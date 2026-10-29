import { describe, expect, it } from 'vitest';
import { stickResponse } from './controls';
import { Aircraft, STEP } from './flight';

describe('touch joystick response', () => {
  it('has a continuous dead zone, soft center and full endpoint authority', () => {
    expect(stickResponse(0.08)).toBe(0);
    expect(stickResponse(-0.08)).toBe(0);
    expect(stickResponse(0.081)).toBeLessThan(0.001);
    expect(stickResponse(5 / (115 * 0.38))).toBeLessThan(0.01);
    expect(stickResponse(0.5)).toBeLessThan(0.2);
    expect(stickResponse(1)).toBe(1);
    expect(stickResponse(-1)).toBe(-1);
    expect(stickResponse(0.4)).toBe(-stickResponse(-0.4));
  });

  it.each([-1, 1])('keeps a small %i-direction drag stable after release', direction => {
    const aircraft = new Aircraft();
    for (let i = 0; i < 120 * 20; i++) {
      aircraft.controls.roll = i < 120 ? stickResponse(direction * 5 / (115 * 0.38)) : 0;
      aircraft.step(STEP);
      expect(aircraft.phase).toBe('airborne');
      expect(aircraft.stalled, `at ${i / 120}s, beta ${aircraft.beta}`).toBe(false);
      expect(Math.abs(aircraft.bank)).toBeLessThan(0.35);
      expect(Math.abs(aircraft.beta)).toBeLessThan(0.15);
    }
    expect(Math.abs(aircraft.rates.z)).toBeLessThan(0.02);
  });
});
