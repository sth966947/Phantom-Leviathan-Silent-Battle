// Missions: who is where at the start, what the player must do, and the script that runs the
// mission's events (strike waves launching, pickets reporting, midget subs reaching harbour).
// The WWII campaign runs in date order; ships sunk in earlier missions stay sunk (`Carry`).

import { brg, dist, norm, offset, type Vec } from './math';
import { end, fireStraight, log, makeAI, makeVessel, shellfire, type AI, type Game, type Goal, type Side, type Vessel } from './sim';

export type MissionKey =
  | 'bismarck' | 'midgets' | 'kidobutai' | 'forcez' | 'javasea' | 'sunda' | 'doolittle' | 'coralsea' | 'midway' | 'pq17'
  | 'savo' | 'eastsol' | 'santacruz' | 'guadalcanal' | 'tassafaronga' | 'komandorski' | 'ons5' | 'northcape'
  | 'philsea' | 'leyte' | 'shinano' | 'tengo'
  | 'riverplate' | 'narvik' | 'calabria' | 'taranto' | 'matapan' | 'duel';

/** What earlier missions changed: the names of enemy ships Tang has already sunk. */
export interface Carry { sunk: string[] }

export interface Mission {
  key: MissionKey; title: string; era: '1941' | '2029'; place: string; date: string;
  night?: boolean; library: string[]; brief: string;
  build: (g: Game, r: () => number, carry: Carry) => void;
}

/** The WWII campaign, in date order. */
export const CAMPAIGN: MissionKey[] = ['bismarck', 'midgets', 'kidobutai', 'forcez', 'javasea', 'sunda', 'doolittle', 'coralsea', 'midway', 'pq17',
  'savo', 'eastsol', 'santacruz', 'guadalcanal', 'tassafaronga', 'komandorski', 'ons5', 'northcape', 'philsea', 'leyte', 'shinano', 'tengo'];
/** Before the vortex: optional stand-alone battles from 1939 to early 1941, open from the start and outside the story. */
export const PREQUELS: MissionKey[] = ['riverplate', 'narvik', 'calabria', 'taranto', 'matapan'];

// ---- Building blocks ---------------------------------------------------------------------------
function add(g: Game, cls: string, name: string, side: Side, p: Vec, hdg: number, spd: number, ai?: Partial<AI>, depth: 0 | 1 | 2 = 0): Vessel {
  const v = makeVessel(g, cls, name, side, p, hdg, spd, depth);
  if (ai) v.ai = makeAI(ai);
  g.vessels.push(v);
  return v;
}
/** Ships keeping station on a leader at the given relative bearings and ranges. */
function screen(g: Game, lead: Vessel, cls: string, names: string[], spots: [number, number][], side: Side = lead.side) {
  return names.map((n, i) => {
    const [rel, rng] = spots[i % spots.length];
    return add(g, cls, n, side, offset(lead, lead.hdg + rel, rng), lead.hdg, lead.spd, { mode: 'station', leader: lead.id, rel, rng });
  });
}
const RING: [number, number][] = [[0, 3], [60, 3], [120, 3], [180, 3], [240, 3], [300, 3], [30, 5], [330, 5]];
const setGoal = (g: Game, o: Partial<Goal>) => Object.assign(g.goal, o);
const alive = (carry: Carry, name: string) => !carry.sunk.includes(name);
const ids = (vs: Vessel[]) => vs.map((v) => v.id);
const clock = (h: number, m = 0) => h * 3600 + m * 60;

/** Each alive carrier puts a strike flight in the air toward `target`. */
function launchStrike(g: Game, carriers: Vessel[], target: Vec, wave: string) {
  const up = carriers.filter((c) => c.alive);
  for (const c of up) {
    const v = add(g, 'kate', `${wave} flight (${c.name})`, 'enemy', offset(c, brg(c, target), 1), brg(c, target), 140, { mode: 'strike', goal: target, cruise: 140 });
    v.track = [];
  }
  if (up.length) log(g, 'warn', `Radio intercepts: the carriers are launching the ${wave.toLowerCase()}. ${up.length} strike flight${up.length > 1 ? 's' : ''} outbound. Radar at periscope depth will see them high up out to 100 nm.`);
  g.flags.flightsLaunched = (g.flags.flightsLaunched ?? 0) + up.length;
}
/** Run the script once at time t. */
const at = (g: Game, t: number, key: string, fn: () => void) => { if (g.t >= t && !g.flags[key]) { g.flags[key] = 1; fn(); } };

const JP_DD = ['Kagerō', 'Shiranui', 'Isokaze', 'Hamakaze', 'Tanikaze', 'Urakaze', 'Arare', 'Kasumi', 'Yukikaze', 'Amatsukaze'];

/** Hits from bombs or aircraft torpedoes: like gunfire, but the aircraft is already gone. */
function bombed(g: Game, at: Vessel, by: string) {
  if (!at.alive) return;
  at.hp -= 1;
  g.blasts.push({ x: at.x, y: at.y, t: g.t, missile: false });
  if (at.hp > 0) return;
  at.alive = false;
  g.sunk.push({ name: at.name, cls: at.cls.key, side: at.side, by: 'enemy' });
  log(g, at.side === 'enemy' ? 'good' : 'danger', `${at.name} has been hit by ${by} and is sinking.`, 'boom');
}

/** Strike flights sent at ships. Each homes on its ship and, if it gets there, scores hits. */
interface Raid { flight: Vessel; target: Vessel; done: boolean }
function raid(g: Game, raids: Raid[], from: Vec, targets: Vessel[], cls: string, names: string[], cruise = 170) {
  const live = targets.filter((t) => t.alive);
  if (!live.length) return;
  names.forEach((n, i) => {
    const target = live[i % live.length];
    const p = offset(from, brg(from, target) + 90, (i - (names.length - 1) / 2) * 2);
    const flight = add(g, cls, n, 'enemy', p, brg(p, target), cruise, { mode: 'strike', goal: { x: target.x, y: target.y }, cruise });
    flight.track = [];
    raids.push({ flight, target, done: false });
  });
  log(g, 'warn', `Radar and radio intercepts: ${names.length} enemy strike flights inbound, bearing ${Math.round(brg(g.own, from)).toString().padStart(3, '0')}. Radar at periscope depth sees them high up out to 100 nm; SM-6 and JATM can bring them down.`);
}
/** Run every tick: keep each flight homing on its ship; when one arrives, it drops `hits` with chance `p` each. */
function pressRaids(g: Game, raids: Raid[], hits: number, p: number, by: string) {
  for (const rd of raids) {
    if (rd.done) continue;
    if (rd.flight.alive && rd.target.alive) rd.flight.ai!.goal = { x: rd.target.x, y: rd.target.y };
    if (!rd.flight.gone) { if (!rd.flight.alive) rd.done = true; continue; }
    rd.done = true;
    log(g, 'danger', `${rd.flight.name} is attacking ${rd.target.name}!`, 'alarm');
    for (let i = 0; i < hits; i++) if (g.r() < p) bombed(g, rd.target, by);
  }
}

/**
 * A gunnery and torpedo fight between two forces: every 20 s, ships within range trade fire.
 * `b` is usually the Allied side, scaled down so Tang still has the fight to win.
 */
const GUN: Record<string, number> = { battleship: 0.22, battlecruiser: 0.2, 'heavy cruiser': 0.13, 'light cruiser': 0.1, destroyer: 0.07 };
function melee(g: Game, a: Vessel[], b: Vessel[], range = 6, torpsA = false, torpsB = false, scaleA = 1, scaleB = 0.5) {
  if (g.t % 20) return;
  for (const x of a) for (const y of b) {
    if (!x.alive || !y.alive) continue;
    const d = dist(x, y);
    if (d > range) continue;
    const near = 1 - d / (range * 1.4);
    shellfire(g, x, y, (GUN[x.cls.type] ?? 0.06) * near * scaleA);
    shellfire(g, y, x, (GUN[y.cls.type] ?? 0.06) * near * scaleB);
    for (const [s, t, ok] of [[x, y, torpsA], [y, x, torpsB]] as const) {
      if (!ok || !/destroyer|cruiser/.test(s.cls.type) || d > 4 || g.flags[`tt${s.id}`]) continue;
      g.flags[`tt${s.id}`] = 1;
      fireStraight(g, s, offset(t, t.hdg, (t.spd * d) / 40));
    }
  }
}
/** Ships at anchor or stopped: they stay put until something sets them moving. */
const moored = (g: Game, cls: string, name: string, side: Side, p: Vec, hdg: number) => add(g, cls, name, side, p, hdg, 0, { mode: 'transit', baseCourse: hdg, cruise: 0, legT: 1e9 });
const go = (course: number, cruise: number, legT = 900): Partial<AI> => ({ mode: 'transit', baseCourse: course, cruise, legT });

// ---- Missions ---------------------------------------------------------------------------------
export const MISSIONS: Record<MissionKey, Mission> = {
  bismarck: {
    key: 'bismarck', title: 'Sink the Bismarck', era: '1941', place: 'Denmark Strait', date: '24 May 1941, 0300',
    library: ['bismarck', 'hipper', 'county', 'admiral', 'kgv', 'merchant', 'ar196'],
    brief: 'A shakedown cruise ends in a time vortex. Tang surfaces in May 1941 with no GPS and only Morse on the radio. Bismarck and Prinz Eugen are breaking out into the Atlantic at 27 knots, with the British cruisers Suffolk and Norfolk shadowing them by radar. Bismarck\'s Arado floatplane scouts ahead. Sink Bismarck before she gets past you. Don\'t hit the British.',
    build(g, r) {
      // The German group runs southwest down the Denmark Strait at 27 kt with Suffolk and
      // Norfolk shadowing well astern. Tang lies ahead of them.
      g.startClock = clock(3);
      g.timeLimit = 5 * 3600;
      const course = 205 + (r() * 2 - 1) * 10;
      const lateral = (r() * 2 - 1) * 9;
      const pass = offset(g.own, course + 90, lateral);
      const bPos = offset(pass, course + 180, 38 + r() * 6);
      g.own.hdg = g.own.ordHdg = norm(course + 180 + 30);
      const bis = add(g, 'bismarck', 'Bismarck', 'enemy', bPos, course, 27, { mode: 'transit', baseCourse: course, cruise: 27, legT: 400 + r() * 400 });
      add(g, 'hipper', 'Prinz Eugen', 'enemy', offset(bPos, course, 1.5), course, 27, { mode: 'station', leader: bis.id, rel: 0, rng: 1.5 });
      add(g, 'county', 'HMS Suffolk', 'allied', offset(bPos, course + 165, 13), course, 27, { mode: 'station', leader: bis.id, rel: 165, rng: 13 });
      add(g, 'county', 'HMS Norfolk', 'allied', offset(bPos, course + 200, 15), course, 27, { mode: 'station', leader: bis.id, rel: 200, rng: 15 });
      // Bismarck's Arado floatplane scouts around the group, watching for periscopes.
      add(g, 'ar196', 'Arado Ar 196', 'enemy', offset(bPos, course, 12), course, 140, { mode: 'orbit', leader: bis.id, phase: r() * 360, rng: 12, torps: 1 });
      setGoal(g, { targets: [bis.id], need: 1, win: 'Bismarck has been sunk.', timeout: 'Bismarck broke out into the Atlantic.' });
      g.script = (gg) => { if (dist(gg.own, bis) > 60 && bis.alive) end(gg, false, 'Bismarck broke out into the Atlantic.'); };
    },
  },

  midgets: {
    key: 'midgets', title: 'The midget subs', era: '1941', place: 'Off Pearl Harbor', date: '7 Dec 1941, 0300', night: true,
    library: ['midget', 'isub', 'wickes', 'merchant', 'kagero'],
    brief: 'Seven months later, Tang is off Oahu in the dark before the attack. Five Japanese I-boats have launched five two-man midget submarines, each carrying two torpedoes, to slip into Pearl Harbor behind the morning traffic. The old destroyer USS Ward is patrolling the entrance. The midgets are small and quiet: slow down and listen. Sink at least four before dawn, and don\'t let two of them get inside. Don\'t torpedo Ward.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 4 * 3600;
      const mouth = offset(g.own, 0, 6);
      g.own.hdg = g.own.ordHdg = 180;
      add(g, 'wickes', 'USS Ward', 'allied', offset(mouth, 200, 2), 270, 8, { mode: 'picket', center: offset(mouth, 190, 2.5) }).ai!.reportT = undefined;
      const midgets: Vessel[] = [];
      const iboats = ['I-16', 'I-18', 'I-20', 'I-22', 'I-24'];
      iboats.forEach((n, i) => {
        const b = 160 + i * 20 + (r() * 2 - 1) * 6;
        const launch = offset(mouth, b, 10 + r() * 3);
        add(g, 'isub', n, 'enemy', offset(launch, b, 1), norm(b + 90), 3, { mode: 'patrol', legT: 400 + r() * 400 }, 1);
        midgets.push(add(g, 'midget', `${n}tou`, 'enemy', launch, brg(launch, mouth), 4, { mode: 'raider', goal: mouth, cruise: 3.5 + r() * 2 }, 1));
      });
      setGoal(g, { targets: ids(midgets), need: 4, win: 'The midget subs are on the bottom. Pearl Harbor wakes up to an ordinary Sunday.', timeout: 'Dawn came with midget subs still loose off the harbour.' });
      g.script = (gg) => {
        for (const m of midgets) {
          if (!m.alive || dist(m, mouth) > 0.5) continue;
          m.alive = false; m.gone = true;
          gg.flags.midgetsIn = (gg.flags.midgetsIn ?? 0) + 1;
          log(gg, 'danger', `${m.name} has slipped into Pearl Harbor behind the anti-submarine net.`, 'alarm');
          if (gg.flags.midgetsIn >= 2) end(gg, false, 'Two midget subs got into Pearl Harbor.');
        }
        // The Ward's lookouts can't tell friend from foe either: she patrols the mouth.
      };
    },
  },

  kidobutai: {
    key: 'kidobutai', title: 'Kido Butai', era: '1941', place: '230 nm north of Oahu', date: '7 Dec 1941, 0530',
    library: ['akagi', 'kaga', 'soryu', 'shokaku', 'kongo', 'kagero', 'kate'],
    brief: 'Admiral Nagumo\'s six carriers are coming south to launch the strike on Pearl Harbor at 0600. Tang is twenty miles ahead of them. Every carrier you sink before it launches is a wave that never reaches Oahu, and every one you sink is missing at Midway. Their destroyers will come hunting when the torpedoes hit: go deep, they can\'t reach 700 feet. At periscope depth, radar sees the strike flights out to 100 nm, and SM-6 can bring them down. Sink at least three carriers.',
    build(g, r, carry) {
      g.startClock = clock(5, 30);
      g.timeLimit = 3 * 3600;
      const course = 180;
      const lead = offset(g.own, 0, 20 + r() * 4);
      g.own.hdg = g.own.ordHdg = 0;
      const tf = (cls: string, name: string, rel: number, rng: number) => alive(carry, name) ? add(g, cls, name, 'enemy', offset(lead, course + rel, rng), course, 24, { mode: 'station', rel, rng }) : null;
      const guide = add(g, 'kongo', 'Hiei', 'enemy', lead, course, 24, { mode: 'transit', baseCourse: course, cruise: 24, legT: 600 });
      const ships = [
        tf('akagi', 'Akagi', 300, 4), tf('kaga', 'Kaga', 330, 7), tf('soryu', 'Sōryū', 60, 4), tf('soryu', 'Hiryū', 30, 7),
        tf('shokaku', 'Shōkaku', 270, 6), tf('shokaku', 'Zuikaku', 90, 6), tf('kongo', 'Kirishima', 180, 3),
      ];
      for (const s of ships) if (s) s.ai!.leader = guide.id;
      const carriers = ships.filter((s): s is Vessel => !!s && s.cls.type.includes('carrier'));
      screen(g, guide, 'kagero', JP_DD.slice(0, 8), [[0, 9], [45, 10], [90, 10], [135, 9], [225, 9], [270, 10], [315, 10], [180, 8]]);
      const oahu = offset(lead, 180, 230);
      setGoal(g, { targets: ids(carriers), need: Math.min(3, carriers.length), win: 'Three carriers are burning. Nagumo has turned north and called off the attack.', timeout: 'The Kido Butai turned north with its carriers. Pearl Harbor was hit.' });
      g.script = (gg) => {
        at(gg, 1800, 'wave1', () => launchStrike(gg, carriers, oahu, 'First wave'));
        at(gg, 4500, 'wave2', () => launchStrike(gg, carriers, oahu, 'Second wave'));
      };
    },
  },

  doolittle: {
    key: 'doolittle', title: 'The Doolittle Raid', era: '1941', place: '650 nm east of Japan', date: '18 Apr 1942, 0600',
    library: ['picket', 'yorktown', 'fletcher', 'atlanta', 'merchant', 'mavis'],
    brief: 'Hornet has sixteen Army B-25s lashed to her flight deck, and Enterprise is covering her. Historically the picket boat Nittō Maru spotted the task force at 0738 and radioed Tokyo, and the bombers had to launch ten hours early, 170 miles farther out than planned. Tang is ahead of the task force. Find the picket boats and sink them before they can report. Then hit Japan first: Tang\'s land-attack Tomahawks can reach the raid\'s own targets, flying by terrain maps with no GPS. Land at least three hits before the bombers launch. A Kawanishi flying boat is patrolling high overhead.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 3 * 3600;
      const course = 270;
      g.own.hdg = g.own.ordHdg = course;
      const tfPos = offset(g.own, 90, 45);
      const hornet = add(g, 'yorktown', 'USS Hornet', 'allied', tfPos, course, 20, { mode: 'transit', baseCourse: course, cruise: 20, legT: 900 });
      add(g, 'yorktown', 'USS Enterprise', 'allied', offset(tfPos, 0, 3), course, 20, { mode: 'station', leader: hornet.id, rel: 0, rng: 3 });
      screen(g, hornet, 'atlanta', ['USS Nashville'], [[270, 4]]);
      screen(g, hornet, 'fletcher', ['USS Gwin', 'USS Meredith', 'USS Grayson', 'USS Monssen'], [[300, 6], [60, 6], [150, 5], [210, 5]]);
      const line = offset(g.own, course, 18 + r() * 4);
      const pickets = ['No. 23 Nittō Maru', 'Nagato Maru', 'Awata Maru'].map((n, i) => {
        const c = offset(line, 0, (i - 1) * 16 + (r() * 2 - 1) * 4);
        return add(g, 'picket', n, 'enemy', c, r() * 360, 6, { mode: 'picket', center: c });
      });
      add(g, 'mavis', 'Kawanishi H6K', 'enemy', offset(line, 0, 40), 180, 120, { mode: 'wander', center: line, rng: 40, cruise: 120 });
      // Doolittle's targets, roughly 650 nm west. Tokyo is the reference point.
      const tokyo = offset(tfPos, course, 650);
      g.sites = ([['Yokosuka naval yard', 200, 25], ['Tokyo: army arsenal and steel works', 0, 0], ['Yokohama docks', 210, 14], ['Nagoya: Mitsubishi aircraft works', 250, 140], ['Kobe: Kawasaki aircraft works', 255, 245]] as const)
        .map(([name, b, d], i) => ({ id: -(i + 1), name, ...offset(tokyo, b, d), hits: 0 }));
      setGoal(g, { targets: ids(pickets), need: 99, win: '', timeout: 'Fewer than three Tomahawks reached Japan before the raid launched.' });
      g.script = (gg) => {
        const sender = pickets.find((p) => p.alive && (p.ai!.reportT ?? 0) >= 240);
        if (sender) return end(gg, false, `${sender.name}'s report reached Tokyo. The raid launches early and far out.`);
        if (gg.t >= gg.timeLimit - 1 && (gg.flags.landHits ?? 0) >= 3) end(gg, true, `No report reached Tokyo, and ${gg.flags.landHits} Tomahawks have already hit Japan. Hornet launches the raid from the planned spot.`);
      };
    },
  },

  midway: {
    key: 'midway', title: 'Midway', era: '1941', place: 'Northwest of Midway', date: '4 Jun 1942, 0430',
    library: ['akagi', 'kaga', 'soryu', 'shokaku', 'kongo', 'yamato', 'takao', 'kagero', 'kate', 'jake'],
    brief: 'Yamamoto has brought the whole Combined Fleet east to take Midway and finish the US carriers. Nagumo\'s carriers launch their strike on the island at 0430. Tang is close to the Kido Butai, with its battleships and cruisers and a screen that will hunt you. The cruiser floatplanes are searching the sea around them. Sink every carrier you find.',
    build(g, r, carry) {
      g.startClock = clock(4, 30);
      g.timeLimit = 5 * 3600;
      const course = 135;
      const lead = offset(g.own, 315, 18 + r() * 4);
      g.own.hdg = g.own.ordHdg = 315;
      const four = [['akagi', 'Akagi'], ['kaga', 'Kaga'], ['soryu', 'Sōryū'], ['soryu', 'Hiryū']].filter(([, n]) => alive(carry, n));
      let targets: Vessel[];
      let guide: Vessel;
      if (four.length) {
        guide = add(g, 'kongo', alive(carry, 'Kirishima') ? 'Kirishima' : 'Haruna', 'enemy', lead, course, 24, { mode: 'transit', baseCourse: course, cruise: 24, legT: 600 });
        if (guide.name === 'Kirishima') screen(g, guide, 'kongo', ['Haruna'], [[180, 4]]);
        const spots: [number, number][] = [[300, 4], [60, 4], [240, 6], [120, 6]];
        targets = four.map(([cls, n], i) => screen(g, guide, cls, [n], [spots[i]])[0]);
        screen(g, guide, 'takao', ['Tone', 'Chikuma'], [[270, 8], [90, 8]]);
      } else {
        // History has changed: with Nagumo's carriers gone, Yamamoto brings the Main Body forward.
        guide = add(g, 'yamato', 'Yamato', 'enemy', lead, course, 22, { mode: 'transit', baseCourse: course, cruise: 22, legT: 600 });
        targets = [guide];
      }
      screen(g, guide, 'kagero', JP_DD.slice(0, 8), [[0, 9], [45, 10], [90, 11], [135, 9], [225, 9], [270, 11], [315, 10], [180, 8]]);
      for (let i = 0; i < 2; i++) add(g, 'jake', `Tone No. ${i + 4} floatplane`, 'enemy', offset(lead, i * 180 + 45, 20), 0, 110, { mode: 'wander', center: lead, rng: 35, cruise: 110 });
      const island = offset(lead, course, 240);
      const four2 = targets.filter((t) => t.cls.type.includes('carrier'));
      setGoal(g, {
        targets: ids(targets), need: targets.length,
        win: four.length ? 'The Kido Butai is gone. Midway stands, and Yorktown never has to fight.' : 'Yamato is on the bottom, and the Main Body turns for home.',
        timeout: 'The Japanese carriers struck Midway and got away to the northwest.',
      });
      g.script = (gg) => { if (four2.length) at(gg, 60, 'strike', () => launchStrike(gg, four2, island, 'Midway strike')); };
    },
  },

  pq17: {
    key: 'pq17', title: 'Convoy PQ-17', era: '1941', place: 'Barents Sea', date: '5 Jul 1942, 0200',
    library: ['typevii', 'tirpitz', 'hipper', 'merchant', 'liberty', 'flower', 'fw200'],
    brief: 'The Admiralty has ordered PQ-17 to scatter, fearing Tirpitz is out. The merchant ships are making for Russia alone, and the U-boats are picking them off. It\'s Arctic summer, so there is no darkness. Tirpitz and Admiral Hipper really are coming this time. Keep the ships around you alive: lose no more than three. A Condor is shadowing the convoy high up.',
    build(g, r, carry) {
      g.startClock = clock(2);
      g.timeLimit = 4 * 3600;
      const course = 60;
      g.own.hdg = g.own.ordHdg = course;
      const names = ['SS Carlton', 'SS Daniel Morgan', 'SS Fairfield City', 'SS Hoosier', 'SS Olopana', 'SS Winston-Salem', 'SS Bellingham'];
      const merchants = names.map((n, i) => add(g, i % 2 ? 'liberty' : 'merchant', n, 'allied', offset(g.own, r() * 360, 2 + r() * 9), norm(course + (r() * 2 - 1) * 25), 9, { mode: 'transit', baseCourse: norm(course + (r() * 2 - 1) * 25), cruise: 8 + r() * 2, legT: 900 }));
      const boats = ['U-88', 'U-255', 'U-334', 'U-703'].map((n) => add(g, 'typevii', n, 'enemy', offset(g.own, r() * 360, 10 + r() * 6), course, 6, { mode: 'raider', torps: 6 }, 1));
      const tirp = alive(carry, 'Tirpitz') ? add(g, 'tirpitz', 'Tirpitz', 'enemy', offset(g.own, 250, 70), 70, 24, { mode: 'transit', baseCourse: 70, cruise: 24, legT: 800 }) : null;
      const heavy = tirp ? [tirp, ...screen(g, tirp, 'hipper', ['Admiral Hipper'], [[200, 2]])] : [];
      add(g, 'fw200', 'Fw 200 Condor', 'enemy', offset(g.own, 0, 30), 90, 160, { mode: 'wander', center: g.own, rng: 40, cruise: 160 });
      setGoal(g, {
        targets: ids(boats), need: boats.length, protect: ids(merchants), maxLosses: 3, surviveWin: true,
        win: 'The scattered ships made it to Novaya Zemlya. PQ-17 got through.', lossText: 'Four ships of PQ-17 are on the bottom of the Barents Sea.', timeout: '',
      });
      g.script = (gg) => {
        // The heavy ships shell any merchant they come within range of.
        if (gg.t % 30) return;
        for (const s of heavy) for (const m of merchants) if (m.alive && dist(s, m) < 12) shellfire(gg, s, m, 0.35);
      };
    },
  },

  guadalcanal: {
    key: 'guadalcanal', title: 'Ironbottom Sound', era: '1941', place: 'Off Guadalcanal', date: '13 Nov 1942, 0130', night: true,
    library: ['kongo', 'kagero', 'agano', 'atlanta', 'fletcher', 'takao'],
    brief: 'Two battleships are coming down the Slot to shell Henderson Field flat. Admiral Callaghan\'s cruisers and destroyers are steaming to meet them in the dark, and in a few minutes this will be the most confused night action of the war. Sink the battleships before they reach Lunga Point. Everyone is firing at everyone, so classify before you shoot: the US ships are in the middle of it.',
    build(g, r, carry) {
      g.startClock = clock(1, 30);
      g.timeLimit = 2.5 * 3600;
      const course = 135;
      const pair = ['Hiei', 'Kirishima'].filter((n) => alive(carry, n));
      const bbNames = pair.length ? pair : ['Kongō', 'Haruna'];
      const lead = offset(g.own, 315, 10 + r() * 3);
      g.own.hdg = g.own.ordHdg = 315;
      const bb = add(g, 'kongo', bbNames[0], 'enemy', lead, course, 18, { mode: 'transit', baseCourse: course, cruise: 18, legT: 900 });
      const bbs = [bb, ...(bbNames[1] ? screen(g, bb, 'kongo', [bbNames[1]], [[180, 1.5]]) : [])];
      screen(g, bb, 'agano', ['Nagara'], [[0, 3]]);
      const jdd = screen(g, bb, 'kagero', ['Akatsuki', 'Ikazuchi', 'Inazuma', 'Yukikaze', 'Amatsukaze', 'Teruzuki'], [[20, 5], [340, 5], [60, 4], [300, 4], [100, 4], [260, 4]]);
      // Callaghan's column, steaming northwest into them.
      const us0 = offset(g.own, 135, 6);
      const atl = add(g, 'atlanta', 'USS Atlanta', 'allied', us0, 315, 18, { mode: 'transit', baseCourse: 315, cruise: 18, legT: 1200 });
      const usShips = [atl,
        ...screen(g, atl, 'atlanta', ['USS Juneau'], [[180, 3]]),
        ...screen(g, atl, 'fletcher', ['USS Fletcher', 'USS O\'Bannon', 'USS Laffey', 'USS Sterett'], [[0, 2], [0, 1], [180, 5], [180, 6]]),
      ];
      const lunga = offset(lead, course, 30);
      setGoal(g, {
        targets: ids(bbs), need: bbs.length, protect: ids(usShips), maxLosses: 3,
        win: 'Both battleships are sinking off Savo Island. Henderson Field will fly in the morning.',
        timeout: 'The battleships shelled Henderson Field and withdrew up the Slot.', lossText: 'Callaghan\'s force has been shot to pieces.',
      });
      const jp = [...bbs, ...jdd];
      g.script = (gg) => {
        if (bbs.some((b) => b.alive && dist(b, lunga) < 8)) {
          gg.flags.shelling = (gg.flags.shelling ?? 0) + 1;
          if (gg.flags.shelling === 1) log(gg, 'danger', 'Star shells over Lunga Point: the battleships have opened fire on Henderson Field!', 'alarm');
          if (gg.flags.shelling > 600) end(gg, false, 'The battleships shelled Henderson Field flat.');
        }
        if (gg.t % 20) return;
        // A night melee: guns at close range both ways, and the Long Lances.
        for (const a of jp) for (const u of usShips) {
          if (!a.alive || !u.alive) continue;
          const d = dist(a, u);
          if (d < 5) { shellfire(gg, a, u, a.cls.type === 'battleship' ? 0.25 : 0.1); shellfire(gg, u, a, 0.08); }
          if (a.cls.type === 'destroyer' && d < 4 && !gg.flags[`ll${a.id}`]) { gg.flags[`ll${a.id}`] = 1; fireStraight(gg, a, offset(u, u.hdg, u.spd * d / 40)); }
        }
      };
    },
  },

  ons5: {
    key: 'ons5', title: 'Convoy ONS-5', era: '1941', place: 'North Atlantic', date: '5 May 1943, 2000', night: true,
    library: ['typevii', 'merchant', 'liberty', 'flower', 'fletcher'],
    brief: 'Forty U-boats are gathered around the slow westbound convoy ONS-5, and tonight they attack in waves. The escort group is down to a handful of corvettes. Tang is inside the screen. Hunt the U-boats before they get into the columns, and lose no more than three ships. A second wave is coming in after the first.',
    build(g, r) {
      g.startClock = clock(20);
      g.timeLimit = 4 * 3600;
      const course = 250;
      g.own.hdg = g.own.ordHdg = course;
      const commodore = add(g, 'merchant', 'SS Rena', 'allied', offset(g.own, 90, 2), course, 7, { mode: 'transit', baseCourse: course, cruise: 7, legT: 3600 });
      const names = ['SS Harbury', 'SS Harperley', 'SS West Maximus', 'SS North Britain', 'SS Selvistan', 'SS Gharinda', 'SS Bonde', 'SS Dolius', 'SS Lorient', 'SS Wentworth', 'SS West Madaket'];
      const cols: [number, number][] = [];
      for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) if (c || k) cols.push([norm(90 + (c - 1.5) * 0 + (k ? 180 : 0)), 0]);
      const merchants = [commodore, ...names.map((n, i) => {
        const col = (i + 1) % 4, row = Math.floor((i + 1) / 4);
        const rel = norm(Math.atan2(col * 0.6 - 0.9, -row * 0.5) * 180 / Math.PI);
        const rng = Math.hypot(col * 0.6 - 0.9, row * 0.5) || 0.6;
        return screen(g, commodore, i % 3 ? 'merchant' : 'liberty', [n], [[rel, rng]])[0];
      })];
      screen(g, commodore, 'flower', ['HMS Sunflower', 'HMS Snowflake', 'HMS Loosestrife', 'HMS Pink'], [[0, 3], [90, 3], [270, 3], [180, 3]]);
      const wave = (names2: string[], side: number) => names2.map((n) => add(g, 'typevii', n, 'enemy', offset(commodore, side + (r() * 2 - 1) * 40, 9 + r() * 5), course, 6, { mode: 'raider', torps: 5 }, 1));
      const first = wave(['U-125', 'U-192', 'U-707', 'U-628'], 330);
      setGoal(g, {
        targets: ids(first), need: 8, protect: ids(merchants), maxLosses: 3, surviveWin: true,
        win: 'ONS-5 is through. The wolfpack has been broken and Dönitz pulls the boats back.', lossText: 'Four ships of ONS-5 are lost. The wolfpack is winning.', timeout: '',
      });
      g.script = (gg) => at(gg, 3600, 'wave2', () => {
        const second = wave(['U-264', 'U-358', 'U-638', 'U-266'], 160);
        gg.goal.targets.push(...ids(second));
        log(gg, 'warn', 'HF/DF: a burst of U-boat radio traffic to the south. The second wave is coming in.', 'alarm');
      });
    },
  },

  philsea: {
    key: 'philsea', title: 'Philippine Sea', era: '1941', place: 'West of the Marianas', date: '19 Jun 1944, 0800',
    library: ['taiho', 'shokaku', 'takao', 'kagero', 'kongo', 'kate'],
    brief: 'Admiral Ozawa has thrown everything at Spruance\'s Task Force 58. His carriers are launching wave after wave east. Historically, the submarines Albacore and Cavalla sank Taihō and Shōkaku this morning. Tang is inside their screen. Sink the big carriers. Every strike flight you shoot down with SM-6 is one less over the fleet.',
    build(g, r, carry) {
      g.startClock = clock(8);
      g.timeLimit = 3 * 3600;
      const course = 90;
      const lead = offset(g.own, 270, 14 + r() * 4);
      g.own.hdg = g.own.ordHdg = 270;
      const taiho = add(g, 'taiho', 'Taihō', 'enemy', lead, course, 24, { mode: 'transit', baseCourse: course, cruise: 24, legT: 600 });
      const carriers = [taiho, ...['Shōkaku', 'Zuikaku'].filter((n) => alive(carry, n)).map((n, i) => screen(g, taiho, 'shokaku', [n], [[i ? 120 : 240, 4]])[0])];
      screen(g, taiho, 'takao', ['Myōkō', 'Haguro'], [[60, 6], [300, 6]]);
      screen(g, taiho, 'kagero', JP_DD.slice(2, 8), RING);
      const tf58 = offset(lead, course, 300);
      setGoal(g, { targets: ids(carriers), need: Math.min(2, carriers.length), win: 'Ozawa\'s big carriers are gone. The Marianas are open.', timeout: 'Ozawa\'s carriers escaped west with their air groups spent.' });
      g.script = (gg) => {
        at(gg, 30, 'raid1', () => launchStrike(gg, carriers, tf58, 'Raid I'));
        at(gg, 2700, 'raid2', () => launchStrike(gg, carriers, tf58, 'Raid II'));
      };
    },
  },

  leyte: {
    key: 'leyte', title: 'Leyte Gulf: Palawan Passage', era: '1941', place: 'Palawan Passage', date: '23 Oct 1944, 0530',
    library: ['yamato', 'kongo', 'takao', 'kagero', 'jake'],
    brief: 'Admiral Kurita\'s Center Force is threading the Palawan Passage toward Leyte Gulf: Yamato and Musashi, three more battleships and ten heavy cruisers. At dawn on this day the submarines Darter and Dace sank the flagship Atago and Maya and crippled Takao. Tang can do more. Sink three of the big ships before Kurita clears the passage.',
    build(g, r, carry) {
      g.startClock = clock(5, 30);
      g.timeLimit = 3 * 3600;
      const course = 40;
      const lead = offset(g.own, 220, 12 + r() * 3);
      g.own.hdg = g.own.ordHdg = 220;
      const atago = add(g, 'takao', 'Atago', 'enemy', lead, course, 16, { mode: 'transit', baseCourse: course, cruise: 16, legT: 900 });
      const cruisers = [atago, ...screen(g, atago, 'takao', ['Takao', 'Maya', 'Chōkai'], [[180, 1.2], [90, 2], [270, 2]])];
      const bbs = ['Yamato', 'Musashi'].filter((n) => alive(carry, n)).flatMap((n, i) => screen(g, atago, 'yamato', [n], [[180, 5 + i * 1.5]]));
      screen(g, atago, 'kongo', ['Kongō', 'Haruna'], [[200, 9], [160, 9]]);
      screen(g, atago, 'kagero', JP_DD.slice(0, 6), [[30, 3], [330, 3], [120, 5], [240, 5], [150, 8], [210, 8]]);
      const big = [...bbs, ...cruisers];
      setGoal(g, { targets: ids(big), need: Math.min(3, big.length), win: 'Center Force is crippled in the Palawan Passage. Leyte\'s landing beaches are safe.', timeout: 'Kurita cleared the passage with his battleships.' });
    },
  },

  shinano: {
    key: 'shinano', title: 'Shinano', era: '1941', place: 'Off Tokyo Bay', date: '29 Nov 1944, 0300', night: true,
    library: ['shinano', 'yamato', 'kagero', 'shokaku'],
    brief: 'The largest carrier ever built is on her first voyage, zigzagging south at 20 knots from Yokosuka with three destroyers. Her crew are green and her watertight doors haven\'t been fitted. Historically USS Archerfish sank her with four torpedoes this night. Sink Shinano.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 3 * 3600;
      const course = 210;
      const lead = offset(g.own, 30, 16 + r() * 4);
      g.own.hdg = g.own.ordHdg = 30;
      const sh = add(g, 'shinano', 'Shinano', 'enemy', lead, course, 20, { mode: 'transit', baseCourse: course, cruise: 20, legT: 500 });
      screen(g, sh, 'kagero', ['Isokaze', 'Yukikaze', 'Hamakaze'], [[0, 2], [120, 2], [240, 2]]);
      setGoal(g, { targets: [sh.id], need: 1, win: 'Shinano has rolled over and sunk, seventeen hours into her first voyage.', timeout: 'Shinano reached Kure.' });
    },
  },

  tengo: {
    key: 'tengo', title: 'Ten-Go: Yamato', era: '1941', place: 'East China Sea', date: '7 Apr 1945, 0800',
    library: ['yamato', 'agano', 'kagero', 'shinano'],
    brief: 'With fuel for a one-way trip, Japan\'s last big-gun battleship is heading for Okinawa to beach herself as a fortress and fight to the end. The light cruiser Yahagi and eight destroyers are with her. Historically, almost 400 carrier aircraft sank her this afternoon. Sink her first, before she reaches Okinawa.',
    build(g, r, carry) {
      g.startClock = clock(8);
      g.timeLimit = 3 * 3600;
      const course = 200;
      const lead = offset(g.own, 20, 15 + r() * 3);
      g.own.hdg = g.own.ordHdg = 20;
      const flagName = ['Yamato', 'Musashi'].find((n) => alive(carry, n));
      const flag = flagName
        ? add(g, 'yamato', flagName, 'enemy', lead, course, 22, { mode: 'transit', baseCourse: course, cruise: 22, legT: 600 })
        : add(g, 'agano', 'Yahagi', 'enemy', lead, course, 24, { mode: 'transit', baseCourse: course, cruise: 24, legT: 600 });
      if (flagName) screen(g, flag, 'agano', ['Yahagi'], [[0, 3]]);
      screen(g, flag, 'kagero', ['Isokaze', 'Hamakaze', 'Yukikaze', 'Asashimo', 'Kasumi', 'Hatsushimo', 'Fuyuzuki', 'Suzutsuki'], RING);
      const okinawa = offset(lead, course, 70);
      setGoal(g, { targets: [flag.id], need: 1, win: `${flag.name} has gone down. The last sortie of the Imperial Navy is over.`, timeout: `${flag.name} is still afloat as the day ends.` });
      g.script = (gg) => { if (flag.alive && dist(flag, okinawa) < 10) end(gg, false, `${flag.name} reached Okinawa and beached herself as a fortress.`); };
    },
  },

  forcez: {
    key: 'forcez', title: 'Force Z', era: '1941', place: 'Off Kuantan, South China Sea', date: '10 Dec 1941, 1030',
    library: ['kgv', 'renown', 'hclass', 'g4m', 'isub'],
    brief: 'Three days after Pearl Harbor, Admiral Phillips has taken Prince of Wales and Repulse north from Singapore with four destroyers and no air cover. At 1100 history has eighty-five Japanese bombers from Saigon finding them, and by 1320 both capital ships are gone. Tang is with Force Z. Keep the bombers off them: at periscope depth, radar sees them high up out to 100 nm, and SM-6 and JATM bring them down. A Japanese submarine is shadowing the force.',
    build(g, r) {
      g.startClock = clock(10, 30);
      g.timeLimit = 1.6 * 3600;
      const course = 180;
      g.own.hdg = g.own.ordHdg = course;
      const lead = offset(g.own, 90, 3);
      const pow = add(g, 'kgv', 'HMS Prince of Wales', 'allied', lead, course, 24, go(course, 24));
      const rep = screen(g, pow, 'renown', ['HMS Repulse'], [[180, 1.5]])[0];
      screen(g, pow, 'hclass', ['HMS Electra', 'HMS Express', 'HMAS Vampire', 'HMS Tenedos'], [[0, 2.5], [60, 2.5], [300, 2.5], [180, 3.5]]);
      add(g, 'isub', 'I-58', 'enemy', offset(lead, 20, 9 + r() * 3), 180, 4, { mode: 'patrol', legT: 400 }, 1);
      const saigon = offset(lead, 330 + (r() * 2 - 1) * 15, 90);
      const raids: Raid[] = [];
      const names = (air: string, n: number, from: number) => Array.from({ length: n }, (_, i) => `${air} chūtai ${from + i}`);
      setGoal(g, { protect: [pow.id, rep.id], maxLosses: 0, surviveWin: true, need: 99, lossText: 'Force Z has lost a capital ship.', win: 'The last bombers have turned for Saigon. Prince of Wales and Repulse are still afloat.', timeout: '' });
      g.script = (gg) => {
        at(gg, 240, 'w1', () => raid(gg, raids, saigon, [rep, pow], 'g4m', names('Mihoro', 4, 1)));
        at(gg, 1500, 'w2', () => raid(gg, raids, saigon, [pow, rep], 'g4m', names('Genzan', 5, 1)));
        at(gg, 2700, 'w3', () => raid(gg, raids, saigon, [rep, pow], 'g4m', names('Kanoya', 5, 1)));
        at(gg, 3900, 'w4', () => raid(gg, raids, saigon, [pow, rep], 'g4m', names('Mihoro', 4, 5)));
        pressRaids(gg, raids, 3, 0.65, 'bombs and aircraft torpedoes');
      };
    },
  },

  javasea: {
    key: 'javasea', title: 'Java Sea', era: '1941', place: 'North of Surabaya', date: '27 Feb 1942, 1600',
    library: ['myoko', 'sendai', 'kagero', 'maru', 'deruyter', 'county', 'usca', 'leander', 'hclass', 'wickes'],
    brief: 'Rear Admiral Karel Doorman\'s scratch ABDA squadron, Dutch, British, Australian and American ships that have never trained together, is going out to stop the invasion convoy bound for Java. Covering it are the heavy cruisers Nachi and Haguro, the light cruisers Jintsū and Naka, and destroyers carrying the Long Lance torpedo. History has Doorman dead and his squadron destroyed by midnight. Sink Nachi and Haguro and the convoy turns back. Classify before you shoot: half the ships out here are on your side.',
    build(g, r, carry) {
      g.startClock = clock(16);
      g.timeLimit = 2.5 * 3600;
      const course = 180;
      g.own.hdg = g.own.ordHdg = 0;
      const jp0 = offset(g.own, 0, 12 + r() * 3);
      const nachi = add(g, 'myoko', alive(carry, 'Nachi') ? 'Nachi' : 'Ashigara', 'enemy', jp0, course, 24, go(course, 24, 700));
      const cruisers = [nachi, ...screen(g, nachi, 'myoko', [alive(carry, 'Haguro') ? 'Haguro' : 'Myōkō'], [[180, 1.2]])];
      const lights = screen(g, nachi, 'sendai', ['Jintsū', 'Naka'], [[45, 5], [315, 5]]);
      const dd = screen(g, nachi, 'kagero', ['Yukikaze', 'Tokitsukaze', 'Amatsukaze', 'Hatsukaze', 'Asagumo', 'Minegumo'], [[30, 6], [60, 6], [300, 6], [330, 6], [90, 4], [270, 4]]);
      const convoy = offset(jp0, 0, 25);
      for (let i = 0; i < 6; i++) add(g, 'maru', `${['Tokushima', 'Nichiran', 'Kotobuki', 'Kofuku', 'Tsuruga', 'Shinsei'][i]} Maru`, 'enemy', offset(convoy, i * 60, 2), course, 8, go(course, 8, 1e9));
      const ab0 = offset(g.own, 180, 6);
      const dr = add(g, 'deruyter', 'HNLMS De Ruyter', 'allied', ab0, 0, 24, go(0, 24, 800));
      const abda = [dr,
        ...screen(g, dr, 'county', ['HMS Exeter'], [[180, 1]]), ...screen(g, dr, 'usca', ['USS Houston'], [[180, 2]]),
        ...screen(g, dr, 'leander', ['HMAS Perth'], [[180, 3]]), ...screen(g, dr, 'deruyter', ['HNLMS Java'], [[180, 4]]),
        ...screen(g, dr, 'hclass', ['HMS Electra', 'HMS Encounter', 'HMS Jupiter'], [[20, 3], [340, 3], [0, 4]]),
        ...screen(g, dr, 'wickes', ['USS John D. Edwards', 'USS Paul Jones', 'USS Alden', 'USS John D. Ford'], [[200, 5], [160, 5], [210, 6], [150, 6]]),
      ];
      setGoal(g, { targets: ids(cruisers), need: cruisers.length, protect: ids(abda), maxLosses: 5, win: 'Both Japanese heavy cruisers are gone. The invasion convoy is turning north, and Doorman\'s squadron lives to fight again.', timeout: 'The invasion convoy is still coming. Java falls in a week.', lossText: 'Doorman\'s squadron has been destroyed.' });
      const jp = [...cruisers, ...lights, ...dd];
      g.script = (gg) => melee(gg, jp, abda, 7, true, false);
    },
  },

  sunda: {
    key: 'sunda', title: 'Sunda Strait', era: '1941', place: 'Bantam Bay, Java', date: '28 Feb 1942, 2300', night: true,
    library: ['mogami', 'sendai', 'kagero', 'maru', 'usca', 'leander'],
    brief: 'The survivors of the Java Sea, USS Houston and HMAS Perth, are trying to slip out through the Sunda Strait in the dark. In Bantam Bay they run into the western invasion force: transports landing troops, with the heavy cruisers Mogami and Mikuma, the light cruiser Natori and a crowd of destroyers. History has both Allied cruisers sunk before 0130, fighting to the end. Sink Mogami and Mikuma, and keep at least one of the two alive.',
    build(g, r, carry) {
      g.startClock = clock(23);
      g.timeLimit = 2.5 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const bay = offset(g.own, 270, 8);
      for (let i = 0; i < 8; i++) moored(g, 'maru', `${['Sakura', 'Tatsuno', 'Horai', 'Ryujo', 'Kuretake', 'Toyama', 'Hokuroku', 'Shinshu'][i]} Maru`, 'enemy', offset(bay, 150 + i * 15, 3 + (i % 3)), 90);
      const cv = ['Mogami', 'Mikuma'].filter((n) => alive(carry, n));
      const cn = cv.length ? cv : ['Kumano', 'Suzuya'];
      const mog = add(g, 'mogami', cn[0], 'enemy', offset(bay, 330, 10 + r() * 3), 135, 20, go(135, 10, 400));
      const cruisers = [mog, ...(cn[1] ? screen(g, mog, 'mogami', [cn[1]], [[180, 1.5]]) : [])];
      const jp = [...cruisers, ...[add(g, 'sendai', 'Natori', 'enemy', offset(bay, 60, 5), 240, 20, go(240, 20, 500))],
        ...['Fubuki', 'Shirayuki', 'Hatsuyuki', 'Murakumo', 'Shirakumo', 'Harukaze', 'Hatakaze', 'Asakaze'].map((n, i) => add(g, 'kagero', n, 'enemy', offset(bay, i * 45, 4 + (i % 2) * 2), (i * 45 + 90) % 360, 18, { mode: 'hunt', home: 'transit' }))];
      const hou = add(g, 'usca', 'USS Houston', 'allied', offset(g.own, 0, 2), 270, 26, go(270, 26, 700));
      const per = screen(g, hou, 'leander', ['HMAS Perth'], [[0, 1]])[0];
      setGoal(g, { targets: ids(cruisers), need: cruisers.length, protect: [hou.id, per.id], maxLosses: 1, win: 'Mogami and Mikuma are sinking in Bantam Bay, and the Allied cruisers are clear into the Indian Ocean.', timeout: 'The Japanese cruisers are still afloat at dawn.', lossText: 'Houston and Perth are both gone, as in 1942.' });
      g.script = (gg) => melee(gg, jp, [hou, per], 6, true, false, 0.22);
    },
  },

  coralsea: {
    key: 'coralsea', title: 'Coral Sea', era: '1941', place: 'Coral Sea', date: '8 May 1942, 0830',
    library: ['shokaku', 'ryujo', 'aoba', 'kagero', 'lexington', 'yorktown', 'kate'],
    brief: 'The first carrier battle in history: neither fleet will ever see the other. Yesterday US aircraft sank the light carrier Shōhō. This morning Shōkaku and Zuikaku are launching everything at Lexington and Yorktown, and history loses Lexington by evening. Tang is inside the Japanese screen. Sink the big carriers, and shoot down what you can of their strikes.',
    build(g, r, carry) {
      g.startClock = clock(8, 30);
      g.timeLimit = 3 * 3600;
      const course = 150;
      g.own.hdg = g.own.ordHdg = 330;
      const lead = offset(g.own, 330, 14 + r() * 3);
      const big = ['Shōkaku', 'Zuikaku'].filter((n) => alive(carry, n));
      const guide = add(g, 'aoba', 'Myōkō', 'enemy', lead, course, 24, go(course, 24, 600));
      const carriers = big.length ? big.map((n, i) => screen(g, guide, 'shokaku', [n], [[i ? 60 : 300, 4]])[0]) : screen(g, guide, 'ryujo', ['Shōhō'], [[0, 4]]);
      screen(g, guide, 'aoba', ['Haguro'], [[180, 4]]);
      screen(g, guide, 'kagero', ['Ariake', 'Yūgure', 'Shiratsuyu', 'Shigure', 'Ushio', 'Akebono'], RING);
      const tf17 = offset(lead, course, 160);
      const lex = add(g, 'lexington', 'USS Lexington', 'allied', tf17, 0, 20, go(0, 20, 900));
      const yor = screen(g, lex, 'yorktown', ['USS Yorktown'], [[90, 4]])[0];
      const raids: Raid[] = [];
      setGoal(g, { targets: ids(carriers), need: carriers.length, protect: [lex.id, yor.id], maxLosses: 1, win: 'The Japanese carriers are gone. Port Moresby is safe, and neither will be at Midway.', timeout: 'The Japanese carriers withdrew north.', lossText: 'Lexington and Yorktown are both lost.' });
      g.script = (gg) => {
        at(gg, 300, 'r1', () => raid(gg, raids, carriers[0], [lex, yor], 'kate', carriers.flatMap((c) => [`${c.name} strike A`, `${c.name} strike B`]), 150));
        at(gg, 3600, 'r2', () => raid(gg, raids, carriers[0], [yor, lex], 'kate', carriers.filter((c) => c.alive).map((c) => `${c.name} second strike`), 150));
        pressRaids(gg, raids, 3, 0.5, 'Japanese torpedo planes');
      };
    },
  },

  savo: {
    key: 'savo', title: 'Savo Island', era: '1941', place: 'Savo Sound, Guadalcanal', date: '9 Aug 1942, 0130', night: true,
    library: ['takao', 'aoba', 'sendai', 'kagero', 'usca', 'county', 'fletcher'],
    brief: 'Two days after the Marines landed on Guadalcanal, Admiral Mikawa is coming down the Slot with seven cruisers to hit the transports. The Allied cruisers are split into two groups either side of Savo Island, half asleep, and the picket destroyers will miss him. History has four Allied cruisers sunk in thirty minutes. Get between Mikawa and the cruisers and sink at least three of his ships before he gets to them.',
    build(g, r, carry) {
      g.startClock = clock(1, 30);
      g.timeLimit = 2 * 3600;
      const course = 135;
      g.own.hdg = g.own.ordHdg = 315;
      const lead = offset(g.own, 315, 9 + r() * 3);
      const chokai = add(g, 'takao', alive(carry, 'Chōkai') ? 'Chōkai' : 'Maya', 'enemy', lead, course, 26, go(course, 26, 1e9));
      const col = [chokai, ...screen(g, chokai, 'aoba', ['Aoba', 'Kako', 'Kinugasa', 'Furutaka'], [[180, 0.8], [180, 1.6], [180, 2.4], [180, 3.2]]),
        ...screen(g, chokai, 'sendai', ['Tenryū', 'Yūbari'], [[200, 2], [200, 3]]), ...screen(g, chokai, 'kagero', ['Yūnagi'], [[180, 4.5]])];
      const south = offset(g.own, 160, 7);
      const can = add(g, 'county', 'HMAS Canberra', 'allied', south, 315, 12, go(315, 12, 1800));
      const north = offset(g.own, 90, 8);
      const vin = add(g, 'usca', 'USS Vincennes', 'allied', north, 45, 10, go(45, 10, 1800));
      const allies = [can, ...screen(g, can, 'usca', ['USS Chicago'], [[180, 0.8]]), ...screen(g, can, 'fletcher', ['USS Bagley', 'USS Patterson'], [[30, 1.5], [330, 1.5]]),
        vin, ...screen(g, vin, 'usca', ['USS Quincy', 'USS Astoria'], [[180, 0.8], [180, 1.6]]), ...screen(g, vin, 'fletcher', ['USS Helm', 'USS Wilson'], [[30, 1.5], [330, 1.5]])];
      const cruisers = allies.filter((v) => v.cls.type.includes('cruiser'));
      const transports = offset(g.own, course, 20);
      setGoal(g, { targets: ids(col.filter((v) => v.cls.type.includes('cruiser'))), need: 3, protect: ids(cruisers), maxLosses: 2, win: 'Mikawa has lost half his cruisers and is running back up the Slot. The transports off Lunga Point unload in peace.', timeout: 'Mikawa withdrew up the Slot at dawn.', lossText: 'The Allied cruiser force has been wrecked, as in history.' });
      g.script = (gg) => {
        if (chokai.alive && dist(chokai, transports) < 6) end(gg, false, 'Mikawa\'s cruisers are among the transports off Lunga Point.');
        melee(gg, col, allies, 6, true, false);
      };
    },
  },

  eastsol: {
    key: 'eastsol', title: 'Eastern Solomons', era: '1941', place: 'North of Malaita', date: '24 Aug 1942, 1300',
    library: ['ryujo', 'takao', 'sendai', 'kagero', 'maru', 'g4m'],
    brief: 'The Japanese are running a reinforcement convoy to Guadalcanal: Rear Admiral Tanaka in the light cruiser Jintsū with three transports, while the light carrier Ryūjō sails ahead as bait for the US carriers. Tang is between them. Sink Ryūjō and two of the transports, and the troops never land.',
    build(g, r, carry) {
      g.startClock = clock(13);
      g.timeLimit = 3 * 3600;
      const course = 160;
      g.own.hdg = g.own.ordHdg = 340;
      const bait = offset(g.own, 325, 13 + r() * 3);
      const ryu = add(g, 'ryujo', 'Ryūjō', 'enemy', bait, course, 22, go(course, 22, 700));
      screen(g, ryu, 'takao', ['Tone'], [[90, 2]]);
      screen(g, ryu, 'kagero', ['Amatsukaze', 'Tokitsukaze'], [[0, 2], [180, 2]]);
      const cvy = offset(g.own, 340 + (r() * 2 - 1) * 8, 14 + r() * 3);
      const jin = add(g, 'sendai', alive(carry, 'Jintsū') ? 'Jintsū' : 'Naka', 'enemy', cvy, course, 9, go(course, 9, 1e9));
      const transports = screen(g, jin, 'maru', ['Kinryu Maru', 'Boston Maru', 'Daifuku Maru'], [[180, 1.5], [200, 3], [160, 3]]);
      screen(g, jin, 'kagero', ['Kagerō', 'Isokaze', 'Kawakaze', 'Suzukaze', 'Umikaze'], [[0, 2], [60, 2.5], [300, 2.5], [120, 3.5], [240, 3.5]]);
      const lunga = offset(cvy, course, 25);
      setGoal(g, { targets: [ryu.id, ...ids(transports)], need: 3, win: 'Ryūjō is gone and Tanaka\'s convoy is scattered. The troops will not land.', timeout: 'Tanaka\'s convoy got through to Guadalcanal.' });
      g.script = (gg) => { if (transports.some((t) => t.alive && dist(t, lunga) < 4)) end(gg, false, 'The transports reached Guadalcanal and landed their troops.'); };
    },
  },

  santacruz: {
    key: 'santacruz', title: 'Santa Cruz Islands', era: '1941', place: 'North of the Santa Cruz Islands', date: '26 Oct 1942, 0700',
    library: ['shokaku', 'ryujo', 'kongo', 'takao', 'kagero', 'yorktown', 'kate'],
    brief: 'The fourth carrier battle of the war. Nagumo has his carriers north of the Santa Cruz Islands to cover the Army\'s great offensive on Guadalcanal, and Hornet and Enterprise are coming for him. History loses Hornet this afternoon, and leaves the US Navy with one damaged carrier in the whole Pacific. Sink two of the Japanese carriers, and don\'t let Hornet go down.',
    build(g, r, carry) {
      g.startClock = clock(7);
      g.timeLimit = 3 * 3600;
      const course = 150;
      g.own.hdg = g.own.ordHdg = 330;
      const lead = offset(g.own, 330, 14 + r() * 3);
      const guide = add(g, 'takao', 'Kumano', 'enemy', lead, course, 22, go(course, 22, 600));
      const big = ['Shōkaku', 'Zuikaku'].filter((n) => alive(carry, n)).map((n, i) => screen(g, guide, 'shokaku', [n], [[i ? 60 : 300, 4]])[0]);
      const light = screen(g, guide, 'ryujo', ['Zuihō', 'Jun\'yō'], [[0, 5], [180, 5]]);
      const carriers = [...big, ...light];
      screen(g, guide, 'kongo', ['Kongō', 'Haruna'].filter((n) => alive(carry, n)), [[120, 6], [240, 6]]);
      screen(g, guide, 'kagero', JP_DD.slice(0, 8), RING);
      const hor = add(g, 'yorktown', 'USS Hornet', 'allied', offset(lead, course, 170), 330, 25, go(330, 25, 900));
      const ent = screen(g, hor, 'yorktown', ['USS Enterprise'], [[90, 10]])[0];
      const raids: Raid[] = [];
      setGoal(g, { targets: ids(carriers), need: Math.min(2, carriers.length), protect: [hor.id], maxLosses: 0, win: 'Two Japanese carriers are gone and Hornet is still flying aircraft. The Army\'s offensive on Guadalcanal has no air cover.', timeout: 'Nagumo\'s carriers withdrew north.', lossText: 'Hornet is sinking, as in history.' });
      g.script = (gg) => {
        at(gg, 400, 'r1', () => raid(gg, raids, carriers.find((c) => c.alive) ?? guide, [hor, ent], 'kate', carriers.filter((c) => c.alive).map((c) => `${c.name} first strike`), 150));
        at(gg, 3000, 'r2', () => raid(gg, raids, carriers.find((c) => c.alive) ?? guide, [hor, ent], 'kate', carriers.filter((c) => c.alive).map((c) => `${c.name} second strike`), 150));
        pressRaids(gg, raids, 3, 0.45, 'Japanese dive bombers and torpedo planes');
      };
    },
  },

  tassafaronga: {
    key: 'tassafaronga', title: 'Tassafaronga', era: '1941', place: 'Off Tassafaronga, Guadalcanal', date: '30 Nov 1942, 2300', night: true,
    library: ['kagero', 'usca', 'brooklyn', 'fletcher'],
    brief: 'Tanaka is back with eight destroyers and drums of supplies for the garrison. Rear Admiral Wright has five cruisers and six destroyers, radar, and the first shot. In history the Long Lances answer that shot and four US cruisers are torn open; Northampton sinks. Sink four of Tanaka\'s destroyers before they can fire, and don\'t lose more than one cruiser.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 2 * 3600;
      const course = 135;
      g.own.hdg = g.own.ordHdg = 315;
      const lead = offset(g.own, 300, 9 + r() * 3);
      const nag = add(g, 'kagero', 'Naganami', 'enemy', lead, course, 20, go(course, 20, 1e9));
      const jp = [nag, ...screen(g, nag, 'kagero', ['Makinami', 'Takanami', 'Kagerō', 'Oyashio', 'Kuroshio', 'Kawakaze', 'Suzukaze'], [[180, 0.6], [90, 1.5], [180, 1.2], [180, 1.8], [180, 2.4], [180, 3], [180, 3.6]])];
      const us0 = offset(g.own, 150, 7.5);
      const min = add(g, 'usca', 'USS Minneapolis', 'allied', us0, 315, 20, go(315, 20, 1e9));
      const cruisers = [min, ...screen(g, min, 'usca', ['USS New Orleans', 'USS Pensacola'], [[180, 0.6], [180, 1.2]]), ...screen(g, min, 'brooklyn', ['USS Honolulu'], [[180, 1.8]]), ...screen(g, min, 'usca', ['USS Northampton'], [[180, 2.4]])];
      const us = [...cruisers, ...screen(g, min, 'fletcher', ['USS Fletcher', 'USS Drayton', 'USS Maury', 'USS Perkins', 'USS Lamson', 'USS Lardner'], [[30, 3], [20, 3.6], [10, 4.2], [0, 4.8], [200, 4], [190, 4.6]])];
      setGoal(g, { targets: ids(jp), need: 4, protect: ids(cruisers), maxLosses: 1, win: 'Tanaka\'s force is broken and the drums never reach the beach. Wright\'s cruisers come home.', timeout: 'Tanaka slipped away up the Slot.', lossText: 'The Long Lances have wrecked Wright\'s cruisers.' });
      g.script = (gg) => melee(gg, jp, us, 6, true, false);
    },
  },

  komandorski: {
    key: 'komandorski', title: 'Komandorski Islands', era: '1941', place: 'Bering Sea', date: '26 Mar 1943, 0800',
    library: ['myoko', 'takao', 'sendai', 'kagero', 'maru', 'usca', 'brooklyn', 'fletcher'],
    brief: 'In the cold Bering Sea, Rear Admiral McMorris\'s small force has found a Japanese convoy for the Aleutian garrisons, and its escort is twice his size: the heavy cruisers Nachi and Maya, two light cruisers and four destroyers. This is a long-range daylight gun duel with no aircraft. Salt Lake City will be hit and stop dead in the water. Sink Nachi and Maya before they finish her.',
    build(g, r, carry) {
      g.startClock = clock(8);
      g.timeLimit = 3 * 3600;
      const course = 90;
      g.own.hdg = g.own.ordHdg = 270;
      const lead = offset(g.own, 270, 10 + r() * 3);
      const nachi = add(g, 'myoko', alive(carry, 'Nachi') ? 'Nachi' : 'Ashigara', 'enemy', lead, course, 26, go(course, 26, 500));
      const maya = add(g, 'takao', alive(carry, 'Maya') ? 'Maya' : 'Takao', 'enemy', offset(lead, 270, 1.2), course, 26, { mode: 'station', leader: nachi.id, rel: 180, rng: 1.2 });
      const jp = [nachi, maya, ...screen(g, nachi, 'sendai', ['Tama', 'Abukuma'], [[150, 3], [210, 3]]), ...screen(g, nachi, 'kagero', ['Wakaba', 'Hatsushimo', 'Ikazuchi', 'Inazuma'], [[45, 3], [315, 3], [90, 3], [270, 3]])];
      const cvy = offset(lead, 300, 12);
      for (const n of ['Asaka Maru', 'Sakito Maru']) add(g, 'maru', n, 'enemy', offset(cvy, r() * 360, 1), 300, 8, go(300, 8, 1e9));
      const slc = add(g, 'usca', 'USS Salt Lake City', 'allied', offset(g.own, 90, 7), 270, 28, go(270, 28, 900));
      const us = [slc, ...screen(g, slc, 'brooklyn', ['USS Richmond'], [[0, 2]]), ...screen(g, slc, 'fletcher', ['USS Bailey', 'USS Coghlan', 'USS Dale', 'USS Monaghan'], [[45, 2], [315, 2], [135, 2], [225, 2]])];
      setGoal(g, { targets: [nachi.id, maya.id], need: 2, protect: [slc.id], maxLosses: 0, win: 'Nachi and Maya are gone. The Aleutian garrisons are cut off.', timeout: 'Hosogaya turned for home with his cruisers.', lossText: 'Salt Lake City has been sunk.' });
      g.script = (gg) => melee(gg, jp, us, 12, false, false, 0.35);
    },
  },

  northcape: {
    key: 'northcape', title: 'North Cape', era: '1941', place: 'Off the North Cape, Norway', date: '26 Dec 1943, 0900', night: true,
    library: ['scharnhorst', 'zerstorer', 'kgv', 'town', 'county', 'flower', 'liberty', 'hclass'],
    brief: 'Arctic winter, dark almost all day. Scharnhorst has come out of Altafjord to fall on convoy JW 55B, bound for Murmansk, and Admiral Fraser is racing to cut her off in Duke of York. History sinks her tonight after a long chase. Get to her first, before she reaches the convoy. Five German destroyers are out looking for it too.',
    build(g, r) {
      g.startClock = clock(9);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 180;
      const cvy = offset(g.own, 90, 14);
      const lib = add(g, 'liberty', 'SS Fort Thompson', 'allied', cvy, 80, 8, go(80, 8, 1e9));
      const ships = [lib, ...screen(g, lib, 'liberty', ['SS Harmatris', 'SS Ocean Gypsy', 'SS John Vining', 'SS Thomas Scott', 'SS British Statesman', 'SS Fort Vercheres', 'SS Andrew Carnegie'], [[0, 1], [90, 1], [270, 1], [180, 1], [45, 1.5], [135, 1.5], [225, 1.5]])];
      screen(g, lib, 'flower', ['HMS Honeysuckle', 'HMS Oxlip'], [[0, 3], [180, 3]]);
      const sch0 = offset(g.own, 200, 14 + r() * 4);
      const sch = add(g, 'scharnhorst', 'Scharnhorst', 'enemy', sch0, brg(sch0, cvy), 26, { mode: 'raider', goal: cvy, cruise: 26 });
      const zs = ['Z29', 'Z30', 'Z33', 'Z34', 'Z38'].map((n, i) => add(g, 'zerstorer', n, 'enemy', offset(sch0, 90 + i * 20, 12), 60, 20, { mode: 'raider', goal: cvy, cruise: 18 }));
      const bel = add(g, 'town', 'HMS Belfast', 'allied', offset(cvy, 200, 8), 200, 22, go(200, 22, 1e9));
      const force1 = [bel, ...screen(g, bel, 'town', ['HMS Sheffield'], [[180, 1]]), ...screen(g, bel, 'county', ['HMS Norfolk'], [[180, 2]])];
      const doy = add(g, 'kgv', 'HMS Duke of York', 'allied', offset(sch0, 240, 40), 60, 24, go(60, 24, 1e9));
      const force2 = [doy, ...screen(g, doy, 'town', ['HMS Jamaica'], [[180, 1]]), ...screen(g, doy, 'hclass', ['HMS Savage', 'HMS Saumarez', 'HMS Scorpion', 'HMS Stord'], [[30, 2], [330, 2], [60, 2], [300, 2]])];
      setGoal(g, { targets: [sch.id], need: 1, protect: ids(ships), maxLosses: 2, win: 'Scharnhorst has gone down off the North Cape. JW 55B sails on to Murmansk.', timeout: 'Scharnhorst escaped back into Altafjord.', lossText: 'Scharnhorst has broken into the convoy.' });
      g.script = (gg) => {
        if (sch.alive) sch.ai!.goal = { x: lib.x, y: lib.y };
        melee(gg, [sch, ...zs], [...ships, ...force1, ...force2], 9, true, false);
      };
    },
  },

  // ---- Before the vortex: optional battles from 1939 to early 1941, outside the campaign story ----
  riverplate: {
    key: 'riverplate', title: 'River Plate', era: '1941', place: 'Off the River Plate, Uruguay', date: '13 Dec 1939, 0600',
    library: ['deutschland', 'county', 'leander'],
    brief: 'Before the vortex: the first naval battle of the war. The pocket battleship Admiral Graf Spee, three months a raider in the South Atlantic, has run into Commodore Harwood\'s cruisers: Exeter, Ajax and Achilles. Her 28 cm guns will wreck Exeter, and she will run for Montevideo and be scuttled four days later. Sink her at sea instead, and save Exeter.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 2.5 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const gs0 = offset(g.own, 0, 12 + r() * 3);
      const spee = add(g, 'deutschland', 'Admiral Graf Spee', 'enemy', gs0, 180, 24, go(180, 24, 600));
      const exe = add(g, 'county', 'HMS Exeter', 'allied', offset(g.own, 200, 4), 20, 25, go(20, 25, 1e9));
      const ajax = add(g, 'leander', 'HMS Ajax', 'allied', offset(g.own, 120, 6), 30, 28, go(30, 28, 1e9));
      const ach = screen(g, ajax, 'leander', ['HMNZS Achilles'], [[180, 1]])[0];
      const montevideo = offset(gs0, 270, 60);
      setGoal(g, { targets: [spee.id], need: 1, protect: [exe.id], maxLosses: 0, win: 'Graf Spee has sunk at sea. Exeter is battered but afloat.', timeout: 'Graf Spee reached Montevideo.', lossText: 'Exeter has been sunk by Graf Spee\'s guns.' });
      g.script = (gg) => {
        if (gg.t > 1500 && spee.ai!.baseCourse !== 270) { spee.ai!.baseCourse = 270; spee.ai!.cruise = 22; log(gg, 'info', 'Graf Spee is turning west for Montevideo, making smoke.'); }
        if (spee.alive && dist(spee, montevideo) < 15) end(gg, false, 'Graf Spee reached the shelter of Montevideo.');
        melee(gg, [spee], [exe, ajax, ach], 10, false, false);
      };
    },
  },

  narvik: {
    key: 'narvik', title: 'Narvik', era: '1941', place: 'Ofotfjord, Norway', date: '10 Apr 1940, 0430',
    library: ['zerstorer', 'hclass', 'frachter'],
    brief: 'Before the vortex: ten German destroyers landed mountain troops at Narvik yesterday and are refuelling in the fjord. Captain Warburton-Lee is taking five British destroyers in through the snow at dawn. He will die on Hardy\'s bridge, and it will take Warspite three days later to finish the job. Help him do it this morning: sink six of the German destroyers.',
    build(g, r) {
      g.startClock = clock(4, 30);
      g.timeLimit = 2 * 3600;
      g.own.hdg = g.own.ordHdg = 90;
      const harbor = offset(g.own, 90, 9);
      const names = ['Wilhelm Heidkamp', 'Anton Schmitt', 'Hans Lüdemann', 'Hermann Künne', 'Diether von Roeder', 'Georg Thiele', 'Wolfgang Zenker', 'Bernd von Arnim', 'Erich Giese', 'Erich Koellner'];
      const zs = names.map((n, i) => (i < 5 ? moored(g, 'zerstorer', n, 'enemy', offset(harbor, i * 72, 1 + (i % 2)), 270) : add(g, 'zerstorer', n, 'enemy', offset(harbor, 20 + (i - 5) * 40, 6 + r() * 4), 270, 0, { mode: 'transit', baseCourse: 270, cruise: 0, legT: 1e9 })));
      for (let i = 0; i < 4; i++) moored(g, 'frachter', ['Bockenheim', 'Frielinghaus', 'Martha Hendrik Fisser', 'Neuenfels'][i], 'enemy', offset(harbor, 200 + i * 20, 2), 90);
      const hardy = add(g, 'hclass', 'HMS Hardy', 'allied', offset(g.own, 270, 3), 90, 15, go(90, 15, 1e9));
      const brits = [hardy, ...screen(g, hardy, 'hclass', ['HMS Hunter', 'HMS Havock', 'HMS Hotspur', 'HMS Hostile'], [[180, 0.6], [180, 1.2], [180, 1.8], [180, 2.4]])];
      setGoal(g, { targets: ids(zs), need: 6, protect: ids(brits), maxLosses: 2, win: 'Six German destroyers are on the bottom of Ofotfjord. Warburton-Lee brings his flotilla out.', timeout: 'Dawn: the German destroyers have got under way.', lossText: 'Warburton-Lee\'s flotilla has been destroyed.' });
      g.script = (gg) => {
        at(gg, 900, 'wake', () => { for (const z of zs.slice(5)) if (z.alive) { z.ai!.cruise = 28; z.ai!.baseCourse = 250; } log(gg, 'warn', 'The German destroyers in the side fjords are getting under way.'); });
        melee(gg, zs, brits, 5, true, true);
      };
    },
  },

  calabria: {
    key: 'calabria', title: 'Calabria', era: '1941', place: 'Off Calabria, Ionian Sea', date: '9 Jul 1940, 1500',
    library: ['cavour', 'zara', 'soldati', 'qe'],
    brief: 'Before the vortex: Admiral Cunningham\'s battle fleet has caught the Italian fleet heading home from a convoy run. Warspite will hit Giulio Cesare at 26,000 yards, one of the longest-range hits ever made at sea, and the Italians will escape behind a smokescreen. Sink both Italian battleships before they get away.',
    build(g, r) {
      g.startClock = clock(15);
      g.timeLimit = 3 * 3600;
      const course = 300;
      g.own.hdg = g.own.ordHdg = 120;
      const lead = offset(g.own, 120, 12 + r() * 3);
      const ces = add(g, 'cavour', 'Giulio Cesare', 'enemy', lead, course, 24, go(course, 24, 600));
      const bbs = [ces, ...screen(g, ces, 'cavour', ['Conte di Cavour'], [[180, 1]])];
      const it = [...bbs, ...screen(g, ces, 'zara', ['Zara', 'Fiume', 'Pola', 'Gorizia'], [[60, 5], [90, 5], [270, 5], [300, 5]]),
        ...screen(g, ces, 'soldati', ['Alfredo Oriani', 'Vittorio Alfieri', 'Giosuè Carducci', 'Vincenzo Gioberti', 'Lanciere', 'Carabiniere'], RING)];
      const war = add(g, 'qe', 'HMS Warspite', 'allied', offset(g.own, 300, 8), 300, 23, go(300, 23, 1e9));
      const brits = [war, ...screen(g, war, 'qe', ['HMS Malaya', 'HMS Royal Sovereign'], [[180, 3], [180, 5]])];
      setGoal(g, { targets: ids(bbs), need: 2, protect: [war.id], maxLosses: 0, win: 'Both Italian battleships are sunk. The Regia Marina will think hard before leaving harbour again.', timeout: 'The Italian fleet escaped behind its smokescreen.', lossText: 'Warspite has been sunk.' });
      g.script = (gg) => melee(gg, it, brits, 13, false, false);
    },
  },

  taranto: {
    key: 'taranto', title: 'Taranto', era: '1941', place: 'Taranto harbour, Italy', date: '11 Nov 1940, 2300', night: true,
    library: ['littorio', 'cavour', 'zara', 'soldati'],
    brief: 'Before the vortex: tonight twenty-one Swordfish biplanes from HMS Illustrious will cripple three Italian battleships at their moorings, the first all-aircraft attack on a fleet in history. Three of them were raised and repaired. Tang has slipped into the Mar Grande ahead of the Swordfish. Sink three battleships for good before dawn. The destroyers on harbour patrol will come hunting when the torpedoes hit.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const anch = offset(g.own, 0, 6);
      const bbs = [['littorio', 'Littorio'], ['littorio', 'Vittorio Veneto'], ['cavour', 'Conte di Cavour'], ['cavour', 'Giulio Cesare'], ['cavour', 'Caio Duilio'], ['cavour', 'Andrea Doria']]
        .map(([c, n], i) => moored(g, c, n, 'enemy', offset(anch, 60 + i * 25, 1.5 + (i % 2) * 1.2), 120));
      for (const [i, n] of ['Zara', 'Fiume', 'Gorizia'].entries()) moored(g, 'zara', n, 'enemy', offset(anch, 300 - i * 20, 2.5), 120);
      for (const [i, n] of ['Lampo', 'Fulmine', 'Baleno', 'Strale'].entries()) add(g, 'soldati', n, 'enemy', offset(anch, 180 + i * 30, 3), 90, 8, { mode: 'picket', center: offset(anch, 180 + i * 30, 3) });
      setGoal(g, { targets: ids(bbs), need: 3, win: 'Three Italian battleships lie on the bottom of the Mar Grande. They will not be raised.', timeout: 'Dawn over Taranto.' });
    },
  },

  matapan: {
    key: 'matapan', title: 'Cape Matapan', era: '1941', place: 'South of Cape Matapan, Greece', date: '28 Mar 1941, 2130', night: true,
    library: ['littorio', 'zara', 'soldati', 'qe'],
    brief: 'Before the vortex: a Swordfish torpedo has stopped the cruiser Pola dead in the water, and Zara and Fiume are coming back in the dark to help her, not knowing Cunningham\'s battleships are waiting with radar. All three will be sunk tonight. But the battleship Vittorio Veneto, torpedoed this afternoon, will get home at 19 knots. Sink Vittorio Veneto.',
    build(g, r) {
      g.startClock = clock(21, 30);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 300;
      const vv0 = offset(g.own, 115 + (r() * 2 - 1) * 12, 14 + r() * 3);
      const vv = add(g, 'littorio', 'Vittorio Veneto', 'enemy', vv0, 300, 19, go(300, 19, 900));
      screen(g, vv, 'soldati', ['Alpino', 'Bersagliere', 'Fuciliere', 'Granatiere'], [[45, 2], [315, 2], [135, 2], [225, 2]]);
      const pola = moored(g, 'zara', 'Pola', 'enemy', offset(g.own, 90, 8), 300);
      const zara = add(g, 'zara', 'Zara', 'enemy', offset(pola, 300, 12), 120, 16, { mode: 'raider', goal: pola, cruise: 16 });
      const fiume = add(g, 'zara', 'Fiume', 'enemy', offset(pola, 300, 13), 120, 16, { mode: 'station', leader: zara.id, rel: 180, rng: 1 });
      const war = add(g, 'qe', 'HMS Warspite', 'allied', offset(pola, 200, 10), 30, 20, go(30, 20, 1e9));
      const brits = [war, ...screen(g, war, 'qe', ['HMS Valiant', 'HMS Barham'], [[180, 1], [180, 2]])];
      setGoal(g, { targets: [vv.id], need: 1, win: 'Vittorio Veneto has gone down off Cape Matapan. The Italian battle fleet will not sail again this year.', timeout: 'Vittorio Veneto reached Taranto.' });
      g.script = (gg) => melee(gg, [zara, fiume, pola], brits, 4, false, false);
    },
  },

  duel: {
    key: 'duel', title: 'Duel: Kazan', era: '2029', place: 'Bear Gap, Norwegian Sea', date: 'March 2029, 0200', night: true,
    library: ['yasen', 'akula', 'virginia', 'ka27', 'il38'],
    brief: 'Back in the present war. A Yasen-M, Kazan, is in your patrol box, quiet and armed, an Il-38N is laying sonobuoys overhead to cue it, and a Ka-27 helicopter is dipping its sonar. Find Kazan on passive sonar and sink it before they find you.',
    build(g, r) {
      g.startClock = clock(2);
      const startBrg = r() * 360;
      const p = offset(g.own, startBrg, 11 + r() * 3);
      const kaz = add(g, 'yasen', 'Kazan (K-561)', 'enemy', p, norm(startBrg + 180 + (r() * 2 - 1) * 60), 7, { mode: 'patrol', legT: 300 + r() * 300, decoys: 2 }, r() < 0.5 ? 2 : 1);
      // An Il-38N works the same patrol box, laying sonobuoys and cueing Kazan.
      const center = offset(g.own, r() * 360, r() * 10);
      const ilBrg = r() * 360;
      add(g, 'il38', 'Il-38N May', 'enemy', offset(center, ilBrg, 70), norm(ilBrg + 180), 300, { mode: 'search', center, wp: center, buoyT: 0, torps: 2, datum: null });
      // A Ka-27PL from a frigate over the horizon hops between dips with its sonar.
      const kaBrg = r() * 360;
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(center, kaBrg, 35), norm(kaBrg + 180), 120, { mode: 'search', center, wp: offset(center, r() * 360, r() * 8), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: [kaz.id], need: 1, win: 'Kazan has been sunk.', timeout: '' });
    },
  },
};
