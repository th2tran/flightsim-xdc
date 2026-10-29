import { Vector3 } from 'three';
import { Aircraft, clamp, Scenario, terrainHeight } from './flight';

export interface Bogey {
  id: number;
  position: Vector3;
  velocity: Vector3;
  forward: Vector3;
  health: number;
  cooldown: number;
}
export interface Projectile {
  id: number;
  kind: 'missile' | 'bullet' | 'hostile' | 'flare';
  position: Vector3;
  velocity: Vector3;
  life: number;
  target: number;
  decoyed: boolean;
}
export interface Explosion { id: number; position: Vector3; life: number; }

export function segmentDistance(point: Vector3, start: Vector3, end: Vector3): number {
  const direction = end.clone().sub(start);
  const fraction = clamp(point.clone().sub(start).dot(direction) / Math.max(0.0001, direction.lengthSq()), 0, 1);
  return start.clone().addScaledVector(direction, fraction).distanceTo(point);
}

export class Combat {
  bogeys: Bogey[] = [];
  projectiles: Projectile[] = [];
  explosions: Explosion[] = [];
  selected = 0;
  lock = 0;
  missiles = 6;
  rounds = 640;
  flares = 24;
  kills = 0;
  time = 0;
  message = 'Flight systems ready';
  messageUntil = 5;
  firing = false;
  private nextId = 1;
  private gunCooldown = 0;
  private flareCooldown = 0;
  private missileCooldown = 0;
  private scenario: Scenario = 'training';

  reset(scenario: Scenario, aircraft: Aircraft): void {
    this.scenario = scenario;
    this.bogeys = [];
    this.projectiles = [];
    this.explosions = [];
    this.selected = 0;
    this.lock = 0;
    this.missiles = 6;
    this.rounds = 640;
    this.flares = 24;
    this.kills = this.time = this.gunCooldown = this.flareCooldown = this.missileCooldown = 0;
    this.firing = false;
    const count = scenario === 'training' ? 0 : scenario === 'intercept' ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const position = aircraft.position.clone().add(new Vector3((i - (count - 1) / 2) * 650, 200 + i * 120, -2600 - i * 480));
      const forward = new Vector3(0, 0, 1);
      this.bogeys.push({ id: this.nextId++, position, forward, velocity: forward.clone().multiplyScalar(145), health: 100, cooldown: 12 + i * 5 });
    }
    this.selected = this.bogeys[0]?.id ?? 0;
    this.notify(count ? 'Bandits inbound. Select target, acquire lock, engage.' : 'Training range clear. Practice flight and runway recovery.', 9);
  }

  get target(): Bogey | undefined { return this.bogeys.find(b => b.id === this.selected && b.health > 0); }
  get alive(): Bogey[] { return this.bogeys.filter(b => b.health > 0); }
  get incoming(): number { return this.projectiles.filter(p => p.kind === 'hostile' && !p.decoyed).length; }
  get complete(): boolean { return this.scenario !== 'training' && this.alive.length === 0; }
  notify(message: string, duration = 3): void { this.message = message; this.messageUntil = this.time + duration; }

  cycleTarget(): void {
    const alive = this.alive;
    this.selected = alive[(alive.findIndex(b => b.id === this.selected) + 1) % Math.max(1, alive.length)]?.id ?? 0;
    this.lock = 0;
  }

  launch(aircraft: Aircraft): boolean {
    if (aircraft.phase === 'crashed' || this.missileCooldown > 0) return false;
    if (!this.missiles) { this.notify('Missiles depleted'); return false; }
    if (!this.target || this.lock < 1) { this.notify('No lock. Hold target inside acquisition circle.'); return false; }
    this.missiles--;
    this.missileCooldown = 0.8;
    this.spawn('missile', aircraft.position.clone().addScaledVector(aircraft.forward, 12),
      aircraft.velocity.clone().addScaledVector(aircraft.forward, 180), 18, this.selected);
    this.notify('Fox two. Missile away.');
    return true;
  }

  releaseFlares(aircraft: Aircraft): boolean {
    if (aircraft.phase === 'crashed' || this.flareCooldown > 0) return false;
    if (!this.flares) { this.notify('Countermeasures depleted'); return false; }
    this.flareCooldown = 0.6;
    const count = Math.min(2, this.flares);
    this.flares -= count;
    for (let i = 0; i < count; i++) {
      const v = aircraft.velocity.clone().multiplyScalar(0.65).add(new Vector3(i ? 22 : -22, -9, 0).applyQuaternion(aircraft.attitude));
      this.spawn('flare', aircraft.position.clone(), v, 4, 0);
    }
    this.notify('Flares deployed. Break turn!');
    return true;
  }

  private spawn(kind: Projectile['kind'], position: Vector3, velocity: Vector3, life: number, target: number): void {
    this.projectiles.push({ id: this.nextId++, kind, position, velocity, life, target, decoyed: false });
  }

  private hit(bogey: Bogey, damage: number): void {
    if (bogey.health <= 0) return;
    bogey.health -= damage;
    if (bogey.health <= 0) {
      this.kills++;
      this.explosions.push({ id: this.nextId++, position: bogey.position.clone(), life: 1.5 });
      this.notify(this.complete ? 'Airspace clear. Return to base.' : 'Splash one. Target destroyed.', 5);
      if (this.selected === bogey.id) this.cycleTarget();
    }
  }

  step(dt: number, aircraft: Aircraft): void {
    this.time += dt;
    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    if (aircraft.phase === 'crashed') return;
    const target = this.target;
    if (target) {
      const relative = target.position.clone().sub(aircraft.position);
      const aligned = relative.length() < 6500 && aircraft.forward.dot(relative.normalize()) > Math.cos(9 * Math.PI / 180);
      this.lock = clamp(this.lock + dt * (aligned ? 1 / 1.8 : -2), 0, 1);
    } else this.lock = 0;
    if (this.firing && this.rounds && this.gunCooldown <= 0 && aircraft.phase === 'airborne') {
      this.rounds--;
      this.gunCooldown = 1 / 20;
      this.spawn('bullet', aircraft.position.clone().addScaledVector(aircraft.forward, 12),
        aircraft.velocity.clone().addScaledVector(aircraft.forward, 1000), 1.7, 0);
    }
    for (const bogey of this.bogeys) {
      if (bogey.health <= 0) continue;
      const toPlayer = aircraft.position.clone().sub(bogey.position);
      const range = toPlayer.length();
      const pursuit = toPlayer.normalize();
      if (range < 550) {
        pursuit.set(Math.cos(this.time * 0.17 + bogey.id), 0.10 * Math.sin(this.time * 0.4), Math.sin(this.time * 0.17 + bogey.id));
      } else {
        pursuit.x += Math.sin(this.time * 0.22 + bogey.id) * 0.30;
        pursuit.y += clamp((1200 - bogey.position.y) / 3000, -0.2, 0.2);
      }
      bogey.forward.lerp(pursuit.normalize(), dt * 0.45).normalize();
      bogey.velocity.copy(bogey.forward).multiplyScalar(this.scenario === 'furball' ? 180 : 145);
      bogey.position.addScaledVector(bogey.velocity, dt);
      const floor = terrainHeight(bogey.position.x, bogey.position.z) + 200;
      if (bogey.position.y < floor) { bogey.position.y = floor; bogey.forward.y = Math.abs(bogey.forward.y) + 0.2; bogey.forward.normalize(); }
      bogey.cooldown -= dt;
      if (bogey.cooldown <= 0 && range < 4500 && range > 500 && bogey.forward.dot(toPlayer) > 0.65) {
        bogey.cooldown = this.scenario === 'furball' ? 17 : 28;
        this.spawn('hostile', bogey.position.clone(), bogey.velocity.clone().addScaledVector(bogey.forward, 160), 15, 0);
        this.notify('Missile warning! Deploy flares and maneuver.', 4);
      }
    }
    for (const projectile of this.projectiles) {
      projectile.life -= dt;
      if (projectile.life <= 0) continue;
      const start = projectile.position.clone();
      if (projectile.kind === 'missile' || projectile.kind === 'hostile') {
        let destination: Vector3 | undefined = projectile.kind === 'hostile'
          ? aircraft.position : this.bogeys.find(b => b.id === projectile.target && b.health > 0)?.position;
        if (projectile.kind === 'hostile') {
          const flare = this.projectiles.find(f => f.kind === 'flare' && f.life > 0.3
            && f.position.distanceTo(projectile.position) < 1600
            && f.position.distanceTo(aircraft.position) > 10);
          if (flare) { projectile.decoyed = true; destination = flare.position; }
          else if (projectile.decoyed) destination = undefined;
        }
        const speed = Math.min(720, projectile.velocity.length() + dt * 120);
        if (destination) {
          const desired = destination.clone().sub(projectile.position).normalize();
          const direction = projectile.velocity.clone().normalize();
          const angle = Math.acos(clamp(direction.dot(desired), -1, 1));
          // A finite turn rate allows an outmaneuvered missile to miss.
          const turn = Math.min(1, dt * 1.1 / Math.max(angle, 0.001));
          projectile.velocity.copy(direction.lerp(desired, turn).normalize()).multiplyScalar(speed);
        } else projectile.velocity.setLength(speed);
      }
      if (projectile.kind === 'flare') {
        projectile.velocity.multiplyScalar(Math.exp(-dt * 0.6));
        projectile.velocity.y -= dt * 4;
      }
      projectile.position.addScaledVector(projectile.velocity, dt);
      if (projectile.kind === 'hostile' && !projectile.decoyed
        && segmentDistance(aircraft.position, start, projectile.position) < 22) {
        aircraft.health -= 42;
        projectile.life = 0;
        this.explosions.push({ id: this.nextId++, position: aircraft.position.clone(), life: 0.5 });
        this.notify('Impact! Airframe damaged.', 4);
        if (aircraft.health <= 0) aircraft.crash('Shot down by a hostile missile');
      }
      if (projectile.kind === 'missile' || projectile.kind === 'bullet') {
        for (const bogey of this.bogeys) {
          if (bogey.health > 0 && segmentDistance(bogey.position, start, projectile.position) < (projectile.kind === 'bullet' ? 15 : 30)) {
            this.hit(bogey, projectile.kind === 'bullet' ? 20 : 100);
            projectile.life = 0;
            break;
          }
        }
      }
      if (projectile.position.y < terrainHeight(projectile.position.x, projectile.position.z)) projectile.life = 0;
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
    for (const explosion of this.explosions) explosion.life -= dt;
    this.explosions = this.explosions.filter(e => e.life > 0);
  }
}
