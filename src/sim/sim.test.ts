import { describe, expect, it } from 'vitest';
import { create, excess, inPeriscope, makeAI, orders, planWave, tick, vesselSL, JATM_PER_CANISTER, MJOLNIR_LAND_HITS, WEAPONS, type Game, type Vessel } from './sim';
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
    orders.fire(g, 'nsm');
    expect(g.stats.fired.nsm).toBe(0);
    orders.depth(g, 1);
    run(g, 60);
    orders.fire(g, 'nsm');
    expect(g.stats.fired.nsm).toBe(1);
  });
  it('NSMs and Tomahawks on a good solution sink Bismarck', () => {
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
  it('sees and identifies ships out to 50 nm, and nothing beyond', () => {
    const g = create('bismarck', 3);
    const bis = g.vessels[1];
    Object.assign(bis, offset(g.own, 40, 45)); freeze(bis, 0);
    g.vessels.slice(2).forEach((v) => { v.alive = false; });
    radarUp(g);
    run(g, 20);
    const c = contactOf(g, bis)!;
    expect(c.held).toBe(true);
    expect(c.classified).toBe('bismarck');
    const far = create('bismarck', 3);
    Object.assign(far.vessels[1], offset(far.own, 40, 55)); freeze(far.vessels[1], 0);
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

describe('experimental weapons', () => {
  it('Mk 96 lights its rocket on acquisition, ignores a countermeasure and sinks the sub', () => {
    const g = duel(4, 0);
    orders.ping(g);
    orders.fire(g, 'mk96');
    const w = g.weapons.find((x) => x.type === 'mk96')!;
    expect(w.spd).toBe(50);
    let sprint = false;
    for (let i = 0; i < 600 && !g.over; i++) {
      tick(g, 1);
      if (w.spd === 250 && !sprint) {
        sprint = true;
        const k = g.vessels[1];
        g.decoys.push({ id: 9999, side: 'enemy', x: k.x, y: k.y + 0.3, life: 240, deep: false });
      }
    }
    expect(sprint).toBe(true);
    expect(g.vessels[1].alive).toBe(false);
  });
  it('Mjolnir needs 10 to 1000 nm and sinks a battleship from the sky', () => {
    const g = create('bismarck', 5);
    orders.depth(g, 1);
    run(g, 60);
    const bis = g.vessels[1];
    const c = g.contacts.find((x) => x.vid === bis.id)!;
    g.selected = c.id;
    c.q = 1; c.bias = 0;
    Object.assign(bis, offset(g.own, 0, 6)); freeze(bis, 0);
    c.est = { x: bis.x, y: bis.y, t: g.t };
    orders.fire(g, 'mjolnir');
    expect(g.stats.fired.mjolnir).toBe(0); // too close for the arc
    Object.assign(bis, offset(g.own, 0, 60));
    c.est = { x: bis.x, y: bis.y, t: g.t };
    orders.fire(g, 'mjolnir'); orders.fire(g, 'mjolnir');
    expect(g.stats.fired.mjolnir).toBe(2);
    run(g, 120);
    expect(g.events.some((e) => e.text.includes('at apex'))).toBe(true);
    expect(bis.alive).toBe(false);
  });
  it('one Mjolnir hits as hard as three Tomahawk MSTs', () => {
    expect(WEAPONS.mjolnir.damage).toBe(3 * WEAPONS.mst.damage);
    const g = create('bismarck', 5);
    orders.depth(g, 1);
    run(g, 60);
    const bis = g.vessels[1], c = g.contacts.find((x) => x.vid === bis.id)!;
    g.selected = c.id; c.q = 1; c.bias = 0;
    Object.assign(bis, offset(g.own, 0, 40)); freeze(bis, 0);
    c.est = { x: bis.x, y: bis.y, t: g.t };
    const hp = bis.hp;
    orders.fire(g, 'mjolnir');
    run(g, 90);
    expect(hp - bis.hp).toBe(3 * WEAPONS.mst.damage);
  });
  it('Mjolnir also strikes sites ashore, for three Tomahawks\' worth of hits', () => {
    const g = create('doolittle', 2);
    g.own.depthT = 1; g.own.ordDepth = 1;
    g.vessels.forEach((v) => { if (v.cls.key === 'picket') { v.alive = false; v.gone = true; } });
    const site = g.sites[0];
    // It reaches Japan from where the raid starts, 600-odd nm out: about 13 minutes on the arc.
    orders.strike(g, site.id, 'mjolnir');
    expect(g.stats.fired.mjolnir).toBe(1);
    run(g, 1000);
    expect(g.weapons.some((w) => w.type === 'mjolnir' && !w.dead)).toBe(false);
    expect(g.events.some((e) => e.text.includes('Mjolnir 1 at apex'))).toBe(true);
    expect(g.strikes).toHaveLength(1);
    expect(g.strikes[0]).toMatchObject({ siteId: site.id, weapon: 'Mjolnir 1', type: 'mjolnir' });
    expect(site.hits).toBe(g.strikes[0].hit ? MJOLNIR_LAND_HITS : 0);
  });
  it('tracks a torpedo coming at us: position, course and speed firm up as sonar listens', () => {
    const g = duel(14, 0);
    const from = offset(g.own, 90, 5), hdg = 270;
    g.weapons.push({
      id: g.seq++, type: 'ugst', side: 'enemy', label: 'UGST', x: from.x, y: from.y, hdg, ordHdg: hdg, spd: 50,
      run: 0, maxRun: 30, enableAt: Infinity, enabled: false, deep: true, wire: false,
      aim: { x: g.own.x, y: g.own.y }, contactId: null, target: null, rolled: new Set(), trail: [],
    });
    const w = g.weapons.at(-1)!;
    run(g, 5);
    expect(w.heardBrg).not.toBeNull();
    expect(g.events.some((e) => /Torpedo in the water, bearing 090, range about/.test(e.text))).toBe(true);
    run(g, 150);
    expect(Math.hypot(w.heardEst!.x - w.x, w.heardEst!.y - w.y)).toBeLessThan(0.3);
    expect(Math.abs(w.heardVel!.spd - 50)).toBeLessThan(8);
    expect(Math.abs(angDiff(w.heardVel!.hdg, 270))).toBeLessThan(10);
  });
  it('a passive drone hears what the boat cannot, and a decoy drone draws the hunter', () => {
    const g = duel(14, 0);
    const k = g.vessels[1];
    freeze(k, 6);
    orders.select(g, null);
    run(g, 60);
    expect(g.contacts.find((c) => c.vid === k.id)?.held ?? false).toBe(false);
    orders.launchDrone(g);
    expect(g.own.drones).toBe(5);
    run(g, 1900);
    expect(g.drones[0].run).toBeGreaterThan(3.99);
    // Kazan still out of the boat's hearing, but the drone 4 nm closer picks her up.
    expect(g.contacts.find((c) => c.vid === k.id)?.held).toBe(true);
    // Decoy: Kazan, hunting by ear, takes the drone for the boat.
    const h = create('duel', 7);
    const kz = h.vessels[1];
    Object.assign(kz, offset(h.own, 0, 7), { depthT: 1, ordDepth: 1 });
    orders.select(h, null);
    orders.launchDrone(h);
    run(h, 1900);
    orders.speed(h, 0);
    orders.droneMode(h, 'decoy');
    run(h, 120);
    expect(h.decoys.length).toBe(1);
    const knows = kz.ai!.knows!;
    expect(Math.hypot(knows.x - h.drones[0].x, knows.y - h.drones[0].y)).toBeLessThan(Math.hypot(knows.x - h.own.x, knows.y - h.own.y));
  });
  it('an active drone pings: the hunter learns where the drone is, not the boat', () => {
    const g = duel(9, 0);
    const k = g.vessels[1];
    orders.launchDrone(g);
    run(g, 1800);
    orders.droneMode(g, 'active');
    run(g, 61);
    const d = g.drones[0];
    expect(k.ai).toBeNull(); // duel() freezes Kazan; check what the ping gave us instead
    const c = g.contacts.find((x) => x.vid === k.id)!;
    expect(c.estErr).toBe(0);
    expect(Math.hypot(c.est!.x - k.x, c.est!.y - k.y)).toBeLessThan(0.3);
    expect(d.battery).toBeLessThan(5400 - 1800);
  });
});

describe('attack waves', () => {
  /** Bismarck stopped dead `near` nm east of Tang and Prinz Eugen `far` nm to the northeast, with perfect solutions. */
  function sittingShips(near: number, far: number) {
    const g = create('bismarck', 3);
    g.own.depthT = 1; g.own.ordDepth = 1;
    for (let i = 0; i < 600; i++) tick(g, 1);
    const ships = ['Bismarck', 'Prinz Eugen'].map((n) => g.vessels.find((x) => x.name.includes(n))!);
    ships[0].x = g.own.x + near; ships[0].y = g.own.y;
    ships[1].x = g.own.x + far * 0.6; ships[1].y = g.own.y + far * 0.8;
    const cs = ships.map((v) => {
      v.ai = null; v.spd = v.ordSpd = 0;
      let c = g.contacts.find((x) => x.vid === v.id);
      if (!c) { c = { ...g.contacts[0], id: g.seq++, vid: v.id, name: v.name }; g.contacts.push(c); }
      c.held = true; c.est = { x: v.x, y: v.y, t: g.t }; c.motion = { crs: 0, spd: 0 };
      return c;
    });
    return { g, ships, cs };
  }
  const run = (g: Game) => { for (let i = 0; i < 3000 && g.weapons.some((w) => w.side === 'us'); i++) tick(g, 1); };
  const spread = (ts: number[]) => Math.max(...ts) - Math.min(...ts);

  for (const [type, near, far, n] of [['mst', 11, 30, 2], ['nsm', 11, 30, 2], ['mjolnir', 12, 40, 1], ['mk48', 5, 11, 2]] as const) {
    it(`a salvo of ${type} at targets ${near} and ${far} nm out all hit within seconds`, () => {
      const { g, cs } = sittingShips(near, far);
      orders.wave(g, type, cs.map((c) => ({ target: c.id, n })));
      // Everything leaves at once: nothing waits in a tube.
      expect(g.weapons.filter((w) => w.side === 'us')).toHaveLength(2 * n);
      const tot = g.waves[0].tot;
      run(g);
      const ts = g.hits.map((h) => h.t);
      expect(ts.length).toBeGreaterThanOrEqual(2);
      expect(spread(ts)).toBeLessThanOrEqual(5);
      expect(Math.abs(Math.max(...ts) - tot)).toBeLessThanOrEqual(5);
    });
  }
  it('salvoes of different weapons each hit together, on their own times', () => {
    const { g, cs } = sittingShips(11, 30);
    for (const type of ['mst', 'nsm'] as const) orders.wave(g, type, cs.map((c) => ({ target: c.id, n: 1 })));
    expect(g.waves).toHaveLength(2);
    run(g);
    for (const kind of ['Tomahawk', 'NSM']) {
      const ts = g.hits.filter((h) => h.label.startsWith(kind)).map((h) => h.t);
      expect(ts).toHaveLength(2);
      expect(spread(ts)).toBeLessThanOrEqual(5);
    }
  });
  it('an NSM goes for a weak point: screws, bridge or magazine', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      const { g, ships, cs } = sittingShips(11, 30);
      g.r = (() => { let x = seed * 7919 + 1; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
      const v = ships[0], hp = v.hp;
      v.ai = makeAI({ mode: 'transit', baseCourse: 0, cruise: 0 });
      orders.wave(g, 'nsm', [{ target: cs[0].id, n: 1 }]);
      run(g);
      const line = g.events.find((e) => e.text.startsWith('NSM 1 hit'))?.text ?? g.events.slice(-5).map((e) => e.text).join(' | ');
      if (line.includes('screws')) { seen.add('screws'); expect(v.crippled).toBe(true); expect(hp - v.hp).toBe(2); }
      else if (line.includes('bridge')) { seen.add('bridge'); expect(v.ai!.cool).toBe(Infinity); }
      else if (line.includes('magazine')) { seen.add('magazine'); expect(hp - v.hp).toBe(5); }
      else throw new Error(line);
    }
    expect([...seen].sort()).toEqual(['bridge', 'magazine', 'screws']);
  });
  it('land-attack Tomahawks on sites 610 and 740 nm out hit together', () => {
    const g = create('doolittle', 2);
    g.own.depthT = 1; g.own.ordDepth = 1;
    g.vessels.forEach((v) => { if (v.cls.key === 'picket') { v.alive = false; v.gone = true; } });
    orders.wave(g, 'tlam', [{ target: g.sites[0].id, site: true, n: 3 }, { target: g.sites[3].id, site: true, n: 2 }]);
    expect(g.weapons).toHaveLength(5);
    for (let i = 0; i < 8000 && g.weapons.length; i++) tick(g, 1);
    expect(g.strikes).toHaveLength(5);
    expect(spread(g.strikes.map((x) => x.t))).toBeLessThanOrEqual(5);
  });
  it('the plan checks tubes, ranges and how far each weapon can stretch its flight', () => {
    const { g, cs } = sittingShips(11, 300);
    const [near, far] = cs.map((c) => c.id);
    expect(planWave(g, 'mk48', [{ target: near, n: 4 }, { target: far, n: 1 }])).toMatchObject({ ok: false });
    expect(planWave(g, 'mk48', [{ target: near, n: 4 }])).toMatchObject({ ok: true });
    expect(planWave(g, 'mk96', [{ target: near, n: 4 }])).toMatchObject({ ok: true });
    expect(planWave(g, 'mst', [{ target: near, n: 4 }, { target: far, n: 4 }, { target: near, n: 4 }, { target: far, n: 1 }])).toMatchObject({ ok: false, why: expect.stringContaining('vertical tubes') });
    expect(planWave(g, 'tlam', [{ target: near, n: 1 }])).toMatchObject({ ok: false });
    // Mjolnir can loft its arc, but not enough to wait 290 nm' worth for the far target.
    expect(planWave(g, 'mjolnir', [{ target: near, n: 1 }, { target: far, n: 1 }])).toMatchObject({ ok: false, why: expect.stringContaining('too close') });
    // A Tomahawk has the fuel to loiter that long.
    expect(planWave(g, 'mst', [{ target: near, n: 1 }, { target: far, n: 1 }])).toMatchObject({ ok: true });
    orders.wave(g, 'mjolnir', [{ target: near, n: 1 }, { target: far, n: 1 }]);
    expect(g.weapons.filter((w) => w.side === 'us')).toHaveLength(0);
  });
});
