const SAMPLE_RATE = 22050;
const BEAT = 60 / 92;
const BARS = 16;
const DURATION = BARS * 4 * BEAT;
const frequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Original "Northstar" cue: slow brass phrases over strings, bass and field drums. */
async function renderScore(): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, Math.ceil((DURATION + 3) * SAMPLE_RATE), SAMPLE_RATE);
  const bus = context.createGain();
  bus.gain.value = 0.65;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 4;
  bus.connect(compressor).connect(context.destination);
  const delay = context.createDelay(1);
  delay.delayTime.value = BEAT * 0.75;
  const echo = context.createGain();
  echo.gain.value = 0.16;
  bus.connect(delay).connect(echo).connect(compressor);

  const voice = (midi: number, beat: number, beats: number, volume: number, brass = false): void => {
    const time = beat * BEAT, duration = beats * BEAT;
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const pan = context.createStereoPanner();
    pan.pan.value = brass ? -0.12 : 0.24;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(brass ? 650 : 1000, time);
    filter.frequency.linearRampToValueAtTime(brass ? 2200 : 1600, time + 0.15);
    filter.frequency.linearRampToValueAtTime(650, time + duration);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + (brass ? 0.09 : 0.35));
    envelope.gain.setValueAtTime(volume * 0.78, time + Math.max(0.36, duration - 0.12));
    envelope.gain.linearRampToValueAtTime(0, time + duration + 0.45);
    envelope.connect(filter).connect(pan).connect(bus);
    for (const detune of [-5, 5]) {
      const oscillator = context.createOscillator();
      oscillator.type = brass ? 'sawtooth' : 'triangle';
      oscillator.frequency.value = frequency(midi);
      oscillator.detune.value = detune;
      oscillator.connect(envelope);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.5);
    }
  };

  let seed = 173;
  const noise = context.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 0x80000000 - 1;
  }
  const drum = (beat: number, snare: boolean, volume: number): void => {
    const time = beat * BEAT;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(volume, time);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + (snare ? 0.18 : 0.65));
    envelope.connect(bus);
    if (snare) {
      const source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800;
      filter.Q.value = 0.65;
      source.connect(filter).connect(envelope);
      source.start(time);
      source.stop(time + 0.2);
    } else {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(100, time);
      oscillator.frequency.exponentialRampToValueAtTime(42, time + 0.25);
      oscillator.connect(envelope);
      oscillator.start(time);
      oscillator.stop(time + 0.7);
    }
  };

  const chords = [
    [50, 57, 62, 65], [46, 53, 58, 62], [53, 60, 65, 69], [48, 55, 60, 64],
    [43, 50, 58, 62], [46, 53, 62, 65], [45, 52, 57, 61], [45, 52, 57, 64],
  ];
  const melody = [
    [[69, 0, 1.5], [65, 2, 1], [67, 3, 0.75]],
    [[70, 0, 2.5], [65, 3, 0.75]],
    [[72, 0.5, 1], [69, 2, 1.5]],
    [[67, 0, 3]],
    [[70, 0, 1], [74, 1.5, 1], [69, 3, 0.75]],
    [[65, 0, 2], [62, 2.5, 1]],
    [[64, 0, 1], [67, 1.5, 1], [61, 3, 0.75]],
    [[64, 0, 2.5]],
  ];
  for (let bar = 0; bar < BARS; bar++) {
    const chord = chords[bar % chords.length];
    for (const note of chord.slice(1)) voice(note, bar * 4, 3.8, 0.018);
    voice(chord[0] - 12, bar * 4, 3.5, 0.055);
    for (let step = 0; step < 8; step++) {
      voice(chord[1 + step % 3] + (bar >= 8 ? 12 : 0), bar * 4 + step / 2, 0.35, 0.012);
    }
    for (const [note, offset, length] of melody[bar % melody.length]) {
      voice(note, bar * 4 + offset, length, bar >= 8 ? 0.040 : 0.032, true);
      if (bar >= 8) voice(note - 12, bar * 4 + offset, length, 0.018, true);
    }
    drum(bar * 4, false, 0.16);
    drum(bar * 4 + 2, false, 0.09);
    drum(bar * 4 + 1, true, 0.10);
    drum(bar * 4 + 3, true, 0.12);
    drum(bar * 4 + 3.5, true, 0.035);
  }
  const rendered = await context.startRendering();
  const loop = new AudioBuffer({ numberOfChannels: 2, length: Math.round(DURATION * SAMPLE_RATE), sampleRate: SAMPLE_RATE });
  // Fold release/echo tails into the start so the loop has no abrupt cut.
  for (let channel = 0; channel < 2; channel++) {
    const source = rendered.getChannelData(channel), target = loop.getChannelData(channel);
    for (let i = 0; i < source.length; i++) target[i % target.length] += source[i];
  }
  return loop;
}

export class FlightMusic {
  enabled = true;
  volume = 0.35;
  private context?: AudioContext;
  private gain?: GainNode;
  private source?: AudioBufferSourceNode;
  private desired = false;
  private changing = false;
  private failed = false;
  private disposed = false;

  constructor(private readonly onError: (error: unknown) => void) {}

  activate(): void {
    if (this.context || !this.enabled || this.failed || this.disposed) return;
    try {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.context.destination);
      // Resume synchronously from the launch/unmute gesture, before rendering awaits.
      void this.context.resume().catch(error => this.fail(error));
      void renderScore().then(buffer => {
        if (this.disposed || this.failed || !this.context || !this.gain) return;
        this.source = this.context.createBufferSource();
        this.source.buffer = buffer;
        this.source.loop = true;
        this.source.connect(this.gain);
        this.source.start();
        this.applyVolume();
        this.reconcile();
      }).catch(error => this.fail(error));
    } catch (error: unknown) { this.fail(error); }
  }

  setPlaying(playing: boolean): void {
    const desired = playing && this.enabled && !this.failed;
    if (desired === this.desired) return;
    this.desired = desired;
    this.applyVolume();
    this.reconcile();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.gain || !this.context || this.disposed) return;
    this.gain.gain.cancelScheduledValues(this.context.currentTime);
    this.gain.gain.setTargetAtTime(this.desired ? this.volume : 0, this.context.currentTime, 0.08);
  }

  private reconcile(): void {
    const context = this.context;
    if (!context || this.changing || this.failed || this.disposed || context.state === 'closed') return;
    const play = this.desired;
    if ((context.state === 'running') === play) return;
    this.changing = true;
    void (play ? context.resume() : context.suspend()).then(() => {
      this.changing = false;
      if (this.desired !== play) this.reconcile();
    }).catch(error => { this.changing = false; this.fail(error); });
  }

  private fail(error: unknown): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.enabled = false;
    this.onError(error);
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.source?.stop();
    this.source?.disconnect();
    this.gain?.disconnect();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(error => console.warn('Unable to close music audio context', error));
    }
  }
}
