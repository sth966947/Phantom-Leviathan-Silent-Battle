import { describe, expect, it } from 'vitest';
import { create, excess, orders, tick, vesselSL, type Game, type Vessel } from './sim';
import { angDiff, offset } from './math';
import { CLASSES, LIBRARY } from './classes';
import { matchClasses, signatureView } from './signature';

const run = (g: Game, secs: number) => { for (let i = 0; i < secs && !g.over; i++) tick(g, 1); };
/** Take a vessel off AI control, steaming straight at a fixed speed. */
const freeze = (v: Vessel, spd = 0) => { v.ai = null; v.spd = v.ordSpd = spd; };

/** Duel with Kazan placed at a given range/bearing, stopped and above the layer. */
function duel(range: number, bearing = 0, seed = 7): Game {
  const g = create('duel', seed);
  const k = g.vessels[1];
  Object.assign(k, offset(g.own, bearing, range), { depthT: 1, ordDepth: 1 });
  freeze(k);
  return g;
}

describe('sonar equation', () => {
  const lis = { x: 0, y: 0, hdg: 0, spd: 5, depthT: 1 };
  it('going fast deafens the listener', () => {
    const src = { x: 0, y: 5, depthT: 1 };
    expect(excess(130, src, { ...lis, spd: 25 }, 20)).toBeLessThan(excess(130, src, lis, 20));
  });
  it('the baffles are deaf without the towed array, and covered with it', () => {
    const astern = { x: 0, y: -1, depthT: 1 };
    expect(excess(140, astern, lis, 20)).toBe(-99);
    expect(excess(140, astern, { ...lis, array: true }, 20)).toBeGreaterThan(0);
  });
  it('crossing the layer costs signal', () => {
    expect(excess(120, { x: 0, y: 3, depthT: 2 }, lis, 20)).toBeLessThan(excess(120, { x: 0, y: 3, depthT: 1 }, lis, 20));
  });
});

describe('signatures', () => {
  it('a faint contact shows few lines and is ambiguous; a strong one is identified', () => {
    const lib = LIBRARY['1941'];
    const faint = signatureView(CLASSES.bismarck, 2, 27, () => 0);
    const strong = signatureView(CLASSES.bismarck, 20, 27, () => 0);
    expect(faint.lines.length).toBeLessThan(strong.lines.length);
    expect(matchClasses(faint, lib, null)[0].pct).toBeLessThan(60);
    expect(matchClasses(strong, lib, null)[0].key).toBe('bismarck');
    expect(matchClasses(strong, lib, null)[0].pct).toBeGreaterThan(90);
  });
  it('Bismarck and Prinz Eugen share their strongest line', () => {
    const one = signatureView(CLASSES.hipper, 1, 27, () => 0);
    const keys = matchClasses(one, LIBRARY['1941'], null).slice(0, 2).map((m) => m.key).sort();
    expect(keys).toEqual(['bismarck', 'hipper']);
  });
});

describe('duel', () => {
  it('is deterministic for a seed', () => {
    const a = create('duel', 42), b = create('duel', 42);
    run(a, 1800); run(b, 1800);
    expect(a.own.x).toBe(b.own.x);
    expect(a.vessels[1].x).toBe(b.vessels[1].x);
  });
  it('detects a slow target at a few miles when quiet', () => {
    const g = duel(4, 0);
  freeze(g.vessels[1], 8);
    run(g, 120);
    const c = g.contacts[0];
    expect(c.held).toBe(true);
    expect(Math.abs(angDiff(c.bearing!, 0))).toBeLessThan(5);
  });
  it('a pinged, stationary sub is sunk by a Mk 48', () => {
    const g = duel(5, 90);
    orders.ping(g);
    orders.fire(g, 'mk48');
    run(g, 900);
    expect(g.over?.win).toBe(true);
  });
  it('wire parts at high speed', () => {
    const g = duel(10, 0);
    orders.fire(g, 'mk48');
    orders.speed(g, 32);
    run(g, 200);
    expect(g.weapons.find((w) => w.side === 'us')?.wire).toBe(false);
  });
});

describe('Sink the Bismarck', () => {
  it('starts with the German group ahead and the British shadowing astern of it', () => {
    const g = create('bismarck', 3);
    expect(g.vessels.map((v) => v.name)).toEqual(['USS Tang (SSN-805)', 'Bismarck', 'Prinz Eugen', 'HMS Suffolk', 'HMS Norfolk']);
    expect(vesselSL(g.vessels[1])).toBeGreaterThan(vesselSL(g.own));
  });
  it('hears the battleship group at long range', () => {
    const g = create('bismarck', 3);
    run(g, 300);
    expect(g.contacts.some((c) => c.held && c.vid === g.vessels[1].id)).toBe(true);
  });
  it('missiles need 150 ft or shallower', () => {
    const g = create('bismarck', 3);
    run(g, 300);
    orders.depth(g, 2);
    run(g, 120);
    orders.fire(g, 'harpoon');
    expect(g.stats.fired.harpoon).toBe(0);
    orders.depth(g, 1);
    run(g, 60);
    orders.fire(g, 'harpoon');
    expect(g.stats.fired.harpoon).toBe(1);
  });
  it('Harpoons and Tomahawks on a good solution sink Bismarck', () => {
    const g = create('bismarck', 5);
    run(g, 60);
    const bis = g.vessels[1];
    g.selected = g.contacts.find((c) => c.vid === bis.id)!.id;
    orders.ping(g); // exact fix is fine for this test, even at long range
    const c = g.contacts.find((x) => x.vid === bis.id)!;
    c.q = 1; c.bias = 0; c.est = { x: bis.x, y: bis.y, t: g.t };
    for (let i = 0; i < 12; i++) { orders.fire(g, 'mst'); c.est = { x: bis.x, y: bis.y, t: g.t }; }
    run(g, 900);
    expect(bis.alive).toBe(false);
    expect(g.over?.win).toBe(true);
  });
  it('sinking a British cruiser fails the mission', () => {
    const g = create('bismarck', 5);
    const suf = g.vessels[3];
    Object.assign(suf, offset(g.own, 0, 3)); freeze(suf, 15);
    run(g, 30);
    const c = g.contacts.find((x) => x.vid === suf.id)!;
    g.selected = c.id; c.est = { x: suf.x, y: suf.y, t: g.t }; c.q = 1; c.bias = 0;
    for (let i = 0; i < 4; i++) orders.fire(g, 'mk48');
    run(g, 600);
    expect(g.over?.win).toBe(false);
    expect(g.stats.blueOnBlue).toBeGreaterThan(0);
  });
});
