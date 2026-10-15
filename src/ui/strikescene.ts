// Strike camera scenes: a small flat-shaded 3D renderer and target sites built procedurally from
// boxes, prisms, beams and cylinders. Everything is a grey from 0 to 1 in an infrared "white is hot"
// palette: water and sky cold and dark, sun-warmed roofs and roads lighter, stacks and engines white.
// World units are metres, x east, y north, z up.
import type { SiteKind } from '../sim/sim';
import { mulberry32 } from '../sim/math';

export type V3 = [number, number, number];
type P2 = [number, number];
/** A flat polygon. `marks` are smaller polygons on the same plane, drawn on it (windows, doors, hatches). */
export interface Face { p: V3[]; n: V3; tone: number; heat: number; marks?: { p: V3[]; tone: number }[]; bb?: [number, number, number, number] }
/** A solid: drawn whole, far to near. A ball is drawn as a shaded disc (radomes, trees). */
export interface Obj { c: V3; faces: Face[]; ball?: { r: number; tone: number }; target?: boolean }
export interface Scene {
  /** Ground, water, roads and decks, drawn first in the order they were added. */
  flat: Face[];
  objs: Obj[];
  /** Chimney and funnel tops that trail smoke. */
  stacks: V3[];
  /** Where a hit lands, where a miss lands, and whether the miss lands in water. */
  aim: V3; miss: V3; missWater: boolean;
  /** Compass heading the missile flies in on. */
  heading: number;
  ground: number;
}
export interface Cam { pos: V3; look: V3; fov: number; roll: number }

// ---- Vector bits ---------------------------------------------------------------------------
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a: V3, b: V3, u: number): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const mean = (ps: V3[]): V3 => { const s: V3 = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length]; };
/** Newell's normal, turned to face away from `inside`. */
function outward(ps: V3[], inside: V3): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const u = unit(n);
  return dot(u, sub(mean(ps), inside)) < 0 ? [-u[0], -u[1], -u[2]] : u;
}
const SUN = unit([-0.45, -0.6, 0.75]);

// ---- Building blocks ----------------------------------------------------------------------
/** Places things in a local frame: local +y points along compass bearing `rot`. */
class Frame {
  private s: number; private c: number;
  constructor(public x: number, public y: number, rot: number) { this.s = Math.sin(rot * Math.PI / 180); this.c = Math.cos(rot * Math.PI / 180); }
  p(lx: number, ly: number, z: number): V3 { return [this.x + lx * this.c + ly * this.s, this.y - lx * this.s + ly * this.c, z]; }
  n(lx: number, ly: number, z: number): V3 { return [lx * this.c + ly * this.s, -lx * this.s + ly * this.c, z]; }
}

export class Builder {
  flat: Face[] = []; objs: Obj[] = []; stacks: V3[] = [];
  /** Where the sea begins, if the site is on the shore. */
  shore: number | null = null;
  constructor(public r: () => number) {}
  rnd(a: number, b: number) { return a + (b - a) * this.r(); }

  /** A ground polygon (x, y pairs) at height z. */
  poly(pts: P2[], tone: number, z = 0, heat = 0) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    this.flat.push({ p: pts.map(([x, y]) => [x, y, z]), n: [0, 0, 1], tone, heat, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  rect(x0: number, y0: number, x1: number, y1: number, tone: number, z = 0) { this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], tone, z); }
  /** A ground strip from a to b, w wide: roads, rails, runway marks. */
  strip(a: P2, b: P2, w: number, tone: number, z = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
    this.poly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], tone, z);
  }

  private add(faces: Face[], c: V3): Obj { const o: Obj = { c, faces }; this.objs.push(o); return o; }

  /** A vertical prism over a convex footprint (local x, y, counter-clockwise). */
  extrude(f: Frame, foot: P2[], z0: number, z1: number, tone: number, o: { top?: number; heat?: number; topHeat?: number } = {}): Obj {
    const lo = foot.map(([x, y]) => f.p(x, y, z0)), hi = foot.map(([x, y]) => f.p(x, y, z1));
    const c = mean([...lo, ...hi]), faces: Face[] = [];
    for (let i = 0; i < foot.length; i++) {
      const j = (i + 1) % foot.length, p = [lo[i], lo[j], hi[j], hi[i]];
      faces.push({ p, n: outward(p, c), tone, heat: o.heat ?? 0 });
    }
    faces.push({ p: hi, n: [0, 0, 1], tone: o.top ?? tone, heat: o.topHeat ?? o.heat ?? 0 });
    return this.add(faces, c);
  }
  box(x: number, y: number, rot: number, w: number, l: number, h: number, tone: number, o: { z0?: number; top?: number; heat?: number; topHeat?: number } = {}) {
    return this.extrude(new Frame(x, y, rot), [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]], o.z0 ?? 0, (o.z0 ?? 0) + h, tone, o);
  }
  cyl(x: number, y: number, rad: number, z0: number, z1: number, tone: number, o: { top?: number; heat?: number; topHeat?: number; sides?: number } = {}) {
    const n = o.sides ?? 12;
    return this.extrude(new Frame(x, y, 0), Array.from({ length: n }, (_, i) => [Math.cos(i / n * 2 * Math.PI) * rad, Math.sin(i / n * 2 * Math.PI) * rad] as P2), z0, z1, tone, o);
  }
  /**
   * A horizontal prism: `profile` (local x across, z up, counter-clockwise) run along local y for
   * length l. Gable roofs, sawtooth roofs and arched hangars. `faceTone` picks a tone per profile edge.
   */
  prism(x: number, y: number, rot: number, l: number, profile: P2[], tone: number, faceTone?: (i: number, n: V3) => number, endTone = tone) {
    const f = new Frame(x, y, rot), faces: Face[] = [];
    const a = profile.map(([px, pz]) => f.p(px, -l / 2, pz)), b = profile.map(([px, pz]) => f.p(px, l / 2, pz));
    for (let i = 0; i < profile.length; i++) {
      const j = (i + 1) % profile.length;
      const ex = profile[j][0] - profile[i][0], ez = profile[j][1] - profile[i][1];
      if (ez === 0 && ex > 0 && profile[i][1] === 0) continue; // the floor
      const n = unit(f.n(ez, 0, -ex));
      faces.push({ p: [a[i], a[j], b[j], b[i]], n, tone: faceTone ? faceTone(i, n) : tone, heat: 0 });
    }
    faces.push({ p: a, n: f.n(0, -1, 0), tone: endTone, heat: 0 }, { p: b, n: f.n(0, 1, 0), tone: endTone, heat: 0 });
    return this.add(faces, mean([...a, ...b]));
  }
  gable(x: number, y: number, rot: number, w: number, l: number, h: number, ridge: number, wall: number, roof: number) {
    return this.prism(x, y, rot, l, [[-w / 2, 0], [w / 2, 0], [w / 2, h], [0, h + ridge], [-w / 2, h]], wall, (i) => (i === 2 || i === 3 ? roof : wall));
  }
  /** A factory hall with a sawtooth roof: glazed north lights (cold, dark) and warm sloping roofs. */
  saw(x: number, y: number, rot: number, w: number, l: number, h: number, teeth: number, wall: number, roof: number, glass: number) {
    const t = Math.min(7, w / teeth * 0.45), pts: P2[] = [[-w / 2, 0], [w / 2, 0]];
    for (let i = teeth; i > 0; i--) { const xi = -w / 2 + (w * i) / teeth; pts.push([xi, h], [xi, h + t]); }
    pts.push([-w / 2, h]);
    // Edges 0..: floor, right wall, then a vertical glazing face and a slope per tooth, then the left wall.
    return this.prism(x, y, rot, l, pts, wall, (i, n) => (i === 1 || i === pts.length - 1 ? wall : Math.abs(n[2]) < 0.2 ? glass : roof));
  }
  arch(x: number, y: number, rot: number, w: number, l: number, h: number, tone: number, door: number) {
    const pts: P2[] = [[-w / 2, 0], [w / 2, 0]];
    for (let i = 1; i < 10; i++) { const a = (i / 10) * Math.PI; pts.push([Math.cos(a) * w / 2, Math.sin(a) * h]); }
    return this.prism(x, y, rot, l, pts, tone, undefined, door);
  }
  /** A square beam between two points: crane towers and jibs, masts, gantries, lattice legs. */
  beam(p1: V3, p2: V3, w: number, tone: number, heat = 0): Obj {
    const d = unit(sub(p2, p1));
    const a = unit(Math.abs(d[2]) > 0.95 ? cross(d, [1, 0, 0]) : cross(d, [0, 0, 1])), b = cross(a, d);
    const k = w / 2, off = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, t]) => [a[0] * s * k + b[0] * t * k, a[1] * s * k + b[1] * t * k, a[2] * s * k + b[2] * t * k] as V3);
    const lo = off.map((o) => [p1[0] + o[0], p1[1] + o[1], p1[2] + o[2]] as V3), hi = off.map((o) => [p2[0] + o[0], p2[1] + o[1], p2[2] + o[2]] as V3);
    const c = lerp3(p1, p2, 0.5), faces: Face[] = [];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, p = [lo[i], lo[j], hi[j], hi[i]]; faces.push({ p, n: outward(p, c), tone, heat }); }
    faces.push({ p: hi, n: outward(hi, c), tone, heat }, { p: lo, n: outward(lo, c), tone, heat });
    return this.add(faces, c);
  }
  /** A frustum: an earth-covered bunker or a slag heap. */
  mound(x: number, y: number, rot: number, w: number, l: number, h: number, inset: number, tone: number) {
    const f = new Frame(x, y, rot);
    const lo = [[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]].map(([a, b]) => f.p(a, b, 0));
    const hi = [[-w / 2 + inset, -l / 2 + inset], [w / 2 - inset, -l / 2 + inset], [w / 2 - inset, l / 2 - inset], [-w / 2 + inset, l / 2 - inset]].map(([a, b]) => f.p(a, b, h));
    const c = mean([...lo, ...hi]), faces: Face[] = [];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4, p = [lo[i], lo[j], hi[j], hi[i]]; faces.push({ p, n: outward(p, c), tone, heat: 0 }); }
    faces.push({ p: hi, n: [0, 0, 1], tone: tone + 0.03, heat: 0 });
    return this.add(faces, c);
  }
  ball(x: number, y: number, z: number, r: number, tone: number) { this.objs.push({ c: [x, y, z], faces: [], ball: { r, tone } }); }
  /** Dark openings on the face of `o` that looks most along `dir` (doors, bays, windows). */
  marks(o: Obj, dir: V3, rects: [number, number, number, number][], tone: number) {
    const face = o.faces.reduce((best, fc) => (dot(fc.n, dir) > dot(best.n, dir) ? fc : best));
    const [p0, p1, , p3] = face.p, u = sub(p1, p0), v = sub(p3, p0), lift = face.n.map((x) => x * 0.15);
    // rects are fractions of the face: [u0, v0, u1, v1]
    face.marks = (face.marks ?? []).concat(rects.map(([u0, v0, u1, v1]) => ({
      tone, p: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([a, b]) => [p0[0] + u[0] * a + v[0] * b + lift[0], p0[1] + u[1] * a + v[1] * b + lift[1], p0[2] + u[2] * a + v[2] * b + lift[2]] as V3),
    })));
  }
  /** Everything added from `from` on is the target. */
  markTarget(from: number) { for (const o of this.objs.slice(from)) o.target = true; }
}

// ---- Ships, cranes, aircraft ---------------------------------------------------------------
type ShipType = 'warship' | 'cargo' | 'boxship' | 'sub' | 'building';
function ship(b: Builder, x: number, y: number, rot: number, len: number, beam: number, type: ShipType) {
  const f = new Frame(x, y, rot), hb = beam / 2, hl = len / 2;
  const free = type === 'sub' ? 2.5 : type === 'building' ? 12 : Math.max(4, len * 0.045);
  b.extrude(f, [[-hb + 1.5, -hl], [hb - 1.5, -hl], [hb, -hl + 4], [hb, hl * 0.45], [0, hl], [-hb, hl * 0.45], [-hb, -hl + 4]], 0, free, 0.3,
    { top: type === 'building' ? 0.24 : 0.42 });
  const at = (ly: number, w: number, l: number, h: number, tone: number, z0 = free, o: { heat?: number; topHeat?: number } = {}) => {
    const p = f.p(0, ly, 0);
    return b.box(p[0], p[1], rot, w, l, h, tone, { z0, ...o });
  };
  const stack = (ly: number, r: number, h: number) => {
    const p = f.p(0, ly, 0);
    b.cyl(p[0], p[1], r, free, free + h, 0.55, { heat: 0.18, topHeat: 0.6, sides: 8 });
    b.stacks.push([p[0], p[1], free + h]);
  };
  const mast = (ly: number, h: number) => { const p = f.p(0, ly, 0); b.beam([p[0], p[1], free], [p[0], p[1], free + h], 0.8, 0.5); };
  if (type === 'warship') {
    at(len * 0.18, beam * 0.5, len * 0.12, 9, 0.48); at(len * 0.2, beam * 0.3, len * 0.05, 15, 0.5);
    stack(len * 0.02, beam * 0.12, 9); if (len > 130) stack(-len * 0.08, beam * 0.12, 9);
    for (const ly of [len * 0.34, -len * 0.3]) at(ly, beam * 0.35, beam * 0.35, 3, 0.46);
    mast(len * 0.12, 24);
  } else if (type === 'cargo') {
    at(-len * 0.05, beam * 0.75, len * 0.14, 8, 0.48); stack(-len * 0.08, beam * 0.1, 7);
    for (const ly of [len * 0.32, len * 0.15, -len * 0.22, -len * 0.36]) mast(ly, 14);
  } else if (type === 'boxship') {
    at(-len * 0.36, beam * 0.9, len * 0.07, 22, 0.52); stack(-len * 0.42, beam * 0.08, 6);
    for (let ly = -len * 0.28; ly < len * 0.36; ly += 14) at(ly, beam * 0.9, 12.5, b.rnd(5, 13), b.rnd(0.38, 0.62));
  } else if (type === 'sub') {
    at(len * 0.18, beam * 0.35, len * 0.1, 6, 0.36);
  }
}

function hammerhead(b: Builder, x: number, y: number, rot: number, h: number) {
  b.beam([x, y, 0], [x, y, h], 8, 0.5);
  const f = new Frame(x, y, rot);
  b.beam(f.p(0, -22, h + 2), f.p(0, 45, h + 2), 4.5, 0.52);
  const cw = f.p(0, -18, 0); b.box(cw[0], cw[1], rot, 7, 8, 6, 0.46, { z0: h - 3 });
  const cab = f.p(0, 2, 0); b.box(cab[0], cab[1], rot, 9, 9, 5, 0.58, { z0: h + 4, heat: 0.05 });
}
/** A portal crane on a quay, jib slewed to `rot`. */
function portal(b: Builder, x: number, y: number, rot: number) {
  for (const [dx, dy] of [[-4, -4], [4, -4], [4, 4], [-4, 4]]) b.beam([x + dx, y + dy, 0], [x + dx * 0.4, y + dy * 0.4, 12], 1.2, 0.5);
  b.box(x, y, rot, 6, 7, 5, 0.56, { z0: 12 });
  const f = new Frame(x, y, rot);
  b.beam(f.p(0, 2, 15), f.p(0, 26, 28), 1.4, 0.52);
}
/** A ship-to-shore container crane: two A-frames, a boom out over the water. */
function gantry(b: Builder, x: number, y: number, rot: number) {
  const f = new Frame(x, y, rot);
  for (const lx of [-9, 9]) { b.beam(f.p(lx, -14, 0), f.p(lx, -14, 42), 1.8, 0.55); b.beam(f.p(lx, 14, 0), f.p(lx, 14, 42), 1.8, 0.55); }
  for (const lx of [-9, 9]) b.beam(f.p(lx, -40, 42), f.p(lx, 55, 42), 2.2, 0.58);
  const m = f.p(0, -10, 0); b.box(m[0], m[1], rot, 20, 14, 7, 0.6, { z0: 42, heat: 0.04 });
}
function plane(b: Builder, x: number, y: number, rot: number, span: number, modern: boolean) {
  const f = new Frame(x, y, rot), len = span * (modern ? 1.4 : 0.75);
  b.beam(f.p(0, -len / 2, 1.6), f.p(0, len / 2, 1.6), span * 0.12, 0.5, modern ? 0.05 : 0);
  b.beam(f.p(-span / 2, len * 0.08, 1.4), f.p(span / 2, len * 0.08, 1.4), span * (modern ? 0.2 : 0.13), 0.52);
  b.beam(f.p(-span * 0.2, -len * 0.42, 1.8), f.p(span * 0.2, -len * 0.42, 1.8), span * 0.08, 0.5);
  if (modern) { const e = f.p(0, -len / 2, 0); b.ball(e[0], e[1], 1.6, 0.9, 0.85); }
}

// ---- Surroundings -------------------------------------------------------------------------
type Box = [number, number, number, number];
const inside = (x: number, y: number, k: Box[]) => k.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);

/** Paddies in 1942, big fields now. */
function fields(b: Builder, area: Box, keep: Box[], modern: boolean) {
  const [x0, y0, x1, y1] = area, cw = modern ? 160 : 70, ch = modern ? 110 : 45;
  for (let x = x0; x < x1; x += cw) for (let y = y0; y < y1; y += ch) {
    if (inside(x + cw / 2, y + ch / 2, keep) || b.r() < 0.12) continue;
    const g = modern ? 3 : 2.5;
    b.rect(x + g, y + g, x + cw - g, y + ch - g, modern ? b.rnd(0.3, 0.45) : b.rnd(0.24, 0.36));
  }
}
/** A town: wooden houses with tiled roofs in 1942, apartment blocks and offices now. */
function town(b: Builder, area: Box, keep: Box[], modern: boolean, density = 0.75) {
  const [x0, y0, x1, y1] = area, lot = modern ? 46 : 17, road = modern ? 0.47 : 0.43;
  for (let x = x0; x < x1; x += lot * 6) b.strip([x - 3, y0], [x - 3, y1], modern ? 10 : 6, road);
  for (let y = y0; y < y1; y += lot * 5) b.strip([x0, y - 3], [x1, y - 3], modern ? 10 : 6, road);
  for (let x = x0; x < x1; x += lot) for (let y = y0; y < y1; y += lot) {
    if (inside(x, y, keep) || b.r() > density || (x - x0) % (lot * 6) < 1 || (y - y0) % (lot * 5) < 1) continue;
    const cx = x + b.rnd(-2, 2) + lot / 2, cy = y + b.rnd(-2, 2) + lot / 2, rot = b.r() < 0.5 ? 0 : 90;
    if (modern) b.box(cx, cy, rot, b.rnd(18, 30), b.rnd(22, 38), b.rnd(10, 36), b.rnd(0.44, 0.56), { top: b.rnd(0.55, 0.66) });
    else b.gable(cx, cy, rot, b.rnd(6, 9), b.rnd(8, 12), b.rnd(3, 4.5), 2, b.rnd(0.46, 0.54), b.rnd(0.3, 0.4));
  }
}
function trees(b: Builder, area: Box, keep: Box[], n: number) {
  const [x0, y0, x1, y1] = area;
  for (let i = 0; i < n; i++) {
    const x = b.rnd(x0, x1), y = b.rnd(y0, y1);
    if (!inside(x, y, keep)) { const r = b.rnd(4, 7); b.ball(x, y, r * 1.1, r, b.rnd(0.24, 0.3)); }
  }
}
/** Sea south of a shore at `y`, with sun glint streaks and a few wakes. */
function sea(b: Builder, y: number, wiggle = 0) {
  b.shore = y;
  const pts: P2[] = [[-6000, -9000], [6000, -9000], [6000, y - wiggle]];
  for (let x = 6000; x >= -6000; x -= 400) pts.push([x, y + (Math.abs(x) > 900 ? Math.sin(x / 700) * wiggle - wiggle : 0)]);
  b.poly(pts, 0.15);
  for (let i = 0; i < 70; i++) { const x = b.rnd(-3000, 3000), yy = b.rnd(-3500, y - 30); b.strip([x, yy], [x + b.rnd(20, 70), yy + b.rnd(-2, 2)], 1.6, 0.21); }
}
const R = (x: number, y: number, w: number, h: number): Box => [x - w / 2, y - h / 2, x + w / 2, y + h / 2];

// ---- Sites --------------------------------------------------------------------------------
function chimney(b: Builder, x: number, y: number, h: number, r = 3.2) {
  b.cyl(x, y, r, 0, h, 0.5, { topHeat: 0.7, sides: 8 });
  b.stacks.push([x, y, h]);
}

function shipyard(b: Builder, modern: boolean) {
  sea(b, -220, 60);
  b.rect(-750, -220, 750, 360, 0.42);
  // Dry dock with a cruiser in it, slipways with a hull building under its gantry.
  b.rect(-300, -225, -228, 90, 0.2); b.strip([-302, -225], [-302, 92], 4, 0.55); b.strip([-226, -225], [-226, 92], 4, 0.55);
  ship(b, -264, -60, 0, 175, 18, 'warship');
  for (const x of [200, 270, 340]) b.rect(x - 20, -250, x + 20, 70, 0.52);
  ship(b, 270, -70, 0, 150, 20, 'building');
  for (let y = -150; y <= 40; y += 38) for (const dx of [-25, 25]) b.beam([270 + dx, y, 0], [270 + dx, y, 36], 2, 0.5);
  for (const dx of [-25, 25]) b.beam([270 + dx, -152, 36], [270 + dx, 42, 36], 2, 0.52);
  hammerhead(b, -150, -190, 90, 46); hammerhead(b, 110, -190, 270, 46);
  if (modern) gantry(b, 20, -205, 180);
  ship(b, 520, -245, 90, 115, 11, modern ? 'warship' : 'warship');
  ship(b, -560, -250, 270, 105, 10, 'warship');
  // The target: the main machine shop. Then the rest of the yard.
  const t = b.objs.length;
  if (modern) b.box(0, 90, 0, 150, 70, 22, 0.52, { top: 0.62 }); else b.saw(0, 90, 90, 70, 150, 16, 7, 0.5, 0.6, 0.24);
  b.markTarget(t);
  b.gable(-160, 170, 0, 50, 120, 14, 8, 0.5, 0.58); b.gable(200, 180, 90, 40, 110, 12, 7, 0.5, 0.56);
  b.gable(-20, 230, 90, 30, 160, 10, 6, 0.48, 0.55); b.box(-470, 60, 0, 90, 60, 10, 0.5, { top: 0.6 }); b.box(480, 90, 90, 60, 120, 12, 0.5, { top: 0.58 });
  for (const [x, y] of [[90, 150], [-90, 200], [-420, 140]]) chimney(b, x, y, modern ? 30 : 48);
  b.strip([-750, 300], [750, 300], 8, 0.47);
  const keep = [R(0, 70, 1520, 600)];
  town(b, [-1800, 360, 1800, 1900], keep, modern); fields(b, [-3000, 360, 3000, 3600], [R(0, 1130, 3600, 1600)], modern);
  trees(b, [-1800, 300, 1800, 1900], keep, 160);
}

function docks(b: Builder, modern: boolean) {
  sea(b, 0, 80);
  b.rect(-900, 0, 900, 260, 0.44);
  const piers = [-480, -160, 160, 480];
  for (const x of piers) b.rect(x - 28, -340, x + 28, 0, 0.46, 0.2);
  // Ships alongside, and the sheds on the piers. The target is the shed on the second pier from the east.
  for (const x of piers) for (const s of [-1, 1]) if (b.r() < 0.75) ship(b, x + s * 50, -175 + b.rnd(-30, 30), b.r() < 0.5 ? 0 : 180, modern ? 150 : 125, modern ? 22 : 16, modern ? 'boxship' : 'cargo');
  let t = 0;
  for (const x of piers) {
    if (x === 160) t = b.objs.length;
    if (modern) b.box(x, -170, 0, 34, 260, 14, 0.5, { top: 0.6 }); else b.gable(x, -170, 0, 34, 260, 9, 5, 0.48, 0.58);
    if (x === 160) b.markTarget(t);
    for (const s of [-1, 1]) for (let y = -300; y < -40; y += 90) if (!modern) portal(b, x + s * 24, y, s > 0 ? 90 : 270);
  }
  if (modern) {
    for (const x of [-700, -620, 640, 720]) gantry(b, x, -10, 180);
    for (let x = 300; x < 860; x += 16) for (let y = 40; y < 220; y += 34) b.box(x, y, 90, 2.4 * 3, 12, b.rnd(2.6, 10), b.rnd(0.38, 0.6));
  }
  for (const y of [20, 30, 40]) b.strip([-900, y], [900, y], 1.5, 0.55);
  for (const [x, w] of [[-520, 180], [-220, 160], [80, 200], [400, 160]] as const) modern ? b.box(x, 120, 90, 50, w, 12, 0.5, { top: 0.62 }) : b.gable(x, 120, 90, 46, w, 8, 6, 0.48, 0.57);
  if (!modern) for (const x of [-400, 250]) chimney(b, x, 200, 34);
  const keep = [R(0, 60, 1820, 480)];
  town(b, [-2000, 260, 2000, 2200], keep, modern, 0.85); fields(b, [-3500, 2200, 3500, 4200], [], modern);
}

function factory(b: Builder, modern: boolean, aircraft: boolean) {
  b.rect(-420, -300, 420, 320, 0.44);
  const t = b.objs.length;
  if (modern) { const o = b.box(0, 0, 0, 180, 120, 16, 0.5, { top: 0.64 }); b.marks(o, [0, -1, 0], [[0.1, 0, 0.22, 0.6], [0.4, 0, 0.52, 0.6], [0.7, 0, 0.82, 0.6]], 0.3); }
  else b.saw(0, 0, 90, 120, 180, 12, 10, 0.5, 0.62, 0.22);
  b.markTarget(t);
  if (modern) {
    b.box(-220, 40, 0, 120, 100, 14, 0.5, { top: 0.63 }); b.box(220, -20, 0, 110, 150, 18, 0.5, { top: 0.6 });
    for (let i = 0; i < 12; i++) b.box(b.rnd(-80, 80), b.rnd(-50, 50), 0, 4, 6, 2.5, 0.75, { z0: 16, heat: 0.2 });
    for (let x = -360; x < -120; x += 6) for (let y = -280; y < -200; y += 12) if (b.r() < 0.7) b.box(x, y, 0, 2, 4.4, 1.5, b.rnd(0.4, 0.7));
    for (const [x, y] of [[300, 220], [350, 220]]) b.cyl(x, y, 18, 0, 22, 0.5, { top: 0.6 });
  } else {
    b.saw(-220, 30, 90, 90, 120, 11, 7, 0.5, 0.6, 0.23); b.gable(210, -20, 0, 80, 150, 13, 8, 0.48, 0.58);
    b.gable(30, -190, 90, 36, 240, 9, 5, 0.48, 0.56); b.gable(-40, 190, 90, 40, 200, 10, 6, 0.48, 0.57);
    for (const [x, y] of [[-110, 110], [120, 100], [-300, -120], [300, 150]]) chimney(b, x, y, 50);
    // Steel works: a blast furnace with its stoves, a gas holder.
    b.cyl(-260, -210, 11, 0, 42, 0.5, { heat: 0.12, topHeat: 0.5 }); b.stacks.push([-260, -210, 42]);
    for (const dx of [-30, -48, -66]) b.cyl(-260 + dx, -210, 6, 0, 34, 0.52, { heat: 0.18 });
    b.cyl(260, 220, 30, 0, 34, 0.46, { top: 0.52, sides: 16 });
  }
  for (const y of [-260, -250, -240]) b.strip([-1200, y], [420, y], 1.5, 0.55);
  if (aircraft) {
    // The works' own airfield next door, with finished aircraft lined up.
    b.rect(520, -700, 580, 700, modern ? 0.5 : 0.46); b.rect(430, -120, 520, 160, 0.46);
    for (let i = 0; i < 9; i++) plane(b, 460 + (i % 3) * 22, -90 + Math.floor(i / 3) * 40, 270, 15, modern);
  }
  const keep = [R(aircraft ? 80 : 0, 0, aircraft ? 1300 : 880, 720)];
  town(b, [-1700, -1300, 1700, 1300], keep, modern, 0.6);
  fields(b, [-3500, -3500, 3500, 3500], [R(0, 0, 3400, 2600)], modern);
  trees(b, [-1700, -1300, 1700, 1300], keep, 140);
}

function airfield(b: Builder, modern: boolean) {
  b.rect(-1600, -420, 1600, 260, 0.37);
  b.rect(-1300, -245, 1300, -195, modern ? 0.52 : 0.47);
  for (let x = -1250; x < 1250; x += 60) b.strip([x, -220], [x + 30, -220], 1.2, 0.62);
  for (const x of [-1280, 1250]) for (let k = -3; k <= 3; k++) b.strip([x, -220 + k * 6], [x + 30, -220 + k * 6], 2.4, 0.64);
  b.rect(-1000, -110, 1000, -86, 0.48);
  for (const x of [-600, 0, 600]) b.rect(x - 12, -195, x + 12, -86, 0.48);
  b.rect(-500, -86, 500, 40, 0.48);
  const spots = modern ? [-360, -180, 0, 180, 360] : [-300, -150, 0, 150, 300];
  let t = 0;
  for (const x of spots) {
    if (x === 0) t = b.objs.length;
    if (modern) b.arch(x, 100, 0, 26, 36, 11, 0.56, 0.42); else b.arch(x, 110, 0, 48, 60, 16, 0.55, 0.36);
    if (x === 0) b.markTarget(t);
  }
  for (let i = 0; i < (modern ? 6 : 14); i++) plane(b, -420 + i * (modern ? 140 : 62), -30 + (i % 2) * 18, 180, modern ? 11 : 14, modern);
  b.box(560, 20, 0, 12, 12, 22, 0.5, { top: 0.55 }); b.box(560, 20, 0, 16, 16, 5, 0.42, { z0: 22, heat: 0.05 });
  for (const x of [700, 780]) b.gable(x, 80, 0, 24, 60, 6, 4, 0.48, 0.56);
  const keep = [R(0, -80, 3300, 720)];
  fields(b, [-3500, -3500, 3500, 3500], keep, modern); trees(b, [-1800, -800, 1800, 900], keep, 220);
  town(b, [-1200, 400, 1200, 1400], keep, modern, 0.5);
}

function radar(b: Builder, modern: boolean) {
  sea(b, -420, 50);
  b.rect(-200, -160, 200, 160, 0.42);
  for (const [x0, y0, x1, y1] of [[-200, -160, 200, -160], [200, -160, 200, 160], [200, 160, -200, 160], [-200, 160, -200, -160]] as const) b.strip([x0, y0], [x1, y1], 1.2, 0.56);
  b.strip([0, 160], [0, 1400], 7, 0.46);
  const t = b.objs.length;
  if (modern) { b.cyl(0, 0, 14, 0, 9, 0.5, { top: 0.55, sides: 14 }); b.ball(0, 0, 22, 17, 0.62); }
  else { b.box(0, 0, 0, 30, 18, 6, 0.48, { top: 0.55 }); b.beam([0, -6, 6], [0, -6, 26], 1.4, 0.5); b.beam([-12, -6, 26], [12, -6, 26], 1.2, 0.55); b.beam([-12, -6, 20], [12, -6, 20], 1.2, 0.55); }
  b.markTarget(t);
  if (modern) {
    b.cyl(95, 50, 10, 0, 7, 0.5, { sides: 12 }); b.ball(95, 50, 15, 12, 0.6);
    b.prism(-100, 40, 90, 50, [[-16, 0], [16, 0], [6, 24], [-16, 24]], 0.5, (i, n) => (n[2] > 0.1 && Math.abs(n[2]) < 0.95 ? 0.66 : 0.5));
    b.box(-60, -90, 90, 20, 60, 6, 0.5, { top: 0.6, heat: 0.04 }); b.box(80, -90, 0, 16, 16, 4, 0.7, { heat: 0.25 });
  } else for (const [x, y] of [[-70, 60], [70, -60]]) b.gable(x, y, 0, 10, 30, 4, 2.5, 0.48, 0.55);
  const tx = 120, ty = -100;
  for (const [dx, dy] of [[-6, -6], [6, -6], [6, 6], [-6, 6]]) b.beam([tx + dx, ty + dy, 0], [tx + dx * 0.2, ty + dy * 0.2, 48], 0.8, 0.52);
  b.box(tx, ty, 0, 14, 3, 2, 0.6, { z0: 48 });
  trees(b, [-1600, -400, 1600, 1600], [R(0, 0, 440, 360), R(0, 800, 30, 1400)], 700);
  fields(b, [-3000, 900, 3000, 3600], [], modern);
}

function subpens(b: Builder, modern: boolean) {
  sea(b, 0, 70);
  b.rect(-700, 0, 700, 300, 0.44);
  const t = b.objs.length;
  const pen = b.box(0, 70, 0, 280, 120, 20, 0.5, { top: 0.6 });
  b.marks(pen, [0, -1, 0], Array.from({ length: 6 }, (_, i) => [0.04 + i * 0.16, 0, 0.15 + i * 0.16, 0.7] as [number, number, number, number]), 0.12);
  b.markTarget(t);
  for (let i = 0; i < 4; i++) b.rect(-120 + i * 46 - 8, -60, -120 + i * 46 + 8, 10, 0.44, 0.1);
  for (const [x, y] of [[-97, -40], [-5, -60], [180, -120]]) ship(b, x, y, 0, modern ? 95 : 70, modern ? 10 : 6.5, 'sub');
  ship(b, -340, -40, 90, 120, 15, modern ? 'boxship' : 'cargo');
  portal(b, 200, -12, 180); portal(b, -260, -12, 180);
  b.gable(-280, 190, 90, 40, 140, 10, 6, 0.48, 0.57); b.box(260, 190, 0, 90, 70, 12, 0.5, { top: 0.6 });
  if (!modern) chimney(b, 380, 180, 36);
  town(b, [-1800, 320, 1800, 2000], [R(0, 150, 1440, 400)], modern);
}

function oil(b: Builder, modern: boolean) {
  sea(b, -260, 50);
  b.rect(-400, -260, 400, 300, 0.4);
  // Tank farm in bunded squares. In infrared each tank shows its fill level, warmer below.
  let t = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const x = -165 + i * 110, y = -70 + j * 110, r = j === 1 && i === 1 ? 30 : b.rnd(20, 27), level = b.rnd(3, 13);
    for (const [x0, y0, x1, y1] of [[x - 48, y - 48, x + 48, y - 48], [x + 48, y - 48, x + 48, y + 48], [x + 48, y + 48, x - 48, y + 48], [x - 48, y + 48, x - 48, y - 48]] as const) b.strip([x0, y0], [x1, y1], 3, 0.5);
    if (i === 1 && j === 1) t = b.objs.length;
    b.cyl(x, y, r, 0, level, 0.62, { sides: 16 }); b.cyl(x, y, r, level, 16, 0.45, { top: 0.52, sides: 16 });
    if (i === 1 && j === 1) b.markTarget(t);
  }
  for (const y of [-150, -140]) b.strip([-400, y], [400, y], 1.4, 0.56);
  b.rect(-12, -560, 12, -260, 0.46, 0.2); b.rect(-80, -580, 80, -550, 0.46, 0.2);
  ship(b, 0, -620, 90, modern ? 230 : 140, modern ? 36 : 18, 'cargo');
  b.cyl(320, 240, 2.5, 0, 55, 0.5, { topHeat: 0.9, sides: 6 }); b.stacks.push([320, 240, 55]);
  town(b, [-1800, 300, 1800, 1800], [], modern, 0.5); trees(b, [-1800, 300, 1800, 1800], [], 120);
  fields(b, [-3500, 1800, 3500, 3800], [], modern);
}

function base(b: Builder, modern: boolean) {
  b.rect(-380, -320, 380, 320, 0.4);
  b.rect(-120, -200, 120, -80, 0.5);
  const t = b.objs.length;
  const hq = modern ? b.box(0, 0, 90, 50, 110, 14, 0.5, { top: 0.6 }) : b.gable(0, 0, 90, 40, 100, 9, 6, 0.48, 0.57);
  b.marks(hq, [0, -1, 0], [[0.45, 0, 0.55, 0.5]], 0.25);
  b.markTarget(t);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    const x = s * (150 + (i % 2) * 70), y = -240 + i * 90;
    modern ? b.box(x, y, 90, 14, 60, 8, 0.5, { top: 0.6 }) : b.gable(x, y, 90, 12, 56, 4, 3, 0.48, 0.56);
  }
  for (let i = 0; i < 14; i++) b.box(-60 + (i % 7) * 18, 120 + Math.floor(i / 7) * 16, 0, 3, 7, 3, b.rnd(0.45, 0.7), { heat: b.r() < 0.3 ? 0.15 : 0 });
  b.cyl(250, 250, 7, 18, 26, 0.52); for (const [dx, dy] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) b.beam([250 + dx, 250 + dy, 0], [250 + dx * 0.6, 250 + dy * 0.6, 18], 0.8, 0.5);
  for (const [x0, y0, x1, y1] of [[-380, -320, 380, -320], [380, -320, 380, 320], [380, 320, -380, 320], [-380, 320, -380, -320]] as const) b.strip([x0, y0], [x1, y1], 1.2, 0.56);
  const keep = [R(0, 0, 800, 680)];
  trees(b, [-1600, -1600, 1600, 1600], keep, 500); fields(b, [-3500, -3500, 3500, 3500], [R(0, 0, 900, 800)], modern);
}

function bunker(b: Builder, modern: boolean) {
  b.rect(-250, -250, 250, 250, 0.38);
  const t = b.objs.length;
  b.mound(0, 0, 0, 120, 90, 16, 26, 0.4);
  const door = b.box(0, -52, 0, 14, 12, 7, 0.55, { top: 0.4 });
  b.marks(door, [0, -1, 0], [[0.2, 0, 0.8, 0.85]], 0.12);
  b.markTarget(t);
  for (const [x, y, h] of [[50, 40, 30], [-40, 30, 22], [70, -20, 18]]) b.beam([x, y, 14], [x, y, 14 + h], 0.7, 0.55);
  b.strip([0, -58], [0, -900], 8, 0.47); b.box(-90, -120, 0, 20, 30, 6, 0.5, { top: 0.58, heat: modern ? 0.06 : 0 });
  b.box(80, -110, 0, 6, 8, 3, 0.7, { heat: 0.3 });
  trees(b, [-1600, -1600, 1600, 1600], [R(0, 0, 520, 520), R(0, -500, 30, 900)], 900);
  fields(b, [-3500, -3500, 3500, 3500], [R(0, 0, 3200, 3200)], modern);
}

const BUILD: Record<SiteKind, (b: Builder, modern: boolean, name: string) => void> = {
  shipyard: (b, m) => shipyard(b, m), docks: (b, m) => docks(b, m), factory: (b, m, n) => factory(b, m, /aircraft/i.test(n)),
  airfield: (b, m) => airfield(b, m), radar: (b, m) => radar(b, m), subpens: (b, m) => subpens(b, m), oil: (b, m) => oil(b, m),
  base: (b, m) => base(b, m), bunker: (b, m) => bunker(b, m),
};

/** The scene for one strike: the site's kind and era, laid out by `seed`. */
export function buildScene(kind: SiteKind, modern: boolean, name: string, seed: number): Scene {
  const r = mulberry32(seed), b = new Builder(r);
  BUILD[kind](b, modern, name);
  const tgt = b.objs.filter((o) => o.target);
  const pts = tgt.flatMap((o) => (o.ball ? [[o.c[0], o.c[1], o.c[2] + o.ball.r] as V3] : o.faces.flatMap((f) => f.p)));
  const c = mean(pts), top = Math.max(...pts.map((p) => p[2]));
  const aim: V3 = [c[0], c[1], top * 0.7];
  // A miss goes into the water if the site is on the shore, or else off to one side.
  const side = r() < 0.5 ? -1 : 1, off = 110 + r() * 70;
  const miss: V3 = b.shore !== null ? [c[0] + side * off * 0.5, Math.min(c[1] - off, b.shore - 50), 0] : [c[0] + side * off, c[1] + (r() - 0.6) * 80, 0];
  return { flat: b.flat, objs: b.objs, stacks: b.stacks, aim, miss, missWater: b.shore !== null, heading: (r() * 2 - 1) * 14, ground: 0.36 };
}

// ---- Rendering ----------------------------------------------------------------------------
export interface View {
  /** Screen position and depth of a world point, or null behind the camera. */
  project(p: V3): [number, number, number] | null;
  dist(p: V3): number;
  /** Focal length in pixels: m metres at depth z are m * F / z pixels. */
  F: number;
}

const NEAR = 2;
const SHADES: string[] = [];
for (let i = 0; i <= 255; i++) { const v = i; SHADES.push(`rgb(${Math.round(v * 0.94)},${v},${Math.round(v * 0.97)})`); }
/** A grey, faintly cool like a thermal imager's. */
export const shade = (v: number) => SHADES[Math.max(0, Math.min(255, Math.round(v * 255)))];

export function makeView(cam: Cam, W: number, H: number): View & { basis: { r: V3; u: V3; f: V3 } } {
  const f = unit(sub(cam.look, cam.pos));
  const r0 = unit(cross(f, [0, 0, 1])), u0 = cross(r0, f);
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  const r: V3 = [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr];
  const u: V3 = [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr];
  const F = (W / 2) / Math.tan((cam.fov * Math.PI) / 360);
  const project = (p: V3): [number, number, number] | null => {
    const d = sub(p, cam.pos), z = dot(d, f);
    if (z < NEAR) return null;
    return [W / 2 + (dot(d, r) * F) / z, H / 2 - (dot(d, u) * F) / z, z];
  };
  return { project, dist: (p) => Math.hypot(...sub(p, cam.pos)), basis: { r, u, f }, F };
}

/** Draws the scene. `damage` (0 to 1) knocks the target down into hot rubble. */
export function render(ctx: CanvasRenderingContext2D, W: number, H: number, sc: Scene, cam: Cam, damage = 0, t = 0): View {
  const view = makeView(cam, W, H), { r, u, f } = view.basis, F = view.F;
  const toCam = (p: V3): V3 => { const d = sub(p, cam.pos); return [dot(d, r), dot(d, u), dot(d, f)]; };
  const haze = 0.33, fogD = 2600;
  const fog = (v: number, d: number) => v + (haze - v) * (1 - Math.exp(-d / fogD));

  // Ground and sky. The horizon is where level directions far ahead land on screen.
  ctx.fillStyle = shade(sc.ground); ctx.fillRect(0, 0, W, H);
  const fh = unit([f[0], f[1], 0]);
  const far = (a: number): V3 => [cam.pos[0] + (fh[0] * Math.cos(a) - fh[1] * Math.sin(a)) * 1e6, cam.pos[1] + (fh[0] * Math.sin(a) + fh[1] * Math.cos(a)) * 1e6, 0];
  const h1 = view.project(far(-0.7)), h2 = view.project(far(0.7));

  const pts: [number, number][] = [];
  const draw = (face: { p: V3[] }, fill: string): boolean => {
    // Clip to the near plane in camera space, then project.
    const cs = face.p.map(toCam);
    pts.length = 0;
    let anyIn = false;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      if (ain) { pts.push([W / 2 + (a[0] * F) / a[2], H / 2 - (a[1] * F) / a[2]]); anyIn = true; }
      if (ain !== bin) {
        const k = (NEAR - a[2]) / (b[2] - a[2]), x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
        pts.push([W / 2 + (x * F) / NEAR, H / 2 - (y * F) / NEAR]);
      }
    }
    if (!anyIn || pts.length < 3) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H || (x1 - x0 < 0.3 && y1 - y0 < 0.3)) return false;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.fill();
    return true;
  };

  // Big ground polygons (the sea) fog by their nearest edge, not a far corner.
  const near = (bb: [number, number, number, number]) => Math.hypot(Math.max(bb[0], Math.min(bb[2], cam.pos[0])) - cam.pos[0], Math.max(bb[1], Math.min(bb[3], cam.pos[1])) - cam.pos[1], cam.pos[2]);
  for (const fc of sc.flat) draw(fc, shade(fog(fc.tone + fc.heat, near(fc.bb!))));
  if (h1 && h2) {
    // Haze toward the horizon, and the cold sky above it.
    const my = (h1[1] + h2[1]) / 2;
    const g = ctx.createLinearGradient(0, my, 0, my + H * 0.45);
    g.addColorStop(0, shade(haze + 0.02)); g.addColorStop(1, 'rgba(84,90,87,0)');
    ctx.fillStyle = g; ctx.fillRect(0, my, W, H * 0.45);
    const dx = h2[0] - h1[0], dy = h2[1] - h1[1], k = 4000;
    const s = ctx.createLinearGradient(0, my - H * 0.35, 0, my);
    s.addColorStop(0, shade(0.06)); s.addColorStop(1, shade(0.24));
    ctx.fillStyle = s;
    ctx.beginPath();
    ctx.moveTo(h1[0] - dx * k, h1[1] - dy * k); ctx.lineTo(h1[0] + dx * k, h1[1] + dy * k);
    ctx.lineTo(h1[0] + dx * k + dy * k, h1[1] + dy * k - dx * k); ctx.lineTo(h1[0] - dx * k + dy * k, h1[1] - dy * k - dx * k);
    ctx.fill();
  }

  // Solids far to near; within one, its faces far to near (sawtooth roofs aren't convex).
  const order = sc.objs.map((o) => ({ o, d: view.dist(o.c) })).filter((x) => x.d > NEAR).sort((a, b) => b.d - a.d);
  const flick = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7.3);
  for (const { o, d } of order) {
    if (o.ball) {
      const p = view.project(o.c);
      if (!p) continue;
      const rad = (o.ball.r * F) / p[2];
      if (rad < 0.4 || p[0] < -rad || p[0] > W + rad || p[1] < -rad || p[1] > H + rad) continue;
      const v = fog(o.ball.tone, d), gr = ctx.createRadialGradient(p[0] - rad * 0.35, p[1] - rad * 0.4, rad * 0.1, p[0], p[1], rad);
      gr.addColorStop(0, shade(v + 0.1)); gr.addColorStop(1, shade(v - 0.08));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    const wreck = o.target && damage > 0;
    const faces = o.faces.map((fc) => {
      if (!wreck) return fc;
      // Knocked flat: everything above a ragged line comes down, burning.
      return { ...fc, p: fc.p.map(([x, y, z]) => [x, y, z * (1 - 0.72 * damage) * (0.85 + 0.15 * Math.sin(x * 0.3 + y * 0.2))] as V3), marks: undefined };
    });
    const vis = faces.filter((fc) => dot(fc.n, sub(cam.pos, fc.p[0])) > 0 || wreck);
    if (vis.length > 1) vis.sort((a, b) => view.dist(mean(b.p)) - view.dist(mean(a.p)));
    for (const fc of vis) {
      const lit = fc.tone * (0.62 + 0.38 * Math.max(0, dot(fc.n, SUN)));
      const hot = fc.heat + (wreck ? damage * (0.32 + 0.12 * flick) : 0);
      const v = wreck ? lit * (1 - 0.45 * damage) + hot : lit + hot;
      if (!draw(fc, shade(fog(v, d)))) continue;
      if (fc.marks) for (const m of fc.marks) draw(m, shade(fog(m.tone, d)));
    }
  }
  return view;
}
