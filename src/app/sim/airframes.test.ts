import { describe, expect, it } from 'vitest';
import { AIRFRAMES } from './airframes';
import { Aircraft, STEP } from './flight';
import { Autopilot } from './autopilot';
import { makeJet } from './renderer';
import { Combat } from './combat';
import { Box3, Mesh, Vector3 } from 'three';

describe('selectable airframes', () => {
  it.each(AIRFRAMES)('$label supports departure, hold and return to a stopped landing', profile => {
    const aircraft = new Aircraft(true, profile);
    const ap = new Autopilot();
    expect(aircraft.fuel).toBe(profile.fuel);
    expect(ap.engageTakeoff(aircraft)).toBeNull();
    for (let i = 0; i < 120 * 120 && ap.mode === 'takeoff'; i++) {
      ap.step(aircraft, STEP);
      aircraft.step(STEP);
      expect(aircraft.phase).not.toBe('crashed');
    }
    expect(ap.mode).toBe('hold');
    for (let i = 0; i < 120 * 30; i++) {
      ap.step(aircraft, STEP);
      aircraft.step(STEP);
    }
    expect(ap.mode).toBe('hold');
    expect(Math.abs(aircraft.position.y * 3.28084 - ap.altitude)).toBeLessThan(100);
    expect(ap.engageLanding(aircraft)).toBeNull();
    let message = '';
    for (let i = 0; i < 120 * 1400 && ap.active; i++) {
      message = ap.step(aircraft, STEP) ?? message;
      aircraft.step(STEP);
      expect(aircraft.phase, `${profile.id}: ${message}`).not.toBe('crashed');
    }
    expect(message).toMatch(/landing complete/);
    expect(aircraft.airspeed).toBeLessThan(0.8);
  });

  it.each(AIRFRAMES)('$label provides animated surface and configuration nodes', profile => {
    const jet = makeJet(false, profile);
    for (const name of ['leftWing', 'rightWing', 'leftElevator', 'rightElevator', 'rudder',
      'leftAileron', 'rightAileron', 'gear-1', 'gear1', 'exhaust-1', 'exhaust1']) {
      expect(jet.getObjectByName(name), name).toBeDefined();
    }
    const size = new Box3().setFromObject(jet).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(16);
    expect(size.z).toBeLessThan(25);
    expect(size.x).toBeGreaterThan(10);
    expect(size.y).toBeLessThan(8);
    let triangles = 0;
    jet.traverse(object => {
      if (object instanceof Mesh) {
        const geometry = object.geometry;
        triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
      }
    });
    expect(triangles).toBeLessThan(7000);
  });

  it('profiles produce distinct acceleration and roll response', () => {
    const results = AIRFRAMES.map(profile => {
      const aircraft = new Aircraft(false, profile);
      aircraft.controls.throttle = 1;
      aircraft.controls.roll = 0.1;
      for (let i = 0; i < 60; i++) aircraft.step(STEP);
      return [aircraft.airspeed, aircraft.rates.z];
    });
    expect(new Set(results.map(([speed]) => speed.toFixed(3))).size).toBe(AIRFRAMES.length);
    expect(new Set(results.map(([, roll]) => roll.toFixed(6))).size).toBe(AIRFRAMES.length);
  });

  it.each(AIRFRAMES)('$label applies its own airborne start and loadout', profile => {
    const aircraft = new Aircraft(false, profile);
    expect(aircraft.position.y).toBe(profile.start.altitude);
    expect(aircraft.airspeed).toBe(profile.start.speed);
    const combat = new Combat();
    combat.reset('intercept', aircraft);
    expect([combat.missiles, combat.rounds, combat.flares]).toEqual([profile.loadout.missiles, profile.loadout.rounds, profile.loadout.flares]);
  });
});
