import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { Aircraft, clamp, Scenario, STEP } from './sim/flight';
import { Combat } from './sim/combat';
import { FlightRenderer, ScreenTarget } from './sim/renderer';
import { FlightMusic } from './sim/music';
import { FlightSound } from './sim/sound';
import { flightWarning, WARNING_LABELS } from './sim/warnings';
import { Autopilot } from './sim/autopilot';
import { FlightInstructor } from './sim/guidance';
import { stickResponse } from './sim/controls';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DecimalPipe, UpperCasePipe],
  templateUrl: './app.component.html',
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('world', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  aircraft = new Aircraft();
  combat = new Combat();
  graphics?: FlightRenderer;
  menu = true;
  help = false;
  paused = false;
  started = false;
  error = '';
  scenario: Scenario = 'intercept';
  activeScenario: Scenario = 'intercept';
  runwayStart = false;
  touch = window.matchMedia('(pointer: coarse)').matches;
  cockpit = false;
  targets: ScreenTarget[] = [];
  flightPath = { x: 50, y: 50, visible: false };
  radar: { id: number; x: number; y: number; selected: boolean }[] = [];
  pitchMarks = [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];
  headingMarks = [-30, -20, -10, 0, 10, 20, 30];
  stickX = 0;
  stickY = 0;
  best = 0;
  readonly autopilot = new Autopilot();
  private readonly instructor = new FlightInstructor();
  autopilotPanel = false;
  audioPanel = false;
  audioError = '';
  effectsError = '';
  readonly sound = new FlightSound((error: unknown) => {
    console.warn('Flight sound effects unavailable', error);
    this.effectsError = 'Sound effects are unavailable in this host. Visual warnings remain active.';
    this.changes.detectChanges();
  });
  readonly music = new FlightMusic((error: unknown) => {
    console.warn('Background music unavailable', error);
    this.audioError = 'Music is unavailable in this host. Flight remains playable.';
    this.changes.detectChanges();
  });
  private animation = 0;
  private last = 0;
  private accumulator = 0;
  private lastUi = 0;
  private keys = new Set<string>();
  private stickPointer: number | null = null;
  private stickElement: HTMLElement | null = null;
  private rudder = 0;
  private rudderPointer: number | null = null;
  private rudderElement: HTMLElement | null = null;
  private gunPointer: number | null = null;

  constructor(private zone: NgZone, private changes: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    try {
      this.graphics = new FlightRenderer(this.canvas.nativeElement, () => {
        this.paused = true;
        this.releaseControls();
        this.error = 'The graphics context was lost. Reopen the app to restore the renderer.';
        this.changes.detectChanges();
      });
    } catch (error: unknown) {
      console.error('Renderer initialization failed', error);
      this.error = 'WebGL 2 is unavailable. Use an up-to-date chat app or browser with hardware acceleration enabled.';
    }
    this.combat.reset('intercept', this.aircraft);
    try {
      const saved = Number(localStorage.getItem('afterburner-best') ?? 0);
      this.best = Number.isFinite(saved) && saved >= 0 ? saved : 0;
    } catch (error: unknown) {
      console.warn('Local flight records are unavailable', error);
      this.combat.notify('Local records unavailable in this host. Flight remains fully playable.', 8);
    }
    this.zone.runOutsideAngular(() => { this.animation = requestAnimationFrame(this.frame); });
    this.changes.detectChanges();
  }

  get running(): boolean { return this.started && !this.menu && !this.help && !this.paused && !this.error && this.aircraft.phase !== 'crashed'; }
  get knots(): number { return this.aircraft.airspeed * 1.94384; }
  get feet(): number { return this.aircraft.position.y * 3.28084; }
  get aglFeet(): number { return Math.max(0, this.aircraft.agl * 3.28084); }
  get vsi(): number { return this.aircraft.verticalSpeed * 196.85; }
  get bankDegrees(): number { return this.aircraft.bank * 180 / Math.PI; }
  get pitchDegrees(): number { return this.aircraft.pitch * 180 / Math.PI; }
  get heading(): string { return Math.round(this.aircraft.heading).toString().padStart(3, '0'); }
  headingMark(offset: number): string {
    const degrees = ((Math.round(this.aircraft.heading / 10) * 10 + offset) % 360 + 360) % 360;
    return degrees === 0 ? 'N' : degrees === 90 ? 'E' : degrees === 180 ? 'S' : degrees === 270 ? 'W' : degrees.toString().padStart(3, '0');
  }
  get elapsed(): string {
    const time = Math.floor(this.combat.time);
    return `${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toString().padStart(2, '0')}`;
  }
  get score(): number { return this.combat.kills * 1000 + (this.aircraft.phase === 'landed' ? 500 : 0); }
  get missionName(): string { return this.activeScenario === 'training' ? 'Flight school' : this.activeScenario === 'intercept' ? 'Coastal intercept' : 'Overwhelming odds'; }
  get guidance(): string {
    return this.activeScenario === 'training' ? this.instructor.guidance(this.aircraft, this.autopilot, this.touch) : '';
  }
  get notification(): string { return this.combat.time < this.combat.messageUntil ? this.combat.message : this.guidance; }
  get warning(): string {
    if (this.aircraft.phase === 'crashed') return 'AIRFRAME LOST';
    const warning = flightWarning(this.aircraft, this.combat.incoming);
    return warning ? WARNING_LABELS[warning] : '';
  }
  get targetRange(): string {
    return this.combat.target ? (this.combat.target.position.distanceTo(this.aircraft.position) / 1000).toFixed(1) : '--';
  }
  get targetBearing(): string {
    const target = this.combat.target;
    if (!target) return '';
    const direction = target.position.clone().sub(this.aircraft.position);
    const angle = (Math.atan2(direction.x, -direction.z) * 180 / Math.PI + 360) % 360;
    return `${Math.round(angle).toString().padStart(3, '0')}°`;
  }
  get baseDistance(): string { return (Math.hypot(this.aircraft.position.x, this.aircraft.position.z) / 1000).toFixed(1); }
  get baseBearing(): string {
    return Math.round((Math.atan2(-this.aircraft.position.x, this.aircraft.position.z) * 180 / Math.PI + 360) % 360).toString().padStart(3, '0');
  }

  start(): void {
    if (this.error) return;
    this.sound.stopCrash();
    this.releaseControls();
    this.aircraft.reset(this.runwayStart);
    this.instructor.reset(this.aircraft);
    this.autopilot.disengage();
    this.activeScenario = this.scenario;
    this.combat.reset(this.scenario, this.aircraft);
    if (this.activeScenario === 'training') this.combat.messageUntil = 0;
    this.started = true;
    this.menu = this.help = this.paused = false;
    this.accumulator = 0;
    this.music.activate();
    this.sound.activate();
  }

  resume(): void { this.menu = this.help = this.paused = false; this.accumulator = 0; this.music.activate(); this.sound.activate(); }
  toggleEffects(): void {
    this.sound.enabled = !this.sound.enabled;
    if (!this.sound.enabled) this.sound.stopCrash();
    if (this.sound.enabled) this.sound.activate();
    this.sound.setPlaying(this.running);
  }
  setEffectsVolume(event: Event): void {
    this.sound.setVolume(Number((event.target as HTMLInputElement).value) / 100);
  }
  toggleMusic(): void {
    this.music.enabled = !this.music.enabled;
    if (this.music.enabled) this.music.activate();
    this.music.setPlaying(this.running);
  }
  setMusicVolume(event: Event): void {
    this.music.setVolume(Number((event.target as HTMLInputElement).value) / 100);
  }
  engageAutopilot(recovery = false): void {
    if (!this.running) { this.combat.notify('Resume airborne flight before engaging autopilot.'); return; }
    const error = this.autopilot.engage(this.aircraft, recovery);
    this.combat.notify(error ?? (recovery ? 'Recovery engaged: wings level, vertical speed zero, speed hold.' : 'Autopilot engaged: heading, altitude and speed captured.'), 5);
  }
  engageStallRecovery(): void {
    if (!this.running) { this.combat.notify('Resume airborne flight before engaging stall recovery.'); return; }
    const error = this.autopilot.engageStallRecovery(this.aircraft);
    this.combat.notify(error ?? 'Stall recovery engaged: unloading wing, wings level, full thrust. Monitor terrain.', 6);
  }
  engageAutomaticFlight(takeoff: boolean): void {
    if (!this.running) { this.combat.notify('Resume the simulation before selecting automatic flight.'); return; }
    const error = takeoff ? this.autopilot.engageTakeoff(this.aircraft) : this.autopilot.engageLanding(this.aircraft);
    this.combat.notify(error ?? (takeoff ? `Auto takeoff engaged: runway ${this.autopilot.runway}, full thrust, rotation and climb.`
      : `Return-to-base engaged: runway ${this.autopilot.runway}. Automatic approach, landing and braking.`), 6);
  }
  commandGoAround(): void {
    if (!this.running || this.autopilot.mode !== 'landing' || this.autopilot.landingStage === 'rollout') return;
    this.autopilot.goAround();
    this.combat.notify('Go-around commanded. Climbing to rejoin the approach.', 6);
  }
  disconnectAutopilot(reason = 'Autopilot disconnected. Manual control.'): void {
    if (!this.autopilot.active) return;
    this.autopilot.disengage();
    this.combat.notify(reason, 4);
  }
  setAutopilotTarget(event: Event, field: 'heading' | 'altitude' | 'speed'): void {
    const input = event.target as HTMLInputElement;
    const ranges = { heading: [0, 359], altitude: [1000, 30000], speed: [220, 550] };
    const [min, max] = ranges[field];
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value < min || value > max) {
      input.value = String(this.autopilot[field]);
      this.combat.notify(`Autopilot ${field} must be between ${min} and ${max}.`, 5);
      return;
    }
    this.autopilot[field] = Math.round(value);
  }
  openMenu(): void { this.releaseControls(); this.sound.stopCrash(); this.menu = true; }
  togglePause(): void { if (!this.started || this.menu || this.help) return; this.paused = !this.paused; this.releaseControls(); }
  showHelp(): void { this.releaseControls(); this.sound.stopCrash(); this.help = true; }
  setThrottle(event: Event): void { this.disconnectAutopilot('Autopilot disconnected: manual throttle override.'); this.aircraft.controls.throttle = Number((event.target as HTMLInputElement).value) / 100; }
  toggleGear(): void {
    if (this.aircraft.phase !== 'airborne') { this.combat.notify('Landing gear locked while on ground'); return; }
    if (this.autopilot.automaticFlight) this.disconnectAutopilot('Autopilot disconnected: manual gear override.');
    this.aircraft.gear = !this.aircraft.gear;
    this.combat.notify(this.aircraft.gear ? 'Landing gear down' : 'Landing gear retracted');
  }
  toggleFlaps(): void { if (this.autopilot.automaticFlight) this.disconnectAutopilot('Autopilot disconnected: manual flap override.'); this.aircraft.flaps = !this.aircraft.flaps; this.combat.notify(this.aircraft.flaps ? 'Flaps extended' : 'Flaps retracted'); }
  toggleCamera(): void {
    this.cockpit = !this.cockpit;
    if (this.graphics) this.graphics.cockpit = this.cockpit;
  }
  launch(): void { if (this.running) this.combat.launch(this.aircraft); }
  flare(): void { if (this.running) this.combat.releaseFlares(this.aircraft); }
  target(): void { if (this.running) this.combat.cycleTarget(); }
  async fullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else this.combat.notify('Fullscreen is managed by your chat app.');
    } catch (error: unknown) {
      console.warn('Fullscreen unavailable', error);
      this.combat.notify('This host does not allow fullscreen.');
    }
  }
  reload(): void { window.location.reload(); }

  private frame = (timestamp: number): void => {
    this.music.setPlaying(this.running);
    const dt = this.last ? Math.min((timestamp - this.last) / 1000, 0.1) : 0;
    this.last = timestamp;
    if (this.running) {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.updateControls(STEP);
        this.aircraft.step(STEP);
        this.combat.step(STEP, this.aircraft);
        if (this.activeScenario === 'training') this.instructor.update(this.aircraft, this.autopilot, STEP);
        this.accumulator -= STEP;
        if (this.aircraft.phase === 'crashed') {
          this.autopilot.disengage();
          this.sound.playCrash();
          this.accumulator = 0;
          break;
        }
      }
    } else this.accumulator = 0;
    this.sound.setPlaying(this.running);
    this.sound.update(this.aircraft, this.combat.incoming);
    if (this.graphics && !this.error) {
      this.targets = this.graphics.draw(this.aircraft, this.combat);
      this.flightPath = this.graphics.projectVelocity(this.aircraft);
    }
    if (timestamp - this.lastUi > 75) {
      this.updateRadar();
      this.persistResult();
      this.changes.detectChanges();
      this.lastUi = timestamp;
    }
    this.animation = requestAnimationFrame(this.frame);
  };

  private updateControls(dt: number): void {
    const held = (code: string): number => this.keys.has(code) ? 1 : 0;
    const pitch = held('ArrowDown') + held('KeyS') - held('ArrowUp') - held('KeyW');
    const roll = held('ArrowRight') + held('KeyD') - held('ArrowLeft') - held('KeyA');
    this.aircraft.controls.pitch = clamp(pitch + stickResponse(this.stickY), -1, 1);
    this.aircraft.controls.roll = clamp(roll + stickResponse(this.stickX), -1, 1);
    this.aircraft.controls.yaw = clamp(held('KeyE') - held('KeyQ') + this.rudder, -1, 1);
    this.aircraft.controls.throttle = clamp(this.aircraft.controls.throttle + (held('ShiftLeft') + held('ShiftRight') - held('ControlLeft') - held('ControlRight')) * dt * 0.30, 0, 1);
    this.aircraft.controls.brake = this.keys.has('KeyB');
    this.combat.firing = this.keys.has('Space') || this.gunPointer !== null;
    const throttleInput = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].some(code => this.keys.has(code));
    if (Math.abs(this.aircraft.controls.pitch) > 0.02 || Math.abs(this.aircraft.controls.roll) > 0.02
      || Math.abs(this.aircraft.controls.yaw) > 0.02 || throttleInput || this.aircraft.controls.brake) {
      this.disconnectAutopilot('Autopilot disconnected: manual flight-control override.');
    }
    const autopilotMessage = this.autopilot.step(this.aircraft, dt);
    if (autopilotMessage) this.combat.notify(autopilotMessage, 6);
  }

  private updateRadar(): void {
    const inverse = this.aircraft.attitude.clone().invert();
    this.radar = this.combat.alive.map(b => {
      const relative = b.position.clone().sub(this.aircraft.position).applyQuaternion(inverse);
      const scale = Math.max(6000, Math.hypot(relative.x, relative.z));
      return { id: b.id, x: 50 + relative.x / scale * 43, y: 50 + relative.z / scale * 43, selected: b.id === this.combat.selected };
    });
  }

  private persistResult(): void {
    if (!this.started || (!this.combat.complete && this.aircraft.phase !== 'crashed' && this.aircraft.phase !== 'landed')) return;
    if (this.score <= this.best) return;
    this.best = this.score;
    try { localStorage.setItem('afterburner-best', String(this.best)); }
    catch (error: unknown) {
      console.warn('Unable to save flight record', error);
      this.combat.notify('Flight record could not be saved in this host.', 5);
    }
  }

  @HostListener('window:keydown', ['$event'])
  keyDown(event: KeyboardEvent): void {
    if (event.altKey || event.metaKey || event.target instanceof HTMLInputElement) return;
    const flightKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Space', 'KeyB', 'KeyM', 'KeyF', 'KeyG', 'KeyL', 'KeyV', 'KeyP', 'KeyH', 'KeyR', 'KeyT', 'Tab', 'Escape'];
    if (!flightKeys.includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'Escape' && !event.repeat) { if (this.help) this.help = false; else if (this.menu && this.started) this.resume(); else this.togglePause(); return; }
    if (event.code === 'KeyP' && !event.repeat) { this.togglePause(); return; }
    if (!this.running) return;
    this.keys.add(event.code);
    if (event.repeat) return;
    switch (event.code) {
      case 'KeyM': this.launch(); break;
      case 'KeyF': this.flare(); break;
      case 'Tab': this.target(); break;
      case 'KeyG': this.toggleGear(); break;
      case 'KeyL': this.toggleFlaps(); break;
      case 'KeyV': this.toggleCamera(); break;
      case 'KeyH': if (this.autopilot.active) this.disconnectAutopilot(); else this.engageAutopilot(); break;
      case 'KeyR': this.engageAutopilot(true); break;
      case 'KeyT': this.engageStallRecovery(); break;
    }
  }

  @HostListener('window:keyup', ['$event'])
  keyUp(event: KeyboardEvent): void { this.keys.delete(event.code); }
  @HostListener('window:blur')
  blur(): void { this.releaseControls(); }
  @HostListener('document:visibilitychange')
  visibility(): void { if (document.hidden) this.blur(); }

  stickStart(event: PointerEvent): void {
    if (!this.running || this.stickPointer !== null) return;
    this.stickPointer = event.pointerId;
    this.stickElement = event.currentTarget as HTMLElement;
    this.stickElement.setPointerCapture(event.pointerId);
    this.stickMove(event);
  }
  stickMove(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer || !this.stickElement) return;
    const rect = this.stickElement.getBoundingClientRect();
    let x = (event.clientX - rect.left - rect.width / 2) / (rect.width * 0.38);
    let y = (event.clientY - rect.top - rect.height / 2) / (rect.height * 0.38);
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    this.stickX = Math.abs(x) < 0.06 ? 0 : x;
    this.stickY = Math.abs(y) < 0.06 ? 0 : y;
  }
  stickEnd(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stickX = this.stickY = 0;
    this.stickElement = null;
  }
  rudderStart(event: PointerEvent, direction: number): void {
    if (!this.running || this.rudderPointer !== null) return;
    this.rudderPointer = event.pointerId;
    this.rudderElement = event.currentTarget as HTMLElement;
    this.rudderElement.setPointerCapture(event.pointerId);
    this.rudder = direction;
  }
  rudderEnd(event: PointerEvent): void {
    if (event.pointerId !== this.rudderPointer) return;
    this.rudder = 0;
    this.rudderPointer = null;
    this.rudderElement = null;
  }
  gunStart(event: PointerEvent): void {
    if (!this.running) return;
    this.gunPointer = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  gunEnd(event: PointerEvent): void { if (event.pointerId === this.gunPointer) this.gunPointer = null; }
  brakeStart(event: PointerEvent): void {
    if (!this.running) return;
    this.keys.add('KeyB');
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  brakeEnd(): void { this.keys.delete('KeyB'); }
  private releaseControls(): void {
    this.keys.clear();
    this.stickX = this.stickY = this.rudder = 0;
    this.stickPointer = this.rudderPointer = this.gunPointer = null;
    this.stickElement = this.rudderElement = null;
    this.aircraft.controls.pitch = this.aircraft.controls.roll = this.aircraft.controls.yaw = 0;
    this.aircraft.controls.brake = this.combat.firing = false;
  }
  ngOnDestroy(): void { cancelAnimationFrame(this.animation); this.graphics?.dispose(); this.music.dispose(); this.sound.dispose(); }
}
