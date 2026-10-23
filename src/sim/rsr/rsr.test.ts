import { describe, expect, it } from 'vitest';
import { create, tick } from '../sim';
import { MISSIONS, objectives } from '../missions';
import { CLASSES } from '../classes';
import { FORCES, FORCE_PLACES, LEVELS, YEARS, hullFor, parseKey, rsrKey, type Force, type Hull } from './index';
import { rosterFor } from './roster';
import {
  CAP, GAUGE_MAX, GAUGE_START, MEDALS, POOLS, bandOf, medalFor, missionER, newRsr, offers, placesFor, rankFor, resolve, type Tally,
} from './campaign';

const key = (force: Force, place: string, year = 1988 as (typeof YEARS)[number], boat: Hull = 'la688', level = 1, variant = 11, sim = false) =>
  rsrKey({ force, place, year, boat, level, variant, sim });
const win: Tally = { win: true, lost: false, targets: ['sovremenny', 'krivak'], others: [], aircraft: 0, landHits: 0 };
const loss: Tally = { ...win, win: false, targets: [] };

describe('Red Storm Rising missions', () => {
  it('every force builds at every place it can be met, in every year, and names a force or a target to hit', () => {
    for (const force of Object.keys(FORCE_PLACES) as Force[]) for (const place of FORCE_PLACES[force]) for (const year of YEARS) {
      const k = key(force, place, year, 'tang');
      const g = create(k, 5);
      expect(g.vessels.length, k).toBeGreaterThan(1);
      // The force to kill, or the airfields to hit, and nothing that isn't a Soviet ship or boat in the goal.
      if (force === 'airbase') expect(g.sites.length, k).toBe(3);
      else {
        expect(g.goal.targets.length, k).toBeGreaterThan(0);
        for (const id of g.goal.targets) expect(g.vessels.find((v) => v.id === id)!.cls.nation, k).toBe('USSR');
      }
      for (let i = 0; i < 300 && !g.over; i++) tick(g, 1);
      expect(objectives(g).length, k).toBeGreaterThan(0);
    }
  });
  it('the briefing names the ships the mission is after', () => {
    for (const force of FORCES) {
      if (force === 'airbase') continue;
      const k = key(force, FORCE_PLACES[force][0]);
      const g = create(k, 2);
      for (const id of g.goal.targets) expect(MISSIONS[k].brief, `${k} ${id}`).toContain(g.vessels.find((v) => v.id === id)!.cls.kind === 'sub' ? CLASSES[g.vessels.find((v) => v.id === id)!.cls.key].name : g.vessels.find((v) => v.id === id)!.name);
    }
  });
  it('every place the player must act in or reach is marked on the plot', () => {
    for (const force of ['amphib', 'convoy', 'wolfpack', 'bastion', 'spetsnaz', 'cms'] as Force[]) {
      const g = create(key(force, FORCE_PLACES[force][0]), 3);
      expect(g.marks?.length, force).toBeGreaterThan(0);
    }
    expect(create(key('kashin', 'barents', 1988, 'la688', 2), 1).marks?.length).toBe(1); // the open water, in the ice
  });
  it('a key builds the same scene from the same seed, and comes back the same mission', () => {
    const k = key('sag', 'giuk');
    expect(MISSIONS[k]).toBe(MISSIONS[k]);
    expect(parseKey(k)).toEqual({ force: 'sag', place: 'giuk', year: 1988, boat: 'la688', level: 1, variant: 11, sim: false });
    const a = create(k, 9), b = create(k, 9);
    for (let i = 0; i < 600; i++) { tick(a, 1); tick(b, 1); }
    expect(a.vessels.map((v) => [v.x, v.y])).toEqual(b.vessels.map((v) => [v.x, v.y]));
    expect(parseKey('rsr:sag:nowhere:1988:la688:1:1')).toBeNull();
    expect(MISSIONS['rsr:bogus']).toBeUndefined();
  });
  it('the boat, year and challenge in the key are the ones sent', () => {
    const g = create(key('duel', 'giuk', 1984, 'sturgeon', 3), 1);
    expect(g.own.cls.key).toBe('sturgeon');
    expect(g.own.kit.mk48).toBe('mk48old');
    expect(g.mods).toEqual(LEVELS[3].mods);
    expect(create(key('november', 'giuk'), 1).mods.dmg).toBe(0); // training
    expect(create(key('kashin', 'barents', 1988, 'la688', 3), 1).env.ice).toBe(true);
    expect(create(key('kashin', 'barents', 1988, 'la688', 1), 1).env.ice).toBe(false);
  });
  it('the Northern Fleet sends the classes in service that year', () => {
    expect(rosterFor(1984).ssn).toContain('november');
    expect(rosterFor(1996).ssn).not.toContain('november');
    expect(rosterFor(1996).ssgn).not.toContain('echo2');
    expect(rosterFor(1984).ssn).not.toContain('akula80');
    expect([rosterFor(1988).carrier, rosterFor(1992).carrier]).toEqual(['kiev', 'kuznetsov80']);
    const g = create(key('cvbg', 'bear', 1996), 1);
    expect(CLASSES[g.vessels.find((v) => v.id === g.goal.targets[0])!.cls.key].name).toBe('Kuznetsov');
  });
});

describe('Red Storm Rising campaign', () => {
  it('starts with the Pact ahead, and offers two different forces from the pool for where the war stands', () => {
    const s = newRsr(42, 'la688', 1988, 1);
    expect(s.gauge).toBe(GAUGE_START);
    expect(s.offer).toHaveLength(2);
    const forces = s.offer.map((k) => parseKey(k)!.force);
    expect(new Set(forces).size).toBe(2);
    for (const f of forces) expect(POOLS[bandOf(s.gauge)]).toContain(f);
  });
  it('a boat without Tomahawks is never sent to strike the Kola airfields', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = newRsr(seed, 'permit', 1984, 1);
      s.gauge = 8;
      expect(offers(s).some((k) => parseKey(k)!.force === 'airbase')).toBe(false);
    }
  });
  it('landings come for Iceland and Britain when the Pact is winning big', () => {
    expect(placesFor('amphib', 'pact-big').every((p) => ['iceland', 'faroes', 'shetland'].includes(p))).toBe(true);
    expect(placesFor('amphib', 'pact').every((p) => ['vestfjord', 'trondheim', 'lofoten'].includes(p))).toBe(true);
  });
  it('a win moves the gauge toward NATO and a loss toward the Pact, with the news on top', () => {
    const s = newRsr(7, 'la688', 1988, 1);
    const e = resolve(s, s.offer[0], win);
    expect(e.delta).toBeGreaterThanOrEqual(2);
    expect(s.gauge).toBe(GAUGE_START + e.delta + e.newsD);
    const before = s.gauge, l = resolve(s, s.offer[0], loss);
    expect(l.delta).toBeLessThanOrEqual(-2);
    expect(s.gauge).toBe(Math.max(-10, before + l.delta + l.newsD));
  });
  it('the war ends at either end of the gauge, or in a ceasefire at the cap', () => {
    const s = newRsr(3, 'la688', 1988, 1);
    s.gauge = GAUGE_MAX - 1;
    for (let i = 0; i < 4 && !s.ending; i++) resolve(s, s.offer[0], win);
    expect(s.ending).toBe('nato');
    expect(s.offer).toEqual([]);
    const p = newRsr(3, 'la688', 1988, 1);
    for (let i = 0; i < 12 && !p.ending; i++) resolve(p, p.offer[0], loss);
    expect(p.ending).toBe('pact');
    const c = newRsr(5, 'la688', 1988, 1);
    for (let i = 0; i < CAP && !c.ending; i++) { resolve(c, c.offer[0], i % 2 ? win : loss); c.gauge = 0; }
    expect(c.ending).toBe('stalemate');
    expect(c.history).toHaveLength(CAP);
  });
});

describe('Red Storm Rising scoring', () => {
  it('weights the efficiency rating by boat and challenge: a Tang counts for less, a Permit for more', () => {
    const tang = missionER(win, 'tang', 1988, 1), la = missionER(win, 'la688', 1988, 1), permit = missionER(win, 'permit', 1988, 1);
    expect(tang).toBeLessThan(la);
    expect(la).toBeLessThan(permit);
    expect(missionER(win, 'la688', 1988, 3)).toBeGreaterThan(missionER(win, 'la688', 1988, 0));
    expect(missionER({ ...win, lost: true }, 'la688', 1988, 1)).toBe(0);
    expect(la).toBe(Math.round((40 + 5 * (6 + 4)) * hullFor('la688', 1988).er));
  });
  it('medals go to missions won, by rating, and rank follows the career rating', () => {
    expect(medalFor(500, false)).toBeNull();
    expect(medalFor(10, true)).toBeNull();
    expect(medalFor(30, true)).toBe(MEDALS[0]);
    expect(medalFor(100, true)).toBe('Silver Star');
    expect(medalFor(1000, true)).toBe('Medal of Honor');
    expect([rankFor(0), rankFor(300), rankFor(700), rankFor(1200), rankFor(5000)]).toEqual(['Commander', 'Captain', 'Rear Admiral', 'Vice Admiral', 'Admiral']);
  });
});
