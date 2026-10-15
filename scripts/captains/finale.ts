// Balance captains for src/sim/modern/finale.ts.
import { atPeriscopeDepth, orders, type Game } from '../../src/sim/sim';
import { brg, dist, offset } from '../../src/sim/math';
import { evade, steerTo, strike, threat } from './counter';
import type { Captain } from './index';

const vesselOf = (g: Game, vid: number) => g.vessels.find((v) => v.id === vid)!;
/** Up at periscope depth with the radar on, an SM-6 at each inbound strike contact not already being chased. */
function sm6(g: Game, i: number) {
  const inbound = g.contacts.filter((c) => c.held && c.air && c.bearing !== null && vesselOf(g, c.vid).alive && vesselOf(g, c.vid).ai?.mode === 'strike');
  if (!inbound.length) return false;
  if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 6); return true; }
  orders.radar(g, true);
  if (i % 4) return true;
  const chased = new Set(g.weapons.filter((w) => w.type === 'sm6' && !w.dead).map((w) => w.contactId));
  const c = inbound.filter((x) => !chased.has(x.id)).sort((a, b) => dist(g.own, vesselOf(g, a.vid)) - dist(g.own, vesselOf(g, b.vid)))[0];
  if (c) { const keep = g.selected; g.selected = c.id; orders.fire(g, 'sm6'); g.selected = keep; }
  return true;
}

export const captains: Record<string, Captain> = {
  E9: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Kazan hears anything over 12 knots: hunt slowly, on legs across the bearing, as in the first duel.
    const c = g.contacts.find((x) => x.held && !x.air && x.bearing !== null && vesselOf(g, x.vid).cls.kind === 'sub');
    if (c) {
      g.selected = c.id;
      if (i - s.lastLeg > 240) { s.lastLeg = i; orders.heading(g, c.bearing! + (s.legs++ % 2 ? 60 : -60)); orders.speed(g, 7); }
      const r = c.est ? dist(g.own, c.est) : 99;
      if (c.q > 0.5 && r < 7 && i % 90 === 0) orders.fire(g, 'mk48');
      if (c.q > 0.5 && r > 2 && r < 12 && i % 300 === 0) orders.fire(g, 'asroc');
      return true;
    }
    if (i % 480 === 0) { orders.turn(g, 70); orders.speed(g, 6); }
    // A look at periscope depth now and then for the Il-38.
    if (i % 900 === 450) orders.depth(g, 0);
    if (atPeriscopeDepth(g) && i % 900 > 600) orders.depth(g, 1);
    return true;
  },
  E10: (g, i, s) => {
    if (sm6(g, i)) return true;
    if (evade(g, i, s)) return true;
    // The Yasen passes us by: get across its track, between it and the launch point, and let it come.
    const ys = g.vessels.find((v) => v.cls.key === 'yasen')!;
    const c = g.contacts.find((x) => x.vid === ys.id && x.held && x.est);
    if (c && c.q > 0.5 && dist(g.own, c.est!) < 7) return { extra: ['yasen', 'akula'], minPct: 50 };
    if (i % 60 === 0) { orders.depth(g, 2); orders.heading(g, c ? brg(g.own, offset(c.est!, 150, 3)) : 70); orders.speed(g, 8); }
    return true;
  },
  E12: (g, i, s) => {
    const drone = g.contacts.find((c) => c.held && c.est && !c.air && (c.cavitating || c.classified === 'poseidon'));
    if (!g.flags.launched) return evade(g, i, s) || { extra: ['khabarovsk'], minPct: 50 };
    if (evade(g, i, s)) return true;
    if (!drone) { if (i % 60 === 0) { orders.heading(g, 230); orders.speed(g, 20); orders.depth(g, 2); } return true; }
    g.selected = drone.id;
    if (!drone.classified) orders.classify(g, drone.id, 'poseidon');
    // Get out ahead of it on its track and lie in wait below the layer.
    const crs = drone.motion?.crs ?? 230;
    const ahead = offset(drone.est!, crs, 6);
    const r = dist(g.own, drone.est!);
    const closing = Math.abs(((brg(drone.est!, g.own) - crs + 540) % 360) - 180) < 60;
    if (i % 20 === 0) { orders.depth(g, 2); orders.heading(g, closing ? brg(g.own, drone.est!) : brg(g.own, ahead)); orders.speed(g, closing && r < 8 ? 6 : 28); }
    // Not with Delaware near it: the seeker can't tell them apart.
    const del = g.vessels.find((v) => v.name.includes('Delaware'))!;
    if (r < 7 && drone.q > 0.3 && i % 45 === 0 && !(del.alive && dist(del, drone.est!) < 7) && g.weapons.filter((w) => w.type === 'mk48' && !w.dead).length < 2) orders.fire(g, 'mk48');
    return true;
  },
  E15: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Choose a target the way a captain might: here, from the seed's layout.
    s.m.pick ??= Math.floor(Math.abs(g.vessels[1].x * 7 + g.vessels[1].y * 13) * 10) % 3;
    const pick = s.m.pick;
    // The generic captain fires Tomahawks at any site: keep it off Barentsburg unless that is the choice.
    if (pick !== 2) g.flags.landHits = 5;
    if (pick === 2) {
      if (i % 60 === 0 && g.own.ordDepth !== 1) orders.depth(g, 1);
      strike(g, { [-1]: 3 }, 2);
      return true;
    }
    // Close the chosen target from the brief's positions until it is held with a fair solution.
    const key = pick ? 'tanker' : 'oscar';
    const t = g.vessels.find((v) => v.cls.key === key)!;
    const c = g.contacts.find((x) => x.vid === t.id && x.held && x.est);
    if (c && c.q > 0.5 && dist(g.own, c.est!) < 8) return { extra: pick ? ['tanker', 'steregushchiy'] : ['oscar'], minPct: 50 };
    if (threat(g, ['akula'], 7)) return { extra: ['akula'], minPct: 50 };
    // Up now and then to look for the Il-38 and put a JATM into it.
    const il = g.vessels.find((v) => v.cls.key === 'il38')!;
    if (il.alive && i % 600 < 90) { if (i % 30 === 0) { orders.depth(g, 0); orders.speed(g, 6); } return true; }
    if (atPeriscopeDepth(g) && i % 30 === 0) orders.depth(g, 1);
    const dr = pick ? offset(offset({ x: 0, y: 0 }, 180, 14), 90, (g.t / 3600) * 8 + 4) : (() => { const st = offset({ x: 0, y: 0 }, 45, 14), lanes = offset({ x: 0, y: 0 }, 220, 30); return offset(st, brg(st, lanes), (g.t / 3600) * 8 + 3); })();
    steerTo(g, i, c ? c.est! : dr, dist(g.own, dr) > 4 ? 13 : 6);
    return true;
  },
  E16: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Stay between Kolpino and the hunters, who come from the northeast.
    const kol = g.vessels.find((v) => v.name.startsWith('Kolpino'))!;
    if (!threat(g, ['akula', 'yasen', 'udaloy'], 12) && kol.alive) { steerTo(g, i, offset(kol, 330, 4), dist(g.own, offset(kol, 330, 4)) > 2 ? 14 : 9); return true; }
    return { extra: ['akula', 'yasen', 'udaloy'], minPct: 50 };
  },
  E13: (g, i, s) => {
    // Fire only back at a boat that has just fired (the snap shot in evade); otherwise find each rogue boat and ping it from close in.
    if (evade(g, i, s)) return true;
    const rogues = g.contacts.filter((c) => c.held && c.est && !c.air && vesselOf(g, c.vid).cls.kind === 'sub' && vesselOf(g, c.vid).ai);
    const c = rogues.sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    const nansen = g.vessels.find((v) => v.name.includes('Nansen'))!;
    // A boat that has fired at the Nansen is fair game: a Mk 48 at the sub contact nearest her.
    if (g.events.some((e) => /launch transient near/.test(e.text))) {
      const t = g.contacts.filter((x) => x.held && x.est && !x.air && vesselOf(g, x.vid).cls.kind === 'sub' && vesselOf(g, x.vid).ai).sort((a, b) => dist(nansen, a.est!) - dist(nansen, b.est!))[0];
      if (t && dist(nansen, t.est!) < 4) { g.selected = t.id; orders.fire(g, 'mk48'); }
    }
    if (!c) {
      steerTo(g, i, offset(nansen, 250, 5), 12);
      if (i % 240 === 0) orders.ping(g);
      return true;
    }
    const r = dist(g.own, c.est!);
    steerTo(g, i, c.est!, r > 3 ? 14 : 6);
    if (r < 3 && i % 60 === 0) orders.ping(g);
    return true;
  },
  E17: (g, i, s) => {
    // Quiet trail: no weapons, no pings. Dodge a torpedo by turning away at moderate speed.
    for (const e of g.events) if (/Torpedo in the water|seeker has acquired us/.test(e.text) && (s.sprintT < 0 || i - s.sprintT > 60)) { orders.decoy(g); orders.speed(g, 16); orders.layer(g); orders.turn(g, 120); s.sprintT = i; }
    if (s.sprintT >= 0) { if (i - s.sprintT > 120) { s.sprintT = -1; orders.speed(g, 6); } return true; }
    // Straddle the layer so the Borei can't hide on the other side of it.
    if (g.own.arraySide === 'with' && s.sprintT < 0 && i % 60 === 0) orders.straddle(g, 'above');
    // The first contact, dead ahead at the start, is the Borei.
    if (!s.m.bid && g.contacts[0]) s.m.bid = g.contacts[0].id;
    const b = g.contacts.find((c) => c.id === s.m.bid && c.est);
    if (!b) { if (i % 60 === 0) { orders.speed(g, 6); } return true; }
    if (!b.classified) orders.classify(g, b.id, 'borei');
    const crs = b.motion?.crs ?? g.own.hdg;
    const spot = offset(b.est!, crs + 180, 2.5);
    const r = dist(g.own, spot);
    if (i % 30 === 0) { orders.heading(g, r > 0.8 ? brg(g.own, spot) : crs); orders.speed(g, r > 2 ? 7 : r > 0.8 ? 6 : Math.max(3, Math.round(b.motion?.spd ?? 5))); }
    return true;
  },
  E18: (g, i, s) => {
    if (sm6(g, i)) return true;
    if (evade(g, i, s, false)) return true;
    // The Backfires are due at 50 minutes and again later: up with the radar to meet them.
    if ((g.t > 48 * 60 && g.t < 72 * 60) || (g.t > 128 * 60 && g.t < 150 * 60)) { if (i % 30 === 0) { orders.depth(g, 0); orders.speed(g, 6); } if (atPeriscopeDepth(g)) orders.radar(g, true); return true; }
    // The Kilo, with ASROC only: a Mk 48 that misses runs on into the convoy. Otherwise keep ahead of the ships.
    const kilo = g.contacts.find((c) => c.held && c.est && !c.air && (c.classified ?? c.matches[0]?.key) === 'kilo' && vesselOf(g, c.vid).alive);
    const heyer = g.vessels.find((v) => v.name.includes('Heyerdahl'))!;
    if (kilo) {
      const r = dist(g.own, kilo.est!);
      g.selected = kilo.id;
      if (kilo.q > 0.4 && r > 1.5 && r < 12 && i - (s.m.asroc ?? -1e9) > 240) { s.m.asroc = i; orders.fire(g, 'asroc'); }
      steerTo(g, i, kilo.est!, r > 5 ? 10 : 5);
      return true;
    }
    if (i % 600 === 300 && !g.contacts.some((c) => c.classified === 'kilo')) orders.ping(g);
    // The second Kilo is somewhere ahead of the ships: get out in front and ping for her.
    if (g.flags.kilo2 && g.vessels.some((v) => v.cls.key === 'kilo' && v.alive)) {
      if (i % 240 === 0) orders.ping(g);
      steerTo(g, i, offset(heyer, 260, 6), 12);
      return true;
    }
    // With the Kilo gone, the corvettes and their Urans.
    if (g.t > 20 * 60 && !g.vessels.some((v) => v.cls.key === 'kilo' && v.alive && g.contacts.some((c) => c.vid === v.id && c.held))) return { extra: ['steregushchiy'], minPct: 40 };
    steerTo(g, i, offset(heyer, 260, 4), dist(g.own, offset(heyer, 260, 4)) > 2 ? 12 : 9);
    return true;
  },
};
