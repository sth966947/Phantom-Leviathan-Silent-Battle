// Periscope view: what the selected contact looks like through the photonics mast,
// drawn from its class silhouette at the real range and aspect, with the ID book
// alongside so the player can compare shapes and accept a class.
import { CLASSES, LIBRARY } from '../sim/classes';
import { contactById, contactLabel, inPeriscope, isFriendlyClass, orders, type Game, type Vessel } from '../sim/sim';
import { angDiff, brg, dist, fmtBrg, fmtRng } from '../sim/math';

// ---- Silhouettes ------------------------------------------------------------------------
// Ships: x runs 0 (stern) to 1 (bow), heights in metres above the waterline.
// Approximate shapes from period photographs; enough to tell the classes apart, and to
// see why Hood's gunners took Prinz Eugen for Bismarck.
type Part =
  | { t: 'box'; x0: number; x1: number; h: number }
  | { t: 'funnel'; x: number; w: number; h: number; rake?: number }
  | { t: 'turret'; x: number; w: number; h: number; gun: number }
  | { t: 'mast'; x: number; h: number; tripod?: boolean };
interface ShipSil { kind: 'ship'; len: number; deck: [number, number][]; parts: Part[] }
interface AirSil { kind: 'air'; len: number; alt: number; draw: (c: CanvasRenderingContext2D, L: number) => void }
type Sil = ShipSil | AirSil;

const T = (x: number, h: number, w = 0.045, gun = 0.07): Part => ({ t: 'turret', x, w, h, gun });

const SHIPS: Record<string, ShipSil> = {
  bismarck: {
    kind: 'ship', len: 251, deck: [[0, 7], [0.15, 8], [0.55, 8], [0.85, 9], [1, 11]],
    parts: [T(0.12, 12), T(0.21, 15), { t: 'box', x0: 0.28, x1: 0.38, h: 16 }, { t: 'mast', x: 0.34, h: 34 },
      T(0.4, 13, 0.025, 0.035), { t: 'funnel', x: 0.47, w: 0.05, h: 26 }, T(0.56, 13, 0.025, 0.035),
      { t: 'box', x0: 0.52, x1: 0.63, h: 20 }, { t: 'box', x0: 0.55, x1: 0.61, h: 28 }, { t: 'mast', x: 0.58, h: 38 },
      T(0.7, 15), T(0.79, 13)],
  },
  hipper: {
    kind: 'ship', len: 212, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 10]],
    parts: [T(0.12, 10, 0.045, 0.06), T(0.2, 13, 0.045, 0.06), { t: 'box', x0: 0.27, x1: 0.36, h: 13 }, { t: 'mast', x: 0.33, h: 28 },
      { t: 'funnel', x: 0.46, w: 0.055, h: 23, rake: 0.01 }, { t: 'box', x0: 0.52, x1: 0.61, h: 19 }, { t: 'box', x0: 0.55, x1: 0.6, h: 25 },
      { t: 'mast', x: 0.57, h: 33 }, T(0.72, 13, 0.045, 0.06), T(0.8, 11, 0.045, 0.06)],
  },
  county: {
    kind: 'ship', len: 192, deck: [[0, 8], [0.6, 10], [1, 11]],
    parts: [T(0.12, 12, 0.04, 0.05), T(0.2, 15, 0.04, 0.05), { t: 'mast', x: 0.3, h: 32, tripod: true },
      { t: 'funnel', x: 0.4, w: 0.028, h: 30 }, { t: 'funnel', x: 0.48, w: 0.028, h: 30 }, { t: 'funnel', x: 0.56, w: 0.028, h: 30 },
      { t: 'box', x0: 0.61, x1: 0.68, h: 20 }, { t: 'mast', x: 0.63, h: 36, tripod: true }, T(0.74, 15, 0.04, 0.05), T(0.82, 13, 0.04, 0.05)],
  },
  admiral: {
    kind: 'ship', len: 262, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 10]],
    parts: [T(0.13, 11), T(0.22, 14), { t: 'box', x0: 0.35, x1: 0.43, h: 14 }, { t: 'mast', x: 0.39, h: 30, tripod: true },
      { t: 'funnel', x: 0.48, w: 0.04, h: 24 }, { t: 'funnel', x: 0.56, w: 0.04, h: 24 },
      { t: 'box', x0: 0.6, x1: 0.69, h: 22 }, { t: 'box', x0: 0.62, x1: 0.67, h: 30 }, { t: 'mast', x: 0.65, h: 38, tripod: true },
      T(0.72, 14), T(0.81, 12)],
  },
  kgv: {
    kind: 'ship', len: 227, deck: [[0, 7], [0.5, 8], [1, 10]],
    parts: [T(0.15, 12, 0.06), { t: 'box', x0: 0.3, x1: 0.41, h: 17 }, { t: 'mast', x: 0.37, h: 32 },
      { t: 'funnel', x: 0.44, w: 0.05, h: 23 }, { t: 'funnel', x: 0.53, w: 0.05, h: 23 },
      { t: 'box', x0: 0.57, x1: 0.67, h: 22 }, { t: 'box', x0: 0.59, x1: 0.65, h: 28 }, { t: 'mast', x: 0.62, h: 36 },
      T(0.7, 15, 0.04), T(0.79, 12, 0.06)],
  },
  merchant: {
    kind: 'ship', len: 130, deck: [[0, 7], [0.1, 8], [0.12, 6], [0.85, 6], [0.88, 8], [1, 9]],
    parts: [{ t: 'box', x0: 0, x1: 0.1, h: 10 }, { t: 'mast', x: 0.24, h: 24 }, { t: 'box', x0: 0.42, x1: 0.56, h: 15 },
      { t: 'funnel', x: 0.5, w: 0.06, h: 21 }, { t: 'mast', x: 0.74, h: 24 }, { t: 'box', x0: 0.88, x1: 1, h: 10 }],
  },
};

// Aircraft are drawn nose to the right in a box `L` pixels long.
const AIR: Record<string, AirSil> = {
  ar196: {
    kind: 'air', len: 11, alt: 300, draw(c, L) {
      c.fillRect(0, -0.07 * L, L * 0.85, 0.12 * L);                 // fuselage
      c.beginPath(); c.moveTo(0, -0.05 * L); c.lineTo(0.08 * L, -0.3 * L); c.lineTo(0.16 * L, -0.06 * L); c.fill(); // fin
      c.fillRect(0.38 * L, -0.03 * L, 0.3 * L, 0.04 * L);           // wing root
      c.fillRect(0.3 * L, 0.3 * L, 0.6 * L, 0.07 * L);              // float
      c.fillRect(0.45 * L, 0.05 * L, 0.03 * L, 0.26 * L); c.fillRect(0.72 * L, 0.05 * L, 0.03 * L, 0.26 * L); // struts
      c.fillRect(0.85 * L, -0.18 * L, 0.03 * L, 0.36 * L);          // propeller disc
    },
  },
  il38: {
    kind: 'air', len: 40, alt: 600, draw(c, L) {
      c.beginPath(); c.ellipse(0.5 * L, 0, 0.5 * L, 0.06 * L, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(0.02 * L, -0.03 * L); c.lineTo(0.08 * L, -0.26 * L); c.lineTo(0.18 * L, -0.26 * L); c.lineTo(0.2 * L, -0.03 * L); c.fill();
      c.fillRect(0.4 * L, -0.02 * L, 0.24 * L, 0.03 * L);                         // wing
      for (const x of [0.5, 0.6]) { c.fillRect(x * L, -0.01 * L, 0.08 * L, 0.05 * L); c.fillRect((x + 0.08) * L, -0.08 * L, 0.008 * L, 0.18 * L); } // nacelles, props
      c.beginPath(); c.ellipse(0.62 * L, 0.06 * L, 0.06 * L, 0.025 * L, 0, 0, Math.PI * 2); c.fill(); // search radar
    },
  },
  ka27: {
    kind: 'air', len: 16, alt: 25, draw(c, L) {
      c.beginPath(); c.ellipse(0.62 * L, 0, 0.26 * L, 0.13 * L, 0, 0, Math.PI * 2); c.fill(); // cabin
      c.fillRect(0.2 * L, -0.04 * L, 0.4 * L, 0.07 * L);                           // tail boom
      c.fillRect(0.18 * L, -0.16 * L, 0.04 * L, 0.2 * L);                          // twin fins
      c.fillRect(0.6 * L, -0.4 * L, 0.03 * L, 0.28 * L);                           // rotor mast
      c.fillRect(0.1 * L, -0.4 * L, L, 0.02 * L); c.fillRect(0.1 * L, -0.32 * L, L, 0.02 * L); // coaxial rotors
      c.fillRect(0.5 * L, 0.13 * L, 0.03 * L, 0.06 * L); c.fillRect(0.75 * L, 0.13 * L, 0.03 * L, 0.06 * L); // gear
    },
  },
};
const AIR_LIBRARY: Record<'1941' | '2029', string[]> = { '1941': ['ar196'], '2029': ['il38', 'ka27'] };
const silOf = (key: string): Sil | null => SHIPS[key] ?? AIR[key] ?? null;

/** Draw a silhouette with its waterline (or centre, for aircraft) at the origin, bow toward +x. */
function drawSil(c: CanvasRenderingContext2D, sil: Sil, lenPx: number, foreshorten: number, ppm: number) {
  const L = lenPx * foreshorten;
  if (sil.kind === 'air') {
    c.save(); c.translate(-L / 2, 0); c.scale(foreshorten, 1); sil.draw(c, lenPx); c.restore();
    return;
  }
  const X = (x: number) => -L / 2 + x * L;
  const Y = (h: number) => -h * ppm;
  c.beginPath();
  c.moveTo(X(0.01), 1.5 * ppm);
  for (const [x, h] of sil.deck) c.lineTo(X(x), Y(h));
  c.lineTo(X(0.99), 1.5 * ppm);
  c.closePath(); c.fill();
  const deckAt = (x: number) => {
    const d = sil.deck;
    for (let i = 1; i < d.length; i++) if (x <= d[i][0]) { const [x0, h0] = d[i - 1], [x1, h1] = d[i]; return h0 + ((x - x0) / (x1 - x0)) * (h1 - h0); }
    return d[d.length - 1][1];
  };
  const line = Math.max(1, ppm * 0.6);
  for (const p of sil.parts) {
    if (p.t === 'box') c.fillRect(X(p.x0), Y(p.h), (p.x1 - p.x0) * L, (p.h - deckAt(p.x0)) * ppm + 1);
    else if (p.t === 'funnel') {
      const w = p.w * L, r = (p.rake ?? 0.004) * L, base = deckAt(p.x);
      c.beginPath(); c.moveTo(X(p.x) - w / 2, Y(base)); c.lineTo(X(p.x) - w / 2 - r, Y(p.h)); c.lineTo(X(p.x) + w / 2 - r, Y(p.h)); c.lineTo(X(p.x) + w / 2, Y(base)); c.fill();
    } else if (p.t === 'turret') {
      const w = p.w * L, base = deckAt(p.x);
      // Superfiring turrets sit on a barbette.
      c.fillRect(X(p.x) - w * 0.35, Y(p.h - 2.5), w * 0.7, (p.h - 2.5 - base) * ppm + 1);
      c.fillRect(X(p.x) - w / 2, Y(p.h), w, 3.5 * ppm);
      const dir = p.x > 0.5 ? 1 : -1;
      c.fillRect(dir > 0 ? X(p.x) + w / 2 : X(p.x) - w / 2 - p.gun * L, Y(p.h - 1.2), p.gun * L, Math.max(1, ppm * 0.8));
    } else {
      const base = deckAt(p.x);
      c.fillRect(X(p.x) - line / 2, Y(p.h), line, (p.h - base) * ppm);
      c.fillRect(X(p.x) - L * 0.02, Y(p.h * 0.8), L * 0.04, line); // yard
      if (p.tripod) { c.beginPath(); c.moveTo(X(p.x), Y(p.h * 0.75)); c.lineTo(X(p.x) - L * 0.02, Y(base)); c.lineTo(X(p.x) - L * 0.02 + line, Y(base)); c.lineTo(X(p.x) + line, Y(p.h * 0.75)); c.fill(); }
    }
  }
}

/** Broadside recognition picture of a class, scaled to fit the canvas (ships to a common scale). */
export function drawClassPicture(cv: HTMLCanvasElement, key: string) {
  const sil = silOf(key);
  const x = cv.getContext('2d')!;
  x.clearRect(0, 0, cv.width, cv.height);
  if (!sil) return;
  x.save();
  x.fillStyle = isFriendlyClass(key) ? '#6fd3a8' : '#c9dbe8';
  const air = sil.kind === 'air';
  x.translate(cv.width / 2, cv.height * (air ? 0.56 : 0.82));
  const lenPx = (cv.width - 14) * (air ? 0.8 : sil.len / 262);
  drawSil(x, sil, lenPx, 1, lenPx / sil.len);
  x.restore();
}

// ---- The view ------------------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const NM = 1852;

export class Periscope {
  open = false;
  private flakes = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.5 }));
  private refFor = '';
  constructor(private canvas: HTMLCanvasElement, private g: () => Game) {
    $('scopeRef').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('button[data-classify]');
      if (b) { orders.classify(this.g(), Number(b.dataset.contact), b.dataset.classify!); this.refFor = ''; }
    });
    $('scopeClose').addEventListener('click', () => this.close());
  }

  /** Try to raise the view on the selected contact; says why not if it can't. */
  toggle(): string | null {
    if (this.open) { this.close(); return null; }
    const g = this.g();
    const c = contactById(g, g.selected);
    if (!inPeriscope(g, c)) return 'Periscope: nothing to look at. Select a ship within 8 nm (aircraft within 10 nm) at periscope depth.';
    this.show();
    return null;
  }
  show() { this.open = true; this.refFor = ''; $('scope').hidden = false; }
  close() { this.open = false; $('scope').hidden = true; }

  draw(g: Game, now: number) {
    if (!this.open) return;
    const c = contactById(g, g.selected);
    const v = inPeriscope(g, c);
    if (!c || !v) { this.close(); return; }
    this.reference(g, c.id, v);
    const read = this.render(this.canvas, g, v, now);
    if ($('scopeRead').textContent !== read) $('scopeRead').textContent = read;
    const title = `Periscope · ${contactLabel(c)}`;
    if ($('scopeTitle').textContent !== title) $('scopeTitle').textContent = title;
  }

  /** Draw the view of `v` into any canvas; returns the bearing, range and angle-on-the-bow readout. */
  render(cv: HTMLCanvasElement, g: Game, v: Vessel, now: number): string {
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const sil = silOf(v.cls.key);
    const rNm = dist(g.own, v), rM = rNm * NM;
    const theta = angDiff(v.hdg, brg(g.own, v));           // target course across our line of sight
    const fore = Math.max(0.14, Math.abs(Math.sin((theta * Math.PI) / 180)));
    const len = sil?.len ?? 100;
    // The photonics mast zooms so the target fills about half the frame.
    const fov = Math.min(0.14, Math.max(0.004, (len * fore) / rM * 1.5));
    const ppm = W / (rM * fov);
    const zoom = Math.max(1, Math.round(0.14 / fov * 1.5));
    const night = g.era === '2029';

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    // Train the scope on the target: aircraft sit above the horizon by their elevation.
    const elevPx = sil?.kind === 'air' ? (sil.alt / rM) * (W / fov) : 0;
    const air = sil?.kind === 'air';
    const horizon = Math.min(H * 2, air ? cy + elevPx : cy + H * 0.12);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, night ? '#2c3d4e' : '#6d7b86'); sky.addColorStop(1, night ? '#5a6d7c' : '#aab4ba');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon);
    const sea = ctx.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, night ? '#18242c' : '#4d5c63'); sea.addColorStop(1, night ? '#070d12' : '#26333a');
    ctx.fillStyle = sea; ctx.fillRect(0, horizon, W, H - horizon);
    // Swell lines.
    ctx.strokeStyle = night ? 'rgba(160,190,200,0.08)' : 'rgba(220,230,235,0.12)';
    for (let i = 1; i < 14; i++) {
      const y = horizon + (H - horizon) * (i / 14) ** 1.6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) ctx.lineTo(x, y + Math.sin(x / 30 + now / 900 + i) * (1 + i * 0.3));
      ctx.stroke();
    }
    if (sil) {
      // Haze and snow thin the image with range.
      const vis = Math.max(0.25, 1 - rNm / (sil.kind === 'air' ? 14 : 11));
      ctx.fillStyle = night ? `rgba(4,8,10,${vis})` : `rgba(28,34,38,${vis})`;
      ctx.save();
      ctx.translate(cx, air ? cy : horizon);
      if (Math.sin((theta * Math.PI) / 180) < 0) ctx.scale(-1, 1); // bow toward the way she is heading
      if (sil.kind === 'ship') {
        // Beyond about 3 nm a periscope 2 m above the water starts to lose the hull below the horizon.
        const hiddenM = rNm > 3 ? (((rNm - 3) / 1.17) ** 2) * 0.3048 : 0;
        ctx.beginPath(); ctx.rect(-W, -H * 2, W * 2, H * 2 + 1); ctx.clip();
        ctx.translate(0, hiddenM * ppm + Math.sin(now / 1300) * ppm * 0.6);
        ctx.rotate(Math.sin(now / 1700) * 0.01); // rolling in the swell
      }
      drawSil(ctx, sil, len * ppm, fore, ppm);
      ctx.restore();
    }
    // Snow in 1941, spray at night in 2029.
    ctx.fillStyle = 'rgba(235,240,245,0.55)';
    for (const f of this.flakes) {
      const y = (f.y + now / 9000 * f.s) % 1, x = (f.x + Math.sin(now / 2000 + f.y * 9) * 0.01) % 1;
      if (!night || f.s > 1.6) ctx.fillRect(x * W, y * H, f.s, f.s);
    }
    // Reticle with stadimeter ticks.
    ctx.strokeStyle = 'rgba(200,255,220,0.65)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    for (let i = -8; i <= 8; i++) { if (!i) continue; const x = cx + i * W / 18; ctx.beginPath(); ctx.moveTo(x, cy - (i % 4 ? 4 : 9)); ctx.lineTo(x, cy + (i % 4 ? 4 : 9)); ctx.stroke(); }
    const vg = ctx.createRadialGradient(cx, cy, W * 0.3, cx, cy, W / 2);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.strokeStyle = '#0d2133'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.stroke();

    const aob = angDiff(brg(v, g.own), v.hdg);
    return `Bearing ${fmtBrg(brg(g.own, v))}° · range ${fmtRng(rNm)} · angle on the bow ${Math.abs(Math.round(aob))}° ${aob >= 0 ? 'starboard' : 'port'} · zoom ×${zoom}`;
  }

  /** The ID book: every class this contact could be, broadside, with the crew's match % and Accept. */
  private reference(g: Game, contactId: number, v: Vessel) {
    const c = contactById(g, contactId)!;
    const keys = v.cls.kind === 'air' ? AIR_LIBRARY[g.era] : LIBRARY[g.era].filter((k) => CLASSES[k].kind === 'surface');
    const sig = `${contactId}|${c.classified}|${c.matches.map((m) => m.key + m.pct).join()}`;
    if (sig === this.refFor) return;
    this.refFor = sig;
    const host = $('scopeRef');
    host.innerHTML = '';
    for (const key of keys) {
      const cl = CLASSES[key], m = c.matches.find((x) => x.key === key);
      const card = document.createElement('div');
      card.className = 'ref' + (c.classified === key ? ' chosen' : '');
      const cv = document.createElement('canvas');
      cv.width = 150; cv.height = 46;
      drawClassPicture(cv, key);
      const name = document.createElement('span');
      name.textContent = cl.name + (m ? ` · crew ${m.pct}%` : '');
      card.append(cv, name);
      if (c.classified === key) { const d = document.createElement('span'); d.className = 'done'; d.textContent = 'classified'; card.append(d); }
      else { const b = document.createElement('button'); b.dataset.classify = key; b.dataset.contact = String(contactId); b.textContent = 'Accept'; card.append(b); }
      host.append(card);
    }
  }
}
