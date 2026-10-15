import { describe, expect, it } from 'vitest';
import { create, excess, inPeriscope, orders, tick, vesselSL, JATM_PER_CANISTER, type Game, type Vessel } from './sim';
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
    expect(g.vessels.map((v) => v.name)).toEqual(['USS Tang (SSN-805)', 'Bismarck', 'Prinz Eugen', 'HMS Suffolk', 'HMS Norfolk', 'Arado Ar 196']);
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

/** Bring Tang to periscope depth at once and put the radar up. */
const radarUp = (g: Game) => { g.own.depthT = 0; orders.depth(g, 0); orders.radar(g, true); };
const contactOf = (g: Game, v: Vessel) => g.contacts.find((c) => c.vid === v.id);

describe('radar', () => {
  it('only works at periscope depth', () => {
    const g = create('bismarck', 3);
    orders.radar(g, true);
    expect(g.own.radar).toBe(false);
    radarUp(g);
    expect(g.own.radar).toBe(true);
    orders.depth(g, 2);
    run(g, 30);
    expect(g.own.radar).toBe(false);
  });
  it('classifies a ship inside 15 nm within a couple of sweeps', () => {
    const g = create('bismarck', 3);
    const bis = g.vessels[1];
    Object.assign(bis, offset(g.own, 40, 12)); freeze(bis, 10);
    radarUp(g);
    run(g, 10);
    const c = contactOf(g, bis)!;
    expect(c.classified).toBe('bismarck');
    expect(Math.hypot(c.est!.x - bis.x, c.est!.y - bis.y)).toBeLessThan(0.5);
  });
  it('sees ships out to 25 nm without identifying them, and nothing beyond', () => {
    const g = create('bismarck', 3);
    const bis = g.vessels[1];
    Object.assign(bis, offset(g.own, 40, 21)); freeze(bis, 0);
    g.vessels.slice(2).forEach((v) => { v.alive = false; });
    radarUp(g);
    run(g, 20);
    const c = contactOf(g, bis)!;
    expect(c.held).toBe(true);
    expect(c.classified).toBeNull();
    const far = create('bismarck', 3);
    Object.assign(far.vessels[1], offset(far.own, 40, 27)); freeze(far.vessels[1], 0);
    far.vessels.slice(2).forEach((v) => { v.alive = false; });
    radarUp(far);
    run(far, 20);
    expect(contactOf(far, far.vessels[1])?.held ?? false).toBe(false);
  });
  it('sees a low helicopter only inside 15 nm, a high patrol plane out to 100 nm', () => {
    const setup = (key: string, range: number) => {
      const g = duel(30);
      const v = g.vessels.find((x) => x.cls.key === key)!;
      g.vessels.forEach((x) => { if (x !== g.own && x !== v) { x.alive = false; x.gone = true; } });
      Object.assign(v, offset(g.own, 0, range)); v.ai = null; v.spd = v.ordSpd = 0;
      radarUp(g);
      run(g, 8);
      return contactOf(g, v);
    };
    expect(setup('ka27', 20)?.held ?? false).toBe(false);
    expect(setup('ka27', 12)?.classified).toBe('ka27');
    expect(setup('il38', 90)?.held).toBe(true);
    expect(setup('il38', 110)?.held ?? false).toBe(false);
  });
});

describe('ASROC', () => {
  it('drops a Mk 54 on the solution that sinks a sub', () => {
    const g = duel(9, 90);
    freeze(g.vessels[1], 4);
    g.vessels[2].alive = false;
    orders.ping(g);
    orders.fire(g, 'asroc');
    expect(g.stats.fired.asroc).toBe(1);
    run(g, 600);
    expect(g.over?.win).toBe(true);
  });
  it('refuses solutions outside 1 to 15 nm', () => {
    const g = duel(20, 90);
    freeze(g.vessels[1], 25);
    run(g, 20);
    const c = g.contacts[0];
    c.est = { x: g.vessels[1].x, y: g.vessels[1].y, t: 0 };
    orders.fire(g, 'asroc');
    expect(c.held).toBe(true);
    expect(g.stats.fired.asroc).toBe(0);
  });
});

describe('air defense', () => {
  const plane = (g: Game, range: number) => {
    const il = g.vessels[2];
    g.vessels[3].alive = false; // keep the helicopter out of these tests
    Object.assign(il, offset(g.own, 0, range));
    il.ai = null; il.hdg = il.ordHdg = 90; il.spd = il.ordSpd = 230;
    return il;
  };
  it('is fire and forget: no target in the cone, it flies off until the fuel runs out', () => {
    const g = duel(30);
    plane(g, 15);
    g.own.depthT = 0; orders.depth(g, 0);
    g.own.hdg = g.own.ordHdg = 180; // aircraft dead astern, outside the ±45° cone
    orders.fire(g, 'jatm');
    expect(g.stats.fired.jatm).toBe(1);
    run(g, 200);
    expect(g.vessels[2].alive).toBe(true);
    expect(g.weapons.some((w) => w.type === 'jatm')).toBe(false);
  });
  it('fired down a bearing without radar, it finds the aircraft itself', () => {
    const g = duel(30);
    const il = plane(g, 30);
    g.own.depthT = 0; orders.depth(g, 0);
    g.own.hdg = g.own.ordHdg = 20; // within 45° of the aircraft's bearing (000)
    for (let i = 0; i < 3 && il.alive; i++) { orders.fire(g, 'sm6'); run(g, 80); }
    expect(il.alive).toBe(false);
  });
  it('JATM shoots down the Il-38, seven rounds to a vertical tube', () => {
    const g = duel(30);
    const il = plane(g, 15);
    radarUp(g);
    run(g, 10);
    const c = contactOf(g, il)!;
    expect(c.classified).toBe('il38');
    g.selected = c.id;
    for (let i = 0; i < 3 && il.alive; i++) { orders.fire(g, 'jatm'); run(g, 40); }
    expect(il.alive).toBe(false);
    expect(g.own.vls.filter((x) => x > 0).length).toBe(1);
    expect(g.own.jatm).toBe(JATM_PER_CANISTER - g.stats.fired.jatm);
  });
  it('SM-6 reaches farther', () => {
    const g = duel(30);
    const il = plane(g, 35);
    radarUp(g);
    run(g, 10);
    g.selected = contactOf(g, il)!.id;
    for (let i = 0; i < 3 && il.alive; i++) { orders.fire(g, 'sm6'); run(g, 80); }
    expect(il.alive).toBe(false);
  });
});

describe('Il-38', () => {
  it('our radar on its ESM brings it in and cues Kazan', () => {
    const g = create('duel', 7);
    const il = g.vessels[2];
    Object.assign(il, offset(g.own, 0, 60));
    radarUp(g);
    run(g, 20);
    expect(il.ai!.mode).toBe('prosecute');
    expect(g.vessels[1].ai!.knows).not.toBeNull();
  });
});

describe('modern ASW aircraft can be heard', () => {
  it('a sonobuoy splash gives a bearing to the aircraft that dropped it', () => {
    const g = create('duel', 7);
    const il = g.vessels[2];
    g.vessels[3].alive = false;
    Object.assign(il, offset(g.own, 60, 3));
    il.ai!.mode = 'search'; il.ai!.center = { x: il.x, y: il.y }; il.ai!.wp = offset(il, 90, 10); il.ai!.buoyT = 0;
    run(g, 3);
    const c = contactOf(g, il)!;
    expect(c?.held).toBe(true);
    expect(c.air).toBe(true);
    expect(Math.abs(angDiff(c.bearing!, 60))).toBeLessThan(15);
  });
  it('a hovering Ka-27 with its sonar in the water is a sonar contact with its own signature', () => {
    const g = create('duel', 7);
    const ka = g.vessels[3];
    g.vessels[2].alive = false;
    Object.assign(ka, offset(g.own, 90, 3));
    ka.ai!.wp = { x: ka.x, y: ka.y };
    run(g, 120);
    expect(ka.ai!.mode).toBe('dip');
    const c = contactOf(g, ka)!;
    expect(c.held).toBe(true);
    expect(c.name.startsWith('Sierra')).toBe(true);
    expect(c.matches[0]?.key).toBe('ka27');
  });
});

describe('1941 aircraft and the periscope', () => {
  it('the Arado is invisible except on radar', () => {
    const g = create('bismarck', 3);
    const ar = g.vessels[5];
    Object.assign(ar, offset(g.own, 0, 6)); ar.ai = null; ar.spd = ar.ordSpd = 0;
    g.own.depthT = 0; orders.depth(g, 0);
    run(g, 60);
    expect(contactOf(g, ar)).toBeUndefined();
    orders.radar(g, true);
    run(g, 10);
    expect(contactOf(g, ar)?.held).toBe(true);
  });
  it('seeing a ship through the periscope fixes it but leaves the identification to the player', () => {
    const g = create('bismarck', 3);
    const bis = g.vessels[1];
    Object.assign(bis, offset(g.own, 40, 5)); freeze(bis, 0);
    g.own.depthT = 0; orders.depth(g, 0);
    run(g, 5);
    const c = contactOf(g, bis)!;
    expect(c.spotted).toBe(true);
    expect(c.classified).toBeNull();
    expect(inPeriscope(g, c)).toBe(bis);
  });
});

describe('hits for the battle camera', () => {
  it('records each of our hits on a ship, the sinking one marked sunk', () => {
    const g = create('bismarck', 5);
    const bis = g.vessels[1];
    Object.assign(bis, offset(g.own, 0, 3)); freeze(bis, 15);
    run(g, 30);
    const c = g.contacts.find((x) => x.vid === bis.id)!;
    g.selected = c.id; c.est = { x: bis.x, y: bis.y, t: g.t }; c.q = 1; c.bias = 0;
    for (let i = 0; i < 4; i++) orders.fire(g, 'mk48');
    run(g, 600);
    const on = g.hits.filter((h) => h.vid === bis.id);
    expect(on.length).toBeGreaterThan(0);
    expect(on.every((h) => h.weapon === 'mk48' && h.kind === 'surface' && h.cls === 'bismarck' && h.name === 'Bismarck')).toBe(true);
    expect(on.at(-1)!.sunk).toBe(!bis.alive);
    expect(on.slice(0, -1).every((h) => !h.sunk)).toBe(true);
    for (let i = 1; i < g.hits.length; i++) expect(g.hits[i].t).toBeGreaterThanOrEqual(g.hits[i - 1].t);
  });
  it('records a surface-to-air kill as an air hit, the same on every run', () => {
    const shoot = () => {
      const g = duel(30);
      const il = g.vessels[2];
      g.vessels[3].alive = false;
      Object.assign(il, offset(g.own, 0, 15)); il.ai = null; il.hdg = il.ordHdg = 90; il.spd = il.ordSpd = 230;
      radarUp(g);
      run(g, 10);
      g.selected = contactOf(g, il)!.id;
      for (let i = 0; i < 3 && il.alive; i++) { orders.fire(g, 'jatm'); run(g, 40); }
      return g.hits;
    };
    const hits = shoot();
    expect(hits.at(-1)).toMatchObject({ weapon: 'jatm', kind: 'air', cls: 'il38', sunk: true });
    expect(shoot()).toEqual(hits);
  });
});
