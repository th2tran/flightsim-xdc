import { Aircraft } from './flight';

export type FlightWarning = 'missile' | 'terrain' | 'stall' | 'g' | 'speed' | 'fuel' | 'gear';

export const WARNING_LABELS: Record<FlightWarning, string> = {
  missile: 'MISSILE · FLARES + BREAK',
  terrain: 'PULL UP · TERRAIN',
  stall: 'STALL · LOWER NOSE',
  g: 'OVER G',
  speed: 'OVERSPEED',
  fuel: 'BINGO FUEL',
  gear: 'GEAR SPEED',
};

export function flightWarning(aircraft: Aircraft, incoming: number): FlightWarning | null {
  if (aircraft.phase === 'crashed') return null;
  if (incoming > 0) return 'missile';
  if (aircraft.agl < 100 && aircraft.verticalSpeed < -4) return 'terrain';
  if (aircraft.stalled) return 'stall';
  if (Math.abs(aircraft.gLoad) > 8) return 'g';
  if (aircraft.airspeed > 340) return 'speed';
  if (aircraft.fuel < 150) return 'fuel';
  if (aircraft.gear && aircraft.airspeed * 1.94384 > 250) return 'gear';
  return null;
}
