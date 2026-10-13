import 'pixi.js/unsafe-eval'; // no eval(), so the game runs under strict content security policies
import './style.css';
import { SCENARIOS, WEAPONS, contactById, create, inPeriscope, orders, tick, type Depth, type Game, type ScenarioKey, type WeaponKey } from './sim/sim';
import { Plot, SPANS } from './render/plot';
import { Waterfall } from './ui/waterfall';
import { SignatureDisplay } from './ui/signature';
import { addLog, updatePanel } from './ui/panel';
import { play, unlockAudio } from './ui/audio';
import { Periscope } from './ui/periscope';
import { Solution } from './ui/solution';

const $ = (id: string) => document.getElementById(id)!;

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
const solution = new Solution(periscope, (id) => orders.select(g, id));
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
on('scopeBtn', togglePeriscope);
on('solBtn', () => solution.toggle());
on('ping', () => orders.ping(g));
on('decoy', () => orders.decoy(g));
on('zoomIn', () => { plot.zoom = Math.max(0, plot.zoom - 1); });
on('zoomOut', () => { plot.zoom = Math.min(SPANS.length - 1, plot.zoom + 1); });
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scenario]')) {
  b.addEventListener('click', () => start(b.dataset.scenario as ScenarioKey));
}

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
    g: () => orders.fire(g, 'asroc'), j: () => orders.fire(g, 'jatm'), m: () => orders.fire(g, 'sm6'),
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
  g = create(key);
  $('log').innerHTML = '';
  $('place').textContent = `· ${SCENARIOS[key].place}`;
  waterfall.clear();
  signature.clear();
  plot.reset(key === 'bismarck' ? 3 : 2);
  periscope.close();
  solution.close();
  overShown = false;
  acc = 0;
  addLog(g, {
    t: 0, kind: 'info', text: key === 'bismarck'
      ? 'The vortex has closed behind us. No GPS, no satellites, Morse on the radio. Radio intercepts put Bismarck in the Denmark Strait. 150 feet, ahead one-third, towed array streamed.'
      : 'On station in the Bear Gap. Ahead one-third, 150 feet. Towed array streamed, passive watch set.',
  });
}

function start(key: ScenarioKey) {
  unlockAudio();
  newGame(key);
  $('overlay').hidden = true;
  running = true;
  last = performance.now();
}

function showResult() {
  const o = g.over!;
  const brief = $('brief');
  const fired = Object.entries(g.stats.fired).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${WEAPONS[k as WeaponKey].short}`).join(', ') || 'no weapons';
  brief.className = 'brief ' + (o.win ? 'win' : 'loss');
  brief.innerHTML = `
    <h2>${o.win ? 'Mission accomplished' : 'Mission failed'}</h2>
    <p class="sub">${SCENARIOS[scenario].title} · ${Math.round(o.t / 60)} min · ${fired} fired · ${g.stats.hits} hits${g.stats.blueOnBlue ? ` · ${g.stats.blueOnBlue} on British ships` : ''}</p>
    <p>${o.reason} The plot now shows where every ship really was.</p>
    <div class="row"><button id="again">Play again</button><button id="menu">Choose mission</button></div>`;
  $('again').addEventListener('click', () => start(scenario));
  $('menu').addEventListener('click', () => location.reload());
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
  solution.draw(g, now);
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
  requestAnimationFrame(frame);
}
void boot();
// Dev builds expose the game for screenshot checks.
if (import.meta.env.DEV) (window as unknown as { game: () => Game }).game = () => g;
