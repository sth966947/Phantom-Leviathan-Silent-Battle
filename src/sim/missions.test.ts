import { describe, expect, it } from 'vitest';
import { create, tick } from './sim';
import { CAMPAIGN, MISSIONS } from './missions';
import { CLASSES } from './classes';

describe('missions', () => {
  for (const key of [...CAMPAIGN, 'duel' as const]) {
    it(`${key} builds and runs for an hour`, () => {
      const g = create(key, 11);
      expect(g.goal.targets.length).toBeGreaterThan(0);
      for (const v of g.vessels) expect(CLASSES[v.cls.key]).toBeDefined();
      for (const k of MISSIONS[key].library) expect(CLASSES[k], k).toBeDefined();
      for (let i = 0; i < 3600 && !g.over; i++) tick(g, 1);
      expect(g.t).toBeGreaterThan(0);
    });
  }
  it('ships sunk earlier stay sunk', () => {
    const g = create('midway', 3, { sunk: ['Akagi', 'Kaga'] });
    const names = g.vessels.map((v) => v.name);
    expect(names).not.toContain('Akagi');
    expect(names).toContain('Hiryū');
    const all = create('midway', 3, { sunk: ['Akagi', 'Kaga', 'Sōryū', 'Hiryū'] });
    expect(all.vessels.some((v) => v.name === 'Yamato')).toBe(true);
  });
  it('escorts hunt with depth charges that cannot reach 700 feet', () => {
    const g = create('shinano', 5);
    g.own.depthT = 2; g.own.ordDepth = 2;
    const dd = g.vessels.find((v) => v.cls.key === 'kagero')!;
    Object.assign(dd, { x: g.own.x, y: g.own.y + 0.1 });
    g.charges.push({ x: g.own.x, y: g.own.y, t: 1 });
    tick(g, 1);
    expect(g.own.hp).toBe(CLASSES.virginia.hp);
    g.own.depthT = 1; g.own.ordDepth = 1;
    g.charges.push({ x: g.own.x, y: g.own.y, t: g.t + 1 });
    tick(g, 1);
    expect(g.own.hp).toBe(CLASSES.virginia.hp - 1);
  });
});
