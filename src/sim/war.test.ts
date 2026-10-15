import { describe, expect, it } from 'vitest';
import { HUBS, WAR_MAX, WAR_MIN, newWar, resolve, warOver, type WarState } from './war';
import { WAR_MISSIONS } from './warData';

/** Plays a whole war, winning each mission with probability `p`, always taking the first offer. */
function play(seed: number, p: number, roll = Math.random) {
  const s = newWar(seed);
  while (!warOver(s)) resolve(s, s.offer[0], roll() < p);
  return s;
}
function rng(seed: number) { let a = seed; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); }

describe('modern war', () => {
  it('runs 30 missions with one Act 2 theater, or 38 with both, always through the Polar Front', () => {
    const r = rng(1);
    let both = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s = play(seed, 0.3 + r() * 0.6, r);
      const ids = s.history.map((h) => h.id);
      const pac = ids.some((id) => /^P\d/.test(id)), gulf = ids.some((id) => /^I\d/.test(id));
      expect(s.history.length).toBe(pac && gulf ? WAR_MAX : WAR_MIN);
      expect(!!s.second).toBe(pac && gulf);
      if (pac && gulf) both++;
      expect(ids).toContain('R7');
      expect(s.ending).not.toBeNull();
    }
    expect(both).toBeGreaterThan(40);
    expect(both).toBeLessThan(360);
  });

  it('plays the same war again from the same seed and results', () => {
    const results = Array.from({ length: WAR_MAX }, (_, i) => i % 3 !== 0);
    const run = () => { const s = newWar(42); let i = 0; while (!warOver(s)) resolve(s, s.offer[0], results[i++]); return s.history; };
    expect(run()).toEqual(run());
  });

  it('offers a choice of two missions after each hub', () => {
    const r = rng(7);
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s: WarState = newWar(seed);
      while (!warOver(s)) {
        const prev = s.history[s.history.length - 1]?.id;
        if (prev && HUBS.includes(prev)) { expect(s.offer.length).toBe(2); checked++; }
        resolve(s, s.offer[s.offer.length - 1], r() < 0.6);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('reaches every mission', () => {
    const seen = new Set<string>();
    const r = rng(3);
    for (let seed = 1; seed <= 6000; seed++) for (const h of play(seed, [0.45, 0.65, 0.85][seed % 3], r).history) seen.add(h.id);
    expect(Object.keys(WAR_MISSIONS).filter((id) => !seen.has(id))).toEqual([]);
  }, 60_000);

  it('rewards playing well', () => {
    const r = rng(9);
    const wins = (p: number) => { let v = 0; for (let seed = 1; seed <= 1500; seed++) if (play(seed, p, r).ending === 'Victory') v++; return v / 1500; };
    expect(wins(0.85)).toBeGreaterThan(0.5);
    expect(wins(0.45)).toBeLessThan(0.1);
  }, 60_000);
});
