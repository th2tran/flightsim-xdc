import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Aircraft, STEP } from './flight';
import { flightPathAngle, FBW_MAX_G, FlyByWire } from './fly-by-wire';

function fly(plane: Aircraft, law: FlyByWire, seconds: number, input: (t: number) => number = () => 0): { maxG: number; stalled: boolean } {
  let maxG = -Infinity, stalled = false;
  for (let i = 0; i < seconds / STEP; i++) {
    plane.controls.pitch = law.command(plane, input(i * STEP));
    plane.step(STEP);
    if (i * STEP > 0.5) maxG = Math.max(maxG, plane.gLoad);
    stalled ||= plane.stalled;
  }
  return { maxG, stalled };
}

function airborne(speed: number, throttle: number): { plane: Aircraft; law: FlyByWire } {
  const plane = new Aircraft();
  plane.velocity.set(0, 0, -speed);
  plane.controls.throttle = throttle;
  const law = new FlyByWire();
  law.capture(plane);
  return { plane, law };
}

describe('fly-by-wire pitch law', () => {
  it.each([[120, 0.45], [165, 0.72], [280, 0.9]])('holds level flight hands-off at %i m/s', (speed, throttle) => {
    const { plane, law } = airborne(speed, throttle);
    fly(plane, law, 16);
    expect(Math.abs(plane.position.y - 1100)).toBeLessThan(15);
    expect(Math.abs(plane.verticalSpeed)).toBeLessThan(1.5);
  });

  it('holds the new flight path after the stick is released', () => {
    const { plane, law } = airborne(165, 0.9);
    fly(plane, law, 2, () => 1);
    fly(plane, law, 3);
    const held = law.heldPath;
    expect(held).toBeGreaterThan(0.2);
    fly(plane, law, 5);
    expect(Math.abs(flightPathAngle(plane) - held)).toBeLessThan(0.02);
  });

  it('holds altitude hands-off in a moderate bank', () => {
    const { plane, law } = airborne(180, 0.8);
    plane.attitude.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 4));
    fly(plane, law, 10);
    expect(Math.abs(plane.position.y - 1100)).toBeLessThan(15);
  });

  it('limits load factor and avoids stalling on a sustained full pull with thrust', () => {
    const { plane, law } = airborne(250, 0.9);
    const result = fly(plane, law, 8, () => 1);
    expect(result.maxG).toBeLessThanOrEqual(FBW_MAX_G + 0.3);
    expect(result.stalled).toBe(false);
  });

  it('still allows a stall when pulling hard at idle thrust', () => {
    const { plane, law } = airborne(165, 0);
    expect(fly(plane, law, 14, () => 1).stalled).toBe(true);
  });

  it('passes stick input straight through on the ground', () => {
    const plane = new Aircraft(true);
    expect(new FlyByWire().command(plane, 0.6)).toBe(0.6);
  });

  it('trims the held flight path', () => {
    const { plane, law } = airborne(200, 0.85);
    law.adjustHeldPath(5 * Math.PI / 180);
    fly(plane, law, 12);
    expect(flightPathAngle(plane)).toBeCloseTo(5 * Math.PI / 180, 1);
    expect(plane.verticalSpeed).toBeGreaterThan(10);
  });
});
