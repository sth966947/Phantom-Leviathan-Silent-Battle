// Balance captains for src/sim/modern/pacific.ts. They play from what the player sees: contacts,
// signature matches, solutions, the log, and the positions the brief gives.
import { atPeriscopeDepth, isFriendlyClass, orders, type Contact, type Game } from '../../src/sim/sim';
import { brg, dist, offset, type Vec } from '../../src/sim/math';
import { B1_ANCH, GUAM, KAO, MAKUNG, P13_EXIT, P14_BOX, P15_MOUTH, P3_BEACH, P5_LINE, P6_EXIT, SUBIC, UOTSURI } from '../../src/sim/modern/pacific';
import type { Captain, CaptainState } from './index';

const MERCH = ['tanker', 'lng', 'boxship', 'tender', 'arleigh'];
const guess = (c: Contact, pct: number) => c.classified ?? (c.matches[0]?.pct > pct ? c.matches[0].key : null);
/** Held contacts, with a solution, that look like one of `keys`. */
const seen = (g: Game, keys: string[], pct = 60) => g.contacts.filter((c) => c.held && c.est && !c.air && g.vessels.find((v) => v.id === c.vid)?.alive
  && keys.includes(guess(c, pct) ?? '') && !isFriendlyClass(guess(c, pct)));

const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** A held contact near a bearing, not called friendly. */
const onBearing = (g: Game, b: number, within: number, minQ = 0) => g.contacts.find((c) => c.held && c.est && !c.air && c.bearing !== null && c.q >= minQ
  && off(c.bearing, b) < within && !isFriendlyClass(guess(c, 50)) && g.vessels.find((v) => v.id === c.vid)?.alive);
/** Across the torpedo's track, on the side nearer our heading: it runs on past where it was aimed. */
const beam = (g: Game, w: Vec) => { const b = brg(w, g.own); return off(b + 90, g.own.hdg) < off(b - 90, g.own.hdg) ? b + 90 : b - 90; };
/** A friendly ship close to an aim point: a torpedo there might take her instead. */
const friendsNear = (g: Game, p: Vec, r = 2.5) => g.vessels.some((v) => v.alive && v.side === 'allied' && v.cls.kind !== 'air' && dist(v, p) < r);
function snap(g: Game, c: Contact | undefined) {
  if (!c || friendsNear(g, c.est!)) return;
  const keep = g.selected; g.selected = c.id; orders.fire(g, 'mk48'); g.selected = keep;
}

const CN_SUBS = ['type093b', 'type095', 'type039', 'type094', 'type096'];
/**
 * Call a contact once the signature is clear enough that it is one of a family, even if not which
 * one: e.g. Chinese boats all share the 50 and 13 Hz lines. Only with a firm enough solution.
 */
function callFamily(g: Game, keys: string[], sumPct: number) {
  for (const c of g.contacts) {
    if (!c.held || c.classified || c.air || c.q < 0.5) continue;
    const sum = c.matches.filter((m) => keys.includes(m.key)).reduce((a, m) => a + m.pct, 0);
    const top = c.matches.find((m) => keys.includes(m.key));
    if (top && sum >= sumPct) orders.classify(g, c.id, top.key);
  }
}

/**
 * Torpedo evasion: decoy, cross the layer, turn away and sprint, then slow down again. A launch
 * transient gives the shooter's bearing: snap a Mk 48 back at anything held there, and once clear,
 * ping down that bearing and shoot at the return.
 */
function evade(g: Game, i: number, s: CaptainState) {
  for (const e of g.events) {
    const m = /Launch transient, bearing (\d+)/.exec(e.text), t = /Torpedo in the water, bearing (\d+)/.exec(e.text);
    if (m || (t && i - s.cutT > 60)) { s.cutBrg = Number((m ?? t)![1]); s.cutT = i; }
  }
  // Hunted by escorts: go below the layer, slow and quiet, for ten minutes.
  for (const e of g.events) if (/Depth charges|sonar has us|sighted our periscope/.test(e.text)) { s.m.huntedT = i; orders.radar(g, false); orders.depth(g, 2); orders.speed(g, 5); }
  // Only torpedoes that are coming our way: the bearing and its drift tell the sonarmen as much.
  const coming = g.weapons.find((w) => w.side === 'enemy' && !w.dead && w.heardBrg != null && dist(w, g.own) < 6 && off(brg(w, g.own), w.hdg) < 35 && !s.m[`ev${w.id}`]);
  if (coming) {
    s.m[`ev${coming.id}`] = 1;
    if (s.cutT >= 0 && i - s.cutT < 30) snap(g, onBearing(g, s.cutBrg, 15));
    if (s.sprintT < 0 || i - s.sprintT > 60) { orders.decoy(g); orders.layer(g); }
    orders.speed(g, 28); orders.heading(g, beam(g, coming)); s.sprintT = i; s.deepT = i;
  }
  if (s.sprintT >= 0) {
    // Keep running directly away from any torpedo we can hear closing.
    const near = g.weapons.filter((w) => w.side === 'enemy' && !w.dead && w.heardBrg != null && dist(w, g.own) < 4).sort((a, b) => dist(a, g.own) - dist(b, g.own))[0];
    if (near && i % 10 === 0 && dist(near, g.own) < 1.5) orders.heading(g, brg(near, g.own));
    for (const e of g.events) if (/acquired us/.test(e.text) && i - (s.m.acqT ?? -1e9) > 60) { s.m.acqT = i; orders.decoy(g); orders.turn(g, 90); orders.layer(g); orders.speed(g, 30); }
    if (i - s.sprintT > 240 && !near && i - (s.m.acqT ?? -1e9) > 360) {
      s.sprintT = -1; orders.speed(g, 6);
      if (s.cutT >= 0 && i - s.cutT < 400 && !s.m.noPing) { orders.ping(g); s.m.shootT = i; }
    }
    return true;
  }
  if (s.m.shootT !== undefined && i - s.m.shootT === 2) snap(g, onBearing(g, s.cutBrg, 30, 0.9));
  if (i - (s.m.huntedT ?? -1e9) < 600) { if (i % 60 === 0) { orders.depth(g, 2); orders.speed(g, 5); } return true; }
  return false;
}
/** Work out an unknown contact: legs across its bearing until the solution firms up and the signature resolves. */
function investigate(g: Game, i: number, s: CaptainState, ignore: string[] = []) {
  const c = g.contacts.filter((x) => x.held && !x.air && x.bearing !== null && !ignore.includes(guess(x, 60) ?? '') && !isFriendlyClass(guess(x, 60))
    && (x.q < 0.6 || !guess(x, 60)) && g.vessels.find((v) => v.id === x.vid)?.alive).sort((a, b) => b.seAvg - a.seAvg)[0];
  if (!c) return false;
  if (i - s.lastLeg > 240) { s.lastLeg = i; orders.heading(g, c.bearing! + (s.legs++ % 2 ? 50 : -50)); orders.speed(g, 6); }
  return true;
}
/** Sprint and drift toward a point: fast legs to cover ground, slow legs to listen. */
function sprintDrift(g: Game, i: number, p: Vec, fast = 14, slow = 5) {
  if (i % 60) return;
  const r = dist(g.own, p);
  if (r < 1.5) { orders.heading(g, brg(g.own, p) + 90); orders.speed(g, slow); return; }
  orders.heading(g, brg(g.own, p));
  orders.speed(g, i % 600 < 240 && r > 3 ? fast : slow);
}
/** Steer clear of mines on the plot. */
function avoidMines(g: Game, i: number) {
  if (i % 10) return false;
  const o = g.own;
  const m = g.mines.filter((x) => x.side === 'enemy' && x.found && dist(o, x) < 0.8 && Math.abs(((brg(o, x) - o.hdg + 540) % 360) - 180) < 50)
    .sort((a, b) => dist(o, a) - dist(o, b))[0];
  if (!m) return false;
  orders.heading(g, brg(o, m) + (((brg(o, m) - o.hdg + 540) % 360) - 180 > 0 ? -70 : 70));
  orders.speed(g, 5);
  return true;
}
/** At periscope depth with the radar on, SM-6 at the nearest strike aircraft. */
function airDefence(g: Game, i: number) {
  if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 6); return; }
  orders.radar(g, true);
  if (i % 20) return;
  const air = g.contacts.filter((c) => c.held && c.air && c.bearing !== null && g.vessels.find((v) => v.id === c.vid && v.alive && v.side === 'enemy' && v.ai?.mode === 'strike'));
  const inFlight = g.weapons.filter((w) => w.type === 'sm6' && !w.dead).length;
  if (air.length > inFlight) {
    const keep = g.selected;
    g.selected = air[inFlight % air.length].id;
    orders.fire(g, 'sm6');
    g.selected = keep;
  }
}
/** JATM at a patrol plane or helicopter we hold, one at a time. */
function jatm(g: Game, i: number) {
  if (i % 15 || !atPeriscopeDepth(g) || g.weapons.some((w) => w.type === 'jatm' && !w.dead)) return;
  const air = g.contacts.find((c) => c.held && c.air && c.bearing !== null && (!c.est || dist(g.own, c.est) < 45)
    && g.vessels.find((v) => v.id === c.vid && v.alive && v.side === 'enemy' && v.ai?.mode !== 'strike'));
  if (air) { const keep = g.selected; g.selected = air.id; orders.fire(g, 'jatm'); g.selected = keep; }
}
/** Anti-ship missiles at ships identified as `keys`, one per contact every few minutes. */
function missiles(g: Game, i: number, s: CaptainState, keys: string[], maxR: number, type: 'mst' | 'harpoon' = 'mst', gap = 240) {
  const t = seen(g, keys, 70).filter((c) => c.q > 0.8 && dist(g.own, c.est!) < maxR && i - (s.m[`f${c.id}`] ?? -1e9) > gap)
    .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
  if (!t) return false;
  g.selected = t.id;
  if (!t.classified) orders.classify(g, t.id, guess(t, 70)!);
  const before = g.stats.fired[type];
  orders.fire(g, type);
  if (g.stats.fired[type] > before) s.m[`f${t.id}`] = i;
  return true;
}
/** Periodic look around at periscope depth with the radar. */
function radarLook(g: Game, i: number, every = 900, stay = 200) {
  if (i % every === every / 2) orders.depth(g, 0);
  const up = i % every >= every / 2 && i % every <= every / 2 + stay;
  if (atPeriscopeDepth(g)) { if (up) orders.radar(g, true); else { orders.radar(g, false); orders.depth(g, 1); } }
}

/** Mk 48s at fresh ping returns that the radar hasn't shown to be ships on the surface. */
function pingShots(g: Game, maxR: number, n = 3) {
  const rs = g.contacts.filter((c) => c.held && c.q > 0.95 && c.est && !c.air && dist(g.own, c.est) < maxR && !c.classified && !friendsNear(g, c.est, 1.5)
    && g.vessels.find((v) => v.id === c.vid)?.alive).sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!)).slice(0, n);
  for (const c of rs) snap(g, c);
}
/**
 * Go after hostile submarines among friendly ships: the generic captain's Mk 48s when the shot is
 * clear, an ASROC when friends are too close to the target for a heavyweight torpedo.
 */
function huntSubs(g: Game, i: number, s: CaptainState, keys: string[], pct: number, clear = 2.5) {
  const t = seen(g, keys, pct).sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
  if (!t) return null;
  if (!friendsNear(g, t.est!, clear)) return { extra: keys, minPct: pct };
  if (i % 60 === 0) { orders.heading(g, brg(g.own, t.est!)); orders.speed(g, 6); }
  const r = dist(g.own, t.est!);
  if (t.q > 0.8 && r > 1.2 && r < 14 && i - (s.m.asrocT ?? -1e9) > 300) { g.selected = t.id; orders.fire(g, 'asroc'); s.m.asrocT = i; }
  return true as const;
}

export const captains: Record<string, Captain> = {
  B1: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Any diesel boat here is hostile: the 209 and the Scorpène family sound alike at first.
    const hunt = huntSubs(g, i, s, ['type209', 'riachuelo', 'kalvari'], 35);
    if (hunt) return hunt;
    // To the anchorage first; with Sábalo gone, sweep back up the approach for Humaitá.
    const sab = g.vessels.find((v) => v.cls.key === 'type209')!;
    const sweep = [B1_ANCH, P(160, 7), P(220, 7), P(190, 3)];
    s.m.wp ??= 0;
    const wp = sab.alive ? B1_ANCH : sweep[s.m.wp % 4];
    if (!sab.alive && dist(g.own, wp) < 1.5) { s.m.wp++; orders.ping(g); }
    if (!investigate(g, i, s, MERCH)) sprintDrift(g, i, wp, 9);
    return true;
  },

  P13: (g, i, s) => {
    if (evade(g, i, s)) return true;
    if (seen(g, ['riachuelo'], 40).length) return { extra: ['riachuelo'], minPct: 40 };
    // Can't hear her in this sea: ping astern now and then, and put a Mk 48 into the return.
    const sh = g.vessels.find((v) => v.name.startsWith('Tonelero'))!;
    if (sh.alive && i % 840 === 480) { orders.ping(g); s.m.pingT = i; }
    if (s.m.pingT === i - 2) {
      const c = g.contacts.find((x) => x.held && x.q > 0.95 && x.est && !x.air && dist(g.own, x.est) < 7 && g.vessels.find((v) => v.id === x.vid)?.alive);
      if (c) { g.selected = c.id; orders.fire(g, 'mk48'); s.m.chase = c.id; }
    }
    // Head for the turning point, clearing the baffles every few minutes to look for her astern.
    if (i % 60 === 0) {
      const leg = sh.alive && i % 420 < 90;
      orders.heading(g, brg(g.own, P13_EXIT) + (leg ? 120 : 0));
      orders.speed(g, leg ? 5 : sh.alive ? 11 : 14);
    }
    return true;
  },

  P14: (g, i, s) => {
    if (evade(g, i, s)) return true;
    if (avoidMines(g, i)) return true;
    const lay = g.vessels.find((v) => v.name === 'Changzheng 16')!;
    callFamily(g, CN_SUBS, 80);
    if (lay.alive && seen(g, CN_SUBS, 50).length) return { extra: CN_SUBS, minPct: 50 };
    // Ping once near the box to find the layer and the mines; once she is sunk, ping round the box.
    const spots = [P14_BOX, offset(P14_BOX, 0, 2.5), offset(P14_BOX, 90, 2.5), offset(P14_BOX, 180, 2.5), offset(P14_BOX, 270, 2.5)];
    s.m.spot ??= 0;
    const p = spots[s.m.spot % spots.length];
    if (dist(g.own, p) < 0.8) {
      if (i - (s.m.pingT ?? -1e9) > 300) { orders.ping(g); s.m.pingT = i; s.m.spot++; }
    } else if (i % 30 === 0) { orders.heading(g, brg(g.own, p)); orders.speed(g, lay.alive ? 6 : 8); }
    return true;
  },

  P1: (g, i, s) => {
    for (const e of g.events) { const mm = /missile launch transients, bearing (\d+)/.exec(e.text); if (mm) { s.m.yjB = Number(mm[1]); s.m.yjT = i; s.m.yjX = g.own.x; s.m.yjY = g.own.y; } }
    if (evade(g, i, s)) return true;
    const m = g.t / 60;
    if ([12, 18, 70, 76, 130].some((w) => m > w + 3 && m < w + 24)) { airDefence(g, i); if (i % 60 === 0) orders.speed(g, 6); return true; }
    callFamily(g, CN_SUBS, 80);
    if (seen(g, CN_SUBS, 50).length) return { extra: CN_SUBS, minPct: 50 };
    // Hunt round the far side of the island, and down the bearing of any missile launch we hear.
    if (s.m.yjT !== undefined && i - s.m.yjT < 1500 && !investigate(g, i, s)) { sprintDrift(g, i, offset({ x: s.m.yjX, y: s.m.yjY }, s.m.yjB, 12), 12); return true; }
    if (!investigate(g, i, s)) sprintDrift(g, i, offset(GUAM, [60, 120, 180][(i / 1200 | 0) % 3], 10), 12);
    return true;
  },

  P2: (g, i, s) => {
    if (evade(g, i, s)) return true;
    callFamily(g, CN_SUBS, 80);
    if (seen(g, ['type054a', ...CN_SUBS], 60).length) return { extra: CN_SUBS, minPct: 60 };
    radarLook(g, i);
    if (!atPeriscopeDepth(g)) sprintDrift(g, i, P(300, 15 + (i / 1800 | 0) % 2 * 5), 12);
    return true;
  },

  P15: (g, i, s) => {
    if (evade(g, i, s)) return true;
    callFamily(g, CN_SUBS, 85);
    if (seen(g, CN_SUBS, 70).length) return { extra: CN_SUBS, minPct: 70 };
    sprintDrift(g, i, (i / 2400 | 0) % 2 ? P(200, 8) : offset(P15_MOUTH, 200, 8), 12);
    return true;
  },

  P3: (g, i, s) => {
    if (evade(g, i, s)) return true;
    if (avoidMines(g, i)) return true;
    // Close the lane to missile range, then stay up with the radar and fire on identified landing ships.
    const lane = offset(P3_BEACH, 250, 12 + Math.max(0, 20 - g.t / 600));
    if (dist(g.own, lane) > 12) { sprintDrift(g, i, lane, 14, 8); return true; }
    if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 6); }
    orders.radar(g, true);
    if (i % 30 === 0) missiles(g, i, s, ['type075', 'type071'], 25);
    if (i % 120 === 0) { orders.heading(g, brg(g.own, lane)); orders.speed(g, dist(g.own, lane) > 5 ? 8 : 4); }
    return true;
  },

  P16: (g, i, s) => {
    if (evade(g, i, s)) return true;
    if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 6); }
    orders.radar(g, true);
    if (i % 20 === 0) missiles(g, i, s, ['type022'], 40, 'harpoon', 150);
    if (i % 60 === 30) missiles(g, i, s, ['type022'], 40, 'mst', 150) || missiles(g, i, s, ['type054a'], 20, 'mst', 200);
    if (i % 120 === 0) { const p = offset(MAKUNG, 270, 12); orders.heading(g, brg(g.own, p)); orders.speed(g, dist(g.own, p) > 2 ? 8 : 3); }
    return true;
  },

  P17: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const m = g.t / 60;
    if ((m > 46 && m < 65) || (m > 101 && m < 136)) { airDefence(g, i); if (i % 60 === 0) { orders.heading(g, brg(g.own, KAO)); orders.speed(g, 8); } return true; }
    callFamily(g, CN_SUBS, 80);
    const hunt = huntSubs(g, i, s, CN_SUBS, 50, 8);
    if (hunt) return hunt;
    // Keep 3 nm ahead of the lead ship, listening, and work out anything we hear.
    const lead = g.vessels.filter((v) => v.side === 'allied' && v.alive).sort((a, b) => dist(a, KAO) - dist(b, KAO))[0];
    if (!investigate(g, i, s, MERCH) && lead) sprintDrift(g, i, offset(lead, brg(lead, KAO), 3), 14, 6);
    return true;
  },

  P4: (g, i, s) => {
    if (evade(g, i, s)) return true;
    callFamily(g, CN_SUBS, 80);
    if (seen(g, CN_SUBS, 50).length) return { extra: CN_SUBS, minPct: 50 };
    // Creep in to about 10 nm from the bay mouth, ping, and put a Mk 48 into every submerged return.
    if (dist(g.own, SUBIC) < 10.5 && i - (s.m.pingT ?? -1e9) > 1200) { orders.ping(g); s.m.pingT = i; }
    if (s.m.pingT === i - 2) pingShots(g, 12);
    sprintDrift(g, i, offset(SUBIC, 260, 9), 8);
    return true;
  },

  P5: (g, i, s) => {
    if (evade(g, i, s)) return true;
    callFamily(g, CN_SUBS, 80);
    if (seen(g, CN_SUBS, 50).length) return { extra: CN_SUBS, minPct: 50 };
    // Shoot down the patrol plane first: up with the radar until it is down, JATM when it is in reach.
    const kq = g.vessels.find((v) => v.cls.key === 'kq200')!;
    if (kq.alive && g.t < 3600) { if (!atPeriscopeDepth(g)) orders.depth(g, 0); orders.radar(g, true); jatm(g, i); if (i % 60 === 0) orders.speed(g, 5); return true; }
    if (atPeriscopeDepth(g)) { orders.radar(g, false); orders.depth(g, 1); }
    // Then in to 9 nm from the line, ping, and shoot at the returns.
    if (dist(g.own, P5_LINE) < 11 && i - (s.m.pingT ?? -1e9) > 1500) { orders.ping(g); s.m.pingT = i; }
    if (s.m.pingT === i - 2) pingShots(g, 14);
    sprintDrift(g, i, offset(P5_LINE, 90, 10), 8);
    return true;
  },

  P18: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const lpd = g.contacts.find((c) => c.held && c.est && c.classified === 'type071');
    const ahead = offset(UOTSURI, 250, 10);
    if (!lpd) {
      if (dist(g.own, ahead) > 3) sprintDrift(g, i, ahead, 14, 8);
      radarLook(g, i, 600, 150);
      return true;
    }
    if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 5); }
    orders.radar(g, true);
    // Fire only on a radar fix with no cutter close to the aim point.
    const cutters = g.contacts.filter((c) => c.held && c.est && c.classified === 'ccg');
    const clear = cutters.every((c) => dist(c.est!, lpd.est!) > 0.8);
    if (clear && g.t - lpd.radarT < 10 && i % 30 === 0 && i - (s.m.f ?? -1e9) > 200) {
      g.selected = lpd.id;
      const before = g.stats.fired.mst;
      orders.fire(g, 'mst');
      if (g.stats.fired.mst > before) s.m.f = i;
    }
    return true;
  },

  P6: (g, i, s) => {
    // Open with Tomahawks on the three airfields, two each, then run for the exit with a radar look
    // every 20 minutes: Tomahawks at Nanchang whenever the radar finds her.
    if (i < 400 && i % 30 === 5 && g.stats.fired.tlam < 6) orders.strike(g, g.sites[g.stats.fired.tlam % 3].id);
    if (i % 600 === 0 && g.stats.fired.tlam < 9 && g.sites.some((x) => x.hits < 2) && i > 600) orders.strike(g, g.sites.find((x) => x.hits < 2)!.id);
    if (evade(g, i, s)) return true;
    if (i < 400) return true;
    const ns = seen(g, ['type055'], 60).filter((c) => dist(g.own, c.est!) < 6);
    if (ns.length) return { extra: ['type055'], minPct: 60 };
    const planes = g.contacts.some((c) => c.held && c.air && g.vessels.find((v) => v.id === c.vid && v.alive && v.side === 'enemy'));
    if (planes) s.m.planeT = i;
    if (atPeriscopeDepth(g)) jatm(g, i);
    if (i - (s.m.planeT ?? -1e9) > 300) radarLook(g, i, 1200, 120);
    else if (atPeriscopeDepth(g) && !g.weapons.some((w) => w.type === 'jatm' && !w.dead) && i % 30 === 0) { orders.radar(g, false); orders.depth(g, 1); }
    if (atPeriscopeDepth(g)) { missiles(g, i, s, ['type055'], 25, 'mst', 120); if (i % 60 === 0) orders.speed(g, 6); return true; }
    if (i % 60 === 0) { orders.heading(g, brg(g.own, P6_EXIT)); orders.speed(g, 10); }
    return true;
  },
};

const P = (b: number, d: number): Vec => offset({ x: 0, y: 0 }, b, d);
