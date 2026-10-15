// Balance captains for src/sim/modern/arctic.ts. Under the ice the generic captain is no use (no
// masts, no missiles), so these play from contacts, solutions, the plot and the log: torpedo
// evasion, ice keels, allied boats' reported positions, and each mission's own job.
import { atPeriscopeDepth, isFriendlyClass, orders, type Contact, type Game } from '../../src/sim/sim';
import { CLASSES } from '../../src/sim/classes';
import { underIce } from '../../src/sim/hazards';
import { brg, dist, offset, type Vec } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

/** Decoy, cross depth, turn away and sprint when a torpedo is heard; true while still running. */
export function evade(g: Game, i: number, s: CaptainState) {
  for (const e of g.events) {
    const lt = /(?:Launch transient|Torpedo in the water), bearing (\d+)/.exec(e.text);
    if (lt) { s.m.shotAtT = i; s.m.shotAtB = Number(lt[1]); }
    const m = /Torpedo in the water, bearing (\d+)/.exec(e.text);
    if (!m || (s.sprintT >= 0 && i - s.sprintT < 60)) continue;
    if (s.sprintT < 0) { orders.decoy(g); orders.layer(g); }
    orders.heading(g, Number(m[1]) + (i % 2 ? 100 : -100)); orders.speed(g, 25); s.sprintT = i;
  }
  if (s.sprintT >= 0) { if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); } else return true; }
  // Shot at by something we can't hear: slow down and ping for it.
  if (s.m.shotAtT !== undefined && i - s.m.shotAtT < 900 && i - (s.m.pingT ?? -1e9) > 300 && i - (s.m.dodgeT ?? -1e9) > 900 && g.own.spd < 9) { s.m.pingT = i; orders.ping(g); }
  return false;
}
/** Read the log: keel warnings (dive under), allied boats' positions, and any bearing-and-range reports. */
export function listen(g: Game, i: number, s: CaptainState, pref = 300) {
  for (const e of g.events) {
    const k = /ice keel .*reaching down to (\d+) feet/.exec(e.text);
    if (k) { s.m.keelFt = Number(k[1]); s.m.keelT = i; orders.depthTo(g, Number(k[1]) + 80); }
    const a = /^(.+) on the acoustic link: she is bearing (\d+), ([\d.]+) (nm|yd)/.exec(e.text);
    if (a) {
      const p = offset(g.own, Number(a[2]), Number(a[3]) / (a[4] === 'yd' ? 2025 : 1));
      s.m[`ally:${a[1]}:x`] = p.x; s.m[`ally:${a[1]}:y`] = p.y; s.m[`ally:${a[1]}:t`] = i;
    }
    const f = /submarine, bearing (\d+) from us, ([\d.]+) (nm|yd)/.exec(e.text);
    if (f) { const p = offset(g.own, Number(f[1]), Number(f[2]) / (f[3] === 'yd' ? 2025 : 1)); s.m.fixX = p.x; s.m.fixY = p.y; s.m.fixT = i; }
    const b = /bearing (\d+)\. (?:Something big|Xue Long 2)/.exec(e.text);
    if (b) { s.m.cueB = Number(b[1]); s.m.cueT = i; }
  }
  if (s.m.keelT !== undefined && i - s.m.keelT > 400 && i % 60 === 0) orders.depthTo(g, pref);
}
/** Where allied boats were last reported, if within the last 20 minutes (allowing for their drift). */
const alliesNear = (s: CaptainState, i: number, p: Vec, within: number) => Object.keys(s.m).filter((k) => k.endsWith(':t')).some((k) => {
  const n = k.slice(0, -2);
  return i - s.m[k] < 1200 && dist(p, { x: s.m[`${n}:x`], y: s.m[`${n}:y`] }) < within + (i - s.m[k]) * 5 / 3600;
});
/**
 * What the player would call a contact: the accepted class, or the best match if it is sure enough,
 * or the best match if every likely class is a hostile one ("Chinese, either way").
 */
export function guess(c: Contact, minPct = 60) {
  if (c.classified) return c.classified;
  const top = c.matches[0];
  if (!top) return null;
  if (top.pct > minPct) return top.key;
  const friendly = c.matches.filter((m) => isFriendlyClass(m.key) || CLASSES[m.key].nation === 'Turkey').reduce((a, m) => a + m.pct, 0);
  return friendly < 10 && !isFriendlyClass(top.key) ? top.key : null;
}
/** The nearest held contact the player would take for one of `want`. */
export function quarry(g: Game, want: string[], minPct = 60, s?: CaptainState, i = 0) {
  // A sub held where the last shot at us came from is the shooter, whatever its signature says.
  if (s?.m.shotAtT !== undefined && i - s.m.shotAtT < 900) {
    const shooter = g.contacts.find((c) => c.held && c.est && !c.air && c.q > 0.8 && Math.abs(((brg(g.own, c.est) - s.m.shotAtB + 540) % 360) - 180) < 20
      && !isFriendlyClass(guess(c, minPct)));
    if (shooter) return shooter;
  }
  return g.contacts.filter((c) => c.held && c.est && !c.air && guess(c, minPct) && want.includes(guess(c, minPct)!) && !isFriendlyClass(guess(c, minPct)))
    .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
}
const running = (g: Game) => g.weapons.filter((w) => w.side === 'us' && !w.dead && w.type === 'mk48').length;

/**
 * Close and shoot: steer at the solution, Mk 48 (or ASROC in open water) on a good solution, never
 * with an ally near the target. After a shot at a sub, turn off the line and change depth before
 * its snap shot comes back down the bearing.
 */
export function attack(g: Game, i: number, s: CaptainState, t: Contact, fireR = 7, fast = 12) {
  g.selected = t.id;
  const k = guess(t);
  if (!t.classified && k) orders.classify(g, t.id, k);
  const r = dist(g.own, t.est!);
  const sub = !k || CLASSES[k].kind === 'sub';
  if (s.m.dodgeT !== undefined && i - s.m.dodgeT < 240) return;
  if (i % 60 === 0) { orders.heading(g, brg(g.own, t.est!)); orders.speed(g, r > 9 ? fast : 6); }
  if (t.q < 0.6 || i % 90 !== 0 || alliesNear(s, i, t.est!, sub ? 3 : 1.5)) return;
  const asroc = sub && !underIce(g) && r > 1.5 && r < 14 && g.own.depthT <= 1.05;
  if (asroc) orders.fire(g, 'asroc');
  else if (r < fireR && running(g) < 2) orders.fire(g, 'mk48'); else return;
  if (sub) { s.m.dodgeT = i; orders.turn(g, i % 180 ? 90 : -90); orders.speed(g, 16); orders.layer(g); }
}
/** Hunt one of `want`; with nothing held, move toward `search` sprinting and drifting, or circle. */
export function hunt(g: Game, i: number, s: CaptainState, want: string[], search: Vec | null = null, minPct = 60) {
  const t = quarry(g, want, minPct, s, i);
  if (t) return attack(g, i, s, t);
  if (search && dist(g.own, search) > 1.5) { if (i % 60 === 0) { orders.heading(g, brg(g.own, search)); orders.speed(g, i % 900 < 420 ? 10 : 5); } }
  else if (i % 600 === 0) { orders.turn(g, 70); orders.speed(g, 6); }
}
/** Patrol planes overhead (sonobuoy splashes): in open water, come up, radar on, and JATM them. True while doing it. */
export function airDefence(g: Game, i: number, s: CaptainState) {
  if (g.events.some((e) => /sonobuoy splash|ESM: airborne/.test(e.text))) s.m.airT = i;
  const planes = g.contacts.filter((c) => c.held && c.air && c.bearing !== null && !isFriendlyClass(c.classified) && g.vessels.find((v) => v.id === c.vid)?.alive);
  if (s.m.airT === undefined || i - s.m.airT > 600 || underIce(g)) { if (s.m.upT !== undefined) { delete s.m.upT; orders.radar(g, false); orders.depth(g, 1); } return false; }
  if (s.m.upT === undefined) { s.m.upT = i; orders.depth(g, 0); orders.speed(g, 6); }
  if (atPeriscopeDepth(g)) {
    orders.radar(g, true);
    if (planes.length && i % 20 === 0 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) { const keep = g.selected; g.selected = planes[0].id; orders.fire(g, 'jatm'); g.selected = keep; }
  }
  if (i - s.m.upT > 400) { s.m.airT = -1e9; }
  return true;
}
const goTo = (g: Game, i: number, p: Vec, spd: number) => { if (i % 30 === 0) { orders.heading(g, brg(g.own, p)); orders.speed(g, spd); } };
/** The nearest open water on the plot (a lead or polynya), if any. */
const nearestLead = (g: Game) => g.env.polynyas.filter((p) => p.r < 100).sort((a, b) => dist(g.own, a) - dist(g.own, b))[0];
/** Get into open water, come up, and fire `n` TLAMs at the sites in turn. */
function strikeFrom(g: Game, i: number, s: CaptainState, lead: Vec & { r: number }, n: number) {
  const fired = g.stats.fired.tlam;
  if (fired >= n) { if (i % 60 === 0) { orders.depthTo(g, 400); orders.speed(g, 8); orders.turn(g, 90); } return; }
  if (underIce(g)) { goTo(g, i, lead, dist(g.own, lead) > 2 ? 12 : 5); return; }
  if (i % 30 === 0) { orders.speed(g, 3); orders.heading(g, brg(g.own, lead)); }
  if (!atPeriscopeDepth(g)) { orders.depth(g, 0); return; }
  if (i % 10 === 0) orders.strike(g, g.sites[fired % g.sites.length].id);
}

export const captains: Record<string, Captain> = {
  R1: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const t = quarry(g, ['type093b', 'kilo'], 60, s, i);
    if (t) attack(g, i, s, t);
    else if (s.m.fixT !== undefined && i - s.m.fixT < 500) goTo(g, i, { x: s.m.fixX, y: s.m.fixY }, 8);
    else goTo(g, i, { x: Math.floor(i / 1500) % 2 ? -3 : 1, y: i < 3000 ? -4 : 6 }, 5);
    return true;
  },
  R2: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const t = quarry(g, ['type095'], 60, s, i);
    if (t) attack(g, i, s, t);
    else if (s.m.fixT !== undefined && i - s.m.fixT < 400) goTo(g, i, { x: s.m.fixX, y: s.m.fixY }, dist(g.own, { x: s.m.fixX, y: s.m.fixY }) > 4 ? 10 : 5);
    else goTo(g, i, offset({ x: 0, y: 5 }, i / 20, 3), 6);
    return true;
  },
  R3: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    hunt(g, i, s, ['arc7lng'], { x: 0, y: 4 });
    return true;
  },
  R4: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const lead = nearestLead(g);
    if (lead) return strikeFrom(g, i, s, lead, 6), true;
    // Search the two reported leads in turn, in widening circles.
    const legs = [offset({ x: 0, y: 0 }, 115, 12), offset({ x: 0, y: 0 }, 225, 20)];
    const at = legs[s.m.leg ?? 0];
    if (dist(g.own, at) < 1.5 && !s.m.circT) s.m.circT = i;
    if (s.m.circT) {
      goTo(g, i, offset(at, (i - s.m.circT) / 6, 2.5), 8);
      if (i - s.m.circT > 1500) { s.m.leg = ((s.m.leg ?? 0) + 1) % 2; s.m.circT = 0; }
    } else goTo(g, i, at, 12);
    return true;
  },
  R5: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    hunt(g, i, s, ['type093b'], { x: 0, y: Math.min(22, 2 + i * 5 / 3600) });
    return true;
  },
  R6: (g, i, s) => {
    listen(g, i, s, 440);
    if (i === 1) orders.depthTo(g, 440);
    if (evade(g, i, s)) return true;
    const t = quarry(g, ['yasen', 'type095'], 60, s, i);
    if (t && dist(g.own, t.est!) < 6) attack(g, i, s, t, 6, 8);
    else goTo(g, i, { x: g.own.x, y: 30 }, 7);
    return true;
  },
  R7: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    hunt(g, i, s, ['yasen', 'type095', 'type093b'], { x: 0, y: 7 });
    return true;
  },
  R8: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const t = quarry(g, ['borei'], 50) ?? quarry(g, ['yasen'], 60, s, i);
    if (t) attack(g, i, s, t);
    else if (s.m.cueT !== undefined) goTo(g, i, offset(g.own, s.m.cueB, 4), 12);
    else hunt(g, i, s, [], { x: 0, y: 14 });
    return true;
  },
  R9: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    if (g.flags.ready) {
      const lead = nearestLead(g);
      if (lead && !underIce(g)) { orders.depth(g, 0); orders.speed(g, 3); }
      else if (lead) goTo(g, i, lead, 10);
      return true;
    }
    const c = g.contacts.find((x) => x.held && x.est && !x.air);
    if (c && i % 60 === 0) {
      const crs = c.motion?.crs ?? 100;
      const astern = offset(c.est!, crs + 180, 4.5);
      const r = dist(g.own, astern);
      orders.heading(g, r > 1 ? brg(g.own, astern) : crs); orders.speed(g, r > 2 ? 9 : Math.max(4, Math.round(c.motion?.spd ?? 5)));
    }
    if (!c && i % 120 === 0) { const last = g.contacts.find((x) => !x.air && x.est); orders.heading(g, last?.est ? brg(g.own, last.est) : 100); orders.speed(g, 8); }
    return true;
  },
  R10: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const hak = { x: 0, y: 4 };
    const t = quarry(g, ['type093b'], 60, s, i);
    if (t && dist(t.est!, hak) < 10) attack(g, i, s, t, 6);
    else goTo(g, i, offset(hak, i / 15, 1.5), 5);
    return true;
  },
  R11: (g, i, s) => {
    listen(g, i, s, 220);
    if (evade(g, i, s)) return true;
    const open = g.env.polynyas.find((p) => p.r < 1);
    if (open) return strikeFrom(g, i, s, open, 12), true;
    // Go to the west patch and push up through it: slow, at 220 feet.
    const patch = { x: -5, y: 0 };
    const d = dist(g.own, patch);
    if (i % 20 === 0) { orders.heading(g, brg(g.own, patch)); orders.speed(g, d > 1.5 ? 10 : d > 0.25 ? 3 : 0); if (d < 1.5) orders.depthTo(g, 220); }
    return true;
  },
  R12: (g, i, s) => {
    if (evade(g, i, s) || airDefence(g, i, s)) return true;
    hunt(g, i, s, ['type093b', 'kilo', 'type095'], { x: 0, y: 4 });
    return true;
  },
  R13: (g, i, s) => {
    listen(g, i, s);
    if (evade(g, i, s)) return true;
    const t = quarry(g, ['xuelong2'], 50);
    const esc = quarry(g, ['type095'], 60, s, i);
    if (t) attack(g, i, s, t, 6);
    else if (esc && dist(g.own, esc.est!) < 4) attack(g, i, s, esc, 4);
    else if (s.m.cueT !== undefined) goTo(g, i, offset(g.own, s.m.cueB, 3), 8);
    else goTo(g, i, offset({ x: 0, y: 0 }, 330, 6), 8);
    return true;
  },
};
