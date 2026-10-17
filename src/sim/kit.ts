// Building blocks shared by every mission file: placing ships, goals, scripted events,
// modern-war helpers, and the pause screen's objective list.

import { brg, dist, offset, type Vec } from './math';
import { fireStraight, log, makeAI, makeVessel, shellfire, type AI, type Game, type Goal, type Side, type Vessel } from './sim';

/** A mission's key: a WWII battle by name, or a modern war mission by its war id (A8, P3, R1...). */
export type MissionKey = string;

/** What earlier missions changed: the names of enemy ships Tang has already sunk. */
export interface Carry { sunk: string[] }

export interface Mission {
  key: MissionKey; title: string; era: '1941' | '2029'; place: string; date: string;
  night?: boolean; library: string[]; brief: string;
  build: (g: Game, r: () => number, carry: Carry) => void;
  /** Which modern mission file it lives in (set by modern/index.ts). */
  file?: string;
}
/** Extra or replacement objectives for one mission, given the ones read from its goal. */
export type ObjectiveFn = (g: Game, base: Objective[]) => Objective[];

// ---- Placing ships and running the script ------------------------------------------------------
export function add(g: Game, cls: string, name: string, side: Side, p: Vec, hdg: number, spd: number, ai?: Partial<AI>, depth: 0 | 1 | 2 = 0): Vessel {
  const v = makeVessel(g, cls, name, side, p, hdg, spd, depth);
  if (ai) v.ai = makeAI(ai);
  g.vessels.push(v);
  return v;
}
/** Ships keeping station on a leader at the given relative bearings and ranges. */
export function screen(g: Game, lead: Vessel, cls: string, names: string[], spots: [number, number][], side: Side = lead.side) {
  return names.map((n, i) => {
    const [rel, rng] = spots[i % spots.length];
    return add(g, cls, n, side, offset(lead, lead.hdg + rel, rng), lead.hdg, lead.spd, { mode: 'station', leader: lead.id, rel, rng });
  });
}
export const RING: [number, number][] = [[0, 3], [60, 3], [120, 3], [180, 3], [240, 3], [300, 3], [30, 5], [330, 5]];
export const setGoal = (g: Game, o: Partial<Goal>) => Object.assign(g.goal, o);
export const alive = (carry: Carry, name: string) => !carry.sunk.includes(name);
export const ids = (vs: Vessel[]) => vs.map((v) => v.id);
export const clock = (h: number, m = 0) => h * 3600 + m * 60;

/** Each alive carrier puts a strike flight in the air toward `target`. */
export function launchStrike(g: Game, carriers: Vessel[], target: Vec, wave: string) {
  const up = carriers.filter((c) => c.alive);
  for (const c of up) {
    const v = add(g, 'kate', `${wave} flight (${c.name})`, 'enemy', offset(c, brg(c, target), 1), brg(c, target), 140, { mode: 'strike', goal: target, cruise: 140 });
    v.track = [];
  }
  if (up.length) log(g, 'warn', `Radio intercepts: the carriers are launching the ${wave.toLowerCase()}. ${up.length} strike flight${up.length > 1 ? 's' : ''} outbound. Radar at periscope depth will see them high up out to 100 nm.`);
  g.flags.flightsLaunched = (g.flags.flightsLaunched ?? 0) + up.length;
}
/** Run the script once at time t. */
export const at = (g: Game, t: number, key: string, fn: () => void) => { if (g.t >= t && !g.flags[key]) { g.flags[key] = 1; fn(); } };

export const JP_DD = ['Kagerō', 'Shiranui', 'Isokaze', 'Hamakaze', 'Tanikaze', 'Urakaze', 'Arare', 'Kasumi', 'Yukikaze', 'Amatsukaze'];

/** Hits from bombs or aircraft torpedoes: like gunfire, but the aircraft is already gone. */
export function bombed(g: Game, at: Vessel, by: string) {
  if (!at.alive) return;
  at.hp -= 1;
  g.blasts.push({ x: at.x, y: at.y, t: g.t, missile: false });
  if (at.hp > 0) return;
  at.alive = false;
  g.sunk.push({ name: at.name, cls: at.cls.key, side: at.side, by: 'enemy' });
  log(g, at.side === 'enemy' ? 'good' : 'danger', `${at.name} has been hit by ${by} and is sinking.`, 'boom');
}

/** Strike flights sent at ships. Each homes on its ship and, if it gets there, scores hits. */
export interface Raid { flight: Vessel; target: Vessel; done: boolean }
export function raid(g: Game, raids: Raid[], from: Vec, targets: Vessel[], cls: string, names: string[], cruise = 170) {
  const live = targets.filter((t) => t.alive);
  if (!live.length) return;
  names.forEach((n, i) => {
    const target = live[i % live.length];
    const p = offset(from, brg(from, target) + 90, (i - (names.length - 1) / 2) * 2);
    const flight = add(g, cls, n, 'enemy', p, brg(p, target), cruise, { mode: 'strike', goal: { x: target.x, y: target.y }, cruise });
    flight.track = [];
    raids.push({ flight, target, done: false });
  });
  log(g, 'warn', `Radar and radio intercepts: ${names.length} enemy strike flights inbound, bearing ${Math.round(brg(g.own, from)).toString().padStart(3, '0')}. Radar at periscope depth sees them high up out to 100 nm; SM-6 and JATM can bring them down.`);
}
/** Run every tick: keep each flight homing on its ship; when one arrives, it drops `hits` with chance `p` each. */
export function pressRaids(g: Game, raids: Raid[], hits: number, p: number, by: string) {
  for (const rd of raids) {
    if (rd.done) continue;
    if (rd.flight.alive && rd.target.alive) rd.flight.ai!.goal = { x: rd.target.x, y: rd.target.y };
    if (!rd.flight.gone) { if (!rd.flight.alive) rd.done = true; continue; }
    rd.done = true;
    log(g, 'danger', `${rd.flight.name} is attacking ${rd.target.name}!`, 'alarm');
    for (let i = 0; i < hits; i++) if (g.r() < p) bombed(g, rd.target, by);
  }
}

/**
 * A gunnery and torpedo fight between two forces: every 20 s, ships within range trade fire.
 * `b` is usually the Allied side, scaled down so Tang still has the fight to win.
 */
export const GUN: Record<string, number> = { battleship: 0.22, battlecruiser: 0.2, 'heavy cruiser': 0.13, 'light cruiser': 0.1, destroyer: 0.07 };
export function melee(g: Game, a: Vessel[], b: Vessel[], range = 6, torpsA = false, torpsB = false, scaleA = 1, scaleB = 0.5) {
  if (g.t % 20) return;
  for (const x of a) for (const y of b) {
    if (!x.alive || !y.alive) continue;
    const d = dist(x, y);
    if (d > range) continue;
    const near = 1 - d / (range * 1.4);
    shellfire(g, x, y, (GUN[x.cls.type] ?? 0.06) * near * scaleA);
    shellfire(g, y, x, (GUN[y.cls.type] ?? 0.06) * near * scaleB);
    for (const [s, t, ok] of [[x, y, torpsA], [y, x, torpsB]] as const) {
      if (!ok || !/destroyer|cruiser/.test(s.cls.type) || d > 4 || g.flags[`tt${s.id}`]) continue;
      g.flags[`tt${s.id}`] = 1;
      fireStraight(g, s, offset(t, t.hdg, (t.spd * d) / 40));
    }
  }
}
/** Ships at anchor or stopped: they stay put until something sets them moving. */
export const moored = (g: Game, cls: string, name: string, side: Side, p: Vec, hdg: number) => add(g, cls, name, side, p, hdg, 0, { mode: 'transit', baseCourse: hdg, cruise: 0, legT: 1e9 });
export const go = (course: number, cruise: number, legT = 900): Partial<AI> => ({ mode: 'transit', baseCourse: course, cruise, legT });

// ---- Modern war building blocks ---------------------------------------------------------------
export const held = (g: Game, v: Vessel) => !!g.contacts.find((c) => c.vid === v.id)?.held;
/** A ship or aircraft that got where it was going: it leaves the area alive, not sunk. */
export function arrive(g: Game, v: Vessel, p: Vec, within: number) {
  if (!v.alive || dist(v, p) >= within) return false;
  v.alive = false; v.gone = true;
  return true;
}
/** Anti-ship missiles at a group: each gets through the escorts' air defence with chance `p`; a hit does `dmg`. */
export function missileSalvo(g: Game, from: string, missile: string, n: number, targets: Vessel[], p: number, dmg: number, at = 'the convoy') {
  log(g, 'danger', `Vampire, vampire! ${from} has fired ${n} ${missile} missiles at ${at}.`, 'alarm');
  for (let i = 0; i < n; i++) {
    const live = targets.filter((t) => t.alive);
    if (!live.length) return;
    if (g.r() > p) { log(g, 'info', `The escorts shot down ${/^[aeiou]/i.test(missile) ? 'an' : 'a'} ${missile}.`); continue; }
    const t = live[Math.floor(g.r() * live.length)];
    for (let k = 0; k < dmg; k++) bombed(g, t, `${/^[aeiou]/i.test(missile) ? 'an' : 'a'} ${missile}`);
  }
}
/**
 * Mjolnir is ballistic: on a long shot it is up in the thin upper atmosphere, out of reach,
 * until it comes almost straight down on the target at Mach 6. Air defence sees it, but can
 * only shoot while it climbs out (its first MJOLNIR_DIVE_NM) or dives (its last MJOLNIR_DIVE_NM),
 * and seldom gets it:
 * a defence that stops a Tomahawk or Harpoon with chance `p` stops a Mjolnir with chance
 * `p` × MJOLNIR_AD.
 */
export const MJOLNIR_AD = 0.2, MJOLNIR_DIVE_NM = 15;
/** A Mjolnir high on its arc, past the climb and not yet in the dive, where no air defence can reach it. */
export const high = (w: Vec & { type: string; aim: Vec; run: number }) => w.type === 'mjolnir' && w.run > MJOLNIR_DIVE_NM && dist(w, w.aim) > MJOLNIR_DIVE_NM;
export const adP = (w: { type: string }, p: number) => (w.type === 'mjolnir' ? p * MJOLNIR_AD : p);
/** Modern warships' close-in air defence: each of our anti-ship missiles that gets within 3 nm of one is shot down with chance `p`. */
export function pointDefence(g: Game, ships: Vessel[], p: number) {
  for (const w of g.weapons) {
    if (w.dead || w.side !== 'us' || (w.type !== 'harpoon' && w.type !== 'mst' && w.type !== 'mjolnir') || high(w) || g.flags[`pd${w.id}`]) continue;
    const by = ships.find((v) => v.alive && dist(v, w) < 3);
    if (!by) continue;
    g.flags[`pd${w.id}`] = 1;
    if (g.r() < adP(w, p)) { w.dead = true; log(g, 'warn', `${by.name} shot down ${w.label}.`); }
  }
}
/** Steer a patrolling submarine along a course while it doesn't know we're there. */
export function keepCourse(v: Vessel, course: number, spd: number) {
  if (v.alive && v.ai?.mode === 'patrol') { v.ordHdg = course; v.ordSpd = spd; }
}

/**
 * Fights Tang only hears: allied boats and ships against the enemy. Once a minute, each live
 * allied unit with a foe inside `range` nm may get a shot off (chance `pAlly`), and each foe with
 * an ally inside range may shoot back (chance `pFoe`). A shot is a torpedo or missile that hits
 * with chance `pHit` for 5 damage (enough for any sub, most of a frigate). The log reports what
 * Tang's sonar would hear: launch transients, explosions and breaking-up noises.
 */
export function skirmish(g: Game, allies: Vessel[], foes: Vessel[], range = 6, pAlly = 0.2, pFoe = 0.15, pHit = 0.6) {
  if (g.t % 60) return;
  const nearest = (v: Vessel, list: Vessel[]) => list.filter((x) => x.alive && dist(x, v) < range && x.cls.kind !== 'air')
    .sort((a, b) => dist(a, v) - dist(b, v))[0];
  const shoot = (from: Vessel, at: Vessel) => {
    const b = Math.round(brg(g.own, at)).toString().padStart(3, '0');
    log(g, 'contact', `Sonar: weapon launch transients near bearing ${b}. ${from.side === 'enemy' ? 'Enemy' : from.name} firing${from.side === 'enemy' ? ` on ${at.name}` : ''}.`);
    g.blasts.push({ x: at.x, y: at.y, t: g.t, missile: false });
    if (g.r() > pHit) return log(g, 'info', `Sonar: the weapon on bearing ${b} ran past without a hit.`);
    at.hp -= 5;
    if (at.hp > 0) return log(g, at.side === 'enemy' ? 'good' : 'danger', `Explosion on bearing ${b}: ${at.side === 'enemy' ? 'an enemy unit' : at.name} is hit and slowing.`, 'boom');
    at.alive = false;
    g.sunk.push({ name: at.name, cls: at.cls.key, side: at.side, by: from.side });
    log(g, at.side === 'enemy' ? 'good' : 'danger', `Explosion on bearing ${b}, then breaking-up noises: ${at.side === 'enemy' ? `${from.name} has sunk an enemy ${at.cls.type}` : `${at.name} is sinking`}.`, 'boom');
  };
  for (const a of allies) { if (!a.alive) continue; const f = nearest(a, foes); if (f && g.r() < pAlly) shoot(a, f); }
  for (const f of foes) { if (!f.alive) continue; const a = nearest(f, allies); if (a && g.r() < pFoe) shoot(f, a); }
}
/** Point an allied boat at a spot: allied subs take no orders from the AI, only from the mission script. */
export function steer(v: Vessel, to: Vec, spd: number) {
  if (!v.alive) return;
  v.ordHdg = brg(v, to); v.ordSpd = dist(v, to) < 0.5 ? 0 : spd;
}

// ---- Objectives: what the pause screen lists, live ---------------------------------------------
export interface Objective { text: string; state: 'done' | 'open' | 'failed'; detail?: string }

export const mins = (s: number) => {
  const m = Math.max(0, Math.ceil(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
export const listNames = (vs: Vessel[]) => {
  const names = vs.map((v) => v.name);
  return names.length <= 4 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.length} ships`;
};
export const byId = (g: Game, ids: number[]) => ids.map((id) => g.vessels.find((v) => v.id === id)!).filter(Boolean);
export const isSunk = (v: Vessel) => !v.alive && !v.gone;

/** Objectives read straight from the mission goal: what to sink, what to keep afloat, and the clock. */
export function baseObjectives(g: Game): Objective[] {
  const gl = g.goal, out: Objective[] = [];
  const tg = byId(g, gl.targets);
  if (tg.length && gl.need <= tg.length) {
    const sunk = tg.filter(isSunk).length, left = tg.filter((v) => v.alive).length;
    const what = gl.need === tg.length ? (tg.length === 1 ? tg[0].name : `all of ${listNames(tg)}`) : `${gl.need} of ${listNames(tg)}`;
    const away = tg.filter((v) => v.gone).length;
    out.push({
      text: `Sink ${what}`,
      state: sunk >= gl.need ? 'done' : sunk + left < gl.need ? 'failed' : 'open',
      detail: tg.length > 1 || gl.need > 1 ? `${sunk} of ${gl.need} sunk${away ? `, ${away} got away` : ''}. ${sunk >= gl.need ? '' : `${gl.need - sunk} more to go.`}` : sunk ? 'Sunk.' : 'Still afloat.',
    });
  }
  const pr = byId(g, gl.protect).filter((v) => v.side !== 'enemy');
  if (pr.length && Number.isFinite(gl.maxLosses)) {
    const lost = pr.filter(isSunk).length;
    out.push({
      text: gl.maxLosses === 0 ? `Keep ${listNames(pr)} afloat` : `Lose no more than ${gl.maxLosses} of ${listNames(pr)}`,
      state: lost > gl.maxLosses ? 'failed' : g.over?.win ? 'done' : 'open',
      detail: lost ? `${lost} lost so far.${lost === gl.maxLosses ? ' One more and the mission fails.' : ''}` : 'None lost so far.',
    });
  }
  if (Number.isFinite(g.timeLimit)) {
    const left = g.timeLimit - g.t;
    out.push(gl.surviveWin
      ? { text: `Hold out for ${mins(g.timeLimit)}`, state: left <= 0 ? 'done' : 'open', detail: `${mins(left)} to go.` }
      : { text: `Finish within ${mins(g.timeLimit)}`, state: left <= 0 && !g.over?.win ? 'failed' : 'open', detail: `${mins(left)} left.${gl.timeout ? ` If time runs out: ${gl.timeout}` : ''}` });
  }
  return out;
}

export const watch = (text: string, failed: boolean, detail?: string): Objective => ({ text, state: failed ? 'failed' : 'open', detail });
export const flag = (g: Game, k: string) => g.flags[k] ?? 0;
export const named = (g: Game, cls: string) => g.vessels.find((v) => v.cls.key === cls && v.side === 'enemy');
