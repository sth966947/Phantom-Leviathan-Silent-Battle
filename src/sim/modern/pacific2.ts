// Modern war missions: pacific2. See the Modern Campaign Plan and src/sim/warData.ts for where each one sits in the war.
// Act 2 in the Western Pacific, June to September 2029: the southern seas, the Chinese fleet coming out,
// the Hainan Bastion hub, what follows it, and the north Pacific against Russia.
import { brg, dist, fmtBrg, KT, norm, offset, type Vec } from '../math';
import { atPeriscopeDepth, end, excess, log, vesselSL, type Game, type Vessel } from '../sim';
import { mineLine, mineZone } from '../hazards';
import {
  add, arrive, at, baseObjectives, bombed, clock, flag, go, ids, isSunk, keepCourse, mins, named, pointDefence,
  pressRaids, raid, screen, setGoal, skirmish, steer, watch, type Mission, type MissionKey, type ObjectiveFn, type Raid,
  markAt,
} from '../kit';

export const missions: Record<MissionKey, Mission> = {};
export const extras: Record<MissionKey, ObjectiveFn> = {};

// ---- Local helpers --------------------------------------------------------------------------------
/** Keep a point in the mission's flags so the objectives can find it again. */
const mark = (g: Game, k: string, p: Vec) => { g.flags[`${k}X`] = p.x; g.flags[`${k}Y`] = p.y; return p; };
const spot = (g: Game, k: string): Vec => ({ x: flag(g, `${k}X`), y: flag(g, `${k}Y`) });
const live = (vs: Vessel[]) => vs.filter((v) => v.alive);
/** A search pattern for aircraft that aren't hunting us: quarter the area at `cruise` knots. */
const wander = (center: Vec, rng: number, cruise: number) => ({ mode: 'wander' as const, center, rng, cruise });
/** A maritime patrol aircraft working a box with sonobuoys and torpedoes. */
const patrolPlane = (center: Vec) => ({ mode: 'search' as const, center, wp: { ...center }, buoyT: 0, torps: 2, datum: null });
/** Allied missiles at an enemy group: each gets through with chance `p` and does `dmg`. */
function alliedSalvo(g: Game, who: string, missile: string, n: number, targets: Vessel[], p: number, dmg: number) {
  log(g, 'info', `${who} ${n === 1 ? 'is firing a' : `are firing ${n}`} ${missile}${n === 1 ? '' : 's'} at the enemy group.`);
  for (let i = 0; i < n; i++) {
    const up = live(targets);
    if (!up.length) return;
    if (g.r() > p) { log(g, 'info', `Sonar: distant airburst. A ${missile} was shot down short of the group.`); continue; }
    const t = up[Math.floor(g.r() * up.length)];
    for (let k = 0; k < dmg; k++) bombed(g, t, `a ${missile}`);
  }
}
/**
 * Escorts on station listen with their hull sonar, dulled by their own speed and the noise of the group.
 * One that holds Tang for a minute leaves the screen to attack (the sub-hunting AI takes over), two at most at
 * a time; when it loses us for good it goes back on station.
 */
function listen(g: Game, ships: Vessel[]) {
  const o = g.own;
  for (const v of ships) {
    if (!v.alive || !v.ai || v.cls.threshold === null) continue;
    const ai = v.ai, k = `hear${v.id}`;
    if (ai.mode === 'station') {
      const se = excess(vesselSL(o), o, { x: v.x, y: v.y, hdg: v.hdg, spd: v.spd, depthT: 0 }, v.cls.threshold + 7) + (g.r() * 2 - 1) * 2;
      g.flags[k] = se > 0 ? (g.flags[k] ?? 0) + 1 : Math.max(0, (g.flags[k] ?? 0) - 1);
      // The group commander keeps most of his screen in place: no more than two escorts go hunting at once.
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
const firedAny = (g: Game) => Object.values(g.stats.fired).some((n) => n > 0);

// ---- P7 Natuna: the southern seas --------------------------------------------------------------------
missions.P7 = {
  key: 'P7', title: 'Natuna', era: '2029', place: 'Natuna Islands, Indonesia', date: 'June 2029, 0430', night: true,
  library: ['type071', 'type052d', 'type054a', 'type075', 'type056'],
  brief: 'China has come for the Natuna Islands. An amphibious group is steaming south for the beaches at Ranai on Natuna Besar: the Type 071 landing ships Wuzhi Shan and Siming Shan, screened by the Type 052D destroyer Hefei ahead and the frigate Huangshan astern. The beaches are 14 nm south-southwest of you (bearing 200). The group was last fixed about 34 nm north of you, making 14 knots. Indonesia has nothing left at sea that can stop it, so it\'s up to Tang. Sink both landing ships. If either gets within 4 nm of the beach, the troops go ashore and the islands are lost. Indonesian F-16s will try a Harpoon strike on the landing ships about an hour in. Their close-in guns stop most anti-ship missiles: torpedoes are surer. Once you hit them, the escorts will come hunting with torpedoes, so shoot from outside 5 nm and go deep.',
  build(g, r) {
    g.startClock = clock(4, 30);
    g.timeLimit = 4 * 3600;
    const beach = mark(g, 'beach', offset(g.own, 200, 14));
    const p = offset(g.own, (r() * 2 - 1) * 15, 32 + r() * 4);
    const lead = add(g, 'type071', 'Wuzhi Shan', 'enemy', p, brg(p, beach), 14, go(brg(p, beach), 14));
    const lpds = [lead, ...screen(g, lead, 'type071', ['Siming Shan'], [[180, 1.5]])];
    const escorts = [...screen(g, lead, 'type052d', ['Hefei'], [[0, 3.5]]), ...screen(g, lead, 'type054a', ['Huangshan'], [[180, 4]])];
    setGoal(g, { targets: ids(lpds), need: 2, win: 'Both landing ships are on the bottom. The invasion of Natuna is off.', timeout: 'The landing group is still afloat off Natuna.' });
    g.script = (gg) => {
      pointDefence(gg, [...escorts, ...lpds], 0.6);
      listen(gg, escorts);
      // Whatever happens to the formation, the landing ships keep making for the beach.
      for (const v of lpds) if (v.alive && v.ai!.mode === 'transit') { v.ai!.baseCourse = brg(v, beach); v.ai!.cruise = 14; }
      at(gg, 3600, 'f16', () => alliedSalvo(gg, 'Indonesian Air Force F-16s', 'Harpoon', 4, lpds, 0.35, 2));
      for (const v of lpds) if (v.alive && dist(v, beach) < 4) end(gg, false, `${v.name} reached the beach at Ranai. The troops are ashore and Natuna is lost.`);
    };
  },
};
extras.P7 = (g, b) => {
  const near = Math.min(...g.vessels.filter((v) => v.cls.key === 'type071' && v.alive).map((v) => dist(v, spot(g, 'beach'))), 99);
  return [...b, watch('Keep both landing ships more than 4 nm from the beach', !!g.over?.reason.includes('ashore'),
    near < 99 ? `The nearest is ${near.toFixed(1)} nm from the beach, bearing 200 and 14 nm from where you started.` : 'None left afloat.')];
};

// ---- P19 Darwin -----------------------------------------------------------------------------------------
missions.P19 = {
  key: 'P19', title: 'Darwin', era: '2029', place: 'Beagle Gulf, off Darwin', date: 'June 2029, 1400',
  library: ['type093b', 'collins', 'type039', 'h6k', 'kq200'],
  brief: 'Australia is all in, and Darwin is where the US Marines\' supplies come ashore. Three ships are alongside at East Arm wharf, 14 nm south of you: USNS Seay, USNS Pililaau and the fuel tanker MT Maersk Peary. A Chinese Type 093B, Changzheng 21, is coming in from the northwest to torpedo them in harbour, and H-6K bombers will come for them too, about 25 and 60 minutes in. Radar at periscope depth sees them high up out to 100 nm; SM-6 brings them down. HMAS Rankin, a Collins-class boat, is guarding the western approach with you: she is a friendly diesel boat, so check every submarine contact before you shoot. Sink the Shang and keep the wharf safe until both raids are over. Lose two of the three ships, or let the Shang get within 6 nm of the wharf, and you have failed. Lose Rankin and you have failed her too.',
  build(g, r) {
    g.startClock = clock(14);
    g.timeLimit = 3 * 3600;
    g.own.hdg = g.own.ordHdg = 300;
    const wharf = mark(g, 'wharf', offset(g.own, 170, 14));
    const moored = (cls: string, name: string, b: number) => add(g, cls, name, 'allied', offset(wharf, b, 0.3), 90, 0, go(90, 0, 1e9));
    const ships = [moored('boxship', 'USNS Seay', 0), moored('boxship', 'USNS Pililaau', 120), moored('tanker', 'MT Maersk Peary', 240)];
    const sp = offset(g.own, 290 + (r() * 2 - 1) * 25, 20 + r() * 5);
    const shang = add(g, 'type093b', 'Changzheng 21', 'enemy', sp, brg(sp, wharf), 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.5 ? 2 : 1);
    // Rankin patrols a line across the western approach.
    const legs = [offset(g.own, 250, 6), offset(g.own, 220, 12)];
    const rankin = add(g, 'collins', 'HMAS Rankin', 'allied', legs[0], 180, 6, undefined, 1);
    setGoal(g, { protect: ids(ships), maxLosses: 1, lossText: 'Two of the ships at East Arm are burning. The Marines\' supplies are gone.',
      timeout: 'The Shang is still out there and Darwin\'s harbour stays shut.' });
    const raids: Raid[] = [];
    const wave = (gg: Game, names: string[]) => raid(gg, raids, offset(wharf, 300 + (gg.r() * 2 - 1) * 30, 140), ships, 'h6k', names, 480);
    g.script = (gg) => {
      keepCourse(shang, brg(shang, wharf), dist(shang, wharf) > 10 ? 9 : 6);
      const leg = legs[Math.floor(gg.t / 1500) % 2];
      steer(rankin, leg, 6);
      skirmish(gg, [rankin], [shang], 4, 0.03, 0.02, 0.5);
      at(gg, 25 * 60, 'raid1', () => wave(gg, ['H-6K flight 1', 'H-6K flight 2', 'H-6K flight 3']));
      at(gg, 60 * 60, 'raid2', () => wave(gg, ['H-6K flight 4', 'H-6K flight 5', 'H-6K flight 6']));
      pressRaids(gg, raids, 4, 0.7, 'YJ-12 missiles');
      if (shang.alive && dist(shang, wharf) < 6) end(gg, false, 'Changzheng 21 got inside 6 nm of the wharf and torpedoed the ships alongside.');
      if (isSunk(rankin)) end(gg, false, 'HMAS Rankin has been sunk.');
      const raidsDone = gg.flags.raid2 && raids.every((x) => x.done);
      if (!shang.alive && raidsDone) end(gg, true, 'The Shang is sunk and the bombers are beaten off. Darwin stays open.');
    };
  },
};
extras.P19 = (g, b) => {
  const sh = g.vessels.find((v) => v.name === 'Changzheng 21');
  const rk = g.vessels.find((v) => v.name === 'HMAS Rankin');
  const raids = g.vessels.filter((v) => v.cls.key === 'h6k');
  return [
    { text: 'Sink the Type 093B, Changzheng 21', state: sh && isSunk(sh) ? 'done' : 'open', detail: sh && isSunk(sh) ? 'Sunk.' : 'Coming in from the northwest. HMAS Rankin is a friendly sub: check before you shoot.' },
    { text: 'Beat off both H-6K raids', state: flag(g, 'raid2') && raids.every(isSunk) ? 'done' : 'open',
      detail: `${raids.filter(isSunk).length} of ${raids.length} bombers shot down${raids.some((v) => v.gone) ? `, ${raids.filter((v) => v.gone).length} got through` : ''}. ${g.t < 25 * 60 ? 'First raid due about 25 minutes in.' : g.t < 60 * 60 ? 'Second raid due about 60 minutes in.' : 'Both raids launched.'}` },
    watch('Keep the Shang more than 6 nm from the wharf', !!g.over?.reason.includes('inside 6 nm')),
    watch('Keep HMAS Rankin afloat', !!rk && isSunk(rk)),
    ...b,
  ];
};

// ---- P20 Lombok Strait -------------------------------------------------------------------------------------
missions.P20 = {
  key: 'P20', title: 'Lombok Strait', era: '2029', place: 'Lombok Strait, Indonesia', date: 'June 2029, 2300', night: true,
  library: ['type039', 'type093b', 'kilo', 'collins'],
  brief: 'Malacca and Sunda are too shallow for a submarine to pass unseen, so China\'s boats go to the Indian Ocean through Lombok, between Bali and Lombok: deep, narrow, and swept by the Indonesian Throughflow, a current that sets south at more than a knot and carries everything with it, Tang included. Three Type 039 Yuan AIP boats are coming down the strait from the north, several miles apart, to hunt Allied shipping off Australia. They are about as quiet as a submarine gets, but slow and short of hearing. Sink two of the three. If two of them get past you and out of the south end of the strait, about 16 nm south of you, the cork has failed. Any of them that hears you will fight. They are hard to hear even close aboard, but there are no friendly submarines in the strait: an active ping finds anything within several miles, at the price of telling every Yuan where you are.',
  build(g, r) {
    g.startClock = clock(23);
    g.timeLimit = 5 * 3600;
    g.own.hdg = g.own.ordHdg = 0;
    const names = ['Yuan (Changcheng 335)', 'Yuan (Changcheng 337)', 'Yuan (Changcheng 341)'];
    const boats = names.map((name, i) => {
      const p = { x: (r() * 2 - 1) * 4, y: 15 + i * 10 + r() * 3 };
      const exit = { x: (r() * 2 - 1) * 4, y: -16 };
      return { v: add(g, 'type039', name, 'enemy', p, brg(p, exit), 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.6 ? 2 : 1), exit };
    });
    setGoal(g, { targets: boats.map((b) => b.v.id), need: 2, win: 'Two of the Yuans are on the bottom of Lombok Strait. The Indian Ocean stays closed to them.', timeout: 'The Yuans waited us out in the strait.' });
    g.flags.through = 0;
    g.script = (gg) => {
      // The Throughflow carries everyone in the water south.
      for (const v of gg.vessels) if (v.alive && v.cls.kind !== 'air') v.y -= 1.2 * KT;
      for (const b of boats) keepCourse(b.v, brg(b.v, b.exit), 8);
      for (const b of boats) if (arrive(gg, b.v, b.exit, 2.5) || (b.v.alive && b.v.y < b.exit.y)) {
        b.v.alive = false; b.v.gone = true;
        gg.flags.through++;
        log(gg, 'danger', `${b.v.name} is out of the south end of the strait and into the Indian Ocean.`);
      }
      if (gg.flags.through >= 2) end(gg, false, 'Two Yuans got through Lombok Strait into the Indian Ocean.');
    };
  },
};
extras.P20 = (g, b) => [...b, watch('Don\'t let two Yuans out of the south end of the strait', flag(g, 'through') >= 2, `${flag(g, 'through')} of 2 have got through. The exit is about 16 nm south of where you started.`)];

// ---- P8 Carrier Killer: the fleet comes out ------------------------------------------------------------------
missions.P8 = {
  key: 'P8', title: 'Carrier Killer', era: '2029', place: 'Philippine Sea', date: 'July 2029, 0600',
  library: ['fujian', 'shandong', 'type055', 'type052d', 'type054a', 'type901', 'type093b', 'kq200', 'ka28'],
  brief: 'The carrier Fujian is out in the Philippine Sea with her full screen, steaming east toward Guam at 16 knots. She was fixed about 32 nm west of you this morning, coming your way. Around her: the Type 055 cruisers Nanchang and Lhasa, the Type 052D destroyers Taiyuan and Guiyang, the frigate Rizhao and the supply ship Hulunhu. The Type 093B Changzheng 18 sweeps ahead of the group, out on one bow, and a Ka-28 helicopter flies close in. Get inside the screen and sink Fujian. The cruisers\' and the carrier\'s close-in defences stop almost every anti-ship missile, so this is torpedo work, and it takes three Mk 48s to sink her. If she gets more than 50 nm away from you, she\'s gone.',
  build(g, r) {
    g.startClock = clock(6);
    g.timeLimit = 3.5 * 3600;
    g.own.hdg = g.own.ordHdg = 270;
    const course = 90 + (r() * 2 - 1) * 10;
    const p = offset(g.own, 270 + (r() * 2 - 1) * 12, 30 + r() * 4);
    const cv = add(g, 'fujian', 'Fujian', 'enemy', p, course, 16, go(course, 16));
    const scr = [
      ...screen(g, cv, 'type055', ['Nanchang', 'Lhasa'], [[0, 4], [180, 4]]),
      ...screen(g, cv, 'type052d', ['Taiyuan', 'Guiyang'], [[60, 3.5], [300, 3.5]]),
      ...screen(g, cv, 'type054a', ['Rizhao'], [[120, 4]]),
      ...screen(g, cv, 'type901', ['Hulunhu'], [[220, 2]]),
    ];
    const side = r() < 0.5 ? 1 : -1;
    const ssn = add(g, 'type093b', 'Changzheng 18', 'enemy', offset(cv, course + side * 35, 10), course, 8, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
    const helo = add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(cv, r() * 360, 3), 0, 120, wander({ x: cv.x, y: cv.y }, 8, 120));
    setGoal(g, { targets: [cv.id], need: 1, win: 'Fujian is sinking. China\'s newest carrier is out of the war.', timeout: 'Fujian steamed on out of reach.' });
    g.script = (gg) => {
      pointDefence(gg, [cv, ...scr], 0.8);
      listen(gg, scr);
      // The 093B sweeps a station ahead and out on one bow of the carrier.
      const sta = offset(cv, course + side * 35, 10);
      keepCourse(ssn, dist(ssn, sta) > 3 ? brg(ssn, sta) : course + Math.sin(gg.t / 600) * 40, dist(ssn, sta) > 3 ? 12 : 8);
      helo.ai!.center = { x: cv.x, y: cv.y };
      if (cv.alive && dist(gg.own, cv) > 50) end(gg, false, 'Fujian is more than 50 nm away and still going. We have lost her.');
    };
  },
};
extras.P8 = (g, b) => {
  const cv = named(g, 'fujian');
  return [...b,
    { text: 'Hits on Fujian', state: cv && isSunk(cv) ? 'done' : 'open', detail: cv ? `${Math.max(0, 14 - cv.hp)} of 14 damage points. Each Mk 48 hit is 5.` : '' },
    watch('Don\'t let her get 50 nm away', !!g.over?.reason.includes('lost her'), cv?.alive ? `${dist(g.own, cv).toFixed(0)} nm away now.` : undefined)];
};

// ---- P21 Shandong -----------------------------------------------------------------------------------------
missions.P21 = {
  key: 'P21', title: 'Shandong', era: '2029', place: 'West of Luzon', date: 'July 2029, 2200', night: true,
  library: ['shandong', 'fujian', 'type055', 'type052d', 'type054a', 'type039', 'tanker', 'ka28'],
  brief: 'The carrier Shandong is flying night strikes against Luzon from the South China Sea, about 22 nm west-southwest of you. To launch and recover she has to steam into the wind, so she is running a racetrack, north for 40 minutes, then south, at 20 knots. Her screen: the Type 055 Yan\'an, the Type 052D destroyers Xining and Zibo, and the frigate Yulin, with a Ka-28 overhead and a Type 039 Yuan lying in wait somewhere ahead of her. Sink her, or put enough into her to cripple her: two Mk 48 hits will end her flying. A neutral crude tanker, MT Pacific Aurora, is crossing the area northbound: a carrier and a tanker both sound big and slow, so identify before you fire. Sinking her fails the mission. Three hours, then the strikes on Luzon will have done their work.',
  build(g, r) {
    g.startClock = clock(22);
    g.timeLimit = 3 * 3600;
    g.own.hdg = g.own.ordHdg = 250;
    const p = offset(g.own, 245 + (r() * 2 - 1) * 15, 20 + r() * 4);
    const north = r() < 0.5;
    const cv = add(g, 'shandong', 'Shandong', 'enemy', p, north ? 15 : 195, 20, go(north ? 15 : 195, 20));
    const scr = [
      ...screen(g, cv, 'type055', ['Yan\'an'], [[0, 3.5]]),
      ...screen(g, cv, 'type052d', ['Xining', 'Zibo'], [[90, 3], [270, 3]]),
      ...screen(g, cv, 'type054a', ['Yulin'], [[180, 3.5]]),
    ];
    // The Yuan waits on the line between the carrier and Luzon: between her and us.
    add(g, 'type039', 'Yuan (Changcheng 330)', 'enemy', offset(cv, brg(cv, g.own) + (r() * 2 - 1) * 30, 7 + r() * 3), r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1);
    const helo = add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(cv, r() * 360, 3), 0, 120, wander({ x: cv.x, y: cv.y }, 7, 120));
    const tp = offset(g.own, 200 + (r() * 2 - 1) * 20, 14 + r() * 4);
    add(g, 'tanker', 'MT Pacific Aurora', 'allied', tp, 10, 12, go(10, 12));
    setGoal(g, { targets: [cv.id], need: 1, win: 'Shandong is sinking. The night strikes on Luzon are over.', timeout: 'Shandong\'s air wing flew all night. Luzon took the strikes.' });
    g.script = (gg) => {
      pointDefence(gg, [cv, ...scr], 0.7);
      listen(gg, scr);
      // The racetrack: into the wind for 40 minutes, then back.
      if (cv.alive && cv.ai!.mode === 'transit') cv.ai!.baseCourse = Math.floor(gg.t / 2400) % 2 === (north ? 0 : 1) ? 15 : 195;
      helo.ai!.center = { x: cv.x, y: cv.y };
      if (cv.alive && cv.hp <= 4) end(gg, true, 'Shandong is listing and burning. Her flight deck is out of action: crippled, and out of the war for months.');
    };
  },
};
extras.P21 = (g, b) => {
  const cv = named(g, 'shandong');
  const tk = g.vessels.find((v) => v.name === 'MT Pacific Aurora');
  return [
    { text: 'Sink or cripple Shandong', state: g.over?.win ? 'done' : 'open', detail: cv ? `${Math.max(0, 12 - cv.hp)} of 8 damage points needed to cripple her. Each Mk 48 hit is 5.` : '' },
    watch('Don\'t sink the neutral tanker MT Pacific Aurora', !!tk && isSunk(tk)),
    ...b.filter((o) => !o.text.startsWith('Sink')),
  ];
};

// ---- P22 Second Island Chain ---------------------------------------------------------------------------------
missions.P22 = {
  key: 'P22', title: 'Second Island Chain', era: '2029', place: 'Off Palau', date: 'July 2029, 0900',
  library: ['type075', 'type071', 'type055', 'type052d', 'type054a', 'type093b', 'kq200'],
  brief: 'China is reaching for the second island chain. A landing group is bound for Babeldaob in Palau, whose beaches are about 16 nm east-southeast of you (bearing 110): the Type 075 assault ship Guangxi with the helicopters and the first wave, the Type 071 Qilian Shan behind her, the Type 055 Wuxi and the Type 052D Hohhot. It was about 40 nm northwest of you an hour ago, making 15 knots. A US P-8A is shadowing it from far out and will pass you its position every 20 minutes. When Guangxi gets within 12 nm of the beach she stops to launch her helicopters and landing craft; after 40 minutes of that, Palau has fallen. Sink Guangxi before then. A KQ-200 is covering the group, and a Type 093B, Changzheng 14, sweeps ahead of it. Their escorts shoot down most missiles.',
  build(g, r) {
    g.startClock = clock(9);
    g.timeLimit = 4 * 3600;
    g.own.hdg = g.own.ordHdg = 320;
    const beach = mark(g, 'beach', offset(g.own, 110, 16));
    const p = offset(g.own, 320 + (r() * 2 - 1) * 15, 38 + r() * 4);
    const lhd = add(g, 'type075', 'Guangxi', 'enemy', p, brg(p, beach), 15, go(brg(p, beach), 15));
    const scr = [
      ...screen(g, lhd, 'type071', ['Qilian Shan'], [[180, 2]]),
      ...screen(g, lhd, 'type055', ['Wuxi'], [[0, 4]]),
      ...screen(g, lhd, 'type052d', ['Hohhot'], [[100, 3.5]]),
      ...screen(g, lhd, 'type054a', ['Huangshi'], [[260, 3.5]]),
    ];
    add(g, 'kq200', 'KQ-200', 'enemy', offset(lhd, r() * 360, 40), 0, 230, patrolPlane({ x: lhd.x, y: lhd.y }));
    const ssn = add(g, 'type093b', 'Changzheng 14', 'enemy', offset(lhd, lhd.hdg, 8), lhd.hdg, 8, { mode: 'patrol', legT: 600, decoys: 2 }, 1);
    setGoal(g, { targets: [lhd.id], need: 1, win: 'Guangxi is sinking with the first wave aboard. The landing on Palau is off.', timeout: 'The landing group is still off Palau.' });
    g.flags.landing = 0;
    g.script = (gg) => {
      pointDefence(gg, [lhd, ...scr], 0.75);
      listen(gg, scr);
      if (lhd.alive) keepCourse(ssn, brg(ssn, offset(lhd, lhd.hdg + Math.sin(gg.t / 600) * 50, 8)), 9);
      for (const v of gg.vessels) if (v.cls.key === 'kq200' && v.ai?.mode === 'search') v.ai.center = { x: lhd.x, y: lhd.y };
      if (!lhd.alive) return;
      if (gg.t % 1200 === 0) log(gg, 'info', `P-8A: the landing group is bearing ${fmtBrg(brg(gg.own, lhd))}, ${dist(gg.own, lhd).toFixed(0)} nm from you, course ${fmtBrg(lhd.hdg)}.`);
      if (lhd.ai!.mode === 'transit') { lhd.ai!.baseCourse = brg(lhd, beach); lhd.ai!.cruise = dist(lhd, beach) < 12 ? 0 : 15; lhd.ai!.zig = 0; }
      if (dist(lhd, beach) < 12.5) {
        if (!gg.flags.landing) log(gg, 'danger', 'P-8A: Guangxi has stopped 12 nm off Babeldaob. Helicopters lifting off; landing craft in the water. 40 minutes and they are ashore.', 'alarm');
        gg.flags.landing++;
        if (gg.flags.landing === 1200) log(gg, 'warn', 'P-8A: the first landing craft are halfway to the beach. 20 minutes left.');
        if (gg.flags.landing >= 2400) end(gg, false, 'The first wave is ashore on Babeldaob. Palau has fallen.');
      }
    };
  },
};
extras.P22 = (g, b) => {
  const l = flag(g, 'landing');
  const lhd = named(g, 'type075');
  return [...b, watch('Stop Guangxi before she lands her troops', l >= 2400,
    l ? `Landing under way: ${mins(2400 - l)} until the first wave is ashore.` : lhd?.alive ? `She is ${Math.max(0, dist(lhd, spot(g, 'beach')) - 12).toFixed(0)} nm short of her launch point, 12 nm off the beach.` : undefined)];
};

// ---- P9 Hainan Bastion (hub) -----------------------------------------------------------------------------------
missions.P9 = {
  key: 'P9', title: 'Hainan Bastion', era: '2029', place: 'Off Yulin, Hainan', date: 'August 2029, 0200', night: true,
  library: ['type094', 'type093b', 'type056', 'type052d', 'kq200', 'type039'],
  brief: 'Yulin, on Hainan\'s southern tip, is home to China\'s missile submarines. Their pens are cut into the hillside, and the Type 094 Jins come out of the tunnels into a deep hole just off the harbour to wait for orders. Tonight three of them are coming out. Find them. The harbour mouth is 22 nm north of you. A mine barrier crosses the approach 10 nm north of you; intelligence has a swept gap about 2 nm wide in it, centred 10 nm out on bearing 011. Go through slowly: the HF sonar finds mines at 10 knots or less. Inside, the Type 056 corvette Datong and the Type 093B Changzheng 16 guard the hole, and the corvette Huizhou patrols off the harbour mouth. To tag a Jin, hold it on sonar, classify it as a Type 094, and keep a good solution on it within 10 nm for two minutes. Tag two of the three, then come to periscope depth and send the report. Do not sink a Jin: an attack on China\'s deterrent at its home base would push the war toward the nuclear line. If Yulin hears shooting, it will send more corvettes and a KQ-200 patrol plane from Lingshui, whose sonobuoys and torpedoes are deadly: shoot it down with JATM if it comes. One will come over on its dawn patrol at about 0340 anyway. You have four hours.',
  build(g, r) {
    g.startClock = clock(2);
    g.timeLimit = 4 * 3600;
    g.own.hdg = g.own.ordHdg = 0;
    const mouth = mark(g, 'mouth', { x: 0, y: 22 });
    // The barrier, with the swept gap the Jins use.
    mineLine(g, { x: -10, y: 10 }, { x: 0.9, y: 10.2 }, 22);
    mineLine(g, { x: 3.1, y: 9.8 }, { x: 13, y: 10 }, 20);
    for (const [x, y, name] of [[(r() * 2 - 1) * 5, 15, 'Datong'], [4 + r() * 3, 19.5, 'Huizhou']] as const)
      add(g, 'type056', name, 'enemy', { x, y }, r() * 360, 6, { mode: 'patrol', legT: 400 });
    add(g, 'type093b', 'Changzheng 16', 'enemy', { x: (r() * 2 - 1) * 5, y: 17 + r() * 3 }, r() * 360, 6, { mode: 'patrol', legT: 500, decoys: 2 }, 2);
    const holds: Vec[] = [{ x: -5 + r() * 2, y: 16 + r() * 2 }, { x: 1 + r() * 2, y: 13 + r() * 2 }, { x: 5 + r() * 2, y: 17 + r() * 2 }].sort(() => r() - 0.5);
    const jins: { v: Vessel | null; hold: Vec }[] = holds.map((hold) => ({ v: null, hold }));
    setGoal(g, { targets: [], timeout: 'Dawn over Yulin. We never got the Jins pinned down.' });
    g.script = (gg) => {
      ['Changzheng 10', 'Changzheng 11', 'Changzheng 20'].forEach((name, i) => at(gg, (10 + i * 25) * 60, `sortie${i}`, () => {
        jins[i].v = add(gg, 'type094', name, 'enemy', offset(mouth, 180, 0.5), 180, 6, { mode: 'raider', goal: jins[i].hold, cruise: 6, decoys: 1 }, 1);
        log(gg, 'info', `Intelligence: a Jin is leaving the tunnels at Yulin (${i + 1} of 3). It will make for the deep hole south of the harbour.`);
      }));
      let tagged = 0;
      jins.forEach((j, i) => {
        const v = j.v;
        if (!v) return;
        // Waiting in the hole: slow circles round its holding point.
        if (v.alive) v.ai!.goal = dist(v, j.hold) < 1.5 ? offset(j.hold, (gg.t / 8) % 360, 1.2) : j.hold;
        if (v.alive) v.ai!.cruise = dist(v, j.hold) < 1.5 ? 4 : 6;
        const k = `tag${i}`;
        const c = gg.contacts.find((x) => x.vid === v.id);
        if (v.alive && (gg.flags[k] ?? 0) < 120 && c?.held && c.classified === 'type094' && c.q >= 0.6 && dist(gg.own, v) < 10) {
          gg.flags[k] = (gg.flags[k] ?? 0) + 1;
          if (gg.flags[k] === 120) log(gg, 'good', `XO: ${c.name} is tagged: a Type 094, track and position logged.`);
        }
        if ((gg.flags[k] ?? 0) >= 120) tagged++;
        if (isSunk(v)) end(gg, false, `We sank ${v.name}, a missile submarine, at her home base. Beijing calls it a first strike, and the war has moved toward the nuclear line.`);
      });
      const possible = tagged + jins.filter((j, i) => (!j.v || j.v.alive) && (gg.flags[`tag${i}`] ?? 0) < 120).length;
      gg.flags.tagged = tagged;
      if (possible < 2) end(gg, false, 'Too few Jins left to tag. The mission is a failure.');
      if (tagged >= 2 && !gg.flags.ready) { gg.flags.ready = 1; log(gg, 'good', 'XO: two Jins tagged. Come to periscope depth and send the report.'); }
      if (gg.flags.ready && atPeriscopeDepth(gg)) end(gg, true, 'The report is out: the Jins\' hole off Yulin is mapped and two of them are tagged. Every one of them can be held at risk now.');
      // The dawn patrol: a KQ-200 comes over the hole at 0340 whatever happens.
      at(gg, 100 * 60, 'kqPatrol', () => { if (!gg.flags.kq) { gg.flags.kq = 1; add(gg, 'kq200', 'KQ-200', 'enemy', offset(mouth, 60, 45), 240, 230, patrolPlane({ x: 0, y: 16 })); log(gg, 'warn', 'ESM: a KQ-200 has taken off from Lingshui. Its radar will be over the hole within minutes.'); } });
      // Our shooting wakes up the base.
      if (firedAny(gg) && !gg.flags.alarm) {
        gg.flags.alarm = 1;
        log(gg, 'danger', 'Yulin has sounded the alarm. Two more corvettes are coming out of the harbour, and a KQ-200 is taking off from Lingshui.', 'alarm');
        if (!gg.flags.kq) { gg.flags.kq = 1; add(gg, 'kq200', 'KQ-200', 'enemy', offset(mouth, 60, 45), 240, 230, patrolPlane({ x: gg.own.x, y: gg.own.y })); }
        for (const name of ['Qinzhou', 'Sanmenxia']) {
          const v = add(gg, 'type056', name, 'enemy', offset(mouth, 180 + (gg.r() * 2 - 1) * 20, 1), 180, 14, { mode: 'attack', legT: 300 });
          v.ai!.knows = { x: gg.own.x + (gg.r() * 2 - 1) * 2, y: gg.own.y + (gg.r() * 2 - 1) * 2, t: gg.t, deep: gg.own.depthT > 1.5 };
        }
      }
    };
  },
};
extras.P9 = (g) => {
  const jins = g.vessels.filter((v) => v.cls.key === 'type094');
  const tags = [0, 1, 2].map((i) => flag(g, `tag${i}`));
  return [
    { text: 'Tag two of the three Jins', state: flag(g, 'tagged') >= 2 ? 'done' : g.over && !g.over.win ? 'failed' : 'open',
      detail: [`${flag(g, 'tagged')} of 2 tagged. ${jins.length} of 3 out of the tunnels.`, ...tags.filter((t) => t > 0 && t < 120).map((t) => `One is ${Math.round((t / 120) * 100)}% tagged.`),
        'Hold it, classify it Type 094, keep a good solution within 10 nm for 2 minutes.'].join(' ') },
    { text: 'Come to periscope depth and send the report', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'ready') ? 'Ready: come up now.' : 'After two tags.' },
    watch('Don\'t sink a Jin', jins.some(isSunk)),
    { text: 'Get through the mine barrier by the swept gap', state: g.own.y > 10.5 ? 'done' : 'open', detail: 'About 2 nm wide, 10 nm out on bearing 011 from where you started.' },
    ...baseObjectives(g),
  ];
};

// ---- P10 Malacca Plug: after Hainan ------------------------------------------------------------------------------
missions.P10 = {
  key: 'P10', title: 'Malacca Plug', era: '2029', place: 'Strait of Malacca', date: 'August 2029, 1100',
  library: ['tanker', 'lng', 'boxship', 'type052d', 'type054a', 'ka28'],
  brief: 'Most of China\'s oil still comes through the Strait of Malacca, and Beijing is now running it in escorted convoys. One is coming down the strait toward Singapore: four Chinese-flagged crude tankers, Yuan Chen Hu, Yuan Ping Hu, Kai Yuan Yang and Xin Shun Yang, led by the Type 052D Changsha with the frigates Xiangtan and Zhoushan. It is about 23 nm northwest of you, making 15 knots on course 135, with a Ka-28 flying over it. It keeps to the far side of the traffic lanes: its track will pass 9 to 13 nm from you, so you will have to go to it. Sink three of the four tankers before they clear the strait, about 34 nm on from where the convoy is now; if two get through, the plug has failed. The strait is full of neutral traffic: Qatari LNG carriers bound for Japan, and container ships. They are not targets. Sinking a neutral ends the mission. Chinese jamming over the strait blocks the anti-ship Tomahawk\'s satellite updates, so it is NSMs and torpedoes, and the escorts\' guns stop most NSMs.',
  build(g, r) {
    g.startClock = clock(11);
    g.timeLimit = 3.5 * 3600;
    g.own.hdg = g.own.ordHdg = 315;
    const course = 135;
    // The convoy keeps to the far side of the traffic lanes: its track passes 9 to 13 nm from Tang.
    const p = offset(offset(g.own, r() < 0.5 ? 45 : 225, 9 + r() * 4), 315, 20 + r() * 3);
    const exit = mark(g, 'exit', offset(p, course, 34));
    const lead = add(g, 'type052d', 'Changsha', 'enemy', p, course, 15, go(course, 15));
    const tankers = screen(g, lead, 'tanker', ['Yuan Chen Hu', 'Yuan Ping Hu', 'Kai Yuan Yang', 'Xin Shun Yang'], [[180, 1.5], [180, 3], [180, 4.5], [180, 6]]);
    const escorts = [lead, ...screen(g, lead, 'type054a', ['Xiangtan', 'Zhoushan'], [[150, 4], [210, 5]])];
    // Neutral traffic in both lanes.
    add(g, 'lng', 'Al Ghariya', 'allied', offset(g.own, 130 + r() * 30, 10 + r() * 6), 315, 15, go(315, 15));
    add(g, 'lng', 'Mekaines', 'allied', offset(g.own, 340 + r() * 40, 6 + r() * 5), 315, 15, go(315, 15));
    add(g, 'boxship', 'Maersk Kendal', 'allied', offset(p, 90 + r() * 40, 4 + r() * 4), course, 16, go(course, 16));
    const helo = add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(lead, 180, 3), course, 120, wander({ x: lead.x, y: lead.y }, 6, 120));
    g.flags.jammed = 1;
    setGoal(g, { targets: ids(tankers), need: 3, win: 'Three of the four tankers are burning in the strait. Beijing\'s oil isn\'t getting through Malacca.', timeout: 'The convoy is through the strait.' });
    g.flags.through = 0;
    g.script = (gg) => {
      pointDefence(gg, escorts, 0.7);
      listen(gg, escorts.slice(1));
      helo.ai!.center = { x: lead.x, y: lead.y };
      for (const v of tankers) if (v.alive && v.ai!.mode !== 'station') { v.ai!.baseCourse = brg(v, exit); v.ai!.cruise = 15; }
      for (const v of tankers) if (arrive(gg, v, exit, 3)) { gg.flags.through++; log(gg, 'danger', `${v.name} has cleared the strait.`); }
      if (gg.flags.through >= 2) end(gg, false, 'Two tankers cleared the strait. China\'s oil is getting through.');
      const n = gg.sunk.find((s) => s.side === 'allied' && s.by === 'us');
      if (n) end(gg, false, `We sank the neutral ${n.name}. Every navy in Asia is on Beijing's side of the story now.`);
    };
  },
};
extras.P10 = (g, b) => [...b,
  watch('Don\'t let two tankers clear the strait', flag(g, 'through') >= 2, `${flag(g, 'through')} of 2 through.`),
  watch('Don\'t sink the neutral LNG carriers or container ships', g.sunk.some((s) => s.side === 'allied' && s.by === 'us'))];

// ---- P11 Kazan Returns ---------------------------------------------------------------------------------------------
missions.P11 = {
  key: 'P11', title: 'Kazan Returns', era: '2029', place: 'Bussol Strait, off the Kurils', date: 'August 2029, 0500',
  library: ['yasen', 'akula', 'kilo', 'virginia', 'il38'],
  brief: 'Kazan (K-561) is back. Your old rival has moved to the Pacific Fleet and is lying in the Bussol Strait in the middle of the Kurils, killing anything that tries to cross. Round two: find her and sink her. She is somewhere ahead of you, 10 to 16 nm out. The Oyashio fog and a heavy swell (sea state 4) mean noise for everyone and a short periscope range. An Il-38 is working the strait for her. She also carries mobile decoys built to sound exactly like a Yasen: when she is pressed she lets one run on at speed down her old course and slips away slow and quiet. A decoy runs straight and dies after about 15 minutes; Kazan turns and creeps. You have three and a half hours.',
  build(g, r) {
    g.startClock = clock(5);
    g.timeLimit = 3.5 * 3600;
    g.env.sea = 4;
    g.own.hdg = g.own.ordHdg = 0;
    const b = (r() * 2 - 1) * 50;
    const kp = offset(g.own, b, 10 + r() * 6);
    const kaz = add(g, 'yasen', 'Kazan (K-561)', 'enemy', kp, norm(b + 180 + (r() * 2 - 1) * 60), 6, { mode: 'patrol', legT: 400, decoys: 3 }, 2);
    add(g, 'il38', 'Il-38N May', 'enemy', offset(kp, r() * 360, 60), 0, 230, patrolPlane({ x: kp.x, y: kp.y }));
    setGoal(g, { targets: [kaz.id], need: 1, win: 'Kazan is on the bottom of the Bussol Strait. Round two to Tang.', timeout: 'Kazan slipped away into the Sea of Okhotsk. Round two is a draw at best.' });
    const decoys: { v: Vessel; t: number }[] = [];
    g.flags.decoys = 0;
    g.script = (gg) => {
      for (const d of decoys) if (d.v.alive && gg.t - d.t > 900) { d.v.alive = false; d.v.gone = true; }
      if (!kaz.alive) return;
      // She holds the narrows: never far from her station.
      if (dist(kaz, kp) > 5) keepCourse(kaz, brg(kaz, kp), 6);
      const pressed = kaz.ai!.mode === 'evade' || (kaz.ai!.mode === 'attack' && kaz.ai!.holdT > 90);
      if (pressed && gg.flags.decoys < 4 && gg.t - flag(gg, 'decoyT') > 600) {
        gg.flags.decoys++; gg.flags.decoyT = gg.t;
        const d = add(gg, 'yasen', 'Brosok decoy', 'enemy', { x: kaz.x, y: kaz.y }, kaz.hdg, 12, undefined, kaz.depthT > 1.5 ? 2 : 1);
        d.hp = 1;
        decoys.push({ v: d, t: gg.t });
        // Kazan herself goes quiet: a hard turn, slow, across the layer.
        Object.assign(kaz.ai!, { mode: 'patrol', legT: 480, holdT: 0, knows: null });
        kaz.ordHdg = norm(kaz.hdg + (gg.r() < 0.5 ? 110 : -110)); kaz.ordSpd = 4; kaz.ordDepth = kaz.depthT > 1.5 ? 1 : 2;
      }
    };
  },
};
extras.P11 = (g, b) => [...b, { text: 'Kazan\'s decoys', state: 'open', detail: `${flag(g, 'decoys')} launched so far. A decoy runs straight and fast; Kazan turns and creeps.` }];

// ---- P23 Jin Breakout ---------------------------------------------------------------------------------------------
missions.P23 = {
  key: 'P23', title: 'Jin Breakout', era: '2029', place: 'South China Sea', date: 'August 2029, 0100', night: true,
  library: ['type094', 'type093b', 'type054a', 'type039', 'ka28', 'kq200'],
  brief: 'A Type 094 Jin, Changzheng 19, has left the Hainan bastion and is running east across the South China Sea for the Bashi Channel and the deep Pacific, where her missiles can reach the United States. A P-8A fixed her about 33 nm west of you at midnight, making 14 knots on an easterly course that will take her well clear of you, 22 to 27 nm to the north or south at her closest: you will have to run to catch her. Her escort sweeps ahead: the Type 093B Changzheng 15 delousing her track, the frigate Hengshui riding ahead of her, a Ka-28 overhead and a KQ-200 laying sonobuoys along her track. Sink the Jin before she gets about 32 nm on from where she was fixed: past that, the water is too deep and wide to find her again. The Jin is loud; her escort is not. At the first sign of an attack she will run at over 20 knots, so make your first shot count.',
  build(g, r) {
    g.startClock = clock(1);
    g.timeLimit = 4 * 3600;
    g.own.hdg = g.own.ordHdg = 270;
    const p = offset(g.own, 270 + (r() * 2 - 1) * 15, 31 + r() * 4);
    const out = mark(g, 'out', offset(p, brg(p, g.own) + (r() < 0.5 ? 1 : -1) * (45 + r() * 12), 32));
    const jin = add(g, 'type094', 'Changzheng 19', 'enemy', p, brg(p, out), 14, { mode: 'raider', goal: out, cruise: 14, decoys: 2 }, 1);
    const ssn = add(g, 'type093b', 'Changzheng 15', 'enemy', offset(jin, jin.hdg, 6), jin.hdg, 10, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
    const ff = add(g, 'type054a', 'Hengshui', 'enemy', offset(jin, jin.hdg + 30, 4), jin.hdg, 14, { mode: 'station', leader: jin.id, rel: 30, rng: 4 });
    const helo = add(g, 'ka28', 'Ka-28 Helix', 'enemy', offset(jin, r() * 360, 5), 0, 120, wander({ x: jin.x, y: jin.y }, 8, 120));
    const kq = add(g, 'kq200', 'KQ-200', 'enemy', offset(jin, r() * 360, 30), 0, 230, patrolPlane({ x: jin.x, y: jin.y }));
    setGoal(g, { targets: [jin.id], need: 1, win: 'Changzheng 19 is sinking. Her missiles will never reach the deep Pacific.', timeout: 'Changzheng 19 is out in the Pacific.' });
    g.script = (gg) => {
      helo.ai!.center = { x: jin.x, y: jin.y };
      if (kq.ai?.mode === 'search') kq.ai.center = offset(jin, jin.hdg, 8);
      // The 093B weaves ahead of the Jin, clearing her track.
      if (jin.alive) keepCourse(ssn, brg(ssn, offset(jin, jin.hdg + Math.sin(gg.t / 500) * 40, 6)), 15);
      listen(gg, [ff]);
      // At the first sign of an attack she runs for it at full speed.
      if (jin.alive && !gg.flags.bolt && (firedAny(gg) || jin.hp < jin.cls.hp)) {
        gg.flags.bolt = 1; jin.ai!.cruise = 21;
        log(gg, 'warn', 'Sonar: the Jin\'s propeller noise is climbing fast. She has heard us and is running at full speed.');
      }
      if (arrive(gg, jin, out, 2)) end(gg, false, 'Changzheng 19 has reached the deep water past the Bashi Channel. We have lost her.');
    };
  },
};
extras.P23 = (g, b) => {
  const jin = named(g, 'type094');
  return [...b, watch('Catch her before she reaches deep water', !!g.over?.reason.includes('deep water'), jin?.alive ? `She has about ${dist(jin, spot(g, 'out')).toFixed(0)} nm to go.` : undefined)];
};

// ---- P24 Downed Pilots ----------------------------------------------------------------------------------------------
missions.P24 = {
  key: 'P24', title: 'Downed Pilots', era: '2029', place: 'Philippine Sea', date: 'August 2029, 1530',
  library: ['ka28', 'kq200', 'type054a', 'type052d', 'type056'],
  brief: 'An EA-18G Growler from USS Gerald R. Ford went down an hour ago. Both crew, Lieutenant Commander Dana Ruiz and Lieutenant Sam Okafor, are alive in a raft 15 nm from you on bearing 065. China heard the Mayday too: the frigate Rizhao and the destroyer Taiyuan are coming at 25 knots from beyond the raft, about 40 nm out, and each is sending its Ka-28 helicopter ahead to search. The destroyer Guiyang, further off, may send a third. If a helicopter finds the raft it will hover over it and hoist them up, which takes 5 minutes; if a ship reaches it, they are prisoners. Get there first: come to periscope depth within about 600 yards of the raft at 4 knots or less, and hold there for 3 minutes while they swim to the sail and come aboard through the lock-out trunk. Then get at least 8 nm clear of the raft\'s position before the ships catch you. The raft is marked on your plot from their Mayday, with a ring showing the 600-yard pickup zone; their beacon confirms the fix once you are within 6 nm at periscope depth, or a Blackwing can spot it from 3 nm. Radar and sonar will not show a raft. Radar at periscope depth sees helicopters; a JATM brings one down. A KQ-200 patrol plane is on its way to cover the search, about 40 minutes out: it will see masts on its radar. Mind the ships\' sonar on the way out.',
  build(g, r) {
    g.startClock = clock(15, 30);
    g.timeLimit = 3 * 3600;
    const rb = 65;
    const raft = mark(g, 'raft', offset(g.own, rb, 15));
    g.flags.raftBrg = rb;
    // The Mayday gave the raft's position, so it is on the plot from the start, with the pickup ring.
    const raftMark = { ...raft, label: 'Raft (Mayday position)', r: 0.3 };
    g.marks = [raftMark];
    g.own.hdg = g.own.ordHdg = rb;
    const ship = (cls: string, name: string, b: number, d: number) => {
      const p = offset(raft, b, d);
      return add(g, cls, name, 'enemy', p, brg(p, raft), 25, { mode: 'patrol', legT: 1e9 });
    };
    const ships = [ship('type054a', 'Rizhao', rb + (r() * 2 - 1) * 30, 38 + r() * 4), ship('type052d', 'Taiyuan', rb + (r() < 0.5 ? 45 : -45), 42 + r() * 4)];
    interface Helo { v: Vessel; guess: Vec; phase: 'out' | 'search' | 'hoist'; k: number; t: number }
    const helos: Helo[] = [];
    setGoal(g, { targets: [], timeout: 'The aircrew are still in the water and we never got to them.' });
    g.flags.pickup = 0;
    g.script = (gg) => {
      const o = gg.own;
      for (const s of ships) if (!gg.flags.aboard) keepCourse(s, brg(s, raft), dist(s, raft) > 3 ? 25 : 8);
      const launch = (from: Vec, name: string) => {
        const v = add(gg, 'ka28', `Ka-28 (${name})`, 'enemy', from, brg(from, raft), 120);
        v.track = [];
        helos.push({ v, guess: offset(raft, gg.r() * 360, 1.5 + gg.r() * 2.5), phase: 'out', k: 0, t: 0 });
        log(gg, 'warn', `ESM and radio intercepts: ${name} has launched her Ka-28 toward the raft.`);
      };
      ships.forEach((s, i) => at(gg, (3 + i * 9) * 60, `helo${i}`, () => s.alive && launch(offset(s, brg(s, raft), 0.3), s.name)));
      // The destroyer Guiyang, further off to the south, sends hers later.
      at(gg, 40 * 60, 'helo2', () => launch(offset(raft, rb + 160, 48), 'Guiyang'));
      at(gg, 40 * 60, 'kq', () => add(gg, 'kq200', 'KQ-200', 'enemy', offset(raft, rb, 60), norm(rb + 180), 230, patrolPlane(raft)));
      for (const h of helos) {
        const v = h.v;
        if (!v.alive) { if (h.phase === 'hoist') { h.phase = 'out'; log(gg, 'good', 'The Ka-28 over the raft is down. Our aircrew are still in the water.'); } continue; }
        if (h.phase === 'out') {
          v.ordHdg = brg(v, h.guess); v.ordSpd = 120;
          if (dist(v, h.guess) < 1) h.phase = 'search';
        } else if (h.phase === 'search') {
          // An expanding square round the guessed position.
          const wp = offset(h.guess, h.k * 90, 0.6 + h.k * 0.35);
          v.ordHdg = brg(v, wp); v.ordSpd = 90;
          if (dist(v, wp) < 0.3) h.k = (h.k + 1) % 24;
          if (dist(v, raft) < 1 && gg.r() < 0.02 && !gg.flags.aboard) {
            h.phase = 'hoist'; h.t = 0; v.ordSpd = 0;
            log(gg, 'danger', `${v.name} is hovering over the raft. They are hoisting our aircrew: five minutes!`, 'alarm');
          }
        } else {
          v.ordSpd = 0; v.ordHdg = brg(v, raft);
          if (++h.t >= 300) end(gg, false, 'The Ka-28 has hoisted our aircrew aboard. They are prisoners of war.');
        }
        // A helicopter close by can see masts and wake, and calls the ships in.
        if (atPeriscopeDepth(gg) && dist(v, o) < 3 && gg.r() < 0.008) {
          log(gg, 'danger', `${v.name} has seen our masts. The Chinese ships have our position.`, 'alarm');
          for (const s of live(ships)) { s.ai!.knows = { x: o.x, y: o.y, t: gg.t, deep: false, exact: true }; s.ai!.mode = 'attack'; }
        }
      }
      // The beacon is heard by our ESM mast at periscope depth within 6 nm; a Blackwing sees the raft within 3 nm.
      const bw = gg.uavs.find((u) => dist(u, raft) < 3);
      if (!gg.flags.beacon && ((atPeriscopeDepth(gg) && dist(o, raft) < 6) || bw)) {
        gg.flags.beacon = 1; raftMark.label = 'Raft (beacon fix)';
        log(gg, 'good', bw ? `Blackwing ${bw.n}: orange raft in sight, two aboard, waving. Bearing ${fmtBrg(brg(o, raft))} from us, ${dist(o, raft).toFixed(1)} nm.`
          : `ESM: PRC-149 beacon, bearing ${fmtBrg(brg(o, raft))}, ${dist(o, raft).toFixed(1)} nm. Raft position confirmed on the plot.`);
      }
      // Close aboard but not set up for the pickup: say what is missing, once each time it changes.
      if (!gg.flags.aboard && dist(o, raft) < 0.3) {
        const need = !atPeriscopeDepth(gg) ? 1 : o.spd > 4.5 ? 2 : 0;
        if (need && need !== gg.flags.raftHint) log(gg, 'warn', need === 1 ? 'The raft is right overhead. Come up to periscope depth so they can swim to the sail.' : 'The raft is alongside but we are going too fast for them to reach us. Slow to 4 knots or less.');
        gg.flags.raftHint = need;
      } else gg.flags.raftHint = 0;
      if (!gg.flags.aboard && dist(o, raft) < 1 && dist(o, raft) >= 0.3 && !gg.flags.raftClose) { gg.flags.raftClose = 1; log(gg, 'info', `Raft ${Math.round(dist(o, raft) * 2025)} yards off, bearing ${fmtBrg(brg(o, raft))}. Close to inside 600 yards at periscope depth, 4 knots or less.`); }
      if (gg.flags.aboard) { raftMark.r = 8; raftMark.label = 'Raft: get 8 nm clear'; }
      for (const s of ships) if (s.alive && dist(s, raft) < 1 && !gg.flags.aboard) end(gg, false, `${s.name} has picked the aircrew out of the water. They are prisoners of war.`);
      if (gg.flags.aboard && dist(o, raft) > 8) end(gg, true, 'Tang is clear with Ruiz and Okafor aboard. Both of them are going home.');
      if (!gg.flags.aboard && atPeriscopeDepth(gg) && dist(o, raft) < 0.3 && o.spd <= 4.5) {
        if (!gg.flags.pickup) log(gg, 'good', 'Periscope: the raft is alongside. The aircrew are swimming for the sail.');
        gg.flags.pickup++;
        if (gg.flags.pickup === 180) { gg.flags.aboard = 1; log(gg, 'good', 'Ruiz and Okafor are aboard, cold and grinning. Now get us out of here: 8 nm clear of the raft.'); }
      }
    };
  },
};
extras.P24 = (g) => {
  const raft = spot(g, 'raft'), d = dist(g.own, raft);
  return [
    { text: 'Pick up the aircrew', state: flag(g, 'aboard') ? 'done' : g.over ? 'failed' : 'open',
      detail: flag(g, 'aboard') ? 'Both aboard.' : flag(g, 'pickup') ? `Coming aboard: ${mins(180 - flag(g, 'pickup'))} to go. Hold within 600 yards at periscope depth, 4 knots or less.` : `The raft bears ${fmtBrg(brg(g.own, raft))}, ${d.toFixed(1)} nm (it was bearing ${fmtBrg(flag(g, 'raftBrg'))} from where you started). Come to periscope depth within 600 yards at 4 knots or less, and hold 3 minutes.` },
    { text: 'Then get 8 nm clear of the raft', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'aboard') ? `${d.toFixed(1)} of 8 nm.` : 'After the pickup.' },
    watch('Keep the helicopters and ships off the raft', !!g.over && !g.over.win && g.over.reason.includes('prisoners')),
    ...baseObjectives(g),
  ];
};

// ---- P12 Sea of Okhotsk: the north Pacific ----------------------------------------------------------------------------
missions.P12 = {
  key: 'P12', title: 'Sea of Okhotsk', era: '2029', place: 'Sea of Okhotsk', date: 'September 2029, 0200', night: true,
  library: ['borei', 'kilo', 'yasen', 'akula', 'il38'],
  brief: 'The Sea of Okhotsk is Russia\'s Pacific bastion, where its missile submarines hide behind the Kurils. Two Borei-A boats, Knyaz Oleg and Generalissimus Suvorov, are on patrol in a box centred about 18 nm north of you (give or take 5 nm east or west) and about 20 nm across, slow and deep and nearly as quiet as Tang. Intelligence says they walk a slow clockwise ring about 6 nm out from the centre of the box, on opposite sides of it: work round that ring the other way and you will meet them. Search it slowly: at 6 knots the towed array hears a Borei 4 nm off, at 12 knots barely 2. Two Kilos, Volkhov and Magadan, guard the box, and an Il-38 is laying sonobuoys over it. Hunt the Boreis and sink both. When the first goes down, the second will run at speed for the Kuril passes, about 30 nm southeast of the box: loud, but fast, and lost if she gets there. You have five hours.',
  build(g, r) {
    g.startClock = clock(2);
    g.timeLimit = 5 * 3600;
    g.env.sea = 3;
    g.own.hdg = g.own.ordHdg = 0;
    const box = offset(g.own, (r() * 2 - 1) * 15, 18);
    const boreis = ['Knyaz Oleg', 'Generalissimus Suvorov'].map((name, i) => {
      const p = offset(box, i * 180 + (r() * 2 - 1) * 60, 4 + r() * 5);
      return add(g, 'borei', name, 'enemy', p, r() * 360, 5, { mode: 'raider', goal: { ...box }, cruise: 5 }, 1);
    });
    const kilos = ['Volkhov', 'Magadan'].map((name, i) => add(g, 'kilo', name, 'enemy', offset(box, 180 + (i ? 40 : -40) + (r() * 2 - 1) * 20, 9 + r() * 3), r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1));
    void kilos;
    add(g, 'il38', 'Il-38N May', 'enemy', offset(box, r() * 360, 60), 0, 230, patrolPlane(box));
    const exit = mark(g, 'exit', offset(box, 125, 30));
    setGoal(g, { targets: ids(boreis), need: 2, win: 'Both Boreis are on the bottom of the Sea of Okhotsk. Russia\'s Pacific deterrent is broken.', timeout: 'The Boreis are still on patrol.' });
    g.script = (gg) => {
      // Each Borei walks a slow circle round the box, and runs from anything that comes at her.
      // Once one is sunk, the other bolts for the Kuril passes at speed: loud, but going.
      const bolt = boreis.some(isSunk);
      boreis.forEach((v, i) => {
        if (!v.alive) return;
        if (!bolt) { v.ai!.goal = offset(box, (gg.t / 75 + i * 180 + 25) % 360, 6); return; }
        if (!gg.flags.bolt) { gg.flags.bolt = 1; log(gg, 'warn', `Sonar: a big contact is speeding up, bearing ${fmtBrg(brg(gg.own, v))}. The other Borei is running for the Kuril passes.`); }
        v.ai!.goal = exit; v.ai!.cruise = 14;
        if (arrive(gg, v, exit, 2)) end(gg, false, `${v.name} got out through the Kurils into the open Pacific.`);
      });
    };
  },
};

extras.P12 = (g, b) => [...b, watch('Don\'t let the second Borei reach the Kuril passes', !!g.over?.reason.includes('Kurils'),
  flag(g, 'bolt') ? 'She is running southeast for the passes, about 30 nm from the box.' : 'When the first is sunk, the other will run.')];

// ---- P25 Vladivostok ---------------------------------------------------------------------------------------------------
missions.P25 = {
  key: 'P25', title: 'Vladivostok', era: '2029', place: 'Peter the Great Gulf', date: 'September 2029, 0030', night: true,
  library: ['kilo', 'steregushchiy', 'ka27', 'udaloy'],
  brief: 'Mine the Pacific Fleet\'s home port. You have 8 mines aboard; lay them from the torpedo tubes at 12 knots or less. Seed two zones, at least 3 mines in each, then get back out south through the Russian minefield. Zone A is the approach to the Eastern Bosphorus, 12 nm due north of you. Zone B is the entrance to Ussuri Bay, the fleet\'s way east to its Fokino base, 13 nm away on bearing 032. Each zone is about 1 nm across. Russia\'s own defensive minefield crosses the gulf about 4 nm north of you; their ships use a swept channel about 1.5 nm wide, 4.6 nm out on bearing 029. Go through it at 10 knots or less and let the HF sonar find the mines. The Kilo Ust-Bolsheretsk and the corvette Sovershenny patrol inside, and the corvette Gromky is alongside at Fokino with steam up: their hull sonars are good, so stay deep and slow. A Ka-27 waits ashore and will come out if they know you are there. The Bastion-P shore missile batteries on Russky Island and Cape Basargin have coastal radars that will spot masts within 10 nm of them. Five hours to dawn.',
  build(g, r) {
    g.startClock = clock(0, 30);
    g.timeLimit = 5 * 3600;
    g.own.hdg = g.own.ordHdg = 29;
    const zoneA = mark(g, 'zoneA', { x: 0, y: 12 }), zoneB = mark(g, 'zoneB', offset(g.own, 32, 13));
    g.flags.minesAboard = 8;
    // The defensive field, with the swept channel their ships use.
    mineLine(g, { x: -10, y: 4.2 }, { x: 1.5, y: 4 }, 24);
    mineLine(g, { x: 3, y: 4 }, { x: 16, y: 3.8 }, 28);
    const batteries = [{ x: -1, y: 16 }, { x: 8, y: 15 }];
    add(g, 'kilo', 'Ust-Bolsheretsk', 'enemy', offset(zoneA, 180 + (r() * 2 - 1) * 60, 3 + r() * 2), r() * 360, 4, { mode: 'patrol', legT: 500, decoys: 2 }, 1);
    add(g, 'steregushchiy', 'Sovershenny', 'enemy', offset(zoneB, 120, 3), r() * 360, 8, { mode: 'patrol', legT: 400 });
    // Gromky is alongside at Fokino, steam up, ready to come out.
    const gromky = add(g, 'steregushchiy', 'Gromky', 'enemy', offset(zoneB, 60, 5), 240, 0, go(240, 0, 1e9));
    setGoal(g, { targets: [], timeout: 'Dawn: the mission is incomplete and the gulf is waking up.' });
    const count = (z: Vec) => g.mines.filter((m) => m.side === 'us' && dist(m, z) < 0.6).length;
    const zoneALabel = mineZone(g, zoneA, 0.6, 'Zone A', 3), zoneBLabel = mineZone(g, zoneB, 0.6, 'Zone B', 3);
    g.marks!.push({ x: 2.25, y: 4.1, r: 0.75, label: 'Swept channel' });
    g.script = (gg) => {
      const o = gg.own;
      gg.flags.inA = zoneALabel(count(zoneA)); gg.flags.inB = zoneBLabel(count(zoneB));
      for (const [k, n] of [['A', gg.flags.inA], ['B', gg.flags.inB]] as const) if (n >= 3 && !gg.flags[`done${k}`]) { gg.flags[`done${k}`] = 1; log(gg, 'good', `Zone ${k} is seeded: ${n} mines down.`); }
      // The coastal radars watch for masts close inshore; a sighting, or our shooting, puts the Ka-27 up from the shore.
      const seen = atPeriscopeDepth(gg) && batteries.some((b) => dist(o, b) < 10) && gg.r() < 0.006;
      if (seen) {
        log(gg, 'danger', 'ESM: a coastal radar on the shore has locked on our masts. The patrol knows where we are.', 'alarm');
        for (const v of gg.vessels) if (v.alive && v.side === 'enemy' && v.ai && v.cls.kind !== 'air') { v.ai.knows = { x: o.x, y: o.y, t: gg.t, deep: false, exact: true }; if (v.ai.mode === 'patrol') v.ai.mode = 'attack'; }
      }
      if ((seen || firedAny(gg)) && !gg.flags.helo) {
        gg.flags.helo = 1;
        const datum = { x: o.x, y: o.y, t: gg.t, deep: o.depthT > 1.5, exact: false };
        add(gg, 'ka27', 'Ka-27PL Helix', 'enemy', { x: 3, y: 19 }, brg({ x: 3, y: 19 }, o), 120, { mode: 'search', center: { x: o.x, y: o.y }, wp: { x: o.x, y: o.y }, torps: 1, datum, hits: 0, dipT: 0 });
        log(gg, 'warn', 'ESM: a Ka-27 helicopter is lifting off from the shore and heading our way, and the corvette Gromky is slipping from Fokino.');
        if (gromky.alive) Object.assign(gromky.ai!, { mode: 'attack', knows: datum, legT: 300 });
      }
      if (gg.flags.doneA && gg.flags.doneB && o.y < 2) end(gg, true, 'Both approaches are mined and Tang is back out through their minefield. The Pacific Fleet is corked in Vladivostok.');
      if (!gg.flags.minesAboard && (gg.flags.inA < 3 || gg.flags.inB < 3) && !gg.flags.empty) { gg.flags.empty = 1; end(gg, false, 'All the mines are laid, but not enough in each zone. The fleet will sweep a path out.'); }
    };
  },
};
extras.P25 = (g) => [
  { text: 'Lay 3 mines in Zone A (Eastern Bosphorus approach)', state: flag(g, 'doneA') ? 'done' : 'open', detail: `${flag(g, 'inA')} of 3. 12 nm due north of where you started.` },
  { text: 'Lay 3 mines in Zone B (Ussuri Bay entrance)', state: flag(g, 'doneB') ? 'done' : 'open', detail: `${flag(g, 'inB')} of 3. 13 nm on bearing 032 from where you started.` },
  { text: 'Get back out through their minefield', state: g.over?.win ? 'done' : 'open', detail: `${flag(g, 'minesAboard')} mines left aboard. Their swept channel through the field: 4.6 nm out on bearing 029 from where you started.` },
  watch('Don\'t run out of mines before both zones are seeded', flag(g, 'empty') > 0),
  ...baseObjectives(g),
];

// ---- P26 Korea Strait ---------------------------------------------------------------------------------------------------
missions.P26 = {
  key: 'P26', title: 'Korea Strait', era: '2029', place: 'Tsushima Strait', date: 'September 2029, 1700',
  library: ['type093b', 'kilo', 'taigei', 'maya', 'type039'],
  brief: 'China and Russia want to join hands in the Sea of Japan, and the way through is the Korea Strait. The Korean navy holds the western channel. You hold the eastern one, the Tsushima Strait, with the Japanese submarine JS Taigei, which holds the northeast end, and the destroyer JS Haguro, which sweeps the western side of the channel about 9 nm west of you. Two Chinese Type 093Bs are coming up from the East China Sea to the southwest, and two Russian Kilos down from Vladivostok to the northeast, all trying to get through. Deal with all four: sink them, or let no more than one get 12 nm past you. If two get through, or any are still in the strait when night falls in four and a half hours, the strait has failed. They come one at a time, a few miles apart. The Shangs will fight if they hear you; the Kilos will try to creep past. Taigei is a diesel boat like the Kilos: identify before you shoot. Don\'t lose both Japanese units.',
  build(g, r) {
    g.startClock = clock(17);
    g.timeLimit = 4.5 * 3600;
    g.own.hdg = g.own.ordHdg = 45;
    const foe = (cls: string, name: string, from: number, d: number, to: number, spd: number) => {
      const p = offset(g.own, from + (r() * 2 - 1) * 15, d);
      const exit = offset(g.own, to + (r() * 2 - 1) * 15, 12);
      // The Shangs will fight their way through; the Kilos try to creep past and only run if attacked.
      const ai = cls === 'kilo' ? { mode: 'raider' as const, goal: exit, cruise: spd } : { mode: 'patrol' as const, legT: 1e9, decoys: 2 };
      return { v: add(g, cls, name, 'enemy', p, brg(p, exit), spd, ai, r() < 0.5 ? 2 : 1), exit, spd };
    };
    const boats = [
      // They come one at a time, the hard way: first a Shang, then a Kilo, then the second of each.
      foe('type093b', 'Changzheng 13', 225, 12 + r() * 2, 45, 10), foe('type093b', 'Changzheng 17', 225, 27 + r() * 3, 45, 10),
      foe('kilo', 'Mozhaisk', 45, 15 + r() * 2, 225, 8), foe('kilo', 'Ufa', 45, 20 + r() * 2, 225, 8),
    ];
    const taigei = add(g, 'taigei', 'JS Taigei', 'allied', offset(g.own, 45, 8), 45, 5, undefined, 1);
    const haguro = add(g, 'maya', 'JS Haguro', 'allied', { x: -9, y: 0 }, 180, 12, go(180, 12));
    setGoal(g, { protect: [taigei.id, haguro.id], maxLosses: 1,
      lossText: 'Taigei and Haguro are both lost. The Japanese line has gone.',
      timeout: 'Night fell with enemy boats still in the strait, and they slipped through in the dark.' });
    g.flags.through = 0;
    g.script = (gg) => {
      for (const b of boats) keepCourse(b.v, brg(b.v, b.exit), b.spd);
      for (const b of boats) if (arrive(gg, b.v, b.exit, 2.5)) { gg.flags.through++; log(gg, 'danger', `${b.v.name} is through the strait.`); }
      // Taigei holds the northeast end; Haguro sweeps up and down the western side of the channel, off Tsushima.
      steer(taigei, offset({ x: 0, y: 0 }, 45, Math.floor(gg.t / 1800) % 2 ? 12 : 6), 5);
      if (haguro.alive && haguro.ai!.mode === 'transit') haguro.ai!.baseCourse = brg(haguro, { x: -9, y: Math.floor(gg.t / 2400) % 2 ? 7 : -7 });
      skirmish(gg, [taigei, haguro], boats.map((b) => b.v), 4, 0.012, 0.01, 0.5);
      at(gg, 90 * 60, 'rok', () => log(gg, 'info', 'ROK Navy: a Chinese boat tried the western channel and was sunk by a Korean P-3C. They are holding.'));
      if (gg.flags.through >= 2) end(gg, false, 'Two enemy boats got through the Tsushima Strait.');
      if (boats.every((b) => !b.v.alive)) end(gg, true, 'All four boats are sunk or past us, and no more than one got through. The Tsushima Strait held: China and Russia are still apart.');
    };
  },
};
extras.P26 = (g, b) => {
  const boats = g.vessels.filter((v) => v.side === 'enemy' && v.cls.kind === 'sub');
  return [
    { text: 'Stop the four enemy boats', state: boats.every(isSunk) ? 'done' : 'open', detail: `${boats.filter(isSunk).length} of ${boats.length} sunk. Two 093Bs from the southwest, two Kilos from the northeast.` },
    watch('Don\'t let two of them through', flag(g, 'through') >= 2, `${flag(g, 'through')} of 2 through.`),
    ...b,
  ];
};

