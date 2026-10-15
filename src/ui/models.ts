// Low-poly 3D models for the battle camera: every surface class built from its periscope silhouette
// (deck profile and parts), submarines lofted from a few numbers per class, aircraft from a short
// spec per type. Local frame: x forward (bow +), y to port, z up, metres; ships' waterline at z = 0.
import { CLASSES } from '../sim/classes';
import { silOf, type ShipSil } from './periscope';
import { hex, mean, outward, sub, unit, type RGB } from './ps1';
import type { V3 } from './strikescene';

export interface MFace { p: V3[]; col: RGB; n: V3; emis?: number; both?: boolean; alpha?: number }
/** A convex piece drawn as one object. `base` pieces (the hull) draw before what stands on them. */
export interface MPart { faces: MFace[]; c: V3; base?: boolean }
export interface Model {
  parts: MPart[]; len: number; beam: number; top: number; draft: number;
  /** Funnel tops and engines: where smoke and heat come from. */
  stacks: V3[];
  deck: (x: number) => number;
}

type P2 = [number, number];
class Mk {
  parts: MPart[] = [];
  /** Adds a piece; faces without a normal get one pointing away from the piece's middle (or `inside`). */
  part(faces: { p: V3[]; col: RGB; n?: V3; emis?: number; both?: boolean; alpha?: number }[], base = false, inside?: V3): MPart {
    const c = mean(faces.flatMap((f) => f.p)), mid = inside ?? c;
    const p: MPart = { c, base, faces: faces.map((f) => ({ ...f, n: f.n ?? outward(f.p, mid) })) };
    this.parts.push(p);
    return p;
  }
  /** A vertical prism over a convex footprint; the top may be shifted (raked funnels). */
  prism(foot: P2[], z0: number, z1: number, col: RGB, top?: RGB, shift: P2 = [0, 0], o: { emis?: number; topEmis?: number } = {}) {
    const lo = foot.map(([x, y]) => [x, y, z0] as V3), hi = foot.map(([x, y]) => [x + shift[0], y + shift[1], z1] as V3);
    const faces: { p: V3[]; col: RGB; n?: V3; emis?: number }[] = [];
    for (let i = 0; i < foot.length; i++) { const j = (i + 1) % foot.length; faces.push({ p: [lo[i], lo[j], hi[j], hi[i]], col, emis: o.emis }); }
    faces.push({ p: hi, col: top ?? col, emis: o.topEmis ?? o.emis }, { p: [...lo].reverse(), col });
    return this.part(faces);
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB, top?: RGB) {
    return this.prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, col, top);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, n: number): P2[] {
    return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry] as P2);
  }
  /** A square bar between two points: masts, gun barrels, struts. */
  beam(p1: V3, p2: V3, w: number, col: RGB) {
    const d = unit(sub(p2, p1));
    const cr = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const a = unit(Math.abs(d[2]) > 0.95 ? cr(d, [1, 0, 0]) : cr(d, [0, 0, 1])), b = cr(a, d), k = w / 2;
    const off = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, t]) => [a[0] * s * k + b[0] * t * k, a[1] * s * k + b[1] * t * k, a[2] * s * k + b[2] * t * k] as V3);
    const lo = off.map((o) => [p1[0] + o[0], p1[1] + o[1], p1[2] + o[2]] as V3), hi = off.map((o) => [p2[0] + o[0], p2[1] + o[1], p2[2] + o[2]] as V3);
    const faces = [0, 1, 2, 3].map((i) => ({ p: [lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]], col }));
    return this.part([...faces, { p: hi, col }, { p: lo, col }]);
  }
  /** A flat plate in the x-y plane (wings, tailplanes), `th` thick. */
  plate(poly: P2[], z: number, th: number, col: RGB) { return this.prism(poly, z - th / 2, z + th / 2, col); }
  /** A flat plate in the x-z plane (fins, rudders, sails seen side on), `th` thick. */
  fin(poly: P2[], y: number, th: number, col: RGB) {
    const a = poly.map(([x, z]) => [x, y - th / 2, z] as V3), b = poly.map(([x, z]) => [x, y + th / 2, z] as V3);
    const faces = poly.map((_, i) => { const j = (i + 1) % poly.length; return { p: [a[i], a[j], b[j], b[i]], col }; });
    return this.part([...faces, { p: a, col }, { p: [...b].reverse(), col }]);
  }
  /**
   * A body lofted through rings of (y, z) points at stations along x: hulls, fuselages, nacelles.
   * `edgeCol(j)` colours the strip after ring point j. Each strip's normal faces away from the axis.
   */
  loft(st: { x: number; ring: P2[] }[], edgeCol: (j: number, z: number) => RGB, o: { base?: boolean; cap0?: RGB; cap1?: RGB } = {}) {
    const faces: { p: V3[]; col: RGB; n?: V3 }[] = [];
    const N = st[0].ring.length;
    for (let i = 0; i + 1 < st.length; i++) {
      const A = st[i], B = st[i + 1];
      const cA = mean(A.ring.map(([y, z]) => [A.x, y, z] as V3)), cB = mean(B.ring.map(([y, z]) => [B.x, y, z] as V3)), axis = mean([cA, cB]);
      for (let j = 0; j < N; j++) {
        const k = (j + 1) % N;
        const raw: V3[] = [[A.x, ...A.ring[j]], [A.x, ...A.ring[k]], [B.x, ...B.ring[k]], [B.x, ...B.ring[j]]];
        const p = raw.filter((q, m) => { const r = raw[(m + 1) % 4]; return Math.abs(q[0] - r[0]) + Math.abs(q[1] - r[1]) + Math.abs(q[2] - r[2]) > 1e-3; });
        if (p.length < 3) continue;
        faces.push({ p, col: edgeCol(j, (A.ring[j][1] + A.ring[k][1]) / 2), n: outward(p, axis) });
      }
    }
    const capOf = (s: { x: number; ring: P2[] }, col: RGB | undefined, dir: number) => {
      if (!col) return;
      const p = s.ring.map(([y, z]) => [s.x, y, z] as V3);
      let span = 0;
      for (const q of p) span = Math.max(span, Math.abs(q[1] - p[0][1]) + Math.abs(q[2] - p[0][2]));
      if (span > 0.05) faces.push({ p, col, n: [dir, 0, 0] });
    };
    capOf(st[0], o.cap0, -1); capOf(st[st.length - 1], o.cap1, 1);
    return this.part(faces, o.base);
  }
}

const ring = (r: number, n: number, cz = 0, ry = r, rot = 0.5): P2[] =>
  Array.from({ length: n }, (_, i) => { const a = ((i + rot) / n) * Math.PI * 2; return [Math.cos(a) * ry, cz + Math.sin(a) * r] as P2; });

// ---- Liveries ----------------------------------------------------------------------------------
interface Livery { hull: RGB; upper: RGB; deck: RGB; funnel: RGB; cap: RGB; boot: RGB; red: RGB }
function livery(key: string): Livery {
  const c = CLASSES[key], n = c?.nation, type = c?.type ?? '', ww2 = !!c && WW2.has(key);
  const L = (hull: string, upper: string, deck: string, funnel = upper): Livery =>
    ({ hull: hex(hull), upper: hex(upper), deck: hex(deck), funnel: hex(funnel), cap: hex('#1e1e22'), boot: hex('#202226'), red: hex('#7a2a22') });
  if (/merchant|transport|tanker|LNG|freighter|container/i.test(type + (c?.name ?? ''))) {
    if (key === 'maru') return L('#4c5054', '#8a8a80', '#6a5a44', '#3a3a3a');
    if (key === 'boxship') return L('#2c4a6a', '#e0e0d8', '#5a5a5a', '#c8c8c0');
    return L('#3a3c40', '#d4d0c0', '#7a6648', '#2a2a2a');
  }
  if (ww2) {
    if (n === 'Germany') return L('#727a82', '#a2a8ae', /battleship|cruiser/.test(type) ? '#9a7c56' : '#6c7074');
    if (n === 'Japan') return L('#565c62', '#7a8188', /carrier/.test(type) ? '#8a7450' : '#7a6448');
    if (n === 'US') return L('#4c5a6c', '#6a7888', '#4c5258');
    if (n === 'UK') return L('#6c747c', '#98a0a8', '#9a8460');
    if (n === 'Italy') return L('#8a9298', '#9ea6ac', '#9a8462');
    return L('#80888e', '#949ca2', '#7a7468');
  }
  if (n === 'Russia') return L('#56626e', '#7c8894', '#3e444a');
  if (n === 'China') return L('#727a84', '#9ea8b0', '#4e545a');
  if (/icebreaker|research|coast guard/.test(type)) return L('#9a2a22', '#e0e0d8', '#5a5a5a', '#e8c040');
  return L('#788290', '#8c96a2', '#4a5056');
}
/** Classes from the 1941 campaign (their hulls and paint are wartime). */
const WW2 = new Set(['bismarck', 'hipper', 'county', 'admiral', 'kgv', 'merchant', 'akagi', 'kaga', 'soryu', 'shokaku', 'taiho', 'shinano', 'kongo', 'yamato',
  'takao', 'agano', 'kagero', 'picket', 'tirpitz', 'yorktown', 'fletcher', 'wickes', 'atlanta', 'flower', 'liberty', 'maru', 'frachter', 'renown', 'ryujo',
  'myoko', 'aoba', 'sendai', 'mogami', 'scharnhorst', 'usca', 'brooklyn', 'lexington', 'deruyter', 'town', 'deutschland', 'zerstorer', 'cavour', 'littorio',
  'zara', 'soldati', 'qe', 'leander', 'hclass', 'isub', 'midget', 'typevii', 'ar196', 'kate', 'mavis', 'jake', 'fw200', 'g4m']);

// ---- Ships -------------------------------------------------------------------------------------
const GENERIC: ShipSil = { kind: 'ship', len: 120, deck: [[0, 5], [0.6, 6], [1, 8]], parts: [{ t: 'box', x0: 0.4, x1: 0.62, h: 14 }, { t: 'funnel', x: 0.45, w: 0.05, h: 18 }, { t: 'mast', x: 0.56, h: 26 }] };

function beamRatio(type: string) {
  if (/battleship/.test(type)) return 0.15;
  if (/carrier|LHD|LPD|landing|icebreaker/.test(type)) return 0.13;
  if (/merchant|transport|tanker|LNG|support|research/.test(type)) return 0.145;
  if (/boat|cutter/.test(type)) return 0.19;
  return 0.105;
}
const PLAN: P2[] = [[0, 0.62], [0.05, 0.84], [0.12, 0.95], [0.25, 1], [0.6, 1], [0.75, 0.9], [0.86, 0.66], [0.94, 0.34], [1, 0.03]];
const interp = (tab: P2[], f: number) => {
  for (let i = 1; i < tab.length; i++) if (f <= tab[i][0]) { const [x0, a] = tab[i - 1], [x1, b] = tab[i]; return a + ((f - x0) / (x1 - x0)) * (b - a); }
  return tab[tab.length - 1][1];
};

/**
 * A ship's model from its silhouette. `split` (0 to 1, stern to bow) cuts it in two at that point,
 * for a ship breaking her back: `pieces[0]` aft of the cut, `pieces[1]` forward of it.
 */
export function shipModel(key: string, split?: number): { model: Model; pieces: MPart[][] } {
  const sil = (silOf(key) as ShipSil | null)?.kind === 'ship' ? (silOf(key) as ShipSil) : GENERIC;
  const card = CLASSES[key], type = card?.type ?? '', lv = livery(key);
  const L = sil.len, B = L * beamRatio(type), draft = Math.min(11, L * 0.038 + 1);
  const X = (f: number) => -L / 2 + f * L;
  const deckF = (f: number) => interp(sil.deck, f);
  const hb = (f: number) => (B / 2) * interp(PLAN, f);
  const mk = new Mk();
  const pieceOf: number[] = [];
  const cut = split ?? 2;
  const tag = (n: number) => { while (pieceOf.length < mk.parts.length) pieceOf.push(n); };

  // The hull, lofted through stations (and through the cut, which is capped dark and burnt).
  const fs = [...new Set([0, 0.04, 0.12, 0.25, 0.4, 0.55, 0.7, 0.8, 0.88, 0.94, 0.98, 1, ...sil.deck.map(([f]) => f)])].sort((a, b) => a - b);
  const stations = (a: number, b: number) => [a, ...fs.filter((f) => f > a + 1e-3 && f < b - 1e-3), b].map((f) => {
    const h = hb(f), d = deckF(f), dr = draft * (f > 0.9 ? 1 - (f - 0.9) * 4 : f < 0.06 ? 0.6 + f * 6 : 1);
    return { x: X(f), ring: [[h, d], [h, 1.1], [h, 0], [h * 0.86, -dr * 0.55], [h * 0.4, -dr], [-h * 0.4, -dr], [-h * 0.86, -dr * 0.55], [-h, 0], [-h, 1.1], [-h, d]] as P2[] };
  });
  const hullCol = (j: number) => (j === 0 || j === 8 ? lv.hull : j === 1 || j === 7 ? lv.boot : j === 9 ? lv.deck : lv.red);
  const burnt = hex('#241c18');
  if (cut < 1) {
    mk.loft(stations(0, cut), hullCol, { base: true, cap0: lv.hull, cap1: burnt }); tag(0);
    mk.loft(stations(cut, 1), hullCol, { base: true, cap0: burnt }); tag(1);
  } else { mk.loft(stations(0, 1), hullCol, { base: true, cap0: lv.hull }); tag(0); }

  // What stands on deck, each piece in the half its middle is in.
  const stacks: V3[] = [];
  const side = (f: number) => (f < cut ? 0 : 1);
  for (const p of sil.parts) {
    if (p.t === 'box') {
      const f = (p.x0 + p.x1) / 2, base = Math.min(deckF(p.x0), deckF(p.x1)), tall = p.h - base;
      const w = Math.min(hb(p.x0), hb(p.x1)) * (tall < 5 ? 1.9 : tall < 12 ? 1.35 : 0.95);
      mk.box(X(p.x0), X(p.x1), -w / 2, w / 2, base - 0.3, p.h, lv.upper); tag(side(f));
    } else if (p.t === 'funnel') {
      const base = deckF(p.x), rx = (p.w * L) / 2, ry = Math.min(rx * 0.7, hb(p.x) * 0.5);
      mk.prism(mk.ellipse(X(p.x), 0, rx, ry, 8), base, p.h, lv.funnel, lv.cap, [-(p.rake ?? 0.004) * L, 0]); tag(side(p.x));
      stacks.push([X(p.x) - (p.rake ?? 0.004) * L, 0, p.h]);
    } else if (p.t === 'turret') {
      const base = deckF(p.x), w = p.w * L, dir = p.x > 0.5 ? 1 : -1;
      if (p.h - 3.2 > base + 0.5) { mk.prism(mk.ellipse(X(p.x), 0, w * 0.36, w * 0.36, 8), base, p.h - 3.2, lv.upper); tag(side(p.x)); }
      // Turret: a box with a sloped face toward the end it points at.
      const tx = X(p.x), hw = Math.min(w * 0.45, hb(p.x) * 0.8), z0 = p.h - 3.4, z1 = p.h;
      mk.part([
        { p: [[tx - (dir * w) / 2, -hw, z0], [tx + (dir * w) / 2, -hw, z0], [tx + (dir * w) / 2, hw, z0], [tx - (dir * w) / 2, hw, z0]], col: lv.upper },
        { p: [[tx - (dir * w) / 2, -hw, z1], [tx + (dir * w) * 0.3, -hw, z1], [tx + (dir * w) * 0.3, hw, z1], [tx - (dir * w) / 2, hw, z1]], col: lv.upper },
        { p: [[tx + (dir * w) * 0.3, -hw, z1], [tx + (dir * w) / 2, -hw, z0], [tx + (dir * w) / 2, hw, z0], [tx + (dir * w) * 0.3, hw, z1]], col: lv.upper },
        { p: [[tx - (dir * w) / 2, -hw, z0], [tx - (dir * w) / 2, hw, z0], [tx - (dir * w) / 2, hw, z1], [tx - (dir * w) / 2, -hw, z1]], col: lv.upper },
        { p: [[tx - (dir * w) / 2, -hw, z0], [tx + (dir * w) / 2, -hw, z0], [tx + (dir * w) * 0.3, -hw, z1], [tx - (dir * w) / 2, -hw, z1]], col: lv.upper },
        { p: [[tx - (dir * w) / 2, hw, z0], [tx + (dir * w) / 2, hw, z0], [tx + (dir * w) * 0.3, hw, z1], [tx - (dir * w) / 2, hw, z1]], col: lv.upper },
      ]); tag(side(p.x));
      const gl = p.gun * L, n = w > 6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const y = n === 1 ? 0 : (i - 0.5) * hw * 0.9;
        mk.beam([tx + (dir * w) / 2 - dir, y, z0 + 1.4], [tx + (dir * w) / 2 + dir * gl, y, z0 + 1.6], Math.max(0.5, w * 0.06), hex('#4a4e54')); tag(side(p.x));
      }
    } else if (p.t === 'mast') {
      const base = deckF(p.x), x = X(p.x);
      mk.beam([x, 0, base], [x, 0, p.h], 0.9, lv.upper); tag(side(p.x));
      mk.beam([x, -L * 0.025, p.h * 0.82], [x, L * 0.025, p.h * 0.82], 0.6, lv.upper); tag(side(p.x));
      if (p.tripod) for (const s of [-1, 1]) { mk.beam([x, 0, p.h * 0.72], [x - L * 0.025, s * hb(p.x) * 0.5, base], 0.7, lv.upper); tag(side(p.x)); }
    } else if (p.t === 'slab') {
      const f = (p.x0 + p.x1) / 2, long = p.x1 - p.x0 > 0.4;
      const w = long ? B * 1.18 : Math.min(hb(p.x0), hb(p.x1)) * 1.6;
      mk.box(X(p.x0), X(p.x1), -w / 2, w / 2, p.h - p.th, p.h, long ? lv.hull : lv.upper, long ? lv.deck : undefined); tag(side(f));
    } else if (p.t === 'dfunnel') {
      const x = X(p.x), w = p.w * L;
      mk.box(x - w / 2, x + w / 2, -hb(p.x) - w * 0.8, -hb(p.x) + 0.5, p.m, p.h, lv.funnel); tag(side(p.x));
      stacks.push([x, -hb(p.x) - w * 0.8, p.m]);
    }
  }
  const top = Math.max(...sil.parts.map((p) => p.h), ...sil.deck.map(([, h]) => h));
  const model: Model = { parts: mk.parts, len: L, beam: B, top, draft, stacks, deck: (x) => deckF((x + L / 2) / L) };
  const pieces: MPart[][] = [[], []];
  mk.parts.forEach((p, i) => pieces[pieceOf[i] ?? 0].push(p));
  return { model, pieces: cut < 1 ? pieces : [mk.parts] };
}

// ---- Submarines --------------------------------------------------------------------------------
interface SubSpec {
  len: number; beam: number;
  /** Sail: middle as a fraction from the bow, length as a fraction of the hull, height above the hull in metres. */
  sail: [number, number, number];
  /** A raised casing aft of the sail (missile deck, double-hull hump): from and to as fractions from the bow, height. */
  hump?: [number, number, number];
  style: 'ssn' | 'ssk' | 'ww2' | 'drone' | 'midget';
  col: string;
}
const SUBS: Record<string, SubSpec> = {
  virginia: { len: 140, beam: 10.4, sail: [0.24, 0.1, 6], style: 'ssn', col: '#2a2e33' },
  yasen: { len: 130, beam: 13, sail: [0.3, 0.13, 5.5], hump: [0.36, 0.55, 1.2], style: 'ssn', col: '#25292e' },
  akula: { len: 113, beam: 13.5, sail: [0.36, 0.14, 6], hump: [0.42, 0.7, 2.2], style: 'ssn', col: '#25292e' },
  oscar: { len: 155, beam: 18, sail: [0.38, 0.17, 6.5], hump: [0.12, 0.62, 1.4], style: 'ssn', col: '#23272c' },
  kilo: { len: 74, beam: 10, sail: [0.38, 0.16, 5], style: 'ssk', col: '#2a2e33' },
  deepsub: { len: 70, beam: 7, sail: [0.4, 0.12, 2.5], style: 'ssk', col: '#3a3e44' },
  isub: { len: 109, beam: 9.1, sail: [0.42, 0.1, 5], style: 'ww2', col: '#4c5258' },
  midget: { len: 24, beam: 1.9, sail: [0.42, 0.14, 1.2], style: 'midget', col: '#3e444a' },
  typevii: { len: 67, beam: 6.2, sail: [0.45, 0.12, 4.2], style: 'ww2', col: '#6a7076' },
  borei: { len: 170, beam: 13.5, sail: [0.26, 0.1, 7], hump: [0.33, 0.6, 2.6], style: 'ssn', col: '#23272c' },
  belgorod: { len: 184, beam: 18, sail: [0.36, 0.15, 6.5], hump: [0.12, 0.62, 1.4], style: 'ssn', col: '#23272c' },
  khabarovsk: { len: 135, beam: 13, sail: [0.3, 0.12, 5.5], hump: [0.36, 0.52, 1.5], style: 'ssn', col: '#25292e' },
  poseidon: { len: 20, beam: 1.6, sail: [0.5, 0, 0], style: 'drone', col: '#4a5056' },
  type093b: { len: 110, beam: 11, sail: [0.25, 0.12, 6], hump: [0.32, 0.46, 2.2], style: 'ssn', col: '#2c3035' },
  type095: { len: 110, beam: 12, sail: [0.28, 0.12, 5.5], style: 'ssn', col: '#2c3035' },
  type094: { len: 135, beam: 12.5, sail: [0.24, 0.11, 6.5], hump: [0.31, 0.6, 3.6], style: 'ssn', col: '#2c3035' },
  type096: { len: 155, beam: 14, sail: [0.27, 0.11, 6], hump: [0.34, 0.6, 1.8], style: 'ssn', col: '#2c3035' },
  type039: { len: 77, beam: 8.4, sail: [0.32, 0.14, 4.5], style: 'ssk', col: '#2c3035' },
  kalvari: { len: 67, beam: 6.2, sail: [0.35, 0.13, 4.2], style: 'ssk', col: '#2c3035' },
  arihant: { len: 112, beam: 11, sail: [0.26, 0.11, 6], hump: [0.33, 0.55, 2.4], style: 'ssn', col: '#2c3035' },
  ghadir: { len: 29, beam: 3, sail: [0.42, 0.18, 1.8], style: 'midget', col: '#3e444a' },
  riachuelo: { len: 72, beam: 6.2, sail: [0.35, 0.13, 4.2], style: 'ssk', col: '#2c3035' },
  alvaro: { len: 100, beam: 9.8, sail: [0.3, 0.12, 5], style: 'ssn', col: '#2c3035' },
  type209: { len: 62, beam: 6.2, sail: [0.38, 0.13, 4], style: 'ssk', col: '#2c3035' },
  taigei: { len: 84, beam: 9.1, sail: [0.32, 0.12, 5.5], style: 'ssk', col: '#2c3035' },
  collins: { len: 78, beam: 7.8, sail: [0.36, 0.12, 4.8], style: 'ssk', col: '#2c3035' },
  reis: { len: 68, beam: 6.3, sail: [0.36, 0.13, 4.4], style: 'ssk', col: '#2c3035' },
};
export const subSpec = (key: string): SubSpec => SUBS[key] ?? { len: 90, beam: 9, sail: [0.32, 0.12, 5], style: 'ssk', col: '#2c3035' };

/** A submarine's hull radius along its length, `f` 0 at the stern to 1 at the bow. */
function subRadius(s: SubSpec, f: number) {
  const R = s.beam / 2;
  const tail = s.style === 'ssk' || s.style === 'midget' ? 0.42 : s.style === 'ww2' ? 0.2 : 0.28;
  const nose = s.style === 'ww2' ? 0.06 : s.style === 'drone' ? 0.2 : 0.1;
  if (f > 1 - nose) { const k = (f - (1 - nose)) / nose; return R * Math.sqrt(Math.max(0, 1 - k * k)) * 0.97 + R * 0.03 * (1 - k); }
  if (f < tail) { const k = f / tail; return R * (0.12 + 0.88 * Math.pow(k, s.style === 'ww2' ? 1 : 0.7)); }
  return R;
}

export function subModel(key: string, split?: number): { model: Model; pieces: MPart[][] } {
  const s = subSpec(key), L = s.len, R = s.beam / 2, X = (f: number) => -L / 2 + f * L;
  const col = hex(s.col), dark = hex('#16181c'), mk = new Mk(), cut = split ?? 2;
  const pieceOf: number[] = [];
  const tag = (n: number) => { while (pieceOf.length < mk.parts.length) pieceOf.push(n); };
  const fs = [0, 0.03, 0.08, 0.15, 0.22, 0.3, 0.45, 0.6, 0.75, 0.86, 0.92, 0.96, 0.99, 1];
  const ww2 = s.style === 'ww2';
  const stations = (a: number, b: number) => [a, ...fs.filter((f) => f > a + 1e-3 && f < b - 1e-3), b].map((f) => {
    const r = Math.max(0.02, subRadius(s, f));
    return { x: X(f), ring: ring(r, 10, 0, ww2 ? r * 0.9 : r) };
  });
  const burnt = hex('#1a1412');
  if (cut < 1) {
    mk.loft(stations(0, cut), () => col, { base: true, cap1: burnt }); tag(0);
    mk.loft(stations(cut, 1), () => col, { base: true, cap0: burnt }); tag(1);
  } else { mk.loft(stations(0, 1), () => col, { base: true }); tag(0); }
  const side = (fromBow: number) => (1 - fromBow < cut ? 0 : 1);
  // Sail, tapered at the leading edge, with a deck gun and casing on the wartime boats.
  if (s.sail[1] > 0) {
    const fc = 1 - s.sail[0], sl = s.sail[1] * L, x0 = X(fc) - sl / 2, x1 = X(fc) + sl / 2, w = Math.min(R * 0.7, sl * 0.3 + 0.6), top = R * 0.85 + s.sail[2];
    mk.prism([[x0, 0], [x0 + sl * 0.15, -w / 2], [x1 - sl * 0.25, -w / 2], [x1, 0], [x1 - sl * 0.25, w / 2], [x0 + sl * 0.15, w / 2]], R * 0.6, top, col, undefined, [-sl * (ww2 ? 0 : 0.08), 0]); tag(side(s.sail[0]));
    if (s.style === 'ssn' && !/virginia|type09|alvaro|arihant/.test(key) && key !== 'virginia') {
      mk.plate([[X(fc) + sl * 0.15, -w / 2 - 3], [X(fc) + sl * 0.35, -w / 2 - 3], [X(fc) + sl * 0.35, w / 2 + 3], [X(fc) + sl * 0.15, w / 2 + 3]], top - s.sail[2] * 0.45, 0.4, col); tag(side(s.sail[0]));
    }
  }
  if (s.hump) {
    const [a, b, h] = s.hump, w = R * 1.3;
    mk.prism([[X(1 - b), 0], [X(1 - b) + 3, -w / 2], [X(1 - a) - 2, -w / 2], [X(1 - a), 0], [X(1 - a) - 2, w / 2], [X(1 - b) + 3, w / 2]], R * 0.55, R + h, col); tag(side((a + b) / 2));
  }
  if (ww2) {
    mk.box(X(0.1), X(0.92), -R * 0.55, R * 0.55, R * 0.7, R * 1.05, hex('#5a5048')); tag(side(0.5));
    const gx = X(1 - s.sail[0] + s.sail[1] * 0.9);
    mk.box(gx - 0.6, gx + 0.6, -0.6, 0.6, R * 1.05, R * 1.05 + 1.4, col); tag(side(s.sail[0] - 0.1));
    mk.beam([gx, 0, R * 1.05 + 1.1], [gx + 3.4, 0, R * 1.05 + 1.3], 0.3, col); tag(side(s.sail[0] - 0.1));
  }
  // Tail: rudders above and below, stern planes, and a shrouded pump-jet or a propeller.
  const tx = X(0.035), tr = Math.max(R * 0.9, 1);
  if (s.style !== 'midget' || key === 'ghadir') {
    mk.fin([[tx - 1, 0], [tx + L * 0.07, 0], [tx + L * 0.03, tr * 1.6], [tx - 0.5, tr * 1.6]], 0, 0.5, col); tag(0);
    mk.fin([[tx - 1, 0], [tx + L * 0.07, 0], [tx + L * 0.03, -tr * 1.4], [tx - 0.5, -tr * 1.4]], 0, 0.5, col); tag(0);
    mk.plate([[tx - 1, -tr * 1.6], [tx + L * 0.03, -tr * 1.6], [tx + L * 0.07, 0], [tx + L * 0.03, tr * 1.6], [tx - 1, tr * 1.6]], 0, 0.5, col); tag(0);
  }
  if (s.style === 'ssn' && !/^type09[34]$|alvaro/.test(key)) {
    mk.loft([{ x: X(0) - 1.5, ring: ring(R * 0.42, 8) }, { x: X(0) + 2.5, ring: ring(R * 0.42, 8) }], () => dark, { cap0: dark }); tag(0);
  } else {
    mk.fin([[X(0) - 1.2, -R * 0.5], [X(0) - 0.6, -R * 0.5], [X(0) - 0.6, R * 0.5], [X(0) - 1.2, R * 0.5]], 0, 0.3, dark); tag(0);
    mk.plate([[X(0) - 1.2, -R * 0.5], [X(0) - 0.6, -R * 0.5], [X(0) - 0.6, R * 0.5], [X(0) - 1.2, R * 0.5]], 0, 0.3, dark); tag(0);
  }
  const model: Model = { parts: mk.parts, len: L, beam: s.beam, top: R + s.sail[2], draft: R, stacks: [], deck: () => R };
  const pieces: MPart[][] = [[], []];
  mk.parts.forEach((p, i) => pieces[pieceOf[i] ?? 0].push(p));
  return { model, pieces: cut < 1 ? pieces : [mk.parts] };
}

// ---- Aircraft ----------------------------------------------------------------------------------
interface AirSpec {
  len: number; span: number; fus: number; sweep: number; chord: number;
  /** Wing position: root middle as a fraction from the nose; height on the fuselage, -1 low to 1 high (2 a parasol). */
  wingAt: number; wingZ: number;
  eng: { kind: 'prop' | 'jet' | 'buried' | 'pod'; y: number[] };
  heli?: boolean; floats?: 'twin' | 'single' | 'hull';
  col: string;
}
const AIRS: Record<string, AirSpec> = {
  il38: { len: 40, span: 37.4, fus: 1.8, sweep: 2, chord: 4.6, wingAt: 0.42, wingZ: -0.6, eng: { kind: 'prop', y: [5.5, 11] }, col: '#a4aab0' },
  tu142: { len: 50, span: 51, fus: 1.6, sweep: 35, chord: 6, wingAt: 0.5, wingZ: 0, eng: { kind: 'prop', y: [7, 14] }, col: '#b0b5ba' },
  tu22m3: { len: 42, span: 30, fus: 1.6, sweep: 55, chord: 7, wingAt: 0.5, wingZ: -0.2, eng: { kind: 'buried', y: [] }, col: '#9aa0a6' },
  h6k: { len: 34.8, span: 33, fus: 1.4, sweep: 35, chord: 5, wingAt: 0.5, wingZ: 0, eng: { kind: 'buried', y: [2.4] }, col: '#b8bcc0' },
  h6j: { len: 34.8, span: 33, fus: 1.4, sweep: 35, chord: 5, wingAt: 0.5, wingZ: 0, eng: { kind: 'buried', y: [2.4] }, col: '#aab2b8' },
  kq200: { len: 36, span: 38, fus: 1.9, sweep: 3, chord: 4.6, wingAt: 0.42, wingZ: 0.9, eng: { kind: 'prop', y: [5.5, 11] }, col: '#a0a8b0' },
  p8a: { len: 39.5, span: 37.6, fus: 1.9, sweep: 25, chord: 5.5, wingAt: 0.5, wingZ: -0.6, eng: { kind: 'pod', y: [5] }, col: '#8e979e' },
  p8i: { len: 39.5, span: 37.6, fus: 1.9, sweep: 25, chord: 5.5, wingAt: 0.5, wingZ: -0.6, eng: { kind: 'pod', y: [5] }, col: '#9aa0a6' },
  p3am: { len: 35.6, span: 30.4, fus: 1.7, sweep: 3, chord: 4.2, wingAt: 0.42, wingZ: -0.6, eng: { kind: 'prop', y: [4.8, 9.5] }, col: '#a5abb0' },
  ka27: { len: 11.3, span: 0, fus: 1.6, sweep: 0, chord: 0, wingAt: 0.5, wingZ: 0, eng: { kind: 'buried', y: [] }, heli: true, col: '#6e786c' },
  ka28: { len: 11.3, span: 0, fus: 1.6, sweep: 0, chord: 0, wingAt: 0.5, wingZ: 0, eng: { kind: 'buried', y: [] }, heli: true, col: '#7a8478' },
  ar196: { len: 11, span: 12.4, fus: 0.65, sweep: 0, chord: 2.2, wingAt: 0.4, wingZ: -0.8, eng: { kind: 'prop', y: [0] }, floats: 'twin', col: '#8a9488' },
  kate: { len: 10.3, span: 15.5, fus: 0.65, sweep: 3, chord: 2.4, wingAt: 0.42, wingZ: -0.9, eng: { kind: 'prop', y: [0] }, col: '#6a7a52' },
  jake: { len: 11.3, span: 14.5, fus: 0.65, sweep: 2, chord: 2.3, wingAt: 0.42, wingZ: -0.9, eng: { kind: 'prop', y: [0] }, floats: 'twin', col: '#7a8460' },
  mavis: { len: 25.6, span: 40, fus: 1.5, sweep: 0, chord: 4, wingAt: 0.45, wingZ: 2.6, eng: { kind: 'prop', y: [4.5, 9] }, floats: 'hull', col: '#7a8470' },
  fw200: { len: 23.5, span: 33, fus: 1.25, sweep: 4, chord: 3.8, wingAt: 0.42, wingZ: -0.6, eng: { kind: 'prop', y: [4.2, 8.6] }, col: '#707a68' },
  g4m: { len: 20, span: 25, fus: 1.25, sweep: 2, chord: 3.8, wingAt: 0.42, wingZ: 0, eng: { kind: 'prop', y: [3.4] }, col: '#6a7a54' },
};
export const airSpec = (key: string): AirSpec => AIRS[key] ?? AIRS.il38;

/** An aircraft, nose toward +x. `engines` returns where its engines are, for fire. */
export function airModel(key: string): { model: Model; engines: V3[]; rotors: MPart[] } {
  const s = airSpec(key), L = s.len, R = s.fus, col = hex(s.col), dark = hex('#2a2e34'), glass = hex('#1c2a38');
  const mk = new Mk(), X = (f: number) => L / 2 - f * L, engines: V3[] = [], rotors: MPart[] = [];
  if (s.heli) {
    const fus = [[0, 0.2], [0.04, 0.7], [0.16, 1], [0.5, 1], [0.62, 0.55], [0.66, 0.25]] as P2[];
    mk.loft(fus.map(([f, k]) => ({ x: X(f), ring: ring(R * k * 1.15, 8, 0, R * k) })), () => col, { base: true, cap0: glass, cap1: col });
    mk.loft([{ x: X(0.6), ring: ring(0.45, 6, 0.4) }, { x: X(1), ring: ring(0.3, 6, 0.5) }], () => col, { cap1: col });
    for (const y of [-1.6, 1.6]) mk.fin([[X(1), 0], [X(0.92), 0], [X(0.93), 1.9], [X(1), 1.9]], y, 0.2, col);
    mk.plate([[X(1), -1.7], [X(0.94), -1.7], [X(0.94), 1.7], [X(1), 1.7]], 0.4, 0.2, col);
    mk.box(X(0.45), X(0.2), -0.6, 0.6, R * 1.1, R * 1.1 + 1.2, col);
    for (const z of [R * 1.1 + 1.4, R * 1.1 + 2.4]) {
      const d = mk.part([{ p: ring(7.9, 10, 0, 7.9).map(([y, x]) => [X(0.32) + x, y, z] as V3), col: hex('#3a3e44'), both: true, alpha: 0.35, n: [0, 0, 1] }]);
      rotors.push(d);
    }
    engines.push([X(0.3), 0, R * 1.2]);
    return { model: { parts: mk.parts, len: L, beam: 3.8, top: R + 3, draft: R, stacks: [], deck: () => R }, engines, rotors };
  }
  // Fuselage: glazed or radome nose, tapering and lifting to the tail.
  const prof: [number, number, number][] = [[0, 0.15, 0], [0.03, 0.6, 0], [0.08, 0.92, 0], [0.15, 1, 0], [0.6, 1, 0], [0.8, 0.7, 0.25], [0.95, 0.35, 0.55], [1, 0.2, 0.65]];
  mk.loft(prof.map(([f, k, lift]) => ({ x: X(f), ring: ring(R * k, 8, R * lift) })), () => col, { base: true, cap0: col, cap1: col });
  // Cockpit glazing: a dark band on the nose.
  mk.box(X(0.1), X(0.04), -R * 0.62, R * 0.62, R * 0.55, R * 0.85, glass);
  const wz = s.wingZ > 1.5 ? R + 2.4 : s.wingZ * R * 0.8, rootX = X(s.wingAt) + s.chord / 2, sw = Math.tan((s.sweep * Math.PI) / 180);
  const half = s.span / 2, tipLE = rootX - (half - R) * sw, tipC = s.chord * 0.45;
  for (const sgn of [-1, 1]) {
    mk.plate([[rootX, sgn * R * 0.6], [tipLE, sgn * half], [tipLE - tipC, sgn * half], [rootX - s.chord, sgn * R * 0.6]].map(([x, y]) => [x, y] as P2), wz, Math.max(0.3, s.chord * 0.1), col);
  }
  if (s.wingZ > 1.5) for (const sgn of [-1, 1]) mk.beam([X(s.wingAt), sgn * R * 0.5, R * 0.8], [X(s.wingAt) - 1, sgn * 4, wz], 0.4, col);
  // Tail: fin and tailplane.
  const tz = R * 0.65, fh = Math.max(2.2, L * 0.17), tl = L * 0.16;
  mk.fin([[X(1), tz], [X(1) + tl, tz], [X(1) + tl * 0.45 - fh * 0.15, tz + fh], [X(1) - fh * 0.2, tz + fh]], 0, Math.max(0.25, R * 0.18), col);
  const ts = Math.max(3, s.span * 0.17);
  mk.plate([[X(1) + tl * 0.8, 0], [X(1) + tl * 0.3, ts], [X(1) - 0.2, ts], [X(1), 0]], tz + 0.2, 0.25, col);
  mk.plate([[X(1) + tl * 0.8, 0], [X(1), 0], [X(1) - 0.2, -ts], [X(1) + tl * 0.3, -ts]], tz + 0.2, 0.25, col);
  // Engines.
  for (const y of s.eng.y) for (const sgn of y === 0 ? [1] : [-1, 1]) {
    const ex = rootX - (Math.abs(y) - R) * sw, yy = sgn * y;
    if (s.eng.kind === 'prop') {
      const nr = y === 0 ? R * 0.95 : Math.max(0.5, R * 0.36), x0 = y === 0 ? X(0) - 0.2 : ex + 1.6, x1 = y === 0 ? X(0.12) : ex - s.chord * 0.9;
      if (y !== 0) mk.loft([{ x: x0, ring: ring(nr, 6, wz - nr * 0.3, nr) }, { x: x1, ring: ring(nr * 0.7, 6, wz, nr * 0.7) }].map((q) => ({ x: q.x, ring: q.ring.map(([a, b]) => [a + yy, b] as P2) })), () => col, { cap0: dark });
      const pr = y === 0 ? R * 2.1 : Math.max(1.6, s.chord * 0.55);
      const pz = y === 0 ? 0 : wz - nr * 0.3;
      mk.part([{ p: ring(pr, 8, pz, pr).map(([a, b]) => [x0 + 0.15, yy + a, b] as V3), col: hex('#40444a'), both: true, alpha: 0.4, n: [1, 0, 0] }]);
      engines.push([x1, yy, wz]);
    } else if (s.eng.kind === 'pod') {
      const nr = R * 0.5, ez = wz - nr * 1.3;
      mk.loft([{ x: ex + 2.6, ring: ring(nr, 8, ez) }, { x: ex - 1.4, ring: ring(nr * 0.8, 8, ez) }].map((q) => ({ x: q.x, ring: q.ring.map(([a, b]) => [a + yy, b] as P2) })), () => col, { cap0: dark, cap1: dark });
      engines.push([ex - 1.4, yy, ez]);
    } else if (s.eng.kind === 'buried') engines.push([X(0.7), yy, wz]);
  }
  if (s.eng.kind === 'buried' && !s.eng.y.length) engines.push([X(0.95), 0, R * 0.3]);
  if (s.floats === 'twin' || s.floats === 'single') {
    for (const sgn of s.floats === 'twin' ? [-1, 1] : [0]) {
      const fy = sgn * s.span * 0.13, fz = -R * 2.6;
      mk.loft([[0.05, 0.1], [0.15, 1], [0.6, 0.9], [0.8, 0.2]].map(([f, k]) => ({ x: X(f), ring: ring(0.45 * k + 0.05, 6, fz, 0.42 * k + 0.05).map(([a, b]) => [a + fy, b] as P2) })), () => col);
      mk.beam([X(0.3), fy, fz + 0.3], [X(0.3), fy * 0.5, wz], 0.18, col); mk.beam([X(0.55), fy, fz + 0.3], [X(0.55), fy * 0.5, wz], 0.18, col);
    }
  }
  return { model: { parts: mk.parts, len: L, beam: s.span, top: R * 2 + fh, draft: R, stacks: [], deck: () => R }, engines, rotors };
}

// ---- Weapons -----------------------------------------------------------------------------------
/** A torpedo or missile body: `len` long, `r` radius, nose toward +x, with fins at the tail. */
export function weaponModel(len: number, r: number, col: RGB, finSpan = 0): MPart[] {
  const mk = new Mk(), X = (f: number) => len / 2 - f * len;
  mk.loft([[0, 0.2], [0.05, 0.85], [0.1, 1], [0.85, 1], [1, 0.6]].map(([f, k]) => ({ x: X(f), ring: ring(r * k, 6) })), () => col, { cap1: hex('#202020') });
  if (finSpan) { mk.plate([[X(0.85), -finSpan], [X(0.98), -finSpan], [X(0.98), finSpan], [X(0.85), finSpan]], 0, 0.06, col); mk.fin([[X(0.85), -finSpan], [X(0.98), -finSpan], [X(0.98), finSpan], [X(0.85), finSpan]], 0, 0.06, col); }
  return mk.parts;
}

// ---- Placing a model in the world ---------------------------------------------------------------
/** Where a model (or one piece of it) is: `pivot` in model space goes to `pos`; heading (compass degrees), pitch (radians, bow up) and roll (radians, to starboard). */
export interface Pose { pos: V3; pivot?: V3; hdg: number; pitch?: number; roll?: number; spin?: number }
export function poseFn(ps: Pose) {
  const pv = ps.pivot ?? [0, 0, 0], h = (ps.hdg * Math.PI) / 180;
  const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(ps.pitch ?? 0), sp = Math.sin(ps.pitch ?? 0), cr = Math.cos(ps.roll ?? 0), sr = Math.sin(ps.roll ?? 0);
  const cs = Math.cos(ps.spin ?? 0), ss = Math.sin(ps.spin ?? 0);
  const rot = (q: V3): V3 => {
    // Yaw spin (helicopters going round), roll about the fore-and-aft axis, pitch about the athwartships axis, then heading.
    let [x, y, z] = q;
    [x, y] = [x * cs - y * ss, x * ss + y * cs];
    [y, z] = [y * cr + z * sr, -y * sr + z * cr];
    [x, z] = [x * cp - z * sp, x * sp + z * cp];
    // Local +x is the heading; local +y is to port, 90 degrees anticlockwise of it.
    return [x * sh - y * ch, x * ch + y * sh, z];
  };
  return {
    point: (q: V3): V3 => { const r = rot([q[0] - pv[0], q[1] - pv[1], q[2] - pv[2]]); return [r[0] + ps.pos[0], r[1] + ps.pos[1], r[2] + ps.pos[2]]; },
    dir: rot,
  };
}
