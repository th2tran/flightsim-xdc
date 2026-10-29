import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Aircraft, STEP } from './flight';
import { Autopilot, headingError } from './autopilot';

function fly(aircraft: Aircraft, autopilot: Autopilot, seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) {
    const error = autopilot.step(aircraft, STEP);
    expect(error, `at ${i * STEP}s: bank ${aircraft.bank}, pitch ${aircraft.pitch}, alpha ${aircraft.alpha}, speed ${aircraft.airspeed}`).toBeNull();
    aircraft.step(STEP);
  }
}

describe('autopilot flight controller', () => {
  it.each([
    [1.52, 0], [-1.52, 0], [0.4, 2.9], [0.4, -2.9],
  ])('continues recovery through pitch %f and bank %f at 10000 ft', (pitch, bank) => {
    const aircraft = new Aircraft();
    aircraft.position.set(0, 3048, 0);
    const ap = new Autopilot();
    expect(ap.engageStallRecovery(aircraft)).toBeNull();
    aircraft.attitude.setFromAxisAngle(new Vector3(1, 0, 0), pitch);
    aircraft.attitude.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -bank));
    aircraft.velocity.set(0, 0, -110);
    aircraft.step(STEP);
    let recovered = false;
    for (let i = 0; i < 120 * 100; i++) {
      const message = ap.step(aircraft, STEP);
      expect(ap.active, `${i / 120}s: ${message}; altitude ${aircraft.position.y}; speed ${aircraft.airspeed}`).toBe(true);
      if (message?.startsWith('Stall recovered')) recovered = true;
      aircraft.step(STEP);
      expect(aircraft.phase).not.toBe('crashed');
    }
    expect(recovered).toBe(true);
  });
  it.each([35, 55, 75])('recovers at 10000 ft from %i m/s without the old low-speed disconnect', speed => {
    const aircraft = new Aircraft();
    aircraft.position.set(0, 3048, 0);
    aircraft.attitude.setFromAxisAngle(new Vector3(1, 0, 0), 0.6);
    aircraft.velocity.set(0, 0, -speed);
    aircraft.step(STEP);
    const ap = new Autopilot();
    if (speed < 45) {
      // Reproduce speed falling below the old cutoff after valid engagement.
      aircraft.airspeed = 50;
      expect(ap.engageStallRecovery(aircraft)).toBeNull();
      aircraft.airspeed = speed;
    } else expect(ap.engageStallRecovery(aircraft)).toBeNull();
    let recovered = false;
    for (let i = 0; i < 120 * 100; i++) {
      const message = ap.step(aircraft, STEP);
      expect(ap.active, `${i / 120}s: ${message}; altitude ${aircraft.position.y}; speed ${aircraft.airspeed}`).toBe(true);
      if (message?.startsWith('Stall recovered')) recovered = true;
      aircraft.step(STEP);
      expect(aircraft.phase).not.toBe('crashed');
    }
    expect(recovered).toBe(true);
    expect(ap.mode).toBe('recovery');
    expect(aircraft.stalled).toBe(false);
  });

  it('reports the exact terrain and overspeed disconnect reasons', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engageStallRecovery(aircraft);
    aircraft.position.set(0, 15, 0);
    expect(ap.step(aircraft, STEP)).toMatch(/terrain clearance.*ft.*minimum/);
    aircraft.reset(false);
    ap.engageStallRecovery(aircraft);
    aircraft.airspeed = 351;
    expect(ap.step(aircraft, STEP)).toMatch(/overspeed 682 kt/);
  });

  it('does not transition into hold below its terrain-clearance envelope', () => {
    const aircraft = new Aircraft();
    aircraft.position.set(0, 100, 0);
    const ap = new Autopilot();
    expect(ap.engageStallRecovery(aircraft)).toBeNull();
    aircraft.alpha = 0.06;
    for (let i = 0; i < 500; i++) ap.step(aircraft, STEP);
    expect(ap.mode).toBe('stall-recovery');
  });
  it.each([0.45, -0.4])('recovers a stall at %f rad angle of attack', alpha => {
    const aircraft = new Aircraft();
    aircraft.position.y = 4000;
    aircraft.attitude.setFromAxisAngle(new Vector3(1, 0, 0), alpha);
    aircraft.velocity.set(0, 0, -110);
    aircraft.step(STEP);
    expect(aircraft.stalled).toBe(true);
    const ap = new Autopilot();
    expect(ap.engageStallRecovery(aircraft)).toBeNull();
    let recovered = false;
    for (let i = 0; i < 120 * 80; i++) {
      const message = ap.step(aircraft, STEP);
      expect(ap.active, `${message}, alpha ${aircraft.alpha}, speed ${aircraft.airspeed}, altitude ${aircraft.position.y}`).toBe(true);
      if (message?.startsWith('Stall recovered')) recovered = true;
      aircraft.step(STEP);
    }
    expect(recovered).toBe(true);
    expect(ap.mode).toBe('recovery');
    expect(aircraft.stalled).toBe(false);
    expect(Math.abs(aircraft.bank)).toBeLessThan(0.03);
    expect(Math.abs(aircraft.verticalSpeed)).toBeLessThan(1.5);
  });

  it('enters stall recovery automatically without resuming the old climb target', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engage(aircraft);
    ap.altitude = 18000;
    aircraft.stalled = true;
    aircraft.alpha = 0.4;
    expect(ap.step(aircraft, STEP)).toMatch(/Stall recovery engaged/);
    expect(ap.mode).toBe('stall-recovery');
    expect(aircraft.controls.pitch).toBeLessThan(0);
    expect(aircraft.controls.throttle).toBe(1);
    ap.disengage();
    expect(ap.mode).toBe('off');
  });

  it('requires three uninterrupted seconds of safe airflow before leaving stall recovery', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engageStallRecovery(aircraft);
    aircraft.alpha = 0.06;
    for (let i = 0; i < 240; i++) ap.step(aircraft, STEP);
    expect(ap.mode).toBe('stall-recovery');
    aircraft.stalled = true;
    ap.step(aircraft, STEP);
    aircraft.stalled = false;
    for (let i = 0; i < 240; i++) ap.step(aircraft, STEP);
    expect(ap.mode).toBe('stall-recovery');
    for (let i = 0; i < 122; i++) ap.step(aircraft, STEP);
    expect(ap.mode).toBe('recovery');
  });

  it('rejects stall recovery on the ground, without fuel or critically low terrain clearance', () => {
    const aircraft = new Aircraft(true);
    const ap = new Autopilot();
    expect(ap.engageStallRecovery(aircraft)).toMatch(/airborne/);
    aircraft.reset(false);
    aircraft.position.set(0, 25, 0);
    expect(ap.engageStallRecovery(aircraft)).toMatch(/clearance/);
    aircraft.reset(false);
    aircraft.fuel = 0;
    expect(ap.engageStallRecovery(aircraft)).toMatch(/failure/);
  });
  it('holds captured heading, altitude, and speed for two minutes', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    expect(ap.engage(aircraft)).toBeNull();
    fly(aircraft, ap, 120);
    expect(ap.active).toBe(true);
    expect(Math.abs(headingError(ap.heading, aircraft.heading))).toBeLessThan(2);
    expect(Math.abs(aircraft.position.y * 3.28084 - ap.altitude)).toBeLessThan(50);
    expect(Math.abs(aircraft.airspeed * 1.94384 - ap.speed)).toBeLessThan(5);
  });

  it('captures new heading, altitude, and speed selections', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engage(aircraft);
    ap.heading = 45;
    ap.altitude = 5000;
    ap.speed = 380;
    fly(aircraft, ap, 150);
    expect(Math.abs(headingError(ap.heading, aircraft.heading))).toBeLessThan(3);
    expect(Math.abs(aircraft.position.y * 3.28084 - ap.altitude)).toBeLessThan(75);
    expect(Math.abs(aircraft.airspeed * 1.94384 - ap.speed)).toBeLessThan(6);
  });

  it.each([
    [355, 280, 2500], [180, 450, 7000], [270, 550, 10000],
  ])('captures heading %i, speed %i kt, altitude %i ft', (heading, speed, altitude) => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engage(aircraft);
    ap.heading = heading;
    ap.speed = speed;
    ap.altitude = altitude;
    fly(aircraft, ap, 240);
    expect(Math.abs(headingError(heading, aircraft.heading))).toBeLessThan(3);
    expect(Math.abs(aircraft.position.y * 3.28084 - altitude)).toBeLessThan(100);
    expect(Math.abs(aircraft.airspeed * 1.94384 - speed)).toBeLessThan(8);
  });

  it('rolls wings level and arrests a descent in recovery mode', () => {
    const aircraft = new Aircraft();
    aircraft.position.y = 2200;
    aircraft.attitude.setFromAxisAngle(new Vector3(0, 0, 1), -0.7);
    aircraft.velocity.y = -10;
    const ap = new Autopilot();
    expect(ap.engage(aircraft, true)).toBeNull();
    fly(aircraft, ap, 60);
    expect(Math.abs(aircraft.bank)).toBeLessThan(0.03);
    expect(Math.abs(aircraft.verticalSpeed)).toBeLessThan(1);
  });

  it.each([-1.0, 1.0])('recovers a %f rad bank without stalling', bank => {
    const aircraft = new Aircraft();
    aircraft.position.y = 2200;
    aircraft.attitude.setFromAxisAngle(new Vector3(0, 0, 1), bank);
    const ap = new Autopilot();
    expect(ap.engage(aircraft, true)).toBeNull();
    fly(aircraft, ap, 60);
    expect(Math.abs(aircraft.bank)).toBeLessThan(0.03);
    expect(Math.abs(aircraft.verticalSpeed)).toBeLessThan(1);
  });

  it('holds a lower-speed, gear-down configuration', () => {
    const aircraft = new Aircraft();
    aircraft.gear = aircraft.flaps = true;
    const ap = new Autopilot();
    ap.engage(aircraft);
    ap.speed = 220;
    fly(aircraft, ap, 180);
    expect(Math.abs(aircraft.airspeed * 1.94384 - ap.speed)).toBeLessThan(8);
    expect(Math.abs(aircraft.position.y * 3.28084 - ap.altitude)).toBeLessThan(100);
  });

  it('handles heading wraparound using the shortest turn', () => {
    expect(headingError(5, 355)).toBe(10);
    expect(headingError(355, 5)).toBe(-10);
  });

  it('rejects ground, low clearance, stalled and engine-out engagement', () => {
    const aircraft = new Aircraft(true);
    const ap = new Autopilot();
    expect(ap.engage(aircraft)).toMatch(/airborne/);
    aircraft.reset(false);
    aircraft.position.set(0, 100, 0);
    expect(ap.engage(aircraft)).toMatch(/clearance/);
    aircraft.reset(false);
    aircraft.stalled = true;
    expect(ap.engage(aircraft)).toMatch(/envelope/);
    aircraft.reset(false);
    aircraft.fuel = 0;
    expect(ap.engage(aircraft)).toMatch(/failure/);
    expect(ap.active).toBe(false);
  });

  it('disconnects on unsafe flight and remains off after recovery or reset', () => {
    const aircraft = new Aircraft();
    const ap = new Autopilot();
    ap.engage(aircraft);
    aircraft.position.set(0, 100, 0);
    expect(ap.step(aircraft, STEP)).toMatch(/disconnected/);
    expect(ap.active).toBe(false);
    aircraft.reset(false);
    expect(ap.step(aircraft, STEP)).toBeNull();
    expect(ap.active).toBe(false);
    ap.engage(aircraft);
    ap.disengage();
    expect(ap.active).toBe(false);
  });
});
