// Missions: who is where at the start, what the player must do, and the script that runs the
// mission's events (strike waves launching, pickets reporting, midget subs reaching harbour).
// The WWII campaign runs in date order; ships sunk in earlier missions stay sunk (`Carry`).

import { brg, dist, norm, offset, type Vec } from './math';
import { end, fireStraight, log, makeAI, makeVessel, shellfire, type AI, type Game, type Goal, type Side, type Vessel } from './sim';

export type MissionKey =
  | 'bismarck' | 'midgets' | 'kidobutai' | 'doolittle' | 'midway' | 'pq17'
  | 'guadalcanal' | 'ons5' | 'philsea' | 'leyte' | 'shinano' | 'tengo' | 'duel';

/** What earlier missions changed: the names of enemy ships Tang has already sunk. */
export interface Carry { sunk: string[] }

export interface Mission {
  key: MissionKey; title: string; era: '1941' | '2029'; place: string; date: string;
  night?: boolean; library: string[]; brief: string;
  build: (g: Game, r: () => number, carry: Carry) => void;
}

/** The WWII campaign, in date order. */
export const CAMPAIGN: MissionKey[] = ['bismarck', 'midgets', 'kidobutai', 'doolittle', 'midway', 'pq17', 'guadalcanal', 'ons5', 'philsea', 'leyte', 'shinano', 'tengo'];

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
    brief: 'Hornet has sixteen Army B-25s lashed to her flight deck, and Enterprise is covering her. Historically the picket boat Nittō Maru spotted the task force at 0738 and radioed Tokyo, and the bombers had to launch ten hours early, 170 miles farther out than planned. Tang is ahead of the task force. Find the picket boats and sink them before they can report. A Kawanishi flying boat is patrolling high overhead.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 2.5 * 3600;
      const course = 270;
      g.own.hdg = g.own.ordHdg = course;
      const tfPos = offset(g.own, 90, 22);
      const hornet = add(g, 'yorktown', 'USS Hornet', 'allied', tfPos, course, 20, { mode: 'transit', baseCourse: course, cruise: 20, legT: 900 });
      add(g, 'yorktown', 'USS Enterprise', 'allied', offset(tfPos, 0, 3), course, 20, { mode: 'station', leader: hornet.id, rel: 0, rng: 3 });
      screen(g, hornet, 'atlanta', ['USS Nashville'], [[270, 4]]);
      screen(g, hornet, 'fletcher', ['USS Gwin', 'USS Meredith', 'USS Grayson', 'USS Monssen'], [[300, 6], [60, 6], [150, 5], [210, 5]]);
      const line = offset(g.own, course, 26 + r() * 4);
      const pickets = ['No. 23 Nittō Maru', 'Nagato Maru', 'Awata Maru'].map((n, i) => {
        const c = offset(line, 0, (i - 1) * 16 + (r() * 2 - 1) * 4);
        return add(g, 'picket', n, 'enemy', c, r() * 360, 6, { mode: 'picket', center: c });
      });
      add(g, 'mavis', 'Kawanishi H6K', 'enemy', offset(line, 0, 40), 180, 120, { mode: 'wander', center: line, rng: 40, cruise: 120 });
      setGoal(g, { targets: ids(pickets), need: pickets.length, surviveWin: true, win: 'No report reached Tokyo. Hornet launches the raid from the planned spot.', timeout: '' });
      g.script = (gg) => {
        const sender = pickets.find((p) => p.alive && (p.ai!.reportT ?? 0) >= 240);
        if (sender) end(gg, false, `${sender.name}'s report reached Tokyo. The raid launches early and far out.`);
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
