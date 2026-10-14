// Tactical plot drawn with PixiJS. North-up, centred on own ship.
// Reads sim state only; animation effects run on real time so they stay smooth
// at any time compression.

import { Application, Container, Graphics, Text } from 'pixi.js';
import { BAFFLE_HALF, RADAR, WEAPONS, arrayActive, isFriendlyClass, type Contact, type Game } from '../sim/sim';
import { CLASSES } from '../sim/classes';
import { angDiff, dist, fmtBrg, offset, type Vec } from '../sim/math';

const COL = {
  rule: 0x1f3b54, dim: 0x6f8ea6, own: 0x7cc8ff, contact: 0xf3b04b, threat: 0xff5d4f, ink: 0xc9dbe8, friend: 0x6fd3a8,
};
const FONT = 'IBM Plex Mono, ui-monospace, Menlo, monospace';
export const SPANS = [6, 12, 24, 40, 80];
const VISUAL_RANGE = 8;

type P = { x: number; y: number };

function dashed(g: Graphics, a: P, b: P, dash: number, gap: number) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1) return;
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
  for (let d = 0; d < L; d += dash + gap) {
    const e = Math.min(d + dash, L);
    g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

/** Short on-plot label: the class once classified, else the sonar designation. */
const tag = (c: Contact) => (c.classified ? CLASSES[c.classified].name.split(' (')[0] : c.name.replace('Sierra ', 'S'));

export class Plot {
  app = new Application();
  zoom = 3;
  private span = SPANS[3];
  private grid = new Graphics();
  private dyn = new Graphics();
  private fx = new Graphics();
  private labels = new Container();
  private pool: Text[] = [];
  private used = 0;
  private seenPings = 0;
  private seenBlasts = 0;
  private effects: { kind: 'ping' | 'blast'; at: number; pos: Vec; missile?: boolean }[] = [];
  private markers: { id: number; x: number; y: number }[] = [];

  async init(host: HTMLElement) {
    await this.app.init({ resizeTo: host, antialias: true, backgroundAlpha: 0, resolution: window.devicePixelRatio || 1, autoDensity: true });
    host.prepend(this.app.canvas);
    this.app.stage.addChild(this.grid, this.dyn, this.fx, this.labels);
  }

  reset(zoom: number) { this.seenPings = 0; this.seenBlasts = 0; this.effects = []; this.zoom = zoom; this.span = SPANS[zoom]; }

  private label(text: string, x: number, y: number, color: number, anchorX = 0, size = 11) {
    let t = this.pool[this.used];
    if (!t) {
      t = new Text({ text: '', style: { fontFamily: FONT, fontSize: size, fill: color } });
      this.pool.push(t); this.labels.addChild(t);
    }
    this.used++;
    if (t.text !== text) t.text = text;
    if (t.style.fill !== color) t.style.fill = color;
    if (t.style.fontSize !== size) t.style.fontSize = size;
    t.anchor.set(anchorX, 0.5);
    t.position.set(Math.round(x), Math.round(y));
    t.visible = true;
  }

  private local(clientX: number, clientY: number): P {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /** Contact whose marker is under the pointer, if any. */
  pick(clientX: number, clientY: number): number | null {
    const p = this.local(clientX, clientY);
    let best: number | null = null, bd = 16;
    for (const m of this.markers) { const d = Math.hypot(m.x - p.x, m.y - p.y); if (d < bd) { bd = d; best = m.id; } }
    return best;
  }

  /** Bearing from own ship to the pointer, for click-to-steer. */
  bearingAt(clientX: number, clientY: number): number | null {
    const p = this.local(clientX, clientY);
    const dx = p.x - this.app.screen.width / 2, dy = p.y - this.app.screen.height / 2;
    if (Math.hypot(dx, dy) < 6) return null;
    return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  }

  draw(g: Game, now: number) {
    const W = this.app.screen.width, H = this.app.screen.height;
    if (!W) return;
    this.span += (SPANS[this.zoom] - this.span) * 0.15; // smooth zoom
    const k = Math.min(W, H) / this.span;
    const own = g.own, over = !!g.over;
    const cx = W / 2, cy = H / 2, ctr = { x: cx, y: cy };
    const scr = (p: Vec): P => ({ x: cx + (p.x - own.x) * k, y: cy - (p.y - own.y) * k });
    const ray = (b: number, len: number): P => ({ x: cx + Math.sin((b * Math.PI) / 180) * len, y: cy - Math.cos((b * Math.PI) / 180) * len });
    const R = Math.min(W, H) * 0.47;
    const pulse = 0.65 + 0.35 * Math.sin(now / 260);

    for (const t of this.pool) t.visible = false;
    this.used = 0;
    this.markers = [];

    // Grid: range rings and compass rose.
    const gr = this.grid.clear();
    const step = this.span / 6;
    for (let i = 1; i <= 3; i++) {
      gr.circle(cx, cy, i * step * k).stroke({ width: 1, color: COL.rule });
      this.label(`${+(i * step).toFixed(1)} nm`, cx + 4, cy - i * step * k + 9, COL.dim);
    }
    for (let b = 0; b < 360; b += 10) {
      const a = ray(b, R - (b % 30 === 0 ? 10 : 5)), c = ray(b, R);
      gr.moveTo(a.x, a.y).lineTo(c.x, c.y);
      if (b % 30 === 0) { const p = ray(b, R - 22); this.label(fmtBrg(b), p.x, p.y, COL.dim, 0.5); }
    }
    gr.stroke({ width: 1, color: COL.rule });

    const d = this.dyn.clear();

    // Own track.
    for (const p of own.track) { const q = scr(p); d.rect(q.x - 1, q.y - 1, 2, 2); }
    d.fill({ color: COL.own, alpha: 0.35 });

    // Periscope horizon at periscope depth.
    if (own.depthT < 0.3) {
      d.circle(cx, cy, VISUAL_RANGE * k).stroke({ width: 1, color: COL.ink, alpha: 0.18 });
      this.label('periscope range', cx, cy + VISUAL_RANGE * k - 9, COL.dim, 0.5);
    }

    // Radar: classification ring and a sweeping trace.
    if (own.radar) {
      d.circle(cx, cy, RADAR.classify * k).stroke({ width: 1, color: COL.friend, alpha: 0.35 });
      this.label('radar ID 15 nm', cx, cy - RADAR.classify * k + 9, COL.friend, 0.5);
      const sw = ((now / 1000) * 90) % 360;
      for (let i = 0; i < 12; i++) {
        const e = ray(sw - i * 2.5, Math.min(R, RADAR.horizon * k));
        d.moveTo(cx, cy).lineTo(e.x, e.y).stroke({ width: 2, color: COL.friend, alpha: 0.28 * (1 - i / 12) });
      }
    }

    // Sonobuoys we heard splash, as small squares.
    for (const b of g.buoys) {
      if (!b.heard && !over) continue;
      const q = scr(b);
      d.rect(q.x - 2.5, q.y - 2.5, 5, 5).stroke({ width: 1, color: COL.threat, alpha: 0.6 });
    }

    // Baffles, or the towed array astern when it is working.
    if (arrayActive(g)) {
      const tail = ray(own.hdg + 180, Math.min(0.6 * k, 40));
      d.moveTo(cx, cy).lineTo(tail.x, tail.y).stroke({ width: 1.5, color: COL.own, alpha: 0.6 });
      d.circle(tail.x, tail.y, 2).fill({ color: COL.own });
    } else {
      const a0 = ((own.hdg + 180 - BAFFLE_HALF - 90) * Math.PI) / 180, a1 = ((own.hdg + 180 + BAFFLE_HALF - 90) * Math.PI) / 180;
      d.moveTo(cx, cy).arc(cx, cy, R, a0, a1).closePath().fill({ color: COL.dim, alpha: 0.09 });
    }

    // Contacts: bearing line, estimated position, range uncertainty.
    for (const c of g.contacts) {
      if (c.bearing === null) continue;
      const v = g.vessels.find((x) => x.id === c.vid)!;
      const sel = c.id === g.selected;
      const col = isFriendlyClass(c.classified) ? COL.friend : COL.contact;
      const alpha = !v.alive ? 0.25 : c.held ? (sel ? 1 : 0.7) : 0.4;
      const end = ray(c.bearing, R);
      if (c.held && v.alive) d.moveTo(cx, cy).lineTo(end.x, end.y);
      else dashed(d, ctr, end, 6, 6);
      d.stroke({ width: sel ? 2 : 1, color: col, alpha: alpha * (sel ? 1 : 0.6) });
      if (!c.est) continue;
      const e = scr(c.est);
      const rr = dist(own, c.est);
      if (c.estErr > 0.05 && v.alive) {
        const n = scr(offset(own, c.bearing, Math.max(0.1, rr - c.estErr)));
        const f = scr(offset(own, c.bearing, rr + c.estErr));
        d.moveTo(n.x, n.y).lineTo(f.x, f.y).stroke({ width: 7, color: col, alpha: 0.22 * alpha, cap: 'round' });
      }
      const s = sel ? 8 : 6;
      const m = v.alive ? c.motion : null;
      if (m) {
        // A solution good enough to call course and speed: where the estimate has been, a pointer
        // along the course, and a leader showing the run at the estimated speed: six minutes for
        // ships and submarines, one minute for aircraft.
        c.trail.forEach((p, i) => { const q = scr(p); d.circle(q.x, q.y, 1.6).fill({ color: col, alpha: alpha * (0.12 + 0.5 * (i / c.trail.length)) }); });
        const lead = scr(offset(c.est, m.crs, m.spd / (c.air ? 60 : 10)));
        if (m.spd > 0.5) d.moveTo(e.x, e.y).lineTo(lead.x, lead.y).stroke({ width: 1.5, color: col, alpha: alpha * 0.8 });
        const f = ray(m.crs, 1), fx = f.x - cx, fy = f.y - cy; // unit vector along the course on screen
        const ps = s + 2;
        const tip = { x: e.x + fx * ps, y: e.y + fy * ps };
        const l = { x: e.x - fx * ps * 0.7 - fy * ps * 0.75, y: e.y - fy * ps * 0.7 + fx * ps * 0.75 };
        const r2 = { x: e.x - fx * ps * 0.7 + fy * ps * 0.75, y: e.y - fy * ps * 0.7 - fx * ps * 0.75 };
        const notch = { x: e.x - fx * ps * 0.25, y: e.y - fy * ps * 0.25 };
        d.poly([tip.x, tip.y, l.x, l.y, notch.x, notch.y, r2.x, r2.y]).fill({ color: col, alpha: alpha * 0.35 }).stroke({ width: 2, color: col, alpha: c.held && sel ? pulse : alpha });
      } else {
        const shape = c.air ? [e.x - s, e.y + s * 0.6, e.x, e.y - s, e.x + s, e.y + s * 0.6] : [e.x, e.y - s, e.x + s, e.y, e.x, e.y + s, e.x - s, e.y];
        d.poly(shape).stroke({ width: 2, color: col, alpha: c.held && sel ? pulse : alpha });
      }
      if (sel && c.held) d.circle(e.x, e.y, 12 + 5 * (1 - pulse)).stroke({ width: 1, color: col, alpha: 0.3 * pulse });
      this.label(tag(c) + (v.alive ? (m ? ` · ${Math.round(m.spd)} kt` : '') : c.air ? ' (down)' : ' (sunk)'), e.x + 11, e.y - 9, col);
      this.markers.push({ id: c.id, x: e.x, y: e.y });
    }

    // Countermeasures.
    for (const dc of g.decoys) {
      if (dc.side !== 'us' && !over) continue;
      const q = scr(dc), col = dc.side === 'us' ? COL.own : COL.threat;
      d.circle(q.x, q.y, 4).circle(q.x, q.y, 8 + 3 * pulse).stroke({ width: 1, color: col, alpha: 0.8 });
    }

    // Weapons. Own weapons are tracked; enemy torpedoes show as bearings.
    for (const w of g.weapons) {
      if (w.dead) continue;
      const spec = WEAPONS[w.type];
      if (w.side === 'us' || over) {
        const col = w.side === 'us' ? COL.own : COL.threat;
        w.trail.forEach((p, i) => {
          const q = scr(p);
          d.circle(q.x, q.y, spec.missile ? 1 : 1.2).fill({ color: col, alpha: 0.08 + 0.5 * (i / w.trail.length) });
        });
        const q = scr(w);
        if (w.wire) { dashed(d, ctr, q, 2, 4); d.stroke({ width: 1, color: COL.own, alpha: 0.35 }); }
        if (w.enabled && !w.target) {
          const s0 = ((w.hdg - 30 - 90) * Math.PI) / 180, s1 = ((w.hdg + 30 - 90) * Math.PI) / 180;
          d.moveTo(q.x, q.y).arc(q.x, q.y, spec.seeker * k, s0, s1).closePath().fill({ color: col, alpha: 0.06 });
        }
        const h = ray(w.hdg, spec.missile ? 9 : 7), hx = h.x - cx, hy = h.y - cy;
        d.moveTo(q.x - hx, q.y - hy).lineTo(q.x + hx, q.y + hy).stroke({ width: spec.missile ? 2 : 3, color: col, cap: 'round' });
        if (spec.missile) d.circle(q.x + hx, q.y + hy, 2.5).fill({ color: col });
        this.label(w.label, q.x + 9, q.y + 9, col);
      } else if (w.heardBrg != null) {
        dashed(d, ctr, ray(w.heardBrg, R), 10, 4);
        d.stroke({ width: 2, color: COL.threat, alpha: pulse });
        const p = ray(w.heardBrg, R * 0.8);
        this.label('TORPEDO', p.x, p.y - 12, COL.threat, 0.5);
      }
    }

    // Truth revealed after the engagement.
    if (over) {
      for (const v of g.vessels) {
        if (v === own) continue;
        const col = v.side === 'allied' ? COL.friend : COL.threat;
        for (const p of v.track) { const q = scr(p); d.rect(q.x - 1.5, q.y - 1.5, 3, 3); }
        d.fill({ color: col, alpha: 0.5 });
        const q = scr(v);
        d.circle(q.x, q.y, 7).stroke({ width: 2, color: col });
        this.label(`${v.name}${v.alive ? '' : v.cls.kind === 'air' ? ' (down)' : ' (sunk)'}`, q.x + 11, q.y + 10, col);
      }
    }

    // Ordered heading and own ship.
    if (Math.abs(angDiff(own.ordHdg, own.hdg)) > 1) { dashed(d, ctr, ray(own.ordHdg, 70), 4, 4); d.stroke({ width: 1, color: COL.own, alpha: 0.5 }); }
    const hl = ray(own.hdg, 40);
    d.moveTo(cx, cy).lineTo(hl.x, hl.y).stroke({ width: 1, color: COL.own });
    const pt = (b: number, l: number) => ray(own.hdg + b, l);
    const n = pt(0, 12), r1 = pt(140, 10), t = pt(180, 4), l1 = pt(-140, 10);
    d.poly([n.x, n.y, r1.x, r1.y, t.x, t.y, l1.x, l1.y]).fill({ color: own.alive ? COL.own : COL.threat });

    // Effects: ping rings and detonations.
    for (; this.seenPings < g.pings.length; this.seenPings++) this.effects.push({ kind: 'ping', at: now, pos: { x: own.x, y: own.y } });
    for (; this.seenBlasts < g.blasts.length; this.seenBlasts++) this.effects.push({ kind: 'blast', at: now, pos: g.blasts[this.seenBlasts], missile: g.blasts[this.seenBlasts].missile });
    const f = this.fx.clear();
    this.effects = this.effects.filter((ef) => {
      const age = (now - ef.at) / 1000;
      const q = scr(ef.pos);
      if (ef.kind === 'ping') {
        if (age > 2) return false;
        for (const lag of [0, 0.25]) {
          const a = age - lag;
          if (a > 0) f.circle(q.x, q.y, a * R * 0.55).stroke({ width: 2, color: COL.ink, alpha: Math.max(0, 0.7 * (1 - a / 2)) });
        }
        return true;
      }
      if (age > 3) return false;
      f.circle(q.x, q.y, 6 + age * 40).stroke({ width: 3, color: ef.missile ? COL.threat : COL.contact, alpha: Math.max(0, 1 - age / 3) });
      f.circle(q.x, q.y, 4 + age * 18).fill({ color: 0xfff1d6, alpha: Math.max(0, 0.8 - age / 1.5) });
      return true;
    });
  }
}
