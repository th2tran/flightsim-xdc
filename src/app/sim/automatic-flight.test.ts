import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Aircraft, onRunway, STEP } from './flight';
import { Autopilot } from './autopilot';

function tick(aircraft: Aircraft, ap: Autopilot): string | null {
  const message = ap.step(aircraft, STEP);
  aircraft.step(STEP);
  return message;
}

describe('automatic takeoff and landing', () => {
  it.each([0, 180])('takes off on runway course %i and transitions to airborne hold', heading => {
    const aircraft = new Aircraft(true);
    if (heading === 180) {
      aircraft.position.z = -1150;
      aircraft.attitude.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    }
    const ap = new Autopilot();
    expect(ap.engageTakeoff(aircraft)).toBeNull();
    for (let i = 0; i < 120 * 120 && ap.mode === 'takeoff'; i++) {
      tick(aircraft, ap);
      expect(aircraft.phase, `${aircraft.crashReason}, ${aircraft.position.toArray()}`).not.toBe('crashed');
    }
    expect(ap.mode).toBe('hold');
    expect(aircraft.phase).toBe('airborne');
    expect(aircraft.agl).toBeGreaterThan(300);
    expect(aircraft.gear).toBe(false);
    expect(aircraft.flaps).toBe(false);
  });

  it.each([
    [0, 1100, 3400, 0], [6000, 1500, -8000, 90], [-5000, 1800, 6000, 240],
    [15000, 3000, 15000, 180], [-12000, 900, -14000, 310], [0, 4500, -20000, 180],
  ])('returns from %i / %i / %i and lands from heading %i', (x, y, z, heading) => {
    const aircraft = new Aircraft();
    aircraft.position.set(x, y, z);
    aircraft.attitude.setFromAxisAngle(new Vector3(0, 1, 0), -heading * Math.PI / 180);
    aircraft.velocity.copy(aircraft.forward).multiplyScalar(165);
    const ap = new Autopilot();
    expect(ap.engageLanding(aircraft)).toBeNull();
    const stages = new Set<string>();
    let message: string | null = null;
    for (let i = 0; i < 120 * 1200 && ap.active; i++) {
      stages.add(ap.landingStage);
      const event = tick(aircraft, ap);
      message = event ?? message;
      expect(aircraft.phase, `${i / 120}s ${ap.status}: ${aircraft.crashReason}; pos ${aircraft.position.toArray()}; speed ${aircraft.airspeed}; sink ${aircraft.verticalSpeed}; last ${message}`).not.toBe('crashed');
    }
    expect(ap.active, `${ap.status}; pos ${aircraft.position.toArray()}; last ${message}`).toBe(false);
    expect(message).toMatch(/landing complete/);
    expect(aircraft.phase).toBe('landed');
    expect(onRunway(aircraft.position)).toBe(true);
    expect(aircraft.airspeed).toBeLessThan(0.8);
    expect(aircraft.touchdownRate).toBeLessThan(5.5);
    expect(stages.has('flare')).toBe(true);
    expect(stages.has('rollout')).toBe(true);
  });

  it('rejects airborne takeoff and insufficient runway / off-center starts', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    expect(ap.engageTakeoff(aircraft)).not.toBeNull();
    aircraft.reset(true);
    aircraft.position.x = 30;
    expect(ap.engageTakeoff(aircraft)).not.toBeNull();
    aircraft.position.x = 0;
    aircraft.position.z = -1000;
    expect(ap.engageTakeoff(aircraft)).toMatch(/Insufficient/);
    expect(ap.active).toBe(false);
  });

  it('supports a commanded go-around', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engageLanding(aircraft);
    ap.goAround();
    expect(ap.landingStage).toBe('go-around');
    for (let i = 0; i < 120 * 35; i++) tick(aircraft, ap);
    expect(ap.mode).toBe('landing');
    expect(ap.landingStage).not.toBe('go-around');
    expect(aircraft.phase).toBe('airborne');
  });

  it('goes around from a misaligned low approach instead of attempting touchdown', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engageLanding(aircraft);
    ap.landingStage = 'final';
    aircraft.position.set(80, 70, 1200);
    aircraft.velocity.set(0, -4, -90);
    aircraft.airspeed = 90;
    expect(ap.step(aircraft, STEP)).toMatch(/Going around/);
    expect(ap.landingStage).toBe('go-around');
    for (let i = 0; i < 120 * 20; i++) tick(aircraft, ap);
    expect(aircraft.phase).toBe('airborne');
    expect(aircraft.verticalSpeed).toBeGreaterThan(0);
  });

  it('aborts a takeoff when centerline alignment is lost and brakes on the ground', () => {
    const aircraft = new Aircraft(true);
    const ap = new Autopilot();
    ap.engageTakeoff(aircraft);
    aircraft.position.x = 26;
    expect(ap.step(aircraft, STEP)).toMatch(/aborted/);
    expect(ap.active).toBe(false);
    expect(aircraft.controls.brake).toBe(true);
    expect(aircraft.controls.throttle).toBe(0);
  });
});
