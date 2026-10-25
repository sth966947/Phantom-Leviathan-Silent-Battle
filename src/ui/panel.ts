// Ship status, contact list, identification and weapons readouts, plus the log.
import { ARRAY, finished, DRONE_LINK, depthFeet, JATM_PER_CANISTER, WEAPONS, arrayActive, atPeriscopeDepth, bankFor, bearingRate, blackwingLink, contactById, contactLabel, isFriendlyClass, missileDepthOk, inPeriscope, radarTracked, slotWeapon, targetContact, vesselSL, type FireKey, type Game, type GameEvent, type WeaponKey } from '../sim/sim';
import { TANG } from '../sim/boats';
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
    const status = !v.alive ? (c.air ? 'down' : 'sunk') : !c.held ? 'lost' : c.air ? (radarTracked(g, c) ? 'radar' : c.est ? 'seen' : 'ESM') : `${Math.round(c.q * 100)}%`;
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
  if (!v.alive) return { prop: `${contactLabel(c)} has been ${c.air ? 'shot down' : 'sunk'}.`, matches: '' };
  if (c.air && !c.sig) {
    const how = !c.held ? 'Air contact lost.' : radarTracked(g, c) ? 'Air contact · radar track.' : c.est ? 'Air contact · rough position.' : 'Air contact · bearing only.';
    const prop = `${how} JATM or SM-6 will fly down bearing ${c.bearing === null ? '—' : fmtBrg(c.bearing)}°.`;
    const m = c.classified ? `<li><span>${esc(contactLabel(c).split(' · ')[1])}</span><span class="pct">100%</span><span class="done">classified</span><span class="bar"><i style="width:100%"></i></span></li>` : '';
    return { prop, matches: m };
  }
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

// ---- The boat's own weapons ----------------------------------------------------------------------
/** What a 1980s boat's weapon is called on its button, with what the hover text says. */
const OLD: Partial<Record<WeaponKey, [string, string]>> = {
  mk48old: ['Mk 48', 'Mk 48 Mod 4, wire-guided heavyweight torpedo, 19 nm. Blown out of the tube by an impulse, so the launch can be heard. Ships and submarines.'],
  harpoon: ['Harpoon', 'UGM-84 Harpoon in a capsule from a torpedo tube, out to 65 nm. Sea-skimming, active radar seeker. Surface ships only, 150 ft or shallower.'],
  tasm: ['Tomahawk anti-ship', 'Tomahawk anti-ship (TASM), out to 250 nm. No updates in flight: it flies to where the target was and searches there. Surface ships only, 150 ft or shallower.'],
  subroc: ['SUBROC', 'UUM-44 SUBROC: a rocket out of a torpedo tube to the solution 5 to 30 nm out, where its depth bomb goes off. Hurts any submarine within 0.7 nm of it.'],
  sealance: ['Sea Lance', 'UUM-125 Sea Lance: a rocket out of a torpedo tube to the solution 3 to 35 nm out, where it drops a Mk 50 torpedo.'],
  stinger: ['Stinger', 'Stinger from the mast launcher at periscope depth: helicopters and low patrol planes within 4 nm. Down the selected air contact\'s bearing. Takes no tube.'],
};
const SLOTS: [string, FireKey][] = [['fireMk48', 'mk48'], ['fireNsm', 'nsm'], ['fireMst', 'mst'], ['fireAsroc', 'asroc'], ['fireJatm', 'jatm'], ['fireSm6', 'sm6'], ['fireMk96', 'mk96'], ['fireMjolnir', 'mjolnir']];
/**
 * Set the boat's name and weapon buttons for the mission: Tang shows all her 2029 kit; a 1980s boat's
 * buttons carry its own weapons, and whatever it lacks (the experimental tab, the drones) is hidden.
 */
export function loadout(g: Game) {
  const k = g.own.kit, tang = k === TANG.kit;
  setText('ownTitle', `Own ship · ${g.own.name}`);
  for (const [id, slot] of SLOTS) {
    const b = $(id) as HTMLButtonElement;
    b.dataset.html ??= b.innerHTML; b.dataset.title ??= b.title;
    const w = slotWeapon(g, slot), old = w ? OLD[w] : undefined;
    b.hidden = !w;
    b.innerHTML = old ? `${old[0]} ${b.dataset.html.replace(/^[^<]*/, '')}` : b.dataset.html;
    b.title = old ? old[1] : b.dataset.title;
  }
  $('tabExp').hidden = !(k.mk96 || k.mjolnir);
  $('fireTlam').hidden = !k.tlam;
  $('wVls').hidden = ($('wVls').previousElementSibling as HTMLElement).hidden = !g.own.vls.length;
  $('wJatm').hidden = ($('wJatm').previousElementSibling as HTMLElement).hidden = k.jatm !== 'jatm';
  (document.querySelector('.card.drone') as HTMLElement).hidden = !tang && !k.drones && !k.blackwings;
  // Vertical-tube weapons go out of the torpedo tubes on a boat that has none.
  for (const el of document.querySelectorAll<HTMLElement>('#paneStd .wlabel')) {
    el.dataset.text ??= el.textContent!;
    el.textContent = !tang && el.dataset.text.startsWith('Vertical') ? (g.own.vls.length ? 'Vertical or torpedo tubes · 150 ft or shallower' : 'Torpedo tubes · missiles 150 ft or shallower') : el.dataset.text;
  }
}

export function updatePanel(g: Game, steerId: number | null = null) {
  const o = g.own;
  setText('clock', clock(g.startClock + g.t));
  setText('mtime', `+${Math.floor(g.t / 3600)}:${String(Math.floor((g.t % 3600) / 60)).padStart(2, '0')}`);
  const turning = Math.abs(angDiff(o.ordHdg, o.hdg)) > 1;
  setText('oHdg', `${fmtBrg(o.hdg)}°${turning ? ` → ${fmtBrg(o.ordHdg)}°` : ''}`);
  setText('oSpd', `${o.spd.toFixed(1)} kt${Math.abs(o.ordSpd - o.spd) > 0.3 ? ` → ${o.ordSpd}` : ''}`);
  const ft = Math.round(o.depthT <= 1 ? 60 + o.depthT * 90 : 150 + (o.depthT - 1) * 550);
  setText('oDepth', `${ft} ft${o.depthT < 0.3 ? ', periscope up' : o.depthT > 1.5 ? ', below layer' : ', above layer'}${Math.abs(o.depthT - o.ordDepth) > 0.05 ? ` → ${Math.round(depthFeet(o.ordDepth))} ft` : ''}`);
  const sl = vesselSL(o) - o.cls.slBase;
  setText('oNoise', sl < 10 ? 'quiet' : sl < 20 ? 'moderate' : sl < 35 ? 'loud' : 'very loud');
  setText('oArray', `${o.radar ? 'radar transmitting' : arrayActive(g) ? 'tracking' : o.spd > ARRAY.maxSpd ? 'flow noise, too fast' : `settling ${Math.ceil(o.arrayStableAt - g.t)}s`}${o.arraySide === 'with' || o.radar ? '' : `, ${o.arraySide} layer`}`);

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
  setText('wTubesX', $('wTubes').textContent!);
  setText('wVlsX', $('wVls').textContent!);
  setText('wDecoys', o.kit.jatm === 'stinger' ? `${o.decoys} · Stingers ${o.stingers}` : String(o.decoys));
  const up = g.uavs.filter((u) => g.t >= u.airAt);
  setText('wBlackwing', `${o.blackwings} aboard${g.uavs.length ? ` · ${up.length ? `${up.length} up` : 'rising'}${up.length ? `, ${Math.ceil(Math.min(...up.map((u) => u.life)) / 60)} min` : ''}` : ''}`);
  // The drone the buttons act on: the one being steered, else the newest.
  const bw = g.uavs.find((u) => u.id === steerId) ?? g.uavs[g.uavs.length - 1];
  const reach = blackwingLink(g);
  setText('bwLink', !reach ? 'none below 150 ft' : `${reach} nm${bw ? ` · #${bw.n} ${dist(o, bw) <= reach ? fmtRng(dist(o, bw)) : 'out of range'}` : ''}`);
  setText('bwMode', bw ? `#${bw.n} ${bw.mode === 'jam' ? 'jamming radar' : 'radar search'}` : '—');
  const dr = g.drones.find((d) => d.id === steerId) ?? g.drones[g.drones.length - 1];
  setText('wDrones', `${o.drones} aboard${g.drones.length ? ` · ${g.drones.length} out` : ''}${o.droneQueue ? ` · ${o.droneQueue} queued` : ''}`);
  const quarry = dr?.target != null ? contactById(g, dr.target) : null;
  setText('uuvLink', dr ? `#${dr.n} ${dist(o, dr) <= DRONE_LINK ? fmtRng(dist(o, dr)) : 'out of range'} · ${dr.home ? 'coming home' : quarry ? `shadowing ${contactLabel(quarry)}` : dr.mode}` : `${DRONE_LINK} nm`);
  setText('wJatm', o.jatm ? `${o.jatm} of ${JATM_PER_CANISTER} left` : `fresh, ${JATM_PER_CANISTER} rounds`);
  const over = finished(g), depthOk = missileDepthOk(g);
  const ship = targetContact(g, false), air = targetContact(g, true);
  // Each button's own weapon on this boat, and the tubes it goes out of.
  const bank = (slot: FireKey) => { const w = slotWeapon(g, slot); return w ? bankFor(o, w) : o.vls; };
  const asw = WEAPONS[slotWeapon(g, 'asroc') ?? 'asroc'];
  const asrocRange = ship?.est ? (() => { const r = dist(o, ship.est!); return r >= asw.minRun! && r <= asw.maxRun; })() : false;
  const dis = (id: string, off: boolean) => { ($(id) as HTMLButtonElement).disabled = over || off; };
  dis('fireMk48', !ready(o.tubes));
  dis('fireNsm', !ready(o.tubes) || !depthOk || !ship);
  dis('fireMst', !ready(bank('mst')) || !depthOk || !ship);
  dis('fireAsroc', !ready(bank('asroc')) || !depthOk || !asrocRange);
  dis('fireJatm', o.kit.jatm === 'stinger' ? !o.stingers || !atPeriscopeDepth(g) : (!o.jatm && !ready(o.vls)) || !depthOk);
  dis('fireSm6', !ready(o.vls) || !depthOk);
  dis('fireMk96', !ready(o.tubes));
  const mjRange = ship?.est ? (() => { const r = dist(o, ship.est!); return r >= WEAPONS.mjolnir.minRun! && r <= WEAPONS.mjolnir.maxRun; })() : false;
  dis('fireMjolnir', !ready(o.vls) || !depthOk || !mjRange);
  dis('launchDrone', o.drones - o.droneQueue <= 0);
  for (const [id, m] of [['dronePassive', 'passive'], ['droneActive', 'active'], ['droneDecoy', 'decoy']] as const) {
    dis(id, !dr);
    $(id).classList.toggle('on', dr?.mode === m);
  }
  dis('fireTlam', !ready(bankFor(o, 'tlam')) || !depthOk || !g.sites.length);
  const mjSite = g.sites.find((x) => x.id === Number(($('mjSite') as HTMLSelectElement).value));
  dis('fireMjLand', !ready(o.vls) || !depthOk || !mjSite || dist(o, mjSite) < WEAPONS.mjolnir.minRun! || dist(o, mjSite) > WEAPONS.mjolnir.maxRun);
  dis('blackwing', !o.blackwings);
  dis('blackwingTo', !g.uavs.length || !sel || sel.air);
  dis('blackwingCtl', !g.uavs.length);
  dis('uuvCtl', !g.drones.length);
  dis('uuvFollow', !g.drones.length || !sel?.est || sel.air);
  dis('uuvHome', !dr || !!dr.home);
  for (const [id, m] of [['bwSearch', 'search'], ['bwJam', 'jam']] as const) {
    dis(id, !bw);
    $(id).classList.toggle('on', bw?.mode === m);
  }
  dis('layMine', !ready(o.tubes) || !g.flags.minesAboard || o.spd > 12);
  dis('radar', !o.radar && !atPeriscopeDepth(g));
  dis('scopeBtn', !inPeriscope(g, sel));
  $('radar').classList.toggle('on-air', o.radar);
  setHTML($('radar'), `${o.radar ? 'Radar on' : 'Radar'} <kbd>R</kbd>`);
  setText('sRadar', o.radar ? 'TRANSMITTING' : atPeriscopeDepth(g) ? 'off · ready' : 'off · needs PD');
  const pick = sel?.air ? air : ship;
  const target = pick?.est ? `Target: ${contactLabel(pick)}${isFriendlyClass(pick.classified) ? ' (friendly!)' : ''}` : 'No target selected';
  setText('wNote', depthOk ? target : `${target} · missiles need 150 ft or shallower`);
}

export const classNameOf = (key: string) => CLASSES[key].name;
