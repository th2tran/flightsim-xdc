import { describe, expect, it } from 'vitest';
import { Aircraft, STEP } from './flight';
import { Combat } from './combat';
import { CAMPAIGN_ORIGIN, campaignBogeyCount, CampaignMode, CampaignSession, NetworkCampaign, RealtimeChannel, slotOffset } from './network';

/** In-memory realtime bus: every message reaches every other member, like a webxdc realtime channel. */
class Bus {
  private readonly listeners = new Map<object, (data: Uint8Array) => void>();
  connect(): RealtimeChannel {
    const key = {};
    return {
      send: data => { for (const [other, listener] of this.listeners) if (other !== key) listener(data.slice()); },
      setListener: listener => { this.listeners.set(key, listener); },
      leave: () => { this.listeners.delete(key); },
    };
  }
}

interface Pilot { net: NetworkCampaign; plane: Aircraft; combat: Combat; flying: boolean }

function pilot(bus: Bus, addr: string): Pilot {
  const plane = new Aircraft();
  const combat = new Combat();
  const net = new NetworkCampaign(bus.connect(), { addr, name: addr.toUpperCase() });
  const result: Pilot = { net, plane, combat, flying: false };
  net.onLaunch = session => begin(result, session);
  return result;
}

function begin(p: Pilot, session: CampaignSession): void {
  p.plane.reset(false);
  p.plane.position.x += slotOffset(p.net.slot());
  p.combat.reset('network', p.plane, {
    bogeys: session.bogeys, origin: CAMPAIGN_ORIGIN,
    network: { authority: session.host === p.net.self.addr, competitive: session.mode === 'competitive' },
  });
  p.flying = true;
}

class World {
  now = 0;
  constructor(readonly pilots: Pilot[]) {}
  run(seconds: number, each?: (p: Pilot) => void): void {
    const frame = 1 / 60;
    for (let t = 0; t < seconds; t += frame) {
      this.now += frame;
      for (const p of this.pilots) {
        if (p.flying) {
          each?.(p);
          for (let i = 0; i < 2; i++) { p.plane.step(STEP); p.combat.step(STEP, p.plane); }
        }
        p.net.status = p.flying ? (p.plane.phase === 'crashed' ? 'down' : 'flying') : 'briefing';
        p.net.tick(this.now, p.plane, p.combat);
      }
    }
  }
}

function lobby(count: number): World {
  const bus = new Bus();
  const world = new World(Array.from({ length: count }, (_, i) => pilot(bus, `pilot${i}@test`)));
  world.run(1.5);
  return world;
}

function launch(world: World, mode: CampaignMode, bogeys = 3, host = world.pilots[0]): void {
  begin(host, host.net.launch(mode, bogeys));
  world.run(0.5);
}

describe('network campaign', () => {
  it('lists every connected pilot in the lobby', () => {
    const world = lobby(3);
    const list = world.pilots[1].net.peerList();
    expect(list.map(peer => peer.addr)).toEqual(['pilot1@test', 'pilot0@test', 'pilot2@test']);
    expect(list[0].self).toBe(true);
    expect(list.every(peer => peer.status === 'briefing')).toBe(true);
  });

  it('launches every waiting pilot into the same campaign with the host settings', () => {
    const world = lobby(3);
    launch(world, 'cooperative', 6);
    const ids = world.pilots.map(p => p.net.session?.id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
    for (const p of world.pilots) {
      expect(p.flying).toBe(true);
      expect(p.combat.hostiles.length).toBe(6);
      expect(p.combat.network?.competitive).toBe(false);
    }
    const xs = world.pilots.map(p => Math.round(p.plane.position.x));
    expect(new Set(xs).size).toBe(3);
    world.run(1);
    expect(world.pilots[0].combat.peers.map(peer => peer.name).sort()).toEqual(['PILOT1@TEST', 'PILOT2@TEST']);
  });

  it('gives the lowest live address the computer bogeys and mirrors them elsewhere', () => {
    const world = lobby(2);
    launch(world, 'cooperative', 3, world.pilots[1]);
    world.run(1);
    const [a, b] = world.pilots;
    expect(a.net.isAuthority).toBe(true);
    expect(b.net.isAuthority).toBe(false);
    const bogeyA = a.combat.hostiles[0];
    const bogeyB = b.combat.hostiles.find(bogey => bogey.id === bogeyA.id)!;
    expect(bogeyB.position.distanceTo(bogeyA.position)).toBeLessThan(80);

    a.plane.crash('Test');
    world.run(1);
    expect(b.net.isAuthority).toBe(true);
  });

  it('keeps co-operative wingmen out of the target cycle', () => {
    const world = lobby(2);
    launch(world, 'cooperative');
    world.run(1);
    const combat = world.pilots[0].combat;
    expect(combat.peers.length).toBe(1);
    for (let i = 0; i < 6; i++) {
      combat.cycleTarget();
      expect(combat.target?.peer).toBeUndefined();
    }
  });

  it('lets competitive pilots target and damage each other, crediting the kill', () => {
    const world = lobby(2);
    launch(world, 'competitive');
    world.run(1);
    const [a, b] = world.pilots;
    const peer = a.combat.peers[0];
    a.combat.selected = peer.id;
    expect(a.combat.target?.peer).toBe('pilot1@test');

    // Pilot 0 reports cannon hits on pilot 1, which resolves them on its own aircraft.
    const kills = a.combat.kills;
    for (let i = 0; i < 20 && b.plane.phase !== 'crashed'; i++) {
      a.combat.events.push({ type: 'damage', target: peer.id, amount: 10, missile: false });
      world.run(0.1);
    }
    expect(b.plane.phase).toBe('crashed');
    expect(b.plane.crashReason).toContain('PILOT0@TEST');
    world.run(1);
    expect(a.combat.kills).toBe(kills + 1);
  });

  it('declares the last pilot standing the competitive winner', () => {
    const world = lobby(2);
    launch(world, 'competitive');
    world.run(1);
    const [a, b] = world.pilots;
    expect(a.combat.victory).toBe(false);
    b.plane.crash('Test');
    world.run(1);
    expect(a.combat.victory).toBe(true);
    expect(a.combat.complete).toBe(true);
    expect(b.combat.victory).toBe(false);
  });

  it('routes damage on computer bogeys through the authority and credits the shooter', () => {
    const world = lobby(2);
    launch(world, 'cooperative');
    world.run(1);
    const [a, b] = world.pilots;
    const id = a.combat.hostiles[0].id;
    b.combat.events.push({ type: 'damage', target: id, amount: 500, missile: true });
    world.run(0.5);
    expect(a.combat.bogeys.find(bogey => bogey.id === id)!.health).toBeLessThanOrEqual(0);
    expect(b.combat.kills).toBe(1);
    expect(b.combat.missileKills).toBe(1);
    expect(b.combat.hostiles.some(bogey => bogey.id === id)).toBe(false);
  });

  it('supports one computer bogey, and zero only in competitive mode', () => {
    expect(campaignBogeyCount('cooperative', 0)).toBe(1);
    expect(campaignBogeyCount('competitive', 0)).toBe(0);
    const coop = lobby(2);
    launch(coop, 'cooperative', 0);
    expect(coop.pilots.map(p => p.combat.hostiles.length)).toEqual([1, 1]);

    const duel = lobby(2);
    launch(duel, 'competitive', 0, duel.pilots[0]);
    duel.run(2);
    expect(duel.pilots.some(p => p.combat.victory)).toBe(false);
    duel.pilots[1].plane.crash('Test');
    duel.run(1);
    expect(duel.pilots[0].combat.victory).toBe(true);

    const single = lobby(2);
    launch(single, 'cooperative', 1);
    expect(single.pilots.map(p => p.combat.hostiles.length)).toEqual([1, 1]);
  });

  it('does not award a solo zero-bogey competitive campaign', () => {
    const world = lobby(1);
    launch(world, 'competitive', 0);
    world.run(2);
    expect(world.pilots[0].combat.victory).toBe(false);
  });

  it('ignores launches for pilots already flying', () => {
    const world = lobby(2);
    const [a, b] = world.pilots;
    b.flying = true;
    world.run(1.2);
    begin(a, a.net.launch('cooperative', 3));
    world.run(0.5);
    expect(b.net.session).toBeNull();
  });
});
