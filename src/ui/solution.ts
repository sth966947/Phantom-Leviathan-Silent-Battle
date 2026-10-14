// Solution window: identification for the selected contact. Broadband waterfall and
// narrowband signature on top; below, the classes the sensor picture still allows, and
// the recognition-book page (picture, reference signature, weapons, speed, armor) of
// whichever one the captain picks.
import { CLASSES, REFERENCE } from '../sim/classes';
import { bearingRate, contactById, contactLabel, inPeriscope, isFriendlyClass, orders, radarTracked, type Contact, type Game } from '../sim/sim';
import { dist, fmtBrg, fmtRng } from '../sim/math';
import { drawClassPicture } from './periscope';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const setHTML = (el: HTMLElement, v: string) => { if (el.dataset.html !== v) { el.dataset.html = v; el.innerHTML = v; } };
const setText = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };

const MAX_HZ = 200;
const NATION: Record<string, string> = { US: 'US', UK: 'British', Germany: 'German', Russia: 'Russian', Japan: 'Japanese', Italy: 'Italian', Netherlands: 'Dutch' };
const FLAG: Record<string, string> = { US: 'US', UK: 'UK', Germany: 'GER', Russia: 'RUS', Japan: 'JPN', Italy: 'ITA', Netherlands: 'NED' };
const drift = (c: Contact) => {
  const r = c.held ? bearingRate(c) : null;
  return r === null ? null : Math.abs(r) < 0.2 ? 'steady' : `${r > 0 ? 'R' : 'L'} ${Math.abs(r).toFixed(1)}°/min`;
};
const source = (g: Game, c: Contact) => (radarTracked(g, c) ? 'radar fix' : c.spotted && inPeriscope(g, c) ? 'periscope fix' : c.air && !c.est ? 'bearing only' : `solution ${Math.round(c.q * 100)}%`);
/** Tonal lines seen on the contact, without the propeller line. */
const tonalsSeen = (c: Contact) => (c.sig ? c.sig.lines.slice(0, c.sig.prop ? -1 : undefined) : []);

interface Row { key: string; pct: number | null }

export class Solution {
  open = false;
  private pick: string | null = null;
  private pickFor: number | null = null;
  private drawn = '';
  constructor(private g: () => Game) {
    $('feed').addEventListener('click', (ev) => {
      const tr = (ev.target as HTMLElement).closest<HTMLElement>('tr[data-key]');
      if (tr) { this.pick = tr.dataset.key!; this.update(this.g()); }
    });
    $('clsAccept').addEventListener('click', () => {
      const g = this.g();
      if (g.selected !== null && this.pick) orders.classify(g, g.selected, this.pick);
      this.update(g);
    });
    $('solClose').addEventListener('click', () => this.close());
  }
  toggle() { if (this.open) this.close(); else this.show(); }
  show() { this.open = true; $('solution').hidden = false; this.drawn = ''; }
  close() { this.open = false; $('solution').hidden = true; }

  /** Candidate classes for the contact: the crew's matches that aren't ruled out, or the whole book before any lines show. */
  private rows(g: Game, c: Contact): { rows: Row[]; ruledOut: number } {
    if (c.matches.length) {
      const live = c.matches.filter((m) => m.pct >= 1 || m.key === c.classified);
      return { rows: live.map((m) => ({ key: m.key, pct: m.pct })), ruledOut: c.matches.length - live.length };
    }
    if (c.classified) return { rows: [{ key: c.classified, pct: null }], ruledOut: 0 };
    const kind = (k: string) => CLASSES[k].kind === 'air';
    return { rows: g.library.filter((k) => kind(k) === c.air).map((key) => ({ key, pct: null })), ruledOut: 0 };
  }

  /** Called at panel refresh rate. */
  update(g: Game) {
    if (!this.open) return;
    const c = contactById(g, g.selected);
    setText($('solTitle'), c ? `Solution · ${contactLabel(c)}` : 'Solution · select a contact (Tab)');
    if (!c) {
      setHTML($('solSensed'), '<span class="dim">No contact selected. Press Tab or click one in the contacts list.</span>');
      setHTML($('feed'), '');
      this.pick = null; this.pickFor = null;
      this.detail(null, null);
      return;
    }
    const { rows, ruledOut } = this.rows(g, c);
    if (this.pickFor !== c.id || !rows.some((r) => r.key === this.pick)) {
      this.pickFor = c.id;
      this.pick = c.classified && rows.some((r) => r.key === c.classified) ? c.classified : rows[0]?.key ?? null;
    }

    // What the sensors have on this contact: the evidence the table is matched against.
    const seen = tonalsSeen(c);
    const sensed: string[] = [];
    if (c.bearing !== null) sensed.push(`Brg ${fmtBrg(c.bearing)}°${drift(c) ? `, ${drift(c)}` : ''}`);
    const v = g.vessels.find((x) => x.id === c.vid)!;
    if (c.est && v.alive) sensed.push(`Rng ${fmtRng(dist(g.own, c.est))}${c.estErr > 0.05 ? ` ± ${fmtRng(c.estErr)}` : ''}`);
    sensed.push(source(g, c));
    if (!c.air || c.sig) {
      sensed.push(seen.length ? `${seen.length} line${seen.length > 1 ? 's' : ''} at ${seen.map((l) => Math.round(l.hz)).join(', ')} Hz` : 'no tonal lines yet');
      sensed.push(c.sig?.prop ? `${c.sig.prop.blades} blades` : 'blades not resolved');
      if (c.cavitating || c.sig?.smear) sensed.push('cavitating');
    }
    if (c.sighted) sensed.push(`sighted: ${CLASSES[c.sighted].name}`);
    if (ruledOut) sensed.push(`${ruledOut} class${ruledOut > 1 ? 'es' : ''} ruled out`);
    setHTML($('solSensed'), sensed.map((s) => `<span>${esc(s)}</span>`).join(''));

    const html = rows.map(({ key, pct }) => {
      const k = CLASSES[key];
      const hits = seen.filter((l) => k.tonals.some((t) => Math.abs(t - l.hz) < 2)).length;
      const lines = !seen.length ? `${k.tonals.length}` : `${hits} of ${seen.length}`;
      const blades = !k.blades ? '—' : c.sig?.prop ? `${k.blades} ${k.blades === c.sig.prop.blades ? '✓' : '✗'}` : String(k.blades);
      const cls = [key === this.pick ? 'sel' : '', isFriendlyClass(key) ? 'friend' : '', c.classified === key ? 'chosen' : ''].join(' ');
      return `<tr class="${cls}" data-key="${key}"><td>${esc(k.name)}${c.classified === key ? ' ✓' : ''}</td><td>${esc(k.type)}</td><td>${FLAG[k.nation]}</td>`
        + `<td>${lines}</td><td>${blades}</td><td>${k.maxSpd} kt</td><td>${pct === null ? '—' : `${pct}%`}</td></tr>`;
    });
    setHTML($('feed'), html.join('') || `<tr><td colspan="7" class="empty">${c.air ? 'Air contact with no sound to match. Radar or the periscope identifies it.' : 'Nothing in the book fits.'}</td></tr>`);
    this.detail(c, this.pick);
  }

  /** The recognition-book page for one class. */
  private detail(c: Contact | null, key: string | null) {
    const accept = $('clsAccept') as HTMLButtonElement;
    const sigKey = c?.sig ? c.sig.lines.map((l) => l.hz.toFixed(0)).join() + (c.sig.prop?.shaftHz.toFixed(1) ?? '') : '';
    const stamp = `${key}|${c?.id}|${c?.classified}|${sigKey}`;
    if (stamp === this.drawn) return;
    this.drawn = stamp;
    const pic = $('clsPic') as HTMLCanvasElement;
    const sig = $('clsSig') as HTMLCanvasElement;
    if (!key) {
      setText($('clsName'), c ? 'No class to show' : 'No contact selected');
      accept.hidden = true;
      pic.getContext('2d')!.clearRect(0, 0, pic.width, pic.height);
      pic.hidden = false; $('clsPhoto').hidden = true;
      this.drawSig(sig, null, c);
      setHTML($('clsFacts'), ''); setText($('clsNotes'), '');
      return;
    }
    const k = CLASSES[key];
    const ref = REFERENCE[key];
    setHTML($('clsName'), `${esc(k.name)} <small>${esc(k.type)}, ${NATION[k.nation]}${isFriendlyClass(key) ? ', friendly' : ''}</small>`);
    accept.hidden = !c || c.classified === key;
    accept.textContent = c?.classified ? 'Reclassify as this' : 'Accept match';
    drawClassPicture(pic, key);
    const photo = ref?.photo;
    pic.hidden = !!photo;
    $('clsPhoto').hidden = !photo;
    if (photo) {
      const img = $('clsImg') as HTMLImageElement;
      img.src = `${import.meta.env.BASE_URL}ships/${photo.file}`;
      img.alt = `Photo of ${k.name}`;
      setText($('clsCredit'), photo.credit);
    }
    this.drawSig(sig, key, c);
    setText($('clsSigLabel'), !k.tonals.length ? 'Reference signature · none, silent to sonar'
      : `Reference signature · amber ticks are ${c ? `${c.name}'s` : 'the contact\'s'} lines`);
    const facts: [string, string][] = [['Max speed', `${k.maxSpd} kt`]];
    if (c?.sig?.prop && k.shaftHzPerKt) facts.push(['Speed by turn count', `${(c.sig.prop.shaftHz / k.shaftHzPerKt).toFixed(0)} kt if this class`]);
    if (ref) facts.push(['Displacement', ref.displacement], ['Armament', ref.armament.join('<br>')], ['Armor', ref.armor]);
    if (k.blades) facts.push(['Propeller', `${k.blades} blades`]);
    setHTML($('clsFacts'), facts.map(([a, b]) => `<dt>${a}</dt><dd>${b.split('<br>').map(esc).join('<br>')}</dd>`).join(''));
    setText($('clsNotes'), ref?.notes ?? '');
  }

  /** Reference narrowband picture: the class's tonals strongest first, its blade line at the contact's measured shaft rate (or 10 kt), and the contact's own lines as ticks along the top for comparison. */
  private drawSig(cv: HTMLCanvasElement, key: string | null, c: Contact | null) {
    const x = cv.getContext('2d')!;
    const { width: w, height: h } = cv;
    x.fillStyle = '#020a12';
    x.fillRect(0, 0, w, h);
    // Fixed-seed speckle so the picture is steady between redraws.
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const img = x.getImageData(0, 0, w, h);
    const k = key ? CLASSES[key] : null;
    const lines: { hz: number; level: number }[] = [];
    if (k) {
      k.tonals.forEach((hz, i) => lines.push({ hz, level: Math.max(0.35, 1 - i * 0.15) }));
      if (k.blades && k.shaftHzPerKt) {
        const shaft = c?.sig?.prop ? c.sig.prop.shaftHz : k.shaftHzPerKt * 10;
        lines.push({ hz: k.blades * shaft, level: 0.55 });
      }
    }
    const top = 10;
    for (let yy = top; yy < h; yy++) {
      for (let i = 0; i < w; i++) {
        let v = 0.08 + rnd() * 0.12;
        for (const l of lines) {
          const lx = (l.hz / MAX_HZ) * w;
          v += l.level * (0.8 + rnd() * 0.25) * Math.exp(-((i - lx) ** 2) / 2.2);
        }
        v = Math.min(1, v);
        const o = (yy * w + i) * 4;
        img.data[o] = Math.round(20 + 220 * v ** 1.6);
        img.data[o + 1] = Math.round(30 + 225 * v);
        img.data[o + 2] = Math.round(34 + 160 * v ** 1.3);
        img.data[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    if (k && !k.tonals.length) {
      x.fillStyle = '#8aa3b8'; x.font = '13px "IBM Plex Mono", monospace'; x.textAlign = 'center';
      x.fillText('No acoustic signature', w / 2, h / 2 + 6);
    }
    // The contact's own lines, as amber ticks across the top strip.
    x.fillStyle = '#f3b04b';
    for (const l of c?.sig?.lines ?? []) x.fillRect(Math.round((l.hz / MAX_HZ) * w) - 1, 0, 3, top - 2);
  }
}
