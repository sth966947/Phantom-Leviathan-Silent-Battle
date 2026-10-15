// Balance captains for src/sim/modern/pacific2.ts.
// Each plays from what the player sees: the brief, contacts, matches, solutions, the log and the objectives.
import { atPeriscopeDepth, orders, type Contact, type Game } from '../../src/sim/sim';
import { brg, dist, offset, type Vec } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

export const captains: Record<string, Captain> = {};

const vesselOf = (g: Game, c: Contact) => g.vessels.find((v) => v.id === c.vid)!;
const guess = (c: Contact, min = 60) => c.classified ?? (c.matches[0]?.pct > min ? c.matches[0].key : null);
/** Torpedo evasion as in the duel: decoy, cross the layer, turn away and sprint, then slow down again. True while sprinting. */
function evade(g: Game, i: number, s: CaptainState) {
  for (const e of g.events) if (/Torpedo in the water|seeker has acquired us/.test(e.text) && (s.sprintT < 0 || i - s.sprintT > 60)) {
    orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i;
  }
  if (s.sprintT < 0) return false;
  if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); return false; }
  return true;
}
const goTo = (g: Game, p: Vec, spd: number) => { orders.heading(g, brg(g.own, p)); orders.speed(g, spd); };
/** Close on the loudest unidentified contact (not one of `skip`): what a player does to get a better look. */
function closeOnNoise(g: Game, i: number, skip: string[], spd = 10) {
  const c = g.contacts.filter((x) => x.held && !x.air && x.bearing !== null && !skip.includes(guess(x, 45) ?? '')).sort((a, b) => b.seAvg - a.seAvg)[0];
  if (c && i % 120 === 0) { orders.heading(g, c.bearing!); orders.speed(g, spd); }
  return !!c;
}
/** Fire at a contact we are sure of: Mk 48 inside 8 nm. */
function shoot(g: Game, i: number, c: Contact) {
  g.selected = c.id;
  const r = dist(g.own, c.est!);
  if (c.q > 0.6 && r < 8 && i % 90 === 0) orders.fire(g, 'mk48');
}
/** At periscope depth: radar on, and a JATM at any enemy aircraft held. */
function antiAir(g: Game, i: number, only?: string) {
  orders.radar(g, true);
  if (i % 20 || g.weapons.some((w) => w.type === 'jatm' && !w.dead)) return;
  const a = g.contacts.find((c) => c.held && c.air && c.bearing !== null && (!only || !c.classified || c.classified === only) && vesselOf(g, c).alive && vesselOf(g, c).side === 'enemy');
  if (!a) return;
  const keep = g.selected; g.selected = a.id; orders.fire(g, 'jatm'); g.selected = keep;
}

/** Shoot back down the bearing of a launch transient, at a held contact there that isn't one of `spare`. */
function shootBack(g: Game, spare: string[]) {
  for (const e of g.events) {
    const m = /Launch transient, bearing (\d+)/.exec(e.text);
    if (!m) continue;
    const b = Number(m[1]);
    const c = g.contacts.find((x) => x.held && x.est && !x.air && Math.abs(((brg(g.own, x.est) - b + 540) % 360) - 180) < 20 && dist(g.own, x.est) < 10 && !spare.includes(guess(x, 40) ?? ''));
    if (!c) continue;
    const keep = g.selected; g.selected = c.id; orders.fire(g, 'mk48'); g.selected = keep;
  }
}

/** Before the generic captain: dodge torpedoes, and JATM any patrol plane or helicopter while we're up. */
function guard(g: Game, i: number, s: CaptainState) {
  if (evade(g, i, s)) return true;
  if (atPeriscopeDepth(g) && i % 20 === 0 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) {
    const a = g.contacts.find((c) => c.held && c.air && c.bearing !== null && vesselOf(g, c).alive && vesselOf(g, c).side === 'enemy' && vesselOf(g, c).ai?.mode !== 'strike');
    if (a) { const keep = g.selected; g.selected = a.id; orders.fire(g, 'jatm'); g.selected = keep; }
  }
  return false;
}

// Plain hunts: the generic captain, plus torpedo evasion and air defence.
const plain = (r: { extra?: string[]; minPct?: number }): Captain => (g, i, s) => (guard(g, i, s) ? true : r);
captains.P7 = plain({});
captains.P10 = plain({});
captains.P22 = plain({ extra: ['type093b'] });
captains.P23 = plain({ extra: ['type093b'] });
captains.P19 = plain({ extra: ['type093b'] });
captains.P20 = plain({ minPct: 40 });
captains.P26 = plain({ extra: ['type093b', 'kilo'] });

// Carriers and missile boats: close on the noise until the signature firms up, then hunt.
const closer = (want: string, skip: string[], min = 50): Captain => (g, i, s) => {
  if (guard(g, i, s)) return true;
  if (g.contacts.some((c) => c.held && c.est && guess(c, min) === want)) return { minPct: min };
  closeOnNoise(g, i, skip, 8);
  return true;
};
captains.P8 = closer('fujian', ['type093b', 'kq200', 'ka28']);
captains.P21 = closer('shandong', ['tanker', 'type039', 'ka28']);
captains.P12 = (g, i, s) => {
  if (guard(g, i, s)) return true;
  if (g.contacts.some((c) => c.held && c.est && guess(c, 40) === 'borei')) return { minPct: 40 };
  const box = { x: 0, y: 18 };
  // Something unidentified on sonar: close it slowly to firm up the signature.
  if (dist(g.own, box) < 11 && closeOnNoise(g, i, ['kilo', 'il38'], 6)) { orders.depth(g, 1); return true; }
  // Every 20 minutes a look at periscope depth, radar off: ESM finds the Il-38 and a JATM goes down its bearing.
  if (i % 1200 < 150 && i > 600) { orders.depth(g, 0); orders.speed(g, 5); return true; }
  if (i % 1200 === 150) orders.depth(g, 1);
  // Run to the box, then search it slowly: a star of legs through its centre.
  if (dist(g.own, box) > 9 && !s.m.inBox) { if (i % 60 === 0) { goTo(g, box, 8); orders.depth(g, 2); } return true; }
  s.m.inBox = 1;
  const wp = (s.m.leg ?? 0) % 2 ? box : offset(box, (s.m.leg ?? 0) * 77, 7);
  if (dist(g.own, wp) < 1) s.m.leg = (s.m.leg ?? 0) + 1;
  if (i % 60 === 0) goTo(g, wp, 6);
  return true;
};

// Kazan and her decoys: a decoy is a brand-new Yasen contact running fast and straight, and it dies within 15 minutes.
captains.P11 = (g, i, s) => {
  if (guard(g, i, s)) return true;
  // A look at periscope depth every 20 minutes, radar off, to put a JATM down the Il-38's radar bearing.
  if (i % 1200 < 150 && i > 300 && !s.m.ilDown) { orders.depth(g, 0); orders.speed(g, 5); return true; }
  if (i % 1200 === 150) orders.depth(g, 1);
  for (const e of g.events) if (/Splash one Il-38/.test(e.text)) s.m.ilDown = 1;
  for (const c of g.contacts) if (c.held && s.m[`seen${c.id}`] === undefined) s.m[`seen${c.id}`] = i;
  const ok = (c: Contact) => c.held && c.est && guess(c, 40) === 'yasen' && !(c.motion && c.motion.spd > 10.5) && i - s.m[`seen${c.id}`] > (s.m.decoys ? 960 : 0);
  for (const e of g.events) if (/launched a countermeasure|new contact/.test(e.text)) s.m.decoys = 1;
  const k = g.contacts.filter(ok).sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
  if (!k) {
    // Nothing firm yet: close anything unidentified, else sweep the strait ahead in zigzag legs.
    if (closeOnNoise(g, i, ['il38'], 6)) return true;
    const far = Math.hypot(g.own.x, g.own.y) > 14;
    if (i % 900 === 0) { orders.heading(g, far ? brg(g.own, { x: 0, y: 6 }) : (i / 900) % 2 ? 320 : 40); orders.speed(g, 7); }
    return true;
  }
  if (!k.classified) orders.classify(g, k.id, 'yasen');
  if (i % 240 === 0) { orders.heading(g, k.bearing! + (s.legs++ % 2 ? 45 : -45)); orders.speed(g, 6); }
  shoot(g, i, k);
  return true;
};

// Hainan: through the swept gap, find the Jins in the hole, tag two, then report. Never shoot a Jin.
captains.P9 = (g, i, s) => {
  shootBack(g, ['type094']);
  if (evade(g, i, s)) return true;
  const o = g.own;
  if (g.flags.ready) { orders.depth(g, 0); orders.speed(g, 5); return true; }
  // Inside, a radar look every 20 minutes picks out the corvettes.
  if (o.y > 11.5 && i % 1200 < 90) { orders.depth(g, 0); if (atPeriscopeDepth(g)) orders.radar(g, true); orders.speed(g, 5); return true; }
  if (o.y > 11.5 && i % 1200 === 90) { orders.radar(g, false); orders.depth(g, 2); }
  if (o.y < 11.5) { if (i % 30 === 0) { goTo(g, o.y < 8 ? { x: 2, y: 8 } : { x: 2, y: 13 }, o.y < 8 ? 10 : 6); orders.depth(g, 2); } return true; }
  const jin = g.contacts.filter((c) => c.held && c.est && !c.air && (c.classified === 'type094' || c.matches[0]?.key === 'type094' && c.matches[0].pct > 40))
    .filter((c) => !s.m[`done${c.id}`]).sort((a, b) => dist(o, a.est!) - dist(o, b.est!))[0];
  for (const c of g.contacts) if (c.classified === 'type094' && (s.m[`t${c.id}`] = (s.m[`t${c.id}`] ?? 0) + (c.held && c.q >= 0.6 && dist(o, c.est!) < 10 ? 1 : 0)) > 125) s.m[`done${c.id}`] = 1;
  if (!jin) {
    const known = (c: Contact) => s.m[`done${c.id}`] || ['type093b', 'type056', 'type052d'].includes(guess(c, 45) ?? '');
    const c = g.contacts.filter((x) => x.held && !x.air && x.est && !known(x) && x.est.y > 11).sort((a, b) => b.seAvg - a.seAvg)[0];
    if (i % 120 === 0) { if (c) goTo(g, c.est!, 6); else goTo(g, offset({ x: 1, y: 16 }, (i / 300) * 80, 3), 5); }
    return true;
  }
  g.selected = jin.id;
  if (!jin.classified) orders.classify(g, jin.id, 'type094');
  const r = dist(o, jin.est!);
  if (i % 240 === 0) { orders.heading(g, r > 5 ? brg(o, jin.est!) : jin.bearing! + (s.legs++ % 2 ? 60 : -60)); orders.speed(g, r > 5 ? 8 : 5); }
  return true;
};

// Downed pilots: run for the raft at 150 feet with a radar look and JATMs on the way, then the pickup at periscope depth.
captains.P24 = (g, i, s) => {
  const raft = offset({ x: 0, y: 0 }, 65, 15), o = g.own, d = dist(o, raft);
  if (g.flags.aboard) { if (evade(g, i, s)) return true; orders.depth(g, 2); if (i % 30 === 0) goTo(g, { x: 0, y: 0 }, 14); return true; }
  shootBack(g, []);
  if (d > 2 && evade(g, i, s)) return true;
  for (const e of g.events) if (/Splash one Ka-28/.test(e.text)) s.m.kills = (s.m.kills ?? 0) + 1;
  const look = i % 420 >= 270 && (s.m.kills ?? 0) < 2;
  if (d > 2) {
    if (i % 30 === 0) goTo(g, raft, look ? 8 : d > 5 ? 15 : 8);
    orders.depth(g, look ? 0 : 2);
    if (atPeriscopeDepth(g)) antiAir(g, i); else orders.radar(g, false);
    return true;
  }
  orders.depth(g, 0);
  if (atPeriscopeDepth(g)) antiAir(g, i);
  orders.heading(g, brg(o, raft));
  orders.speed(g, d > 0.6 ? 8 : d > 0.25 ? 3 : 1);
  return true;
};

// Vladivostok: through the swept channel, three mines in each zone, and back out the same way.
captains.P25 = (g, i, s) => {
  shootBack(g, []);
  if (evade(g, i, s)) return true;
  const o = g.own, A = { x: 0, y: 12 }, B = offset({ x: 0, y: 0 }, 32, 13), gap = 2.25;
  const inA = g.flags.inA ?? 0, inB = g.flags.inB ?? 0;
  orders.depth(g, 2);
  const foe = g.contacts.find((c) => c.held && c.est && ['kilo', 'steregushchiy'].includes(guess(c) ?? '') && dist(o, c.est) < 6 && c.q > 0.6);
  if (foe) { const keep = g.selected; shoot(g, i, foe); g.selected = keep; }
  const north = o.y > 5.5;
  let wp: Vec;
  if (inA < 3 || inB < 3) wp = !north ? (o.y < 2 ? { x: gap, y: 2 } : { x: gap, y: 6 }) : inA < 3 ? A : B;
  else wp = north ? (dist(o, { x: gap, y: 6 }) > 0.5 ? { x: gap, y: 6 } : { x: gap, y: 1 }) : { x: gap, y: 0 };
  const r = dist(o, wp);
  if (i % 20 === 0) goTo(g, wp, (wp === A || wp === B) && r < 1 ? 4 : 7);
  if ((wp === A || wp === B) && r < 0.35 && i % 40 === 0) orders.layMine(g);
  return true;
};
