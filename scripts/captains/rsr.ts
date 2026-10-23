// Balance captains for the Red Storm Rising missions (src/sim/rsr). They know what the player knows:
// the briefing (where the force was and what it is), the marks on the plot, contacts, matches,
// solutions and the log. One captain per force; the generated missions all share them.
import { atPeriscopeDepth, orders, type Game } from '../../src/sim/sim';
import { brg, dist, offset, type Vec } from '../../src/sim/math';
import { parseKey } from '../../src/sim/rsr';
import { CLASSES } from '../../src/sim/classes';
import { evade, hunt, quarry, attack } from './arctic';
import type { Captain, CaptainState } from './index';

const goTo = (g: Game, i: number, p: Vec, spd: number) => { if (i % 30 === 0) { orders.heading(g, brg(g.own, p)); orders.speed(g, spd); } };
/** The classes the briefing says to sink. */
const wanted = (g: Game) => [...new Set(g.goal.targets.map((id) => g.vessels.find((v) => v.id === id)!.cls.key))];
/** Where the briefing put the force at the start (its first ship), as the player would plot it. */
function briefed(g: Game, s: CaptainState): Vec {
  if (s.m.bx === undefined) {
    const v = g.vessels.find((x) => x.id === g.goal.targets[0]) ?? g.vessels[1];
    s.m.bx = v.x; s.m.by = v.y; s.m.bc = v.hdg; s.m.bs = v.spd;
  }
  return { x: s.m.bx, y: s.m.by };
}
/** A dead-reckoned spot ahead of the briefed group: where it will be in `t` seconds on its briefed course. */
const ahead = (g: Game, s: CaptainState, t: number) => offset(briefed(g, s), s.m.bc, (s.m.bs * Math.min(t, g.t + t)) / 3600);
/** Shoot down a patrol plane or helicopter held while at periscope depth, with whatever the boat carries. */
function airDefence(g: Game, i: number) {
  if (!atPeriscopeDepth(g) || i % 20 || g.weapons.some((w) => (w.type === 'jatm' || w.type === 'stinger') && !w.dead)) return;
  const a = g.contacts.find((c) => c.held && c.air && c.bearing !== null && g.vessels.find((v) => v.id === c.vid)?.alive);
  if (a) { const keep = g.selected; g.selected = a.id; orders.fire(g, 'jatm'); g.selected = keep; }
}

const guessOf = (c: Game['contacts'][number], min = 50) => c.classified ?? (c.matches[0]?.pct > min ? c.matches[0].key : null);
/**
 * Surface groups: run in toward where the group will be, close on the loudest noise until a named class
 * firms up, then hand over to the generic captain to hunt it. Lost it: back to where it was last held.
 */
const group: Captain = (g, i, s) => {
  if (evade(g, i, s)) return true;
  airDefence(g, i);
  const want = wanted(g);
  const t = g.contacts.find((c) => c.held && c.est && want.includes(guessOf(c) ?? ''));
  if (t) { s.m.lx = t.est!.x; s.m.ly = t.est!.y; s.m.lt = i; return { minPct: 50 }; }
  if (s.m.lt !== undefined && i - s.m.lt < 1800) { const p = { x: s.m.lx, y: s.m.ly }; goTo(g, i, p, dist(g.own, p) > 3 ? 12 : 5); return true; }
  const loud = g.contacts.filter((c) => c.held && !c.air && c.bearing !== null).sort((a, b) => b.seAvg - a.seAvg)[0];
  if (loud && i % 120 === 0) { orders.heading(g, loud.bearing!); orders.speed(g, 8); return true; }
  if (loud) return true;
  // Head across the group's track, a few miles ahead of it, sprinting and drifting to listen.
  const p = ahead(g, s, 1800);
  goTo(g, i, p, dist(g.own, p) > 4 ? (i % 600 < 300 ? 12 : 5) : 5);
  return true;
};
/** Landings and convoys: get across the line between them and the mark, then hunt the named ships. */
const runIn: Captain = (g, i, s) => {
  if (evade(g, i, s)) return true;
  airDefence(g, i);
  const want = wanted(g);
  const mark = g.marks![0];
  const p = briefed(g, s);
  const t = quarry(g, want, 50, s, i);
  if (t) { attack(g, i, s, t, 8, 14); return true; }
  // A point a third of the way from the group to its destination: they will come to us.
  const c = { x: p.x + (mark.x - p.x) * 0.35, y: p.y + (mark.y - p.y) * 0.35 };
  goTo(g, i, c, dist(g.own, c) > 3 ? 12 : 4);
  return true;
};
/** Submarines: move toward the briefed spot (or a mark), slow, and hunt the named classes. */
const subHunt = (spot: (g: Game, s: CaptainState) => Vec): Captain => (g, i, s) => {
  if (evade(g, i, s)) return true;
  // Below the layer after boats, above it after ships.
  const ships = wanted(g).every((k) => CLASSES[k].kind === 'surface');
  if (i % 60 === 0 && !g.env.ice) orders.depth(g, ships ? 1 : i % 1200 < 600 ? 2 : 1);
  hunt(g, i, s, wanted(g), spot(g, s), 50);
  return true;
};
/** The Kola strike: Tomahawks out from 150 feet, a few at a time, then deep and away from the datum. */
const strike: Captain = (g, i, s) => {
  if (evade(g, i, s)) return true;
  const flying = g.weapons.filter((w) => w.type === 'tlam' && !w.dead).length;
  const hits = g.flags.landHits ?? 0;
  // Two at a time, then deep and away from the datum for a while before the next pair.
  // Away means away from the hunters the briefing put on the plot.
  if (s.m.away === undefined) { const h = g.vessels.find((v) => v.side === 'enemy' && v.cls.kind === 'surface'); s.m.away = h ? brg(h, g.own) : 0; }
  if (hits + flying < 6 && i - (s.m.shotT ?? -1e9) > 900) {
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    orders.speed(g, 5);
    if (g.own.depthT > 1.05) return true;
    const before = g.stats.fired.tlam;
    orders.strike(g, g.sites[(s.m.n ?? 0) % g.sites.length].id);
    if (g.stats.fired.tlam > before) { s.m.n = (s.m.n ?? 0) + 1; if (s.m.n % 2 === 0) s.m.shotT = i; }
    return true;
  }
  if (i - (s.m.shotT ?? -1e9) < 900) { if (i % 60 === 0) { orders.depth(g, 2); orders.heading(g, s.m.away); orders.speed(g, 12); } return true; }
  if (i % 60 === 0) orders.speed(g, 5);
  return true;
};

export const RSR_CAPTAINS: Record<string, Captain> = {
  sag: group, cvbg: group, asw: group,
  amphib: runIn, convoy: runIn,
  wolfpack: subHunt((g, s) => briefed(g, s)),
  bastion: subHunt((g) => g.marks![0]),
  spetsnaz: subHunt((g, s) => { const p = briefed(g, s), m = g.marks![0]; return { x: p.x + (m.x - p.x) * 0.4, y: p.y + (m.y - p.y) * 0.4 }; }),
  cms: subHunt((g, s) => briefed(g, s)),
  duel: subHunt((g, s) => briefed(g, s)), november: subHunt((g, s) => briefed(g, s)), kashin: subHunt((g, s) => briefed(g, s)),
  airbase: strike,
};
export const rsrCaptain: Captain = (g, i, s) => RSR_CAPTAINS[parseKey(g.scenario)!.force](g, i, s);
