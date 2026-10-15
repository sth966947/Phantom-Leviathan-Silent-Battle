// The modern war: 30 to 38 missions per war, drawn from about 120. Each slot of the war offers a pool of
// missions; your last result, the four fronts and the escalation meter narrow the pool, and a seeded
// dice roll picks from what is left. After every mission a news card is drawn that can move a front,
// unlock a mission or swap in a surprise one. Everything is decided from the war's seed, so
// reloading never changes what comes next. See the Modern Campaign Plan doc.
import { SLOTS, WAR_MISSIONS } from './warData';

export type Front = 'N' | 'P' | 'I' | 'S';
export type Ending = 'Victory' | 'Stalemate' | 'Brink' | 'Defeat';
export const FRONTS: Front[] = ['N', 'P', 'I', 'S'];
export const FRONT_NAMES: Record<Front, string> = { N: 'Atlantic', P: 'Pacific', I: 'Gulf', S: 'South Atlantic' };

/** A slot of the war. `branch` P or I is one Act 2 theater; R is the Polar Front under the ice, played in every war. */
export interface Slot { act: 1 | 2 | 3; title: string; branch: 'P' | 'I' | 'R' | null; ids: string[] }
export interface WarMission {
  id: string; name: string; where: string; face: string; goal: string;
  /** Plain words for when the mission can come up, and the rule the game uses for it. */
  when: string; cond: string;
  /** What a win and a loss do: `N+1` moves a front, `X+2` escalation, `!flag` sets a flag. */
  win: string; lose: string; winText: string; loseText: string;
}
export interface Step { id: string; win: boolean; news: string }
export interface WarState {
  v: 1; seed: number;
  meters: Record<Front, number>;
  /** Escalation, 0 to 5. */
  x: number;
  flags: string[];
  /** News cards drawn so far; most can only come up once a war. */
  drawn: string[];
  history: Step[];
  branch: 'P' | 'I' | null;
  /**
   * The other Act 2 theater, when the war sends Tang there too after the first: because that front
   * is losing, or because she did so well in the first that the fleet wants her there. Null when
   * she goes straight on to the Polar Front; absent until the first theater is done.
   */
  second?: 'P' | 'I' | null;
  /** The counteroffensive's front, set when Act 3 reaches it. */
  front: Front | null;
  ending: Ending | null;
  /** The mission or missions on offer now. Two after a hub, so the player picks. */
  offer: string[];
  /** A surprise mission the news has queued for the next slot. */
  surprise: string | null;
}

export const HUBS = ['A11', 'P9', 'I5'];
/** The shortest and longest wars: one Act 2 theater, or both (less the second's long way round). */
export const WAR_MIN = 30, WAR_MAX = 38;

// ---- Dice ---------------------------------------------------------------------------------------
/** A fresh generator for one decision, so each step's rolls depend only on the seed and the step. */
function dice(seed: number, step: number, salt: number) {
  let a = (seed ^ Math.imul(step + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, items: T[], weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = r() * total;
  for (let i = 0; i < items.length; i++) { roll -= weights[i]; if (roll < 0 && weights[i] > 0) return i; }
  return weights.findIndex((w) => w > 0);
}

// ---- Rules ---------------------------------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const has = (s: WarState, f: string) => s.flags.includes(f);
const lastWin = (s: WarState) => s.history.length ? s.history[s.history.length - 1].win : true;
const total = (s: WarState) => FRONTS.reduce((n, f) => n + s.meters[f], 0);
export const weakest = (s: WarState, r: () => number = Math.random): Front =>
  [...FRONTS].sort((a, b) => s.meters[a] - s.meters[b] || r() - 0.5)[0];

export function endingFor(s: WarState): Ending {
  if (s.x >= 4) return 'Brink';
  const t = total(s);
  return t >= 9 ? 'Victory' : t <= 1 ? 'Defeat' : 'Stalemate';
}

/** How strongly one rule word fits now; 0 means it doesn't. */
function atom(s: WarState, a: string): number {
  const m = /^([NPIS])(<=|>=|<|>)(-?\d)$/.exec(a);
  if (m) {
    const v = s.meters[m[1] as Front], n = Number(m[3]);
    const ok = m[2] === '<=' ? v <= n : m[2] === '>=' ? v >= n : m[2] === '<' ? v < n : v > n;
    return ok ? 2 : 0;
  }
  if (a.startsWith('f:')) return has(s, a.slice(2)) ? 3 : 0;
  if (a.startsWith('front:')) return s.front === a.slice(6) ? 3 : 0;
  if (a.startsWith('end:')) return s.ending && a.slice(4).includes(s.ending[0]) ? 3 : 0;
  switch (a) {
    case 'always': case 'any': return 1;
    case 'win': return lastWin(s) ? 1 : 0;
    case 'loss': return lastWin(s) ? 0 : 1;
    case 'offered': return 2;
    case 'X>=1': return s.x >= 1 ? 2 : 0;
    case 'brinkNear': return s.x >= 3 ? 5 : 0;
    case 'canalOpen': return has(s, 'canal_shut') ? 0 : 2;
    case 'kazanAlive': return has(s, 'kazan_dead') ? 0 : 2;
    case 'kazan': return has(s, 'kazan_loose') ? 3 : 0;
    case 'links': return has(s, 'links_cut') ? 3 : 0;
    default: return 0; // 'surprise': only the news sends you there
  }
}
/** A mission's weight in its pool: `a|b` takes the better fit, `*2` sets the weight, `;1` is the weight when nothing fits. */
export function weight(s: WarState, cond: string): number {
  const [main, fallback] = cond.split(';');
  const best = Math.max(...main.split('|').map((part) => {
    const [a, w] = part.split('*');
    const fit = atom(s, a);
    return fit && w ? Number(w) : fit;
  }));
  return best || Number(fallback ?? 0);
}

function apply(s: WarState, fx: string) {
  for (const e of fx.split(' ').filter(Boolean)) {
    if (e.startsWith('!')) { if (!has(s, e.slice(1))) s.flags.push(e.slice(1)); continue; }
    const m = /^([NPISXW])([+-]\d)$/.exec(e);
    if (!m) continue;
    const d = Number(m[2]);
    if (m[1] === 'X') s.x = clamp(s.x + d, 0, 5);
    else {
      // "One meter": the counteroffensive's front, or the weakest.
      const f = m[1] === 'W' ? (s.front ?? weakest(s, () => 0.5)) : m[1] as Front;
      s.meters[f] = clamp(s.meters[f] + d, -3, 3);
    }
  }
}

// ---- News ----------------------------------------------------------------------------------------
export interface NewsCard {
  name: string; text: string;
  /** How likely the card is now; 0 keeps it out of the draw. */
  odds: (s: WarState) => number;
  fx: string;
  /** Cards that can come up more than once a war. */
  repeat?: boolean;
}
const act = (s: WarState) => currentSlot(s)?.act ?? 3;
export const NEWS: NewsCard[] = [
  { name: 'Quiet week', text: 'No news worth the airtime.', odds: () => 4, fx: '', repeat: true },
  { name: 'Allied sub missing', text: 'A US sub stops reporting south of Iceland.', odds: (s) => act(s) === 1 ? 2 : 0, fx: '!sub_missing' },
  { name: 'Cables cut', text: 'Transatlantic cables go dark. Orders now come late or not at all.', odds: (s) => s.meters.N < 0 ? 2 : 1, fx: '!links_cut' },
  { name: 'Turkey wavers', text: 'Ankara lets Russian ships through the Bosphorus "for repairs".', odds: (s) => act(s) === 1 ? 2 : 0, fx: '!turkey' },
  { name: 'Japan all in', text: 'After a strike on Okinawa, Japan commits its whole sub fleet.', odds: (s) => act(s) === 2 && s.branch === 'P' ? 2 : 0, fx: '!japan' },
  { name: 'Australia all in', text: 'Australia sends its boats north.', odds: (s) => act(s) === 2 && s.branch === 'P' ? 2 : 0, fx: '!australia' },
  { name: 'Canal sabotaged', text: 'A ship is scuttled in the Panama Canal locks.', odds: (s) => s.meters.S <= 0 ? 1 : 0, fx: '!canal_shut' },
  { name: 'Suez reopened', text: 'Egypt clears the canal and lets NATO ships through.', odds: () => 1, fx: '!suez' },
  { name: 'Israel struck', text: 'Missiles hit Haifa; the strike was guided from the sea.', odds: (s) => s.meters.I <= 0 ? 1 : 0, fx: '!israel' },
  { name: 'A sub wants out', text: 'A Russian captain signals that the crew wants to defect.', odds: (s) => s.meters.N > 0 && act(s) >= 2 ? 1 : 0, fx: '!defector' },
  { name: 'Carrier hit', text: 'A US carrier is hit by hypersonic missiles. The front sags.', odds: (s) => s.meters.P > 0 ? 1 : 0, fx: 'P-1', repeat: true },
  { name: 'Himalayan clash', text: 'Indian and Chinese troops fight on the border. The pact cracks.', odds: (s) => act(s) >= 2 ? 1 : 0, fx: 'I+1' },
  { name: 'Pakistan joins', text: 'Pakistan\'s navy joins the fight against India.', odds: (s) => act(s) >= 2 ? 1 : 0, fx: 'I+1' },
  { name: 'Tanker war', text: 'Iran sinks three tankers. Oil prices double.', odds: (s) => s.meters.I >= 0 && act(s) >= 2 ? 1 : 0, fx: 'I-1', repeat: true },
  { name: 'Election in Brasília', text: 'A new government in Brazil talks peace.', odds: (s) => act(s) === 3 ? 1 : 0, fx: 'S+1' },
  { name: 'Nuclear alert', text: 'Russia puts its missile subs on alert.', odds: () => 1, fx: 'X+1', repeat: true },
  { name: 'Back channel', text: 'Diplomats find a quiet line to Moscow.', odds: (s) => s.x > 0 ? 1 : 0, fx: 'X-1', repeat: true },
  { name: 'Kazan sighted', text: 'Your rival is spotted heading your way.', odds: (s) => has(s, 'kazan_dead') ? 0 : 1, fx: '!kazan_loose', repeat: true },
  { name: 'Sub down', text: 'An allied sub sends a distress buoy near your next patrol.', odds: () => 0.15, fx: '!V1', repeat: true },
  { name: 'Neutral sub', text: 'A sub with no matching signature is loose nearby.', odds: () => 0.15, fx: '!V2', repeat: true },
  { name: 'Storm', text: 'A gale is forecast over your next patrol area.', odds: () => 0.15, fx: '!V3', repeat: true },
  { name: 'Trawler', text: 'An intelligence trawler is shadowing allied ships.', odds: () => 0.15, fx: '!V4', repeat: true },
  { name: 'Allied mix-up', text: 'An allied frigate reports an "enemy sub" where Tang is headed.', odds: () => 0.15, fx: '!V5', repeat: true },
  { name: 'Low ammo', text: 'Supply ships are late; a tender is sent to meet Tang.', odds: () => 0.15, fx: '!V6', repeat: true },
];
export const newsCard = (name: string) => NEWS.find((n) => n.name === name);

// ---- The war -------------------------------------------------------------------------------------
const theater = (b: 'P' | 'I') => SLOTS.filter((sl) => sl.branch === b);
/**
 * The slots this war plays, in order: Act 1, the first Act 2 theater, the second if the war sends
 * Tang there (without its long way round, since she is already east of Suez or west of Panama),
 * the Polar Front, then Act 3.
 */
function slots(s: WarState): Slot[] {
  const first = s.branch ?? 'P';
  const second = s.second ? theater(s.second).slice(1) : [];
  return [
    ...SLOTS.filter((sl) => sl.act === 1),
    ...theater(first), ...second,
    ...SLOTS.filter((sl) => sl.branch === 'R'),
    ...SLOTS.filter((sl) => sl.act === 3 && sl.branch !== 'R'),
  ];
}
/** Missions in this war as it stands. It grows by eight if Tang is sent to the second theater. */
export const warLength = (s: WarState) => slots(s).length;
export function currentSlot(s: WarState): Slot | undefined {
  return slots(s)[s.history.length];
}
/** After the first theater: does the war send Tang to the other one too? */
function secondTheater(s: WarState): 'P' | 'I' | null {
  const first = s.branch!, other = first === 'P' ? 'I' : 'P';
  return s.meters[other] < 0 || s.meters[first] >= 2 ? other : null;
}

/** Gets the next slot ready: Act 2's front, the counteroffensive, the ending, and the mission on offer. */
function prepare(s: WarState) {
  const n = s.history.length;
  s.offer = [];
  if (s.branch && s.second === undefined && n >= SLOTS.filter((sl) => sl.act === 1).length + theater(s.branch).length) s.second = secondTheater(s);
  if (!currentSlot(s)) return;
  let slot = currentSlot(s)!;
  if (slot.branch && !s.branch) {
    const r = dice(s.seed, n, 1);
    s.branch = s.meters.P < s.meters.I ? 'P' : s.meters.I < s.meters.P ? 'I' : r() < 0.5 ? 'P' : 'I';
    slot = currentSlot(s)!;
  }
  if (slot.title === 'Counteroffensive 1') s.front = weakest(s, dice(s.seed, n, 2));
  if (slot.title === 'The end') s.ending = endingFor(s);
  const afterHub = n > 0 && HUBS.includes(s.history[n - 1].id);
  // Surprises never replace the first mission, a hub, the choice after a hub, the fight at the Pole, the counteroffensive or the end.
  const fixed = n === 0 || afterHub || slot.title.startsWith('Counteroffensive') || slot.title === 'The end' || slot.ids.some((id) => HUBS.includes(id) || id === 'R7');
  if (s.surprise && !fixed) {
    s.offer = [s.surprise];
    s.surprise = null;
    return;
  }
  const r = dice(s.seed, n, 3);
  let ids = slot.ids.slice();
  let w = ids.map((id) => weight(s, WAR_MISSIONS[id].cond));
  if (!w.some((x) => x > 0)) { ids = [ids[0]]; w = [1]; }
  // After a hub the player chooses between two sets of orders.
  const choices = afterHub ? 2 : 1;
  while (s.offer.length < choices && w.some((x) => x > 0)) {
    const i = pick(r, ids, w);
    s.offer.push(ids[i]);
    w[i] = 0;
  }
}

export function newWar(seed: number): WarState {
  const s: WarState = {
    v: 1, seed: seed >>> 0, meters: { N: 0, P: 0, I: 0, S: 0 }, x: 0, flags: [], drawn: [], history: [],
    branch: null, front: null, ending: null, offer: [], surprise: null,
  };
  prepare(s);
  return s;
}

/** Records a mission's result, draws the news and readies the next slot. Returns the news card. */
export function resolve(s: WarState, id: string, win: boolean): NewsCard {
  if (!s.offer.includes(id)) throw new Error(`${id} is not on offer`);
  const m = WAR_MISSIONS[id];
  s.flags = s.flags.filter((f) => f !== 'damaged' && !(m.cond.includes(`f:${f}`)));
  apply(s, win ? m.win : m.lose);
  const n = s.history.length;
  const r = dice(s.seed, n, 4);
  const odds = NEWS.map((c) => {
    const sets = c.fx.startsWith('!') ? c.fx.slice(1) : '';
    if ((sets && has(s, sets)) || (!c.repeat && s.drawn.includes(c.name))) return 0;
    return Math.max(0, c.odds(s));
  });
  const card = NEWS[pick(r, NEWS, odds)];
  s.drawn.push(card.name);
  s.history.push({ id, win, news: card.name });
  // Surprise cards queue their mission instead of setting a flag.
  const surprise = /^!(V\d)$/.exec(card.fx);
  if (surprise) s.surprise = surprise[1];
  else apply(s, card.fx);
  prepare(s);
  return card;
}

export const warOver = (s: WarState) => !currentSlot(s);
