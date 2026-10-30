import { Vector3 } from 'three';
import { Aircraft } from './flight';
import { Combat } from './combat';

/** Subset of the webxdc realtime channel API used by network campaigns. */
export interface RealtimeChannel {
  send(data: Uint8Array): void;
  setListener(listener: (data: Uint8Array) => void): void;
  leave(): void;
}
export type CampaignMode = 'cooperative' | 'competitive';
export type PeerStatus = 'briefing' | 'flying' | 'down' | 'solo';
export interface PeerInfo { addr: string; name: string; status: PeerStatus; airframe: string; session: string; lastSeen: number; self?: boolean; host?: boolean }
export interface CampaignSession { id: string; host: string; mode: CampaignMode; bogeys: number; players: string[] }

export const CAMPAIGN_BOGEYS = [0, 1, 3, 6, 10] as const;
/** Co-operative campaigns need at least one computer bogey to fight; zero is competitive-only. */
export function campaignBogeyCount(mode: CampaignMode, bogeys: number): number {
  return mode === 'cooperative' ? Math.max(1, bogeys) : bogeys;
}
/** Shared formation reference: player slots and bogey spawns are laid out around it on every client. */
export const CAMPAIGN_ORIGIN = new Vector3(0, 1100, 3400);
export const PEER_TIMEOUT = 5;
const PRESENCE_INTERVAL = 1;
const STATE_INTERVAL = 0.1;
const LAUNCH_REPEAT = 0.5;
const LAUNCH_WINDOW = 2;
const SLOT_SPACING = 260;
const PEER_ID_BASE = 100000;

type Triple = [number, number, number];
type Message =
  | { t: 'p'; a: string; n: string; s: PeerStatus; af: string; sid: string }
  | { t: 'L'; a: string; sid: string; mode: CampaignMode; bogeys: number; players: string[] }
  | { t: 's'; a: string; sid: string; n: string; af: string; p: Triple; v: Triple; h: number }
  | { t: 'b'; a: string; sid: string; l: [number, number, number, number, number, number, number, number][] }
  | { t: 'f'; a: string; sid: string; at: string; p: Triple; v: Triple; d: number }
  | { t: 'd'; a: string; sid: string; at?: string; target?: number; amt: number; m: boolean }
  | { t: 'k'; a: string; sid: string; to: string; m: boolean }
  | { t: 'x'; a: string; sid: string; by: string; m: boolean }
  | { t: 'q'; a: string; sid: string };

interface WebxdcApi { selfAddr?: string; selfName?: string; joinRealtimeChannel?: () => RealtimeChannel }

/** Joins the webxdc realtime channel when the host supports it; otherwise networking is reported unavailable. */
export function connectWebxdc(): NetworkCampaign {
  const webxdc = (globalThis as { webxdc?: WebxdcApi }).webxdc;
  let channel: RealtimeChannel | null = null;
  try { channel = webxdc?.joinRealtimeChannel?.() ?? null; }
  catch (error: unknown) { console.warn('Webxdc realtime channel unavailable', error); }
  return new NetworkCampaign(channel, { addr: webxdc?.selfAddr ?? 'local', name: webxdc?.selfName ?? 'You' });
}

/** Lateral formation offset (metres) for a player's slot so jets never spawn on top of each other. */
export function slotOffset(index: number): number {
  return index === 0 ? 0 : Math.ceil(index / 2) * SLOT_SPACING * (index % 2 ? 1 : -1);
}

const round = (value: number): number => Math.round(value * 10) / 10;
const triple = (vector: Vector3): Triple => [round(vector.x), round(vector.y), round(vector.z)];
const vector = ([x, y, z]: Triple): Vector3 => new Vector3(x, y, z);

/**
 * Peer-to-peer combat campaign over the webxdc realtime channel.
 * The host launches every peer waiting in the briefing. Each client owns its own aircraft and decides hits on it;
 * the alive player with the lowest address simulates the computer bogeys, and that role migrates if they leave or die.
 */
export class NetworkCampaign {
  readonly peers = new Map<string, PeerInfo>();
  session: CampaignSession | null = null;
  status: PeerStatus = 'briefing';
  airframe = 'fa27';
  onLaunch: ((session: CampaignSession) => void) | null = null;
  private now = 0;
  private sentPresence = -Infinity;
  private sentState = -Infinity;
  private launchedAt = -Infinity;
  private sentLaunch = -Infinity;
  private readonly joined = new Set<string>();
  private readonly peerIds = new Map<string, number>();
  private nextPeerId = PEER_ID_BASE;
  private inbox: Message[] = [];
  private opponentSeen = false;
  private downReported = false;
  private authority = false;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly channel: RealtimeChannel | null, readonly self: { addr: string; name: string }) {
    channel?.setListener(data => this.receive(data));
  }

  get available(): boolean { return !!this.channel; }
  get isAuthority(): boolean { return this.authority; }

  /** Everyone currently connected, including the local player, for the read-only lobby list. */
  peerList(): PeerInfo[] {
    const others = [...this.peers.values()]
      .filter(peer => this.now - peer.lastSeen < PEER_TIMEOUT)
      .sort((a, b) => a.name.localeCompare(b.name));
    const me: PeerInfo = { addr: this.self.addr, name: this.self.name, status: this.status, airframe: this.airframe, session: this.session?.id ?? '', lastSeen: this.now, self: true };
    return [me, ...others].map(peer => ({ ...peer, host: !!this.session && peer.session === this.session.id && peer.addr === this.session.host }));
  }

  /** Host: launch every peer waiting in the briefing into a new campaign. */
  launch(mode: CampaignMode, bogeys: number): CampaignSession {
    const waiting = [...this.peers.values()]
      .filter(peer => peer.status === 'briefing' && this.now - peer.lastSeen < PEER_TIMEOUT)
      .map(peer => peer.addr).sort();
    bogeys = campaignBogeyCount(mode, bogeys);
    const session: CampaignSession = {
      id: `${this.self.addr}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      host: this.self.addr, mode, bogeys, players: [this.self.addr, ...waiting],
    };
    this.join(session);
    this.launchedAt = this.now;
    this.sentLaunch = -Infinity;
    return session;
  }

  /** Index of a player in the launch formation. */
  slot(addr = this.self.addr): number { return Math.max(0, this.session?.players.indexOf(addr) ?? 0); }

  /** Leaves any campaign and the realtime channel when the app closes. */
  dispose(): void {
    this.leave();
    try { this.channel?.leave(); } catch (error: unknown) { console.warn('Unable to leave realtime channel', error); }
  }

  /** Leave the current campaign, e.g. when starting another sortie. */
  leave(): void {
    if (!this.session) return;
    this.send({ t: 'q', a: this.self.addr, sid: this.session.id });
    this.session = null;
    this.authority = false;
  }

  /** Processes received messages and sends presence, state and combat events. Call once per rendered frame. */
  tick(now: number, aircraft: Aircraft, combat: Combat): void {
    this.now = now;
    const inbox = this.inbox;
    this.inbox = [];
    for (const message of inbox) this.handle(message, aircraft, combat);
    if (now - this.sentPresence >= PRESENCE_INTERVAL) {
      this.sentPresence = now;
      this.send({ t: 'p', a: this.self.addr, n: this.self.name, s: this.status, af: this.airframe, sid: this.session?.id ?? '' });
    }
    const session = this.session;
    if (!session || !combat.network) return;
    if (session.host === this.self.addr && now - this.launchedAt < LAUNCH_WINDOW && now - this.sentLaunch >= LAUNCH_REPEAT) {
      this.sentLaunch = now;
      this.send({ t: 'L', a: this.self.addr, sid: session.id, mode: session.mode, bogeys: session.bogeys, players: session.players });
    }
    for (const peer of combat.peers) {
      const info = peer.peer ? this.peers.get(peer.peer) : undefined;
      if (!info || now - info.lastSeen >= PEER_TIMEOUT || info.session !== session.id) combat.removePeer(peer.peer!);
    }
    this.updateAuthority(aircraft, combat);
    for (const event of combat.events) {
      if (event.type === 'fire') {
        this.send({ t: 'f', a: this.self.addr, sid: session.id, at: event.at, p: triple(event.position), v: triple(event.velocity), d: event.damage });
      } else {
        const peer = combat.bogeys.find(bogey => bogey.id === event.target)?.peer;
        this.send({ t: 'd', a: this.self.addr, sid: session.id, ...(peer ? { at: peer } : { target: event.target }), amt: event.amount, m: event.missile });
      }
    }
    combat.events = [];
    if (now - this.sentState >= STATE_INTERVAL) {
      this.sentState = now;
      this.send({ t: 's', a: this.self.addr, sid: session.id, n: this.self.name, af: this.airframe,
        p: triple(aircraft.position), v: triple(aircraft.velocity), h: aircraft.phase === 'crashed' ? 0 : Math.max(0, round(aircraft.health)) });
      if (this.authority) {
        this.send({ t: 'b', a: this.self.addr, sid: session.id, l: combat.bogeys.filter(bogey => !bogey.peer).map(bogey => [
          bogey.id, ...triple(bogey.position), round(bogey.forward.x * 100) / 100, round(bogey.forward.y * 100) / 100, round(bogey.forward.z * 100) / 100, Math.max(0, bogey.health),
        ] as [number, number, number, number, number, number, number, number]) });
      }
    }
    if (aircraft.phase === 'crashed' && !this.downReported) {
      this.downReported = true;
      this.send({ t: 'x', a: this.self.addr, sid: session.id, by: combat.lastAttacker, m: combat.lastAttackMissile });
    }
    this.checkVictory(aircraft, combat, session);
  }

  private join(session: CampaignSession): void {
    this.session = session;
    this.joined.add(session.id);
    this.opponentSeen = false;
    this.downReported = false;
    this.authority = false;
    this.status = 'flying';
  }

  private updateAuthority(aircraft: Aircraft, combat: Combat): void {
    const session = this.session!;
    const candidates = [...this.peers.values()]
      .filter(peer => peer.session === session.id && peer.status === 'flying' && this.now - peer.lastSeen < PEER_TIMEOUT)
      .map(peer => peer.addr);
    if (aircraft.phase !== 'crashed') candidates.push(this.self.addr);
    const authority = candidates.length > 0 && candidates.sort()[0] === this.self.addr;
    if (authority && !this.authority) {
      // Taking over the bogeys: give players a moment before the first new missile.
      for (const bogey of combat.hostiles) bogey.cooldown = Math.max(bogey.cooldown, 6);
    }
    this.authority = authority;
    combat.network!.authority = authority;
  }

  private checkVictory(aircraft: Aircraft, combat: Combat, session: CampaignSession): void {
    if (combat.victory || session.mode !== 'competitive' || aircraft.phase === 'crashed') return;
    const rivals = combat.peers.filter(peer => peer.health > 0);
    // Without a rival in sight, only clearing the computer bogeys wins; with none, wait for opponents to appear.
    if (this.opponentSeen ? rivals.length > 0 : combat.startingBogeys === 0 || combat.hostiles.length > 0) return;
    combat.victory = true;
    combat.notify(this.opponentSeen ? 'LAST PILOT STANDING. You win the campaign!' : 'Airspace clear. You win the campaign. Return to base.', 10);
  }

  private peerId(addr: string): number {
    let id = this.peerIds.get(addr);
    if (id === undefined) { id = this.nextPeerId++; this.peerIds.set(addr, id); }
    return id;
  }

  private peerName(addr: string): string { return this.peers.get(addr)?.name ?? 'another pilot'; }

  private handle(message: Message, aircraft: Aircraft, combat: Combat): void {
    if (message.a === this.self.addr) return;
    const known = this.peers.get(message.a);
    if (message.t === 'p') {
      this.peers.set(message.a, { addr: message.a, name: message.n, status: message.s, airframe: message.af, session: message.sid, lastSeen: this.now });
      return;
    }
    if (message.t === 'L') {
      if (this.joined.has(message.sid) || !message.players.includes(this.self.addr) || this.status !== 'briefing') return;
      const session: CampaignSession = { id: message.sid, host: message.a, mode: message.mode, bogeys: message.bogeys, players: message.players };
      this.join(session);
      this.onLaunch?.(session);
      return;
    }
    const session = this.session;
    if (!session || message.sid !== session.id) return;
    if (known) { known.lastSeen = this.now; known.session = session.id; }
    switch (message.t) {
      case 's': {
        const info = known ?? { addr: message.a, name: message.n, status: 'flying', airframe: message.af, session: session.id, lastSeen: this.now };
        info.name = message.n;
        info.airframe = message.af;
        if (message.h <= 0) info.status = 'down';
        else if (info.status !== 'briefing') info.status = 'flying';
        this.peers.set(message.a, info);
        if (message.h > 0) this.opponentSeen = true;
        const existing = combat.peers.find(peer => peer.peer === message.a);
        if (!existing && message.h <= 0) return;
        combat.syncPeer(message.a, this.peerId(message.a), message.n, message.af, vector(message.p), vector(message.v), message.h);
        return;
      }
      case 'b':
        if (this.authority) return;
        for (const [id, x, y, z, fx, fy, fz, health] of message.l) combat.syncBogey(id, new Vector3(x, y, z), new Vector3(fx, fy, fz), health);
        return;
      case 'f':
        if (message.at === this.self.addr && aircraft.phase !== 'crashed') {
          combat.incomingMissile(vector(message.p), vector(message.v), message.d, combat.peers.some(peer => peer.peer === message.a) ? message.a : undefined);
        }
        return;
      case 'd':
        if (message.at === this.self.addr) combat.applyPlayerDamage(aircraft, message.amt, message.a, this.peerName(message.a));
        else if (message.target !== undefined && this.authority && combat.damageBogey(message.target, message.amt, message.m)) {
          this.send({ t: 'k', a: this.self.addr, sid: session.id, to: message.a, m: message.m });
        }
        return;
      case 'k':
        if (message.to === this.self.addr) combat.creditKill(message.m);
        return;
      case 'x': {
        if (known) known.status = 'down';
        const peer = combat.peers.find(item => item.peer === message.a);
        if (peer && peer.health > 0) combat.syncPeer(message.a, peer.id, peer.name ?? '', peer.airframe ?? 'fa27', peer.position, peer.velocity, 0);
        const name = this.peerName(message.a);
        if (message.by === this.self.addr) combat.creditKill(message.m, `You shot down ${name}.`);
        else combat.notify(message.by ? `${name} was shot down by ${this.peerName(message.by)}.` : `${name} is down.`, 5);
        return;
      }
      case 'q':
        if (known) { known.status = 'briefing'; known.session = ''; }
        combat.removePeer(message.a);
        combat.notify(`${this.peerName(message.a)} left the campaign.`, 4);
        return;
    }
  }

  private send(message: Message): void {
    if (!this.channel) return;
    try { this.channel.send(this.encoder.encode(JSON.stringify(message))); }
    catch (error: unknown) { console.warn('Network campaign message not sent', error); }
  }

  private receive(data: Uint8Array): void {
    try {
      const message = JSON.parse(this.decoder.decode(data)) as Message;
      if (message && typeof message === 'object' && typeof message.t === 'string' && typeof message.a === 'string') this.inbox.push(message);
    } catch (error: unknown) {
      console.warn('Ignoring malformed network campaign message', error);
    }
  }
}
