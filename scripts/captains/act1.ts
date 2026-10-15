// Balance captains for src/sim/modern/act1.ts.
// They play from what the player could see: contacts, matches, solutions, the log, the plot
// (allied ships, marked mines, polynyas, strike sites) and what the brief says.
import { atPeriscopeDepth, orders, type Contact, type Game } from '../../src/sim/sim';
import { angDiff, brg, dist, offset, type Vec } from '../../src/sim/math';
import { underIce } from '../../src/sim/hazards';
import type { Captain, CaptainState } from './index';

const said = (g: Game, re: RegExp) => g.events.some((e) => re.test(e.text));
const guess = (c: Contact, min: number) => c.classified ?? (c.matches[0]?.pct > min ? c.matches[0].key : null);
/** The nearest held contact the crew would call one of these classes. */
function find(g: Game, keys: string[], min = 60) {
  return g.contacts.filter((c) => c.held && c.est && !c.air && keys.includes(guess(c, min) ?? ''))
    .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
}
const steerTo = (g: Game, p: Vec, spd: number) => { orders.heading(g, brg(g.own, p)); orders.speed(g, spd); };
/** Torpedo evasion as in the duel: decoy, cross the layer, turn away and sprint, then slow down. True while sprinting. */
function evade(g: Game, i: number, s: CaptainState) {
  if (said(g, /Torpedo in the water|seeker has acquired us/) && (s.sprintT < 0 || i - s.sprintT > 60)) {
    orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i;
  }
  if (s.sprintT >= 0) { if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); } else return true; }
  return false;
}
/** A torpedo at a held contact with a decent solution inside 8 nm. */
function shoot(g: Game, i: number, c: Contact | undefined, key: string, q = 0.6, every = 90) {
  if (!c || c.q < q || dist(g.own, c.est!) > 8 || i % every) return false;
  g.selected = c.id;
  if (!c.classified) orders.classify(g, c.id, key);
  orders.fire(g, 'mk48');
  return true;
}
/** A heading toward `want` that stays clear of every marked mine for the next 0.7 nm. */
function safeHeading(g: Game, want: number) {
  const o = g.own, mines = g.mines.filter((m) => m.side !== 'us' && m.found && dist(o, m) < 1.2);
  const clear = (h: number) => { for (let d = 0.05; d <= 0.7; d += 0.05) { const p = offset(o, h, d); if (mines.some((m) => dist(p, m) < 0.2)) return false; } return true; };
  for (const k of [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120]) if (clear(want + k)) return want + k;
  return want + 180;
}
const quietGo = (g: Game, p: Vec, spd: number) => { orders.heading(g, safeHeading(g, brg(g.own, p))); orders.speed(g, spd); };
/** Evade, then hand the tick to the generic captain hunting these extra classes. */
const basic = (extra: string[] = [], minPct = 60): Captain => (g, i, s) => (evade(g, i, s) ? true : { extra, minPct });
const SUBS = ['kilo', 'akula', 'yasen', 'oscar', 'belgorod', 'borei', 'type209', 'reis'];
/**
 * A careful hunter: quiet at 150 feet, a radar look every ten minutes, missiles at surface targets
 * from range, ASROC and Mk 48 at submarines, the same at any threat that comes close, and torpedo evasion.
 * `area` is where the brief says to look when nothing is held.
 */
function hunter(g: Game, i: number, s: CaptainState, targets: string[], threats: string[], area: () => Vec, min = 60, investigate = false) {
  for (const e of g.events) { const m = /Launch transient, bearing (\d+)/.exec(e.text); if (m) { s.m.shB = Number(m[1]); s.m.shT = i; } }
  if (evade(g, i, s)) return true;
  // Return fire down the bearing of whoever just shot at us.
  if (i - (s.m.shT ?? -1e9) < 900 && i % 45 === 0) {
    const c = g.contacts.find((x) => x.held && x.est && !x.air && x.q > 0.4 && Math.abs(angDiff(brg(g.own, x.est), s.m.shB)) < 12 && dist(g.own, x.est) > 1.2 && dist(g.own, x.est) < 7);
    if (c) { g.selected = c.id; orders.fire(g, 'mk48'); }
  }
  if (antiAir(g, i, s)) return true;
  const o = g.own;
  // Radar look: two minutes at periscope depth every ten.
  const look = i % 600 >= 480 && !g.env.ice;
  if (look) { if (!atPeriscopeDepth(g)) orders.depth(g, 0); else orders.radar(g, true); }
  else if (o.ordDepth < 1) { orders.radar(g, false); orders.depth(g, 1); }
  const fire = (c: Contact, key: string) => {
    const r = dist(o, c.est!), sub = SUBS.includes(key);
    // Never into a spot with one of ours close by.
    if (g.vessels.some((v) => v.side === 'allied' && v.alive && dist(v, c.est!) < 2.5)) return;
    g.selected = c.id;
    if (!c.classified) orders.classify(g, c.id, key);
    if (sub && r < 1.2) return; // too close: a snap shot back would get us first; open out
    if (r < 7) return orders.fire(g, 'mk48');
    if (sub && r > 1.5 && r < 12 && !g.env.ice) return orders.fire(g, 'asroc');
    if (!sub && r < 30) orders.fire(g, g.flags.jammed ? 'harpoon' : 'mst');
  };
  const t = find(g, targets, min), th = find(g, threats, min);
  for (const [c, every] of [[th, 60], [t, 75]] as const) {
    if (!c || c.q < 0.6 || i % every) continue;
    const key = guess(c, min)!, r = dist(o, c.est!);
    if ((c === th && r < (SUBS.includes(key) ? 8 : 20)) || c === t) { fire(c, key); break; }
  }
  if (i % 60 === 0 && !look) {
    // Unknown submarine contacts: close in until the sonar can tell what they are.
    const unk = investigate && !t ? g.contacts.filter((c) => c.held && c.est && !c.air && !guess(c, min) && dist(o, c.est) < 12).sort((a, b) => dist(o, a.est!) - dist(o, b.est!))[0] : undefined;
    const go = t ?? unk ?? null;
    if (go) { const r = dist(o, go.est!); orders.heading(g, safeHeading(g, brg(o, go.est!) + (r < 2.5 && go === t ? 150 : 0))); orders.speed(g, r > 12 ? 9 : r < 2.5 && go === t ? 8 : 5); }
    else { const a = area(); const r = dist(o, a); orders.heading(g, safeHeading(g, r > 2 ? brg(o, a) : o.hdg + 60)); orders.speed(g, r > 6 ? 8 : 5); }
  }
  return true;
}
/** A pinging ship gives herself away: when her pings are loud, turn and send a fish down the bearing. */
function pingShot(g: Game, i: number, s: CaptainState) {
  for (const e of g.events) { const p = /active sonar intercept, bearing (\d+), loud/.exec(e.text); if (p) { s.m.pB = Number(p[1]); s.m.pT = i; } }
  if (s.m.pT === undefined || i - s.m.pT >= 90 || i - (s.m.pShot ?? -1e9) <= 360) return false;
  orders.heading(g, s.m.pB); orders.speed(g, 5);
  if (Math.abs(angDiff(g.own.hdg, s.m.pB)) < 8) { g.selected = null; orders.fire(g, 'mk48'); s.m.pShot = i; }
  return true;
}
/** SM-6 at the nearest strike flight held on radar. */
function sm6(g: Game, i: number) {
  if (!atPeriscopeDepth(g)) return;
  orders.radar(g, true);
  const air = g.contacts.find((c) => c.held && c.air && c.est && g.t - c.radarT < 10 && ['tu22m3', 'h6k', 'h6j'].includes(c.classified ?? c.matches[0]?.key ?? ''));
  if (air && i % 20 === 0 && g.weapons.filter((w) => w.type === 'sm6' && !w.dead).length < 2) { const k = g.selected; g.selected = air.id; orders.fire(g, 'sm6'); g.selected = k; }
}
/** A JATM at any patrol aircraft or helicopter that is working over us. */
function antiAir(g: Game, i: number, s: CaptainState) {
  if (said(g, /sonobuoy splash|steadying on us/)) s.m.airT = i;
  if (i - (s.m.airT ?? -1e9) > 120 || g.env.ice) return false;
  const air = g.contacts.find((c) => c.held && c.air && c.bearing !== null && ['il38', 'tu142', 'ka27', 'kq200', 'ka28', 'p8i', 'p3am', ''].includes(c.classified ?? c.matches[0]?.key ?? ''));
  if (!air) return false;
  if (g.own.ordDepth > 1) orders.depth(g, 1);
  if (i % 15 === 0 && g.own.depthT <= 1.05 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) { const k = g.selected; g.selected = air.id; orders.fire(g, 'jatm'); g.selected = k; }
  return true;
}
const pt = (g: Game, kx: string, ky: string): Vec => ({ x: (g.flags[kx] ?? 0) / 1000, y: (g.flags[ky] ?? 0) / 1000 });

export const captains: Record<string, Captain> = {
  A8: (g, i, s) => hunter(g, i, s, ['ropucha', 'ivangren'], ['kilo', 'steregushchiy'], () => ({ x: 0, y: 0 })),
  A9: (g, i, s) => hunter(g, i, s, ['kirov'], ['gorshkov'], () => offset({ x: 0, y: 0 }, 80, 20)),
  A13: (g, i, s) => hunter(g, i, s, ['belgorod'], ['akula'], () => offset({ x: 0, y: 0 }, 30, 10), 50),
  A16: (g, i, s) => hunter(g, i, s, ['gorshkov'], [], () => offset({ x: 0, y: 0 }, 50, 15)),
  A25: (g, i, s) => hunter(g, i, s, ['ropucha', 'ivangren'], ['kilo'], () => offset({ x: 0, y: 0 }, 270, 6)),

  A10(g, i, s) {
    const m = g.t / 60;
    if ((m > 33 && m < 50) || (m > 93 && m < 110)) {
      if (evade(g, i, s)) return true;
      if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 6); }
      sm6(g, i);
      return true;
    }
    return hunter(g, i, s, ['oscar'], ['akula'], () => offset({ x: 0, y: 0 }, 5, 16));
  },

  A21(g, i, s) {
    const box = pt(g, 'boxX', 'boxY');
    if (dist(g.own, box) > 2.3) return hunter(g, i, s, [], ['steregushchiy'], () => box);
    if (evade(g, i, s)) return true;
    if (shoot(g, i, find(g, ['steregushchiy']), 'steregushchiy')) return true;
    orders.radar(g, false); orders.depth(g, 1); orders.speed(g, 4);
    if (i % 10 === 0) {
      const next = g.sites.find((x) => x.hits === 0 && !g.weapons.some((w) => w.type === 'tlam' && w.contactId === x.id));
      if (next) orders.strike(g, next.id);
    }
    return true;
  },

  A11(g, i, s) {
    if (i === 0) s.m.axis = g.own.hdg;
    if (evade(g, i, s)) return true;
    // The Udaloy's pings tell us where she is: stay out of her way rather than start a fight in here.
    for (const e of g.events) { const p = /active sonar intercept, bearing (\d+), (loud|clear)/.exec(e.text); if (p) { s.m.uB = Number(p[1]); s.m.uT = i; s.m.uR = p[2] === 'loud' ? 2 : 6; } }
    const ready = !!g.flags.ready;
    const threat = find(g, ['akula', 'yasen', 'udaloy'], 60);
    if (threat && threat.q > 0.65 && shoot(g, i, threat, guess(threat, 60)!, 0.65, 120)) return true;
    if (g.own.ordDepth !== 2 && i % 60 === 0) orders.depth(g, 2);
    const b = find(g, ['borei'], 40);
    // Keep clear of any other submarine we hear close by.
    const other = g.contacts.filter((c) => c.held && c.est && !c.air && c !== b && dist(g.own, c.est) < 3.5).sort((x, y) => dist(g.own, x.est!) - dist(g.own, y.est!))[0];
    const away = (want: number, b: number, r: number) => want + Math.sign(angDiff(b, want) || 1) * -Math.max(0, 70 - 15 * r);
    const push = (want: number) => {
      let h = other ? away(want, brg(g.own, other.est!), dist(g.own, other.est!)) : want;
      if (s.m.uT !== undefined && i - s.m.uT < 300 && Math.abs(angDiff(s.m.uB, h)) < 60) h = away(h, s.m.uB, s.m.uR);
      return h;
    };
    if (ready) { if (i % 30 === 0) { orders.heading(g, push(brg(g.own, { x: 0, y: 0 }))); orders.speed(g, 6); } return true; }
    if (b) {
      g.selected = b.id;
      const r = dist(g.own, b.est!);
      if (i % 30 === 0) { orders.heading(g, push(r > 4 ? brg(g.own, b.est!) : brg(g.own, b.est!) + 90)); orders.speed(g, r > 4 ? 5 : 4); }
      return true;
    }
    if (i % 30 === 0) { orders.heading(g, push(brg(g.own, offset({ x: 0, y: 0 }, s.m.axis, 17)))); orders.speed(g, 5); }
    return true;
  },

  A12(g, i, s) {
    if (i < 60) { orders.depth(g, 1); if (i % 5 === 0 && (s.m.fired ?? 0) < 6) { orders.strike(g, g.sites[(s.m.fired ?? 0) % 2].id); s.m.fired = (s.m.fired ?? 0) + 1; } return true; }
    if (evade(g, i, s)) return true;
    if (antiAir(g, i, s)) return true;
    const need = g.sites.find((x) => x.hits < 2 && !g.weapons.some((w) => w.type === 'tlam' && w.contactId === x.id));
    if (need && g.t > 25 * 60) {
      if (g.own.ordDepth !== 1) orders.depth(g, 1);
      if (i % 10 === 0) orders.strike(g, need.id);
      orders.speed(g, 6);
      return true;
    }
    if (i % 60 === 0) { orders.heading(g, safeHeading(g, 300)); orders.speed(g, 12); orders.depth(g, 2); }
    return true;
  },

  A22(g, i, s) {
    if (evade(g, i, s)) return true;
    if (i === 0) { orders.depth(g, 2); s.m.ivan = -1e9; }
    if (said(g, /clearing her baffles/)) s.m.ivan = i;
    const b = find(g, ['borei'], 30) ?? g.contacts.find((c) => c.held && c.est && !c.air && c.vid === g.contacts.find((x) => x.classified === 'borei')?.vid);
    if (b && !b.classified && b.matches[0]?.key === 'borei') orders.classify(g, b.id, 'borei');
    if (i - s.m.ivan < 360) { orders.speed(g, 2); return true; }
    if (b?.est) {
      s.m.lb = b.bearing ?? 0;
      const crs = b.motion?.crs ?? brg(g.own, b.est);
      const spot = offset(b.est, crs + 180, 3.5);
      const r = dist(g.own, spot), too = dist(g.own, b.est) < 2.5;
      if (i % 30 === 0) { orders.heading(g, r > 0.6 ? brg(g.own, spot) : crs); orders.speed(g, too ? 2 : Math.min(dist(g.own, b.est) < 5 ? 6 : 10, Math.max(3, Math.round((b.motion?.spd ?? 5) + (r > 1 ? 1.5 : 0))))); }
    } else if (i % 60 === 0) { orders.heading(g, s.m.lb ?? g.own.hdg); orders.speed(g, 4); }
    return true;
  },

  A23(g, i, s) {
    if (evade(g, i, s)) return true;
    const yasenUp = g.goal.targets.some((id) => g.vessels.find((v) => v.id === id)?.alive);
    if (!yasenUp) {
      const p = [...g.env.polynyas].sort((a, b) => dist(g.own, a) - dist(g.own, b))[0];
      if (!underIce(g)) { orders.depth(g, 0); orders.speed(g, 3); } else if (i % 30 === 0) { steerTo(g, p, 10); }
      return true;
    }
    // Nothing else lives under the pack: any submerged contact is the Yasen.
    const c = g.contacts.filter((k) => k.held && k.est && !k.air).sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    if (c) {
      const d = dist(g.own, c.est!);
      if (d < 6 && d > 1.2 && i - (s.m.shotT ?? -1e9) > 180) { g.selected = c.id; orders.fire(g, 'mk48'); s.m.shotT = i; }
      // Head for a point between it and the open water it wants.
      const pol = g.env.polynyas[0];
      const aim = { x: (c.est!.x + pol.x) / 2, y: (c.est!.y + pol.y) / 2 };
      if (i % 30 === 0) { orders.depth(g, 2); orders.heading(g, brg(g.own, d < 3 ? c.est! : aim)); orders.speed(g, d > 4 && i % 600 < 420 ? 12 : 5); }
      return true;
    }
    // Cut across its track toward the polynya: sprint, then drift and listen.
    if (i % 600 === 0) { orders.depth(g, 2); orders.heading(g, brg(g.own, offset({ x: 0, y: 0 }, 35, 14))); orders.speed(g, 10); }
    if (i % 600 === 420) orders.speed(g, 4);
    return true;
  },

  A18(g, i, s) {
    for (const e of g.events) { const m = /Launch transient, bearing (\d+)/.exec(e.text); if (m) { s.m.shB = Number(m[1]); s.m.shT = i; } if (/fresh mines/.test(e.text)) s.m.fresh = 1; }
    if (evade(g, i, s)) return true;
    const cv = g.vessels.find((v) => v.cls.key === 'qnlz')!;
    const ours = g.vessels.filter((v) => v.side === 'allied' && v.alive);
    // No friendly boats here: any submerged contact away from our ships is hostile.
    const sub = g.contacts.filter((c) => c.held && c.est && !c.air && c.q > 0.3 && ours.every((v) => dist(v, c.est!) > 1.5) && dist(g.own, c.est) > 1.2 && dist(g.own, c.est) < 7)
      .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    if (sub && i - (s.m.subShot ?? -1e9) > 120) { g.selected = sub.id; orders.fire(g, 'mk48'); s.m.subShot = i; return true; }
    if (s.m.pingY === undefined) s.m.pingY = 99;
    // Ping as we advance, and again when the Akula is heard laying more.
    if ((s.m.pingY - g.own.y > 2.5 || s.m.fresh) && g.own.y < 1) { orders.ping(g); s.m.pingY = g.own.y; s.m.fresh = 0; }
    const want = { x: 0, y: Math.max(-19, cv.y - 3) };
    if (i % 10 === 0) { orders.depth(g, 1); quietGo(g, dist(g.own, want) < 0.3 ? { x: 0, y: want.y - 1 } : want, dist(g.own, want) < 0.3 ? 2 : 8); }
    return true;
  },

  A20(g, i, s) {
    if (evade(g, i, s)) return true;
    if (i === 0) { s.m.crs = 200; s.m.corr = 0; }
    for (const e of g.events) {
      const m = /axis now runs about (\d+)/.exec(e.text);
      if (m) { s.m.crs = Number(m[1]); s.m.corr = 0; }
      if (/on the channel axis/.test(e.text)) s.m.corr = 0;
      const side = /axis lies to the (east|west)/.exec(e.text);
      if (side) s.m.corr = Math.sign(angDiff(side[1] === 'east' ? 90 : 270, s.m.crs)) * 25;
    }
    const kilo = find(g, ['kilo']);
    if (shoot(g, i, kilo, 'kilo')) return true;
    if (i % 5 === 0) { orders.heading(g, safeHeading(g, s.m.crs + s.m.corr)); orders.speed(g, 6); }
    return true;
  },

  A14(g, i, s) {
    if (evade(g, i, s)) return true;
    const lead = g.vessels.find((v) => v.name === 'HMS Cardiff')!;
    const ours = g.vessels.filter((v) => v.side === 'allied' && v.alive);
    const clearOfUs = (c: Contact) => ours.every((v) => dist(v, c.est!) > 3);
    // A radar look every eight minutes: anything on the surface that isn't ours is a corvette.
    const look = i % 480 >= 390;
    if (look) { if (!atPeriscopeDepth(g)) orders.depth(g, 0); else orders.radar(g, true); }
    else if (g.own.ordDepth < 1) { orders.radar(g, false); orders.depth(g, 1); }
    const corv = g.contacts.filter((c) => c.held && c.est && !c.air && g.t - c.radarT < 600 && clearOfUs(c) && dist(g.own, c.est) < 26).sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    if (corv && i % 60 === 0) { g.selected = corv.id; orders.fire(g, dist(g.own, corv.est!) < 7 ? 'mk48' : 'mst'); }
    // Anything heard under water ahead of the convoy is the Kilo.
    const kilo = g.contacts.filter((c) => c.held && c.est && !c.air && c.q > 0.6 && g.t - c.radarT > 600 && clearOfUs(c) && (guess(c, 45) === 'kilo' || !guess(c, 45)) && dist(g.own, c.est) > 1.2 && dist(g.own, c.est) < 12)
      .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    if (kilo && i % 90 === 45) {
      g.selected = kilo.id;
      const far = ours.every((v) => dist(v, kilo.est!) > 6) && ours.every((v) => dist(v, g.own) > 3);
      orders.fire(g, dist(g.own, kilo.est!) < 7 && far ? 'mk48' : 'asroc');
    }
    const run = lead.alive ? Math.hypot(lead.x, lead.y) : 0;
    if (run > 4 && run < 17 && i - (s.m.pingT ?? -1e9) > 240) { orders.ping(g); s.m.pingT = i; }
    const spot = offset(lead, lead.hdg, 4);
    if (i % 20 === 0 && !look) { quietGo(g, spot, dist(g.own, spot) > 1 ? 14 : 10); }
    return true;
  },

  A15: (g, i, s) => {
    for (const e of g.events) { const m = /bearing (\d+), (\d+) nm from you/.exec(e.text); if (m) { s.m.cue = 1; s.m.cb = Number(m[1]); s.m.cr = Number(m[2]); s.m.cx = g.own.x; s.m.cy = g.own.y; } }
    // Get across the Kilos' track: part way from the last snorkel cue toward the exit 14 nm south.
    const area = () => {
      if (!s.m.cue) return { x: 0, y: -4 };
      const c = offset({ x: s.m.cx, y: s.m.cy }, s.m.cb, s.m.cr), ex = { x: 0, y: -14 };
      return { x: c.x + (ex.x - c.x) * 0.5, y: c.y + (ex.y - c.y) * 0.5 };
    };
    return hunter(g, i, s, ['kilo'], [], area, 55, true);
  },

  A24(g, i, s) {
    if (evade(g, i, s)) return true;
    const box = pt(g, 'bx', 'by'), mouth = pt(g, 'mx', 'my');
    for (const e of g.events) { const m = /Launch transient, bearing (\d+)/.exec(e.text); if (m) { s.m.shB = Number(m[1]); s.m.shT = i; } }
    if (g.own.ordDepth !== 2 && i % 30 === 0) orders.depth(g, 2);
    if (pingShot(g, i, s)) return true;
    // No friendly or neutral traffic in the bay: anything held close in is the Kilo or the corvette.
    const near = g.contacts.filter((c) => c.held && c.est && !c.air && dist(g.own, c.est) > 1.2 && dist(g.own, c.est) < 6.5).sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
    if (near && i - (s.m.shotT ?? -1e9) > 150 && (near.q > 0.15 || i - (s.m.shT ?? -1e9) < 600)) { g.selected = near.id; orders.fire(g, 'mk48'); s.m.shotT = i; }
    if ((g.flags.laid ?? 0) >= 6 || !g.flags.minesAboard) { if (i % 20 === 0) quietGo(g, offset(mouth, brg(mouth, { x: 0, y: 0 }), 16), 10); return true; }
    const r = dist(g.own, box);
    if (r < 1.1) { orders.speed(g, 5); if (i % 15 === 0) orders.layMine(g); if (i % 20 === 0) orders.heading(g, safeHeading(g, brg(g.own, box) + 60)); return true; }
    if (i % 20 === 0) quietGo(g, box, r > 4 ? 8 : 6);
    return true;
  },
};
