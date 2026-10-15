// Modern war missions: home. See the Modern Campaign Plan and src/sim/warData.ts for where each one sits in the war.
// Act 3: home waters (E0, E5, E6) in December 2029, then the South Atlantic (E1, E3, E7, E8, E2, E4, E11, E14)
// from late December 2029 into January 2030.
import { brg, dist, fmtBrg, gauss, norm, offset, type Vec } from '../math';
import type { ClassCard } from '../classes';
import { atPeriscopeDepth, depthT, end, log, shellfire, type Game, type Vessel } from '../sim';
import { mineLine, type Mine } from '../hazards';
import {
  add, arrive, at, baseObjectives, byId, clock, flag, go, ids, isSunk, keepCourse, mins, missileSalvo, moored, pointDefence,
  screen, setGoal, skirmish, steer, watch, type Mission, type MissionKey, type ObjectiveFn,
} from '../kit';

// ---- Helpers -----------------------------------------------------------------------------------
/** Mines scattered in a box `len` nm long and `half` nm either side of a line from `a` on `course`. */
function mineLane(g: Game, a: Vec, course: number, len: number, half: number, n: number): Mine[] {
  const out: Mine[] = [];
  for (let i = 0; i < n; i++) {
    const p = offset(offset(a, course, g.r() * len), course + 90, (g.r() * 2 - 1) * half);
    const m: Mine = { id: g.seq++, side: 'enemy', found: false, x: p.x, y: p.y };
    g.mines.push(m);
    out.push(m);
  }
  return out;
}
/** How far along and across a lane from `a` on `course` a point lies. */
function inLane(p: Vec, a: Vec, course: number) {
  const r = dist(a, p), d = ((brg(a, p) - course) * Math.PI) / 180;
  return { along: r * Math.cos(d), across: Math.abs(r * Math.sin(d)) };
}
/** A friendly patrol plane circling a spot (no AI: it only flies the pattern). */
function circle(v: Vessel, c: Vec, rad: number) {
  if (!v.alive) return;
  v.ordSpd = 250;
  v.ordHdg = dist(v, c) > rad ? brg(v, c) : norm(brg(v, c) + 95);
}
/** A patrol plane's report of where it thinks a submarine is, rough by `err` nm. */
function cue(g: Game, who: string, v: Vessel, err: number) {
  if (!v.alive) return;
  const p = { x: v.x + gauss(g.r) * err, y: v.y + gauss(g.r) * err };
  log(g, 'contact', `${who}: possible submarine, bearing ${fmtBrg(brg(g.own, p))}, about ${Math.max(1, Math.round(dist(g.own, p)))} nm from you.`);
}
/**
 * Frigates screening a landing force: they keep station until the force is attacked or sees a
 * periscope, then the first `hunters` of them go hunting with their hull sonar along the line of the attack.
 */
function screenUntilStung(g: Game, frig: Vessel[], charges: Vessel[], hunters = frig.length) {
  if (g.flags.stung || !charges.some((v) => v.hp < v.cls.hp || v.ai?.mode === 'alert' || !v.alive)) return;
  g.flags.stung = 1;
  for (const f of frig.slice(0, hunters)) {
    if (!f.alive) continue;
    const e = 2.5;
    f.ai!.knows = { x: g.own.x + gauss(g.r) * e, y: g.own.y + gauss(g.r) * e, t: g.t, deep: false };
    f.ai!.mode = 'attack';
  }
  log(g, 'warn', `Sonar: ${hunters > 1 ? 'the frigates are' : 'a frigate is'} speeding up and turning toward us, coming hunting.`);
}
/** Escorts that go in first (so the log names the force by their navy) and take station on `lead` once it exists. */
const frigates = (g: Game, cls: string, names: string[], at: Vec, course: number, spd: number, spots: [number, number][]) =>
  names.map((n, i) => add(g, cls, n, 'enemy', offset(at, course + spots[i][0], spots[i][1]), course, spd, { mode: 'station', rel: spots[i][0], rng: spots[i][1] }));
/** A diesel boat snorkelling: its diesels make it far louder for a while. */
const snortCard = (c: ClassCard): ClassCard => ({ ...c, slBase: c.slBase + 20 });
/** Shallow water: Tang can't go deeper than `ft`. */
function shelf(g: Game, ft: number) {
  if (g.own.ordDepth <= depthT(ft)) return;
  g.own.ordDepth = depthT(ft);
  if (!g.flags.shelfWarned) log(g, 'warn', `Navigator: there is only ${ft + 60} feet of water under us here. Holding ${ft} feet.`);
  g.flags.shelfWarned = 1;
}
const minesLeft = (g: Game, set: Set<number>) => g.mines.filter((m) => set.has(m.id)).length;

export const missions: Record<MissionKey, Mission> = {
  // ---- Home waters ---------------------------------------------------------------------------------
  E0: {
    key: 'E0', title: 'Homecoming', era: '2029', place: 'Off Norfolk, Virginia', date: 'December 2029, 0500', night: true,
    library: ['akula', 'yasen', 'kilo', 'virginia', 'arleigh'],
    brief: 'Tang is home, and the Russians got here first. An Akula, Volk, slipped in overnight and sowed mines in the Atlantic Ocean Channel, the swept lane into Chesapeake Bay and Norfolk. The channel starts 2 nm west of you and runs west for 12 nm to Cape Henry, about a mile wide. Volk is still about, laying more. Find the mines in the channel and the MH-60S helicopters will destroy each one you mark. The HF sonar finds mines quietly within a mile when you are slow; an active ping shows every mine within 3 nm, but Volk will hear it. Clear the channel and sink Volk within four hours, before the Ford strike group comes home. If Volk gets 35 nm out to sea, it is gone. A mine does heavy damage: two will sink Tang.',
    build(g, r) {
      g.startClock = clock(5);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      g.own.ordSpd = 6;
      const mouth = offset(g.own, 270, 2), lane = 270, len = 12;
      const chan = new Set(mineLane(g, mouth, lane, len, 0.45, 8).map((m) => m.id));
      const p = offset(mouth, lane, 6 + r() * 3);
      const volk = add(g, 'akula', 'Akula (Volk)', 'enemy', offset(p, r() < 0.5 ? 0 : 180, 0.3), 90, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      const sea = offset(g.own, 60 + r() * 30, 35);
      g.flags.total = chan.size;
      g.flags.cleared = 0;
      g.script = (gg) => {
        // The helicopters destroy each marked mine in the channel a minute and a half after we mark it.
        for (const m of gg.mines) {
          if (!chan.has(m.id) || !m.found) continue;
          const k = `mc${m.id}`;
          if (!gg.flags[k]) gg.flags[k] = gg.t;
          else if (gg.t - gg.flags[k] >= 90) {
            gg.mines = gg.mines.filter((x) => x !== m);
            gg.flags.cleared++;
            log(gg, 'good', `MH-60S: mine destroyed in the channel. ${gg.flags.cleared} cleared so far.`);
            break;
          }
        }
        if (volk.alive) {
          const { along, across } = inLane(volk, mouth, lane);
          // Volk runs east down the channel laying as it goes, then makes for deep water.
          if (along < 0.5) gg.flags.layDone = 1;
          const laying = along < len && !gg.flags.layDone;
          keepCourse(volk, laying ? 90 + Math.max(-20, Math.min(20, (volk.y - mouth.y) * 40)) : brg(volk, sea), laying ? 5 : 9);
          if (laying && volk.ai!.mode === 'patrol' && across < 0.6 && gg.t % 600 === 300) {
            const m: Mine = { id: gg.seq++, side: 'enemy', found: false, x: volk.x, y: volk.y };
            gg.mines.push(m); chan.add(m.id); gg.flags.total++;
          }
          if (arrive(gg, volk, sea, 2)) end(gg, false, 'Volk reached deep water and got away. It will be back with more mines.');
        }
        if (isSunk(volk) && minesLeft(gg, chan) === 0) end(gg, true, 'The channel is clear and Volk is on the bottom. The Ford group can come home.');
      };
      setGoal(g, { timeout: 'Four hours gone and the channel still isn\'t safe. The Ford group has to stand off.' });
    },
  },

  E5: {
    key: 'E5', title: 'Kings Bay', era: '2029', place: 'Off St Marys Inlet, Georgia', date: 'December 2029, 0200', night: true,
    library: ['yasen', 'akula', 'virginia', 'trawler', 'boxship', 'p8a'],
    brief: 'A Yasen-M, Arkhangelsk, is waiting off the Georgia coast for the next missile boat to leave Kings Bay. USS Tennessee sails at 0430, two and a half hours from now; St Marys Inlet is 14 nm west of you. Find Arkhangelsk and sink it before then, or it will pick up her trail and the deterrent patrol is blown. A P-8A out of Jacksonville is working the area and will pass you its best guess of the Yasen\'s position every 20 minutes. The Russian spy ship Viktor Leonov is loitering offshore too: if it sees your periscope inside 4 nm it will tell the Yasen where you are. Container ships are coming in and out of Jacksonville; they are friendly.',
    build(g, r) {
      g.startClock = clock(2);
      g.timeLimit = 2.5 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const inlet = offset(g.own, 270, 14);
      const lair = offset(inlet, 90 + (r() * 2 - 1) * 45, 7 + r() * 4);
      const ys = add(g, 'yasen', 'Arkhangelsk (K-564)', 'enemy', offset(lair, r() * 360, 2), r() * 360, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.5 ? 2 : 1);
      const spy = offset(g.own, r() * 360, 6 + r() * 4);
      const leonov = add(g, 'trawler', 'Viktor Leonov', 'enemy', spy, r() * 360, 4, go(0, 4, 1e9));
      const p8 = add(g, 'p8a', 'P-8A Poseidon', 'allied', offset(lair, 45, 30), 225, 250);
      const ships: [Vessel, Vec][] = [
        [add(g, 'boxship', 'MV Atlantic Sail', 'allied', offset(inlet, 80, 4), 95, 15, go(95, 15, 1e9)), offset(inlet, 95, 45)],
        [add(g, 'boxship', 'MV Bahia Laura', 'allied', offset(g.own, 60 + r() * 30, 20), 260, 14, go(260, 14, 1e9)), inlet],
      ];
      setGoal(g, { targets: [ys.id], need: 1, win: 'Arkhangelsk is on the bottom off Georgia. Tennessee slips out unseen.', timeout: 'Tennessee cleared the sea buoy with Arkhangelsk still waiting for her. The patrol is compromised.' });
      let dir = r() < 0.5 ? 0 : 180;
      g.script = (gg) => {
        circle(p8, ys.alive ? lair : inlet, 12);
        if (gg.t % 1200 === 60 && ys.alive) cue(gg, 'P-8A Poseidon', ys, 2.5);
        if (ys.y > lair.y + 3) dir = 180;
        if (ys.y < lair.y - 3) dir = 0;
        keepCourse(ys, norm(dir + Math.max(-30, Math.min(30, (lair.x - ys.x) * 15)) * (dir ? -1 : 1)), 5);
        if (leonov.alive) {
          leonov.ai!.baseCourse = dist(leonov, spy) > 3 ? brg(leonov, spy) : leonov.ai!.baseCourse;
          if (atPeriscopeDepth(gg) && dist(gg.own, leonov) < 4 && gg.r() < 0.004 && ys.alive && ys.ai!.mode === 'patrol') {
            ys.ai!.knows = { x: gg.own.x, y: gg.own.y, t: gg.t, deep: false, exact: true };
            ys.ai!.mode = 'attack'; ys.ai!.holdT = 120;
            gg.flags.leonov = 1;
            log(gg, 'danger', `Radio intercept: Viktor Leonov is transmitting, bearing ${fmtBrg(brg(gg.own, leonov))}. She has seen our periscope and is telling Arkhangelsk.`, 'alarm');
          }
        }
        for (const [s, to] of ships) arrive(gg, s, to, 2);
        at(gg, 2 * 3600, 'sail', () => log(gg, 'warn', 'Kings Bay: Tennessee is under way down the St Marys channel. Half an hour to the sea buoy.'));
      };
    },
  },

  E6: {
    key: 'E6', title: 'Halifax', era: '2029', place: 'Approaches to Halifax, Nova Scotia', date: 'December 2029, 1300',
    library: ['akula', 'kilo', 'yasen', 'type209', 'virginia', 'type26'],
    brief: 'The next convoy to Europe is forming in Bedford Basin, and the Russians have two boats waiting outside Halifax: an Akula working the approaches somewhere 8 to 14 nm east of you, and a Kilo lying quietly off Chebucto Head, about 10 nm northwest of you. Sink both within three and a half hours so the convoy can sail. A Kilo running on its battery is nearly silent, but it has to snorkel to charge it: listen for the diesels. HMCS Fraser, Canada\'s first River-class frigate (a Type 26), is hunting with you and may get a shot in; don\'t torpedo her. From 45 minutes in, she will pass you a rough position whenever her towed array hears the Akula. A December gale is blowing: wave noise covers quiet contacts, and the periscope sees less.',
    build(g, r) {
      g.startClock = clock(13);
      g.timeLimit = 3.5 * 3600;
      g.env.sea = 4;
      g.own.hdg = g.own.ordHdg = 320;
      const head = offset(g.own, 320, 10);
      const den = offset(head, 140 + (r() * 2 - 1) * 40, 3 + r() * 2);
      const kilo = add(g, 'kilo', 'Kilo (Kaluga)', 'enemy', den, r() * 360, 3, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      const box = offset(g.own, 90 + (r() * 2 - 1) * 50, 9 + r() * 4);
      const ak = add(g, 'akula', 'Akula (Samara)', 'enemy', box, r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, r() < 0.5 ? 2 : 1);
      const fr = add(g, 'type26', 'HMCS Fraser', 'allied', offset(g.own, 200, 4), 90, 10);
      const quiet = kilo.cls, loud = snortCard(quiet);
      const legs = [offset(g.own, 90, 8), offset(g.own, 30, 10), offset(head, 120, 5), offset(g.own, 150, 8)];
      const snortAt = Math.floor(r() * 1200);
      setGoal(g, { targets: [kilo.id, ak.id], need: 2, win: 'Both boats are sunk. The convoy sails from Halifax tonight.', timeout: 'The boats are still outside Halifax. The convoy stays in Bedford Basin.' });
      g.script = (gg) => {
        // The Kilo snorkels for 12 minutes in every 30, unless it is fighting or running.
        const snort = (gg.t - snortAt) % 1800 < 720 && gg.t > snortAt && kilo.ai!.mode === 'patrol';
        kilo.cls = snort ? loud : quiet;
        if (kilo.ai!.mode === 'patrol') { kilo.ordDepth = snort ? 0 : 1; keepCourse(kilo, dist(kilo, den) > 1.5 ? brg(kilo, den) : norm(kilo.hdg + 1), 3); }
        // The Akula wanders its box, and turns back into it if it strays.
        if (dist(ak, box) > 5) keepCourse(ak, brg(ak, box), 7);
        const leg = legs[Math.floor(gg.t / 1500) % legs.length];
        steer(fr, leg, 12);
        skirmish(gg, [fr], [kilo, ak], 3, 0.08, 0.1, 0.5);
        // Fraser's towed array catches the Akula now and then, and she passes it on.
        if (fr.alive && gg.t >= 2700 && (gg.t - 2700) % 1800 === 0 && dist(fr, ak) < 16) cue(gg, 'HMCS Fraser', ak, 2);
      };
    },
  },

  // ---- The South Atlantic erupts ------------------------------------------------------------------
  E1: {
    key: 'E1', title: 'Brazil\'s Gambit', era: '2029', place: 'Off Ascension Island', date: 'December 2029, 0600',
    library: ['jalashwa', 'tamandare', 'riachuelo', 'kalvari', 'type075'],
    brief: 'Brazil has come into the war with a grab for Ascension Island, the airfield halfway across the South Atlantic. Two dock landing ships with Brazilian Marines aboard, Bahia and Mattoso Maia, are coming in from the west-southwest with two Tamandaré frigates screening ahead; Ascension is 10 nm east of you and the force about 40 nm beyond it to the west-southwest. The ID book has no Brazilian landing ship: they are closest to the Indian Jalashwa, another ex-US dock ship. Two Riachuelo boats, Humaitá and Tonelero, are out ahead as a screen, somewhere between you and the force. Sink both landing ships. If either gets within 3 nm of the island, the Marines are ashore and Ascension is lost. The frigates have good hull sonar: once the force is attacked or sees a periscope, they will come hunting.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 4 * 3600;
      const isle = offset(g.own, 80, 10);
      const from = 245 + (r() * 2 - 1) * 15;
      const start = offset(isle, from, 42);
      const course = brg(start, isle);
      g.own.hdg = g.own.ordHdg = norm(from);
      const frig = frigates(g, 'tamandare', ['Tamandaré (F200)', 'Jerônimo de Albuquerque (F201)'], start, course, 14, [[-30, 4], [30, 4]]);
      const bahia = add(g, 'jalashwa', 'Bahia (G40)', 'enemy', start, course, 14, go(course, 14, 1e9));
      for (const f of frig) f.ai!.leader = bahia.id;
      const maia = screen(g, bahia, 'jalashwa', ['Mattoso Maia (G28)'], [[180, 2]])[0];
      add(g, 'riachuelo', 'Humaitá (S41)', 'enemy', offset(offset(isle, from, 16 + r() * 6), from + 90, (r() * 2 - 1) * 5), r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      add(g, 'riachuelo', 'Tonelero (S42)', 'enemy', offset(offset(isle, from, 11 + r() * 4), from + 90, (r() * 2 - 1) * 6), r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      const lsts = [bahia, maia];
      setGoal(g, { targets: ids(lsts), need: 2, win: 'Both landing ships are sunk. The Brazilian force is turning for home and Ascension holds.', timeout: 'The landing force is still out there, waiting its chance.' });
      g.script = (gg) => {
        screenUntilStung(gg, frig, lsts);
        pointDefence(gg, frig, 0.35);
        // Landing ships that lose their way keep coming for the beach once they've run.
        for (const l of lsts) if (l.alive && l.ai!.mode === 'transit') l.ai!.baseCourse = brg(l, isle);
        for (const l of lsts) if (l.alive && dist(l, isle) < 3) { end(gg, false, `${l.name} has reached Ascension and the Marines are ashore. The island is lost.`); return; }
      };
    },
  },

  E3: {
    key: 'E3', title: 'Essequibo', era: '2029', place: 'Off the Essequibo coast, Guyana', date: 'December 2029, 0400', night: true,
    library: ['ropucha', 'tamandare', 'type209', 'tanker', 'lng', 'riachuelo'],
    brief: 'Venezuela is making its move on Guyana\'s oil coast while Brazil covers it. Four Venezuelan tank landing ships, Capana, Esequibo, Goajira and Los Llanos, are running down the coast from the northwest with two Brazilian Tamandaré frigates as escort, one of which will come hunting once the force is attacked, making for the beaches about 18 nm south-southwest of you. Their Korean-built hulls are closest to the Russian Ropucha in the ID book. Sink at least three; if two get within 3 nm of the beach, the landing has succeeded. This is shallow water: Tang can\'t get below 250 feet, so there is no layer to hide under. Shuttle tankers for the offshore oil fields are anchored along the coast; they are friendly, and a torpedo will take whatever it finds. The Venezuelan sub Sábalo may be about.',
    build(g, r) {
      g.startClock = clock(4);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 300;
      const beach = offset(g.own, 200, 18);
      const start = offset(g.own, 305 + (r() * 2 - 1) * 15, 26);
      const course = brg(start, beach);
      const frig = frigates(g, 'tamandare', ['Cunha Moreira (F202)', 'Mariz e Barros (F203)'], start, course, 11, [[-50, 3], [50, 3]]);
      const lead = add(g, 'ropucha', 'Capana (T-61)', 'enemy', start, course, 11, go(course, 11, 1e9));
      for (const f of frig) f.ai!.leader = lead.id;
      const lsts = [lead, ...screen(g, lead, 'ropucha', ['Esequibo (T-62)', 'Goajira (T-63)', 'Los Llanos (T-64)'], [[180, 1], [180, 2], [180, 3]])];
      // Shuttle tankers at anchor off the oil terminals, near the landing force's track.
      const mid = offset(start, course, dist(start, beach) * (0.45 + r() * 0.2));
      ['MT Cap Lara', 'MT Kriti Ruby', 'MT Nordic Breeze'].forEach((n, i) => moored(g, 'tanker', n, 'allied', offset(mid, course + 90 + i * 120 + r() * 40, 2 + r() * 2), r() * 360));
      add(g, 'type209', 'Sábalo (S-31)', 'enemy', offset(beach, 20 + r() * 60, 6 + r() * 3), r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      setGoal(g, { targets: ids(lsts), need: 3, win: 'Three landing ships are on the bottom. The grab for the Essequibo has failed.', timeout: 'The landing force is still off the coast at dawn, unbeaten.' });
      g.flags.landed = 0;
      g.script = (gg) => {
        shelf(gg, 250);
        screenUntilStung(gg, frig, lsts, 1);
        pointDefence(gg, frig, 0.55);
        for (const l of lsts) {
          if (l.alive && l.ai!.mode === 'transit') l.ai!.baseCourse = brg(l, beach);
          if (arrive(gg, l, beach, 3)) {
            gg.flags.landed++;
            log(gg, 'danger', `${l.name} has beached and is putting her tanks ashore.`, 'alarm');
            if (gg.flags.landed >= 2) end(gg, false, 'Two landing ships got their troops ashore. Venezuela holds the Essequibo coast.');
          }
        }
      };
    },
  },

  E7: {
    key: 'E7', title: 'Falklands', era: '2029', place: 'North of the Falkland Islands', date: 'December 2029, 2200', night: true,
    library: ['tamandare', 'riachuelo', 'kalvari', 'type26', 'boxship', 'tanker'],
    brief: 'Britain\'s fleet is in the North Atlantic, and Brazil thinks the Falklands are there for the taking. A small convoy is bringing reinforcements and fuel to Mare Harbour: the sealift ships Hurst Point and Anvil Point and the tanker Wave Knight, escorted by HMS Glasgow, a Type 26. Tang is with them. Get them in: lose no more than one in the next three hours. Two Tamandaré frigates are coming from the west to cut them off; if they get within 30 nm of the convoy for ten minutes, they will fire Exocets. A Riachuelo is waiting ahead somewhere on the convoy\'s track. A strong westerly is blowing: wave noise covers quiet contacts, and the periscope sees less.',
    build(g, r) {
      g.startClock = clock(22);
      g.timeLimit = 3 * 3600;
      g.env.sea = 4;
      const course = 210;
      g.own.hdg = g.own.ordHdg = course;
      const lead = add(g, 'type26', 'HMS Glasgow', 'allied', offset(g.own, course, 2), course, 12, go(course, 12, 1e9));
      const ships = [...screen(g, lead, 'boxship', ['MV Hurst Point', 'MV Anvil Point'], [[150, 2], [210, 2]]), ...screen(g, lead, 'tanker', ['RFA Wave Knight'], [[180, 3.5]])];
      const frig = ['Independência (F44)', 'União (F45)'].map((n, i) => {
        const p = offset(lead, 275 + (i ? 12 : -12) + (r() * 2 - 1) * 10, 80 + r() * 10);
        return add(g, 'tamandare', n, 'enemy', p, brg(p, lead), 22, { mode: 'patrol', legT: 1e9 });
      });
      const ambush = offset(lead, course + (r() * 2 - 1) * 12, 16 + r() * 6);
      const sub = add(g, 'riachuelo', 'Tonelero (S42)', 'enemy', ambush, norm(course + 180), 4, { mode: 'raider', cruise: 6, decoys: 2, torps: 4 }, 1);
      setGoal(g, { targets: [], protect: ids(ships), maxLosses: 1, surviveWin: true,
        win: 'The convoy is inside Mare Harbour\'s air cover. The Falklands are reinforced.', lossText: 'Two ships of the convoy are gone. The Falklands garrison will have to hold with what it has.', timeout: '' });
      g.flags.closeT = 0;
      g.flags.fired = 0;
      g.script = (gg) => {
        pointDefence(gg, frig, 0.5);
        // Glasgow's towed array and Merlin give her a chance at the Riachuelo if it comes close.
        skirmish(gg, [lead], [sub], 3, 0.15, 0.1, 0.5);
        for (const f of frig) keepCourse(f, brg(f, lead.alive ? lead : ships[0]), 22);
        // Ten minutes inside 30 nm sets up a full salvo; half an hour more brings the last of their Exocets.
        if (frig.some((f) => f.alive && ships.some((s) => s.alive && dist(f, s) < 30))) gg.flags.closeT++;
        const salvo = (n: number) => { gg.flags.fired++; for (const f of frig) if (f.alive) missileSalvo(gg, f.name, 'sea-skimming Exocet', n, ships, lead.alive ? 0.25 : 0.45, 2); };
        if (gg.flags.closeT === 300) log(gg, 'warn', 'HMS Glasgow: Brazilian fire-control radar to the west. The frigates are setting up an Exocet shot.');
        if (gg.flags.closeT === 600) salvo(4);
        if (gg.flags.closeT === 2400) salvo(2);
      };
    },
  },

  E8: {
    key: 'E8', title: 'Gulf of Guinea', era: '2029', place: 'Off the Niger Delta, Nigeria', date: 'December 2029, 1000',
    library: ['valour', 'riachuelo', 'type209', 'tanker', 'lng', 'tamandare'],
    brief: 'West African oil is Europe\'s lifeline now, and the pact is going after it. Tankers are leaving the Bonny terminal, 16 nm north-northwest of you, every half hour, heading southwest for the open sea. The South African frigate Amatola is coming up from the south to shell them, and the Brazilian boat Tonelero is lying in wait somewhere on their lane, 10 to 20 nm southwest of the terminal. Sink Amatola and Tonelero within three and a half hours, and lose no more than one tanker. The tankers and LNG carriers are friendly: identify before you shoot, because a torpedo takes whatever it finds first.',
    build(g, r) {
      g.startClock = clock(10);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const bonny = offset(g.own, 345, 16), course = 220, out = offset(bonny, course, 45);
      const names = ['MT Bonny Light', 'LNG Rivers', 'MT Front Altair', 'LNG Bonny Gas', 'MT Brass River', 'MT Forcados'];
      const merch: Vessel[] = [];
      const sail = (gg: Game, i: number, along: number) => {
        const p = offset(offset(bonny, course, along), course + 90, (gg.r() * 2 - 1) * 2);
        const v = add(gg, i % 2 ? 'lng' : 'tanker', names[i], 'allied', p, course, 13, go(course, 13, 1e9));
        merch.push(v); gg.goal.protect.push(v.id);
        if (along === 0) log(gg, 'info', `Bonny terminal: ${names[i]} has sailed, heading southwest.`);
      };
      const ama = add(g, 'valour', 'Amatola (F145)', 'enemy', offset(g.own, 190 + r() * 60, 20 + r() * 6), 0, 14, { mode: 'patrol', legT: 1e9 });
      const lair = offset(offset(bonny, course, 12 + r() * 6), course + 90, (r() * 2 - 1) * 3);
      const ton = add(g, 'riachuelo', 'Tonelero (S42)', 'enemy', lair, r() * 360, 4, { mode: 'patrol', legT: 1e9, decoys: 2, torps: 4 }, 1);
      setGoal(g, { targets: [ama.id, ton.id], need: 2, maxLosses: 1,
        win: 'Amatola and Tonelero are sunk. The tankers are moving again.', lossText: 'Two tankers lost. The insurers have closed the Bonny route.', timeout: 'The raiders are still loose off Bonny.' });
      let next = 0;
      g.script = (gg) => {
        if (next < names.length && gg.t >= next * 1800 + 60) sail(gg, next++, 0);
        for (const m of merch) arrive(gg, m, out, 2);
        // Tonelero lies in wait on the lane and goes for any tanker that comes within 6 nm, then goes back to its spot; it won't chase more than 8 nm from it.
        if (ton.alive) {
          const near = dist(ton, lair) < 8 && merch.some((m) => m.alive && dist(m, ton) < (ton.ai!.mode === 'raider' ? 9 : 6));
          if (near && ton.ai!.mode === 'patrol') ton.ai!.mode = 'raider';
          if (!near && ton.ai!.mode === 'raider') { ton.ai!.mode = 'patrol'; ton.ai!.prey = null; }
          keepCourse(ton, dist(ton, lair) > 1 ? brg(ton, lair) : norm(ton.hdg + 2), 4);
        }
        if (!ama.alive) return;
        pointDefence(gg, [ama], 0.6);
        const prey = merch.filter((m) => m.alive).sort((a, b) => dist(ama, a) - dist(ama, b))[0];
        if (prey) {
          keepCourse(ama, brg(ama, offset(prey, prey.hdg, 1)), 22);
          if (dist(ama, prey) < 2 && gg.t % 20 === 0) {
            if (!gg.flags[`shell${prey.id}`]) { gg.flags[`shell${prey.id}`] = 1; log(gg, 'danger', `Amatola is firing on ${prey.name}, bearing ${fmtBrg(brg(gg.own, prey))}!`, 'alarm'); }
            shellfire(gg, ama, prey, 0.3);
          }
        } else keepCourse(ama, brg(ama, bonny), 10);
      };
    },
  },

  // ---- The South Atlantic decides -----------------------------------------------------------------
  E2: {
    key: 'E2', title: 'Álvaro Alberto', era: '2029', place: 'Mid South Atlantic', date: 'January 2030, 0100', night: true,
    library: ['alvaro', 'riachuelo', 'kalvari', 'akula', 'virginia', 'p8a'],
    brief: 'Brazil\'s first nuclear submarine, Álvaro Alberto, is at sea, heading north for the Atlantic convoy lanes. A P-8A from Ascension has it somewhere within 25 nm of you, and will pass you a rough position every half hour. It sprints and drifts: fast and loud for a while, then slow and quiet to listen. It is a first-generation boat and noisier than a Russian one, but a quiet Riachuelo shadows it in its baffles to cover its back. Find Álvaro Alberto and sink it within four hours. If it gets 48 nm north of where it is now, it is into the open ocean and lost to us.',
    build(g, r) {
      g.startClock = clock(1);
      g.timeLimit = 4 * 3600;
      const p = offset(g.own, r() * 360, 14 + r() * 8);
      const course = 10 + (r() * 2 - 1) * 20;
      const alv = add(g, 'alvaro', 'Álvaro Alberto (SN10)', 'enemy', p, course, 8, { mode: 'patrol', legT: 1e9, decoys: 3 }, r() < 0.5 ? 2 : 1);
      const rch = add(g, 'riachuelo', 'Angostura (S43)', 'enemy', offset(p, course + 180, 3), course, 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      const away = offset(p, course, 48);
      const p8 = add(g, 'p8a', 'P-8A Poseidon', 'allied', offset(p, 0, 40), 180, 250);
      const phase = r() * 1800;
      g.own.hdg = g.own.ordHdg = brg(g.own, p);
      setGoal(g, { targets: [alv.id], need: 1, win: 'Álvaro Alberto is on the bottom. Brazil\'s nuclear navy has lasted one patrol.', timeout: 'Álvaro Alberto kept ahead of us, and is still at sea.' });
      g.script = (gg) => {
        circle(p8, alv, 10);
        if (gg.t % 1800 === 30) cue(gg, 'P-8A Poseidon', alv, 3);
        // Sprint for 12 minutes, drift for 18.
        const sprint = (gg.t + phase) % 1800 < 720;
        keepCourse(alv, brg(alv, away), sprint ? 18 : 6);
        const spot = offset(alv, alv.hdg + 180, 3);
        keepCourse(rch, dist(rch, spot) > 0.5 ? brg(rch, spot) : alv.hdg, Math.min(18, alv.spd + dist(rch, spot) * 3));
        if (arrive(gg, alv, away, 3)) end(gg, false, 'Álvaro Alberto is through into the open Atlantic. We have lost it.');
      };
    },
  },

  E4: {
    key: 'E4', title: 'Panama', era: '2029', place: 'Off Colón, Panama Canal', date: 'January 2030, 0300', night: true,
    library: ['ghadir', 'deepsub', 'type209', 'tanker', 'lng', 'boxship'],
    brief: 'Venezuela has Iranian-built Ghadir midget submarines, and five of them are on their way to the Caribbean entrance of the Panama Canal with charges to wreck the Gatun locks. The breakwater entrance at Colón is 4 nm south-southwest of you. The midgets are tiny, slow and very quiet; they were dropped about 10 to 14 nm out, to the northeast and east of the breakwater. Sink at least four. If two get through the breakwater, the canal will be shut for months. Ships waiting to transit are anchored 4 to 7 nm west of the breakwater, silent with their engines stopped; they are friendly, and a torpedo will take whatever it finds. An active ping finds midgets well out, but the Venezuelan boat Caribe is guarding them and will hear it.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 20;
      const mouth = offset(g.own, 200, 4);
      ['MT Pacific Jewel', 'LNG Gatun', 'MV Cristobal Express', 'MT Chagres', 'LNG Colón'].forEach((n, i) =>
        moored(g, i % 2 ? 'lng' : n.startsWith('MV') ? 'boxship' : 'tanker', n, 'allied', offset(mouth, 270 + i * 10 + r() * 8, 4 + r() * 3), r() * 360));
      const subs = ['Ghadir 1', 'Ghadir 2', 'Ghadir 3', 'Ghadir 4', 'Ghadir 5'].map((n, i) => {
        const p = offset(mouth, 15 + i * 18 + (r() * 2 - 1) * 6, 10 + r() * 4);
        return add(g, 'ghadir', n, 'enemy', p, brg(p, mouth), 6, { mode: 'raider', goal: mouth, cruise: 4.5 + r() * 2 }, 1);
      });
      add(g, 'type209', 'Caribe (S-32)', 'enemy', offset(mouth, 10 + r() * 60, 11 + r() * 3), r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      setGoal(g, { targets: ids(subs), need: 4, win: 'The midget subs are on the bottom. Ships are moving through the canal again by noon.', timeout: 'Midget subs are still loose off Colón. The canal stays closed until they are found.' });
      g.flags.inside = 0;
      g.script = (gg) => {
        for (const s of subs) if (arrive(gg, s, mouth, 0.5)) {
          gg.flags.inside++;
          log(gg, 'danger', `${s.name} has slipped through the breakwater into Limon Bay.`, 'alarm');
          if (gg.flags.inside >= 2) end(gg, false, 'Two midget subs got inside the breakwater. The Gatun locks are wrecked and the canal is shut.');
        }
      };
    },
  },

  E11: {
    key: 'E11', title: 'Rio Blockade', era: '2029', place: 'Off Rio de Janeiro', date: 'January 2030, 2300', night: true,
    library: ['riachuelo', 'tamandare', 'alvaro', 'kalvari', 'type209'],
    brief: 'Bottle up Brazil\'s fleet in Guanabara Bay. Tang has six mines aboard. The entrance to the bay, between Sugarloaf and Santa Cruz fort, is 16 nm north of you. Lay at least four mines within a mile of the entrance, then get back out more than 12 nm from it, before dawn: five hours. Slow to 12 knots or less to lay. Brazil has its own minefield across the approach, about 5 nm south of the entrance, with a gap somewhere for its own ships: find the gap with the HF sonar or a ping. Two Riachuelo boats guard the approach, and they will hear a ping. A Tamandaré frigate is alongside inside the bay and is due to sail at about 0130: be done in the entrance before then.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 5 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      g.flags.minesAboard = 6;
      const mouth = offset(g.own, 0, 16);
      const lineY = mouth.y - 5, gapX = (r() * 2 - 1) * 2.5;
      mineLine(g, { x: -5, y: lineY }, { x: gapX - 0.6, y: lineY }, Math.round((gapX + 4.4) / 0.32), 'enemy', 0.08);
      mineLine(g, { x: gapX + 0.6, y: lineY }, { x: 5, y: lineY }, Math.round((4.4 - gapX) / 0.32), 'enemy', 0.08);
      const subs = ['Riachuelo (S40)', 'Humaitá (S41)'].map((n, i) =>
        add(g, 'riachuelo', n, 'enemy', { x: (i ? 1 : -1) * (1 + r() * 3), y: lineY + (i ? -2 - r() * 3 : 1 + r() * 2) }, r() * 360, 4, { mode: 'patrol', legT: 600, decoys: 2 }, 1));
      const fr = moored(g, 'tamandare', 'Tamandaré (F200)', 'enemy', offset(mouth, 0, 3), 180);
      void subs;
      setGoal(g, { timeout: 'Dawn found us still at it. The blockade is not in place.' });
      g.script = (gg) => {
        at(gg, 150 * 60, 'sortie', () => {
          if (!fr.alive) return;
          Object.assign(fr.ai!, go(180, 14));
          log(gg, 'warn', 'Sonar: new contact in the bay entrance, bearing ' + fmtBrg(brg(gg.own, fr)) + '. The Tamandaré frigate is coming out.');
        });
        const laid = gg.mines.filter((m) => m.side === 'us' && dist(m, mouth) <= 1).length;
        gg.flags.laid = laid;
        if (laid >= 4 && !gg.flags.done) { gg.flags.done = 1; log(gg, 'good', 'XO: four mines are down in the entrance. Now get us out: 12 nm clear.'); }
        if (gg.flags.done && dist(gg.own, mouth) > 12) end(gg, true, 'The minefield is laid and Tang is clear. Brazil\'s fleet is shut in Guanabara Bay.');
      };
    },
  },

  E14: {
    key: 'E14', title: 'Fernando de Noronha', era: '2029', place: 'Off northeast Brazil', date: 'January 2030, 0400', night: true,
    library: ['tamandare', 'riachuelo', 'p3am', 'valour'],
    brief: 'The airfield on Fernando de Noronha, 70 nm west of you, puts Brazil\'s P-3AM Orions over the Atlantic narrows. Close it with Tomahawks: land two hits on the runway and one on the fuel farm. First, though, kill the island\'s air-defence radar: until it is down, its missile battery will shoot down most of our Tomahawks. The radar is mobile. Its position shows on ESM only when we are at periscope depth within 43 nm of the island for two minutes, and it moves every 40 minutes. A second Orion takes off in 45 minutes unless the runway has been hit; one is already up. Two Tamandaré frigates patrol east of the island. A launch shows Orions nearby where we are. Three hours.',
    build(g, r) {
      g.startClock = clock(4);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const isle = offset(g.own, 270, 70);
      const runway = { id: -1, name: 'Noronha runway', ...offset(isle, 0, 0.3), hits: 0 };
      const fuel = { id: -2, name: 'Noronha fuel farm', ...offset(isle, 120, 1), hits: 0 };
      g.sites.push(runway, fuel);
      const patrol = offset(isle, 90, 30);
      const frig = ['Cunha Moreira (F202)', 'Mariz e Barros (F203)'].map((n, i) =>
        add(g, 'tamandare', n, 'enemy', offset(patrol, i ? 0 : 180, 6 + r() * 4), r() * 360, 10, { mode: 'patrol', legT: 700 }));
      void frig;
      const orion = (gg: Game, name: string) => add(gg, 'p3am', name, 'enemy', offset(isle, 90, 5), 90, 300, { mode: 'search', center: offset(isle, 90, 30), wp: offset(isle, 90, 30), buoyT: 0, torps: 2, datum: null });
      orion(g, 'P-3AM Orion 7201');
      let radar: (typeof runway) | null = null;
      g.flags.esm = 0;
      g.script = (gg) => {
        // The radar moves every 40 minutes unless it has been hit.
        if (!gg.flags.radarDown && gg.t % 2400 === 0 && radar) {
          gg.sites = gg.sites.filter((s) => s !== radar);
          radar = null; gg.flags.esm = 0;
          log(gg, 'warn', 'ESM: the island\'s air-defence radar has gone off the air. It is moving to a new site.');
        }
        if (radar && radar.hits && !gg.flags.radarDown) { gg.flags.radarDown = 1; log(gg, 'good', 'The island\'s air-defence radar is off the air for good. Its missile battery is blind.'); }
        if (!gg.flags.radarDown && !radar && atPeriscopeDepth(gg) && dist(gg.own, isle) < 43) {
          gg.flags.esm++;
          if (gg.flags.esm >= 120) {
            radar = { id: -3, name: 'Air-defence radar (ESM fix)', ...offset(isle, gg.r() * 360, 0.5 + gg.r()), hits: 0 };
            gg.sites.push(radar);
            log(gg, 'good', 'ESM: we have a fix on the island\'s air-defence radar. It is on the target list for Tomahawk.');
          }
        }
        // Until the radar is down, the battery shoots at every Tomahawk coming in.
        for (const w of gg.weapons) {
          if (w.type !== 'tlam' || w.dead || dist(w, isle) > 10 || gg.flags[`sam${w.id}`]) continue;
          gg.flags[`sam${w.id}`] = 1;
          if (!gg.flags.radarDown && gg.r() < 0.75) { w.dead = true; log(gg, 'warn', `${w.label} was shot down by the island's missile battery.`); }
        }
        if (gg.t === 45 * 60) {
          if (runway.hits) log(gg, 'good', 'Intelligence: the second Orion is stuck on the cratered runway.');
          else { orion(gg, 'P-3AM Orion 7204'); log(gg, 'warn', 'ESM: a second P-3AM Orion has taken off from Noronha.'); }
        }
        if (gg.flags.radarDown && runway.hits >= 2 && fuel.hits >= 1) end(gg, true, 'The runway is cratered and the fuel farm is burning. The Orions have lost their island.');
      };
      setGoal(g, { timeout: 'Three hours gone and the Noronha airfield is still working.' });
    },
  },
};

// ---- Objectives --------------------------------------------------------------------------------
const timeOnly = (b: ReturnType<typeof baseObjectives>) => b.filter((o) => !o.text.startsWith('Sink'));
export const extras: Record<MissionKey, ObjectiveFn> = {
  E0: (g, b) => {
    const volk = g.vessels.find((v) => v.cls.key === 'akula')!;
    const total = flag(g, 'total'), cleared = flag(g, 'cleared');
    return [
      { text: 'Sink Volk, the minelaying Akula', state: isSunk(volk) ? 'done' : volk.gone ? 'failed' : 'open', detail: isSunk(volk) ? 'Sunk.' : volk.gone ? 'It got away to sea.' : 'Still laying. If it gets 35 nm out to sea, it is gone.' },
      { text: 'Clear every mine in the channel', state: cleared >= total && total > 0 ? 'done' : 'open', detail: `${cleared} destroyed. Mine countermeasures reckon ${Math.max(0, total - cleared)} more are still in the channel.` },
      ...b,
    ];
  },
  E5: (g, b) => [...b, watch('Keep Viktor Leonov from giving us away', !!flag(g, 'leonov'), flag(g, 'leonov') ? 'She saw our periscope and told the Yasen.' : 'She reports any periscope she sees inside 4 nm.')],
  E1: (g, b) => [...b, watch('Keep the landing ships 3 nm from Ascension', !!g.over?.reason.includes('ashore'))],
  E3: (g, b) => [...b, watch('Don\'t let two landing ships reach the beach', flag(g, 'landed') >= 2, `${flag(g, 'landed')} of 2 have landed.`)],
  E7: (g, b) => [...b,
    { text: 'Stop the frigates before they fire Exocets', state: flag(g, 'fired') ? 'failed' : byId(g, g.vessels.filter((v) => v.cls.key === 'tamandare').map((v) => v.id)).every(isSunk) ? 'done' : 'open',
      detail: flag(g, 'fired') ? 'They have fired.' : flag(g, 'closeT') ? `They are inside 30 nm and setting up: ${mins(600 - flag(g, 'closeT'))} until they fire.` : 'Coming from the west. Ten minutes inside 30 nm of the convoy and they fire.' }],
  E2: (g, b) => [...b, watch('Catch it before it gets 48 nm north', !!g.over?.reason.includes('open Atlantic'))],
  E4: (g, b) => [...b, watch('Don\'t let two midgets through the breakwater', flag(g, 'inside') >= 2, `${flag(g, 'inside')} of 2 have got in.`)],
  E11: (g, b) => [
    { text: 'Lay 4 mines within a mile of the entrance', state: flag(g, 'done') ? 'done' : 'open', detail: `${flag(g, 'laid')} of 4 laid there. ${flag(g, 'minesAboard')} mines left aboard.` },
    { text: 'Then get more than 12 nm clear of the entrance', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'done') ? 'Go now.' : 'After the mines are down.' },
    ...timeOnly(b),
  ],
  E14: (g, b) => {
    const s = (id: number) => g.sites.find((x) => x.id === id)?.hits ?? 0;
    return [
      { text: 'Knock out the air-defence radar', state: flag(g, 'radarDown') ? 'done' : 'open', detail: flag(g, 'radarDown') ? 'Down.' : g.sites.some((x) => x.id === -3) ? 'Fixed: on the Tomahawk target list. It moves every 40 minutes.' : `Come to periscope depth within 60 nm of the island for an ESM fix (${Math.min(120, flag(g, 'esm'))} of 120 s).` },
      { text: 'Two Tomahawk hits on the runway', state: s(-1) >= 2 ? 'done' : 'open', detail: `${s(-1)} of 2.` },
      { text: 'One hit on the fuel farm', state: s(-2) >= 1 ? 'done' : 'open', detail: `${s(-2)} of 1.` },
      ...timeOnly(b),
    ];
  },
};
