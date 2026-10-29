import { Aircraft, clamp, G, GEAR_HEIGHT, onRunway, terrainHeight } from './flight';

export type AutopilotMode = 'off' | 'hold' | 'recovery' | 'stall-recovery' | 'takeoff' | 'landing';
export type LandingStage = 'return' | 'align' | 'final' | 'flare' | 'rollout' | 'go-around';
export const headingError = (target: number, current: number): number => ((target - current + 540) % 360 + 360) % 360 - 180;

export class Autopilot {
  mode: AutopilotMode = 'off';
  heading = 0;
  altitude = 3600;
  speed = 320;
  private speedIntegral = 0;
  private recoveredTime = 0;
  landingStage: LandingStage = 'return';
  runway: '36' | '18' = '36';
  private direction = 1;
  private route: { x: number; z: number }[] = [];
  private routeIndex = 0;
  private takeoffAirborne = false;
  private goAroundTime = 0;

  get automaticFlight(): boolean { return this.mode === 'takeoff' || this.mode === 'landing'; }
  get status(): string {
    if (this.mode === 'takeoff') return 'AUTO TAKEOFF';
    if (this.mode === 'landing') return `RWY ${this.runway} / ${this.landingStage.toUpperCase()}`;
    return this.mode === 'hold' ? 'HDG / ALT / SPD' : this.mode === 'recovery' ? 'LEVEL / SPD'
      : this.mode === 'stall-recovery' ? 'STALL RECOVERY' : 'OFF';
  }

  get active(): boolean { return this.mode !== 'off'; }

  engage(aircraft: Aircraft, recovery = false): string | null {
    return this.engageMode(aircraft, recovery ? 'recovery' : 'hold');
  }

  engageTakeoff(aircraft: Aircraft): string | null {
    const course = Math.abs(headingError(0, aircraft.heading)) < 15 ? 0
      : Math.abs(headingError(180, aircraft.heading)) < 15 ? 180 : null;
    if (!['parked', 'landed', 'takeoff'].includes(aircraft.phase) || !onRunway(aircraft.position)
      || Math.abs(aircraft.position.x) > 15 || course === null || aircraft.airspeed > 45
      || Math.abs(aircraft.bank) > 0.1 || aircraft.fuel < 100 || aircraft.health <= 0) {
      return 'Auto takeoff requires runway centerline, heading 000/180 ±15°, speed below 87 kt, and fuel.';
    }
    const direction = course === 0 ? 1 : -1;
    if (1600 + aircraft.position.z * direction < 1600) return 'Insufficient runway ahead for auto takeoff. Reposition near the departure threshold.';
    this.disengage();
    this.mode = 'takeoff';
    this.heading = course;
    this.direction = direction;
    this.runway = course === 0 ? '36' : '18';
    this.altitude = 3000;
    this.speed = 280;
    this.takeoffAirborne = false;
    aircraft.gear = aircraft.flaps = true;
    aircraft.controls.brake = false;
    return null;
  }

  engageLanding(aircraft: Aircraft): string | null {
    const error = this.engage(aircraft);
    if (error) return error;
    this.mode = 'landing';
    this.direction = aircraft.position.z >= 0 ? 1 : -1;
    this.runway = this.direction === 1 ? '36' : '18';
    this.planReturn(aircraft);
    return null;
  }

  private planReturn(aircraft: Aircraft): void {
    const side = aircraft.position.x < 0 ? -1 : 1;
    this.route = [
      { x: side * 7000, z: this.direction * 15000 },
      { x: 0, z: this.direction * 23000 },
      { x: 0, z: this.direction * 12000 },
    ];
    this.routeIndex = 0;
    this.landingStage = 'return';
    this.speedIntegral = 0;
    this.goAroundTime = 0;
  }

  goAround(): void {
    if (this.mode !== 'landing' || this.landingStage === 'rollout') return;
    this.landingStage = 'go-around';
    this.goAroundTime = 0;
    this.speedIntegral = 0;
  }

  engageStallRecovery(aircraft: Aircraft): string | null {
    return this.engageMode(aircraft, 'stall-recovery');
  }

  private engageMode(aircraft: Aircraft, mode: 'hold' | 'recovery' | 'stall-recovery'): string | null {
    if (aircraft.phase !== 'airborne') return 'This autopilot mode requires airborne flight. Use AUTO TAKEOFF on the runway.';
    if (aircraft.fuel <= 0 || aircraft.health <= 0) return 'Autopilot unavailable: engine or airframe failure.';
    const stallRecovery = mode === 'stall-recovery';
    if (aircraft.agl < (stallRecovery ? 30 : 150)) return stallRecovery
      ? 'Stall recovery requires at least 100 ft terrain clearance; immediate manual recovery required.'
      : 'Autopilot requires at least 500 ft terrain clearance.';
    if (aircraft.airspeed < (stallRecovery ? 45 : 90) || aircraft.airspeed > 330 || (!stallRecovery && aircraft.stalled)
      || Math.abs(aircraft.pitch) > (stallRecovery ? 1.45 : 1) || Math.abs(aircraft.bank) > 2.6) {
      return 'Autopilot unavailable outside the flight envelope. Recover speed and attitude manually.';
    }
    this.mode = mode;
    this.heading = Math.round(aircraft.heading) % 360;
    this.altitude = clamp(Math.round(aircraft.position.y * 3.28084), 1000, 30000);
    this.speed = clamp(Math.round(aircraft.airspeed * 1.94384), 220, 550);
    this.speedIntegral = 0;
    this.recoveredTime = 0;
    return null;
  }

  disengage(): void { this.mode = 'off'; this.speedIntegral = 0; this.recoveredTime = 0; }

  step(aircraft: Aircraft, dt: number): string | null {
    if (!this.active) return null;
    if (aircraft.phase === 'crashed' || aircraft.fuel <= 0 || aircraft.health <= 0) {
      this.disengage();
      return aircraft.phase === 'crashed' ? 'Autopilot disconnected: aircraft crashed.'
        : aircraft.fuel <= 0 ? 'Autopilot disconnected: fuel exhausted.'
        : 'Autopilot disconnected: airframe destroyed.';
    }
    if (this.mode === 'takeoff') return this.stepTakeoff(aircraft, dt);
    if (this.mode === 'landing') return this.stepLanding(aircraft, dt);
    const enteringStall = aircraft.stalled && this.mode !== 'stall-recovery';
    if (enteringStall) {
      this.mode = 'stall-recovery';
      this.speedIntegral = this.recoveredTime = 0;
    }
    const stallRecovery = this.mode === 'stall-recovery';
    const minimumClearance = stallRecovery ? 20 : 120;
    const reason = aircraft.phase !== 'airborne' ? 'aircraft is not airborne'
      : aircraft.agl < minimumClearance ? `terrain clearance ${Math.round(aircraft.agl * 3.28084)} ft below ${Math.round(minimumClearance * 3.28084)} ft minimum`
      : aircraft.airspeed > 350 ? `overspeed ${Math.round(aircraft.airspeed * 1.94384)} kt`
      : !stallRecovery && aircraft.airspeed < 80 ? `airspeed ${Math.round(aircraft.airspeed * 1.94384)} kt below 156 kt minimum`
      : !stallRecovery && Math.abs(aircraft.pitch) > 1.15 ? 'pitch exceeds 66 degrees'
      : !stallRecovery && Math.abs(aircraft.bank) > 2.8 ? 'bank exceeds 160 degrees' : null;
    if (reason) {
      this.disengage();
      return `Autopilot disconnected: ${reason}. Manual control.`;
    }
    const bank = aircraft.bank;
    const targetBank = this.mode !== 'hold' ? 0
      : clamp(headingError(this.heading, aircraft.heading) * Math.PI / 180 * 1.4, -0.44, 0.44);
    this.controlLateral(aircraft, targetBank);
    if (stallRecovery) {
      aircraft.controls.pitch = clamp((0.06 - aircraft.alpha) * 1.3 - aircraft.rates.x * 0.35, -0.55, 0.35);
      aircraft.controls.throttle = 1;
      aircraft.controls.brake = false;
      const recovered = aircraft.agl >= 150 && Math.abs(aircraft.pitch) < 1
        && !aircraft.stalled && Math.abs(aircraft.alpha) < 0.12
        && aircraft.airspeed > 115 && Math.abs(bank) < 0.15 && Math.abs(aircraft.beta) < 0.12;
      this.recoveredTime = recovered ? this.recoveredTime + dt : 0;
      if (this.recoveredTime >= 3) {
        this.mode = 'recovery';
        this.heading = Math.round(aircraft.heading) % 360;
        this.altitude = clamp(Math.round(aircraft.position.y * 3.28084), 1000, 30000);
        this.speed = Math.max(280, this.speed);
        this.speedIntegral = this.recoveredTime = 0;
        return 'Stall recovered. Wings-level and speed hold engaged; check terrain and flight path.';
      }
      return enteringStall ? 'Stall recovery engaged: unloading wing, wings level, full thrust. Monitor terrain.' : null;
    }
    const verticalTarget = this.mode === 'recovery' ? 0
      : clamp((this.altitude / 3.28084 - aircraft.position.y) * 0.12, -12, 12);
    this.controlVertical(aircraft, dt, verticalTarget);
    return null;
  }

  private controlLateral(aircraft: Aircraft, targetBank: number): void {
    aircraft.controls.roll = clamp((targetBank - aircraft.bank) * 0.4 + aircraft.rates.z * 0.3, -0.35, 0.35);
    const turnRate = G * Math.tan(clamp(aircraft.bank, -0.7, 0.7)) / Math.max(40, aircraft.airspeed);
    aircraft.controls.yaw = clamp(aircraft.beta * 7 + (aircraft.rates.y + turnRate) * 0.8, -0.8, 0.8);
  }

  private controlVertical(aircraft: Aircraft, dt: number, verticalTarget: number): void {
    const bank = aircraft.bank;
    const density = 1.225 * Math.exp(-Math.max(0, aircraft.position.y) / 8500);
    const qArea = 0.5 * density * aircraft.airspeed ** 2 * aircraft.airframe.wingArea;
    const mass = aircraft.airframe.mass + aircraft.fuel;
    const liftCoefficient = mass * G / (qArea * Math.max(0.65, Math.cos(bank)));
    const trimAlpha = clamp((liftCoefficient - 0.16 - (aircraft.flaps ? 0.42 : 0)) / 4.6, -0.06, 0.18);
    const targetPitch = clamp(trimAlpha + Math.asin(clamp(verticalTarget / aircraft.airspeed, -0.15, 0.15))
      + (verticalTarget - aircraft.verticalSpeed) * 0.003, -0.16, 0.28);
    const trimElevator = 0.8 * (trimAlpha - 0.035) / (0.95 * 0.44);
    aircraft.controls.pitch = clamp(trimElevator + (targetPitch - aircraft.pitch) * 0.65
      - aircraft.rates.x * 0.28, -0.35, 0.35);
    const speedError = this.speed / 1.94384 - aircraft.airspeed;
    this.speedIntegral = clamp(this.speedIntegral + speedError * dt * 0.003, -0.35, 0.35);
    const drag = qArea * (aircraft.airframe.drag + 0.065 * liftCoefficient ** 2 + (aircraft.gear ? 0.035 : 0)
      + (aircraft.flaps ? 0.04 : 0) + Math.max(0, aircraft.airspeed - 290) * 0.0007);
    const feedForward = (drag + mass * G * verticalTarget / aircraft.airspeed) / aircraft.airframe.thrust;
    aircraft.controls.throttle = clamp(feedForward + speedError * 0.025 + this.speedIntegral, 0, 1);
    aircraft.controls.brake = false;
  }

  private trackHeading(aircraft: Aircraft, bankLimit = 0.44): void {
    const bank = clamp(headingError(this.heading, aircraft.heading) * Math.PI / 180 * 1.4, -bankLimit, bankLimit);
    this.controlLateral(aircraft, bank);
  }

  private groundControls(aircraft: Aircraft, brake: boolean): void {
    const course = this.direction === 1 ? 0 : 180;
    this.heading = course;
    aircraft.controls.pitch = aircraft.controls.roll = 0;
    aircraft.controls.yaw = clamp(headingError(course, aircraft.heading) * 0.06
      - aircraft.position.x * this.direction * 0.015 + aircraft.rates.y * 0.4, -0.3, 0.3);
    aircraft.controls.throttle = brake ? 0 : 1;
    aircraft.controls.brake = brake;
  }

  private stepTakeoff(aircraft: Aircraft, dt: number): string | null {
    if (!this.takeoffAirborne && aircraft.phase !== 'airborne') {
      aircraft.gear = aircraft.flaps = true;
      this.groundControls(aircraft, false);
      if (!onRunway(aircraft.position) || Math.abs(aircraft.position.x) > 25
        || Math.abs(headingError(this.heading, aircraft.heading)) > 20
        || (1600 + aircraft.position.z * this.direction < 350 && aircraft.airspeed < 75)) {
        this.disengage();
        aircraft.controls.throttle = 0;
        aircraft.controls.brake = true;
        return 'Auto takeoff aborted: runway / alignment / speed. Brakes applied; manual control.';
      }
      if (aircraft.airspeed > 78) aircraft.controls.pitch = clamp((0.12 - aircraft.pitch) * 1.1 - aircraft.rates.x * 0.3 + 0.10, 0, 0.25);
      return null;
    }
    this.takeoffAirborne = true;
    if (aircraft.phase !== 'airborne') {
      this.disengage();
      return 'Auto takeoff disconnected: unexpected ground contact.';
    }
    this.trackHeading(aircraft);
    this.controlVertical(aircraft, dt, 10);
    if (aircraft.agl > 20 && aircraft.verticalSpeed > 0) aircraft.gear = false;
    if (aircraft.agl > 90 && aircraft.airspeed > 105) aircraft.flaps = false;
    if (aircraft.agl > 300 && aircraft.airspeed > 120 && !aircraft.gear && !aircraft.flaps) {
      this.mode = 'hold';
      this.altitude = Math.round(aircraft.position.y * 3.28084);
      this.speed = Math.round(aircraft.airspeed * 1.94384);
      this.speedIntegral = 0;
      return 'Auto takeoff complete. Heading, altitude and speed hold engaged.';
    }
    if (aircraft.stalled) {
      this.mode = 'stall-recovery';
      this.recoveredTime = 0;
      return 'Departure stall: automatic stall recovery engaged.';
    }
    return null;
  }

  private stepLanding(aircraft: Aircraft, dt: number): string | null {
    if (aircraft.phase === 'landed' || this.landingStage === 'rollout') {
      this.landingStage = 'rollout';
      aircraft.gear = true;
      this.groundControls(aircraft, true);
      if (aircraft.airspeed < 0.15) {
        this.disengage();
        aircraft.controls.brake = true;
        return 'Automatic landing complete. Aircraft stopped on runway.';
      }
      return null;
    }
    if (aircraft.phase !== 'airborne') {
      this.disengage();
      return 'Automatic landing disconnected: aircraft is not airborne.';
    }
    if (aircraft.stalled) {
      this.mode = 'stall-recovery';
      this.recoveredTime = 0;
      return 'Approach stall: automatic stall recovery engaged. Landing cancelled.';
    }
    if (aircraft.airspeed < 70 || aircraft.airspeed > 350 || Math.abs(aircraft.pitch) > 1.15 || Math.abs(aircraft.bank) > 2.8) {
      this.disengage();
      return 'Automatic landing disconnected: flight envelope exceeded. Manual control.';
    }
    if (this.landingStage === 'go-around') {
      this.goAroundTime += dt;
      this.heading = this.direction === 1 ? 0 : 180;
      this.speed = 280;
      this.trackHeading(aircraft);
      this.controlVertical(aircraft, dt, 10);
      if (aircraft.agl > 30 && aircraft.verticalSpeed > 0) aircraft.gear = false;
      if (aircraft.agl > 120 && aircraft.airspeed > 105) aircraft.flaps = false;
      if (aircraft.agl > 450 && this.goAroundTime > 30) {
        this.planReturn(aircraft);
        return 'Go-around complete. Rejoining return-to-base approach.';
      }
      return null;
    }
    if (this.landingStage === 'return' || this.landingStage === 'align') {
      const waypoint = this.route[this.routeIndex];
      const dx = waypoint.x - aircraft.position.x, dz = waypoint.z - aircraft.position.z;
      this.heading = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
      if (this.routeIndex === 2) {
        const course = this.direction === 1 ? 0 : 180;
        const intercept = Math.atan2(-aircraft.position.x * this.direction, 3000) * 180 / Math.PI;
        this.heading = (course + clamp(intercept, -35, 35) + 360) % 360;
      }
      this.speed = this.routeIndex < 2 ? 270 : 230;
      const clearance = terrainHeight(aircraft.position.x, aircraft.position.z) + 450;
      const glideHeight = GEAR_HEIGHT + Math.max(0, aircraft.position.z * this.direction - 400) * Math.tan(4.5 * Math.PI / 180);
      this.altitude = (this.routeIndex === 2 ? Math.max(glideHeight, terrainHeight(aircraft.position.x, aircraft.position.z) + 100)
        : Math.max(900, clearance)) * 3.28084;
      aircraft.gear = false;
      aircraft.flaps = false;
      this.trackHeading(aircraft);
      const descentFeed = this.routeIndex === 2 ? -aircraft.airspeed * Math.tan(4.5 * Math.PI / 180) : 0;
      this.controlVertical(aircraft, dt, clamp(descentFeed + (this.altitude / 3.28084 - aircraft.position.y) * 0.08, -12, 12));
      if (this.routeIndex < 2 && Math.hypot(dx, dz) < 5500) {
        this.routeIndex++;
        this.landingStage = 'align';
      } else if (this.routeIndex === 2) {
        const along = aircraft.position.z * this.direction;
        if (along < 16000 && along > 6000 && Math.abs(aircraft.position.x) < 150
          && Math.abs(headingError(this.direction === 1 ? 0 : 180, aircraft.heading)) < 8 && aircraft.position.y < 1300) {
          this.landingStage = 'final';
          this.speedIntegral = 0;
          return `Runway ${this.runway} captured. Gear down, flaps down, final approach.`;
        } else if (along < 6000) {
          this.goAround();
          return 'Approach not stabilized at final fix. Going around.';
        }
      }
      return null;
    }
    const along = aircraft.position.z * this.direction;
    const distance = along - 400;
    const course = this.direction === 1 ? 0 : 180;
    const intercept = Math.atan2(-aircraft.position.x * this.direction, Math.max(500, Math.min(2500, Math.abs(distance)))) * 180 / Math.PI;
    this.heading = (course + clamp(intercept, -20, 20) + 360) % 360;
    aircraft.gear = aircraft.flaps = true;
    this.speed = 175;
    const glideHeight = GEAR_HEIGHT + Math.max(0, distance) * Math.tan(4.5 * Math.PI / 180);
    const unsafe = along < -1100 || (along > 2200 && aircraft.agl < 35)
      || (along < 2500 && aircraft.agl < 100 && (Math.abs(aircraft.position.x) > 22
      || Math.abs(headingError(course, aircraft.heading)) > 8 || Math.abs(aircraft.bank) > 0.14
      || (aircraft.agl < 12 && aircraft.verticalSpeed < -5.2) || aircraft.airspeed < 80 || aircraft.airspeed > 110));
    if (unsafe) {
      this.goAround();
      return 'Unstable final approach. Going around; climb and rejoin.';
    }
    if (aircraft.agl < 30 && along < 1600) this.landingStage = 'flare';
    const verticalTarget = this.landingStage === 'flare'
      ? -clamp(aircraft.agl * 0.15, 1.5, 3)
      : clamp(-aircraft.airspeed * Math.tan(4.5 * Math.PI / 180) + (glideHeight - aircraft.position.y) * 0.12, -10, 5);
    this.trackHeading(aircraft, 0.12);
    this.controlVertical(aircraft, dt, verticalTarget);
    return null;
  }
}
