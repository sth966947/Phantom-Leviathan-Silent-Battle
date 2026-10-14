import 'pixi.js/unsafe-eval'; // no eval(), so the game runs under strict content security policies
import './style.css';
import { WEAPONS, contactById, create, inPeriscope, orders, tick, type Depth, type Game, type ScenarioKey, type WeaponKey } from './sim/sim';
import { CAMPAIGN, MISSIONS, type MissionKey } from './sim/missions';
import { carryFor, changedFor, interlude, record, results, unlocked } from './campaign';
import { Plot, SPANS } from './render/plot';
import { Waterfall } from './ui/waterfall';
import { SignatureDisplay } from './ui/signature';
import { addLog, updatePanel } from './ui/panel';
import { play, unlockAudio } from './ui/audio';
import { Periscope } from './ui/periscope';
import { Solution } from './ui/solution';

const $ = (id: string) => document.getElementById(id)!;
const esc = (t: string) => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

const SPEEDS: [number, string][] = [[3, 'Creep'], [5, '⅓'], [10, '⅔'], [15, 'Std'], [20, 'Full'], [32, 'Flank']];
const DEPTHS: [number, string][] = [[0, 'Periscope'], [1, '150 ft'], [2, '700 ft']];
const TIMES: [number, string][] = [[0, 'Pause'], [10, '×10'], [30, '×30'], [90, '×90']];

let scenario: ScenarioKey = 'bismarck';
let g: Game = create(scenario);
let timeScale = 30;
let running = false;
let acc = 0;
let last = performance.now();
let overShown = false;

const plot = new Plot();
const waterfall = new Waterfall($('waterfall') as HTMLCanvasElement);
const signature = new SignatureDisplay($('signature') as HTMLCanvasElement);
const periscope = new Periscope($('scopeView') as HTMLCanvasElement, () => g);
const solution = new Solution(() => g);
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
buttonRow($('depths'), DEPTHS, (_, l) => l, (v) => orders.depth(g, v as Depth));
buttonRow($('times'), TIMES, (_, l) => l, (v) => { timeScale = v; });
const on = (id: string, fn: () => void) => $(id).addEventListener('click', fn);
on('left', () => orders.turn(g, -10));
on('right', () => orders.turn(g, 10));
on('fireMk48', () => orders.fire(g, 'mk48'));
on('fireHarpoon', () => orders.fire(g, 'harpoon'));
on('fireMst', () => orders.fire(g, 'mst'));
on('fireAsroc', () => orders.fire(g, 'asroc'));
on('fireJatm', () => orders.fire(g, 'jatm'));
on('fireSm6', () => orders.fire(g, 'sm6'));
on('radar', () => orders.radar(g));
on('fireTlam', () => orders.strike(g, Number(($('tlamSite') as HTMLSelectElement).value)));
on('scopeBtn', togglePeriscope);
on('solBtn', () => solution.toggle());
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
  if (!running) { if (ev.key === 'Enter' && overShown) start(scenario); return; }
  const idx = SPEEDS.findIndex(([v]) => v >= g.own.ordSpd);
  const faster = () => orders.speed(g, SPEEDS[Math.min(SPEEDS.length - 1, idx + 1)][0]);
  const slower = () => orders.speed(g, SPEEDS[Math.max(0, idx - 1)][0]);
  const keys: Record<string, () => void> = {
    a: () => orders.turn(g, -10), arrowleft: () => orders.turn(g, -10),
    d: () => orders.turn(g, 10), arrowright: () => orders.turn(g, 10),
    w: faster, arrowup: faster, s: slower, arrowdown: slower,
    q: () => orders.depth(g, Math.max(0, g.own.ordDepth - 1) as Depth),
    e: () => orders.depth(g, Math.min(2, g.own.ordDepth + 1) as Depth),
    l: () => orders.layer(g),
    f: () => orders.fire(g, 'mk48'), h: () => orders.fire(g, 'harpoon'), t: () => orders.fire(g, 'mst'),
    g: () => orders.fire(g, 'asroc'), y: () => orders.strike(g, Number(($('tlamSite') as HTMLSelectElement).value)), j: () => orders.fire(g, 'jatm'), m: () => orders.fire(g, 'sm6'),
    r: () => orders.radar(g), v: togglePeriscope, b: () => solution.toggle(), escape: () => { if (periscope.open) periscope.close(); else solution.close(); },
    p: () => orders.ping(g), c: () => orders.decoy(g),
    tab: () => orders.cycleContact(g), k: acceptTop,
    ' ': () => { timeScale = timeScale ? 0 : 30; },
    '1': () => { timeScale = 10; }, '2': () => { timeScale = 30; }, '3': () => { timeScale = 90; },
    '=': () => { plot.zoom = Math.max(0, plot.zoom - 1); }, '-': () => { plot.zoom = Math.min(SPANS.length - 1, plot.zoom + 1); },
  };
  const act = keys[ev.key.toLowerCase()];
  if (act) { ev.preventDefault(); act(); }
});

// ---- Lifecycle -------------------------------------------------------------------
function newGame(key: ScenarioKey) {
  scenario = key;
  const m = MISSIONS[key];
  g = create(key, undefined, carryFor(key));
  $('log').innerHTML = '';
  $('place').textContent = `· ${m.place}, ${m.date.split(',')[0]}`;
  waterfall.clear();
  signature.clear();
  plot.reset(key === 'duel' ? 2 : 3);
  $('tlamRow').hidden = !g.sites.length;
  $('tlamSite').innerHTML = g.sites.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  periscope.close();
  solution.close();
  overShown = false;
  acc = 0;
  addLog(g, {
    t: 0, kind: 'info', text: key === 'bismarck'
      ? 'The vortex has closed behind us. No GPS, no satellites, Morse on the radio. Radio intercepts put Bismarck in the Denmark Strait. 150 feet, ahead one-third, towed array streamed.'
      : key === 'duel' ? 'On station in the Bear Gap. Ahead one-third, 150 feet. Towed array streamed, passive watch set.'
        : `${m.title}: ${m.place}, ${m.date}. 150 feet, ahead one-third, towed array streamed.`,
  });
}

function start(key: ScenarioKey) {
  unlockAudio();
  newGame(key);
  $('overlay').hidden = true;
  running = true;
  last = performance.now();
}

// ---- Campaign screen ---------------------------------------------------------------
const campaignHTML = $('brief').innerHTML;
let picked: MissionKey = CAMPAIGN.find((k) => unlocked(k) && !results()[k]?.win) ?? 'bismarck';

function showCampaign(key: MissionKey = picked) {
  picked = key;
  const brief = $('brief');
  brief.className = 'brief';
  brief.innerHTML = campaignHTML;
  const done = results();
  const item = (k: MissionKey, n: string) => {
    const open = k === 'duel' || unlocked(k);
    const r = done[k];
    const mark = r?.win ? '<span class="ok">✓</span>' : r ? '<span class="no">✗</span>' : '';
    return `<li class="${k === key ? 'sel' : ''} ${open ? '' : 'locked'}"><button data-m="${k}" ${open ? '' : 'disabled'}><span class="n">${n}</span><span class="t">${esc(MISSIONS[k].title)}<small>${esc(MISSIONS[k].date.split(',')[0])}</small></span>${mark}</button></li>`;
  };
  $('campList').innerHTML = CAMPAIGN.map((k, i) => item(k, String(i + 1))).join('') + '<li class="sep">Present day</li>' + item('duel', '—');
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
  $('overlay').hidden = false;
  running = false;
}

function showResult() {
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
    <div class="row">${next ? `<button id="next">Next: ${esc(MISSIONS[next].title)}</button>` : ''}<button id="again">Play again</button><button id="menu">Campaign</button></div>`;
  $('next')?.addEventListener('click', () => showCampaign(next!));
  $('again').addEventListener('click', () => start(scenario));
  $('menu').addEventListener('click', () => showCampaign(i >= 0 ? key : picked));
  $('overlay').hidden = false;
  running = false;
}

// ---- Main loop ------------------------------------------------------------------------
let panelT = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running && !g.over) {
    acc += dt * timeScale;
    for (let n = 0; acc >= 1 && n < 400 && !g.over; n++) { tick(g, 1); acc -= 1; }
  }
  for (const ev of g.events) { addLog(g, ev); if (ev.sound) play(ev.sound); }
  g.events.length = 0;
  plot.draw(g, now);
  periscope.draw(g, now);
  waterfall.draw(g);
  signature.draw(g);
  if (now - panelT > 150) {
    panelT = now;
    updatePanel(g);
    solution.update(g);
    for (const b of $('speeds').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', +b.dataset.v! === g.own.ordSpd);
    for (const b of $('depths').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', +b.dataset.v! === g.own.ordDepth);
    for (const b of $('times').children as HTMLCollectionOf<HTMLElement>) b.classList.toggle('on', +b.dataset.v! === timeScale);
  }
  if (g.over && !overShown) { overShown = true; updatePanel(g); setTimeout(showResult, 2500); }
  requestAnimationFrame(frame);
}

async function boot() {
  // Pixi text rasterises with whatever font is loaded, so wait briefly for webfonts.
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  await plot.init(wrap);
  newGame('bismarck');
  updatePanel(g);
  showCampaign();
  requestAnimationFrame(frame);
}
void boot();
// Dev builds expose the game for screenshot checks.
if (import.meta.env.DEV) (window as unknown as { game: () => Game }).game = () => g;
