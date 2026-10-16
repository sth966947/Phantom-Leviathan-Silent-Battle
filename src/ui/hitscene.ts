// Battle camera shots: one target seen from a fixed third-person camera while our weapons come in,
// explode, and the target burns, breaks up, sinks, falls or is crushed. Everything is a pure function
// of the shot's time and seed, so a frame can be drawn at any moment (and skipping is free).
import type { SiteKind } from '../sim/sim';
import { mulberry32 } from '../sim/math';
import { silOf } from './periscope';
import { airModel, poseFn, shipModel, subModel, subSpec, weaponModel, type MPart, type Model, type Pose } from './models';
import {
  blob, blobAt, css, draw3d, fireCol, hex, mean, mix, streak, unit,
  type PFace, type PGroup, type PObj, type RGB, type Sprite, type World,
} from './ps1';
import { buildScene, lerp3, type Cam, type Scene, type V3 } from './strikescene';

export type ShotKind = 'ship' | 'sub' | 'air' | 'land';
export interface ShotSpec {
  kind: ShotKind;
  /** Class key (ships, subs, aircraft) or site name (land). */
  cls: string; siteKind?: SiteKind;
  /** One per weapon arriving: its key ('mk48', 'harpoon', 'tlam', 'mine'...), when it lands (shot seconds), and for land whether it hit. */
  weapons: string[]; at: number[]; hits: boolean[];
  /** The target sank, broke up or fell (land: was hit at all). */
  sunk: boolean;
  dur: number; seed: number; night: boolean; modern: boolean;
}
/** How long each weapon is on screen before it lands. */
export function approachTime(kind: ShotKind, weapon: string) {
  if (weapon === 'mine') return 0.4;
  if (weapon === 'mjolnir') return 1.6; // straight down out of the sky, at sea or ashore
  if (kind === 'land') return 2.1;
  if (kind === 'air') return 1.8;
  if (weapon === 'mk96') return 1.1; // the last stretch at 250 knots
  if (weapon === 'mk48' || weapon === 'mk54' || weapon === 'wwtorp') return kind === 'sub' ? 2.6 : 2.4;
  return 2.2;
}
/** What becomes of the target, for the caption. */
export function fate(s: ShotSpec): 'break' | 'founder' | 'magazine' | 'damaged' {
  if (!s.sunk) return 'damaged';
  const r = mulberry32(s.seed ^ 0xfa7e)();
  const torp = s.weapons.some((w) => isTorp(w) || w === 'mine');
  if (s.kind === 'ship') {
    const big = (silOf(s.cls)?.len ?? 120) > 200;
    if (big && r < (torp ? 0.25 : 0.55)) return 'magazine';
    return torp && r < 0.8 ? 'break' : 'founder';
  }
  return 'break';
}

const ease = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const isTorp = (w: string) => w === 'mk48' || w === 'mk54' || w === 'wwtorp' || w === 'mk96';

/** Per-shot cache: models are built once, not every frame. */
export type ShotCache = Record<string, unknown>;
function cached<T>(c: ShotCache, k: string, make: () => T): T { if (!(k in c)) c[k] = make(); return c[k] as T; }

export interface Frame { flash: number }

// ---- Placing models -----------------------------------------------------------------------------
function place(parts: MPart[], ps: Pose, tint?: (f: PFace) => PFace): PGroup {
  const P = poseFn(ps);
  const obj = (m: MPart): PObj => ({
    c: P.point(m.c),
    faces: m.faces.map((f) => { const fc: PFace = { p: f.p.map(P.point), col: f.col, n: P.dir(f.n), emis: f.emis, both: f.both, alpha: f.alpha }; return tint ? tint(fc) : fc; }),
  });
  const base = parts.filter((m) => m.base).map(obj), rest = parts.filter((m) => !m.base).map(obj);
  return { c: mean([...base, ...rest].map((o) => o.c)), base, parts: rest };
}

// ---- Skies and seas -------------------------------------------------------------------------------
interface Sky { top: RGB; low: RGB; sea: RGB; fog: RGB; sun: V3; amb: number; exposure: number; smoke: RGB; smokeLit: RGB; spray: RGB; sprayLit: RGB }
function sky(night: boolean, seed: number, camSide = -1): Sky {
  const lit = (v: V3): V3 => unit([v[0], v[1] * -camSide, v[2]]);
  if (night) return {
    top: hex('#03060c'), low: hex('#18263a'), sea: hex('#0a1622'), fog: hex('#141f2e'), sun: lit([0.3, -0.6, 0.55]), amb: 0.35, exposure: 0.5,
    smoke: hex('#16161a'), smokeLit: hex('#3a2a24'), spray: hex('#6a7a8a'), sprayLit: hex('#a8b8c8'),
  };
  const dusk = mulberry32(seed ^ 0xd05c)() < 0.35;
  return dusk ? {
    top: hex('#2a3c5c'), low: hex('#d8a888'), sea: hex('#30485e'), fog: hex('#b09890'), sun: lit([-0.6, -0.5, 0.35]), amb: 0.45, exposure: 0.95,
    smoke: hex('#2c2a2c'), smokeLit: hex('#5a4a48'), spray: hex('#c8ccd4'), sprayLit: hex('#fff4ec'),
  } : {
    top: hex('#36577c'), low: hex('#a9bfcf'), sea: hex('#2b4a64'), fog: hex('#9db2c2'), sun: lit([-0.45, -0.55, 0.7]), amb: 0.5, exposure: 1,
    smoke: hex('#2e3034'), smokeLit: hex('#5c6066'), spray: hex('#c4d2de'), sprayLit: hex('#ffffff'),
  };
}
function seaWorld(s: Sky, r: () => number, t: number, around: V3, spread: number): World {
  const flat: PFace[] = [{ p: Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2) * 30000, Math.sin((i / 16) * Math.PI * 2) * 30000, 0] as V3), col: s.sea, n: [0, 0, 1] }];
  // Swell: long crests and troughs across the line of sight, lighter and darker, rolling slowly.
  const crest = mix(s.sea, s.sprayLit, 0.22), trough = mix(s.sea, [0, 0, 0], 0.35), cap = mix(s.sea, s.sprayLit, 0.6);
  for (let i = 0; i < 900; i++) {
    const y = around[1] + (r() * 2 - 1) * spread * 1.6, x = around[0] + (r() * 2 - 1) * spread * 2.2 + Math.sin(t * 0.6 + i) * 2;
    const len = 6 + r() * 30, th = 1 + r() * 4, k = r();
    const col = k < 0.45 ? crest : k < 0.93 ? trough : cap;
    flat.push({ p: [[x - len, y, 0.02], [x + len, y, 0.02], [x + len * 0.8, y + th, 0.02], [x - len * 0.8, y + th, 0.02]], col, n: [0, 0, 1] });
  }
  return { skyTop: s.top, skyLow: s.low, ground: s.sea, fog: s.fog, fogD: 2600, sun: s.sun, amb: s.amb, exposure: s.exposure, flat, groups: [], sprites: [], clipWater: true };
}
/** Cumulus banks low on the horizon. */
function clouds(out: Sprite[], sk: Sky, seed: number, cx: number, cy: number, dir: number) {
  const r = mulberry32(seed ^ 0xc10d);
  for (let i = 0; i < 16; i++) {
    const q: V3 = [cx + (r() * 2 - 1) * 6000, cy + dir * (5000 + r() * 4000), 200 + r() * 600];
    for (let k = 0; k < 5; k++) out.push(blob([q[0] + (k - 2) * 160 + Math.sin(i + k) * 50, q[1], q[2] + Math.cos(k * 2 + i) * 30 + (k % 2) * 50], 50 + r() * 45, mix(sk.low, sk.top, 0.18), mix(sk.low, sk.sprayLit, 0.45), 0.8, sk.fog, i * 5 + k, 2.2));
  }
}
/** A flat ring of foam on the sea. */
function foam(flat: PFace[], p: V3, rad: number, col: RGB, alpha: number, n = 10) {
  if (alpha <= 0.02 || rad <= 0) return;
  flat.push({ p: Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, k = 1 + Math.sin(i * 2.7 + rad) * 0.15; return [p[0] + Math.cos(a) * rad * k, p[1] + Math.sin(a) * rad * k * 0.8, 0.08] as V3; }), col, n: [0, 0, 1], alpha: Math.min(1, alpha) });
}

// ---- Effects --------------------------------------------------------------------------------------
/** A fireball at `p`: blobs of fire swelling and cooling to smoke as they rise. */
function fireball(out: Sprite[], seed: number, p: V3, R: number, age: number, n = 16) {
  if (age < 0) return;
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, el = r() * 1.2 - 0.2, k = 0.25 + r() * 0.75, life = 1.2 + r() * 1.4, delay = r() * 0.18;
    const tt = age - delay;
    if (tt < 0) continue;
    const grow = 1 - Math.exp(-tt * 5), d = R * k * grow;
    const q: V3 = [p[0] + Math.cos(a) * Math.cos(el) * d, p[1] + Math.sin(a) * Math.cos(el) * d, p[2] + Math.sin(el) * d * 0.8 + tt * R * 0.35];
    const heat = tt / life + k * 0.18;
    if (heat > 1.6) continue;
    const c = fireCol(0.08 + heat * 0.8);
    blobPush(out, q, R * (0.2 + 0.26 * r()) * (0.6 + grow * 0.6) * (1 + Math.max(0, heat - 0.6)), c, mix(c, [255, 255, 230], 0.18), heat > 1 ? 1.6 - heat : 1, i + seed);
  }
  if (age < 0.1) blobPush(out, p, R * 0.9, [255, 240, 190], [255, 255, 240], 1 - age / 0.1, 0);
}
function blobPush(out: Sprite[], p: V3, rm: number, col: RGB, light: RGB | null, alpha: number, jag: number) { out.push(blob(p, rm, col, light, Math.max(0, Math.min(1, alpha)), null, jag)); }

/** Debris flung out of a blast on hot arcs. */
function debris(out: Sprite[], seed: number, p: V3, speed: number, age: number, n: number, g = 18, hot = true, under = false) {
  if (age < 0) return;
  const r = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, el = (under ? -0.6 : 0.15) + r() * (under ? 1.2 : 1.2), v = speed * (0.4 + r() * 0.8);
    const at = (tt: number): V3 => [p[0] + Math.cos(a) * Math.cos(el) * v * tt, p[1] + Math.sin(a) * Math.cos(el) * v * tt, p[2] + Math.sin(el) * v * tt - 0.5 * g * tt * tt];
    const q = at(age), q0 = at(Math.max(0, age - 0.07));
    if (!under && q[2] < 0) continue;
    const heat = hot ? clamp01(age / (1.2 + r())) : 1;
    out.push(streak(q, q0, hot ? fireCol(0.15 + heat * 0.7) : [40, 40, 44], 1));
  }
}

/** A column of water thrown up by an explosion at the waterline, and falling back as spray. */
function waterColumn(w: World, seed: number, p: V3, H: number, age: number, sk: Sky, wide = 1) {
  if (age < 0) return;
  const r = mulberry32(seed), g = 26, v0 = Math.sqrt(2 * g * H);
  for (let i = 0; i < 80; i++) {
    const k = r(), v = v0 * (0.25 + 0.75 * Math.sqrt(k)), a = r() * Math.PI * 2, spread = (1 + r() * 4.5 * (0.5 + k)) * wide, delay = r() * 0.1;
    const tt = age - delay;
    if (tt < 0) continue;
    const z = v * tt - 0.5 * g * tt * tt;
    if (z < -1) continue;
    // Narrow while it climbs, the crown spilling outward as it falls back.
    const fall = Math.max(0, tt - v / g);
    const out1 = spread * (1 + tt * 0.6) + fall * (5 + k * 7) * wide;
    const q: V3 = [p[0] + Math.cos(a) * out1, p[1] + Math.sin(a) * out1 * 0.7, Math.max(0, z)];
    const rad = (1.6 + tt * 1.4 + k * 1.5) * wide;
    const fade = 1 - clamp01((tt - 2.4) / 1.4);
    blobPush(w.sprites, q, rad, mix(sk.spray, sk.sprayLit, 0.3 * k), sk.sprayLit, fade, i);
  }
  // The white boil spreading at the foot of the column.
  foam(w.flat, p, (8 + age * 9) * wide, sk.sprayLit, 0.9 * (1 - age / 5), 12);
  foam(w.flat, p, (4 + age * 6) * wide, mix(sk.spray, sk.sea, 0.2), 0.8 * (1 - age / 5), 10);
}

/** Smoke rising from a fire that moves with its ship: puffs emitted since `from`, each drifting downwind. */
function smokeFrom(out: Sprite[], t: number, from: number, until: number, at: (te: number) => V3 | null, sk: Sky, size: number, every = 0.09, life = 4.2, lit = true, pale = false) {
  if (t < from) return;
  for (let te = t - ((t - from) % every); te >= Math.max(from, t - life); te -= every) {
    if (te > until) continue;
    const p0 = at(te);
    if (!p0 || p0[2] < -0.5) continue;
    const a = t - te, n = Math.round(te / every);
    const q: V3 = [p0[0] - a * 5 * size + Math.sin(n * 1.3) * size, p0[1] + a * 2, p0[2] + 9 * size * Math.pow(a, 0.75)];
    const rad = size * (1.3 + a * 2.2) * (0.8 + 0.4 * Math.abs(Math.sin(n * 2.1))), k = a / life;
    if (pale) out.push(blob(q, rad, mix(sk.smokeLit, sk.fog, 0.45), mix(sk.spray, sk.fog, 0.4), clamp01((1 - k) * 0.7), null, n));
    else out.push(blob(q, rad, mix(lit && a < 0.6 ? sk.smokeLit : sk.smoke, sk.smoke, clamp01(k * 3)), mix(sk.smokeLit, sk.smoke, clamp01(k * 1.5)), clamp01((1 - k) * 1.6), null, n));
  }
}
/** Flames licking up from a point. */
function flames(out: Sprite[], t: number, p: V3 | null, size: number, seed: number) {
  if (!p || p[2] < 0) return;
  for (let i = 0; i < 4; i++) {
    const f = Math.sin(t * (13 + i * 3.1) + seed + i * 1.7) * 0.5 + 0.5;
    out.push(blob([p[0] + (i - 1.5) * size * 0.5, p[1], p[2] + size * (0.4 + i * 0.25 + f * 0.6)], size * (0.55 + f * 0.4), fireCol(0.12 + i * 0.12 + f * 0.1), fireCol(0.05), 1, null, i + seed));
  }
}

// ---- Ships ---------------------------------------------------------------------------------------
interface ShipRig { whole: MPart[]; halves: MPart[][]; model: Model; cut: number; hx: number[] }
function shipRig(s: ShotSpec, c: ShotCache): ShipRig {
  return cached(c, 'ship', () => {
    const r = mulberry32(s.seed ^ 0x51c);
    const base = shipModel(s.cls).model;
    // Where each weapon strikes, as a fraction of the length from the stern: under the machinery for torpedoes.
    const hx = s.weapons.map((w, i) => (isTorp(w) || w === 'mine' ? 0.36 + r() * 0.3 : 0.4 + r() * 0.25) + (i % 2 ? 0.08 : -0.04));
    const cut = Math.max(0.3, Math.min(0.7, hx[hx.length - 1]));
    const split = fate(s) === 'damaged' || fate(s) === 'founder' ? undefined : cut;
    const whole = shipModel(s.cls).pieces[0];
    const halves = split !== undefined ? shipModel(s.cls, split).pieces : [whole];
    return { whole, halves, model: base, cut, hx };
  });
}

function drawShip(ctx: CanvasRenderingContext2D, W: number, H: number, s: ShotSpec, t: number, c: ShotCache): Frame {
  const rig = shipRig(s, c), m = rig.model, L = m.len, r = mulberry32(s.seed);
  const side = r() < 0.5 ? -1 : 1; // camera off the starboard or port beam
  const sk = sky(s.night, s.seed, -side);
  const last = s.at[s.at.length - 1], fa = fate(s);
  const sinkDur = Math.max(2.6, s.dur - last - 0.4);
  // Steaming ahead until hit, then losing way.
  const t1 = s.at[0];
  const spd = Math.max(3, Math.min(9, L / 25));
  const xAt = (tt: number) => (tt < t1 ? spd * tt : spd * t1 + spd * (1 - Math.exp(-(tt - t1) * 0.5)) * 2);
  const X = (f: number) => -L / 2 + f * L;
  const sinkS = (tt: number) => clamp01((tt - last - (fa === 'magazine' ? 0.25 : 0.7)) / sinkDur);
  const poses = (tt: number): { parts: MPart[]; pose: Pose }[] => {
    const x = xAt(tt), bob = Math.sin(tt * 1.1) * 0.25, rollBob = Math.sin(tt * 0.8 + 1) * 0.02;
    const k = sinkS(tt), e = ease(0, 1, k);
    if (fa === 'damaged' || tt < last + 0.3) {
      const dmg = fa === 'damaged' ? ease(t1, t1 + 3, tt) : 0;
      return [{ parts: rig.whole, pose: { pos: [x, 0, bob - dmg * 0.8], hdg: 90, pitch: -dmg * 0.012, roll: rollBob + dmg * 0.05 * side } }];
    }
    if (fa === 'founder') {
      // Settling by the stern, listing, then sliding under bow last.
      const pv: V3 = [X(0.25), 0, 0];
      const pitch = 0.4 * ease(0, 0.75, k);
      return [{ parts: rig.whole, pose: { pos: [x + X(0.25), 0, bob - Math.pow(k, 1.7) * (L * 0.75 * Math.sin(0.4) + m.top + 6) - ease(0, 0.2, k) * 2], pivot: pv, hdg: 90, pitch, roll: rollBob + e * 0.2 * side } }];
    }
    // Breaking her back: both ends rise as the middle goes down, then both slide under.
    const xc = X(rig.cut), A = (fa === 'magazine' ? 0.3 : 0.5) * ease(0, 0.6, k), down = Math.pow(k, 1.8) * (L * 0.7 * Math.sin(0.5) + m.top + 8) + ease(0, 0.3, k) * 3;
    const apart = fa === 'magazine' ? e * L * 0.12 : e * 4;
    return [
      { parts: rig.halves[0], pose: { pos: [x + xc - apart, 0, -down], pivot: [xc, 0, 0], hdg: 90, pitch: -A, roll: e * 0.18 * side } },
      { parts: rig.halves[1] ?? [], pose: { pos: [x + xc + apart, 0, -down], pivot: [xc, 0, 0], hdg: 90, pitch: A * 0.9, roll: -e * 0.12 * side } },
    ];
  };
  /** Where a point on the ship (model space) is at time `tt`. */
  const at = (q: V3, tt: number): V3 => {
    const ps = poses(tt);
    const piece = ps.length > 1 && q[0] > X(rig.cut) ? ps[1] : ps[0];
    return poseFn(piece.pose).point(q);
  };
  const w = seaWorld(sk, mulberry32(s.seed ^ 77), t, [0, 0, 0], L * 2.5);
  for (const p of poses(t)) if (p.parts.length) w.groups.push(place(p.parts, p.pose, sinkS(t) > 0 || fa === 'damaged' ? scorch(t - last) : undefined));
  const out = w.sprites;
  const nearY = -side * m.beam * 0.5;
  const camD = L * 1.35 + 110, mid = xAt(s.dur * 0.5);
  clouds(out, sk, s.seed, mid, 0, side);
  const cam: Cam = { pos: [mid + L * 0.4 * (r() < 0.5 ? 1 : -1), -side * camD, 7 + L * 0.03], look: [mid, 0, Math.max(8, m.top * 0.4)], fov: 38, roll: 0 };

  // Funnel smoke while she steams.
  for (const st of m.stacks) smokeFrom(out, t, -6, last + 1.5, (te) => at(st, te), sk, Math.max(0.45, L / 300), 0.14, 3, false, true);
  // Bow wave and wake.
  if (t < last + 1) {
    const bow = at([L / 2, 0, 0], t), stern = at([-L / 2, 0, 0], t), k = t < t1 ? 1 : Math.exp(-(t - t1));
    foam(w.flat, [bow[0] - L * 0.02, bow[1], 0], m.beam * 0.75, sk.sprayLit, 0.8 * k, 8);
    for (let i = 0; i < 8; i++) foam(w.flat, [stern[0] - i * L * 0.07, stern[1] + Math.sin(i * 2.1) * 2, 0], m.beam * (0.5 + i * 0.12), mix(sk.sprayLit, sk.sea, 0.2 + i * 0.08), 0.7 * k * (1 - i / 8), 8);
  }

  let flash = 0;
  s.weapons.forEach((wk, i) => {
    const ti = s.at[i], hf = rig.hx[i], ta = approachTime('ship', wk), age = t - ti;
    const hullX = X(hf), hit = at([hullX, nearY, 0], Math.min(t, ti));
    if (isTorp(wk)) {
      // The torpedo's track running in from our side, a line of bubbles on the surface.
      if (t > ti - ta && t < ti + 2.5) {
        const u = clamp01((t - (ti - ta)) / ta);
        const from: V3 = [hit[0] - L * 0.5 - r() * 60, hit[1] - side * (L * 0.75 + 60), 0];
        const tail = Math.max(0, u - 0.55);
        const fade = t > ti ? Math.max(0, 1 - age / 2.5) : 1;
        for (let k = 0; k < 14; k++) {
          const ua = tail + ((u - tail) * k) / 14, ub = tail + ((u - tail) * (k + 1)) / 14;
          const qa = lerp3(from, hit, ua), qb = lerp3(from, hit, ub), wd = 1.5 + (1 - k / 14) * 4;
          if (k % 2 === 0) out.push(blob([qb[0], qb[1], 0.6], 0.9 + (1 - k / 14) * 1.2, sk.spray, sk.sprayLit, fade * (0.4 + 0.5 * (k / 14)), null, k));
          const dx = qb[0] - qa[0], dy = qb[1] - qa[1], l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * wd, ny = (dx / l) * wd;
          w.flat.push({ p: [[qa[0] + nx, qa[1] + ny, 0.1], [qb[0] + nx, qb[1] + ny, 0.1], [qb[0] - nx, qb[1] - ny, 0.1], [qa[0] - nx, qa[1] - ny, 0.1]], col: sk.sprayLit, n: [0, 0, 1], alpha: fade * (0.25 + 0.6 * (k / 14)) });
        }
        if (u < 1) foam(w.flat, lerp3(from, hit, u), 2.2, sk.sprayLit, 0.9, 8);
      }
    } else if (wk !== 'mine') {
      // A sea-skimming missile coming in from off the bow quarter, its exhaust trailing.
      const aim: V3 = [hullX, 0, m.deck(hullX) + 3 + r() * 4];
      const tgt = at(aim, ti);
      // It comes in past the camera from the left, low over the waves, and runs away into the target.
      const fw = unit([cam.look[0] - cam.pos[0], cam.look[1] - cam.pos[1], 0]), rt: V3 = [fw[1], -fw[0], 0], d0 = 130 + i * 30, l0 = Math.tan((cam.fov * Math.PI) / 360) * d0 + 12;
      // Mjolnir comes almost straight down out of the sky at the end of its ballistic arc.
      const dive = wk === 'mjolnir';
      const from: V3 = dive ? [tgt[0] - rt[0] * (70 + i * 15), tgt[1] - rt[1] * (70 + i * 15), tgt[2] + 190] : [cam.pos[0] + fw[0] * d0 - rt[0] * l0, cam.pos[1] + fw[1] * d0 - rt[1] * l0, 3 + i];
      const path = (u: number): V3 => { const q = lerp3(from, tgt, u); if (!dive) q[2] = from[2] + (tgt[2] - from[2]) * u * u * u + Math.sin(u * Math.PI) * 2; return q; };
      if (t > ti - ta && t < ti + 3.5) {
        const u = Math.min(1, (t - (ti - ta)) / ta), pos = path(u);
        const dir = dive ? unit([tgt[0] - from[0], tgt[1] - from[1], tgt[2] - from[2]]) : unit([tgt[0] - from[0], tgt[1] - from[1], 0]);
        if (u < 1) {
          w.groups.push(place(cached(c, dive ? 'mj' : 'msl', () => dive ? weaponModel(9, 0.6, hex('#3c4044'), 1) : weaponModel(8, 0.5, hex("#d8dce0"), 1)), { pos, hdg: Math.atan2(dir[0], dir[1]) * 180 / Math.PI, pitch: dive ? Math.asin(dir[2]) : undefined }));
          const tail: V3 = [pos[0] - dir[0] * 3.1, pos[1] - dir[1] * 3.1, pos[2] - dir[2] * 3.1];
          for (let k = 0; k < 4; k++) out.push(blob([tail[0] - dir[0] * k * 1.6, tail[1] - dir[1] * k * 1.6, tail[2]], (1.1 - k * 0.2) * (1 + Math.sin(t * 40 + k) * 0.15), fireCol(0.1 + k * 0.12), k ? null : fireCol(0), 1 - k * 0.15));
          // At Mach 6 the air ahead of it glows: a white-hot streak running back up the arc.
          if (dive) for (let k = 0; k < 18; k++) {
            const q = path(Math.max(0, u - k * 0.012));
            out.push(blob(q, (2.6 - k * 0.1) * (1 + Math.sin(t * 50 + k) * 0.1), fireCol(Math.min(0.9, 0.02 + k * 0.05)), k < 3 ? fireCol(0) : null, 1 - k / 20, null, k));
          }
        }
        // The smoke trail hangs in the air behind it, spreading and thinning.
        for (let k = 3; k < 70; k++) {
          const uk = u - k * 0.014;
          if (uk < 0) break;
          const age = (u - uk) * ta + Math.max(0, t - ti), q = path(uk);
          if (age > 3.5) continue;
          out.push(blob([q[0], q[1], q[2] + age * 0.8], 0.5 + age * 1.3, mix(sk.smokeLit, sk.fog, 0.35), mix(sk.spray, sk.fog, 0.2), 0.75 * (1 - age / 3.5), null, k));
        }
      }
    }
    if (age < 0) return;
    if (age < 0.15) flash = Math.max(flash, 1 - age / 0.15);
    if (isTorp(wk) || wk === 'mine') {
      waterColumn(w, s.seed + i * 31, [hit[0], hit[1], 0], Math.max(45, Math.min(110, L * 0.38)), age, sk, Math.max(0.7, L / 200));
      fireball(out, s.seed + i * 17, [hit[0], hit[1], 2], Math.max(6, L * 0.04), age - 0.05, 8);
    } else {
      const p = at([hullX, 0, m.deck(hullX) + 4], ti);
      fireball(out, s.seed + i * 17, p, wk === 'mjolnir' ? 24 : wk === 'mst' ? 16 : 11, age, wk === 'mjolnir' ? 30 : 24);
      debris(out, s.seed + i * 5, p, wk === 'mjolnir' ? 45 : 28, age, wk === 'mjolnir' ? 40 : 24);
      // The penetrator goes off deep inside the hull: a column of water and wreckage out the far side.
      if (wk === 'mjolnir') waterColumn(w, s.seed + i * 29, [hit[0], hit[1] - nearY * 0.2, 0], Math.max(40, Math.min(90, L * 0.3)), age - 0.08, sk, Math.max(0.6, L / 220));
    }
  });
  if (fa === 'magazine') {
    const age = t - last - 0.25, p = at([X(rig.cut), 0, m.deck(X(rig.cut)) + 6], last);
    if (age >= 0) {
      if (age < 0.2) flash = Math.max(flash, 1);
      fireball(out, s.seed ^ 0xbeef, p, Math.max(40, L * 0.28), age, 26);
      fireball(out, s.seed ^ 0xbee2, [p[0], p[1], p[2] + L * 0.2], Math.max(30, L * 0.2), age - 0.35, 18);
      debris(out, s.seed ^ 0xdeb, p, 90, age, 50, 22);
    }
  }
  // Fires and smoke where she was hit, carried with the hull as it moves and sinks.
  s.weapons.forEach((wk, i) => {
    const ti = s.at[i], hf = rig.hx[i], hullX = X(hf);
    if (t < ti + 0.3) return;
    const torp = isTorp(wk) || wk === 'mine';
    const spots: V3[] = torp ? [[hullX, nearY * 0.6, m.deck(hullX) + 0.5]] : [[hullX, 0, m.deck(hullX) + 3], [hullX - L * 0.06, nearY * 0.5, m.deck(hullX) + 1]];
    for (const [k, q] of spots.entries()) {
      smokeFrom(out, t, ti + 0.4, s.dur, (te) => at(q, te), sk, Math.max(0.9, L / 140) * (torp ? 0.8 : 1.2), 0.1, 4.5);
      flames(out, t, at(q, t), Math.max(1.6, L / 70), i * 7 + k);
    }
  });
  if (fa !== 'damaged' && t > last) {
    // Foam and oil where she goes down, and the boil of air at the end.
    const k = sinkS(t), centre = at([X(rig.cut), 0, 0], t);
    if (k > 0.05) for (let i = 0; i < 7; i++) foam(w.flat, [centre[0] + (i - 3) * L * 0.09, centre[1] + Math.sin(i * 3) * 5, 0], (4 + L * 0.03) * (0.6 + k), mix(sk.sprayLit, sk.sea, 0.25 + 0.5 * k), 0.85 * (1 - Math.abs(i - 3) / 4), 9);
  }

  // Camera: low over the water off the beam, fixed for the shot, the whole ship in frame.
  draw3d(ctx, W, H, w, cam);
  return { flash };
}
/** Burnt and glowing paint once she's been hit hard. */
function scorch(age: number) {
  const k = clamp01(age / 2) * 0.35, burn: RGB = [50, 40, 36];
  return (f: PFace): PFace => ({ ...f, col: mix(f.col, burn, k) });
}

// ---- Submarines ------------------------------------------------------------------------------------
function drawSub(ctx: CanvasRenderingContext2D, W: number, H: number, s: ShotSpec, t: number, c: ShotCache): Frame {
  const spec = subSpec(s.cls), L = spec.len, R = spec.beam / 2, r = mulberry32(s.seed);
  const last = s.at[s.at.length - 1], fa = fate(s), side = r() < 0.5 ? -1 : 1;
  const cut = cached(c, 'cut', () => 0.38 + mulberry32(s.seed ^ 3)() * 0.26);
  const whole = cached(c, 'whole', () => subModel(s.cls).pieces[0]);
  const halves = cached(c, 'halves', () => subModel(s.cls, cut).pieces);
  const X = (f: number) => -L / 2 + f * L;
  const spd = Math.max(3, Math.min(7, L / 22));
  const t1 = s.at[0];
  const xAt = (tt: number) => spd * Math.min(tt, t1) + (tt > t1 ? (fa === 'damaged' ? spd * 1.4 * (tt - t1) : spd * (1 - Math.exp(-(tt - t1)))) : 0);
  const sinkDur = Math.max(3, s.dur - last - 0.3);
  const k = clamp01((t - last - 0.4) / sinkDur), e = ease(0, 1, k);
  const crushT = last + 0.4 + sinkDur * 0.62;
  const posesAt = (tt: number): { parts: MPart[]; pose: Pose }[] => {
    const x = xAt(tt), kk = clamp01((tt - last - 0.4) / sinkDur), ee = ease(0, 1, kk);
    if (fa === 'damaged' || tt < last + 0.4) {
      const dmg = fa === 'damaged' ? ease(t1, t1 + 2.5, tt) : 0;
      return [{ parts: whole, pose: { pos: [x, 0, -dmg * (tt - t1) * 2.2], hdg: 90, pitch: -dmg * 0.14, roll: Math.sin(tt) * 0.02 + dmg * 0.1 } }];
    }
    const xc = X(cut), A = 0.55 * ease(0, 0.5, kk), down = ee * (L * 0.5 + 25), apart = ee * L * 0.08;
    return [
      { parts: halves[0], pose: { pos: [x + xc - apart, 0, -down * 0.9], pivot: [xc, 0, 0], hdg: 90, pitch: -A, roll: ee * 0.5 } },
      { parts: halves[1] ?? [], pose: { pos: [x + xc + apart, 0, -down], pivot: [xc, 0, 0], hdg: 90, pitch: A * 1.1, roll: -ee * 0.3 } },
    ];
  };
  const at = (q: V3, tt: number) => { const ps = posesAt(tt); return poseFn((ps.length > 1 && q[0] > X(cut) ? ps[1] : ps[0]).pose).point(q); };
  const w: World = {
    skyTop: hex('#3f86a4'), skyLow: hex('#0f3a52'), ground: hex('#01060b'), fog: hex('#0b2a3c'), fogD: Math.max(150, L * 1.7),
    sun: unit([0.1, 0.25, 1]), amb: 0.32, exposure: 0.85 - e * 0.35, flat: [], groups: [], sprites: [], underwater: true,
  };
  for (const p of posesAt(t)) if (p.parts.length) w.groups.push(place(p.parts, p.pose));
  const out = w.sprites, bub = hex('#a8d0e0'), bubLit = hex('#e8fbff');
  // Marine snow drifting through the light.
  const rs = mulberry32(s.seed ^ 0x5a0);
  for (let i = 0; i < 90; i++) {
    const q: V3 = [(rs() * 2 - 1) * L * 1.2 + xAt(s.dur / 2), (rs() * 2 - 1) * L * 0.8 - side * L * 0.3, (rs() * 2 - 1) * L * 0.5 - (t * 0.6 + rs() * 50) % 20];
    out.push(blob(q, 0.25, hex('#5a8aa0'), null, 0.8));
  }
  let flash = 0;
  s.weapons.forEach((wk, i) => {
    const ti = s.at[i], ta = approachTime('sub', wk), hf = i === s.weapons.length - 1 ? cut : 0.3 + r() * 0.4;
    const hit = at([X(hf), -side * R * 0.3, -R * 0.9], Math.min(t, ti));
    if (t > ti - ta && t < ti) {
      // The torpedo homing in, weaving on its seeker, propeller wash streaming behind.
      const u = (t - (ti - ta)) / ta;
      const from: V3 = [hit[0] - 180, hit[1] - side * 120, hit[2] - 25];
      const path = (uu: number): V3 => { const q = lerp3(from, hit, uu); return [q[0], q[1] + Math.sin(uu * 9) * 6 * (1 - uu), q[2] + Math.sin(uu * 5) * 3 * (1 - uu)]; };
      const pos = path(u), nx = path(Math.min(1, u + 0.01)), d = unit([nx[0] - pos[0], nx[1] - pos[1], nx[2] - pos[2]]);
      w.groups.push(place(cached(c, 'torp', () => weaponModel(5.8, 0.27, hex('#8a9096'))), { pos, hdg: Math.atan2(d[0], d[1]) * 180 / Math.PI, pitch: Math.asin(d[2]) }));
      for (let kk = 1; kk < 36; kk++) {
        const uk = u - kk * 0.008;
        if (uk < 0) break;
        const q = path(uk), age = kk * 0.008 * ta;
        out.push(blob([q[0], q[1], q[2] + age * 1.2], 0.3 + kk * 0.03, bub, bubLit, 0.8 * (1 - kk / 36), null, kk));
      }
    }
    const age = t - ti;
    if (age < 0) return;
    if (age < 0.12) flash = Math.max(flash, 1 - age / 0.12);
    // The gas bubble: swelling, collapsing, swelling again (the bubble pulse), then breaking up and rising.
    const Rb = Math.max(9, R * 2.4);
    const rb = age < 0.25 ? Rb * ease(0, 0.25, age) : age < 0.6 ? Rb * (1 - 0.7 * ease(0.25, 0.6, age)) : age < 0.9 ? Rb * (0.3 + 0.35 * ease(0.6, 0.9, age)) : 0;
    if (rb > 0) out.push(blob([hit[0], hit[1], hit[2] + age * 4], rb, hex('#6aa8c0'), hex('#d8f4ff'), 0.55, null, 2));
    if (age < 0.5) out.push(blob(hit, 6 + age * 30, hex('#fff6d0'), hex('#ffffff'), 1 - age / 0.5));
    const rbb = mulberry32(s.seed + i * 13);
    for (let kk = 0; kk < 60; kk++) {
      const a = rbb() * Math.PI * 2, d = rbb() * Rb, st = 0.8 + rbb() * 0.6, rise = 5 + rbb() * 5;
      const tt = age - st;
      if (tt < 0 || tt > 4) continue;
      out.push(blob([hit[0] + Math.cos(a) * d + Math.sin(tt * 3 + kk) * 1.5, hit[1] + Math.sin(a) * d * 0.5, hit[2] + tt * rise + d * 0.3], 0.5 + rbb() * 1.4, bub, bubLit, 1 - tt / 4, null, kk));
    }
    debris(out, s.seed + i * 3, hit, 18, age, 18, 3, false, true);
  });
  if (fa !== 'damaged' && t > last) {
    // Air streaming out of the broken ends, debris tumbling down with the halves.
    const ends: V3[] = [[X(cut) - 1, 0, 0], [X(cut) + 1, 0, 0]];
    const rb = mulberry32(s.seed ^ 0xa1);
    for (const end of ends) for (let kk = 0; kk < 50; kk++) {
      const te = t - kk * 0.06;
      if (te < last + 0.2) break;
      const p0 = at(end, te), a = t - te;
      out.push(blob([p0[0] + Math.sin(kk * 1.7 + a * 4) * 1.5, p0[1] + (rb() - 0.5) * 3, p0[2] + a * (6 + rb() * 3)], 0.4 + rb() * 1.1, bub, bubLit, 1 - kk / 50, null, kk));
    }
    debris(out, s.seed ^ 0x77, at([X(cut), 0, 0], last), 10, t - last, 26, 2.2, false, true);
    // Past crush depth: a flash in each half and a burst of air.
    const ca = t - crushT;
    if (ca > 0) {
      for (const end of [[X(cut * 0.5), 0, 0], [X((1 + cut) / 2), 0, 0]] as V3[]) {
        const p = at(end, t);
        if (ca < 0.18) out.push(blob(p, 10 + ca * 50, hex('#fff6d0'), hex('#ffffff'), 1 - ca / 0.18));
        const rr = mulberry32(Math.floor(end[0] * 10) ^ s.seed);
        for (let kk = 0; kk < 36; kk++) {
          const a = rr() * Math.PI * 2, v = 6 + rr() * 10, tt = ca - rr() * 0.2;
          if (tt < 0 || tt > 2.5) continue;
          out.push(blob([p[0] + Math.cos(a) * v * tt, p[1] + Math.sin(a) * v * tt * 0.5, p[2] + tt * 7 + Math.sin(a) * v * tt * 0.4], 0.6 + rr() * 1.4, bub, bubLit, 1 - tt / 2.5, null, kk));
        }
      }
      if (ca < 0.1) flash = Math.max(flash, 0.5);
    }
  } else if (fa === 'damaged' && t > t1) {
    // Air leaking from the breach as she runs for it.
    for (let kk = 0; kk < 60; kk++) {
      const te = t - kk * 0.05;
      if (te < t1) break;
      const p0 = at([X(0.5), -side * R * 0.5, R * 0.4], te), a = t - te;
      out.push(blob([p0[0], p0[1], p0[2] + a * 5], 0.4 + (kk % 3) * 0.3, bub, bubLit, 1 - kk / 60, null, kk));
    }
  }
  const mid = xAt(Math.min(s.dur, last + 1) * 0.5);
  const cam: Cam = { pos: [mid + L * 0.35, -side * (L * 1.05 + 30), 6 + R], look: [mid + L * 0.05, 0, -R * 0.5 - (fa !== 'damaged' ? L * 0.06 : 0)], fov: 50, roll: 0 };
  const view = draw3d(ctx, W, H, w, cam);
  // Light from the surface: shafts slanting down through the water, swaying.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const x = ((i * 67 + s.seed % 50) % W) + Math.sin(t * 0.4 + i) * 12, wdt = 14 + (i % 3) * 10;
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.9);
    g.addColorStop(0, 'rgba(120,190,215,0.16)'); g.addColorStop(1, 'rgba(120,190,215,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + wdt, 0); ctx.lineTo(x + wdt + 50, H); ctx.lineTo(x + 40, H); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  void view;
  return { flash };
}

// ---- Aircraft --------------------------------------------------------------------------------------
function drawAir(ctx: CanvasRenderingContext2D, W: number, H: number, s: ShotSpec, t: number, c: ShotCache): Frame {
  const am = cached(c, 'air', () => airModel(s.cls)), L = am.model.len, heli = am.rotors.length > 0;
  const sk = sky(s.night, s.seed), r = mulberry32(s.seed);
  const last = s.at[s.at.length - 1], kill = s.sunk;
  const alt = heli ? 40 : 130, v = heli ? 0 : 58;
  const x0 = heli ? 0 : -v * last * 0.9;
  // Flight path: level until the hit, then (killed) falling in flames into the sea.
  const g = heli ? 16 : 20;
  const fallT = Math.sqrt((2 * alt) / g);
  const poseAt = (tt: number): Pose & { down: boolean } => {
    const a = tt - last;
    if (!kill || a < 0) {
      const dmg = a > 0 ? Math.min(1, a) : 0;
      return { pos: [x0 + v * tt + (heli ? Math.sin(tt * 0.7) * 2 : 0), 0, alt + Math.sin(tt * 0.9) * 1.5 - dmg * a * 3], hdg: 90, pitch: -dmg * 0.08, roll: Math.sin(tt * 0.6) * 0.05, down: false };
    }
    const fa = Math.min(a, fallT);
    return {
      pos: [x0 + v * last + v * 0.8 * fa, heli ? 0 : fa * 3, Math.max(0, alt - 0.5 * g * fa * fa)], hdg: 90,
      pitch: heli ? -0.2 * fa : -Math.min(1.1, 0.42 * fa * fa), roll: heli ? 0.3 * fa : 0.9 * fa, spin: heli ? 2.5 * fa * fa : 0, down: a >= fallT,
    };
  };
  const w = seaWorld(sk, mulberry32(s.seed ^ 91), t, [x0 + v * last, 300, 0], 900);
  w.clipWater = true;
  const ps = poseAt(t);
  const parts = heli ? am.model.parts.map((p) => (am.rotors.includes(p) ? { ...p, faces: p.faces.map((f) => ({ ...f })) } : p)) : am.model.parts;
  if (!ps.down) w.groups.push(place(parts, ps, kill && t > last ? scorch(t - last) : undefined));
  const out = w.sprites;
  clouds(out, sk, s.seed, x0 + v * last, 0, 1);
  const P = (tt: number) => poseFn(poseAt(tt));
  let flash = 0;
  s.weapons.forEach((wk, i) => {
    const ti = s.at[i], ta = approachTime('air', wk);
    const tgt = P(ti).point([L * 0.15, 0, -1]);
    // The missile climbing from the sea far off, its motor bright and its trail white.
    const p0: V3 = [tgt[0] - 520 - r() * 120, tgt[1] + 900, 0], p1: V3 = [tgt[0] - 380, tgt[1] + 500, tgt[2] * 0.8];
    const bez = (u: number): V3 => { const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), cc = u * u; return [a * p0[0] + b * p1[0] + cc * tgt[0], a * p0[1] + b * p1[1] + cc * tgt[1], a * p0[2] + b * p1[2] + cc * tgt[2]]; };
    const u = (t - (ti - ta)) / ta;
    if (u > 0) {
      for (let k = 0; k < 60; k++) {
        const uk = Math.min(u, 1) - k * 0.016;
        if (uk < 0) break;
        const age = (Math.min(u, 1) - uk) * ta + Math.max(0, t - ti);
        if (age > 5) continue;
        out.push(blob(bez(uk), 1.6 + age * 2.2, mix(sk.spray, sk.fog, 0.2), sk.sprayLit, 0.7 * (1 - age / 5), null, k));
      }
      if (u < 1) {
        const q = bez(u);
        out.push(blob(q, 2.4 + Math.sin(t * 50) * 0.5, fireCol(0.15), fireCol(0), 1));
        out.push(blob(q, 6, fireCol(0.3), null, 0.35));
      }
    }
    const age = t - ti;
    if (age < 0) return;
    if (age < 0.12) flash = Math.max(flash, 0.8 * (1 - age / 0.12));
    // Proximity burst just ahead of the aircraft: a flash, a dark puff, fragments.
    // Sized to the airframe: a helicopter is small and the camera is close, so its burst is too.
    const bs = heli ? 0.45 : 1, b: V3 = [tgt[0] + 6 * bs, tgt[1] - 4 * bs, tgt[2] + 3 * bs];
    if (age < 0.2) out.push(blob(b, (14 + age * 40) * bs, [255, 250, 220], [255, 255, 255], 1 - age / 0.2));
    const rr = mulberry32(s.seed + i * 7);
    for (let k = 0; k < 10; k++) {
      const q: V3 = [b[0] + ((rr() - 0.5) * 12 - age * 3) * bs, b[1] + (rr() - 0.5) * 8 * bs, b[2] + ((rr() - 0.5) * 8 + age * 2) * bs];
      const heat = age * 1.6 + rr() * 0.3;
      if (heat < 3) out.push(blob(q, (4 + age * 4 + rr() * 3) * bs, fireCol(Math.min(1, 0.3 + heat * 0.4)), heat < 0.5 ? fireCol(0.1) : null, 1 - heat / 3, null, k));
    }
    debris(out, s.seed + i, b, 30 * bs, age, 20, 10);
  });
  if (t > last) {
    // Fire at the engines (or the whole airframe of a killed aircraft) and the smoke trail it leaves.
    const pts = kill ? [...am.engines, [0, 0, 0] as V3] : am.engines.slice(0, 1);
    for (const [k, q] of pts.entries()) {
      const at = (tt: number): V3 | null => (poseAt(tt).down ? null : P(tt).point(q));
      const nowP = at(t);
      if (nowP) {
        flames(out, t, nowP, kill ? Math.max(1.5, L / 14) : 1.2, k);
        out.push(blob(nowP, kill ? L * 0.12 : 1.5, fireCol(0.25), fireCol(0.05), 0.9, null, k));
      }
      for (let kk = 1; kk < 90; kk++) {
        const te = t - kk * 0.05;
        if (te < last + 0.05) break;
        const p0 = at(te);
        if (!p0) continue;
        const a = t - te;
        if (kk % 2 && a > 0.4) continue;
        out.push(blob([p0[0] - a * 3, p0[1] + a, p0[2] + a * 2], (kill ? 1.1 : 0.7) + a * 1.4, a < 0.25 ? fireCol(0.45) : sk.smoke, a < 0.25 ? fireCol(0.3) : sk.smokeLit, Math.max(0, 0.9 - a / 4), null, kk));
      }
    }
    const fall = t - last - fallT;
    if (kill && fall > 0) {
      const p = P(last + fallT).point([0, 0, 0]);
      waterColumn(w, s.seed ^ 0x5b1, [p[0], p[1], 0], heli ? 18 : 30, fall, sk, heli ? 0.5 : 0.7);
      fireball(out, s.seed ^ 0x5b2, [p[0], p[1], 1], heli ? 6 : 10, fall, 10);
      smokeFrom(out, t, last + fallT + 0.3, s.dur, () => [p[0], p[1], 0.5], sk, 0.8, 0.12, 3.5);
      if (fall < 0.15) flash = Math.max(flash, 0.4);
    }
  }
  const mid = poseAt(last).pos;
  const cam: Cam = { pos: [mid[0] + 50, -(heli ? 120 : 240), heli ? 26 : 60], look: [mid[0] + 30, 0, heli ? 22 : alt * 0.6], fov: heli ? 44 : 50, roll: 0 };
  draw3d(ctx, W, H, w, cam);
  return { flash };
}

// ---- Land strikes ---------------------------------------------------------------------------------
const RAMP: [number, string][] = [[0, '#0a1018'], [0.12, '#1c3048'], [0.18, '#2a4660'], [0.23, '#35525c'], [0.28, '#3e5a44'], [0.34, '#4e6442'],
  [0.4, '#6a724e'], [0.45, '#7e7c62'], [0.5, '#8a8678'], [0.56, '#9a968c'], [0.62, '#ab9c86'], [0.7, '#bcae98'], [0.8, '#d8c8a8'], [1, '#f2ead8']];
const RAMPC = RAMP.map(([k, h]) => [k, hex(h)] as [number, RGB]);
function ramp(v: number): RGB {
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < RAMPC.length; i++) if (x <= RAMPC[i][0]) { const [a, ca] = RAMPC[i - 1], [b, cb] = RAMPC[i]; return mix(ca, cb, (x - a) / (b - a)); }
  return RAMPC[RAMPC.length - 1][1];
}
interface LandRig { sc: Scene; flat: PFace[]; still: PGroup[]; balls: Sprite[]; targets: { c: V3; faces: { p: V3[]; n: V3; tone: number; heat: number }[] }[]; hdg: number }
function landRig(s: ShotSpec, c: ShotCache): LandRig {
  return cached(c, 'land', () => {
    const sc = buildScene(s.siteKind ?? 'base', s.modern, s.cls, s.seed);
    const flat: PFace[] = sc.flat.map((f) => ({ p: f.p, n: f.n, col: ramp(f.tone + f.heat) }));
    const still: PGroup[] = [], balls: Sprite[] = [], targets: LandRig['targets'] = [];
    for (const o of sc.objs) {
      if (o.ball) {
        const tree = o.ball.tone < 0.35, col = tree ? hex('#2e4a2a') : ramp(o.ball.tone), lit = tree ? hex('#4a6a3a') : ramp(o.ball.tone + 0.12);
        balls.push(blob([o.c[0], o.c[1], o.c[2]], o.ball.r, col, lit, 1, null, Math.floor(o.c[0])));
        continue;
      }
      if (o.target) { targets.push({ c: o.c, faces: o.faces.map((f) => ({ p: f.p, n: f.n, tone: f.tone, heat: f.heat })) }); continue; }
      still.push({ c: o.c, base: [], parts: [{ c: o.c, faces: o.faces.map((f) => ({ p: f.p, n: f.n, col: ramp(f.tone), emis: Math.min(0.8, f.heat * 1.3), marks: f.marks?.map((m) => ({ p: m.p, col: ramp(m.tone) })) })) }] });
    }
    return { sc, flat, still, balls, targets, hdg: sc.heading };
  });
}
function drawLand(ctx: CanvasRenderingContext2D, W: number, H: number, s: ShotSpec, t: number, c: ShotCache): Frame {
  const rig = landRig(s, c), sc = rig.sc, sk = sky(s.night, s.seed), r = mulberry32(s.seed ^ 0x1a);
  const hd = (rig.hdg * Math.PI) / 180, fwd: V3 = [Math.sin(hd), Math.cos(hd), 0], right: V3 = [Math.cos(hd), -Math.sin(hd), 0];
  // Impact points: around the aimpoint for hits, off target for misses.
  const pts = cached(c, 'impacts', () => s.weapons.map((_, i) => (s.hits[i]
    ? ([sc.aim[0] + (i ? (r() - 0.5) * 50 : 0), sc.aim[1] + (i ? (r() - 0.5) * 40 : 0), sc.aim[2]] as V3)
    : ([sc.miss[0] + (r() - 0.5) * 40, sc.miss[1] + (r() - 0.5) * 30, 0] as V3))));
  const firstHit = s.at.find((_, i) => s.hits[i]);
  const damage = firstHit === undefined ? 0 : ease(firstHit, firstHit + 1.2, t);
  const flick = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7.3);
  const groups = [...rig.still, ...rig.targets.map((o) => ({
    c: o.c, base: [] as PObj[], parts: [{
      c: o.c, faces: o.faces.map((f) => ({
        p: damage > 0 ? f.p.map(([x, y, z]) => [x, y, z * (1 - 0.72 * damage) * (0.85 + 0.15 * Math.sin(x * 0.3 + y * 0.2))] as V3) : f.p,
        n: f.n, col: mix(ramp(f.tone), [40, 34, 30], damage * 0.6), emis: Math.min(0.9, f.heat * 1.3 + damage * 0.45 * flick),
      })),
    }],
  }))];
  const w: World = {
    skyTop: sk.top, skyLow: sk.low, ground: mix(ramp(sc.ground), sk.fog, 0.75), fog: sk.fog, fogD: 3200, sun: sk.sun, amb: sk.amb, exposure: s.night ? 0.55 : 1,
    flat: rig.flat, groups, sprites: [...rig.balls],
  };
  const out = w.sprites;
  // Chimney smoke.
  for (const st of sc.stacks) smokeFrom(out, t, -5, s.dur, () => [st[0], st[1], st[2]], sk, 1.4, 0.2, 4, false);
  let flash = 0;
  s.weapons.forEach((wk, i) => {
    const ti = s.at[i], ta = approachTime('land', wk), p = pts[i], mj = wk === 'mjolnir';
    if (mj) {
      // Mjolnir drops almost straight out of the sky at the end of its arc, glowing white-hot.
      const from: V3 = [p[0] - fwd[0] * (150 + i * 30), p[1] - fwd[1] * (150 + i * 30), p[2] + 360];
      const path = (u: number): V3 => lerp3(from, p, u);
      const dir = unit([p[0] - from[0], p[1] - from[1], p[2] - from[2]]);
      if (t > ti - ta && t < ti + 3.5) {
        const u = Math.min(1, (t - (ti - ta)) / ta);
        if (u < 1) {
          w.groups.push(place(cached(c, 'mjl', () => weaponModel(14, 1.4, hex('#3c4044'), 1)), { pos: path(u), hdg: Math.atan2(dir[0], dir[1]) * 180 / Math.PI, pitch: Math.asin(dir[2]) }));
          for (let k = 0; k < 18; k++) out.push(blob(path(Math.max(0, u - k * 0.012)), (8 - k * 0.3) * (1 + Math.sin(t * 50 + k) * 0.1), fireCol(Math.min(0.9, 0.02 + k * 0.05)), k < 3 ? fireCol(0) : null, 1 - k / 20, null, k));
        }
        // The trail hangs in the air behind it, spreading and thinning.
        for (let k = 3; k < 70; k++) {
          const uk = u - k * 0.014;
          if (uk < 0) break;
          const age = (u - uk) * ta + Math.max(0, t - ti), q = path(uk);
          if (age > 3.5) continue;
          out.push(blob([q[0], q[1], q[2] + age * 2], 2.5 + age * 5, mix(sk.smokeLit, sk.fog, 0.35), mix(sk.spray, sk.fog, 0.2), 0.75 * (1 - age / 3.5), null, k));
        }
      }
    } else {
      // The Tomahawk diving in at 15 degrees from down its track.
      const dir = unit([fwd[0], fwd[1], -Math.tan((15 * Math.PI) / 180)]);
      const pos = (tt: number): V3 => { const d = (ti - tt) * 245; return [p[0] - dir[0] * d + right[0] * Math.sin(tt * 2 + i) * 2, p[1] - dir[1] * d, p[2] - dir[2] * d]; };
      if (t > ti - ta && t < ti) {
        const q = pos(t);
        w.groups.push(place(cached(c, 'tlam', () => weaponModel(6.2, 0.26, hex('#c8ccd0'), 0.7)), { pos: q, hdg: rig.hdg, pitch: -0.26 }));
        out.push(blob([q[0] - dir[0] * 3.5, q[1] - dir[1] * 3.5, q[2] - dir[2] * 3.5], 1.6, fireCol(0.25), fireCol(0.05), 0.9));
        for (let k = 1; k < 26; k++) { const te = t - k * 0.05; if (te < ti - ta) break; out.push(blob(pos(te), 1 + k * 0.25, mix(sk.spray, sk.fog, 0.3), null, 0.4 * (1 - k / 26), null, k)); }
      }
    }
    const age = t - ti;
    if (age < 0) return;
    if (age < 0.15) flash = Math.max(flash, 1 - age / 0.15);
    const water = !s.hits[i] && sc.missWater;
    if (water) { waterColumn(w, s.seed + i * 9, p, mj ? 110 : 70, age, sk, 1.4); return; }
    // The penetrator goes in before it goes off: a burst of earth, then the fireball out of the crater.
    fireball(out, s.seed + i * 11, [p[0], p[1], p[2] + 6], mj ? 70 : s.hits[i] ? 30 : 18, mj ? age - 0.08 : age, mj ? 30 : 22);
    if (mj) waterColumn(w, s.seed + i * 21, p, 110, age, { ...sk, spray: mix(sk.smoke, [120, 100, 80], 0.5), sprayLit: [170, 150, 120] }, 2.2); // a column of earth thrown up out of the crater
    debris(out, s.seed + i * 4, p, mj ? 120 : 70, age, mj ? 60 : 34, mj ? 50 : 30);
    smokeFrom(out, t, ti + 0.3, s.dur, () => [p[0], p[1], p[2] + 8], sk, mj ? 4.6 : s.hits[i] ? 3.2 : 1.8, 0.12, 5);
    if (s.hits[i]) for (let k = 0; k < (mj ? 7 : 4); k++) flames(out, t, [p[0] + (k - (mj ? 3 : 1.5)) * 14, p[1] + Math.sin(k * 2) * 10, 2], mj ? 7 : 5, k + i);
  });
  // A fixed camera standing off to one side of the missiles' track, the whole site in view.
  const camD = 1250;
  const cam: Cam = { pos: [sc.aim[0] + right[0] * camD - fwd[0] * 250, sc.aim[1] + right[1] * camD - fwd[1] * 250, 240], look: [sc.aim[0] - fwd[0] * 60, sc.aim[1] - fwd[1] * 60, 30], fov: 40, roll: 0 };
  draw3d(ctx, W, H, w, cam);
  return { flash };
}

export function drawShotFrame(ctx: CanvasRenderingContext2D, W: number, H: number, s: ShotSpec, t: number, c: ShotCache): Frame {
  const f = s.kind === 'ship' ? drawShip(ctx, W, H, s, t, c) : s.kind === 'sub' ? drawSub(ctx, W, H, s, t, c) : s.kind === 'air' ? drawAir(ctx, W, H, s, t, c) : drawLand(ctx, W, H, s, t, c);
  if (f.flash > 0) { ctx.fillStyle = `rgba(255,250,235,${(f.flash * 0.55).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
  return f;
}
export { blobAt, css };
