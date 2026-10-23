// The Red Storm Rising campaign: the war for the Norwegian Sea on one gauge, NATO at one end and the
// Warsaw Pact at the other. Each mission's result and the news between missions move the gauge; where
// it stands decides which forces the Northern Fleet sends out next and where. The war ends when either
// side holds the whole sea, or after CAP missions in a ceasefire. Pure logic: no DOM, deterministic.
import { mulberry32 } from '../math';
import { CLASSES } from '../classes';
import type { Game } from '../sim';
import type { Year } from '../boats';
import { FORCE_PLACES, type Force } from './forces';
import { HULLS, LEVELS, hullFor, parseKey, rsrKey, type Hull } from './index';

export const GAUGE_MIN = -10, GAUGE_MAX = 10, GAUGE_START = -2, CAP = 24;
export type Band = 'pact-big' | 'pact' | 'even' | 'nato' | 'nato-big';
export const bandOf = (gauge: number): Band => (gauge <= -6 ? 'pact-big' : gauge <= -2 ? 'pact' : gauge <= 1 ? 'even' : gauge <= 5 ? 'nato' : 'nato-big');
export const BAND_TEXT: Record<Band, string> = {
  'pact-big': 'The Northern Fleet holds the Norwegian Sea and is reaching for Iceland and Britain.',
  pact: 'The Pact is winning in the north: Soviet troops are in Norway and their fleet is coming south.',
  even: 'The Norwegian Sea is contested. Neither side controls it.',
  nato: 'NATO is pushing north: the convoys are getting through and the Northern Fleet is falling back.',
  'nato-big': 'NATO holds the Norwegian Sea and is carrying the war to the Kola Peninsula and the bastions.',
};

/** What the Northern Fleet sends out, by where the war stands. */
export const POOLS: Record<Band, Force[]> = {
  'pact-big': ['amphib', 'wolfpack', 'spetsnaz', 'convoy'],
  pact: ['amphib', 'wolfpack', 'sag', 'convoy', 'spetsnaz'],
  even: ['sag', 'asw', 'wolfpack', 'convoy', 'cvbg'],
  nato: ['sag', 'asw', 'cvbg', 'airbase', 'bastion'],
  'nato-big': ['bastion', 'airbase', 'cvbg', 'asw'],
};
/** Where a force can be met, by where the war stands: when the Pact is winning big, landings come for Iceland and Britain. */
export function placesFor(force: Force, band: Band): string[] {
  const all = FORCE_PLACES[force];
  const pick = (want: string[]) => { const p = all.filter((x) => want.includes(x)); return p.length ? p : all; };
  if (force === 'amphib' || force === 'spetsnaz') return band === 'pact-big' ? pick(['iceland', 'faroes', 'shetland']) : pick(['vestfjord', 'trondheim', 'lofoten']);
  if (force === 'asw' && band === 'nato-big') return pick(['barents', 'northcape']);
  if (force === 'sag' && (band === 'pact' || band === 'pact-big')) return pick(['giuk', 'faroes', 'janmayen']);
  return all;
}

/** News between missions: what the rest of the war did. Original text; `d` moves the gauge. */
export interface News { name: string; text: string; d: number }
export const NEWS: News[] = [
  { name: 'Backfires broken up', text: 'Tomcats flying from Iceland caught a Backfire raid over the Denmark Strait and shot down eleven. The rest jettisoned their missiles and turned for home.', d: 1 },
  { name: 'Convoy through', text: 'A forty-ship reinforcement convoy has docked in Le Havre and Rotterdam with an armoured division aboard.', d: 2 },
  { name: 'Narvik heights retaken', text: 'Norwegian brigades and US Marines have pushed the Soviet airborne troops off the heights above Narvik.', d: 1 },
  { name: 'The barrier holds', text: 'The SOSUS lines across the gap have tracked three Soviet boats trying to slip south. P-3s sank two of them.', d: 1 },
  { name: 'Kola approaches mined', text: 'British submarines have laid mines across the approaches to the Kola Inlet. A Soviet frigate has already been lost to one.', d: 1 },
  { name: 'Fuel runs short', text: 'Intelligence reports the Soviet army in Germany is short of fuel. The Pact has to fight with what it has.', d: 1 },
  { name: 'Faroes gap', text: 'A Royal Navy frigate group has sunk a Victor in the Faroes gap, and lost none of its own.', d: 1 },
  { name: 'Keflavík holds', text: 'The Icelandic air bases are still in NATO hands after a week of Soviet raids. The runway at Keflavík is repaired every night.', d: 1 },
  { name: 'Backfire raid', text: 'Backfires from Kola caught a convoy south of Iceland. Four ships are lost, two of them troopships.', d: -2 },
  { name: 'Airborne drop on Bardufoss', text: 'Soviet paratroopers have seized the airfield at Bardufoss. MiGs are flying from it by nightfall.', d: -1 },
  { name: 'Keflavík bombed', text: 'A heavy raid has closed the runways at Keflavík for a day. The P-3s are flying from Scotland.', d: -1 },
  { name: 'Frigate lost', text: 'A NATO frigate on convoy escort has been sunk by missiles from a Soviet submarine she never heard.', d: -1 },
  { name: 'Radar sites cut', text: 'Commandos have blown up the radar heads on the Norwegian coast. The early warning line has a hole in it.', d: -1 },
  { name: 'Storms ground the patrols', text: 'Gales across the Norwegian Sea have grounded the P-3s for two days. The Soviet boats have the sea to themselves.', d: -1 },
  { name: 'Northern Fleet sorties', text: 'Satellites show the Northern Fleet putting to sea in strength from Severomorsk and the Kola fjords.', d: -2 },
  { name: 'A quiet week', text: 'Both sides are counting their losses and resupplying. The sea is quiet, for now.', d: 0 },
];

// ---- Scoring: the efficiency rating, medals and rank -----------------------------------------
export const MEDALS = ['Navy Commendation Medal', 'Bronze Star for Valor', 'Silver Star', 'Distinguished Service Medal', 'Navy Cross', 'Medal of Honor'] as const;
export type Medal = (typeof MEDALS)[number];
/** Mission ER needed for each medal, lowest to highest. Only a mission won earns one. */
export const MEDAL_ER = [30, 60, 100, 150, 210, 300];
export const RANKS = ['Commander', 'Captain', 'Rear Admiral', 'Vice Admiral', 'Admiral'] as const;
export type Rank = (typeof RANKS)[number];
/** Career ER needed for each rank. */
export const RANK_ER = [0, 250, 600, 1000, 1500];
export const rankFor = (er: number): Rank => RANKS[RANK_ER.filter((t) => er >= t).length - 1];
export const medalFor = (er: number, win: boolean): Medal | null => {
  const n = win ? MEDAL_ER.filter((t) => er >= t).length : 0;
  return n ? MEDALS[n - 1] : null;
};

/** What a mission's end is scored on: the ships the mission named, everything else sunk, aircraft, and Tomahawk hits ashore. */
export interface Tally { win: boolean; lost: boolean; targets: string[]; others: string[]; aircraft: number; landHits: number }
export function tally(g: Game): Tally {
  const tset = new Set(g.goal.targets);
  const sunk = g.sunk.filter((s) => s.side === 'enemy');
  const byName = (n: string) => g.vessels.find((v) => v.name === n && v.side === 'enemy');
  const ships = sunk.filter((s) => CLASSES[s.cls].kind !== 'air');
  return {
    win: !!g.over?.win, lost: !g.own.alive,
    targets: ships.filter((s) => tset.has(byName(s.name)?.id ?? -1)).map((s) => s.cls),
    others: ships.filter((s) => !tset.has(byName(s.name)?.id ?? -1)).map((s) => s.cls),
    aircraft: sunk.length - ships.length, landHits: g.flags.landHits ?? 0,
  };
}
/** A ship's worth: its damage points, half again for a submarine. */
const worth = (cls: string) => CLASSES[cls].hp * (CLASSES[cls].kind === 'sub' ? 1.5 : 1);
/**
 * The efficiency rating for one mission: 40 for getting the job done, 5 for each damage point of the
 * named force sunk, 2 for anything else, 3 an aircraft and 6 a Tomahawk hit ashore; weighted by the
 * boat (an older boat earns more) and the challenge level. Losing the boat scores nothing.
 */
export function missionER(t: Tally, hull: Hull, year: Year, level: number) {
  if (t.lost) return 0;
  const base = (t.win ? 40 : 0) + 5 * t.targets.reduce((a, c) => a + worth(c), 0) + 2 * t.others.reduce((a, c) => a + worth(c), 0) + 3 * t.aircraft + 6 * t.landHits;
  return Math.round(base * hullFor(hull, year).er * (LEVELS[level]?.er ?? 1));
}

// ---- The war ---------------------------------------------------------------------------------
export type Ending = 'nato' | 'pact' | 'stalemate';
export interface Entry {
  key: string; win: boolean; er: number; medal: Medal | null;
  /** How far the result moved the gauge, and the news card drawn after it. */
  delta: number; news: string; newsD: number; sunk: number;
}
export interface RsrState {
  v: 1; seed: number; boat: Hull; year: Year; level: number;
  gauge: number; history: Entry[]; offer: string[]; ending: Ending | null;
}
const dice = (s: RsrState, salt = 0) => mulberry32((s.seed + 7919 * s.history.length + salt) >>> 0);

/** Two sets of orders to choose from, two different forces from the pool for where the war stands. */
export function offers(s: RsrState): string[] {
  const r = dice(s, 1), band = bandOf(s.gauge), tlam = hullFor(s.boat, s.year).kit.tlam;
  const pool = POOLS[band].filter((f) => f !== 'airbase' || tlam).sort(() => r() - 0.5);
  return pool.slice(0, 2).map((force) => {
    const ps = placesFor(force, band);
    return rsrKey({ force, place: ps[Math.floor(r() * ps.length)], year: s.year, boat: s.boat, level: s.level, variant: Math.floor(r() * 1e6), sim: false });
  });
}
export function newRsr(seed: number, boat: Hull, year: Year, level: number): RsrState {
  const s: RsrState = { v: 1, seed: seed >>> 0, boat: HULLS.includes(boat) ? boat : 'la688', year, level, gauge: GAUGE_START, history: [], offer: [], ending: null };
  s.offer = offers(s);
  return s;
}
export const careerER = (s: RsrState) => s.history.reduce((a, h) => a + h.er, 0);
export const medals = (s: RsrState) => s.history.flatMap((h) => (h.medal ? [h.medal] : []));
export const missionNo = (s: RsrState) => s.history.length + 1;

/** Count a mission played from the offer: score it, move the gauge, draw the news, and see whether the war is over. */
export function resolve(s: RsrState, key: string, t: Tally): Entry {
  const r = dice(s, 2);
  const er = missionER(t, s.boat, s.year, s.level);
  const k = parseKey(key);
  // The bigger prizes move the war further: a carrier, a bastion or the Kola airfields.
  const big = !!k && ['cvbg', 'bastion', 'airbase', 'amphib'].includes(k.force);
  const delta = (t.win ? 1 : -1) * (big || r() < 0.3 ? 3 : 2);
  const card = NEWS[Math.floor(r() * NEWS.length)];
  const e: Entry = { key, win: t.win, er, medal: medalFor(er, t.win), delta, news: card.name, newsD: card.d, sunk: t.targets.length + t.others.length };
  s.history.push(e);
  s.gauge = Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, s.gauge + delta + card.d));
  s.ending = s.gauge >= GAUGE_MAX ? 'nato' : s.gauge <= GAUGE_MIN ? 'pact' : s.history.length >= CAP ? 'stalemate' : null;
  s.offer = s.ending ? [] : offers(s);
  return e;
}
export const newsCard = (name: string) => NEWS.find((n) => n.name === name);
export const ENDINGS: Record<Ending, [string, string]> = {
  nato: ['NATO wins the Norwegian Sea', 'The Northern Fleet is penned in the Barents Sea, its bastions broken and its airfields cratered. With the Atlantic open, the reinforcements pour into Europe, and within a fortnight Moscow asks for terms.'],
  pact: ['The Pact wins the Norwegian Sea', 'Iceland has fallen and the convoys have stopped. Europe is cut off from America, and NATO has to accept a ceasefire on the lines the Soviet army holds.'],
  stalemate: ['Ceasefire', `After ${CAP} missions both sides are exhausted. A ceasefire leaves the Norwegian Sea divided, and nobody calls it a victory.`],
};
