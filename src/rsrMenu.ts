// The Red Storm Rising tab: the setup screen, the war for the Norwegian Sea, the battle sims, and the
// screens between missions (efficiency rating, medals, rank) and at the end of the war.
import { MISSIONS } from './sim/missions';
import { WEAPONS, boatName, type Game } from './sim/sim';
import { CLASSES } from './sim/classes';
import { mulberry32 } from './sim/math';
import { HULLS, LEVELS, YEARS, FORCES, FORCE_PLACES, hullFor, hullOK, parseKey, rsrKey, type Force, type Hull } from './sim/rsr';
import {
  BAND_TEXT, CAP, ENDINGS, GAUGE_MAX, GAUGE_MIN, MEDALS, RANKS, RANK_ER, bandOf, careerER, medalFor, medals, missionER, missionNo, newsCard, rankFor, resolve, tally,
  type RsrState, type Tally,
} from './sim/rsr/campaign';
import { currentRsr, endRsr, lastPick, saveRsr, savePick, startRsr, type Pick } from './rsrSave';
import type { Year } from './sim/boats';

const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

export type RsrPlay = 'war' | 'sim';
export interface RsrHost {
  /** The mode tabs, already wired by main. */ modes: string; wireModes: () => void;
  start: (key: string, play: RsrPlay) => void; replay: () => void; done: () => void;
}
let view: 'war' | 'sims' = 'war';

// ---- Pickers: boat, year, challenge -----------------------------------------------------------
const BOAT_BLURB: Record<Hull, string> = {
  tang: 'Tang as she came back from 1945: the 2029 kit, quiet as a hole in the water. Counts for least.',
  permit: 'The oldest and loudest: four tubes, slow old Mk 48s and SUBROC. Counts for most.',
  sturgeon: 'Four tubes, Harpoon and SUBROC; a fine under-ice boat. Tomahawks from 1988.',
  la688: 'Fast and quieter: four tubes, Harpoon, Tomahawk from 1988 and Sea Lance from 1992.',
  la688i: 'The Improved Los Angeles: twelve vertical Tomahawk tubes and the mast Stinger from 1992.',
  seawolf: 'Eight tubes, swims her weapons out quietly. Only in 1996. Counts for less.',
};
function pickersHTML(p: Pick) {
  const boats = HULLS.map((h) => {
    const b = hullFor(h, p.year), ok = hullOK(h, p.year);
    return `<button class="boat ${h === p.boat ? 'on' : ''}" data-boat="${h}" ${ok ? '' : 'disabled'}>
      <b>${esc(b.name)}</b><small>${esc(CLASSES[b.cls].name)} · ${b.tubes} tubes${b.vls ? ` · ${b.vls} VLS` : ''} · ER ×${b.er}</small>
      <span>${ok ? esc(BOAT_BLURB[h]) : 'Not in service this year.'}</span></button>`;
  }).join('');
  return `<div class="rsr-pick">
    <div class="wlabel">Year</div><div class="row seg">${YEARS.map((y) => `<button data-year="${y}" class="${y === p.year ? 'on' : ''}">${y}</button>`).join('')}</div>
    <div class="wlabel">Boat</div><div class="boats">${boats}</div>
    <div class="wlabel">Challenge</div><div class="row seg">${LEVELS.map((l, i) => `<button data-level="${i}" class="${i === p.level ? 'on' : ''}" title="${esc(l.note)}">${esc(l.name)}</button>`).join('')}</div>
    <p class="fx">${esc(LEVELS[p.level].note)} ER ×${LEVELS[p.level].er}.</p>
  </div>`;
}
function wirePickers(p: Pick, redraw: () => void) {
  const brief = $('brief');
  for (const b of brief.querySelectorAll<HTMLButtonElement>('[data-year]')) b.addEventListener('click', () => {
    p.year = Number(b.dataset.year) as Year;
    if (!hullOK(p.boat, p.year)) p.boat = 'la688';
    savePick(p); redraw();
  });
  for (const b of brief.querySelectorAll<HTMLButtonElement>('[data-boat]')) b.addEventListener('click', () => { p.boat = b.dataset.boat as Hull; savePick(p); redraw(); });
  for (const b of brief.querySelectorAll<HTMLButtonElement>('[data-level]')) b.addEventListener('click', () => { p.level = Number(b.dataset.level); savePick(p); redraw(); });
}
const twoClick = (b: HTMLButtonElement, ask: string, fn: () => void) => b.addEventListener('click', () => {
  if (!b.classList.contains('confirm')) {
    const was = b.textContent;
    b.classList.add('confirm'); b.textContent = ask;
    setTimeout(() => { b.classList.remove('confirm'); b.textContent = was; }, 4000);
    return;
  }
  fn();
});
const show = (host: RsrHost, cls: string, html: string) => {
  const brief = $('brief');
  brief.className = `brief war rsr ${cls}`;
  brief.innerHTML = host.modes + html;
  host.wireModes();
  host.done();
};

// ---- The screens ----------------------------------------------------------------------------
export function showRsr(host: RsrHost) {
  if (view === 'sims') return showSims(host);
  const s = currentRsr();
  if (!s) return showSetup(host);
  return s.ending ? showEnd(host, s) : showWar(host, s);
}

function showSetup(host: RsrHost) {
  const p = lastPick();
  show(host, 'setup', `
    <div class="camp-head"><div><h2>Red Storm Rising</h2><p class="sub">The war for the Norwegian Sea · 1984 to 1996</p></div>
      <button id="toSims" class="restart">Battle sims</button></div>
    <p>The Warsaw Pact has gone to war with NATO, and the Northern Fleet is coming out of the Kola Inlet to cut Europe off from America. You command an American attack submarine in the Norwegian Sea. Each mission sends you after one Soviet force; how you do, and the news from the rest of the war, moves the fight for the sea one way or the other. The war ends when one side holds the whole sea, or in a ceasefire after ${CAP} missions.</p>
    ${pickersHTML(p)}
    <div class="row"><button id="rsrStart" class="primary">Take command</button></div>`);
  wirePickers(p, () => showSetup(host));
  $('rsrStart').addEventListener('click', () => { startRsr(p); showRsr(host); });
  $('toSims').addEventListener('click', () => { view = 'sims'; showRsr(host); });
}

/** The gauge: Pact at the left, NATO at the right, a cell for every step. */
function gaugeHTML(g: number) {
  const cells = [];
  for (let n = GAUGE_MIN; n <= GAUGE_MAX; n++) cells.push(`<i class="${n === 0 ? 'mid ' : ''}${g < 0 && n >= g && n < 0 ? 'neg' : g > 0 && n <= g && n > 0 ? 'pos' : ''}${n === g ? ' at' : ''}"></i>`);
  return `<div class="gauge"><div class="gauge-ends"><span class="no">Warsaw Pact holds the sea</span><span class="gv">${g > 0 ? '+' : ''}${g}</span><span class="ok">NATO holds the sea</span></div>
    <div class="gauge-bar">${cells.join('')}</div><p class="fx">${esc(BAND_TEXT[bandOf(g)])}</p></div>`;
}
function careerHTML(s: RsrState) {
  const er = careerER(s), rank = rankFor(er), next = RANKS.indexOf(rank) + 1;
  const counts = MEDALS.map((m) => [m, medals(s).filter((x) => x === m).length] as const).filter(([, n]) => n);
  return `<div class="career"><div><span class="wlabel">Rank</span><b>${esc(rank)}</b>${next < RANKS.length ? `<small>${RANK_ER[next] - er} ER to ${esc(RANKS[next])}</small>` : ''}</div>
    <div><span class="wlabel">Career ER</span><b>${er}</b><small>${esc(boatLine(s))}</small></div>
    <div class="medals"><span class="wlabel">Decorations</span>${counts.length ? counts.map(([m, n]) => `<span class="medal m${MEDALS.indexOf(m)}">${esc(m)}${n > 1 ? ` ×${n}` : ''}</span>`).join('') : '<small>None yet.</small>'}</div></div>`;
}
const boatLine = (s: RsrState) => `${hullFor(s.boat, s.year).name} · ${s.year} · ${LEVELS[s.level].name}`;
const titleOf = (key: string) => MISSIONS[key]?.title ?? key;

function showWar(host: RsrHost, s: RsrState) {
  const n = missionNo(s), last = s.history.at(-1), card = last ? newsCard(last.news) : undefined;
  const rows = s.history.map((h, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(titleOf(h.key))}<small>${esc(MISSIONS[h.key]?.place ?? '')} · ER ${h.er}${h.medal ? ` · ${esc(h.medal)}` : ''}</small></span>${h.win ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'}</li>`);
  rows.push(`<li class="sel"><span class="n">${n}</span><span class="t">${s.offer.map((k) => esc(titleOf(k))).join(' or ')}<small>Now</small></span></li>`);
  show(host, '', `
    <div class="camp-head"><div><h2>Red Storm Rising</h2><p class="sub">Mission ${n} of up to ${CAP} · ${esc(boatLine(s))}</p></div>
      <div class="row heads"><button id="toSims" class="restart">Battle sims</button><button id="restartRsr" class="restart">Restart war</button></div></div>
    ${gaugeHTML(s.gauge)}
    ${careerHTML(s)}
    <div class="camp">
      <ol class="camp-list war-list" id="campList">${rows.join('')}</ol>
      <div class="camp-detail" id="campDetail">
        ${card ? `<div class="bulletin"><div class="wlabel">News from the front</div><p><b>${esc(card.name)}.</b> ${esc(card.text)}</p></div>`
          : '<div class="bulletin"><div class="wlabel">The first day of the war</div><p>Soviet tanks are across the inner German border and the Northern Fleet is at sea. Your orders are waiting: choose one.</p></div>'}
        <p class="sub">Choose your orders</p>
        <div class="offers">${s.offer.map((k) => offerHTML(k)).join('')}</div>
      </div>
    </div>`);
  $('campList').querySelector('li.sel')?.scrollIntoView({ block: 'nearest' });
  for (const b of $('brief').querySelectorAll<HTMLButtonElement>('[data-begin]')) b.addEventListener('click', () => host.start(b.dataset.begin!, 'war'));
  $('toSims').addEventListener('click', () => { view = 'sims'; showRsr(host); });
  twoClick($('restartRsr') as HTMLButtonElement, 'Throw this war away? Click again', () => { endRsr(); showRsr(host); });
}
function offerHTML(key: string) {
  const m = MISSIONS[key];
  return `<div class="war-mission"><p class="sub">${esc(m.place)} · ${esc(m.date)}</p><h3>${esc(m.title)}</h3>
    <p class="war-brief">${esc(m.brief)}</p><button data-begin="${esc(key)}">Take these orders</button></div>`;
}

function showEnd(host: RsrHost, s: RsrState) {
  const [head, text] = ENDINGS[s.ending!];
  const won = s.history.filter((h) => h.win).length;
  show(host, s.ending === 'nato' ? 'win' : s.ending === 'pact' ? 'loss' : '', `
    <div class="camp-head"><div><h2>${esc(head)}</h2><p class="sub">The war is over · ${s.history.length} missions, ${won} won · ${esc(boatLine(s))}</p></div></div>
    ${gaugeHTML(s.gauge)}
    <p>${esc(text)}</p>
    <p>You end the war as <b>${esc(rankFor(careerER(s)))}</b>, with a career efficiency rating of <b>${careerER(s)}</b>.</p>
    ${careerHTML(s)}
    <div class="row"><button id="rsrNew" class="primary">New war</button><button id="toSims">Battle sims</button></div>`);
  $('rsrNew').addEventListener('click', () => { endRsr(); showRsr(host); });
  $('toSims').addEventListener('click', () => { view = 'sims'; showRsr(host); });
}

// ---- Battle sims ------------------------------------------------------------------------------
const SIMS: [Force | 'chance', string, string][] = [
  ['november', 'Training: Open Sea', 'A November in open water, the loudest boat the Soviets have. Hits on you do no harm.'],
  ['kashin', 'Training: The Kashin', 'A Kashin destroyer hunting you with her hull sonar; in the ice at Serious and Ultimate. Hits do no harm.'],
  ['duel', 'A Duel', 'One on one with a Soviet attack boat of the year.'],
  ['cms', 'The Cruise Missile Sub', 'Stop a cruise missile boat before she gets in range of a NATO carrier group.'],
  ['wolfpack', 'The Wolfpack', 'A pack of Soviet boats heading for a convoy behind you.'],
  ['bastion', 'The Boomer Bastion', 'A ballistic missile boat creeping round her bastion, with a guard.'],
  ['sag', 'A Strike Group', 'A Kirov or Slava surface action group.'],
  ['asw', 'An ASW Group', 'A hunting group that is looking for you.'],
  ['cvbg', 'A Carrier Task Force', 'Kiev, or Kuznetsov from 1992, and her screen.'],
  ['chance', 'Chance Engagement', 'Any of the campaign\'s forces, anywhere in the Norwegian Sea.'],
];
function simKey(f: Force | 'chance', p: Pick) {
  const r = mulberry32((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0);
  const tlam = hullFor(p.boat, p.year).kit.tlam;
  const any = FORCES.filter((x) => x !== 'airbase' || tlam);
  const force = f === 'chance' ? any[Math.floor(r() * any.length)] : f;
  const places = FORCE_PLACES[force];
  return rsrKey({ force, place: places[Math.floor(r() * places.length)], year: p.year, boat: p.boat, level: p.level, variant: Math.floor(r() * 1e6), sim: true });
}
function showSims(host: RsrHost) {
  const p = lastPick();
  show(host, 'sims', `
    <div class="camp-head"><div><h2>Battle sims</h2><p class="sub">Red Storm Rising · single fights that don't count toward the war</p></div>
      <button id="toWar" class="restart">Back to the war</button></div>
    ${pickersHTML(p)}
    <ol class="sims">${SIMS.map(([f, name, blurb]) => `<li><button data-sim="${f}"><b>${esc(name)}</b><small>${esc(blurb)}</small></button></li>`).join('')}</ol>`);
  wirePickers(p, () => showSims(host));
  for (const b of $('brief').querySelectorAll<HTMLButtonElement>('[data-sim]')) b.addEventListener('click', () => host.start(simKey(b.dataset.sim as Force | 'chance', p), 'sim'));
  $('toWar').addEventListener('click', () => { view = 'war'; showRsr(host); });
}

// ---- Between missions -----------------------------------------------------------------------
/** The result of an RSR mission or sim. Nothing counts toward the war until the player continues, so a mission can be replayed first. */
export function showRsrResult(host: RsrHost, g: Game, key: string, play: RsrPlay) {
  const o = g.over!, t: Tally = tally(g), k = parseKey(key)!;
  const er = missionER(t, k.boat, k.year, k.level), medal = medalFor(er, t.win);
  const s = currentRsr();
  const counts = play === 'war' && !!s && s.offer.includes(key);
  const fired = Object.entries(g.stats.fired).filter(([, n]) => n > 0).map(([w, n]) => `${n} ${WEAPONS[w as keyof typeof WEAPONS].short}`).join(', ') || 'no weapons';
  const sunk = g.sunk.filter((x) => x.side === 'enemy' && CLASSES[x.cls].kind !== 'air').map((x) => x.name);
  const before = s ? careerER(s) : 0, promoted = counts && rankFor(before + er) !== rankFor(before) ? rankFor(before + er) : null;
  const b = hullFor(k.boat, k.year);
  $('brief').className = `brief rsr ${o.win ? 'win' : 'loss'}`;
  $('brief').innerHTML = `
    <h2>${o.win ? 'Mission accomplished' : t.lost ? `${esc(boatName(g))} is lost` : 'Mission failed'}</h2>
    <p class="sub">${esc(MISSIONS[key].title)} · ${Math.round(o.t / 60)} min · ${fired} fired · ${g.stats.hits} hits${play === 'sim' ? ' · battle sim' : ''}</p>
    <p>${esc(o.reason)}${o.after ? ` Afterwards: ${esc(o.after)}` : ''}${sunk.length ? ` Sunk: ${esc(sunk.join(', '))}.` : ''} The plot now shows where every ship really was.</p>
    <div class="er"><div><span class="wlabel">Efficiency rating</span><b>${er}</b><small>${esc(b.name)} ×${b.er} · ${esc(LEVELS[k.level].name)} ×${LEVELS[k.level].er}</small></div>
      ${medal ? `<div><span class="wlabel">${counts ? 'Awarded' : 'Would earn'}</span><span class="medal m${MEDALS.indexOf(medal)}">${esc(medal)}</span></div>` : ''}
      ${promoted ? `<div><span class="wlabel">Promoted</span><b>${esc(promoted)}</b></div>` : ''}</div>
    ${t.lost && play === 'war' ? '<p>The war can\'t go on without your boat. Replay the mission.</p>' : ''}
    ${counts && !t.lost ? `<p class="fx">If you continue: ${o.win ? '<span class="ok">won</span>, NATO gains ground in the Norwegian Sea' : '<span class="no">lost</span>, the Pact gains ground'}, and the news from the front comes in.</p>` : ''}
    <div class="row">${counts && !t.lost ? '<button id="next" class="primary">Continue the war</button>' : ''}<button id="again">${play === 'sim' ? 'Fight it again' : 'Replay mission'}</button><button id="watch">Watch replay</button>${play === 'sim' ? '<button id="back">Battle sims</button>' : ''}</div>`;
  $('next')?.addEventListener('click', () => { resolve(s!, key, t); saveRsr(); view = 'war'; showRsr(host); });
  $('again').addEventListener('click', () => host.start(key, play));
  $('watch').addEventListener('click', host.replay);
  $('back')?.addEventListener('click', () => { view = 'sims'; showRsr(host); });
  host.done();
}
