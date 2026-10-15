import 'pixi.js/unsafe-eval'; // no eval(), so the game runs under strict content security policies
import './style.css';
import { WEAPONS, arrivingSoon, contactById, create, inPeriscope, orders, tick, type Depth, type Game, type ScenarioKey, type WeaponKey } from './sim/sim';
import { CAMPAIGN, MISSIONS, PREQUELS, objectives, type MissionKey } from './sim/missions';
import { carryFor, changedFor, interlude, record, resetCampaign, results, unlocked } from './campaign';
import { Plot, SPANS } from './render/plot';
import { Waterfall } from './ui/waterfall';
import { SignatureDisplay } from './ui/signature';
import { addLog, updatePanel } from './ui/panel';
import { play, unlockAudio } from './ui/audio';
import { Periscope } from './ui/periscope';
import { Solution } from './ui/solution';
import { DepthView } from './ui/depth';
import { StrikeCam, type Impact } from './ui/strikecam';
import { Player, noteSelection, record as recordOrders, recording } from './replay';
import { FRONTS, FRONT_NAMES, WAR_MAX, WAR_MIN, currentSlot, warLength, newsCard, resolve as resolveWar, warOver, type Ending, type WarState } from './sim/war';
import { WAR_MISSIONS } from './sim/warData';
import { currentWar, playable, restartWar, saveWar } from './warSave';

const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

const SPEEDS: [number, string][] = [[3, 'Creep'], [5, '⅓'], [10, '⅔'], [15, 'Std'], [20, 'Full'], [32, 'Flank']];
const DEPTHS: [number, string][] = [[0, 'Periscope'], [1, '150 ft'], [2, '700 ft']];
const TIMES: [number, string][] = [[0, 'Pause'], [1, '×1'], [10, '×10'], [30, '×30'], [90, '×90']];

let scenario: ScenarioKey = 'bismarck';
let g: Game = create(scenario);
let timeScale = 1;
let resumeScale = 1; // what Pause goes back to
let running = false;
let acc = 0;
let last = performance.now();
let overShown = false;
let replay: Player | null = null;
let liveGame: Game | null = null; // the finished mission, kept while its replay plays
let warMission: string | null = null; // the modern war mission being played, if any
type Mode = 'ww2' | 'war';
let mode: Mode = (() => { try { return localStorage.getItem('phantom-leviathan-mode') === 'war' ? 'war' : 'ww2'; } catch { return 'ww2'; } })();

const plot = new Plot();
const waterfall = new Waterfall($('waterfall') as HTMLCanvasElement);
const signature = new SignatureDisplay($('signature') as HTMLCanvasElement);
const periscope = new Periscope($('scopeView') as HTMLCanvasElement, () => g);
const solution = new Solution(() => g);
const depthView = new DepthView($('depthCanvas') as HTMLCanvasElement, () => g);
const strikeCam = new StrikeCam();
let strikesSeen = 0; // land-attack arrivals already handed to the battle camera
let hitsSeen = 0; // hits on vessels and aircraft already handed to it
/** Arrivals waiting to play: held while more of our weapons are about to land, so they play as one reel. */
let pending: Impact[] = [];
let lastArrival = 0;
/** Game seconds the camera waits after an arrival for others still in flight. */
const HOLD = 60;

/** Picks up new arrivals from the sim (not in a replay: they've been seen). True if there were any. */
function collectArrivals(): boolean {
  const fresh: Impact[] = replay ? [] : [
    ...g.strikes.slice(strikesSeen).map((s): Impact => ({ type: 'land', t: s.t, weapon: s.weapon, site: s.siteName, siteId: s.siteId, kind: s.kind, hit: s.hit })),
    ...g.hits.slice(hitsSeen).map((h): Impact => ({ type: 'hit', ...h })),
  ];
  strikesSeen = g.strikes.length; hitsSeen = g.hits.length;
  if (!fresh.length) return false;
  pending.push(...fresh.sort((a, b) => a.t - b.t));
  lastArrival = g.t;
  return true;
}
/** Still waiting for more weapons to land before showing what has. */
const holding = () => pending.length > 0 && !g.over && g.t - lastArrival < HOLD && arrivingSoon(g, HOLD - (g.t - lastArrival));
/** Hands the waiting arrivals to the battle camera as one reel. */
function showArrivals() {
  if (!pending.length) return;
  strikeCam.add({ impacts: pending, modern: g.era === '2029', night: g.night, date: MISSIONS[scenario].date.split(',')[0].toUpperCase(), clock: g.startClock });
  pending = [];
}
function forgetArrivals() { strikesSeen = g.strikes.length; hitsSeen = g.hits.length; pending = []; }
function togglePeriscope() {
  const why = periscope.toggle();
  if (why) addLog(g, { t: g.t, kind: 'warn', text: why });
}

// ---- Controls ---------------------------------------------------------------
function buttonRow(host: HTMLElement, items: [number, string][], fmt: (v: number, l: string) => string, onClick: (v: number) => void) {
  for (const [v, l] of items) {
    const b = document.createElement('button');
    b.textContent = fmt(v, l);
    b.dataset.v = String(v);
    b.addEventListener('click', () => onClick(v));
    host.appendChild(b);
  }
}
buttonRow($('speeds'), SPEEDS, (v, l) => `${l} ${v}`, (v) => orders.speed(g, v));
const MATCHES = [['course', 'matchCrs', 'Course'], ['bearing', 'matchBrg', 'Bearing'], ['speed', 'matchSpd', 'Speed']] as const;
for (const [what, , label] of MATCHES) {
  const b = document.createElement('button');
  b.id = `match-${what}`;
  b.textContent = label;
  b.title = what === 'bearing' ? 'Toggle: keep steering straight at the selected contact\'s bearing. Ends if you steer by hand.'
    : what === 'course' ? 'Toggle: keep steering the selected contact\'s course from the solution. Ends if you steer by hand.'
    : 'Toggle: keep our speed matched to the selected contact\'s, from the solution. Ends if you order another speed (Z).';
  b.addEventListener('click', () => orders.match(g, what));
  $('follow').appendChild(b);
}
buttonRow($('depths'), DEPTHS, (_, l) => l, (v) => orders.depth(g, v as Depth));
buttonRow($('times'), TIMES, (_, l) => l, (v) => { if (!v && timeScale) resumeScale = timeScale; timeScale = v; });
function togglePause() { if (timeScale) { resumeScale = timeScale; timeScale = 0; } else timeScale = resumeScale; }

// ---- Pause card: the briefing and the mission's objectives, live ----------------------------------
let pauseDismissed = false; // closed with Hide: stays closed until the next pause
const MARK = { done: '✓', open: '○', failed: '✗' } as const;
function renderPause() {
  const m = MISSIONS[scenario];
  const obs = objectives(g);
  $('pauseCard').innerHTML = `
    <p class="sub">Paused · ${esc(m.place)} · ${esc(m.date)}</p>
    <h2>${esc(m.title)}</h2>
    <p class="pbrief">${esc(m.brief)}</p>
    <h3>Objectives</h3>
    <ul class="obj">${obs.map((o) => `<li class="${o.state}"><span class="mk">${MARK[o.state]}</span><span><b>${esc(o.text)}</b>${o.detail ? `<small>${esc(o.detail)}</small>` : ''}</span></li>`).join('')}</ul>
    <div class="row"><button id="pResume">Resume <kbd>Space</kbd></button><button id="pHide">Hide, stay paused</button></div>`;
  $('pResume').addEventListener('click', togglePause);
  $('pHide').addEventListener('click', () => { pauseDismissed = true; $('pauseCard').hidden = true; });
}
function updatePauseCard() {
  const paused = running && !g.over && !replay && timeScale === 0;
  if (!paused) pauseDismissed = false;
  const show = paused && !pauseDismissed && $('overlay').hidden;
  const card = $('pauseCard');
  if (show && card.hidden) renderPause();
  card.hidden = !show;
}
const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
on('pauseBtn', togglePause);
// Leaving a mission in progress takes two clicks, so a stray one doesn't throw it away.
on('toCampaign', () => {
  const b = $('toCampaign');
  const midMission = running && !g.over && !replay;
  if (midMission && !b.classList.contains('confirm')) {
    b.classList.add('confirm');
    b.textContent = 'Leave mission? Click again';
    setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Back to campaign'; }, 4000);
    return;
  }
  b.classList.remove('confirm'); b.textContent = 'Back to campaign';
  if (replay) exitReplay();
  showMenu();
});
on('shallower', () => orders.depthBy(g, -50));
on('arrayUp', () => orders.straddle(g, 'above'));
on('arrayDown', () => orders.straddle(g, 'below'));
on('deeper', () => orders.depthBy(g, 50));
$('depthSet').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const box = $('depthFt') as HTMLInputElement;
  if (box.value !== '') orders.depthTo(g, Number(box.value));
  box.value = '';
  box.blur();
});
on('fireMk48', () => orders.fire(g, 'mk48'));
on('fireHarpoon', () => orders.fire(g, 'harpoon'));
on('fireMst', () => orders.fire(g, 'mst'));
on('fireAsroc', () => orders.fire(g, 'asroc'));
on('fireJatm', () => orders.fire(g, 'jatm'));
on('fireSm6', () => orders.fire(g, 'sm6'));
on('radar', () => orders.radar(g));
on('fireTlam', () => orders.strike(g, Number(($('tlamSite') as HTMLSelectElement).value)));
on('layMine', () => orders.layMine(g));
on('scopeBtn', togglePeriscope);
on('solBtn', () => { depthView.close(); solution.toggle(); });
on('depthBtn', () => { solution.close(); depthView.toggle(); });
on('ping', () => orders.ping(g));
on('decoy', () => orders.decoy(g));
on('zoomIn', () => { plot.zoom = Math.max(0, plot.zoom - 1); });
on('zoomOut', () => { plot.zoom = Math.min(SPANS.length - 1, plot.zoom + 1); });

$('contacts').addEventListener('click', (ev) => {
  const li = (ev.target as HTMLElement).closest<HTMLElement>('li[data-id]');
  if (li) orders.select(g, Number(li.dataset.id));
});
$('matches').addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>('button[data-classify]');
  if (b) orders.classify(g, Number(b.dataset.contact), b.dataset.classify!);
});

const wrap = $('plotWrap');
wrap.addEventListener('click', (ev) => {
  if (!running || g.over || (ev.target as HTMLElement).closest('button, .scope')) return;
  const picked = plot.pick(ev.clientX, ev.clientY);
  if (picked !== null) {
    orders.select(g, picked);
    // Clicking a contact you can see brings up the periscope view on it.
    if (inPeriscope(g, contactById(g, picked))) periscope.show();
    return;
  }
  const b = plot.bearingAt(ev.clientX, ev.clientY);
  if (b !== null) orders.heading(g, b);
});
wrap.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  plot.zoom = Math.max(0, Math.min(SPANS.length - 1, plot.zoom + (ev.deltaY > 0 ? 1 : -1)));
}, { passive: false });

function acceptTop() {
  const c = g.contacts.find((x) => x.id === g.selected);
  if (c?.matches.length) orders.classify(g, c.id, c.matches[0].key);
}

document.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (strikeCam.open) { // the strike camera holds the keyboard while it plays
    if (ev.key === 'Escape') { ev.preventDefault(); strikeCam.skip(); }
    return;
  }
  if ((ev.target as HTMLElement).closest?.('input, select, textarea')) return; // typing a depth, not giving orders
  if (!running) { if (ev.key === 'Enter' && overShown) start(scenario); return; }
  const idx = SPEEDS.findIndex(([v]) => v >= g.own.ordSpd);
  const faster = () => orders.speed(g, SPEEDS[Math.min(SPEEDS.length - 1, idx + 1)][0]);
  const slower = () => orders.speed(g, SPEEDS[Math.max(0, idx - 1)][0]);
  const keys: Record<string, () => void> = {
    a: () => orders.turn(g, -10), arrowleft: () => orders.turn(g, -10),
    d: () => orders.turn(g, 10), arrowright: () => orders.turn(g, 10),
    w: faster, arrowup: faster, s: slower, arrowdown: slower,
    q: () => { const up = [...DEPTHS].reverse().find(([v]) => v < g.own.ordDepth - 0.01); if (up) orders.depth(g, up[0]); },
    e: () => { const dn = DEPTHS.find(([v]) => v > g.own.ordDepth + 0.01); if (dn) orders.depth(g, dn[0]); },
    '[': () => orders.depthBy(g, -50), ']': () => orders.depthBy(g, 50),
    u: () => orders.straddle(g, 'above'), n: () => orders.straddle(g, 'below'),
    l: () => orders.layer(g),
    f: () => orders.fire(g, 'mk48'), h: () => orders.fire(g, 'harpoon'), t: () => orders.fire(g, 'mst'),
    g: () => orders.fire(g, 'asroc'), y: () => orders.strike(g, Number(($('tlamSite') as HTMLSelectElement).value)), j: () => orders.fire(g, 'jatm'), m: () => orders.fire(g, 'sm6'),
    r: () => orders.radar(g), v: togglePeriscope, b: () => { depthView.close(); solution.toggle(); }, x: () => { solution.close(); depthView.toggle(); }, escape: () => { if (replay && liveGame && !periscope.open && !depthView.open && !solution.open) exitReplay(); else if (periscope.open) periscope.close(); else if (depthView.open) depthView.close(); else solution.close(); },
    p: () => orders.ping(g), c: () => orders.decoy(g), z: () => orders.match(g, 'speed'), i: () => orders.layMine(g),
    tab: () => orders.cycleContact(g), k: acceptTop,
    ' ': togglePause,
    '1': () => { timeScale = 1; }, '2': () => { timeScale = 10; }, '3': () => { timeScale = 30; }, '4': () => { timeScale = 90; },
    '=': () => { plot.zoom = Math.max(0, plot.zoom - 1); }, '-': () => { plot.zoom = Math.min(SPANS.length - 1, plot.zoom + 1); },
  };
  const act = keys[ev.key.toLowerCase()];
  if (act) { ev.preventDefault(); act(); }
});

// ---- Lifecycle -------------------------------------------------------------------
function newGame(key: ScenarioKey) {
  scenario = key;
  const m = MISSIONS[key];
  const seed = Date.now() & 0x7fffffff;
  const carry = carryFor(key);
  g = create(key, seed, carry);
  recordOrders(g, key, seed, carry);
  replay = null;
  liveGame = null;
  $('replayBar').hidden = true;
  setUp(key);
  addLog(g, {
    t: 0, kind: 'info', text: key === 'bismarck'
      ? 'The vortex has closed behind us. No GPS, no satellites, Morse on the radio. Radio intercepts put Bismarck in the Denmark Strait. 150 feet, ahead one-third, towed array streamed.'
      : key === 'duel' ? 'On station in the Bear Gap. Ahead one-third, 150 feet. Towed array streamed, passive watch set.'
        : `${m.title}: ${m.place}, ${m.date}. 150 feet, ahead one-third, towed array streamed.`,
  });
}

/** Resets the screens for the game in `g`. */
function setUp(key: ScenarioKey) {
  const m = MISSIONS[key];
  $('log').innerHTML = '';
  $('place').textContent = `· ${m.place}, ${m.date.split(',')[0]}`;
  waterfall.clear();
  signature.clear();
  plot.reset(key === 'duel' ? 2 : 3);
  $('tlamRow').hidden = !g.sites.length;
  $('mineRow').hidden = !g.flags.minesAboard;
  $('tlamSite').innerHTML = g.sites.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  periscope.close();
  solution.close();
  depthView.close();
  strikeCam.close();
  forgetArrivals();
  overShown = false;
  acc = 0;
}

// ---- Replay -------------------------------------------------------------------------
function startReplay() {
  const r = recording();
  if (!r) return;
  liveGame ??= g;
  g = create(r.key, r.seed, r.carry);
  replay = new Player(g, r);
  setUp(r.key);
  addLog(g, { t: 0, kind: 'info', text: 'Replay: the mission again from the start, with every ship shown where it really was. Use time compression to speed it up or slow it down.' });
  $('replayText').textContent = 'Replay';
  $('replayBar').hidden = false;
  $('overlay').hidden = true;
  timeScale = 30;
  running = true;
  last = performance.now();
}
function exitReplay() {
  if (!liveGame) return;
  g = liveGame;
  liveGame = null;
  replay = null;
  forgetArrivals();
  $('replayBar').hidden = true;
  $('overlay').hidden = false; // the results, as they were
  running = false;
}
on('replayRestart', startReplay);
on('replayExit', exitReplay);

function start(key: ScenarioKey, fromWar: string | null = null) {
  warMission = fromWar;
  unlockAudio();
  newGame(key);
  timeScale = resumeScale = 1; // start in real time so the player can get their bearings
  $('overlay').hidden = true;
  running = true;
  last = performance.now();
}

// ---- Campaign screen ---------------------------------------------------------------
const campaignHTML = $('brief').innerHTML;
let picked: MissionKey = CAMPAIGN.find((k) => unlocked(k) && !results()[k]?.win) ?? 'bismarck';

function showCampaign(key: MissionKey = picked) {
  picked = key;
  const keep = document.getElementById('campList')?.scrollTop ?? 0; // the list is redrawn below
  const brief = $('brief');
  brief.className = 'brief';
  brief.innerHTML = campaignHTML;
  wireModes();
  const done = results();
  const item = (k: MissionKey, n: string) => {
    const open = k === 'duel' || unlocked(k);
    const r = done[k];
    const mark = r?.win ? '<span class="ok">✓</span>' : r ? '<span class="no">✗</span>' : '';
    return `<li class="${k === key ? 'sel' : ''} ${open ? '' : 'locked'}"><button data-m="${k}" ${open ? '' : 'disabled'}><span class="n">${n}</span><span class="t">${esc(MISSIONS[k].title)}<small>${esc(MISSIONS[k].date.split(',')[0])}</small></span>${mark}</button></li>`;
  };
  $('campList').innerHTML = CAMPAIGN.map((k, i) => item(k, String(i + 1))).join('')
    + '<li class="sep">Before the vortex · optional</li>' + PREQUELS.map((k) => item(k, '·')).join('')
    + '<li class="sep">Present day</li>' + item('duel', '—');
  if (keep) $('campList').scrollTop = keep;
  else $('campList').querySelector('li.sel')?.scrollIntoView({ block: 'nearest' });
  $('campList').addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-m]');
    if (b && !b.disabled) showCampaign(b.dataset.m as MissionKey);
  });
  const m = MISSIONS[key];
  const changed = changedFor(key);
  $('campDetail').innerHTML = `
    <p class="sub">${esc(m.place)} · ${esc(m.date)}</p>
    <h3>${esc(m.title)}</h3>
    <p>${esc(m.brief)}</p>
    ${changed.length ? `<p class="changed">History has changed: ${esc(changed.length > 1 ? `${changed.slice(0, -1).join(', ')} and ${changed[changed.length - 1]}` : changed[0])} ${changed.length > 1 ? 'were' : 'was'} sunk by Tang in an earlier mission and won't be here.</p>` : ''}
    <button id="begin">Begin mission</button>`;
  $('begin').addEventListener('click', () => start(key));
  // Two clicks, so a stray one can't wipe the campaign.
  const restart = $('restartCamp') as HTMLButtonElement;
  restart.hidden = !Object.keys(done).length;
  restart.addEventListener('click', () => {
    if (!restart.classList.contains('confirm')) {
      restart.classList.add('confirm');
      restart.textContent = 'Erase all results? Click again';
      setTimeout(() => { restart.classList.remove('confirm'); restart.textContent = 'Restart campaign'; }, 4000);
      return;
    }
    resetCampaign();
    showCampaign(CAMPAIGN[0]);
  });
  $('overlay').hidden = false;
  running = false;
}

function showResult() {
  if (warMission) return showWarResult(warMission);
  const o = g.over!;
  const res = record(g);
  const key = scenario;
  const brief = $('brief');
  const fired = Object.entries(g.stats.fired).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${WEAPONS[k as WeaponKey].short}`).join(', ') || 'no weapons';
  const i = CAMPAIGN.indexOf(key);
  const next = o.win && i >= 0 && i < CAMPAIGN.length - 1 ? CAMPAIGN[i + 1] : null;
  const story = i >= 0 ? interlude(key, res) : [];
  brief.className = 'brief ' + (o.win ? 'win' : 'loss');
  brief.innerHTML = `
    <h2>${o.win ? 'Mission accomplished' : 'Mission failed'}</h2>
    <p class="sub">${esc(MISSIONS[key].title)} · ${Math.round(o.t / 60)} min · ${fired} fired · ${g.stats.hits} hits${g.stats.blueOnBlue ? ` · ${g.stats.blueOnBlue} on friendly ships` : ''}</p>
    <p>${esc(o.reason)}${res.sunk.length ? ` Sunk: ${esc(res.sunk.join(', '))}.` : ''}${res.aircraft ? ` Aircraft shot down: ${res.aircraft}.` : ''} The plot now shows where every ship really was.</p>
    ${story.length ? `<div class="interlude"><div class="wlabel">The war, as it now stands</div>${story.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
    <div class="row">${next ? `<button id="next">Next: ${esc(MISSIONS[next].title)}</button>` : ''}<button id="watch">Watch replay</button><button id="again">Play again</button><button id="menu">Campaign</button></div>`;
  $('next')?.addEventListener('click', () => showCampaign(next!));
  $('watch').addEventListener('click', startReplay);
  $('again').addEventListener('click', () => start(scenario));
  $('menu').addEventListener('click', () => showCampaign(i >= 0 ? key : picked));
  $('overlay').hidden = false;
  running = false;
}
// ---- Modern war screen --------------------------------------------------------------------
function setMode(m: Mode) {
  mode = m;
  try { localStorage.setItem('phantom-leviathan-mode', m); } catch { /* fine without it */ }
  showMenu();
}
function showMenu() { strikeCam.close(); if (mode === 'war') showWar(); else showCampaign(); }
function wireModes() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.modes button')) {
    b.classList.toggle('on', b.dataset.mode === mode);
    b.addEventListener('click', () => setMode(b.dataset.mode as Mode));
  }
}

const ACTS: Record<string, string> = {
  '1': 'Act 1 · The North Atlantic and the Arctic',
  '2P': 'Act 2 · The Western Pacific', '2I': 'Act 2 · The Indian Ocean and the Gulf', '2': 'Act 2',
  R: 'The Polar Front · under the ice with Japan',
  '3': 'Act 3 · Home, the South Atlantic and the end',
};
const ENDINGS: Record<Ending, [string, string]> = {
  Victory: ['Victory', 'The pact breaks. India walks out first, then Brazil, and Moscow and Beijing accept a ceasefire on NATO\'s terms.'],
  Stalemate: ['Stalemate', 'Exhausted, both sides accept a ceasefire along the lines they hold today. Nobody calls it a victory.'],
  Brink: ['The brink', 'For six days the world waited on the orders of a few missile subs. The crisis passed, at a price nobody will forget.'],
  Defeat: ['Defeat', 'The sea lanes are lost. With Europe cut off and the Pacific gone, NATO sues for peace.'],
};
const actKey = (w: WarState) => { const sl = currentSlot(w); return sl ? (sl.branch === 'R' ? 'R' : sl.act === 2 ? `2${sl.branch ?? ''}` : String(sl.act)) : '3'; };

function frontsHTML(w: WarState) {
  const bar = (v: number) => `<span class="fmeter">${[-3, -2, -1, 0, 1, 2, 3].map((n) => `<i class="${n === 0 ? 'mid ' : ''}${(v < 0 && n >= v && n < 0) ? 'neg' : (v > 0 && n <= v && n > 0) ? 'pos' : ''}"></i>`).join('')}</span>`;
  return `<div class="fronts">${FRONTS.map((f) => `<div class="front"><span class="fn">${FRONT_NAMES[f]}</span><span class="fbar">${bar(w.meters[f])}<span class="fv">${w.meters[f] > 0 ? '+' : ''}${w.meters[f]}</span></span></div>`).join('')}
    <div class="front esc"><span class="fn">Escalation</span><span class="fbar"><span class="pips">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= w.x ? 'on' : ''}"></i>`).join('')}</span><span class="fv">${w.x}</span></span></div></div>`;
}

function warMissionHTML(id: string, w: WarState, choice: boolean) {
  const m = WAR_MISSIONS[id];
  const built = !!playable(id);
  return `<div class="war-mission">
    <p class="sub">${esc(m.where)} · ${esc(currentSlot(w)?.title ?? '')}</p>
    <h3>${esc(m.name)}</h3>
    <p><b>You face:</b> ${esc(m.face)}.</p>
    <p><b>Orders:</b> ${esc(m.goal)}.</p>
    ${built ? `<p class="war-brief">${esc(MISSIONS[playable(id)!].brief)}</p>` : ''}
    <p class="fx"><span class="ok">Win:</span> ${esc(m.winText)} · <span class="no">Loss:</span> ${esc(m.loseText)}</p>
    ${built ? `<button data-begin="${id}">${choice ? 'Take these orders' : 'Begin mission'}</button>`
      : `<p class="unbuilt">This mission isn't built yet. To try the story, mark how it went.</p><div class="row"><button data-mark="${id}" data-win="1">Count as won</button><button data-mark="${id}" data-win="0">Count as lost</button></div>`}
  </div>`;
}

function showWar() {
  const w = currentWar();
  const brief = $('brief');
  brief.className = 'brief war';
  const n = w.history.length;
  const last = w.history[n - 1];
  const over = warOver(w);
  const card = last && !over ? newsCard(last.news) : undefined;
  const rows = w.history.map((h, i) => `<li><span class="n">${i + 1}</span><span class="t">${esc(WAR_MISSIONS[h.id].name)}<small>${esc(h.news)}</small></span>${h.win ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'}</li>`);
  if (!over) rows.push(`<li class="sel"><span class="n">${n + 1}</span><span class="t">${w.offer.map((id) => esc(WAR_MISSIONS[id].name)).join(' or ')}<small>Now</small></span></li>`);
  for (let i = n + 2; i <= warLength(w); i++) rows.push(`<li class="locked"><span class="n">${i}</span><span class="t">?</span></li>`);
  const ending = w.ending && over ? ENDINGS[w.ending] : null;
  brief.innerHTML = `
    <div class="modes"><button data-mode="ww2">WWII campaign</button><button data-mode="war">Modern war · 2029</button></div>
    <div class="camp-head">
      <div>
        <h2>The war of 2029</h2>
        <p class="sub">${over ? 'The war is over' : `Mission ${n + 1} of ${warLength(w)} · ${esc(ACTS[actKey(w)])}`}</p>
      </div>
      <button id="restartWar" class="restart" title="Starts a new war with new dice">${over ? 'New war' : 'Restart war'}</button>
    </div>
    ${frontsHTML(w)}
    <div class="camp">
      <ol class="camp-list war-list" id="campList">${rows.join('')}</ol>
      <div class="camp-detail" id="campDetail">
        ${card ? `<div class="bulletin"><div class="wlabel">Radio bulletin</div><p><b>${esc(card.name)}.</b> ${esc(card.text)}</p></div>` : `<div class="bulletin"><div class="wlabel">March 2029</div><p>Tang is back from 1945, in a world at war: NATO against the BRICS Pact. Each mission's result, and the news between missions, decides where she is sent next. A war is ${WAR_MIN} to ${WAR_MAX} missions.</p></div>`}
        ${ending ? `<h3>${esc(ending[0])}</h3><p>${esc(ending[1])}</p>`
          : `${w.offer.length > 1 ? '<p class="sub">Choose your orders</p>' : ''}<div class="offers">${w.offer.map((id) => warMissionHTML(id, w, w.offer.length > 1)).join('')}</div>`}
      </div>
    </div>`;
  wireModes();
  $('campList').querySelector('li.sel')?.scrollIntoView({ block: 'nearest' });
  for (const b of brief.querySelectorAll<HTMLButtonElement>('[data-begin]')) b.addEventListener('click', () => start(playable(b.dataset.begin!)!, b.dataset.begin!));
  for (const b of brief.querySelectorAll<HTMLButtonElement>('[data-mark]')) b.addEventListener('click', () => {
    resolveWar(w, b.dataset.mark!, b.dataset.win === '1');
    saveWar();
    showWar();
  });
  const restart = $('restartWar') as HTMLButtonElement;
  restart.addEventListener('click', () => {
    if (!over && !restart.classList.contains('confirm')) {
      restart.classList.add('confirm');
      restart.textContent = 'Throw this war away? Click again';
      setTimeout(() => { restart.classList.remove('confirm'); restart.textContent = 'Restart war'; }, 4000);
      return;
    }
    restartWar();
    showWar();
  });
  $('overlay').hidden = false;
  running = false;
}

function showWarResult(id: string) {
  const o = g.over!;
  const res = record(g);
  const brief = $('brief');
  const m = WAR_MISSIONS[id];
  // Nothing counts until the player moves on, so a mission can be replayed first.
  const tangLost = !g.own.alive;
  brief.className = 'brief ' + (o.win ? 'win' : 'loss');
  brief.innerHTML = `
    <h2>${o.win ? 'Mission passed' : tangLost ? 'Tang is lost' : 'Mission failed'}</h2>
    <p class="sub">${esc(m.name)} · ${Math.round(o.t / 60)} min · ${g.stats.hits} hits</p>
    <p>${esc(o.reason)}${res.sunk.length ? ` Sunk: ${esc(res.sunk.join(', '))}.` : ''} The plot now shows where every ship really was.</p>
    <p><b>Orders were:</b> ${esc(m.goal)}.</p>
    ${tangLost ? '<p>The war can\'t go on without Tang. Replay the mission.</p>'
      : `<p class="fx">If you continue: ${o.win ? `<span class="ok">passed</span> · ${esc(m.winText)}` : `<span class="no">failed</span> · ${esc(m.loseText)}`}</p>`}
    <div class="row"><button id="again">Replay mission</button>${tangLost ? '' : `<button id="next">Continue the war</button>`}<button id="watch">Watch replay</button></div>`;
  $('next')?.addEventListener('click', () => {
    resolveWar(currentWar(), id, o.win);
    saveWar();
    showWar();
  });
  $('again').addEventListener('click', () => start(scenario, id));
  $('watch').addEventListener('click', startReplay);
  $('overlay').hidden = false;
  running = false;
}

// ---- Main loop ------------------------------------------------------------------------
let panelT = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // The game waits while the battle camera plays. A weapon landing stops the tick there, so time
  // compression can't run past it; if more of ours are about to land, the game runs on quickly
  // until they have (or a minute has passed), and they all play as one reel.
  if (running && !g.over && !strikeCam.open) {
    acc += dt * (pending.length && timeScale > 0 ? Math.max(timeScale, 16) : timeScale);
    for (let n = 0; acc >= 1 && n < 400 && !g.over; n++) {
      if (replay) replay.apply(); else noteSelection(g);
      tick(g, 1); acc -= 1;
      collectArrivals();
      if (pending.length && !holding()) { acc = 0; break; }
    }
  }
  collectArrivals();
  if (pending.length && !holding()) showArrivals();
  strikeCam.draw(now);
  for (const ev of g.events) { addLog(g, ev); if (ev.sound) play(ev.sound); }
  g.events.length = 0;
  plot.draw(g, now);
  periscope.draw(g, now);
  waterfall.draw(g);
  signature.draw(g);
  depthView.draw(g);
  if (now - panelT > 150) {
    panelT = now;
    updatePanel(g);
    solution.update(g);
    for (const b of $('speeds').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', +b.dataset.v! === g.own.ordSpd);
    for (const b of $('depths').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', +b.dataset.v! === g.own.ordDepth);
    for (const [what, flag] of MATCHES) $(`match-${what}`).classList.toggle('on', !!g.flags[flag]);
    $('arrayUp').classList.toggle('on', g.own.arraySide === 'above');
    $('arrayDown').classList.toggle('on', g.own.arraySide === 'below');
    for (const b of $('times').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', +b.dataset.v! === timeScale);
    const pb = $('pauseBtn'), label = timeScale ? 'Pause' : 'Resume';
    if (pb.firstChild?.textContent?.trim() !== label) pb.innerHTML = `${label} <kbd>Space</kbd>`;
    pb.classList.toggle('on', !timeScale);
    updatePauseCard();
  }
  if (g.over && !overShown && !strikeCam.open) {
    overShown = true; updatePanel(g);
    if (replay) $('replayText').textContent = 'Replay finished';
    else setTimeout(showResult, 2500);
  }
  requestAnimationFrame(frame);
}

async function boot() {
  // Pixi text rasterises with whatever font is loaded, so wait briefly for webfonts.
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  await plot.init(wrap);
  newGame('bismarck');
  updatePanel(g);
  showMenu();
  requestAnimationFrame(frame);
}
void boot();
// Dev builds expose the game for screenshot checks.
if (import.meta.env.DEV) Object.assign(window, { game: () => g, strikeCam });
