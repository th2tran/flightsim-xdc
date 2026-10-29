import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlightMusic } from './music';

afterEach(() => vi.unstubAllGlobals());

describe('background music lifecycle', () => {
  it('creates no audio before a user gesture and clamps volume', () => {
    const constructor = vi.fn();
    vi.stubGlobal('AudioContext', constructor);
    const music = new FlightMusic(vi.fn());
    music.setPlaying(true);
    expect(constructor).not.toHaveBeenCalled();
    music.setVolume(5);
    expect(music.volume).toBe(1);
    music.setVolume(-1);
    expect(music.volume).toBe(0);
    music.dispose();
    music.activate();
    expect(constructor).not.toHaveBeenCalled();
  });

  it('does not initialize muted music', () => {
    const constructor = vi.fn();
    vi.stubGlobal('AudioContext', constructor);
    const music = new FlightMusic(vi.fn());
    music.enabled = false;
    music.activate();
    expect(constructor).not.toHaveBeenCalled();
  });

  it('reports unsupported audio once without breaking flight', () => {
    const error = new Error('Audio unavailable');
    vi.stubGlobal('AudioContext', class { constructor() { throw error; } });
    const report = vi.fn();
    const music = new FlightMusic(report);
    expect(() => music.activate()).not.toThrow();
    music.activate();
    music.setPlaying(true);
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    expect(music.enabled).toBe(false);
  });
});
