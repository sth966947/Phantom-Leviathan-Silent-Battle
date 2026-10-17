// Simulation core: game state and a fixed one-second tick. No DOM or PixiJS,
// so it is deterministic for a given seed and testable in Node.
// Units: positions in nautical miles (x east, y north), time in game seconds,
// speeds in knots, bearings in degrees true (clockwise from north).

import { angDiff, approach, brg, clamp, D2R, dist, fmtBrg, fmtRng, gauss, KT, mulberry32, norm, offset, type Vec } from './math';
import { CLASSES, type ClassCard } from './classes';
import { MISSIONS, type Carry, type MissionKey } from './missions';
import { matchClasses, signatureView, type Match, type SignatureView } from './signature';
import { ambientDb, calmSea, pingMines, underIce, updateHazards, visibility, type Env, type Mine } from './hazards';

export type Side = 'us' | 'allied' | 'enemy';
/** Depth setting: 0 periscope depth (60 ft), 1 is 150 ft, 2 is 700 ft, and anything between or below. */
export type Depth = number;
export type ScenarioKey = MissionKey;
export type EventKind = 'info' | 'contact' | 'danger' | 'good' | 'warn';
export type Sound = 'ping' | 'ping-echo' | 'contact' | 'launch' | 'missile' | 'alarm' | 'boom';
export type WeaponKey = 'mk48' | 'ugst' | 'harpoon' | 'mst' | 'asroc' | 'mk54' | 'jatm' | 'sm6' | 'apr3' | 'wwtorp' | 'tlam' | 'mk96' | 'mjolnir';
/** What the player can launch. Mk 54 comes from ASROC; UGST and APR-3 are enemy weapons. */
export type FireKey = 'mk48' | 'harpoon' | 'mst' | 'asroc' | 'jatm' | 'sm6' | 'mk96' | 'mjolnir';
/** How a weapon finds its target: homing torpedo, anti-ship missile, ASROC carrier, or surface-to-air. */
export type Role = 'torpedo' | 'antiship' | 'asw' | 'aa' | 'land';

export interface GameEvent { t: number; kind: EventKind; text: string; sound?: Sound }

/** Periscope depth, 150 ft (above the layer), 700 ft (below it). */
export const DEPTH_FT = [60, 150, 700] as const;
const LAYER_AT = 1.5; // depthT above this is below the layer

export interface Knowledge extends Vec { t: number; deep: boolean; exact?: boolean }
export interface AI {
  mode: 'patrol' | 'attack' | 'evade' | 'transit' | 'station' | 'alert' | 'orbit' | 'search' | 'prosecute' | 'dip'
    | 'hunt' | 'raider' | 'strike' | 'picket' | 'wander';
  legT: number; holdT: number; knows: Knowledge | null; cool: number; evadeT: number;
  threat: Weapon | null; snapTaken: boolean; decoys: number;
  baseCourse: number; zig: number; cruise: number;
  leader?: number; rel?: number; rng?: number; alertT: number; fleeHdg: number;
  // Aircraft: patrol centre, current waypoint, sonobuoy timer and torpedoes left.
  center?: Vec; wp?: Vec; buoyT?: number; torps?: number; datum?: Knowledge | null; phase?: number; hits?: number; dipT?: number;
  // WWII: the ship a raiding submarine is after, a goal point (harbour mouth, strike target), a picket's report timer,
  // and where an escort was stationed before it went hunting.
  prey?: number | null; goal?: Vec; reportT?: number; home?: AIMode;
}
export type AIMode = AI['mode'];

export interface Vessel extends Vec {
  id: number; name: string; cls: ClassCard; side: Side;
  hdg: number; ordHdg: number; spd: number; ordSpd: number;
  depthT: number; ordDepth: Depth; hp: number; alive: boolean;
  track: Vec[]; ai: AI | null;
  /** Left the area alive (a strike that got through, a ship that escaped): not sunk. */
  gone?: boolean;
}

export interface OwnBoat extends Vessel {
  tubes: number[]; vls: number[]; decoys: number; arrayStableAt: number;
  /** The towed array streams with the boat, or is worked across the layer from it. */
  arraySide: ArraySide;
  /** Rounds left in the JATM canister in the current vertical tube (7 per canister). */
  jatm: number; radar: boolean;
  /** Sonar drones left aboard. */
  drones: number;
}

/**
 * A disposable sonar drone, swum out from a torpedo tube. It runs out along its launch bearing,
 * then hovers. Passive: an extra pair of ears away from the boat. Active: it pings every minute,
 * so whoever hears the ping hunts the drone, not Tang. Decoy: it plays Tang's noise.
 */
export type DroneMode = 'passive' | 'active' | 'decoy';
export interface Drone extends Vec { id: number; n: number; hdg: number; run: number; mode: DroneMode; battery: number; deep: boolean; pingT: number }

/** An enemy sonobuoy: a small omnidirectional hydrophone, shallow or deep. */
export interface Buoy extends Vec { id: number; life: number; deep: boolean; heard: boolean; hits: number; est: Vec | null }

export interface Decoy extends Vec { id: number; side: Side; life: number; deep: boolean }

export interface Weapon extends Vec {
  id: number; type: WeaponKey; side: Side; label: string;
  hdg: number; ordHdg: number; spd: number;
  run: number; maxRun: number; enableAt: number; enabled: boolean;
  deep: boolean; wire: boolean; aim: Vec; contactId: number | null; layerT?: number;
  target: Vessel | Decoy | null; targetKind?: 'vessel' | 'decoy';
  rolled: Set<number>; trail: Vec[];
  dead?: boolean; deadAt?: number; heardBrg?: number | null;
  /** An enemy torpedo our sonar is tracking: when first heard, the estimated position now, the
   *  fixes every 10 s, and its estimated course and speed. */
  heardAt?: number; heardEst?: Vec | null; heardTrail?: (Vec & { t: number })[]; heardVel?: { hdg: number; spd: number } | null;
  /** Mjolnir: past the top of its arc. */
  apex?: boolean;
  /** Flying to a site ashore (a TLAM, or a Mjolnir sent at a land target). */
  land?: boolean;
}

export interface Contact {
  id: number; vid: number; name: string;
  held: boolean; ever: boolean; lastSeen: number; se: number; seAvg: number;
  bearing: number | null; q: number; bias: number; air: boolean; radarT: number; radarHits: number;
  est: (Vec & { t: number }) | null; estErr: number; legHdg: number;
  /** Course and speed from the solution, once it is good enough to judge them; and where the estimate has been. */
  motion: { crs: number; spd: number } | null; trail: Vec[];
  history: { t: number; b: number }[]; cavitating: boolean;
  sig: SignatureView | null; matches: Match[]; classified: string | null; sighted: string | null; spotted: boolean;
}

export interface WaterfallRow { row: Float32Array; baffle: Uint8Array; t: number }

/** What stands at a land-attack site: the strike camera draws the scene to suit it. */
export type SiteKind = 'shipyard' | 'docks' | 'factory' | 'airfield' | 'radar' | 'subpens' | 'oil' | 'base' | 'bunker';
/** A fixed target ashore for land-attack Tomahawks, with hits landed on it. */
export interface Site extends Vec { id: number; name: string; hits: number; kind?: SiteKind }
/** One land-attack Tomahawk's arrival, for the strike camera. */
export interface Strike { t: number; siteId: number; siteName: string; kind: SiteKind; hit: boolean; weapon: string; type: 'tlam' | 'mjolnir' }
/** One hit by Tang's weapons (or a mine Tang laid) on a ship, submarine or aircraft, for the battle camera. */
export interface Hit {
  t: number; vid: number; name: string; cls: string; kind: ClassCard['kind'];
  weapon: WeaponKey | 'mine'; label: string; sunk: boolean;
}

/** A site's kind as set by its mission, or else guessed from its name. */
export function siteKind(site: Site): SiteKind {
  if (site.kind) return site.kind;
  const n = site.name.toLowerCase();
  const by: [RegExp, SiteKind][] = [
    [/sub(marine)? pens?|u-boat/, 'subpens'], [/radar|early warning/, 'radar'], [/oil|fuel|tank farm|refiner/, 'oil'],
    [/air ?(field|base|port|station)|runway/, 'airfield'], [/naval yard|shipyard|dockyard|slipway/, 'shipyard'], [/\b(docks?|port|harbou?r|wharf|piers?)\b/, 'docks'],
    [/bunker|command|headquarters|\bhq\b/, 'bunker'], [/works|factory|arsenal|plant|steel|mill/, 'factory'],
  ];
  return by.find(([re]) => re.test(n))?.[1] ?? 'base';
}

/**
 * What a mission asks. Sinking `need` of `targets` wins at once. Losing more than `maxLosses` of
 * `protect` loses. At the time limit the mission is won if `surviveWin`, else lost with `timeout`.
 */
export interface Goal {
  targets: number[]; need: number; protect: number[]; maxLosses: number; surviveWin: boolean;
  win: string; timeout: string; lossText: string;
}

export interface Game {
  scenario: ScenarioKey; era: '1941' | '2029'; startClock: number; timeLimit: number;
  /** Classes in the signature and recognition book for this mission. */
  library: string[]; night: boolean; goal: Goal;
  /** Who was sunk or shot down, in order, and mission counters (strikes through, reports sent). */
  sunk: { name: string; cls: string; side: Side; by: Side }[]; flags: Record<string, number>;
  /** Mission script run every tick: waves launching, pickets reporting, midgets reaching harbour. */
  script: ((g: Game) => void) | null;
  /** Fixed targets ashore for land-attack Tomahawks, with hits landed on each. */
  sites: Site[];
  /** Every land-attack Tomahawk's arrival, hit or miss, in order. */
  strikes: Strike[];
  /** Every hit by Tang's weapons on a vessel or aircraft, in order. */
  hits: Hit[];
  /** Minefields (see hazards.ts): enemy mines Tang must find and avoid, and any Tang has laid. */
  mines: Mine[];
  /** Sea state and pack ice for the mission (see hazards.ts). */
  env: Env;
  t: number; r: () => number; seq: number;
  over: { win: boolean; t: number; reason: string } | null;
  /** A replay of a finished mission: the plot shows every ship where it really is. */
  replay?: boolean;
  own: OwnBoat; vessels: Vessel[]; contacts: Contact[]; selected: number | null;
  weapons: Weapon[]; decoys: Decoy[]; drones: Drone[]; buoys: Buoy[]; splashT: number; heard: Set<number>; sweeps: { t: number }[];
  events: GameEvent[]; waterfall: WaterfallRow | null; wfTimer: number;
  pings: (Partial<Vec> & { t: number })[]; blasts: (Vec & { t: number; missile: boolean })[];
  /** Depth charges sinking toward their set depth, and when they go off. */
  charges: (Vec & { t: number })[];
  stats: { fired: Record<WeaponKey, number>; enemyFired: number; pings: number; hits: number; blueOnBlue: number; drones?: number };
}

// ---- Weapons ------------------------------------------------------------------------
// Early versions have unlimited weapons (Scott's call); only tube reloads limit firing.
// `missile` means it flies (no acoustic signature, launched from 150 ft or shallower).
// `vls` means it comes from a vertical tube rather than a torpedo tube. `pk` is the
// chance a surface-to-air missile kills the aircraft it reaches.
export const WEAPONS: Record<WeaponKey, {
  name: string; short: string; spd: number; maxRun: number; seeker: number; damage: number;
  missile: boolean; role: Role; vls?: boolean; minRun?: number; pk?: number; surfaceDamage?: number;
}> = {
  mk48: { name: 'Mk 48 ADCAP Mod 7', short: 'Mk 48', spd: 55, maxRun: 22, seeker: 2.5, damage: 5, missile: false, role: 'torpedo' },
  ugst: { name: 'UGST Fizik-1', short: 'UGST', spd: 50, maxRun: 13, seeker: 2.2, damage: 5, missile: false, role: 'torpedo' },
  harpoon: { name: 'UGM-84 Harpoon Block II', short: 'Harpoon', spd: 470, maxRun: 67, seeker: 10, damage: 2, missile: true, role: 'antiship' },
  mst: { name: 'Tomahawk anti-ship (Maritime Strike)', short: 'Tomahawk', spd: 480, maxRun: 900, seeker: 12, damage: 3, missile: true, role: 'antiship', vls: true },
  // Sub-launched RUM-139C: a rocket that flies to the solution and drops a Mk 54.
  asroc: { name: 'ASROC (sub-launched RUM-139C)', short: 'ASROC', spd: 600, maxRun: 15, seeker: 0, damage: 0, missile: true, role: 'asw', vls: true, minRun: 1 },
  // A lightweight warhead kills a submarine but only dents a big surface ship.
  mk54: { name: 'Mk 54 lightweight torpedo', short: 'Mk 54', spd: 40, maxRun: 6, seeker: 1.6, damage: 5, surfaceDamage: 2, missile: false, role: 'torpedo' },
  // Surface-to-air missiles are fire and forget: they fly down the launch bearing and take the
  // first aircraft their seeker finds in a 50 nm, ±45° cone, or run out of fuel.
  jatm: { name: 'AIM-260 JATM (sub-launched)', short: 'JATM', spd: 2300, maxRun: 100, seeker: 50, damage: 1, missile: true, role: 'aa', vls: true, pk: 0.85 },
  sm6: { name: 'SM-6 (sub-launched)', short: 'SM-6', spd: 2000, maxRun: 130, seeker: 50, damage: 1, missile: true, role: 'aa', vls: true, pk: 0.9 },
  apr3: { name: 'APR-3E air-dropped torpedo', short: 'APR-3', spd: 60, maxRun: 3, seeker: 1.2, damage: 3, missile: false, role: 'torpedo' },
  // WWII straight-running torpedo (G7e, Type 95): no seeker, it hits whatever is in its path.
  // Land attack: flies to a fixed site by terrain matching (TERCOM), so it needs no GPS.
  tlam: { name: 'Tomahawk land attack (Block V)', short: 'TLAM', spd: 480, maxRun: 1000, seeker: 0, damage: 1, missile: true, role: 'land', vls: true },
  // Experimental, first fitted to Tang. Mk 96: a supercavitating torpedo (the US answer to the
  // Shkval). It swims out at 50 knots; once its seeker has a target it lights the rocket and
  // runs in at 250, too fast to dodge or decoy, and very loud. Only 15 nm of fuel.
  mk96: { name: 'Mk 96 supercavitating torpedo (experimental)', short: 'Mk 96', spd: 50, maxRun: 15, seeker: 2.5, damage: 6, missile: false, role: 'torpedo' },
  // Mjolnir: sub-launched Precision Strike Missile, Increment 2. Up in a ballistic arc, then
  // down onto the ship at Mach 6 with a 1,500 lb penetrating warhead. Air defence can only reach it as it climbs or dives, and seldom stops it (kit.ts MJOLNIR_AD).
  mjolnir: { name: 'Mjolnir (sub-launched PrSM Increment 2, experimental)', short: 'Mjolnir', spd: 3000, maxRun: 1000, seeker: 10, damage: 9, missile: true, role: 'antiship', vls: true, minRun: 10 },
  wwtorp: { name: 'Straight-running torpedo', short: 'Torpedo', spd: 40, maxRun: 5, seeker: 0.12, damage: 3, missile: false, role: 'torpedo' },
};
export const JATM_PER_CANISTER = 7;
/** Mk 96 sprint speed once the seeker has a target, knots. */
export const MK96_SPRINT = 250;
/** A Mjolnir on a site ashore lands three Tomahawks' worth of damage, and rarely misses: it is
 *  inertially guided down a ballistic arc rather than map-matching its way in. */
export const MJOLNIR_LAND_HITS = 3, MJOLNIR_LAND_P = 0.95;
export const DRONES_ABOARD = 6;
/** Drone battery, seconds of passive listening; active and decoy run it down three times as fast. */
const DRONE_BATTERY = 5400, DRONE_RUN = 4, DRONE_SPD = 8, DRONE_DECOY_SL = 122;
const AA_CONE = 45;
const TUBE_RELOAD = 120;
const VLS_RELOAD = 600;
const MISSILE_MAX_DEPTH = 1.05; // missiles launch from 150 ft or shallower
const VISUAL_RANGE = 8;         // nm, through May snow squalls in the Denmark Strait
const AIR_VISUAL_RANGE = 10;    // nm, aircraft against the sky

// ---- Radar ---------------------------------------------------------------------------
// Mast radar, periscope depth only.
/** Mast radar, nm. Ships: seen and identified out to 25. Aircraft: low fliers (helicopters, attack runs) inside 15, high fliers out to 100, identified inside 15. */
export const RADAR = { classify: 50, classifyAir: 15, horizon: 50, airLow: 15, airHigh: 100, sweep: 4, esm: 100 };
/** Helicopters stay down on the water; fixed-wing aircraft come down only to attack. */
const HELOS = new Set(['ka27', 'ka28']);
export const flyingLow = (v: Vessel) => v.cls.kind === 'air' && (HELOS.has(v.cls.key) || v.ai?.mode === 'prosecute');
/** Feet below the surface for a depth setting: periscope depth 60 ft, 150 ft, 700 ft. */
export const depthFeet = (depthT: number) => (depthT <= 1 ? 60 + 90 * depthT : 150 + 550 * (depthT - 1));
export const LAYER_FT = depthFeet(LAYER_AT);
/** The depth setting for a depth in feet. */
export const depthT = (ft: number) => (ft <= 150 ? (ft - 60) / 90 : 1 + (ft - 150) / 550);
export const MIN_FT = 60, MAX_FT = 800;
/** Typical cruising height in feet. Low fliers stay down where radar sees them only close in. */
const CRUISE_FT: Record<string, number> = { il38: 8000, kq200: 8000, p8i: 7000, p8a: 7000, p3am: 6000, h6k: 28000, h6j: 25000, tu142: 25000, tu22m3: 30000, ar196: 1500, kate: 10000, mavis: 6000, jake: 2500, fw200: 3000 };
export const altitudeFt = (v: Vessel) => (flyingLow(v) ? (HELOS.has(v.cls.key) ? 300 : 600) : CRUISE_FT[v.cls.key] ?? 8000);
const PD_MAX = 0.3; // depthT at or above which masts are out of the water

// ---- Acoustics ---------------------------------------------------------------------
const SL_TORPEDO = 140;
const SL_DECOY = 128;
const SL_LAUNCH = 128;
const LAYER_LOSS = 9;
export const BAFFLE_HALF = 30;
export const ARRAY = { name: 'TB-34 towed array', gain: 3, maxSpd: 12, settle: 90 };
export const WF_BINS = 180;

export const vesselSL = (v: Vessel) => v.cls.slBase + 1.5 * v.spd;
/** Wave and ice noise for the mission under way, set each tick (see hazards.ts). */
let ambient = 0;
export const selfNoise = (spd: number) => 70 + ambient + Math.max(0, spd - 5) * 1.2;
const deepOf = (o: { depthT?: number; deep?: boolean }) => (o.depthT !== undefined ? o.depthT > LAYER_AT : !!o.deep);
export const inBaffles = (lis: { hdg: number }, bearing: number) => Math.abs(angDiff(bearing, lis.hdg + 180)) < BAFFLE_HALF;

/** Towed array works when slow and straight; it removes the stern blind spot and adds gain. */
export const arrayActive = (g: Game) => g.own.spd <= ARRAY.maxSpd && g.t >= g.own.arrayStableAt;

type Listener = Vec & { hdg: number; spd: number; depthT: number; array?: boolean; arrayDepthT?: number };

/** Passive sonar equation, simplified. Positive means detectable. */
export function excess(sl: number, src: Vec & { depthT?: number; deep?: boolean }, lis: Listener, threshold: number): number {
  const r = dist(src, lis);
  const base = sl - 20 * Math.log10(Math.max(r, 0.05)) - selfNoise(lis.spd) - threshold;
  // Hull sonar: deaf astern, and it hears across the layer badly.
  const hull = inBaffles(lis, brg(lis, src)) ? -99 : base - (deepOf(src) !== deepOf(lis) ? LAYER_LOSS : 0);
  if (!lis.array) return hull;
  // Towed array: no baffles, some gain, and it listens from its own side of the layer.
  const arr = base + ARRAY.gain - (deepOf(src) !== deepOf({ depthT: lis.arrayDepthT ?? lis.depthT }) ? LAYER_LOSS : 0);
  return Math.max(hull, arr);
}
/** Where the towed array streams: with the boat, or across the layer from it. */
export type ArraySide = 'with' | 'above' | 'below';
export const arrayDepthT = (o: OwnBoat) => (o.arraySide === 'above' ? Math.min(o.depthT, 1) : o.arraySide === 'below' ? Math.max(o.depthT, 2) : o.depthT);
const ownEars = (g: Game): Listener => ({ x: g.own.x, y: g.own.y, hdg: g.own.hdg, spd: g.own.spd, depthT: g.own.depthT, array: arrayActive(g), arrayDepthT: arrayDepthT(g.own) });

// ---- Setup ---------------------------------------------------------------------------
export function makeVessel(g: Game, cls: string, name: string, side: Side, p: Vec, hdg: number, spd: number, depth: Depth): Vessel {
  const c = CLASSES[cls];
  return {
    id: g.seq++, name, cls: c, side, x: p.x, y: p.y, hdg, ordHdg: hdg, spd, ordSpd: spd,
    depthT: c.kind === 'sub' ? depth : 0, ordDepth: c.kind === 'sub' ? depth : 0,
    hp: c.hp, alive: true, track: [], ai: null,
  };
}

export function makeAI(over: Partial<AI>): AI {
  return {
    mode: 'patrol', legT: 300, holdT: 0, knows: null, cool: 0, evadeT: 0, threat: null, snapTaken: false,
    decoys: 0, baseCourse: 0, zig: 0, cruise: 0, alertT: 0, fleeHdg: 0, ...over,
  };
}

export function create(scenario: ScenarioKey = 'bismarck', seed?: number, carry: Carry = { sunk: [] }): Game {
  const r = mulberry32(seed ?? (Date.now() & 0xffffffff));
  const m = MISSIONS[scenario];
  const g = {
    scenario, era: m.era, startClock: 0, timeLimit: Infinity, library: m.library, night: !!m.night,
    goal: { targets: [], need: 1, protect: [], maxLosses: Infinity, surviveWin: false, win: '', timeout: '', lossText: '' },
    sunk: [], flags: {}, script: null, sites: [], strikes: [], hits: [], mines: [], env: calmSea(),
    t: 0, r, seq: 1, over: null, vessels: [], contacts: [], selected: null,
    weapons: [], decoys: [], drones: [], buoys: [], charges: [], splashT: -1e9, heard: new Set(), sweeps: [], events: [], waterfall: null, wfTimer: 0, pings: [], blasts: [],
    stats: {
      fired: Object.fromEntries(Object.keys(WEAPONS).map((k) => [k, 0])) as Record<WeaponKey, number>,
      enemyFired: 0, pings: 0, hits: 0, blueOnBlue: 0,
    },
  } as unknown as Game;

  const ownV = makeVessel(g, 'virginia', 'USS Tang (SSN-805)', 'us', { x: 0, y: 0 }, 0, 5, 1);
  g.own = Object.assign(ownV, { tubes: [0, 0, 0, 0], vls: Array(12).fill(0), decoys: 4, arrayStableAt: 0, arraySide: 'with' as ArraySide, jatm: 0, radar: false, drones: DRONES_ABOARD });
  g.vessels.push(g.own);
  m.build(g, r, carry);
  return g;
}

export function log(g: Game, kind: EventKind, text: string, sound?: Sound) { g.events.push({ t: g.t, kind, text, sound }); }
const vesselById = (g: Game, id: number) => g.vessels.find((v) => v.id === id)!;
export const contactById = (g: Game, id: number | null) => (id === null ? null : g.contacts.find((c) => c.id === id) ?? null);
/** What the player calls a contact: its accepted class if classified, else its sonar designation. */
export const contactLabel = (c: Contact) => (c.classified ? `${c.name} · ${CLASSES[c.classified].name}` : c.name);
export const isFriendlyClass = (key: string | null) =>
  !!key && (['UK', 'US', 'Netherlands', 'Australia', 'Norway'].includes(CLASSES[key].nation) || !!CLASSES[key].friendly);

// ---- Movement -------------------------------------------------------------------------
function moveVessel(v: Vessel, dt: number) {
  if (v.cls.kind === 'air') {
    const turn = clamp(angDiff(v.ordHdg, v.hdg), -3 * dt, 3 * dt);
    v.hdg = norm(v.hdg + turn);
    v.spd = v.ordSpd;
    v.x += Math.sin(v.hdg * D2R) * v.spd * KT * dt;
    v.y += Math.cos(v.hdg * D2R) * v.spd * KT * dt;
    return 0;
  }
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
/** The contact a weapon would go after: the selected one if it suits, else the first that does. */
export function targetContact(g: Game, air = false): Contact | null {
  // Air contacts only need a bearing: the missile does its own finding.
  const ok = (c: Contact | null) => !!c && c.air === air && (air ? c.bearing !== null : !!c.est) && vesselById(g, c.vid).alive;
  const sel = contactById(g, g.selected);
  if (ok(sel)) return sel;
  return g.contacts.find((c) => c.held && ok(c)) ?? null;
}
/** Surface-to-air missiles need a live radar track to fly out on. */
export const radarTracked = (g: Game, c: Contact) => c.held && g.t - c.radarT <= RADAR.sweep * 3;

export const orders = {
  heading(g: Game, hdg: number) { stopSteering(g); g.own.ordHdg = norm(Math.round(hdg)); },
  turn(g: Game, delta: number) { stopSteering(g); g.own.ordHdg = norm(Math.round(g.own.ordHdg + delta)); },
  speed(g: Game, kts: number) {
    if (g.flags.matchSpd) { g.flags.matchSpd = 0; log(g, 'info', 'No longer matching the target\'s speed.'); }
    g.own.ordSpd = clamp(kts, 0, g.own.cls.maxSpd);
  },
  /**
   * Toggles that keep following the selected contact until turned off or overridden: its speed, its
   * course (steer parallel), or its bearing (steer straight at it). Course and bearing exclude each other.
   */
  match(g: Game, what: MatchKind) {
    const key = MATCH_FLAG[what];
    if (g.flags[key]) { g.flags[key] = 0; return log(g, 'info', `No longer matching the target's ${what}.`); }
    const c = contactById(g, g.selected);
    if (!c) return log(g, 'warn', `Match ${what}: select a contact first.`);
    if (c.air) return log(g, 'warn', `Match ${what}: we can't follow an aircraft.`);
    if (!c.held || (what !== 'bearing' && !c.motion)) return log(g, 'warn', `Match ${what}: no ${what} on ${contactLabel(c)} yet. Keep tracking until the solution shows its course and speed.`);
    if (what === 'course' && g.flags.matchBrg) { g.flags.matchBrg = 0; log(g, 'info', 'No longer steering at the target\'s bearing.'); }
    if (what === 'bearing' && g.flags.matchCrs) { g.flags.matchCrs = 0; log(g, 'info', 'No longer matching the target\'s course.'); }
    g.flags[key] = c.id;
    keepMatch(g);
    const now = what === 'speed' ? `${g.own.ordSpd} knots` : `${String(Math.round(g.own.ordHdg)).padStart(3, '0')}°`;
    log(g, 'info', `Matching ${contactLabel(c)}'s ${what}: ${now}. We'll keep following it until you turn this off or give another ${what === 'speed' ? 'speed' : 'heading'}.`);
  },
  depth(g: Game, d: Depth) {
    if (g.own.arraySide !== 'with') { g.own.arraySide = 'with'; g.own.arrayStableAt = g.t + ARRAY.settle; log(g, 'info', 'Towed array streaming with the boat again.'); }
    if (g.own.ordDepth === d) return;
    g.own.ordDepth = d;
    const ft = Math.round(depthFeet(d));
    log(g, 'info', d === 0 ? 'Making periscope depth, 60 feet. Periscope and masts will be up.'
      : `Making depth ${ft} feet${d > LAYER_AT ? (g.own.depthT > LAYER_AT ? ', below the layer' : ', going below the layer') : ', above the layer'}.`);
  },
  /**
   * Straddle the layer: the boat on one side, the towed array worked across to the other, so
   * the array hears what the hull can't. 'above' puts the boat below the layer and the array
   * above it; 'below' the other way round.
   */
  straddle(g: Game, array: 'above' | 'below') {
    const o = g.own;
    if (o.arraySide === array) return;
    o.arraySide = 'with'; // quietly: the order below sets the depth, then the array goes across
    orders.depth(g, depthT(array === 'above' ? 550 : 300));
    o.arraySide = array;
    o.arrayStableAt = g.t + ARRAY.settle;
    log(g, 'info', array === 'above'
      ? 'Making depth 550 feet, below the layer. Towed array is being worked up above the layer.'
      : 'Making depth 300 feet, above the layer. Towed array is being let out deep, below the layer.');
  },
  /** Make a depth in feet, between periscope depth and test depth. */
  depthTo(g: Game, feet: number) {
    if (!Number.isFinite(feet)) return;
    const ft = clamp(Math.round(feet), MIN_FT, MAX_FT);
    orders.depth(g, ft <= MIN_FT ? 0 : depthT(ft));
  },
  /** Change the ordered depth by a number of feet, in 50-foot steps, between periscope depth and test depth. */
  depthBy(g: Game, deltaFt: number) {
    const now = Math.round(depthFeet(g.own.ordDepth) / 50) * 50;
    const ft = clamp(now + deltaFt, MIN_FT, MAX_FT);
    orders.depth(g, ft <= MIN_FT ? 0 : depthT(ft));
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
  fire(g: Game, type: FireKey) {
    const o = g.own;
    if (g.over) return;
    const w = WEAPONS[type];
    if (w.missile && underIce(g)) return log(g, 'warn', `${w.short}: ice overhead. Missiles need open water: find a polynya.`);
    if (w.missile && o.depthT > MISSILE_MAX_DEPTH) return log(g, 'warn', `${w.short}: come up to 150 feet or shallower to launch.`);
    // Maritime Strike Tomahawk needs satellite updates in flight to find a moving ship.
    if (type === 'mst' && g.flags.jammed) return log(g, 'warn', 'Tomahawk: satellite links are jammed. It can\'t get in-flight updates on a moving target. Harpoon and torpedoes still work.');
    const aa = w.role === 'aa';
    const c = targetContact(g, aa);
    if (!aa && w.missile && !c) return log(g, 'warn', `${w.short}: no contact to target. Select a contact with a solution first.`);
    // A SAM goes down the bearing of the selected air contact, or straight ahead if there is none.
    const aim = aa ? offset(o, c ? c.bearing! : o.hdg, w.seeker) : c?.est ? { x: c.est.x, y: c.est.y } : offset(o, o.hdg, 8);
    const range = dist(o, aim);
    if (w.role === 'asw' && (range < w.minRun! || range > w.maxRun)) return log(g, 'warn', `ASROC: solution is ${fmtRng(range)} out. ASROC reaches 1 to 15 nm.`);
    if (type === 'mjolnir' && (range < w.minRun! || range > w.maxRun)) return log(g, 'warn', `Mjolnir: solution is ${fmtRng(range)} out. The ballistic arc needs ${w.minRun} to ${w.maxRun} nm.`);
    // A JATM canister holds seven rounds; it takes a vertical tube until it is empty.
    const fromCanister = type === 'jatm' && o.jatm > 0;
    const bank = w.vls ? o.vls : o.tubes;
    const tube = fromCanister ? -1 : bank.findIndex((x) => x <= 0);
    if (!fromCanister && tube < 0) return log(g, 'warn', w.vls ? 'All vertical launch tubes reloading.' : 'All torpedo tubes reloading.');
    if (type === 'jatm') {
      if (!fromCanister) { o.jatm = JATM_PER_CANISTER; bank[tube] = VLS_RELOAD; }
      o.jatm--;
    } else bank[tube] = w.vls ? VLS_RELOAD : TUBE_RELOAD;
    const hdg = brg(o, aim);
    g.stats.fired[type]++;
    const label = `${w.short} ${g.stats.fired[type]}`;
    const enableAt = w.role === 'antiship' ? Math.max(1, range - 8) : w.role === 'aa' ? 0.5 : 1;
    g.weapons.push({
      id: g.seq++, type, side: 'us', label, x: o.x, y: o.y, hdg, ordHdg: hdg, spd: w.spd,
      run: 0, maxRun: w.maxRun, enableAt, enabled: false,
      deep: o.depthT > LAYER_AT, wire: !w.missile, aim, contactId: c?.id ?? null,
      target: null, rolled: new Set(), trail: [],
    });
    const at = c ? ` at ${contactLabel(c)}` : '';
    const from = type === 'jatm' ? `JATM canister, ${o.jatm} of ${JATM_PER_CANISTER} left${fromCanister ? '' : `, VLS tube ${tube + 1}`}` : w.vls ? `VLS tube ${tube + 1}` : `Tube ${tube + 1}`;
    const tail = type === 'mk96' ? '. Wire guidance active; rocket lights when the seeker acquires.' : type === 'mjolnir' ? `, ${fmtRng(range)}. Boosting up the arc; impact in about ${Math.round(range / w.spd * 3600)} seconds.` : w.role === 'torpedo' ? '. Wire guidance active.' : w.role === 'asw' ? `, drop point ${fmtRng(range)}.` : aa ? '. Fire and forget, seeker searching.' : `, range ${fmtRng(range)}.`;
    log(g, 'good', `${from} fired. ${label}${at}, bearing ${fmtBrg(hdg)}${tail}`, w.missile ? 'missile' : 'launch');
    transient(g, o, 'us');
    if (w.missile) launchSeen(g);
  },
  /** Lay a mine from a torpedo tube where Tang is now. Missions that send Tang out with mines set `minesAboard`. */
  layMine(g: Game) {
    const o = g.own;
    if (g.over) return;
    if (!g.flags.minesAboard) return log(g, 'warn', 'No mines aboard on this patrol.');
    if (o.spd > 12) return log(g, 'warn', 'Mines: slow to 12 knots or less to lay a mine.');
    const tube = o.tubes.findIndex((x) => x <= 0);
    if (tube < 0) return log(g, 'warn', 'All torpedo tubes reloading.');
    o.tubes[tube] = TUBE_RELOAD;
    g.flags.minesAboard--;
    g.mines.push({ id: g.seq++, side: 'us', found: true, x: o.x, y: o.y });
    log(g, 'good', `Tube ${tube + 1}: mine laid. ${g.flags.minesAboard} left aboard.`);
  },
  /** Land-attack Tomahawk at one of the mission's fixed sites ashore. */
  strike(g: Game, siteId: number, type: 'tlam' | 'mjolnir' = 'tlam') {
    const o = g.own, w = WEAPONS[type], mj = type === 'mjolnir';
    if (g.over) return;
    const site = g.sites.find((x) => x.id === siteId);
    const name = mj ? 'Mjolnir' : 'TLAM';
    if (!site) return log(g, 'warn', `${name}: no target selected.`);
    if (underIce(g)) return log(g, 'warn', `${name}: ice overhead. Missiles need open water: find a polynya.`);
    if (o.depthT > MISSILE_MAX_DEPTH) return log(g, 'warn', `${name}: come up to 150 feet or shallower to launch.`);
    const range = dist(o, site);
    if (mj && (range < w.minRun! || range > w.maxRun)) return log(g, 'warn', `Mjolnir: ${site.name} is ${fmtRng(range)} away. The ballistic arc needs ${w.minRun} to ${w.maxRun} nm.`);
    if (range > w.maxRun) return log(g, 'warn', `TLAM: ${site.name} is ${fmtRng(range)} away, beyond Tomahawk range.`);
    const tube = o.vls.findIndex((x) => x <= 0);
    if (tube < 0) return log(g, 'warn', 'All vertical launch tubes reloading.');
    o.vls[tube] = VLS_RELOAD;
    g.stats.fired[type]++;
    const label = mj ? `Mjolnir ${g.stats.fired.mjolnir}` : `TLAM ${g.stats.fired.tlam}`;
    const hdg = brg(o, site);
    g.weapons.push({
      id: g.seq++, type, side: 'us', label, x: o.x, y: o.y, hdg, ordHdg: hdg, spd: w.spd,
      run: 0, maxRun: w.maxRun, enableAt: Infinity, enabled: false, deep: false, wire: false,
      aim: { x: site.x, y: site.y }, contactId: site.id, target: null, rolled: new Set(), trail: [], land: true,
    });
    if (mj) log(g, 'good', `VLS tube ${tube + 1} fired. ${label} for ${site.name}, ${fmtRng(range)}. Boosting up the arc; impact in about ${Math.round(range / w.spd * 3600)} seconds.`, 'missile');
    else log(g, 'good', `VLS tube ${tube + 1} fired. ${label} for ${site.name}, ${fmtRng(range)}, about ${Math.round(range / w.spd * 60)} minutes' flight. ${g.era === '1941' ? 'Terrain matching only: no GPS in 1942.' : g.flags.jammed ? 'GPS jammed: terrain matching only.' : 'GPS and terrain matching.'}`, 'missile');
    transient(g, o, 'us');
    launchSeen(g);
  },
  radar(g: Game, on = !g.own.radar) {
    if (g.over || on === g.own.radar) return;
    if (on && g.own.depthT > PD_MAX) return log(g, 'warn', 'Radar: the mast only clears the water at periscope depth.');
    g.own.radar = on;
    log(g, on ? 'good' : 'info', on ? 'Radar mast up, transmitting. Anyone with a radar warning receiver can hear us.' : 'Radar secured.');
  },
  ping(g: Game) {
    const o = g.own;
    if (g.over) return;
    g.stats.pings++;
    g.pings.push({ t: g.t });
    pingMines(g);
    const returns = pingFrom(g, o, o.depthT > LAYER_AT, 'Ping return');
    log(g, returns ? 'contact' : 'info', returns ? `Active ping: ${returns} return${returns > 1 ? 's' : ''}.` : 'Active ping: no return.', returns ? 'ping-echo' : 'ping');
  },
  /** Swim a sonar drone out of a torpedo tube, toward the selected contact or dead ahead. */
  launchDrone(g: Game) {
    const o = g.own;
    if (g.over) return;
    if (o.drones <= 0) return log(g, 'warn', 'No sonar drones left aboard.');
    const tube = o.tubes.findIndex((x) => x <= 0);
    if (tube < 0) return log(g, 'warn', 'All torpedo tubes reloading.');
    o.tubes[tube] = TUBE_RELOAD;
    o.drones--;
    const c = targetContact(g);
    const hdg = norm(Math.round(c?.bearing ?? o.hdg));
    const n = g.stats.drones = (g.stats.drones ?? 0) + 1;
    g.drones.push({ id: g.seq++, n, x: o.x, y: o.y, hdg, run: 0, mode: 'passive', battery: DRONE_BATTERY, deep: o.depthT > LAYER_AT, pingT: 0 });
    log(g, 'good', `Tube ${tube + 1}: sonar drone ${n} away, bearing ${fmtBrg(hdg)}. It will run ${DRONE_RUN} nm and hover, listening. ${o.drones} left aboard.`, 'launch');
  },
  /** Switch the newest drone between passive listening, active pinging and decoy. */
  droneMode(g: Game, mode: DroneMode) {
    const d = g.drones[g.drones.length - 1];
    if (g.over || !d || d.mode === mode) return;
    d.mode = mode;
    log(g, mode === 'passive' ? 'info' : 'good', `Drone ${d.n}: ${mode === 'passive' ? 'passive, listening.' : mode === 'active' ? 'active sonar on, pinging every minute. Anyone who hears it will hunt the drone.' : 'decoy on, playing our noise. Torpedoes and hunters should go for it.'}`);
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

/**
 * An active ping from `src` (Tang, or one of its drones): echoes give exact fixes on what they
 * bounce off, and anyone with sonar within 60 nm hears where the ping came from.
 */
function pingFrom(g: Game, src: Vec & { hdg: number }, deep: boolean, what: string) {
  const o = g.own;
  let returns = 0;
  for (const v of g.vessels) {
    if (v === o || !v.alive || v.cls.kind === 'air') continue;
    const r = dist(src, v), b = brg(src, v);
    const layer = deep !== deepOf(v) ? 10 : 0;
    const size = v.cls.kind === 'surface' ? 8 : 0; // big steel hulls echo well
    const echo = 47 + size - 40 * Math.log10(Math.max(r, 0.1)) - layer - (src === o && inBaffles(o, b) ? 99 : 0);
    if (echo > 0) {
      returns++;
      const c = contactFor(g, v);
      if (!c.held) c.legHdg = o.hdg;
      c.held = true; c.ever = true; c.lastSeen = g.t; c.q = 1; c.bias = 0; c.bearing = brg(o, v);
      c.est = { x: v.x, y: v.y, t: g.t }; c.estErr = 0;
      log(g, 'contact', `${what}: ${contactLabel(c)} bearing ${fmtBrg(c.bearing)}, range ${fmtRng(dist(o, v))}.`);
    }
    // Close in that is a fix; far off only a rough bearing and range.
    if (v.ai && v.cls.threshold !== null && r < 60) {
      const near = r < 15, e = near ? 0 : r * 0.06;
      v.ai.knows = { x: src.x + gauss(g.r) * e, y: src.y + gauss(g.r) * e, t: g.t, deep, exact: near };
      v.ai.holdT = Math.max(v.ai.holdT, near ? 120 : 40);
      if (v.ai.mode === 'patrol') v.ai.mode = 'attack';
    }
  }
  return returns;
}

/** Drones swim out, hover, listen, ping or play decoy until their batteries run flat. */
function updateDrones(g: Game, dt: number) {
  for (const d of g.drones) {
    if (d.run < DRONE_RUN) {
      const step = DRONE_SPD * KT * dt;
      d.x += Math.sin(d.hdg * D2R) * step; d.y += Math.cos(d.hdg * D2R) * step; d.run += step;
      if (d.run >= DRONE_RUN) log(g, 'info', `Drone ${d.n} on station, ${fmtRng(dist(g.own, d))} from us, bearing ${fmtBrg(brg(g.own, d))}.`);
    }
    d.battery -= dt * (d.mode === 'passive' ? 1 : 3);
    if (d.mode === 'active' && g.t - d.pingT >= 60) {
      d.pingT = g.t;
      g.pings.push({ t: g.t, x: d.x, y: d.y });
      const n = pingFrom(g, d, d.deep, `Drone ${d.n} ping`);
      if (!n) log(g, 'info', `Drone ${d.n} ping: no return.`);
    }
    // A decoy drone is a countermeasure that keeps going: torpedo seekers can be drawn to it.
    if (d.mode === 'decoy') {
      const dec = g.decoys.find((x) => x.id === d.id);
      if (dec) { dec.x = d.x; dec.y = d.y; dec.life = 2; } else g.decoys.push({ id: d.id, side: 'us', x: d.x, y: d.y, life: 2, deep: d.deep });
    }
  }
  for (const d of g.drones) if (d.battery <= 0) log(g, 'warn', `Drone ${d.n}: battery flat. It has scuttled itself.`);
  g.drones = g.drones.filter((d) => d.battery > 0);
}

/** Contacts are named for the sensor that found them: Sierra (sonar), Victor (eyes), Romeo (radar), Echo (ESM). */
type Sensor = 'Sierra' | 'Victor' | 'Romeo' | 'Echo';
/** Quality from which the crew will call a contact's course and speed. */
export const MOTION_Q = 0.6;
/**
 * Target motion: with a good enough solution, the crew calls the contact's course and speed.
 * The error shrinks as the solution firms up, with the same lean as the range error.
 */
function updateMotion(g: Game) {
  for (const c of g.contacts) {
    const v = g.vessels.find((x) => x.id === c.vid);
    if (!v?.alive || !c.held || !c.est) continue;
    if (c.q >= MOTION_Q) {
      const e = 1 - c.q;
      c.motion = { crs: norm(v.hdg + c.bias * 60 * e), spd: Math.max(0, v.spd * (1 + c.bias * 0.8 * e)) };
    }
    if (g.t % 30 === 0) { c.trail.push({ x: c.est.x, y: c.est.y }); if (c.trail.length > 10) c.trail.shift(); }
  }
}

function contactFor(g: Game, v: Vessel, sensor: Sensor = 'Sierra'): Contact {
  let c = g.contacts.find((x) => x.vid === v.id);
  if (!c) {
    const n = g.contacts.filter((x) => x.name.startsWith(sensor)).length + 1;
    c = {
      id: g.seq++, vid: v.id, name: `${sensor} ${n}`, held: false, ever: false, lastSeen: -1e9, se: -99, seAvg: -10,
      bearing: null, q: 0, bias: 0, air: v.cls.kind === 'air', radarT: -1e9, radarHits: 0,
      est: null, estErr: 0, legHdg: 0, motion: null, trail: [], history: [], cavitating: false,
      sig: null, matches: [], classified: null, sighted: null, spotted: false,
    };
    g.contacts.push(c);
    if (g.selected === null) g.selected = c.id;
  }
  return c;
}

/** A launch makes a loud transient that anyone with sonar may hear. */
function transient(g: Game, src: Vec & { depthT?: number; deep?: boolean }, side: Side) {
  if (side === 'us') {
    for (const v of g.vessels) {
      if (v === g.own || !v.alive || !v.ai || v.cls.threshold === null) continue;
      if (excess(SL_LAUNCH, src, v, v.cls.threshold) > 0) {
        v.ai.knows = { x: src.x + gauss(g.r) * 0.8, y: src.y + gauss(g.r) * 0.8, t: g.t, deep: deepOf(src) };
        if (v.ai.mode === 'patrol') v.ai.mode = 'attack';
      }
    }
  } else if (excess(SL_LAUNCH, src, ownEars(g), g.own.cls.threshold!) > 0) {
    log(g, 'danger', `Launch transient, bearing ${fmtBrg(brg(g.own, src))}!`, 'alarm');
  }
}

function enemyFire(g: Game, v: Vessel, aim: Vec, deep: boolean, snap: boolean) {
  if (g.era === '1941') { v.ai!.cool = 300; return fireStraight(g, v, aim, deep); }
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

/** A WWII torpedo: runs straight at the aim point and hits whatever is in its way. */
export function fireStraight(g: Game, v: Vessel, aim: Vec, deep = false) {
  const w = WEAPONS.wwtorp;
  const hdg = brg(v, aim);
  g.stats.enemyFired++;
  g.weapons.push({
    id: g.seq++, type: 'wwtorp', side: 'enemy', label: w.short, x: v.x, y: v.y, hdg, ordHdg: hdg, spd: w.spd,
    run: 0, maxRun: w.maxRun, enableAt: 0.2, enabled: false, deep, wire: false, aim, contactId: null,
    target: null, rolled: new Set(), trail: [],
  });
  transient(g, v, 'enemy');
}

// ---- Weapons in flight -------------------------------------------------------------------
function updateWeapon(g: Game, w: Weapon, dt: number) {
  const spec = WEAPONS[w.type];
  const step = w.spd * KT * dt;
  w.run += step;
  // ASROC flies straight to the drop point and puts a Mk 54 in the water there.
  // TLAM: cruise to the site. Terrain matching over 2029 maps works on 1942 ground; the
  // terminal camera's scenes are 87 years out of date, so a few miss.
  if (spec.role === 'land' || w.land) {
    w.ordHdg = brg(w, w.aim);
    const mj = w.type === 'mjolnir';
    if (mj && !w.apex && w.run >= dist(w, w.aim)) { w.apex = true; log(g, 'good', `${w.label} at apex. Terminal dive at Mach 6.`); }
    if (dist(w, w.aim) <= step) {
      w.dead = true;
      const site = g.sites.find((x) => x.id === w.contactId);
      const hit = !!site && g.r() < (mj ? MJOLNIR_LAND_P : 0.85), n = mj ? MJOLNIR_LAND_HITS : 1;
      if (site) g.strikes.push({ t: g.t, siteId: site.id, siteName: site.name, kind: siteKind(site), hit, weapon: w.label, type: mj ? 'mjolnir' : 'tlam' });
      if (site && hit) {
        site.hits += n; g.flags.landHits = (g.flags.landHits ?? 0) + n;
        log(g, 'good', `${w.label}: impact on ${site.name}.`, 'boom');
      } else log(g, 'warn', `${w.label}: no impact report from ${site?.name ?? 'the target'}. Probably a miss.`);
      return;
    }
    return moveWeapon(g, w, spec, dt);
  }
  if (spec.role === 'asw') {
    w.ordHdg = brg(w, w.aim);
    if (dist(w, w.aim) <= step) {
      w.dead = true;
      dropTorpedo(g, 'mk54', 'us', w.aim, w.hdg, `Mk 54 (${w.label})`, w.contactId);
      log(g, 'good', `${w.label}: Mk 54 in the water at the drop point. Searching.`);
      return;
    }
    return moveWeapon(g, w, spec, dt);
  }
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

  // Mjolnir tops out its ballistic arc halfway there and comes down at Mach 6.
  if (w.type === 'mjolnir' && !w.apex && w.run >= dist(w, w.aim)) {
    w.apex = true;
    log(g, 'good', `${w.label} at apex. Terminal dive at Mach 6, seeker searching.`);
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
        if (r < (spec.missile ? Math.max(0.25, step) : Math.max(0.06, step))) {
          if (spec.role === 'aa' && g.r() > spec.pk!) {
            w.dead = true;
            return log(g, 'warn', `${w.label} missed ${(tgt as Vessel).cls.name}.`);
          }
          if (w.targetKind === 'vessel') return hit(g, w, tgt as Vessel);
          w.rolled.add((tgt as Decoy).id);
          w.target = null;
        }
      }
    }
    if (!w.target || w.targetKind === 'vessel') seek(g, w);
    // Mk 96: the seeker has something, so the rocket lights. Nothing can outrun it, and everyone hears it.
    if (w.type === 'mk96' && w.target && w.targetKind === 'vessel' && w.spd < MK96_SPRINT) {
      w.spd = MK96_SPRINT; w.wire = false;
      log(g, 'good', `${w.label}: target acquired. Rocket lit, ${MK96_SPRINT} knots and supercavitating. Wire cut.`, 'launch');
      transient(g, w, 'us');
    }
    // Unwired torpedoes with nothing on the seeker circle and switch layers to search.
    if (!w.target && !w.wire && (w.type === 'mk54' || w.type === 'apr3')) {
      w.ordHdg = norm(w.hdg + 4);
      w.layerT = (w.layerT ?? 0) + dt;
      if (w.layerT > 45) { w.layerT = 0; w.deep = !w.deep; }
    }
  }
  moveWeapon(g, w, spec, dt);
}

function moveWeapon(g: Game, w: Weapon, spec: (typeof WEAPONS)[WeaponKey], dt: number) {
  const rate = spec.role === 'aa' ? 20 : spec.missile ? 6 : 14;
  w.hdg = norm(w.hdg + clamp(angDiff(w.ordHdg, w.hdg), -rate * dt, rate * dt));
  w.x += Math.sin(w.hdg * D2R) * w.spd * KT * dt;
  w.y += Math.cos(w.hdg * D2R) * w.spd * KT * dt;
  if (g.t % (spec.missile ? 1 : 4) === 0) { w.trail.push({ x: w.x, y: w.y }); if (w.trail.length > 90) w.trail.shift(); }
  // Missiles that find nothing past their aim point destroy themselves.
  const overrun = spec.role === 'antiship' && w.enabled && !w.target && w.run > w.enableAt + 8 + spec.seeker;
  if (w.run >= w.maxRun || overrun) {
    w.dead = true;
    if (w.side === 'us') log(g, 'warn', spec.role === 'antiship' ? `${w.label} found no target and self-destructed.` : spec.role === 'aa' ? `${w.label} ran out of fuel without finding a target.` : `${w.label} ran out of fuel and shut down.`);
    else if (g.heard.has(w.id)) log(g, 'good', 'Enemy torpedo has run out of fuel.');
  }
}

function dropTorpedo(g: Game, type: 'mk54' | 'apr3', side: Side, at: Vec, hdg: number, label: string, contactId: number | null) {
  const spec = WEAPONS[type];
  g.weapons.push({
    id: g.seq++, type, side, label, x: at.x, y: at.y, hdg, ordHdg: hdg, spd: spec.spd,
    run: 0, maxRun: spec.maxRun, enableAt: 0.05, enabled: false, deep: false, wire: false,
    aim: { x: at.x, y: at.y }, contactId, target: null, rolled: new Set(), trail: [],
  });
}

function seek(g: Game, w: Weapon) {
  const spec = WEAPONS[w.type];
  const cone = spec.role === 'aa' ? AA_CONE : 30;
  const inCone = (obj: Vec, range: number) => dist(w, obj) < range && Math.abs(angDiff(brg(w, obj), w.hdg)) < cone;
  // A sprinting Mk 96 is far too fast to be fooled by a countermeasure.
  if (!spec.missile && !(w.type === 'mk96' && w.spd >= MK96_SPRINT)) {
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
    if (w.side === 'us' ? v.side === 'us' : v.side === 'enemy') continue;
    if (spec.role === 'aa' ? v.cls.kind !== 'air' : spec.role === 'antiship' ? v.cls.kind !== 'surface' : v.cls.kind === 'air') continue;
    const acq = !spec.missile && deepOf(v) !== w.deep ? spec.seeker / 2 : spec.seeker;
    // Torpedoes take the nearest return; anti-ship missiles take the ship nearest their aim point.
    const score = (x: Vessel) => (spec.role === 'antiship' ? dist(x, w.aim) : dist(w, x));
    if (inCone(v, acq) && (!best || score(v) < score(best))) best = v;
  }
  if (!best) return;
  w.target = best; w.targetKind = 'vessel';
  if (w.side === 'us') { if (w.wire || spec.missile || w.contactId !== null) log(g, 'good', `${w.label} has acquired a target.`); }
  else if (best === g.own) log(g, 'danger', 'Torpedo seeker has acquired us! Evade!', 'alarm');
}

function hit(g: Game, w: Weapon, v: Vessel) {
  const spec = WEAPONS[w.type];
  w.dead = true;
  v.hp -= v.cls.kind === 'surface' ? spec.surfaceDamage ?? spec.damage : spec.damage;
  g.blasts.push({ x: v.x, y: v.y, t: g.t, missile: spec.missile });
  if (v.side === 'us') {
    if (v.hp <= 0) { v.alive = false; log(g, 'danger', 'Torpedo hit. Flooding aft. We are lost.', 'boom'); return end(g, false, 'USS Tang was sunk.'); }
    return log(g, 'danger', 'Torpedo hit! Flooding, but holding.', 'boom');
  }
  const sunk = v.hp <= 0;
  if (w.side === 'us') {
    g.stats.hits++;
    g.hits.push({ t: g.t, vid: v.id, name: v.name, cls: v.cls.key, kind: v.cls.kind, weapon: w.type, label: w.label, sunk });
  }
  if (sunk) { v.alive = false; g.sunk.push({ name: v.name, cls: v.cls.key, side: v.side, by: w.side }); }
  const c = g.contacts.find((x) => x.vid === v.id);
  if (v.cls.kind === 'air') { log(g, 'good', `${w.label} hit. Splash one ${v.cls.name}.`, 'boom'); return checkGoal(g); }
  const who = c ? contactLabel(c) : 'an unseen ship';
  if (v.side === 'allied' && w.side === 'enemy') {
    log(g, 'danger', sunk ? `Explosion on bearing ${fmtBrg(brg(g.own, v))}: ${v.name} has been torpedoed and is sinking.` : `Explosion on bearing ${fmtBrg(brg(g.own, v))}: ${v.name} has been torpedoed.`, 'boom');
    return checkGoal(g);
  }
  if (v.side === 'allied') {
    g.stats.blueOnBlue++;
    log(g, 'danger', `${w.label} hit ${v.name}! She's a friendly ship.${sunk ? ` ${v.name} is sinking.` : ''}`, 'boom');
    if (sunk) return end(g, false, `${v.name} was sunk by our own weapon.`);
  } else {
    log(g, 'good', sunk ? `${w.label} hit ${who}. Breaking-up noises: ${v.name} is sinking.` : `${w.label} hit ${who}. Secondary explosions; she is slowing.`, 'boom');
  }
  // The whole group knows it is under attack and runs from the threat; escorts come hunting.
  if (v.side === 'enemy') alertGroup(g, norm(brg(w, v)), v.side, v);
  checkGoal(g);
}

/**
 * True when one of our weapons in flight looks set to arrive within `secs`: a torpedo or missile
 * homing on a target, an anti-ship missile or Tomahawk flying to its aim point, an ASROC about to drop.
 * The battle camera waits for these so that hits close together play as one clip.
 */
export function arrivingSoon(g: Game, secs: number): boolean {
  for (const w of g.weapons) {
    if (w.dead || w.side !== 'us') continue;
    const role = WEAPONS[w.type].role;
    const to = w.target && w.targetKind === 'vessel' ? w.target : role === 'land' || role === 'antiship' || role === 'asw' ? w.aim : null;
    if (!to || w.spd <= 0) continue;
    const eta = dist(w, to) / (w.spd * KT) + (role === 'asw' ? 30 : 0);
    if (eta <= secs) return true;
  }
  return false;
}

/**
 * Gunfire between surface ships (Tang plays no part): a hit takes one point. Used by mission
 * scripts for battleships shelling a convoy or a night melee off Guadalcanal.
 */
export function shellfire(g: Game, from: Vessel, at: Vessel, pHit: number) {
  if (!from.alive || !at.alive || g.r() > pHit) return;
  at.hp -= 1;
  g.blasts.push({ x: at.x + gauss(g.r) * 0.05, y: at.y + gauss(g.r) * 0.05, t: g.t, missile: false });
  if (at.hp > 0) return;
  at.alive = false;
  g.sunk.push({ name: at.name, cls: at.cls.key, side: at.side, by: from.side });
  log(g, at.side === 'enemy' ? 'good' : 'danger', `Gunfire: ${at.name} is burning and sinking, hit by ${from.name}.`, 'boom');
  checkGoal(g);
}

/** Win or lose on the mission goal. Called after every sinking and every tick. */
function checkGoal(g: Game) {
  if (g.over) return;
  const gl = g.goal;
  const sunkIds = (ids: number[]) => ids.filter((id) => !vesselById(g, id).alive && !vesselById(g, id).gone).length;
  if (gl.protect.length && sunkIds(gl.protect) > gl.maxLosses) return end(g, false, gl.lossText);
  if (gl.targets.length && sunkIds(gl.targets) >= gl.need) return end(g, true, gl.win);
  if (g.t >= g.timeLimit) end(g, gl.surviveWin, gl.surviveWin ? gl.win : gl.timeout);
}

export function end(g: Game, win: boolean, reason: string) { if (!g.over) g.over = { win, t: g.t, reason }; }

const isEscort = (v: Vessel) => /destroyer|corvette/.test(v.cls.type);
const ADJ: Record<string, string> = {
  Germany: 'German', Japan: 'Japanese', Russia: 'Russian', UK: 'British', US: 'US', Italy: 'Italian', Netherlands: 'Dutch',
  China: 'Chinese', India: 'Indian', Iran: 'Iranian', Brazil: 'Brazilian', 'South Africa': 'South African', Venezuela: 'Venezuelan',
  Australia: 'Australian', Norway: 'Norwegian', Turkey: 'Turkish', Pakistan: 'Pakistani', Liberia: 'merchant',
};
/** "The German group", "The Japanese force": how the log names the enemy. */
export const groupName = (g: Game) => {
  const e = g.vessels.find((v) => v.side === 'enemy' && v.cls.kind === 'surface');
  return e ? `The ${ADJ[e.cls.nation]} ${g.vessels.filter((v) => v.side === 'enemy' && v.cls.kind === 'surface').length > 3 ? 'force' : 'group'}` : 'The enemy';
};

/**
 * A group under attack: big ships turn away and run, escorts go hunting where they think the
 * submarine is (`near` is the ship that was hit or that saw us, so their datum is rough).
 */
function alertGroup(g: Game, fleeHdg: number, side: Side, near?: Vessel) {
  const o = g.own;
  for (const v of g.vessels) {
    if (!v.ai || !v.alive || v.side !== side || v.cls.kind !== 'surface') continue;
    if (isEscort(v) && v.ai.mode !== 'picket') {
      if (near && dist(v, near) > 15) continue;
      if (v.ai.mode !== 'hunt') v.ai.home = v.ai.mode;
      const e = 0.6 + dist(o, near ?? v) * 0.1;
      v.ai.mode = 'hunt'; v.ai.alertT = 1500; v.ai.cool = 0;
      v.ai.datum = { x: o.x + gauss(g.r) * e, y: o.y + gauss(g.r) * e, t: g.t, deep: false };
      v.ai.wp = { x: v.ai.datum.x, y: v.ai.datum.y };
      continue;
    }
    if (v.ai.mode !== 'transit' && v.ai.mode !== 'alert') continue;
    // Turn away from the threat, but keep running for the objective.
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
  // Passive drones out in the water: extra ears, linked back to the boat.
  const droneEars: Listener[] = g.drones.filter((d) => d.mode === 'passive').map((d) => ({ x: d.x, y: d.y, hdg: d.hdg, spd: 0, depthT: d.deep ? 2 : 1, array: true }));
  for (const v of g.vessels) {
    if (v === o || (v.cls.kind === 'air' && !dipping(v))) continue;
    const exists = g.contacts.find((x) => x.vid === v.id);
    if (!v.alive) { if (exists) exists.held = false; continue; }
    const own = excess(vesselSL(v), v, ears, o.cls.threshold!) + gauss(g.r) * 2;
    const byDrone = droneEars.length ? Math.max(...droneEars.map((l) => excess(vesselSL(v), v, l, o.cls.threshold!))) + gauss(g.r) * 2 : -99;
    const se = Math.max(own, byDrone);
    const r = dist(o, v);
    const seen = atPD && v.cls.kind === 'surface' && r < VISUAL_RANGE * visibility(g.env);
    if (se <= 0 && !seen && !exists) continue;
    const c = contactFor(g, v, se > 0 ? 'Sierra' : 'Victor');
    c.se = se;
    c.seAvg += (se - c.seAvg) * 0.05; // the display integrates over about a minute
    if (se > 0 || seen) {
      // Boat and drone both hearing it is a cross-fix: the solution firms up much faster.
      if (own > 0 && byDrone > 0) c.q = Math.min(0.97, c.q + dt / 200);
      const sd = seen ? 0.2 : clamp(3 - se * 0.25, 0.4, 3);
      const meas = norm(brg(o, v) + gauss(g.r) * sd);
      if (!c.held) {
        c.held = true;
        c.legHdg = o.hdg;
        if (c.q < 0.5) c.bias = (g.r() * 2 - 1) * 0.6;
        log(g, 'contact', `Conn, sonar: ${c.ever ? 'regained' : 'new contact'} ${contactLabel(c)}, bearing ${fmtBrg(meas)}${own <= 0 && byDrone > 0 && !seen ? ', heard by the drone' : ''}.`, c.ever ? undefined : 'contact');
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
        // Periscope with laser rangefinder: exact fix. The class is for the player to judge by eye.
        if (!c.spotted) log(g, 'contact', `Periscope: ship in sight, bearing ${fmtBrg(brg(o, v))}, range ${fmtRng(r)}. Select it and raise the periscope view (V) to identify.`);
        c.spotted = true; c.q = Math.max(c.q, 0.99); c.bias = 0;
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
        log(g, 'danger', `${v.name} has sighted our periscope! ${groupName(g)} is turning away and the escorts are coming.`, 'alarm');
        alertGroup(g, brg(o, v), 'enemy', v);
      }
    }
  }

  for (const w of g.weapons) {
    if (w.side !== 'enemy' || w.dead) continue;
    const tse = excess(SL_TORPEDO, w, ears, o.cls.threshold!);
    w.heardBrg = tse > 0 ? brg(o, w) : null;
    trackTorpedo(g, w);
    if (tse > 0 && !g.heard.has(w.id)) {
      g.heard.add(w.id);
      log(g, 'danger', `Torpedo in the water, bearing ${fmtBrg(w.heardBrg!)}, range about ${fmtRng(dist(o, w.heardEst!))}!`, 'alarm');
    }
  }
}

/** Sonar's track on a torpedo coming at us. A torpedo is loud and close, so the bearing is good from
 *  the start; the range starts rough and firms up over a minute or two of listening. The error is
 *  fixed per torpedo (no draw on the game's dice) and shrinks as the track builds. */
function trackTorpedo(g: Game, w: Weapon) {
  if (w.heardBrg == null) { w.heardEst = null; return; }
  const o = g.own;
  if (w.heardAt == null) { w.heardAt = g.t; w.heardTrail = []; }
  const u = (k: number) => (((w.id * 9301 + k * 49297) % 233280) / 233280) - 0.5;
  const decay = Math.exp(-(g.t - w.heardAt) / 90), r = dist(o, w);
  w.heardEst = offset(o, norm(w.heardBrg + u(1) * 6 * decay), Math.max(0.05, r * (1 + u(2) * 0.5 * decay)));
  const tr = w.heardTrail!;
  if (!tr.length || g.t - tr[tr.length - 1].t >= 10) { tr.push({ ...w.heardEst, t: g.t }); if (tr.length > 12) tr.shift(); }
  // Course and speed need a few fixes; then they start rough and firm up with the range.
  w.heardVel = g.t - w.heardAt >= 20 ? { hdg: norm(w.hdg + u(3) * 30 * decay), spd: w.spd * (1 + u(4) * 0.4 * decay) } : null;
}

// ---- Radar, ESM and eyes on aircraft ----------------------------------------------------------
function fixContact(g: Game, c: Contact, v: Vessel, err: number) {
  const o = g.own;
  const b = norm(brg(o, v) + gauss(g.r) * 0.5);
  const r = Math.max(0.05, dist(o, v) + gauss(g.r) * err);
  if (!c.held) {
    c.held = true;
    c.legHdg = o.hdg;
    if (!c.ever) log(g, 'contact', `Radar: new contact ${contactLabel(c)}${c.air ? ', air' : ''}, bearing ${fmtBrg(b)}, range ${fmtRng(r)}.`, 'contact');
    c.ever = true;
  }
  c.lastSeen = g.t; c.radarT = g.t;
  c.bearing = b; c.bias = 0;
  c.q = Math.max(c.q, 0.95);
  c.est = { ...offset(o, b, r), t: g.t };
  c.estErr = err;
}

function classifyBy(g: Game, c: Contact, v: Vessel, how: string) {
  if (c.classified === v.cls.key) return;
  c.sighted = v.cls.key;
  c.classified = v.cls.key;
  const friend = isFriendlyClass(v.cls.key);
  log(g, friend ? 'good' : 'contact', `${how}: ${c.name} classified ${v.cls.name}, ${v.cls.type}${friend ? '. Friendly, do not fire.' : '.'}`);
}

function radarAndAir(g: Game) {
  const o = g.own;
  const atPD = o.depthT < PD_MAX;
  if (o.radar && !atPD) { o.radar = false; log(g, 'info', 'Radar secured, mast is under.'); }
  const sweep = o.radar && g.t % RADAR.sweep === 0;
  if (sweep) g.sweeps.push({ t: g.t });
  for (const v of g.vessels) {
    if (v === o || v.cls.kind === 'sub') continue;
    let c = g.contacts.find((x) => x.vid === v.id) ?? null;
    if (!v.alive) { if (c) c.held = false; continue; }
    const r = dist(o, v);
    const air = v.cls.kind === 'air';
    if (sweep) {
      const reach = air ? (flyingLow(v) ? RADAR.airLow : RADAR.airHigh) : RADAR.horizon;
      if (r <= reach) {
        c = c ?? contactFor(g, v, 'Romeo');
        const idAt = air ? RADAR.classifyAir : RADAR.classify;
        fixContact(g, c, v, r <= idAt ? 0.05 : 0.3);
        c.radarHits++;
        // Close enough, the return is clear enough to identify; beyond, it is only a blip.
        if (r <= idAt && c.classified !== v.cls.key) classifyBy(g, c, v, 'Radar');
      }
    }
    if (!air) continue;
    // Eyes and ESM on aircraft, at periscope depth. In 1941 only radar finds aircraft.
    if (g.era === '2029' && atPD && r < AIR_VISUAL_RANGE * visibility(g.env) && g.r() < 0.05) {
      c = c ?? contactFor(g, v, 'Victor');
      if (!c.held || !c.est || g.t - c.lastSeen > 10) log(g, 'contact', `Periscope: aircraft, bearing ${fmtBrg(brg(o, v))}. Raise the periscope view (V) to identify.`);
      c.held = true; c.ever = true; c.lastSeen = g.t; c.bearing = brg(o, v); c.spotted = true;
      if (!c.est || g.t - c.radarT > RADAR.sweep * 3) { c.est = { ...offset(o, c.bearing, r * (0.8 + g.r() * 0.4)), t: g.t }; c.estErr = r * 0.2; }
    }
    if (atPD && v.cls.emitter && r < RADAR.esm) {
      c = c ?? contactFor(g, v, 'Echo');
      if (!c.held) { c.held = true; c.ever = true; log(g, 'contact', `ESM: airborne search radar, bearing ${fmtBrg(brg(o, v))}.`, 'contact'); }
      c.lastSeen = g.t;
      c.bearing = norm(brg(o, v) + gauss(g.r) * 2);
      if (g.t - c.radarT > RADAR.sweep * 3) c.est = null; // bearing only, no range
      if (!c.classified) classifyBy(g, c, v, 'ESM');
    }
    if (c?.held && g.t - c.lastSeen > 30) { c.held = false; log(g, 'warn', `Lost ${contactLabel(c)}.`); }
  }
}

/** Anyone who can see the launch knows roughly where we are. */
function launchSeen(g: Game) {
  const o = g.own;
  for (const v of g.vessels) {
    if (!v.alive || v.side !== 'enemy' || v.cls.kind !== 'air' || !v.ai) continue;
    const r = dist(o, v);
    if (r > 20) continue;
    if (v.ai.mode === 'orbit') {
      if (!alerted(g)) log(g, 'danger', `${v.cls.name} has seen our missile launch! ${groupName(g)} is turning away.`, 'alarm');
      alertGroup(g, brg(o, vesselById(g, v.ai.leader!)), 'enemy', v);
    } else if (v.ai.mode === 'wander' || v.ai.mode === 'strike') {
      continue;
    } else airDatum(g, v, { x: o.x, y: o.y, t: g.t, deep: false, exact: true }, 'missile launch');
  }
}
const alerted = (g: Game) => g.vessels.some((v) => v.ai?.mode === 'alert');

// ---- Enemy aircraft ----------------------------------------------------------------------------
function airDatum(g: Game, v: Vessel, k: Knowledge, why: string) {
  const ai = v.ai!;
  const fresh = !ai.datum || ai.mode !== 'prosecute';
  ai.datum = k; ai.mode = 'prosecute'; ai.wp = { x: k.x, y: k.y };
  if (fresh && g.own.depthT < PD_MAX && dist(g.own, v) < RADAR.esm) log(g, 'danger', `ESM: ${v.cls.name} search radar bearing is steadying on us (${why}).`, 'alarm');
  shareDatum(g, v.side, k);
}

/** Aircraft pass their datum to the submarine by datalink. */
function shareDatum(g: Game, side: Side, k: Knowledge) {
  for (const s of g.vessels) {
    if (!s.alive || s.side !== side || s.cls.kind === 'air' || s.cls.threshold === null || !s.ai) continue;
    s.ai.knows = { x: k.x, y: k.y, t: g.t, deep: k.deep };
    if (s.ai.mode === 'patrol') s.ai.mode = 'attack';
  }
}

function airAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!, o = g.own;
  if (ai.mode === 'orbit') {
    // Floatplane circling ahead of its ship, looking for periscopes.
    const lead = vesselById(g, ai.leader!);
    ai.phase = norm(ai.phase! + dt * 0.6);
    const spot = offset(lead, lead.hdg + ai.phase!, ai.rng!);
    v.ordHdg = brg(v, spot); v.ordSpd = 140;
    const r = dist(o, v);
    if (o.depthT < PD_MAX && r < 5 && g.r() < 0.012 * (1 - r / 5) && !alerted(g)) {
      log(g, 'danger', `The ${v.cls.name} has spotted our periscope! ${groupName(g)} is turning away at full speed.`, 'alarm');
      alertGroup(g, brg(o, lead), 'enemy', v);
      // Its two 50 kg bombs are the only way it can touch us.
      if (ai.torps! > 0) {
        ai.torps = 0;
        g.blasts.push({ x: o.x + gauss(g.r) * 0.05, y: o.y + gauss(g.r) * 0.05, t: g.t, missile: false });
        if (g.r() < 0.35) { o.hp -= 1; log(g, 'danger', 'Bomb hit aft! Minor flooding, still in the fight.', 'boom'); }
        else log(g, 'warn', 'Two bombs close aboard. No damage.', 'boom');
      }
    }
    return;
  }
  if (ai.mode === 'strike') {
    // A strike flight on its way to the target. Reaching it is the mission script's business.
    v.ordSpd = ai.cruise || 140; v.ordHdg = brg(v, ai.goal!);
    if (dist(v, ai.goal!) < 3) { v.alive = false; v.gone = true; g.flags.strikesThrough = (g.flags.strikesThrough ?? 0) + 1; }
    return;
  }
  if (ai.mode === 'wander') {
    // A patrol plane or flying boat quartering its area, watching for periscopes.
    v.ordSpd = ai.cruise || 120;
    if (!ai.wp || dist(v, ai.wp) < 2) ai.wp = offset(ai.center!, g.r() * 360, g.r() * (ai.rng ?? 30));
    v.ordHdg = brg(v, ai.wp);
    const r = dist(o, v);
    if (o.depthT < PD_MAX && r < 6 && g.r() < 0.01 * (1 - r / 6)) {
      log(g, 'danger', `${v.name} has spotted our periscope and is signalling the fleet.`, 'alarm');
      alertGroup(g, brg(o, v), 'enemy', o);
    }
    return;
  }
  if (HELOS.has(v.cls.key)) return heloAI(g, v, dt);
  // Il-38: search the box laying sonobuoys; on a datum, seed buoys round it and attack.
  v.ordSpd = ai.mode === 'prosecute' ? 300 : 230;
  if (dist(v, ai.wp!) < 1.5) {
    if (ai.mode === 'prosecute' && ai.datum) {
      const d = ai.datum;
      if (d.exact && g.t - d.t < 30 && ai.torps! > 0 && ai.cool <= 0) {
        ai.torps!--; ai.cool = 600; g.stats.enemyFired++;
        dropTorpedo(g, 'apr3', 'enemy', d, v.hdg, 'APR-3', null);
        d.exact = false;
      } else if (g.buoys.length < 24) {
        for (let i = 0; i < 4; i++) dropBuoy(g, v, offset(d, i * 90 + 45, 1.2), i % 2 === 1);
      }
      ai.wp = offset(d, g.r() * 360, 3);
      if (g.t - d.t > 900) { ai.mode = 'search'; ai.datum = null; }
    } else {
      ai.wp = offset(ai.center!, g.r() * 360, 4 + g.r() * 16);
    }
  }
  v.ordHdg = brg(v, ai.wp!);
  ai.cool = Math.max(0, ai.cool - dt);
  ai.buoyT! -= dt;
  if (ai.mode === 'search' && ai.buoyT! <= 0 && dist(v, ai.center!) < 25) { ai.buoyT = 180; dropBuoy(g, v, v, g.r() < 0.3); }
  // Masts and periscope show on its radar a few miles out; our radar shows on its ESM far out.
  const r = dist(o, v);
  if (o.depthT < PD_MAX && r < 12 && g.r() < 0.02 * (1 - r / 12)) airDatum(g, v, { x: o.x, y: o.y, t: g.t, deep: false, exact: true }, 'periscope on its radar');
  if (o.radar && r < RADAR.esm && (!ai.datum || g.t - ai.datum.t > 120)) {
    const e = r * 0.1;
    airDatum(g, v, { x: o.x + gauss(g.r) * e, y: o.y + gauss(g.r) * e, t: g.t, deep: false, exact: r < 10 }, 'our radar on its ESM');
  }
}

const BUOY_THRESHOLD = 31; // a small hydrophone: hears us when fast or close, not when slow

const SL_SPLASH = 108;    // a sonobuoy hitting the water and deploying its hydrophone
const DIP_THRESHOLD = 26; // a dipping sonar hears better than a buoy

/** Sonobuoy splashes are audible, and give away where the aircraft is working. */
function dropBuoy(g: Game, by: Vessel, at: Vec, deep: boolean) {
  const o = g.own;
  if (underIce(g, at)) return; // nothing to drop a buoy into on the pack
  const heard = excess(SL_SPLASH, { x: at.x, y: at.y, depthT: 1 }, ownEars(g), o.cls.threshold!) + gauss(g.r) * 2 > 0;
  const r = dist(o, at);
  const b = norm(brg(o, at) + gauss(g.r) * 2);
  const est = heard ? offset(o, b, r * (1 + gauss(g.r) * 0.2)) : null;
  g.buoys.push({ id: g.seq++, x: at.x, y: at.y, life: 2400, deep, heard, hits: 0, est });
  if (!heard) return;
  // The splash puts the aircraft on that bearing: a contact a missile can be sent down.
  const c = contactFor(g, by, 'Sierra');
  const first = !c.held;
  c.held = true; c.ever = true; c.lastSeen = g.t; c.bearing = b;
  if (g.t - c.radarT > RADAR.sweep * 3) { c.est = { ...est!, t: g.t }; c.estErr = r * 0.25; }
  if (first || g.t - g.splashT > 60) {
    g.splashT = g.t;
    log(g, 'warn', `Sonar: sonobuoy splash, bearing ${fmtBrg(b)}, about ${fmtRng(r)}. Aircraft working there: ${contactLabel(c)}.`, first ? 'contact' : undefined);
  }
}

export const dipping = (v: Vessel) => v.ai?.mode === 'dip';

/** Ka-27PL: fly to a spot, hover and dip the sonar, listen, move on. Attack a close contact. */
function heloAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!, o = g.own;
  ai.cool = Math.max(0, ai.cool - dt);
  if (ai.mode === 'dip') {
    v.ordSpd = 0;
    ai.dipT! -= dt;
    const se = excess(vesselSL(o), o, { x: v.x, y: v.y, hdg: 0, spd: 0, depthT: v.depthT, array: true }, DIP_THRESHOLD) + gauss(g.r) * 2;
    ai.hits = se > 0 ? ai.hits! + dt : Math.max(0, ai.hits! - dt);
    if (ai.hits! >= 15) {
      ai.hits = 0;
      const r = dist(o, v), e = Math.max(0.2, r * 0.25);
      ai.datum = { x: o.x + gauss(g.r) * e, y: o.y + gauss(g.r) * e, t: g.t, deep: o.depthT > LAYER_AT, exact: r < 3 };
      shareDatum(g, v.side, ai.datum);
      if (ai.datum.exact && ai.torps! > 0 && ai.cool <= 0) ai.dipT = 0; // raise the dome and go in
    }
    if (ai.dipT! <= 0) {
      v.depthT = 0;
      const d = ai.datum;
      if (d && g.t - d.t < 60 && d.exact && ai.torps! > 0) { ai.mode = 'prosecute'; ai.wp = { x: d.x, y: d.y }; }
      else { ai.mode = 'search'; ai.wp = d && g.t - d.t < 600 ? offset(d, g.r() * 360, 3) : offset(ai.center!, g.r() * 360, 4 + g.r() * 12); }
    }
    return;
  }
  v.ordSpd = 120;
  v.ordHdg = brg(v, ai.wp!);
  if (dist(v, ai.wp!) > 1) return;
  const d = ai.datum;
  if (ai.mode === 'prosecute' && d && ai.torps! > 0) {
    ai.torps!--; ai.cool = 600; g.stats.enemyFired++;
    dropTorpedo(g, 'apr3', 'enemy', d, v.hdg, 'APR-3', null);
    d.exact = false;
    ai.mode = 'search'; ai.wp = offset(d, g.r() * 360, 4);
    return;
  }
  ai.mode = 'dip'; ai.dipT = 180; ai.hits = 0;
  v.spd = v.ordSpd = 0;
  v.depthT = g.r() < 0.5 ? 2 : 1; // dome above or below the layer
}

/** Sonobuoys listen for us; a few seconds of holding contact gives the aircraft a datum. */
function updateBuoys(g: Game, dt: number) {
  const o = g.own;
  // Whichever patrol aircraft is working the buoys (Il-38, KQ-200, P-8, Tu-142...) gets the datum.
  const il = g.vessels.find((v) => v.alive && v.side === 'enemy' && v.cls.kind === 'air' && !HELOS.has(v.cls.key) && (v.ai?.mode === 'search' || v.ai?.mode === 'prosecute'))
    ?? g.vessels.find((v) => v.alive && v.cls.key === 'il38');
  for (const b of g.buoys) {
    b.life -= dt;
    if (!il) continue;
    const se = excess(vesselSL(o), o, { x: b.x, y: b.y, hdg: 0, spd: 0, depthT: b.deep ? 2 : 1, array: true }, BUOY_THRESHOLD) + gauss(g.r) * 2;
    b.hits = se > 0 ? b.hits + dt : Math.max(0, b.hits - dt);
    if (b.hits >= 10) {
      b.hits = 0;
      const e = Math.max(0.2, dist(o, b) * 0.4);
      airDatum(g, il, { x: o.x + gauss(g.r) * e, y: o.y + gauss(g.r) * e, t: g.t, deep: o.depthT > LAYER_AT, exact: dist(o, b) < 1.2 }, 'sonobuoy contact');
    }
  }
  g.buoys = g.buoys.filter((b) => b.life > 0);
}

function updateSignatures(g: Game) {
  const lib = g.library;
  for (const c of g.contacts) {
    const v = vesselById(g, c.vid);
    if (c.air && !(dipping(v) && c.held)) {
      c.sig = null;
      c.matches = c.classified ? [{ key: c.classified, name: CLASSES[c.classified].name, pct: 100 }] : [];
      continue;
    }
    if (!c.held || !v.alive) continue;
    c.sig = signatureView(v.cls, c.seAvg, v.spd, () => gauss(g.r));
    c.matches = matchClasses(c.sig, lib.filter((k) => (CLASSES[k].kind === 'air') === c.air), c.sighted);
  }
}

// ---- AI ------------------------------------------------------------------------------------
/** Depth charges go off about 20 s after they are rolled. Set for 50 to 400 ft: deep water is safe. */
const CHARGE_DEEPEST = 1.35;
function depthCharges(g: Game) {
  const o = g.own;
  const due = g.charges.filter((c) => c.t <= g.t);
  if (!due.length) return;
  g.charges = g.charges.filter((c) => c.t > g.t);
  const near = Math.min(...due.map((c) => dist(o, c)));
  for (const c of due) g.blasts.push({ x: c.x, y: c.y, t: g.t, missile: false });
  if (near > 3) return;
  if (near < 0.12 && o.depthT <= CHARGE_DEEPEST) {
    o.hp -= 1;
    if (o.hp <= 0) { o.alive = false; log(g, 'danger', 'Depth charges right on top of us. The hull is breached.', 'boom'); return end(g, false, 'USS Tang was sunk by depth charges.'); }
    log(g, 'danger', `Depth charges close aboard! Damage aft, flooding under control. ${o.depthT > LAYER_AT ? '' : 'Go deep: they are set shallow.'}`, 'boom');
  } else log(g, 'warn', near < 0.5 ? (o.depthT > CHARGE_DEEPEST ? 'Depth charges, well above us. They are set too shallow to reach 700 feet.' : 'Depth charges, close! Go deep.') : 'Depth charges exploding in the distance.', 'boom');
}

/** A WWII escort hunting: run to the datum, sweep around it with its sonar, and roll a pattern on a fix. */
function huntAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!, o = g.own;
  ai.alertT -= dt; ai.cool = Math.max(0, ai.cool - dt);
  const r = dist(v, o);
  // Its sonar (ASDIC) finds a quiet boat only close in, and hardly at all below the layer.
  const p = r < 1.5 ? (o.depthT > LAYER_AT ? 0.004 : 0.03) * (o.spd > 12 ? 2 : 1) : 0;
  if (g.r() < p * dt) {
    if (!ai.datum?.exact) log(g, 'danger', `Sonar: ${v.name}'s sonar has us, bearing ${fmtBrg(brg(o, v))}. She's starting her attack run.`, 'ping');
    ai.datum = { x: o.x + gauss(g.r) * 0.12, y: o.y + gauss(g.r) * 0.12, t: g.t, deep: o.depthT > LAYER_AT, exact: true };
    ai.wp = { x: ai.datum.x, y: ai.datum.y };
  }
  if (!ai.wp) ai.wp = { x: v.x, y: v.y };
  v.ordHdg = brg(v, ai.wp);
  v.ordSpd = dist(v, ai.wp) > 1 ? Math.min(25, v.cls.maxSpd) : 15;
  if (dist(v, ai.wp) < 0.15) {
    const d = ai.datum;
    // A modern escort on a fix drops a lightweight torpedo instead of rolling depth charges.
    if (d?.exact && g.t - d.t < 150 && ai.cool <= 0 && g.era !== '1941') {
      enemyFire(g, v, d, d.deep, false);
      d.exact = false;
    } else if (d?.exact && g.t - d.t < 150 && ai.cool <= 0) {
      ai.cool = 90; g.flags.patterns = (g.flags.patterns ?? 0) + 1;
      for (let i = 0; i < 5; i++) g.charges.push({ ...offset(d, i * 72, i ? 0.08 : 0), t: g.t + 18 + i });
      d.exact = false;
    }
    ai.wp = d ? offset(d, g.r() * 360, 0.3 + g.r() * 1.5) : offset(v, g.r() * 360, 1);
  }
  if (ai.alertT <= 0) { ai.mode = ai.home ?? 'station'; ai.datum = null; }
}

/** A picket boat drifting on its station; it radios a report the moment it sees a warship. */
function picketAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!, o = g.own;
  if (!ai.wp || dist(v, ai.wp) < 0.5) ai.wp = offset(ai.center!, g.r() * 360, g.r() * 3);
  v.ordHdg = brg(v, ai.wp); v.ordSpd = 6;
  if (v.side !== 'enemy') return; // a friendly patrol boat just keeps its beat
  const sees = g.vessels.some((x) => x.alive && x !== o && x.side !== 'enemy' && x.cls.kind === 'surface' && dist(x, v) < 12)
    || (o.depthT < PD_MAX && dist(o, v) < 3 && g.r() < 0.01);
  if (sees || ai.reportT !== undefined) {
    if (ai.reportT === undefined) { ai.reportT = 0; log(g, 'danger', `Radio intercept: ${v.name} is transmitting, bearing ${fmtBrg(brg(o, v))}. She has seen something. Stop her before the message gets through!`, 'alarm'); }
    ai.reportT += dt;
  }
}

function surfaceAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!;
  // Modern sub hunters search, attack and dodge torpedoes as a submarine does, on the surface.
  if (v.cls.threshold !== null && (ai.mode === 'patrol' || ai.mode === 'attack' || ai.mode === 'evade')) return subAI(g, v, dt);
  if (ai.mode === 'hunt') return huntAI(g, v, dt);
  if (ai.mode === 'picket') return picketAI(g, v, dt);
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

/** WWII submarine attacking surface ships (or a midget making for a harbour), not hunting us. */
function raiderAI(g: Game, v: Vessel, dt: number) {
  const ai = v.ai!, o = g.own;
  ai.cool = Math.max(0, ai.cool - dt);
  const threat = g.weapons.find((w) => w.side === 'us' && !w.dead && !WEAPONS[w.type].missile && dist(w, v) < 3);
  if (threat) { v.ordHdg = brg(threat, v); v.ordSpd = v.cls.maxSpd; v.ordDepth = 2; return; }
  v.ordDepth = 1;
  if (ai.goal) { v.ordHdg = brg(v, ai.goal); v.ordSpd = ai.cruise || 6; return; }
  let prey = ai.prey != null ? vesselById(g, ai.prey) : null;
  if (!prey?.alive) {
    prey = null;
    for (const x of g.vessels) if (x.alive && x !== o && x.side !== 'enemy' && x.cls.kind === 'surface' && (!prey || dist(v, x) < dist(v, prey))) prey = x;
    ai.prey = prey?.id ?? null;
  }
  if (!prey) { v.ordSpd = 4; return; }
  const r = dist(v, prey);
  // Aim off for the target's run while the torpedo travels.
  const lead = offset(prey, prey.hdg, prey.spd * (r / WEAPONS.wwtorp.spd));
  v.ordHdg = brg(v, r > 2 ? offset(prey, prey.hdg, Math.min(6, r * 0.5)) : lead);
  v.ordSpd = r > 5 ? Math.min(v.cls.maxSpd, 14) : 6;
  if (r < 1.6 && ai.cool <= 0 && (ai.torps ?? 6) > 0) {
    ai.torps = (ai.torps ?? 6) - 1; ai.cool = 300;
    fireStraight(g, v, lead);
    fireStraight(g, v, offset(lead, prey.hdg, 0.15));
  }
}

function subAI(g: Game, v: Vessel, dt: number) {
  const o = g.own, ai = v.ai!;
  // Allied boats go where their mission script sends them; their fights are settled by `skirmish` in kit.ts.
  if (v.side !== 'enemy') return;
  if (ai.mode === 'raider') return raiderAI(g, v, dt);
  // A decoy drone plays a loud recording of Tang, far louder than Tang creeping: whichever sounds louder is the one hunted.
  let heard: Vec & { deep: boolean } = { x: o.x, y: o.y, deep: o.depthT > LAYER_AT };
  let se = excess(vesselSL(o), o, v, v.cls.threshold!) + gauss(g.r) * 2;
  for (const d of g.drones) {
    if (d.mode !== 'decoy') continue;
    const sd = excess(Math.max(vesselSL(o) + 3, DRONE_DECOY_SL), d, v, v.cls.threshold!) + gauss(g.r) * 2;
    if (sd > se) { se = sd; heard = { x: d.x, y: d.y, deep: d.deep }; }
  }
  if (se > 0) {
    const err = dist(heard, v) * 0.12;
    ai.knows = { x: heard.x + gauss(g.r) * err, y: heard.y + gauss(g.r) * err, t: g.t, deep: heard.deep };
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
    // Close to firing range but not to point blank, where a torpedo can't arm in time: inside 3 nm, open out on a beam course.
    v.ordHdg = r < 3 ? norm(brg(v, ai.knows) + 100) : brg(v, ai.knows);
    v.ordSpd = r > 6 ? 12 : 7;
    v.ordDepth = ai.knows.deep ? 2 : 1;
    const solved = ai.knows.exact || ai.holdT >= 90;
    if (solved && r < 8 && r > 1.2 && ai.cool <= 0 && g.t - ai.knows.t < 120) {
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
    if (v === o || !v.alive || (v.cls.kind === 'air' && !dipping(v))) continue;
    const se = excess(vesselSL(v), v, ears, o.cls.threshold!);
    add(brg(o, v), clamp((se + 12) / 22, 0, 1) * (0.7 + 0.3 * g.r()), v.cls.kind === 'surface' ? 2.8 : 2.2);
  }
  for (const w of g.weapons) if (!w.dead && !WEAPONS[w.type].missile) add(brg(o, w), clamp((excess(SL_TORPEDO, w, ears, o.cls.threshold!) + 10) / 20, 0, 1.2), 1.6);
  for (const d of g.decoys) add(brg(o, d), clamp((excess(SL_DECOY, d, ears, o.cls.threshold!) + 10) / 20, 0, 1), 1.8);
  for (let i = 0; i < WF_BINS; i++) if (baffle[i]) row[i] *= 0.15;
  return { row, baffle, t: g.t };
}

// ---- Tick ----------------------------------------------------------------------------------------
export type MatchKind = 'speed' | 'course' | 'bearing';
const MATCH_FLAG: Record<MatchKind, string> = { speed: 'matchSpd', course: 'matchCrs', bearing: 'matchBrg' };
/** Steering by hand ends any course or bearing match. */
function stopSteering(g: Game) {
  if (g.flags.matchCrs) { g.flags.matchCrs = 0; log(g, 'info', 'No longer matching the target\'s course.'); }
  if (g.flags.matchBrg) { g.flags.matchBrg = 0; log(g, 'info', 'No longer steering at the target\'s bearing.'); }
}
/** Follow the matched contacts: speed and course from the solution, bearing from sonar. A contact lost for two minutes ends its match. */
function keepMatch(g: Game) {
  for (const what of ['speed', 'course', 'bearing'] as const) {
    const key = MATCH_FLAG[what];
    if (!g.flags[key]) continue;
    const c = contactById(g, g.flags[key]);
    // A contact that fades for a moment (the array settling after a turn) keeps its match; two minutes lost ends it.
    if (c && !c.held && g.t - c.lastSeen <= 120 && vesselById(g, c.vid).alive) continue;
    if (!c || !c.held || !vesselById(g, c.vid).alive || (what !== 'bearing' && !c.motion) || (what === 'bearing' && c.bearing === null)) {
      g.flags[key] = 0;
      if (!g.flags.matchSpd && !g.flags.matchCrs && !g.flags.matchBrg) log(g, 'warn', 'Lost the target we were matching. Holding present course and speed.');
      continue;
    }
    if (what === 'speed') g.own.ordSpd = Math.round(clamp(c.motion!.spd, 0, g.own.cls.maxSpd));
    else g.own.ordHdg = norm(Math.round(what === 'course' ? c.motion!.crs : c.bearing!));
  }
}

export function tick(g: Game, dt = 1) {
  if (g.over) return;
  g.t += dt;
  ambient = ambientDb(g.env);
  const o = g.own;
  for (const v of g.vessels) {
    if (!v.alive) continue;
    if (v.ai) ({ surface: surfaceAI, sub: subAI, air: airAI })[v.cls.kind](g, v, dt);
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
  updateHazards(g);
  if (g.over) return;
  if (g.drones.length) updateDrones(g, dt);
  ownSensors(g, dt);
  radarAndAir(g);
  updateBuoys(g, dt);
  g.wfTimer -= dt;
  if (g.wfTimer <= 0) { g.wfTimer = 3; g.waterfall = waterfallRow(g); updateSignatures(g); }
  depthCharges(g);
  updateMotion(g);
  if (g.flags.matchSpd || g.flags.matchCrs || g.flags.matchBrg) {
    // Selecting another contact ends every match, so the boat holds course and speed instead of swinging to the new one.
    const on = [g.flags.matchSpd, g.flags.matchCrs, g.flags.matchBrg].find(Boolean);
    if (g.selected !== on) {
      g.flags.matchSpd = g.flags.matchCrs = g.flags.matchBrg = 0;
      log(g, 'info', 'New target selected: match toggles off. Holding present course and speed.');
    } else if (g.t % 5 === 0) keepMatch(g);
  }
  g.script?.(g);
  checkGoal(g);
}

/** Degrees per minute of bearing drift on a held contact, or null. */
export function bearingRate(c: Contact): number | null {
  const h = c.history;
  if (h.length < 4) return null;
  const a = h[Math.max(0, h.length - 7)], b = h[h.length - 1];
  return b.t === a.t ? null : angDiff(b.b, a.b) / ((b.t - a.t) / 60);
}

export const missileDepthOk = (g: Game) => g.own.depthT <= MISSILE_MAX_DEPTH;
export const atPeriscopeDepth = (g: Game) => g.own.depthT < PD_MAX;

/** The vessel behind a contact, if it can be seen through the periscope right now. */
export function inPeriscope(g: Game, c: Contact | null): Vessel | null {
  if (!c || !atPeriscopeDepth(g)) return null;
  const v = vesselById(g, c.vid);
  if (!v.alive) return null;
  const r = dist(g.own, v);
  if (v.cls.kind === 'surface') return r < VISUAL_RANGE * visibility(g.env) ? v : null;
  if (v.cls.kind === 'air') return r < AIR_VISUAL_RANGE * visibility(g.env) && c.held ? v : null;
  return null;
}
export { VISUAL_RANGE, AIR_VISUAL_RANGE };
