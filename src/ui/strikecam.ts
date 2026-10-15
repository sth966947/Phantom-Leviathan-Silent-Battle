// Strike camera: when a land-attack Tomahawk arrives, an eight-second clip from its terminal seeker,
// then a standoff battle damage view. Drawn procedurally: the seeker's infrared feed is rendered small
// (strikescene.ts), grained, bloomed and blown up, with the HUD drawn sharp on top. Several arrivals
// queue and play in turn. The game waits while a clip plays, so time compression can't skip it.
import type { SiteKind } from '../sim/sim';
import { mulberry32 } from '../sim/math';
import { buildScene, lerp3, render, shade, type Cam, type Scene, type V3, type View } from './strikescene';

export interface ClipInfo {
  weapon: string; site: string; kind: SiteKind; hit: boolean; modern: boolean;
  /** Date and time of day of the impact, as the feed stamps them: "18 APR 1942", seconds since midnight. */
  date: string; clock: number;
  seed: number;
}

// Feed and display resolution, and the clip's phases in seconds.
const LW = 480, LH = 360, DW = 960, DH = 720;
const INTRO = 0.5, RUN = 3.9, CUT = 0.6, BDA = 2.9, OUT = 0.3;
const LENGTH = INTRO + RUN + CUT + BDA + OUT;
const START_RANGE = 3600, START_ALT = 1000, PATH_END = 0.985;
const HUD = '#e6f2ee', DIM = 'rgba(230,242,238,0.55)', GOOD = '#6fd3a8', AMBER = '#f3b04b';
const FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

const ease = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
const hms = (s: number) => `${pad((s / 3600) % 24)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

interface Particle { v: V3; r: number; b: number; k: number }
interface Clip {
  info: ClipInfo; scene: Scene; t0: number; n: number;
  start: V3; impact: V3;
  fire: Particle[]; smoke: Particle[]; debris: Particle[];
}

export class StrikeCam {
  private el: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private feed = document.createElement('canvas');
  private fctx: CanvasRenderingContext2D;
  private glow = document.createElement('canvas');
  private gctx: CanvasRenderingContext2D;
  private grain: HTMLCanvasElement[] = [];
  private lines: CanvasPattern | null = null;
  private queue: ClipInfo[] = [];
  private clip: Clip | null = null;
  private played = 0; // clips finished or skipped in this run of arrivals

  constructor(host: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'strikecam';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="sc-frame" role="dialog" aria-label="Tomahawk strike camera">
        <div class="sc-head"><span id="scTitle">Strike camera</span>
          <span class="sc-btns"><button id="scSkipAll" hidden>Skip all</button><button id="scSkip">Skip <kbd>Esc</kbd></button></span></div>
        <canvas id="scView" width="${DW}" height="${DH}" aria-label="Tomahawk seeker camera and battle damage footage"></canvas>
      </div>`;
    host.appendChild(this.el);
    this.ctx = (this.el.querySelector('#scView') as HTMLCanvasElement).getContext('2d')!;
    this.feed.width = LW; this.feed.height = LH;
    this.fctx = this.feed.getContext('2d')!;
    this.glow.width = LW / 6; this.glow.height = LH / 6;
    this.gctx = this.glow.getContext('2d')!;
    const r = mulberry32(7);
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('canvas');
      c.width = LW; c.height = LH;
      const x = c.getContext('2d')!, img = x.createImageData(LW, LH);
      for (let p = 0; p < img.data.length; p += 4) { const v = 128 + (r() + r() + r() - 1.5) * 120; img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255; }
      x.putImageData(img, 0, 0);
      this.grain.push(c);
    }
    const sl = document.createElement('canvas');
    sl.width = 2; sl.height = 3;
    const sx = sl.getContext('2d')!;
    sx.fillStyle = 'rgba(0,0,0,0.22)'; sx.fillRect(0, 2, 2, 1);
    this.lines = this.ctx.createPattern(sl, 'repeat');
    this.el.querySelector('#scSkip')!.addEventListener('click', () => this.skip());
    this.el.querySelector('#scSkipAll')!.addEventListener('click', () => this.close());
  }

  get open() { return !!this.clip; }

  add(info: ClipInfo) {
    this.queue.push(info);
    if (!this.clip) this.next();
    this.updateHead();
  }
  /** Ends this clip and plays the next one waiting, if any. */
  skip() { this.played++; this.next(); }
  close() { this.queue.length = 0; this.clip = null; this.played = 0; this.el.hidden = true; }

  private get total() { return this.played + (this.clip ? 1 : 0) + this.queue.length; }

  private next() {
    const info = this.queue.shift();
    if (!info) return this.close();
    const scene = buildScene(info.kind, info.modern, info.site, info.seed);
    const hdg = scene.heading * Math.PI / 180, back: V3 = [-Math.sin(hdg), -Math.cos(hdg), 0];
    const start: V3 = [scene.aim[0] + back[0] * START_RANGE, scene.aim[1] + back[1] * START_RANGE, START_ALT];
    const r = mulberry32(info.seed ^ 0x5eed);
    const sphere = (up: number): V3 => { const a = r() * Math.PI * 2, z = up + r() * (1 - up), s = Math.sqrt(1 - z * z); return [Math.cos(a) * s, Math.sin(a) * s, z]; };
    this.clip = {
      info, scene, t0: performance.now(), n: this.played + 1, start, impact: info.hit ? scene.aim : scene.miss,
      fire: Array.from({ length: 16 }, (): Particle => ({ v: sphere(0.1), r: 0.6 + r() * 0.6, b: r() * 0.15, k: r() })),
      smoke: Array.from({ length: 46 }, (_, i): Particle => ({ v: [r() * 2 - 1, r() * 2 - 1, 0.6 + r() * 0.6], r: 0.7 + r() * 0.6, b: i * 0.055 + r() * 0.05, k: r() })),
      debris: Array.from({ length: 44 }, (): Particle => { const d = sphere(0.25); return { v: [d[0] * (40 + r() * 70), d[1] * (40 + r() * 70), d[2] * (50 + r() * 90)], r: 0, b: 0, k: r() }; }),
    };
    this.el.hidden = false;
    this.updateHead();
  }

  private updateHead() {
    const c = this.clip;
    if (!c) return;
    const n = this.total;
    (this.el.querySelector('#scTitle') as HTMLElement).textContent =
      `Strike camera · ${c.info.weapon} · ${c.info.site}${n > 1 ? ` · ${c.n} of ${n}` : ''}`;
    (this.el.querySelector('#scSkipAll') as HTMLElement).hidden = !this.queue.length;
  }

  /** Call every animation frame. */
  draw(now: number) {
    const c = this.clip;
    if (!c) return;
    const t = (now - c.t0) / 1000;
    if (t >= LENGTH) { this.skip(); return; }
    const f = this.fctx, ctx = this.ctx;
    let view: View | null = null, hud: () => void;
    if (t < INTRO + RUN) {
      const u = Math.max(0, (t - INTRO) / RUN);
      view = this.seeker(c, u, t);
      hud = () => this.seekerHud(c, u, t, view!);
    } else if (t < INTRO + RUN + CUT) {
      const k = (t - INTRO - RUN) / CUT;
      f.fillStyle = '#000'; f.fillRect(0, 0, LW, LH);
      hud = () => this.cutHud(c, k, t);
    } else {
      const te = t - INTRO - RUN - CUT - 0.55;
      view = this.bda(c, te, t);
      hud = () => this.bdaHud(c, te, t, view!);
    }
    this.post(t);
    // Static: over the intro as the link comes up, and through the cut after impact.
    const cut = t >= INTRO + RUN && t < INTRO + RUN + CUT;
    const noise = t < INTRO ? 1 - t / INTRO : cut ? 1 : 0;
    if (noise > 0) this.snow(noise, t, cut ? (t - INTRO - RUN) / CUT : 1);
    hud();
    if (t > LENGTH - OUT) { ctx.fillStyle = `rgba(0,0,0,${(t - LENGTH + OUT) / OUT})`; ctx.fillRect(0, 0, DW, DH); }
  }

  // ---- The seeker's run in -----------------------------------------------------------------
  private seekerCam(c: Clip, u: number, t: number): Cam {
    const s = u * PATH_END, sc = c.scene;
    const pos = lerp3(c.start, c.impact, s);
    // A miss: the seeker can't match the 1942 ground to its scene and the aim slides off the target.
    let look = c.info.hit ? sc.aim : lerp3(sc.aim, sc.miss, ease(0.18, 0.7, u));
    const range = Math.hypot(look[0] - pos[0], look[1] - pos[1], look[2] - pos[2]);
    const j = range * (0.0012 + 0.005 * u * u);
    look = [look[0] + Math.sin(t * 9.1) * j + Math.sin(t * 23) * j * 0.4, look[1] + Math.cos(t * 7.7) * j, look[2] + Math.sin(t * 11.3) * j * 0.8];
    const zoom = c.info.hit ? 1 + 1.6 * ease(0.8, 1, u) : 1;
    return { pos, look, fov: 30 / zoom, roll: 0.025 * Math.sin(t * 1.4) + 0.01 * Math.sin(t * 5.2) };
  }
  private seeker(c: Clip, u: number, t: number): View {
    const cam = this.seekerCam(c, u, t);
    const view = render(this.fctx, LW, LH, c.scene, cam, 0, t);
    this.stackSmoke(c, view, t);
    return view;
  }

  /** Chimneys and funnels trail drifting smoke, warm at the stack and cooling. */
  private stackSmoke(c: Clip, view: View, t: number) {
    for (const [i, p] of c.scene.stacks.entries()) {
      for (let k = 0; k < 9; k++) {
        const a = ((t * 0.35 + k / 9 + i * 0.13) % 1), d = a * 120;
        const q = view.project([p[0] + d * 0.8, p[1] + d * 0.35, p[2] + d * 0.35 + 2]);
        if (!q) continue;
        const rad = ((3 + a * 22) * view.F) / q[2];
        if (rad < 0.5) continue;
        this.puff(q[0], q[1], rad, 0.42 + 0.25 * (1 - a), 0.35 * (1 - a));
      }
    }
  }
  private puff(x: number, y: number, rad: number, v: number, alpha: number, add = false) {
    const f = this.fctx, g = f.createRadialGradient(x, y, 0, x, y, rad);
    const col = shade(v).replace('rgb', 'rgba').replace(')', '');
    g.addColorStop(0, `${col},${alpha})`); g.addColorStop(0.55, `${col},${alpha * 0.6})`); g.addColorStop(1, `${col},0)`);
    if (add) f.globalCompositeOperation = 'lighter';
    f.fillStyle = g; f.beginPath(); f.arc(x, y, rad, 0, Math.PI * 2); f.fill();
    f.globalCompositeOperation = 'source-over';
  }

  // ---- Battle damage view -------------------------------------------------------------------
  private bda(c: Clip, te: number, t: number): View {
    const p = c.impact, hdg = (c.scene.heading + 125 + te * 3) * Math.PI / 180;
    const cam: Cam = {
      pos: [p[0] + Math.sin(hdg) * 1150, p[1] + Math.cos(hdg) * 1150, 430],
      look: [p[0], p[1], p[2] + 35], fov: 24 - te * 1.2, roll: 0,
    };
    const damage = c.info.hit ? ease(0.02, 0.7, te) : 0;
    const view = render(this.fctx, LW, LH, c.scene, cam, damage, t);
    this.stackSmoke(c, view, t);
    const px = (m: number, z: number) => (m * view.F) / z;
    const f = this.fctx;
    if (te < 0) {
      // The missile's last half second, a hot dot diving in.
      const a = lerp3(c.start, p, 1 + te * 0.32), b = lerp3(c.start, p, 1 + (te - 0.08) * 0.32);
      const qa = view.project(a), qb = view.project(b);
      if (qa && qb) {
        f.strokeStyle = shade(0.8); f.lineWidth = 1.2; f.beginPath(); f.moveTo(qb[0], qb[1]); f.lineTo(qa[0], qa[1]); f.stroke();
        this.puff(qa[0], qa[1], 3, 1, 0.9, true);
      }
      return view;
    }
    const water = !c.info.hit && c.scene.missWater, big = c.info.hit ? 1 : 0.55;
    // Shock ring across the ground or water.
    if (te < 0.8) {
      f.strokeStyle = `rgba(240,250,245,${0.55 * (1 - te / 0.8)})`; f.lineWidth = 1.5; f.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2, q = view.project([p[0] + Math.cos(a) * te * 380 * big, p[1] + Math.sin(a) * te * 380 * big, 1]);
        if (q) { if (i) f.lineTo(q[0], q[1]); else f.moveTo(q[0], q[1]); }
      }
      f.stroke();
    }
    // Smoke column: warm and bright low down, cooling grey as it climbs and drifts.
    for (const s of c.smoke) {
      const age = te - s.b;
      if (age < 0) continue;
      const rise = (water ? 50 : 160) * big * s.v[2] * (1 - Math.exp(-age * 0.9));
      const q = view.project([p[0] + s.v[0] * 18 + age * 9, p[1] + s.v[1] * 18 + age * 3, p[2] + rise + 6]);
      if (!q) continue;
      const v = water ? 0.7 - age * 0.08 : 0.36 + 0.4 * Math.exp(-age * 1.6);
      this.puff(q[0], q[1], px((12 + age * 20) * s.r * big, q[2]), v, 0.7 * Math.min(1, age * 5) * Math.max(0, 1 - age / 3.2));
    }
    if (water) {
      // A column of spray thrown up and falling back.
      for (const d of c.debris) {
        const g = 40, z = d.v[2] * 1.1 * te - 0.5 * g * te * te;
        if (z < 0) continue;
        const q = view.project([p[0] + d.v[0] * 0.18 * te, p[1] + d.v[1] * 0.18 * te, z]);
        if (q) this.puff(q[0], q[1], px(6 + te * 8, q[2]), 0.85, 0.55);
      }
    } else {
      // Debris flung out on hot arcs.
      f.lineWidth = 1;
      for (const d of c.debris) {
        const g = 55, at = (tt: number): V3 => [p[0] + d.v[0] * tt * big, p[1] + d.v[1] * tt * big, p[2] + d.v[2] * tt * big - 0.5 * g * tt * tt];
        const a = at(te), b = at(Math.max(0, te - 0.06));
        if (a[2] < 0) continue;
        const qa = view.project(a), qb = view.project(b);
        if (!qa || !qb) continue;
        f.strokeStyle = shade(0.45 + 0.55 * Math.exp(-te * 0.9 * (1 + d.k))); f.beginPath(); f.moveTo(qb[0], qb[1]); f.lineTo(qa[0], qa[1]); f.stroke();
      }
    }
    // Fireball, white hot, then dulling.
    const fireballs = (o: V3, scale: number, t0: number) => {
      const tt = te - t0;
      if (tt < 0) return;
      for (const b of c.fire) {
        const k = tt - b.b;
        if (k < 0) continue;
        const R = 34 * scale * (1 - Math.exp(-k * 5)) * b.r;
        const q = view.project([o[0] + b.v[0] * R, o[1] + b.v[1] * R, o[2] + b.v[2] * R + 22 * k * scale + 6]);
        if (!q) continue;
        const heat = Math.exp(-k * 1.5);
        this.puff(q[0], q[1], px((10 + 24 * (1 - Math.exp(-k * 4))) * scale * b.r, q[2]), 0.5 + 0.5 * heat, Math.min(1, 0.4 + heat), heat > 0.3);
      }
    };
    if (!water) fireballs(p, big, 0);
    else fireballs(p, 0.35, 0);
    if (c.info.hit) { fireballs(lerp3(p, [p[0] + 30, p[1] - 20, 2], 1), 0.55, 0.75); fireballs([p[0] - 35, p[1] + 25, 4], 0.45, 1.35); }
    // The flash.
    if (te < 0.2) {
      const q = view.project(p);
      if (q) this.puff(q[0], q[1], px(160 * big, q[2]), 1, 1 - te / 0.2, true);
    }
    return view;
  }

  // ---- Post: grain, bloom, upscale, scanlines, vignette ---------------------------------
  private post(t: number) {
    const f = this.fctx, g = this.gctx, ctx = this.ctx;
    f.globalCompositeOperation = 'overlay'; f.globalAlpha = 0.32;
    f.drawImage(this.grain[Math.floor(t * 30) % this.grain.length], 0, 0);
    f.globalCompositeOperation = 'source-over'; f.globalAlpha = 1;
    // Bloom: a small copy, its contrast raised to the fourth power so only hot things survive.
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.feed, 0, 0, this.glow.width, this.glow.height);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(this.glow, 0, 0); g.drawImage(this.glow, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.feed, 0, 0, DW, DH);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
    ctx.drawImage(this.glow, 0, 0, DW, DH);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // An occasional rolling bar, as on a weak video link.
    const bar = (t * 0.6) % 1;
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(0, bar * DH * 1.4 - 80, DW, 80);
    if (this.lines) { ctx.fillStyle = this.lines; ctx.fillRect(0, 0, DW, DH); }
    const v = ctx.createRadialGradient(DW / 2, DH / 2, DH * 0.35, DW / 2, DH / 2, DH * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, DW, DH);
  }
  /** Snow and tearing: `amount` 0 to 1; `k` how far into the cut (it opens with a white flash). */
  private snow(amount: number, t: number, k: number) {
    const ctx = this.ctx;
    ctx.globalAlpha = amount * 0.9;
    const gr = this.grain[Math.floor(t * 40) % this.grain.length];
    for (let y = 0; y < DH; y += 24) {
      const sx = (Math.sin(y * 0.37 + t * 50) * 0.5 + 0.5) * 30;
      ctx.drawImage(gr, sx, (y / DH) * LH * 0.5, LW / 2, 12, 0, y, DW, 24);
    }
    ctx.globalAlpha = 1;
    if (k < 0.25) { ctx.fillStyle = `rgba(255,255,255,${1 - k / 0.25})`; ctx.fillRect(0, 0, DW, DH); }
  }

  // ---- HUD --------------------------------------------------------------------------------
  private text(s: string, x: number, y: number, o: { size?: number; align?: CanvasTextAlign; color?: string; weight?: number } = {}) {
    const ctx = this.ctx;
    ctx.font = `${o.weight ?? 600} ${o.size ?? 15}px ${FONT}`;
    ctx.textAlign = o.align ?? 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = o.color ?? HUD; ctx.fillText(s, x, y);
  }
  private frameHud(c: Clip, t: number, label: string) {
    const ctx = this.ctx, i = c.info;
    ctx.strokeStyle = DIM; ctx.lineWidth = 2;
    for (const [x, y, sx, sy] of [[24, 24, 1, 1], [DW - 24, 24, -1, 1], [24, DH - 24, 1, -1], [DW - 24, DH - 24, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * 34); ctx.lineTo(x, y); ctx.lineTo(x + sx * 34, y); ctx.stroke();
    }
    this.text(i.weapon, 44, 58, { size: 22, weight: 700 });
    this.text(label, 44, 80, { size: 13, color: DIM });
    if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff5d4f'; ctx.beginPath(); ctx.arc(50, 100, 5, 0, Math.PI * 2); ctx.fill(); }
    this.text('REC', 62, 105, { size: 13 });
    this.text(i.date, DW - 44, 58, { align: 'right', size: 15 });
    this.text(hms(i.clock + t), DW - 44, 80, { align: 'right', size: 15 });
    const n = this.total;
    if (n > 1) this.text(`STRIKE ${c.n} OF ${n}`, DW / 2, 58, { align: 'center', size: 14 });
  }
  private seekerHud(c: Clip, u: number, t: number, view: View) {
    const ctx = this.ctx, i = c.info, sx = DW / LW;
    const cam = this.seekerCam(c, u, t);
    this.frameHud(c, t, 'RGM-109E BLK V · TERMINAL · IR/DSMAC');
    // Reticle.
    const cx = DW / 2, cy = DH / 2;
    ctx.strokeStyle = HUD; ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(cx + dx * 16, cy + dy * 16); ctx.lineTo(cx + dx * 70, cy + dy * 70); }
    ctx.stroke();
    ctx.lineWidth = 1.5; ctx.beginPath();
    for (let k = 1; k <= 4; k++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const d = 70 + k * 40; ctx.moveTo(cx + dx * d - dy * 5, cy + dy * d - dx * 5); ctx.lineTo(cx + dx * d + dy * 5, cy + dy * d + dx * 5);
    }
    ctx.stroke();
    ctx.fillStyle = HUD; ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    // Gate on the target: where the seeker thinks the target is, tracked or lost.
    const tgt = c.scene.objs.filter((o) => o.target);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of tgt) for (const p of o.ball ? [o.c] : o.faces.flatMap((fc) => fc.p)) {
      const q = view.project(p);
      if (!q) continue;
      x0 = Math.min(x0, q[0] * sx); x1 = Math.max(x1, q[0] * sx); y0 = Math.min(y0, q[1] * sx); y1 = Math.max(y1, q[1] * sx);
    }
    const lostTrack = !i.hit && u > 0.42;
    if (x1 > x0) {
      const pad = 10, w = Math.max(44, x1 - x0 + pad * 2), h = Math.max(44, y1 - y0 + pad * 2), gx = (x0 + x1) / 2 - w / 2, gy = (y0 + y1) / 2 - h / 2;
      const onScreen = gx + w > 0 && gx < DW && gy + h > 0 && gy < DH;
      if (onScreen && !(lostTrack && Math.floor(t * 6) % 2)) {
        ctx.strokeStyle = lostTrack ? AMBER : HUD; ctx.lineWidth = 2;
        const k = Math.min(18, w / 3, h / 3);
        ctx.beginPath();
        for (const [x, y, ax, ay] of [[gx, gy, 1, 1], [gx + w, gy, -1, 1], [gx, gy + h, 1, -1], [gx + w, gy + h, -1, -1]]) { ctx.moveTo(x, y + ay * k); ctx.lineTo(x, y); ctx.lineTo(x + ax * k, y); }
        ctx.stroke();
        this.text(lostTrack ? 'NO MATCH' : 'TGT', gx, gy - 8, { size: 12, color: lostTrack ? AMBER : HUD });
      }
    }
    // Range bar and flight data.
    const rng = Math.hypot(c.impact[0] - cam.pos[0], c.impact[1] - cam.pos[1], c.impact[2] - cam.pos[2]);
    const full = Math.hypot(c.impact[0] - c.start[0], c.impact[1] - c.start[1], c.impact[2] - c.start[2]);
    const bx = DW - 60, by = 160, bh = DH - 330;
    ctx.strokeStyle = DIM; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, 12, bh);
    ctx.fillStyle = HUD; ctx.fillRect(bx + 3, by + bh * (1 - rng / full) + 3, 6, Math.max(0, bh * (rng / full) - 6));
    this.text('RTG', bx + 6, by - 10, { size: 12, align: 'center', color: DIM });
    const alt = cam.pos[2] * 3.281;
    this.text(`RTG ${(rng / 1000).toFixed(2)} KM`, 44, DH - 96, { size: 18, weight: 700 });
    this.text(`ALT ${Math.round(alt).toLocaleString('en-US')} FT   GS 480 KT   DIVE ${Math.round(Math.atan2(START_ALT, START_RANGE) * 180 / Math.PI)}°`, 44, DH - 72, { size: 14 });
    this.text(`T-${(rng / 247).toFixed(1)} S`, 44, DH - 50, { size: 14, color: DIM });
    const match = i.hit ? Math.round(71 + 20 * u + Math.sin(t * 13) * 2) : Math.max(8, Math.round(68 - 70 * ease(0.15, 0.6, u) + Math.sin(t * 17) * 3));
    this.text(`TGT ${i.site.toUpperCase()}`, DW - 44, DH - 96, { size: 15, align: 'right' });
    this.text(`${i.kind.toUpperCase()} · DSMAC SCENE MATCH ${match}%`, DW - 44, DH - 72, { size: 13, align: 'right', color: lostTrack ? AMBER : DIM });
    const status = lostTrack ? (Math.floor(t * 4) % 2 ? 'SCENE MISMATCH · TRACK LOST' : '') : u > 0.8 ? 'TERMINAL · AIMPOINT LOCKED' : u > 0.05 ? 'TERMINAL DIVE · TRACKING' : 'LINK ACQUIRED';
    if (status) this.text(status, DW / 2, DH - 50, { size: 15, align: 'center', color: lostTrack ? AMBER : HUD });
    if (t < INTRO) this.text('ACQUIRING SEEKER VIDEO', DW / 2, DH / 2 - 100, { size: 16, align: 'center' });
  }
  private cutHud(c: Clip, k: number, t: number) {
    if (k < 0.2) return;
    this.frameHud(c, t, 'RGM-109E BLK V · TERMINAL · IR/DSMAC');
    this.ctx.fillStyle = 'rgba(0,0,0,0.65)'; this.ctx.fillRect(DW / 2 - 140, DH / 2 - 34, 280, 58);
    this.text('LINK LOST', DW / 2, DH / 2 + 4, { size: 26, weight: 700, align: 'center' });
  }
  private bdaHud(c: Clip, te: number, t: number, view: View) {
    const ctx = this.ctx, i = c.info, sx = DW / LW;
    this.frameHud(c, t, 'BATTLE DAMAGE · STANDOFF IR');
    const q = view.project(c.scene.aim);
    if (q) {
      ctx.strokeStyle = DIM; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.strokeRect(q[0] * sx - 40, q[1] * sx - 40, 80, 80); ctx.setLineDash([]);
      this.text('AIMPOINT', q[0] * sx - 40, q[1] * sx - 48, { size: 12, color: DIM });
    }
    if (te < 0.3) return;
    const a = Math.min(1, (te - 0.3) / 0.25);
    ctx.globalAlpha = a;
    const col = i.hit ? GOOD : AMBER;
    const head = i.hit ? 'IMPACT · TARGET HIT' : 'MISS';
    let sub: string;
    if (i.hit) sub = `${i.site.toUpperCase()} · SEVERE DAMAGE`;
    else {
      const dx = c.scene.miss[0] - c.scene.aim[0], dy = c.scene.miss[1] - c.scene.aim[1];
      const dir = COMPASS[Math.round(((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360) / 45) % 8];
      sub = `IMPACT ${Math.round(Math.hypot(dx, dy) / 10) * 10} M ${dir.toUpperCase()} OF TARGET${c.scene.missWater ? ', IN THE WATER' : ''} · NO DAMAGE`;
    }
    ctx.font = `700 34px ${FONT}`;
    const w = Math.max(ctx.measureText(head).width, 13 * 0.62 * sub.length) + 60, y = DH - 150;
    ctx.fillStyle = 'rgba(4,12,20,0.78)'; ctx.fillRect(DW / 2 - w / 2, y - 46, w, 84);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(DW / 2 - w / 2, y - 46, w, 84);
    this.text(head, DW / 2, y, { size: 34, weight: 700, align: 'center', color: col });
    this.text(sub, DW / 2, y + 26, { size: 13, align: 'center' });
    ctx.globalAlpha = 1;
  }
}
