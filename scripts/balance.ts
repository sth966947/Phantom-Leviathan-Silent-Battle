// Plays many seeded games with simple scripted captains and prints the outcome mix.
// Run with: npx vite-node scripts/balance.ts
import { create, orders, tick, type Game } from '../src/sim/sim';
import { brg, dist } from '../src/sim/math';

const med = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

function duelCaptain(g: Game, i: number, s: { legs: number; lastLeg: number }) {
  const c = g.contacts[0];
  if (c?.held && i - s.lastLeg > 240) { s.lastLeg = i; orders.heading(g, c.bearing! + (s.legs++ % 2 ? 50 : -50)); orders.speed(g, 6); }
  if (!c?.held && i % 600 === 0) { orders.turn(g, 70); orders.speed(g, 8); }
  if (c?.held && c.q > 0.55 && c.est && dist(g.own, c.est) < 8 && !g.weapons.some((w) => w.side === 'us' && !w.dead)) orders.fire(g, 'mk48');
  for (const e of g.events) if (/Torpedo in the water/.test(e.text)) { orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); }
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

for (const key of ['duel', 'bismarck'] as const) {
  const res: Record<string, number> = {};
  const mins: number[] = [];
  for (let seed = 1; seed <= 100; seed++) {
    const g = create(key, seed);
    const s = { legs: 0, lastLeg: 0 };
    for (let i = 0; i < 10800 && !g.over; i++) {
      tick(g, 1);
      if (key === 'duel') duelCaptain(g, i, s); else bismarckCaptain(g, i);
      g.events.length = 0;
    }
    const out = g.over ? (g.over.win ? 'win' : g.over.reason) : 'timeout';
    res[out] = (res[out] ?? 0) + 1;
    if (g.over) mins.push(Math.round(g.over.t / 60));
  }
  console.log(key, res, 'median minutes', med(mins));
}
