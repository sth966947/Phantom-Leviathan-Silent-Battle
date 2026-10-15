// Modern war missions: counter. Act 3's counteroffensive, January to February 2030: three pushes
// on each front (CA Atlantic, CP Pacific, CG Gulf and Indian Ocean, CS South Atlantic), each a bigger
// fight than the last, with allied boats and ships fighting alongside Tang.
import { brg, dist, norm, offset, type Vec } from '../math';
import { depthT, end, log, WEAPONS, type Game, type Vessel } from '../sim';
import { CLASSES } from '../classes';
import {
  add, alive, at, clock, flag, go, ids, isSunk, keepCourse, mins, missileSalvo, pointDefence, pressRaids, raid, screen,
  setGoal, skirmish, steer, watch, type Carry, type Mission, type MissionKey, type ObjectiveFn, type Raid,
} from '../kit';
import { mineField, mineLine } from '../hazards';

// ---- Helpers shared with finale.ts ------------------------------------------------------------
/** The first `n` names not sunk in earlier missions (then the sunk ones, if the list runs out). */
export function fresh(carry: Carry, names: string[], n = names.length) {
  const up = names.filter((x) => alive(carry, x));
  return [...up, ...names.filter((x) => !up.includes(x))].slice(0, n);
}
/** A land target for TLAMs. */
export function site(g: Game, name: string, p: Vec) {
  const s = { id: -(g.sites.length + 1), name, x: p.x, y: p.y, hits: 0 };
  g.sites.push(s);
  return s;
}
/** An enemy UGST homing torpedo, fired by a mission script (a boat attacking something other than Tang). */
export function enemyTorpedo(g: Game, v: Vessel, aim: Vec, deep = v.depthT > 1.5) {
  const w = WEAPONS.ugst, hdg = brg(v, aim);
  g.stats.enemyFired++;
  g.weapons.push({
    id: g.seq++, type: 'ugst', side: 'enemy', label: w.short, x: v.x, y: v.y, hdg, ordHdg: hdg, spd: w.spd,
    run: 0, maxRun: w.maxRun, enableAt: 1, enabled: false, deep, wire: false, aim, contactId: null, target: null, rolled: new Set(), trail: [],
  });
}
/** Air defence against TLAMs: each one that flies within `range` nm of a live ship (or point) is shot down with chance `p`, once per defender. */
export function tlamDefence(g: Game, defenders: (Vec & { name: string; alive?: boolean })[], range: number, p: number) {
  for (const w of g.weapons) {
    if (w.dead || w.type !== 'tlam') continue;
    for (const d of defenders) {
      const k = `sam${w.id}_${d.name}`;
      if (d.alive === false || g.flags[k] || dist(d, w) > range) continue;
      g.flags[k] = 1;
      if (g.r() < p) { w.dead = true; log(g, 'warn', `${w.label} was shot down by ${d.name}.`); break; }
    }
  }
}
/** Shallow water: the bottom is close, so nobody can get below the layer. */
export function shallow(g: Game, ft: number) {
  const t = depthT(ft);
  if (g.own.ordDepth > t) {
    g.own.ordDepth = t;
    if (!g.flags.shoal) log(g, 'warn', `The bottom is at ${ft + 40} feet here. Holding ${ft} feet: there is no going below the layer.`);
    g.flags.shoal = 1;
  }
  for (const v of g.vessels) if (v.alive && v !== g.own && v.cls.kind === 'sub' && v.ordDepth > t) v.ordDepth = t;
}
/** A submarine screening a group: it keeps its station quietly, and only hunts once one of the group is hit. */
export function screenSub(v: Vessel, group: Vessel[], station: Vec, spd: number) {
  if (!v.alive || !v.ai) return;
  if (!group.some((x) => x.hp < x.cls.hp)) {
    if (v.ai.mode === 'patrol' || v.ai.mode === 'attack') v.ai.mode = 'transit';
    if (v.ai.mode === 'transit') steer(v, station, spd);
  } else if (v.ai.mode === 'transit') { v.ai.mode = 'patrol'; v.ai.legT = 300; }
}
/** Shore radar sees each missile launch: the hunters are told where we are. */
export function launchReported(g: Game, hunters: Vessel[], by: string, err = 1) {
  const n = g.stats.fired.tlam + g.stats.fired.mst + g.stats.fired.harpoon;
  if (n <= flag(g, 'seenLaunches')) return;
  g.flags.seenLaunches = n;
  const up = hunters.filter((v) => v.alive && v.ai);
  for (const v of up) {
    v.ai!.knows = { x: g.own.x + (g.r() * 2 - 1) * err, y: g.own.y + (g.r() * 2 - 1) * err, t: g.t, deep: false };
    if (v.ai!.mode === 'patrol') v.ai!.mode = 'attack';
  }
  if (up.length && !g.flags.launchWarned) { g.flags.launchWarned = 1; log(g, 'warn', `ESM: ${by} has seen our launch. Expect the hunters to come to where we fired from.`); }
}
/** Cruise missiles in flight: air contacts that SM-6 can bring down. Uses the missile class when the roster has one. */
export const CRUISE = CLASSES.kalibr ? 'kalibr' : 'tu22m3';
export function cruiseMissiles(g: Game, from: Vec, to: Vec, n: number, name: string, first = 1, spd = 480) {
  const b = brg(from, to);
  return Array.from({ length: n }, (_, i) => {
    const p = offset(from, b + 90, (i - (n - 1) / 2) * 0.6);
    const v = add(g, CRUISE, `${name} ${first + i}`, 'enemy', p, b, spd, { mode: 'strike', goal: to, cruise: spd });
    v.track = [];
    return v;
  });
}
/** Ships that reach a line or point leave alive: counted under `key`. */
function through(g: Game, ships: Vessel[], done: (v: Vessel) => boolean, key: string, text: (v: Vessel) => string) {
  for (const v of ships) if (v.alive && done(v)) { v.alive = false; v.gone = true; g.flags[key] = (g.flags[key] ?? 0) + 1; log(g, 'danger', text(v)); }
}
const lift = (g: Game, id: number) => g.sites.find((s) => s.id === id)!.hits;
/** Hits on a site, counted out of `need`. */
const hitLine = (g: Game, id: number, need: number) => {
  const s = g.sites.find((x) => x.id === id)!;
  return { text: `Land ${need} Tomahawks on ${s.name}`, state: s.hits >= need ? 'done' as const : 'open' as const, detail: `${Math.min(s.hits, need)} of ${need} hits.` };
};

const YASEN = ['Novosibirsk (K-573)', 'Krasnoyarsk (K-571)', 'Arkhangelsk (K-564)', 'Perm (K-575)', 'Severodvinsk (K-560)'];
const AKULA = ['Akula (Vepr)', 'Akula (Tigr)', 'Akula (Leopard)', 'Akula (Volk)', 'Akula (Samara)', 'Akula (Pantera)'];
const OSCAR = ['Oscar II (Voronezh)', 'Oscar II (Orel)', 'Oscar II (Smolensk)', 'Oscar II (Tver)'];

export const missions: Record<MissionKey, Mission> = {
  // ---- Counteroffensive 1 ------------------------------------------------------------------------
  CA1: {
    key: 'CA1', title: 'Second Bear Gap', era: '2029', place: 'Bear Island Gap, Barents Sea', date: 'January 2030, 0100', night: true,
    library: ['yasen', 'akula', 'oscar', 'kilo', 'nansen', 'type26', 'il38'],
    brief: 'Russia is sending its last wave of submarines west through the Bear Island Gap: two Yasen-Ms, two Akulas and an Oscar II, in two waves. The Yasens and the Oscar are running for it; the Akulas are there to fight. The first three are about 15 nm east of you now; the last two are expected in about 50 minutes, running faster. If three boats get past a line 20 nm west of you, the breakout has worked. Hold the gap for four hours, or sink all five. HNoMS Fridtjof Nansen and HMS Glasgow hold the southern end of the gap, about 14 nm south of you, and will fight anything that comes near them. They are friendly: check what you shoot at. An Il-38 is working the gap for the Russians.',
    build(g, r, carry) {
      g.startClock = clock(1);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 90;
      const south = { x: 0, y: -14 };
      const allies = [
        add(g, 'nansen', 'HNoMS Fridtjof Nansen', 'allied', offset(south, 270, 3), 90, 6, { mode: 'picket', center: offset(south, 270, 3) }),
        add(g, 'type26', 'HMS Glasgow', 'allied', offset(south, 90, 3), 90, 6, { mode: 'picket', center: offset(south, 90, 3) }),
      ];
      add(g, 'il38', 'Il-38N May', 'enemy', offset(g.own, r() * 360, 60), 0, 230, { mode: 'search', center: { x: 0, y: 0 }, wp: { x: 0, y: 0 }, buoyT: 0, torps: 2, datum: null });
      const [y1, y2] = fresh(carry, YASEN, 2), [a1, a2] = fresh(carry, AKULA, 2), [o1] = fresh(carry, OSCAR, 1);
      const boats: { v: Vessel; lane: Vec; spd: number }[] = [];
      const wave = (gg: Game, list: [string, string][], x0: number, spd: number) => list.forEach(([cls, name]) => {
        const p = { x: x0 + gg.r() * 4, y: (gg.r() * 2 - 1) * 13 };
        const lane = { x: -22, y: p.y + (gg.r() * 2 - 1) * 4 };
        // The Akulas are the fighters; the missile boats just want to get out.
        const fight = cls === 'akula';
        const v = add(gg, cls, name, 'enemy', p, brg(p, lane), spd, fight ? { mode: 'patrol', legT: 1e9, decoys: 2 } : { mode: 'raider', goal: lane, cruise: spd, decoys: 2 }, gg.r() < 0.5 ? 2 : 1);
        boats.push({ v, lane, spd });
        gg.goal.targets.push(v.id);
      });
      wave(g, [['yasen', y1], ['akula', a1], ['oscar', o1]], 13, 9);
      setGoal(g, { need: 5, surviveWin: true, win: 'Four hours and the gap held. Russia\'s last wave of submarines is broken.', timeout: '' });
      g.script = (gg) => {
        at(gg, 50 * 60, 'wave2', () => {
          wave(gg, [['yasen', y2], ['akula', a2]], 18, 12);
          log(gg, 'warn', 'Sonar: more boats coming from the east, running fast. The second wave is here.');
        });
        for (const b of boats) keepCourse(b.v, brg(b.v, b.lane), b.spd);
        through(gg, boats.map((b) => b.v), (v) => v.x < -20, 'through', (v) => `${v.name} is past the line and into the Norwegian Sea.`);
        skirmish(gg, allies, boats.map((b) => b.v), 5, 0.12, 0.06, 0.5);
        if (flag(gg, 'through') >= 3) end(gg, false, 'Three boats broke through the Bear Island Gap. The breakout has worked.');
      };
    },
  },

  CP1: {
    key: 'CP1', title: 'Return to Taiwan', era: '2029', place: 'Taiwan Strait', date: 'January 2030, 0400', night: true,
    library: ['type071', 'type901', 'tanker', 'type054a', 'type056', 'type039', 'taigei', 'kq200'],
    brief: 'The troops China landed on Taiwan live on what crosses the strait. Tonight\'s convoy is two Type 071 landing ships, a Type 901 supply ship and two fuel tankers, with two Type 054A frigates and a Type 056 corvette as escort and a Type 039 submarine out ahead. It is about 20 nm west of you, heading east for the beachhead at Taichung, about 26 nm east of you. Sink three of the five supply ships before three of them get there. JS Hakugei, a Japanese Taigei, is working the convoy\'s northern flank: she is friendly. A KQ-200 is flying cover.',
    build(g, r) {
      g.startClock = clock(4);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const course = 90;
      const lead = add(g, 'type071', 'Kunlunshan', 'enemy', { x: -20, y: (r() * 2 - 1) * 6 }, course, 12, go(course, 12, 1e9));
      const sup = [lead,
        ...screen(g, lead, 'type071', ['Changbaishan'], [[180, 1.5]]),
        ...screen(g, lead, 'type901', ['Chaganhu'], [[140, 1.5]]),
        ...screen(g, lead, 'tanker', ['Tanker Da Qing 75', 'Tanker Da Qing 91'], [[220, 1.5], [180, 3]])];
      const esc = [...screen(g, lead, 'type054a', ['Huangshan', 'Yuncheng'], [[40, 3], [320, 3]]), ...screen(g, lead, 'type056', ['Datong'], [[180, 5]])];
      const yuan = add(g, 'type039', 'Type 039 Yuan (Hull 336)', 'enemy', offset(lead, course + (r() * 2 - 1) * 30, 7), course, 6, { mode: 'transit', legT: 1e9, decoys: 2 }, 1);
      add(g, 'kq200', 'KQ-200', 'enemy', offset(lead, r() * 360, 40), 0, 230, { mode: 'search', center: { x: 0, y: 0 }, wp: { x: 0, y: 0 }, buoyT: 0, torps: 2, datum: null });
      const hak = add(g, 'taigei', 'JS Hakugei (SS-516)', 'allied', offset(lead, 20, 9), course, 6, undefined, 1);
      setGoal(g, { targets: ids(sup), need: 3, win: 'Three supply ships are on the bottom of the strait. The beachhead at Taichung goes hungry.', timeout: 'The convoy got enough through to keep the beachhead going.' });
      g.script = (gg) => {
        screenSub(yuan, [...sup, ...esc], offset(lead, course, 7), 13);
        steer(hak, offset(lead, 20, 7), 9);
        through(gg, sup, (v) => v.x > 26, 'landed', (v) => `${v.name} has reached the beachhead at Taichung and is unloading.`);
        skirmish(gg, [hak], [...esc, yuan], 5, 0.1, 0.08, 0.5);
        if (flag(gg, 'landed') >= 3) end(gg, false, 'Three supply ships reached Taichung. The troops on Taiwan have what they need for another week.');
      };
    },
  },

  CG1: {
    key: 'CG1', title: 'Gulf Lockdown', era: '2029', place: 'Strait of Hormuz, off Bandar Abbas', date: 'January 2030, 2300', night: true,
    library: ['kilo', 'ghadir', 'jamaran', 'fac', 'arleigh'],
    brief: 'Iran still has two Kilos and a nest of Ghadir midgets, and they keep slipping out to hit the tankers. Lock them in. You have eight mines aboard (Lay mine, at 12 knots or less). Lay three within 1 nm of each harbour mark: Bandar Abbas, bearing 345, 8 nm, and the Qeshm boat base, bearing 300, 9 nm. A channel with three mines in it is closed: nothing will come out. Until then, expect a Kilo out of Bandar Abbas about 50 minutes in and midgets out of Qeshm at 45 and 90 minutes, all running for open water about 12 nm southeast of you. The Kilo Tareq is already at sea west of you: sink it, and sink anything that gets out. If two boats reach the open water southeast of you, the lockdown has failed. Iran has mined the straight run to Qeshm. USS Paul Hamilton and USS Sterett guard the exit to the southeast.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 345;
      g.flags.minesAboard = 8;
      const A = offset(g.own, 345, 8), B = offset(g.own, 300, 9), open = offset(g.own, 150, 12);
      g.flags.ax = A.x; g.flags.ay = A.y; g.flags.bx = B.x; g.flags.by = B.y;
      mineField(g, offset(g.own, 300, 5), 1.2, 10);
      const tareq = add(g, 'kilo', 'Tareq (901)', 'enemy', offset(g.own, 240 + r() * 40, 14 + r() * 3), r() * 360, 4, { mode: 'patrol', legT: 400, decoys: 2 }, 1);
      add(g, 'jamaran', 'Sahand', 'enemy', offset(g.own, 320, 10), 90, 10, go(90, 10, 600));
      for (const [i, p] of [A, B].entries()) add(g, 'fac', `IRGCN fast attack craft ${i + 1}`, 'enemy', offset(p, 180, 2), 0, 12, { mode: 'wander', center: offset(p, 180, 3), rng: 3, cruise: 14 });
      const allies = [
        add(g, 'arleigh', 'USS Paul Hamilton', 'allied', offset(open, 60, 2), 0, 6, { mode: 'picket', center: offset(open, 60, 2) }),
        add(g, 'arleigh', 'USS Sterett', 'allied', offset(open, 240, 2), 0, 6, { mode: 'picket', center: offset(open, 240, 2) }),
      ];
      const out: Vessel[] = [tareq];
      const closed = (gg: Game, p: Vec) => gg.mines.filter((m) => m.side === 'us' && dist(m, p) < 1).length >= 3;
      const sortie = (gg: Game, ch: Vec, closedKey: string, cls: string, name: string, port: string) => {
        if (gg.flags[closedKey]) return log(gg, 'good', `Radio intercept: ${name} was ordered out of ${port}, but the channel is mined. She is staying alongside.`);
        const p = offset(ch, brg(open, ch), 2);
        const v = add(gg, cls, name, 'enemy', p, brg(p, open), 6, { mode: 'raider', goal: open, cruise: cls === 'kilo' ? 9 : 7, decoys: cls === 'kilo' ? 2 : 0 }, 1);
        out.push(v);
        log(gg, 'warn', `Sonar: a submarine is coming out of ${port}, bearing ${Math.round(brg(gg.own, p)).toString().padStart(3, '0')}.`);
      };
      setGoal(g, { targets: [], win: '', timeout: 'Four hours, and Iran\'s ports are still open.' });
      g.script = (gg) => {
        for (const [p, k, port] of [[A, 'closedA', 'Bandar Abbas'], [B, 'closedB', 'Qeshm']] as const) {
          if (!gg.flags[k] && closed(gg, p)) { gg.flags[k] = 1; log(gg, 'good', `Three mines down off ${port}. That channel is closed.`); }
        }
        at(gg, 45 * 60, 'ghadir1', () => sortie(gg, B, 'closedB', 'ghadir', 'Ghadir midget (Qeshm 1)', 'Qeshm'));
        at(gg, 50 * 60, 'noor', () => sortie(gg, A, 'closedA', 'kilo', 'Noor (902)', 'Bandar Abbas'));
        at(gg, 90 * 60, 'ghadir2', () => sortie(gg, B, 'closedB', 'ghadir', 'Ghadir midget (Qeshm 2)', 'Qeshm'));
        through(gg, out.filter((v) => v !== tareq), (v) => dist(v, open) < 3, 'escaped', (v) => `${v.name} has reached open water. She is loose among the tankers.`);
        skirmish(gg, allies, out, 4, 0.15, 0.05, 0.5);
        if (flag(gg, 'escaped') >= 2) return end(gg, false, 'Two Iranian boats got out into open water. The lockdown failed.');
        if (gg.flags.closedA && gg.flags.closedB && !out.some((v) => v.alive)) end(gg, true, 'Both channels are mined and every Iranian boat at sea is sunk. Iran\'s navy is locked in its ports.');
      };
    },
  },

  CS1: {
    key: 'CS1', title: 'Ascension Relief', era: '2029', place: 'Off Ascension Island', date: 'January 2030, 0700',
    library: ['tamandare', 'riachuelo', 'type209', 'p3am', 'type26', 'tanker', 'boxship'],
    brief: 'Ascension has been under siege since the autumn: three Brazilian Tamandaré frigates and two Riachuelos hold the sea around it. A British relief convoy, RFA Tideforce with MV Hurst Point and MV Eddystone, escorted by HMS Cardiff, is 4 nm behind you, heading 170 for the anchorage at Clarence Bay, about 24 nm south of you. Break the siege: get the convoy to the anchorage, losing no more than one ship. The frigates fire MANSUP anti-ship missiles at the convoy about every 25 minutes while it is inside 20 nm of them, and one Riachuelo is coming in from the east to torpedo it, and the other is hunting for you: sink the frigates first if you can. A P-3AM is up.',
    build(g, r, carry) {
      g.startClock = clock(7);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 170;
      const anch = offset(g.own, 170, 24);
      const card = add(g, 'type26', 'HMS Cardiff', 'allied', offset(g.own, 350, 2), 170, 9, go(170, 9, 1e9));
      const convoy = [...screen(g, card, 'tanker', ['RFA Tideforce'], [[180, 1.5]]), ...screen(g, card, 'boxship', ['MV Hurst Point', 'MV Eddystone'], [[150, 2.5], [210, 2.5]])];
      const frig = fresh(carry, ['Tamandaré (F200)', 'Jerônimo de Albuquerque (F201)', 'Cunha Moreira (F202)', 'Mariz e Barros (F203)'], 3)
        .map((n, i) => add(g, 'tamandare', n, 'enemy', offset(anch, 250 + i * 70 + r() * 30, 12 + r() * 4), r() * 360, 8, { mode: 'patrol', legT: 500 }));
      const subs = fresh(carry, ['Riachuelo (S40)', 'Humaitá (S41)', 'Tonelero (S42)', 'Angostura (S43)'], 2)
        .map((n, i) => add(g, 'riachuelo', n, 'enemy', offset(anch, i ? 60 + r() * 30 : 300 + r() * 30, i ? 16 : 13), 0, 4, i ? { mode: 'raider', cruise: 6, decoys: 2, torps: 4 } : { mode: 'patrol', legT: 500, decoys: 2 }, 1));
      add(g, 'p3am', 'P-3AM Orion', 'enemy', offset(anch, r() * 360, 40), 0, 230, { mode: 'search', center: anch, wp: anch, buoyT: 0, torps: 2, datum: null });
      setGoal(g, { targets: [], protect: ids(convoy), maxLosses: 1, lossText: 'Two relief ships are gone. Ascension stays under siege.', win: '', timeout: 'The convoy never made the anchorage. Ascension stays under siege.' });
      g.script = (gg) => {
        pointDefence(gg, frig, 0.35);
        if (dist(card, anch) < 1) card.ai!.cruise = 0;
        // Without Cardiff to keep station on, the merchants make for the anchorage on their own.
        for (const v of convoy) if (v.alive && v.ai!.mode === 'transit') { v.ai!.baseCourse = brg(v, anch); v.ai!.cruise = 9; }
        through(gg, convoy, (v) => dist(v, anch) < 4, 'arrived', (v) => `${v.name} is in Clarence Bay, under the island's guns.`);
        skirmish(gg, [card], subs, 4, 0.15, 0.08, 0.5);
        // Each frigate inside 25 nm of the convoy gets a MANSUP off every 20 minutes.
        if (gg.t % 1500 === 750) for (const f of frig) {
          const near = convoy.filter((v) => v.alive && dist(v, f) < 20);
          if (f.alive && near.length) missileSalvo(gg, f.name, 'MANSUP', 1, near, 0.25, 2);
        }
        const left = convoy.filter((v) => v.alive).length;
        if (!left && flag(gg, 'arrived') >= 2) end(gg, true, 'The relief convoy is in Clarence Bay. The siege of Ascension is broken.');
      };
    },
  },

  // ---- Counteroffensive 2 ------------------------------------------------------------------------
  CA2: {
    key: 'CA2', title: 'Kola Assault', era: '2029', place: 'Barents Sea', date: 'January 2030, 1000',
    library: ['kirov', 'udaloy', 'gorshkov', 'yasen', 'akula', 'virginia', 'tu142'],
    brief: 'NATO is going into the Barents. USS Gerald R. Ford\'s group is 150 nm behind you, and Tang leads the way in with USS Vermont and USS Delaware. Between the carrier and Kola stands the battlecruiser Pyotr Velikiy with two Udaloys and a Gorshkov frigate, about 22 nm east of you and heading west at 16 knots, with a Yasen-M out ahead. Sink Pyotr Velikiy before she gets 30 nm west of where you are now: from there her Granits reach the Ford. She is huge and needs three or four hits; her close-in guns will knock down some of your missiles. Once she is hit, the Ford\'s air wing will go in after her escorts. Vermont and Delaware are friendly.',
    build(g, r, carry) {
      g.startClock = clock(10);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 90;
      const kname = fresh(carry, ['Pyotr Velikiy', 'Admiral Nakhimov'], 1)[0];
      const kirov = add(g, 'kirov', kname, 'enemy', { x: 22, y: (r() * 2 - 1) * 6 }, 270, 16, go(270, 16, 1e9));
      const esc = [...screen(g, kirov, 'udaloy', ['Severomorsk', 'Vice-Admiral Kulakov'], [[45, 3], [315, 3]]), ...screen(g, kirov, 'gorshkov', ['Admiral Golovko'], [[180, 3]])];
      const yasen = add(g, 'yasen', fresh(carry, YASEN, 1)[0], 'enemy', offset(kirov, 270 + (r() * 2 - 1) * 30, 9), 270, 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      add(g, 'tu142', 'Tu-142MK Bear-F', 'enemy', offset(kirov, r() * 360, 50), 0, 230, { mode: 'search', center: { x: kirov.x, y: kirov.y }, wp: { x: kirov.x, y: kirov.y }, buoyT: 0, torps: 2, datum: null });
      const allies = [add(g, 'virginia', 'USS Vermont (SSN-792)', 'allied', { x: 2, y: 9 }, 90, 6, undefined, 2), add(g, 'virginia', 'USS Delaware (SSN-791)', 'allied', { x: 2, y: -9 }, 90, 6, undefined, 2)];
      setGoal(g, { targets: [kirov.id], need: 1, win: `${kname} is going down. The road into the Barents is open, and the Ford is coming.`, timeout: `${kname} held the Barents.` });
      g.script = (gg) => {
        pointDefence(gg, [kirov, ...esc], 0.45);
        keepCourse(yasen, brg(yasen, offset(kirov, 270, 9)), 10);
        allies.forEach((a, i) => steer(a, offset(kirov, i ? 210 : 330, 7), 10));
        skirmish(gg, allies, [yasen, ...esc], 6, 0.1, 0.07, 0.5);
        if (kirov.hp < kirov.cls.hp && !gg.flags.hitT) { gg.flags.hitT = gg.t; log(gg, 'good', `${kname} is hit and her radars are flickering. Ford's air wing is launching.`); }
        if (gg.flags.hitT && gg.t - gg.flags.hitT === 600) {
          log(gg, 'good', 'Super Hornets from the Ford are over the Russian group with Harpoons.');
          for (const v of [...esc, kirov]) if (v.alive && gg.r() < 0.5) for (let k = 0; k < 2; k++) if (v.alive) { v.hp -= 1; if (v.hp <= 0) { v.alive = false; gg.sunk.push({ name: v.name, cls: v.cls.key, side: v.side, by: 'allied' }); log(gg, 'good', `${v.name} is burning and sinking.`, 'boom'); } }
        }
        if (kirov.alive && kirov.x < -30) end(gg, false, `${kname} reached launch range and fired twenty Granits at the Ford. The carrier is out of the war.`);
      };
    },
  },

  CP2: {
    key: 'CP2', title: 'Yulin Strike', era: '2029', place: 'South China Sea, off Hainan', date: 'January 2030, 0200', night: true,
    library: ['type055', 'type052d', 'type093b', 'type039', 'collins', 'kq200', 'ka28'],
    brief: 'Strike China\'s southern submarine base at Yulin, on Hainan, 70 nm due north of you. Land two Tomahawks on the tunnel entrance where the boats hide and two on the submarine piers beside it. Between you and Hainan, about 32 nm north, the Type 055 Yan\'an and two Type 052Ds steam back and forth across the approach: their air defence shoots down most Tomahawks that fly within 8 nm of one of them. Sink them first, or launch from where the missiles\' path misses them. Once Yulin knows it is under attack, a Type 093B will come out after you. HMAS Rankin, an Australian Collins, is working the approach to the east: she is friendly. A KQ-200 and a Ka-28 hunt for the group.',
    build(g, r) {
      g.startClock = clock(2);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const tunnel = site(g, 'Yulin submarine tunnel entrance', { x: 0, y: 70 });
      const piers = site(g, 'Yulin submarine piers', offset(tunnel, 100, 1.2));
      const dir = r() < 0.5 ? 90 : 270;
      const lead = add(g, 'type055', 'Yan\'an', 'enemy', { x: (r() * 2 - 1) * 8, y: 32 }, dir, 14, go(dir, 14, 1e9));
      const dd = screen(g, lead, 'type052d', ['Hohhot', 'Nanning'], [[90, 3], [270, 3]]);
      const group = [lead, ...dd];
      const yuan = add(g, 'type039', 'Type 039 Yuan (Hull 341)', 'enemy', offset(lead, 180, 8), 90, 5, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      add(g, 'kq200', 'KQ-200', 'enemy', offset(lead, r() * 360, 40), 0, 230, { mode: 'search', center: { x: 0, y: 25 }, wp: { x: 0, y: 25 }, buoyT: 0, torps: 2, datum: null });
      add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(lead, r() * 360, 3), 0, 120, { mode: 'search', center: { x: 0, y: 28 }, wp: { x: 0, y: 26 }, buoyT: 0, torps: 1, datum: null });
      const rankin = add(g, 'collins', 'HMAS Rankin (SSG 78)', 'allied', { x: 14, y: 16 }, 0, 6, undefined, 1);
      const hunters: Vessel[] = [yuan];
      setGoal(g, { targets: [], win: '', timeout: 'The night is over and Yulin is still in business.' });
      g.script = (gg) => {
        // The group sweeps east and west across the approach.
        if (lead.alive && lead.ai!.mode === 'transit' && Math.abs(lead.x) > 12 && Math.sign(lead.x) === Math.sign(Math.sin((lead.ai!.baseCourse * Math.PI) / 180))) lead.ai!.baseCourse = norm(lead.ai!.baseCourse + 180);
        pointDefence(gg, group, 0.5);
        tlamDefence(gg, group, 8, 0.6);
        steer(rankin, offset(lead, 120, 8), 6);
        skirmish(gg, [rankin], hunters, 5, 0.12, 0.08, 0.5);
        if (gg.stats.fired.tlam && !gg.flags.sortie) {
          gg.flags.sortie = 1;
          gg.flags.sortieT = gg.t;
        }
        at(gg, (gg.flags.sortieT || 1e9) + 900, 'hunter', () => {
          hunters.push(add(gg, 'type093b', 'Type 093B (Hull 419)', 'enemy', offset(tunnel, 180, 4), 180, 16, { mode: 'attack', legT: 400, decoys: 2, knows: { x: gg.own.x, y: gg.own.y, t: gg.t, deep: false } }, 2));
          log(gg, 'warn', 'Radio intercepts: Yulin has sent a Type 093B out after us, coming south at speed.');
        });
        if (lift(gg, tunnel.id) >= 2 && lift(gg, piers.id) >= 2) end(gg, true, 'The tunnel mouth has collapsed and the piers are burning. China\'s southern submarine base is shut.');
      };
    },
  },

  CG2: {
    key: 'CG2', title: 'Bandar Abbas', era: '2029', place: 'Off Bandar Abbas', date: 'January 2030, 0300', night: true,
    library: ['jamaran', 'kilo', 'fac', 'droneboat', 'arleigh'],
    brief: 'Strike Iran\'s main naval base at Bandar Abbas, 55 nm north of you: three Tomahawks on the dry dock and two on the submarine pier. The coast is thick with air defences, and Tomahawks fly too long over them from far out: launch from inside 25 nm of the base or most will be shot down. That means going in, past the mines. An Iranian minefield runs across the approach 28 nm north of you, with a gap about 3 nm wide straight ahead that their own boats use. Beyond it, the frigates Sahand and Dena and the Kilo Yunes are hunting, and fast attack craft are watching for periscopes. Once the base is hit, expect a swarm of fast attack craft and explosive drone boats to go for USS Mason and USS Sampson, 8 nm south of you.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const dock = site(g, 'Bandar Abbas dry dock', { x: 0, y: 55 });
      const pier = site(g, 'Bandar Abbas submarine pier', offset(dock, 90, 1.5));
      mineLine(g, { x: -9, y: 28 }, { x: -1.6, y: 28 }, 12);
      mineLine(g, { x: 1.6, y: 28 }, { x: 9, y: 28 }, 12);
      const hunters = ([['Sahand', -5], ['Dena', 5]] as const).map(([n, x]) => add(g, 'jamaran', n, 'enemy', { x: x + (r() * 2 - 1) * 2, y: 33 + r() * 4 }, r() * 360, 10, { mode: 'patrol', legT: 500 }));
      hunters.push(add(g, 'kilo', 'Yunes (903)', 'enemy', { x: (r() * 2 - 1) * 2, y: 30 + r() * 2 }, r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1));
      for (const x of [-6, 0, 6]) add(g, 'fac', `IRGCN fast attack craft ${x / 6 + 2}`, 'enemy', { x, y: 42 }, 0, 12, { mode: 'wander', center: { x, y: 42 }, rng: 4, cruise: 14 });
      const dds = [add(g, 'arleigh', 'USS Mason', 'allied', offset(g.own, 170, 8), 0, 5, { mode: 'picket', center: offset(g.own, 170, 8) }), add(g, 'arleigh', 'USS Sampson', 'allied', offset(g.own, 190, 8), 0, 5, { mode: 'picket', center: offset(g.own, 190, 8) })];
      const swarm: Vessel[] = [];
      setGoal(g, { targets: [], protect: ids(dds), maxLosses: 1, lossText: 'The swarm got both destroyers. The strike has cost too much.', win: '', timeout: 'Dawn, and the base at Bandar Abbas is still working.' });
      g.script = (gg) => {
        // Tomahawks launched from far out: the coastal SAMs get most of them on the way in.
        for (const w of gg.weapons) {
          if (w.type !== 'tlam' || w.dead) continue;
          const k = `tl${w.id}`;
          if (gg.flags[k] === undefined) gg.flags[k] = dist(gg.own, w.aim) > 25 ? 1 : 0;
          if (gg.flags[k] === 1 && dist(w, w.aim) < 10) {
            gg.flags[k] = 2;
            if (gg.r() < 0.75) { w.dead = true; log(gg, 'warn', `${w.label} was shot down by the coastal air defences after a long run in over the coast.`); }
          }
        }
        tlamDefence(gg, [{ ...dock, name: 'the base\'s Tor batteries' }], 6, 0.25);
        launchReported(gg, hunters, 'coastal radar');
        if (gg.flags.landHits && !gg.flags.swarm) {
          gg.flags.swarm = 1;
          for (let i = 0; i < 6; i++) {
            const p = offset(dock, 180 + (i - 2.5) * 6, 4);
            const v = add(gg, i % 2 ? 'droneboat' : 'fac', i % 2 ? `Drone boat ${(i + 1) / 2}` : `IRGCN attack craft ${i / 2 + 4}`, 'enemy', p, 180, 0, go(brg(p, dds[i % 2]), i % 2 ? 40 : 32, 1e9));
            swarm.push(v);
          }
          log(gg, 'warn', 'Radio intercepts: a swarm of fast attack craft and drone boats is coming out of Bandar Abbas, heading for Mason and Sampson.');
        }
        for (const [i, v] of swarm.entries()) {
          const dd = dds[i % 2].alive ? dds[i % 2] : dds[(i + 1) % 2];
          if (!v.alive || !dd.alive) continue;
          v.ai!.baseCourse = brg(v, dd);
          if (dist(v, dd) < 0.4) {
            v.alive = false; v.gone = true;
            for (let k = 0; k < 2; k++) if (gg.r() < 0.6) { dd.hp -= 2; gg.blasts.push({ x: dd.x, y: dd.y, t: gg.t, missile: false }); }
            log(gg, 'danger', `${v.name} rammed ${dd.name} and blew up alongside.`, 'boom');
            if (dd.hp <= 0) { dd.alive = false; gg.sunk.push({ name: dd.name, cls: dd.cls.key, side: dd.side, by: 'enemy' }); log(gg, 'danger', `${dd.name} is sinking.`, 'boom'); }
          }
        }
        skirmish(gg, dds, swarm, 8, 0.45, 0, 0.6);
        if (lift(gg, dock.id) >= 3 && lift(gg, pier.id) >= 2) end(gg, true, 'The dry dock is flooded and the submarine pier is wrecked. Iran\'s main base is out of the war.');
      };
    },
  },

  CS2: {
    key: 'CS2', title: 'River Plate', era: '2029', place: 'Off Montevideo', date: 'January 2030, 1500',
    library: ['tanker', 'lng', 'tamandare', 'riachuelo', 'type26', 'p3am'],
    brief: 'Brazil fuels its war with oil from the south. Four tankers chartered by Petrobras are leaving the River Plate, about 25 nm west of you, heading 060 up the coast for Rio Grande with two Tamandaré frigates and the Riachuelo Tonelero. Sink three of the four before they get 45 nm up the coast. A neutral Argentine LNG carrier, Puerto Madryn, is coming the other way, bound for Buenos Aires: an LNG carrier, not a tanker. Sinking her fails the mission. HMS Belfast is to the east, and will take on the escorts if they come near: she is friendly. A P-3AM covers the convoy.',
    build(g, r, carry) {
      g.startClock = clock(15);
      g.timeLimit = 4 * 3600;
      const course = 60;
      g.own.hdg = g.own.ordHdg = 240;
      const start = { x: -25, y: -6 + (r() * 2 - 1) * 3 };
      const dest = offset(start, course, 45);
      const lead = add(g, 'tanker', 'Tanker Rômulo Almeida', 'enemy', start, course, 12, go(course, 12, 1e9));
      const tankers = [lead, ...screen(g, lead, 'tanker', ['Tanker Henrique Dias', 'Tanker Zumbi dos Palmares', 'Tanker Marcílio Dias'], [[90, 1.2], [180, 1.5], [135, 2]])];
      const esc = fresh(carry, ['Mariz e Barros (F203)', 'Cunha Moreira (F202)', 'Jerônimo de Albuquerque (F201)', 'Tamandaré (F200)'], 2);
      const frig = screen(g, lead, 'tamandare', esc, [[30, 3], [200, 3]]);
      const ton = add(g, 'riachuelo', fresh(carry, ['Tonelero (S42)', 'Angostura (S43)', 'Humaitá (S41)'], 1)[0], 'enemy', offset(lead, course, 6), course, 5, { mode: 'transit', legT: 1e9, decoys: 2 }, 1);
      const neutral = add(g, 'lng', 'Puerto Madryn (Argentina, neutral)', 'allied', { x: 20, y: 14 + r() * 3 }, 270, 13, go(270, 13, 1e9));
      void neutral;
      add(g, 'p3am', 'P-3AM Orion', 'enemy', offset(lead, r() * 360, 40), 0, 230, { mode: 'search', center: { x: -10, y: 2 }, wp: { x: -10, y: 2 }, buoyT: 0, torps: 2, datum: null });
      const belfast = add(g, 'type26', 'HMS Belfast', 'allied', offset(g.own, 90, 12), 0, 6, { mode: 'picket', center: offset(g.own, 70, 10) });
      setGoal(g, { targets: ids(tankers), need: 3, win: 'Three tankers are burning off the Uruguayan coast. Brazil\'s southern oil has stopped.', timeout: 'The tankers got up the coast to Rio Grande.' });
      g.script = (gg) => {
        pointDefence(gg, frig, 0.4);
        screenSub(ton, [...tankers, ...frig], offset(lead, course, 5), 13);
        through(gg, tankers, (v) => dist(v, start) > 45 || dist(v, dest) < 3, 'escaped', (v) => `${v.name} is past Chuí and into Brazilian waters.`);
        skirmish(gg, [belfast], [...frig, ton], 6, 0.12, 0.08, 0.5);
        if (flag(gg, 'escaped') >= 2) end(gg, false, 'Two tankers got up the coast. Brazil\'s fuel keeps flowing.');
      };
    },
  },

  // ---- Counteroffensive 3 ------------------------------------------------------------------------
  CA3: {
    key: 'CA3', title: 'White Sea', era: '2029', place: 'White Sea, off Severodvinsk', date: 'February 2030, 0500', night: true,
    library: ['yasen', 'akula', 'arktika', 'virginia'],
    brief: 'Finish the Northern Fleet where it is built. The Sevmash yard at Severodvinsk, 50 nm south-southeast of you, has two more Yasen-Ms fitting out. Land two Tomahawks on the building hall and two on the fitting-out basin. The White Sea is frozen: under the pack you can\'t come above 200 feet or launch anything. There are two patches of open water: a small polynya bearing 150, 10 nm, that the cold will close in about an hour, and a bigger one bearing 200, 22 nm. An S-400 battery covers the yard and will stop some of your missiles. The Yasen Arkhangelsk is out on trials and an Akula guards the bay; the icebreaker Sibir is breaking a channel nearby, loud enough to hide behind. USS Vermont is under the ice with you: she is friendly.',
    build(g, r, carry) {
      g.startClock = clock(5);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 160;
      g.own.depthT = g.own.ordDepth = depthT(300);
      const p1 = { ...offset(g.own, 150, 10), r: 1.6 }, p2 = { ...offset(g.own, 200, 22), r: 2 };
      g.env.ice = true; g.env.polynyas = [p1, p2];
      const hall = site(g, 'Sevmash building hall', offset(g.own, 160, 50));
      const basin = site(g, 'Sevmash fitting-out basin', offset(hall, 90, 1));
      const yasen = add(g, 'yasen', fresh(carry, ['Arkhangelsk (K-564)', 'Perm (K-575)'], 1)[0], 'enemy', offset(p1, r() * 360, 4 + r() * 2), r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, 2);
      const akula = add(g, 'akula', fresh(carry, AKULA, 1)[0], 'enemy', offset(p2, r() * 360, 5), r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, 1);
      add(g, 'arktika', 'Sibir', 'enemy', offset(g.own, 120, 8), 200, 6, { mode: 'wander', center: offset(g.own, 170, 12), rng: 6, cruise: 7 });
      const vermont = add(g, 'virginia', 'USS Vermont (SSN-792)', 'allied', offset(g.own, 250, 4), 180, 6, undefined, 2);
      setGoal(g, { targets: [], win: '', timeout: 'The yard at Severodvinsk is still building boats.' });
      g.script = (gg) => {
        tlamDefence(gg, [{ ...hall, name: 'the S-400 battery at Severodvinsk' }], 12, 0.35);
        launchReported(gg, [yasen, akula], 'the radar at Severodvinsk');
        steer(vermont, offset(akula, 0, 3), 6);
        skirmish(gg, [vermont], [yasen, akula], 5, 0.1, 0.08, 0.5);
        at(gg, 60 * 60, 'freeze', () => {
          gg.env.polynyas = gg.env.polynyas.filter((p) => p !== p1);
          log(gg, 'warn', 'The small polynya bearing 150 has frozen over. The big one to the southwest is the only open water left.');
        });
        if (lift(gg, hall.id) >= 2 && lift(gg, basin.id) >= 2) end(gg, true, 'The building hall is burning and the fitting-out basin is wrecked. The Northern Fleet will build no more Yasens.');
      };
    },
  },

  CP3: {
    key: 'CP3', title: 'Yellow Sea', era: '2029', place: 'Yellow Sea, off Qingdao', date: 'February 2030, 1100',
    library: ['type055', 'type052d', 'type054a', 'type039', 'type093b', 'maya', 'taigei', 'h6j'],
    brief: 'China\'s North Sea Fleet has come out of Qingdao to fight: the Type 055 Nanchang, the Type 052Ds Xining, Urumqi and Qiqihar and the Type 054A Rizhao, about 20 nm north of you heading south, with a Type 039 ahead of them. JS Maya and the submarine JS Hakugei are 12 nm south of you, and the fleet is coming for them. Sink three of the five warships; Maya and Hakugei will fight too. The Yellow Sea is shallow, about 300 feet: nobody can get below the layer, and the bottom is close. Once the group is within 25 nm of Maya it fires YJ-18s at her every 15 minutes, and H-6J bombers are expected about 45 minutes in. If both Japanese ships are lost, so is the battle. Maya and Hakugei are friendly.',
    build(g, r) {
      g.startClock = clock(11);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      g.own.depthT = g.own.ordDepth = 1;
      const lead = add(g, 'type055', 'Nanchang', 'enemy', { x: (r() * 2 - 1) * 5, y: 20 }, 180, 12, go(180, 12, 900));
      const group = [lead, ...screen(g, lead, 'type052d', ['Xining', 'Urumqi', 'Qiqihar'], [[60, 3], [300, 3], [180, 3]]), ...screen(g, lead, 'type054a', ['Rizhao'], [[0, 4]])];
      const yuan = add(g, 'type039', 'Type 039 Yuan (Hull 330)', 'enemy', offset(lead, 180 + (r() * 2 - 1) * 30, 8), 180, 5, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      const maya = add(g, 'maya', 'JS Maya (DDG-179)', 'allied', offset(g.own, 180, 12), 0, 6, { mode: 'picket', center: offset(g.own, 180, 12) });
      const hak = add(g, 'taigei', 'JS Hakugei (SS-516)', 'allied', offset(g.own, 160, 8), 0, 5, undefined, 1);
      const raids: Raid[] = [];
      setGoal(g, { targets: ids(group), need: 3, protect: [maya.id, hak.id], maxLosses: 1, lossText: 'Maya and Hakugei are both gone. The North Sea Fleet has the Yellow Sea.',
        win: 'Three of the North Sea Fleet\'s warships are sunk and the rest are running for Qingdao.', timeout: 'The North Sea Fleet still holds the Yellow Sea.' });
      g.script = (gg) => {
        shallow(gg, 260);
        pointDefence(gg, group, 0.45);
        if (lead.alive) lead.ai!.baseCourse = brg(lead, maya.alive ? maya : hak);
        steer(hak, offset(lead, 180, 6), 7);
        skirmish(gg, [maya, hak], [...group, yuan], 8, 0.08, 0.08, 0.5);
        const live = group.filter((v) => v.alive);
        if (gg.t % 900 === 0 && maya.alive && live.some((v) => dist(v, maya) < 25)) missileSalvo(gg, live[0].name, 'YJ-18', 4, [maya], 0.25, 2);
        at(gg, 45 * 60, 'h6j', () => raid(gg, raids, offset(maya, 330, 120), [maya, hak].filter((v) => v.alive && v.cls.kind === 'surface'), 'h6j', ['H-6J flight 1', 'H-6J flight 2', 'H-6J flight 3'], 450));
        pressRaids(gg, raids, 2, 0.4, 'YJ-12 missiles');
      };
    },
  },

  CG3: {
    key: 'CG3', title: 'The Andaman Bargain', era: '2029', place: 'Andaman Sea', date: 'February 2030, 0800',
    library: ['vikrant', 'kolkata', 'talwar', 'kalvari', 'tanker', 'type901', 'type054a', 'collins', 'p8i'],
    brief: 'India is wavering. Its carrier INS Vikrant, with the destroyers Kolkata and Chennai, the frigate Trishul and the submarine Vagsheer, is escorting a Chinese convoy to Myanmar: two tankers and the supply ship Hulunhu with two Type 054As, about 22 nm east of you heading 340, with a Type 093B somewhere close. Their close-in guns will knock down some of your missiles. Show India the pact is losing, without a massacre. Either sink two of the three Chinese supply ships under Indian eyes, or put a single torpedo into Vikrant and leave her afloat: either way, Vikrant will turn for home. Sink Vikrant, or sink two Indian ships, and India stays in the war for good. The Indians won\'t shoot unless one of their ships is hit. HMAS Rankin is working the Chinese escorts: she is friendly.',
    build(g, r) {
      g.startClock = clock(8);
      g.timeLimit = 3.5 * 3600;
      const course = 340;
      g.own.hdg = g.own.ordHdg = 70;
      const lead = add(g, 'type901', 'Hulunhu', 'enemy', offset(g.own, 70 + r() * 30, 22), course, 12, go(course, 12, 1e9));
      const sup = [lead, ...screen(g, lead, 'tanker', ['Tanker Yuan Yang Hu', 'Tanker Yuan Ning Hu'], [[150, 1.5], [210, 1.5]])];
      const cesc = screen(g, lead, 'type054a', ['Xuzhou', 'Liuzhou'], [[60, 3], [180, 4]]);
      const shang = add(g, 'type093b', 'Type 093B (Hull 421)', 'enemy', offset(lead, course + 120, 4), course, 6, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      const vik = add(g, 'vikrant', 'INS Vikrant', 'enemy', offset(lead, course - 90, 6), course, 12, go(course, 12, 1e9));
      const iesc = screen(g, vik, 'kolkata', ['INS Kolkata', 'INS Chennai'], [[45, 2.5], [315, 2.5]]).concat(screen(g, vik, 'talwar', ['INS Trishul'], [[180, 3]]));
      const vag = add(g, 'kalvari', 'INS Vagsheer', 'enemy', offset(vik, course - 60, 5), course, 6, { mode: 'transit', legT: 1e9, decoys: 2 }, 1);
      const indian = [vik, ...iesc, vag];
      add(g, 'p8i', 'P-8I Neptune', 'enemy', offset(vik, r() * 360, 30), 0, 300, { mode: 'wander', center: { x: vik.x, y: vik.y }, rng: 20, cruise: 300 });
      const rankin = add(g, 'collins', 'HMAS Rankin (SSG 78)', 'allied', offset(lead, course + 90, 7), course, 6, undefined, 1);
      setGoal(g, { targets: [], win: '', timeout: 'The convoy reached Kyaukphyu under Indian escort. India is still in the pact.' });
      g.script = (gg) => {
        const angry = indian.some((v) => v.hp < v.cls.hp);
        if (!angry) {
          // Wavering: the Indian ships keep their stations and don't hunt us unless one of them is hit.
          for (const v of iesc) if (v.ai!.mode === 'hunt') { v.ai!.mode = 'station'; v.ai!.datum = null; }
          if (vik.ai!.mode === 'alert') vik.ai!.mode = 'transit';
          if (vag.alive) { vag.ordHdg = brg(vag, offset(vik, course - 60, 5)); vag.ordSpd = 12; }
        } else if (!gg.flags.angry) {
          gg.flags.angry = 1;
          vag.ai!.mode = 'attack'; vag.ai!.knows = { x: gg.own.x, y: gg.own.y, t: gg.t, deep: gg.own.depthT > 1.5 };
          log(gg, 'danger', 'Radio intercepts: the Indian ships are at action stations and hunting us.', 'alarm');
        }
        steer(rankin, offset(lead, course + 90, 5), 8);
        pointDefence(gg, [...sup, ...cesc], 0.45);
        keepCourse(shang, brg(shang, offset(lead, course + 120, 4)), 9);
        skirmish(gg, [rankin], [...cesc, shang], 5, 0.1, 0.06, 0.5);
        const lost = indian.filter(isSunk).length;
        if (isSunk(vik)) return end(gg, false, 'Vikrant is on the bottom with a thousand sailors. India will never forgive it: it stays in the pact to the end.');
        if (lost >= 2) return end(gg, false, 'Two Indian warships are sunk. It was a massacre, and India stays in the war.');
        const why = sup.filter(isSunk).length >= 2 ? 'The pact could not even protect its own convoy under India\'s eyes.' : vik.hp < vik.cls.hp ? 'One torpedo, and Vikrant left afloat: the message is understood.' : '';
        if (why) end(gg, true, `${why} Vikrant is turning for home, and Delhi is asking for terms.`);
      };
    },
  },

  CS3: {
    key: 'CS3', title: 'Itaguaí', era: '2029', place: 'Off Itaguaí, Brazil', date: 'February 2030, 2100', night: true,
    library: ['riachuelo', 'alvaro', 'tamandare', 'p3am', 'virginia'],
    brief: 'Strike the yard that builds Brazil\'s submarines, at Itaguaí on Sepetiba Bay, 50 nm north of you. Brazil\'s first nuclear boat, Álvaro Alberto, will be rolled out onto the shiplift for launching between 60 and 120 minutes from now. Land two Tomahawks on the shiplift while she is on it, and two on the submarine hall. Hits on the lift before she is on it do nothing. Two Riachuelos and the frigate Jerônimo de Albuquerque are guarding the approaches, and a P-3AM is up. USS Montana is working the approaches with you: she is friendly.',
    build(g, r, carry) {
      g.startClock = clock(21);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const slip = site(g, 'Itaguaí shiplift', { x: 0, y: 50 });
      const shed = site(g, 'Itaguaí submarine hall', offset(slip, 80, 0.8));
      const subs = fresh(carry, ['Humaitá (S41)', 'Tonelero (S42)', 'Angostura (S43)', 'Riachuelo (S40)'], 2)
        .map((n, i) => add(g, 'riachuelo', n, 'enemy', i ? offset(slip, 180 + (r() * 2 - 1) * 20, 14) : offset(g.own, r() * 360, 20), r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1));
      add(g, 'tamandare', fresh(carry, ['Jerônimo de Albuquerque (F201)', 'Cunha Moreira (F202)', 'Mariz e Barros (F203)'], 1)[0], 'enemy', offset(g.own, r() * 60 - 30, 18), 180, 10, { mode: 'patrol', legT: 600 });
      add(g, 'p3am', 'P-3AM Orion', 'enemy', offset(g.own, r() * 360, 40), 0, 230, { mode: 'search', center: { x: 0, y: 15 }, wp: { x: 0, y: 15 }, buoyT: 0, torps: 2, datum: null });
      const mon = add(g, 'virginia', 'USS Montana (SSN-794)', 'allied', offset(g.own, 90, 5), 0, 6, undefined, 1);
      setGoal(g, { targets: [], win: '', timeout: 'The night is over and the yard at Itaguaí is untouched.' });
      g.flags.onLift = 0; g.flags.lastLift = 0;
      g.script = (gg) => {
        steer(mon, offset(subs[0].alive ? subs[0] : subs[1], 90, 3), 6);
        skirmish(gg, [mon], subs, 5, 0.1, 0.08, 0.5);
        at(gg, 60 * 60, 'rollout', () => log(gg, 'warn', 'Intelligence: Álvaro Alberto is out of the hall and on the shiplift. Strike now.'));
        at(gg, 120 * 60, 'launched', () => log(gg, 'warn', 'Intelligence: Álvaro Alberto is off the lift and in the water.'));
        const window = gg.t >= 3600 && gg.t < 7200;
        if (slip.hits > gg.flags.lastLift) {
          if (window) { gg.flags.onLift += slip.hits - gg.flags.lastLift; log(gg, 'good', `Hit on the shiplift with Álvaro Alberto on it (${Math.min(2, gg.flags.onLift)} of 2).`); }
          else log(gg, 'info', 'The shiplift is hit, but Álvaro Alberto isn\'t on it.');
          gg.flags.lastLift = slip.hits;
        }
        if (gg.t >= 7200 && gg.flags.onLift < 2) return end(gg, false, 'Álvaro Alberto is in the water and away from the yard. Brazil has its nuclear submarine.');
        if (gg.flags.onLift >= 2 && shed.hits >= 2) end(gg, true, 'Álvaro Alberto is a wreck on a broken shiplift, and the submarine hall is burning. Brazil\'s submarine programme is finished.');
      };
    },
  },
};

export const extras: Record<MissionKey, ObjectiveFn> = {
  CA1: (g, b) => [...b, watch('Don\'t let three boats past the line 20 nm west', flag(g, 'through') >= 3, `${flag(g, 'through')} of 3 have got through.${flag(g, 'wave2') ? '' : ' Two more boats are due about 50 minutes in.'}`)],
  CP1: (g, b) => [...b, watch('Don\'t let three supply ships reach Taichung', flag(g, 'landed') >= 3, `${flag(g, 'landed')} of 3 have landed.`)],
  CG1: (g, b) => {
    const n = (k: 'a' | 'b') => g.mines.filter((m) => m.side === 'us' && dist(m, { x: g.flags[`${k}x`], y: g.flags[`${k}y`] }) < 1).length;
    const tareq = g.vessels.find((v) => v.name.startsWith('Tareq'));
    const atSea = g.vessels.filter((v) => v.side === 'enemy' && v.cls.kind === 'sub' && v.alive);
    return [
      { text: 'Mine the Bandar Abbas channel (bearing 345, 8 nm)', state: flag(g, 'closedA') ? 'done' : 'open', detail: `${Math.min(3, n('a'))} of 3 mines within 1 nm. ${flag(g, 'minesAboard')} mines left aboard.` },
      { text: 'Mine the Qeshm channel (bearing 300, 9 nm)', state: flag(g, 'closedB') ? 'done' : 'open', detail: `${Math.min(3, n('b'))} of 3 mines within 1 nm.` },
      { text: 'Sink the Kilo Tareq', state: tareq && isSunk(tareq) ? 'done' : 'open' },
      { text: 'Sink every Iranian boat that gets out', state: atSea.length ? 'open' : 'done', detail: atSea.length ? `${atSea.length} at sea.` : 'None at sea.' },
      watch('Don\'t let two boats reach open water', flag(g, 'escaped') >= 2, `${flag(g, 'escaped')} of 2 have got out.`),
      ...b,
    ];
  },
  CS1: (g, b) => [{ text: 'Get the relief convoy into Clarence Bay', state: g.over?.win ? 'done' : 'open', detail: `${flag(g, 'arrived')} ship${flag(g, 'arrived') === 1 ? '' : 's'} in so far. The anchorage is about 24 nm south of where you started.` }, ...b],
  CA2: (g, b) => [...b, watch('Sink her before she is 30 nm west of your start', !!g.over?.reason.includes('launch range'), 'From there her Granits reach the Ford.')],
  CP2: (g, b) => [hitLine(g, -1, 2), hitLine(g, -2, 2), { text: 'Sink the Type 055 group, or keep your Tomahawks 8 nm clear of it', state: 'open', detail: `${g.vessels.filter((v) => ['type055', 'type052d'].includes(v.cls.key) && isSunk(v)).length} of 3 sunk.` }, ...b],
  CG2: (g, b) => [hitLine(g, -1, 3), hitLine(g, -2, 2), { text: 'Launch from inside 25 nm of the base', state: 'open', detail: `You are ${dist(g.own, g.sites[0]).toFixed(0)} nm from the base. The mines lie 28 nm north of where you started.` }, ...b],
  CS2: (g, b) => [...b,
    watch('Don\'t sink the neutral LNG carrier Puerto Madryn', g.vessels.some((v) => v.cls.key === 'lng' && isSunk(v))),
    watch('Don\'t let two tankers get 45 nm up the coast', flag(g, 'escaped') >= 2, `${flag(g, 'escaped')} of 2 have got away.`)],
  CA3: (g, b) => [hitLine(g, -1, 2), hitLine(g, -2, 2),
    { text: 'Launch from open water', state: 'open', detail: flag(g, 'freeze') ? 'Only the polynya bearing 200, 22 nm from where you started, is still open.' : `Polynyas: bearing 150, 10 nm (closes in ${mins(60 * 60 - g.t)}) and bearing 200, 22 nm.` }, ...b],
  CP3: (g, b) => [...b, { text: 'Shoot down the H-6J bombers', state: 'open', detail: flag(g, 'h6j') ? 'They are on their way.' : `Expected in ${mins(45 * 60 - g.t)}.` }],
  CG3: (g, b) => {
    const sup = g.vessels.filter((v) => ['tanker', 'type901'].includes(v.cls.key));
    const vik = g.vessels.find((v) => v.cls.key === 'vikrant')!;
    const ind = g.vessels.filter((v) => ['vikrant', 'kolkata', 'talwar', 'kalvari'].includes(v.cls.key));
    return [
      { text: 'Either sink two of the three Chinese supply ships', state: sup.filter(isSunk).length >= 2 ? 'done' : 'open', detail: `${sup.filter(isSunk).length} of 2 sunk.` },
      { text: 'Or put one torpedo into Vikrant and leave her afloat', state: vik.alive && vik.hp < vik.cls.hp ? 'done' : isSunk(vik) ? 'failed' : 'open' },
      watch('Don\'t sink Vikrant', isSunk(vik)),
      watch('Don\'t sink two Indian ships', ind.filter(isSunk).length >= 2, `${ind.filter(isSunk).length} sunk so far.`),
      ...b,
    ];
  },
  CS3: (g, b) => [
    { text: 'Land 2 Tomahawks on the shiplift while Álvaro Alberto is on it', state: flag(g, 'onLift') >= 2 ? 'done' : g.t >= 7200 ? 'failed' : 'open',
      detail: `${Math.min(2, flag(g, 'onLift'))} of 2. ${g.t < 3600 ? `She rolls out in ${mins(3600 - g.t)}.` : g.t < 7200 ? `She is on the lift for ${mins(7200 - g.t)} more.` : 'She is in the water.'}` },
    hitLine(g, -2, 2), ...b,
  ],
};
