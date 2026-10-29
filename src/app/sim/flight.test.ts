import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Aircraft, GEAR_HEIGHT, onRunway, STEP, terrainHeight } from './flight';

function advance(plane: Aircraft, seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) plane.step(STEP);
}

describe('six-degree-of-freedom flight', () => {
  it.each([-0.1, 0.1])('damps sideslip after a %f roll pulse without autopilot', roll => {
    const plane = new Aircraft();
    for (let i = 0; i < 120 * 20; i++) {
      plane.controls.roll = i < 60 ? roll : 0;
      plane.step(STEP);
      expect(plane.stalled).toBe(false);
      expect(Math.abs(plane.beta)).toBeLessThan(0.1);
      expect(Math.abs(plane.bank)).toBeLessThan(0.5);
    }
    expect(Math.abs(plane.rates.z)).toBeLessThan(0.02);
  });

  it.each([-10, 10])('opposes an initial %i m/s sideways velocity', sideways => {
    const plane = new Aircraft();
    plane.velocity.x = sideways;
    plane.step(STEP);
    expect(Math.sign(plane.rates.y)).toBe(-Math.sign(plane.beta));
    advance(plane, 10);
    expect(Math.abs(plane.beta)).toBeLessThan(0.01);
    expect(plane.stalled).toBe(false);
  });
  it('initializes a plausible airborne state and maintains normalized attitude', () => {
    const plane = new Aircraft();
    advance(plane, 20);
    expect(plane.phase).toBe('airborne');
    expect(plane.position.y).toBeGreaterThan(600);
    expect(plane.airspeed).toBeGreaterThan(100);
    expect(plane.airspeed).toBeLessThan(350);
    expect(plane.attitude.length()).toBeCloseTo(1, 10);
    expect(plane.fuel).toBeLessThan(2400);
    expect(Number.isFinite(plane.position.length())).toBe(true);
  });

  it('maps elevator, aileron and rudder to independent body moments', () => {
    const pitch = new Aircraft();
    pitch.controls.pitch = 0.3;
    advance(pitch, 0.5);
    expect(pitch.surfaces.elevator).toBeGreaterThan(0.1);
    expect(pitch.rates.x).toBeGreaterThan(0);
    expect(pitch.pitch).toBeGreaterThan(0.035);
    const roll = new Aircraft();
    roll.controls.roll = 0.5;
    advance(roll, 0.5);
    expect(roll.rates.z).toBeLessThan(0);
    expect(roll.bank).toBeGreaterThan(0);
    const yaw = new Aircraft();
    yaw.controls.yaw = 0.5;
    advance(yaw, 0.5);
    expect(yaw.rates.y).toBeLessThan(0);
    expect(yaw.velocity.x).not.toBe(0);
  });

  it('rotates lift with the airframe rather than world-up', () => {
    const level = new Aircraft();
    const banked = new Aircraft();
    banked.attitude.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2));
    advance(level, 0.1);
    advance(banked, 0.1);
    expect(banked.velocity.x).toBeGreaterThan(level.velocity.x);
    expect(banked.velocity.y).toBeLessThan(level.velocity.y);
  });

  it('detects stall and configuration drag', () => {
    const stalled = new Aircraft();
    stalled.attitude.setFromAxisAngle(new Vector3(1, 0, 0), 0.5);
    stalled.step(STEP);
    expect(stalled.stalled).toBe(true);
    const clean = new Aircraft();
    const dirty = new Aircraft();
    clean.controls.throttle = dirty.controls.throttle = 0;
    dirty.gear = dirty.flaps = true;
    advance(clean, 1);
    advance(dirty, 1);
    expect(dirty.airspeed).toBeLessThan(clean.airspeed);
  });

  it('increases acceleration with afterburner and stops thrust with empty tanks', () => {
    const idle = new Aircraft();
    const burner = new Aircraft();
    const empty = new Aircraft();
    idle.controls.throttle = 0;
    burner.controls.throttle = empty.controls.throttle = 1;
    empty.fuel = 0;
    advance(idle, 1);
    advance(burner, 1);
    advance(empty, 1);
    expect(burner.airspeed).toBeGreaterThan(idle.airspeed + 8);
    expect(empty.airspeed).toBeLessThan(burner.airspeed);
    expect(empty.fuel).toBe(0);
  });

  it('remains finite during sustained multi-axis maneuvering', () => {
    const plane = new Aircraft();
    plane.position.y = 10000;
    for (let i = 0; i < 120 * 60; i++) {
      plane.controls.pitch = Math.sin(i / 200) * 0.4;
      plane.controls.roll = Math.cos(i / 350) * 0.6;
      plane.controls.yaw = Math.sin(i / 300) * 0.2;
      plane.step(STEP);
    }
    expect(Number.isFinite(plane.position.length())).toBe(true);
    expect(Number.isFinite(plane.rates.length())).toBe(true);
    expect(plane.attitude.length()).toBeCloseTo(1, 8);
  });
});

describe('runway state machine', () => {
  it('keeps an idle aircraft parked on the runway', () => {
    const plane = new Aircraft(true);
    advance(plane, 10);
    expect(plane.phase).toBe('parked');
    expect(plane.position.y).toBeCloseTo(GEAR_HEIGHT);
    expect(plane.airspeed).toBeLessThan(0.01);
  });

  it('rolls then takes off under pilot control', () => {
    const plane = new Aircraft(true);
    plane.controls.throttle = 1;
    let sawTakeoff = false;
    for (let i = 0; i < 120 * 25; i++) {
      if (plane.airspeed > 78) plane.controls.pitch = 0.22;
      plane.step(STEP);
      if (plane.phase === 'takeoff') sawTakeoff = true;
      if (plane.phase === 'airborne') break;
    }
    expect(sawTakeoff).toBe(true);
    expect(plane.phase, plane.crashReason).toBe('airborne');
    expect(plane.agl).toBeGreaterThan(1.5);
  });

  it('registers a gentle gear-down touchdown and wheel braking', () => {
    const plane = new Aircraft();
    plane.position.set(0, GEAR_HEIGHT + 0.03, 1000);
    plane.velocity.set(0, -1.5, -65);
    plane.attitude.identity();
    plane.gear = plane.flaps = true;
    plane.controls.throttle = 0;
    advance(plane, 0.1);
    expect(plane.phase).toBe('landed');
    expect(plane.touchdownRate).toBeGreaterThan(0);
    plane.controls.brake = true;
    const before = plane.airspeed;
    advance(plane, 2);
    expect(plane.airspeed).toBeLessThan(before - 5);
  });

  it.each([
    ['gear-up', false, 0, -1.5, 0],
    ['hard landing', true, 0, -9, 0],
    ['runway excursion', true, 70, -1.5, 0],
    ['banked touchdown', true, 0, -1.5, 0.5],
  ])('crashes on %s', (_name, gear, x, sink, bank) => {
    const plane = new Aircraft();
    plane.position.set(x, GEAR_HEIGHT + 0.005, 0);
    plane.velocity.set(0, sink, -70);
    plane.attitude.setFromAxisAngle(new Vector3(0, 0, 1), bank);
    plane.gear = gear;
    advance(plane, 0.1);
    expect(plane.phase).toBe('crashed');
    expect(plane.crashReason).not.toBe('');
    const position = plane.position.clone();
    advance(plane, 2);
    expect(plane.position.equals(position)).toBe(true);
  });

  it('resets all flight controls, damage, and touchdown state', () => {
    const plane = new Aircraft();
    plane.crash('test');
    plane.controls.pitch = 1;
    plane.reset(true);
    expect(plane.health).toBe(100);
    expect(plane.phase).toBe('parked');
    expect(plane.controls.pitch).toBe(0);
    expect(plane.gear).toBe(true);
    expect(plane.crashReason).toBe('');
  });

  it('keeps the airbase flat and provides hills outside the pattern', () => {
    expect(terrainHeight(0, 0)).toBe(0);
    expect(terrainHeight(0, 1600)).toBe(0);
    expect(terrainHeight(9000, 7000)).toBeGreaterThan(0);
    expect(onRunway(new Vector3(0, 0, 1599))).toBe(true);
    expect(onRunway(new Vector3(40, 0, 0))).toBe(false);
  });
});
