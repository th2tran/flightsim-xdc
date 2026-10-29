import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Aircraft, STEP } from './flight';
import { Autopilot } from './autopilot';
import { Combat } from './combat';
import { compressionBlocker } from './time-compression';

function cruising(): { aircraft: Aircraft; autopilot: Autopilot; combat: Combat } {
  const aircraft = new Aircraft();
  aircraft.reset(false);
  const autopilot = new Autopilot();
  const combat = new Combat();
  combat.reset('training', aircraft);
  return { aircraft, autopilot, combat };
}

describe('time compression', () => {
  it('requires an engaged autopilot outside stall recovery', () => {
    const { aircraft, autopilot, combat } = cruising();
    expect(compressionBlocker(aircraft, autopilot, combat)).toBe('autopilot required');
    expect(autopilot.engage(aircraft, false)).toBeNull();
    expect(compressionBlocker(aircraft, autopilot, combat)).toBeNull();
    autopilot.mode = 'stall-recovery';
    expect(compressionBlocker(aircraft, autopilot, combat)).toBe('stall recovery in progress');
  });

  it('returns to real time for threats and touchdown', () => {
    const { aircraft, autopilot, combat } = cruising();
    expect(autopilot.engageLanding(aircraft)).toBeNull();
    expect(compressionBlocker(aircraft, autopilot, combat)).toBeNull();
    combat.spawnTrainingDrone(aircraft, 2000, 0);
    expect(compressionBlocker(aircraft, autopilot, combat)).toBeNull();
    combat.launchTrainingMissile(aircraft);
    expect(compressionBlocker(aircraft, autopilot, combat)).toBe('missile inbound');
    combat.projectiles.length = 0;
    combat.spawnTrainingDrone(aircraft, 5000, 0).drone = false;
    expect(compressionBlocker(aircraft, autopilot, combat)).toBe('hostiles within 8 km');
    combat.bogeys.length = 0;
    autopilot.landingStage = 'flare';
    expect(compressionBlocker(aircraft, autopilot, combat)).toBe('touchdown runs in real time');
  });

  it('fast-forwards a return-to-base at 16x and drops to real time for the flare', () => {
    const aircraft = new Aircraft();
    aircraft.position.set(15000, 3000, 15000);
    aircraft.attitude.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    aircraft.velocity.copy(aircraft.forward).multiplyScalar(165);
    const autopilot = new Autopilot();
    const combat = new Combat();
    combat.reset('training', aircraft);
    expect(autopilot.engageLanding(aircraft)).toBeNull();
    let scale = 16, frames = 0, compressedSimTime = 0, stageAtRelease = '';
    let accumulator = 0, message: string | null = null;
    while (autopilot.active && frames < 60 * 600) {
      frames++;
      accumulator += scale / 60;
      while (accumulator >= STEP) {
        message = autopilot.step(aircraft, STEP) ?? message;
        aircraft.step(STEP);
        accumulator -= STEP;
        if (scale > 1) compressedSimTime += STEP;
        if (scale > 1 && compressionBlocker(aircraft, autopilot, combat)) {
          scale = 1;
          stageAtRelease = autopilot.landingStage;
          accumulator = Math.min(accumulator, STEP);
        }
      }
      expect(aircraft.phase).not.toBe('crashed');
    }
    expect(message).toMatch(/landing complete/);
    expect(aircraft.phase).toBe('landed');
    expect(stageAtRelease).toBe('flare');
    expect(compressedSimTime).toBeGreaterThan(120);
    expect(frames / 60).toBeLessThan(compressedSimTime / 4);
  });
});
