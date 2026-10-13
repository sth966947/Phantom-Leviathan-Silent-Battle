// Simulation core: game state and a fixed one-second tick. No DOM or PixiJS,
// so it is deterministic for a given seed and testable in Node.
// Units: positions in nautical miles (x east, y north), time in game seconds,
// speeds in knots, bearings in degrees true (clockwise from north).

import { angDiff, approach, brg, clamp, D2R, dist, fmtBrg, fmtRng, gauss, KT, mulberry32, norm, offset, type Vec } from './math';
import { CLASSES, LIBRARY, type ClassCard } from './classes';
import { matchClasses, signatureView, type Match, type SignatureView } from './signature';

export type Side = 'us' | 'allied' | 'enemy';
export type Depth = 0 | 1 | 2;
export type ScenarioKey = 'bismarck' | 'duel';
export type EventKind = 'info' | 'contact' | 'danger' | 'good' | 'warn';
export type Sound = 'ping' | 'ping-echo' | 'contact' | 'launch' | 'missile' | 'alarm' | 'boom';
export type WeaponKey = 'mk48' | 'ugst' | 'harpoon' | 'mst';

export interface GameEvent { t: number; kind: EventKind; text: string; sound?: Sound }

/** Periscope depth, 150 ft (above the layer), 700 ft (below it). */
export const DEPTH_FT = [60, 150, 700] as const;
const LAYER_AT = 1.5; // depthT above this is below the layer

export interface Knowledge extends Vec { t: number; deep: boolean; exact?: boolean }
export interface AI {
  mode: 'patrol' | 'attack' | 'evade' | 'transit' | 'station' | 'alert';
  legT: number; holdT: number; knows: Knowledge | null; cool: number; evadeT: number;
  threat: Weapon | null; snapTaken: boolean; decoys: number;
  baseCourse: number; zig: number; cruise: number;
  leader?: number; rel?: number; rng?: number; alertT: number; fleeHdg: number;
}

export interface Vessel extends Vec {
  id: number; name: string; cls: ClassCard; side: Side;
  hdg: number; ordHdg: number; spd: number; ordSpd: number;
  depthT: number; ordDepth: Depth; hp: number; alive: boolean;
  track: Vec[]; ai: AI | null;
}

export interface OwnBoat extends Vessel { tubes: number[]; vls: number[]; decoys: number; arrayStableAt: number }

export interface Decoy extends Vec { id: number; side: Side; life: number; deep: boolean }

export interface Weapon extends Vec {
  id: number; type: WeaponKey; side: Side; label: string;
  hdg: number; ordHdg: number; spd: number;
  run: number; maxRun: number; enableAt: number; enabled: boolean;
  deep: boolean; wire: boolean; aim: Vec; contactId: number | null;
  target: Vessel | Decoy | null; targetKind?: 'vessel' | 'decoy';
  rolled: Set<number>; trail: Vec[];
  dead?: boolean; deadAt?: number; heardBrg?: number | null;
}

export interface Contact {
  id: number; vid: number; name: string;
  held: boolean; ever: boolean; lastSeen: number; se: number; seAvg: number;
  bearing: number | null; q: number; bias: number;
  est: (Vec & { t: number }) | null; estErr: number; legHdg: number;
  history: { t: number; b: number }[]; cavitating: boolean;
  sig: SignatureView | null; matches: Match[]; classified: string | null; sighted: string | null;
}

export interface WaterfallRow { row: Float32Array; baffle: Uint8Array; t: number }

export interface Game {
  scenario: ScenarioKey; era: '1941' | '2029'; startClock: number; timeLimit: number;
  t: number; r: () => number; seq: number;
  over: { win: boolean; t: number; reason: string } | null;
  own: OwnBoat; vessels: Vessel[]; contacts: Contact[]; selected: number | null;
  weapons: Weapon[]; decoys: Decoy[]; heard: Set<number>;
  events: GameEvent[]; waterfall: WaterfallRow | null; wfTimer: number;
  pings: { t: number }[]; blasts: (Vec & { t: number; missile: boolean })[];
  stats: { fired: Record<WeaponKey, number>; enemyFired: number; pings: number; hits: number; blueOnBlue: number };
}

// ---- Weapons ------------------------------------------------------------------------
// Early versions have unlimited weapons (Scott's call); only tube reloads limit firing.
export const WEAPONS: Record<WeaponKey, {
  name: string; short: string; spd: number; maxRun: number; seeker: number; damage: number; missile: boolean;
}> = {
  mk48: { name: 'Mk 48 ADCAP Mod 7', short: 'Mk 48', spd: 55, maxRun: 22, seeker: 2.5, damage: 5, missile: false },
  ugst: { name: 'UGST Fizik-1', short: 'UGST', spd: 50, maxRun: 13, seeker: 2.2, damage: 5, missile: false },
  harpoon: { name: 'UGM-84 Harpoon Block II', short: 'Harpoon', spd: 470, maxRun: 67, seeker: 10, damage: 2, missile: true },
  mst: { name: 'Maritime Strike Tomahawk', short: 'MST', spd: 480, maxRun: 900, seeker: 12, damage: 3, missile: true },
};
const TUBE_RELOAD = 120;
const VLS_RELOAD = 600;
const MISSILE_MAX_DEPTH = 1.05; // missiles launch from 150 ft or shallower
const VISUAL_RANGE = 8;         // nm, through May snow squalls in the Denmark Strait

// ---- Acoustics ---------------------------------------------------------------------
const SL_TORPEDO = 140;
const SL_DECOY = 128;
const SL_LAUNCH = 128;
const LAYER_LOSS = 9;
export const BAFFLE_HALF = 30;
export const ARRAY = { name: 'TB-34 towed array', gain: 3, maxSpd: 12, settle: 90 };
export const WF_BINS = 180;

export const vesselSL = (v: Vessel) => v.cls.slBase + 1.5 * v.spd;
export const selfNoise = (spd: number) => 70 + Math.max(0, spd - 5) * 1.2;
const deepOf = (o: { depthT?: number; deep?: boolean }) => (o.depthT !== undefined ? o.depthT > LAYER_AT : !!o.deep);
export const inBaffles = (lis: { hdg: number }, bearing: number) => Math.abs(angDiff(bearing, lis.hdg + 180)) < BAFFLE_HALF;

/** Towed array works when slow and straight; it removes the stern blind spot and adds gain. */
export const arrayActive = (g: Game) => g.own.spd <= ARRAY.maxSpd && g.t >= g.own.arrayStableAt;

type Listener = Vec & { hdg: number; spd: number; depthT: number; array?: boolean };

/** Passive sonar equation, simplified. Positive means detectable. */
export function excess(sl: number, src: Vec & { depthT?: number; deep?: boolean }, lis: Listener, threshold: number): number {
  const r = dist(src, lis);
  const b = brg(lis, src);
  if (!lis.array && inBaffles(lis, b)) return -99;
  const layer = deepOf(src) !== deepOf(lis) ? LAYER_LOSS : 0;
  return sl - 20 * Math.log10(Math.max(r, 0.05)) - selfNoise(lis.spd) - layer - threshold + (lis.array ? ARRAY.gain : 0);
}
const ownEars = (g: Game): Listener => ({ x: g.own.x, y: g.own.y, hdg: g.own.hdg, spd: g.own.spd, depthT: g.own.depthT, array: arrayActive(g) });

// ---- Setup ---------------------------------------------------------------------------
function makeVessel(g: Game, cls: string, name: string, side: Side, p: Vec, hdg: number, spd: number, depth: Depth): Vessel {
  const c = CLASSES[cls];
  return {
    id: g.seq++, name, cls: c, side, x: p.x, y: p.y, hdg, ordHdg: hdg, spd, ordSpd: spd,
    depthT: c.kind === 'surface' ? 0 : depth, ordDepth: c.kind === 'surface' ? 0 : depth,
    hp: c.hp, alive: true, track: [], ai: null,
  };
}

function makeAI(over: Partial<AI>): AI {
  return {
    mode: 'patrol', legT: 300, holdT: 0, knows: null, cool: 0, evadeT: 0, threat: null, snapTaken: false,
    decoys: 0, baseCourse: 0, zig: 0, cruise: 0, alertT: 0, fleeHdg: 0, ...over,
  };
}

export const SCENARIOS: Record<ScenarioKey, { title: string; era: '1941' | '2029'; place: string }> = {
  bismarck: { title: 'Sink the Bismarck', era: '1941', place: 'Denmark Strait, 24 May 1941' },
  duel: { title: 'Duel: Kazan', era: '2029', place: 'Bear Gap, Norwegian Sea, March 2029' },
};

export function create(scenario: ScenarioKey = 'bismarck', seed?: number): Game {
  const r = mulberry32(seed ?? (Date.now() & 0xffffffff));
  const g = {
    scenario, era: SCENARIOS[scenario].era, startClock: 0, timeLimit: Infinity,
    t: 0, r, seq: 1, over: null, vessels: [], contacts: [], selected: null,
    weapons: [], decoys: [], heard: new Set(), events: [], waterfall: null, wfTimer: 0, pings: [], blasts: [],
    stats: { fired: { mk48: 0, ugst: 0, harpoon: 0, mst: 0 }, enemyFired: 0, pings: 0, hits: 0, blueOnBlue: 0 },
  } as unknown as Game;

  const ownV = makeVessel(g, 'virginia', 'USS Tang (SSN-805)', 'us', { x: 0, y: 0 }, 0, 5, 1);
  g.own = Object.assign(ownV, { tubes: [0, 0, 0, 0], vls: Array(12).fill(0), decoys: 4, arrayStableAt: 0 });
  g.vessels.push(g.own);

  if (scenario === 'bismarck') {
    // 0300 on 24 May 1941. The German group runs southwest down the Denmark Strait
    // at 27 kt with Suffolk and Norfolk shadowing well astern. Tang lies ahead of them.
    g.startClock = 3 * 3600;
    g.timeLimit = 5 * 3600;
    const course = 205 + (r() * 2 - 1) * 10;
    const lateral = (r() * 2 - 1) * 9;
    const pass = offset(g.own, course + 90, lateral);
    const bPos = offset(pass, course + 180, 38 + r() * 6);
    g.own.hdg = g.own.ordHdg = norm(course + 180 + 30);
    const bis = makeVessel(g, 'bismarck', 'Bismarck', 'enemy', bPos, course, 27, 0);
    bis.ai = makeAI({ mode: 'transit', baseCourse: course, cruise: 27, legT: 400 + r() * 400 });
    const pe = makeVessel(g, 'hipper', 'Prinz Eugen', 'enemy', offset(bPos, course, 1.5), course, 27, 0);
    pe.ai = makeAI({ mode: 'station', leader: bis.id, rel: 0, rng: 1.5 });
    const suf = makeVessel(g, 'county', 'HMS Suffolk', 'allied', offset(bPos, course + 165, 13), course, 27, 0);
    suf.ai = makeAI({ mode: 'station', leader: bis.id, rel: 165, rng: 13 });
    const nor = makeVessel(g, 'county', 'HMS Norfolk', 'allied', offset(bPos, course + 200, 15), course, 27, 0);
    nor.ai = makeAI({ mode: 'station', leader: bis.id, rel: 200, rng: 15 });
    g.vessels.push(bis, pe, suf, nor);
  } else {
    g.startClock = 2 * 3600;
    const startBrg = r() * 360;
    const p = offset(g.own, startBrg, 11 + r() * 3);
    const kaz = makeVessel(g, 'yasen', 'Kazan (K-561)', 'enemy', p, norm(startBrg + 180 + (r() * 2 - 1) * 60), 7, r() < 0.5 ? 2 : 1);
    kaz.ai = makeAI({ mode: 'patrol', legT: 300 + r() * 300, decoys: 2 });
    g.vessels.push(kaz);
  }
  return g;
}

function log(g: Game, kind: EventKind, text: string, sound?: Sound) { g.events.push({ t: g.t, kind, text, sound }); }
const vesselById = (g: Game, id: number) => g.vessels.find((v) => v.id === id)!;
export const contactById = (g: Game, id: number | null) => (id === null ? null : g.contacts.find((c) => c.id === id) ?? null);
/** What the player calls a contact: its accepted class if classified, else its sonar designation. */
export const contactLabel = (c: Contact) => (c.classified ? `${c.name} · ${CLASSES[c.classified].name}` : c.name);
export const isFriendlyClass = (key: string | null) => !!key && (CLASSES[key].nation === 'UK' || CLASSES[key].nation === 'US');

// ---- Movement -------------------------------------------------------------------------
function moveVessel(v: Vessel, dt: number) {
  const rate = (v.cls.kind === 'surface' ? 0.4 : 0.6) + v.spd * 0.08;
  const turn = clamp(angDiff(v.ordHdg, v.hdg), -rate * dt, rate * dt);
  v.hdg = norm(v.hdg + turn);
  const cap = v.cls.maxSpd * (0.35 + 0.65 * Math.max(0, v.hp) / v.cls.hp); // damage slows a ship
  v.spd = approach(v.spd, Math.min(v.ordSpd, cap), (v.ordSpd > v.spd ? 0.12 : 0.25) * dt);
  if (v.cls.kind === 'sub') v.depthT = approach(v.depthT, v.ordDepth, dt / 40);
  v.x += Math.sin(v.hdg * D2R) * v.spd * KT * dt;
  v.y += Math.cos(v.hdg * D2R) * v.spd * KT * dt;
  return Math.abs(turn) / dt;
}

// ---- Player orders ----------------------------------------------------------------------
function targetContact(g: Game): Contact | null {
  const sel = contactById(g, g.selected);
  if (sel?.est) return sel;
  return g.contacts.find((c) => c.held && c.est) ?? null;
}

export const orders = {
  heading(g: Game, hdg: number) { g.own.ordHdg = norm(Math.round(hdg)); },
  turn(g: Game, delta: number) { g.own.ordHdg = norm(Math.round(g.own.ordHdg + delta)); },
  speed(g: Game, kts: number) { g.own.ordSpd = clamp(kts, 0, g.own.cls.maxSpd); },
  depth(g: Game, d: Depth) {
    if (g.own.ordDepth === d) return;
    g.own.ordDepth = d;
    log(g, 'info', [
      'Making periscope depth, 60 feet. Periscope and masts will be up.',
      'Making depth 150 feet, above the layer.',
      'Making depth 700 feet, going below the layer.',
    ][d]);
  },
  layer(g: Game) { orders.depth(g, g.own.ordDepth === 2 ? 1 : 2); },
  select(g: Game, contactId: number | null) { g.selected = contactId; },
  cycleContact(g: Game) {
    const list = g.contacts.filter((c) => c.ever && vesselById(g, c.vid).alive);
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === g.selected);
    g.selected = list[(i + 1) % list.length].id;
  },
  classify(g: Game, contactId: number, key: string) {
    const c = contactById(g, contactId);
    if (!c) return;
    c.classified = key;
    const cl = CLASSES[key];
    log(g, isFriendlyClass(key) ? 'good' : 'contact', `${c.name} classified ${cl.name}, ${cl.type}${isFriendlyClass(key) ? '. Friendly, do not fire.' : '.'}`);
  },
  fire(g: Game, type: 'mk48' | 'harpoon' | 'mst') {
    const o = g.own;
    if (g.over) return;
    const w = WEAPONS[type];
    if (w.missile && o.depthT > MISSILE_MAX_DEPTH) return log(g, 'warn', `${w.short}: come up to 150 feet or shallower to launch.`);
    const bank = type === 'mst' ? o.vls : o.tubes;
    const tube = bank.findIndex((x) => x <= 0);
    if (tube < 0) return log(g, 'warn', type === 'mst' ? 'All vertical launch tubes reloading.' : 'All torpedo tubes reloading.');
    const c = targetContact(g);
    if (w.missile && !c) return log(g, 'warn', `${w.short}: no contact to target. Select a contact with a solution first.`);
    const aim = c?.est ? { x: c.est.x, y: c.est.y } : offset(o, o.hdg, 8);
    const hdg = brg(o, aim);
    bank[tube] = type === 'mst' ? VLS_RELOAD : TUBE_RELOAD;
    g.stats.fired[type]++;
    const label = `${w.short} ${g.stats.fired[type]}`;
    g.weapons.push({
      id: g.seq++, type, side: 'us', label, x: o.x, y: o.y, hdg, ordHdg: hdg, spd: w.spd,
      run: 0, maxRun: w.maxRun, enableAt: w.missile ? Math.max(1, dist(o, aim) - 8) : 1, enabled: false,
      deep: o.depthT > LAYER_AT, wire: !w.missile, aim, contactId: c?.id ?? null,
      target: null, rolled: new Set(), trail: [],
    });
    const at = c ? ` at ${contactLabel(c)}` : '';
    const from = type === 'mst' ? `VLS tube ${tube + 1}` : `Tube ${tube + 1}`;
    log(g, 'good', `${from} fired. ${label}${at}, bearing ${fmtBrg(hdg)}${w.missile ? ', range ' + fmtRng(dist(o, aim)) + '.' : '. Wire guidance active.'}`, w.missile ? 'missile' : 'launch');
    transient(g, o, 'us');
  },
  ping(g: Game) {
    const o = g.own;
    if (g.over) return;
    g.stats.pings++;
    g.pings.push({ t: g.t });
    let returns = 0;
    for (const v of g.vessels) {
      if (v === o || !v.alive) continue;
      const r = dist(o, v), b = brg(o, v);
      const layer = deepOf(o) !== deepOf(v) ? 10 : 0;
      const size = v.cls.kind === 'surface' ? 8 : 0; // big steel hulls echo well
      const echo = 47 + size - 40 * Math.log10(Math.max(r, 0.1)) - layer - (inBaffles(o, b) ? 99 : 0);
      if (echo > 0) {
        returns++;
        const c = contactFor(g, v);
        if (!c.held) c.legHdg = o.hdg;
        c.held = true; c.ever = true; c.lastSeen = g.t; c.q = 1; c.bias = 0; c.bearing = b;
        c.est = { x: v.x, y: v.y, t: g.t }; c.estErr = 0;
        log(g, 'contact', `Ping return: ${contactLabel(c)} bearing ${fmtBrg(b)}, range ${fmtRng(r)}.`);
      }
      // Anyone with sonar within 60 nm hears the ping and knows where it came from.
      if (v.ai && v.cls.threshold !== null && r < 60) {
        v.ai.knows = { x: o.x, y: o.y, t: g.t, deep: o.depthT > LAYER_AT, exact: true };
        v.ai.holdT = Math.max(v.ai.holdT, 120);
        if (v.ai.mode === 'patrol') v.ai.mode = 'attack';
      }
    }
    log(g, returns ? 'contact' : 'info', returns ? `Active ping: ${returns} return${returns > 1 ? 's' : ''}.` : 'Active ping: no return.', returns ? 'ping-echo' : 'ping');
  },
  decoy(g: Game) {
    const o = g.own;
    if (g.over) return;
    if (o.decoys <= 0) return log(g, 'warn', 'No countermeasures remaining.');
    o.decoys--;
    g.decoys.push({ id: g.seq++, side: 'us', x: o.x, y: o.y, life: 240, deep: o.depthT > LAYER_AT });
    log(g, 'good', `ADC Mk 5 countermeasure launched. ${o.decoys} left.`);
  },
};

function contactFor(g: Game, v: Vessel): Contact {
  let c = g.contacts.find((x) => x.vid === v.id);
  if (!c) {
    c = {
      id: g.seq++, vid: v.id, name: `Sierra ${g.contacts.length + 1}`, held: false, ever: false, lastSeen: -1e9, se: -99, seAvg: -10,
      bearing: null, q: 0, bias: 0, est: null, estErr: 0, legHdg: 0, history: [], cavitating: false,
      sig: null, matches: [], classified: null, sighted: null,
    };
    g.contacts.push(c);
    if (g.selected === null) g.selected = c.id;
  }
  return c;
}

/** A launch makes a loud transient that anyone with sonar may hear. */
function transient(g: Game, src: Vessel, side: Side) {
  if (side === 'us') {
    for (const v of g.vessels) {
      if (v === g.own || !v.alive || !v.ai || v.cls.threshold === null) continue;
      if (excess(SL_LAUNCH, src, v, v.cls.threshold) > 0) {
        v.ai.knows = { x: src.x + gauss(g.r) * 0.8, y: src.y + gauss(g.r) * 0.8, t: g.t, deep: src.depthT > LAYER_AT };
        if (v.ai.mode === 'patrol') v.ai.mode = 'attack';
      }
    }
  } else if (excess(SL_LAUNCH, src, ownEars(g), g.own.cls.threshold!) > 0) {
    log(g, 'danger', `Launch transient, bearing ${fmtBrg(brg(g.own, src))}!`, 'alarm');
  }
}

function enemyFire(g: Game, v: Vessel, aim: Vec, deep: boolean, snap: boolean) {
  const w = WEAPONS.ugst;
  const hdg = brg(v, aim);
  v.ai!.cool = 300;
  g.stats.enemyFired++;
  g.weapons.push({
    id: g.seq++, type: 'ugst', side: 'enemy', label: w.short, x: v.x, y: v.y, hdg, ordHdg: hdg, spd: w.spd,
    run: 0, maxRun: w.maxRun, enableAt: snap ? 0.5 : 1, enabled: false, deep, wire: false, aim, contactId: null,
    target: null, rolled: new Set(), trail: [],
  });
  transient(g, v, 'enemy');
}

// ---- Weapons in flight -------------------------------------------------------------------
function updateWeapon(g: Game, w: Weapon, dt: number) {
  const spec = WEAPONS[w.type];
  w.run += w.spd * KT * dt;
  if (!w.enabled && w.run >= w.enableAt) w.enabled = true;

  // Wire: steer own torpedoes toward the current solution until they acquire.
  if (w.wire) {
    const c = contactById(g, w.contactId);
    if (dist(w, g.own) > 16 || g.own.spd > 24) {
      w.wire = false;
      log(g, 'warn', `${w.label}: wire parted. Torpedo running on its own.`);
    } else if (!w.target && c?.est) {
      w.aim = { x: c.est.x, y: c.est.y };
      if (dist(w, w.aim) > 0.4) w.ordHdg = brg(w, w.aim);
    }
  }

  // Maritime Strike Tomahawk takes datalink updates of the target position in flight.
  if (w.type === 'mst' && !w.enabled) {
    const c = contactById(g, w.contactId);
    if (c?.held && c.est) { w.aim = { x: c.est.x, y: c.est.y }; w.enableAt = w.run + Math.max(0, dist(w, w.aim) - 8); }
    w.ordHdg = brg(w, w.aim);
  }

  if (w.enabled) {
    if (w.target) {
      const tgt = w.target;
      const gone = w.targetKind === 'decoy' ? !g.decoys.includes(tgt as Decoy) : !(tgt as Vessel).alive;
      const r = dist(w, tgt);
      const lose = spec.missile ? r > spec.seeker * 1.5 : r > 3;
      if (gone || lose || Math.abs(angDiff(brg(w, tgt), w.hdg)) > 70) {
        w.target = null;
        if (w.side === 'us' && (w.wire || spec.missile)) log(g, 'warn', `${w.label}: lost the target, searching.`);
      } else {
        w.ordHdg = brg(w, tgt);
        if (!spec.missile) w.deep = deepOf(tgt);
        if (r < (spec.missile ? 0.25 : 0.06)) {
          if (w.targetKind === 'vessel') return hit(g, w, tgt as Vessel);
          w.rolled.add((tgt as Decoy).id);
          w.target = null;
        }
      }
    }
    if (!w.target || w.targetKind === 'vessel') seek(g, w);
  }

  const rate = spec.missile ? 6 : 14;
  w.hdg = norm(w.hdg + clamp(angDiff(w.ordHdg, w.hdg), -rate * dt, rate * dt));
  w.x += Math.sin(w.hdg * D2R) * w.spd * KT * dt;
  w.y += Math.cos(w.hdg * D2R) * w.spd * KT * dt;
  if (g.t % (spec.missile ? 1 : 4) === 0) { w.trail.push({ x: w.x, y: w.y }); if (w.trail.length > 90) w.trail.shift(); }
  // Missiles that find nothing past their aim point destroy themselves.
  const overrun = spec.missile && w.enabled && !w.target && w.run > w.enableAt + 8 + spec.seeker;
  if (w.run >= w.maxRun || overrun) {
    w.dead = true;
    if (w.side === 'us') log(g, 'warn', spec.missile ? `${w.label} found no target and self-destructed.` : `${w.label} ran out of fuel and shut down.`);
    else if (g.heard.has(w.id)) log(g, 'good', 'Enemy torpedo has run out of fuel.');
  }
}

function seek(g: Game, w: Weapon) {
  const spec = WEAPONS[w.type];
  const inCone = (obj: Vec, range: number) => dist(w, obj) < range && Math.abs(angDiff(brg(w, obj), w.hdg)) < 30;
  if (!spec.missile) {
    for (const d of g.decoys) {
      if (d.side === w.side || w.rolled.has(d.id) || !inCone(d, spec.seeker)) continue;
      w.rolled.add(d.id);
      if (g.r() < (w.target ? 0.45 : 0.65)) {
        w.target = d; w.targetKind = 'decoy';
        if (w.side === 'us' && w.wire) log(g, 'warn', `${w.label} is chasing a countermeasure.`);
        return;
      }
    }
  }
  if (w.target) return;
  // Seekers cannot tell friend from foe: anything in the cone except the shooter's own side.
  let best: Vessel | null = null;
  for (const v of g.vessels) {
    if (!v.alive) continue;
    if (w.side === 'us' ? v.side === 'us' : v.side !== 'us') continue;
    if (spec.missile && v.cls.kind !== 'surface') continue;
    const acq = !spec.missile && deepOf(v) !== w.deep ? spec.seeker / 2 : spec.seeker;
    // Torpedoes take the nearest return; anti-ship missiles take the ship nearest their aim point.
    const score = (x: Vessel) => (spec.missile ? dist(x, w.aim) : dist(w, x));
    if (inCone(v, acq) && (!best || score(v) < score(best))) best = v;
  }
  if (!best) return;
  w.target = best; w.targetKind = 'vessel';
  if (w.side === 'us') { if (w.wire || spec.missile) log(g, 'good', `${w.label} has acquired a target.`); }
  else log(g, 'danger', 'Torpedo seeker has acquired us! Evade!', 'alarm');
}

function hit(g: Game, w: Weapon, v: Vessel) {
  const spec = WEAPONS[w.type];
  w.dead = true;
  v.hp -= spec.damage;
  g.blasts.push({ x: v.x, y: v.y, t: g.t, missile: spec.missile });
  if (v.side === 'us') {
    if (v.hp <= 0) { v.alive = false; log(g, 'danger', 'Torpedo hit. Flooding aft. We are lost.', 'boom'); return end(g, false, 'USS Tang was sunk.'); }
    return log(g, 'danger', 'Torpedo hit! Flooding, but holding.', 'boom');
  }
  if (w.side === 'us') g.stats.hits++;
  const sunk = v.hp <= 0;
  if (sunk) v.alive = false;
  const c = g.contacts.find((x) => x.vid === v.id);
  const who = c ? contactLabel(c) : 'an unseen ship';
  if (v.side === 'allied') {
    g.stats.blueOnBlue++;
    log(g, 'danger', `${w.label} hit ${v.name}! That's a British cruiser.${sunk ? ` ${v.name} is sinking.` : ''}`, 'boom');
    if (sunk) return end(g, false, `${v.name} was sunk by our own weapon.`);
  } else {
    log(g, 'good', sunk ? `${w.label} hit ${who}. Breaking-up noises: ${v.name} is sinking.` : `${w.label} hit ${who}. Secondary explosions; she is slowing.`, 'boom');
  }
  // The whole group knows it is under attack and runs from the threat.
  alertGroup(g, norm(brg(w, v)), v.side);
  if (g.scenario === 'bismarck' && !g.vessels[1].alive) end(g, true, 'Bismarck has been sunk.');
  if (g.scenario === 'duel' && !g.vessels[1].alive) end(g, true, 'Kazan has been sunk.');
}

function end(g: Game, win: boolean, reason: string) { if (!g.over) g.over = { win, t: g.t, reason }; }

function alertGroup(g: Game, fleeHdg: number, side: Side) {
  for (const v of g.vessels) {
    if (!v.ai || !v.alive || v.side !== side || v.cls.kind !== 'surface') continue;
    if (v.ai.mode !== 'transit' && v.ai.mode !== 'alert') continue;
    // Turn away from the threat, but keep running for the open Atlantic.
    const threatBrg = norm(fleeHdg + 180);
    v.ai.mode = 'alert'; v.ai.alertT = 1800;
    v.ai.fleeHdg = norm(v.ai.baseCourse + (angDiff(threatBrg, v.ai.baseCourse) > 0 ? -50 : 50));
  }
}

// ---- Own sensors -----------------------------------------------------------------------------
function ownSensors(g: Game, dt: number) {
  const o = g.own;
  const ears = ownEars(g);
  const atPD = o.depthT < 0.3;
  for (const v of g.vessels) {
    if (v === o) continue;
    const exists = g.contacts.find((x) => x.vid === v.id);
    if (!v.alive) { if (exists) exists.held = false; continue; }
    const se = excess(vesselSL(v), v, ears, o.cls.threshold!) + gauss(g.r) * 2;
    const r = dist(o, v);
    const seen = atPD && v.cls.kind === 'surface' && r < VISUAL_RANGE;
    if (se <= 0 && !seen && !exists) continue;
    const c = contactFor(g, v);
    c.se = se;
    c.seAvg += (se - c.seAvg) * 0.05; // the display integrates over about a minute
    if (se > 0 || seen) {
      const sd = seen ? 0.2 : clamp(3 - se * 0.25, 0.4, 3);
      const meas = norm(brg(o, v) + gauss(g.r) * sd);
      if (!c.held) {
        c.held = true;
        c.legHdg = o.hdg;
        if (c.q < 0.5) c.bias = (g.r() * 2 - 1) * 0.6;
        log(g, 'contact', `Conn, sonar: ${c.ever ? 'regained' : 'new contact'} ${contactLabel(c)}, bearing ${fmtBrg(meas)}.`, c.ever ? undefined : 'contact');
        c.ever = true;
      }
      c.lastSeen = g.t;
      c.bearing = c.bearing === null ? meas : norm(c.bearing + angDiff(meas, c.bearing) * 0.3);
      c.q = Math.min(0.97, c.q + dt / 600);
      if (Math.abs(angDiff(o.hdg, c.legHdg)) > 40) {
        c.legHdg = o.hdg;
        if (c.q < 0.95) {
          c.q = Math.min(0.97, c.q + 0.25);
          log(g, 'info', `New leg: solution on ${contactLabel(c)} improving (${Math.round(c.q * 100)}%).`);
        }
      }
      if (seen) {
        // Periscope with laser rangefinder: exact fix, and the class by sight.
        if (!c.sighted) log(g, 'contact', `Periscope: ${v.cls.name}, ${v.cls.type}, bearing ${fmtBrg(brg(o, v))}, range ${fmtRng(r)}.`);
        c.sighted = v.cls.key; c.q = Math.max(c.q, 0.99); c.bias = 0;
      }
      const estR = r * (1 + c.bias * (1 - c.q));
      c.est = { ...offset(o, c.bearing, estR), t: g.t };
      c.estErr = estR * 0.6 * (1 - c.q);
      const cav = v.cls.kind === 'sub' && v.spd > 20;
      if (cav && !c.cavitating) log(g, 'contact', `${contactLabel(c)} is cavitating. Target has gone to high speed.`);
      c.cavitating = cav;
    } else if (c.held && g.t - c.lastSeen > 45) {
      c.held = false;
      c.q *= 0.6;
      log(g, 'warn', `Lost contact on ${contactLabel(c)}. Last bearing ${fmtBrg(c.bearing ?? 0)}.`);
    }
    if (g.t % 10 === 0 && c.held && c.bearing !== null) { c.history.push({ t: g.t, b: c.bearing }); if (c.history.length > 30) c.history.shift(); }
  }

  // Being seen: a periscope and masts within a few miles of a surface ship can be spotted.
  if (atPD) {
    for (const v of g.vessels) {
      if (!v.alive || v.side !== 'enemy' || v.cls.kind !== 'surface' || !v.ai || v.ai.mode === 'alert') continue;
      const r = dist(o, v);
      if (r < 6 && g.r() < 0.004 * (6 - r)) {
        log(g, 'danger', `${v.name} has sighted our periscope! The German group is turning away at full speed.`, 'alarm');
        alertGroup(g, brg(o, v), 'enemy');
      }
    }
  }

  for (const w of g.weapons) {
    if (w.side !== 'enemy' || w.dead) continue;
    const tse = excess(SL_TORPEDO, w, ears, o.cls.threshold!);
    w.heardBrg = tse > 0 ? brg(o, w) : null;
    if (tse > 0 && !g.heard.has(w.id)) {
      g.heard.add(w.id);
      log(g, 'danger', `Torpedo in the water, bearing ${fmtBrg(w.heardBrg!)}!`, 'alarm');
    }
  }
}

function updateSignatures(g: Game) {
  const lib = LIBRARY[g.era];
  for (const c of g.contacts) {
    const v = vesselById(g, c.vid);
    if (!c.held || !v.alive) continue;
    c.sig = signatureView(v.cls, c.seAvg, v.spd, () => gauss(g.r));
    c.matches = matchClasses(c.sig, lib, c.sighted);
  }
}

// ---- AI ------------------------------------------------------------------------------------
function surfaceAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!;
  if (ai.mode === 'station') {
    const lead = vesselById(g, ai.leader!);
    if (!lead.alive) { ai.mode = 'transit'; ai.baseCourse = v.hdg; ai.cruise = 20; return; }
    const spot = offset(lead, lead.hdg + ai.rel!, ai.rng!);
    const d = dist(v, spot);
    v.ordHdg = d > 0.3 ? brg(v, spot) : lead.hdg;
    const ahead = Math.cos((angDiff(brg(v, spot), v.hdg) * Math.PI) / 180);
    v.ordSpd = clamp(lead.spd + ahead * d * 6, 0, v.cls.maxSpd);
    return;
  }
  if (ai.mode === 'alert') {
    ai.alertT -= dt;
    v.ordHdg = norm(ai.fleeHdg + ai.zig);
    v.ordSpd = v.cls.maxSpd;
    ai.legT -= dt;
    if (ai.legT <= 0) { ai.legT = 120 + g.r() * 120; ai.zig = (g.r() * 2 - 1) * 35; }
    if (ai.alertT <= 0) ai.mode = 'transit'; // back to the breakout course
    return;
  }
  // Transit: base course with a zigzag every few minutes.
  ai.legT -= dt;
  if (ai.legT <= 0) { ai.legT = 480 + g.r() * 420; ai.zig = (g.r() * 2 - 1) * 25; }
  v.ordHdg = norm(ai.baseCourse + ai.zig);
  v.ordSpd = ai.cruise;
}

function subAI(g: Game, v: Vessel, dt: number) {
  const o = g.own, ai = v.ai!;
  const se = excess(vesselSL(o), o, v, v.cls.threshold!) + gauss(g.r) * 2;
  if (se > 0) {
    const err = dist(o, v) * 0.12;
    ai.knows = { x: o.x + gauss(g.r) * err, y: o.y + gauss(g.r) * err, t: g.t, deep: o.depthT > LAYER_AT };
    ai.holdT += dt;
    if (ai.mode === 'patrol' && ai.holdT > 40) ai.mode = 'attack';
  } else {
    ai.holdT = Math.max(0, ai.holdT - dt * 0.25);
  }

  let threat: Weapon | null = null;
  for (const w of g.weapons) {
    if (w.side !== 'us' || w.dead || WEAPONS[w.type].missile) continue;
    const d = dist(w, v);
    const closing = Math.abs(angDiff(w.hdg, brg(w, v))) < 50;
    if (d < 7 && closing && excess(SL_TORPEDO, w, v, v.cls.threshold!) > 0 && (!threat || d < dist(threat, v))) threat = w;
  }
  if (threat && ai.mode !== 'evade') {
    ai.mode = 'evade'; ai.evadeT = 240;
    v.ordDepth = v.depthT > LAYER_AT ? 1 : 2;
    if (ai.decoys > 0) {
      ai.decoys--;
      g.decoys.push({ id: g.seq++, side: v.side, x: v.x, y: v.y, life: 240, deep: v.depthT > LAYER_AT });
      const c = g.contacts.find((x) => x.vid === v.id);
      if (c?.held) log(g, 'contact', `${contactLabel(c)} launched a countermeasure.`);
    }
    // Snap shot back down the bearing of the incoming torpedo.
    if (!ai.snapTaken && g.r() < 0.6) {
      ai.snapTaken = true;
      enemyFire(g, v, offset(v, brg(v, threat), dist(v, threat) + 4), o.depthT > LAYER_AT, true);
    }
  }
  if (threat) ai.threat = threat;

  ai.cool = Math.max(0, ai.cool - dt);
  if (ai.knows && g.t - ai.knows.t > 900 && ai.mode === 'attack') ai.mode = 'patrol';

  if (ai.mode === 'evade') {
    const t = ai.threat && !ai.threat.dead ? ai.threat : null;
    if (t) v.ordHdg = brg(t, v);
    v.ordSpd = 28;
    ai.evadeT -= dt;
    if (ai.evadeT <= 0 && !t) { ai.mode = ai.knows ? 'attack' : 'patrol'; ai.threat = null; }
  } else if (ai.mode === 'attack' && ai.knows) {
    const r = dist(v, ai.knows);
    v.ordHdg = brg(v, ai.knows);
    v.ordSpd = r > 6 ? 12 : 7;
    v.ordDepth = ai.knows.deep ? 2 : 1;
    const solved = ai.knows.exact || ai.holdT >= 90;
    if (solved && r < 8 && ai.cool <= 0 && g.t - ai.knows.t < 120) {
      enemyFire(g, v, { x: ai.knows.x, y: ai.knows.y }, ai.knows.deep, false);
      ai.knows.exact = false;
    }
  } else {
    ai.legT -= dt;
    if (ai.legT <= 0) {
      ai.legT = 360 + g.r() * 360;
      v.ordHdg = norm(v.hdg + (g.r() * 2 - 1) * 120);
      v.ordSpd = 6 + Math.round(g.r() * 3);
      if (g.r() < 0.25) v.ordDepth = v.ordDepth === 2 ? 1 : 2;
    }
  }
}

// ---- Broadband waterfall row ------------------------------------------------------------------
function waterfallRow(g: Game): WaterfallRow {
  const o = g.own, ears = ownEars(g);
  const row = new Float32Array(WF_BINS), baffle = new Uint8Array(WF_BINS);
  const base = 0.14 + (selfNoise(o.spd) - 70) / 70;
  for (let i = 0; i < WF_BINS; i++) {
    baffle[i] = !ears.array && inBaffles(o, i * 2 + 1) ? 1 : 0;
    row[i] = base * (0.5 + g.r());
  }
  const add = (bearing: number, level: number, width: number) => {
    for (let i = 0; i < WF_BINS; i++) {
      const d = angDiff(i * 2 + 1, bearing);
      row[i] += level * Math.exp(-(d * d) / (2 * width * width));
    }
  };
  for (const v of g.vessels) {
    if (v === o || !v.alive) continue;
    const se = excess(vesselSL(v), v, ears, o.cls.threshold!);
    add(brg(o, v), clamp((se + 12) / 22, 0, 1) * (0.7 + 0.3 * g.r()), v.cls.kind === 'surface' ? 2.8 : 2.2);
  }
  for (const w of g.weapons) if (!w.dead && !WEAPONS[w.type].missile) add(brg(o, w), clamp((excess(SL_TORPEDO, w, ears, o.cls.threshold!) + 10) / 20, 0, 1.2), 1.6);
  for (const d of g.decoys) add(brg(o, d), clamp((excess(SL_DECOY, d, ears, o.cls.threshold!) + 10) / 20, 0, 1), 1.8);
  for (let i = 0; i < WF_BINS; i++) if (baffle[i]) row[i] *= 0.15;
  return { row, baffle, t: g.t };
}

// ---- Tick ----------------------------------------------------------------------------------------
export function tick(g: Game, dt = 1) {
  if (g.over) return;
  g.t += dt;
  const o = g.own;
  for (const v of g.vessels) {
    if (!v.alive) continue;
    if (v.ai) (v.cls.kind === 'surface' ? surfaceAI : subAI)(g, v, dt);
    const turnRate = moveVessel(v, dt);
    if (v === o && turnRate > 0.5) o.arrayStableAt = g.t + ARRAY.settle; // the array snakes in a turn
    if (g.t % 15 === 0) { v.track.push({ x: v.x, y: v.y }); if (v.track.length > 400) v.track.shift(); }
  }
  o.tubes = o.tubes.map((x) => Math.max(0, x - dt));
  o.vls = o.vls.map((x) => Math.max(0, x - dt));
  for (const d of g.decoys) d.life -= dt;
  g.decoys = g.decoys.filter((d) => d.life > 0);
  for (const w of g.weapons) if (!w.dead) updateWeapon(g, w, dt);
  g.weapons = g.weapons.filter((w) => { if (w.dead && w.deadAt === undefined) w.deadAt = g.t; return !w.dead || g.t - w.deadAt! < 1; });
  if (g.over) return;
  ownSensors(g, dt);
  g.wfTimer -= dt;
  if (g.wfTimer <= 0) { g.wfTimer = 3; g.waterfall = waterfallRow(g); updateSignatures(g); }
  if (g.scenario === 'bismarck') {
    const bis = g.vessels[1];
    if (g.t >= g.timeLimit || dist(o, bis) > 60) end(g, false, 'Bismarck broke out into the Atlantic.');
  }
}

/** Degrees per minute of bearing drift on a held contact, or null. */
export function bearingRate(c: Contact): number | null {
  const h = c.history;
  if (h.length < 4) return null;
  const a = h[Math.max(0, h.length - 7)], b = h[h.length - 1];
  return b.t === a.t ? null : angDiff(b.b, a.b) / ((b.t - a.t) / 60);
}

export const missileDepthOk = (g: Game) => g.own.depthT <= MISSILE_MAX_DEPTH;
