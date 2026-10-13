// Ship status, contact list, identification and weapons readouts, plus the log.
import { ARRAY, DEPTH_FT, arrayActive, bearingRate, contactById, contactLabel, isFriendlyClass, missileDepthOk, vesselSL, type Game, type GameEvent } from '../sim/sim';
import { CLASSES } from '../sim/classes';
import { angDiff, dist, fmtBrg, fmtRng } from '../sim/math';

const $ = (id: string) => document.getElementById(id)!;
const setText = (id: string, v: string) => { const el = $(id); if (el.textContent !== v) el.textContent = v; };
const setHTML = (el: HTMLElement, v: string) => { if (el.dataset.html !== v) { el.dataset.html = v; el.innerHTML = v; } };
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export function clock(t: number) {
  const h = Math.floor(t / 3600) % 24, m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function addLog(g: Game, ev: GameEvent) {
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = clock(g.startClock + ev.t);
  const span = document.createElement('span');
  span.className = ev.kind;
  span.textContent = ev.text;
  li.append(time, span);
  const list = $('log');
  list.prepend(li);
  while (list.children.length > 80) list.lastChild!.remove();
}

function contactsHTML(g: Game) {
  const rows = g.contacts.filter((c) => c.ever).map((c) => {
    const v = g.vessels.find((x) => x.id === c.vid)!;
    const cls = [c.id === g.selected ? 'sel' : '', isFriendlyClass(c.classified) ? 'friend' : '', !v.alive ? 'sunk' : !c.held ? 'lost' : ''].join(' ');
    const status = !v.alive ? 'sunk' : !c.held ? 'lost' : `${Math.round(c.q * 100)}%`;
    const rng = c.est && v.alive ? fmtRng(dist(g.own, c.est)) : '';
    return `<li class="${cls}" data-id="${c.id}"><span class="nm">${esc(contactLabel(c))}</span>`
      + `<span class="num">${c.bearing === null ? '—' : fmtBrg(c.bearing) + '°'} ${rng}</span><span class="num">${status}</span></li>`;
  });
  return rows.length ? rows.join('') : '<li class="empty">No contacts yet. Listen.</li>';
}

function identHTML(g: Game) {
  const c = contactById(g, g.selected);
  if (!c) return { prop: 'Select a contact to see its signature.', matches: '' };
  const v = g.vessels.find((x) => x.id === c.vid)!;
  if (!v.alive) return { prop: `${contactLabel(c)} has been sunk.`, matches: '' };
  const sig = c.sig;
  let prop = !c.held ? 'Contact lost. Signature fading.' : !sig || !sig.lines.length ? 'Too faint to show any lines yet.' : `${sig.lines.length - (sig.prop ? 1 : 0)} tonal line${sig.lines.length - (sig.prop ? 1 : 0) === 1 ? '' : 's'}`;
  if (c.held && sig?.prop) prop += ` · ${sig.prop.blades} blades at ${sig.prop.shaftHz.toFixed(1)} Hz shaft`;
  else if (c.held && sig?.lines.length) prop += ' · propeller not resolved';
  if (c.held && sig?.smear) prop += ' · cavitation';
  if (c.held) {
    const rate = bearingRate(c);
    if (rate !== null) prop += ` · drift ${Math.abs(rate) < 0.2 ? 'steady' : `${rate > 0 ? 'right' : 'left'} ${Math.abs(rate).toFixed(1)}°/min`}`;
  }
  const matches = c.matches.slice(0, 3).map((m) => {
    const done = c.classified === m.key;
    return `<li><span>${esc(m.name)}</span><span class="pct">${m.pct}%</span>`
      + (done ? '<span class="done">classified</span>' : `<button data-classify="${m.key}" data-contact="${c.id}">Accept</button>`)
      + `<span class="bar"><i style="width:${m.pct}%"></i></span></li>`;
  }).join('');
  return { prop, matches };
}

export function updatePanel(g: Game) {
  const o = g.own;
  setText('clock', clock(g.startClock + g.t));
  const turning = Math.abs(angDiff(o.ordHdg, o.hdg)) > 1;
  setText('oHdg', `${fmtBrg(o.hdg)}°${turning ? ` → ${fmtBrg(o.ordHdg)}°` : ''}`);
  setText('oSpd', `${o.spd.toFixed(1)} kt${Math.abs(o.ordSpd - o.spd) > 0.3 ? ` → ${o.ordSpd}` : ''}`);
  const ft = Math.round(o.depthT <= 1 ? 60 + o.depthT * 90 : 150 + (o.depthT - 1) * 550);
  setText('oDepth', `${ft} ft${o.depthT < 0.3 ? ', periscope up' : o.depthT > 1.5 ? ', below layer' : ', above layer'}${Math.abs(o.depthT - o.ordDepth) > 0.05 ? ` → ${DEPTH_FT[o.ordDepth]}` : ''}`);
  const sl = vesselSL(o) - o.cls.slBase;
  setText('oNoise', sl < 10 ? 'quiet' : sl < 20 ? 'moderate' : sl < 35 ? 'loud' : 'very loud');
  setText('oArray', arrayActive(g) ? 'tracking' : o.spd > ARRAY.maxSpd ? 'flow noise, too fast' : `settling ${Math.ceil(o.arrayStableAt - g.t)}s`);

  setHTML($('contacts'), contactsHTML(g));
  const id = identHTML(g);
  setText('prop', id.prop);
  setHTML($('matches'), id.matches);
  const sel = contactById(g, g.selected);
  setText('sigLabel', sel ? `Signature · ${sel.name}` : 'Signature · no contact selected');

  const ready = (bank: number[]) => bank.filter((x) => x <= 0).length;
  const next = (bank: number[]) => { const l = bank.filter((x) => x > 0); return l.length ? ` · next ${Math.ceil(Math.min(...l))}s` : ''; };
  setText('wTubes', `${ready(o.tubes)} of ${o.tubes.length} ready${next(o.tubes)}`);
  setText('wVls', `${ready(o.vls)} of ${o.vls.length} ready${next(o.vls)}`);
  setText('wDecoys', String(o.decoys));
  const over = !!g.over, depthOk = missileDepthOk(g), hasTarget = !!sel?.est || g.contacts.some((c) => c.held && c.est);
  ($('fireMk48') as HTMLButtonElement).disabled = over || !ready(o.tubes);
  ($('fireHarpoon') as HTMLButtonElement).disabled = over || !ready(o.tubes) || !depthOk || !hasTarget;
  ($('fireMst') as HTMLButtonElement).disabled = over || !ready(o.vls) || !depthOk || !hasTarget;
  ($('decoy') as HTMLButtonElement).disabled = o.decoys <= 0 || over;
  const target = sel?.est ? `Target: ${contactLabel(sel)}${isFriendlyClass(sel.classified) ? ' (friendly!)' : ''}` : 'No target selected';
  setText('wNote', depthOk ? target : `${target} · missiles need 150 ft or shallower`);
}

export const classNameOf = (key: string) => CLASSES[key].name;
