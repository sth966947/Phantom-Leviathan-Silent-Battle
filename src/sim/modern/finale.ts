// Modern war missions: finale. The climax (E9, E10, E12, E15, E16) and the endings (E13 Armistice
// for victory or stalemate, E17 Launch Window at the brink, E18 Evacuation in defeat), February 2030.
import { brg, dist, gauss, norm, offset } from '../math';
import { end, log, type Game, type Vessel } from '../sim';
import {
  add, at, clock, flag, go, ids, isSunk, keepCourse, mins, missileSalvo, pointDefence, pressRaids, raid, screen, setGoal, skirmish, steer, watch,
  type Mission, type MissionKey, type ObjectiveFn, type Raid,
  markAt,
} from '../kit';
import { CRUISE, cruiseMissiles, enemyTorpedo, fresh, site } from './counter';

/** Ships' and allied air defence against cruise missiles: each missile coming within `range` of a defender is shot down with chance `p`, once per defender. */
function screenAir(g: Game, missiles: Vessel[], defenders: Vessel[], range: number, p: number) {
  for (const m of missiles) for (const d of defenders) {
    const k = `sa${m.id}_${d.id}`;
    if (!m.alive || !d.alive || g.flags[k] || dist(m, d) > range) continue;
    g.flags[k] = 1;
    if (g.r() < p) { m.alive = false; log(g, 'good', `${d.name} shot down ${m.name}.`); }
  }
}
/**
 * A boat the mission script sets on a ship, firing UGSTs at it from inside 3 nm every five minutes.
 * In raider mode the AI does the steering; in transit mode the script chases at `chase` knots, once
 * the ship is inside `notice` nm. Neither hunts Tang, though both dodge Tang's torpedoes.
 */
function stalk(g: Game, v: Vessel, prey: Vessel, key: string, chase = 0, notice = Infinity) {
  if (!v.alive || !prey.alive || !v.ai) return;
  if (v.ai.mode === 'raider') v.ai.prey = prey.id;
  const r = dist(v, prey);
  if (chase) {
    if (v.ai.mode === 'patrol' || v.ai.mode === 'attack') v.ai.mode = 'transit';
    if (v.ai.mode === 'transit') { v.ordHdg = r < notice ? brg(v, offset(prey, prey.hdg, Math.min(4, r * 0.4))) : v.ordHdg; v.ordSpd = r >= notice ? 3 : r > 2.5 ? chase : 5; }
  }
  if (r >= notice) return;
  if (r < 3 && r > 0.6 && g.t - flag(g, key) > 300) {
    g.flags[key] = g.t;
    g.flags[`${key}Fired`] = 1;
    enemyTorpedo(g, v, offset(prey, prey.hdg, prey.spd * r / 50 / 1.2), prey.depthT > 1.5);
    log(g, 'danger', `Sonar: launch transient near ${prey.name}! Torpedo in the water, heading for her.`, 'alarm');
  }
}
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
/** True once for each active ping Tang has made since the last call. */
function pinged(g: Game) {
  const n = g.pings.length ? g.pings[g.pings.length - 1].t : -1;
  if (n <= (g.flags.pingSeen ?? -1)) return false;
  g.flags.pingSeen = n;
  return true;
}

export const missions: Record<MissionKey, Mission> = {
  // ---- The climax --------------------------------------------------------------------------------
  E9: {
    key: 'E9', title: 'Rival\'s End', era: '2029', place: 'Lofoten Basin, Norwegian Sea', date: 'February 2030, 0300', night: true,
    library: ['yasen', 'akula', 'oscar', 'virginia', 'il38'],
    brief: 'Kazan has come looking for you one last time. Her captain has beaten every boat NATO has sent after him, and he knows how you fight. He is somewhere within about 12 nm, in a full gale: the wave noise blinds you both. He sprints and drifts, changes depth every leg, goes quiet after he dodges a torpedo, and nearly always shoots back down its bearing. His sonar crew will hear you whenever you go above 12 knots within 15 nm, and at any speed inside about 6 nm. He will very likely shoot first, and his double hull and his damage-control crew will keep him fighting after one hit: it takes two. An Il-38 is working for him. Sink Kazan. You have four hours before he slips away.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 4 * 3600;
      g.env.sea = 5;
      const b = r() * 360;
      const kaz = add(g, 'yasen', 'Kazan (K-561)', 'enemy', offset(g.own, b, 10 + r() * 3), norm(b + 180 + (r() * 2 - 1) * 60), 6, { mode: 'patrol', legT: 1e9, decoys: 4 }, r() < 0.5 ? 2 : 1);
      // A double hull and the best damage-control crew in the fleet: it takes two hits to sink her.
      kaz.hp = 9;
      const box = offset(g.own, r() * 360, 5);
      add(g, 'il38', 'Il-38N May', 'enemy', offset(box, r() * 360, 60), 0, 230, { mode: 'search', center: box, wp: box, buoyT: 0, torps: 2, datum: null });
      setGoal(g, { targets: [kaz.id], need: 1, win: 'Kazan is breaking up under the gale. Her captain fought to the end; the rivalry is over, and the Northern Fleet has lost its best.', timeout: 'Kazan slipped away into the gale. Her captain will be back.' });
      g.flags.kc = kaz.hdg;
      g.script = (gg) => {
        const ai = kaz.ai!, o = gg.own;
        if (!kaz.alive) return;
        // A veteran: every snap shot he can take, and quick reloads.
        if (ai.mode !== 'evade') ai.snapTaken = false;
        if (ai.cool > 200) ai.cool = 200;
        // Ten-minute legs: sprint, then drift and listen, with a new course and depth each leg.
        const leg = Math.floor(gg.t / 600);
        // He has come looking for us: from far off, each leg heads for where the Il-38 last put us (give or take 4 nm); close in, he crosses back and forth.
        if (flag(gg, 'leg') !== leg) {
          gg.flags.leg = leg;
          const rough = { x: o.x + (gg.r() * 2 - 1) * 4, y: o.y + (gg.r() * 2 - 1) * 4 };
          gg.flags.kc = dist(kaz, o) > 6 ? brg(kaz, rough) : norm(kaz.hdg + (gg.r() < 0.5 ? 100 : -100));
          if (ai.mode === 'patrol') kaz.ordDepth = gg.r() < 0.5 ? 2 : 1;
        }
        if (ai.mode === 'evade') gg.flags.dodged = gg.t;
        // After a dodge he goes quiet for three minutes and lets the torpedo look elsewhere.
        if (gg.flags.dodged && gg.t - gg.flags.dodged < 180 && ai.mode === 'attack') ai.mode = 'patrol';
        // He sprints only when far off; close in he drifts.
        keepCourse(kaz, gg.flags.kc, gg.flags.dodged && gg.t - gg.flags.dodged < 180 ? 3 : gg.t % 600 < 120 && dist(o, kaz) > 8 ? 12 : 4);
        // He hears an ASROC's Mk 54 splash in: he bolts at once, drops two decoys and shoots back at the launch.
        for (const w of gg.weapons) {
          if (w.type !== 'mk54' || w.dead || gg.flags[`k54${w.id}`] || dist(w, kaz) > 3) continue;
          gg.flags[`k54${w.id}`] = 1;
          ai.mode = 'evade'; ai.evadeT = 240; ai.threat = w; kaz.ordDepth = kaz.depthT > 1.5 ? 1 : 2;
          for (let k = 0; k < 2; k++) gg.decoys.push({ id: gg.seq++, side: 'enemy', x: kaz.x, y: kaz.y, life: 240, deep: k === 0 });
          if (ai.knows && gg.t - ai.knows.t < 300) enemyTorpedo(gg, kaz, { x: ai.knows.x, y: ai.knows.y }, ai.knows.deep);
        }
        // A torpedo close by: another countermeasure every half minute, up to eight in all.
        const near = gg.weapons.find((w) => w.side === 'us' && !w.dead && (w.type === 'mk48' || w.type === 'mk54') && dist(w, kaz) < 2);
        if (near && gg.t - flag(gg, 'kd') > 30 && flag(gg, 'kdn') < 8) {
          gg.flags.kd = gg.t; gg.flags.kdn = flag(gg, 'kdn') + 1;
          gg.decoys.push({ id: gg.seq++, side: 'enemy', x: kaz.x, y: kaz.y, life: 240, deep: kaz.depthT > 1.5 });
        }
        // His sonar crew hears anything fast within 15 nm.
        const r = dist(o, kaz);
        if ((o.spd > 12 && r < 15 || r < 6.5) && gg.t % 10 === 0) {
          ai.knows = { x: o.x + gauss(gg.r) * r * 0.05, y: o.y + gauss(gg.r) * r * 0.05, t: gg.t, deep: o.depthT > 1.5, exact: r < 6.5 };
          if (ai.mode === 'patrol' && !(gg.flags.dodged && gg.t - gg.flags.dodged < 180)) ai.mode = 'attack';
        }
      };
    },
  },

  E10: {
    key: 'E10', title: 'Last Line', era: '2029', place: 'Off the US East Coast', date: 'February 2030, 0500',
    library: ['yasen', 'akula', 'arleigh', CRUISE, 'virginia'],
    brief: 'A Yasen-M has got through to the American coast with a load of Kalibr cruise missiles. It is about 16 nm north of you, heading south-southeast at 10 knots for a launch position about 14 nm southeast of you, 140 nm off Norfolk; it will pass you by, not come to you. Sink it before it gets there. If it launches, its Kalibrs will fly west for Norfolk and Washington: come to periscope depth, get the radar up and bring them down with SM-6. If two get through, the strike has worked. It will launch from wherever it is two and a half hours from now. USS Mitscher and USS Bainbridge are 20 nm west of you and will shoot at any missile that comes near them. An Akula is sweeping ahead of the Yasen.',
    build(g, r, carry) {
      g.startClock = clock(5);
      g.timeLimit = 4 * 3600;
      const launch = offset(g.own, 120 + (r() * 2 - 1) * 15, 14);
      markAt(g, launch, 'Yasen launch position');
      const ys = offset(g.own, 10 + (r() * 2 - 1) * 15, 16);
      const yasen = add(g, 'yasen', fresh(carry, ['Krasnoyarsk (K-571)', 'Novosibirsk (K-573)', 'Arkhangelsk (K-564)', 'Perm (K-575)'], 1)[0], 'enemy', ys, brg(ys, launch), 9, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      const ak = add(g, 'akula', fresh(carry, ['Akula (Volk)', 'Akula (Samara)', 'Akula (Leopard)'], 1)[0], 'enemy', offset(yasen, brg(ys, launch), 6), brg(ys, launch), 7, { mode: 'patrol', legT: 500, decoys: 2 }, 1);
      const coast = offset(g.own, 280, 140);
      const dds = [add(g, 'arleigh', 'USS Mitscher', 'allied', offset(g.own, 270, 20), 0, 6, { mode: 'picket', center: offset(g.own, 265, 20) }), add(g, 'arleigh', 'USS Bainbridge', 'allied', offset(g.own, 290, 22), 0, 6, { mode: 'picket', center: offset(g.own, 295, 22) })];
      const kalibrs: Vessel[] = [];
      setGoal(g, { targets: [], win: '', timeout: 'The Yasen is still out there with its missiles.' });
      g.script = (gg) => {
        keepCourse(yasen, brg(yasen, launch), dist(yasen, launch) > 3 ? 10 : 3);
        keepCourse(ak, brg(ak, offset(yasen, brg(yasen, launch), 6)), 9);
        const salvo = (n: number) => {
          kalibrs.push(...cruiseMissiles(gg, yasen, coast, n, 'Kalibr', kalibrs.length + 1));
          log(gg, 'danger', `Launch transients, bearing ${Math.round(brg(gg.own, yasen)).toString().padStart(3, '0')}: the Yasen is firing Kalibrs! ${n} missiles heading west for the coast. Periscope depth, radar up, SM-6.`, 'alarm');
        };
        if (yasen.alive && !gg.flags.launchT && (dist(yasen, launch) < 2 || gg.t >= 150 * 60)) { gg.flags.launchT = gg.t; yasen.ordDepth = 1; salvo(4); }
        if (gg.flags.launchT && yasen.alive) { at(gg, gg.flags.launchT + 120, 'salvo2', () => salvo(4)); at(gg, gg.flags.launchT + 900, 'salvo3', () => salvo(4)); }
        screenAir(gg, kalibrs, dds, 12, 0.45);
        if (flag(gg, 'strikesThrough') >= 2) return end(gg, false, `${flag(gg, 'strikesThrough')} Kalibrs got through to Norfolk. The war has come home.`);
        if (!yasen.alive && !kalibrs.some((k) => k.alive))
          end(gg, true, gg.flags.launchT ? 'The Yasen is on the bottom and its missiles are down. The coast never knew how close it came.' : 'The Yasen is sunk with every missile still in its tubes. Nobody ashore will ever know.');
      };
    },
  },

  E12: {
    key: 'E12', title: 'Poseidon', era: '2029', place: 'North Atlantic, west of Ireland', date: 'February 2030, 2300', night: true,
    library: ['khabarovsk', 'poseidon', 'belgorod', 'yasen', 'virginia', 'tu142'],
    brief: 'The brink. Khabarovsk, the Poseidon carrier, is about 14 nm north of you, and Moscow has given her the order. She will launch her nuclear drone in about 45 minutes, sooner if she is attacked and survives. Sink her first if you can. Once it is out, the drone runs southwest for the coast at 35 knots and 700 feet: faster than Tang, and below the layer, so fire from below the layer too. Get ahead of it and put a torpedo into it before it is 60 nm from where it was launched; after that nothing can catch it. USS Delaware is waiting farther down its likely track and will get one shot. A Tu-142 covers Khabarovsk.',
    build(g, r) {
      g.startClock = clock(23);
      g.timeLimit = 3 * 3600;
      const course = 230;
      const kh = add(g, 'khabarovsk', 'Khabarovsk', 'enemy', offset(g.own, (r() * 2 - 1) * 25, 14), course, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      add(g, 'tu142', 'Tu-142MK Bear-F', 'enemy', offset(kh, r() * 360, 50), 0, 230, { mode: 'search', center: { x: kh.x, y: kh.y }, wp: { x: kh.x, y: kh.y }, buoyT: 0, torps: 2, datum: null });
      const del = add(g, 'virginia', 'USS Delaware (SSN-791)', 'allied', offset(kh, course, 34), 0, 0, undefined, 2);
      let drone: Vessel | null = null;
      setGoal(g, { targets: [kh.id], need: 1, win: 'Khabarovsk is sunk with the Poseidon still in her. The brink is a step further away.', timeout: 'The Poseidon is still running, and nobody is in front of it.' });
      g.flags.lx = 0; g.flags.ly = 0;
      g.script = (gg) => {
        if (!drone) keepCourse(kh, course, 5);
        const hurt = kh.alive && (kh.hp < kh.cls.hp || kh.ai!.mode === 'evade');
        if (!drone && kh.alive && (gg.t >= 45 * 60 || hurt)) {
          drone = add(gg, 'poseidon', 'Poseidon drone', 'enemy', { x: kh.x, y: kh.y }, kh.hdg, 10, undefined, 2);
          drone.ordSpd = 35; drone.ordHdg = course; drone.ordDepth = 2;
          gg.flags.lx = kh.x; gg.flags.ly = kh.y; gg.flags.launched = gg.t;
          markAt(gg, kh, 'Poseidon launch: catch it inside 60 nm', 60);
          // Her work done, Khabarovsk turns north for home.
          kh.ai = { ...kh.ai!, mode: 'raider', goal: offset(kh, 20, 80), cruise: 14 };
          gg.goal.targets = [drone.id]; gg.goal.win = 'The Poseidon drone is broken open on the bottom of the Atlantic. The coast will never know.';
          log(gg, 'danger', `Sonar: a huge launch transient and a high-speed screw, bearing ${Math.round(brg(gg.own, kh)).toString().padStart(3, '0')}. Khabarovsk has launched the Poseidon! Running deep and fast, southwest.`, 'alarm');
        }
        if (!drone?.alive) return;
        // Delaware's one shot as it passes her: it doesn't kill, but it slows the drone.
        if (!gg.flags.delShot && dist(drone, del) < 3) {
          gg.flags.delShot = 1;
          if (gg.r() < 0.5) { drone.ordSpd = 24; log(gg, 'good', 'Delaware reports a hit on the drone: it is damaged and slowing to 24 knots.'); }
          else log(gg, 'warn', 'Delaware fired on the drone and missed. It is still running at 35 knots.');
        }
        if (dist(drone, { x: gg.flags.lx, y: gg.flags.ly }) > 60) { drone.alive = false; drone.gone = true; end(gg, false, 'The Poseidon is past the last line where anything can catch it. In a day it will reach the coast.'); }
      };
    },
  },

  E15: {
    key: 'E15', title: 'Comms Dark', era: '2029', place: 'Norwegian Sea, off Jan Mayen', date: 'February 2030, 1400',
    library: ['oscar', 'akula', 'tanker', 'steregushchiy', 'il38', 'virginia'],
    brief: 'The satellites and the cables are down: no orders, no cueing, no anti-ship Tomahawk. Your last orders said to hurt the Northern Fleet however you can, so choose your target. One: the Oscar II Voronezh, about 14 nm northeast of you, running southwest for the convoy lanes. Two: the fleet oiler Akademik Pashin with the corvette Stoikiy, about 14 nm south, heading east at 8 knots; without her the Northern Fleet\'s ships can\'t stay at sea. Three: the Russian radar station at Barentsburg on Svalbard, 520 nm to the northeast, which guides their bombers: land three Tomahawks on it (about 65 minutes\' flight). Do any one of these. An Akula and an Il-38 are hunting in the area.',
    build(g, r, carry) {
      g.startClock = clock(14);
      g.timeLimit = 3 * 3600;
      g.flags.jammed = 1;
      const lanes = offset(g.own, 220, 30);
      markAt(g, lanes, 'Convoy lanes');
      const op = offset(g.own, 30 + r() * 30, 14);
      const oscar = add(g, 'oscar', fresh(carry, ['Oscar II (Voronezh)', 'Oscar II (Orel)', 'Oscar II (Tver)'], 1)[0], 'enemy', op, brg(op, lanes), 8, { mode: 'raider', goal: lanes, cruise: 8, decoys: 2 }, 1);
      const oiler = add(g, 'tanker', 'Akademik Pashin', 'enemy', offset(g.own, 170 + r() * 20, 14), 90, 8, go(90, 8, 900));
      const stoikiy = screen(g, oiler, 'steregushchiy', ['Stoikiy'], [[0, 2]]);
      const radar = site(g, 'Barentsburg radar station', offset(g.own, 30, 520));
      add(g, 'akula', fresh(carry, ['Akula (Pantera)', 'Akula (Gepard)', 'Akula (Tigr)'], 1)[0], 'enemy', offset(g.own, r() * 360, 9), r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, 2);
      add(g, 'il38', 'Il-38N May', 'enemy', offset(g.own, r() * 360, 60), 0, 230, { mode: 'search', center: { x: 0, y: 0 }, wp: { x: 0, y: 0 }, buoyT: 0, torps: 2, datum: null });
      setGoal(g, { targets: [], win: '', timeout: 'Three hours alone, and nothing to show for it.' });
      g.script = (gg) => {
        pointDefence(gg, stoikiy, 0.3);
        if (isSunk(oiler)) return end(gg, true, 'Akademik Pashin is burning. Without her fuel, the Northern Fleet\'s ships are tied to Kola, and nobody had to tell us to do it.');
        if (isSunk(oscar)) return end(gg, true, 'Voronezh is sunk short of the convoy lanes with all her Granits still aboard, and nobody had to tell us to do it.');
        if (oscar.alive && dist(oscar, lanes) < 2) { oscar.alive = false; oscar.gone = true; log(gg, 'warn', 'Voronezh has reached the convoy lanes and gone deep. That target is gone.'); }
        if (radar.hits >= 3) end(gg, true, 'Barentsburg radar is off the air and the bombers are flying blind over the Barents, and nobody had to tell us to do it.');
      };
    },
  },

  E16: {
    key: 'E16', title: 'The Defector', era: '2029', place: 'Norwegian Sea, off Vesterålen', date: 'February 2030, 0400', night: true,
    library: ['kilo', 'akula', 'yasen', 'udaloy', 'ka27', 'nansen', 'virginia'],
    brief: 'A Russian Kilo, Kolpino, has signalled that her crew wants out. She is 1 nm east of you, heading 230 at 8 knots for HNoMS Thor Heyerdahl, waiting 25 nm southwest of you off the Norwegian coast. Escort her there. Her old fleet knows what she is doing: an Akula is coming after her from the northeast, a Yasen will join the hunt about 50 minutes in, and the destroyer Admiral Levchenko and her helicopter are on their way. The hunters are after Kolpino, not you: they will dodge your torpedoes but not stop to shoot back, and they will torpedo her from inside 3 nm. Sink them first. Kolpino is a Kilo: do not shoot the Kilo. If she is sunk, the mission fails.',
    build(g, r, carry) {
      g.startClock = clock(4);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 230;
      const safe = offset(g.own, 230, 25);
      markAt(g, safe, 'HNoMS Thor Heyerdahl: bring her here');
      const kol = add(g, 'kilo', 'Kolpino (B-271)', 'allied', offset(g.own, 90, 1), 230, 8, undefined, 1);
      const heyer = add(g, 'nansen', 'HNoMS Thor Heyerdahl', 'allied', safe, 50, 4, { mode: 'picket', center: safe });
      const ak = add(g, 'akula', fresh(carry, ['Akula (Leopard)', 'Akula (Volk)', 'Akula (Samara)'], 1)[0], 'enemy', offset(g.own, 40 + r() * 20, 14 + r() * 3), 230, 12, { mode: 'transit', legT: 1e9, decoys: 2 }, 2);
      const hunters: Vessel[] = [ak];
      setGoal(g, { targets: [], protect: [kol.id], maxLosses: 0, lossText: 'Kolpino is sinking with her crew. Nobody will try to come over again.', win: '', timeout: 'Kolpino never made it to the Norwegians.' });
      g.flags.kolDecoys = 2;
      g.script = (gg) => {
        steer(kol, safe, 8);
        at(gg, 40 * 60, 'udaloy', () => {
          const dd = add(gg, 'udaloy', 'Admiral Levchenko', 'enemy', offset(kol, 20, 22), 200, 18, { mode: 'patrol', legT: 600 });
          add(gg, 'ka27', 'Ka-27PL Helix', 'enemy', offset(dd, 0, 2), 200, 120, { mode: 'search', center: { x: kol.x, y: kol.y }, wp: offset(kol, 20, 6), torps: 1, datum: null, hits: 0, dipT: 0 });
          log(gg, 'warn', 'Radio intercepts: the destroyer Admiral Levchenko is coming south at speed with a helicopter.');
        });
        at(gg, 50 * 60, 'yasen', () => {
          hunters.push(add(gg, 'yasen', fresh(carry, ['Severodvinsk (K-560)', 'Perm (K-575)', 'Arkhangelsk (K-564)'], 1)[0], 'enemy', offset(kol, 0, 13), 200, 12, { mode: 'transit', legT: 1e9, decoys: 2 }, 2));
          log(gg, 'warn', 'Sonar: a fast submarine coming down from the north. The Yasen has joined the hunt.');
        });
        // They have orders to sink Kolpino at any cost: they dodge Tang's torpedoes but don't stop to shoot back.
        for (const h of hunters) if (h.ai) h.ai.snapTaken = true;
        hunters.forEach((h, i) => stalk(gg, h, kol, `h${i}`, 18));
        // Kolpino dodges what she can: a decoy and a sprint when a torpedo closes on her.
        const tp = gg.weapons.find((w) => w.side === 'enemy' && !w.dead && dist(w, kol) < 2);
        if (tp && kol.alive && gg.t - flag(gg, 'kolDodge') > 240) {
          gg.flags.kolDodge = gg.t;
          if (gg.flags.kolDecoys > 0) { gg.flags.kolDecoys--; gg.decoys.push({ id: gg.seq++, side: 'allied', x: kol.x, y: kol.y, life: 240, deep: false }); }
          log(gg, 'warn', 'Kolpino is sprinting away from a torpedo and has launched a decoy.');
        }
        if (tp && kol.alive) { kol.ordHdg = brg(tp, kol); kol.ordSpd = 18; }
        skirmish(gg, [heyer], hunters, 5, 0.25, 0.05, 0.6);
        if (kol.alive && dist(kol, safe) < 2) { kol.alive = false; kol.gone = true; end(gg, true, 'Kolpino is alongside Thor Heyerdahl and her crew are coming over. Moscow has lost a boat and a secret, and the war has lost a little of its will.'); }
      };
    },
  },

  // ---- The endings -------------------------------------------------------------------------------
  E13: {
    key: 'E13', title: 'Armistice', era: '2029', place: 'Norwegian Sea, bound for Reykjavík', date: 'February 2030, 1000',
    library: ['kilo', 'akula', 'nansen', 'virginia'],
    brief: 'It is over, on paper. The delegations are aboard HNoMS Fridtjof Nansen, 2 nm north of you, heading 250 at 9 knots for the signing at a rendezvous 24 nm away. Not every boat at sea got the ceasefire: a Kilo and an Akula out on long patrols are lying somewhere ahead, near her track, and will take the Nansen for a target if she comes within about 6 nm of them. Don\'t start the war again. You may only fire on a boat after it has fired at the Nansen. Better still, close to within 4 nm of a boat and ping: on the underwater telephone your ping carries the ceasefire message, and it should stand down, though a suspicious captain may answer with a torpedo first. Her towed decoy will pull some torpedoes off her, but not all. If the Nansen is sunk, or you fire first, the ceasefire dies.',
    build(g, r, carry) {
      g.startClock = clock(10);
      g.timeLimit = 3.5 * 3600;
      g.own.hdg = g.own.ordHdg = 250;
      const course = 250;
      const meet = offset(g.own, course, 24);
      markAt(g, meet, 'Signing rendezvous');
      const nansen = add(g, 'nansen', 'HNoMS Fridtjof Nansen', 'allied', offset(g.own, 0, 2), course, 9, go(course, 9, 1e9));
      const rogues = [
        add(g, 'kilo', fresh(carry, ['Kaluga (B-800)', 'Vladikavkaz (B-459)', 'Magnitogorsk (B-471)'], 1)[0], 'enemy', offset(offset(g.own, course, 9 + r() * 2), course + (r() < 0.5 ? 90 : -90), 2 + r() * 2), r() * 360, 3, { mode: 'transit', legT: 1e9, decoys: 2 }, 1),
        add(g, 'akula', fresh(carry, ['Akula (Samara)', 'Akula (Gepard)', 'Akula (Vepr)'], 1)[0], 'enemy', offset(offset(g.own, course, 16 + r() * 3), course + (r() < 0.5 ? 90 : -90), 2 + r() * 2), r() * 360, 3, { mode: 'transit', legT: 1e9, decoys: 2 }, 2),
      ];
      setGoal(g, { targets: [], protect: [nansen.id], maxLosses: 0, lossText: 'Fridtjof Nansen is sinking with both delegations aboard. The ceasefire has drowned with them, and the war goes on.', win: '', timeout: 'The rendezvous was missed. The talks have broken up in anger.' });
      g.script = (gg) => {
        if (nansen.alive && dist(nansen, meet) < 1.5) nansen.ai!.cruise = 0;
        const ping = pinged(gg);
        // Nansen's towed torpedo decoy pulls some torpedoes off her.
        for (const w of gg.weapons) if (w.side === 'enemy' && !w.dead && !gg.flags[`nx${w.id}`] && dist(w, nansen) < 1.5) {
          gg.flags[`nx${w.id}`] = 1;
          if (gg.r() < 0.3) { w.dead = true; log(gg, 'good', 'Fridtjof Nansen\'s towed decoy has pulled a torpedo off her.'); }
        }
        rogues.forEach((v, i) => {
          if (!v.alive) return;
          const k = `r${i}`;
          // The ceasefire on the underwater telephone: a ping from inside 4 nm.
          if (!gg.flags[`${k}Told`] && ping && dist(gg.own, v) < 4) {
            // Some captains think it's a trick, the first time, and answer with a torpedo.
            if (!gg.flags[`${k}Doubt`] && gg.r() < 0.35) {
              gg.flags[`${k}Doubt`] = 1; gg.flags[`${k}Fired`] = 1;
              enemyTorpedo(gg, v, { x: gg.own.x, y: gg.own.y }, gg.own.depthT > 1.5);
              return log(gg, 'danger', `Underwater telephone: ${v.name} thinks it is a trick, and answers with a torpedo! She has fired: weapons free on her, or try again.`, 'alarm');
            }
            gg.flags[`${k}Told`] = 1;
            v.ai = null; v.ordHdg = norm(brg(nansen, v)); v.ordSpd = 8;
            log(gg, 'good', `Underwater telephone: ${v.name} acknowledges the ceasefire and is turning for home.`);
          }
          if (gg.flags[`${k}Told`]) return;
          stalk(gg, v, nansen, k, 10, 6);
          // Firing first: a hit on a boat that hasn't fired breaks the ceasefire.
          if (v.hp < v.cls.hp && !gg.flags[`${k}Fired`]) end(gg, false, `We fired first on ${v.name}, which had never heard of the ceasefire. Moscow calls it treachery; the talks are over and the war goes on.`);
        });
        if (nansen.alive && dist(nansen, meet) < 2 && !gg.weapons.some((w) => w.side === 'enemy' && !w.dead))
          end(gg, true, 'The ceasefire is signed on Fridtjof Nansen\'s quarterdeck. The guns are quiet from the Barents to the South China Sea. Tang turns for home, eighty-eight years late.');
      };
    },
  },

  E17: {
    key: 'E17', title: 'Launch Window', era: '2029', place: 'North Atlantic, south of Iceland', date: 'February 2030, 0100', night: true,
    library: ['borei', 'akula', 'yasen', 'virginia'],
    brief: 'The brink. A Borei, Knyaz Pozharsky, is on alert with sixteen Bulavas, about 3 nm ahead of you. If the crisis ashore goes the wrong way, she launches. Your orders: trail her until the crisis ends, three hours from now, and do nothing to make her captain think he is under attack. No weapons at all. No active sonar within 30 nm of her. Keep the trail: at least 90 minutes with her held inside 5 nm, and never let her get 20 nm away. If she hears you for long, her captain will assume the worst. An Akula is sweeping about 7 nm ahead of her; if it finds you, all you can do is run. Her own baffles, dead astern, are the safest place to be.',
    build(g, r, carry) {
      g.startClock = clock(1);
      g.timeLimit = 3 * 3600;
      const course = 200 + r() * 40;
      g.own.hdg = g.own.ordHdg = course;
      const bname = fresh(carry, ['Knyaz Pozharsky', 'Knyaz Oleg', 'Generalissimus Suvorov', 'Imperator Aleksandr III'], 1)[0];
      const borei = add(g, 'borei', bname, 'enemy', offset(g.own, course, 3), course, 6, { mode: 'transit', legT: 1e9, decoys: 2 }, 2);
      const ak = add(g, 'akula', fresh(carry, ['Akula (Tigr)', 'Akula (Pantera)', 'Akula (Gepard)'], 1)[0], 'enemy', offset(borei, course + (r() * 2 - 1) * 30, 7), course, 6, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      setGoal(g, { targets: [], surviveWin: true, win: '', timeout: '' });
      g.flags.trail = 0; g.flags.bc = course;
      g.script = (gg) => {
        if (!borei.alive) return end(gg, false, `${bname} is sinking. In her last minute she fired. Somewhere, cities are burning.`);
        // A slow, wandering patrol: a new course every half hour, and a change of depth.
        if (gg.t % 1800 === 0) { gg.flags.bc = norm(gg.flags.bc + (gg.r() * 2 - 1) * 40); borei.ordDepth = gg.r() < 0.5 ? 2 : 1; }
        borei.ordHdg = gg.flags.bc; borei.ordSpd = 6 + Math.round(Math.sin(gg.t / 900) + 1);
        keepCourse(ak, brg(ak, offset(borei, gg.flags.bc, 7)), 7);
        if (sum(gg.stats.fired) > 0) return end(gg, false, `${bname} heard our launch and took it for the first shot of an attack. She has fired her Bulavas.`);
        if (pinged(gg) && dist(gg.own, borei) < 30) return end(gg, false, `${bname} heard our active sonar. Her captain decided he was being hunted, and he launched.`);
        const heard = borei.ai!.holdT;
        if (heard > 60 && !gg.flags.warned) { gg.flags.warned = 1; log(gg, 'danger', `Sonar: ${bname} is slowing and coming shallow. She heard us. Open the range and stay quiet!`, 'alarm'); }
        if (heard < 20) gg.flags.warned = 0;
        if (heard > 150) return end(gg, false, `${bname} heard us stalking her for too long. Her captain assumed the worst and launched.`);
        if (dist(gg.own, borei) > 20) return end(gg, false, `We lost ${bname}. Nobody is watching a Borei on alert, and nobody can stop her.`);
        if (gg.contacts.find((c) => c.vid === borei.id)?.held && dist(gg.own, borei) < 5) gg.flags.trail++;
        if (gg.t >= gg.timeLimit - 1) end(gg, gg.flags.trail >= 5400, gg.flags.trail >= 5400
          ? `The crisis is over. Moscow and Washington have stepped back, and ${bname} has been ordered home. Nobody launched. The world will never know how close it came.`
          : `The crisis is over, but we lost the track for too long: ${bname} was alone for most of it. The world got lucky.`);
      };
    },
  },

  E18: {
    key: 'E18', title: 'Evacuation', era: '2029', place: 'Off Bodø, Norway', date: 'February 2030, 0600',
    library: ['ivangren', 'ropucha', 'steregushchiy', 'kilo', 'tu22m3', 'nansen', 'boxship'],
    brief: 'Norway is falling. Russian landing ships are coming down the coast for Bodø, and the last ships out of the port are leaving now: five cargo ships with the wounded, the civilians and what is left of the garrison, with HNoMS Thor Heyerdahl as escort. They are 2 nm east of you, heading 260 for open sea about 28 nm west. Get at least three of them out. A Kilo is waiting off the fjord mouth for them, two Steregushchiy corvettes ahead of the landing force 30 nm north will fire Uran missiles at the ships whenever they are inside 25 nm, and Backfires are expected about 50 minutes in, and again later: SM-6 will stop them. There may be more boats waiting farther out.',
    build(g, r, carry) {
      g.startClock = clock(6);
      g.timeLimit = 4 * 3600;
      const course = 260;
      g.own.hdg = g.own.ordHdg = course;
      const open = offset(g.own, course, 28);
      markAt(g, open, 'Open sea');
      const heyer = add(g, 'nansen', 'HNoMS Thor Heyerdahl', 'allied', offset(g.own, 90, 2), course, 10, go(course, 10, 1e9));
      const ships = screen(g, heyer, 'boxship', ['MV Vesterålen', 'MV Lofoten', 'MV Nordkapp', 'MV Saltstraumen', 'MV Polarlys'], [[150, 1.5], [210, 1.5], [180, 3], [140, 3.2], [220, 3.2]]);
      const kp = offset(g.own, course + (r() * 2 - 1) * 30, 8 + r() * 4);
      const kilos = [add(g, 'kilo', fresh(carry, ['Vladikavkaz (B-459)', 'Magnitogorsk (B-471)', 'Kaluga (B-800)'], 1)[0], 'enemy', kp, r() * 360, 3, { mode: 'raider', cruise: 6, decoys: 2, torps: 0 }, 1)];
      const force = { x: 0, y: 30 };
      const ig = add(g, 'ivangren', 'Pyotr Morgunov', 'enemy', force, 180, 12, go(180, 12, 1e9));
      screen(g, ig, 'ropucha', ['Kondopoga', 'Olenegorskiy Gornyak'], [[150, 2], [210, 2]]);
      const corv = screen(g, ig, 'steregushchiy', ['Stoikiy', 'Gremyashchiy'], [[-20, 8], [20, 9]]);
      const raids: Raid[] = [];
      setGoal(g, { targets: [], protect: ids(ships), maxLosses: 2, lossText: 'Three of the five ships are gone. Bodø\'s last convoy died in sight of the coast.', win: '', timeout: 'The ships never cleared the coast.' });
      g.script = (gg) => {
        pointDefence(gg, corv, 0.5);
        // A second Kilo, sent out from Vestfjorden to wait for them farther west.
        at(gg, 90 * 60, 'kilo2', () => {
          const lead = ships.find((v) => v.alive) ?? heyer;
          kilos.push(add(gg, 'kilo', fresh(carry, ['Novorossiysk (B-261)', 'Krasnodar (B-265)', 'Stary Oskol (B-262)'], 1)[0], 'enemy', offset(lead, course + (gg.r() * 2 - 1) * 20, 12), gg.r() * 360, 3, { mode: 'raider', cruise: 6, decoys: 2, torps: 0 }, 1));
          log(gg, 'warn', 'Signal from Bodø: a second Kilo sailed from Vestfjorden last night. She will be ahead of the ships.');
        });
        kilos.forEach((k, n) => stalk(gg, k, ships.find((v) => v.alive) ?? heyer, `kilo${n}`));
        skirmish(gg, [heyer], kilos, 3, 0.15, 0, 0.5);
        if (gg.t % 1200 === 600) for (const c of corv) {
          const near = ships.filter((v) => v.alive && dist(v, c) < 25);
          if (c.alive && near.length) missileSalvo(gg, c.name, 'Uran', 2, near, 0.3, 2, 'the evacuation ships');
        }
        at(gg, 50 * 60, 'backfires', () => raid(gg, raids, offset(heyer, 40, 150), ships.filter((v) => v.alive), 'tu22m3', ['Backfire 1', 'Backfire 2', 'Backfire 3'], 520));
        at(gg, 130 * 60, 'backfires2', () => raid(gg, raids, offset(heyer, 30, 150), ships.filter((v) => v.alive), 'tu22m3', ['Backfire 4', 'Backfire 5', 'Backfire 6'], 520));
        pressRaids(gg, raids, 3, 0.5, 'Kh-32 missiles');
        for (const v of ships) if (v.alive && v.x < open.x + 1) { v.alive = false; v.gone = true; gg.flags.out = flag(gg, 'out') + 1; log(gg, 'good', `${v.name} is out into open sea.`); }
        if (heyer.alive && heyer.x < open.x + 1) heyer.ai!.cruise = 4;
        if (!ships.some((v) => v.alive) && flag(gg, 'out') >= 3)
          end(gg, true, `${flag(gg, 'out')} ships made it out of Bodø. Norway has fallen and the war is lost, but these people will remember who came for them.`);
      };
    },
  },
};

export const extras: Record<MissionKey, ObjectiveFn> = {
  E9: (g, b) => b,
  E10: (g, b) => {
    const k = g.vessels.filter((v) => v.name.startsWith('Kalibr'));
    return [
      { text: 'Sink the Yasen before it launches', state: g.vessels.some((v) => v.cls.key === 'yasen' && isSunk(v)) ? 'done' : flag(g, 'launchT') ? 'failed' : 'open', detail: flag(g, 'launchT') ? 'It has launched.' : `It launches at its launch position, or in ${mins(150 * 60 - g.t)} wherever it is.` },
      ...(k.length ? [{ text: 'Shoot down the Kalibrs', state: k.some((x) => x.alive) ? 'open' as const : 'done' as const, detail: `${k.filter((x) => !x.alive && !x.gone).length} of ${k.length} down, ${flag(g, 'strikesThrough')} through.` }] : []),
      watch('Don\'t let two missiles reach the coast', flag(g, 'strikesThrough') >= 2, `${flag(g, 'strikesThrough')} of 2.`),
      ...b,
    ];
  },
  E12: (g, b) => {
    const d = g.vessels.find((v) => v.cls.key === 'poseidon');
    const run = d ? dist(d, { x: g.flags.lx, y: g.flags.ly }) : 0;
    return [
      { text: 'Sink Khabarovsk before she launches', state: d ? (g.vessels.find((v) => v.cls.key === 'khabarovsk')!.alive ? 'failed' : 'done') : b[0]?.state ?? 'open', detail: d ? 'The drone is out.' : `She launches in about ${mins(45 * 60 - g.t)}, sooner if she is attacked.` },
      ...(d ? [{ text: 'Sink the Poseidon drone', state: isSunk(d) ? 'done' as const : d.gone ? 'failed' as const : 'open' as const, detail: `${run.toFixed(0)} of 60 nm run. Fire from below the layer.` }] : []),
      ...b.filter((o) => !o.text.startsWith('Sink')),
    ];
  },
  E15: (g, b) => {
    const s = g.sites[0];
    const os = g.vessels.find((v) => v.cls.key === 'oscar')!, oil = g.vessels.find((v) => v.cls.key === 'tanker')!;
    return [
      { text: 'Choose one: sink the Oscar II before it reaches the lanes', state: isSunk(os) ? 'done' : os.gone ? 'failed' : 'open' },
      { text: 'Or sink the oiler Akademik Pashin', state: isSunk(oil) ? 'done' : 'open' },
      { text: 'Or land 3 hits on Barentsburg radar', state: s.hits >= 3 ? 'done' : 'open', detail: `${Math.min(3, s.hits)} of 3 hits. A Tomahawk counts 1, a Mjolnir 3.` },
      ...b.filter((o) => !o.text.startsWith('Sink')),
    ];
  },
  E16: (g, b) => {
    const kol = g.vessels.find((v) => v.name.startsWith('Kolpino'))!;
    const safe = g.vessels.find((v) => v.name === 'HNoMS Thor Heyerdahl')!;
    return [{ text: 'Get Kolpino to Thor Heyerdahl', state: g.over?.win ? 'done' : 'open', detail: kol.alive ? `${dist(kol, safe).toFixed(1)} nm to go.` : '' },
      watch('Don\'t shoot the Kilo', !!g.over?.reason.includes('our own weapon')), ...b];
  },
  E13: (g, b) => {
    const told = [0, 1].filter((i) => flag(g, `r${i}Told`)).length;
    return [{ text: 'Get Fridtjof Nansen to the rendezvous', state: g.over?.win ? 'done' : 'open', detail: `${told} of 2 rogue boats told of the ceasefire.` },
      watch('Don\'t fire first', !!g.over?.reason.includes('fired first'), 'Only a boat that has fired at the Nansen may be fired on. A ping from inside 4 nm tells a boat the war is over.'), ...b];
  },
  E17: (g) => {
    const tr = Math.min(flag(g, 'trail'), 5400);
    return [
      { text: 'Hold the Borei inside 5 nm for 90 minutes', state: tr >= 5400 ? 'done' : g.over && !g.over.win ? 'failed' : 'open', detail: `${mins(tr)} of 90 min.` },
      watch('No weapons, and no pings within 30 nm', !!g.over?.reason.match(/launch\b|active sonar/)),
      watch('Don\'t let her hear you for long', !!g.over?.reason.includes('stalking'), flag(g, 'warned') ? 'She has heard us! Open the range and keep quiet.' : 'She hasn\'t heard us.'),
      watch('Don\'t let her get 20 nm away', !!g.over?.reason.includes('lost')),
      { text: `Hold on until the crisis ends`, state: g.over?.win ? 'done' : 'open', detail: `${mins(g.timeLimit - g.t)} to go.` },
    ];
  },
  E18: (g, b) => [{ text: 'Get three ships out to open sea, 28 nm west', state: flag(g, 'out') >= 3 ? 'done' : 'open', detail: `${flag(g, 'out')} out so far.` }, ...b],
};
