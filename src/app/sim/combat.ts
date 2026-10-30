import { Quaternion, Vector3 } from 'three';
import type { Loadout } from './airframes';
import { Aircraft, clamp, Scenario, terrainHeight } from './flight';

export interface Bogey {
  id: number;
  position: Vector3;
  velocity: Vector3;
  forward: Vector3;
  health: number;
  cooldown: number;
  drone?: boolean;
  /** Webxdc address of a remote player flying this aircraft (network campaigns only). */
  peer?: string;
  name?: string;
  airframe?: string;
}
export interface Projectile {
  id: number;
  kind: 'missile' | 'bullet' | 'hostile' | 'flare';
  position: Vector3;
  velocity: Vector3;
  life: number;
  target: number;
  decoyed: boolean;
  damage?: number;
  /** Peer address that launched a hostile missile at the local player. */
  owner?: string;
}
export interface Explosion {
  id: number;
  position: Vector3;
  life: number;
  duration: number;
  intensity: number;
  kind: 'missile' | 'destroyed';
}
export interface MissileStrike {
  id: number;
  target: number | 'player';
  localPosition: Vector3;
  localNormal: Vector3;
  localTrail: Vector3;
  life: number;
  duration: number;
}

/** Role of the local client in a network campaign. */
export interface CombatNetwork {
  /** True on the one client that simulates the computer-controlled bogeys. */
  authority: boolean;
  competitive: boolean;
}
export type CombatEvent =
  | { type: 'damage'; target: number; amount: number; missile: boolean }
  | { type: 'fire'; at: string; position: Vector3; velocity: Vector3; damage: number };
export interface CampaignSetup { bogeys: number; origin: Vector3; network: CombatNetwork }

export const PVP_MISSILE_DAMAGE = 50;
export const PVP_GUN_DAMAGE = 8;
const HOSTILE_MISSILE_DAMAGE = 42;
const STRIKE_DURATION = 0.9;
const AIRFRAME_RADII = new Vector3(6, 1.5, 10);
const MISSILE_BLAST_DURATION = 2.2;
const DRONE_SPEED = 110;
const TRAINING_MISSILE_DAMAGE = 15;

export function segmentClosestPoint(point: Vector3, start: Vector3, end: Vector3): Vector3 {
  const direction = end.clone().sub(start);
  const fraction = clamp(point.clone().sub(start).dot(direction) / Math.max(0.0001, direction.lengthSq()), 0, 1);
  return start.clone().addScaledVector(direction, fraction);
}

export function segmentDistance(point: Vector3, start: Vector3, end: Vector3): number {
  return point.distanceTo(segmentClosestPoint(point, start, end));
}

export class Combat {
  bogeys: Bogey[] = [];
  projectiles: Projectile[] = [];
  explosions: Explosion[] = [];
  strikes: MissileStrike[] = [];
  selected = 0;
  lock = 0;
  missiles = 6;
  rounds = 640;
  flares = 24;
  loadout: Loadout = { missiles: 6, rounds: 640, flares: 24 };
  kills = 0;
  gunKills = 0;
  missileKills = 0;
  missilesDefeated = 0;
  time = 0;
  message = 'Flight systems ready';
  messageUntil = 5;
  firing = false;
  network: CombatNetwork | null = null;
  /** Outbox of hits and launches the network layer must deliver to other clients. */
  events: CombatEvent[] = [];
  lastAttacker = '';
  lastAttackMissile = false;
  victory = false;
  /** Computer bogeys the sortie started with; zero-bogey network campaigns cannot be won by clearing the airspace. */
  startingBogeys = 0;
  private nextId = 1;
  private gunCooldown = 0;
  private flareCooldown = 0;
  private missileCooldown = 0;
  private scenario: Scenario = 'training';

  reset(scenario: Scenario, aircraft: Aircraft, campaign?: CampaignSetup): void {
    this.scenario = scenario;
    this.network = scenario === 'network' && campaign ? { ...campaign.network } : null;
    this.events = [];
    this.lastAttacker = '';
    this.lastAttackMissile = false;
    this.victory = false;
    this.bogeys = [];
    this.projectiles = [];
    this.explosions = [];
    this.strikes = [];
    this.selected = 0;
    this.lock = 0;
    this.loadout = { ...aircraft.airframe.loadout };
    this.missiles = this.loadout.missiles;
    this.rounds = this.loadout.rounds;
    this.flares = this.loadout.flares;
    this.kills = this.gunKills = this.missileKills = this.missilesDefeated = 0;
    this.time = this.gunCooldown = this.flareCooldown = this.missileCooldown = 0;
    this.firing = false;
    const count = scenario === 'training' ? 0 : scenario === 'intercept' ? 3 : scenario === 'furball' ? 5 : campaign?.bogeys ?? 3;
    for (let i = 0; i < count; i++) {
      const forward = new Vector3(0, 0, 1);
      if (scenario === 'network') {
        // Identical ids and positions on every client so the authority's updates line up.
        const position = (campaign?.origin ?? aircraft.position).clone()
          .add(new Vector3((i - (count - 1) / 2) * 650, 200 + (i % 4) * 120, -3200 - (i % 4) * 480));
        this.bogeys.push({ id: i + 1, position, forward, velocity: forward.clone().multiplyScalar(this.bogeySpeed), health: 100, cooldown: 14 + i * 3 });
        continue;
      }
      const position = aircraft.position.clone().add(new Vector3((i - (count - 1) / 2) * 650, 200 + i * 120, -2600 - i * 480));
      this.bogeys.push({ id: this.nextId++, position, forward, velocity: forward.clone().multiplyScalar(145), health: 100, cooldown: 12 + i * 5 });
    }
    this.startingBogeys = count;
    this.nextId = Math.max(this.nextId, count + 1);
    this.selected = this.bogeys[0]?.id ?? 0;
    this.notify(count ? 'Bandits inbound. Select target, acquire lock, engage.'
      : scenario === 'network' ? 'No computer bogeys. Fly with the other pilots.' : 'Training range clear. Practice flight and runway recovery.', 9);
  }

  get target(): Bogey | undefined { return this.bogeys.find(b => b.id === this.selected && this.targetable(b)); }
  get alive(): Bogey[] { return this.bogeys.filter(b => b.health > 0); }
  /** Live computer-controlled bogeys, excluding other players. */
  get hostiles(): Bogey[] { return this.bogeys.filter(b => b.health > 0 && !b.peer); }
  get peers(): Bogey[] { return this.bogeys.filter(b => b.peer); }
  /** Other players may only be targeted in competitive network campaigns. */
  targetable(bogey: Bogey): boolean { return bogey.health > 0 && (!bogey.peer || !!this.network?.competitive); }
  private get bogeySpeed(): number { return this.scenario === 'furball' ? 180 : this.scenario === 'network' ? 160 : 145; }
  get incoming(): number { return this.projectiles.filter(p => p.kind === 'hostile' && !p.decoyed).length; }
  get complete(): boolean {
    if (this.victory) return true;
    return this.scenario !== 'training' && !this.network?.competitive && this.startingBogeys > 0 && this.hostiles.length === 0;
  }
  notify(message: string, duration = 3): void { this.message = message; this.messageUntil = this.time + duration; }

  cycleTarget(): void {
    const alive = this.bogeys.filter(b => this.targetable(b));
    this.selected = alive[(alive.findIndex(b => b.id === this.selected) + 1) % Math.max(1, alive.length)]?.id ?? 0;
    this.lock = 0;
  }

  launch(aircraft: Aircraft): boolean {
    if (aircraft.phase === 'crashed' || this.missileCooldown > 0) return false;
    if (!this.missiles) { this.notify('Missiles depleted'); return false; }
    if (!this.target || this.lock < 1) { this.notify('No lock. Hold target inside acquisition circle.'); return false; }
    this.missiles--;
    this.missileCooldown = 0.8;
    const position = aircraft.position.clone().addScaledVector(aircraft.forward, 12);
    const velocity = aircraft.velocity.clone().addScaledVector(aircraft.forward, 180);
    this.spawn('missile', position, velocity, 18, this.selected);
    // The target player's client flies its own copy so it can be decoyed and score the hit.
    if (this.target?.peer) this.events.push({ type: 'fire', at: this.target.peer, position: position.clone(), velocity: velocity.clone(), damage: PVP_MISSILE_DAMAGE });
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

  /** Non-firing, straight-flying target for Flight School, placed ahead at a bearing offset from the nose. */
  spawnTrainingDrone(aircraft: Aircraft, distance: number, offset: number): Bogey {
    const heading = new Vector3(aircraft.forward.x, 0, aircraft.forward.z);
    if (heading.lengthSq() < 0.001) heading.set(0, 0, -1);
    heading.normalize();
    const bearing = heading.clone().applyAxisAngle(new Vector3(0, 1, 0), -offset);
    const position = aircraft.position.clone().addScaledVector(bearing, distance);
    position.y = Math.max(position.y + 60, terrainHeight(position.x, position.z) + 400);
    const drone: Bogey = {
      id: this.nextId++, position, forward: heading, velocity: heading.clone().multiplyScalar(DRONE_SPEED),
      health: 100, cooldown: Infinity, drone: true,
    };
    this.bogeys.push(drone);
    if (!this.target) { this.selected = drone.id; this.lock = 0; }
    return drone;
  }

  /** Reduced-damage hostile missile launched from behind for the Flight School flare drill. */
  launchTrainingMissile(aircraft: Aircraft): void {
    const heading = new Vector3(aircraft.forward.x, 0, aircraft.forward.z);
    if (heading.lengthSq() < 0.001) heading.set(0, 0, -1);
    heading.normalize();
    const from = aircraft.position.clone()
      .addScaledVector(heading.clone().applyAxisAngle(new Vector3(0, 1, 0), 2.4), 2800);
    from.y = Math.max(aircraft.position.y, terrainHeight(from.x, from.z) + 200);
    const velocity = aircraft.position.clone().sub(from).setLength(260);
    this.spawn('hostile', from, velocity, 15, 0, TRAINING_MISSILE_DAMAGE);
    this.notify('Missile warning! Deploy flares and break turn.', 4);
  }

  /** A missile fired at the local player by another client (a player or the bogey authority). */
  incomingMissile(position: Vector3, velocity: Vector3, damage: number, owner?: string): void {
    this.spawn('hostile', position.clone(), velocity.clone(), 15, 0, damage, owner);
    this.notify('Missile warning! Deploy flares and maneuver.', 4);
  }

  /** Cannon damage to the local player reported by the shooter's client. */
  applyPlayerDamage(aircraft: Aircraft, amount: number, by: string, byName = 'another pilot'): void {
    if (aircraft.phase === 'crashed') return;
    aircraft.health -= amount;
    this.lastAttacker = by;
    this.lastAttackMissile = false;
    this.notify(`Taking fire from ${byName}!`, 3);
    if (aircraft.health <= 0) aircraft.crash(`Shot down by ${byName}`);
  }

  /** Applies damage reported by another client to a computer bogey. Returns true when it destroys it. */
  damageBogey(id: number, amount: number, missile: boolean): boolean {
    const bogey = this.bogeys.find(b => b.id === id && !b.peer);
    if (!bogey || bogey.health <= 0) return false;
    return this.hit(bogey, amount, missile, false);
  }

  /** Credits the local player with a kill confirmed by another client. */
  creditKill(missile: boolean, message = 'Splash one. Target destroyed.'): void {
    this.kills++;
    if (missile) this.missileKills++;
    else this.gunKills++;
    this.notify(this.complete ? 'Airspace clear. Return to base.' : message, 5);
  }

  /** Mirrors a computer bogey simulated by the authority client. */
  syncBogey(id: number, position: Vector3, forward: Vector3, health: number): void {
    let bogey = this.bogeys.find(b => b.id === id && !b.peer);
    if (!bogey) {
      bogey = { id, position: position.clone(), forward: forward.clone().normalize(), velocity: new Vector3(), health, cooldown: 14 };
      this.bogeys.push(bogey);
    }
    const destroyed = bogey.health > 0 && health <= 0;
    bogey.position.copy(position);
    if (forward.lengthSq() > 0.001) bogey.forward.copy(forward).normalize();
    bogey.velocity.copy(bogey.forward).multiplyScalar(this.bogeySpeed);
    bogey.health = health;
    if (destroyed) this.destroyed(bogey);
  }

  /** Mirrors another player's aircraft. */
  syncPeer(peer: string, id: number, name: string, airframe: string, position: Vector3, velocity: Vector3, health: number): Bogey {
    let bogey = this.bogeys.find(b => b.peer === peer);
    if (!bogey) {
      bogey = { id, peer, name, airframe, position: position.clone(), velocity: velocity.clone(), forward: new Vector3(0, 0, -1), health, cooldown: Infinity };
      this.bogeys.push(bogey);
    }
    const destroyed = bogey.health > 0 && health <= 0;
    bogey.name = name;
    bogey.airframe = airframe;
    bogey.position.copy(position);
    bogey.velocity.copy(velocity);
    if (velocity.lengthSq() > 1) bogey.forward.copy(velocity).normalize();
    bogey.health = health;
    if (destroyed) this.destroyed(bogey);
    return bogey;
  }

  removePeer(peer: string): void {
    const bogey = this.bogeys.find(b => b.peer === peer);
    if (!bogey) return;
    this.bogeys = this.bogeys.filter(b => b !== bogey);
    if (this.selected === bogey.id) this.cycleTarget();
  }

  private destroyed(bogey: Bogey): void {
    this.explosions.push({
      id: this.nextId++, position: bogey.position.clone(), life: 1.5, duration: 1.5, intensity: 1.15, kind: 'destroyed',
    });
    if (this.selected === bogey.id) this.cycleTarget();
  }

  private spawn(kind: Projectile['kind'], position: Vector3, velocity: Vector3, life: number, target: number, damage?: number, owner?: string): void {
    this.projectiles.push({ id: this.nextId++, kind, position, velocity, life, target, decoyed: false, damage, owner });
  }

  private hit(bogey: Bogey, damage: number, missileImpact = false, credit = true): boolean {
    if (bogey.health <= 0) return false;
    bogey.health -= damage;
    if (bogey.health > 0) return false;
    if (credit) {
      this.kills++;
      if (missileImpact) this.missileKills++;
      else this.gunKills++;
    }
    if (!missileImpact || !credit) {
      this.explosions.push({
        id: this.nextId++, position: bogey.position.clone(), life: 1.5, duration: 1.5, intensity: 1.15, kind: 'destroyed',
      });
    }
    if (credit) this.notify(this.complete ? 'Airspace clear. Return to base.' : 'Splash one. Target destroyed.', 5);
    if (this.selected === bogey.id) this.cycleTarget();
    return true;
  }

  private missileStrike(
    target: number | 'player',
    targetPosition: Vector3,
    attitude: Quaternion,
    impactPosition: Vector3,
    projectileVelocity: Vector3,
    targetVelocity: Vector3,
  ): void {
    const inverse = attitude.clone().invert();
    const offset = impactPosition.clone().sub(targetPosition).applyQuaternion(inverse);
    const localNormal = offset.lengthSq() > 0.001
      ? offset.normalize()
      : projectileVelocity.clone().negate().applyQuaternion(inverse).normalize();
    const surfaceScale = Math.sqrt(
      (localNormal.x / AIRFRAME_RADII.x) ** 2
      + (localNormal.y / AIRFRAME_RADII.y) ** 2
      + (localNormal.z / AIRFRAME_RADII.z) ** 2,
    );
    const localPosition = localNormal.clone().multiplyScalar(1 / surfaceScale);
    const surfaceNormal = new Vector3(
      localPosition.x / AIRFRAME_RADII.x ** 2,
      localPosition.y / AIRFRAME_RADII.y ** 2,
      localPosition.z / AIRFRAME_RADII.z ** 2,
    ).normalize();
    const localTrail = targetVelocity.clone().negate().applyQuaternion(inverse);
    if (localTrail.lengthSq() < 0.001) localTrail.set(0, 0, 1);
    else localTrail.normalize();
    this.strikes.push({
      id: this.nextId++,
      target,
      localPosition,
      localNormal: surfaceNormal,
      localTrail,
      life: STRIKE_DURATION,
      duration: STRIKE_DURATION,
    });
  }

  private ageEffects(dt: number): void {
    for (const explosion of this.explosions) explosion.life -= dt;
    this.explosions = this.explosions.filter(explosion => explosion.life > 0);
    for (const strike of this.strikes) strike.life -= dt;
    this.strikes = this.strikes.filter(strike => strike.life > 0);
  }

  step(dt: number, aircraft: Aircraft): void {
    this.time += dt;
    this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    this.flareCooldown = Math.max(0, this.flareCooldown - dt);
    this.missileCooldown = Math.max(0, this.missileCooldown - dt);
    if (aircraft.phase === 'crashed') { this.ageEffects(dt); return; }
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
    const remoteTargets = this.bogeys.filter(b => b.peer && b.health > 0);
    for (const bogey of this.bogeys) {
      if (bogey.health <= 0) continue;
      if (bogey.peer || (this.network && !this.network.authority)) {
        // Dead-reckon between network updates.
        bogey.position.addScaledVector(bogey.velocity, dt);
        continue;
      }
      if (bogey.drone) {
        bogey.velocity.copy(bogey.forward).multiplyScalar(DRONE_SPEED);
        bogey.position.addScaledVector(bogey.velocity, dt);
        bogey.position.y = Math.max(bogey.position.y, terrainHeight(bogey.position.x, bogey.position.z) + 200);
        continue;
      }
      // In network campaigns each bogey engages the nearest player.
      let quarry: Bogey | undefined;
      let quarryPosition = aircraft.position;
      for (const peer of remoteTargets) {
        if (peer.position.distanceToSquared(bogey.position) < quarryPosition.distanceToSquared(bogey.position)) {
          quarry = peer;
          quarryPosition = peer.position;
        }
      }
      const toPlayer = quarryPosition.clone().sub(bogey.position);
      const range = toPlayer.length();
      const pursuit = toPlayer.normalize();
      if (range < 550) {
        pursuit.set(Math.cos(this.time * 0.17 + bogey.id), 0.10 * Math.sin(this.time * 0.4), Math.sin(this.time * 0.17 + bogey.id));
      } else {
        pursuit.x += Math.sin(this.time * 0.22 + bogey.id) * 0.30;
        pursuit.y += clamp((1200 - bogey.position.y) / 3000, -0.2, 0.2);
      }
      bogey.forward.lerp(pursuit.normalize(), dt * 0.45).normalize();
      bogey.velocity.copy(bogey.forward).multiplyScalar(this.bogeySpeed);
      bogey.position.addScaledVector(bogey.velocity, dt);
      const floor = terrainHeight(bogey.position.x, bogey.position.z) + 200;
      if (bogey.position.y < floor) { bogey.position.y = floor; bogey.forward.y = Math.abs(bogey.forward.y) + 0.2; bogey.forward.normalize(); }
      bogey.cooldown -= dt;
      if (bogey.cooldown <= 0 && range < 4500 && range > 500 && bogey.forward.dot(toPlayer) > 0.65) {
        bogey.cooldown = this.scenario === 'furball' ? 17 : this.scenario === 'network' ? 24 : 28;
        const velocity = bogey.velocity.clone().addScaledVector(bogey.forward, 160);
        if (quarry?.peer) this.events.push({ type: 'fire', at: quarry.peer, position: bogey.position.clone(), velocity, damage: HOSTILE_MISSILE_DAMAGE });
        else {
          this.spawn('hostile', bogey.position.clone(), velocity, 15, 0);
          this.notify('Missile warning! Deploy flares and maneuver.', 4);
        }
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
          if (flare) {
            if (!projectile.decoyed) this.missilesDefeated++;
            projectile.decoyed = true;
            destination = flare.position;
          }
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
        const impactPosition = segmentClosestPoint(aircraft.position, start, projectile.position);
        this.missileStrike('player', aircraft.position, aircraft.attitude, impactPosition, projectile.velocity, aircraft.velocity);
        aircraft.health -= projectile.damage ?? HOSTILE_MISSILE_DAMAGE;
        this.lastAttacker = projectile.owner ?? '';
        this.lastAttackMissile = !!projectile.owner;
        projectile.life = 0;
        projectile.target = -1;
        this.explosions.push({
          id: this.nextId++, position: impactPosition, life: MISSILE_BLAST_DURATION,
          duration: MISSILE_BLAST_DURATION, intensity: 1, kind: 'missile',
        });
        this.notify('Impact! Airframe damaged.', 4);
        if (aircraft.health <= 0) {
          const shooter = projectile.owner ? this.bogeys.find(b => b.peer === projectile.owner)?.name : undefined;
          aircraft.crash(shooter ? `Shot down by ${shooter}` : 'Shot down by a hostile missile');
        }
      }
      if (projectile.kind === 'missile' || projectile.kind === 'bullet') {
        for (const bogey of this.bogeys) {
          if (bogey.peer && !this.network?.competitive) continue;
          if (bogey.health > 0 && segmentDistance(bogey.position, start, projectile.position) < (projectile.kind === 'bullet' ? 15 : 30)) {
            if (bogey.peer) {
              // The other player's client resolves missile hits (it may decoy them); cannon hits are reported.
              if (projectile.kind === 'bullet') this.events.push({ type: 'damage', target: bogey.id, amount: PVP_GUN_DAMAGE, missile: false });
              projectile.life = 0;
              break;
            }
            if (projectile.kind === 'missile') {
              const direction = new Vector3(0, 0, -1);
              const attitude = new Quaternion().setFromUnitVectors(direction, bogey.forward);
              const impactPosition = segmentClosestPoint(bogey.position, start, projectile.position);
              this.missileStrike(bogey.id, bogey.position, attitude, impactPosition, projectile.velocity, bogey.velocity);
            }
            if (projectile.kind === 'missile') {
              const impactPosition = segmentClosestPoint(bogey.position, start, projectile.position);
              this.explosions.push({
                id: this.nextId++, position: impactPosition, life: MISSILE_BLAST_DURATION,
                duration: MISSILE_BLAST_DURATION, intensity: 1, kind: 'missile',
              });
            }
            const damage = projectile.kind === 'bullet' ? 20 : 100;
            if (this.network && !this.network.authority) {
              this.events.push({ type: 'damage', target: bogey.id, amount: damage, missile: projectile.kind === 'missile' });
            } else this.hit(bogey, damage, projectile.kind === 'missile');
            projectile.life = 0;
            break;
          }
        }
      }
      if (projectile.position.y < terrainHeight(projectile.position.x, projectile.position.z)) projectile.life = 0;
    }
    for (const projectile of this.projectiles) {
      if (projectile.kind === 'hostile' && projectile.life <= 0 && !projectile.decoyed && projectile.target !== -1) this.missilesDefeated++;
    }
    this.projectiles = this.projectiles.filter(p => p.life > 0);
    this.ageEffects(dt);
  }
}
