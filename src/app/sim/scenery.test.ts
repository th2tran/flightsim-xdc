import { describe, expect, it } from 'vitest';
import { terrainHeight } from './flight';
import { forestDensity, inAirfieldClearZone, treePositions } from './scenery';

describe('scenery', () => {
  it('plants deterministic woodland clear of the airfield and lakes', () => {
    const trees = treePositions();
    expect(trees.length).toBeGreaterThan(3000);
    expect(treePositions().map(tree => tree.toArray())).toEqual(trees.map(tree => tree.toArray()));
    for (const tree of trees) {
      expect(inAirfieldClearZone(tree.x, tree.z)).toBe(false);
      expect(Math.abs(tree.x) < 100 && Math.abs(tree.z) < 2000).toBe(false);
      expect(forestDensity(tree.x, tree.z)).toBeGreaterThanOrEqual(0.5);
      expect(tree.y).toBeCloseTo(terrainHeight(tree.x, tree.z));
    }
  });
});
