// Battle camera: when our weapons land (a torpedo or missile on a ship, a torpedo on a submarine, a
// surface-to-air missile on an aircraft, a Tomahawk on a site ashore), a short cutscene from a fixed
// third-person camera, drawn in a PlayStation-era style: low-poly 3D at 320x240, 15-bit colour with
// ordered dithering, blown up with square pixels. Arrivals close together play as one reel, cutting
// from target to target. The game waits while a reel plays, so time compression can't skip past it.
import type { SiteKind, WeaponKey } from '../sim/sim';
import { CLASSES } from '../sim/classes';
import { mulberry32 } from '../sim/math';
import { approachTime, drawShotFrame, fate, type ShotCache, type ShotKind, type ShotSpec } from './hitscene';
import { ps1Post } from './ps1';

/** One arrival: a Tomahawk on a site ashore, or a hit on a vessel or aircraft. `t` is game seconds. */
export type Impact =
  | { type: 'land'; t: number; weapon: string; site: string; siteId: number; kind: SiteKind; hit: boolean; mjolnir?: boolean }
  | { type: 'hit'; t: number; weapon: WeaponKey | 'mine'; label: string; vid: number; name: string; cls: string; kind: 'surface' | 'sub' | 'air'; sunk: boolean };
export interface Reel {
  impacts: Impact[]; modern: boolean; night: boolean;
  /** The date the feed stamps ("18 APR 1942") and the mission's clock at game time 0, seconds since midnight. */
  date: string; clock: number;
}

// Feed and display resolution.
const LW = 320, LH = 240, DW = 960, DH = 720;
const FADE_IN = 0.35, CUT = 0.12, FADE_OUT = 0.45;
const HUD = '#e6f2ee', DIM = 'rgba(230,242,238,0.62)', GOOD = '#6fd3a8', AMBER = '#f3b04b', BAD = '#ff7a5c';
const FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');
const hms = (s: number) => `${pad((s / 3600) % 24)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
const WNAME: Record<string, [string, string]> = {
  mk48: ['MK 48 ADCAP', 'HEAVYWEIGHT TORPEDO'], mk54: ['MK 54', 'ASROC LIGHTWEIGHT TORPEDO'], nsm: ['NAVAL STRIKE MISSILE', 'STEALTH ANTI-SHIP MISSILE'],
  mst: ['TOMAHAWK MST', 'MARITIME STRIKE MISSILE'], jatm: ['JATM', 'SURFACE-TO-AIR MISSILE'], sm6: ['SM-6', 'SURFACE-TO-AIR MISSILE'],
  mine: ['MINE', 'LAID BY TANG'], tlam: ['TOMAHAWK', 'LAND ATTACK MISSILE'],
  mk96: ['MK 96', 'SUPERCAVITATING TORPEDO · EXPERIMENTAL'], mjolnir: ['MJOLNIR', 'HYPERSONIC STRIKE MISSILE · EXPERIMENTAL'],
};
const isTorpKey = (w: string) => w === 'mk48' || w === 'mk54' || w === 'wwtorp' || w === 'mk96';

interface Shot {
  spec: ShotSpec; cache: ShotCache; start: number;
  name: string; classLine: string; clock: number; headline: string; status: (t: number) => string; good: boolean;
}
interface Clip { reel: Reel; shots: Shot[]; total: number; t0: number; impacts: number }

/** Lays a reel out as shots: one per target, its weapons landing in turn. */
export function planReel(reel: Reel): { shots: Omit<Shot, 'cache' | 'start'>[]; durs: number[] } {
  const groups = new Map<string, Impact[]>();
  for (const im of reel.impacts) {
    const key = im.type === 'land' ? `s${im.siteId}` : `v${im.vid}`;
    groups.set(key, [...(groups.get(key) ?? []), im]);
  }
  const shots: Omit<Shot, 'cache' | 'start'>[] = [], durs: number[] = [];
  const many = groups.size;
  [...groups.values()].forEach((ims, gi) => {
    const first = gi === 0, im0 = ims[0];
    const kind: ShotKind = im0.type === 'land' ? 'land' : im0.kind === 'surface' ? 'ship' : im0.kind;
    const weapons = ims.map((m) => (m.type === 'land' ? (m.mjolnir ? 'mjolnir' : 'tlam') : m.weapon));
    const hits = ims.map((m) => (m.type === 'land' ? m.hit : true));
    const sunk = ims.some((m) => (m.type === 'land' ? m.hit : m.sunk));
    // Later targets in a reel get quicker cuts.
    const pace = first ? 1 : many > 3 ? 0.7 : 0.8;
    const at: number[] = [];
    weapons.forEach((w, i) => at.push(i === 0 ? (first ? 1.4 : 0.6) + approachTime(kind, w) : at[i - 1] + Math.max(1.3, approachTime(kind, w) * 0.55)));
    const tail = (sunk ? (kind === 'ship' ? 5.4 : kind === 'sub' ? 5.2 : kind === 'air' ? 4.3 : 3.6) : 3) * pace;
    const seed = ((im0.t * 7919) ^ ((im0.type === 'land' ? im0.siteId : im0.vid) * 104729)) | 0;
    const spec: ShotSpec = {
      kind, cls: im0.type === 'land' ? im0.site : im0.cls, siteKind: im0.type === 'land' ? im0.kind : undefined,
      weapons, at, hits, sunk, dur: at[at.length - 1] + tail, seed, night: reel.night, modern: reel.modern,
    };
    const card = im0.type === 'hit' ? CLASSES[im0.cls] : undefined;
    const name = im0.type === 'land' ? im0.site : im0.name;
    const classLine = im0.type === 'land' ? `${im0.kind.toUpperCase()} · LAND TARGET` : card ? [card.name !== name ? card.name : '', card.type, card.nation].filter(Boolean).join(' · ').toUpperCase() : '';
    const n = weapons.length, landHits = hits.filter(Boolean).length;
    let headline: string;
    if (kind === 'land') headline = landHits ? (n > 1 ? `${landHits} IMPACT${landHits > 1 ? 'S' : ''}` : 'IMPACT') : n > 1 ? `${n} MISSES` : 'MISS';
    else if (kind === 'air') headline = sunk ? 'SPLASH ONE' : 'MISSILE HIT';
    else if (weapons.every((w) => w === 'mine')) headline = 'MINE';
    else if (weapons.every(isTorpKey)) headline = n > 1 ? `${n} TORPEDO HITS` : 'TORPEDO HIT';
    else if (weapons.every((w) => !isTorpKey(w) && w !== 'mine')) headline = n > 1 ? `${n} MISSILE HITS` : 'MISSILE HIT';
    else headline = `${n} HITS`;
    const fa = fate(spec), last = at[at.length - 1];
    const sinkDur = Math.max(3, spec.dur - last - 0.3), crushT = last + 0.4 + sinkDur * 0.62;
    const status = (t: number) => {
      if (kind === 'land') return landHits ? 'SEVERE DAMAGE' : 'NO DAMAGE';
      if (kind === 'air') return sunk ? 'SHOT DOWN' : 'DAMAGED';
      if (kind === 'sub') return !sunk ? 'DAMAGED · LEAKING AIR' : t > crushT ? 'PAST CRUSH DEPTH · LOST' : 'HULL BREAKING UP';
      return fa === 'break' ? 'BROKEN IN TWO · SINKING' : fa === 'magazine' ? 'MAGAZINE EXPLOSION · SINKING' : fa === 'founder' ? 'SINKING' : 'DAMAGED · ON FIRE';
    };
    shots.push({ spec, name, classLine, clock: reel.clock + im0.t, headline, status, good: kind === 'land' ? landHits > 0 : true });
    durs.push(spec.dur);
  });
  return { shots, durs };
}

export class StrikeCam {
  private el: HTMLElement;
  private ctx: CanvasRenderingContext2D;
  private feed = document.createElement('canvas');
  private fctx: CanvasRenderingContext2D;
  private queue: Reel[] = [];
  private clip: Clip | null = null;
  private shotNow = -1;

  constructor(host: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.className = 'strikecam';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="sc-frame" role="dialog" aria-label="Battle camera">
        <div class="sc-head"><span id="scTitle">Battle camera</span>
          <span class="sc-btns"><button id="scSkipAll" hidden>Skip all</button><button id="scSkip">Skip <kbd>Esc</kbd></button></span></div>
        <canvas id="scView" width="${DW}" height="${DH}" aria-label="Battle camera footage of our weapons arriving"></canvas>
      </div>`;
    host.appendChild(this.el);
    this.ctx = (this.el.querySelector('#scView') as HTMLCanvasElement).getContext('2d')!;
    this.feed.width = LW; this.feed.height = LH;
    this.fctx = this.feed.getContext('2d', { willReadFrequently: true })!;
    this.el.querySelector('#scSkip')!.addEventListener('click', () => this.skip());
    this.el.querySelector('#scSkipAll')!.addEventListener('click', () => this.close());
  }

  get open() { return !!this.clip; }

  /** Queue a reel: every arrival in it plays in one clip. */
  add(reel: Reel) {
    if (!reel.impacts.length) return;
    this.queue.push(reel);
    if (!this.clip) this.next();
    this.updateHead();
  }
  /** Cut to the next target in this reel, or the next reel waiting, or close. */
  skip() {
    const c = this.clip;
    if (!c) return;
    const i = this.shotAt((performance.now() - c.t0) / 1000);
    if (i + 1 < c.shots.length) { c.t0 = performance.now() - c.shots[i + 1].start * 1000; this.updateHead(); return; }
    this.next();
  }
  /** Jump the playing reel to `t` seconds in (for checking frames by hand). */
  seek(t: number, hold = false) { if (this.clip) { this.clip.t0 = performance.now() - t * 1000; this.held = hold ? t : null; } }
  private held: number | null = null;
  close() { this.held = null; this.queue.length = 0; this.clip = null; this.shotNow = -1; this.el.hidden = true; }

  private next() {
    const reel = this.queue.shift();
    if (!reel) return this.close();
    const { shots, durs } = planReel(reel);
    let at = 0;
    const full: Shot[] = shots.map((s, i) => { const sh = { ...s, cache: {}, start: at }; at += durs[i] + (i + 1 < shots.length ? CUT : 0); return sh; });
    this.clip = { reel, shots: full, total: at, t0: performance.now(), impacts: reel.impacts.length };
    this.shotNow = -1;
    this.el.hidden = false;
    this.updateHead();
  }
  private shotAt(t: number) {
    const s = this.clip!.shots;
    let i = 0;
    while (i + 1 < s.length && t >= s[i + 1].start) i++;
    return i;
  }

  private updateHead() {
    const c = this.clip;
    if (!c) return;
    const i = Math.max(0, this.shotNow), s = c.shots[i];
    (this.el.querySelector('#scTitle') as HTMLElement).textContent =
      `Battle camera · ${s.headline.toLowerCase().replace(/^./, (x) => x.toUpperCase())} · ${s.name}${c.shots.length > 1 ? ` · ${i + 1} of ${c.shots.length}` : ''}`;
    (this.el.querySelector('#scSkipAll') as HTMLElement).hidden = !(this.queue.length || i + 1 < c.shots.length);
  }

  /** Call every animation frame. */
  draw(now: number) {
    const c = this.clip;
    if (!c) return;
    const t = this.held ?? Math.max(0, (now - c.t0) / 1000);
    if (t >= c.total) { this.next(); return; }
    const i = this.shotAt(t), s = c.shots[i], st = t - s.start;
    if (i !== this.shotNow) { this.shotNow = i; this.updateHead(); }
    const f = this.fctx, ctx = this.ctx;
    if (st > s.spec.dur) { f.fillStyle = '#000'; f.fillRect(0, 0, LW, LH); } // the cut between targets
    else drawShotFrame(f, LW, LH, s.spec, st, s.cache);
    ps1Post(f, LW, LH, 5);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.feed, 0, 0, DW, DH);
    this.hud(c, s, i, st);
    let black = 0;
    if (t < FADE_IN) black = 1 - t / FADE_IN;
    if (t > c.total - FADE_OUT) black = Math.max(black, (t - c.total + FADE_OUT) / FADE_OUT);
    if (black > 0) { ctx.fillStyle = `rgba(0,0,0,${black.toFixed(3)})`; ctx.fillRect(0, 0, DW, DH); }
  }

  // ---- HUD ----------------------------------------------------------------------------------
  private text(s: string, x: number, y: number, o: { size?: number; align?: CanvasTextAlign; color?: string; weight?: number } = {}) {
    const ctx = this.ctx;
    ctx.font = `${o.weight ?? 600} ${o.size ?? 15}px ${FONT}`;
    ctx.textAlign = o.align ?? 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillText(s, x + 2, y + 2);
    ctx.fillStyle = o.color ?? HUD; ctx.fillText(s, x, y);
  }
  private hud(c: Clip, s: Shot, i: number, st: number) {
    const ctx = this.ctx, sp = s.spec;
    // The weapon arriving now (or the last one in).
    let wi = 0;
    for (let k = 0; k < sp.at.length; k++) if (st > sp.at[k] - 0.2) wi = k;
    const [wn, wsub] = WNAME[sp.weapons[wi]] ?? [sp.weapons[wi].toUpperCase(), ''];
    ctx.fillStyle = 'rgba(4,12,20,0.55)'; ctx.fillRect(0, 0, DW, 92);
    this.text(sp.weapons.length > 1 ? `${wn}  ${wi + 1}/${sp.weapons.length}` : wn, 32, 44, { size: 24, weight: 700 });
    this.text(wsub, 32, 70, { size: 14, color: DIM });
    this.text(c.reel.date, DW - 32, 44, { align: 'right', size: 17 });
    this.text(hms(s.clock + Math.max(0, st - sp.at[0])), DW - 32, 70, { align: 'right', size: 17 });
    if (c.impacts > 1) this.text(`${c.impacts} HITS${c.shots.length > 1 ? ` · TARGET ${i + 1} OF ${c.shots.length}` : ''}`, DW / 2, 44, { align: 'center', size: 16, weight: 700, color: AMBER });
    // Target name, lower left, until the result comes up.
    const last = sp.at[sp.at.length - 1], show = st > last + 0.7;
    if (!show) {
      ctx.fillStyle = 'rgba(4,12,20,0.55)'; ctx.fillRect(0, DH - 92, DW, 92);
      this.text(s.name.toUpperCase(), 32, DH - 50, { size: 24, weight: 700 });
      this.text(s.classLine, 32, DH - 24, { size: 14, color: DIM });
    } else {
      const a = Math.min(1, (st - last - 0.7) / 0.25);
      ctx.globalAlpha = a;
      const head = `${s.headline} · ${s.name.toUpperCase()}`, sub = s.status(st);
      const col = !s.good ? AMBER : sp.sunk ? GOOD : sp.kind === 'land' ? GOOD : AMBER;
      ctx.font = `700 30px ${FONT}`;
      const w = Math.min(DW - 40, Math.max(ctx.measureText(head).width, sub.length * 11) + 64), y = DH - 82;
      ctx.fillStyle = 'rgba(4,12,20,0.82)'; ctx.fillRect(DW / 2 - w / 2, y - 44, w, 86);
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.strokeRect(DW / 2 - w / 2, y - 44, w, 86);
      this.text(head, DW / 2, y - 2, { size: head.length > 34 ? 24 : 30, weight: 700, align: 'center', color: col });
      this.text(sub, DW / 2, y + 28, { size: 16, align: 'center', color: sub.includes('DAMAGED') || sub.includes('NO DAMAGE') ? AMBER : sub.includes('LOST') ? BAD : HUD });
      ctx.globalAlpha = 1;
    }
  }
}

/** A seed-stable shuffle used by the dev hook to make sample reels. */
export const sampleSeed = (n: number) => Math.floor(mulberry32(n)() * 1e6);
