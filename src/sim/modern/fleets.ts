// Modern war missions: fleets. See the Modern Campaign Plan and src/sim/warData.ts for where each one sits in the war.
// The big set pieces Scott asked for: whole carrier groups to hunt, and landings with the landing craft already in the water.
// A26 and A27 are Act 1 against Russia (the northern and southern flanks), P27 and P28 are Act 2 against China.
import { brg, dist, fmtBrg, offset, type Vec } from '../math';
import { end, excess, log, vesselSL, type Game, type Vessel } from '../sim';
import {
  add, alive, arrive, at, clock, flag, go, ids, isSunk, keepCourse, pointDefence, screen, setGoal, watch, markAt,
  type Mission, type MissionKey, type ObjectiveFn,
} from '../kit';

export const missions: Record<MissionKey, Mission> = {};
export const extras: Record<MissionKey, ObjectiveFn> = {};

// ---- Local helpers --------------------------------------------------------------------------------
/** A search pattern for aircraft that aren't hunting us: quarter the area at `cruise` knots. */
export const wander = (center: Vec, rng: number, cruise: number) => ({ mode: 'wander' as const, center, rng, cruise });
/** A maritime patrol aircraft working a box with sonobuoys and torpedoes. */
export const patrolPlane = (center: Vec, torps = 2) => ({ mode: 'search' as const, center, wp: { ...center }, buoyT: 0, torps, datum: null });
/** A dipping ASW helicopter hunting around a point, with one torpedo. */
export const dipper = (center: Vec) => ({ mode: 'search' as const, center: { ...center }, wp: { ...center }, torps: 1, datum: null, hits: 0, dipT: 0 });
const sub = (g: Game, cls: string, name: string, p: Vec, hdg: number, spd: number) =>
  add(g, cls, name, 'enemy', p, hdg, spd, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
const byName = (g: Game, name: string) => g.vessels.find((v) => v.name === name && v.side === 'enemy');
const dmg = (v: Vessel | undefined) => (v ? Math.max(0, v.cls.hp - v.hp) : 0);
/**
 * The carrier is gone: the senior ship left stays by the wreck to pick up survivors, slow, and the rest of the
 * screen forms up on her instead of scattering. Run once, when the carrier sinks.
 */
export function standBy(g: Game, cv: Vessel, ships: Vessel[], course: number) {
  if (cv.alive || g.flags.standBy) return;
  const lead = ships.find((v) => v.alive);
  if (!lead?.ai) return;
  g.flags.standBy = 1;
  Object.assign(lead.ai, { mode: 'transit', baseCourse: course, cruise: 6, zig: 0, legT: 1e9, leader: undefined });
  ships.forEach((v, i) => {
    if (v === lead || !v.alive || !v.ai || v.ai.mode !== 'station') return;
    Object.assign(v.ai, { leader: lead.id, rel: (i * 72) % 360, rng: 3 });
  });
  log(g, 'info', `Sonar: ${lead.name} has slowed right down near where ${cv.name} went down. She is standing by to pick up survivors.`);
}
/**
 * Escorts on station listen with their hull sonar, dulled by their own speed and the noise of the group.
 * One that holds Tang for a minute leaves the screen to attack, two at most at a time; when it loses us
 * for good it goes back on station.
 */
export function listen(g: Game, ships: Vessel[]) {
  const o = g.own;
  for (const v of ships) {
    if (!v.alive || !v.ai || v.cls.threshold === null) continue;
    const ai = v.ai, k = `hear${v.id}`;
    if (ai.mode === 'station') {
      const se = excess(vesselSL(o), o, { x: v.x, y: v.y, hdg: v.hdg, spd: v.spd, depthT: 0 }, v.cls.threshold + 7) + (g.r() * 2 - 1) * 2;
      g.flags[k] = se > 0 ? (g.flags[k] ?? 0) + 1 : Math.max(0, (g.flags[k] ?? 0) - 1);
      const out = ships.filter((x) => x.alive && g.flags[`home${x.id}`]).length;
      if (g.flags[k] >= 60 && out < 2) {
        g.flags[k] = 0; g.flags[`home${v.id}`] = 1;
        Object.assign(ai, { mode: 'attack', holdT: 60, knows: { x: o.x, y: o.y, t: g.t, deep: o.depthT > 1.5 } });
        log(g, 'danger', `Sonar: a contact on bearing ${fmtBrg(brg(o, v))} has turned toward us and is speeding up. One of the escorts has us on her sonar.`, 'alarm');
      }
    } else if (ai.mode === 'patrol' && g.flags[`home${v.id}`] && ai.leader !== undefined && g.vessels.find((x) => x.id === ai.leader)?.alive) {
      g.flags[`home${v.id}`] = 0; ai.mode = 'station';
    }
  }
}

/**
 * A landing in progress. The landing ships close to `standoff` nm off the beach and hold there, each putting a
 * landing craft in the water every `every` seconds while it has any left; some craft are already on their way in
 * when the mission starts. Craft run straight for the beach and nothing turns them. Every craft that reaches it
 * counts toward `limit`; at the limit the landing has succeeded.
 */
interface Landing {
  beach: Vec; ships: Vessel[]; cls: string; label: string; cruise: number; standoff: number; limit: number;
  /** Craft aboard each landing ship at the start, and the seconds between her launches. */
  stock: number[]; every: number[];
}
/** Put the landing on the game: craft left aboard and the next launch time live in the flags, per ship. */
function startLanding(g: Game, L: Landing, firstWave: Vec[]) {
  L.ships.forEach((s, i) => { g.flags[`stock${s.id}`] = L.stock[i]; g.flags[`next${s.id}`] = L.every[i] * (0.5 + i * 0.25); });
  for (const p of firstWave) launchCraft(g, L, p);
  g.flags.ashore = 0;
}
const craftOf = (g: Game, cls: string) => g.vessels.filter((v) => v.cls.key === cls);
function launchCraft(g: Game, L: Landing, from: Vec) {
  const n = craftOf(g, L.cls).length + 1, c = brg(from, L.beach);
  return add(g, L.cls, `${L.label} ${n}`, 'enemy', from, c, L.cruise, go(c, L.cruise, 1e9));
}
function runLanding(g: Game, L: Landing, fail: string) {
  L.ships.forEach((s, i) => {
    if (!s.alive || !s.ai) return;
    const r = dist(s, L.beach);
    if (s.ai.mode === 'transit') { s.ai.baseCourse = brg(s, L.beach); s.ai.cruise = r > L.standoff ? 8 : 0; s.ai.zig = 0; }
    if (r > L.standoff + 2 || !flag(g, `stock${s.id}`) || g.t < flag(g, `next${s.id}`)) return;
    g.flags[`stock${s.id}`]--; g.flags[`next${s.id}`] = g.t + L.every[i];
    const v = launchCraft(g, L, offset(s, brg(s, L.beach), 0.3));
    log(g, 'warn', `Sonar: a new fast contact close by ${s.name}. Another landing craft is in the water and running for the beach (${v.name}).`);
  });
  for (const c of craftOf(g, L.cls)) {
    if (!c.alive || !c.ai) continue;
    // Nothing turns a landing craft once it's on its run: no zigzag, no turning away.
    Object.assign(c.ai, { mode: 'transit', baseCourse: brg(c, L.beach), cruise: L.cruise, zig: 0, legT: 1e9 });
    if (arrive(g, c, L.beach, 0.8)) {
      g.flags.ashore = flag(g, 'ashore') + 1;
      log(g, 'danger', `${c.name} has reached the beach. ${g.flags.ashore} of ${L.limit} landing craft ashore.`);
    }
  }
  if (flag(g, 'ashore') >= L.limit) end(g, false, fail);
}
const craftAfloat = (g: Game, cls: string) => craftOf(g, cls).filter((c) => c.alive).length;
/** Craft still aboard the landing ships that are afloat (the ships are the goal's targets). */
const craftLeft = (g: Game) => g.goal.targets.reduce((n, id) => n + (g.vessels.find((v) => v.id === id)?.alive ? flag(g, `stock${id}`) : 0), 0);
/** The beach label on the plot, kept current. */
const beachLabel = (g: Game, cls: string, limit: number) => `Beach: ${flag(g, 'ashore')} of ${limit} ashore, ${craftAfloat(g, cls)} coming`;
/** The landing's objective line, with the live counts. */
const landingWatch = (g: Game, text: string, cls: string, limit: number) =>
  watch(text, flag(g, 'ashore') >= limit, `${flag(g, 'ashore')} of ${limit} ashore. ${craftAfloat(g, cls)} in the water now, ${craftLeft(g)} more aboard the landing ships still afloat.`);

// ---- A26 Northern Fleet -------------------------------------------------------------------------------
const A26_LIB = ['kuznetsov', 'kirov', 'udaloy', 'gorshkov', 'yasen', 'akula', 'ka27', 'il38', 'virginia'];
missions.A26 = {
  key: 'A26', title: 'Northern Fleet', era: '2029', place: 'Norwegian Sea', date: 'May 2029, 0500',
  library: A26_LIB,
  brief: 'Russia has sent its only carrier to sea. Admiral Kuznetsov is coming down the Norwegian Sea at 12 knots with the whole Northern Fleet surface group around her, about 30 nm north of you and heading your way, to cover a strike on the Norwegian coast. With her: the nuclear battlecruiser Pyotr Velikiy (Admiral Nakhimov, if Pyotr Velikiy is already on the bottom) out ahead, the Udaloy destroyers Vice-Admiral Kulakov and Severomorsk on the flanks, and the frigate Admiral Gorshkov astern. The Yasen-M Arkhangelsk sweeps out on one bow, two Ka-27s fly round the group and an Il-38 is due from Severomorsk to work a sonobuoy box ahead of it. Sink Kuznetsov and the battlecruiser, or Kuznetsov and two of her three escorts (the Udaloys and the frigate). Kuznetsov takes three Mk 48s, the battlecruiser three more, an escort two. Kuznetsov\'s worn-out steam plant gives her about 24 knots at most, so she can\'t outrun a torpedo for long. Their air defence stops most anti-ship missiles, and the Udaloys have good sonar and will come after you if they hear you. If the carrier gets more than 50 nm away from you, she\'s gone. Anything else you sink is a bonus.',
  build(g, r, carry) {
    g.startClock = clock(5);
    g.timeLimit = 5 * 3600;
    g.own.hdg = g.own.ordHdg = 0;
    const course = 200 + (r() * 2 - 1) * 12;
    const p = offset(g.own, (r() * 2 - 1) * 15, 29 + r() * 4);
    const cv = add(g, 'kuznetsov', 'Admiral Kuznetsov', 'enemy', p, course, 12, go(course, 12));
    const bcName = alive(carry, 'Pyotr Velikiy') ? 'Pyotr Velikiy' : 'Admiral Nakhimov';
    const [bc] = screen(g, cv, 'kirov', [bcName], [[0, 6]]);
    const scr = [
      bc,
      ...screen(g, cv, 'udaloy', ['Vice-Admiral Kulakov', 'Severomorsk'], [[70, 4], [290, 4]]),
      ...screen(g, cv, 'gorshkov', ['Admiral Gorshkov'], [[180, 3.5]]),
    ];
    const esc = scr.slice(1);
    const side = r() < 0.5 ? 1 : -1;
    const ssn = sub(g, 'yasen', 'Arkhangelsk', offset(cv, course + side * 40, 10), course, 8);
    const helos = [
      add(g, 'ka27', 'Ka-27PL Helix (Kuznetsov)', 'enemy', offset(cv, course, 6), course, 120, dipper(offset(cv, course, 8))),
      add(g, 'ka27', 'Ka-27PL Helix (Pyotr)', 'enemy', offset(cv, r() * 360, 3), 0, 120, wander({ x: cv.x, y: cv.y }, 9, 120)),
    ];
    setGoal(g, {
      targets: [cv.id, bc.id], need: 2,
      win: `Admiral Kuznetsov and ${bcName} are going down. The Northern Fleet has lost its two biggest ships in one morning.`,
      timeout: 'The carrier group is still afloat and covering the strike on Norway.',
    });
    g.script = (gg) => {
      pointDefence(gg, [cv, ...scr], 0.7);
      listen(gg, scr);
      const sta = offset(cv, course + side * 40, 10);
      keepCourse(ssn, dist(ssn, sta) > 3 ? brg(ssn, sta) : course + Math.sin(gg.t / 600) * 40, dist(ssn, sta) > 3 ? 12 : 8);
      const lead = cv.alive ? cv : bc;
      for (const h of helos) if (h.alive) h.ai!.center = h.ai!.mode === 'wander' ? { x: lead.x, y: lead.y } : offset(lead, course, 8);
      // The Il-38 comes on task from Severomorsk an hour and a half in, and works a box ahead of the group.
      at(gg, 5400, 'il38', () => {
        add(gg, 'il38', 'Il-38N May', 'enemy', offset(lead, course + 180, 40), course, 230, patrolPlane(offset(lead, course, 6), 1));
        log(gg, 'warn', 'ESM: a maritime patrol radar to the north, closing. An Il-38 is coming to join the group.');
      });
      standBy(gg, cv, scr, course);
      if (isSunk(cv) && esc.filter(isSunk).length >= 2) end(gg, true, 'Admiral Kuznetsov is going down with two of her escorts. What is left of the Northern Fleet group is turning for home.');
      if (cv.alive && dist(gg.own, cv) > 50) end(gg, false, 'Admiral Kuznetsov is more than 50 nm away and still going. We have lost her.');
    };
  },
};
extras.A26 = (g, b) => {
  const cv = byName(g, 'Admiral Kuznetsov'), bc = g.vessels.find((v) => v.cls.key === 'kirov');
  const esc = g.vessels.filter((v) => v.cls.key === 'udaloy' || v.cls.key === 'gorshkov');
  const either = !!cv && isSunk(cv) && (!!bc && isSunk(bc) || esc.filter(isSunk).length >= 2);
  return [
    { text: `Sink Kuznetsov and ${bc?.name ?? 'the battlecruiser'}, or Kuznetsov and two escorts`, state: either ? 'done' : 'open', detail: `Escorts sunk: ${esc.filter(isSunk).length} of 3.` },
    ...b.filter((o) => !o.text.startsWith('Sink')),
    { text: 'Hits on Kuznetsov', state: cv && isSunk(cv) ? 'done' : 'open', detail: `${dmg(cv)} of 14 damage points. Each Mk 48 hit is 5.` },
    { text: `Hits on ${bc?.name ?? 'the battlecruiser'}`, state: bc && isSunk(bc) ? 'done' : 'open', detail: `${dmg(bc)} of 12 damage points.` },
    watch('Don\'t let the carrier get 50 nm away', !!g.over?.reason.includes('lost her'), cv?.alive ? `${dist(g.own, cv).toFixed(0)} nm away now.` : undefined)];
};

// ---- A27 Gotland Landing ---------------------------------------------------------------------------------
const A27_LIB = ['ropucha', 'ivangren', 'serna', 'steregushchiy', 'kilo', 'ka27', 'virginia'];
missions.A27 = {
  key: 'A27', title: 'Gotland Landing', era: '2029', place: 'Off Slite, Gotland', date: 'May 2029, 0340', night: true,
  library: A27_LIB,
  brief: 'The Baltic Fleet has come for Gotland. Four Ropucha landing ships (Kaliningrad, Minsk, Korolev and Aleksandr Shabalin) and the new Ivan Gren-class Vladimir Andreyev are standing off the beach at Slite, on the island\'s east coast, and the first wave of Serna landing craft is already in the water and running in. The beach is about 7 nm to your west; the landing ships are holding about 20 nm out, some 12 nm east of you, and the craft are running in past you at 26 knots. Each landing ship puts another Serna in the water every 7 or 8 minutes while she has any left (five each). Three Steregushchiy corvettes (Steregushchiy, Soobrazitelny and Boikiy) guard the transport area, two Ka-27s are up and a Kilo is somewhere off the beach. If six landing craft reach the beach, the Russians have a battalion ashore and the mission fails. Sink four of the five landing ships and the landing is called off. A Serna is small, fast and fragile: one hit of anything stops it, so an NSM or a torpedo at the craft buys time. The beach is marked on the plot with the count.',
  build(g, r) {
    g.startClock = clock(3, 40);
    g.timeLimit = 3 * 3600;
    const beach = offset(g.own, 270 + (r() * 2 - 1) * 10, 7 + r());
    const mark = markAt(g, beach, 'Beach', 0.8);
    const toSea = brg(beach, g.own);
    const area = offset(beach, toSea + (r() * 2 - 1) * 8, 19 + r());
    g.own.hdg = g.own.ordHdg = toSea;
    const names: [string, string][] = [['ropucha', 'Kaliningrad'], ['ropucha', 'Minsk'], ['ivangren', 'Vladimir Andreyev'], ['ropucha', 'Korolev'], ['ropucha', 'Aleksandr Shabalin']];
    const ships = names.map(([c, n], i) => {
      const p = offset(area, toSea + 90, (i - 2) * 1.6);
      return add(g, c, n, 'enemy', p, brg(p, beach), 0, go(brg(p, beach), 0, 1e9));
    });
    const corv = [
      add(g, 'steregushchiy', 'Steregushchiy', 'enemy', offset(area, brg(area, beach), 3), brg(area, beach), 8, wander(offset(area, brg(area, beach), 3), 4, 10)),
      ...screen(g, ships[0], 'steregushchiy', ['Soobrazitelny'], [[180, 2.5]]),
      ...screen(g, ships[4], 'steregushchiy', ['Boikiy'], [[180, 2.5]]),
    ];
    const kilo = sub(g, 'kilo', 'Kilo (Dmitrov)', offset(beach, toSea + (r() * 2 - 1) * 30, 5 + r() * 2), r() * 360, 4);
    const helos = [
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(area, brg(area, beach), 5), 0, 120, dipper(offset(area, brg(area, beach), 6))),
      add(g, 'ka27', 'Ka-27PS Helix', 'enemy', offset(area, r() * 360, 3), 0, 120, wander({ x: area.x, y: area.y }, 7, 110)),
    ];
    const L: Landing = { beach, ships, cls: 'serna', label: 'Serna', cruise: 26, standoff: 20, limit: 6, stock: ships.map(() => 5), every: ships.map(() => 450) };
    // The first wave: four craft already on the way in, spread across the run.
    startLanding(g, L, [0, 1, 2, 3].map((i) => offset(beach, toSea + (i - 1.5) * 10, 8.5 + i * 0.8)));
    setGoal(g, {
      targets: ids(ships), need: 4,
      win: 'Four landing ships are sinking off Slite. The Baltic Fleet has called off the landing; the craft already ashore are cut off.',
      timeout: 'The landing ships are still off the beach, putting their troops ashore.',
    });
    g.script = (gg) => {
      pointDefence(gg, [...corv, ...ships], 0.5);
      listen(gg, corv);
      runLanding(gg, L, 'Six landing craft reached the beach at Slite. A Russian battalion is ashore on Gotland.');
      mark.label = beachLabel(gg, L.cls, L.limit);
      keepCourse(kilo, kilo.ai?.mode === 'patrol' ? brg(kilo, beach) + 90 + Math.sin(gg.t / 900) * 90 : kilo.hdg, 4);
      const lead = ships.find((s) => s.alive) ?? ships[0];
      helos[0].ai!.center = offset(lead, brg(lead, beach), 5);
    };
  },
};
extras.A27 = (g, b) => [...b, landingWatch(g, 'Don\'t let six landing craft reach the beach', 'serna', 6)];

// ---- P27 The Whole Group ------------------------------------------------------------------------------------
const P27_LIB = ['shandong', 'fujian', 'type055', 'type052d', 'type054a', 'type901', 'type093b', 'ka28', 'kq200', 'virginia'];
missions.P27 = {
  key: 'P27', title: 'The Whole Group', era: '2029', place: 'Philippine Sea', date: 'August 2029, 0430',
  library: P27_LIB,
  brief: 'China has put its whole carrier group back to sea, east of Luzon, to cover a push on the Philippines. The carrier Shandong (Fujian, if Shandong is already on the bottom) is at the centre, making 16 knots east about 30 nm west of you. Her screen is the strongest China has: the Type 055 cruisers Anshan and Dalian ahead and astern, the Type 052D destroyers Kunming and Chengdu on the bows, the frigate Binzhou and the supply ship Chaganhu. The Type 093B Changzheng 20 sweeps ahead of the group, two Ka-28s fly round it and a KQ-200 patrol plane works a sonobuoy line out ahead. Break the group: sink the carrier and both Type 055 cruisers. The carrier takes three Mk 48s, each cruiser two. Their air defence stops nearly every missile, so it\'s torpedo work. If the carrier gets more than 50 nm away from you, she\'s gone. Everything else in the group is fair game once the job is done.',
  build(g, r, carry) {
    g.startClock = clock(4, 30);
    g.timeLimit = 5 * 3600;
    g.own.hdg = g.own.ordHdg = 270;
    const course = 90 + (r() * 2 - 1) * 10;
    const p = offset(g.own, 270 + (r() * 2 - 1) * 12, 29 + r() * 4);
    const [cls, name] = alive(carry, 'Shandong') || !alive(carry, 'Fujian') ? ['shandong', 'Shandong'] : ['fujian', 'Fujian'];
    const cv = add(g, cls, name, 'enemy', p, course, 16, go(course, 16));
    const cr = screen(g, cv, 'type055', ['Anshan', 'Dalian'], [[0, 4], [180, 4]]);
    const scr = [
      ...cr,
      ...screen(g, cv, 'type052d', ['Kunming', 'Chengdu'], [[55, 3.5], [305, 3.5]]),
      ...screen(g, cv, 'type054a', ['Binzhou'], [[120, 4]]),
      ...screen(g, cv, 'type901', ['Chaganhu'], [[230, 2]]),
    ];
    const side = r() < 0.5 ? 1 : -1;
    const ssn = sub(g, 'type093b', 'Changzheng 20', offset(cv, course + side * 35, 10), course, 8);
    const helos = [
      add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(cv, course, 6), course, 120, wander(offset(cv, course, 8), 6, 120)),
      add(g, 'ka28', 'Ka-28 Helix (2)', 'enemy', offset(cv, r() * 360, 3), 0, 120, wander({ x: cv.x, y: cv.y }, 8, 120)),
    ];
    add(g, 'kq200', 'KQ-200', 'enemy', offset(cv, course, 20), course, 300, patrolPlane(offset(cv, course, 18), 1));
    setGoal(g, {
      targets: [cv.id, ...ids(cr)], need: 3,
      win: `${name}, Anshan and Dalian are all going down. China's carrier group is broken.`,
      timeout: `${name}'s group is still at sea, covering the push on the Philippines.`,
    });
    g.script = (gg) => {
      pointDefence(gg, [cv, ...scr], 0.8);
      listen(gg, scr);
      standBy(gg, cv, scr, course);
      const sta = offset(cv, course + side * 35, 10);
      keepCourse(ssn, dist(ssn, sta) > 3 ? brg(ssn, sta) : course + Math.sin(gg.t / 600) * 40, dist(ssn, sta) > 3 ? 12 : 8);
      const lead = cv.alive ? cv : cr.find((c) => c.alive) ?? cv;
      for (const h of helos) if (h.alive) h.ai!.center = h.ai!.mode === 'wander' ? { x: lead.x, y: lead.y } : offset(lead, course, 8);
      if (cv.alive && dist(gg.own, cv) > 50) end(gg, false, `${name} is more than 50 nm away and still going. We have lost her.`);
    };
  },
};
extras.P27 = (g, b) => {
  const cv = g.vessels.find((v) => v.side === 'enemy' && (v.cls.key === 'shandong' || v.cls.key === 'fujian'));
  const cr = g.vessels.filter((v) => v.cls.key === 'type055');
  return [...b,
    { text: `Hits on ${cv?.name ?? 'the carrier'}`, state: cv && isSunk(cv) ? 'done' : 'open', detail: `${dmg(cv)} of ${cv?.cls.hp ?? 12} damage points. Each Mk 48 hit is 5.` },
    { text: 'Hits on the cruisers', state: cr.length && cr.every(isSunk) ? 'done' : 'open', detail: cr.map((c) => `${c.name} ${dmg(c)} of ${c.cls.hp}`).join(', ') + '.' },
    watch('Don\'t let the carrier get 50 nm away', !!g.over?.reason.includes('lost her'), cv?.alive ? `${dist(g.own, cv).toFixed(0)} nm away now.` : undefined)];
};

// ---- P28 Beachhead --------------------------------------------------------------------------------------------
const P28_LIB = ['type075', 'type071', 'type726', 'type052d', 'type054a', 'type056', 'type039', 'ka28', 'virginia'];
missions.P28 = {
  key: 'P28', title: 'Beachhead', era: '2029', place: 'Off Taoyuan, Taiwan', date: 'August 2029, 0510',
  library: P28_LIB,
  brief: 'The landing on Taiwan has begun. The Type 075 assault ship Guangxi and the Type 071 docks Jinggang Shan and Longhu Shan are holding about 20 nm off the beach north of Taoyuan, and the first wave of Type 726 hovercraft is already in the water, running in at 28 knots. The beach is about 10 nm to your east; the landing ships are about 12 nm west of you, so the craft are coming right past you. Each dock puts another hovercraft in the water every 10 minutes, Guangxi every 15, until they run out. The destroyers Suzhou and Baotou, the frigate Zaozhuang and the corvette Yingkou guard them, two Ka-28s are up, and a Type 039 Yuan is lying in wait in the strait. If six hovercraft reach the beach, the beachhead holds and the mission fails. Sink two of the three landing ships and the landing is called off. A hovercraft is loud and fast but fragile: one hit stops it, and a torpedo fired across its path will catch it. The beach is marked on the plot with the count.',
  build(g, r) {
    g.startClock = clock(5, 10);
    g.timeLimit = 3 * 3600;
    const beach = offset(g.own, 90 + (r() * 2 - 1) * 10, 10 + r());
    const mark = markAt(g, beach, 'Beach', 0.8);
    const toSea = brg(beach, g.own);
    const area = offset(beach, toSea + (r() * 2 - 1) * 8, 21 + r());
    const lhd = add(g, 'type075', 'Guangxi', 'enemy', area, brg(area, beach), 0, go(brg(area, beach), 0, 1e9));
    const lpd = (['Jinggang Shan', 'Longhu Shan'] as const).map((n, i) => {
      const p = offset(area, toSea + (i ? 90 : -90), 2);
      return add(g, 'type071', n, 'enemy', p, brg(p, beach), 0, go(brg(p, beach), 0, 1e9));
    });
    const ships = [lhd, ...lpd];
    g.own.hdg = g.own.ordHdg = toSea;
    const esc = [
      ...screen(g, lhd, 'type052d', ['Suzhou', 'Baotou'], [[-60, 3.5], [60, 3.5]]),
      ...screen(g, lhd, 'type054a', ['Zaozhuang'], [[0, 4]]),
      add(g, 'type056', 'Yingkou', 'enemy', offset(area, brg(area, beach), 6), brg(area, beach), 10, wander(offset(area, brg(area, beach), 6), 4, 12)),
    ];
    const yuan = sub(g, 'type039', 'Yuan (Changcheng 336)', offset(g.own, toSea + (r() * 2 - 1) * 40, 5 + r() * 2), r() * 360, 3);
    const helos = [
      add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(area, brg(area, beach), 5), 0, 120, dipper(offset(area, brg(area, beach), 7))),
      add(g, 'ka28', 'Ka-28 Helix (2)', 'enemy', offset(area, r() * 360, 3), 0, 120, wander({ x: area.x, y: area.y }, 7, 110)),
    ];
    // Guangxi launches every 15 minutes, the docks every 10.
    const L: Landing = { beach, ships, cls: 'type726', label: 'LCAC', cruise: 28, standoff: 21, limit: 6, stock: [2, 3, 3], every: [900, 600, 600] };
    // The first wave is already on its way in: four craft between the ships and Tang.
    startLanding(g, L, [0, 1, 2, 3].map((i) => offset(beach, toSea + (i - 1.5) * 6, 15 + i * 1.2)));
    setGoal(g, {
      targets: ids(ships), need: 2,
      win: 'Two of the three landing ships are going down. The landing off Taoyuan has been called off; the craft already ashore are cut off.',
      timeout: 'The landing ships are still off the beach, putting troops ashore.',
    });
    g.script = (gg) => {
      pointDefence(gg, [...esc, ...ships], 0.6);
      listen(gg, esc);
      runLanding(gg, L, 'Six hovercraft reached the beach. China has a beachhead north of Taoyuan.');
      mark.label = beachLabel(gg, L.cls, L.limit);
      keepCourse(yuan, brg(yuan, beach) + 90 + Math.sin(gg.t / 900) * 90, 3);
      const lead = ships.find((s) => s.alive) ?? lhd;
      helos[0].ai!.center = offset(lead, brg(lead, beach), 7);
    };
  },
};
extras.P28 = (g, b) => [...b, landingWatch(g, 'Don\'t let six hovercraft reach the beach', 'type726', 6)];
