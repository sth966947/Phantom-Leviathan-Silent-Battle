// Balance captains for src/sim/modern/home.ts. Each plays from what the player could see: contacts,
// matches, solutions, the log, marked mines and the briefing.
import { atPeriscopeDepth, inPeriscope, isFriendlyClass, missileDepthOk, orders, type Contact, type Game } from '../../src/sim/sim';
import { CLASSES } from '../../src/sim/classes';
import { angDiff, brg, dist, offset, type Vec } from '../../src/sim/math';
import type { Captain, CaptainState } from './index';

const guess = (c: Contact, minPct = 60) => c.classified ?? (c.q > 0.4 && c.matches[0]?.pct > minPct ? c.matches[0].key : null);
const alive = (g: Game, c: Contact) => g.vessels.find((v) => v.id === c.vid)?.alive ?? false;

/**
 * Torpedo in the water: decoy, cross the layer, and run away from its bearing at full speed for as
 * long as sonar still hears it, then slow down again. True while running.
 */
function evade(g: Game, i: number, s: CaptainState) {
  // Torpedoes heard and coming our way (the bearing drift says so); ones running at other ships are left alone.
  const heard = g.weapons.filter((w) => w.side === 'enemy' && !w.dead && w.heardBrg != null && (Math.abs(angDiff(w.hdg, brg(w, g.own))) < 60 || dist(w, g.own) < 1.5));
  if (heard.length) {
    const acq = g.events.some((e) => /seeker has acquired us/.test(e.text));
    if (s.sprintT < 0 || acq) { orders.decoy(g); orders.depth(g, g.own.ordDepth <= 1.2 ? 2 : 1); }
    if (acq) s.m.acqT = i;
    s.sprintT = i;
    // Beam the torpedo quietly; run flat out only once its seeker has us.
    const near = heard.sort((a, b) => dist(g.own, a) - dist(g.own, b))[0];
    const run = i - (s.m.acqT ?? -1e9) < 240;
    if (i % 5 === 0) { orders.heading(g, near.heardBrg! + (run ? 180 : near.id % 2 ? 100 : -100)); orders.speed(g, run ? 30 : 12); }
    return true;
  }
  if (s.sprintT >= 0) { if (i - s.sprintT > 30) { s.sprintT = -1; orders.speed(g, 5); } return true; }
  return false;
}
/** Every `every` seconds, two minutes at periscope depth: eyes (and radar if `radar`), identifying what the periscope shows. */
function look(g: Game, i: number, every: number, radar = false) {
  if (i % every === every / 2) orders.depth(g, 0);
  if (!atPeriscopeDepth(g)) return;
  if (radar) orders.radar(g, true);
  for (const c of g.contacts) { const v = inPeriscope(g, c); if (v && c.classified !== v.cls.key && c.held) orders.classify(g, c.id, v.cls.key); }
  if (i % every > every / 2 + 120) { orders.radar(g, false); orders.depth(g, 1); }
}
/** A heading near `hdg` that keeps 0.3 nm clear of every marked enemy mine in the next 2 nm. */
function safe(g: Game, hdg: number) {
  const o = g.own;
  const near = g.mines.filter((m) => m.side !== 'us' && m.found && dist(o, m) < 2.5);
  if (!near.length) return hdg;
  const clear = (h: number) => near.every((m) => {
    const r = dist(o, m), a = (angDiff(brg(o, m), h) * Math.PI) / 180;
    const along = r * Math.cos(a), across = Math.abs(r * Math.sin(a));
    return along < -0.05 || along > 2 || across > 0.3;
  });
  for (const d of [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90, 120, -120, 150, -150, 180]) if (clear(hdg + d)) return hdg + d;
  return hdg;
}
const steerTo = (g: Game, p: Vec, spd: number) => { orders.heading(g, safe(g, brg(g.own, p))); orders.speed(g, spd); };

/** Friendly by the book, or a merchant (the briefs say every merchant about is on our side). */
const friendly = (k: string | null) => !!k && (isFriendlyClass(k) || ['tanker', 'lng', 'boxship'].includes(k));
/** A friendly ship, as far as the contacts show, near the target or close to the torpedo's path to it. */
function friendsNear(g: Game, p: Vec, r: number) {
  const o = g.own, d = dist(o, p);
  return g.contacts.some((c) => {
    // Anything friendly seen in the last half hour, at its last known spot.
    if (!c.ever || !c.est || c.air || g.t - c.lastSeen > 1800 || !alive(g, c) || !friendly(guess(c, 50))) return false;
    if (dist(c.est, p) < r) return true;
    const a = (angDiff(brg(o, c.est), brg(o, p)) * Math.PI) / 180, along = dist(o, c.est) * Math.cos(a);
    return along > 0 && along < d && Math.abs(dist(o, c.est) * Math.sin(a)) < 1.5;
  });
}
/** Close on and shoot the nearest held contact of a wanted class. Returns the contact, or null. */
function engage(g: Game, i: number, want: string[], o: { minPct?: number; missile?: boolean; maxR?: number; spd?: number; s?: CaptainState; standoff?: number; minR?: number } = {}) {
  const tg = g.contacts.filter((c) => c.held && c.est && !c.air && alive(g, c) && guess(c, o.minPct) && want.includes(guess(c, o.minPct)!) && !friendly(guess(c, o.minPct)))
    .sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!))[0];
  if (!tg || dist(g.own, tg.est!) > (o.maxR ?? 99)) return null;
  g.selected = tg.id;
  if (!tg.classified && tg.q > 0.6) orders.classify(g, tg.id, guess(tg, o.minPct)!);
  const r = dist(g.own, tg.est!), sub = CLASSES[guess(tg, o.minPct)!].kind === 'sub';
  // After a launch, slip sideways for a few minutes: everyone with sonar heard where it came from.
  const st = o.s?.m;
  const shots = Object.values(g.stats.fired).reduce((a, b) => a + b, 0);
  if (st && shots > (st.shots ?? 0)) { st.shots = shots; st.shiftT = i; st.shiftH = brg(g.own, tg.est!) + (i % 2 ? 130 : -130); }
  const shifting = st && st.shiftT !== undefined && i - st.shiftT < 300;
  if (i % 60 === 0) {
    if (shifting) { orders.heading(g, safe(g, st!.shiftH)); orders.speed(g, 6); }
    else if ((o.standoff && r < o.standoff) || (o.minR && r < o.minR)) { orders.heading(g, safe(g, brg(g.own, tg.est!) + 150)); orders.speed(g, 6); }
    // A weak solution firms up with each new leg: zigzag 50 degrees either side of the bearing until it is good.
    else if (tg.q < 0.6 && r < 10) { orders.heading(g, safe(g, brg(g.own, tg.est!) + ((i / 120 | 0) % 2 ? 50 : -50))); orders.speed(g, o.spd ?? 6); }
    else { orders.heading(g, safe(g, brg(g.own, tg.est!))); orders.speed(g, r > (sub ? 12 : 10) ? (sub ? 10 : 15) : o.spd ?? 6); }
    if (g.own.ordDepth === 0 && !o.missile) orders.depth(g, 1);
  }
  const clearShot = !friendsNear(g, tg.est!, 3);
  if (tg.q > 0.6 && r < 8 && r >= (o.minR ?? 0) && i % 90 === 0 && clearShot && !o.standoff) orders.fire(g, 'mk48');
  if (o.missile !== false && !sub && tg.q > 0.6 && r < 30 && r > 4 && i % 120 === 0 && missileDepthOk(g)) orders.fire(g, g.flags.jammed ? 'harpoon' : 'mst');
  if (sub && tg.q > 0.6 && r > Math.max(1, o.minR ?? 0) && r < 15 && i % 120 === 0 && missileDepthOk(g) && clearShot) orders.fire(g, 'asroc');
  return tg;
}
/** At periscope depth: radar on, and SM-6 or JATM at any enemy aircraft it identifies. */
function airDefence(g: Game, i: number) {
  if (!atPeriscopeDepth(g)) return;
  if (i % 20 || g.weapons.some((w) => (w.type === 'jatm' || w.type === 'sm6') && !w.dead)) return;
  const air = g.contacts.find((c) => c.held && c.air && c.bearing !== null && alive(g, c) && c.classified && !isFriendlyClass(c.classified));
  if (!air) return;
  const keep = g.selected; g.selected = air.id; orders.fire(g, 'jatm'); g.selected = keep;
}
/** The last position a log line of the form "bearing NNN, about N nm" gave, relative to us when it was logged. */
function readCue(g: Game, s: CaptainState, re: RegExp) {
  for (const e of g.events) {
    const m = re.exec(e.text);
    if (m) { const p = offset(g.own, Number(m[1]), Number(m[2])); s.m.cx = p.x; s.m.cy = p.y; s.m.ct = g.t; }
  }
  return s.m.ct !== undefined ? { x: s.m.cx, y: s.m.cy } : null;
}

export const captains: Record<string, Captain> = {
  // Wait for Volk off the seaward end and sink it, then sweep the channel: ping, wait for the helicopters, move on.
  E0: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const mouth = { x: -2, y: 0 };
    if (engage(g, i, ['akula'], { minPct: 50, s })) return true;
    const volk = g.vessels.find((v) => v.cls.key === 'akula')!;
    const hunting = volk.alive && g.t < 40 * 60;
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    if (hunting) { if (i % 60 === 0) steerTo(g, { x: 1, y: 1.5 }, dist(g.own, { x: 1, y: 1.5 }) > 1 ? 6 : 2); return true; }
    // The sweep: stops every 2.5 nm down the channel and back.
    s.m.leg ??= 0;
    const stops = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map((k) => ({ x: mouth.x - 1 - k * 2.5, y: 0 }));
    const stop = stops[s.m.leg % stops.length];
    if (dist(g.own, stop) > 0.3) { if (i % 15 === 0) steerTo(g, stop, 5); s.m.wait = 0; return true; }
    if (!s.m.wait) { s.m.wait = i; orders.speed(g, 0); orders.ping(g); }
    if (i - s.m.wait > 100 && !g.mines.some((m) => m.side !== 'us' && m.found && dist(g.own, m) < 3.5)) { s.m.leg++; s.m.wait = 0; }
    return true;
  },

  // Run to each P-8 cue, slow down to listen there, and hunt the Yasen when it is held. Stay deep, away from the spy ship's eyes.
  E5: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const cuePos = readCue(g, s, /P-8A Poseidon: possible submarine, bearing (\d+), about (\d+) nm/);
    if (engage(g, i, ['yasen', 'akula'], { minPct: 45, s })) return true;
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    if (cuePos && i % 60 === 0) { const r = dist(g.own, cuePos); steerTo(g, cuePos, r > 6 ? 9 : 5); }
    return true;
  },

  // Hunt both boats; go and listen off Chebucto Head for the Kilo's diesels.
  E6: (g, i, s) => {
    if (evade(g, i, s)) return true;
    if (engage(g, i, ['akula', 'kilo'], { minPct: 45, minR: 4, s })) return true;
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    const kilo = g.vessels.find((v) => v.cls.key === 'kilo')!;
    const head = offset({ x: 0, y: 0 }, 320, 10);
    // Listen off Chebucto Head for an hour (two snorkel periods); then sweep the Akula's area to the east.
    const east = [offset({ x: 0, y: 0 }, 50, 10), offset({ x: 0, y: 0 }, 90, 13), offset({ x: 0, y: 0 }, 130, 10), offset({ x: 0, y: 0 }, 90, 8)];
    const fc = readCue(g, s, /HMCS Fraser: possible submarine, bearing (\d+), about (\d+) nm/);
    const spot = kilo.alive && g.t < 3600 ? offset(head, 140, 4) : fc && g.t - s.m.ct < 1500 ? fc : east[Math.floor(g.t / 900) % east.length];
    if (i % 60 === 0) steerTo(g, spot, dist(g.own, spot) > 2 ? 8 : 4);
    return true;
  },

  // Wait inside the sub screen on the landing force's track, look with the periscope, and torpedo the dock ships.
  E1: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const ldg = engage(g, i, ['jalashwa'], { minPct: 50, missile: true, spd: 4, s });
    look(g, i, 300, true);
    if (!ldg && i % 60 === 0) { const out = offset({ x: 0, y: 0 }, 245, 4); steerTo(g, out, dist(g.own, out) > 1 ? 6 : 2); }
    return true;
  },

  // As E1, in shallow water, and careful not to torpedo the anchored tankers.
  E3: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // A hunting frigate close enough to see on radar gets a torpedo first.
    const hunter = engage(g, i, ['tamandare'], { minPct: 50, maxR: 8, missile: true, s });
    const ldg = hunter ?? engage(g, i, ['ropucha'], { minPct: 50, missile: true, s, standoff: 9 });
    if (!ldg) engage(g, i, ['type209'], { minPct: 50, maxR: 4, missile: false, s });
    look(g, i, 600, true);
    if (!ldg && i % 60 === 0) { const out = offset({ x: 0, y: 0 }, 290, 10); steerTo(g, out, dist(g.own, out) > 2 ? 12 : 3); }
    return true;
  },

  // Ride ahead of the convoy hunting the Riachuelo; after 40 minutes, go 18 nm west to meet the frigates and sink them there.
  E7: (g, i, s) => {
    if (evade(g, i, s)) return true;
    // Fast radar contacts to the west are the frigates: the brief says so.
    for (const c of g.contacts) if (c.held && c.est && !c.air && !c.classified && c.motion && c.motion.spd > 16 && c.est.x < g.own.x - 3) orders.classify(g, c.id, 'tamandare');
    const f = engage(g, i, ['tamandare'], { minPct: 50, missile: true, spd: 8, s });
    if (!f && engage(g, i, ['riachuelo', 'kalvari'], { minPct: 45, maxR: 8, s })) return true;
    const lead = g.vessels.find((v) => v.cls.key === 'type26' && v.alive) ?? g.vessels.find((v) => v.side === 'allied' && v.alive);
    const frigsUp = g.vessels.some((v) => v.cls.key === 'tamandare' && v.alive);
    const west = g.t > 40 * 60 && frigsUp;
    look(g, i, west ? 300 : 600, true);
    if (!f && i % 60 === 0) {
      if (west && lead) { const p = offset(lead, 280, 18); steerTo(g, p, dist(g.own, p) > 2 ? 16 : 4); return true; }
      // Sprint out ahead of the convoy, then drift and listen while it catches up.
      const ahead = lead ? offset(lead, 210, 5) : offset(g.own, 210, 3);
      const drift = i % 720 > 240 || dist(g.own, ahead) < 1.5;
      steerTo(g, ahead, drift ? 4 : 16);
    }
    return true;
  },

  // Sink Amatola with Tomahawks when radar finds her; sit on the tanker lane and listen for Tonelero's attack runs.
  E8: (g, i, s) => {
    const ama = g.vessels.some((v) => v.cls.key === 'valour' && v.alive);
    for (const e of g.events) {
      const lb = /^Launch transient, bearing (\d+)/.exec(e.text);
      if (!lb) continue;
      s.m.lt = i;
      // Far off: she is busy with a tanker, so close along the bearing to get her in torpedo range.
      if (!ama && !g.contacts.some((c) => c.classified === 'riachuelo' && c.held)) { const p = offset(g.own, Number(lb[1]), 5); s.m.lx = p.x; s.m.ly = p.y; s.m.lT = i; }
    }
    if (evade(g, i, s)) return true;
    const a = engage(g, i, ['valour'], { minPct: 50, missile: true, spd: 6, s });
    // No friendly submarines here: anything that sounds like a sub is Tonelero. When she fires on a tanker,
    // ping to find her: an echo that isn't one of the ships radar has named is her.
    for (const c of g.contacts) if (c.held && !c.air && !c.classified && c.q > 0.5 && c.matches[0]?.pct >= 40 && CLASSES[c.matches[0].key].kind === 'sub') orders.classify(g, c.id, 'riachuelo');
    if (s.m.lt !== undefined && i - s.m.lt === 20) orders.ping(g);
    if (s.m.lt !== undefined && i - s.m.lt === 21) for (const c of g.contacts) if (c.held && c.q >= 0.99 && c.est && !c.air && !c.classified && !friendly(c.matches[0]?.pct > 50 ? c.matches[0].key : null) && dist(g.own, c.est) < 12) orders.classify(g, c.id, 'riachuelo');
    if (!a && engage(g, i, ['riachuelo', 'type209'], { minPct: 45, s })) return true;
    look(g, i, 600, true);
    if (!a && i % 60 === 0) {
      const t = s.m.lT !== undefined && i - s.m.lT < 1500 ? { x: s.m.lx, y: s.m.ly } : offset(offset({ x: 0, y: 0 }, 345, 16), 220, 12);
      steerTo(g, t, dist(g.own, t) > 2 ? 10 : 3);
    }
    return true;
  },

  // Run to the P-8 cue; then sprint while it sprints (it is deaf and loud), drift while it drifts, and shoot.
  E2: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const cuePos = readCue(g, s, /P-8A Poseidon: possible submarine, bearing (\d+), about (\d+) nm/);
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    const loud = g.contacts.filter((c) => c.held && c.est && !c.air && alive(g, c)).sort((a, b) => b.seAvg - a.seAvg)[0];
    if (loud && loud.seAvg > 6 && dist(g.own, loud.est!) > 6) { if (i % 30 === 0) steerTo(g, loud.est!, 20); return true; }
    if (engage(g, i, ['alvaro', 'riachuelo'], { minPct: 40, spd: 5, maxR: 10, s })) return true;
    if (cuePos && i % 60 === 0) { const p = offset(cuePos, 10, (g.t - s.m.ct) / 3600 * 11); const r = dist(g.own, p); steerTo(g, p, r > 8 ? 16 : 5); }
    return true;
  },

  // Wait off the breakwater where every midget has to come, listen slow, and pick them off; mind the anchored ships.
  E4: (g, i, s) => {
    if (evade(g, i, s)) return true;
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    const mouth = offset({ x: 0, y: 0 }, 200, 4);
    look(g, i, 900, true);
    // The anchorage is all west of the breakwater: a sub-like sound, or a ping echo, to the east is a midget.
    const east = (p: Vec) => p.x > mouth.x - 1.5;
    for (const c of g.contacts) if (c.held && !c.air && !c.classified && c.q > 0.5 && c.matches[0]?.pct >= 25 && CLASSES[c.matches[0].key].kind === 'sub' && c.est && east(c.est)) orders.classify(g, c.id, 'ghadir');
    if (g.t > 1800 && i - (s.m.pinged ?? -1e9) > 180 && g.contacts.some((c) => c.held && !c.air && !c.classified && c.est && east(c.est) && dist(g.own, c.est) < 3.5)) { s.m.pinged = i; orders.ping(g); }
    if (s.m.pinged === i - 1) for (const c of g.contacts) if (c.held && c.q >= 0.99 && c.est && !c.air && !c.classified && east(c.est) && dist(g.own, c.est) < 5) orders.classify(g, c.id, 'ghadir');
    if (engage(g, i, ['ghadir', 'deepsub', 'type209'], { minPct: 40, spd: 4, s })) return true;
    if (i % 60 === 0) { const p = offset(mouth, 50, 2); steerTo(g, p, dist(g.own, p) > 0.6 ? 6 : 1); }
    return true;
  },

  // Creep north to the defensive field, run along it with the HF sonar to find the gap (no pings: the boats would hear),
  // go through, lay four mines in the entrance and come back out the same way.
  E11: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const mouth = { x: 0, y: 16 };
    if (g.own.ordDepth !== 1) orders.depth(g, 1);
    if (engage(g, i, ['riachuelo', 'tamandare'], { minPct: 50, maxR: 3, missile: false, spd: 4, s })) return true;
    const line = () => g.mines.filter((m) => m.side !== 'us' && m.found).map((m) => m.x).sort((a, b) => a - b);
    const lineY = () => { const m = g.mines.filter((x) => x.side !== 'us' && x.found); return m.length ? m.reduce((a, x) => a + x.y, 0) / m.length : 11; };
    s.m.ph ??= 0;
    const go = (p: Vec, spd: number, next: number, within = 0.3) => { if (dist(g.own, p) < within) s.m.ph = next; else if (i % 10 === 0) steerTo(g, p, spd); };
    switch (s.m.ph) {
      case 0: go({ x: -3.2, y: 9.4 }, 10, 1); break; // up to the field's south side, west end
      case 1: go({ x: -3.2, y: lineY() - 0.75 }, 6, 2); break;
      case 2: go({ x: 3.2, y: lineY() - 0.75 }, 9, 3); break; // along the line at 9 knots, mapping it
      case 3: {
        const xs = line().filter((x) => Math.abs(x) < 3.6);
        let best = 0, gx = 0;
        for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > best) { best = xs[k] - xs[k - 1]; gx = (xs[k] + xs[k - 1]) / 2; }
        s.m.gx = gx; s.m.ph = 4; break;
      }
      case 4: go({ x: s.m.gx, y: lineY() - 0.6 }, 6, 5, 0.15); break;
      case 5: go({ x: s.m.gx, y: lineY() + 0.8 }, 5, 6, 0.15); break; // through the gap
      case 6: go({ x: mouth.x - 0.4, y: mouth.y - 0.6 }, 8, 7); break;
      case 7: // lay along the entrance
        if (i % 10 === 0) steerTo(g, { x: mouth.x + 0.6, y: mouth.y - 0.2 }, 3);
        if (dist(g.own, mouth) < 0.95 && i % 125 === 0) orders.layMine(g);
        if (g.flags.done || !g.flags.minesAboard || dist(g.own, { x: mouth.x + 0.6, y: mouth.y - 0.2 }) < 0.2) s.m.ph = g.flags.done ? 8 : 6;
        break;
      case 8: go({ x: s.m.gx, y: lineY() + 0.8 }, 8, 9, 0.2); break;
      case 9: go({ x: s.m.gx, y: lineY() - 0.8 }, 5, 10, 0.15); break;
      default: if (i % 30 === 0) steerTo(g, { x: s.m.gx, y: 0 }, 12);
    }
    return true;
  },

  // Close to 41 nm, get the ESM fix at periscope depth, kill the radar, then the runway and fuel farm.
  E14: (g, i, s) => {
    if (evade(g, i, s)) return true;
    const isle = { x: -70, y: 0 };
    airDefence(g, i);
    const site = (id: number) => g.sites.find((x) => x.id === id);
    const inFlight = (id: number) => g.weapons.filter((w) => w.type === 'tlam' && !w.dead && w.contactId === id).length;
    if (dist(g.own, isle) > 41) { if (i % 60 === 0) { steerTo(g, isle, 14); orders.depth(g, 1); } return true; }
    if (i % 60 === 0) orders.speed(g, 4);
    const radar = site(-3);
    if (!g.flags.radarDown) {
      if (!radar) { if (!atPeriscopeDepth(g)) orders.depth(g, 0); return true; }
      if (inFlight(-3) < 2 && i % 20 === 0) { orders.depth(g, 1); orders.strike(g, -3); }
      return true;
    }
    if (atPeriscopeDepth(g) && i % 600 > 300) orders.depth(g, 1);
    const want = (site(-1)!.hits + inFlight(-1) < 3) ? -1 : (site(-2)!.hits + inFlight(-2) < 2) ? -2 : 0;
    if (want && i % 20 === 0) { orders.depth(g, 1); orders.strike(g, want); }
    return true;
  },
};
