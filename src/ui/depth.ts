// Depth view: a side-on cut through the sea around Tang, after the original's Sea Conditions
// screen. Range from Tang runs left to right; height runs up into the sky and depth down to
// 900 feet, with the thermal layer marked. Each held contact sits at its estimated range,
// at the surface, at its depth or at its altitude. Contacts with no range yet are listed in
// a column on the right at their height.
import { CLASSES } from '../sim/classes';
import { LAYER_FT, altitudeFt, depthFeet, isFriendlyClass, type Contact, type Game, type Vessel } from '../sim/sim';
import { dist, fmtBrg } from '../sim/math';

const $ = (id: string) => document.getElementById(id)!;
const SEA_FT = 900;
const SKY_FT = 30000;
const RANGES = [5, 10, 20, 40, 60, 100, 150];
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtFt = (ft: number) => `${Math.round(ft).toLocaleString('en-US')} ft`;

interface Mark { c: Contact | null; v: Vessel; x: number; y: number; lane: 'air' | 'surface' | 'sub' }

export class DepthView {
  open = false;
  private hits: { x: number; y: number; id: number }[] = [];
  constructor(private canvas: HTMLCanvasElement, private g: () => Game) {
    $('depthClose').addEventListener('click', () => this.close());
    canvas.addEventListener('click', (ev) => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const near = this.hits.map((h) => ({ h, d: Math.hypot(h.x - x, h.y - y) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 24) this.g().selected = near.h.id;
    });
  }
  toggle() { if (this.open) this.close(); else this.show(); }
  show() { this.open = true; $('depthView').hidden = false; }
  close() { this.open = false; $('depthView').hidden = true; }

  draw(g: Game) {
    if (!this.open) return;
    const cv = this.canvas, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const x2 = cv.getContext('2d')!;
    x2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = { sea: css('--sea'), rule: css('--rule'), ink: css('--ink'), dim: css('--dim'), own: css('--own'), contact: css('--contact'), threat: css('--threat'), good: css('--good') };
    const mono = (px: number, w = 400) => `${w} ${px}px ${css('--f-data')}`;

    // Frame: sky band on top, sea below, a "no range" column on the right.
    const L = 62, R = W - 150, T = 8, B = H - 30;
    const surf = T + (B - T) * 0.3;
    const yAlt = (ft: number) => surf - (surf - T) * Math.sqrt(Math.min(ft, SKY_FT) / SKY_FT);
    const yDep = (ft: number) => surf + (B - surf) * (Math.min(ft, SEA_FT) / SEA_FT);

    // Held contacts, and for five minutes after losing one, its last known place (dimmed).
    const shown = g.contacts.filter((c) => (c.held || (c.ever && g.t - c.lastSeen < 300)) && g.vessels.find((v) => v.id === c.vid)?.alive && !g.vessels.find((v) => v.id === c.vid)?.gone);
    // Scale to what is held now; older, lost contacts beyond it sit at the edge.
    const ranged = shown.filter((c) => c.est && c.held);
    const far = Math.max(0, ...ranged.map((c) => dist(g.own, c.est!)));
    const maxR = RANGES.find((r) => r >= far * 1.08) ?? RANGES[RANGES.length - 1];
    const x0 = L + 18;
    const xR = (nm: number) => x0 + (R - 16 - x0) * Math.min(nm / maxR, 1);

    x2.clearRect(0, 0, W, H);
    // Sky
    const sky = x2.createLinearGradient(0, T, 0, surf);
    sky.addColorStop(0, '#081320'); sky.addColorStop(1, '#10273b');
    x2.fillStyle = sky; x2.fillRect(L, T, W - L, surf - T);
    // Sea above and below the layer
    const yl = yDep(LAYER_FT);
    const up = x2.createLinearGradient(0, surf, 0, yl);
    up.addColorStop(0, '#12456b'); up.addColorStop(1, '#0d3352');
    x2.fillStyle = up; x2.fillRect(L, surf, W - L, yl - surf);
    const dn = x2.createLinearGradient(0, yl, 0, B);
    dn.addColorStop(0, '#0a2236'); dn.addColorStop(1, '#06121d');
    x2.fillStyle = dn; x2.fillRect(L, yl, W - L, B - yl);
    // Thermal layer band
    x2.fillStyle = 'rgba(255, 93, 79, 0.22)'; x2.fillRect(L, yl - 5, W - L, 10);
    x2.strokeStyle = 'rgba(255, 93, 79, 0.7)'; x2.setLineDash([6, 5]); x2.beginPath(); x2.moveTo(L, yl); x2.lineTo(W, yl); x2.stroke(); x2.setLineDash([]);
    x2.font = mono(11, 600); x2.fillStyle = '#ff8a7e'; x2.textAlign = 'left'; x2.textBaseline = 'bottom';
    x2.fillText(`THERMAL LAYER ${fmtFt(LAYER_FT).toUpperCase()}`, x0, yl - 7);
    x2.font = mono(11); x2.fillStyle = C.dim; x2.textBaseline = 'top';
    x2.fillText('Crossing it costs about 9 dB', x0, yl + 7);
    // Surface line
    x2.strokeStyle = '#7cc8ff'; x2.globalAlpha = 0.6; x2.beginPath(); x2.moveTo(L, surf); x2.lineTo(W, surf); x2.stroke(); x2.globalAlpha = 1;
    // No-range column
    x2.fillStyle = 'rgba(7, 22, 36, 0.55)'; x2.fillRect(R, T, W - R, B - T);
    x2.strokeStyle = C.rule; x2.beginPath(); x2.moveTo(R + 0.5, T); x2.lineTo(R + 0.5, B); x2.stroke();
    x2.font = mono(10.5); x2.fillStyle = C.dim; x2.textAlign = 'center'; x2.textBaseline = 'top';
    x2.fillText('NO RANGE YET', (R + W) / 2, B + 8);

    // Height and depth scale on the left
    x2.font = mono(10.5); x2.textAlign = 'right'; x2.textBaseline = 'middle';
    x2.strokeStyle = 'rgba(201, 219, 232, 0.08)';
    for (const ft of [1000, 5000, 10000, 20000, 30000]) {
      const y = yAlt(ft); x2.fillStyle = C.dim; x2.fillText(ft >= 1000 ? `${ft / 1000}k ft` : `${ft}`, L - 8, y);
      x2.beginPath(); x2.moveTo(L, y); x2.lineTo(R, y); x2.stroke();
    }
    x2.fillStyle = C.ink; x2.fillText('0', L - 8, surf);
    for (let ft = 100; ft <= SEA_FT; ft += 100) {
      const y = yDep(ft); x2.fillStyle = C.dim; x2.fillText(`${ft}`, L - 8, y);
      x2.beginPath(); x2.moveTo(L, y); x2.lineTo(R, y); x2.stroke();
    }
    x2.save(); x2.translate(14, (T + B) / 2); x2.rotate(-Math.PI / 2); x2.textAlign = 'center'; x2.fillStyle = C.dim; x2.fillText('ALTITUDE · DEPTH IN FEET', 0, 0); x2.restore();
    // Range scale along the bottom
    x2.textAlign = 'center'; x2.textBaseline = 'top';
    const step = maxR / 5;
    for (let r = 0; r <= maxR + 1e-6; r += step) {
      const x = xR(r); x2.fillStyle = C.dim; x2.fillText(r === 0 ? 'TANG' : `${+r.toFixed(1)} nm`, x, B + 8);
      x2.strokeStyle = 'rgba(201, 219, 232, 0.08)'; x2.beginPath(); x2.moveTo(x, T); x2.lineTo(x, B); x2.stroke();
    }

    // Contacts
    const heightOf = (v: Vessel) => (v.cls.kind === 'air' ? yAlt(altitudeFt(v)) : v.cls.kind === 'sub' ? yDep(depthFeet(v.depthT)) : surf);
    const marks: Mark[] = [];
    let listY = { air: T + 14, surface: surf - 2, sub: surf + 26 };
    for (const c of shown) {
      const v = g.vessels.find((x) => x.id === c.vid)!;
      const lane = v.cls.kind === 'air' ? 'air' : v.cls.kind === 'sub' ? 'sub' : 'surface';
      if (c.est) marks.push({ c, v, x: xR(dist(g.own, c.est)), y: heightOf(v), lane });
      else {
        // Unranged: stack in the right-hand column at about the right height.
        const y = Math.max(listY[lane], lane === 'sub' ? heightOf(v) : lane === 'air' ? heightOf(v) : surf);
        listY = { ...listY, [lane]: y + 30 };
        marks.push({ c, v, x: R + 16, y, lane });
      }
    }
    marks.sort((a, b) => a.x - b.x);
    this.hits = [];
    // Glyphs first, then labels placed in the first free tier, with a leader line when lifted.
    const taken: { l: number; t: number; r: number; b: number }[] = [];
    const clash = (q: { l: number; t: number; r: number; b: number }) => q.t < T || q.b > B || taken.some((o) => q.l < o.r && q.r > o.l && q.t < o.b && q.b > o.t);
    for (const m of marks) {
      const col = isFriendlyClass(m.c!.classified) ? C.good : C.contact;
      x2.globalAlpha = m.c!.held ? 1 : 0.45;
      glyph(x2, m.v, m.x, m.y, col, g.selected === m.c!.id);
      x2.globalAlpha = 1;
      this.hits.push({ x: m.x, y: m.y, id: m.c!.id });
      taken.push({ l: m.x - 14, t: m.y - 9, r: m.x + 14, b: m.y + 5 });
    }
    for (const m of marks) {
      const c = m.c!, sel = g.selected === c.id;
      const col = sel ? '#ffffff' : isFriendlyClass(c.classified) ? C.good : C.contact;
      const cls = c.classified ? CLASSES[c.classified].name.split(' (')[0].replace(/ ".*"/, '') : null;
      const line1 = cls ? `${c.name} · ${cls}` : c.name;
      const what = [m.lane === 'air' ? fmtFt(altitudeFt(m.v)) : m.lane === 'sub' ? `≈ ${fmtFt(Math.round(depthFeet(m.v.depthT) / 50) * 50)}` : '', m.x > R && c.bearing !== null ? `brg ${fmtBrg(c.bearing)}` : '', c.held ? '' : 'lost'].filter(Boolean).join(' · ');
      x2.font = mono(11, sel ? 600 : 400);
      const w = Math.max(x2.measureText(line1).width, what ? x2.measureText(what).width : 0) + 6;
      const h = what ? 26 : 14;
      const inCol = m.x > R;
      const down = m.lane === 'sub';
      let box = null as null | { l: number; t: number; r: number; b: number };
      for (let tier = 0; tier < 12 && !box; tier++) {
        const top = down ? m.y + 8 + tier * 16 : m.y - 11 - h - tier * 16;
        const l = inCol ? m.x + 14 : Math.min(Math.max(m.x - w / 2, L + 4), R - w - 4);
        const q = { l, t: top, r: l + w, b: top + h };
        if (!clash(q)) box = q;
      }
      if (!box) continue; // no room: the glyph alone still shows it
      taken.push(box);
      const near = down ? box.t : box.b;
      if (Math.abs(near - m.y) > 16 && !inCol) {
        x2.strokeStyle = col; x2.globalAlpha = 0.35; x2.beginPath(); x2.moveTo(m.x, m.y + (down ? 5 : -9)); x2.lineTo(m.x, near); x2.stroke(); x2.globalAlpha = 1;
      }
      x2.textAlign = 'left'; x2.textBaseline = 'top';
      x2.globalAlpha = c.held ? 1 : 0.6;
      x2.fillStyle = col; x2.fillText(line1, box.l + 3, box.t);
      if (what) { x2.fillStyle = C.dim; x2.font = mono(10.5); x2.fillText(what, box.l + 3, box.t + 13); }
      x2.globalAlpha = 1;
    }
    // Own ship last so it sits on top.
    const oy = yDep(depthFeet(g.own.depthT));
    glyph(x2, g.own, x0, oy, C.own, false);
    x2.font = mono(11, 600); x2.fillStyle = C.own; x2.textAlign = 'left'; x2.textBaseline = 'top';
    x2.fillText(`TANG ${fmtFt(depthFeet(g.own.depthT))}`, x0 + 18, oy + 8);

    // Header readout
    const deep = depthFeet(g.own.depthT) > LAYER_FT;
    const above = marks.filter((m) => m.lane === 'sub' && depthFeet(m.v.depthT) <= LAYER_FT).length;
    const below = marks.filter((m) => m.lane === 'sub' && depthFeet(m.v.depthT) > LAYER_FT).length;
    const ships = marks.filter((m) => m.lane === 'surface').length, air = marks.filter((m) => m.lane === 'air').length;
    const parts = [`Tang ${deep ? 'below' : 'above'} layer`, `${ships} ship${ships === 1 ? '' : 's'}`, `${above + below} sub${above + below === 1 ? '' : 's'}${below ? ` (${below} deep)` : ''}`, `${air} aircraft`];
    const read = $('depthRead');
    const txt = parts.join(' · ');
    if (read.textContent !== txt) read.textContent = txt;
  }
}

/** Small side-on symbols: a hull on the surface, a submarine, an aircraft. */
function glyph(x2: CanvasRenderingContext2D, v: Vessel, x: number, y: number, col: string, sel: boolean) {
  x2.save();
  x2.translate(x, y);
  x2.fillStyle = col; x2.strokeStyle = col;
  if (v.cls.kind === 'air') {
    x2.beginPath(); x2.moveTo(-9, 0); x2.lineTo(9, 0); x2.lineTo(11, -1.5); x2.lineTo(-7, -1.5); x2.closePath(); x2.fill();
    x2.fillRect(-2, -5, 4, 9); x2.fillRect(-10, -5, 2.5, 4);
  } else if (v.cls.kind === 'sub') {
    x2.beginPath(); x2.ellipse(0, 0, 13, 3.6, 0, 0, Math.PI * 2); x2.fill();
    x2.fillRect(-1, -7, 5, 4);
  } else {
    x2.beginPath(); x2.moveTo(-13, -4); x2.lineTo(13, -4); x2.lineTo(9, 1); x2.lineTo(-11, 1); x2.closePath(); x2.fill();
    x2.fillRect(-3, -9, 6, 5); x2.fillRect(-7, -6.5, 3, 2.5);
  }
  if (sel) { x2.lineWidth = 1.5; x2.strokeStyle = '#ffffff'; x2.strokeRect(-17, -12, 34, 18); }
  x2.restore();
}
