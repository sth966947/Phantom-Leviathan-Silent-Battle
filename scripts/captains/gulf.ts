// Balance captains for src/sim/modern/gulf.ts. Each plays from what the player could see: contacts,
// suggested matches, solutions, the log, the periscope and radar, and what the brief says.
import { atPeriscopeDepth, inPeriscope, isFriendlyClass, orders, type Contact, type Game } from '../../src/sim/sim';
import { angDiff, brg, dist, norm, type Vec } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

const vesselOf = (g: Game, c: Contact) => g.vessels.find((v) => v.id === c.vid);
/** The class a player would call a contact: what it was classified as, else a strong enough match. */
const guess = (c: Contact, minPct: number) => c.classified ?? (c.matches[0]?.pct > minPct ? c.matches[0].key : null);
/** Held surface or sub contacts that look like one of `keys`, nearest first. */
function hostiles(g: Game, keys: string[], minPct = 60) {
  return g.contacts.filter((c) => c.held && c.est && !c.air && keys.includes(guess(c, minPct) ?? '') && vesselOf(g, c)?.alive)
    .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!));
}
/** What the periscope shows, the player names: classify anything in view by eye. */
function eyeball(g: Game) {
  for (const c of g.contacts) {
    const v = inPeriscope(g, c);
    if (v && c.classified !== v.cls.key && v.cls.kind === 'surface') orders.classify(g, c.id, v.cls.key);
  }
}
/** Torpedo evasion: decoy, cross the layer, turn away from it and sprint; then slow again. True while evading. */
function evade(g: Game, i: number, s: CaptainState, escort = false, counter = false) {
  for (const e of g.events) {
    // With a convoy about, most torpedoes are for the ships: only a seeker on us is worth running from.
    const m = (escort ? /seeker has acquired us/ : /Torpedo in the water, bearing (\d+)|seeker has acquired us/).exec(e.text);
    if (!m || (s.sprintT >= 0 && i - s.sprintT < 60)) continue;
    orders.decoy(g); orders.speed(g, 26); orders.depth(g, g.own.depthT > 1.5 ? 1 : 2);
    orders.heading(g, m[1] ? norm(Number(m[1]) + 180) : norm(g.own.hdg + 120));
    s.sprintT = i; s.deepT = i;
  }
  if (s.sprintT < 0) return false;
  if (i === s.sprintT && counter && i - (s.m.counterT ?? -1e9) > 300 && g.events.some((e) => /Launch transient/.test(e.text))) {
    // Someone unseen shot at us: ping for a fix and send an ASROC back.
    s.m.counterT = i; orders.ping(g); pingShot(g, ['kalvari', 'type209', 'type039']);
  }
  if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); return false; }
  return true;
}
/** Up to periscope depth for a radar look every so often; JATM at any enemy patrol plane in view. */
function airDefence(g: Game, i: number, s: CaptainState, every = 900) {
  if (i - s.deepT < 600) return;
  if (i % every === every / 2) orders.depth(g, 0);
  if (!atPeriscopeDepth(g)) return;
  orders.radar(g, true);
  const air = g.contacts.find((c) => c.held && c.air && c.bearing !== null && c.classified && !isFriendlyClass(c.classified) && vesselOf(g, c)?.alive);
  if (air && i % 20 === 0 && !g.weapons.some((w) => w.side === 'us' && w.type === 'jatm' && !w.dead)) { const keep = g.selected; g.selected = air.id; orders.fire(g, 'jatm'); g.selected = keep; }
  if (i % every > every / 2 + 240 || i % every < every / 2) { orders.radar(g, false); orders.depth(g, 1); }
}
/** Steer for a point, edging round any marked mine close ahead; slow near a known minefield. */
function goTo(g: Game, to: Vec, spd: number) {
  let h = brg(g.own, to);
  for (const m of g.mines) {
    if (m.side === 'us' || !m.found) continue;
    const d = dist(g.own, m), off = angDiff(brg(g.own, m), h);
    if (d < 1.5 && Math.abs(off) < 35) h = norm(h - Math.sign(off || 1) * 45);
  }
  orders.heading(g, h); orders.speed(g, spd);
}
/** Right after a ping: any return close by that isn't a ship we know is the sub we're after. Name it and shoot. */
function pingShot(g: Game, keys: string[], reach = 8) {
  const c = g.contacts.filter((x) => x.lastSeen === g.t && x.q === 1 && !x.air && x.est && vesselOf(g, x)?.side !== 'allied' && (!x.classified || keys.includes(x.classified)) && dist(g.own, x.est) < reach)
    .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
  if (!c || !clearShot(g, c.est!, 2)) return;
  if (!c.classified) orders.classify(g, c.id, keys[0]);
  g.selected = c.id;
  const r = dist(g.own, c.est!);
  orders.fire(g, r > 1.2 ? 'asroc' : 'mk48');
  if (r < 7) orders.fire(g, 'mk48');
}
/** Our own convoy's ships: the player knows where they are on the plot. */
const friends = (g: Game) => g.vessels.filter((v) => v.alive && v.side === 'allied' && v.cls.kind === 'surface');
/** No friendly ship near the target or the run out to it, where a seeker could take it instead. */
function clearShot(g: Game, at: Vec, margin = 2.5) {
  return !friends(g).some((f) => [0.3, 0.5, 0.75, 1].some((k) => dist(f, { x: g.own.x + (at.x - g.own.x) * k, y: g.own.y + (at.y - g.own.y) * k }) < (k === 1 ? margin : 1.2)));
}
/** Our own attack on one contact: close it, then torpedo, ASROC or missile, never into the convoy. */
function attack(g: Game, i: number, c: Contact, sub: boolean, close = true) {
  g.selected = c.id;
  const r = dist(g.own, c.est!), safe = clearShot(g, c.est!);
  const running = g.weapons.filter((w) => w.side === 'us' && !w.dead && w.contactId === c.id).length;
  if (close && i % 60 === 0) { orders.heading(g, brg(g.own, c.est!)); orders.speed(g, r > 8 ? 12 : 6); if (g.own.ordDepth === 0) orders.depth(g, 1); }
  if (!safe || running >= (sub ? 2 : 1) || c.q < 0.55) return;
  if (r < 7 && i % 90 === 0) orders.fire(g, 'mk48');
  else if (sub && r > 1.2 && r < 12 && c.q > 0.6 && i % 150 === 0) orders.fire(g, 'asroc');
  else if (!sub && r > 4 && r < 30 && c.q > 0.6 && i % 120 === 0) orders.fire(g, g.flags.jammed ? 'harpoon' : 'mst');
}
/**
 * Convoy escort: keep station ahead of the lead ship and listen; a launch transient means a boat is
 * on the convoy, so ping for it and shoot back; any boat we hold inside 12 nm, go and kill.
 */
function escort(g: Game, i: number, s: CaptainState, leadName: string, course: number, subs: string[], call: string, wary = false) {
  if (evade(g, i, s, !wary)) return true;
  // A ping every ten minutes from ahead of the convoy, and at once on a launch transient.
  if ((g.events.some((e) => /Launch transient/.test(e.text)) || i % 600 === 300) && i - (s.m.counterT ?? -1e9) > 120 && g.own.depthT < 1.5) {
    s.m.counterT = i; orders.ping(g); pingShot(g, [call], 13);
  }
  const boat = hostiles(g, [...subs], 50)[0];
  if (boat && dist(g.own, boat.est!) < 12) { if (!boat.classified) orders.classify(g, boat.id, call); attack(g, i, boat, true); return true; }
  if (i % 60 === 0 && !atPeriscopeDepth(g)) {
    const lead = g.vessels.find((v) => v.name === leadName && v.alive) ?? friends(g)[0];
    // On the bow, out of the line a boat ahead would fire down at the convoy.
    const spot = lead ? { x: lead.x + Math.sin((course + 70) * Math.PI / 180) * 3, y: lead.y + Math.cos((course + 70) * Math.PI / 180) * 3 } : null;
    const r = spot ? dist(g.own, spot) : 0;
    orders.heading(g, spot && r > 0.5 ? brg(g.own, spot) : course); orders.speed(g, r > 1 ? 16 : lead ? Math.round(lead.spd) : 8); orders.depth(g, 1);
  }
  return true;
}
/** Hand the tick to the generic captain when there's a target worth fighting in reach, else true. */
function fightOr(g: Game, keys: string[], minPct: number, within: number, search: () => void): true | { extra: string[]; minPct: number } {
  if (hostiles(g, keys, minPct).some((c) => dist(g.own, c.est!) < within)) return { extra: keys, minPct };
  search();
  return true;
}

export const captains: Record<string, Captain> = {
  B2: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Deep and steady for Agulhas; fight only what is close and has a solution.
    if (hostiles(g, ['valour', 'type209'], 60).some((c) => c.q > 0.6 && dist(g.own, c.est!) < 4)) return { extra: ['valour', 'type209'], minPct: 60 };
    if (i % 60 === 0) { orders.heading(g, 90); orders.speed(g, 11); orders.depth(g, 2); }
    return true;
  },
  I12: (g, i, s) => {
    if (evade(g, i, s)) return true;
    eyeball(g);
    // Only fire at what the radar or periscope has named: the tankers sound like the supply ship.
    const sure = g.contacts.some((c) => c.held && (c.classified === 'type901' || (c.classified === 'type209')));
    if (sure) return { extra: ['type901', 'type209'], minPct: 101 };
    // The 209 is the only sub: name it from its match.
    const boat = hostiles(g, ['type209', 'kalvari'], 50)[0];
    if (boat && !boat.classified) orders.classify(g, boat.id, 'type209');
    if (i % 900 === 450) orders.depth(g, 0);
    if (atPeriscopeDepth(g)) { orders.radar(g, true); if (i % 900 > 700) { orders.radar(g, false); orders.depth(g, 1); } }
    if (i % 120 === 0) { orders.heading(g, 0); orders.speed(g, atPeriscopeDepth(g) ? 6 : 9); }
    return true;
  },
  I13: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const base = { x: -36, y: 0 };
    const nearLine = g.own.x < -23 && g.own.x > -29;
    if (nearLine && !s.m.pinged) { s.m.pinged = 1; orders.ping(g); }
    // A radar look every ten minutes for the frigate and the drone boats; missiles at them when found.
    const t = hostiles(g, ['jamaran', 'droneboat'], 60).filter((c) => c.q > 0.6 && dist(g.own, c.est!) < 30)[0];
    if (t && !nearLine) attack(g, i, t, false, false);
    if (g.events.some((e) => /drone boats coming for our datum/.test(e.text))) { s.m.pdT = -1e9; s.m.hideT = i; orders.radar(g, false); orders.depth(g, 1); }
    if (!nearLine && i % 600 === 300 && i - (s.m.hideT ?? -1e9) > 1200) { s.m.pdT = i; orders.depth(g, 0); orders.speed(g, 8); }
    if (i - (s.m.pdT ?? -1e9) < 180) { if (atPeriscopeDepth(g)) orders.radar(g, true); return true; }
    if (g.own.radar) orders.radar(g, false);
    if (i % 20 === 0) { goTo(g, base, nearLine ? 6 : 14); orders.depth(g, 1); }
    return true;
  },
  I1: (g, i, s) => {
    if (evade(g, i, s)) return true;
    airDefence(g, i, s);
    for (const e of g.events) {
      const m = /sonobuoy contact, diesel submarine, bearing (\d+), (\d+) nm/.exec(e.text);
      if (m) { const b = Number(m[1]) * Math.PI / 180, r = Number(m[2]); const p = { x: g.own.x + Math.sin(b) * r, y: g.own.y + Math.cos(b) * r }; if (s.m.cueT !== i || dist(g.own, p) < dist(g.own, { x: s.m.cx, y: s.m.cy })) { s.m.cx = p.x; s.m.cy = p.y; } s.m.cueT = i; }
    }
    const kal = hostiles(g, ['kalvari', 'type209', 'type039'], 40);
    for (const c of kal) if (!c.classified) orders.classify(g, c.id, 'kalvari');
    if (kal.length) return { extra: ['kalvari'], minPct: 40 };
    if (!s.m.cueT || atPeriscopeDepth(g)) return true;
    const cue = { x: s.m.cx, y: s.m.cy }, r = dist(g.own, cue);
    if (i % 60 === 0) { orders.heading(g, brg(g.own, cue)); orders.speed(g, r > 4 ? 14 : 5); }
    // Close in on the cue, then one ping for a fix.
    if (r < 4 && i - (s.m.pingT ?? -1e9) > 600) { s.m.pingT = i; orders.ping(g); pingShot(g, ['kalvari']); }
    return true;
  },
  I2: (g, i, s) => escort(g, i, s, 'MT Gulf Spirit', 240, ['type209', 'kalvari'], 'type209'),
  I14: (g, i, s) => {
    if (evade(g, i, s, false, true)) return true;
    airDefence(g, i, s, 600);
    return fightOr(g, ['talwar'], 60, 30, () => { if (i % 120 === 0) { orders.heading(g, 40); orders.speed(g, i < 1800 ? 8 : 4); orders.depth(g, 1); } });
  },
  I3: (g, i, s) => {
    if (evade(g, i, s, false, true)) return true;
    airDefence(g, i, s, 1200);
    return fightOr(g, ['vikrant', 'kolkata'], 60, 40, () => { if (i % 120 === 0) { orders.heading(g, 300); orders.speed(g, 10); } });
  },
  I15: (g, i, s) => { airDefence(g, i, s); return escort(g, i, s, 'MT Pakistan Pride', 22, ['kalvari', 'type209'], 'kalvari'); },
  I16: (g, i, s) => {
    if (evade(g, i, s, false, true)) return true;
    airDefence(g, i, s, 600);
    // The brief says the destroyer is the only warship out there: a lone radar blip west of the islands is Kochi.
    for (const c of g.contacts) if (c.held && !c.air && !c.classified && c.radarT === g.t && vesselOf(g, c)?.cls.kind === 'surface') orders.classify(g, c.id, 'kolkata');
    const kochiDown = g.vessels.some((v) => v.cls.key === 'kolkata' && !v.alive && !v.gone);
    // With the destroyer gone (or time short), Tomahawks at the targets still needing hits.
    if ((kochiDown || g.t > 2 * 3600) && i % 120 === 0) {
      const need = g.sites.filter((x) => x.hits + g.weapons.filter((w) => w.type === 'tlam' && w.contactId === x.id).length < 2);
      if (need.length) { if (g.own.ordDepth > 1) orders.depth(g, 1); else orders.strike(g, need[0].id); }
    }
    if (kochiDown) { if (i % 120 === 0) { orders.heading(g, 270); orders.speed(g, 6); } return true; }
    return fightOr(g, ['kolkata', 'kalvari'], 60, 30, () => { if (i % 120 === 0) { orders.heading(g, 80); orders.speed(g, 10); } });
  },
  I4: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // A quiet trail from astern, below the layer, never a shot.
    if (g.own.ordDepth !== 2) orders.depth(g, 2);
    const a = g.contacts.find((c) => c.held && c.est && !c.air && (guess(c, 30) === 'arihant' || c.seAvg > 5));
    if (a && i % 60 === 0) {
      const crs = a.motion?.crs ?? 150;
      const astern = { x: a.est!.x - Math.sin(crs * Math.PI / 180) * 6, y: a.est!.y - Math.cos(crs * Math.PI / 180) * 6 };
      const r = dist(g.own, astern);
      orders.heading(g, r > 1 ? brg(g.own, astern) : crs); orders.speed(g, r > 2 ? 9 : Math.max(5, Math.round(a.motion?.spd ?? 8)));
    }
    if (!a && i % 120 === 0) { orders.heading(g, s.m.lastBrg ?? 160); orders.speed(g, 9); }
    if (a) s.m.lastBrg = a.bearing!;
    return true;
  },
  I9: (g, i, s) => {
    if (evade(g, i, s, false, true)) return true;
    return fightOr(g, ['type075', 'type071'], 60, 30, () => { if (i % 120 === 0) { orders.heading(g, 60); orders.speed(g, 6); orders.depth(g, 1); } });
  },
  I17: (g, i, s) => {
    if (evade(g, i, s, false, true)) return true;
    airDefence(g, i, s, 600);
    // On radar, the blip that isn't moving is the landing ship at anchor; the one that is, the destroyer.
    for (const c of g.contacts) if (c.held && !c.air && !c.classified && c.radarT === g.t && c.motion) orders.classify(g, c.id, c.motion.spd < 2 ? 'jalashwa' : 'kolkata');
    const jal = hostiles(g, ['jalashwa'], 50)[0];
    const near = g.own.x > 7 && g.own.x < 11;
    if (near && !s.m.pinged) { s.m.pinged = 1; orders.ping(g); }
    if (jal) attack(g, i, jal, false, false);
    if (i % 20 === 0 && !atPeriscopeDepth(g)) { goTo(g, jal?.est ?? { x: 16, y: 0 }, near ? 5 : jal && dist(g.own, jal.est!) < 6 ? 6 : 12); if (g.own.ordDepth > 1.5) orders.depth(g, 1); }
    return true;
  },
};
