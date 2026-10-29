import { Aircraft, clamp, G } from './flight';

export const FBW_MAX_G = 7.5;
export const FBW_MIN_G = -3;
const PULL_RATE = 0.2;
const PUSH_RATE = 0.15;
const ELEVATOR_LIMIT = 0.44;
const STEEP_BANK = Math.PI / 3;

export function flightPathAngle(aircraft: Aircraft): number {
  return aircraft.airspeed > 1 ? Math.asin(clamp(aircraft.velocity.y / aircraft.airspeed, -1, 1)) : 0;
}

/**
 * Fighter-style pitch control law. Neutral stick holds the current flight path; stick
 * deflection commands a flight-path rate, limited by load factor and angle of attack.
 * On the ground it passes the stick straight to the elevator for normal rotation.
 */
export class FlyByWire {
  heldPath = 0;

  capture(aircraft: Aircraft): void { this.heldPath = flightPathAngle(aircraft); }
  adjustHeldPath(delta: number): void { this.heldPath = clamp(this.heldPath + delta, -1.4, 1.4); }

  command(aircraft: Aircraft, input: number): number {
    const stick = clamp(input, -1, 1);
    const speed = aircraft.airspeed;
    if (aircraft.phase !== 'airborne' || speed < 30) {
      this.capture(aircraft);
      return stick;
    }
    const gamma = flightPathAngle(aircraft);
    const bank = aircraft.bank;
    const cosBank = Math.cos(bank);
    // Bank compensation up to 60°, fading to plain gravity cancellation beyond (and inverted).
    const bankGain = cosBank / Math.max(cosBank * cosBank, 0.25);
    const pilot = Math.abs(stick) > 0.02;
    let load: number;
    if (pilot || Math.abs(bank) > STEEP_BANK) {
      this.heldPath = gamma;
      const rate = stick * (stick > 0 ? PULL_RATE : PUSH_RATE);
      load = clamp(Math.cos(gamma) * bankGain + speed * rate / G, FBW_MIN_G, FBW_MAX_G);
    } else {
      const pathRate = clamp((this.heldPath - gamma) * 0.8, -0.1, 0.1);
      load = clamp((Math.cos(gamma) + speed * pathRate / G) * bankGain, -2, 3);
    }
    const density = 1.225 * Math.exp(-Math.max(0, aircraft.position.y) / 8500);
    const qArea = 0.5 * density * speed * speed * aircraft.airframe.wingArea;
    const mass = aircraft.airframe.mass + aircraft.fuel;
    const criticalAlpha = aircraft.flaps ? 0.31 : 0.29;
    // Hands-off flight never stalls; sustained hard pulls can still exceed the critical angle.
    const alphaLimit = pilot ? criticalAlpha + 0.04 : criticalAlpha - 0.03;
    const liftCoefficient = load * mass * G / Math.max(qArea, 1);
    const alpha = clamp((liftCoefficient - 0.16 - (aircraft.flaps ? 0.42 : 0)) / 4.6, -0.2, alphaLimit);
    const achievedLoad = (0.16 + 4.6 * alpha + (aircraft.flaps ? 0.42 : 0)) * qArea / (mass * G);
    const pitchRate = (achievedLoad - Math.cos(gamma) * cosBank) * G / Math.max(speed, 40);
    const elevator = (0.8 * (alpha - 0.035) + pitchRate * 2.6 / Math.max(speed, 40)) / 0.95
      + (alpha - aircraft.alpha) * 2.2 - (aircraft.rates.x - pitchRate) * 0.9;
    return clamp(elevator / ELEVATOR_LIMIT, -1, 1);
  }
}
