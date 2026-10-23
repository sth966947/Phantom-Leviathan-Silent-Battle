// Balance captains for src/sim/modern/fleets.ts.
// Each plays from what the player sees: the brief, contacts, matches, solutions, the log and the objectives.
import { atPeriscopeDepth, orders, type Contact, type Game } from '../../src/sim/sim';
import { brg, dist } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

export const captains: Record<string, Captain> = {};

const vesselOf = (g: Game, c: Contact) => g.vessels.find((v) => v.id === c.vid)!;
const guess = (c: Contact, min = 60) => c.classified ?? (c.matches[0]?.pct > min ? c.matches[0].key : null);
/** Torpedo evasion as in the duel: decoy, cross the layer, turn away and sprint, then slow down again. True while sprinting. */
function evade(g: Game, i: number, s: CaptainState) {
  for (const e of g.events) if (/Torpedo in the water|seeker has acquired us/.test(e.text) && (s.sprintT < 0 || i - s.sprintT > 60)) {
    orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i;
  }
  if (s.sprintT < 0) return false;
  if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); return false; }
  return true;
}
/** Shoot back down the bearing of a launch transient, at a held contact there. */
function shootBack(g: Game) {
  for (const e of g.events) {
    const m = /Launch transient, bearing (\d+)/.exec(e.text);
    if (!m) continue;
    const b = Number(m[1]);
    const c = g.contacts.find((x) => x.held && x.est && !x.air && Math.abs(((brg(g.own, x.est) - b + 540) % 360) - 180) < 20 && dist(g.own, x.est) < 10);
    if (!c) continue;
    const keep = g.selected; g.selected = c.id; orders.fire(g, 'mk48'); g.selected = keep;
  }
}
/** Before the generic captain: dodge torpedoes, and JATM any patrol plane or helicopter while we're up. */
function guard(g: Game, i: number, s: CaptainState) {
  shootBack(g);
  if (evade(g, i, s)) return true;
  if (atPeriscopeDepth(g) && i % 20 === 0 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) {
    const a = g.contacts.find((c) => c.held && c.air && c.bearing !== null && vesselOf(g, c).alive && vesselOf(g, c).side === 'enemy');
    if (a) { const keep = g.selected; g.selected = a.id; orders.fire(g, 'jatm'); g.selected = keep; }
  }
  return false;
}
/** Close on the loudest contact that isn't one of `skip` until the signature firms up. */
function closeOnNoise(g: Game, i: number, skip: string[], spd = 8) {
  const c = g.contacts.filter((x) => x.held && !x.air && x.bearing !== null && !skip.includes(guess(x, 45) ?? '')).sort((a, b) => b.seAvg - a.seAvg)[0];
  if (c && i % 120 === 0) { orders.heading(g, c.bearing!); orders.speed(g, spd); }
  return !!c;
}

// Carrier groups: close on the noise until a target's signature firms up, then hunt with the generic captain.
const group = (want: string[], skip: string[], extra: string[] = [], min = 50): Captain => (g, i, s) => {
  if (guard(g, i, s)) return true;
  const seen = g.contacts.filter((c) => c.est && want.includes(guess(c, min) ?? '') && g.vessels.find((v) => v.id === c.vid)?.alive);
  const t = seen.find((c) => c.held);
  if (t) { s.m.lx = t.est!.x; s.m.ly = t.est!.y; s.m.lt = i; }
  if (t || g.contacts.some((c) => c.held && c.est && extra.includes(guess(c, min) ?? ''))) return { extra, minPct: min };
  // Lost the big ship: run to where she was last held, as a player would, then listen again.
  if (seen.length && s.m.lt !== undefined && i - s.m.lt < 3600 && i % 120 === 0) {
    const p = { x: s.m.lx, y: s.m.ly };
    orders.heading(g, brg(g.own, p)); orders.speed(g, dist(g.own, p) > 3 ? 15 : 6);
    return true;
  }
  closeOnNoise(g, i, skip);
  return true;
};
// Kuznetsov and two escorts wins as well as Kuznetsov and the battlecruiser.
captains.A26 = group(['kuznetsov', 'kirov'], ['yasen', 'il38', 'ka27'], ['udaloy', 'gorshkov']);
captains.P27 = group(['shandong', 'fujian', 'type055'], ['type093b', 'kq200', 'ka28']);

// Landings: the landing ships are the goal, and any landing craft in reach is worth a torpedo on the way.
const landing = (craft: string): Captain => (g, i, s) => (guard(g, i, s) ? true : { extra: [craft], minPct: 50 });
captains.A27 = landing('serna');
captains.P28 = landing('type726');
