import { Aircraft } from './flight';
import { Autopilot } from './autopilot';
import { Combat } from './combat';

export const LESSON_COUNT = 12;
const LAND = 6, DEPART = 7, LOCK = 8, GUNS = 9, MISSILE = 10, DEFEND = 11;
export const COMBAT_LESSON_START = LOCK;

export class FlightInstructor {
  private step = 0;
  private dwell = 0;
  private throttle = 0;
  private baseline = 0;
  private wrongWeapon = 0;
  private delay = 0;

  get lesson(): number { return this.step; }
  get graduated(): boolean { return this.step >= LESSON_COUNT; }

  reset(aircraft: Aircraft): void {
    this.step = this.dwell = this.baseline = this.wrongWeapon = this.delay = 0;
    this.throttle = aircraft.controls.throttle;
  }

  update(aircraft: Aircraft, autopilot: Autopilot, dt: number, combat?: Combat): void {
    if (this.step === LAND && aircraft.phase === 'landed') { this.advance(aircraft, combat); return; }
    if (aircraft.phase !== 'airborne' || autopilot.active || correctiveGuidance(aircraft, false, this.step)) {
      this.dwell = 0;
      return;
    }
    if (combat) this.runDrill(combat, aircraft, dt);
    const drone = combat?.target?.drone ?? false;
    const achieved = [
      aircraft.pitch > 0.08 && aircraft.controls.pitch > 0.02,
      Math.abs(aircraft.pitch) < 0.06 && Math.abs(aircraft.bank) < 0.08,
      Math.abs(aircraft.bank) > 0.15,
      Math.abs(aircraft.bank) < 0.06,
      Math.abs(aircraft.controls.throttle - this.throttle) > 0.08,
      true,
      false,
      aircraft.agl > 150 && !aircraft.gear,
      drone && (combat?.lock ?? 0) >= 1,
      (combat?.gunKills ?? 0) > this.baseline,
      (combat?.missileKills ?? 0) > this.baseline,
      (combat?.missilesDefeated ?? 0) > this.baseline,
    ][this.step] ?? false;
    this.dwell = achieved ? this.dwell + dt : 0;
    if (this.dwell >= (this.step === 5 ? 12 : 0.5)) this.advance(aircraft, combat);
  }

  guidance(aircraft: Aircraft, autopilot: Autopilot, touch: boolean): string {
    return flightGuidance(aircraft, autopilot, touch, this.step);
  }

  private advance(aircraft: Aircraft, combat?: Combat): void {
    this.step++;
    this.dwell = 0;
    if (this.step === 4) this.throttle = aircraft.controls.throttle;
    if (!combat) return;
    this.baseline = this.step === GUNS ? combat.gunKills : this.step === MISSILE ? combat.missileKills
      : this.step === DEFEND ? combat.missilesDefeated : 0;
    this.wrongWeapon = this.step === GUNS ? combat.missileKills : this.step === MISSILE ? combat.gunKills : 0;
    this.delay = 3;
    if (this.step === LOCK) combat.notify('Combat drills: training drone on radar, right of the nose. It will not shoot back.', 6);
    if (this.step === GUNS) combat.notify('Lock confirmed. Now close in for a guns kill.', 4);
    if (this.step === MISSILE) combat.notify('Splash one. Next drone inbound for a missile shot.', 5);
    if (this.step === DEFEND) combat.notify('Good kill. Final drill: a training missile will be fired at you.', 5);
    if (this.graduated) combat.notify('FLIGHT SCHOOL COMPLETE. Congratulations, cadet: you have graduated.', 10);
  }

  private runDrill(combat: Combat, aircraft: Aircraft, dt: number): void {
    if (this.step >= LOCK && this.step <= MISSILE) {
      if (this.step === GUNS && combat.rounds < 200) combat.rounds = combat.loadout.rounds;
      if (this.step === MISSILE && combat.missiles < 2) combat.missiles = 2;
      if (!combat.alive.some(bogey => bogey.drone)) {
        const misuse = this.step === GUNS ? combat.missileKills : this.step === MISSILE ? combat.gunKills : 0;
        if (misuse > this.wrongWeapon) {
          this.wrongWeapon = misuse;
          combat.notify(this.step === GUNS ? 'Guns drill: destroy the drone with the cannon, not a missile. New drone launched.'
            : 'Missile drill: lock the drone and fire a missile. New drone launched.', 5);
        }
        combat.spawnTrainingDrone(aircraft, this.step === MISSILE ? 3500 : 2500, this.step === MISSILE ? 0.25 : 0.4);
      }
    }
    if (this.step === DEFEND) {
      if (combat.flares < 6) combat.flares = combat.loadout.flares;
      if (combat.projectiles.some(projectile => projectile.kind === 'hostile' && !projectile.decoyed)) { this.delay = 4; return; }
      this.delay -= dt;
      if (this.delay <= 0) { combat.launchTrainingMissile(aircraft); this.delay = 4; }
    }
  }
}

function flightGuidance(aircraft: Aircraft, autopilot: Autopilot, touch: boolean, step: number): string {
  const pull = touch ? 'Drag the stick down gently' : 'Hold Down / S gently';
  const thrust = touch ? 'Raise the throttle slider' : 'Hold Shift to add thrust';
  if (aircraft.phase === 'crashed') return 'Aircraft lost. Select Fly Again to practice; open ? for the flight manual.';
  if (aircraft.phase === 'landed') {
    return step === DEPART
      ? `Landing complete. STEP 8/12 - Depart again: ${thrust} to full and roll down the runway. Rotate at 150-170 kt, retract gear and flaps, then climb above 500 ft for combat drills.`
      : `Landing complete. ${touch ? 'Hold BRAKE' : 'Hold B'} to stop, or ${touch ? 'raise the throttle' : 'hold Shift'} to take off again.`;
  }
  const correction = correctiveGuidance(aircraft, touch, step);
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
    `STEP 1/12 - Pitch: ${pull} until the nose rises above 5 degrees. Use small inputs and watch the pitch ladder.`,
    `STEP 2/12 - Level off: ${touch ? 'push the stick forward gently' : 'tap Up / W gently'} to bring pitch near zero, with wings level.`,
    `STEP 3/12 - Turn: ${touch ? 'move the stick sideways' : 'use Left/Right or A/D'} to bank about 10 degrees. Center the control to stop rolling.`,
    `STEP 4/12 - Roll out: ${touch ? 'move the stick opposite the bank' : 'use the opposite roll key'} until wings are level, then release.`,
    `STEP 5/12 - Thrust: ${thrust} or ${touch ? 'lower it' : 'hold Ctrl to reduce it'} by at least 10%. Watch airspeed respond.`,
    'STEP 6/12 - Scan the HUD: heading at top, airspeed left, altitude right, vertical speed below. Hold steady and study these for 12 seconds.',
    'STEP 7/12 - Return and land: follow the blue HOME marker on the radar, or open AP > Return & Land for a guided demonstration. Touch down safely on the runway to continue.',
    `STEP 8/12 - Depart again: climb above 500 ft with gear ${touch ? 'retracted (GEAR button)' : 'retracted (G)'}.`,
    `STEP 9/12 - Radar lock: a training drone is ahead and to the right. Turn toward it and hold the target box inside the HUD acquisition circle until LOCK completes${touch ? '' : ' (Tab selects targets)'}.`,
    `STEP 10/12 - Guns: close within 1 km of the drone, put the nose on it and ${touch ? 'hold GUN' : 'hold Space'} in short bursts until it is destroyed.`,
    `STEP 11/12 - Missile: a new drone is 3.5 km ahead. Acquire LOCK, then ${touch ? 'tap FOX TWO' : 'press M'} to fire a missile.`,
    `STEP 12/12 - Defend: when MSL INBOUND appears, ${touch ? 'tap FLARES' : 'press F'} to release flares and break turn hard. Defeat one missile.`,
  ];
  if (step >= LESSON_COUNT) return 'FLIGHT SCHOOL COMPLETE - Cadet graduated. Free flight: practice any maneuver, land, or open the briefing for a combat sortie.';
  return lessons[Math.min(step, lessons.length - 1)];
}

function correctiveGuidance(aircraft: Aircraft, touch: boolean, step = 0): string | null {
  const combatDrill = step >= COMBAT_LESSON_START;
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
  if (!combatDrill && Math.abs(aircraft.bank) > 0.7) {
    return `CORRECTION - Bank too steep for this lesson. ${touch ? 'Move the stick opposite the bank' : 'Roll opposite the bank with Left/Right or A/D'} to level wings; avoid pulling hard.`;
  }
  if ((!combatDrill && aircraft.pitch > 0.35) || aircraft.airspeed < 100) {
    return 'CORRECTION - Nose high or speed low: ease the nose toward the horizon and add thrust. Keep wings level and let airspeed recover before climbing.';
  }
  if (!combatDrill && (aircraft.pitch < -0.25 || aircraft.verticalSpeed < -20)) {
    return `CORRECTION - Descending too fast: level wings, ${touch ? 'pull the stick down gently' : 'gently hold Down / S'} toward the horizon. Avoid an abrupt high-G pullout.`;
  }
  if (aircraft.airspeed > 300) return 'CORRECTION - Excessive speed for training: reduce throttle and gently level off. Do not deploy gear/flaps at high speed.';
  if (aircraft.gear && aircraft.airspeed > 150) {
    return `CORRECTION - Gear is down at high speed. ${touch ? 'Use GEAR' : 'Press G'} to retract it, or reduce speed if preparing to land.`;
  }
  return null;
}
