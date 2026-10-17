// Modern war missions: gulf2. See the Modern Campaign Plan and src/sim/warData.ts for where each one sits in the war.
// Act 2, the Iran branch from the Hormuz hub on: June to September 2029, the Gulf, the Red Sea and the Arabian Sea.

import { brg, dist, fmtBrg, norm, offset, type Vec } from '../math';
import { depthT, end, log, shellfire, type Game, type Vessel } from '../sim';
import {
  add, alive, arrive, at, bombed, byId, clock, flag, go, ids, isSunk, keepCourse, mins, missileSalvo, moored, pointDefence,
  screen, setGoal, skirmish, steer, watch, type Carry, type Mission, type MissionKey, type Objective, type ObjectiveFn,
} from '../kit';
import { mineField, mineLine } from '../hazards';

export const missions: Record<MissionKey, Mission> = {};
export const extras: Record<MissionKey, ObjectiveFn> = {};

// ---- Gulf building blocks ------------------------------------------------------------------------
/** Iran's Kilos: the three bought in the 1990s and two ex-Russian boats handed over in 2027. Each mission takes the first not yet sunk. */
const KILOS = ['Tareq (901)', 'Noor (902)', 'Yunes (903)', 'Alborz (904)', 'Sabalan (905)'];
const kilos = (carry: Carry, n: number) => {
  const left = KILOS.filter((k) => alive(carry, k));
  return (left.length >= n ? left : KILOS).slice(0, n);
};
const vs = (g: Game, cls: string) => g.vessels.filter((v) => v.cls.key === cls);
const live = (list: Vessel[]) => list.filter((v) => v.alive);

/** Shallow water: nobody can go deeper than `ft`, so there is no layer to hide under. */
function shallow(g: Game, ft: number) {
  const max = depthT(ft);
  for (const v of g.vessels) {
    if (!v.alive || v.cls.kind !== 'sub' || v.ordDepth <= max) continue;
    v.ordDepth = max;
    if (v === g.own && g.t - flag(g, 'shoalT') > 120) { g.flags.shoalT = g.t; log(g, 'warn', `Navigator: only ${ft + 40} feet under the keel here. Holding ${ft} feet.`); }
  }
}
/** Mines Tang has found are marked for the minehunting helicopters, which blow them in place a few minutes later. */
function sweepMarked(g: Game, who: string, delay = 180) {
  for (const m of [...g.mines]) {
    if (m.side !== 'enemy' || !m.found) continue;
    const k = `mk${m.id}`;
    if (!g.flags[k]) { g.flags[k] = g.t; continue; }
    if (g.t - g.flags[k] < delay) continue;
    g.mines = g.mines.filter((x) => x !== m);
    g.flags.cleared = flag(g, 'cleared') + 1;
    g.blasts.push({ x: m.x, y: m.y, t: g.t, missile: false });
    log(g, 'good', `${who} has blown the marked mine on bearing ${fmtBrg(brg(g.own, m))}. ${g.flags.cleared} cleared.`);
  }
}
/** Explosive drone boats: each runs at the nearest ship in `targets` and blows up alongside. */
function droneBoats(g: Game, boats: Vessel[], targets: Vessel[], dmg = 2) {
  for (const b of boats) {
    if (!b.alive || !b.ai) continue;
    const t = live(targets).sort((x, y) => dist(b, x) - dist(b, y))[0];
    if (!t) { b.ai.cruise = 0; continue; }
    Object.assign(b.ai, { mode: 'transit', baseCourse: brg(b, t), zig: 0, cruise: 40, legT: 1e9 });
    if (dist(b, t) > 0.15) continue;
    b.alive = false; b.gone = true;
    log(g, 'danger', `${b.name} has rammed ${t.name} and blown up alongside!`, 'boom');
    for (let i = 0; i < dmg; i++) bombed(g, t, 'an explosive drone boat');
  }
}
/** Small boats jink hard at 30 to 40 knots: each of our anti-ship missiles that gets within 1 nm of one misses with chance `p`. */
function jink(g: Game, boats: Vessel[], p = 0.35) {
  for (const w of g.weapons) {
    if (w.dead || w.side !== 'us' || (w.type !== 'harpoon' && w.type !== 'mst') || g.flags[`jk${w.id}`]) continue;
    const b = boats.find((v) => v.alive && dist(v, w) < 1);
    if (!b) continue;
    g.flags[`jk${w.id}`] = 1;
    if (g.r() < p) { w.dead = true; log(g, 'warn', `${w.label} missed ${b.name}: she jinked inside the seeker's turn.`); }
  }
}
/** Launch a wave of drone boats from `from`. */
function droneWave(g: Game, list: Vessel[], from: Vec, n: number, tag: string) {
  for (let i = 0; i < n; i++) list.push(add(g, 'droneboat', `Drone boat ${tag}${i + 1}`, 'enemy', offset(from, g.r() * 360, 0.5 + g.r()), 0, 40, go(0, 40, 1e9)));
  log(g, 'danger', `Radar and sonar: ${n} high-speed contacts, bearing ${fmtBrg(brg(g.own, from))}, coming in at 40 knots. Explosive drone boats! Harpoon, Tomahawk or Mk 48 can stop them.`, 'alarm');
}
/** Fast attack craft: each dashes at the nearest ship, fires its missiles inside `range` nm, then runs for home. */
function facRun(g: Game, facs: Vessel[], ships: Vessel[], range: number, p: () => number, missile = 'C-704', n = 2) {
  for (const f of facs) {
    if (!f.alive || !f.ai) continue;
    const t = live(ships).sort((x, y) => dist(f, x) - dist(f, y))[0];
    if (!t) continue;
    const k = `fac${f.id}`;
    if (!g.flags[k]) {
      Object.assign(f.ai, { mode: 'transit', baseCourse: brg(f, t), zig: 0, cruise: 32, legT: 1e9 });
      if (dist(f, t) < range) { g.flags[k] = 1; missileSalvo(g, f.name, missile, n, ships, p(), 2); f.ai.baseCourse = brg(t, f); }
    } else if (f.ai.mode === 'transit' && dist(f, t) > 25) { f.alive = false; f.gone = true; }
  }
}
const facWave = (g: Game, list: Vessel[], from: Vec, names: string[], range = 9) => {
  for (const n of names) list.push(add(g, 'fac', n, 'enemy', offset(from, g.r() * 360, 1 + g.r() * 2), 0, 30, go(0, 30, 1e9)));
  log(g, 'danger', `Radar intercepts: ${names.length} fast attack craft racing out, bearing ${fmtBrg(brg(g.own, from))}. They will fire anti-ship missiles inside about ${range} nm. Sink them first.`, 'alarm');
};
/** Escorts' guns and helicopters against small boats: every 10 s each escort may score on the nearest boat inside 4 nm. */
function guns(g: Game, escorts: Vessel[], boats: Vessel[], p = 0.06) {
  if (g.t % 10) return;
  for (const e of live(escorts)) {
    const b = live(boats).filter((x) => dist(x, e) < 4).sort((x, y) => dist(e, x) - dist(e, y))[0];
    if (b) shellfire(g, e, b, p);
  }
}
/**
 * Frigates carry 324 mm lightweight torpedoes, not heavyweights: shorter legs, a smaller seeker and a
 * warhead a Virginia can survive once. Each torpedo a surface ship has just fired becomes one, and
 * after `load` of them (two triple tubes and a short reload) the ship has none left.
 */
function lightweights(g: Game, load = 4) {
  for (const w of g.weapons) {
    if (w.side !== 'enemy' || w.type !== 'ugst' || w.run > 0.1 || g.flags[`lw${w.id}`]) continue;
    g.flags[`lw${w.id}`] = 1;
    const by = g.vessels.find((v) => v.alive && v.side === 'enemy' && v.cls.kind === 'surface' && dist(v, w) < 0.15);
    if (!by) continue;
    Object.assign(w, { type: 'apr3', spd: 45, maxRun: 7, label: 'Lightweight torpedo' });
    g.flags[`lt${by.id}`] = flag(g, `lt${by.id}`) + 1;
    if (g.flags[`lt${by.id}`] >= load && by.ai) by.ai.cool = 1e9;
  }
}
/** Our own escorts never depth-charge Tang, even after a stray weapon of ours hits one of them: they stay on their jobs. */
function noBlueHunt(g: Game) {
  for (const v of g.vessels) if (v.side === 'allied' && v.ai?.mode === 'hunt') { v.ai.mode = v.ai.home ?? 'station'; v.ai.datum = null; }
}
/** A patrol plane's report of a submarine, rough by `err` nm, as bearing and range from Tang. */
function cue(g: Game, v: Vessel, who: string, err: number) {
  const p = offset(v, g.r() * 360, g.r() * err);
  log(g, 'contact', `${who}: possible submarine, bearing ${fmtBrg(brg(g.own, p))}, range ${dist(g.own, p).toFixed(1)} nm from us.`);
}
/** Lanes: when every live ship in `ships` has reached `exit` (or been lost), the convoy is through. */
function through(g: Game, ships: Vessel[], exit: Vec, within = 2) {
  // A ship that lost its leader (or is the leader) keeps making for the exit.
  for (const s of ships) if (s.alive && s.ai?.mode === 'transit' && s.ai.cruise > 0) { s.ai.baseCourse = brg(s, exit); s.ai.cruise = Math.min(s.ai.cruise, 10); }
  for (const s of ships) if (arrive(g, s, exit, within)) { g.flags.through = flag(g, 'through') + 1; log(g, 'good', `${s.name} is clear of the danger area.`); }
  return ships.every((s) => !s.alive);
}
const site = (g: Game, name: string, p: Vec) => { const s = { id: -(g.sites.length + 1), name, ...p, hits: 0 }; g.sites.push(s); return s; };
const hits = (g: Game, name: string) => g.sites.find((s) => s.name === name)?.hits ?? 0;
const convoyState = (g: Game) => {
  const ships = byId(g, g.goal.protect);
  return `${flag(g, 'through')} of ${ships.length} through, ${ships.filter(isSunk).length} lost.`;
};

// ---- I5 Hormuz (the hub) ----------------------------------------------------------------------
missions.I5 = {
  key: 'I5', title: 'Hormuz', era: '2029', place: 'Strait of Hormuz', date: 'June 2029, 0430',
  library: ['kilo', 'ghadir', 'fac', 'tanker', 'arleigh', 'jamaran', 'type209'],
  brief: 'Iran has closed the Strait of Hormuz with Chinese-made mines, Ghadir midget subs and a Kilo. Four tankers are waiting to come out of the Gulf with USS Jeremiah Denton as escort, and Tang leads them through. The lane runs southeast (120) for 24 nm from 3 nm astern of you; the convoy sails 30 minutes in at 9 knots. Mine lines cross the lane: at 10 knots or less the HF sonar finds mines out to 1 nm, and an active ping finds them out to 3 nm, though every sub in the strait will hear it. Each mine you find is marked and blown by the destroyer\'s helicopter three minutes later. The midget subs lie off the lane, two torpedoes each, and will go for the tankers; Jeremiah Denton\'s helicopters will report them as they move and hunt them too. The Kilo guards the far end; a P-8A working that end of the strait will pass on rough positions for it every half hour. Fast attack craft will come out from Qeshm. The water is shallow: no deeper than 250 feet, so no layer. Get the tankers through and lose no more than one.',
  build(g, r, carry) {
    g.startClock = clock(4, 30);
    g.timeLimit = 5 * 3600;
    g.env.sea = 3;
    const course = 120;
    g.own.hdg = g.own.ordHdg = course; g.own.depthT = g.own.ordDepth = 1;
    const c0 = offset(g.own, course + 180, 3), exit = offset(c0, course, 24);
    const lead = add(g, 'tanker', 'MT Ocean Pride', 'allied', c0, course, 0, go(course, 0, 1e9));
    const tankers = [lead, ...screen(g, lead, 'tanker', ['MT Hellas Glory', 'MT Nordic Breeze', 'MT Basra Star'], [[180, 1], [180, 2], [180, 3]])];
    const denton = add(g, 'arleigh', 'USS Jeremiah Denton', 'allied', offset(lead, course + 60, 2), course, 0, { mode: 'station', leader: lead.id, rel: 60, rng: 2 });
    // Busy water: neutral traffic still working the inshore route.
    add(g, 'tanker', 'MT Kaveh (Iranian coaster)', 'allied', offset(c0, course + 70, 6), course + 180, 8, go(course + 180, 8));
    for (const d of [6, 10, 14, 19]) {
      const c = offset(c0, course, d + (r() * 2 - 1));
      mineLine(g, offset(c, course - 90, 1.1), offset(c, course + 90, 1.1), 7);
    }
    // The midgets wait off the lane for the tankers; they are tanker killers and leave Tang alone.
    const ghadirs = [9, 14, 19].map((d, i) => {
      const p = offset(offset(c0, course, d), course + (r() < 0.5 ? 90 : -90), 2 + r() * 2);
      return add(g, 'ghadir', `Ghadir ${942 + i * 3}`, 'enemy', p, r() * 360, 2, { mode: 'raider', goal: p, cruise: 1.5, torps: 1 }, 1);
    });
    const [kn] = kilos(carry, 1);
    const kpos = offset(offset(c0, course, 19), course + (r() < 0.5 ? 90 : -90), 4.5 + r() * 1.5);
    const kilo = add(g, 'kilo', kn, 'enemy', kpos, course + 180, 3, { mode: 'raider', goal: kpos, cruise: 1.5, torps: 2, decoys: 2 }, 1);
    const facs: Vessel[] = [];
    setGoal(g, { protect: ids(tankers), maxLosses: 1, lossText: 'Two tankers are lost in the strait. Nothing else will sail through Hormuz this month.', timeout: 'Five hours gone and the convoy is still in the strait.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      shallow(gg, 250);
      sweepMarked(gg, 'Jeremiah Denton\'s MH-60S');
      at(gg, 30 * 60, 'sail', () => { lead.ai!.cruise = 9; log(gg, 'info', 'The convoy is under way, 9 knots, on the lane behind us.'); });
      for (const gd of ghadirs) {
        if (!gd.alive || !gd.ai!.goal || !tankers.some((t) => t.alive && dist(gd, t) < 6)) continue;
        Object.assign(gd.ai!, { goal: undefined, cruise: 6 });
        if (denton.alive) cue(gg, gd, 'Jeremiah Denton\'s MH-60R', 1);
      }
      // The Kilo waits quietly off the lane, then goes for the tankers when they come by.
      // A P-8A out of Oman is working the far end of the strait and passes on what its buoys hear of the Kilo.
      if (kilo.alive && gg.t % 1800 === 600) cue(gg, kilo, 'P-8A Poseidon', 1.5);
      if (kilo.alive && kilo.ai!.goal && tankers.some((t) => t.alive && dist(t, kilo) < 7)) {
        Object.assign(kilo.ai!, { goal: undefined, cruise: 8 });
        if (denton.alive) cue(gg, kilo, 'Jeremiah Denton\'s MH-60R', 1);
      }
      skirmish(gg, [denton], ghadirs, 4.5, 0.14, 0, 0.5);
      at(gg, 75 * 60, 'facs', () => facWave(gg, facs, offset(offset(c0, course, 14), 30, 18), ['Peykan', 'Joshan', 'Zoubin', 'Khadang']));
      facRun(gg, facs, tankers, 9, () => (denton.alive ? 0.4 : 0.65), 'C-704', 3); jink(gg, facs, 0.3);
      guns(gg, [denton], facs, 0.02);
      if (through(gg, tankers, exit)) end(gg, true, 'The tankers are out in the Gulf of Oman. The strait is open and the oil is moving.');
    };
  },
};
extras.I5 = (g, b) => [
  { text: 'Lead the tankers through the strait', state: g.over?.win ? 'done' : 'open', detail: convoyState(g) },
  { text: 'Find the mines in the lane', state: 'open', detail: `${flag(g, 'cleared')} cleared, ${g.mines.filter((m) => m.side === 'enemy').length} left in the strait.` },
  ...b,
];

// ---- I7 Kharg Island ----------------------------------------------------------------------------
missions.I7 = {
  key: 'I7', title: 'Kharg Island', era: '2029', place: 'Northern Gulf', date: 'June 2029, 0200', night: true,
  library: ['kilo', 'jamaran', 'fac', 'tanker', 'type039'],
  brief: 'With the strait open, it is Iran\'s turn to lose its oil. Nine-tenths of its crude goes out through Kharg Island, 32 nm north-northeast of you (bearing 020). Put land-attack Tomahawks into it: three hits each on the T-jetty, the Sea Island terminal and the tank farm. A Mersad air-defence battery on the island shoots down half the Tomahawks that come near while its radar works; two hits on its radar silence it. Over flat water and a flat island the Tomahawks\' terrain matching has nothing to hold on to, so launch from within 20 nm of Kharg, where the terminal camera can do the job; from farther out they wander off. Every launch tells Iran where you are: the Kilo that came up from Bandar Abbas and the frigate Sahand out of Bushehr will come for you. Neutral tankers are loading at the terminal: leave them alone. The northern Gulf is shallow, no deeper than 200 feet. You have two and a half hours, until first light.',
  build(g, r, carry) {
    g.startClock = clock(2);
    g.timeLimit = 2.5 * 3600;
    g.own.hdg = g.own.ordHdg = 20; g.own.depthT = g.own.ordDepth = 1;
    const kharg = offset(g.own, 20, 32);
    site(g, 'Kharg air-defence radar', offset(kharg, 300, 2));
    site(g, 'Kharg T-jetty', offset(kharg, 90, 1.5));
    site(g, 'Sea Island terminal', offset(kharg, 250, 2.5));
    site(g, 'Kharg tank farm', offset(kharg, 0, 1));
    for (const [n, b] of [['MT Delos Spirit', 100], ['MT Indus Maru', 260]] as const) moored(g, 'tanker', n, 'allied', offset(kharg, b, 4), r() * 360);
    const [kn] = kilos(carry, 1);
    const kilo = add(g, 'kilo', kn, 'enemy', offset(g.own, r() < 0.5 ? 60 + r() * 30 : 320 + r() * 30, 10 + r() * 4), r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
    const sahand = add(g, 'jamaran', 'IRIS Sahand', 'enemy', offset(kharg, 170 + r() * 60, 10 + r() * 4), 200, 10, { mode: 'patrol', legT: 900 });
    setGoal(g, { timeout: 'Kharg is still loading oil. The strike ran out of time.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      shallow(gg, 200);
      pointDefence(gg, [sahand], 0.5);
      const radar = hits(gg, 'Kharg air-defence radar') >= 2;
      for (const w of gg.weapons) {
        if (w.type !== 'tlam' || w.dead) continue;
        if (!gg.flags[`tl${w.id}`]) gg.flags[`tl${w.id}`] = dist(w, kharg) > 20 ? 2 : 1;
        if (gg.flags[`tl${w.id}`] === 2 && w.run > 5) { w.dead = true; log(gg, 'warn', `${w.label} has no terrain fix over open water and is wandering off course. Launch from within 20 nm of Kharg.`); continue; }
        if (gg.flags[`ad${w.id}`] || dist(w, kharg) > 10) continue;
        gg.flags[`ad${w.id}`] = 1;
        if (!radar && gg.r() < 0.5) { w.dead = true; log(gg, 'warn', `Kharg's Mersad battery shot down ${w.label}.`); }
      }
      // Every launch gives us away: coastal radar sees the missile climb out and the hunters get a rough datum.
      if (gg.stats.fired.tlam + gg.stats.fired.mjolnir > flag(gg, 'seen')) {
        if (!gg.flags.seen) log(gg, 'warn', 'Radio intercepts: Iranian coastal radar saw the launch. Sahand and the Kilo are being vectored toward us.');
        gg.flags.seen = gg.stats.fired.tlam + gg.stats.fired.mjolnir;
        for (const v of [kilo, sahand]) if (v.alive && v.ai!.mode !== 'evade') { v.ai!.knows = { x: gg.own.x + (gg.r() - 0.5) * 3, y: gg.own.y + (gg.r() - 0.5) * 3, t: gg.t, deep: false }; v.ai!.mode = 'attack'; }
      }
      if (['Kharg T-jetty', 'Sea Island terminal', 'Kharg tank farm'].every((n) => hits(gg, n) >= 3)) end(gg, true, 'Kharg\'s jetties and tanks are burning. Iran\'s oil exports have stopped.');
    };
  },
};
extras.I7 = (g, b) => [
  ...['Kharg T-jetty', 'Sea Island terminal', 'Kharg tank farm'].map((n): Objective => ({ text: `Three hits on the ${n.replace('Kharg ', '')}`, state: hits(g, n) >= 3 ? 'done' : 'open', detail: `${Math.min(3, hits(g, n))} of 3.` })),
  { text: 'Launch from within 20 nm of Kharg', state: 'open', detail: `${dist(g.own, offset({ x: 0, y: 0 }, 20, 32)).toFixed(1)} nm from the island now.` },
  { text: 'Silence the air-defence radar (optional)', state: hits(g, 'Kharg air-defence radar') >= 2 ? 'done' : 'open', detail: hits(g, 'Kharg air-defence radar') >= 2 ? 'Two hits: the battery is blind.' : 'While it works, half the Tomahawks are shot down near the island.' },
  ...b,
];

// ---- I18 Bahrain --------------------------------------------------------------------------------
missions.I18 = {
  key: 'I18', title: 'Bahrain', era: '2029', place: 'Off Manama, Bahrain', date: 'June 2029, 0300', night: true,
  library: ['ghadir', 'droneboat', 'arleigh', 'tender', 'boxship', 'fac', 'kilo'],
  brief: 'Iran is going for the Fifth Fleet\'s home port. Three Ghadir midget subs are creeping in from the northeast toward the Mina Salman channel, 8 nm west-southwest of you (bearing 250), and explosive drone boats will follow from the Iranian coast. USS Emory S. Land, USS Thad Cochran and a supply ship are alongside; USS Sam Nunn patrols just south of the channel mouth and her guns can stop a drone boat or two; mind your torpedoes near her. Hold for two and a half hours. Don\'t let two midgets into the channel, and lose no more than one ship in port. Drone boats are fast and loud: Harpoon or Tomahawk them well out.',
  build(g, r) {
    g.startClock = clock(3);
    g.timeLimit = 2.5 * 3600;
    g.own.hdg = g.own.ordHdg = 45; g.own.depthT = g.own.ordDepth = 1;
    const mouth = offset(g.own, 250, 8);
    const port = [moored(g, 'tender', 'USS Emory S. Land', 'allied', offset(mouth, 250, 1.5), 70), moored(g, 'arleigh', 'USS Thad Cochran', 'allied', offset(mouth, 235, 1.8), 70),
      moored(g, 'boxship', 'USNS Charlton', 'allied', offset(mouth, 265, 1.8), 70)];
    const nunn = add(g, 'arleigh', 'USS Sam Nunn', 'allied', offset(mouth, 170, 2), 0, 6, { mode: 'picket', center: offset(mouth, 160, 2) });
    const midgets = [0, 1, 2].map((i) => {
      const p = offset(mouth, 25 + i * 22 + (r() * 2 - 1) * 6, 10 + r() * 3);
      return add(g, 'ghadir', `Ghadir ${951 + i}`, 'enemy', p, brg(p, mouth), 5, { mode: 'raider', goal: mouth, cruise: 5 + r() * 2 }, 1);
    });
    const boats: Vessel[] = [];
    setGoal(g, { protect: ids(port), maxLosses: 1, surviveWin: true, lossText: 'Two ships are burning alongside in Mina Salman. The Fifth Fleet has lost its home port.',
      win: 'Dawn over Manama: the harbour is intact and the midgets are on the bottom or turned back.', timeout: '' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      for (const m of midgets) {
        if (!m.alive || dist(m, mouth) > 0.5) continue;
        m.alive = false; m.gone = true;
        gg.flags.midgetsIn = flag(gg, 'midgetsIn') + 1;
        log(gg, 'danger', `${m.name} is inside the Mina Salman channel!`, 'alarm');
        const t = live(port)[0];
        if (t) for (let i = 0; i < 3; i++) bombed(gg, t, `${m.name}'s torpedoes`);
        if (gg.flags.midgetsIn >= 2) end(gg, false, 'Two midget subs got into Mina Salman.');
      }
      at(gg, 30 * 60, 'w1', () => droneWave(gg, boats, offset(mouth, 40, 26), 4, 'A'));
      at(gg, 85 * 60, 'w2', () => droneWave(gg, boats, offset(mouth, 55, 26), 5, 'B'));
      droneBoats(gg, boats, [...port, nunn]); jink(gg, boats);
      guns(gg, [nunn], boats, 0.015);
      skirmish(gg, [nunn], midgets, 3, 0.08, 0, 0.5);
    };
  },
};
extras.I18 = (g, b) => [...b, watch('Don\'t let two midgets into the channel', flag(g, 'midgetsIn') >= 2, `${flag(g, 'midgetsIn')} of 2 have got in.`),
  { text: 'Stop the drone boats', state: 'open', detail: g.t < 30 * 60 ? 'Expected about 30 minutes in, and again later.' : `${vs(g, 'droneboat').filter(isSunk).length} sunk, ${vs(g, 'droneboat').filter((v) => v.alive).length} still running.` }];

// ---- I19 Qatar Gas ------------------------------------------------------------------------------
missions.I19 = {
  key: 'I19', title: 'Qatar Gas', era: '2029', place: 'Off Ras Laffan, Qatar', date: 'July 2029, 1400',
  library: ['lng', 'type26', 'fac', 'ghadir', 'jamaran', 'tanker'],
  brief: 'Europe needs Qatar\'s gas. Three Q-Max carriers, Mozah, Al Mayeda and Rasheeda, are leaving Ras Laffan with HMS Glasgow as escort, heading 060 for 28 nm to the safe water off the Emirates; Tang is out ahead of them. Iran has sown a minefield across the route about 12 nm out: find it with the HF sonar (10 knots or less) or a ping, and Glasgow\'s Merlin will blow each mine you mark. Iranian fast attack craft will come in waves from the islands to the north and fire C-704s from about 15 nm. Sink them before they get there. Two Ghadir midget subs are thought to be lying off the route beyond the minefield; Glasgow\'s Wildcat will report them when they move. Bring all three carriers out.',
  build(g, r) {
    g.startClock = clock(14);
    g.timeLimit = 3.5 * 3600;
    const course = 60;
    g.own.hdg = g.own.ordHdg = course; g.own.depthT = g.own.ordDepth = 1;
    const c0 = offset(g.own, course + 180, 3), exit = offset(c0, course, 28);
    const lead = add(g, 'lng', 'Mozah', 'allied', c0, course, 10, go(course, 10, 1e9));
    const ships = [lead, ...screen(g, lead, 'lng', ['Al Mayeda', 'Rasheeda'], [[180, 1.2], [180, 2.4]])];
    const glasgow = add(g, 'type26', 'HMS Glasgow', 'allied', offset(lead, course - 50, 2), course, 10, { mode: 'station', leader: lead.id, rel: -50, rng: 2 });
    mineField(g, offset(c0, course, 12 + r() * 2), 1.2, 16);
    // Two midgets lie off the route beyond the minefield, waiting for the carriers to slow for it.
    const ghadirs = [17, 22].map((d, i) => {
      const p = offset(offset(c0, course, d), course + (r() < 0.5 ? 90 : -90), 2 + r() * 2);
      return add(g, 'ghadir', `Ghadir ${960 + i * 2}`, 'enemy', p, r() * 360, 2, { mode: 'raider', goal: p, cruise: 1.5, torps: 1 }, 1);
    });
    const facs: Vessel[] = [];
    const names = [['Tondar', 'Khanjar', 'Neyzeh', 'Fath', 'Nasr', 'Ashura', 'Tareq'], ['Tabarzin', 'Gorz', 'Derafsh', 'Heydar', 'Qadir', 'Zafar', 'Hamzeh'],
      ['Paykan', 'Gardouneh', 'Shamshir', 'Zolfaghar', 'Kaman', 'Sina', 'Toufan', 'Saeqeh'], ['Separ', 'Falakhon', 'Khadang', 'Joshan', 'Zoubin', 'Shahid Nazeri', 'Azarakhsh', 'Raad']];
    setGoal(g, { protect: ids(ships), maxLosses: 0, lossText: 'A gas carrier is burning off Ras Laffan, and the rest turn back.', timeout: 'The carriers are still in the Gulf at nightfall.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      sweepMarked(gg, 'Glasgow\'s Merlin');
      for (const gd of ghadirs) {
        if (!gd.alive || !gd.ai!.goal || !ships.some((t) => t.alive && dist(gd, t) < 6)) continue;
        Object.assign(gd.ai!, { goal: undefined, cruise: 6 });
        if (glasgow.alive) cue(gg, gd, 'Glasgow\'s Wildcat', 1);
      }
      skirmish(gg, [glasgow], ghadirs, 4, 0.12, 0, 0.5);
      // Each wave comes in two groups from different islands at once, to swamp the defence.
      names.forEach((n, i) => at(gg, (20 + i * 30) * 60, `fw${i}`, () => {
        const b = (gg.r() * 2 - 1) * 15, h = Math.ceil(n.length / 2);
        facWave(gg, facs, offset(lead, b - 30, 24), n.slice(0, h), 15); facWave(gg, facs, offset(lead, b + 30, 24), n.slice(h), 15);
      }));
      facRun(gg, facs, ships, 15, () => (glasgow.alive ? 0.4 : 0.6), 'C-704', 3); jink(gg, facs, 0.3);
      guns(gg, [glasgow], facs, 0.02);
      if (through(gg, ships, exit)) end(gg, true, 'The carriers are off the Emirates under friendly air cover. Europe\'s gas is on its way.');
    };
  },
};
extras.I19 = (g, b) => [{ text: 'See the carriers 28 nm out to safe water', state: g.over?.win ? 'done' : 'open', detail: convoyState(g) },
  { text: 'Find the minefield on the route', state: 'open', detail: `${flag(g, 'cleared')} mines cleared, ${g.mines.length} left.` }, ...b];

// ---- I6 Bab-el-Mandeb -----------------------------------------------------------------------
missions.I6 = {
  key: 'I6', title: 'Bab-el-Mandeb', era: '2029', place: 'Mouth of the Red Sea', date: 'July 2029, 0500',
  library: ['jamaran', 'droneboat', 'boxship', 'arleigh', 'fac', 'type054a'],
  brief: 'The southern gate of the Red Sea is shut. Iranian-supplied launchers on the Yemeni shore fire on anything that moves, drone boats come out of the coves, and the frigate IRIS Dena covers the strait. A convoy of four container ships with USS Louis H. Wilson Jr. is moving north with you at 8 knots. To open the gate, land two Tomahawks on each launcher site (Mocha, 25 nm north-northeast; Dhubab, 14 nm northeast; and Zuqar Island, out in the strait 32 nm north-northwest) and sink Dena, somewhere 25 to 30 nm north of you beyond the strait with two missile boats in company, firing her own Noor missiles at the convoy every 20 minutes; her guns shoot down more than half the missiles fired at her. The launchers are mobile and hide in the hills: they are out in the open for only about seven minutes after each salvo, so a Tomahawk sent at any other time hits empty ground. They fire three missiles every 15 minutes and are deadlier while the Perim Island radar (9 nm north) works. Lose no more than one ship. Three hours.',
  build(g, r) {
    g.startClock = clock(5);
    g.timeLimit = 3 * 3600;
    const course = 340;
    g.own.hdg = g.own.ordHdg = course; g.own.depthT = g.own.ordDepth = 1;
    site(g, 'Mocha launcher site', offset(g.own, 22, 25));
    site(g, 'Dhubab launcher site', offset(g.own, 45, 14));
    site(g, 'Zuqar Island launcher site', offset(g.own, 345, 32));
    site(g, 'Perim Island radar', offset(g.own, 5, 9));
    const lead = add(g, 'arleigh', 'USS Louis H. Wilson Jr.', 'allied', offset(g.own, 180, 3), course, 8, go(course, 8, 1e9));
    const ships = screen(g, lead, 'boxship', ['MV Maersk Kensington', 'MV Cape Orlando', 'MV Atlantic Sail', 'MV Ever Grace'], [[150, 2], [210, 2], [165, 4], [195, 4]]);
    const dena = add(g, 'jamaran', 'IRIS Dena', 'enemy', offset(g.own, course + (r() * 2 - 1) * 20, 24 + r() * 6), 160, 8, { mode: 'patrol', legT: 700 });
    const screenBoats = screen(g, dena, 'fac', ['Separ', 'Sahand-2'], [[40, 1.5], [320, 1.5]]);
    const boats: Vessel[] = [], coast = [offset(g.own, 70, 12), offset(g.own, 40, 20)];
    setGoal(g, { protect: ids(ships), maxLosses: 1, lossText: 'Two ships of the convoy are lost in the strait. The Red Sea stays shut.', timeout: 'The gate is still shut: launchers or Dena still in action.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      pointDefence(gg, [dena, ...screenBoats], 0.6);
      const radar = hits(gg, 'Perim Island radar') > 0;
      for (const n of ['Mocha launcher site', 'Dhubab launcher site', 'Zuqar Island launcher site']) {
        const s = gg.sites.find((x) => x.name === n)!, k = `shown${n[0]}`;
        // Mobile launchers, hidden in the hills: they are out in the open only for the few minutes after a salvo, then move on.
        const open = gg.flags[k] !== undefined && gg.t - gg.flags[k] < 7 * 60;
        if (s.hits > flag(gg, `kept${n[0]}`) && flag(gg, `kept${n[0]}`) < 2 && !open) { s.hits = flag(gg, `kept${n[0]}`); log(gg, 'warn', `${n}: the strike hit empty ground. The launchers have moved.`); }
        if (s.hits >= 2 || open) gg.flags[`kept${n[0]}`] = s.hits;
        if (s.hits < 2 && gg.t >= 3 * 60 && (gg.t - 3 * 60) % (15 * 60) === ({ M: 0, D: 420, Z: 240 } as Record<string, number>)[n[0]]) {
          missileSalvo(gg, n.replace(' site', ''), 'Ghader', 3, ships, radar ? 0.25 : 0.45, 2);
          gg.flags[k] = gg.t; log(gg, 'info', `Wilson's radar has traced the launch back to the ${n.replace(' site', 's')}. They will move again within seven minutes.`);
        }
      }
      // Dena joins in with her own Noor missiles whenever the convoy is inside 40 nm.
      if (dena.alive && gg.t % (20 * 60) === 12 * 60 && live(ships).some((x) => dist(x, dena) < 40)) missileSalvo(gg, 'IRIS Dena', 'Noor', 2, ships, lead.alive ? 0.25 : 0.5, 2);
      // From the coves on the Yemeni shore.
      at(gg, 8 * 60, 'w1', () => { droneWave(gg, boats, coast[0], 4, 'A'); droneWave(gg, boats, coast[1], 3, 'B'); });
      at(gg, 35 * 60, 'w2', () => droneWave(gg, boats, coast[1], 5, 'C'));
      at(gg, 65 * 60, 'w3', () => droneWave(gg, boats, coast[0], 5, 'D'));
      droneBoats(gg, boats, [...ships, lead]); jink(gg, boats);
      guns(gg, [lead], boats, 0.07);
      if (!dena.alive && gg.sites.filter((s) => s.name.includes('launcher')).every((s) => s.hits >= 2)) end(gg, true, 'The launchers are wrecked and Dena is on the bottom. Bab-el-Mandeb is open.');
    };
  },
};
extras.I6 = (g, b) => [
  { text: 'Two hits on the Mocha launcher site', state: hits(g, 'Mocha launcher site') >= 2 ? 'done' : 'open', detail: `${Math.min(2, hits(g, 'Mocha launcher site'))} of 2. 25 nm north-northeast of where you started.` },
  { text: 'Two hits on the Dhubab launcher site', state: hits(g, 'Dhubab launcher site') >= 2 ? 'done' : 'open', detail: `${Math.min(2, hits(g, 'Dhubab launcher site'))} of 2. 14 nm northeast of where you started.` },
  { text: 'Two hits on the Zuqar Island launcher site', state: hits(g, 'Zuqar Island launcher site') >= 2 ? 'done' : 'open', detail: `${Math.min(2, hits(g, 'Zuqar Island launcher site'))} of 2. 32 nm north-northwest of where you started.` },
  { text: 'Sink IRIS Dena', state: vs(g, 'jamaran').every(isSunk) ? 'done' : 'open' },
  { text: 'Knock out the Perim Island radar (optional)', state: hits(g, 'Perim Island radar') ? 'done' : 'open', detail: 'Blinds the launchers: fewer of their missiles find a ship.' },
  ...b,
];

// ---- I20 Haifa ---------------------------------------------------------------------------------
missions.I20 = {
  key: 'I20', title: 'Haifa', era: '2029', place: 'Eastern Mediterranean, off Haifa', date: 'July 2029, 2300', night: true,
  library: ['kilo', 'reis', 'type209', 'boxship', 'tanker'],
  brief: 'Iran has struck Israel, and a Kilo that slipped through Suez before it closed is coming to finish the job: mines and torpedoes in Haifa\'s harbour mouth, about 13 nm east of you. It is somewhere to the west, on battery and quiet, snorting now and then. Its racks are mostly full of mines, but it has a few torpedoes and will use them on anyone it hears hunting it. A P-8A is working the area and will radio a rough position, good to a few miles, about every half hour. Sink the Kilo before it gets within 3 nm of the harbour. A Turkish Reis-class boat is also out here, neutral and minding its own business: sinking it fails the mission, so make sure of your target. Neutral merchants are using the anchorage.',
  build(g, r, carry) {
    g.startClock = clock(23);
    g.timeLimit = 4.5 * 3600;
    g.own.hdg = g.own.ordHdg = 270;
    const haifa = offset(g.own, 80 + r() * 20, 12 + r() * 2);
    const kp = offset(g.own, 240 + r() * 60, 17 + r() * 3);
    const [kn] = kilos(carry, 1);
    const kilo = add(g, 'kilo', kn, 'enemy', kp, brg(kp, haifa), 6, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
    const reisSpots = [offset(g.own, 200 + r() * 40, 6), offset(g.own, 320 + r() * 40, 7)];
    const reis = add(g, 'reis', 'TCG Piri Reis', 'allied', reisSpots[0], 0, 5, undefined, 1);
    for (const [n, b] of [['MV Zim Shanghai', 60], ['MT Aegean Star', 110]] as const) moored(g, 'boxship', n, 'allied', offset(haifa, b + 180, 4), r() * 360);
    setGoal(g, { targets: [kilo.id], need: 1, protect: [reis.id], maxLosses: 0, win: 'The Kilo is on the bottom short of Haifa.', lossText: 'We sank TCG Piri Reis, a neutral Turkish submarine.', timeout: 'The Kilo was never found.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      steer(reis, reisSpots[Math.floor(gg.t / 2400) % 2], 5);
      if (!kilo.alive) return;
      // Snorting: 8 minutes in every 40 at 10 knots on the diesels, loud.
      // It holds on for Haifa, and turns on anything it hears hunting it.
      keepCourse(kilo, brg(kilo, haifa), gg.t % 2400 > 1920 ? 10 : 6);
      // Its racks are full of mines for the harbour: room for only a few torpedoes. Once they are gone it runs for Haifa.
      for (const w of gg.weapons) if (w.side === 'enemy' && w.run < 0.1 && !gg.flags[`kt${w.id}`] && dist(w, kilo) < 0.3) { gg.flags[`kt${w.id}`] = 1; gg.flags.ktorps = flag(gg, 'ktorps') + 1; }
      if (flag(gg, 'ktorps') >= 2) { kilo.ai!.cool = 1e9; if (kilo.ai!.mode === 'attack') kilo.ai!.mode = 'patrol'; }
      if (gg.t % 1800 === 900) cue(gg, kilo, 'P-8A Poseidon', 2 + gg.r() * 2);
      if (dist(kilo, haifa) < 3) end(gg, false, 'The Kilo reached Haifa\'s harbour mouth and laid its mines. The port is shut.');
    };
  },
};
extras.I20 = (g, b) => [...b, watch('Stop the Kilo short of Haifa\'s harbour mouth', !!g.over?.reason.includes('harbour mouth'), 'It needs to get within 3 nm of the harbour, about 13 nm east of where you started.')];

// ---- I21 Eilat --------------------------------------------------------------------------------
missions.I21 = {
  key: 'I21', title: 'Eilat', era: '2029', place: 'Gulf of Aqaba', date: 'July 2029, 0400',
  library: ['jamaran', 'droneboat', 'boxship', 'tanker', 'fac'],
  brief: 'The Gulf of Aqaba is a 12-mile-wide slot with Egypt on one side and Saudi Arabia on the other. The Iranian frigate IRIS Jamaran has come up through the Strait of Tiran and is standing off 45 to 50 nm south of Eilat with two missile boats, launching drone boats and Noor missiles at the port, 12 nm north-northeast of you (bearing 025), where a container ship and a tanker are alongside. Sink Jamaran to stop the waves; stop the boats she has already sent. Don\'t lose either ship in port. Stay in the gulf: more than 6 nm either side of its axis puts you in Egyptian or Saudi waters, and five minutes there ends the mission. Three hours.',
  build(g, r) {
    g.startClock = clock(4);
    g.timeLimit = 3 * 3600;
    const axis = 25;
    g.own.hdg = g.own.ordHdg = axis + 180;
    const eilat = offset(g.own, axis, 12);
    const port = [moored(g, 'boxship', 'MV Zim Eilat', 'allied', offset(eilat, 300, 0.6), 200), moored(g, 'tanker', 'MT Eilat Star (EAPC terminal)', 'allied', offset(eilat, 160, 1.5), 200)];
    const jamaran = add(g, 'jamaran', 'IRIS Jamaran', 'enemy', offset(g.own, axis + 180, 34 + r() * 4), axis, 12, { mode: 'patrol', legT: 1e9 });
    const stand = offset(eilat, axis + 180, 44 + r() * 4);
    const escorts = screen(g, jamaran, 'fac', ['Gardouneh', 'Khanjar'], [[60, 1.5], [300, 1.5]]);
    const boats: Vessel[] = [];
    setGoal(g, { targets: [jamaran.id], need: 1, protect: ids(port), maxLosses: 0, win: 'Jamaran is sunk in the Gulf of Aqaba. Eilat is safe.', lossText: 'A ship is burning and sinking alongside in Eilat. Israel\'s Red Sea port is shut.', timeout: 'Jamaran is still out there launching drone boats.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      const lateral = Math.sin(((brg(eilat, gg.own) - (axis + 180)) * Math.PI) / 180) * dist(eilat, gg.own);
      if (Math.abs(lateral) > 6) {
        gg.flags.outside = flag(gg, 'outside') + 1;
        if (gg.flags.outside === 1) log(gg, 'warn', `Navigator: we are out of the gulf\'s axis into ${lateral > 0 ? 'Egyptian' : 'Saudi'} waters. Come back within 6 nm.`);
        if (gg.flags.outside >= 300) end(gg, false, 'Tang spent five minutes in neutral waters. The mission is called off.');
      } else gg.flags.outside = 0;
      pointDefence(gg, [jamaran, ...escorts], 0.6);
      if (jamaran.alive) {
        keepCourse(jamaran, dist(jamaran, stand) > 1 ? brg(jamaran, stand) : norm(gg.t / 4), dist(jamaran, stand) > 1 ? 12 : 5);
        if (gg.t % (10 * 60) === 2 * 60) droneWave(gg, boats, jamaran, 5, `${(gg.t + 480) / 600}-`);
        // And her own Noor missiles at the port; Eilat's Barak batteries stop most of them.
        if (gg.t % (20 * 60) === 0 && gg.t > 0) missileSalvo(gg, 'IRIS Jamaran', 'Noor', 2, port, 0.2, 2, 'the port');
      }
      droneBoats(gg, boats, port); jink(gg, boats);
    };
  },
};
extras.I21 = (g, b) => [...b, watch('Stay inside the gulf (6 nm either side of the axis)', !!g.over?.reason.includes('neutral waters'), flag(g, 'outside') ? `Outside for ${mins(flag(g, 'outside'))}. Five minutes ends the mission.` : 'Inside.'),
  { text: 'Stop the drone boats', state: 'open', detail: `${vs(g, 'droneboat').filter(isSunk).length} sunk, ${vs(g, 'droneboat').filter((v) => v.alive).length} running. A wave every 10 minutes while Jamaran is afloat.` }];

// ---- I11 Gulf of Oman -------------------------------------------------------------------------
missions.I11 = {
  key: 'I11', title: 'Gulf of Oman', era: '2029', place: 'Gulf of Oman', date: 'August 2029, 0100', night: true,
  library: ['kilo', 'jamaran', 'tanker', 'type039', 'ghadir'],
  brief: 'Iran\'s last two Kilos have slipped out of the strait and are running southeast for the Arabian Sea, where they could hide for months. They are about 20 nm northwest of you (bearing 320), snorting at 10 knots to make the most of the dark, and two Moudge-class frigates, Deylaman and Zagros, are sweeping ahead of them. Sink both Kilos before either gets 40 nm out to open water. The frigates have good hull sonar and torpedoes.',
  build(g, r, carry) {
    g.startClock = clock(1);
    g.timeLimit = 4 * 3600;
    g.own.hdg = g.own.ordHdg = 320;
    const start = offset(g.own, 320, 20), out = offset(start, 130, 40);
    const boats = kilos(carry, 2).map((n, i) => {
      const p = offset(start, 40 + i * 180, 1.5 + r());
      return { v: add(g, 'kilo', n, 'enemy', p, 130, 10, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1), lane: offset(out, 40 + i * 180 + (r() * 2 - 1) * 30, 2) };
    });
    const frigates = (['IRIS Deylaman', 'IRIS Zagros'] as const).map((n, i) => add(g, 'jamaran', n, 'enemy', offset(offset(start, 130, 6), 40 + i * 180, 2 + r() * 2), 130, 10, { mode: 'patrol', legT: 1e9 }));
    add(g, 'tanker', 'MT Fujairah Spirit', 'allied', offset(g.own, 200, 10), 30, 11, go(30, 11));
    setGoal(g, { targets: boats.map((b) => b.v.id), need: 2, win: 'Both Kilos are on the bottom. Iran has no submarines left outside the strait.', timeout: 'The Kilos are still loose.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      for (const b of boats) {
        keepCourse(b.v, brg(b.v, b.lane), 10);
        // Each frigate sweeps 6 nm ahead of its Kilo.
        const f = frigates[boats.indexOf(b)], spot = offset(b.v.alive ? b.v : f, 130, 6);
        keepCourse(f, dist(f, spot) > 1.5 ? brg(f, spot) : norm(130 + Math.sin(gg.t / 300) * 60), dist(f, spot) > 1.5 ? 14 : 10);
        if (arrive(gg, b.v, b.lane, 3)) end(gg, false, `${b.v.name} reached open water in the Arabian Sea and vanished.`);
      }
    };
  },
};
extras.I11 = (g, b) => [...b, watch('Don\'t let either Kilo reach open water', !!g.over?.reason.includes('open water'), 'Open water is about 40 nm southeast of where they started.')];

// ---- I22 Chabahar -----------------------------------------------------------------------------
missions.I22 = {
  key: 'I22', title: 'Chabahar', era: '2029', place: 'Off Chabahar, Iran', date: 'August 2029, 0200', night: true,
  library: ['jamaran', 'kilo', 'fac', 'tanker', 'type054a'],
  brief: 'Chabahar is Iran\'s one port outside the strait, and the Gulf\'s losses are being made good through it. Close it with mines: Tang carries eight. The entrance channel is 12 nm north of you. Lay at least six within 1.5 nm of the channel mouth (slow to 12 knots or less, then Lay mine), and get 8 nm clear again. The frigates Jamaran and Sahand are circling the approaches at 12 knots, about 5 nm out from the mouth, and a Kilo is on guard further out. Their sonar is good: go in slow. The bay is shallow: 250 feet at most. You have four hours.',
  build(g, r, carry) {
    g.startClock = clock(2);
    g.timeLimit = 4 * 3600;
    g.own.hdg = g.own.ordHdg = 0; g.own.depthT = g.own.ordDepth = 1;
    g.flags.minesAboard = 8;
    const mouth = offset(g.own, 0, 12);
    const frigates = (['IRIS Jamaran', 'IRIS Sahand'] as const).map((n, i) => add(g, 'jamaran', n, 'enemy', offset(mouth, i * 180 + r() * 90, 5), r() * 360, 12, { mode: 'patrol', legT: 1e9 }));
    const [kn] = kilos(carry, 1);
    add(g, 'kilo', kn, 'enemy', offset(mouth, r() < 0.5 ? 120 + r() * 20 : 220 + r() * 20, 9 + r() * 2), r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
    setGoal(g, { timeout: 'Chabahar is still open.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      shallow(gg, 250);
      frigates.forEach((f, i) => keepCourse(f, norm(brg(mouth, f) + (i ? -1 : 1) * (90 + (dist(mouth, f) - 5) * 20)), 12));
      for (const m of gg.mines) if (m.side === 'us' && dist(m, mouth) < 1.5 && !gg.flags[`ch${m.id}`]) {
        gg.flags[`ch${m.id}`] = 1; gg.flags.laid = flag(gg, 'laid') + 1;
        if (gg.flags.laid === 6) log(gg, 'good', 'Six mines in the channel. Now get clear: 8 nm from the mouth.');
      }
      if (flag(gg, 'laid') >= 6 && dist(gg.own, mouth) > 8) end(gg, true, 'The channel into Chabahar is mined. Nothing will sail in or out until Iran sweeps it, and that will take weeks.');
    };
  },
};
extras.I22 = (g) => [
  { text: 'Lay six mines within 1.5 nm of the channel mouth', state: flag(g, 'laid') >= 6 ? 'done' : 'open', detail: `${Math.min(6, flag(g, 'laid'))} of 6 laid, ${flag(g, 'minesAboard')} aboard. The mouth is 12 nm north of where you started.` },
  { text: 'Then get 8 nm clear', state: g.over?.win ? 'done' : 'open' },
  { text: `Finish within ${mins(g.timeLimit)}`, state: g.over && !g.over.win ? 'failed' : 'open', detail: `${mins(g.timeLimit - g.t)} left.` },
];

// ---- I23 Gwadar -------------------------------------------------------------------------------
missions.I23 = {
  key: 'I23', title: 'Gwadar', era: '2029', place: 'Off Gwadar, Arabian Sea', date: 'August 2029, 1500',
  library: ['type071', 'type054a', 'type039', 'kq200', 'tanker', 'jamaran', 'kalvari'],
  brief: 'Gwadar is China\'s port on the Arabian Sea, and the PLA Navy is using it to feed Iran. The landing ship Wuzhishan is bringing in a cargo of missiles and drone boats, escorted by the Type 054A frigates Xuchang and Yulin, with a Type 039 Yuan sweeping ahead of them at about 9 knots. They are about 14 nm southwest of you, heading for Gwadar, 28 nm to the north. Sink Wuzhishan before she reaches the breakwater. The frigates hunt submarines well and shoot down most anti-ship missiles that come near them, and the first shot will bring a KQ-200 patrol plane out from Gwadar to hunt for the launch point. Neutral tankers are waiting to go in: leave them be.',
  build(g, r) {
    g.startClock = clock(15);
    g.timeLimit = 3.5 * 3600;
    g.own.hdg = g.own.ordHdg = 230;
    const gwadar = offset(g.own, 0, 28);
    const p = offset(g.own, 210 + r() * 30, 13 + r() * 3);
    const lhd = add(g, 'type071', 'Wuzhishan', 'enemy', p, brg(p, gwadar), 13, go(brg(p, gwadar), 13));
    const escorts = screen(g, lhd, 'type054a', ['Xuchang', 'Yulin'], [[50, 2.5], [310, 2.5]]);
    const yuan = add(g, 'type039', 'Great Wall 335 (Yuan)', 'enemy', offset(lhd, lhd.hdg, 8), lhd.hdg, 9, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
    for (const [n, b] of [['MT Karachi Pride', 120], ['MT Arabian Gulf', 220]] as const) moored(g, 'tanker', n, 'allied', offset(gwadar, b, 6), r() * 360);
    let kq: Vessel | null = null;
    setGoal(g, { targets: [lhd.id], need: 1, win: 'Wuzhishan is sinking short of Gwadar with her cargo. The Chinese pipeline to Iran is cut.', timeout: 'Wuzhishan is still afloat.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      pointDefence(gg, [...escorts, lhd], 0.55);
      // The first missile fired at the group scrambles a KQ-200 from Gwadar: buoys round the group, and a torpedo on the launch point.
      if (!kq && Object.values(gg.stats.fired).some((n) => n > 0)) {
        kq = add(gg, 'kq200', 'KQ-200', 'enemy', offset(gwadar, 180, 2), 180, 230, { mode: 'search', center: { x: lhd.x, y: lhd.y }, wp: { x: lhd.x, y: lhd.y }, buoyT: 0, torps: 1, datum: null });
        log(gg, 'warn', 'ESM: aircraft radar lifting off from Gwadar. A KQ-200 patrol plane is coming out to the group.');
      }
      if (kq?.alive && kq.ai!.mode === 'search' && lhd.alive) kq.ai!.center = { x: lhd.x, y: lhd.y };
      // The Yuan sweeps ahead of the group, weaving across its track at 9 knots, until it hears something.
      const ahead = offset(lhd, lhd.hdg, 7);
      if (lhd.alive) keepCourse(yuan, dist(yuan, ahead) > 4 ? brg(yuan, ahead) : norm(lhd.hdg + Math.sin(gg.t / 600) * 50), 9);
      if (lhd.alive && lhd.ai!.mode === 'transit') lhd.ai!.baseCourse = brg(lhd, gwadar);
      if (arrive(gg, lhd, gwadar, 2)) end(gg, false, 'Wuzhishan is inside the breakwater at Gwadar. Her cargo will be in Iran within days.');
    };
  },
};
extras.I23 = (g, b) => [...b, watch('Stop her before the breakwater', !!g.over?.reason.includes('breakwater'), 'Gwadar is 28 nm north of where you started.')];

// ---- I10 Suez -------------------------------------------------------------------------------
missions.I10 = {
  key: 'I10', title: 'Suez', era: '2029', place: 'Gulf of Suez, approaches to the canal', date: 'September 2029, 0600',
  library: ['tanker', 'kilo', 'boxship', 'lng', 'jamaran'],
  brief: 'Tang is going home through Suez, and Iran means to shut the canal behind the fleet. A blockship, the Iranian-run tanker Arya Star, is coming up from astern of you, heading north for the canal entrance at Port Tewfik, 22 nm north-northwest of you (bearing 340), to scuttle herself in the channel. The anchorage between here and the canal is full of neutral ships waiting their turn, tankers among them: the blockship is the tanker under way northbound, the rest are at anchor or heading south. A Kilo is escorting her, running 2 nm ahead. Sink Arya Star before she gets there, but not within 4 nm of the entrance, or her wreck closes the canal anyway. Sinking a neutral fails the mission. The Gulf of Suez is shallow: 200 feet at most.',
  build(g, r, carry) {
    g.startClock = clock(6);
    g.timeLimit = 3 * 3600;
    g.own.hdg = g.own.ordHdg = 340; g.own.depthT = g.own.ordDepth = 1;
    const canal = offset(g.own, 340, 22);
    const anch = offset(g.own, 345, 12);
    // Neutrals (allied side): sinking one with our own weapon ends the mission.
    [['tanker', 'MT Stena Imperial'], ['boxship', 'MV CMA CGM Tage'], ['tanker', 'MT Minerva Libra'], ['lng', 'Methane Princess'], ['tanker', 'MT Kriti Ruby']]
      .forEach(([c, n], i) => moored(g, c, n, 'allied', offset(anch, i * 72 + r() * 30, 1 + r() * 2.5), r() * 360));
    add(g, 'tanker', 'MT Suez Rajan', 'allied', offset(anch, 60, 3), 160, 10, go(160, 10));
    const bp = offset(g.own, 150 + r() * 60, 8 + r() * 2);
    const block = add(g, 'tanker', 'Arya Star', 'enemy', bp, brg(bp, canal), 11, go(brg(bp, canal), 11, 1e9));
    const [kn] = kilos(carry, 1);
    const kilo = add(g, 'kilo', kn, 'enemy', offset(block, block.hdg, 2), block.hdg, 11, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
    setGoal(g, { timeout: 'Arya Star is still afloat.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      shallow(gg, 200);
      if (block.alive && block.ai!.mode === 'transit') block.ai!.baseCourse = brg(block, canal);
      // The Kilo rides 2 nm ahead of her, clearing the way, until it hears something.
      const spot = offset(block.alive ? block : kilo, brg(block, canal), 2);
      keepCourse(kilo, brg(kilo, spot), dist(kilo, spot) > 0.5 ? 13 : 11);
      if (isSunk(block)) {
        if (dist(block, canal) < 4) end(gg, false, 'Arya Star sank in the canal approach. Her wreck blocks the channel.');
        else end(gg, true, 'Arya Star is on the bottom well short of the canal. The way home is open.');
      }
      if (arrive(gg, block, canal, 1)) end(gg, false, 'Arya Star scuttled herself in the canal. Suez is shut.');
    };
  },
};
extras.I10 = (g, b) => [{ text: 'Sink the blockship Arya Star', state: vs(g, 'tanker').some((v) => v.side === 'enemy' && isSunk(v)) ? 'done' : 'open', detail: 'The tanker under way northbound.' }, ...b, watch('Sink her more than 4 nm short of the canal', !!g.over?.reason.includes('approach') || !!g.over?.reason.includes('scuttled'), 'Port Tewfik is 22 nm north-northwest of where you started.'),
  watch('Don\'t sink a neutral ship', !!g.over?.reason.includes('our own weapon'))];

// ---- I24 Socotra ----------------------------------------------------------------------------
missions.I24 = {
  key: 'I24', title: 'Socotra', era: '2029', place: 'Off Socotra, Arabian Sea', date: 'September 2029, 0300', night: true,
  library: ['type901', 'kilo', 'fac', 'type054a', 'tanker'],
  brief: 'China has set up a forward supply base for Iran in a bay on Socotra\'s north coast, 14 nm north-northeast of you (bearing 030). The fleet oiler Chaganhu is anchored there with an Iranian Kilo alongside taking on fuel and torpedoes, and a fuel depot ashore keeps the oiler topped up. Take out the base: sink Chaganhu and the Kilo, and land three Tomahawks on the fuel depot. Her close-in guns shoot down about half the missiles fired at her. Once the shooting starts the Kilo will dive and come for you, and Chaganhu will run north: if she gets 25 nm from the bay she is gone. Two fast attack craft guard the bay. You have three hours.',
  build(g, r, carry) {
    g.startClock = clock(3);
    g.timeLimit = 3 * 3600;
    g.own.hdg = g.own.ordHdg = 30;
    const bay = offset(g.own, 30, 14);
    site(g, 'Hadibu fuel depot', offset(bay, 150, 3));
    const oiler = moored(g, 'type901', 'Chaganhu', 'enemy', bay, 300);
    const depot = 'Hadibu fuel depot';
    const [kn] = kilos(carry, 1);
    const kilo = add(g, 'kilo', kn, 'enemy', offset(bay, 210, 0.15), 300, 0, { mode: 'patrol', legT: 1e9, decoys: 2 }, 0);
    const guard = (['Joshan', 'Zoubin'] as const).map((n, i) => add(g, 'fac', n, 'enemy', offset(bay, 200 + i * 60, 3), 0, 8, go(0, 8, 1e9)));
    const away = offset(bay, 0, 25);
    setGoal(g, { timeout: 'The supply base is still working.' });
    g.script = (gg) => {
      lightweights(gg); noBlueHunt(gg);
      for (const f of guard) if (f.alive && f.ai!.mode === 'transit') f.ai!.baseCourse = norm(brg(bay, f) + 90 + (dist(bay, f) - 3) * 20);
      const loud = gg.stats.hits > 0 || Object.values(gg.stats.fired).some((n) => n > 0) || (kilo.ai?.mode ?? 'patrol') !== 'patrol';
      if (kilo.alive && !gg.flags.dived) {
        keepCourse(kilo, 300, 0);
        if (loud) { gg.flags.dived = 1; kilo.ordDepth = 1; kilo.ai!.legT = 300; log(gg, 'warn', 'Sonar: flooding noises near the oiler. The Kilo is casting off and diving!'); }
      }
      if (oiler.alive && loud && !gg.flags.run) { gg.flags.run = 1; Object.assign(oiler.ai!, { mode: 'transit', baseCourse: 0, cruise: 18, legT: 1e9 }); log(gg, 'warn', 'Chaganhu is weighing anchor and heading north.'); }
      if (arrive(gg, oiler, away, 3)) end(gg, false, 'Chaganhu got away to the north. The base will be back in business within a week.');
      pointDefence(gg, [oiler], 0.5);
      if (isSunk(oiler) && isSunk(kilo) && hits(gg, depot) >= 3) end(gg, true, 'Chaganhu and the Kilo are sunk and the fuel depot is burning. The forward base is finished.');
    };
  },
};
extras.I24 = (g, b) => {
  const oiler = vs(g, 'type901')[0];
  return [
    { text: 'Sink the oiler Chaganhu', state: oiler && isSunk(oiler) ? 'done' : oiler?.gone ? 'failed' : 'open', detail: flag(g, 'run') ? 'She is running north: 25 nm and she is gone.' : 'At anchor in the bay.' },
    { text: 'Sink the Kilo', state: vs(g, 'kilo').every(isSunk) ? 'done' : 'open', detail: flag(g, 'dived') ? 'Dived and hunting.' : 'Alongside the oiler, taking on fuel.' },
    { text: 'Three hits on the fuel depot', state: hits(g, 'Hadibu fuel depot') >= 3 ? 'done' : 'open', detail: `${Math.min(3, hits(g, 'Hadibu fuel depot'))} of 3.` },
    ...b,
  ];
};

