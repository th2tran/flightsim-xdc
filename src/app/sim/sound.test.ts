import { afterEach, describe, expect, it, vi } from 'vitest';
import { Aircraft } from './flight';
import { alarmSamples, crashSamples, gunSamples, missileSamples, engineMix, FlightSound } from './sound';
import { flightWarning, FlightWarning } from './warnings';

afterEach(() => vi.unstubAllGlobals());

describe('engine and warning mapping', () => {
  it('generates a bounded rocket ignition and decaying launch whoosh', () => {
    const samples = missileSamples(22050);
    expect(samples.length).toBe(24255);
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
    expect(rms(samples)).toBeGreaterThan(0.03);
    expect(rms(samples.slice(0, 6000))).toBeGreaterThan(rms(samples.slice(-6000)) * 5);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1);
    expect(Math.abs(samples[0])).toBe(0);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.0001);
  });
  it('generates a short, bounded cannon report with silent endpoints', () => {
    const samples = gunSamples(22050);
    expect(samples.length).toBe(1985);
    const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
    expect(rms).toBeGreaterThan(0.03);
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(1);
    expect(Math.abs(samples[0])).toBe(0);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.001);
  });
  it('generates a bounded impact with a decaying rumble and silent endpoints', () => {
    const samples = crashSamples(22050);
    expect(samples.length).toBe(52920);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
    expect(peak).toBeGreaterThan(0.3);
    expect(peak).toBeLessThan(1);
    expect(rms(samples.slice(0, 11025))).toBeGreaterThan(rms(samples.slice(-11025)) * 10);
    expect(samples[0]).toBe(0);
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.0001);
  });
  it('increases turbine pitch and roar with thrust, including afterburner', () => {
    const aircraft = new Aircraft();
    aircraft.controls.throttle = 0;
    const idle = engineMix(aircraft);
    aircraft.controls.throttle = 0.88;
    const military = engineMix(aircraft);
    aircraft.controls.throttle = 1;
    const burner = engineMix(aircraft);
    expect(military.frequency).toBeGreaterThan(idle.frequency);
    expect(burner.roar).toBeGreaterThan(military.roar * 1.8);
    expect(burner.cutoff).toBeGreaterThan(military.cutoff);
    aircraft.fuel = 0;
    expect(engineMix(aircraft).whine).toBe(0);
    expect(engineMix(aircraft).roar).toBe(0);
    aircraft.reset(false);
    aircraft.crash('test');
    expect(engineMix(aircraft).roar).toBe(0);
  });

  it('uses the HUD warning thresholds and resolves simultaneous threats by priority', () => {
    const aircraft = new Aircraft();
    expect(flightWarning(aircraft, 0)).toBeNull();
    aircraft.gear = true;
    expect(flightWarning(aircraft, 0)).toBe('gear');
    aircraft.fuel = 149;
    expect(flightWarning(aircraft, 0)).toBe('fuel');
    aircraft.airspeed = 341;
    expect(flightWarning(aircraft, 0)).toBe('speed');
    aircraft.gLoad = -8.1;
    expect(flightWarning(aircraft, 0)).toBe('g');
    aircraft.stalled = true;
    expect(flightWarning(aircraft, 0)).toBe('stall');
    aircraft.position.set(0, 100, 0);
    aircraft.verticalSpeed = -4.1;
    expect(flightWarning(aircraft, 0)).toBe('terrain');
    expect(flightWarning(aircraft, 1)).toBe('missile');
    aircraft.crash('test');
    expect(flightWarning(aircraft, 1)).toBeNull();
  });

  it('does not warn at exact safe thresholds', () => {
    const aircraft = new Aircraft();
    aircraft.position.set(0, 102.2, 0);
    aircraft.verticalSpeed = -4;
    aircraft.airspeed = 340;
    aircraft.gLoad = 8;
    aircraft.fuel = 150;
    expect(flightWarning(aircraft, 0)).toBeNull();
  });

  it.each<FlightWarning>(['missile', 'terrain', 'stall', 'g', 'speed', 'fuel', 'gear'])('generates audible, bounded, click-free %s loops', warning => {
    const data = alarmSamples(warning, 22050);
    const rms = Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length);
    expect(rms).toBeGreaterThan(0.02);
    expect(Math.max(...data.slice(0, 20000).map(Math.abs))).toBeLessThan(0.3);
    expect(data[0]).toBe(0);
    expect(Math.abs(data[data.length - 1])).toBeLessThan(0.01);
  });
});

function audioHarness() {
  const parameter = () => ({ value: 0, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = () => ({
    gain: parameter(), frequency: parameter(), detune: parameter(), Q: parameter(),
    threshold: parameter(), ratio: parameter(), type: '', loop: false,
    connect: vi.fn(function (this: unknown, destination: unknown) { return destination; }),
    disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    buffer: null, onended: null,
  });
  const sources: ReturnType<typeof node>[] = [];
  const oscillators: ReturnType<typeof node>[] = [];
  const context = {
    currentTime: 0, sampleRate: 22050, state: 'suspended', destination: node(),
    createGain: () => node(), createDynamicsCompressor: () => node(), createBiquadFilter: () => node(),
    createOscillator: () => { const oscillator = node(); oscillators.push(oscillator); return oscillator; },
    createBufferSource: () => { const source = node(); sources.push(source); return source; },
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    resume: vi.fn(async () => { context.state = 'running'; }),
    suspend: vi.fn(async () => { context.state = 'suspended'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
  };
  const constructor = vi.fn(function () { return context; });
  vi.stubGlobal('AudioContext', constructor);
  return { context, sources, oscillators, constructor };
}

describe('sound effects lifecycle', () => {
  it('reuses missile audio and cancels launches on pause and crash', async () => {
    const { sources } = audioHarness();
    const sound = new FlightSound(vi.fn());
    sound.activate();
    sound.playMissile();
    expect(sources).toHaveLength(1);
    sound.setPlaying(true);
    await Promise.resolve();
    sound.playMissile();
    sound.playMissile();
    expect(sources).toHaveLength(3);
    expect(sources[1].buffer).toBe(sources[2].buffer);
    expect(sources[1].loop).toBe(false);
    sound.setPlaying(false);
    expect(sources[1].stop).toHaveBeenCalledOnce();
    sound.enabled = false;
    sound.playMissile();
    expect(sources).toHaveLength(3);
    sound.enabled = true;
    sound.setPlaying(true);
    sound.playMissile();
    sound.playCrash();
    expect(sources[3].stop).toHaveBeenCalledOnce();
    sound.playMissile();
    expect(sources).toHaveLength(5);
    sound.dispose();
  });
  it('plays one report per shot, reuses its buffer, and stops on pause, mute or crash', async () => {
    const { sources } = audioHarness();
    const sound = new FlightSound(vi.fn());
    sound.activate();
    sound.playGun();
    expect(sources).toHaveLength(1);
    sound.setPlaying(true);
    await Promise.resolve();
    sound.playGun();
    sound.playGun();
    expect(sources).toHaveLength(3);
    expect(sources[1].buffer).toBe(sources[2].buffer);
    expect(sources[1].loop).toBe(false);
    const ended = sources[1].onended as (() => void) | null;
    ended?.();
    expect(sources[1].disconnect).toHaveBeenCalledOnce();
    sound.setPlaying(false);
    expect(sources[2].stop).toHaveBeenCalledOnce();
    sound.playGun();
    expect(sources).toHaveLength(3);
    sound.setPlaying(true);
    sound.playGun();
    sound.enabled = false;
    sound.setPlaying(true);
    expect(sources[3].stop).toHaveBeenCalledOnce();
    sound.playGun();
    expect(sources).toHaveLength(4);
    sound.enabled = true;
    sound.setPlaying(true);
    sound.playGun();
    sound.playCrash();
    expect(sources[4].stop).toHaveBeenCalledOnce();
    sound.playGun();
    expect(sources).toHaveLength(6);
    sound.dispose();
  });
  it('lets a one-shot crash finish after flight stops, then suspends audio', async () => {
    const { context, sources } = audioHarness();
    const sound = new FlightSound(vi.fn());
    sound.activate();
    sound.setPlaying(true);
    await Promise.resolve();
    sound.playCrash();
    sound.playCrash();
    expect(sources).toHaveLength(2);
    const crash = sources[1];
    expect(crash.loop).toBe(false);
    expect(crash.start).toHaveBeenCalledOnce();
    sound.setPlaying(false);
    await Promise.resolve();
    expect(context.state).toBe('running');
    const ended = crash.onended as (() => void) | null;
    ended?.();
    await Promise.resolve();
    expect(context.state).toBe('suspended');
    expect(crash.disconnect).toHaveBeenCalledOnce();
    sound.dispose();
  });

  it('cancels crash audio on reset/mute and does not play while effects are muted', async () => {
    const { sources, context } = audioHarness();
    const sound = new FlightSound(vi.fn());
    sound.playCrash();
    expect(sources).toHaveLength(0);
    sound.activate();
    sound.setPlaying(true);
    await Promise.resolve();
    sound.playCrash();
    sound.setPlaying(false);
    sound.stopCrash();
    await Promise.resolve();
    expect(sources[1].stop).toHaveBeenCalledOnce();
    expect(sources[1].onended).toBeNull();
    expect(context.state).toBe('suspended');
    sound.enabled = false;
    sound.playCrash();
    expect(sources).toHaveLength(2);
    sound.dispose();
  });
  it('does not allocate before a gesture or while disabled', () => {
    const { constructor } = audioHarness();
    const sound = new FlightSound(vi.fn());
    sound.setPlaying(true);
    expect(constructor).not.toHaveBeenCalled();
    sound.enabled = false;
    sound.activate();
    expect(constructor).not.toHaveBeenCalled();
    sound.setVolume(2);
    expect(sound.volume).toBe(1);
    sound.setVolume(-1);
    expect(sound.volume).toBe(0);
  });

  it('reuses continuous nodes, replaces only changed alarms, and suspends and disposes', async () => {
    const { context, sources, oscillators } = audioHarness();
    const report = vi.fn();
    const sound = new FlightSound(report);
    const aircraft = new Aircraft();
    sound.activate();
    sound.setPlaying(true);
    await Promise.resolve();
    sound.update(aircraft, 0);
    expect(oscillators).toHaveLength(2);
    expect(sources).toHaveLength(1);
    sound.update(aircraft, 1);
    expect(sources).toHaveLength(2);
    expect(sources[1].loop).toBe(true);
    sound.update(aircraft, 1);
    expect(sources).toHaveLength(2);
    aircraft.stalled = true;
    sound.update(aircraft, 0);
    expect(sources[1].stop).toHaveBeenCalledOnce();
    expect(sources).toHaveLength(3);
    aircraft.stalled = false;
    sound.update(aircraft, 0);
    expect(sources[2].stop).toHaveBeenCalledOnce();
    sound.enabled = false;
    sound.setPlaying(true);
    await Promise.resolve();
    expect(context.state).toBe('suspended');
    sound.enabled = true;
    sound.setPlaying(true);
    await Promise.resolve();
    expect(context.state).toBe('running');
    sound.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(oscillators.every(n => n.stop.mock.calls.length === 1)).toBe(true);
    expect(sources[0].stop).toHaveBeenCalledOnce();
    sound.dispose();
    expect(context.close).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it('reports audio failures explicitly, disables effects, and prevents retries', () => {
    const error = new Error('Audio unavailable');
    vi.stubGlobal('AudioContext', class { constructor() { throw error; } });
    const report = vi.fn();
    const sound = new FlightSound(report);
    sound.activate();
    sound.activate();
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    expect(sound.enabled).toBe(false);
  });
});
