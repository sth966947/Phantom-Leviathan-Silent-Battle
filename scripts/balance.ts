// Plays many seeded games with simple scripted captains and prints the outcome mix.
// Run with: npx vite-node scripts/balance.ts
import { atPeriscopeDepth, create, isFriendlyClass, orders, targetContact, tick, type Game } from '../src/sim/sim';
import { CLASSES } from '../src/sim/classes';
import { CAMPAIGN, MODERN, PREQUELS } from '../src/sim/missions';
import { brg, dist } from '../src/sim/math';

const med = (a: number[]) => (a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);

function duelCaptain(g: Game, i: number, s: { legs: number; lastLeg: number; sprintT: number }) {
  const c = g.contacts.find((x) => x.vid === g.vessels[1].id);
  if (c?.held && i - s.lastLeg > 240) { s.lastLeg = i; orders.heading(g, c.bearing! + (s.legs++ % 2 ? 50 : -50)); orders.speed(g, 6); }
  if (!c?.held && i % 600 === 0) { orders.turn(g, 70); orders.speed(g, 8); }
  if (c?.held && c.q > 0.55 && c.est && dist(g.own, c.est) < 8 && !g.weapons.some((w) => w.side === 'us' && !w.dead)) orders.fire(g, 'mk48');
  for (const e of g.events) if (/Torpedo in the water/.test(e.text)) { orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i; }
  if (s.sprintT >= 0 && i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); } // slow down again once clear
  // Every 15 minutes, a look around at periscope depth: radar sweep, and a JATM at any aircraft.
  if (i % 900 === 450 && s.sprintT < 0) orders.depth(g, 0);
  if (atPeriscopeDepth(g)) {
    orders.radar(g, true);
    const air = targetContact(g, true);
    if (air && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) orders.fire(g, 'jatm');
    if (i % 900 > 600) { orders.radar(g, false); orders.depth(g, 1); }
  }
}

/** Uses only what the player sees: contacts, suggested matches and solutions. */
function bismarckCaptain(g: Game, i: number) {
  const bis = g.contacts.find((c) => c.held && (c.classified === 'bismarck' || (c.matches[0]?.key === 'bismarck' && c.matches[0].pct > 60)));
  if (!bis?.est) { if (i % 300 === 0) orders.speed(g, 5); return; }
  g.selected = bis.id;
  if (bis.classified !== 'bismarck') orders.classify(g, bis.id, 'bismarck');
  const r = dist(g.own, bis.est);
  if (i % 120 === 0) { orders.heading(g, brg(g.own, bis.est)); orders.speed(g, r > 12 ? 15 : 6); }
  if (bis.q > 0.6 && r < 30 && i % 60 === 0) orders.fire(g, 'mst');
  if (bis.q > 0.6 && r < 8 && i % 60 === 0) orders.fire(g, 'mk48');
}

/**
 * A generic WWII captain: knows which classes the mission wants sunk (from the briefing), and
 * otherwise only uses contacts, matches and solutions. Goes deep when depth charges are about.
 */
function wwiiCaptain(g: Game, i: number, s: { deepT: number }, extra: string[] = [], minPct = 80) {
  const want = new Set([...g.goal.targets.map((id) => g.vessels.find((v) => v.id === id)!.cls.key), ...extra]);
  const guess = (c: (typeof g.contacts)[number]) => c.classified ?? (c.matches[0]?.pct > minPct ? c.matches[0].key : null);
  for (const e of g.events) if (/Depth charges|sonar has us|sighted our periscope/.test(e.text)) { s.deepT = i; orders.depth(g, 2); orders.speed(g, 5); }
  const deep = i - s.deepT < 900;
  if (!deep && g.own.ordDepth === 2 && i % 60 === 0) orders.depth(g, 1);
  // A radar look every quarter hour when nothing is chasing us.
  if (!deep && i % 900 === 450) orders.depth(g, 0);
  if (atPeriscopeDepth(g)) { orders.radar(g, true); if (i % 900 > 600 || deep) { orders.radar(g, false); orders.depth(g, deep ? 2 : 1); } }
  if (g.sites.length && i % 400 === 200 && (g.flags.landHits ?? 0) + g.weapons.filter((w) => w.type === 'tlam').length < 5) orders.strike(g, g.sites[(i / 400 | 0) % g.sites.length].id);
  // Strike flights: at periscope depth with radar on, SM-6 the nearest one.
  const air = g.contacts.filter((c) => c.held && c.air && c.est && guess(c) && !isFriendlyClass(guess(c)) && g.vessels.find((v) => v.id === c.vid)?.ai?.mode === 'strike');
  if (air.length && !deep && i % 45 === 0) { if (!atPeriscopeDepth(g)) orders.depth(g, 0); else { orders.radar(g, true); g.selected = air[0].id; orders.fire(g, 'sm6'); } }
  const tgts = g.contacts.filter((c) => c.held && c.est && !c.air && guess(c) && want.has(guess(c)!) && !isFriendlyClass(guess(c)));
  tgts.sort((a, b) => dist(g.own, a.est!) - dist(g.own, b.est!));
  const t = tgts[0];
  if (!t) {
    // With land targets, the pickets lie ahead on the task force's course: go and look. Otherwise search in circles.
    if (g.sites.length) { if (i % 120 === 0) { orders.heading(g, 270); orders.speed(g, 10); } }
    else if (i % 600 === 0) { orders.turn(g, 60); orders.speed(g, 6); }
    return;
  }
  g.selected = t.id;
  if (!t.classified) orders.classify(g, t.id, guess(t)!);
  const r = dist(g.own, t.est!);
  const sub = CLASSES[guess(t)!].kind === 'sub';
  if (i % 120 === 0) { orders.heading(g, brg(g.own, t.est!)); orders.speed(g, deep ? 5 : r > 10 ? 15 : 6); }
  if (t.q > 0.6 && r < 8 && i % 90 === 0) orders.fire(g, 'mk48');
  if (!sub && !deep && t.q > 0.6 && r < 30 && r > 4 && i % 120 === 0) orders.fire(g, g.flags.jammed ? 'harpoon' : 'mst');
  if (sub && !deep && t.q > 0.6 && r > 1 && r < 15 && i % 120 === 0) orders.fire(g, 'asroc');
}

/** The modern war: the WWII captain plus what each briefing tells the player to do. */
function modernCaptain(g: Game, i: number, s: { deepT: number; sprintT: number; cutBrg: number; cutT: number }) {
  const key = g.scenario;
  // Torpedo evasion as in the duel: decoy, cross the layer, turn away and sprint, then slow down again.
  for (const e of g.events) if (/Torpedo in the water/.test(e.text) && (s.sprintT < 0 || i - s.sprintT > 60)) { orders.decoy(g); orders.speed(g, 25); orders.layer(g); orders.turn(g, 120); s.sprintT = i; }
  if (s.sprintT >= 0) { if (i - s.sprintT > 150) { s.sprintT = -1; orders.speed(g, 6); } return; }
  // Patrol planes and helicopters: a JATM at any one held while we're up (not in the trail, where we stay quiet).
  if (key !== 'vortex' && atPeriscopeDepth(g) && i % 30 === 0 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) {
    const air = g.contacts.find((c) => c.held && c.air && c.bearing !== null && g.vessels.find((v) => v.id === c.vid)?.alive && g.vessels.find((v) => v.id === c.vid)?.side === 'enemy' && g.vessels.find((v) => v.id === c.vid)?.ai?.mode !== 'strike');
    if (air) { const keep = g.selected; g.selected = air.id; orders.fire(g, 'jatm'); g.selected = keep; }
  }
  const deep = i - s.deepT < 900;
  if (key === 'vortex' && !g.flags.blown) {
    // Below the layer with the Akula, no radar: a quiet trail.
    if (!g.flags.ready && g.own.ordDepth !== 2) orders.depth(g, 2);
    const ak = g.contacts.find((c) => c.held && c.est && !c.air);
    // Trail from astern, in its baffles, 5 to 8 nm back.
    if (ak && i % 120 === 0) { const astern = { x: ak.est!.x - Math.sin(((ak.motion?.crs ?? 225) * Math.PI) / 180) * 6, y: ak.est!.y - Math.cos(((ak.motion?.crs ?? 225) * Math.PI) / 180) * 6 }; const r = dist(g.own, astern); orders.heading(g, r > 1.5 ? brg(g.own, astern) : ak.motion?.crs ?? 225); orders.speed(g, r > 3 ? 10 : 7); }
    if (!ak && i % 300 === 0) { orders.heading(g, 225); orders.speed(g, 10); }
    if (g.flags.ready) orders.depth(g, 0);
    return;
  }
  if (key === 'eyes') {
    if (i % 120 === 0 && !deep) { orders.heading(g, 180); orders.speed(g, 10); }
    if (i % 900 === 450 && !deep) orders.depth(g, 0);
    for (const e of g.events) if (/Torpedo in the water|sonobuoy/i.test(e.text)) { s.deepT = i; orders.depth(g, 2); orders.decoy(g); }
    if (atPeriscopeDepth(g)) {
      orders.radar(g, true);
      const air = targetContact(g, true);
      if (air && i % 30 === 0 && !g.weapons.some((w) => w.type === 'jatm' && !w.dead)) orders.fire(g, 'jatm');
      if (i % 900 > 700) { orders.radar(g, false); orders.depth(g, 1); }
    }
    return;
  }
  if (key === 'lostsister' && !g.flags.rescue) {
    const ok = g.vessels.find((v) => v.name.startsWith('USS Oklahoma'))!;
    if (i % 120 === 0) { orders.heading(g, brg(g.own, ok)); orders.speed(g, 12); }
    return;
  }
  if (key === 'raiderloose' && !deep && !g.contacts.some((c) => c.held && c.q > 0.5 && ['yasen', 'akula'].includes(c.matches[0]?.key) && c.matches[0].pct > 40)) {
    // Sprint and drift down Kazan's track toward the lanes, listening on each drift.
    if (i % 1200 === 0) { orders.heading(g, 225); orders.speed(g, 16); }
    if (i % 1200 === 480) orders.speed(g, 6);
    for (const e of g.events) if (/Torpedo in the water/.test(e.text)) { s.deepT = i; orders.decoy(g); orders.depth(g, 2); }
    return;
  }
  if (key === 'cables' && !deep && !g.contacts.some((c) => c.held && ['deepsub', 'kilo'].includes(c.matches[0]?.key) && c.matches[0].pct > 60)) {
    // Head for the noisy Yantar, which marks the cable site, then listen there.
    // Cutting transients: steer for them, and ping once close to get a fix.
    for (const e of g.events) { const m = /transients, bearing (\d+)/.exec(e.text); if (m) { s.cutBrg = Number(m[1]); s.cutT = i; } }
    if (s.cutT >= 0 && i - s.cutT < 600) {
      if (i % 60 === 0) { orders.heading(g, s.cutBrg); orders.speed(g, 6); }
      if (i - s.cutT === 200) { orders.ping(g); const c = g.contacts.find((x) => x.held && x.q > 0.9 && x.matches[0]?.key !== 'yantar' && x.est && dist(g.own, x.est) < 6); if (c) { g.selected = c.id; orders.classify(g, c.id, 'deepsub'); orders.fire(g, 'mk48'); } }
      return;
    }
    const y = g.contacts.find((c) => c.held && c.est && c.matches[0]?.key === 'yantar');
    if (i % 120 === 0) { const r = y ? dist(g.own, y.est!) : 99; orders.heading(g, y ? brg(g.own, y.est!) : 270); orders.speed(g, r > 5 ? 10 : 4); orders.depth(g, 2); }
    return;
  }
  if (key === 'bremerhaven') {
    // Up for a radar look when the bombers are due; otherwise go out ahead of the convoy after the Oscar.
    const due = (g.t > 29 * 60 && g.t < 45 * 60) || (g.t > 74 * 60 && g.t < 90 * 60);
    if (due && !deep) { if (!atPeriscopeDepth(g)) { orders.depth(g, 0); orders.speed(g, 8); } orders.radar(g, true); }
    const osc = g.contacts.some((c) => c.held && c.matches[0]?.key === 'oscar' && c.matches[0].pct > 60);
    if (!due && !osc && !deep && i % 600 === 0) { orders.depth(g, 1); orders.heading(g, 90); orders.speed(g, i % 1200 ? 8 : 18); }
    if (!osc && !due) return;
  }
  wwiiCaptain(g, i, s, key === 'bremerhaven' ? ['oscar'] : key === 'raiderloose' ? ['akula'] : key === 'cables' ? ['kilo'] : [], key === 'raiderloose' ? 40 : 60);
}

const only = process.argv[2];
for (const key of only ? [only as 'duel'] : (['duel', ...CAMPAIGN, ...PREQUELS, ...MODERN.filter((k) => k !== 'duel')] as const)) {

  const res: Record<string, number> = {};
  const mins: number[] = [];
  const n = key === 'duel' || key === 'bismarck' ? 100 : 30;
  for (let seed = 1; seed <= n; seed++) {
    const g = create(key, seed);
    const s = { legs: 0, lastLeg: 0, sprintT: -1, deepT: -1e9, cutBrg: 0, cutT: -1 };
    for (let i = 0; i < Math.min(18000, g.timeLimit + 5) && !g.over; i++) {
      tick(g, 1);
      if (key === 'duel') duelCaptain(g, i, s); else if (key === 'bismarck') bismarckCaptain(g, i); else if (MODERN.includes(key)) modernCaptain(g, i, s); else wwiiCaptain(g, i, s);
      if (process.env.E && seed === Number(process.env.E)) for (const e of g.events) console.log(Math.round(g.t / 60), e.text);
      g.events.length = 0;
    }
    const out = g.over ? (g.over.win ? (process.env.R ? g.over.reason : "win") : g.over.reason) : "timeout";
    // V=1 lists each run.
    if (process.env.V) console.log(seed, out.slice(0, 30), "sunk:", g.vessels.filter((v) => !v.alive).map((v) => v.name).join(", "));
    res[out] = (res[out] ?? 0) + 1;
    if (g.over) mins.push(Math.round(g.over.t / 60));
  }
  console.log(key, res, 'median minutes', med(mins));
}
