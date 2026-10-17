// Modern war missions: gulf. Act 2's Indian Ocean theater, June to September 2029: the long way round
// the Cape, arrival at Diego Garcia, India's navy, and the Bay of Bengal. See src/sim/warData.ts for
// where each one sits in the war.
import { brg, dist, fmtBrg, gauss, norm, offset, type Vec } from '../math';
import { end, excess, log, vesselSL, type Game, type Vessel } from '../sim';
import { mineLine } from '../hazards';
import {
  add, arrive, at, bombed, clock, flag, go, held, ids, isSunk, keepCourse, mins, missileSalvo, moored,
  pointDefence, screen, setGoal, skirmish, steer, watch,
  type Mission, type MissionKey, type ObjectiveFn,
  adP,
  high,
} from '../kit';

// ---- Local helpers -----------------------------------------------------------------------------
/** A surface ship circling a spot: back toward it whenever it strays past `r` nm. */
function loiter(v: Vessel, c: Vec, r: number) {
  if (v.alive && v.ai && v.ai.mode === 'transit' && dist(v, c) > r) v.ai.baseCourse = brg(v, c);
}
/** A patrol plane's search box over a spot. */
const patrolPlane = (g: Game, cls: string, name: string, center: Vec, from: number, range: number) =>
  add(g, cls, name, 'enemy', offset(center, from, range), norm(from + 180), 300, { mode: 'search', center, wp: { ...center }, buoyT: 0, torps: 2, datum: null });
/**
 * The sim's sonobuoys only report to an Il-38. Indian and Chinese patrol planes listen to theirs
 * here: ten seconds of holding Tang on a buoy gives the plane a datum, and it comes down to attack.
 * `cue` also passes the datum to its side's submarines. Our pings give it an exact datum.
 */
function planeBuoys(g: Game, plane: Vessel, cue = true) {
  if (!plane.alive || !plane.ai) return;
  const o = g.own, ai = plane.ai;
  // Its buoys hear our active sonar a long way off: a ping is an exact datum.
  if (g.stats.pings > flag(g, 'pingsHeard') && dist(o, plane) < 60) {
    ai.datum = { x: o.x, y: o.y, t: g.t, deep: o.depthT > 1.5, exact: true };
    ai.mode = 'prosecute'; ai.wp = { x: o.x, y: o.y };
    log(g, 'danger', `ESM: ${plane.cls.name} has turned toward us. Its buoys heard our ping.`, 'alarm');
  }
  g.flags.pingsHeard = g.stats.pings;
  for (const b of g.buoys) {
    if (dist(b, plane.ai.center ?? plane) > 40) continue;
    const se = excess(vesselSL(o), o, { x: b.x, y: b.y, hdg: 0, spd: 0, depthT: b.deep ? 2 : 1, array: true }, 31) + gauss(g.r) * 2;
    const k = `buoy${b.id}`;
    g.flags[k] = se > 0 ? flag(g, k) + 1 : Math.max(0, flag(g, k) - 1);
    if (g.flags[k] < 10) continue;
    g.flags[k] = 0;
    const e = Math.max(0.2, dist(o, b) * 0.4);
    const fresh = ai.mode !== 'prosecute';
    ai.datum = { x: o.x + gauss(g.r) * e, y: o.y + gauss(g.r) * e, t: g.t, deep: o.depthT > 1.5, exact: dist(o, b) < 1.2 };
    ai.mode = 'prosecute'; ai.wp = { x: ai.datum.x, y: ai.datum.y };
    if (fresh) log(g, 'danger', `Sonar: ${plane.cls.name} is turning in over its buoys. It has us on sonobuoys.`, 'alarm');
    if (cue) for (const s of g.vessels) if (s.alive && s.side === 'enemy' && s.cls.kind === 'sub' && s.ai && s.ai.mode === 'patrol') { s.ai.knows = { ...ai.datum }; s.ai.mode = 'attack'; }
  }
}
/** Rough position reports from an allied patrol plane on a submarine it is tracking. */
function alliedCue(g: Game, v: Vessel, err: number, who = 'P-8A Poseidon') {
  if (!v.alive) return;
  const p = offset(v, g.r() * 360, g.r() * err);
  log(g, 'contact', `${who}: sonobuoy contact, diesel submarine, bearing ${fmtBrg(brg(g.own, p))}, ${dist(g.own, p).toFixed(0)} nm from you, give or take ${err} nm.`);
}
/** Ships a submarine's anti-ship missiles go after: the live ones of `ships`. */
const live = (vs: Vessel[]) => vs.filter((v) => v.alive);

export const missions: Record<MissionKey, Mission> = {
  // ---- The long way round ---------------------------------------------------------------------
  B2: {
    key: 'B2', title: 'Cape of Storms', era: '2029', place: 'Off Cape Town', date: 'June 2029, 0500', night: true,
    library: ['type209', 'valour', 'riachuelo', 'tamandare', 'virginia'],
    brief: 'With Suez shut, Tang goes to the Indian Ocean the long way. A winter gale is blowing off the Cape: sea state 6, with waves loud enough to cover a lot of noise, theirs and yours, and spray that halves what the periscope sees. South Africa has joined the pact and is guarding the passage. Two Valour frigates are sweeping north and south about 15 nm east of you, and two Heroine-class boats are lying quiet about 25 nm east. Get 36 nm east of where you start, past Cape Agulhas, within 4 hours. You don\'t have to sink anyone. The forecast has the gale easing in about two hours, and the cover easing with it.',
    build(g, r) {
      g.startClock = clock(5);
      g.timeLimit = 4 * 3600;
      g.env.sea = 6;
      g.own.hdg = g.own.ordHdg = 90;
      const frig = (name: string, y: number) => add(g, 'valour', name, 'enemy', { x: 14 + r() * 3, y }, r() < 0.5 ? 0 : 180, 8, { mode: 'patrol', legT: 1e9 });
      const fr = [frig('SAS Amatola (F145)', 4 + r() * 4), frig('SAS Spioenkop (F147)', -4 - r() * 4)];
      const boat = (name: string, y: number) => add(g, 'type209', name, 'enemy', { x: 23 + r() * 4, y }, r() * 360, 3, { mode: 'patrol', legT: 1e9, decoys: 1 }, r() < 0.5 ? 2 : 1);
      const subs = [boat('SAS Manthatisi (S101)', 2 + r() * 6), boat('SAS Queen Modjadji I (S103)', -2 - r() * 6)];
      setGoal(g, { targets: [], win: 'We are round Cape Agulhas and into the Indian Ocean.', timeout: 'The gale blew out and we are still west of Agulhas. The Cape is closed to us.' });
      g.script = (gg) => {
        // The frigates sweep their lines north and south; the boats creep about on their stations.
        fr.forEach((f, i) => keepCourse(f, (Math.floor(gg.t / 1500) + i) % 2 ? 0 : 180, 8));
        subs.forEach((s, i) => keepCourse(s, norm(gg.t / 20 + i * 180), 3));
        at(gg, 2 * 3600, 'ease', () => { gg.env.sea = 4; log(gg, 'warn', 'The gale is easing: sea state 4. Less noise to hide in, and the periscope can see further.'); });
        if (gg.own.x >= 36) end(gg, true, 'We are round Cape Agulhas and into the Indian Ocean.');
      };
    },
  },

  I12: {
    key: 'I12', title: 'Mozambique Channel', era: '2029', place: 'Mozambique Channel', date: 'June 2029, 1400',
    library: ['type209', 'type901', 'tanker', 'lng', 'kalvari'],
    brief: 'The tankers that go round the Cape come up the Mozambique Channel, and the pact has a trap in it. A Heroine-class boat, SAS Charlotte Maxeke, is working from the Chinese supply ship Chaganhu, which is drifting about 15 nm north of you and keeping her fuelled. Clear the channel: sink both. Three of our tankers are coming up from the south, about 20 nm behind you, and will pass in an hour and a half; the boat will go after them when they come by. Lose no more than one. The supply ship and the tankers are all big, slow and loud: be sure what you are shooting at. Sinking a tanker yourself ends the mission.',
    build(g, r) {
      g.startClock = clock(14);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 0;
      const spot = offset(g.own, 335 + r() * 50, 13 + r() * 4);
      const sup = add(g, 'type901', 'Chaganhu (967)', 'enemy', spot, r() * 360, 4, go(r() * 360, 4, 600));
      const sub = add(g, 'type209', 'SAS Charlotte Maxeke (S102)', 'enemy', offset(spot, r() * 360, 1.5), r() * 360, 3, { mode: 'patrol', legT: 1e9, decoys: 1 }, 1);
      const course = 5;
      const lead = add(g, 'tanker', 'MT Nordic Breeze', 'allied', offset(g.own, 185 + r() * 20, 18 + r() * 4), course, 12, go(course, 12, 1e9));
      const tankers = [lead, ...screen(g, lead, 'tanker', ['MT Kota Harmony', 'MT Atlantic Pioneer'], [[180, 1.5], [180, 3]])];
      setGoal(g, { targets: [sup.id, sub.id], need: 2, protect: ids(tankers), maxLosses: 1,
        win: 'The Heroine boat and its supply ship are both sunk. The channel is open to the tankers again.',
        lossText: 'Two of the tankers are burning in the channel.', timeout: 'The channel is still not clear.' });
      g.script = (gg) => {
        loiter(sup, spot, 4);
        keepCourse(sub, brg(sub, offset(sup, norm(gg.t / 10), 1.5)), 3);
        // When the tankers come within 15 nm, the boat leaves its mother ship and goes after them.
        if (sub.alive && sub.ai!.mode !== 'raider' && live(tankers).some((t) => dist(t, sub) < 15)) {
          sub.ai!.mode = 'raider'; sub.ai!.torps = 4;
          log(gg, 'warn', 'Intelligence: the Heroine boat has left the supply ship. It is going after the tankers.');
        }
      };
    },
  },

  I13: {
    key: 'I13', title: 'Horn of Africa', era: '2029', place: 'Off Djibouti', date: 'June 2029, 2200', night: true,
    library: ['jamaran', 'droneboat', 'fac', 'tender', 'kilo'],
    brief: 'With Suez open again, the short way in is through the Gulf of Aden, and Tang\'s Red Sea base is the tender Emory S. Land at Djibouti, about 36 nm west of you. Iran means to close the approach. The frigate Jamaran is coming down from the north to lay a mine line across it, about 26 nm west of you, starting within the half hour; once the line is finished, the approach is shut. She has good hull sonar: if she hears you she will stop laying and come after you with torpedoes. Reach the tender before then: get within 3 nm of her. Sink Jamaran and the line is never finished; any mines she has laid stay, so slow down to let the HF sonar find them, or ping. Iran\'s explosive drone boats will go for the tender too, and she must stay afloat. Iran\'s coastal radar listens for yours: keep the mast up too long and drone boats will come for it.',
    build(g, r) {
      g.startClock = clock(22);
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = 270;
      const base = offset(g.own, 268 + r() * 4, 36);
      const tender = moored(g, 'tender', 'USS Emory S. Land (AS-39)', 'allied', base, 90);
      const lx = -26 + (r() * 2 - 1) * 1.5;
      const a = { x: lx, y: 7 + r() * 2 }, b = { x: lx, y: -7 - r() * 2 };
      const jp = offset(a, 10 + r() * 40, 4 + r() * 3);
      // She hunts with her hull sonar as she goes: if she hears us, she stops laying and comes after us.
      const jam = add(g, 'jamaran', 'IRIS Jamaran (76)', 'enemy', jp, brg(jp, a), 16, { mode: 'patrol', legT: 1e9 });
      setGoal(g, { targets: [], protect: [tender.id], maxLosses: 0, lossText: 'The tender is sinking at her moorings. Tang has no base on the Red Sea.',
        win: 'We are alongside the tender at Djibouti.', timeout: 'We never reached Djibouti.' });
      g.flags.laid = 0;
      // A mine every 250 s at 10 knots is one every 0.7 nm: this many and the line is across.
      const full = Math.floor((a.y - b.y) / 0.69);
      const boats: Vessel[] = [], hunters: Vessel[] = [];
      const swarm = (gg: Game, n: number) => {
        const from = offset(base, 20 + gg.r() * 40, 30);
        for (let i = 0; i < n; i++) boats.push(add(gg, 'droneboat', `Drone boat ${boats.length + 1}`, 'enemy', offset(from, 90, i * 0.6), brg(from, base), 40, go(brg(from, base), 40, 1e9)));
        log(gg, 'warn', `Radio intercepts: Iranian drone boats launched from the Yemen coast, heading for the tender. ${n} of them. Harpoon or torpedoes can stop them; her guns may get one.`);
      };
      g.script = (gg) => {
        at(gg, 50 * 60, 'swarm1', () => swarm(gg, 3));
        at(gg, 110 * 60, 'swarm2', () => swarm(gg, 2));
        for (const d of boats) {
          if (!d.alive) continue;
          d.ai!.baseCourse = brg(d, base); d.ai!.zig = 0;
          if (dist(d, base) < 1.5 && !gg.flags[`gun${d.id}`]) {
            gg.flags[`gun${d.id}`] = 1;
            if (gg.r() < 0.4) { d.alive = false; gg.sunk.push({ name: d.name, cls: d.cls.key, side: 'enemy', by: 'allied' }); log(gg, 'good', `The tender's guns blew ${d.name} out of the water.`); continue; }
          }
          if (arrive(gg, d, base, 0.2)) { log(gg, 'danger', `${d.name} has rammed the tender and exploded!`, 'boom'); for (let k = 0; k < 3; k++) if (gg.r() < 0.8) bombed(gg, tender, 'a drone boat'); }
        }
        // Iran listens for our radar: a minute of it on the air and two drone boats come out after the mast.
        if (gg.own.radar) gg.flags.esm = flag(gg, 'esm') + 1;
        if (flag(gg, 'esm') >= 60 && !hunters.some((d) => d.alive)) {
          gg.flags.esm = 0; gg.flags.dx = gg.own.x; gg.flags.dy = gg.own.y;
          const from = offset(gg.own, 330 + gg.r() * 60, 16);
          for (let i = 0; i < 2; i++) hunters.push(add(gg, 'droneboat', `Drone boat ${boats.length + hunters.length + 1}`, 'enemy', offset(from, 90, i * 0.5), brg(from, gg.own), 40, go(brg(from, gg.own), 40, 1e9)));
          log(gg, 'danger', 'ESM: Iranian coastal radar has locked on our mast. Fast screws to the north: drone boats coming for our datum. Get the mast down and go deep.', 'alarm');
        }
        for (const d of hunters) {
          if (!d.alive) continue;
          if (gg.own.depthT < 0.3 && (gg.own.radar || dist(d, gg.own) < 6)) { gg.flags.dx = gg.own.x; gg.flags.dy = gg.own.y; }
          const datum = { x: flag(gg, 'dx'), y: flag(gg, 'dy') };
          d.ai!.baseCourse = dist(d, datum) > 0.5 ? brg(d, datum) : norm(d.hdg + 30); d.ai!.zig = 0;
          if (dist(d, gg.own) < 0.25 && gg.own.depthT < 0.6) {
            d.alive = false; d.gone = true;
            gg.blasts.push({ x: gg.own.x, y: gg.own.y, t: gg.t, missile: false });
            gg.own.hp -= 2;
            log(gg, 'danger', `${d.name} has rammed our sail and exploded! Masts gone, flooding forward.`, 'boom');
            if (gg.own.hp <= 0) { gg.own.alive = false; end(gg, false, 'A drone boat blew in our sail. USS Tang was lost.'); }
          }
        }
        pointDefence(gg, [jam], 0.5);
        if (jam.alive) {
          if (!gg.flags.laying && dist(jam, a) < 1) { gg.flags.laying = 1; log(gg, 'warn', 'Intelligence: Jamaran has reached the approach and turned south at 10 knots. She is laying mines.'); }
          // Back on her line whenever she isn't chasing us.
          const back = gg.flags.laying ? { x: lx, y: Math.min(jam.y, a.y) - 1 } : a;
          keepCourse(jam, brg(jam, back), gg.flags.laying ? 10 : 16);
          // A mine about every 0.7 nm down the line, while she is on it.
          if (gg.flags.laying && jam.ai!.mode === 'patrol' && Math.abs(jam.x - lx) < 0.5 && jam.y > b.y && gg.t % 250 === 0) { mineLine(gg, jam, jam, 1); gg.flags.laid++; }
          if (gg.flags.laid >= full && gg.own.x > lx) end(gg, false, 'The mine line is finished. Iran has closed the approach to Djibouti.');
        }
        if (dist(gg.own, base) < 3) end(gg, true, 'We are alongside the tender at Djibouti.');
      };
    },
  },

  // ---- Arrival ----------------------------------------------------------------------------------
  I1: {
    key: 'I1', title: 'Diego Garcia', era: '2029', place: 'Chagos Archipelago', date: 'July 2029, 0600',
    library: ['kalvari', 'p8i', 'type209', 'type039', 'p8a'],
    brief: 'Diego Garcia is the base the whole Indian Ocean campaign runs from, and three prepositioning ships are at anchor in its lagoon, 12 nm north of you. Two Indian Kalvari boats are coming in from the northeast and northwest to shoot SM39 Exocets at them from about 13 nm out, and each will keep moving round the atoll and firing again until it is sunk. Sink both. The Kalvaris are very quiet on batteries: our own P-8A will pass you rough positions on them every 20 minutes. India\'s P-8I is overhead laying sonobuoys: it will torpedo you if it gets a fix, and its buoys will hear any ping you make. Lose no more than one ship.',
    build(g, r) {
      g.startClock = clock(6);
      g.timeLimit = 4 * 3600;
      const lagoon = offset(g.own, 0, 12);
      const ships = [0, 1, 2].map((i) => moored(g, 'boxship', ['USNS Seay', 'USNS Pililaau', 'USNS Bob Hope'][i], 'allied', offset(lagoon, i * 120, 0.8), i * 120));
      const kal = ['INS Vagsheer (S26)', 'INS Karanj (S23)'].map((n, i) => {
        const from = norm((i ? 70 : 290) + (r() * 2 - 1) * 25);
        const p = offset(lagoon, from, 22.5 + r() * 4);
        const fire = offset(lagoon, from + (r() * 2 - 1) * 15, 13);
        const v = add(g, 'kalvari', n, 'enemy', p, brg(p, fire), 8, { mode: 'raider', goal: fire, cruise: 7, decoys: 2 }, 1);
        return { v, fire, from };
      });
      const p8 = patrolPlane(g, 'p8i', 'P-8I Neptune', lagoon, r() * 360, 80);
      setGoal(g, { targets: kal.map((k) => k.v.id), need: 2, protect: ids(ships), maxLosses: 1,
        win: 'Both Kalvaris are on the bottom. Diego Garcia is safe.', lossText: 'Two of the prepositioning ships are burning in the lagoon.', timeout: 'A Kalvari is still loose off Diego Garcia.' });
      g.script = (gg) => {
        p8.ai!.center = gg.vessels.find((v) => v.alive && v.side === 'enemy' && v.cls.key === 'kalvari') ?? lagoon;
        planeBuoys(gg, p8);
        if (gg.t % 1200 === 300) kal.forEach((k) => alliedCue(gg, k.v, 4));
        for (const k of kal) {
          const v = k.v, key = `kal${v.id}`;
          if (!v.alive) continue;
          if (flag(gg, key) || dist(v, k.fire) < 1) gg.flags[key] = flag(gg, key) + 1;
          // On station it creeps about its firing point, getting ready to come up.
          if (gg.flags[key] && gg.flags[key] < 240) { v.ai!.goal = offset(k.fire, norm(gg.t / 4), 0.5); v.ai!.cruise = 3; }
          if (gg.flags[key] === 1) log(gg, 'warn', 'P-8A Poseidon: a Kalvari has stopped about 13 nm off the lagoon. It will be coming up to launch in a few minutes.');
          if (gg.flags[key] === 240) {
            gg.flags.salvos = flag(gg, 'salvos') + 1;
            missileSalvo(gg, 'A Kalvari', 'SM39 Exocet', 2, live(ships), 0.7, 2);
            // Then it slips round the atoll to a fresh firing point to reload and shoot again.
            k.from = norm(k.from + (gg.r() < 0.5 ? 50 : -50));
            k.fire = offset(lagoon, k.from, 13);
            v.ai!.goal = k.fire; v.ai!.cruise = 7; gg.flags[key] = 0;
          }
        }
      };
    },
  },

  I2: {
    key: 'I2', title: 'Tankers Round the Cape', era: '2029', place: 'Off Madagascar', date: 'July 2029, 1000',
    library: ['type209', 'tanker', 'type26', 'kalvari', 'valour'],
    brief: 'Europe needs Gulf oil, and with Hormuz contested it comes the long way, round the Cape. Four loaded tankers are passing south of Madagascar on course 240, with HMS Glasgow as their only escort and Tang under them. South Africa has sent its Heroine-class boats north to meet them: at least two are lying ahead. Bring the tankers through: lose no more than one in the next two and a half hours. Glasgow\'s helicopter may get a boat if it comes close, but the job is yours.',
    build(g, r) {
      g.startClock = clock(10);
      g.timeLimit = 2.5 * 3600;
      const course = 240;
      g.own.hdg = g.own.ordHdg = course;
      const lead = add(g, 'tanker', 'MT Gulf Spirit', 'allied', offset(g.own, course, 2), course, 11, go(course, 11, 1e9));
      const tankers = [lead, ...screen(g, lead, 'tanker', ['MT Aegean Glory', 'MT Hafnia Star', 'MT Ocean Pride'], [[90, 1.5], [180, 1.5], [135, 2.1]])];
      const glasgow = screen(g, lead, 'type26', ['HMS Glasgow (F88)'], [[0, 3]], 'allied')[0];
      const names = ['SAS Manthatisi (S101)', 'SAS Charlotte Maxeke (S102)', 'SAS Queen Modjadji I (S103)'];
      const subs = [0, 1].map((i) => {
        const p = offset(lead, course + (i ? 6 : -6) + (r() * 2 - 1) * 6, 13 + i * 9 + r() * 4);
        return add(g, 'type209', names[i], 'enemy', p, brg(p, lead), 3, { mode: 'patrol', legT: 1e9, decoys: 1 }, 1);
      });
      setGoal(g, { targets: [], protect: ids(tankers), maxLosses: 1, surviveWin: true,
        win: 'The tankers are past Madagascar and under air cover from Durban. The oil gets through.', lossText: 'Two tankers are burning off Madagascar.', timeout: '' });
      g.script = (gg) => {
        // Each boat lies quiet across the convoy's path, then goes in when it comes within 8 nm.
        for (const s of subs) {
          if (!s.alive) continue;
          if (s.ai!.mode === 'patrol') keepCourse(s, brg(s, lead), 2);
          if (s.ai!.mode !== 'raider' && live(tankers).some((t) => dist(t, s) < 8)) { s.ai!.mode = 'raider'; s.ai!.torps = 3; }
        }
        at(gg, 50 * 60, 'third', () => {
          const p = offset(lead, course + (gg.r() < 0.5 ? 25 : -25), 13);
          subs.push(add(gg, 'type209', names[2], 'enemy', p, brg(p, lead), 2, { mode: 'patrol', legT: 1e9, decoys: 1 }, 1));
          log(gg, 'warn', `A P-8A out of Diego Garcia reports a third boat snorkelling about 13 nm ahead of the convoy, bearing ${fmtBrg(brg(gg.own, p))} from you.`);
        });
        skirmish(gg, [glasgow], subs, 3, 0.15, 0.05, 0.5);
      };
    },
  },

  I14: {
    key: 'I14', title: 'Seychelles', era: '2029', place: 'Off Mahé', date: 'July 2029, 1600',
    library: ['talwar', 'kalvari', 'collins', 'kolkata', 'type054a'],
    brief: 'India means to take the Seychelles and its airfield. Two Talwar frigates, Trishul and Tabar, are about 25 nm northeast of you with marines and helicopters aboard, heading for Mahé, and a Kalvari is sweeping ahead of them. Port Victoria on Mahé is 15 nm south of you. If either frigate spends 15 minutes within 6 nm of Victoria, its helicopters will have the airfield. Sink both frigates. They are sub hunters with good hull sonar and they will come for you if they hear you. HMAS Rankin, an Australian Collins boat, is with you and will take on the Kalvari.',
    build(g, r) {
      g.startClock = clock(16);
      g.timeLimit = 4 * 3600;
      const victoria = offset(g.own, 180, 15);
      const fp = offset(g.own, 35 + r() * 30, 23 + r() * 4);
      const frig = ['INS Trishul (F43)', 'INS Tabar (F44)'].map((n, i) => add(g, 'talwar', n, 'enemy', offset(fp, brg(fp, victoria) + 90, i ? 3 : -3), brg(fp, victoria), 12, { mode: 'patrol', legT: 1e9 }));
      const kp = offset(fp, brg(fp, victoria), 12 + r() * 4);
      const kal = add(g, 'kalvari', 'INS Khanderi (S22)', 'enemy', kp, brg(kp, victoria), 5, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      const rankin = add(g, 'collins', 'HMAS Rankin', 'allied', offset(g.own, 90, 3), 45, 6, undefined, 1);
      setGoal(g, { targets: ids(frig), need: 2, win: 'Both Talwars are sunk. The Seychelles stay out of India\'s hands.', timeout: 'India has the Seychelles.' });
      g.script = (gg) => {
        for (const f of frig) {
          keepCourse(f, brg(f, victoria), dist(f, victoria) > 5 ? 12 : 4);
          if (f.alive && dist(f, victoria) < 6) gg.flags.ashore = flag(gg, 'ashore') + 1;
        }
        if (gg.flags.ashore === 1) log(gg, 'danger', 'A Talwar is off Port Victoria and launching helicopters. 15 minutes and the airfield is theirs.', 'alarm');
        if (flag(gg, 'ashore') >= 900) end(gg, false, 'Indian marines hold the airfield on Mahé. The Seychelles are lost.');
        keepCourse(kal, brg(kal, victoria), 5);
        pointDefence(gg, frig, 0.3);
        steer(rankin, kal.alive ? kal : victoria, 7);
        skirmish(gg, [rankin], [kal], 4, 0.15, 0.1, 0.5);
      };
    },
  },

  // ---- India's navy -----------------------------------------------------------------------------
  I3: {
    key: 'I3', title: 'Andaman Sea', era: '2029', place: 'Andaman Sea', date: 'August 2029, 0800',
    library: ['vikrant', 'kolkata', 'talwar', 'p8i', 'jalashwa'],
    brief: 'India\'s carrier INS Vikrant is crossing the Andaman Sea on course 135 to close the Malacca Strait, with the destroyers Kolkata and Chennai as her screen and a P-8I out ahead. Turn her back. Six points of damage on Vikrant, a torpedo and a missile or two Tomahawks, and she will turn for home; sinking both destroyers will do it too. She must not get 55 nm down her track: by then her air wing covers the strait. The destroyers keep station on her and hunt with good sonar and torpedoes, and the group\'s Barak-8s will shoot down most of your Harpoons and Tomahawks. The group is about 25 nm northwest of you.',
    build(g, r) {
      g.startClock = clock(8);
      g.timeLimit = 4 * 3600;
      const course = 135;
      const vp = offset(g.own, 300 + r() * 30, 23 + r() * 5);
      const vik = add(g, 'vikrant', 'INS Vikrant (R11)', 'enemy', vp, course, 16, go(course, 16));
      // The destroyers keep their screen stations, listening: they hunt with their own sonar and torpedoes.
      const spots = [40, 320];
      const dd = ['INS Kolkata (D63)', 'INS Chennai (D65)'].map((n, i) => add(g, 'kolkata', n, 'enemy', offset(vik, course + spots[i], 3), course, 16, { mode: 'patrol', legT: 1e9 }));
      screen(g, vik, 'talwar', ['INS Teg (F45)'], [[180, 3]]);
      const p8 = patrolPlane(g, 'p8i', 'P-8I Neptune', offset(vik, course, 15), r() * 360, 60);
      setGoal(g, { targets: [vik.id], need: 1, win: 'Vikrant is sunk.', timeout: 'The Vikrant group held its course.' });
      g.script = (gg) => {
        p8.ai!.center = offset(vik, vik.hdg, 15);
        dd.forEach((d, i) => { const st = offset(vik, vik.hdg + spots[i], 3); keepCourse(d, brg(d, st), dist(d, st) > 0.5 ? Math.min(28, vik.spd + 6) : vik.spd); });
        planeBuoys(gg, p8, false);
        pointDefence(gg, [vik, ...dd], 0.7);
        if (vik.alive && vik.cls.hp - vik.hp >= 6) end(gg, true, 'Vikrant is hit hard and turning for home. The strait stays open.');
        if (vik.alive && dd.every(isSunk)) end(gg, true, 'Both destroyers are sunk. With no screen left, Vikrant is turning for home.');
        const along = (vik.x - vp.x) * Math.sin((course * Math.PI) / 180) + (vik.y - vp.y) * Math.cos((course * Math.PI) / 180);
        if (vik.alive && along >= 55) end(gg, false, 'Vikrant is off the Malacca Strait with her air wing up. The strait is closed.');
      };
    },
  },

  I15: {
    key: 'I15', title: 'Karachi Relief', era: '2029', place: 'Arabian Sea', date: 'August 2029, 1300',
    library: ['kalvari', 'p8i', 'tanker', 'boxship', 'talwar'],
    brief: 'Pakistan\'s navy is still in the fight but running out of fuel and spares. Three chartered ships are making a run for Karachi, 36 nm north-northeast of you, at 14 knots: get at least two of them in. Indian Kalvaris are lying across the approach, quiet on their batteries until the ships come close, and a P-8I is working over the route with sonobuoys and torpedoes. Its buoys will hear any ping you make. Come up and shoot it down, or stay deep and slow under it. Lose two ships and the run has failed.',
    build(g, r) {
      g.startClock = clock(13);
      g.timeLimit = 3.5 * 3600;
      const karachi = offset(g.own, 22, 36);
      const course = brg(g.own, karachi);
      g.own.hdg = g.own.ordHdg = course;
      const lead = add(g, 'tanker', 'MT Pakistan Pride', 'allied', offset(g.own, course + 180, 2), course, 14, go(course, 14, 1e9));
      // Each ship makes her own best speed for Karachi: a damaged one is left behind, not waited for.
      const ships = [lead, ...(['MV Indus Trader', 'MV Makran Star'] as const).map((n, i) => add(g, 'boxship', n, 'allied', offset(lead, course + (i ? 210 : 150), 1.5), course, 14, go(course, 14, 1e9)))];
      const kal = ['INS Kalvari (S21)', 'INS Vela (S24)', 'INS Vagir (S25)'].map((n, i) => {
        const p = offset(g.own, course + (i % 2 ? 8 : -8) + (r() * 2 - 1) * 6, 12 + i * 8 + r() * 4);
        return add(g, 'kalvari', n, 'enemy', p, r() * 360, 2, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      });
      const p8 = patrolPlane(g, 'p8i', 'P-8I Neptune', offset(g.own, course, 15), r() * 360, 50);
      setGoal(g, { targets: [], protect: ids(ships), maxLosses: 1,
        win: 'Two ships are in Karachi. Pakistan\'s navy can sail again.', lossText: 'Two of the three ships are sunk. Karachi goes without.', timeout: 'The ships never made Karachi.' });
      g.flags.inPort = 0;
      g.script = (gg) => {
        p8.ai!.center = live(ships)[0] ?? karachi;
        planeBuoys(gg, p8);
        for (const k of kal) {
          if (!k.alive) continue;
          if (k.ai!.mode === 'patrol') keepCourse(k, norm(gg.t / 15), 2);
          if (k.ai!.mode !== 'raider' && live(ships).some((s) => dist(s, k) < 8)) { k.ai!.mode = 'raider'; k.ai!.torps = 3; }
        }
        for (const s of ships) {
          if (!s.alive) continue;
          if (s.ai!.mode === 'transit' || s.ai!.mode === 'alert') { s.ai!.baseCourse = brg(s, karachi); }
          if (arrive(gg, s, karachi, 1.5)) { gg.flags.inPort++; log(gg, 'good', `${s.name} is inside the Karachi breakwater.`); }
        }
        if (gg.flags.inPort >= 2) end(gg, true, 'Two ships are in Karachi. Pakistan\'s navy can sail again.');
        if (ships.every((s) => !s.alive) && gg.flags.inPort < 2) end(gg, false, 'Only one ship made Karachi. It isn\'t enough.');
      };
    },
  },

  I16: {
    key: 'I16', title: 'Lakshadweep', era: '2029', place: 'Laccadive Sea', date: 'August 2029, 0200', night: true,
    library: ['kolkata', 'kalvari', 'talwar', 'p8i'],
    brief: 'India has turned the Lakshadweep islands into a forward base: an airstrip on Agatti, about 50 nm east-northeast of you, and the naval detachment and its radar on Kavaratti, about 55 nm east. Raid it with Tomahawks: two hits on each of the three targets. The destroyer INS Kochi is patrolling west of the islands, and her Barak-8 missiles will shoot down most Tomahawks that fly within 20 nm of her. Sink her first or pick your launch point well. A Kalvari is on the prowl too. You have three hours before daylight brings the P-8Is.',
    build(g, r) {
      g.startClock = clock(2);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 90;
      const shift = (r() * 2 - 1) * 4;
      const kav = { x: 55, y: -3 + shift }, aga = { x: 45, y: 22 + shift };
      const targets = [['Agatti airstrip', aga], ['Kavaratti naval detachment', kav], ['Kavaratti radar station', { x: kav.x + 2, y: kav.y + 2 }]] as const;
      targets.forEach(([name, p], i) => g.sites.push({ id: -(i + 1), name, x: p.x, y: p.y, hits: 0 }));
      const beat = { x: 36 + r() * 4, y: 9 + shift };
      const kochi = add(g, 'kolkata', 'INS Kochi (D64)', 'enemy', offset(beat, r() * 360, 4), r() * 360, 10, { mode: 'patrol', legT: 1e9 });
      add(g, 'kalvari', 'INS Vagir (S25)', 'enemy', offset(g.own, 60 + r() * 60, 14 + r() * 6), r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1);
      setGoal(g, { targets: [], win: 'All three targets on Lakshadweep are wrecked. India\'s forward base is out of the war.', timeout: 'Daylight, and the base on Lakshadweep is still working.' });
      g.script = (gg) => {
        keepCourse(kochi, brg(kochi, offset(beat, norm(gg.t / 12), 7)), 10);
        pointDefence(gg, [kochi], 0.6);
        for (const w of gg.weapons) {
          if (w.dead || (w.type !== 'tlam' && w.type !== 'mjolnir') || high(w) || gg.flags[`sam${w.id}`] || !kochi.alive || dist(w, kochi) > 20) continue;
          gg.flags[`sam${w.id}`] = 1;
          if (gg.r() < adP(w, 0.7)) { w.dead = true; log(gg, 'warn', `${kochi.name}'s Barak-8 shot down ${w.label}.`); }
        }
        if (gg.sites.every((s) => s.hits >= 2)) end(gg, true, 'All three targets on Lakshadweep are wrecked. India\'s forward base is out of the war.');
      };
    },
  },

  // ---- The Bay of Bengal --------------------------------------------------------------------------
  I4: {
    key: 'I4', title: 'Arihant', era: '2029', place: 'Bay of Bengal', date: 'September 2029, 0400', night: true,
    library: ['arihant', 'kalvari', 'p8i', 'type094'],
    brief: 'INS Arighaat, India\'s missile submarine, has sailed from Visakhapatnam with nuclear missiles aboard, and the war is close to the edge. The fleet needs to know where she is at all times. She is about 7 nm south of you heading southeast. Trail her: hold her on sonar inside 8 nm for 45 minutes in all. Do not sink her: sinking a missile boat could start the nuclear war. She is loud, but her towed array is good: come inside about 4 nm, or run fast, and she will hear you. Every so often she turns to clear her baffles. If she hears you she will run, and if she hears you twice she knows she is being trailed and the patrol is blown. Lose her by more than 20 nm and the trail is cold. A P-8I is laying buoys along her track.',
    build(g, r) {
      g.startClock = clock(4);
      g.timeLimit = 3 * 3600;
      const course = 140 + r() * 20;
      g.own.hdg = g.own.ordHdg = course;
      const p = offset(g.own, 170 + r() * 30, 6 + r() * 2);
      const ari = add(g, 'arihant', 'INS Arighaat (S3)', 'enemy', p, course, 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      const p8 = patrolPlane(g, 'p8i', 'P-8I Neptune', offset(p, course, 10), r() * 360, 60);
      setGoal(g, { targets: [], protect: [ari.id], maxLosses: 0, lossText: 'We sank a missile submarine. India is talking about nuclear release.', timeout: 'We lost too much time on the trail.' });
      g.flags.trail = 0; g.flags.spooked = 0;
      g.script = (gg) => {
        p8.ai!.center = offset(ari, ari.hdg, 8);
        planeBuoys(gg, p8, false);
        if (!ari.alive) return;
        // Her towed array hears all round, better than her hull sonar: half a minute of us on it and she knows.
        const se = excess(vesselSL(gg.own), gg.own, { x: ari.x, y: ari.y, hdg: ari.hdg, spd: ari.spd, depthT: ari.depthT, array: true }, 20) + gauss(gg.r) * 2;
        gg.flags.heard = se > 0 ? flag(gg, 'heard') + 1 : Math.max(0, flag(gg, 'heard') - 1);
        // She heard us: she breaks away fast for ten minutes instead of fighting.
        if (ari.ai!.mode === 'attack' || ari.ai!.mode === 'evade' || flag(gg, 'heard') >= 30) {
          gg.flags.heard = 0;
          gg.flags.spooked++; gg.flags.runT = gg.t + 600;
          ari.ai!.mode = 'patrol'; ari.ai!.holdT = 0; ari.ai!.knows = null;
          gg.flags.runHdg = norm(brg(gg.own, ari) + (gg.r() * 2 - 1) * 30);
          log(gg, 'danger', gg.flags.spooked >= 2 ? 'Sonar: Arighaat is sprinting again. She knows we are here.' : 'Sonar: Arighaat has sped up sharply and is turning away. She may have heard us.', 'alarm');
          if (gg.flags.spooked >= 2) return end(gg, false, 'Arighaat counter-detected us twice. India knows the patrol is trailed and will move it.');
        }
        const running = gg.t < flag(gg, 'runT');
        // Every 20 minutes she swings round for a few minutes to clear her baffles.
        const clearing = !running && gg.t % 1200 > 1080;
        keepCourse(ari, running ? gg.flags.runHdg : clearing ? norm(course + 130) : norm(course + Math.sin(gg.t / 900) * 20), running ? 18 : clearing ? 5 : 8);
        if (held(gg, ari) && dist(gg.own, ari) < 8) gg.flags.trail++;
        if (gg.flags.trail === 1350) log(gg, 'good', 'XO: That\'s 30 minutes of track on Arighaat. Fifteen more.');
        if (gg.flags.trail >= 2700) end(gg, true, 'We have 45 minutes of track on Arighaat. A P-8A out of Diego Garcia is taking over the watch.');
        if (dist(gg.own, ari) > 20) end(gg, false, 'We lost Arighaat. She is more than 20 nm away and the trail is cold.');
      };
    },
  },

  I9: {
    key: 'I9', title: 'Trincomalee', era: '2029', place: 'Off Sri Lanka', date: 'September 2029, 0100', night: true,
    library: ['type071', 'type075', 'talwar', 'kalvari', 'jalashwa'],
    brief: 'The pact is landing on Sri Lanka to take the harbour at Trincomalee. Three Chinese amphibious ships, the assault ship Guangxi and the transport docks Wuzhishan and Qilianshan, carry an Indian brigade, with the frigate INS Tarkash as escort and the Kalvari INS Vagsheer sweeping ahead. They are about 18 nm east-northeast of you, heading for the beaches south of the harbour, about 18 nm west-southwest of you. Sink two of the three landing ships. If two of them reach the beach, the brigade is ashore.',
    build(g, r) {
      g.startClock = clock(1);
      g.timeLimit = 4 * 3600;
      const beach = offset(g.own, 240 + r() * 20, 17 + r() * 3);
      const gp = offset(g.own, 55 + r() * 25, 16 + r() * 4);
      const course = brg(gp, beach);
      const lead = add(g, 'type075', 'Guangxi (32)', 'enemy', gp, course, 13, go(course, 13));
      const lpd = screen(g, lead, 'type071', ['Wuzhishan (987)', 'Qilianshan (985)'], [[120, 1.5], [240, 1.5]]);
      screen(g, lead, 'talwar', ['INS Tarkash (F50)'], [[0, 3]]);
      const kp = offset(lead, course + (r() * 2 - 1) * 20, 9 + r() * 3);
      add(g, 'kalvari', 'INS Vagsheer (S26)', 'enemy', kp, course, 5, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
      const landers = [lead, ...lpd];
      setGoal(g, { targets: ids(landers), need: 2, win: 'Two of the landing ships are sunk. The landing at Trincomalee has failed.', timeout: 'The landing force is still at sea, but so is the brigade.' });
      g.flags.landed = 0;
      g.script = (gg) => {
        for (const v of landers) {
          if (v.alive && v.ai!.mode === 'transit') { v.ai!.baseCourse = brg(v, beach); v.ai!.cruise = 13; }
          if (arrive(gg, v, beach, 2)) { gg.flags.landed++; log(gg, 'danger', `${v.name} is off the beach and putting troops ashore.`); }
        }
        if (gg.flags.landed >= 2) end(gg, false, 'Two landing ships reached the beach. The brigade is ashore at Trincomalee.');
      };
    },
  },

  I17: {
    key: 'I17', title: 'Maldives', era: '2029', place: 'Off Malé', date: 'September 2029, 1100',
    library: ['jalashwa', 'kolkata', 'talwar', 'type071'],
    brief: 'India is seizing the Maldives. The landing ship INS Jalashwa is at anchor off Malé, 16 nm east of you, sending a battalion ashore by landing craft; it will all be ashore in 100 minutes. Sink her before then. She is big: one torpedo will only slow her. The destroyer INS Chennai is guarding the anchorage, and while she is afloat her Barak-8s will shoot down most Harpoons and Tomahawks sent at Jalashwa. India has mined the deep channel west of the anchorage, about 10 nm east of you: slow down so the HF sonar can find the mines, or ping, and the destroyer will hear the ping.',
    build(g, r) {
      g.startClock = clock(11);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 90;
      const anch = offset(g.own, 85 + r() * 10, 16);
      const jal = moored(g, 'jalashwa', 'INS Jalashwa (L41)', 'enemy', anch, r() * 360);
      const dd = add(g, 'kolkata', 'INS Chennai (D65)', 'enemy', offset(anch, 270, 3), 0, 8, { mode: 'patrol', legT: 1e9 });
      const mx = anch.x - 6 - r() * 1.5;
      mineLine(g, { x: mx, y: anch.y - 7 }, { x: mx, y: anch.y + 7 }, 18, 'enemy', 0.4);
      setGoal(g, { targets: [jal.id], need: 1, win: 'Jalashwa is sinking off Malé with the rest of the battalion still aboard. The landing has failed.', timeout: 'Jalashwa got away.' });
      g.flags.unload = 0;
      g.script = (gg) => {
        keepCourse(dd, brg(dd, offset(anch, norm(gg.t / 8), 3.5)), 8);
        // Chennai's Barak-8 covers the anchorage: most missiles at Jalashwa die while she is afloat and close.
        for (const w of gg.weapons) {
          if (w.dead || w.side !== 'us' || (w.type !== 'harpoon' && w.type !== 'mst' && w.type !== 'mjolnir') || high(w) || gg.flags[`pd${w.id}`]) continue;
          const at = [dd, jal].find((v) => v.alive && dist(v, w) < 3);
          if (!at) continue;
          gg.flags[`pd${w.id}`] = 1;
          const p = at === dd ? 0.6 : dd.alive && dist(dd, jal) < 8 ? 0.75 : 0.2;
          if (gg.r() < adP(w, p)) { w.dead = true; log(gg, 'warn', `${dd.alive ? dd.name : jal.name} shot down ${w.label}.`); }
        }
        if (jal.alive && !gg.flags.ran) gg.flags.unload++;
        if (gg.flags.ran && jal.ai!.mode === 'transit') { jal.ai!.baseCourse = 90; jal.ai!.cruise = 14; }
        if (gg.flags.unload === 3000) log(gg, 'warn', 'Radio intercepts: half the battalion is ashore in Malé.');
        if (gg.flags.unload >= 6000) end(gg, false, 'The whole battalion is ashore. India holds Malé.');
        if (jal.alive && jal.ai!.mode === 'alert' && !gg.flags.ran) { gg.flags.ran = 1; log(gg, 'warn', 'Jalashwa has cut her anchor cable and is running. The landing craft are left on the beach.'); }
        if (arrive(gg, jal, offset(anch, 90, 30), 2)) end(gg, false, 'Jalashwa escaped east. The troops she landed hold Malé.');
      };
    },
  },
};

export const extras: Record<MissionKey, ObjectiveFn> = {
  B2: (g, b) => {
    const east = Math.max(0, Math.min(36, g.own.x));
    return [
      { text: 'Get 36 nm east, round Cape Agulhas', state: east >= 36 ? 'done' : 'open', detail: `${east.toFixed(1)} of 36 nm so far. Sea state ${g.env.sea}.` },
      ...b,
    ];
  },
  I12: (g, b) => [...b, watch('Don\'t sink a tanker yourself', g.sunk.some((x) => x.side === 'allied' && x.by === 'us'), 'The supply ship and the tankers sound much alike. Identify before you shoot.')],
  I13: (g, b) => {
    const jam = g.vessels.find((v) => v.cls.key === 'jamaran');
    const ten = g.vessels.find((v) => v.cls.key === 'tender');
    return [
      { text: 'Reach the tender at Djibouti', state: g.over?.win ? 'done' : g.over ? 'failed' : 'open', detail: ten ? `${dist(g.own, ten).toFixed(1)} nm to go. Get within 3 nm.` : '' },
      { text: 'Get there before the mine line is finished', state: g.over?.reason.includes('closed') ? 'failed' : jam && isSunk(jam) ? 'done' : 'open',
        detail: jam && isSunk(jam) ? 'Jamaran is sunk: the line will never be finished.' : flag(g, 'laying') ? `Jamaran is laying: ${flag(g, 'laid')} mines down.` : 'Jamaran has not started laying yet.' },
      ...b,
    ];
  },
  I1: (g, b) => [...b, watch('Sink them before they launch', flag(g, 'salvos') > 0, flag(g, 'salvos') ? `${flag(g, 'salvos')} Exocet salvo${flag(g, 'salvos') > 1 ? 's' : ''} fired so far.` : 'Each one stops about 13 nm from the lagoon and fires 4 minutes later.')],
  I14: (g, b) => [...b, watch('Keep the frigates away from Port Victoria', flag(g, 'ashore') >= 900,
    flag(g, 'ashore') ? `A frigate has had ${mins(flag(g, 'ashore'))} off Victoria. At 15 minutes the airfield falls.` : 'Neither frigate is within 6 nm of Victoria yet.')],
  I3: (g, b) => {
    const vik = g.vessels.find((v) => v.cls.key === 'vikrant');
    const dd = g.vessels.filter((v) => v.cls.key === 'kolkata');
    const dmg = vik ? vik.cls.hp - Math.max(0, vik.hp) : 0;
    return [
      { text: 'Turn Vikrant back: hit her for 6 points of damage', state: dmg >= 6 ? 'done' : 'open', detail: `${dmg} of 6 so far. A Mk 48 does 5, a Tomahawk 3, a Harpoon 2.` },
      { text: 'Or sink both destroyers', state: dd.every(isSunk) ? 'done' : 'open', detail: `${dd.filter(isSunk).length} of 2 sunk.` },
      watch('Stop her before she is 55 nm down her track', !!g.over?.reason.includes('Malacca')),
      ...b.filter((o) => !o.text.startsWith('Sink')),
    ];
  },
  I15: (g, b) => [{ text: 'Get two of the three ships into Karachi', state: flag(g, 'inPort') >= 2 ? 'done' : g.over && !g.over.win ? 'failed' : 'open', detail: `${flag(g, 'inPort')} of 2 in port.` }, ...b],
  I16: (g, b) => [
    ...g.sites.map((s) => ({ text: `Two hits on ${s.name}`, state: s.hits >= 2 ? 'done' as const : 'open' as const, detail: `${s.hits} of 2.` })),
    watch('Mind INS Kochi\'s Barak-8: it shoots down Tomahawks within 20 nm of her', false, g.vessels.some((v) => v.cls.key === 'kolkata' && isSunk(v)) ? 'Kochi is sunk. The sky is open.' : 'Kochi is still afloat.'),
    ...b,
  ],
  I4: (g, b) => {
    const trail = Math.min(flag(g, 'trail'), 2700);
    const ari = g.vessels.find((v) => v.cls.key === 'arihant');
    return [
      { text: 'Trail Arighaat inside 8 nm for 45 minutes', state: trail >= 2700 ? 'done' : 'open', detail: `${mins(trail)} of 45 min held. Only time with her held on sonar inside 8 nm counts.` },
      watch('Don\'t let her hear you twice', flag(g, 'spooked') >= 2, `She has heard us ${flag(g, 'spooked')} time${flag(g, 'spooked') === 1 ? '' : 's'}.`),
      watch('Don\'t sink her', !!ari && isSunk(ari)),
      watch('Don\'t lose her: more than 20 nm away and the trail is cold', !!g.over?.reason.includes('lost Arighaat')),
      ...b.filter((o) => o.text.startsWith('Finish')),
    ];
  },
  I9: (g, b) => [...b, watch('Don\'t let two landing ships reach the beach', flag(g, 'landed') >= 2, `${flag(g, 'landed')} of 2 have reached it.`)],
  I17: (g, b) => {
    const u = flag(g, 'unload');
    return [...b, watch('Sink her before the battalion is ashore', u >= 6000, flag(g, 'ran') ? 'She has stopped unloading and is running.' : `${mins(6000 - u)} until the last troops are ashore.`)];
  },
};
