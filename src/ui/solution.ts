// Solution window: the fire-control picture for the selected contact. Broadband
// waterfall and narrowband signature on top, a feed of every contact below, and the
// selected target's details, including the periscope view when it is in sight.
import { CLASSES } from '../sim/classes';
import { bearingRate, contactById, contactLabel, inPeriscope, isFriendlyClass, radarTracked, type Contact, type Game } from '../sim/sim';
import { dist, fmtBrg, fmtRng } from '../sim/math';
import type { Periscope } from './periscope';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const setHTML = (el: HTMLElement, v: string) => { if (el.dataset.html !== v) { el.dataset.html = v; el.innerHTML = v; } };
const setText = (el: HTMLElement, v: string) => { if (el.textContent !== v) el.textContent = v; };

const drift = (c: Contact, short = false) => {
  const r = c.held ? bearingRate(c) : null;
  return r === null ? '—' : Math.abs(r) < 0.2 ? 'steady' : `${r > 0 ? 'R' : 'L'} ${Math.abs(r).toFixed(1)}°${short ? '' : '/min'}`;
};
const props = (c: Contact, short = false) => (c.sig?.prop ? (short ? `${c.sig.prop.blades} bl` : `${c.sig.prop.blades} blades · ${c.sig.prop.shaftHz.toFixed(1)} Hz shaft`) : c.air ? '—' : short ? '?' : 'not resolved');
const shortName = (key: string) => CLASSES[key].name.split(' (')[0];
const best = (c: Contact) => (c.classified ? `${shortName(c.classified)} ✓` : c.matches[0] ? `${shortName(c.matches[0].key)} ${c.matches[0].pct}%` : '—');
const source = (g: Game, c: Contact) => (radarTracked(g, c) ? 'radar' : c.spotted && inPeriscope(g, c) ? 'scope' : c.air && !c.est ? 'brg only' : `${Math.round(c.q * 100)}%`);

export class Solution {
  open = false;
  constructor(private periscope: Periscope, private onSelect: (id: number) => void) {
    $('feed').addEventListener('click', (ev) => {
      const tr = (ev.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
      if (tr) this.onSelect(Number(tr.dataset.id));
    });
    $('solClose').addEventListener('click', () => this.close());
  }
  toggle() { if (this.open) this.close(); else this.show(); }
  show() { this.open = true; $('solution').hidden = false; }
  close() { this.open = false; $('solution').hidden = true; }

  /** Tables and facts; called at panel refresh rate. */
  update(g: Game) {
    if (!this.open) return;
    const sel = contactById(g, g.selected);
    setText($('solTitle'), sel ? `Solution · ${contactLabel(sel)}` : 'Solution · no contact selected');
    const rows = g.contacts.filter((c) => c.ever).map((c) => {
      const v = g.vessels.find((x) => x.id === c.vid)!;
      const cls = [c.id === g.selected ? 'sel' : '', isFriendlyClass(c.classified) ? 'friend' : '', !v.alive ? 'sunk' : !c.held ? 'lost' : ''].join(' ');
      const rng = c.est && v.alive ? fmtRng(dist(g.own, c.est)) : '—';
      return `<tr class="${cls}" data-id="${c.id}"><td>${esc(c.name)}${c.air ? ' ✈' : ''}</td><td>${c.bearing === null ? '—' : fmtBrg(c.bearing)}</td>`
        + `<td>${drift(c, true)}</td><td>${rng}</td><td>${!v.alive ? (c.air ? 'down' : 'sunk') : !c.held ? 'lost' : source(g, c)}</td><td>${props(c, true)}</td><td>${esc(best(c))}</td></tr>`;
    });
    setHTML($('feed'), rows.join('') || '<tr><td colspan="7" class="empty">No contacts yet. Listen.</td></tr>');

    if (!sel) { setHTML($('solFacts'), ''); setText($('solAdvice'), 'Select a contact (Tab, or click a row).'); return; }
    const facts: [string, string][] = [
      ['Bearing', sel.bearing === null ? '—' : `${fmtBrg(sel.bearing)}°`],
      ['Bearing drift', drift(sel)],
      ['Range', sel.est ? `${fmtRng(dist(g.own, sel.est))}${sel.estErr > 0.05 ? ` ± ${fmtRng(sel.estErr)}` : ''}` : 'unknown'],
      ['Solution', source(g, sel)],
    ];
    if (!sel.air || sel.sig) {
      const lines = sel.sig ? sel.sig.lines.length - (sel.sig.prop ? 1 : 0) : 0;
      facts.push(['Tonal lines', String(lines)], ['Propeller', props(sel)]);
      // Turn count: shaft rate over the class's Hz per knot gives the target's speed.
      const k = sel.classified ? CLASSES[sel.classified] : null;
      if (sel.sig?.prop && k?.shaftHzPerKt) facts.push(['Speed by turn count', `${(sel.sig.prop.shaftHz / k.shaftHzPerKt).toFixed(0)} kt`]);
      if (sel.cavitating || sel.sig?.smear) facts.push(['Cavitation', 'yes']);
    }
    facts.push(['Classified', sel.classified ? CLASSES[sel.classified].name : 'not yet']);
    setHTML($('solFacts'), facts.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join(''));
    const advice = !sel.held ? 'Contact lost. Hold course and listen, or come round to put the bearing off your baffles.'
      : sel.air ? 'Air contact. JATM or SM-6 will fly down its bearing.'
        : sel.q < 0.6 ? 'Range is soft. Hold this leg, then turn 40° or more to start a new one; each leg firms it up.'
          : sel.q < 0.9 ? 'Solution is usable. Another leg, a periscope look or a ping will make it firm.'
            : 'Solution is firm. Weapons will fly to it.';
    setText($('solAdvice'), advice);
  }

  /** The live periscope picture; called every frame. */
  draw(g: Game, now: number) {
    if (!this.open) return;
    const sel = contactById(g, g.selected);
    const v = inPeriscope(g, sel);
    $('solEye').hidden = !v;
    if (v) setText($('solScopeRead'), this.periscope.render($('solScope') as HTMLCanvasElement, g, v, now));
  }
}
