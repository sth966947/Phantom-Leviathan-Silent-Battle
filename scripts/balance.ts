// Plays many seeded games with simple scripted captains and prints the outcome mix.
// Run with: npx vite-node scripts/balance.ts
import { atPeriscopeDepth, create, isFriendlyClass, orders, targetContact, tick, type Game } from '../src/sim/sim';
import { CLASSES } from '../src/sim/classes';
import { CAMPAIGN } from '../src/sim/missions';
import { brg, dist } from '../src/sim/math';

const med = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

function duelCaptain(g: Game, i: number, s: { legs: number; lastLeg: number; sprintT: number }) {
  const c = g.contacts.find((x) => x.vid === g.vessels[1].id);
  if (c?.held && i - s.lastLeg > 240) { s.lastLeg = i; orders.heading(g, c.bearing! + (s.legs++ % 2 ? 50 : -50)); orders.speed(g, 6); }
  if (!c?.held && i % 600 === 0) { orders.turn(g, 70); orders.speed(g, 8); }
  if (c?.held && c.q > 0.55 && c.est && dist(g.own, c.est) < 8 && !g.weapons.some((w) => w.side === 'us' && !w.dead)) orders.fire(g, 'mk48');
  for (const e of g.events) if (/Torpedo in the water/.test(e.text)) { orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i; }
  if (s.sprintT >= 0 && i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); } // slow down again once clear
  // Every 15 minutes, a look around at periscope depth: radar sweep, and a JATM at any aircraft.
  if (i % 900 === 450 && s.sprintT < 0) orders.depth(g, 0);
  if (atPeriscopeDepth(g)) {
    orders.radar(g, true);
    const air = targetContact(g, true);
    if (air && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) orders.fire(g, 'jatm');
    if (i % 900 > 600) { orders.radar(g, false); orders.depth(g, 1); }
  }
}

/** Uses only what the player sees: contacts, suggested matches and solutions. */
function bismarckCaptain(g: Game, i: number) {
  const bis = g.contacts.find((c) => c.held && (c.classified === 'bismarck' || (c.matches[0]?.key === 'bismarck' && c.matches[0].pct > 60)));
  if (!bis?.est) { if (i % 300 === 0) orders.speed(g, 5); return; }
  g.selected = bis.id;
  if (bis.classified !== 'bismarck') orders.classify(g, bis.id, 'bismarck');
  const r = dist(g.own, bis.est);
  if (i % 120 === 0) { orders.heading(g, brg(g.own, bis.est)); orders.speed(g, r > 12 ? 15 : 6); }
  if (bis.q > 0.6 && r < 30 && i % 60 === 0) orders.fire(g, 'mst');
  if (bis.q > 0.6 && r < 8 && i % 60 === 0) orders.fire(g, 'mk48');
}

/**
 * A generic WWII captain: knows which classes the mission wants sunk (from the briefing), and
 * otherwise only uses contacts, matches and solutions. Goes deep when depth charges are about.
 */
function wwiiCaptain(g: Game, i: number, s: { deepT: number }) {
  const want = new Set(g.goal.targets.map((id) => g.vessels.find((v) => v.id === id)!.cls.key));
  const guess = (c: (typeof g.contacts)[number]) => c.classified ?? (c.matches[0]?.pct > 80 ? c.matches[0].key : null);
  for (const e of g.events) if (/Depth charges|sonar has us|sighted our periscope/.test(e.text)) { s.deepT = i; orders.depth(g, 2); orders.speed(g, 5); }
  const deep = i - s.deepT < 900;
  if (!deep && g.own.ordDepth === 2 && i % 60 === 0) orders.depth(g, 1);
  const tgts = g.contacts.filter((c) => c.held && c.est && !c.air && guess(c) && want.has(guess(c)!) && !isFriendlyClass(guess(c)));
  tgts.sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!));
  const t = tgts[0];
  if (!t) { if (i % 600 === 0) { orders.turn(g, 60); orders.speed(g, 6); } return; }
  g.selected = t.id;
  if (!t.classified) orders.classify(g, t.id, guess(t)!);
  const r = dist(g.own, t.est!);
  const sub = CLASSES[guess(t)!].kind === 'sub';
  if (i % 120 === 0) { orders.heading(g, brg(g.own, t.est!)); orders.speed(g, deep ? 5 : r > 10 ? 15 : 6); }
  if (t.q > 0.6 && r < 8 && i % 90 === 0) orders.fire(g, 'mk48');
  if (!sub && !deep && t.q > 0.6 && r < 30 && r > 4 && i % 120 === 0) orders.fire(g, 'mst');
  if (sub && !deep && t.q > 0.6 && r > 1 && r < 15 && i % 120 === 0) orders.fire(g, 'asroc');
}

const only = process.argv[2];
for (const key of only ? [only as 'duel'] : (['duel', ...CAMPAIGN] as const)) {

  const res: Record<string, number> = {};
  const mins: number[] = [];
  const n = key === 'duel' || key === 'bismarck' ? 100 : 30;
  for (let seed = 1; seed <= n; seed++) {
    const g = create(key, seed);
    const s = { legs: 0, lastLeg: 0, sprintT: -1, deepT: -1e9 };
    for (let i = 0; i < Math.min(18000, g.timeLimit + 5) && !g.over; i++) {
      tick(g, 1);
      if (key === 'duel') duelCaptain(g, i, s); else if (key === 'bismarck') bismarckCaptain(g, i); else wwiiCaptain(g, i, s);
      g.events.length = 0;
    }
    const out = g.over ? (g.over.win ? 'win' : g.over.reason) : 'timeout';
    res[out] = (res[out] ?? 0) + 1;
    if (g.over) mins.push(Math.round(g.over.t / 60));
  }
  console.log(key, res, 'median minutes', med(mins));
}
