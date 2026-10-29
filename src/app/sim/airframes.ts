export interface Airframe {
  id: string;
  name: string;
  label: string;
  description: string;
  mass: number;
  fuel: number;
  wingArea: number;
  thrust: number;
  afterburner: number;
  drag: number;
  inertia: number;
  span: number;
  sweep: number;
  tail: number;
  color: number;
  /** Airborne-start altitude (m) and true airspeed (m/s). */
  start: { altitude: number; speed: number };
  loadout: Loadout;
}

export interface Loadout { missiles: number; rounds: number; flares: number }

export const metresToFeet = (metres: number) => metres * 3.28084;
export const msToKnots = (speed: number) => speed * 1.94384;

// Gameplay-balanced profiles, not certified aircraft performance data.
export const AIRFRAMES: readonly Airframe[] = [
  { id: 'fa27', name: 'F/A-27', label: 'F/A-27 Multirole', description: 'Balanced trainer and multirole fighter.',
    mass: 8500, fuel: 2400, wingArea: 28, thrust: 85000, afterburner: 45000, drag: 0.025, inertia: 1,
    span: 5, sweep: 0.65, tail: 0.2, color: 0x9caeb7,
    start: { altitude: 1100, speed: 165 }, loadout: { missiles: 6, rounds: 640, flares: 24 } },
  { id: 'f14', name: 'F-14', label: 'F-14 Tomcat', description: 'Heavy interceptor; broad swept wings, deliberate roll response.',
    mass: 11000, fuel: 3000, wingArea: 38, thrust: 105000, afterburner: 55000, drag: 0.03, inertia: 1.35,
    span: 6.8, sweep: 0.9, tail: 0.08, color: 0xadb4b7,
    start: { altitude: 1500, speed: 180 }, loadout: { missiles: 6, rounds: 675, flares: 30 } },
  { id: 'f15', name: 'F-15E', label: 'F-15E Strike Eagle', description: 'Powerful strike fighter with strong acceleration and a stable platform.',
    mass: 10500, fuel: 2900, wingArea: 35, thrust: 110000, afterburner: 55000, drag: 0.028, inertia: 1.2,
    span: 5.8, sweep: 0.35, tail: 0, color: 0x596a76,
    start: { altitude: 1200, speed: 175 }, loadout: { missiles: 8, rounds: 510, flares: 30 } },
  { id: 'f22', name: 'F-22', label: 'F-22 Raptor', description: 'Agile stealth fighter; low drag and quick angular response.',
    mass: 10000, fuel: 2800, wingArea: 34, thrust: 110000, afterburner: 60000, drag: 0.022, inertia: 0.9,
    span: 6, sweep: 0.4, tail: 0.48, color: 0x87959e,
    start: { altitude: 1500, speed: 185 }, loadout: { missiles: 8, rounds: 480, flares: 24 } },
  { id: 'yf23', name: 'YF-23', label: 'Northrop YF-23 Black Widow II', description: 'Low-drag prototype with diamond wings and a wide V-tail.',
    mass: 10500, fuel: 3000, wingArea: 36, thrust: 105000, afterburner: 55000, drag: 0.02, inertia: 1.1,
    span: 6.5, sweep: 0, tail: 0.85, color: 0x454e58,
    start: { altitude: 1400, speed: 185 }, loadout: { missiles: 6, rounds: 480, flares: 24 } },
];
