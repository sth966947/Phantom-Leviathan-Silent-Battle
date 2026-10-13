export interface Vec { x: number; y: number }

export const D2R = Math.PI / 180;
/** Nautical miles per second for one knot. */
export const KT = 1 / 3600;

export const norm = (a: number) => ((a % 360) + 360) % 360;
/** Signed smallest difference a - b, in (-180, 180]. */
export const angDiff = (a: number, b: number) => { const d = norm(a - b); return d > 180 ? d - 360 : d; };
export const brg = (from: Vec, to: Vec) => norm(Math.atan2(to.x - from.x, to.y - from.y) / D2R);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const approach = (v: number, target: number, step: number) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
export const offset = (p: Vec, bearing: number, range: number): Vec => ({ x: p.x + Math.sin(bearing * D2R) * range, y: p.y + Math.cos(bearing * D2R) * range });

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

export const fmtBrg = (b: number) => String(Math.round(norm(b)) % 360).padStart(3, '0');
export const fmtRng = (r: number) => (r < 1 ? `${Math.round((r * 2025) / 100) * 100} yd` : `${r.toFixed(1)} nm`);
