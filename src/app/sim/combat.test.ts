import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Aircraft, STEP } from './flight';
import { Combat, segmentDistance } from './combat';

function advance(combat: Combat, plane: Aircraft, seconds: number): void {
  for (let i = 0; i < seconds / STEP; i++) combat.step(STEP, plane);
}
function fixture(): { plane: Aircraft; combat: Combat } {
  const plane = new Aircraft();
  plane.attitude.identity();
  const combat = new Combat();
  combat.reset('intercept', plane);
  return { plane, combat };
}

describe('combat scenarios', () => {
  it('populates each scenario and resets stores', () => {
    const { plane, combat } = fixture();
    expect(combat.alive.length).toBe(3);
    combat.reset('furball', plane);
    expect(combat.alive.length).toBe(5);
    combat.missiles = 0;
    combat.reset('training', plane);
    expect(combat.alive.length).toBe(0);
    expect(combat.missiles).toBe(6);
    expect(combat.complete).toBe(false);
  });

  it('cycles live targets and handles an empty range', () => {
    const { plane, combat } = fixture();
    const first = combat.selected;
    combat.cycleTarget();
    expect(combat.selected).not.toBe(first);
    combat.target!.health = 0;
    combat.cycleTarget();
    expect(combat.target!.health).toBeGreaterThan(0);
    combat.reset('training', plane);
    expect(() => combat.cycleTarget()).not.toThrow();
    expect(combat.selected).toBe(0);
  });

  it('requires alignment, range and dwell for missile lock', () => {
    const { plane, combat } = fixture();
    combat.target!.position.copy(plane.position).add(new Vector3(0, 0, -3000));
    combat.target!.forward.set(0, 0, -1);
    expect(combat.launch(plane)).toBe(false);
    advance(combat, plane, 1);
    expect(combat.lock).toBeGreaterThan(0.5);
    expect(combat.lock).toBeLessThan(1);
    advance(combat, plane, 1);
    expect(combat.lock).toBe(1);
    expect(combat.launch(plane)).toBe(true);
    expect(combat.missiles).toBe(5);
    expect(combat.launch(plane)).toBe(false);
    combat.target!.position.copy(plane.position).add(new Vector3(8000, 0, 0));
    advance(combat, plane, 1);
    expect(combat.lock).toBe(0);
  });

  it('homing missiles destroy a bandit and consume one store', () => {
    const { plane, combat } = fixture();
    const target = combat.target!;
    target.position.copy(plane.position).add(new Vector3(0, 0, -1800));
    target.forward.set(0, 0, 1);
    combat.lock = 1;
    expect(combat.launch(plane)).toBe(true);
    advance(combat, plane, 8);
    expect(combat.kills).toBeGreaterThanOrEqual(1);
    expect(target.health).toBeLessThanOrEqual(0);
    expect(combat.missiles).toBe(5);
  });

  it('supports held cannon fire with bounded fire rate and ammunition', () => {
    const { plane, combat } = fixture();
    combat.firing = true;
    advance(combat, plane, 1);
    expect(combat.rounds).toBeGreaterThanOrEqual(620);
    expect(combat.rounds).toBeLessThanOrEqual(623);
    combat.rounds = 0;
    advance(combat, plane, 1);
    expect(combat.rounds).toBe(0);
    combat.firing = false;
    combat.rounds = 10;
    advance(combat, plane, 1);
    expect(combat.rounds).toBe(10);
  });

  it('tests projectile swept paths instead of only their end position', () => {
    expect(segmentDistance(new Vector3(0, 0, -5), new Vector3(), new Vector3(0, 0, -10))).toBe(0);
    expect(segmentDistance(new Vector3(3, 0, -5), new Vector3(), new Vector3(0, 0, -10))).toBe(3);
    expect(segmentDistance(new Vector3(0, 0, 5), new Vector3(), new Vector3(0, 0, -10))).toBe(5);
  });

  it('deploys finite paired flares and decoys a nearby hostile missile', () => {
    const { plane, combat } = fixture();
    combat.projectiles.push({ id: 1000, kind: 'hostile', position: plane.position.clone().add(new Vector3(0, 0, 1000)), velocity: new Vector3(0, 0, -400), life: 15, target: 0, decoyed: false });
    expect(combat.incoming).toBe(1);
    expect(combat.releaseFlares(plane)).toBe(true);
    expect(combat.releaseFlares(plane)).toBe(false);
    expect(combat.flares).toBe(22);
    advance(combat, plane, 0.3);
    expect(combat.projectiles.find(p => p.kind === 'hostile')!.decoyed).toBe(true);
    expect(combat.incoming).toBe(0);
  });

  it('applies hostile damage and destroys an exhausted airframe', () => {
    const { plane, combat } = fixture();
    plane.health = 30;
    combat.projectiles.push({ id: 1000, kind: 'hostile', position: plane.position.clone().add(new Vector3(0, 0, 25)), velocity: new Vector3(0, 0, -600), life: 3, target: 0, decoyed: false });
    advance(combat, plane, 0.1);
    expect(plane.phase).toBe('crashed');
    expect(plane.health).toBe(0);
  });

  it('AI engages with incoming missiles and expired effects are removed', () => {
    const { plane, combat } = fixture();
    for (let i = 0; i < 120 * 20 && !combat.incoming; i++) combat.step(STEP, plane);
    expect(combat.incoming).toBeGreaterThan(0);
    combat.projectiles.forEach(p => { p.life = -1; });
    combat.step(STEP, plane);
    expect(combat.projectiles.length).toBe(0);
  });
});
