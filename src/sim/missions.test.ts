import { describe, expect, it } from 'vitest';
import { create, orders, siteKind, tick } from './sim';
import { CAMPAIGN, MISSIONS, MODERN, PREQUELS, objectives } from './missions';
import { MODERN_MISSIONS } from './modern';
import { CLASSES } from './classes';

describe('missions', () => {
  for (const key of [...CAMPAIGN, ...PREQUELS, ...MODERN, ...Object.keys(MODERN_MISSIONS)]) {
    it(`${key} builds and runs for an hour`, () => {
      const g = create(key, 11);
      expect(g.goal.targets.length + g.sites.length + g.goal.protect.length + (g.script ? 1 : 0)).toBeGreaterThan(0);
      for (const v of g.vessels) expect(CLASSES[v.cls.key]).toBeDefined();
      for (const k of MISSIONS[key].library) expect(CLASSES[k], k).toBeDefined();
      for (let i = 0; i < 3600 && !g.over; i++) tick(g, 1);
      expect(g.t).toBeGreaterThan(0);
      const obs = objectives(g);
      expect(obs.length).toBeGreaterThan(0);
      for (const o of obs) expect(o.text).not.toMatch(/undefined|NaN/);
    });
  }
  it('a land-attack Tomahawk flies to Japan by terrain maps and hits its site', () => {
    const g = create('doolittle', 2);
    g.own.depthT = 1; g.own.ordDepth = 1;
    g.vessels.forEach((v) => { if (v.cls.key === 'picket') { v.alive = false; v.gone = true; } });
    orders.strike(g, g.sites[0].id);
    expect(g.stats.fired.tlam).toBe(1);
    for (let i = 0; i < 6000 && !g.weapons.every((w) => w.type !== 'tlam'); i++) tick(g, 1);
    expect(g.weapons.some((w) => w.type === 'tlam')).toBe(false);
    expect(g.t).toBeGreaterThan(60 * 60);
    // The strike camera's record of the arrival.
    expect(g.strikes).toHaveLength(1);
    expect(g.strikes[0]).toMatchObject({ siteId: g.sites[0].id, siteName: 'Yokosuka naval yard', kind: 'shipyard', weapon: 'TLAM 1', type: 'tlam' });
    expect(g.strikes[0].hit).toBe(g.sites[0].hits === 1);
  });
  it('one Mjolnir on Japan counts as three hits and wins the Doolittle mission', () => {
    const g = create('doolittle', 2);
    g.own.depthT = 1; g.own.ordDepth = 1;
    g.vessels.forEach((v) => { if (v.cls.key === 'picket') { v.alive = false; v.gone = true; } });
    orders.strike(g, g.sites[0].id, 'mjolnir');
    for (let i = 0; i < 6000 && g.weapons.some((w) => w.type === 'mjolnir'); i++) tick(g, 1);
    expect(g.strikes[0]).toMatchObject({ type: 'mjolnir', hit: true });
    expect(objectives(g).find((o) => o.text.startsWith('Land 3 hits on Japan'))?.state).toBe('done');
    for (let i = 0; i < 12000 && !g.over; i++) tick(g, 1);
    expect(g.over).toMatchObject({ win: true });
    expect(g.over!.reason).toContain('3 hits have already landed on Japan');
  });
  it('modern air defence shoots at Mjolnir only as it climbs or dives, with a fifth of its usual chance', () => {
    const fly = (roll: number, run: number) => {
      const g = create('I16', 3);
      g.own.depthT = 1; g.own.ordDepth = 1;
      orders.strike(g, g.sites[0].id, 'mjolnir');
      const w = g.weapons.find((x) => x.type === 'mjolnir')!, kochi = g.vessels.find((v) => v.name.includes('Kochi'))!;
      w.x = kochi.x + 5; w.y = kochi.y; w.run = run;
      w.aim = { x: kochi.x + 205, y: kochi.y };
      g.r = () => roll;
      tick(g, 1);
      return !!w.dead;
    };
    // Climbing out: Kochi's Barak-8 stops a Tomahawk with chance 0.7, so a Mjolnir with 0.14.
    expect(fly(0.13, 0)).toBe(true);
    expect(fly(0.15, 0)).toBe(false);
    // High on its arc, 200 nm from the target: out of reach.
    expect(fly(0, 100)).toBe(false);
  });
  it('a site with no kind gets one from its name', () => {
    const at = { x: 0, y: 0, id: 1, hits: 0 };
    expect(siteKind({ ...at, name: 'Harbour submarine pens' })).toBe('subpens');
    expect(siteKind({ ...at, name: 'Coastal radar station' })).toBe('radar');
    expect(siteKind({ ...at, name: 'Tank farm and refinery' })).toBe('oil');
    expect(siteKind({ ...at, name: 'Naval air base runway' })).toBe('airfield');
    expect(siteKind({ ...at, name: 'Hilltop' })).toBe('base');
    expect(siteKind({ ...at, name: 'Yokohama docks', kind: 'factory' })).toBe('factory');
  });
  it('Match toggles keep following the target until overridden', () => {
    const g = create('duel', 4);
    const kaz = g.vessels.find((v) => v.cls.key === 'yasen')!;
    for (let i = 0; i < 3000 && !g.contacts.some((c) => c.vid === kaz.id && c.held); i++) tick(g, 1);
    const c = g.contacts.find((x) => x.vid === kaz.id && x.held)!;
    expect(c).toBeDefined();
    c.motion ??= { crs: kaz.hdg, spd: kaz.spd }; // as if the solution had firmed up
    g.selected = c.id;
    orders.match(g, 'speed');
    expect(g.flags.matchSpd).toBe(c.id);
    c.motion = { crs: c.motion!.crs, spd: 17 };
    for (let i = 0; i < 10; i++) tick(g, 1);
    if (g.flags.matchSpd) expect(g.own.ordSpd).toBe(Math.round(c.motion!.spd));
    orders.speed(g, 5);
    expect(g.flags.matchSpd).toBe(0);
    expect(g.own.ordSpd).toBe(5);
    // Course and bearing can't both be on, and steering by hand ends them.
    orders.match(g, 'course');
    orders.match(g, 'bearing');
    expect(g.flags.matchCrs).toBe(0);
    expect(g.flags.matchBrg).toBe(c.id);
    for (let i = 0; i < 5; i++) tick(g, 1);
    if (g.flags.matchBrg) expect(Math.abs(((g.own.ordHdg - c.bearing! + 540) % 360) - 180)).toBeLessThan(8);
    orders.turn(g, 10);
    expect(g.flags.matchBrg).toBe(0);
    // Switching targets turns every match off.
    orders.match(g, 'speed');
    orders.match(g, 'course');
    g.selected = -1;
    tick(g, 1);
    expect([g.flags.matchSpd, g.flags.matchCrs, g.flags.matchBrg]).toEqual([0, 0, 0]);
  });
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

describe('Downed Pilots', () => {
  it('shows the raft on the plot, prompts when close, and picks the crew up', () => {
    const g = create('P24', 5);
    const raft = g.marks![0];
    expect(raft.label).toContain('Raft');
    // Deep and right under the raft: told to come up.
    Object.assign(g.own, { x: raft.x, y: raft.y + 0.1, spd: 3, ordSpd: 3, depthT: 2, ordDepth: 2 });
    tick(g, 1);
    expect(g.events.some((e) => e.text.includes('Come up to periscope depth'))).toBe(true);
    // At periscope depth and slow: they come aboard in three minutes.
    g.own.depthT = 0; orders.depth(g, 0);
    for (let i = 0; i < 200 && !g.flags.aboard; i++) { Object.assign(g.own, { x: raft.x, y: raft.y + 0.1, spd: 3, ordSpd: 3 }); tick(g, 1); }
    expect(g.flags.aboard).toBe(1);
    tick(g, 1);
    expect(g.marks![0].r).toBe(8);
  });
});
