import { describe, expect, it } from 'vitest';
import { create, orders, slotWeapon, tick, torpSL, type Game } from './sim';
import { MISSIONS } from './missions';
import { BOATS, TANG, boatFor, inService, YEARS } from './boats';
import { CLASSES, REFERENCE } from './classes';
import { CLASSES_80S } from './classes80s';
import { subSpec } from '../ui/models';
import { silOf } from '../ui/periscope';
import { offset } from './math';

const run = (g: Game, secs: number) => { for (let i = 0; i < secs && !g.over; i++) tick(g, 1); };
/** The duel with another boat in Tang's place. */
function duelIn(b: ReturnType<typeof boatFor>, seed = 7, mods = {}) {
  const key = `test-${b.key}-${seed}`;
  MISSIONS[key] = { ...MISSIONS.duel, key, boat: b, mods };
  return create(key, seed);
}
/** Kazan stopped above the layer at a range and bearing. */
function place(g: Game, range: number, bearing = 0) {
  const k = g.vessels[1];
  Object.assign(k, offset(g.own, bearing, range), { depthT: 1, ordDepth: 1 });
  k.ai = null; k.spd = k.ordSpd = 0;
  return k;
}

describe('boat profiles', () => {
  it('every mission without a boat of its own still sends Tang, and plays exactly as before', () => {
    // Fingerprints taken on the code before boat profiles existed: 40 minutes of each mission, seed 7.
    const before: Record<string, [string, number, number]> = {
      duel: ['-66.032612', 20, 3], bismarck: ['1370.314971', 4, 4], A26: ['1209.139342', 13, 3],
      P27: ['-1064.810809', 38, 9], vortex: ['-111.252927', 17, 1], midway: ['-310.228479', 17, 16],
    };
    for (const [key, [sum, events, contacts]] of Object.entries(before)) {
      const g = create(key, 7);
      expect(g.own.name).toBe('USS Tang (SSN-805)');
      expect(g.own.kit).toBe(TANG.kit);
      expect([g.own.tubes.length, g.own.vls.length, g.own.drones, g.own.blackwings]).toEqual([4, 12, 6, 4]);
      run(g, 2400);
      expect(g.vessels.reduce((a, v) => a + v.x * 3 + v.y * 7 + v.hp, 0).toFixed(6), key).toBe(sum);
      expect([g.events.length, g.contacts.length], key).toEqual([events, contacts]);
    }
  });
  it('Tang fires what each button says', () => {
    const g = create('duel', 1);
    for (const k of ['mk48', 'nsm', 'mst', 'asroc', 'jatm', 'sm6', 'mk96', 'mjolnir'] as const) expect(slotWeapon(g, k)).toBe(k);
  });
  it('a 1984 Sturgeon has the old Mk 48, Harpoon and SUBROC, and no Tomahawks or vertical tubes', () => {
    const g = duelIn(boatFor('sturgeon', 1984));
    expect(g.own.name).toBe('USS Pargo (SSN-650)');
    expect(g.own.cls.key).toBe('sturgeon');
    expect([g.own.tubes.length, g.own.vls.length, g.own.drones, g.own.blackwings]).toEqual([4, 0, 0, 0]);
    expect([slotWeapon(g, 'mk48'), slotWeapon(g, 'nsm'), slotWeapon(g, 'mst'), slotWeapon(g, 'asroc'), slotWeapon(g, 'jatm'), slotWeapon(g, 'mk96')])
      .toEqual(['mk48old', 'harpoon', null, 'subroc', null, null]);
    orders.fire(g, 'mst');
    expect(g.weapons).toHaveLength(0);
    expect(g.events.at(-1)?.text).toMatch(/doesn't carry/);
  });
  it('a 1980s boat fires a Tomahawk from a torpedo tube unless it has vertical tubes', () => {
    for (const [b, bank] of [['sturgeon', 'tubes'], ['la688i', 'vls']] as const) {
      const g = duelIn(boatFor(b, 1988));
      place(g, 20, 0);
      g.own.depthT = g.own.ordDepth = 1;
      const k = g.vessels[1];
      k.cls = CLASSES.udaloy; // a ship to shoot at
      orders.ping(g);
      g.contacts[0].est = { x: k.x, y: k.y, t: 0 };
      orders.fire(g, 'mst');
      expect(g.weapons[0]?.type, b).toBe('tasm');
      expect(g.own[bank].some((x) => x > 0), b).toBe(true);
    }
  });
  it('a Seawolf swims her torpedoes out quietly; older boats blow them out loudly', () => {
    for (const [b, quiet] of [['seawolf', true], ['la688', false]] as const) {
      const g = duelIn(boatFor(b, 1996));
      place(g, 5, 0);
      orders.ping(g);
      orders.fire(g, 'mk48');
      const w = g.weapons[0];
      expect(w.type).toBe('mk48');
      expect(torpSL(w) < 140, b).toBe(quiet);
    }
  });
  it('SUBROC\'s depth bomb sinks a submarine close to where it goes off', () => {
    const g = duelIn(boatFor('permit', 1984));
    const k = place(g, 10, 0);
    g.own.depthT = g.own.ordDepth = 1;
    orders.ping(g);
    orders.fire(g, 'asroc');
    expect(g.weapons[0]?.type).toBe('subroc');
    run(g, 120);
    expect(k.alive).toBe(false);
    expect(g.over?.win).toBe(true);
  });
  it('the mast Stinger needs periscope depth and takes no tube', () => {
    const g = duelIn(boatFor('la688i', 1992));
    expect(g.own.stingers).toBe(4);
    orders.fire(g, 'jatm');
    expect(g.weapons).toHaveLength(0);
    g.own.depthT = g.own.ordDepth = 0;
    orders.fire(g, 'jatm');
    expect(g.weapons[0]?.type).toBe('stinger');
    expect(g.own.stingers).toBe(3);
    expect(g.own.tubes.every((x) => x === 0)).toBe(true);
  });
  it('a training fight\'s hits do no damage, and the top challenge level gives no crew matches', () => {
    const g = duelIn(boatFor('la688', 1988), 7, { dmg: 0 });
    g.own.hp = 5;
    g.weapons.push({ ...{ id: 999, type: 'ugst', side: 'enemy', label: 'x', x: g.own.x, y: g.own.y + 0.01, hdg: 180, ordHdg: 180, spd: 50, run: 2, maxRun: 13, enableAt: 0, enabled: true, deep: false, wire: false, aim: g.own, contactId: null, target: g.own, targetKind: 'vessel', rolled: new Set(), trail: [] } });
    run(g, 3);
    expect(g.own.alive).toBe(true);
    const h = duelIn(boatFor('la688', 1988), 8, { noId: true });
    place(h, 3, 0);
    run(h, 200);
    expect(h.contacts[0]?.held).toBe(true);
    expect(h.contacts[0].matches).toEqual([]);
  });
  it('the boats offered each year are the ones in service', () => {
    expect(YEARS.filter((y) => inService('seawolf', y))).toEqual([1996]);
    expect(YEARS.filter((y) => inService('la688i', y))).toEqual([1988, 1992, 1996]);
    expect(BOATS.every((b) => inService(b, 1988) || b === 'seawolf')).toBe(true);
  });
  it('every 1980s class has an ID-book entry and a look in the periscope and the battle camera', () => {
    for (const [k, c] of Object.entries(CLASSES_80S)) {
      expect(REFERENCE[k], k).toBeDefined();
      if (c.kind === 'sub') expect(subSpec(k).len === 90 && subSpec(k).beam === 9, k).toBe(false);
      else expect(silOf(k)?.kind, k).toBe(c.kind === 'air' ? 'air' : 'ship');
    }
  });
});
