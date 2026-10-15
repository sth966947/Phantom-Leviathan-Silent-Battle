// Modern war missions: pacific. Act 2, the Western Pacific war with China, June to September 2029:
// the long way round (B1, P13, P14), arrival (P1, P2, P15), Taiwan (P3, P16, P17), the first
// island chain (P4, P5, P18) and the run south past the Spratlys (P6).
import { brg, dist, gauss, offset, type Vec } from '../math';
import { end, log, type Game, type Vessel } from '../sim';
import { mineField, mineLine } from '../hazards';
import {
  add, arrive, at, byId, clock, flag, go, ids, isSunk, keepCourse, mins, moored, pointDefence, pressRaids, raid, screen,
  setGoal, skirmish, steer, watch, type Mission, type MissionKey, type ObjectiveFn, type Raid,
} from '../kit';

/** A point from Tang's start, by bearing and range: the brief gives every position this way. */
const P = (b: number, d: number): Vec => offset({ x: 0, y: 0 }, b, d);
const fired = (g: Game) => Object.values(g.stats.fired).some((n) => n > 0);
const sunkBy = (g: Game, v: Vessel) => g.sunk.find((s) => s.name === v.name);
const pad = (b: number) => Math.round(b).toString().padStart(3, '0');

const kq200 = (g: Game, name: string, from: Vec, center: Vec) =>
  add(g, 'kq200', name, 'enemy', from, brg(from, center), 300, { mode: 'search', center, wp: { ...center }, buoyT: 0, torps: 2, datum: null });

/** Bombers flying out to a launch point: when one gets there it fires and turns for home. */
interface Bomber { v: Vessel; launch: Vec; done: boolean }
function bomberWave(g: Game, list: Bomber[], target: Vec, from: number, n: number, launchR: number, startR = 200) {
  for (let i = 0; i < n; i++) {
    const b = from + (i - (n - 1) / 2) * 6;
    const launch = offset(target, b, launchR), p = offset(target, b, startR);
    const v = add(g, 'h6k', `H-6K ${list.length + 1}`, 'enemy', p, brg(p, launch), 450, { mode: 'strike', goal: launch, cruise: 450 });
    v.track = [];
    list.push({ v, launch, done: false });
  }
  log(g, 'warn', `Radio intercepts: ${n} H-6K bombers inbound from bearing ${pad(from)}. At periscope depth the radar sees them high up out to 100 nm; SM-6 can bring them down before they launch.`);
}
/** Bombers that reached their launch point this tick. */
function launched(list: Bomber[]) {
  const out: Bomber[] = [];
  for (const b of list) {
    if (b.done) continue;
    if (!b.v.gone) { if (!b.v.alive) b.done = true; continue; }
    b.done = true;
    out.push(b);
  }
  return out;
}

// ---- Fixed points, shared with the balance captains ----------------------------------------------
export const B1_ANCH = P(190, 12);
export const P13_EXIT = P(250, 40);
export const P14_BOX = P(0, 8), P14_MOUTH = P(0, 12);
export const GUAM = P(120, 14);
export const P15_MOUTH = P(15, 22);
export const P3_BEACH = P(60, 22), P3_START = P(300, 20);
export const MAKUNG = P(90, 9);
export const KAO = P(30, 30);
export const SUBIC = P(90, 14);
export const P5_LINE = P(270, 14);
export const UOTSURI = P(0, 24);
export const P6_EXIT = P(220, 40);

export const missions: Record<MissionKey, Mission> = {
  // ---- The long way round -------------------------------------------------------------------------
  B1: {
    key: 'B1', title: 'Caribbean Run', era: '2029', place: 'Off Colón, Panama', date: 'June 2029, 0500',
    library: ['type209', 'riachuelo', 'kalvari', 'tanker', 'lng', 'boxship'],
    brief: 'Tang is ordered to the Pacific, and the quick way is the Panama Canal. The pact wants it shut first. Five merchant ships are anchored off Colón waiting for the locks, 12 nm south of you (bearing 190). A Venezuelan Type 209, Sábalo, is coming in from the east to torpedo them, and a Brazilian Riachuelo-class boat, Humaitá, is lying across your path, somewhere 6 to 10 nm south of you, to keep you away. Sink both boats within three and a half hours. If three of the merchants are sunk, the wrecks and the danger close the canal and the mission fails. Both boats are diesel-electric and quiet on the battery; Sábalo will be louder while she hurries.',
    build(g, r) {
      g.startClock = clock(5);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 190;
      const ships: [string, string][] = [['tanker', 'MT Cristóbal Spirit'], ['lng', 'LNG Gatún Star'], ['boxship', 'MV Pacific Hope'], ['tanker', 'MT Bahía Grande'], ['boxship', 'MV Atlantic Dawn']];
      const merchants = ships.map(([cls, name], i) => moored(g, cls, name, 'allied', offset(B1_ANCH, i * 72 + r() * 30, 1 + r() * 1.5), r() * 360));
      const sp = offset(B1_ANCH, 60 + r() * 50, 23 + r() * 3);
      const sab = add(g, 'type209', 'ARV Sábalo (S-31)', 'enemy', sp, brg(sp, B1_ANCH), 12, { mode: 'raider', decoys: 2, torps: 4 }, 1);
      const hp = offset(g.own, 190 + (r() * 2 - 1) * 30, 6 + r() * 4);
      const hum = add(g, 'riachuelo', 'Humaitá (S41)', 'enemy', hp, r() * 360, 5, { mode: 'patrol', legT: 400, decoys: 2 }, 1);
      setGoal(g, { targets: [sab.id, hum.id], need: 2, protect: ids(merchants), maxLosses: 2,
        win: 'Both pact boats are on the bottom. The canal stays open and the Pacific Fleet\'s ships can come through.',
        lossText: 'Three ships are sunk at the canal mouth. The Panama Canal Authority has closed the approaches.',
        timeout: 'Time is up and a pact boat is still loose off the canal. The approaches are closed.' });
      // Humaitá keeps to her patrol line across the approach.
      g.script = (gg) => { if (hum.alive && hum.ai!.mode === 'patrol' && dist(hum, hp) > 3) keepCourse(hum, brg(hum, hp), 5); };
    },
  },

  P13: {
    key: 'P13', title: 'Drake Passage', era: '2029', place: 'Off Cape Horn', date: 'June 2029, 1400',
    library: ['riachuelo', 'type209', 'alvaro', 'kalvari'],
    brief: 'The canal is shut, so Tang goes the long way: round Cape Horn into the Pacific. It is blowing a full gale, sea state 6. Wave noise deafens every sonar, yours and theirs, and the periscope sees half as far. A Brazilian Riachuelo-class boat, Tonelero, picked you up off the Falklands and is a couple of miles astern, in your baffles. She is under orders to track you, not to shoot first. Get to the turning point 40 nm west-southwest (bearing 250) within four hours, and get there without her: sink her or lose her. If she holds you for 40 minutes in all, her report goes out and the pact will be waiting for you in the Pacific.',
    build(g, r) {
      g.startClock = clock(14);
      g.timeLimit = 4 * 3600;
      g.env.sea = 6;
      g.own.hdg = g.own.ordHdg = 250;
      const sh = add(g, 'riachuelo', 'Tonelero (S42)', 'enemy', offset(g.own, 70 + (r() * 2 - 1) * 15, 1.5 + r()), 250, 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      sh.ai!.knows = { x: 0, y: 0, t: 0, deep: false };
      setGoal(g, { timeout: 'Four hours and we are still short of the Pacific.' });
      g.flags.held = 0;
      g.script = (gg) => {
        const ai = sh.ai!, k = ai.knows;
        const fresh = sh.alive && !!k && gg.t - k.t < 240;
        if (sh.alive && !fired(gg) && sh.hp === sh.cls.hp) {
          // Shadowing: keep a mile or so back on where she reckons we are, and never shoot first.
          ai.cool = 300; ai.holdT = 0; ai.legT = 1e9;
          if (ai.mode === 'attack') ai.mode = 'patrol';
          if (ai.mode === 'patrol') {
            // She reckons we are still heading for the Pacific at about 10 knots, and works along our track, sprinting and drifting.
            const aim = k ? offset(k, 250, Math.min(30, ((gg.t - k.t) / 3600) * 10)) : P13_EXIT;
            const d = dist(sh, aim);
            sh.ordHdg = brg(sh, aim); sh.ordSpd = d > 4 ? 18 : d > 1.5 ? 12 : 5;
          }
          if (fresh && dist(sh, gg.own) < 10) gg.flags.held++;
          if (gg.flags.held === 1200) log(gg, 'warn', 'Sonar: Tonelero is still with us. Twenty minutes of track: she\'ll have enough for her report soon.');
          if (gg.flags.held >= 2400) end(gg, false, 'Tonelero got her report out. The pact knows Tang is coming round the Horn.');
        }
        if (dist(gg.own, P13_EXIT) < 3) {
          if (!fresh) end(gg, true, 'Tang is round the Horn and into the Pacific with nobody on her tail.');
          else if (!gg.flags.stillOn) { gg.flags.stillOn = 1; log(gg, 'warn', 'XO: we\'re at the turning point, but Tonelero is still holding us. Shake her or sink her.'); }
        }
      };
    },
  },

  P14: {
    key: 'P14', title: 'Pearl Again', era: '2029', place: 'Off Pearl Harbor, Oahu', date: 'July 2029, 0300', night: true,
    library: ['type093b', 'type095', 'type039', 'virginia'],
    brief: 'Pearl Harbor, where Tang\'s war began in December 1941. A Chinese Type 093B, Changzheng 16, slipped in tonight and is sowing mines in the approaches to the harbour mouth, 12 nm north of you. She keeps laying until she is stopped. The fleet sorties in two and a quarter hours. Sink the minelayer and make sure every mine in the approaches is marked on the plot for the sweepers. The mine-hunting sonar finds mines close in, better when slow. An active ping marks every mine within 3 nm, but every boat within 60 nm hears it. A mine under the hull does heavy damage: two will sink Tang.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 2.25 * 3600;
      const box = P14_BOX;
      mineField(g, box, 3.5, 8);
      const lay = add(g, 'type093b', 'Changzheng 16', 'enemy', offset(box, r() * 360, 1 + r() * 2), r() * 360, 4, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      let wp = offset(box, r() * 360, r() * 3.5);
      g.flags.laid = 8;
      setGoal(g, { timeout: 'The fleet is sortieing and the approaches are still not clear.' });
      g.script = (gg) => {
        if (lay.alive && lay.ai!.mode === 'patrol') {
          if (dist(lay, wp) < 0.4) wp = offset(box, gg.r() * 360, gg.r() * 3.5);
          keepCourse(lay, brg(lay, wp), 3);
          // A mine every six minutes while she is on her laying run.
          if (gg.t % 360 === 0 && gg.flags.laid < 18) { mineField(gg, { x: lay.x, y: lay.y }, 0.05, 1); gg.flags.laid++; }
        }
        const left = gg.mines.filter((m) => m.side === 'enemy' && !m.found).length;
        if (!lay.alive && !left) end(gg, true, 'The minelayer is sunk and every mine is marked. The sweepers can clear a lane before the fleet sails.');
      };
    },
  },

  // ---- Arrival -----------------------------------------------------------------------------------
  P1: {
    key: 'P1', title: 'Guam', era: '2029', place: 'Off Guam, Marianas', date: 'July 2029, 0900',
    library: ['type093b', 'type095', 'type039', 'h6k', 'h6j', 'kq200'],
    brief: 'Guam is the hub of the Pacific war, and China means to shut it. H-6K bombers are coming from the northwest in waves to fire YJ-12 missiles at Andersen and Apra Harbor from 50 nm out, and a Type 093B, Changzheng 11, is somewhere off the far side of the island to spot for them. Guam is 14 nm southeast of you (bearing 120). Hold out for three hours: if four missiles get through, the airfield and port are out of the war. At periscope depth your radar sees the bombers high up out to 100 nm, and SM-6 can bring them down before they launch. While the 093B lives, it gives the bombers their aim points and fires YJ-18s of its own between raids: sink it and far fewer missiles will find their targets.',
    build(g, r) {
      g.startClock = clock(9);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 300;
      const sp = offset(GUAM, 30 + r() * 150, 8 + r() * 5); // on the far side of the island
      const spot = add(g, 'type093b', 'Changzheng 11', 'enemy', sp, r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, r() < 0.5 ? 2 : 1);
      setGoal(g, { surviveWin: true, win: 'The raids are over and Guam is still in the fight.', timeout: '' });
      const bombers: Bomber[] = [];
      g.flags.guamHits = 0;
      const waves: [number, number][] = [[12, 4], [18, 4], [70, 6], [76, 5], [130, 7]];
      g.script = (gg) => {
        waves.forEach(([m, n], i) => at(gg, m * 60, `wave${i}`, () => bomberWave(gg, bombers, GUAM, 290 + gg.r() * 45, n, 50)));
        // A spotting boat keeps near the island.
        if (spot.alive && spot.ai!.mode === 'patrol' && dist(spot, GUAM) > 16) keepCourse(spot, brg(spot, GUAM), 6);
        for (const b of launched(bombers)) {
          const p = spot.alive ? 0.45 : 0.15;
          let hits = 0;
          for (let k = 0; k < 2; k++) if (gg.r() < p) hits++;
          gg.flags.guamHits += hits;
          log(gg, 'danger', `${b.v.name} has launched two YJ-12s at Guam. ${hits ? `${hits} hit${hits > 1 ? 's' : ''} on ${gg.r() < 0.5 ? 'Andersen' : 'Apra Harbor'}.` : 'Both shot down by the island\'s defences.'}`, 'alarm');
        }
        // Between raids the 093B fires YJ-18s of her own from her torpedo tubes, unless she is busy dodging.
        if (spot.alive && gg.t % 2400 === 1500 && spot.ai!.mode !== 'evade') {
          let hits = 0;
          for (let k = 0; k < 2; k++) if (gg.r() < 0.5) hits++;
          gg.flags.guamHits += hits;
          log(gg, 'danger', `Sonar: missile launch transients, bearing ${pad(brg(gg.own, spot))}! Changzheng 11 has fired two YJ-18s at Guam. ${hits ? `${hits} hit${hits > 1 ? 's' : ''}.` : 'Both shot down.'}`, 'alarm');
        }
        if (gg.flags.guamHits >= 4) end(gg, false, 'Four missiles have hit Guam. Andersen and Apra Harbor are out of the war.');
      };
    },
  },

  P2: {
    key: 'P2', title: 'Okinawa', era: '2029', place: 'East China Sea, west of Okinawa', date: 'July 2029, 1100',
    library: ['type093b', 'type054a', 'type052d', 'type039', 'type056'],
    brief: 'Okinawa is the anchor of the first island chain, and a US amphibious group is waiting east of the island to come in. A Chinese hunter group holds the western approaches: two Type 054A frigates, Yuncheng and Rizhao, sweeping with their hull sonar, and a Type 093B, Changzheng 19, working with them. All three are 10 to 20 nm west and northwest of you. Sink all three within four hours. The frigates hear well and will come for you with torpedoes as soon as they do, and their close-in guns can shoot down some of your anti-ship missiles. At periscope depth your radar finds and identifies them inside 15 nm.',
    build(g, r) {
      g.startClock = clock(11);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 300;
      const c = P(300 + (r() * 2 - 1) * 15, 15);
      const ff = ['Yuncheng', 'Rizhao'].map((n, i) => add(g, 'type054a', n, 'enemy', offset(c, i * 180 + r() * 90, 3 + r() * 3), r() * 360, 8, { mode: 'patrol', legT: 300 + r() * 300 }));
      const ss = add(g, 'type093b', 'Changzheng 19', 'enemy', offset(c, r() * 360, 4 + r() * 4), r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, r() < 0.5 ? 2 : 1);
      setGoal(g, { targets: [...ids(ff), ss.id], need: 3, win: 'The hunter group is gone. The amphibious group can come in to Okinawa.', timeout: 'The approaches are still not clear.' });
      g.script = (gg) => pointDefence(gg, ff, 0.45);
    },
  },

  P15: {
    key: 'P15', title: 'Yokosuka', era: '2029', place: 'Sagami Bay, off Tokyo Bay', date: 'July 2029, 2300', night: true,
    library: ['type093b', 'taigei', 'type039', 'type095', 'virginia'],
    brief: 'Japan is all in. Two Type 093Bs are working into Sagami Bay: Changzheng 15 is making for the Uraga Channel and the shipping of Tokyo Bay, 22 nm north-northeast of you (bearing 015), and Changzheng 17 is hunting somewhere west of you. You are hunting them with JS Taigei, a Japanese diesel boat, which starts 6 nm west of you and works the western half of the bay. Sink both 093Bs within four hours; Taigei\'s kills count. Taigei sounds like a submarine because she is one: identify every contact by its signature before you fire, and remember a torpedo takes the first hull its seeker finds. If you sink Taigei, the mission fails. If Changzheng 15 gets into the channel, it fails too.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const tg = add(g, 'taigei', 'JS Taigei (SS-513)', 'allied', P(270, 6), 0, 5, undefined, 1);
      const rp = P(185 + (r() * 2 - 1) * 20, 16 + r() * 4);
      const cz15 = add(g, 'type093b', 'Changzheng 15', 'enemy', rp, brg(rp, P15_MOUTH), 9, { mode: 'raider', goal: P15_MOUTH, cruise: 11, decoys: 2 }, 1);
      const cz17 = add(g, 'type093b', 'Changzheng 17', 'enemy', offset(P(260, 12), r() * 360, 2 + r() * 3), r() * 360, 6, { mode: 'patrol', legT: 400, decoys: 2 }, r() < 0.5 ? 2 : 1);
      const box = [P(300, 10), P(250, 9), P(280, 15), P(220, 6)];
      setGoal(g, { targets: [cz15.id, cz17.id], need: 2, win: 'Both 093Bs are sunk. Sagami Bay is ours and Japan\'s.', timeout: 'A 093B is still loose in Sagami Bay.' });
      g.flags.leg = 0;
      g.script = (gg) => {
        const foes = [cz15, cz17].filter((v) => v.alive);
        // Taigei works her half of the bay and closes on anything she hears there.
        const near = foes.filter((f) => dist(f, tg) < 6).sort((a, b) => dist(a, tg) - dist(b, tg))[0];
        if (near) steer(tg, near, 6);
        else { const wp = box[gg.flags.leg % box.length]; if (dist(tg, wp) < 0.6) gg.flags.leg++; steer(tg, wp, 5); }
        skirmish(gg, [tg], foes, 3, 0.12, 0.06, 0.5);
        if (arrive(gg, cz15, P15_MOUTH, 1.5)) end(gg, false, 'Changzheng 15 is in the Uraga Channel among the Tokyo Bay shipping.');
        if (!tg.alive && sunkBy(gg, tg)?.by === 'us') end(gg, false, 'We sank JS Taigei. Japan\'s navy will not forget it.');
      };
    },
  },

  // ---- Taiwan ------------------------------------------------------------------------------------
  P3: {
    key: 'P3', title: 'Taiwan Strait', era: '2029', place: 'Taiwan Strait', date: 'August 2029, 0400', night: true,
    library: ['type075', 'type071', 'type052d', 'type054a', 'type901'],
    brief: 'The invasion has begun. An amphibious group is crossing the strait for the beaches south of Taoyuan: the assault ship Hainan (Type 075) and two Type 071 docks, Wuzhi Shan and Siming Shan, with the destroyers Taiyuan and Hohhot (Type 052D) as escort. They are 20 nm northwest of you (bearing 300), making about 12 knots east for the beach 22 nm northeast (bearing 060). Sink two of the three landing ships before they get there; if two reach the beach, the mission fails. The PLA has laid a mine line across the strait about 3 to 4 nm north of you to cover the group\'s southern flank: the HF sonar will show you the mines. The escorts\' close-in guns can shoot down some of your anti-ship missiles.',
    build(g, r) {
      g.startClock = clock(4);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      mineLine(g, P(300, 7), P(60, 7), 16, 'enemy', 0.3);
      const course = brg(P3_START, P3_BEACH);
      const lhd = add(g, 'type075', 'Hainan', 'enemy', P3_START, course, 12, go(course, 12, 1e9));
      const lpds = screen(g, lhd, 'type071', ['Wuzhi Shan', 'Siming Shan'], [[150, 1.5], [210, 1.5]]);
      const dd = screen(g, lhd, 'type052d', ['Taiyuan', 'Hohhot'], [[0, 3], [100 + r() * 20, 3]]);
      const landers = [lhd, ...lpds];
      setGoal(g, { targets: ids(landers), need: 2, win: 'Two of the landing ships are sunk in the strait. The assault on the Taoyuan beaches is broken.', timeout: 'The landing went in.' });
      g.flags.landed = 0;
      g.script = (gg) => {
        pointDefence(gg, [...landers, ...dd], 0.8);
        for (const v of landers) {
          if (v.ai?.mode === 'transit' || v.ai?.mode === 'alert') v.ai.baseCourse = brg(v, P3_BEACH);
          if (arrive(gg, v, P3_BEACH, 2)) { gg.flags.landed++; log(gg, 'danger', `${v.name} has reached the beach and is putting her troops ashore.`); }
        }
        if (gg.flags.landed >= 2) end(gg, false, 'Two landing ships reached the beach. The PLA has a foothold on Taiwan.');
      };
    },
  },

  P16: {
    key: 'P16', title: 'Penghu', era: '2029', place: 'Penghu Islands, Taiwan Strait', date: 'August 2029, 1600',
    library: ['type022', 'type054a', 'type056', 'type052d'],
    brief: 'The Penghu Islands sit in the middle of the strait, and whoever holds them holds the strait. Taiwan\'s garrison at Makung, 9 nm east of you, is holding on, and the PLA is sending waves of Type 022 missile boats from the mainland to the west to fire on it from 22 nm out. Two Type 054A frigates, Huangshan and Yiyang, are hunting for you between the islands and the mainland. Keep the islands in the fight for 2 hours 45 minutes: if three boats reach their firing point, the garrison\'s defences are gone. The catamarans are fast and loud, and Harpoon or Tomahawk will kill one with one hit, though their guns shoot down some missiles.',
    build(g, r) {
      g.startClock = clock(16);
      g.timeLimit = 2.75 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const ff = ['Huangshan', 'Yiyang'].map((n, i) => add(g, 'type054a', n, 'enemy', P(250 + i * 40 + r() * 20, 8 + r() * 6), r() * 360, 8, { mode: 'patrol', legT: 300 + r() * 300 }));
      interface Fac { v: Vessel; fire: Vec; done: boolean }
      const boats: Fac[] = [];
      let hull = 2208;
      const wave = (gg: Game) => {
        const b = 270 + (gg.r() * 2 - 1) * 75; // from anywhere along the mainland coast, north-northwest round to south-southwest
        const fire = offset(MAKUNG, b, 22);
        for (let i = 0; i < 8; i++) {
          const p = offset(offset(MAKUNG, b, 45), b + 90, (i - 3.5) * 1.2);
          boats.push({ v: add(gg, 'type022', `Type 022 boat ${hull++}`, 'enemy', p, brg(p, fire), 36, go(brg(p, fire), 36, 1e9)), fire: offset(fire, b + 90, (i - 3.5) * 0.8), done: false });
        }
        log(gg, 'warn', `Radio intercepts: eight Type 022 missile boats leaving the mainland, bearing ${pad(brg(gg.own, offset(MAKUNG, b, 45)))} from us, making 36 knots for Penghu.`);
      };
      setGoal(g, { surviveWin: true, win: 'The missile boat raids are spent. Penghu holds, and the strait stays contested.', timeout: '' });
      g.flags.salvos = 0;
      g.script = (gg) => {
        [5, 35, 65, 95].forEach((m, i) => at(gg, m * 60, `wave${i}`, () => wave(gg)));
        pointDefence(gg, ff, 0.45);
        pointDefence(gg, boats.map((f) => f.v), 0.5);
        for (const f of boats) {
          if (f.done || !f.v.alive) continue;
          if (f.v.ai!.mode === 'transit') f.v.ai!.baseCourse = brg(f.v, f.fire);
          if (arrive(gg, f.v, f.fire, 1)) {
            f.done = true; gg.flags.salvos++;
            log(gg, 'danger', `${f.v.name} has fired her YJ-83s at Makung and is turning for home. ${gg.flags.salvos} of 3.`, 'alarm');
          }
        }
        if (gg.flags.salvos >= 3) end(gg, false, 'Three missile boat salvos have hit Makung. The garrison\'s defences are gone and Penghu will fall.');
      };
    },
  },

  P17: {
    key: 'P17', title: 'Blockade Runner', era: '2029', place: 'Off Kaohsiung, Taiwan', date: 'August 2029, 0200', night: true,
    library: ['type039', 'type093b', 'h6k', 'kq200', 'tanker', 'lng', 'boxship'],
    brief: 'Taiwan is under blockade and running short of fuel. Three ships are making a run for Kaohsiung, 30 nm north-northeast of you (bearing 030): the tanker Kaohsiung Star, the LNG carrier Formosa Spirit and the container ship Ever Steady, at 12 knots with Tang as their only escort. At least two Type 039 Yuans are waiting along the route, and H-6K bombers will come for the ships once the PLA knows where they are, in more than one raid. Get them in: lose no more than one. Radar at periscope depth sees the bombers high up out to 100 nm, and SM-6 can bring them down.',
    build(g, r) {
      g.startClock = clock(2);
      g.timeLimit = 3.5 * 3600;
      const course = brg({ x: 0, y: 0 }, KAO);
      g.own.hdg = g.own.ordHdg = course;
      const ships = ([['tanker', 'MT Kaohsiung Star'], ['lng', 'LNG Formosa Spirit'], ['boxship', 'MV Ever Steady']] as const)
        .map(([cls, n], i) => add(g, cls, n, 'allied', offset(g.own, course + 180, 0.5 + i), course, 12, go(course, 12, 1e9)));
      const yuans = ['Yuan 336', 'Yuan 341'].map((n, i) => {
        const p = offset(offset(g.own, course, 10 + i * 9 + r() * 4), course + (r() < 0.5 ? 90 : -90), 2 + r() * 3);
        return add(g, 'type039', n, 'enemy', p, brg(p, g.own), 3, { mode: 'raider', decoys: 2, torps: 2 }, 1);
      });
      const raids: Raid[] = [];
      setGoal(g, { protect: ids(ships), maxLosses: 1, win: 'The ships are alongside in Kaohsiung. Taiwan has fuel for another month.',
        lossText: 'Two of the three ships are sunk. The blockade holds.', timeout: 'Dawn, and the ships are still at sea. They will never make it in daylight.' });
      g.script = (gg) => {
        for (const v of ships) {
          if (v.ai?.mode === 'transit') v.ai.baseCourse = brg(v, KAO);
          if (arrive(gg, v, KAO, 1.5)) log(gg, 'good', `${v.name} is inside the Kaohsiung breakwater.`);
        }
        // The Yuans lie in wait until the ships come within reach.
        for (const y of yuans) if (y.alive && !gg.flags[`go${y.id}`]) {
          y.ordSpd = 0;
          if (ships.some((s) => s.alive && dist(s, y) < 12)) gg.flags[`go${y.id}`] = 1;
        }
        at(gg, 45 * 60, 'raid', () => raid(gg, raids, offset(KAO, 300, 160), ships, 'h6k', ['H-6K 1', 'H-6K 2', 'H-6K 3', 'H-6K 4'], 450));
        at(gg, 100 * 60, 'raid2', () => raid(gg, raids, offset(KAO, 270, 160), ships, 'h6k', ['H-6K 5', 'H-6K 6', 'H-6K 7', 'H-6K 8'], 450));
        at(gg, 115 * 60, 'raid3', () => raid(gg, raids, offset(KAO, 330, 160), ships, 'h6k', ['H-6K 9', 'H-6K 10', 'H-6K 11', 'H-6K 12', 'H-6K 13', 'H-6K 14'], 450));
        pressRaids(gg, raids, 2, 0.75, 'a YJ-12');
        if (ships.every((v) => !v.alive) && ships.filter(isSunk).length <= 1) end(gg, true, gg.goal.win);
      };
    },
  },

  // ---- The first island chain ---------------------------------------------------------------------
  P4: {
    key: 'P4', title: 'Luzon', era: '2029', place: 'Off Subic Bay, Luzon', date: 'August 2029, 1300',
    library: ['type039', 'type054a', 'type093b', 'kilo', 'tender', 'arleigh'],
    brief: 'The US fleet is coming back to Subic Bay, and the PLA got there first underwater. Two Type 039 Yuans are lying quiet off the bay mouth, 14 nm east of you, and the frigate Xianning (Type 054A) is patrolling outside. The submarine tender USS Emory S. Land, with USS Halsey as escort, is 14 nm west of you and will make for the bay at 12 knots. Sink both Yuans within 3 hours 30 minutes. If either US ship is sunk, the mission fails. On their batteries the Yuans are very quiet: an active ping finds a submarine much farther out than you can hear one, but every boat within 60 nm hears it and knows exactly where you are. Once the tender is close, the Yuans will leave their stations and go for her.',
    build(g, r) {
      g.startClock = clock(13);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 90;
      const yuans = ['Yuan 337', 'Yuan 339'].map((n) => {
        const p = offset(SUBIC, 230 + r() * 80, 2 + r() * 3);
        return { v: add(g, 'type039', n, 'enemy', p, r() * 360, 2, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.5 ? 2 : 1), hold: p };
      });
      add(g, 'type054a', 'Xianning', 'enemy', P(70 + r() * 40, 8 + r() * 4), r() * 360, 8, { mode: 'patrol', legT: 400 });
      const f0 = P(270, 14);
      const tender = add(g, 'tender', 'USS Emory S. Land (AS-39)', 'allied', f0, 90, 12, go(90, 12, 1e9));
      const [ddg] = screen(g, tender, 'arleigh', ['USS Halsey (DDG-97)'], [[0, 2]]);
      setGoal(g, { targets: yuans.map((y) => y.v.id), need: 2, protect: [tender.id, ddg.id], maxLosses: 0,
        win: 'Both Yuans are sunk. Subic Bay is open for the fleet.', lossText: 'A US ship has been torpedoed off Subic Bay.', timeout: 'A Yuan is still lying off Subic Bay. The fleet can\'t use it.' });
      g.script = (gg) => {
        if (tender.alive && tender.ai?.mode === 'transit') {
          tender.ai.baseCourse = brg(tender, SUBIC);
          if (dist(tender, SUBIC) < 1) tender.ai.cruise = 0;
        }
        const close = tender.alive && dist(tender, SUBIC) < 14;
        for (const y of yuans) {
          if (!y.v.alive) continue;
          if (close && y.v.ai!.mode !== 'raider') {
            y.v.ai!.mode = 'raider'; y.v.ai!.prey = tender.id;
            if (!gg.flags.raiders) { gg.flags.raiders = 1; log(gg, 'warn', 'Sonar: transients from the bay mouth. The Yuans are moving out after the tender.'); }
          }
          if (y.v.ai!.mode === 'patrol') keepCourse(y.v, brg(y.v, y.hold), dist(y.v, y.hold) > 0.5 ? 3 : 0);
        }
      };
    },
  },

  P5: {
    key: 'P5', title: 'Bashi Channel', era: '2029', place: 'Bashi Channel, Luzon Strait', date: 'September 2029, 0100', night: true,
    library: ['type039', 'type093b', 'kilo', 'kq200', 'ka28'],
    brief: 'The Luzon Strait is the door between the Pacific and the South China Sea, and a wolfpack of three Type 039 Yuans holds it. They lie in a line running north and south about 14 nm west of you, about 7 nm apart, and a KQ-200 patrol plane is laying sonobuoys over them. When one of them hears you, it tells the others. Sink two of the three within four hours. Keep your speed down near the buoys, and stay off periscope depth when the plane is close.',
    build(g, r) {
      g.startClock = clock(1);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const pack = ['Yuan 333', 'Yuan 338', 'Yuan 342'].map((n, i) =>
        add(g, 'type039', n, 'enemy', offset(P5_LINE, i ? (i === 1 ? 0 : 180) : 90, (i ? 7 : 0) + (r() * 2 - 1) * 1.5), r() * 360, 4, { mode: 'patrol', legT: 300 + r() * 400, decoys: 2 }, r() < 0.5 ? 2 : 1));
      kq200(g, 'KQ-200 3601', offset(P5_LINE, 270, 80), P5_LINE);
      setGoal(g, { targets: ids(pack), need: 2, win: 'Two Yuans are sunk and the pack is broken. The Bashi Channel is open.', timeout: 'The pack still holds the channel.' });
      g.script = (gg) => {
        // The pack talks: a boat with a firm contact passes it to the others every couple of minutes.
        if (gg.t % 120) return;
        const sure = pack.find((v) => v.alive && v.ai!.knows && gg.t - v.ai!.knows.t < 10 && v.ai!.holdT > 30);
        if (!sure) return;
        const k = sure.ai!.knows!;
        for (const v of pack) if (v.alive && v !== sure && dist(v, k) < 10) {
          const e = 2.5 + dist(v, k) * 0.2;
          v.ai!.knows = { x: k.x + gauss(gg.r) * e, y: k.y + gauss(gg.r) * e, t: gg.t, deep: k.deep };
          if (v.ai!.mode === 'patrol') v.ai!.mode = 'attack';
        }
      };
    },
  },

  P18: {
    key: 'P18', title: 'Senkaku', era: '2029', place: 'Senkaku Islands, East China Sea', date: 'September 2029, 0500',
    library: ['type071', 'ccg', 'type052d', 'type054a', 'type056'],
    brief: 'China is landing troops on the Senkakus. The landing ship Yimeng Shan (Type 071) is 28 nm west-northwest of you, making 12 knots for Uotsuri-jima, 24 nm north. The destroyers Nanning and Zibo (Type 052D) escort her, and three China Coast Guard cutters ride close around her to make it a police matter. Sink Yimeng Shan before she reaches the island, within three and a half hours. Do not hit the cutters: one hit on a coast guard ship and Tokyo calls the whole thing off, and the mission fails. The cutters and the 071 sound alike on sonar; the radar at periscope depth tells them apart inside 15 nm, and a torpedo or missile takes the first hull it finds near its aim point. The destroyers\' close-in guns can shoot down some of your missiles.',
    build(g, r) {
      g.startClock = clock(5);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 330;
      const p = P(295 + (r() * 2 - 1) * 6, 28);
      const course = brg(p, UOTSURI);
      const lpd = add(g, 'type071', 'Yimeng Shan', 'enemy', p, course, 12, go(course, 12, 1e9));
      const dd = screen(g, lpd, 'type052d', ['Nanning', 'Zibo'], [[60, 4], [300, 4]]);
      const cutters = screen(g, lpd, 'ccg', ['Haijing 2901', 'Haijing 2502', 'Haijing 2306'], [[r() * 40, 1 + r() * 0.6], [120 + r() * 40, 1 + r() * 0.6], [240 + r() * 40, 1 + r() * 0.6]]);
      setGoal(g, { targets: [lpd.id], need: 1, win: 'Yimeng Shan is sinking. The landing is off, and not one coast guard ship was touched.', timeout: 'Yimeng Shan is still afloat, and she will be off the island by dark.' });
      g.script = (gg) => {
        pointDefence(gg, [lpd, ...dd], 0.55);
        if (lpd.ai?.mode === 'transit' || lpd.ai?.mode === 'alert') lpd.ai.baseCourse = brg(lpd, UOTSURI);
        if (arrive(gg, lpd, UOTSURI, 1.5)) end(gg, false, 'Yimeng Shan is off Uotsuri-jima and her troops are going ashore.');
        const hit = cutters.find((c) => c.hp < c.cls.hp);
        if (hit) end(gg, false, `We hit the coast guard cutter ${hit.name}. Tokyo has called off the operation.`);
      };
    },
  },

  // ---- The southern seas -------------------------------------------------------------------------
  P6: {
    key: 'P6', title: 'Spratly Gauntlet', era: '2029', place: 'Spratly Islands, South China Sea', date: 'September 2029, 0600',
    library: ['type055', 'type052d', 'type056', 'kq200', 'ka28', 'h6k'],
    brief: 'Tang is ordered south to the Indonesian straits, and the short way runs through the Spratlys, past China\'s island airfields. Get to the exit point 40 nm southwest of you (bearing 220) within four hours. The cruiser Nanchang (Type 055) is hunting the passage with a very good sonar and a strong air defence, and from 20 minutes in, every 40 minutes, each airfield sends up a KQ-200 to lay sonobuoys along the passage: a buoy that hears you gives Nanchang your position. Subi Reef (bearing 255, 24 nm), Fiery Cross (bearing 215, 38 nm) and Mischief Reef (bearing 185, 28 nm) can be shut down with two Tomahawk hits each. A launch from periscope depth shows any aircraft nearby where you are.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 220;
      const fields: [string, Vec][] = [['Subi Reef airfield', P(255, 24)], ['Fiery Cross Reef airfield', P(215, 38)], ['Mischief Reef airfield', P(185, 28)]];
      fields.forEach(([name, p], i) => g.sites.push({ id: -(i + 1), name, x: p.x, y: p.y, hits: 0 }));
      const mid = P(220, 25);
      const cg = add(g, 'type055', 'Nanchang', 'enemy', offset(mid, r() * 360, 3 + r() * 5), r() * 360, 10, { mode: 'patrol', legT: 400 });
      const planes: Vessel[] = [];
      setGoal(g, { timeout: 'Four hours and Tang is still inside the Spratlys.' });
      g.script = (gg) => {
        if (gg.t % 2400 === 1200) for (const s of gg.sites) if (s.hits < 2) {
          const c = P(220 + (gg.r() * 2 - 1) * 10, 8 + gg.r() * 34); // somewhere along the passage
          planes.push(kq200(gg, `KQ-200 (${s.name.replace(' airfield', '')})`, s, offset(c, gg.r() * 360, gg.r() * 4)));
          log(gg, 'warn', `ESM and intelligence: a KQ-200 is up from ${s.name.replace(' airfield', '')}.`);
        }
        for (const s of gg.sites) if (s.hits >= 2 && !gg.flags[`shut${s.id}`]) { gg.flags[`shut${s.id}`] = 1; log(gg, 'good', `${s.name} is cratered. No more aircraft from there.`); }
        pointDefence(gg, [cg], 0.55);
        if (dist(gg.own, P6_EXIT) < 3) end(gg, true, 'Tang is through the Spratlys and into open water to the south.');
      };
    },
  },
};

// ---- Objectives: what the pause screen lists, live -----------------------------------------------
const reached = (g: Game, p: Vec, within: number, text: string) => {
  const d = dist(g.own, p);
  return { text, state: (g.over?.win || d < within ? 'done' : 'open') as 'done' | 'open', detail: `${d.toFixed(1)} nm to go.` };
};

export const extras: Record<MissionKey, ObjectiveFn> = {
  P13: (g, b) => {
    const held = flag(g, 'held'), sh = g.vessels.find((v) => v.name.startsWith('Tonelero'));
    return [
      reached(g, P13_EXIT, 3, 'Reach the turning point 40 nm west-southwest'),
      { text: 'Shake Tonelero or sink her', state: sh && isSunk(sh) ? 'done' : held >= 2400 ? 'failed' : 'open',
        detail: sh && isSunk(sh) ? 'Sunk.' : `She has held us for ${mins(held)} of 40 min.` },
      ...b,
    ];
  },
  P14: (g, b) => {
    const lay = g.vessels.find((v) => v.name === 'Changzheng 16');
    const ms = g.mines.filter((m) => m.side === 'enemy'), found = ms.filter((m) => m.found).length;
    return [
      { text: 'Sink the minelayer, Changzheng 16', state: lay && isSunk(lay) ? 'done' : 'open', detail: lay && isSunk(lay) ? 'Sunk. No more mines.' : `She has laid about ${flag(g, 'laid')} mines so far and is still laying.` },
      { text: 'Mark every mine in the approaches', state: g.over?.win ? 'done' : 'open', detail: `${found} found so far.` },
      watch('Don\'t hit a mine: two will sink Tang', g.over?.reason.includes('mine') ?? false),
      ...b,
    ];
  },
  P1: (g, b) => {
    const spot = g.vessels.find((v) => v.name === 'Changzheng 11');
    return [
      watch('Keep the missile hits on Guam below four', flag(g, 'guamHits') >= 4, `${flag(g, 'guamHits')} of 4 hits so far.`),
      { text: 'Sink the spotter, Changzheng 11', state: spot && isSunk(spot) ? 'done' : 'open', detail: spot && isSunk(spot) ? 'Sunk. The bombers are firing blind.' : 'While she lives, the bombers\' missiles are far more accurate, and she fires her own.' },
      ...b,
    ];
  },
  P15: (g, b) => [...b,
    watch('Don\'t sink JS Taigei', !!g.over?.reason.includes('Taigei')),
    watch('Stop Changzheng 15 reaching the Uraga Channel', !!g.over?.reason.includes('Uraga')),
  ],
  P3: (g, b) => [...b, watch('Don\'t let two landing ships reach the beach', flag(g, 'landed') >= 2, `${flag(g, 'landed')} of 2 have landed.`)],
  P16: (g, b) => [...b, watch('Stop the missile boats reaching their firing point', flag(g, 'salvos') >= 3, `${flag(g, 'salvos')} of 3 salvos have hit Makung.`)],
  P17: (g, b) => {
    const ships = byId(g, g.goal.protect), docked = ships.filter((v) => v.gone).length;
    return [{ text: 'Bring the ships into Kaohsiung', state: g.over?.win ? 'done' : 'open', detail: `${docked} of ${ships.length} in so far.` }, ...b];
  },
  P18: (g, b) => [
    ...b.filter((o) => !o.text.startsWith('Hold')),
    watch('Stop her before she reaches Uotsuri-jima', !!g.over?.reason.includes('ashore')),
    watch('Don\'t hit a coast guard cutter', !!g.over?.reason.includes('coast guard')),
  ],
  P6: (g, b) => [
    reached(g, P6_EXIT, 3, 'Reach the exit point 40 nm southwest'),
    { text: 'Shut the airfields with Tomahawks (optional)', state: g.sites.every((s) => s.hits >= 2) ? 'done' : 'open', detail: `${g.sites.map((s) => `${s.name.replace(' airfield', '')} ${Math.min(2, s.hits)}/2`).join(', ')}.` },
    ...b,
  ],
};
