// Modern war missions: chance. Surprise missions the news can swap in for the next slot (V1 to V6).
// They happen "near the next mission", so each is set in generic open ocean on passage, and says so.
import { brg, dist, fmtBrg, norm, offset } from '../math';
import { atPeriscopeDepth, end, excess, log, vesselSL, type Game, type Vessel } from '../sim';
import {
  add, at, byId, clock, flag, go, ids, isSunk, keepCourse, mins, screen, setGoal, steer, watch,
  type Mission, type MissionKey, type ObjectiveFn,
} from '../kit';
import { passFix } from './arctic';

const PLACE = 'Open ocean, on passage';
const DATE = 'On passage, wartime';
/** A pact sub sent after a ship: the WWII raider logic, which closes and fires straight-runners. */
const raider = (g: Game, cls: string, name: string, p: { x: number; y: number }, spd: number) =>
  add(g, cls, name, 'enemy', p, 0, spd, { mode: 'raider', cruise: spd, decoys: 2, torps: 6 }, 1);
const ourHits = (g: Game, v: Vessel) => v.hp < v.cls.hp;

export const missions: Record<MissionKey, Mission> = {
  V1: {
    key: 'V1', title: 'Mayday', era: '2029', place: PLACE, date: `${DATE}, 0300`, night: true,
    library: ['udaloy', 'steregushchiy', 'ka27', 'virginia', 'gorshkov'],
    brief: 'Change of plan on the way to your next mission. USS Delaware has gone down in open ocean after a collision with a seamount: she is lying on the bottom 8 nm north of you, crew alive, too deep to escape on their own. A rescue ship with the SRDRS rescue system is coming in from the east or west (she will say which on the radio) and will be on site in about an hour; it needs 30 minutes over her. A Udaloy and a Steregushchiy corvette heard her go down and are searching the area from the north with a Ka-27, circling in closer as they go. If one of them spends two minutes within 1.5 nm of Delaware, its sonar will find her and it will attack. Keep them off her, and keep the rescue ship afloat, until the crew is up. Sink them, or draw them away.',
    build(g, r) {
      g.startClock = clock(3);
      g.timeLimit = 2.5 * 3600;
      const wreck = offset(g.own, (r() * 2 - 1) * 20, 8);
      // Delaware lies on the bottom: not a vessel in the fight (a seeker can't pick her out of the seabed), just a spot to guard.
      const rescue = add(g, 'rescueship', 'MV Dakota Rescue', 'allied', offset(wreck, (r() < 0.5 ? 90 : 270) + (r() * 2 - 1) * 20, 12), 0, 12);
      const hunt = (cls: string, name: string, a: number) => add(g, cls, name, 'enemy', offset(wreck, a, 6 + r() * 2), 0, 12, { mode: 'patrol', legT: 1e9 });
      // They came in from the north when they heard her go down.
      const a0 = (r() * 2 - 1) * 50;
      const hunters = [hunt('udaloy', 'Admiral Panteleyev', a0), hunt('steregushchiy', 'Sovershenny', a0 + (r() < 0.5 ? 1 : -1) * (50 + r() * 30))];
      add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(hunters[0], 90, 2), 0, 120, { mode: 'search', center: { x: wreck.x, y: wreck.y }, wp: offset(wreck, r() * 360, 4), torps: 1, datum: null, hits: 0, dipT: 0 });
      setGoal(g, { targets: [], protect: [rescue.id], maxLosses: 0, lossText: 'The rescue ship is sinking. Delaware\'s crew will not be coming home.', timeout: 'Out of time: the rescue never finished.' });
      g.flags.found = 0; g.flags.rescue = 0;
      g.script = (gg) => {
        // The hunters circle the spot where they heard her, closing in by a mile every quarter hour.
        const rad = Math.max(0.8, 5 - gg.t / 900);
        hunters.forEach((h, i) => keepCourse(h, brg(h, offset(wreck, gg.t / 12 + i * 180, rad)), 12));
        if (hunters.some((h) => h.alive && dist(h, wreck) < 1.5)) {
          if (!gg.flags.found) log(gg, 'danger', 'Sonar: a hunter is pinging right over Delaware!', 'alarm');
          gg.flags.found++;
        } else gg.flags.found = Math.max(0, gg.flags.found - 1);
        if (gg.flags.found >= 120 && !gg.flags.lost) {
          gg.flags.lost = 1;
          log(gg, 'danger', 'RBU rockets are exploding over Delaware. Her hull has given way.', 'boom');
          end(gg, false, 'The hunters found Delaware on the bottom. We lost them: her crew will not be coming home.');
        }
        at(gg, 5, 'radio', () => log(gg, 'info', `MV Dakota Rescue on the radio: inbound from the ${rescue.x > wreck.x ? 'east' : 'west'}, 12 nm out from Delaware, 12 knots.`));
        if (rescue.alive) steer(rescue, wreck, 12);
        if (rescue.alive && dist(rescue, wreck) < 1) {
          if (!gg.flags.rescue) log(gg, 'good', 'The rescue ship is over Delaware. The SRDRS is going down to her hatch.');
          gg.flags.rescue++;
        }
        if (gg.flags.rescue === 900) log(gg, 'good', 'The first load of survivors is up. Halfway there.');
        if (gg.flags.rescue >= 1800) end(gg, true, 'The last of Delaware\'s crew is aboard the rescue ship. Every one of them saved.');
      };
    },
  },

  V2: {
    key: 'V2', title: 'Ghost Contact', era: '2029', place: PLACE, date: `${DATE}, 1400`,
    library: ['reis', 'kalvari', 'virginia', 'taigei', 'collins', 'kilo', 'type039'],
    brief: 'On passage to your next mission, a P-8 has passed you a fleeting contact: a quiet submarine, about 9 nm to the north, working a patrol box about 4 nm across at 8 knots, nationality unknown. Its signature will be faint: expect to close to a mile or two to read it. The P-8 will pass a rough position every 10 minutes until you can read its signature yourself. It could be a neutral Turkish Reis on its own business, an Indian Kalvari hunting for the pact, or one of ours that nobody told you about. Identify it by its signature, classify it, and come to periscope depth to report. If it is Indian, you will then be cleared to sink it; it is hunting shipping, and will only turn on you if you come within 2 nm or shoot. If you report it wrongly, or fire on a neutral or a friend, the mission fails. You have three hours.',
    build(g, r) {
      g.startClock = clock(14);
      g.timeLimit = 3 * 3600;
      g.env.sea = 1;
      const roll = r();
      const [cls, name] = roll < 0.35 ? ['reis', 'TCG Hızırreis'] : roll < 0.7 ? ['kalvari', 'INS Vagsheer'] : roll < 0.85 ? ['virginia', 'USS Iowa (SSN-797)'] : ['taigei', 'JS Raigei'];
      const hostile = cls === 'kalvari';
      const p = offset(g.own, (r() * 2 - 1) * 35, 8 + r() * 2);
      const course = norm(brg(p, g.own) + 90 + (r() * 2 - 1) * 40), dir = r() < 0.5 ? 1 : -1;
      const ghost = hostile ? add(g, cls, name, 'enemy', p, course, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.5 ? 2 : 1)
        : add(g, cls, name, 'allied', p, course, 5, undefined, r() < 0.5 ? 2 : 1);
      g.flags.hostile = hostile ? 1 : 0;
      setGoal(g, hostile ? { targets: [], win: '', timeout: 'Three hours, and we never pinned it down.' }
        : { protect: [ghost.id], maxLosses: 0, lossText: `We sank ${name}. She was ${cls === 'reis' ? 'a neutral' : 'one of ours'}.`, timeout: 'Three hours, and we never pinned it down.' });
      g.script = (gg) => {
        // It works a patrol box: a slow racetrack about 4 nm across, at 8 knots.
        const c = brg(ghost, offset(p, (gg.t / 9) * dir, 2));
        if (hostile) keepCourse(ghost, c, 8); else steer(ghost, offset(ghost, c, 5), 8);
        // The Kalvari is after shipping: it only turns on a submarine that comes within 2 nm or shoots.
        const weFired = Object.values(gg.stats.fired).some((n) => n > 0);
        if (hostile && ghost.alive && ghost.ai!.mode === 'attack' && !weFired && dist(gg.own, ghost) > 2) { ghost.ai!.mode = 'patrol'; ghost.ai!.holdT = 0; }
        // The P-8 stays on station and passes a rough position every 10 minutes until we can read it ourselves.
        const own = gg.contacts.find((x) => x.vid === ghost.id);
        if (ghost.alive && gg.t % 600 === 300 && !(own?.held && own.matches.length)) passFix(gg, ghost, 'P-8 Poseidon reports', 1, 0.3);
        if (hostile && gg.stats.enemyFired > 0 && !Object.values(gg.stats.fired).some((n) => n > 0)) gg.flags.shotFirst = 1;
        if (!hostile && ghost.alive && ourHits(gg, ghost)) end(gg, false, `We put a torpedo into ${name}. She was ${cls === 'reis' ? 'a neutral Turkish boat' : 'one of ours'}.`);
        if (gg.flags.reported) {
          if (hostile && isSunk(ghost)) end(gg, true, 'The Kalvari is sunk. One less pact boat on the lanes.');
          return;
        }
        const k = gg.contacts.find((x) => x.vid === ghost.id);
        if (!k?.classified || !atPeriscopeDepth(gg)) {
          if (hostile && isSunk(ghost) && gg.flags.shotFirst) end(gg, true, 'It fired on us first, and we sank it. An Indian Kalvari, the wreckage says.');
          if (hostile && isSunk(ghost)) end(gg, false, 'We sank it before we knew what it was. It was Indian, but the rules said identify first, and the inquiry will say so too.');
          return;
        }
        gg.flags.reported = 1;
        if (k.classified !== cls) return end(gg, false, `We reported it as a ${k.classified === 'kalvari' ? 'pact boat' : 'friendly or neutral'}. It was ${name}.${hostile ? ' It went on to torpedo a tanker.' : ' A P-8 put a torpedo into it on our word.'}`);
        if (!hostile) return end(gg, true, `Report sent: ${name}, ${cls === 'reis' ? 'a neutral, going about her business' : 'one of ours on a patrol nobody told us about'}. Nobody fires.`);
        log(gg, 'good', 'Fleet acknowledges: an Indian Kalvari. Weapons free: sink it.');
        gg.goal.targets = [ghost.id]; gg.goal.need = 1; gg.goal.win = 'The Kalvari is sunk. One less pact boat on the lanes.';
      };
    },
  },

  V3: {
    key: 'V3', title: 'Storm Front', era: '2029', place: PLACE, date: `${DATE}, 2100`, night: true,
    library: ['yasen', 'akula', 'kilo', 'boxship', 'arleigh', 'virginia'],
    brief: 'A full gale has caught you on passage, and the pact is using it. A Yasen-M is closing on an allied convoy about 40 nm east of you, steaming north, under cover of the storm: nothing is flying, wave noise is drowning out quiet contacts for everyone, and the periscope sees half as far. If the Yasen spends 15 minutes within 20 nm of the convoy, it will fire its Oniks missiles. Find it and sink it first. It is somewhere between you and the convoy, probably 9 to 14 nm east of you now. The destroyer with the convoy, USS Paul Ignatius, will pass you a rough fix whenever her towed array catches it. The storm will peak in about half an hour and ease after two.',
    build(g, r, carry) {
      g.startClock = clock(21);
      g.timeLimit = 3 * 3600;
      g.env.sea = 5;
      g.own.hdg = g.own.ordHdg = 90;
      const lead = add(g, 'arleigh', 'USS Paul Ignatius', 'allied', offset(g.own, 80 + r() * 20, 40), 0, 10, go(0, 10, 1e9));
      const ships = screen(g, lead, 'boxship', ['MV Maersk Kensington', 'MV Cape Orlando', 'MV Atlantic Sun'], [[150, 2], [210, 2], [180, 4]]);
      const p = offset(g.own, 70 + r() * 40, 9 + r() * 5);
      const names = ['Arkhangelsk', 'Perm', 'Novosibirsk', 'Krasnoyarsk'].filter((n) => !carry.sunk.includes(n));
      const ys = add(g, 'yasen', names[0] ?? 'Perm', 'enemy', p, brg(p, lead), 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      setGoal(g, { targets: [ys.id], need: 1, protect: ids(ships), maxLosses: 0, lossText: 'The Oniks got through. A convoy ship is burning in the gale.',
        win: 'The Yasen is sunk in the storm. The convoy never knew it was there.', timeout: 'The storm blew out and the Yasen slipped away.' });
      g.flags.salvoT = 0;
      g.script = (gg) => {
        at(gg, 30 * 60, 'peak', () => { gg.env.sea = 6; log(gg, 'warn', 'The gale is at its height: sea state 6. Even the sonar is half deaf.'); });
        at(gg, 120 * 60, 'ease', () => { gg.env.sea = 4; log(gg, 'info', 'The storm is easing: sea state 4.'); });
        if (!ys.alive) return;
        // The Yasen closes the convoy for a missile shot, but fights if it hears us.
        keepCourse(ys, brg(ys, offset(lead, 270, 18)), 8);
        if (dist(ys, lead) < 20) gg.flags.salvoT++;
        // Paul Ignatius's towed array catches it now and then through the storm, and passes us a rough fix.
        if (lead.alive && gg.t % 900 === 450 && dist(ys, lead) < 26) passFix(gg, ys, 'USS Paul Ignatius reports', 2, 0.3);
        if (gg.flags.salvoT === 600) log(gg, 'warn', `Sonar: the Yasen is slowing and coming shallow, bearing ${fmtBrg(brg(gg.own, ys))}. It's setting up a missile shot!`);
        if (gg.flags.salvoT >= 900) {
          const t = ships.find((s) => s.alive);
          if (t) { t.hp = 0; t.alive = false; gg.sunk.push({ name: t.name, cls: t.cls.key, side: 'allied', by: 'enemy' }); log(gg, 'danger', `Vampire! Oniks missiles through the storm: ${t.name} is hit and sinking.`, 'boom'); }
        }
      };
    },
  },

  V4: {
    key: 'V4', title: 'Spy Trawler', era: '2029', place: PLACE, date: `${DATE}, 1000`,
    library: ['trawler', 'kilo', 'steregushchiy', 'virginia'],
    brief: 'An intelligence trawler, the Vishnya-class Viktor Leonov, is sitting on your route to the next mission, about 10 nm north, streaming towed hydrophones. If she hears you for ten minutes in all, or sees your masts within 6 nm, she will report Tang and the next mission will be blown. Sink her, or put a weapon in the water close enough (within 3 nm) to send her running, then let her go: if she gets 20 nm away she has run. She is noisy; you will hear her long before she hears you, unless you go fast. A Kilo is keeping her company.',
    build(g, r) {
      g.startClock = clock(10);
      g.timeLimit = 2.5 * 3600;
      const p = offset(g.own, (r() * 2 - 1) * 30, 9 + r() * 2);
      const agi = add(g, 'trawler', 'Viktor Leonov', 'enemy', p, r() * 360, 3, { mode: 'wander', center: { x: p.x, y: p.y }, rng: 3, cruise: 3 });
      const k = add(g, 'kilo', 'Novorossiysk', 'enemy', offset(p, r() * 360, 2 + r() * 2), r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1);
      void k;
      setGoal(g, { targets: [agi.id], need: 1, win: 'Viktor Leonov is sinking. Nobody heard us.', timeout: 'She is still sitting on our route. The next mission is blown before it starts.' });
      g.flags.heard = 0;
      g.script = (gg) => {
        if (!agi.alive) return;
        const o = gg.own;
        if (!gg.flags.running) {
          const se = excess(vesselSL(o), o, { x: agi.x, y: agi.y, hdg: agi.hdg, spd: agi.spd, depthT: 1, array: true }, 23);
          if (se > 0) gg.flags.heard++;
          if (atPeriscopeDepth(gg) && dist(o, agi) < 6) gg.flags.heard += 5;
          if (gg.flags.heard >= 300 && !gg.flags.warned) { gg.flags.warned = 1; log(gg, 'warn', 'Radio intercept: Viktor Leonov is on the air, short coded bursts. She may be on to us.'); }
          if (gg.flags.heard >= 600) return end(gg, false, 'Viktor Leonov has reported us. The pact knows Tang is coming.');
          if (gg.weapons.some((w) => w.side === 'us' && !w.dead && dist(w, agi) < 3)) {
            gg.flags.running = 1;
            agi.ai = null; agi.ordHdg = brg(o, agi); agi.ordSpd = agi.cls.maxSpd;
            log(gg, 'good', `Viktor Leonov has cut her hydrophones loose and is running, bearing ${fmtBrg(brg(o, agi))}.`);
            gg.flags.fromX = agi.x; gg.flags.fromY = agi.y;
          }
        } else if (dist(agi, { x: gg.flags.fromX, y: gg.flags.fromY }) > 20) {
          agi.alive = false; agi.gone = true;
          end(gg, true, 'Viktor Leonov has run for home without her hydrophones. Nobody heard enough to report.');
        }
      };
    },
  },

  V5: {
    key: 'V5', title: 'Friendly Fire', era: '2029', place: PLACE, date: `${DATE}, 1600`,
    library: ['type26', 'nansen', 'arleigh', 'kilo', 'virginia'],
    brief: 'The British frigate HMS Glasgow, about 12 nm north of you, has been told a pact submarine is in this box, and she thinks it is you. The datalink that would tell her otherwise is down. She will hunt you with her towed array and her active sonar, which pings every two minutes and will fix you inside 5 nm, deep or shallow. Do not shoot back: damage her and the mission fails. Prove who you are: come to periscope depth within 6 nm of her and stay up for a minute in all, so her lookouts see your masts and she hears you on the radio. Her radar will see the masts first, and she may shoot at them before her captain believes you. Or stay alive and out of her way for two and a half hours, until the datalink is back.',
    build(g, r) {
      g.startClock = clock(16);
      g.timeLimit = 2.5 * 3600;
      const p = offset(g.own, (r() * 2 - 1) * 40, 11 + r() * 2);
      const gl = add(g, 'type26', 'HMS Glasgow', 'enemy', p, brg(p, g.own), 12, { mode: 'attack', legT: 400 });
      gl.ai!.knows = { x: g.own.x + (r() * 2 - 1) * 2, y: g.own.y + (r() * 2 - 1) * 2, t: 0, deep: false };
      setGoal(g, { protect: [gl.id], maxLosses: 0, surviveWin: true, lossText: 'We sank HMS Glasgow.',
        win: 'The datalink is back. Glasgow knows who we are, and her captain owes ours a drink.', timeout: '' });
      g.flags.seen = 0;
      g.script = (gg) => {
        if (!gl.alive) return;
        if (ourHits(gg, gl)) return end(gg, false, 'We put a weapon into HMS Glasgow. Blue on blue.');
        // Without the datalink she keeps her last datum warm: she goes back to the box whenever she loses us.
        if (gl.ai!.mode === 'patrol') keepCourse(gl, brg(gl, offset({ x: 0, y: 0 }, gg.t / 10, 4)), 14);
        // Her Type 2087 active sonar goes out every two minutes, below the layer as well as above it.
        if (gg.t % 120 === 60) {
          const d = dist(gg.own, gl);
          if (d < 20) log(gg, 'contact', `Sonar: active sonar, bearing ${fmtBrg(brg(gg.own, gl))}. Glasgow's 2087 is pinging.`, 'ping');
          if (d < 5) {
            gl.ai!.knows = { x: gg.own.x, y: gg.own.y, t: gg.t, deep: gg.own.depthT > 1.5, exact: true };
            if (gl.ai!.mode === 'patrol') gl.ai!.mode = 'attack';
            log(gg, 'danger', 'That ping had us in it. Glasgow has a fix on us.', 'alarm');
          }
        }
        if (atPeriscopeDepth(gg) && dist(gg.own, gl) < 6) {
          if (!gg.flags.seen) log(gg, 'info', 'Masts up. Calling Glasgow on the radio and the bridge-to-bridge net.');
          gg.flags.seen++;
          // Her radar sees the masts before her radio room believes us: one shot at the datum.
          if (gg.flags.seen === 20 && !gg.flags.shot) {
            gg.flags.shot = 1;
            gl.ai!.knows = { x: gg.own.x, y: gg.own.y, t: gg.t, deep: false, exact: true };
            gl.ai!.mode = 'attack'; gl.ai!.cool = 0;
            log(gg, 'danger', 'ESM: Glasgow\'s radar has locked on our masts. She\'s turning toward us.', 'alarm');
          }
        }
        if (gg.flags.seen >= 60) end(gg, true, 'HMS Glasgow: "Tang, Glasgow. We have you. Check fire, check fire. Sincere apologies." She is standing down.');
      };
    },
  },

  V6: {
    key: 'V6', title: 'Running Low', era: '2029', place: PLACE, date: `${DATE}, 0700`,
    library: ['tender', 'akula', 'kilo', 'yasen', 'virginia'],
    brief: 'Tang is nearly dry: two Mk 48s left in the tubes, the vertical tubes empty. The tender USS Emory S. Land has come out to meet you in open ocean, 8 nm north of you, steaming north at 5 knots. Get within half a mile of her at periscope depth and 6 knots or less, and stay there 20 minutes in all to take on weapons. A pact Akula has had a tip about where she is, and a Kilo may follow it. Rearm, then keep the tender afloat until she turns for home, two and a half hours from now.',
    build(g, r) {
      g.startClock = clock(7);
      g.timeLimit = 2.5 * 3600;
      const ten = add(g, 'tender', 'USS Emory S. Land (AS-39)', 'allied', offset(g.own, (r() * 2 - 1) * 20, 8), 0, 5, go(0, 5, 1e9));
      const a = r() * 360;
      raider(g, 'akula', 'Tigr', offset(ten, a, 22 + r() * 3), 12);
      const kl = raider(g, 'kilo', 'Krasnodar', offset(ten, a + 120 + r() * 120, 14), 6);
      setGoal(g, { protect: [ten.id], maxLosses: 0, surviveWin: true, lossText: 'Emory S. Land is sinking, and Tang\'s reloads with her.',
        win: 'Emory S. Land is turning for home, and Tang is full of fish again.', timeout: '' });
      g.flags.rearm = 0;
      g.own.vls = g.own.vls.map(() => 1e9);
      g.script = (gg) => {
        const o = gg.own;
        if (!gg.flags.rearmed) {
          if (gg.stats.fired.mk48 >= 2) o.tubes = o.tubes.map((x) => Math.max(x, 1e9));
          if (ten.alive && dist(o, ten) < 0.5 && o.spd <= 6 && atPeriscopeDepth(gg)) {
            if (!gg.flags.rearm) log(gg, 'good', 'Alongside Emory S. Land. Weapons coming across.');
            gg.flags.rearm++;
            if (gg.flags.rearm === 600) log(gg, 'good', 'Half the load is aboard. Ten more minutes.');
          }
          if (gg.flags.rearm >= 1200) {
            gg.flags.rearmed = 1;
            o.tubes = o.tubes.map(() => 0); o.vls = o.vls.map(() => 0);
            log(gg, 'good', 'Rearmed: tubes loaded, vertical tubes full. Weapons free.');
          }
        }
        // The Kilo waits an hour before it starts its run in.
        if (gg.t < 3600) kl.ordSpd = 0;
        at(gg, 60 * 60, 'kilo', () => { if (kl.alive) { log(gg, 'warn', 'Intelligence: a Kilo was seen leaving its patrol area, heading for the tender\'s position.'); } });
        if (gg.t >= gg.timeLimit - 1 && !gg.flags.rearmed) end(gg, false, 'The tender turned for home, and we never got our weapons aboard.');
      };
    },
  },
};

export const extras: Record<MissionKey, ObjectiveFn> = {
  V1: (g, b) => {
    const res = flag(g, 'rescue'), f = flag(g, 'found');
    return [
      { text: 'Guard the rescue for 30 minutes', state: res >= 1800 ? 'done' : 'open', detail: res ? `${mins(res)} of 30 min done.` : 'The rescue ship is still on its way.' },
      watch('Keep the hunters more than 1.5 nm from Delaware', !!flag(g, 'lost'), f ? `A hunter is over her: ${mins(120 - f)} until it finds her.` : 'Delaware is 8 nm north of where you started.'),
      ...b,
    ];
  },
  V2: (g, b) => [
    { text: 'Identify the contact and classify it', state: flag(g, 'reported') ? 'done' : 'open', detail: 'By its signature: Reis, Kalvari, Virginia or Taigei.' },
    { text: 'Come to periscope depth and report it', state: flag(g, 'reported') ? 'done' : 'open' },
    watch('Don\'t fire on a neutral or a friend', !!g.over?.reason.match(/sank|torpedo into/) && !flag(g, 'hostile')),
    ...(flag(g, 'reported') && flag(g, 'hostile') ? [{ text: 'Sink the Kalvari', state: g.over?.win ? 'done' : 'open' } as const] : []),
    ...b.filter((o) => !o.text.startsWith('Keep')),
  ],
  V3: (g, b) => {
    const t = flag(g, 'salvoT');
    return [...b, watch('Sink it before it fires on the convoy', t >= 900, t ? `It is inside 20 nm of the convoy: ${mins(900 - t)} until it fires.` : 'It needs 15 minutes inside 20 nm of the convoy.')];
  },
  V4: (g, b) => {
    const h = flag(g, 'heard');
    return [
      { text: 'Sink Viktor Leonov, or drive her off', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'running') ? 'She is running. Let her go.' : 'A weapon within 3 nm of her sends her running.' },
      watch('Don\'t let her report Tang', h >= 600, `She has heard us for ${mins(h)} of 10 min.`),
      ...b.filter((o) => !o.text.startsWith('Sink')),
    ];
  },
  V5: (g, b) => {
    const gl = g.vessels.find((v) => v.name === 'HMS Glasgow');
    return [
      { text: 'Show yourself: a minute at periscope depth within 6 nm of Glasgow', state: g.over?.win && flag(g, 'seen') >= 60 ? 'done' : 'open', detail: `${flag(g, 'seen')} of 60 s so far.` },
      watch('Don\'t fire on HMS Glasgow', !!gl && ourHits(g, gl)),
      ...b.filter((o) => !o.text.startsWith('Keep')),
    ];
  },
  V6: (g, b) => {
    const re = flag(g, 'rearm');
    const ten = byId(g, g.goal.protect)[0];
    return [
      { text: 'Rearm from Emory S. Land', state: flag(g, 'rearmed') ? 'done' : 'open', detail: flag(g, 'rearmed') ? 'Rearmed.' : `${mins(re)} of 20 min alongside. Within 0.5 nm, periscope depth, 6 knots or less.` },
      watch('Keep the tender afloat', !!ten && isSunk(ten)),
      ...b.filter((o) => !o.text.startsWith('Keep')),
    ];
  },
};
