// The sea itself: minefields, pack ice and storms. Missions switch these on in their build;
// the tick runs `updateHazards` once a second. No DOM, deterministic like the rest of the sim.

import { brg, dist, fmtBrg, type Vec } from './math';
import { depthT, end, log, type Game, type Side, type Vessel } from './sim';

/**
 * A mine on the bottom or on a mooring. Enemy mines threaten Tang and allied ships; mines Tang
 * lays sink enemy ships that pass over them. `found` means Tang's sonar has it marked on the plot.
 */
export interface Mine extends Vec { id: number; side: Side; found: boolean }

/**
 * Weather and ice. `sea` is the sea state, 0 calm to 6 a full gale: wave noise covers quiet
 * contacts for everyone, and spray and swell cut what the periscope can see. Under `ice`, Tang
 * can't come shallower than the ice keels except in the open water of a polynya, which also
 * means no masts, radar or missile launches; aircraft can't drop sonobuoys on the pack.
 */
export interface Env { sea: number; ice: boolean; polynyas: (Vec & { r: number })[] }
export const calmSea = (): Env => ({ sea: 2, ice: false, polynyas: [] });

/** How close a mine has to be to go off under a hull, and how far the HF mine-hunting sonar sees one. */
export const MINE_LETHAL = 0.1, MINE_HF_SLOW = 1.0, MINE_HF_FAST = 0.4, MINE_PING = 3;
const MINE_DAMAGE = 3;
/** Ice keels hang down to about this depth: under the pack, this is as shallow as Tang can go. */
export const ICE_FLOOR_FT = 200;

/** Lay a line of mines from `a` to `b`, `n` of them, jittered so they don't sit on a ruler line. */
export function mineLine(g: Game, a: Vec, b: Vec, n: number, side: Side = 'enemy', jitter = 0.15): Mine[] {
  const out: Mine[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const m: Mine = {
      id: g.seq++, side, found: side === 'us',
      x: a.x + (b.x - a.x) * f + (g.r() * 2 - 1) * jitter, y: a.y + (b.y - a.y) * f + (g.r() * 2 - 1) * jitter,
    };
    g.mines.push(m);
    out.push(m);
  }
  return out;
}
/** Scatter `n` mines in a circle of radius `rad` around `c`. */
export function mineField(g: Game, c: Vec, rad: number, n: number, side: Side = 'enemy'): Mine[] {
  const out: Mine[] = [];
  for (let i = 0; i < n; i++) {
    const a = g.r() * Math.PI * 2, d = Math.sqrt(g.r()) * rad;
    const m: Mine = { id: g.seq++, side, found: side === 'us', x: c.x + Math.sin(a) * d, y: c.y + Math.cos(a) * d };
    g.mines.push(m);
    out.push(m);
  }
  return out;
}

/** True when Tang is under the pack, away from open water. */
export function underIce(g: Game, at: Vec = g.own) {
  return g.env.ice && !g.env.polynyas.some((p) => dist(p, at) < p.r);
}
/** Extra background noise, in dB, from waves and grinding ice. Everyone's ears suffer alike. */
export function ambientDb(env: Env) {
  return Math.max(0, env.sea - 2) * 1.5 + (env.ice ? 3 : 0);
}
/** How far the periscope sees ships and aircraft today, as a fraction of a clear day. */
export function visibility(env: Env) {
  return env.sea >= 5 ? 0.5 : env.sea >= 4 ? 0.75 : 1;
}

/** Active sonar lights up every enemy mine within reach of the ping. */
export function pingMines(g: Game) {
  let n = 0;
  for (const m of g.mines) if (m.side !== 'us' && !m.found && dist(g.own, m) < MINE_PING) { m.found = true; n++; }
  if (n) log(g, 'warn', `Ping: ${n} mine-like echo${n > 1 ? 'es' : ''} close aboard. Marked on the plot.`);
}

function blowMine(g: Game, m: Mine, v: Vessel) {
  g.mines = g.mines.filter((x) => x !== m);
  g.blasts.push({ x: m.x, y: m.y, t: g.t, missile: false });
  v.hp -= MINE_DAMAGE;
  const sunk = v.hp <= 0;
  if (v === g.own) {
    if (sunk) { v.alive = false; log(g, 'danger', 'Mine! The hull is split. We are lost.', 'boom'); return end(g, false, 'USS Tang hit a mine and was lost.'); }
    return log(g, 'danger', 'Mine! Heavy shock aft, flooding in the engine room, but holding. Slow down and watch the HF sonar.', 'boom');
  }
  if (sunk) { v.alive = false; g.sunk.push({ name: v.name, cls: v.cls.key, side: v.side, by: m.side === 'us' ? 'us' : 'enemy' }); }
  const ours = m.side === 'us';
  if (ours) g.hits.push({ t: g.t, vid: v.id, name: v.name, cls: v.cls.key, kind: v.cls.kind, weapon: 'mine', label: 'Mine', sunk });
  log(g, ours ? 'good' : 'danger', `Explosion on bearing ${fmtBrg(brg(g.own, v))}: ${v.name} has hit ${ours ? 'one of our mines' : 'a mine'}${sunk ? ' and is sinking' : ''}.`, 'boom');
}

function updateMines(g: Game) {
  const o = g.own;
  for (const m of [...g.mines]) {
    // Tang's HF sonar in the sail and chin picks mines out ahead, better when slow.
    if (m.side !== 'us' && !m.found && dist(o, m) < (o.spd <= 10 ? MINE_HF_SLOW : MINE_HF_FAST)) {
      m.found = true;
      log(g, 'warn', `HF sonar: mine-like echo bearing ${fmtBrg(brg(o, m))}, ${Math.round(dist(o, m) * 2025)} yards. Marked on the plot.`);
    }
    const victim = g.vessels.find((v) => v.alive && v.cls.kind !== 'air' && dist(v, m) < MINE_LETHAL
      && (m.side === 'us' ? v.side === 'enemy' : v.side !== 'enemy'));
    if (victim) blowMine(g, m, victim);
  }
}

function updateIce(g: Game) {
  const o = g.own, floor = depthT(ICE_FLOOR_FT);
  if (!underIce(g)) { g.flags.iceWarned = 0; return; }
  if (o.ordDepth < floor) {
    o.ordDepth = floor;
    if (o.radar) o.radar = false;
    if (!g.flags.iceWarned) log(g, 'warn', `Ice overhead: the keels hang down to ${ICE_FLOOR_FT} feet. Holding ${ICE_FLOOR_FT} feet until we find open water.`);
    g.flags.iceWarned = 1;
  }
}

/** Once a second from the tick. */
export function updateHazards(g: Game) {
  if (g.mines.length) updateMines(g);
  if (g.env.ice) updateIce(g);
}
