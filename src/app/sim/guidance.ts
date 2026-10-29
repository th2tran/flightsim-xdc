import { Aircraft } from './flight';
import { Autopilot } from './autopilot';

export class FlightInstructor {
  private step = 0;
  private dwell = 0;
  private throttle = 0;

  reset(aircraft: Aircraft): void { this.step = 0; this.dwell = 0; this.throttle = aircraft.controls.throttle; }

  update(aircraft: Aircraft, autopilot: Autopilot, dt: number): void {
    if (aircraft.phase !== 'airborne' || autopilot.active || correctiveGuidance(aircraft, false)) {
      this.dwell = 0;
      return;
    }
    const achieved = [
      aircraft.pitch > 0.08 && aircraft.controls.pitch > 0.02,
      Math.abs(aircraft.pitch) < 0.06 && Math.abs(aircraft.bank) < 0.08,
      Math.abs(aircraft.bank) > 0.15,
      Math.abs(aircraft.bank) < 0.06,
      Math.abs(aircraft.controls.throttle - this.throttle) > 0.08,
      true,
    ][this.step] ?? false;
    this.dwell = achieved ? this.dwell + dt : 0;
    if (this.dwell >= (this.step === 5 ? 12 : 0.5)) {
      this.step++;
      this.dwell = 0;
      if (this.step === 4) this.throttle = aircraft.controls.throttle;
    }
  }

  guidance(aircraft: Aircraft, autopilot: Autopilot, touch: boolean): string {
    return flightGuidance(aircraft, autopilot, touch, this.step);
  }
}

function flightGuidance(aircraft: Aircraft, autopilot: Autopilot, touch: boolean, step: number): string {
  const pull = touch ? 'Drag the stick down gently' : 'Hold Down / S gently';
  const thrust = touch ? 'Raise the throttle slider' : 'Hold Shift to add thrust';
  if (aircraft.phase === 'crashed') return 'Aircraft lost. Select Fly Again to practice; open ? for the flight manual.';
  if (aircraft.phase === 'landed') return `Landing complete. ${touch ? 'Hold BRAKE' : 'Hold B'} to stop, then open the briefing for another practice sortie.`;
  const correction = correctiveGuidance(aircraft, touch);
  if (correction) return correction;
  if (autopilot.mode === 'takeoff') return 'Auto Takeoff manages thrust, rotation and gear/flaps. Watch airspeed and altitude; manual flight input disconnects AP.';
  if (autopilot.mode === 'landing') return `Autoland: runway ${autopilot.runway}, ${autopilot.landingStage}. Monitor terrain and alignment. AP > Go Around aborts the approach before rollout.`;
  if (autopilot.active) return `AP is flying. ${touch ? 'Open AP to edit hold targets or Return & Land' : 'H disconnects; R levels wings; AP settings edit hold targets'}. Manual flight input takes control.`;
  if (aircraft.phase === 'parked' || aircraft.phase === 'takeoff') {
    return aircraft.airspeed < 78
      ? `${thrust} to full; release brakes and keep runway centerline. Rotate at 150-170 kt. AP > Auto Takeoff can demonstrate.`
      : `${pull} to lift off at 150-170 kt. Keep wings level; retract gear and flaps after a positive climb.`;
  }
  if (aircraft.verticalSpeed > 1 && aircraft.agl > 30 && (aircraft.gear || aircraft.flaps)) {
    return `Positive climb: ${touch ? 'use the GEAR and FLAPS buttons' : 'press G for gear and L for flaps'} to retract them when speed permits. Monitor airspeed.`;
  }
  const lessons = [
    `STEP 1/7 - Pitch: ${pull} until the nose rises above 5 degrees. Use small inputs and watch the pitch ladder.`,
    `STEP 2/7 - Level off: ${touch ? 'push the stick forward gently' : 'tap Up / W gently'} to bring pitch near zero, with wings level.`,
    `STEP 3/7 - Turn: ${touch ? 'move the stick sideways' : 'use Left/Right or A/D'} to bank about 10 degrees. Center the control to stop rolling.`,
    `STEP 4/7 - Roll out: ${touch ? 'move the stick opposite the bank' : 'use the opposite roll key'} until wings are level, then release.`,
    `STEP 5/7 - Thrust: ${thrust} or ${touch ? 'lower it' : 'hold Ctrl to reduce it'} by at least 10%. Watch airspeed respond.`,
    'STEP 6/7 - Scan the HUD: heading at top, airspeed left, altitude right, vertical speed below. Hold steady and study these for 12 seconds.',
    'STEP 7/7 - Return and land: open AP > Return & Land for a guided demonstration. It flies a full circuit, configures gear/flaps, flares and brakes. Monitor the approach; Go Around retries it.',
  ];
  return lessons[Math.min(step, lessons.length - 1)];
}

function correctiveGuidance(aircraft: Aircraft, touch: boolean): string | null {
  if (aircraft.phase !== 'airborne') {
    if ((aircraft.phase === 'parked' || aircraft.phase === 'takeoff') && aircraft.controls.brake && aircraft.controls.throttle > 0.3) {
      return `CORRECTION - Brakes are holding you back. ${touch ? 'Release BRAKE' : 'Release B'} before accelerating down the runway.`;
    }
    return null;
  }
  if (aircraft.stalled) return `CORRECTION - Stall: ease nose down, level wings and add full thrust. ${touch ? 'Open AP > Stall Recovery' : 'Press T for stall recovery'} if altitude permits.`;
  if (aircraft.agl < 120 && aircraft.verticalSpeed < -1) {
    return 'CORRECTION - Low and descending: if not aligned on a safe runway approach, level wings, add thrust and climb. Do not pull sharply into a stall.';
  }
  if (Math.abs(aircraft.bank) > 0.7) {
    return `CORRECTION - Bank too steep for this lesson. ${touch ? 'Move the stick opposite the bank' : 'Roll opposite the bank with Left/Right or A/D'} to level wings; avoid pulling hard.`;
  }
  if (aircraft.pitch > 0.35 || aircraft.airspeed < 100) {
    return 'CORRECTION - Nose high or speed low: ease the nose toward the horizon and add thrust. Keep wings level and let airspeed recover before climbing.';
  }
  if (aircraft.pitch < -0.25 || aircraft.verticalSpeed < -20) {
    return `CORRECTION - Descending too fast: level wings, ${touch ? 'pull the stick down gently' : 'gently hold Down / S'} toward the horizon. Avoid an abrupt high-G pullout.`;
  }
  if (aircraft.airspeed > 300) return 'CORRECTION - Excessive speed for training: reduce throttle and gently level off. Do not deploy gear/flaps at high speed.';
  if (aircraft.gear && aircraft.airspeed > 150) {
    return `CORRECTION - Gear is down at high speed. ${touch ? 'Use GEAR' : 'Press G'} to retract it, or reduce speed if preparing to land.`;
  }
  return null;
}
