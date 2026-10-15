// A small "PlayStation era" 3D renderer for the battle camera: low-poly flat-shaded models drawn
// far to near on a 320x240 canvas, vertices snapped to whole pixels, fog to the horizon, billboard
// sprites for fire, smoke and spray, then 15-bit colour with the console's 4x4 ordered dither.
// World units are metres, x east, y north, z up (as in strikescene.ts).
import { makeView, type Cam, type V3, type View } from './strikescene';

export type RGB = [number, number, number];
/** A flat polygon. `n` is its outward normal (computed if left out); `emis` glows it toward fire colour. */
export interface PFace { p: V3[]; col: RGB; n?: V3; emis?: number; alpha?: number; both?: boolean; marks?: { p: V3[]; col: RGB }[] }
export interface PObj { c: V3; faces: PFace[] }
/** Things drawn as one: `base` first in its order (a hull), then `parts` far to near (what stands on it). */
export interface PGroup { c: V3; base: PObj[]; parts: PObj[] }
/** A billboard at a world point. `ppm` is pixels per metre there; `fog` 0 to 1 how far it has faded. */
export interface Sprite { p: V3; draw: (ctx: CanvasRenderingContext2D, x: number, y: number, ppm: number, fog: number, view: View) => void }
export interface World {
  skyTop: RGB; skyLow: RGB; ground: RGB; fog: RGB; fogD: number; sun: V3; amb: number;
  /** Scales every lit colour (night, deep water); glowing faces are not dimmed. */
  exposure?: number;
  /** Ground and sea polygons, drawn first in order. */
  flat: PFace[];
  groups: PGroup[]; sprites: Sprite[];
  /** Hide what is below the sea surface (z < 0). */
  clipWater?: boolean;
  /** Underwater: the background is the water column, lighter toward the surface. */
  underwater?: boolean;
}

// ---- Vector bits ---------------------------------------------------------------------------
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const mean = (ps: V3[]): V3 => { const s: V3 = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length]; };
export function newell(ps: V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return unit(n);
}
/** The polygon's normal, turned to face away from `inside`. */
export function outward(ps: V3[], inside: V3): V3 {
  const u = newell(ps);
  return dot(u, sub(mean(ps), inside)) < 0 ? [-u[0], -u[1], -u[2]] : u;
}

// ---- Colour --------------------------------------------------------------------------------
export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
/** Fire colours, white hot (0) to dull red and smoke (1). */
const FIRE: RGB[] = ['#fffbe0', '#ffe680', '#ffc040', '#ff8a20', '#e05a14', '#9a3010', '#4a2418', '#2a2622'].map(hex);
export function fireCol(k: number): RGB {
  const x = Math.max(0, Math.min(0.999, k)) * (FIRE.length - 1), i = Math.floor(x);
  return mix(FIRE[i], FIRE[i + 1], x - i);
}

// ---- Rendering ----------------------------------------------------------------------------
const NEAR = 1;
const HOT: RGB = [255, 150, 50];

export function draw3d(ctx: CanvasRenderingContext2D, W: number, H: number, w: World, cam: Cam): View {
  const view = makeView(cam, W, H), { r, u, f } = view.basis, F = view.F;
  const toCam = (p: V3): V3 => { const d = sub(p, cam.pos); return [dot(d, r), dot(d, u), dot(d, f)]; };
  const fogK = (d: number) => 1 - Math.exp(-d / w.fogD);

  // Background: the sky above the horizon and the sea or ground below it, or the water column.
  const fh = unit([f[0], f[1], 0]);
  const far = (a: number): V3 => [cam.pos[0] + (fh[0] * Math.cos(a) - fh[1] * Math.sin(a)) * 1e6, cam.pos[1] + (fh[0] * Math.sin(a) + fh[1] * Math.cos(a)) * 1e6, cam.pos[2]];
  const h1 = view.project(far(-0.6)), h2 = view.project(far(0.6));
  if (w.underwater) {
    // Brighter looking up toward the surface, black looking down.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const up = Math.max(-1, Math.min(1, f[2] * 2));
    g.addColorStop(0, css(mix(w.skyLow, w.skyTop, 0.6 + 0.4 * up))); g.addColorStop(1, css(mix(w.ground, w.skyLow, 0.3 + 0.3 * up)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = css(w.ground); ctx.fillRect(0, 0, W, H);
    if (h1 && h2) {
      const my = (h1[1] + h2[1]) / 2, dx = h2[0] - h1[0], dy = h2[1] - h1[1], k = 4000;
      const s = ctx.createLinearGradient(0, my - H * 0.6, 0, my);
      s.addColorStop(0, css(w.skyTop)); s.addColorStop(1, css(w.skyLow));
      ctx.fillStyle = s;
      ctx.beginPath();
      ctx.moveTo(h1[0] - dx * k, h1[1] - dy * k); ctx.lineTo(h1[0] + dx * k, h1[1] + dy * k);
      ctx.lineTo(h1[0] + dx * k + dy * k, h1[1] + dy * k - dx * k); ctx.lineTo(h1[0] - dx * k + dy * k, h1[1] - dy * k - dx * k);
      ctx.fill();
    }
  }

  const pts: [number, number][] = [];
  const poly = (ps: V3[], fill: string): boolean => {
    let cs = ps;
    if (w.clipWater) {
      // Cut away what is under the sea.
      const out: V3[] = [];
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i], b = cs[(i + 1) % cs.length], ain = a[2] >= 0, bin = b[2] >= 0;
        if (ain) out.push(a);
        if (ain !== bin) { const k = a[2] / (a[2] - b[2]); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 0]); }
      }
      if (out.length < 3) return false;
      cs = out;
    }
    const cc = cs.map(toCam);
    pts.length = 0;
    let anyIn = false;
    for (let i = 0; i < cc.length; i++) {
      const a = cc[i], b = cc[(i + 1) % cc.length], ain = a[2] >= NEAR, bin = b[2] >= NEAR;
      // Whole pixels, as the console had no sub-pixel precision: edges crawl a little as things move.
      if (ain) { pts.push([Math.round(W / 2 + (a[0] * F) / a[2]), Math.round(H / 2 - (a[1] * F) / a[2])]); anyIn = true; }
      if (ain !== bin) {
        const k = (NEAR - a[2]) / (b[2] - a[2]), x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
        pts.push([Math.round(W / 2 + (x * F) / NEAR), Math.round(H / 2 - (y * F) / NEAR)]);
      }
    }
    if (!anyIn || pts.length < 3) return false;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) return false;
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
    return true;
  };
  const lit = (fc: PFace, n: V3, d: number): string => {
    const l = (w.amb + (1 - w.amb) * Math.max(0, dot(n, w.sun))) * (w.exposure ?? 1);
    let c: RGB = [fc.col[0] * l, fc.col[1] * l, fc.col[2] * l];
    if (fc.emis) c = mix(c, HOT, fc.emis);
    return css(mix(c, w.fog, fogK(d)));
  };

  // Flat ground and sea: fog by their nearest point.
  for (const fc of w.flat) {
    let d = Infinity;
    for (const p of fc.p) d = Math.min(d, Math.hypot(p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]));
    if (fc.p.length > 4) d = Math.hypot(cam.pos[2], 40); // the open sea: as near as the water under the camera
    if (fc.alpha !== undefined) ctx.globalAlpha = fc.alpha;
    poly(fc.p, lit(fc, fc.n ?? [0, 0, 1], d));
    ctx.globalAlpha = 1;
  }

  const drawObj = (o: PObj) => {
    const vis: { fc: PFace; n: V3; d: number }[] = [];
    for (const fc of o.faces) {
      let n = fc.n ?? outward(fc.p, o.c);
      const m = mean(fc.p), toEye = sub(cam.pos, m);
      if (dot(n, toEye) <= 0) { if (!fc.both) continue; n = [-n[0], -n[1], -n[2]]; }
      vis.push({ fc, n, d: Math.hypot(toEye[0], toEye[1], toEye[2]) });
    }
    vis.sort((a, b) => b.d - a.d);
    for (const { fc, n, d } of vis) {
      if (fc.alpha !== undefined) ctx.globalAlpha = fc.alpha;
      if (poly(fc.p, lit(fc, n, d)) && fc.marks) for (const mk of fc.marks) poly(mk.p, lit({ ...fc, col: mk.col }, n, d));
      ctx.globalAlpha = 1;
    }
  };
  type Item = { d: number; g?: PGroup; s?: Sprite };
  const items: Item[] = [];
  for (const g of w.groups) items.push({ d: view.dist(g.c), g });
  for (const s of w.sprites) items.push({ d: view.dist(s.p), s });
  items.sort((a, b) => b.d - a.d);
  for (const it of items) {
    if (it.g) {
      for (const o of it.g.base) drawObj(o);
      const parts = it.g.parts.map((o) => ({ o, d: view.dist(o.c) })).sort((a, b) => b.d - a.d);
      for (const { o } of parts) drawObj(o);
    } else if (it.s) {
      if (w.clipWater && it.s.p[2] < -0.5) continue;
      const q = view.project(it.s.p);
      if (q) it.s.draw(ctx, q[0], q[1], F / q[2], fogK(q[2]), view);
    }
  }
  return view;
}

// ---- 15-bit colour and the ordered dither ----------------------------------------------------
const DITHER = [-4, 0, -3, 1, 2, -2, 3, -1, -3, 1, -4, 0, 3, -1, 2, -2];
/** Reduce the frame to `bits` per channel (5 is the console's 15-bit colour) with its 4x4 dither. */
export function ps1Post(ctx: CanvasRenderingContext2D, W: number, H: number, bits = 5) {
  const img = ctx.getImageData(0, 0, W, H), d = img.data, sh = 8 - bits, k = (1 << sh) / 8, half = (1 << sh) >> 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = DITHER[((y & 3) << 2) | (x & 3)] * k, i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = Math.max(0, Math.min(255, d[i + c] + o));
      d[i + c] = Math.min(255, ((v >> sh) << sh) + half);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---- Sprites ---------------------------------------------------------------------------------
/** A chunky eight-sided blob, its lit side toward the top left: smoke, spray, fireballs. */
export function blobAt(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, col: RGB, light: RGB | null, alpha = 1, jag = 0, wide = 1) {
  if (rad < 0.6) { ctx.globalAlpha = alpha; ctx.fillStyle = css(light ?? col); ctx.fillRect(Math.round(x), Math.round(y), 1, 1); ctx.globalAlpha = 1; return; }
  ctx.globalAlpha = alpha;
  const oct = (cx: number, cy: number, rr: number, c: RGB) => {
    ctx.fillStyle = css(c); ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39, k = 1 + (jag ? Math.sin(jag * 7.1 + i * 2.3) * 0.18 : 0);
      const px = Math.round(cx + Math.cos(a) * rr * k * wide), py = Math.round(cy + Math.sin(a) * rr * k);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  };
  oct(x, y, rad, col);
  if (light && rad > 1.5) oct(x - rad * 0.22 * wide, y - rad * 0.25, rad * 0.62, light);
  ctx.globalAlpha = 1;
}
/** A world-space blob: `rm` metres across at point `p`, its colours fogged with distance. */
export function blob(p: V3, rm: number, col: RGB, light: RGB | null, alpha = 1, fogTo: RGB | null = null, jag = 0, wide = 1): Sprite {
  return {
    p, draw: (ctx, x, y, ppm, fog) => {
      const k = fogTo ? fog : 0;
      blobAt(ctx, x, y, rm * ppm, fogTo ? mix(col, fogTo, k) : col, light && fogTo ? mix(light, fogTo, k) : light, alpha, jag, wide);
    },
  };
}
/** A short bright line from `a` to `b` (debris, sparks, a missile's flame). */
export function streak(a: V3, b: V3, col: RGB, width = 1, alpha = 1): Sprite {
  return {
    p: a, draw: (ctx, x, y, _ppm, _fog, view) => {
      const q = view.project(b);
      if (!q) return;
      ctx.globalAlpha = alpha; ctx.strokeStyle = css(col); ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Math.round(y) + 0.5); ctx.lineTo(Math.round(q[0]) + 0.5, Math.round(q[1]) + 0.5); ctx.stroke();
      ctx.globalAlpha = 1;
    },
  };
}
