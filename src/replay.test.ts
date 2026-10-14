import { describe, expect, it } from 'vitest';
import { create, orders, tick } from './sim/sim';
import { Player, noteSelection, record, recording } from './replay';

describe('replay', () => {
  it('plays a mission back exactly from its seed and orders', () => {
    const seed = 1234, carry = { sunk: [] };
    const g = create('bismarck', seed, carry);
    record(g, 'bismarck', seed, carry);
    for (let i = 0; i < 3000 && !g.over; i++) {
      if (i === 60) orders.depth(g, 0);
      if (i === 200) orders.radar(g, true);
      if (i === 400) { orders.radar(g, false); orders.depthBy(g, 300); orders.speed(g, 10); }
      if (i === 900) { orders.turn(g, 40); g.selected = g.contacts[0]?.id ?? null; }
      if (i === 1500 && g.selected !== null) orders.fire(g, 'mk48');
      noteSelection(g);
      tick(g, 1);
    }
    const r = create('bismarck', seed, carry);
    const p = new Player(r, recording()!);
    for (let i = 0; i < 3000 && !r.over; i++) { p.apply(); tick(r, 1); }
    const where = (x: typeof g) => x.vessels.map((v) => [v.name, v.x.toFixed(6), v.y.toFixed(6), v.alive]);
    expect(where(r)).toEqual(where(g));
    expect(r.stats).toEqual(g.stats);
    // The captain can't give orders to a replay.
    orders.speed(r, 20);
    expect(r.own.ordSpd).toBe(10);
  });
});
