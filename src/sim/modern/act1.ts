// Modern war missions: act1. See the Modern Campaign Plan and src/sim/warData.ts for where each one sits in the war.
// Act 1, March to May 2029: the North Atlantic, the Arctic and Russia's Northern Fleet, then the Baltic and the Mediterranean.
import { brg, dist, fmtBrg, gauss, norm, offset, type Vec } from '../math';
import { atPeriscopeDepth, end, excess, log, vesselSL, type Game, type Vessel } from '../sim';
import { mineField, mineLine, mineZone, underIce } from '../hazards';
import {
  add, arrive, at, byId, clock, flag, go, held, ids, isSunk, keepCourse, mins, missileSalvo, pointDefence, screen, setGoal, watch,
  type Mission, type MissionKey, type Objective, type ObjectiveFn,
  adP,
  high,
  markAt,
} from '../kit';

// ---- Local helpers -----------------------------------------------------------------------------
/** An enemy boat on a scripted course: patrol mode with no random legs, so `keepCourse` steers it until it hears us. */
const boat = (g: Game, cls: string, name: string, p: Vec, hdg: number, spd: number, depth: 1 | 2 = 2) =>
  add(g, cls, name, 'enemy', p, hdg, spd, { mode: 'patrol', legT: 1e9, decoys: 2 }, depth);
/** A neutral: on the enemy side so torpedoes and missiles will take it, but it never fights. Sinking one is the mission's to judge. */
function neutral(g: Game, cls: string, name: string, p: Vec, hdg: number, spd: number, depth: 1 | 2 = 1) {
  const v = add(g, cls, name, 'enemy', p, hdg, spd, { ...go(hdg, spd, 1e9), snapTaken: true }, depth);
  return v;
}
/** Keep a neutral boat out of the fight: it dodges our torpedoes but never turns to attack. */
const stayNeutral = (v: Vessel) => { if (v.ai && v.ai.mode === 'attack') v.ai.mode = 'transit'; };
/** Sub-hunting ships on station or in transit listen with their hull sonar: one that hears Tang leaves the formation and attacks. */
function listen(g: Game, ships: Vessel[]) {
  if (g.t % 5) return;
  const o = g.own;
  for (const v of ships) {
    if (!v.alive || !v.ai || v.cls.threshold === null || (v.ai.mode !== 'station' && v.ai.mode !== 'transit')) continue;
    if (excess(vesselSL(o), o, v, v.cls.threshold) + gauss(g.r) * 2 <= 0) continue;
    const e = dist(o, v) * 0.12;
    v.ai.knows = { x: o.x + gauss(g.r) * e, y: o.y + gauss(g.r) * e, t: g.t, deep: o.depthT > 1.5 };
    v.ai.holdT = 60; v.ai.mode = 'attack';
    log(g, 'danger', `Sonar: ${v.name} has gone active and is turning toward us, bearing ${fmtBrg(brg(o, v))}. She has us on her hull sonar.`, 'alarm');
  }
}
/** A hunter that has been told roughly where Tang is. */
function cue(g: Game, v: Vessel, err: number) {
  if (!v.alive || !v.ai) return;
  const o = g.own;
  v.ai.knows = { x: o.x + gauss(g.r) * err, y: o.y + gauss(g.r) * err, t: g.t, deep: o.depthT > 1.5 };
  v.ai.mode = 'attack';
}
/** A quiet ASW ship hunting with active sonar: heard far off, with a rough strength, and it finds us inside `findR`. */
function activeSonar(g: Game, v: Vessel, findR: number, every = 120) {
  if (!v.alive || g.t % every !== 0) return;
  const d = dist(v, g.own);
  if (d > 18) return;
  log(g, 'info', `Sonar: active sonar intercept, bearing ${String(Math.round(brg(g.own, v))).padStart(3, '0')}, ${d < 5 ? 'loud: she is close' : d < 10 ? 'clear' : 'faint'}. ${v.name} is pinging.`);
  if (d < findR) cue(g, v, 0.3);
}
const site = (g: Game, name: string, p: Vec) => { const s = { id: -(g.sites.length + 1), name, x: p.x, y: p.y, hits: 0 }; g.sites.push(s); return s; };
const sunkOf = (vs: Vessel[]) => vs.filter(isSunk).length;
const ended = (g: Game, s: string) => !!g.over?.reason.includes(s);

/** Tang's own missiles fired since the last call, for scripts that react to launches. 'land' is land attack only: TLAM, or Mjolnir at a site. */
function newLaunches(g: Game, type: 'land' | 'any') {
  const out = [];
  for (const w of g.weapons) {
    if (w.side !== 'us' || g.flags[`seen${w.id}`] || (type === 'land' && w.type !== 'tlam' && !w.land)) continue;
    g.flags[`seen${w.id}`] = 1;
    out.push(w);
  }
  return out;
}

export const missions: Record<MissionKey, Mission> = {
  // ---- The northern flank ------------------------------------------------------------------------
  A8: {
    key: 'A8', title: 'Fjord War', era: '2029', place: 'Vestfjorden, Norway', date: 'April 2029, 0230', night: true,
    library: ['ropucha', 'ivangren', 'kilo', 'steregushchiy', 'ka27', 'nansen', 'virginia'],
    brief: 'A Russian landing force has come round Lofoten in the dark and is running up Vestfjorden for the beaches south of Bodø. Three Ropucha landing ships and the Ivan Gren-class Pyotr Morgunov are in a loose column about 15 nm northwest of you, making 12 knots for a beach about 14 nm to your east. A Kilo sweeps ahead of them and the corvette Stoikiy rides with the column, with a Ka-27 up. Sink two of the four landing ships. If three of them reach the beach, the landing has succeeded and the mission fails. The corvette has good sonar and will leave the column to come after you if she hears you. Russian jamming covers the fjord: the anti-ship Tomahawk can\'t get its in-flight updates, so it\'s NSM and torpedoes, and the ships\' guns shoot down a share of what comes at them.',
    build(g, r) {
      g.startClock = clock(2, 30);
      g.timeLimit = 3 * 3600;
      g.flags.jammed = 1;
      const beach = offset(g.own, 75 + r() * 20, 13 + r() * 2);
      markAt(g, beach, 'Landing beach', 1.5);
      const p0 = offset(g.own, 300 + r() * 30, 14 + r() * 2);
      const crs = brg(p0, beach);
      g.own.hdg = g.own.ordHdg = norm(crs + 180 + 40);
      const ships = ([['ropucha', 'Aleksandr Otrakovsky'], ['ropucha', 'Kondopoga'], ['ivangren', 'Pyotr Morgunov'], ['ropucha', 'Georgiy Pobedonosets']] as const)
        .map(([c, n], i) => add(g, c, n, 'enemy', offset(p0, crs + 180 + (i % 2 ? 15 : -15), i * 1.3), crs, 12, go(crs, 12, 600)));
      const corv = add(g, 'steregushchiy', 'Stoikiy', 'enemy', offset(ships[0], crs + 120, 2.5), crs, 12, { mode: 'station', leader: ships[0].id, rel: 120, rng: 2.5 });
      const kilo = boat(g, 'kilo', 'Kilo (Vladikavkaz)', offset(p0, crs + (r() * 2 - 1) * 25, 5 + r() * 2), crs, 6, 1);
      const helo = add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(ships[0], r() * 360, 4), 0, 120, { mode: 'search', center: { x: p0.x, y: p0.y }, wp: offset(p0, crs, 6), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: ids(ships), need: 2, win: 'Two landing ships are on the bottom of Vestfjorden. The rest have turned back for Lofoten.', timeout: 'The landing force is still in the fjord, regrouping for another run at the beach.' });
      g.flags.landed = 0;
      g.script = (gg) => {
        listen(gg, [corv]);
        pointDefence(gg, [corv, ...ships], 0.35);
        const lead = ships.find((s) => s.alive) ?? ships[0];
        helo.ai!.center = offset(lead, lead.hdg, 4);
        keepCourse(kilo, brg(kilo, offset(lead, brg(lead, beach), 6)), 7);
        for (const s of ships) {
          if (s.alive && s.ai!.mode === 'transit') s.ai!.baseCourse = brg(s, beach);
          if (arrive(gg, s, beach, 1.5)) { gg.flags.landed++; log(gg, 'danger', `${s.name} has reached the beach and is putting her troops ashore.`); }
        }
        if (gg.flags.landed >= 3) end(gg, false, 'Three landing ships reached the beach. Russian marines are ashore south of Bodø.');
      };
    },
  },

  A9: {
    key: 'A9', title: 'Svalbard', era: '2029', place: 'Off Svalbard', date: 'April 2029, 1100',
    library: ['kirov', 'gorshkov', 'udaloy', 'ka27', 'virginia'],
    brief: 'The battlecruiser Pyotr Velikiy and the frigates Admiral Kasatonov and Admiral Golovko are steaming west to cover a landing at Longyearbyen. They are about 30 nm east of you, making 18 knots for a fire support position off Isfjorden about 15 nm northwest of you. Sink Pyotr Velikiy, or hurt the group badly enough to turn it back: 8 points of damage on the Kirov (a Mk 48 does 5, a Tomahawk 3), or both frigates sunk. If the Kirov reaches the fire support position, the landing goes ahead and the mission fails. All three ships shoot down a share of incoming anti-ship missiles, and the frigates have strong sonar: if one hears you she will leave the screen and come for you. A Ka-27 flies from the Kirov.',
    build(g, r) {
      g.startClock = clock(11);
      g.timeLimit = 3 * 3600;
      const fsp = offset(g.own, 305 + r() * 25, 14 + r() * 3);
      markAt(g, fsp, 'Fire support position', 2);
      const p = offset(g.own, 70 + r() * 30, 28 + r() * 4);
      const crs = brg(p, fsp);
      g.own.hdg = g.own.ordHdg = norm(brg(g.own, p));
      const kirov = add(g, 'kirov', 'Pyotr Velikiy', 'enemy', p, crs, 18, go(crs, 18, 700));
      const frig = screen(g, kirov, 'gorshkov', ['Admiral Kasatonov', 'Admiral Golovko'], [[50, 3], [-50, 3]]);
      const helo = add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(kirov, crs, 5), crs, 120, { mode: 'search', center: offset(kirov, crs, 8), wp: offset(kirov, crs, 8), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: [kirov.id], need: 1, win: 'Pyotr Velikiy is sinking. The landing at Longyearbyen is off.', timeout: 'The Kirov group is still at sea and the landing is only delayed.' });
      g.script = (gg) => {
        listen(gg, frig);
        pointDefence(gg, [kirov], 0.85);
        pointDefence(gg, frig, 0.6);
        if (!kirov.alive) return;
        if (kirov.ai!.mode === 'transit') kirov.ai!.baseCourse = brg(kirov, fsp);
        helo.ai!.center = offset(kirov, kirov.hdg, 6);
        if (kirov.hp <= kirov.cls.hp - 8) end(gg, true, 'Pyotr Velikiy is badly hurt and turning back for Severomorsk. The landing at Longyearbyen is off.');
        if (frig.every(isSunk)) end(gg, true, 'Both frigates are sunk. Without a screen, Pyotr Velikiy has turned back for Severomorsk.');
        if (dist(kirov, fsp) < 2) end(gg, false, 'Pyotr Velikiy reached the fire support position. Her guns and missiles are covering the landing at Longyearbyen.');
      };
    },
  },

  A10: {
    key: 'A10', title: 'Keflavik', era: '2029', place: 'Off Iceland', date: 'April 2029, 1900',
    library: ['oscar', 'akula', 'tu142', 'tu22m3', 'p8a', 'virginia'],
    brief: 'Keflavik, about 35 nm southeast of you, is the hinge of the North Atlantic: the P-8s that hunt the Northern Fleet fly from there. An Oscar II, Voronezh, is coming down from the north to put a salvo of P-700 Granits into the base. It needs to reach a launch position about 20 nm north of you and sit there for a quarter of an hour to set up the shot. Sink it first. Backfire bombers will also try for the base with Kh-32s from about 50 nm out; radar at periscope depth sees them high up out to 100 nm and SM-6 can bring them down. If four missiles hit the base, it is out of action and the mission fails. A Tu-142 is over the area hunting for you.',
    build(g, r) {
      g.startClock = clock(19);
      g.timeLimit = 3 * 3600;
      const base = offset(g.own, 110 + r() * 20, 35);
      const launch = offset(g.own, 350 + r() * 30, 19 + r() * 3);
      markAt(g, base, 'Keflavik');
      markAt(g, launch, 'Oscar launch position', 2);
      const op = offset(launch, 345 + r() * 30, 18 + r() * 3);
      const oscar = add(g, 'oscar', 'Oscar II (Voronezh)', 'enemy', op, brg(op, launch), 10, { mode: 'raider', goal: launch, cruise: 10, decoys: 2 }, 1);
      add(g, 'tu142', 'Tu-142MK Bear-F', 'enemy', offset(g.own, r() * 360, 50), 0, 230, { mode: 'search', center: { x: g.own.x, y: g.own.y }, wp: { x: g.own.x, y: g.own.y }, buoyT: 0, torps: 2, datum: null });
      setGoal(g, { targets: [oscar.id], need: 1, win: 'Voronezh is on the bottom with her Granits still in their tubes. Keflavik is safe.', timeout: 'Voronezh is still out there and the base is still in danger.' });
      interface Backfire { v: Vessel; launch: Vec; done: boolean }
      const bombers: Backfire[] = [];
      const wave = (gg: Game, n: number) => {
        const from = norm(330 + gg.r() * 60);
        for (let i = 0; i < n; i++) {
          const lp = offset(base, from + (i - 0.5) * 8, 50), p = offset(base, from + (i - 0.5) * 8, 170);
          const v = add(gg, 'tu22m3', `Backfire ${bombers.length + 1}`, 'enemy', p, brg(p, lp), 540, { mode: 'strike', goal: lp, cruise: 540 });
          v.track = [];
          bombers.push({ v, launch: lp, done: false });
        }
        log(gg, 'warn', `Radio intercepts: ${n} Tu-22M3 Backfires inbound for Keflavik from bearing ${fmtBrg(brg(gg.own, offset(base, from, 170)))}. They launch from 50 nm short of the base. Radar at periscope depth sees them out to 100 nm.`);
      };
      g.flags.baseHits = 0; g.flags.salvoT = 0;
      g.script = (gg) => {
        at(gg, 35 * 60, 'wave1', () => wave(gg, 3));
        at(gg, 95 * 60, 'wave2', () => wave(gg, 4));
        for (const b of bombers) {
          if (b.done) continue;
          if (!b.v.gone) { if (!b.v.alive) b.done = true; continue; }
          b.done = true;
          log(gg, 'danger', `${b.v.name} has launched two Kh-32s at Keflavik.`, 'alarm');
          for (let k = 0; k < 2; k++) {
            if (gg.r() < 0.5) { gg.flags.baseHits++; log(gg, 'danger', `A Kh-32 got through the Patriots and hit Keflavik. ${gg.flags.baseHits} hits on the base.`, 'boom'); }
            else log(gg, 'info', 'The Patriot batteries at Keflavik shot down a Kh-32.');
          }
        }
        if (gg.flags.baseHits >= 4) return end(gg, false, 'Four missiles hit Keflavik. The runway and the P-8 hangars are wrecked.');
        if (!oscar.alive) return;
        if (dist(oscar, launch) < 2) gg.flags.salvoT++;
        if (gg.flags.salvoT === 300) log(gg, 'warn', 'Sonar: the Oscar has slowed and is coming shallow. It is setting up its shot on Keflavik!');
        if (gg.flags.salvoT >= 900) end(gg, false, 'Voronezh fired 24 P-700 Granits at Keflavik. The base is wrecked.');
      };
    },
  },

  A21: {
    key: 'A21', title: 'Finnmark', era: '2029', place: 'Off northern Norway', date: 'April 2029, 0400',
    library: ['steregushchiy', 'kilo', 'ka27', 'nansen', 'virginia'],
    brief: 'The Finns go over the border into Pechenga at H-hour, two and a half hours from now, and they need the Russian radars blind first. Put a Tomahawk into each of four sites: the Pechenga air-defence radar, the Zapolyarny early-warning radar, the coastal battery radar on the Rybachy Peninsula and the Titovka radar site. The S-400s around Pechenga will shoot down anything that comes from the wrong direction, so every TLAM must be launched from inside the launch box, a circle of 3 nm radius about 10 nm east of you. Two Steregushchiy corvettes, Retivy and Strogiy, are patrolling the box with their sonar. Every site hit by H-hour wins; one missed fails the mission.',
    build(g, r) {
      g.startClock = clock(4);
      g.timeLimit = 2.5 * 3600;
      const box = offset(g.own, 85 + r() * 20, 10);
      g.own.hdg = g.own.ordHdg = brg(g.own, box);
      g.flags.boxX = box.x * 1000; g.flags.boxY = box.y * 1000;
      markAt(g, box, 'Launch box', 3);
      const names = ['Pechenga air-defence radar', 'Zapolyarny early-warning radar', 'Rybachy coastal battery radar', 'Titovka radar site'];
      names.forEach((n, i) => site(g, n, offset(g.own, 120 + i * 9 + r() * 6, 45 + r() * 20)));
      const corvs = ['Retivy', 'Strogiy'].map((n, i) => add(g, 'steregushchiy', n, 'enemy', offset(box, i * 180 + r() * 90, 2 + r() * 2), r() * 360, 10, { mode: 'patrol', legT: 300 }));
      setGoal(g, { targets: [], need: 1, win: 'All four radar sites are burning. The Finns go in with the Russian radars blind.', timeout: 'H-hour came with a Russian radar still working. The Finnish push ran into a prepared defence.' });
      g.script = (gg) => {
        for (const v of corvs) if (v.alive && v.ai!.mode === 'patrol' && dist(v, box) > 5) { v.ordHdg = brg(v, box); v.ordSpd = 12; }
        pointDefence(gg, corvs, 0.4);
        const inside = dist(gg.own, box) <= 3;
        if (inside !== !!gg.flags.inBox) { gg.flags.inBox = inside ? 1 : 0; log(gg, 'info', inside ? 'Navigator: we are inside the launch box. Tomahawks will fly the planned route from here.' : 'Navigator: we have left the launch box.'); }
        for (const w of newLaunches(gg, 'land')) {
          // Mjolnir doesn't fly the route: the S-400s see it wherever it was launched from, but seldom stop it.
          if (dist(gg.own, box) <= 3 && w.type !== 'mjolnir') continue;
          if (w.type === 'mjolnir') { if (gg.r() < adP(w, 1)) { w.dead = true; log(gg, 'warn', `The S-400s over Pechenga caught ${w.label} in its terminal dive.`); } continue; }
          w.dead = true;
          log(gg, 'warn', `${w.label} flew into the S-400 umbrella over Pechenga and was shot down. Launch from inside the box.`);
        }
        if (gg.sites.every((s) => s.hits > 0)) end(gg, true, 'All four radar sites are burning. The Finns go in with the Russian radars blind.');
      };
    },
  },

  // ---- Into the Bastion (hub) ----------------------------------------------------------------------
  A11: {
    key: 'A11', title: 'Into the Bastion', era: '2029', place: 'Barents Sea', date: 'May 2029, 0100', night: true,
    library: ['borei', 'yasen', 'akula', 'udaloy', 'ka27', 'il38', 'virginia'],
    brief: 'The Bastion: the stretch of the Barents Sea where Russia hides its missile submarines, behind a wall of attack boats, ships and aircraft. No Western boat has been inside since the war began. Somewhere about 14 nm northeast of you, the Borei-A Knyaz Pozharsky is circling slowly with sixteen Bulava missiles aboard. Two Akulas patrol a barrier line about 6 nm out, each beating up and down its own half of it: listen for them and slip through the gap between them, slowly, the Udaloy Admiral Levchenko hunts closer in with her active sonar (quiet, but you will hear her pings from far off), and Kazan, your old rival, rides shotgun on the Borei. Get through the barrier, find the Borei and hold it on sonar inside 6 nm for 20 minutes to get its full signature and patrol box. Then get back out past the barrier, to within 8 nm of where you started. Do NOT sink the Borei: sinking a missile submarine is a strategic attack, and Moscow will answer it. Once you are inside, expect the Bastion to wake up.',
    build(g, r) {
      g.startClock = clock(1);
      g.timeLimit = 4.5 * 3600;
      const start = { x: g.own.x, y: g.own.y };
      const axis = 35 + r() * 20;
      g.own.hdg = g.own.ordHdg = axis;
      const bc = offset(start, axis + (r() * 2 - 1) * 15, 13 + r() * 2);
      const borei = boat(g, 'borei', 'Knyaz Pozharsky', offset(bc, r() * 360, 1.5), r() * 360, 5);
      // Each Akula beats up and down its own half of the barrier line. Where the halves meet there is a gap.
      const bar = offset(offset(start, axis, 6), axis + 90, (r() * 2 - 1) * 1.5);
      markAt(g, offset(start, axis, 6), 'Akula barrier line, about here');
      const home = markAt(g, start, 'Start');
      const ends = [-1, 1].map((sd) => [offset(bar, axis + sd * 90, 2.5), offset(bar, axis + sd * 90, 8)]);
      const akulas = ['Akula (Samara)', 'Akula (Volk)'].map((n, i) => boat(g, 'akula', n, offset(bar, axis + (i ? 90 : -90), 3 + r() * 4), axis + (i ? 90 : -90), 6, i ? 1 : 2));
      const kazan = boat(g, 'yasen', 'Kazan (K-561)', offset(borei, r() * 360, 3), r() * 360, 6);
      kazan.hp = 99; // Kazan is the rival: she can be hurt but not sunk here
      const udaloy = add(g, 'udaloy', 'Admiral Levchenko', 'enemy', offset(bc, brg(bc, start) + (r() * 2 - 1) * 40, 6), r() * 360, 10, { mode: 'patrol', legT: 600 });
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(udaloy, r() * 360, 3), 0, 120, { mode: 'search', center: { x: bc.x, y: bc.y }, wp: offset(bc, r() * 360, 5), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: [], protect: [borei.id], maxLosses: 0, lossText: 'We sank Knyaz Pozharsky. Moscow calls it a strike on its nuclear deterrent, and the war has just got much more dangerous.',
        win: 'We are back outside the Bastion with Knyaz Pozharsky\'s signature and patrol box. The fleet can find her again whenever it has to.', timeout: 'We ran out of time inside the Bastion.' });
      g.flags.trail = 0;
      g.script = (gg) => {
        // The barrier boats beat back and forth across the approach; the Borei circles its box with Kazan close by.
        akulas.forEach((a, i) => {
          if (!a.alive || a.ai!.mode !== 'patrol') return;
          const k = `ak${i}`, to = ends[i][flag(gg, k)];
          if (dist(a, to) < 0.5) gg.flags[k] = 1 - flag(gg, k);
          keepCourse(a, brg(a, to), 6);
        });
        keepCourse(borei, brg(borei, offset(bc, gg.t / 15, 2)), 5);
        keepCourse(kazan, brg(kazan, offset(borei, gg.t / 10, 3)), 7);
        if (udaloy.alive && udaloy.ai!.mode === 'patrol' && dist(udaloy, bc) > 9) { udaloy.ordHdg = brg(udaloy, bc); udaloy.ordSpd = 12; }
        activeSonar(gg, udaloy, 3);
        // The Bastion wakes: an Il-38 comes out from Severomorsk once we are past the barrier.
        if (dist(gg.own, start) > 9) at(gg, 0, 'woke', () => {
          add(gg, 'il38', 'Il-38N May', 'enemy', offset(bc, 120, 70), 300, 230, { mode: 'search', center: { x: bc.x, y: bc.y }, wp: { x: bc.x, y: bc.y }, buoyT: 0, torps: 2, datum: null });
          log(gg, 'warn', 'Radio intercepts: an Il-38N is scrambling from Severomorsk for the Borei\'s box. Something has told them to look. It will be overhead in about 15 minutes.');
        });
        // Kazan is the rival. Hurt her and she breaks off for home.
        if (kazan.alive && kazan.hp < 99 && !gg.flags.kazanHit) {
          gg.flags.kazanHit = 1;
          kazan.ai!.mode = 'raider'; kazan.ai!.goal = offset(bc, 110, 60); kazan.ai!.cruise = 18;
          log(gg, 'good', 'Sonar: Kazan is hit, flooding noises, but she is still under way, running east for Severomorsk. She will be back.');
        }
        if (gg.flags.kazanHit && kazan.ai!.goal) arrive(gg, kazan, kazan.ai!.goal, 4);
        if (!gg.flags.ready && borei.alive && held(gg, borei) && dist(gg.own, borei) < 6) gg.flags.trail++;
        if (gg.flags.trail >= 1200 && !gg.flags.ready) {
          gg.flags.ready = 1;
          log(gg, 'good', 'XO: We have twenty minutes on the Borei: her full signature and her patrol box. Now get us out of here, back past the barrier.');
          home.label = 'Get back within 8 nm'; home.r = 8;
          log(gg, 'danger', 'Sonar: Kazan has turned toward us and is coming up to speed. The Bastion knows we are here.', 'alarm');
          if (!gg.flags.kazanHit) cue(gg, kazan, 2);
        }
        if (gg.flags.ready && dist(gg.own, start) < 8) end(gg, true, gg.goal.win);
      };
    },
  },

  // ---- What the Bastion hides ------------------------------------------------------------------------
  A12: {
    key: 'A12', title: 'Kola Strike', era: '2029', place: 'Off the Kola coast', date: 'May 2029, 0300', night: true,
    library: ['udaloy', 'ka27', 'il38', 'akula', 'virginia'],
    brief: 'Tomahawk the submarine pens at Gadzhiyevo and Olenya Guba, then get out. The pens are about 120 nm southeast of you, about 15 minutes\' flight. Each pen needs two hits to bring the rock down on the boats inside, so land two on each. Every launch makes a noise the whole coast will hear: two Udaloys, Admiral Levchenko and Severomorsk, are hunting about 16 nm east of you with a Ka-27, and an Il-38 will come out once you have fired. Once all four hits are in, get 20 nm away from where you first launched. The mission fails if time runs out first.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 3 * 3600;
      site(g, 'Gadzhiyevo submarine pens', offset(g.own, 128 + r() * 6, 118 + r() * 6));
      site(g, 'Olenya Guba submarine pens', offset(g.own, 136 + r() * 6, 112 + r() * 6));
      const hunt = offset(g.own, 80 + r() * 30, 16);
      const dds = ['Admiral Levchenko', 'Severomorsk'].map((n, i) => add(g, 'udaloy', n, 'enemy', offset(hunt, i * 180 + r() * 60, 3), r() * 360, 12, { mode: 'patrol', legT: 500 }));
      const helo = add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(hunt, r() * 360, 2), 0, 120, { mode: 'search', center: hunt, wp: offset(hunt, r() * 360, 5), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: [], need: 1, win: 'Both pens hit hard, and we are clear of the coast. The Northern Fleet\'s boats are buried in their own shelters.', timeout: 'Time ran out before the strike was done and we were clear.' });
      g.script = (gg) => {
        pointDefence(gg, dds, 0.5);
        for (const v of dds) if (v.alive && v.ai!.mode === 'patrol' && dist(v, hunt) > 10) { v.ordHdg = brg(v, hunt); v.ordSpd = 14; }
        if (newLaunches(gg, 'land').length && !gg.flags.fired) {
          gg.flags.fired = 1; gg.flags.lx = gg.own.x * 1000; gg.flags.ly = gg.own.y * 1000;
          markAt(gg, gg.own, 'Launch point: get 20 nm clear', 20);
          log(gg, 'warn', 'Radio intercepts: the coast has seen our launch. The Udaloys are turning toward the launch point and an Il-38 is scrambling.');
          for (const v of dds) cue(gg, v, 2.5);
          helo.ai!.center = { x: gg.own.x, y: gg.own.y };
          add(gg, 'il38', 'Il-38N May', 'enemy', offset(gg.own, 130, 60), 310, 230, { mode: 'search', center: { x: gg.own.x, y: gg.own.y }, wp: { x: gg.own.x, y: gg.own.y }, buoyT: 0, torps: 1, datum: null });
        }
        const done = gg.sites.every((s) => s.hits >= 2);
        if (done) at(gg, 0, 'pensDone', () => log(gg, 'good', 'Battle damage: both pens have collapsed. Now get us out of here: 20 nm from the launch point.'));
        if (done && gg.flags.fired && dist(gg.own, { x: gg.flags.lx / 1000, y: gg.flags.ly / 1000 }) >= 20) end(gg, true, gg.goal.win);
      };
    },
  },

  A13: {
    key: 'A13', title: 'The Doomsday Sub', era: '2029', place: 'Barents to Norwegian Sea', date: 'May 2029, 0500',
    library: ['belgorod', 'akula', 'oscar', 'poseidon', 'virginia'],
    brief: 'Belgorod, the giant special-mission submarine, has sailed with Poseidon aboard: a nuclear-armed torpedo drone that can cross an ocean and wreck a coastline. She is coming southwest out of the Barents about 16 nm northeast of you, with the Akula Leopard as escort. Intelligence says she will launch at about 0640, in 100 minutes. Find her, trail her, and sink her before she launches. Belgorod is huge and loud but tough: expect to need two torpedo hits. The sonar will tell you when she starts her launch run.',
    build(g, r) {
      g.startClock = clock(5);
      g.timeLimit = 105 * 60;
      const p = offset(g.own, 15 + r() * 40, 15 + r() * 3);
      const crs = 215 + r() * 20;
      const bel = boat(g, 'belgorod', 'Belgorod (K-329)', p, crs, 11);
      const ak = boat(g, 'akula', 'Akula (Leopard)', offset(bel, crs + (r() < 0.5 ? 120 : -120), 4), crs, 11, 1);
      setGoal(g, { targets: [bel.id], need: 1, win: 'Belgorod is on the bottom with Poseidon still in her belly. The world will never know how close it came.', timeout: 'Belgorod launched Poseidon.' });
      g.script = (gg) => {
        if (!bel.alive) return;
        const prep = gg.t >= 85 * 60;
        keepCourse(bel, crs + Math.sin(gg.t / 900) * 25, prep ? 4 : 11);
        keepCourse(ak, brg(ak, offset(bel, crs + 150, 3)), 11);
        at(gg, 85 * 60, 'prep', () => { bel.ordDepth = 1; log(gg, 'danger', `Sonar: Belgorod has slowed right down and is coming up. Transients: she is flooding a tube. She is starting the launch run, bearing ${fmtBrg(brg(gg.own, bel))}!`, 'alarm'); });
        at(gg, 95 * 60, 'prep2', () => log(gg, 'danger', 'Sonar: tube doors opening on Belgorod. Minutes left!', 'alarm'));
        if (gg.t >= 100 * 60) {
          add(gg, 'poseidon', 'Poseidon', 'enemy', offset(bel, crs, 0.2), crs, 60, go(crs, 60, 1e9), 2);
          end(gg, false, 'Belgorod has launched Poseidon. It is running southwest at 60 knots, and nothing we have can catch it.');
        }
      };
    },
  },

  A22: {
    key: 'A22', title: 'Borei Trail', era: '2029', place: 'Barents Sea', date: 'May 2029, 0000', night: true,
    library: ['borei', 'yasen', 'akula', 'virginia'],
    brief: 'The Borei-A Knyaz Vladimir has left the Bastion on a deterrent patrol, and Fleet wants her watched every minute she is at sea. She is about 4 nm from you, heading roughly northeast: turn and settle in behind her. Trail her: build up 2 hours of contact held inside 12 nm, and don\'t let her hear you. If she counter-detects you, she goes to ground and the mission fails; if she gets more than 25 nm away, the trail is cold. Do not sink her. She weaves, changes speed often, and clears her baffles with a sharp turn every half hour or so. The Yasen-M Arkhangelsk is sweeping ahead of her and sometimes doubles back down her track: you may fight it if you have to, but a torpedo launch near the Borei may give you away.',
    build(g, r) {
      g.startClock = clock(0);
      g.timeLimit = 3.5 * 3600;
      const crs = 40 + r() * 40;
      const borei = boat(g, 'borei', 'Knyaz Vladimir', offset(g.own, crs + (r() * 2 - 1) * 15, 4 + r()), crs, 6);
      g.own.hdg = g.own.ordHdg = norm(crs + 120 + r() * 120); g.own.ordSpd = 5;
      const ph = r() * 6;
      const yasen = boat(g, 'yasen', 'Arkhangelsk (K-564)', offset(borei, crs + (r() * 2 - 1) * 30, 7), crs, 7);
      setGoal(g, { targets: [], protect: [borei.id], maxLosses: 0, lossText: 'We sank Knyaz Vladimir. Moscow calls it an attack on its deterrent.',
        win: 'Two hours of track on Knyaz Vladimir, and she never knew we were there. The P-8s will take over the watch.', timeout: 'Time ran out before we had two hours of track.' });
      g.flags.trail = 0;
      g.script = (gg) => {
        if (!borei.alive) return;
        // Her patrol: a slow weave, a baffle-clearing turn every half hour, and a run if a fight breaks out nearby.
        const t = gg.t % 1800, ivan = t > 1500 && t < 1700;
        if (t === 1500) log(gg, 'warn', 'Sonar: the Borei\'s bearing rate is changing fast. She is turning: clearing her baffles!');
        const run = gg.t - flag(gg, 'runT') < 1200 && flag(gg, 'runT') > 0;
        const fast = Math.sin(gg.t / 600 + ph) > 0.4;
        keepCourse(borei, ivan ? crs + 180 : crs + Math.sin(gg.t / 1500 + ph) * 70 + Math.sin(gg.t / 500) * 30, run ? 14 : ivan ? 8 : fast ? 9 : 5);
        // The Yasen sweeps ahead, and every 40 minutes doubles back down her track.
        const back = gg.t % 2400 > 1800;
        keepCourse(yasen, brg(yasen, offset(borei, borei.hdg + (back ? 180 : 0), back ? 6 : 7)), back ? 9 : 8);
        if (yasen.alive && yasen.ai!.mode === 'attack' && !gg.flags.runT) {
          gg.flags.runT = gg.t;
          log(gg, 'warn', 'Sonar: the Borei has heard the Yasen go to attack speed and is running. She is louder now, but so are we if we chase.');
        }
        if (borei.ai!.holdT > 30 || borei.ai!.mode === 'attack') return end(gg, false, 'Knyaz Vladimir heard us. She has gone deep and silent, and the trail is blown.');
        if (held(gg, borei) && dist(gg.own, borei) < 12) gg.flags.trail++;
        if (gg.flags.trail === 3600) log(gg, 'good', 'XO: One hour of track on the Borei. Halfway.');
        if (gg.flags.trail >= 7200) end(gg, true, gg.goal.win);
        if (dist(gg.own, borei) > 25) end(gg, false, 'Knyaz Vladimir is more than 25 nm away. The trail is cold.');
      };
    },
  },

  A23: {
    key: 'A23', title: 'Under the Ice', era: '2029', place: 'Arctic ice edge, north of Svalbard', date: 'May 2029, 0600',
    library: ['yasen', 'akula', 'arktika', 'virginia'],
    brief: 'The Yasen-M Ulyanovsk has slipped under the pack ice north of Svalbard. It is heading for open water, a polynya about 12 nm north of it, where it can come up and fire Kalibr cruise missiles at the airfields in northern Norway. If it spends ten minutes in that polynya, it fires and the mission fails. It is about 10 nm northeast of you. Under the ice you can\'t come above 200 feet, so no masts, radar, ASROC or missiles: torpedoes only, and the grinding ice makes everything harder to hear. Sink the Yasen, then come up to periscope depth in any polynya to report. The polynyas are marked on the plot.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 3 * 3600;
      g.env.ice = true;
      g.own.depthT = g.own.ordDepth = 2;
      const yp = offset(g.own, 35 + r() * 30, 9 + r() * 2);
      const target = offset(yp, 350 + r() * 30, 11 + r() * 2);
      g.env.polynyas = [
        { ...target, r: 1.2 },
        { ...offset(g.own, 200 + r() * 40, 3), r: 1 },
        { ...offset(g.own, 60 + r() * 30, 7), r: 0.8 },
        { ...offset(yp, 250 + r() * 40, 8), r: 1 },
        { ...offset(yp, 90 + r() * 40, 6), r: 0.9 },
      ];
      const yasen = boat(g, 'yasen', 'Ulyanovsk (K-574)', yp, brg(yp, target), 8);
      setGoal(g, { targets: [yasen.id], need: 1, win: 'The Yasen is sunk and we are up in open water. The report is out.', timeout: 'We are still under the pack.' });
      g.flags.inPol = 0;
      g.script = (gg) => {
        if (yasen.alive) {
          keepCourse(yasen, brg(yasen, target), dist(yasen, target) > 2 ? 6 : 3);
          if (dist(yasen, target) < 1.2) {
            if (!gg.flags.inPol) log(gg, 'danger', 'Sonar: the Yasen has reached open water and is coming shallow. It is setting up to fire!', 'alarm');
            gg.flags.inPol++;
          }
          if (gg.flags.inPol >= 600) end(gg, false, 'Ulyanovsk came up in the polynya and fired its Kalibrs at Bodø and Evenes.');
        } else {
          at(gg, 0, 'sunk', () => log(gg, 'good', 'Breaking-up noises under the ice. Now find open water and come up to report.'));
          if (atPeriscopeDepth(gg) && !underIce(gg)) end(gg, true, gg.goal.win);
        }
      };
    },
  },

  // ---- Holding the line, the undersea war -----------------------------------------------------------
  A18: {
    key: 'A18', title: 'Faroe Shelf', era: '2029', place: 'Faroe-Shetland Channel', date: 'April 2029, 0700',
    library: ['akula', 'kilo', 'qnlz', 'type26', 'virginia'],
    brief: 'HMS Prince of Wales took a torpedo north of the Faroes and is limping home to Rosyth at 8 knots, with HMS Glasgow as escort. Her way south runs through a lane that the Russians have just mined: it starts 3 nm south of you and runs 12 nm due south. Go ahead of her and find the mines. Your HF sonar picks them out about a mile ahead at 10 knots or less; an active ping shows every mine within 3 nm, but every submarine around will hear it. Each mine you find in the lane is marked, and the carrier\'s mine-clearance drones destroy it two minutes later. She only moves while you are at least a mile and a half ahead of her down the lane. An Akula is laying more mines in the lane: it would rather run than fight, but sinking it stops the mining. A Kilo waits near the southern end. Two mine hits will sink the carrier. Get her through the lane.',
    build(g, r) {
      g.startClock = clock(7);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 180;
      const exitY = -16;
      markAt(g, { x: 0, y: -3 }, 'Mine lane starts');
      markAt(g, { x: 0, y: exitY }, 'End of the mine lane');
      mineLine(g, { x: 0, y: -4 }, { x: 0, y: -14 }, 9, 'enemy', 0.12);
      mineField(g, { x: 0, y: -9 }, 4, 16);
      g.mines = g.mines.filter((m) => Math.abs(m.x) > 0.3 || m.y < -3.5); // nothing on Tang's doorstep
      const cv = add(g, 'qnlz', 'HMS Prince of Wales', 'allied', { x: 0, y: 2 }, 180, 0);
      cv.hp = 6; // already torpedoed once
      screen(g, cv, 'type26', ['HMS Glasgow'], [[180, 1.2]]);
      const ak = boat(g, 'akula', 'Akula (Tigr)', { x: (r() < 0.5 ? -1 : 1) * (8 + r() * 3), y: -6 - r() * 4 }, 90, 6, 1);
      ak.ai!.snapTaken = true; // a minelayer on a job: it runs from a fight rather than shooting back
      const kilo = boat(g, 'kilo', 'Kilo (Vologda)', { x: (r() * 2 - 1) * 4, y: exitY - 2 - r() * 3 }, r() * 360, 3, 1);
      setGoal(g, { targets: [], protect: [cv.id], maxLosses: 0, lossText: 'HMS Prince of Wales hit a second mine and is going down in the channel.',
        win: 'HMS Prince of Wales is through the lane and into open water, making for Rosyth.', timeout: 'The carrier is still stuck north of the minefield.' });
      g.flags.layT = 0;
      g.script = (gg) => {
        // The Kilo lies in ambush at the far end: it shoots only at what comes close.
        if (kilo.alive && dist(kilo, gg.own) > 4) kilo.ai!.cool = Math.max(kilo.ai!.cool, 60);
        // She fires a torpedo at a time and takes her time reloading.
        if (kilo.alive) { if (kilo.ai!.cool > flag(gg, 'kc') + 1) kilo.ai!.cool = Math.max(kilo.ai!.cool, 480); gg.flags.kc = kilo.ai!.cool; }
        if (kilo.alive && kilo.ai!.mode === 'patrol' && dist(kilo, { x: 0, y: exitY - 3 }) > 4) { kilo.ordHdg = brg(kilo, { x: 0, y: exitY - 3 }); kilo.ordSpd = 4; }
        // The carrier comes on down the lane only while Tang is well ahead of her and near the lane.
        const ahead = cv.y - gg.own.y >= 1.5 && Math.abs(gg.own.x) < 2;
        cv.ordHdg = brg(cv, { x: 0, y: cv.y - 2 }); cv.ordSpd = ahead && cv.alive ? 8 : 0;
        if (cv.alive && cv.y <= exitY) end(gg, true, gg.goal.win);
        // Marked mines in the lane go two minutes after they are found.
        for (const m of [...gg.mines]) {
          if (m.side === 'us' || !m.found || Math.abs(m.x) > 1) continue;
          const k = `mf${m.id}`;
          if (!gg.flags[k]) gg.flags[k] = gg.t;
          if (gg.t - gg.flags[k] >= 120) {
            gg.mines = gg.mines.filter((x) => x !== m);
            gg.flags.cleared = flag(gg, 'cleared') + 1;
            log(gg, 'good', `A mine-clearance drone from Prince of Wales has destroyed the mine we marked. ${gg.flags.cleared} cleared.`);
          }
        }
        // The Akula lays more mines in the lane ahead of the carrier while it lives.
        if (ak.alive) {
          if (dist(ak, gg.own) > 3) { ak.ai!.cool = Math.max(ak.ai!.cool, 60); if (ak.ai!.mode === 'attack') ak.ai!.mode = 'patrol'; }
          const spot = { x: 0, y: Math.max(exitY + 1, cv.y - 5) };
          keepCourse(ak, brg(ak, spot), 7);
          if (dist(ak, spot) < 1 && gg.t - gg.flags.layT > 1500 && spot.y > exitY + 1.5) {
            gg.flags.layT = gg.t;
            mineLine(gg, { x: 0, y: spot.y + 0.8 }, { x: 0, y: spot.y - 0.8 }, 3, 'enemy', 0.1);
            log(gg, 'warn', `Sonar: a string of splashes and clanks, bearing ${fmtBrg(brg(gg.own, ak))}. The Akula is laying fresh mines in the lane.`);
          }
        }
      };
    },
  },

  A20: {
    key: 'A20', title: 'Spoofed', era: '2029', place: 'Norwegian Trench', date: 'April 2029, 2200', night: true,
    library: ['kilo', 'akula', 'nansen', 'virginia'],
    brief: 'GPS is being spoofed across the Norwegian Trench, the satellite links are jammed, and the Russians have mined both flanks of the trench where it cuts through the shallows off Egersund. The deep-water channel down the axis of the trench is clear, but it winds, and the old charts only roughly agree with it: about 5 nm on 200, then about 5 nm on 160, then about 5 nm on 210. Navigate by the bottom: the fathometer reports every two and a half minutes, and the bottom shoals on whichever side you are drifting toward. Stray more than about half a mile off the axis and you are among the mines. Your HF sonar finds mines about a mile ahead at 10 knots or less; a ping shows every one within 3 nm, but a Kilo is waiting near the far end and will hear it. Reach the end of the channel. Two mine hits will sink Tang.',
    build(g, r) {
      g.startClock = clock(22);
      g.timeLimit = 3.5 * 3600;
      g.flags.jammed = 1;
      const legs = [200 + (r() * 2 - 1) * 8, 160 + (r() * 2 - 1) * 8, 210 + (r() * 2 - 1) * 8];
      const pts: Vec[] = [{ x: g.own.x, y: g.own.y }];
      for (const c of legs) pts.push(offset(pts[pts.length - 1], c, 4.5 + r()));
      g.own.hdg = g.own.ordHdg = legs[0]; g.own.ordSpd = 6;
      // Mines on both flanks of each leg, but none in the channel itself.
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
        const a = pts[i], b = pts[i + 1], off = (k: number) => offset(a, legs[i] + 90 * s, k), endP = (k: number) => offset(b, legs[i] + 90 * s, k);
        mineLine(g, off(0.75), endP(0.75), 10, 'enemy', 0.2);
        mineLine(g, off(1.4), endP(1.4), 6, 'enemy', 0.3);
      }
      g.mines = g.mines.filter((m) => xtrack(pts, m).d > 0.5 && dist(m, pts[0]) > 0.8);
      const kilo = boat(g, 'kilo', 'Kilo (Vologda)', offset(offset(pts[2], legs[2], 2 + r() * 2), legs[2] + (r() < 0.5 ? 90 : -90), 2 + r()), r() * 360, 3, 1);
      void kilo;
      g.flags.ex = pts[3].x * 1000; g.flags.ey = pts[3].y * 1000;
      markAt(g, pts[3], 'End of the channel', 1);
      setGoal(g, { targets: [], need: 1, win: 'We are through the trench and into deep water, with the field behind us.', timeout: 'We are still inside the minefield.' });
      g.script = (gg) => {
        const xt = xtrack(pts, gg.own);
        if (gg.t % 150 === 0) {
          const fath = Math.round(180 - Math.min(2, xt.d) * 45 + gauss(gg.r) * 3);
          const tilt = xt.d < 0.25 ? 'Steady bottom: we are on the channel axis.'
            : `Shoaling to ${xt.left ? 'the east' : 'the west'}${xt.d > 0.45 ? ', fast' : ''}: the axis lies to the ${xt.left ? 'west' : 'east'}${xt.d > 0.45 ? '. We are among the mines' : ''}.`;
          log(gg, xt.d > 0.45 ? 'warn' : 'info', `Fathometer: ${fath} fathoms. ${tilt}`);
        }
        if (xt.seg > flag(gg, 'seg') && xt.seg < 3) {
          gg.flags.seg = xt.seg;
          log(gg, 'info', `Fathometer: the deep water is bending away. The trench axis now runs about ${String(Math.round(legs[xt.seg] / 5) * 5).padStart(3, '0')}.`);
        }
        if (dist(gg.own, pts[3]) < 1) end(gg, true, gg.goal.win);
      };
    },
  },

  // ---- The southern flank ------------------------------------------------------------------------
  A14: {
    key: 'A14', title: 'Baltic Gate', era: '2029', place: 'Off Gotland', date: 'May 2029, 0900',
    library: ['kilo', 'steregushchiy', 'boxship', 'type26', 'ka27', 'virginia'],
    brief: 'A convoy of four ro-ro ships is running north past Gotland with armour and ammunition for Finland and the Baltic states, escorted by HMS Cardiff. Tang is 4 nm ahead of it. Lose no more than one ship in the next 2 hours 30 minutes. The corvettes Soobrazitelny and Boikiy are coming out from the southeast: if one spends 8 minutes inside 20 nm of the convoy, she fires a salvo of Kalibrs at it. Radar at periscope depth sees ships out to 25 nm. The Kilo Dmitrov is lying in wait somewhere ahead. The Russians mined the route overnight, about 11 nm north of you: ping ahead of the convoy to find the mines, and Cardiff will steer the convoy round any you have marked.',
    build(g, r) {
      g.startClock = clock(9);
      g.timeLimit = 2.5 * 3600;
      const crs = 15 + r() * 10;
      g.own.hdg = g.own.ordHdg = crs; g.own.ordSpd = 11;
      const lead = add(g, 'type26', 'HMS Cardiff', 'allied', offset(g.own, crs + 180, 4), crs, 11, go(crs, 11, 1e9));
      const ships = screen(g, lead, 'boxship', ['MS Finnmaid', 'MS Finnswan', 'MV Baltic Bright', 'MV Hansa Carrier'], [[160, 1.5], [200, 1.5], [170, 3], [190, 3]]);
      // Last night's mines across the route.
      const mid = offset(lead, crs, 15 + r() * 3);
      markAt(g, mid, 'Mines reported across the route', 1.5);
      mineLine(g, offset(mid, crs + 90, 1.5), offset(mid, crs - 90, 1.5), 6, 'enemy', 0.25);
      const ep = offset(lead, 105 + r() * 30, 38);
      const corvs = ['Soobrazitelny', 'Boikiy'].map((n, i) => add(g, 'steregushchiy', n, 'enemy', offset(ep, 90 * i, 3), brg(ep, lead), 20, go(brg(ep, lead), 20, 1e9)));
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(ep, 0, 2), 0, 120, { mode: 'search', center: offset(lead, crs, 12), wp: offset(lead, crs, 12), torps: 1, datum: null, hits: 0, dipT: 0 });
      const kilo = add(g, 'kilo', 'Kilo (Dmitrov)', 'enemy', offset(lead, crs + (r() * 2 - 1) * 25, 14 + r() * 4), norm(crs + 180), 3, { mode: 'raider', cruise: 6, decoys: 2, torps: 4 }, 1);
      void kilo;
      setGoal(g, { targets: [], protect: ids(ships), maxLosses: 1, surviveWin: true,
        win: 'The convoy is under the Finnish air umbrella. The Baltic stays open.', lossText: 'Two ships of the convoy are gone. The Baltic is closing.', timeout: '' });
      g.script = (gg) => {
        for (const v of corvs) {
          if (!v.alive) continue;
          if (v.ai!.mode === 'transit') { v.ai!.baseCourse = brg(v, lead); v.ai!.cruise = dist(v, lead) < 18 ? 8 : 20; }
          if (dist(v, lead) < 20) gg.flags[`fc${v.id}`] = flag(gg, `fc${v.id}`) + 1;
          if (gg.flags[`fc${v.id}`] === 480) missileSalvo(gg, v.name, 'Kalibr', 4, ships, 0.4, 3);
        }
        pointDefence(gg, corvs, 0.4);
        // Cardiff steers the convoy round any mine we have marked.
        for (const m of [...gg.mines]) {
          if (!m.found || m.side === 'us') continue;
          if ([lead, ...ships].some((s) => s.alive && dist(s, m) < 0.4)) {
            gg.mines = gg.mines.filter((x) => x !== m);
            log(gg, 'good', 'Cardiff has the marked mine on her sonar. The convoy is edging round it.');
          }
        }
      };
    },
  },

  A15: {
    key: 'A15', title: 'Bosphorus', era: '2029', place: 'Aegean Sea', date: 'May 2029, 2300', night: true,
    library: ['kilo', 'reis', 'type209', 'virginia'],
    brief: 'Turkey is wavering. Two Black Sea Fleet Kilos, Krasnodar and Kolpino, came through the Bosphorus on the surface under the Montreux rules and dived as soon as they reached the Aegean. They are about 15 nm north of you, running south at 10 knots for the Mediterranean. Sink both before either gets 14 nm south of where you are now. Kilos are very quiet, but they have to snorkel, and a Hellenic Navy P-3 overhead will pass on any snorkel it catches on radar. The Turkish submarine TCG Hızırreis is shadowing them, and Ankara is watching what we do: she is neutral, so identify every contact before you shoot. Sinking her fails the mission and may bring Turkey in against us.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 4 * 3600;
      const exit = offset(g.own, 180 + (r() * 2 - 1) * 15, 14);
      markAt(g, exit, 'Their way out: stop them before here', 2);
      const kilos = ['Kilo (Krasnodar)', 'Kilo (Kolpino)'].map((n, i) => {
        const p = offset(g.own, (i ? 15 : -15) + (r() * 2 - 1) * 15, 14 + r() * 4);
        const k = boat(g, 'kilo', n, p, brg(p, exit), 10, r() < 0.5 ? 2 : 1);
        k.ai!.snapTaken = true; // they run from a torpedo rather than shoot back down its bearing
        return k;
      });
      const tk = kilos[Math.floor(r() * 2)];
      const reis = neutral(g, 'reis', 'TCG Hızırreis', offset(tk, norm(tk.hdg + 180 + (r() * 2 - 1) * 40), 2.5 + r()), tk.hdg, 10, 1);
      setGoal(g, { targets: ids(kilos), need: 2, protect: [reis.id], maxLosses: 0, lossText: 'We sank TCG Hızırreis, a neutral Turkish submarine. Ankara has closed the straits to us.',
        win: 'Both Kilos are on the bottom of the Aegean. Ankara noticed who kept the peace in its waters.', timeout: 'The Kilos are still loose in the Aegean.' });
      g.flags.through = 0;
      g.script = (gg) => {
        stayNeutral(reis);
        // A Hellenic Navy P-3 catches a snorkelling Kilo on radar every 15 minutes or so.
        if (gg.t % 900 === 450) {
          const k = kilos.filter((x) => x.alive)[Math.floor(gg.t / 900) % 2] ?? kilos.find((x) => x.alive);
          if (k) { const p = offset(k, gg.r() * 360, gg.r() * 1.5); log(gg, 'contact', `Hellenic Navy P-3: snorkel radar contact bearing ${fmtBrg(brg(gg.own, p))}, ${dist(gg.own, p).toFixed(0)} nm from you. It dived as we came over.`); }
        }
        for (const k of kilos) {
          // They are running for the Med, not looking for a fight: they turn on us only when we are close, and run after a shot.
          if (k.alive && k.ai!.mode === 'attack' && (dist(k, gg.own) > 3 || k.ai!.cool > 0)) k.ai!.mode = 'patrol';
          keepCourse(k, brg(k, exit), 10);
          if (arrive(gg, k, exit, 2)) { gg.flags.through++; log(gg, 'danger', `${k.name} is past us and into the Mediterranean.`); }
        }
        if (gg.flags.through) end(gg, false, 'A Kilo got through to the Mediterranean.');
        if (reis.alive && reis.ai!.mode === 'transit') reis.ordHdg = brg(reis, offset(tk.alive ? tk : exit, tk.hdg + 180, tk.alive ? 2.5 : 0));
      };
    },
  },

  A16: {
    key: 'A16', title: 'Zircon', era: '2029', place: 'Eastern Mediterranean', date: 'May 2029, 1400',
    library: ['gorshkov', 'kilo', 'ka27', 'ford', 'arleigh', 'virginia'],
    brief: 'The Ford strike group is south of Cyprus, and two Admiral Gorshkov frigates out of Tartus, Admiral Isakov and Admiral Amelko, are racing for it with Zircon hypersonic missiles. Nothing in the strike group can stop a Zircon salvo. The carrier is about 14 nm west-southwest of you; the frigates are about 38 nm northeast of you at 18 knots. If either frigate spends 6 minutes inside 30 nm of the Ford, she fires and the Ford is out of the war. Sink both frigates first. Their Poliment-Redut air defence shoots down most anti-ship missiles, and they have a Ka-27 up. USS Gerald R. Ford and USS Mahan are friendly: check every target.',
    build(g, r) {
      g.startClock = clock(14);
      g.timeLimit = 3 * 3600;
      const ford = add(g, 'ford', 'USS Gerald R. Ford', 'allied', offset(g.own, 240 + r() * 20, 14), 270, 6, go(270, 6, 1e9));
      screen(g, ford, 'arleigh', ['USS Mahan'], [[90, 2]]);
      const p = offset(g.own, 40 + r() * 30, 36 + r() * 4);
      const frig = ['Admiral Isakov', 'Admiral Amelko'].map((n, i) => add(g, 'gorshkov', n, 'enemy', offset(p, 90 * i + r() * 30, 2.5 * i), brg(p, ford), 18, go(brg(p, ford), 18, 600)));
      const helo = add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(p, brg(p, ford), 6), 0, 120, { mode: 'search', center: offset(p, brg(p, ford), 10), wp: offset(p, brg(p, ford), 10), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: ids(frig), need: 2, protect: [ford.id], maxLosses: 0, lossText: 'The Ford has been sunk.',
        win: 'Both Zircon frigates are on the bottom. The Ford strike group is safe.', timeout: 'The frigates are still out there, and the Ford has to run.' });
      g.script = (gg) => {
        pointDefence(gg, frig, 0.85);
        const lead = frig.find((f) => f.alive);
        if (lead) helo.ai!.center = offset(lead, lead.hdg, 5);
        for (const f of frig) {
          if (!f.alive) continue;
          if (f.ai!.mode === 'transit') f.ai!.baseCourse = brg(f, ford);
          if (dist(f, ford) < 30) gg.flags[`fc${f.id}`] = flag(gg, `fc${f.id}`) + 1;
          if (flag(gg, `fc${f.id}`) === 120) log(gg, 'danger', `Radio intercepts: ${f.name} is inside 30 nm of the Ford and her fire-control radar is up. She is setting up a Zircon shot!`, 'alarm');
          if (flag(gg, `fc${f.id}`) >= 360) return end(gg, false, `${f.name} fired eight Zircons at the Ford. Three got through: the carrier is burning and out of the war.`);
        }
      };
    },
  },

  A24: {
    key: 'A24', title: 'Kaliningrad', era: '2029', place: 'Gulf of Danzig', date: 'May 2029, 0100', night: true,
    library: ['kilo', 'steregushchiy', 'ka27', 'virginia'],
    brief: 'Bottle up the Baltic Fleet in Baltiysk. Tang has 8 mines aboard: lay at least 6 of them in the approach channel, inside 1.5 nm of the marked point 2 nm off the harbour mouth, which is about 16 nm east-southeast of you. Slow to 12 knots or less and use the Lay mine button. Then get at least 14 nm clear of the harbour mouth. The Russians have their own defensive minefields north and south of the approach, the Kilo Dmitrov patrols the entrance, a Ka-27 is dipping its sonar over the approach, and the corvette Soobrazitelny sweeps the approach. She is very quiet, but she searches with active sonar: you will hear her pings, their bearing and roughly how close she is, from a long way off. Close in, those pings will find you whatever depth you are at. Coastal radars cover the bay: stay at periscope depth inside 14 nm of the coast for more than a minute and they will see your masts and call the hunters onto you. Part of the fleet will sortie in about two hours, and any mines you have laid by then will be waiting for it.',
    build(g, r) {
      g.startClock = clock(1);
      g.timeLimit = 3.5 * 3600;
      g.flags.minesAboard = 8;
      const mouth = offset(g.own, 105 + r() * 10, 16);
      const app = brg(mouth, g.own);
      const box = offset(mouth, app, 2);
      g.own.hdg = g.own.ordHdg = brg(g.own, box);
      g.flags.bx = box.x * 1000; g.flags.by = box.y * 1000; g.flags.mx = mouth.x * 1000; g.flags.my = mouth.y * 1000;
      mineField(g, offset(mouth, app - 40, 6), 2.3, 14);
      mineField(g, offset(mouth, app + 40, 6), 2.3, 14);
      mineField(g, offset(mouth, app + (r() * 2 - 1) * 5, 7.5), 1.2, 3);
      const kilo = boat(g, 'kilo', 'Kilo (Dmitrov)', offset(mouth, app + (r() * 2 - 1) * 30, 3), r() * 360, 3, 1);
      kilo.ai!.legT = 400;
      const corv = add(g, 'steregushchiy', 'Soobrazitelny', 'enemy', offset(mouth, app + (r() * 2 - 1) * 20, 8), r() * 360, 8, { mode: 'patrol', legT: 400 });
      // Neither answers a launch transient blind: they have to find us first.
      corv.ai!.snapTaken = true; kilo.ai!.snapTaken = true;
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(mouth, app, 1), app, 120, { mode: 'search', center: box, wp: offset(box, app, 4), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: [], need: 1, win: 'The approach to Baltiysk is mined and we are clear. The Baltic Fleet is bottled up in port.', timeout: 'Time is up and the approach is still open.' });
      g.flags.seenT = 0;
      const zone = mineZone(g, box, 1.5, 'Mining point', 6);
      g.script = (gg) => {
        if (corv.alive && corv.ai!.mode === 'patrol' && dist(corv, box) > 8) { corv.ordHdg = brg(corv, box); corv.ordSpd = 10; }
        if (kilo.alive && kilo.ai!.mode === 'patrol' && dist(kilo, mouth) > 5) { kilo.ordHdg = brg(kilo, mouth); }
        // The corvette hunts with active sonar: easy to hear, and it finds us inside about 2.5 nm.
        activeSonar(gg, corv, 3.5);
        if (atPeriscopeDepth(gg) && dist(gg.own, mouth) < 14) gg.flags.seenT++;
        if (gg.flags.seenT === 60) {
          log(gg, 'danger', 'ESM: coastal surveillance radar has locked on to our masts. The hunters are being called onto us!', 'alarm');
          cue(gg, kilo, 1); cue(gg, corv, 1);
        }
        at(gg, 120 * 60, 'sortie', () => {
          ['Boikiy', 'Stoikiy'].forEach((n, i) => add(gg, 'steregushchiy', n, 'enemy', offset(mouth, app, 0.3 + i * 0.6), app, 14, go(app, 14, 1e9)));
          log(gg, 'warn', 'Sonar: heavy screws from the harbour mouth. Two corvettes are coming out down the approach channel.');
        });
        const atBox = dist(gg.own, box) <= 1.5;
        if (atBox !== !!gg.flags.atBox) { gg.flags.atBox = atBox ? 1 : 0; log(gg, 'info', atBox ? 'Navigator: we are on the mining point. Mines laid here will count.' : 'Navigator: we are off the mining point.'); }
        // A mine that has already sunk a ship still counts as laid.
        for (const m of gg.mines) if (m.side === 'us' && dist(m, box) <= 1.5 && !gg.flags[`mb${m.id}`]) { gg.flags[`mb${m.id}`] = 1; gg.flags.laid = flag(gg, 'laid') + 1; }
        const laid = zone(flag(gg, 'laid'));
        if (laid >= 6 && dist(gg.own, mouth) >= 14) end(gg, true, gg.goal.win);
      };
    },
  },

  A25: {
    key: 'A25', title: 'Tartus', era: '2029', place: 'Off Syria', date: 'May 2029, 1600',
    library: ['ropucha', 'ivangren', 'kilo', 'tanker', 'lng', 'ka27', 'virginia'],
    brief: 'Tartus is Russia\'s only naval base in the Mediterranean, and it lives on supply ships run in from the Black Sea and the Baltic. Three are coming in now: the landing ships Korolev and Aleksandr Shabalin and the Ivan Gren-class Pyotr Morgunov, about 18 nm west of you, making 14 knots for Tartus, which is about 16 nm east of you. The Kilo Stary Oskol is out ahead of them and a Ka-27 is up from Tartus. The jammers at Hmeimim cover the coast, so the anti-ship Tomahawk can\'t get its in-flight updates: NSM and torpedoes. The Pantsir and S-400 batteries round Tartus shoot down most missiles inside 12 nm of the port. Sink two of the three. If two of them reach Tartus, the mission fails. These are busy waters: the Liberian tanker MT Aegean Star and the gas carrier LNG Cyprus Spirit are crossing the area, and sinking either fails the mission. Identify before you shoot.',
    build(g, r) {
      g.startClock = clock(16);
      g.timeLimit = 3 * 3600;
      const tartus = offset(g.own, 90 + r() * 10, 16);
      markAt(g, tartus, 'Tartus: air defences 12 nm', 12);
      const p0 = offset(g.own, 270 + (r() * 2 - 1) * 15, 17 + r() * 3);
      const crs = brg(p0, tartus);
      const ships = ([['ropucha', 'Korolev'], ['ivangren', 'Pyotr Morgunov'], ['ropucha', 'Aleksandr Shabalin']] as const)
        .map(([c, n], i) => add(g, c, n, 'enemy', offset(p0, crs + 180, i * 1.5), crs, 14, go(crs, 14, 700)));
      const kilo = boat(g, 'kilo', 'Kilo (Stary Oskol)', offset(p0, crs + (r() * 2 - 1) * 20, 8), crs, 5, 1);
      g.flags.jammed = 1;
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(tartus, 270, 2), 270, 120, { mode: 'search', center: { x: g.own.x, y: g.own.y }, wp: offset(g.own, r() * 360, 4), torps: 1, datum: null, hits: 0, dipT: 0 });
      const neutrals = [
        neutral(g, 'tanker', 'MT Aegean Star', offset(g.own, 190 + r() * 30, 12), 10, 12),
        neutral(g, 'lng', 'LNG Cyprus Spirit', offset(g.own, 340 + r() * 30, 12), 190, 13),
      ];
      setGoal(g, { targets: ids(ships), need: 2, protect: ids(neutrals), maxLosses: 0, lossText: 'We sank a neutral merchant ship. The world\'s press has a new story, and it is about us.',
        win: 'Two supply ships are on the bottom off Tartus. The base is going hungry.', timeout: 'The supply run is still under way.' });
      g.flags.in = 0;
      g.script = (gg) => {
        keepCourse(kilo, brg(kilo, offset(ships.find((s) => s.alive) ?? tartus, crs, 6)), 6);
        pointDefence(gg, ships, 0.3);
        // The Pantsir and S-400 batteries round Tartus cover the last 12 nm.
        for (const w of gg.weapons) {
          if (w.dead || w.side !== 'us' || (w.type !== 'nsm' && w.type !== 'mst' && w.type !== 'mjolnir') || high(w) || dist(w, tartus) > 12 || gg.flags[`pt${w.id}`]) continue;
          gg.flags[`pt${w.id}`] = 1;
          if (gg.r() < adP(w, 0.6)) { w.dead = true; log(gg, 'warn', `The air defences at Tartus shot down ${w.label}.`); }
        }
        for (const s of ships) {
          if (s.alive && s.ai!.mode === 'transit') s.ai!.baseCourse = brg(s, tartus);
          if (arrive(gg, s, tartus, 1.5)) { gg.flags.in++; log(gg, 'danger', `${s.name} has reached Tartus and is unloading.`); }
        }
        if (gg.flags.in >= 2) end(gg, false, 'Two supply ships reached Tartus. The base is resupplied.');
      };
    },
  },
};

/** Cross-track: distance from p to the nearest leg of a route, the leg's index, and whether p is left of it (east of a southbound leg). */
function xtrack(pts: Vec[], p: Vec) {
  let best = { d: Infinity, seg: 0, left: false };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best.d - 1e-9) best = { d, seg: i, left: dx * (p.y - a.y) - dy * (p.x - a.x) > 0 };
  }
  return best;
}

// ---- Objectives --------------------------------------------------------------------------------
const neutralOk = (g: Game, text: string): Objective => {
  const pr = byId(g, g.goal.protect);
  const lost = pr.filter(isSunk);
  return { text, state: lost.length ? 'failed' : g.over?.win ? 'done' : 'open', detail: lost.length ? `${lost.map((v) => v.name).join(' and ')} sunk.` : 'None harmed.' };
};
const sitesObj = (g: Game, need: number, text: string): Objective => {
  const done = g.sites.filter((s) => s.hits >= need).length;
  return { text, state: done === g.sites.length ? 'done' : 'open', detail: g.sites.map((s) => `${s.name}: ${Math.min(s.hits, need)} of ${need}`).join('. ') + '.' };
};
const vessel = (g: Game, cls: string) => g.vessels.find((v) => v.cls.key === cls);

export const extras: Record<MissionKey, ObjectiveFn> = {
  A8: (g, b) => [...b, watch('Don\'t let three landing ships reach the beach', flag(g, 'landed') >= 3, `${flag(g, 'landed')} of 3 have landed.`)],
  A9: (g, b) => {
    const k = vessel(g, 'kirov'), fr = g.vessels.filter((v) => v.cls.key === 'gorshkov');
    const dmg = k ? Math.max(0, k.cls.hp - k.hp) : 0;
    return [
      { text: 'Sink Pyotr Velikiy', state: k && isSunk(k) ? 'done' : 'open', detail: k?.alive ? `${dmg} damage so far.` : 'Sunk.' },
      { text: 'Or turn the group back: 8 damage on the Kirov', state: dmg >= 8 ? 'done' : 'open', detail: `${Math.min(dmg, 8)} of 8. A Mk 48 hit does 5, a Tomahawk 3.` },
      { text: 'Or sink both frigates', state: fr.every(isSunk) ? 'done' : 'open', detail: `${sunkOf(fr)} of 2 sunk.` },
      watch('Stop her before she reaches the fire support position', ended(g, 'fire support position'), 'About 15 nm northwest of where you started.'),
      ...b.filter((o) => !o.text.startsWith('Sink')),
    ];
  },
  A10: (g, b) => {
    const s = flag(g, 'salvoT');
    const osc = vessel(g, 'oscar');
    return [...b,
      watch('Sink Voronezh before it fires its Granits', s >= 900, osc && isSunk(osc) ? 'Sunk.' : s ? `It is at the launch position: ${mins(900 - s)} until it fires.` : 'It needs 15 minutes at its launch position, about 20 nm north of where you started.'),
      watch('Keep the missile hits on Keflavik under four', flag(g, 'baseHits') >= 4, `${flag(g, 'baseHits')} hits so far. Backfires are expected about 35 and 95 minutes in.`),
    ];
  },
  A21: (g, b) => [sitesObj(g, 1, 'Hit all four radar sites with Tomahawk or Mjolnir'), watch('Launch only from inside the box', false, 'A 3 nm circle about 10 nm east of where you started. Tomahawks from outside it are shot down. Mjolnir flies its own path and usually gets through.'), ...b],
  A11: (g, b) => {
    const tr = Math.min(flag(g, 'trail'), 1200);
    const borei = vessel(g, 'borei');
    return [
      { text: 'Hold the Borei on sonar inside 6 nm for 20 minutes', state: flag(g, 'ready') ? 'done' : 'open', detail: flag(g, 'ready') ? 'Done.' : `${mins(tr)} of 20 min. She circles about 17 nm in from where you started.` },
      { text: 'Then get back out, within 8 nm of where you started', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'ready') ? `${Math.max(0, Math.hypot(g.own.x, g.own.y) - 8).toFixed(1)} nm to go.` : 'After the trail.' },
      watch('Don\'t sink the Borei', !!borei && isSunk(borei)),
      ...b.filter((o) => !o.text.startsWith('Keep')),
    ];
  },
  A12: (g, b) => {
    const lp = { x: flag(g, 'lx') / 1000, y: flag(g, 'ly') / 1000 };
    return [
      sitesObj(g, 2, 'Land two hits on each pen (one Mjolnir does it)'),
      { text: 'Then get 20 nm from the launch point', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'fired') ? `${dist(g.own, lp).toFixed(1)} nm from it now.` : 'Not launched yet.' },
      ...b,
    ];
  },
  A13: (g, b) => [...b, watch('Sink her before she launches Poseidon', ended(g, 'launched'), g.t < 85 * 60 ? `Launch run expected in about ${mins(85 * 60 - g.t)}.` : `She is on her launch run: ${mins(100 * 60 - g.t)} left.`)],
  A22: (g, b) => {
    const tr = Math.min(flag(g, 'trail'), 7200);
    const borei = vessel(g, 'borei');
    return [
      { text: 'Hold the Borei inside 12 nm for 2 hours', state: tr >= 7200 ? 'done' : 'open', detail: `${mins(tr)} of 2 h held so far.` },
      watch('Don\'t let her hear you', ended(g, 'heard us')),
      watch('Don\'t lose her: more than 25 nm and the trail is cold', ended(g, 'cold')),
      watch('Don\'t sink the Borei', !!borei && isSunk(borei)),
      ...b.filter((o) => !o.text.startsWith('Keep')),
    ];
  },
  A23: (g, b) => [...b,
    watch('Stop the Yasen before it fires from the polynya', flag(g, 'inPol') >= 600, flag(g, 'inPol') ? `It is in open water: ${mins(600 - flag(g, 'inPol'))} until it fires.` : 'It is heading north for open water.'),
    { text: 'Then come up to periscope depth in a polynya', state: g.over?.win ? 'done' : 'open', detail: 'Only possible in open water.' },
  ],
  A18: (g, b) => {
    const cv = g.vessels.find((v) => v.cls.key === 'qnlz');
    return [
      { text: 'Get HMS Prince of Wales through the lane', state: g.over?.win ? 'done' : cv && isSunk(cv) ? 'failed' : 'open',
        detail: cv ? `${Math.max(0, cv.y + 16).toFixed(1)} nm to go. She moves only while you are at least 1.5 nm ahead of her down the lane. ${cv.hp <= 3 ? 'She has hit one mine: one more sinks her.' : ''}` : undefined },
      { text: 'Find the mines in the lane', state: 'open', detail: `${flag(g, 'cleared')} cleared so far. Mines you mark in the lane are destroyed two minutes later.` },
      ...b.filter((o) => !o.text.startsWith('Keep')),
    ];
  },
  A20: (g, b) => {
    const ex = { x: flag(g, 'ex') / 1000, y: flag(g, 'ey') / 1000 };
    return [{ text: 'Reach the end of the channel', state: g.over?.win ? 'done' : 'open', detail: `${dist(g.own, ex).toFixed(1)} nm to go in a straight line. Follow the trench axis.` },
      watch('Don\'t hit two mines', !g.own.alive, g.own.hp < g.own.cls.hp ? 'One hit already: one more sinks us.' : 'No hits so far.'), ...b];
  },
  A14: (g, b) => [...b, watch('Keep the corvettes from firing on the convoy', false, 'Each fires a Kalibr salvo after 8 minutes inside 20 nm of the convoy.')],
  A15: (g, b) => [...b.filter((o) => !o.text.startsWith('Keep')), neutralOk(g, 'Don\'t sink the Turkish submarine'), watch('Don\'t let either Kilo get 14 nm south of where you started', flag(g, 'through') > 0)],
  A16: (g, b) => {
    const fr = g.vessels.filter((v) => v.cls.key === 'gorshkov');
    const worst = Math.max(0, ...fr.map((f) => flag(g, `fc${f.id}`)));
    return [...b, watch('Sink them before either fires on the Ford', ended(g, 'Zircons'), worst ? `One is inside 30 nm: ${mins(360 - worst)} until she can fire.` : 'Both are still outside 30 nm of the Ford.')];
  },
  A24: (g, b) => {
    const mouth = { x: flag(g, 'mx') / 1000, y: flag(g, 'my') / 1000 };
    return [
      { text: 'Lay 6 mines within 1.5 nm of the marked point off the harbour mouth', state: flag(g, 'laid') >= 6 ? 'done' : 'open', detail: `${flag(g, 'laid')} of 6 laid there. ${flag(g, 'minesAboard')} left aboard.` },
      { text: 'Then get 14 nm clear of the harbour mouth', state: g.over?.win ? 'done' : 'open', detail: `${dist(g.own, mouth).toFixed(1)} nm from it now.` },
      { text: 'Watch the corvette\'s pings', state: g.vessels.some((v) => v.name === 'Soobrazitelny' && !v.alive) ? 'done' : 'open', detail: 'She is too quiet to hear, but her active sonar gives her bearing away.' },
      watch('Stay off the coastal radars', flag(g, 'seenT') >= 60, 'No more than a minute at periscope depth inside 14 nm of the coast.'),
      ...b,
    ];
  },
  A25: (g, b) => [...b.filter((o) => !o.text.startsWith('Keep')), neutralOk(g, 'Don\'t sink the neutral merchants'), watch('Don\'t let two supply ships reach Tartus', flag(g, 'in') >= 2, `${flag(g, 'in')} of 2 have got in.`)],
};
