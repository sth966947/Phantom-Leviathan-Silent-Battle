// Balance captains for src/sim/modern/chance.ts.
import { atPeriscopeDepth, orders, type Contact, type Game } from '../../src/sim/sim';
import { brg, dist, offset, type Vec } from '../../src/sim/math';
import { airDefence, attack, evade, guess, hunt, listen, quarry } from './arctic';
import type { Captain } from './index';

const goTo = (g: Game, i: number, p: Vec, spd: number) => { if (i % 30 === 0) { orders.heading(g, brg(g.own, p)); orders.speed(g, spd); } };
const byName = (g: Game, start: string) => g.vessels.find((v) => v.name.startsWith(start));
/** The held contact on a vessel (only to pick which contact the player would be looking at). */
const contactOn = (g: Game, vid?: number): Contact | undefined => g.contacts.find((c) => c.vid === vid && c.held && c.est);

export const captains: Record<string, Captain> = {
  V1: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Warships at 12 knots are loud and tall: come up 6 nm short of Delaware, radar on, and Tomahawk them.
    if (i < 1500) { goTo(g, i, { x: 0, y: 2 }, 10); return true; }
    if (!atPeriscopeDepth(g)) { if (i % 30 === 0) { orders.depth(g, 0); orders.speed(g, 5); } return true; }
    orders.radar(g, true);
    const want = ['udaloy', 'steregushchiy'];
    const t = g.contacts.filter((c) => c.held && c.est && !c.air && want.includes(guess(c, 40) ?? ''))
      .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    if (t) {
      g.selected = t.id;
      if (!t.classified) orders.classify(g, t.id, guess(t, 40)!);
      const flying = g.weapons.filter((w) => w.side === 'us' && !w.dead && w.type === 'mst').length;
      if (t.q > 0.5 && dist(g.own, t.est!) < 30 && flying < 2 && i % 60 === 0) orders.fire(g, 'mst');
    }
    if (airDefence(g, i, s)) return true;
    goTo(g, i, { x: 0, y: 4 }, 5);
    return true;
  },
  V2: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const c = g.contacts.find((x) => x.held && x.est && !x.air);
    if (g.flags.reported) { if (c) attack(g, i, s, c); return true; }
    // It shot at us: that settles what it is. Shoot back.
    if (c && s.m.shotAtT !== undefined && i - s.m.shotAtT < 1200 && g.stats.enemyFired > 0) { if (!c.classified) orders.classify(g, c.id, 'kalvari'); attack(g, i, s, c); return true; }
    // Classify once the signature has settled on one class, then come up and report.
    const top = c?.matches[0];
    if (c && top && top.pct >= 70) s.m.sureT = (s.m.sureT ?? 0) + 1; else s.m.sureT = 0;
    if (c && !c.classified && s.m.sureT > 120) orders.classify(g, c.id, top!.key);
    if (c?.classified) { if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 5); } return true; }
    // Run to the latest position (ours or the P-8's), sprinting and drifting, then close it slowly to read it.
    const fix = s.m.fixX !== undefined ? { x: s.m.fixX, y: s.m.fixY } : null;
    const p = c?.est && (!fix || (c.matches.length && c.est.t > (s.m.fixT ?? 0))) ? c.est : fix ?? c?.est ?? { x: 0, y: 9 };
    const d = dist(g.own, p);
    goTo(g, i, p, d > 2 ? (i % 600 < 420 ? 14 : 6) : 5);
    // It may be on the other side of the layer: try both.
    if (!c?.matches.length && i % 1200 === 900) orders.layer(g);
    return true;
  },
  V3: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const t = quarry(g, ['yasen', 'akula'], 40, s, i);
    if (t && (t.q >= 0.6 || dist(g.own, t.est!) < 4)) return attack(g, i, s, t), true;
    // Below the layer, out of the wave noise, where a Yasen stalking a convoy will be.
    if (g.own.ordDepth < 2 && i % 60 === 0) orders.depth(g, 2);
    // Sprint and drift out along its likely track toward the convoy, or to the destroyer's last fix.
    const p = s.m.fixX !== undefined ? { x: s.m.fixX, y: s.m.fixY } : { x: 16, y: 4 };
    goTo(g, i, p, dist(g.own, p) > 3 ? (i % 600 < 400 ? 14 : 5) : 5);
    return true;
  },
  V4: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const k = quarry(g, ['kilo'], 60, s, i);
    if (k && dist(g.own, k.est!) < 4) return attack(g, i, s, k), true;
    const agi = contactOn(g, byName(g, 'Viktor Leonov')?.id);
    if (agi && agi.q > 0.6) {
      // Seen through the periscope: a Mk 48 from outside 6 nm, then back down.
      g.selected = agi.id;
      if (!agi.classified) orders.classify(g, agi.id, 'trawler');
      const running = g.weapons.some((w) => w.side === 'us' && !w.dead);
      if (dist(g.own, agi.est!) < 14 && i - (s.m.shotT ?? -1e9) > 600 && !running) { orders.fire(g, 'mk48'); s.m.shotT = i; }
      if (running && i % 60 === 0) { orders.depth(g, 1); orders.speed(g, 4); }
      return true;
    }
    for (const e of g.events) { const m = /HF radio, bearing (\d+)/.exec(e.text); if (m) { s.m.esmB = Number(m[1]); s.m.esmX = g.own.x; s.m.esmY = g.own.y; } }
    // Creep along the ESM bearing above the layer; every few minutes, a periscope look while still well outside 6 nm.
    const y = Math.min(4.5, i / 700);
    if (i % 600 < 90 && i > 600) { if (i % 30 === 0) { orders.depth(g, 0); orders.speed(g, 3); } return true; }
    if (i % 60 === 0) orders.depth(g, 1);
    goTo(g, i, s.m.esmB !== undefined ? offset({ x: s.m.esmX, y: s.m.esmY }, s.m.esmB, Math.min(4, i / 700)) : { x: 0, y }, 4);
    return true;
  },
  V5: (g, i, s) => {
    if (evade(g, i, s)) { s.m.lastDodge = i; return true; }
    // Close Glasgow from under the layer, then come up within 5 nm of her and stay up.
    const gl = byName(g, 'HMS Glasgow');
    const c = contactOn(g, gl?.id);
    const p = c?.est ?? (gl ? offset(gl, 0, 0) : { x: 0, y: 11 });
    const r = dist(g.own, p);
    if (r > 5) { if (!atPeriscopeDepth(g) && g.own.ordDepth < 2 && i % 60 === 0) orders.depth(g, 2); goTo(g, i, p, 8); return true; }
    if (i - (s.m.lastDodge ?? -1e9) < 420) return true;
    if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 5); }
    return true;
  },
  V6: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const ten = byName(g, 'USS Emory S. Land');
    if (!g.flags.rearmed && ten?.alive) {
      // Alongside at periscope depth, 5 knots on her course.
      const r = dist(g.own, ten);
      if (r > 0.3) { goTo(g, i, offset(ten, ten.hdg, Math.min(1, r / 6)), r > 1 ? 14 : 8); if (r < 1.5 && !atPeriscopeDepth(g)) orders.depth(g, 0); return true; }
      if (i % 30 === 0) { orders.heading(g, ten.hdg); orders.speed(g, 5); }
      if (!atPeriscopeDepth(g)) orders.depth(g, 0);
      return true;
    }
    if (airDefence(g, i, s)) return true;
    // Rearmed: stay near the tender and sink anything that closes her; meet the P-8's fixes on her side.
    const t = quarry(g, ['akula', 'kilo'], 40, s, i);
    if (t && ten && dist(ten, t.est!) < 12 && (t.q >= 0.6 || dist(g.own, t.est!) < 4)) return attack(g, i, s, t), true;
    if (ten && s.m.fixX !== undefined && i - s.m.fixT < 1500) {
      const f = { x: s.m.fixX, y: s.m.fixY };
      goTo(g, i, offset(ten, brg(ten, f), Math.min(6, dist(ten, f) / 2)), i % 600 < 400 ? 12 : 5);
    } else if (ten) goTo(g, i, offset(ten, i / 20, 2.5), 7);
    // Raiders come in shallow, as the Kilo and Akula do: patrol above the layer.
    if (!atPeriscopeDepth(g) && g.own.ordDepth !== 1 && i % 60 === 0) orders.depth(g, 1);
    return true;
  },
};
