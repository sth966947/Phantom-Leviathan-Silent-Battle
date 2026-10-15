// Balance captains for src/sim/modern/counter.ts.
import { atPeriscopeDepth, orders, type Game } from '../../src/sim/sim';
import { underIce } from '../../src/sim/hazards';
import { angDiff, brg, dist, offset, type Vec } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

/** Torpedo evasion as in the duel: decoy, cross the layer, turn away and sprint, then slow down again. True while evading. */
export function evade(g: Game, i: number, s: CaptainState, snap = true) {
  // Patrol planes and helicopters: a JATM at any one held while we're up.
  if (atPeriscopeDepth(g) && i % 30 === 0 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) {
    const air = g.contacts.find((c) => { const v = g.vessels.find((x) => x.id === c.vid)!; return c.held && c.air && c.bearing !== null && v.alive && v.side === 'enemy' && v.ai?.mode !== 'strike'; });
    if (air) { const keep = g.selected; g.selected = air.id; orders.fire(g, 'jatm'); g.selected = keep; }
  }
  // Whoever just fired at us is hostile: a snap shot back at any sub contact on that bearing.
  for (const e of g.events) {
    const m = /Launch transient, bearing (\d+)/.exec(e.text);
    if (!m) continue;
    const find = () => g.contacts.find((x) => x.held && x.est && !x.air && g.vessels.find((v) => v.id === x.vid)?.cls.kind === 'sub' && Math.abs(angDiff(x.bearing!, Number(m[1]))) < 15);
    // Nothing on that bearing: a quiet diesel boat. One ping finds it.
    let c = find();
    if (!snap) continue;
    if (!c) { orders.ping(g); c = find(); }
    // Not with friendly ships close to it: the seeker can't tell them apart.
    if (c && !g.vessels.some((v) => v.alive && v.side === 'allied' && v.cls.kind === 'surface' && dist(v, c!.est!) < 3)) { const keep = g.selected; g.selected = c.id; orders.fire(g, 'mk48'); if (dist(g.own, c.est!) > 2) orders.fire(g, 'asroc'); g.selected = keep; }
  }
  for (const e of g.events) if (/Torpedo in the water|seeker has acquired us/.test(e.text) && (s.sprintT < 0 || i - s.sprintT > 60)) { orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i; }
  if (s.sprintT >= 0) { if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); } return true; }
  return false;
}
/** Steer for a point, turning away from any mine we have found close ahead. */
export function steerTo(g: Game, i: number, p: Vec, spd: number) {
  if (i % 20) return;
  let hdg = brg(g.own, p);
  const mine = g.mines.find((m) => m.found && m.side !== 'us' && dist(g.own, m) < 0.9 && Math.abs(angDiff(brg(g.own, m), hdg)) < 50);
  if (mine) hdg = brg(g.own, mine) + (angDiff(hdg, brg(g.own, mine)) >= 0 ? 75 : -75);
  orders.heading(g, hdg);
  orders.speed(g, mine ? Math.min(spd, 6) : spd);
}
/** A held contact of one of these classes, with a fair solution, inside `r` nm. */
export const threat = (g: Game, classes: string[], r: number) =>
  g.contacts.some((c) => c.held && c.est && c.q > 0.5 && classes.includes(c.classified ?? c.matches[0]?.key) && dist(g.own, c.est) < r);
const inFlight =(g: Game, id: number) => g.weapons.filter((w) => w.type === 'tlam' && !w.dead && w.contactId === id).length;
/** Fire Tomahawks at each site until hits plus those in flight reach `need` (+ `spare`). Returns true once all are in hand. */
export function strike(g: Game, need: Record<number, number>, spare = 1) {
  let done = true;
  for (const [id, n] of Object.entries(need)) {
    const s = g.sites.find((x) => x.id === Number(id))!;
    if (s.hits >= n) continue;
    done = false;
    if (s.hits + inFlight(g, s.id) < n + spare && g.own.depthT <= 1.05 && !underIce(g)) orders.strike(g, s.id);
  }
  return done;
}

export const captains: Record<string, Captain> = {
  CA1: (g, i, s) => evade(g, i, s) || { minPct: 50 },
  CP1: (g, i, s) => evade(g, i, s) || { extra: ['type039'] },
  CG1: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const marks: [string, Vec][] = [['closedA', { x: g.flags.ax, y: g.flags.ay }], ['closedB', { x: g.flags.bx, y: g.flags.by }]];
    const next = marks.find(([k]) => !g.flags[k]);
    // Deal with a boat or frigate that has found us before going on with the mines.
    // With the channels shut, the boats still at sea are quiet: ping for them now and then.
    if (!next && i % 600 === 300 && !g.contacts.some((c) => c.held && !c.air && ['kilo', 'ghadir'].includes(c.classified ?? c.matches[0]?.key))) orders.ping(g);
    if (!next || threat(g, ['kilo', 'jamaran'], 7)) return { extra: ['kilo', 'ghadir', 'jamaran'], minPct: 50 };
    const p = next[1], r = dist(g.own, p);
    if (g.own.ordDepth !== 1 && i % 60 === 0) orders.depth(g, 1);
    steerTo(g, i, r > 0.5 ? p : { x: p.x + Math.sin(i / 200) * 0.6, y: p.y + Math.cos(i / 200) * 0.6 }, r > 3 ? 10 : 6);
    if (r < 0.8 && i % 130 === 0) orders.layMine(g);
    return true;
  },
  CS1: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // The frigates are round the anchorage, 24 nm south: go ahead of the convoy to find them.
    if (!threat(g, ['tamandare'], 30) && !g.contacts.some((c) => c.held && c.classified === 'tamandare')) { steerTo(g, i, offset({ x: 0, y: 0 }, 170, 18), 10); if (i % 900 === 450) orders.depth(g, 0); if (i % 900 === 600) orders.depth(g, 1); if (atPeriscopeDepth(g)) orders.radar(g, true); return true; }
    return { extra: ['tamandare'] };
  },
  CA2: (g, i, s) => evade(g, i, s) || { extra: ['yasen', 'udaloy', 'gorshkov'] },
  CP2: (g, i, s) => evade(g, i, s) || { extra: ['type055', 'type052d', 'type093b', 'type039'] },
  CG2: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Through the gap in the mines, then up to 150 feet inside 25 nm of the base.
    if (g.own.y < 30.5) { steerTo(g, i, { x: 0, y: 31.5 }, g.own.y > 25 ? 5 : 10); return true; }
    if (i % 60 === 0) orders.depth(g, 1);
    strike(g, { [-1]: 3, [-2]: 2 });
    return { extra: ['jamaran', 'kilo'] };
  },
  CS2: (g, i, s) => evade(g, i, s) || { extra: ['tamandare', 'riachuelo'] },
  CA3: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const open = g.env.polynyas.slice().sort((a, b) => dist(g.own, a) - dist(g.own, b))[0];
    if (!open) return { extra: ['yasen', 'akula'] };
    if (dist(g.own, open) > open.r * 0.6) { steerTo(g, i, open, dist(g.own, open) > 4 ? 14 : 5); return true; }
    if (i % 30 === 0) { orders.speed(g, 2); orders.depth(g, 1); }
    strike(g, { [-1]: 2, [-2]: 2 }, 2);
    return true;
  },
  CP3: (g, i, s) => evade(g, i, s) || { extra: ['type039'] },
  CG3: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Dead reckoning from the brief: 22 nm east at the start, heading 340 at 12 knots. Close to 10 nm of it.
    const dr = offset(offset({ x: 0, y: 0 }, 85, 22), 340, (g.t / 3600) * 12);
    if (dist(g.own, dr) > 10 && !threat(g, ['tanker', 'type901'], 12)) { steerTo(g, i, offset(dr, 340, 4), 16); return true; }
    return { extra: ['tanker', 'type901', 'type093b'], minPct: 50 };
  },
  CS3: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Hits on the empty shiplift (the generic captain fires at every site) don't count.
    if (g.t <= 3600) s.m.pre = g.sites[0].hits;
    if (i % 60 === 0 && g.own.ordDepth !== 1) orders.depth(g, 1);
    strike(g, g.t > 3600 ? { [-1]: (s.m.pre ?? 0) + 2, [-2]: 2 } : { [-2]: 2 }, 2);
    if (threat(g, ['riachuelo', 'tamandare'], 8)) return { extra: ['riachuelo', 'tamandare'] };
    steerTo(g, i, { x: 0, y: 12 }, dist(g.own, { x: 0, y: 12 }) > 2 ? 8 : 3);
    return true;
  },
};
