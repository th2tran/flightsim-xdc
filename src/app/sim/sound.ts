import { Aircraft, clamp } from './flight';
import { FlightWarning, flightWarning } from './warnings';

interface AlarmPattern { duration: number; pulse: number; duty: number; low: number; high: number; }
const ALARMS: Record<FlightWarning, AlarmPattern> = {
  missile: { duration: 0.6, pulse: 0.15, duty: 0.8, low: 1050, high: 1550 },
  terrain: { duration: 1.2, pulse: 0.3, duty: 0.75, low: 480, high: 850 },
  stall: { duration: 0.8, pulse: 0.8, duty: 0.92, low: 360, high: 430 },
  g: { duration: 1.6, pulse: 0.4, duty: 0.5, low: 700, high: 700 },
  speed: { duration: 1.8, pulse: 0.3, duty: 0.35, low: 900, high: 700 },
  fuel: { duration: 4, pulse: 4, duty: 0.10, low: 520, high: 660 },
  gear: { duration: 2, pulse: 0.5, duty: 0.3, low: 600, high: 800 },
};

export function alarmSamples(warning: FlightWarning, sampleRate: number): Float32Array {
  const pattern = ALARMS[warning];
  const samples = new Float32Array(Math.round(sampleRate * pattern.duration));
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    const pulseTime = time % pattern.pulse;
    const onTime = pattern.pulse * pattern.duty;
    const frequency = Math.floor(time / pattern.pulse) % 2 ? pattern.high : pattern.low;
    phase += frequency * 2 * Math.PI / sampleRate;
    const envelope = clamp(Math.min(pulseTime / 0.008, (onTime - pulseTime) / 0.012), 0, 1);
    samples[i] = envelope * (Math.sin(phase) * 0.25 + Math.sin(phase * 3) * 0.035);
  }
  return samples;
}

export function crashSamples(sampleRate: number): Float32Array {
  const duration = 2.4;
  const samples = new Float32Array(Math.round(sampleRate * duration));
  let seed = 719, low = 0, phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    low += (noise - low) * (1 - Math.exp(-2 * Math.PI * 220 / sampleRate));
    phase += 2 * Math.PI * (35 + 90 * Math.exp(-time * 9)) / sampleRate;
    const attack = Math.min(1, time / 0.003);
    const fade = clamp((duration - time) / 0.15, 0, 1);
    const impact = noise * 0.38 * Math.exp(-time * 22);
    const boom = Math.sin(phase) * 0.34 * Math.exp(-time * 3.5);
    const debris = (low * 0.85 + noise * 0.06) * Math.exp(-time * 1.8);
    samples[i] = attack * fade * (impact + boom + debris);
  }
  return samples;
}

export function gunSamples(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * 0.09));
  let seed = 193, low = 0, phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    low += (noise - low) * (1 - Math.exp(-2 * Math.PI * 1800 / sampleRate));
    phase += 2 * Math.PI * (85 + 160 * Math.exp(-time * 90)) / sampleRate;
    const envelope = Math.min(1, time / 0.001) * Math.max(0, 1 - time / 0.09);
    samples[i] = envelope * (low * 0.65 * Math.exp(-time * 55)
      + Math.sin(phase) * 0.35 * Math.exp(-time * 45));
  }
  return samples;
}

export function missileSamples(sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * 1.1));
  let seed = 907, low = 0, phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0x80000000 - 1;
    const cutoff = 350 + 2200 * Math.exp(-time * 2.5);
    low += (noise - low) * (1 - Math.exp(-2 * Math.PI * cutoff / sampleRate));
    phase += 2 * Math.PI * (55 + 110 * Math.exp(-time * 8)) / sampleRate;
    const envelope = Math.min(1, time / 0.008) * Math.max(0, 1 - time / 1.1) ** 2;
    samples[i] = envelope * (low * 0.8 + noise * 0.12 * Math.exp(-time * 35)
      + Math.sin(phase) * 0.25 * Math.exp(-time * 8));
  }
  return samples;
}

export function engineMix(aircraft: Aircraft): { frequency: number; whine: number; roar: number; cutoff: number } {
  const throttle = aircraft.fuel > 0 ? clamp(aircraft.controls.throttle, 0, 1) : 0;
  const running = aircraft.fuel > 0 && aircraft.phase !== 'crashed';
  const burner = clamp((throttle - 0.88) / 0.12, 0, 1);
  return {
    frequency: 85 + throttle * 290,
    whine: running ? 0.018 + throttle * 0.028 : 0,
    roar: running ? 0.05 + throttle * 0.14 + burner * 0.18 : 0,
    cutoff: 450 + throttle * 1800 + burner * 1000,
  };
}

export class FlightSound {
  enabled = true;
  volume = 0.55;
  private context?: AudioContext;
  private master?: GainNode;
  private engine?: GainNode;
  private whine?: GainNode;
  private roar?: GainNode;
  private filter?: BiquadFilterNode;
  private turbines: OscillatorNode[] = [];
  private noise?: AudioBufferSourceNode;
  private alarm?: AudioBufferSourceNode;
  private alarmGain?: GainNode;
  private crash?: AudioBufferSourceNode;
  private crashBuffer?: AudioBuffer;
  private gunBuffer?: AudioBuffer;
  private missileBuffer?: AudioBuffer;
  private readonly weaponSources = new Set<AudioBufferSourceNode>();
  private readonly alarms = new Map<FlightWarning, AudioBuffer>();
  private warning: FlightWarning | null = null;
  private desired = false;
  private changing = false;
  private failed = false;
  private disposed = false;

  constructor(private readonly onError: (error: unknown) => void) {}

  activate(): void {
    if (this.context || !this.enabled || this.failed || this.disposed) return;
    try {
      const context = this.context = new AudioContext();
      this.master = context.createGain();
      this.master.gain.value = this.volume;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.ratio.value = 6;
      this.master.connect(limiter).connect(context.destination);
      this.engine = context.createGain();
      this.engine.gain.value = 0;
      this.engine.connect(this.master);
      this.whine = context.createGain();
      this.whine.gain.value = 0;
      this.whine.connect(this.engine);
      for (const detune of [-7, 7]) {
        const turbine = context.createOscillator();
        turbine.type = 'triangle';
        turbine.frequency.value = 85;
        turbine.detune.value = detune;
        turbine.connect(this.whine);
        turbine.start();
        this.turbines.push(turbine);
      }
      this.roar = context.createGain();
      this.roar.gain.value = 0;
      this.filter = context.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.Q.value = 0.6;
      this.filter.connect(this.roar).connect(this.engine);
      const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 41;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 0x80000000 - 1;
      }
      this.noise = context.createBufferSource();
      this.noise.buffer = buffer;
      this.noise.loop = true;
      this.noise.connect(this.filter);
      this.noise.start();
      this.alarmGain = context.createGain();
      this.alarmGain.gain.value = 0;
      this.alarmGain.connect(this.master);
      void context.resume().then(() => this.reconcile()).catch(error => this.fail(error));
    } catch (error: unknown) { this.fail(error); }
  }

  setPlaying(playing: boolean): void {
    const desired = playing && this.enabled && !this.failed;
    if (desired === this.desired) return;
    this.desired = desired;
    if (!desired) { this.changeWarning(null); this.stopWeapons(); }
    this.reconcile();
  }

  playCrash(): void {
    if (!this.context || !this.master || !this.enabled || this.failed || this.disposed || this.crash) return;
    this.changeWarning(null);
    this.stopWeapons();
    this.engine!.gain.setTargetAtTime(0, this.context.currentTime, 0.015);
    if (!this.crashBuffer) {
      const samples = crashSamples(this.context.sampleRate);
      this.crashBuffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      this.crashBuffer.getChannelData(0).set(samples);
    }
    const source = this.crash = this.context.createBufferSource();
    source.buffer = this.crashBuffer;
    source.connect(this.master);
    source.onended = () => {
      source.disconnect();
      if (this.crash === source) this.crash = undefined;
      this.reconcile();
    };
    source.start();
    this.reconcile();
  }

  playGun(): void {
    this.playWeapon('gun');
  }

  playMissile(): void {
    this.playWeapon('missile');
  }

  private playWeapon(kind: 'gun' | 'missile'): void {
    if (!this.context || !this.master || !this.desired || !this.enabled || this.failed || this.disposed || this.crash) return;
    let buffer = kind === 'gun' ? this.gunBuffer : this.missileBuffer;
    if (!buffer) {
      const samples = (kind === 'gun' ? gunSamples : missileSamples)(this.context.sampleRate);
      buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.getChannelData(0).set(samples);
      if (kind === 'gun') this.gunBuffer = buffer;
      else this.missileBuffer = buffer;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    this.weaponSources.add(source);
    source.onended = () => { source.disconnect(); this.weaponSources.delete(source); };
    source.start();
  }

  private stopWeapons(): void {
    for (const source of this.weaponSources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.weaponSources.clear();
  }

  stopCrash(): void {
    if (!this.crash) return;
    this.crash.onended = null;
    this.crash.stop();
    this.crash.disconnect();
    this.crash = undefined;
    this.reconcile();
  }

  update(aircraft: Aircraft, incoming: number): void {
    if (!this.desired || !this.context || this.disposed) return;
    const warning = flightWarning(aircraft, incoming);
    this.changeWarning(warning);
    const mix = engineMix(aircraft);
    const time = this.context.currentTime;
    this.engine!.gain.setTargetAtTime(warning ? 0.45 : 1, time, 0.1);
    this.whine!.gain.setTargetAtTime(mix.whine, time, 0.25);
    this.roar!.gain.setTargetAtTime(mix.roar, time, 0.25);
    this.filter!.frequency.setTargetAtTime(mix.cutoff, time, 0.3);
    for (const turbine of this.turbines) turbine.frequency.setTargetAtTime(mix.frequency, time, 0.4);
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    if (this.context && !this.disposed) this.master!.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.05);
  }

  private changeWarning(warning: FlightWarning | null): void {
    if (this.warning === warning || !this.context || !this.alarmGain || this.disposed) return;
    this.warning = warning;
    const time = this.context.currentTime;
    this.alarmGain.gain.cancelScheduledValues(time);
    this.alarmGain.gain.setTargetAtTime(warning ? 1 : 0, time, 0.015);
    if (this.alarm) {
      const previous = this.alarm;
      previous.stop(time + 0.04);
      previous.onended = () => previous.disconnect();
      this.alarm = undefined;
    }
    if (!warning) return;
    let buffer = this.alarms.get(warning);
    if (!buffer) {
      const samples = alarmSamples(warning, this.context.sampleRate);
      buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
      buffer.getChannelData(0).set(samples);
      this.alarms.set(warning, buffer);
    }
    this.alarm = this.context.createBufferSource();
    this.alarm.buffer = buffer;
    this.alarm.loop = true;
    this.alarm.connect(this.alarmGain);
    this.alarm.start();
  }

  private reconcile(): void {
    const context = this.context;
    if (!context || this.changing || this.failed || this.disposed || context.state === 'closed') return;
    const play = this.desired || !!this.crash;
    if ((context.state === 'running') === play) return;
    this.changing = true;
    void (play ? context.resume() : context.suspend()).then(() => {
      this.changing = false;
      if ((this.desired || !!this.crash) !== play) this.reconcile();
    }).catch(error => { this.changing = false; this.fail(error); });
  }

  private fail(error: unknown): void {
    if (this.failed || this.disposed) return;
    this.failed = true;
    this.enabled = false;
    this.onError(error);
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWeapons();
    this.stopCrash();
    for (const source of [...this.turbines, this.noise, this.alarm]) {
      source?.stop();
      source?.disconnect();
    }
    for (const node of [this.master, this.engine, this.whine, this.roar, this.filter, this.alarmGain]) node?.disconnect();
    this.alarms.clear();
    this.crashBuffer = undefined;
    this.gunBuffer = undefined;
    this.missileBuffer = undefined;
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(error => console.warn('Unable to close effects audio context', error));
    }
  }
}
