// Balance captains for src/sim/modern/gulf2.ts. Each plays from what the player could see: the brief
// (lanes, bearings, where the sites are), contacts, matches, solutions, the log and the plot (marked mines, friendly ships).
import { atPeriscopeDepth, orders, type Contact, type Game } from '../../src/sim/sim';
import { angDiff, brg, clamp, dist, norm, offset, type Vec } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

export const captains: Record<string, Captain> = {};

const O: Vec = { x: 0, y: 0 }; // Tang's start: every brief gives positions from here.
const guess = (c: Contact, min = 60) => c.classified ?? (c.matches[0]?.pct > min ? c.matches[0].key : null);
const seen = (g: Game, keys: string[], min = 60) => g.contacts.filter((c) => c.held && c.est && !c.air && keys.includes(guess(c, min) ?? '') && g.vessels.find((v) => v.id === c.vid)?.alive);
const near = (g: Game, list: Contact[]) => list.sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];

/**
 * Torpedo evasion: when a torpedo we can hear is running within 4 nm of us, decoy, cross the layer where the
 * water allows, and run square across its track: flat out in deep water, at 16 knots in the shallows,
 * where there is no layer to hide under and a sprint only brings every frigate in earshot. True while running.
 */
function evade(g: Game, i: number, s: CaptainState, spd = 25) {
  const torps = g.weapons.filter((w) => w.side === 'enemy' && !w.dead && dist(w, g.own) < 4);
  const t = torps.sort((a, b) => dist(a, g.own) - dist(b, g.own))[0];
  if (t && (s.sprintT < 0 || i - s.sprintT > 60)) {
    const tb = brg(g.own, t);
    orders.decoy(g); orders.speed(g, spd); orders.layer(g);
    orders.heading(g, tb + (angDiff(g.own.hdg, tb) > 0 ? 90 : -90)); s.sprintT = i;
  }
  if (s.sprintT < 0) return false;
  if (i - s.sprintT > (t ? 300 : 120)) { s.sprintT = -1; orders.speed(g, 6); orders.depth(g, 1); return false; }
  return true;
}
/** Small fast boats (drone boats, missile boats): a Harpoon at each one held, again after two minutes if it is still running. */
function harpoonBoats(g: Game, i: number, s: CaptainState, keys: string[], max = 30) {
  if (i % 5) return;
  // Not when a friendly ship is close to the boat: the seeker takes whatever is nearest its aim point.
  const clear = (c: Contact) => !g.vessels.some((v) => v.alive && v.side === 'allied' && v.cls.kind === 'surface' && dist(v, c.est!) < 2 + c.estErr);
  const boats = seen(g, keys, 40).filter((c) => dist(g.own, c.est!) < max && i - (s.m[`h${c.id}`] ?? -1e9) > 120 && clear(c));
  const b = near(g, boats);
  if (!b) return;
  if (g.own.depthT > 1.05) { orders.depth(g, 1); return; }
  const keep = g.selected;
  g.selected = b.id;
  if (!b.classified) orders.classify(g, b.id, guess(b, 40)!);
  const before = g.stats.fired.harpoon;
  orders.fire(g, 'harpoon');
  if (g.stats.fired.harpoon > before) s.m[`h${b.id}`] = i;
  g.selected = keep;
}
/** Hunt submarines among friendly shipping: close the nearest, ASROC from stand-off, Mk 48 only with no friendly near the target. */
function subHunt(g: Game, i: number, s: CaptainState, keys: string[], min = 50) {
  const t = near(g, seen(g, keys, min));
  if (!t) return false;
  g.selected = t.id;
  if (!t.classified) orders.classify(g, t.id, guess(t, min)!);
  const r = dist(g.own, t.est!);
  const friend = (d: number) => g.vessels.some((v) => v.alive && v.side === 'allied' && dist(v, t.est!) < d + t.estErr);
  if (i % 60 === 0) { orders.heading(g, brg(g.own, t.est!)); orders.speed(g, r > 6 ? 12 : 5); }
  if (t.q > 0.5 && r > 1 && r < 15 && !friend(1) && i - (s.m.asroc ?? -1e9) > 150) { if (g.own.depthT > 1.05) orders.depth(g, 1); else { orders.fire(g, 'asroc'); s.m.asroc = i; } }
  if (t.q > 0.6 && r < 6 && !friend(3) && i % 120 === 0) orders.fire(g, 'mk48');
  return true;
}
/** Fire a TLAM at a named site when a vertical tube is free and that site still needs hits. */
function strike(g: Game, name: string, need: number) {
  const site = g.sites.find((x) => x.name === name);
  if (!site) return false;
  const flying = g.weapons.filter((w) => w.type === 'tlam' && w.contactId === site.id && !w.dead).length;
  if (site.hits + flying >= need) return false;
  if (g.own.depthT > 1.05) { orders.depth(g, 1); return true; }
  if (!g.own.vls.some((x) => x <= 0)) return false;
  orders.strike(g, site.id);
  return true;
}
/** Steer along a lane from `a` on `course`, `ahead` nm beyond the point `lead` has reached, stopping for marked mines in the way. */
function laneLead(g: Game, a: Vec, course: number, lead: Vec | null, ahead: number) {
  const u = { x: Math.sin((course * Math.PI) / 180), y: Math.cos((course * Math.PI) / 180) };
  const along = (p: Vec) => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  const cross = (g.own.x - a.x) * u.y - (g.own.y - a.y) * u.x; // + is to the right of the lane
  const mine = g.mines.find((m) => m.side === 'enemy' && m.found && dist(g.own, m) < 0.6 && Math.abs(angDiff(brg(g.own, m), g.own.hdg)) < 40);
  orders.heading(g, norm(course - clamp(cross * 40, -60, 60) + (mine ? (angDiff(brg(g.own, mine), g.own.hdg) > 0 ? -50 : 50) : 0)));
  const gap = along(g.own) - (lead ? along(lead) : -99);
  orders.speed(g, mine ? 3 : gap < ahead ? 9 : gap > ahead + 3 ? 3 : 7);
}
/** A radar look at periscope depth every quarter hour (it keeps the solutions on surface contacts fresh). */
function look(g: Game, i: number) {
  if (i % 900 === 450) orders.depth(g, 0);
  if (atPeriscopeDepth(g)) { orders.radar(g, true); if (i % 900 > 600) { orders.radar(g, false); orders.depth(g, 1); } }
}
/** Steer for the last reported submarine position (a helicopter's or patrol plane's cue) and listen there. True while doing so. */
function cueTo(g: Game, i: number, s: CaptainState, within: number, keep = 900) {
  for (const e of g.events) {
    const m = /possible submarine, bearing (\d+), range ([\d.]+) nm/.exec(e.text);
    if (m && Number(m[2]) < within) { const p = offset(g.own, Number(m[1]), Number(m[2])); s.m.cx = p.x; s.m.cy = p.y; s.m.ct = i; }
  }
  if (s.m.ct === undefined || i - s.m.ct > keep) return false;
  if (i % 30 === 0) { const p = { x: s.m.cx, y: s.m.cy }; const r = dist(g.own, p); orders.heading(g, brg(g.own, p)); orders.speed(g, r > 2 ? 12 : 4); }
  return true;
}
const allied = (g: Game, name: string) => g.vessels.find((v) => v.name === name && v.alive) ?? null;

captains.I5 = (g, i, s) => {
  if (evade(g, i, s, 16)) return true;
  harpoonBoats(g, i, s, ['fac']);
  const threat = seen(g, ['ghadir', 'kilo'], 50).filter((c) => dist(g.own, c.est!) < (guess(c, 50) === 'kilo' ? 12 : 6));
  if (threat.length && subHunt(g, i, s, ['ghadir', 'kilo'])) return true;
  if (cueTo(g, i, s, 10)) return true;
  if (i % 10 === 0) laneLead(g, offset(O, 300, 3), 120, allied(g, 'MT Ocean Pride') ?? g.vessels.find((v) => v.cls.key === 'tanker' && v.side === 'allied' && v.alive && !v.name.includes('Kaveh')) ?? null, 3);
  return true;
};

captains.I7 = (g, i, s) => {
  if (evade(g, i, s, 16)) return true;
  const kharg = offset(O, 20, 32);
  // Hand over to the generic captain only to fight something close; it would waste Tomahawks from out here.
  const fight = seen(g, ['kilo', 'jamaran']).some((c) => dist(g.own, c.est!) < 7);
  if (dist(g.own, kharg) > 18) {
    if (fight) return { extra: ['kilo', 'jamaran'] };
    if (i % 60 === 0) { orders.heading(g, brg(g.own, kharg)); orders.speed(g, 8); }
    return true;
  }
  if (i % 20 === 0) {
    if (!strike(g, 'Kharg air-defence radar', 1)) {
      const radarDown = (g.sites.find((x) => x.name.includes('radar'))?.hits ?? 0) > 0;
      if (radarDown || i - (s.m.inT ??= i) > 900) for (const n of ['Kharg T-jetty', 'Sea Island terminal', 'Kharg tank farm']) if (strike(g, n, 3)) break;
    }
  }
  if (fight) return { extra: ['kilo', 'jamaran'] };
  if (i % 120 === 0) { orders.heading(g, brg(g.own, kharg) + 90); orders.speed(g, 5); }
  return true;
};

captains.I18 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  harpoonBoats(g, i, s, ['droneboat'], 35);
  look(g, i);
  const mouth = offset(O, 250, 8);
  if (seen(g, ['ghadir'], 50).some((c) => dist(g.own, c.est!) < 8)) return { extra: ['ghadir'], minPct: 50 };
  if (i % 60 === 0) { const p = offset(mouth, 45, 2.5); orders.heading(g, dist(g.own, p) > 0.7 ? brg(g.own, p) : g.own.hdg + 90); orders.speed(g, dist(g.own, p) > 1 ? 8 : 3); }
  return true;
};

captains.I19 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  harpoonBoats(g, i, s, ['fac']);
  if (i % 10 === 0) laneLead(g, offset(O, 240, 3), 60, allied(g, 'Mozah') ?? g.vessels.find((v) => v.cls.key === 'lng' && v.alive) ?? null, 3);
  return true;
};

captains.I6 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  harpoonBoats(g, i, s, ['droneboat']);
  if (i > 20 && i % 20 === 0) strike(g, 'Perim Island radar', 1) || strike(g, 'Dhubab launcher site', 2) || strike(g, 'Mocha launcher site', 2);
  look(g, i);
  if (seen(g, ['jamaran']).length) return { extra: ['jamaran'] };
  if (i % 120 === 0) { orders.heading(g, 340); orders.speed(g, 8); }
  return true;
};

captains.I20 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  for (const e of g.events) {
    const m = /possible submarine, bearing (\d+), range ([\d.]+) nm/.exec(e.text);
    if (m) { const p = offset(g.own, Number(m[1]), Number(m[2])); s.m.cx = p.x; s.m.cy = p.y; s.m.ct = i; }
  }
  if (seen(g, ['kilo'], 75).length) return { extra: ['kilo'], minPct: 75 };
  if (i % 60 === 0) {
    const p = s.m.ct !== undefined && i - s.m.ct < 1500 ? { x: s.m.cx, y: s.m.cy } : offset(O, 270, 4);
    const r = dist(g.own, p);
    orders.heading(g, brg(g.own, p)); orders.speed(g, r > 3 ? 12 : 5);
  }
  return true;
};

captains.I21 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  harpoonBoats(g, i, s, ['droneboat'], 20);
  const lateral = Math.sin(((brg(O, g.own) - 25) * Math.PI) / 180) * dist(O, g.own);
  if (Math.abs(lateral) > 4.5) { if (i % 30 === 0) { orders.heading(g, lateral > 0 ? 25 + 270 : 25 + 90); orders.speed(g, 8); } return true; }
  if (i % 120 === 0 && !seen(g, ['jamaran']).length) { orders.heading(g, 205); orders.speed(g, 8); }
  return { extra: ['jamaran'] };
};

captains.I11 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  look(g, i);
  if (seen(g, ['kilo', 'jamaran'], 50).length) return { extra: ['jamaran'], minPct: 50 };
  // Wait across their track; once one is sunk, sprint and drift down the track after the other.
  const sunk = g.vessels.filter((v) => v.cls.key === 'kilo' && !v.alive && !v.gone).length;
  if (sunk) { if (i % 600 === 0) { orders.heading(g, 130); orders.speed(g, 13); } if (i % 600 === 360) orders.speed(g, 5); }
  else if (i % 120 === 0) { const p = offset(O, 320, 5); orders.heading(g, brg(g.own, p)); orders.speed(g, dist(g.own, p) > 1 ? 8 : 3); }
  return true;
};

captains.I22 = (g, i, s) => {
  if (evade(g, i, s, 16)) return true;
  const mouth = offset(O, 0, 12);
  const done = (g.flags.laid ?? 0) >= 6;
  if (i % 30 === 0) {
    const p = done ? offset(O, 180, 2) : mouth;
    const r = dist(g.own, mouth);
    orders.heading(g, brg(g.own, p)); orders.speed(g, done ? 5 : r > 8 ? 8 : 5);
  }
  if (!done && dist(g.own, mouth) < 1.2 && i % 20 === 0) orders.layMine(g);
  if (seen(g, ['kilo', 'jamaran']).some((c) => dist(g.own, c.est!) < 4)) return { extra: ['kilo', 'jamaran'] };
  return true;
};

captains.I23 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  look(g, i);
  // Close slowly and quietly; hand over to the generic captain inside 12 nm or when a sub is near.
  const lhd = near(g, seen(g, ['type071']));
  const sub = seen(g, ['type039'], 40).some((c) => dist(g.own, c.est!) < 8);
  if (!sub && (!lhd || dist(g.own, lhd.est!) > 12)) {
    if (i % 120 === 0) { orders.heading(g, lhd ? brg(g.own, lhd.est!) : 215); orders.speed(g, 7); }
    return true;
  }
  return { extra: ['type054a', 'type039'], minPct: 40 };
};

captains.I10 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  const canal = offset(O, 340, 22);
  // The blockship: a tanker under way northbound, from its solution's course and speed.
  const bs = g.contacts.filter((c) => c.held && c.est && c.motion && ['tanker'].includes(c.matches[0]?.key) && c.motion.spd > 6 && Math.abs(angDiff(c.motion.crs, brg(c.est!, canal))) < 40);
  // Once we have picked her out, stay on her even when she turns away to dodge.
  const prev = g.contacts.find((c) => c.id === s.m.tid && c.est && g.vessels.find((v) => v.id === c.vid)?.alive);
  const t = prev ?? near(g, bs);
  if (t) s.m.tid = t.id;
  if (seen(g, ['kilo'], 60).some((c) => dist(g.own, c.est!) < 5)) return { extra: ['kilo'] };
  if (!t || !t.est) {
    // Work up solutions on the merchants: legs across their bearings until their course and speed show.
    const open = near(g, g.contacts.filter((c) => c.held && c.est && !c.motion && ['tanker', 'lng', 'boxship'].includes(c.matches[0]?.key)));
    if (i % 240 === 0) { orders.heading(g, open ? brg(g.own, open.est!) + (s.legs++ % 2 ? 70 : -70) : 160); orders.speed(g, 6); }
    return true;
  }
  g.selected = t.id;
  const r = dist(g.own, t.est!);
  if (i % 60 === 0) { orders.heading(g, brg(g.own, t.motion ? offset(t.est!, t.motion.crs, r / 5) : t.est!)); orders.speed(g, r > 5 ? 15 : 6); }
  if (t.q > 0.6 && r < 7 && dist(t.est!, canal) > 5 && i % 90 === 0) orders.fire(g, 'mk48');
  return true;
};

captains.I24 = (g, i, s) => {
  if (evade(g, i, s)) return true;
  // Close in quietly, Tomahawk the oiler at anchor, then the depot; fight whatever comes out.
  const oiler = seen(g, ['type901'], 50)[0];
  const ov = oiler && g.vessels.find((v) => v.id === oiler.vid);
  if (oiler && ov && i % 60 === 0 && dist(g.own, oiler.est!) < 10 && g.weapons.filter((w) => w.type === 'mst' && !w.dead).length < 2 * Math.ceil(ov.hp / 3)) {
    if (g.own.depthT > 1.05) orders.depth(g, 1);
    else { g.selected = oiler.id; if (!oiler.classified) orders.classify(g, oiler.id, 'type901'); orders.fire(g, 'mst'); }
  }
  if (g.stats.fired.mst > 0 && i % 20 === 0) strike(g, 'Hadibu fuel depot', 3);
  if (!g.stats.fired.mst) look(g, i);
  if (seen(g, ['kilo', 'fac'], 50).some((c) => dist(g.own, c.est!) < 6) || (oiler && g.stats.fired.mst > 0)) return { extra: ['type901', 'kilo', 'fac'], minPct: 50 };
  if (i % 120 === 0) { const p = offset(O, 30, 7); orders.heading(g, brg(g.own, p)); orders.speed(g, dist(g.own, p) > 1 ? 8 : 4); }
  return true;
};
