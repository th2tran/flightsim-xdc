import { Aircraft } from './flight';
import { Autopilot } from './autopilot';
import { Combat } from './combat';

export const TIME_SCALES = [1, 2, 4, 8, 16] as const;
export const COMPRESSION_THREAT_RANGE = 8000;

/** Returns why time compression is unavailable, or null when the sim may run faster than real time. */
export function compressionBlocker(aircraft: Aircraft, autopilot: Autopilot, combat: Combat): string | null {
  if (!autopilot.active) return 'autopilot required';
  if (autopilot.mode === 'stall-recovery') return 'stall recovery in progress';
  if (aircraft.phase === 'crashed') return 'aircraft lost';
  if (autopilot.mode === 'landing' && (autopilot.landingStage === 'flare' || autopilot.landingStage === 'rollout')) return 'touchdown runs in real time';
  if (combat.incoming > 0) return 'missile inbound';
  if (combat.alive.some(bogey => !bogey.drone && bogey.position.distanceTo(aircraft.position) < COMPRESSION_THREAT_RANGE)) return 'hostiles within 8 km';
  return null;
}
