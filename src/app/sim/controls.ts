import { clamp } from './flight';

export function stickResponse(value: number): number {
  if (Math.abs(value) <= 0.08) return 0;
  const magnitude = clamp((Math.abs(value) - 0.08) / 0.92, 0, 1);
  return Math.sign(value) * (0.25 * magnitude + 0.75 * magnitude ** 3);
}
