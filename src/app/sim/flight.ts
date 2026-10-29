import { Quaternion, Vector3 } from 'three';

export type FlightPhase = 'parked' | 'takeoff' | 'airborne' | 'landed' | 'crashed';
export type Scenario = 'training' | 'intercept' | 'furball';
export interface Controls {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  brake: boolean;
}

export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
export const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, -1);
export const G = 9.80665;
export const STEP = 1 / 120;
export const GEAR_HEIGHT = 2.2;

export function terrainHeight(x: number, z: number): number {
  const distance = Math.hypot(x, z);
  const fade = clamp((distance - 2200) / 3000, 0, 1);
  return fade * (200 + 130 * Math.sin(x / 1800) * Math.cos(z / 2400)
    + 85 * Math.sin((x + z) / 1100) + 60 * Math.cos(x / 650));
}

export function onRunway(p: Vector3): boolean {
  return Math.abs(p.x) < 38 && Math.abs(p.z) < 1600;
}

/** Body axes: +X right, +Y up, -Z forward. Angular rates are body-local. */
export class Aircraft {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly attitude = new Quaternion();
  readonly rates = new Vector3();
  readonly controls: Controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.72, brake: false };
  readonly surfaces = { elevator: 0, aileron: 0, rudder: 0 };
  phase: FlightPhase = 'airborne';
  gear = false;
  flaps = false;
  health = 100;
  fuel = 2400;
  gLoad = 1;
  alpha = 0;
  beta = 0;
  airspeed = 0;
  verticalSpeed = 0;
  stalled = false;
  touchdownRate = 0;
  crashReason = '';
  private readonly bodyVelocity = new Vector3();
  private readonly force = new Vector3();
  private readonly inverse = new Quaternion();
  private readonly delta = new Quaternion();
  private readonly axis = new Vector3();

  constructor(runway = false) { this.reset(runway); }

  reset(runway: boolean): void {
    this.position.set(0, runway ? GEAR_HEIGHT : 1100, runway ? 1150 : 3400);
    this.velocity.set(0, 0, runway ? 0 : -165);
    this.attitude.setFromAxisAngle(new Vector3(1, 0, 0), runway ? 0 : 0.035);
    this.rates.set(0, 0, 0);
    this.phase = runway ? 'parked' : 'airborne';
    this.gear = runway;
    this.flaps = runway;
    this.health = 100;
    this.fuel = 2400;
    this.controls.throttle = runway ? 0 : 0.72;
    this.controls.pitch = this.controls.roll = this.controls.yaw = 0;
    this.controls.brake = false;
    this.surfaces.elevator = this.surfaces.aileron = this.surfaces.rudder = 0;
    this.gLoad = 1;
    this.airspeed = runway ? 0 : 165;
    this.alpha = this.beta = this.verticalSpeed = 0;
    this.stalled = false;
    this.touchdownRate = 0;
    this.crashReason = '';
  }

  get forward(): Vector3 { return FORWARD.clone().applyQuaternion(this.attitude); }
  get up(): Vector3 { return UP.clone().applyQuaternion(this.attitude); }
  get agl(): number { return this.position.y - terrainHeight(this.position.x, this.position.z) - GEAR_HEIGHT; }
  get heading(): number {
    const f = this.forward;
    return (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
  }
  get pitch(): number { return Math.asin(clamp(this.forward.y, -1, 1)); }
  get bank(): number {
    const right = new Vector3(1, 0, 0).applyQuaternion(this.attitude);
    return Math.atan2(-right.y, this.up.y);
  }

  crash(reason: string): void {
    this.health = 0;
    this.phase = 'crashed';
    this.crashReason = reason;
  }

  step(dt: number): void {
    if (this.phase === 'crashed') return;
    this.inverse.copy(this.attitude).invert();
    this.bodyVelocity.copy(this.velocity).applyQuaternion(this.inverse);
    this.airspeed = this.velocity.length();
    const speed = this.airspeed;
    const forwardSpeed = -this.bodyVelocity.z;
    this.alpha = Math.atan2(-this.bodyVelocity.y, Math.max(1, forwardSpeed));
    this.beta = Math.atan2(this.bodyVelocity.x, Math.max(1, forwardSpeed));
    const density = 1.225 * Math.exp(-Math.max(0, this.position.y) / 8500);
    const q = 0.5 * density * speed * speed;
    const area = 28;
    const mass = 8500 + this.fuel;
    const response = 1 - Math.exp(-dt * 9);
    this.surfaces.elevator += (clamp(this.controls.pitch, -1, 1) * 0.44 - this.surfaces.elevator) * response;
    this.surfaces.aileron += (clamp(this.controls.roll, -1, 1) * 0.35 - this.surfaces.aileron) * response;
    this.surfaces.rudder += (clamp(this.controls.yaw, -1, 1) * 0.40 - this.surfaces.rudder) * response;
    const criticalAlpha = this.flaps ? 0.31 : 0.29;
    this.stalled = Math.abs(this.alpha) > criticalAlpha && speed > 25;
    let liftCoefficient = 0.16 + 4.6 * this.alpha + (this.flaps ? 0.42 : 0);
    if (this.stalled) liftCoefficient *= Math.max(0.18, 1 - (Math.abs(this.alpha) - criticalAlpha) * 2.5);
    liftCoefficient = clamp(liftCoefficient, -1.7, 1.8);
    const dragCoefficient = 0.025 + 0.065 * liftCoefficient ** 2
      + (this.gear ? 0.035 : 0) + (this.flaps ? 0.04 : 0)
      + (this.stalled ? 0.18 : 0) + Math.max(0, speed - 290) * 0.0007;
    const throttle = clamp(this.controls.throttle, 0, 1);
    const thrust = this.fuel > 0 ? (throttle * 85000 + Math.max(0, throttle - 0.88) / 0.12 * 45000) : 0;
    this.fuel = Math.max(0, this.fuel - dt * (0.25 + throttle * 0.9 + (throttle > 0.88 ? 2 : 0)));
    this.force.copy(this.bodyVelocity).multiplyScalar(speed > 0.01 ? -q * area * dragCoefficient / speed : 0);
    // Lift is perpendicular to the local relative wind, not fixed to world-up.
    this.force.y += q * area * liftCoefficient * Math.cos(this.alpha);
    this.force.z -= q * area * liftCoefficient * Math.sin(this.alpha);
    this.force.x += -q * area * 0.9 * this.beta;
    this.force.z -= thrust;
    this.gLoad = clamp(this.force.y / (mass * G), -15, 15);
    this.force.applyQuaternion(this.attitude);
    this.force.y -= mass * G;

    const ground = terrainHeight(this.position.x, this.position.z) + GEAR_HEIGHT;
    const grounded = this.phase !== 'airborne' && this.position.y <= ground + 0.04 && this.velocity.y <= 0.5;
    if (grounded) {
      this.force.y = Math.max(0, this.force.y);
      const friction = (this.controls.brake ? 0.45 : 0.018) * mass * G;
      const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
      if (horizontal > 0.01) {
        const resistance = Math.min(friction, horizontal * mass / dt);
        this.force.x -= this.velocity.x / horizontal * resistance;
        this.force.z -= this.velocity.z / horizontal * resistance;
      }
    }

    const authority = q * area * 3;
    const pitchTorque = authority * (0.8 * (0.035 - this.alpha)
      + this.surfaces.elevator * 0.95 - this.rates.x * 2.6 / Math.max(speed, 40));
    const yawTorque = q * area * 10 * (0.20 * this.beta
      - this.surfaces.rudder * 0.13 - this.rates.y * 3 / Math.max(speed, 40));
    const rollTorque = q * area * 10 * (-this.surfaces.aileron * 0.13
      - this.rates.z * 2.3 / Math.max(speed, 40));
    const ix = 70000, iy = 85000, iz = 25000;
    // Euler rigid-body equation includes gyroscopic cross-coupling.
    this.rates.x += dt * (pitchTorque - (iz - iy) * this.rates.y * this.rates.z) / ix;
    this.rates.y += dt * (yawTorque - (ix - iz) * this.rates.z * this.rates.x) / iy;
    this.rates.z += dt * (rollTorque - (iy - ix) * this.rates.x * this.rates.y) / iz;
    if (grounded) {
      this.rates.y += (-this.controls.yaw * speed * 0.015 - this.rates.y) * Math.min(1, dt * 5);
      this.rates.z *= Math.exp(-8 * dt);
      if (speed < 55) this.rates.x *= Math.exp(-8 * dt);
    }
    this.rates.clampLength(0, 3.5);
    const rotation = this.rates.length();
    if (rotation > 0.000001) {
      this.axis.copy(this.rates).divideScalar(rotation);
      this.delta.setFromAxisAngle(this.axis, rotation * dt);
      this.attitude.multiply(this.delta).normalize();
    }
    this.velocity.addScaledVector(this.force, dt / mass);
    this.position.addScaledVector(this.velocity, dt);
    this.verticalSpeed = this.velocity.y;
    const floor = terrainHeight(this.position.x, this.position.z) + GEAR_HEIGHT;
    if (this.position.y <= floor) {
      const touchdown = !grounded;
      this.touchdownRate = touchdown ? -this.velocity.y : this.touchdownRate;
      if (!this.gear || !onRunway(this.position) || this.velocity.y < -5.5
        || Math.abs(this.bank) > 0.18 || this.pitch < -0.07 || this.pitch > 0.30) {
        this.crash(!this.gear ? 'Gear-up ground impact' : !onRunway(this.position)
          ? 'Terrain impact / runway excursion' : 'Landing envelope exceeded');
        return;
      }
      this.position.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
      if (this.phase === 'airborne') this.phase = 'landed';
      else if (this.phase === 'parked' && speed > 3) this.phase = 'takeoff';
    } else if (this.position.y > floor + 1.5) {
      this.phase = 'airborne';
    }
    if (this.airspeed > 390) this.health -= dt * (this.airspeed - 390) * 0.025;
    if (this.health <= 0) this.crash('Airframe destroyed');
  }
}
