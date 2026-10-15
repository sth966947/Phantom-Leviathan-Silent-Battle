// Modern war missions: the Polar Front (Act 3, October to November 2029). US and Japanese boats
// against Russia and China, mostly under the pack: no masts, radar or missiles except in open water,
// noisy ice for everyone, keels to dive under and leads to find. See src/sim/warData.ts (R1 to R13).
import { brg, dist, fmtBrg, fmtRng, norm, offset, type Vec } from '../math';
import { atPeriscopeDepth, depthFeet, depthT, end, log, type Game, type Vessel } from '../sim';
import { underIce } from '../hazards';
import {
  add, alive, at, baseObjectives, clock, flag, go, held, ids, isSunk, keepCourse, listNames, mins, screen, setGoal, skirmish, steer, watch,
  type Carry, type Mission, type MissionKey, type Objective, type ObjectiveFn,
} from '../kit';

// ---- Names: the first of each list that earlier missions haven't sunk ---------------------------
const YASEN = ['Krasnoyarsk', 'Arkhangelsk', 'Perm', 'Novosibirsk', 'Ulyanovsk', 'Voronezh'];
const SHANG = ['Changzheng 18', 'Changzheng 19', 'Changzheng 20', 'Changzheng 21', 'Changzheng 22', 'Changzheng 23'];
const T095 = ['Changzheng 25', 'Changzheng 26', 'Changzheng 27', 'Changzheng 28'];
const KILO = ['Ufa', 'Volkhov', 'Mozhaisk', 'Magadan'];
const pick = (carry: Carry, pool: string[], i = 0) => { const ok = pool.filter((n) => alive(carry, n)); return (ok.length > i ? ok : pool)[i % pool.length]; };

// ---- The ice -------------------------------------------------------------------------------------
type Hole = Vec & { r: number };
/** Pack ice overhead, with open water only in `open`. Waves are damped under the pack. */
function pack(g: Game, open: Hole[] = [], sea = 1) { g.env.ice = true; g.env.polynyas = open; g.env.sea = sea; }
/** Open water south of a straight ice edge at `y` (a polynya so big its rim is a line). */
const edgeSouth = (y: number): Hole => ({ x: 0, y: y - 2000, r: 2000 });
const hole = (p: Vec, r: number): Hole => ({ x: p.x, y: p.y, r });

/** Leads nobody has charted: the upward-looking sonar finds each when Tang passes within 3 nm of its rim. */
function seekLeads(g: Game, hidden: Hole[]) {
  for (const p of hidden) {
    if (g.env.polynyas.includes(p) || dist(g.own, p) > p.r + 3) continue;
    g.env.polynyas.push(p);
    log(g, 'good', `Upward-looking sonar: the ice is thinning, then open water, bearing ${fmtBrg(brg(g.own, p))}, ${fmtRng(dist(g.own, p))}. A lead about ${(p.r * 2).toFixed(1)} nm across. Marked on the plot.`, 'contact');
  }
}
/** Close a lead: the pack drifts shut over it. */
const closeLead = (g: Game, p: Hole) => { g.env.polynyas = g.env.polynyas.filter((x) => x !== p); };

/** A pressure ridge's keel, hanging down to `ft`. Tang's upward-looking sonar warns of it; hitting it shallow tears the sail. */
interface Keel extends Vec { r: number; ft: number; warnT: number; hitT: number }
const keel = (p: Vec, r: number, ft: number): Keel => ({ x: p.x, y: p.y, r, ft: Math.round(ft / 10) * 10, warnT: -1e9, hitT: -1e9 });
/** Keels scattered over a box, none within `clear` nm of Tang's start. */
function keelField(r: () => number, n: number, x0: number, x1: number, y0: number, y1: number, ft0 = 280, ft1 = 400, clear = 2): Keel[] {
  const out: Keel[] = [];
  while (out.length < n) {
    const p = { x: x0 + r() * (x1 - x0), y: y0 + r() * (y1 - y0) };
    if (Math.hypot(p.x, p.y) > clear) out.push(keel(p, 0.3 + r() * 0.3, ft0 + r() * (ft1 - ft0)));
  }
  return out;
}
function keels(g: Game, ks: Keel[]) {
  const o = g.own, d = depthFeet(o.depthT);
  for (const k of ks) {
    const r = dist(o, k);
    if (r < k.r + 0.8 && d < k.ft + 30 && g.t - k.warnT > 300) {
      k.warnT = g.t;
      log(g, 'warn', `Upward-looking sonar: ice keel bearing ${fmtBrg(brg(o, k))}, ${fmtRng(Math.max(0.05, r - k.r))}, reaching down to ${k.ft} feet. Go under it or go round.`);
    }
    if (r < k.r && d < k.ft - 10 && g.t - k.hitT > 90) {
      k.hitT = g.t; o.hp -= 1;
      g.flags.keelHits = flag(g, 'keelHits') + 1;
      if (o.hp <= 0) { o.alive = false; log(g, 'danger', 'The sail has torn open on an ice keel. Flooding we can\'t stop.', 'boom'); return end(g, false, 'USS Tang struck an ice keel and was lost.'); }
      log(g, 'danger', `Collision! The sail has struck an ice keel. Flooding forward, under control. Taking her down to ${k.ft + 100} feet.`, 'boom');
      o.ordDepth = Math.max(o.ordDepth, depthT(k.ft + 100));
    }
  }
}
/** Shallow water or a ridge crest: no boat goes deeper than `limit(p)` feet there (null: no limit). */
function bottom(g: Game, limit: (p: Vec) => number | null) {
  for (const v of g.vessels) {
    if (!v.alive || v.cls.kind !== 'sub') continue;
    const ft = limit(v);
    if (ft === null) continue;
    const lim = depthT(ft);
    if (v === g.own && v.ordDepth > lim + 0.01 && g.t - flag(g, 'shoalT') > 120) {
      g.flags.shoalT = g.t;
      log(g, 'warn', `Fathometer: the bottom is coming up. Holding ${Math.round(ft)} feet, as deep as we can go here.`);
    }
    v.ordDepth = Math.min(v.ordDepth, lim);
    v.depthT = Math.min(v.depthT, lim);
  }
}
/** Our anti-ship missiles lose ships in the ice clutter: each that gets within 3 nm of its target may go blind. */
function iceClutter(g: Game, p: number) {
  for (const w of g.weapons) {
    if (w.dead || w.side !== 'us' || (w.type !== 'harpoon' && w.type !== 'mst') || !w.target || g.flags[`ic${w.id}`]) continue;
    g.flags[`ic${w.id}`] = 1;
    if (g.r() < p) { w.dead = true; log(g, 'warn', `${w.label} lost its target in the ice clutter.`); }
  }
}

// ---- Allies under the ice -----------------------------------------------------------------------
const jp = (g: Game, name: string, p: Vec, hdg: number, depth: 1 | 2 = 1) => add(g, 'taigei', name, 'allied', p, hdg, 4, undefined, depth);
/** Allied boats report on the acoustic link every ten minutes: where they are from Tang. */
function phone(g: Game, allies: Vessel[]) {
  if (g.t % 600 !== 10) return;
  for (const v of allies) if (v.alive && dist(g.own, v) < 30)
    log(g, 'info', `${v.name} on the acoustic link: she is bearing ${fmtBrg(brg(g.own, v))}, ${fmtRng(dist(g.own, v))} from us.`);
}
const nearest = (v: Vec, list: Vessel[], within = Infinity) => list.filter((x) => x.alive && dist(x, v) < within).sort((a, b) => dist(a, v) - dist(b, v))[0];
/** Pact boats that haven't found Tang go after the nearest allied boat they've been cued on. */
function stalk(foes: Vessel[], allies: Vessel[], spd = 6) {
  for (const f of foes) { const a = nearest(f, allies); if (a) keepCourse(f, brg(f, a), spd); }
}
/** Allied boats engage the nearest enemy their sonar would hold, or keep to their stations. */
function engage(allies: Vessel[], foes: Vessel[], stations: Vec[], spd = 5, sonar = 7) {
  allies.forEach((a, i) => { const f = nearest(a, foes, sonar); steer(a, f ? offset(f, brg(f, a), 2.5) : stations[i], f ? spd + 1 : spd); });
}
const weFired = (g: Game) => Object.values(g.stats.fired).some((n) => n > 0);
/** Boats under orders to get through, not to fight: they come after Tang only when it has shot at someone in the last 15 minutes. */
function inAHurry(g: Game, boats: Vessel[]) {
  const shots = Object.values(g.stats.fired).reduce((a, n) => a + n, 0);
  if (shots !== flag(g, 'shots')) { g.flags.shots = shots; g.flags.shotT = g.t; }
  if (shots && g.t - flag(g, 'shotT') < 900) return;
  for (const b of boats) if (b.alive && b.ai?.mode === 'attack') { b.ai.mode = 'patrol'; b.ai.holdT = 0; }
}

export const missions: Record<MissionKey, Mission> = {
  R1: {
    key: 'R1', title: 'Bering Gate', era: '2029', place: 'Bering Strait', date: 'October 2029, 0400', night: true,
    library: ['type093b', 'kilo', 'taigei', 'type095', 'virginia'],
    brief: 'The Polar Front has opened. Russia and China are sending boats north through the Bering Strait to fight under the Arctic ice, and Tang and the Japanese boat JS Taigei are the gate. A Russian Kilo loaded with mines for the Chukchi approaches is coming up from the south, 14 to 18 nm behind you, with a Chinese Type 093B riding shotgun. The Kilo will run rather than fight; the 093B will fight anything it hears. Sink both before either gets north past the Diomede Islands, 12 nm north of you. The strait is shallow: nobody can go deeper than 150 feet, so there is no layer to hide under. The pack hasn\'t reached the strait yet; it\'s open water and a moderate sea. Taigei is holding the eastern channel about 5 nm east of you; every ten minutes she reports her position on the acoustic link, and any submarine her sonar holds. Your Mk 48s can\'t tell her from the enemy: check before you shoot.',
    build(g, r, carry) {
      g.startClock = clock(4);
      g.timeLimit = 4.5 * 3600;
      g.env.sea = 3;
      g.own.hdg = g.own.ordHdg = 180;
      const taigei = jp(g, 'JS Taigei', { x: 5, y: 0 }, 180);
      // The Kilo is loaded with mines for the Chukchi approaches and only runs; the 093B rides shotgun and fights.
      const runner = (cls: string, name: string, spd: number, fights: boolean) => {
        const p = offset(g.own, 150 + r() * 60, 14 + r() * 4);
        const lane = { x: r() < 0.5 ? -4 : 4, y: 14 };
        const v = add(g, cls, name, 'enemy', p, brg(p, lane), spd, fights ? { mode: 'patrol', legT: 1e9, decoys: 2 } : { mode: 'raider', goal: lane, cruise: spd, decoys: 2 }, 1);
        return { v, lane, spd };
      };
      const boats = [runner('type093b', pick(carry, SHANG), 9, true), runner('kilo', pick(carry, KILO), 7, false)];
      const foes = boats.map((b) => b.v);
      setGoal(g, { targets: ids(foes), need: 2, win: 'Both boats are on the bottom of the strait. The Bering Gate holds.', timeout: 'Dawn, and one of them is still lurking south of the strait. The gate is open.' });
      g.script = (gg) => {
        bottom(gg, () => 150);
        phone(gg, [taigei]);
        // Taigei walks her beat in the eastern channel.
        engage([taigei], foes, [{ x: 5, y: Math.floor(gg.t / 2400) % 2 ? -6 : 6 }], 4, 6);
        skirmish(gg, [taigei], foes, 3, 0.15, 0.1, 0.6);
        // Taigei passes on what her sonar holds.
        const f = taigei.alive && gg.t % 600 === 300 ? foes.find((x) => x.alive && dist(x, taigei) < 6) : undefined;
        if (f) { const est = offset(f, gg.r() * 360, gg.r() * 0.8); log(gg, 'contact', `JS Taigei reports a submarine, bearing ${fmtBrg(brg(gg.own, est))} from us, ${fmtRng(dist(gg.own, est))}.`); }
        for (const b of boats) {
          keepCourse(b.v, brg(b.v, b.lane), b.spd);
          if (b.v.alive && b.v.y > 12) {
            b.v.alive = false; b.v.gone = true;
            end(gg, false, `${b.v.name} slipped north past the Diomedes into the Chukchi Sea.`);
          }
        }
      };
    },
  },

  R2: {
    key: 'R2', title: 'Ice Camp', era: '2029', place: 'Beaufort Sea', date: 'October 2029, 1000',
    library: ['type095', 'type093b', 'yasen', 'virginia'],
    brief: 'Ice Camp Nautilus sits on the pack 5 nm north of you, beside a lead of open water, with a hydrophone tracking range hung through the ice around it. A Chinese Type 095 is coming to wreck it. Sink the 095 within three hours. If it spends three minutes within 2 nm of the camp, it will put a torpedo up through the lead into the range and the camp will have to be abandoned. The range hears what you can\'t: every four minutes, while the 095 is within 12 nm of the camp, the camp will pass you its bearing and range. Pressure ridges ring the camp; their keels hang down to 300 to 400 feet, and the upward-looking sonar will warn you of each. Under the pack you can\'t come above 200 feet, and missiles and ASROC need open water.',
    build(g, r, carry) {
      g.startClock = clock(10);
      g.timeLimit = 3 * 3600;
      const camp = { x: 0, y: 5 };
      pack(g, [hole({ x: 0.5, y: 5.4 }, 0.7), hole(offset(camp, 240 + r() * 60, 9), 0.8)]);
      const ks = [...[0, 70, 140, 215, 290].map((b) => keel(offset(camp, b + r() * 30, 2.3 + r()), 0.4, 300 + r() * 100)), ...keelField(r, 6, -14, 14, -6, 18)];
      const a = norm(220 + r() * 280);
      const p = offset(camp, a, 20 + r() * 4);
      const t = add(g, 'type095', pick(carry, T095), 'enemy', p, brg(p, camp), 8, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      setGoal(g, { targets: [t.id], need: 1, win: 'The Type 095 is sunk. Ice Camp Nautilus keeps listening.', timeout: 'The Type 095 is still out there. The camp is being flown out.' });
      g.flags.atCamp = 0;
      g.script = (gg) => {
        keels(gg, ks);
        if (!t.alive) return;
        const d = dist(t, camp);
        keepCourse(t, brg(t, camp), d > 6 ? 8 : 5);
        if (d < 12 && gg.t % 240 === 0) {
          const est = offset(t, gg.r() * 360, gg.r() * 0.6);
          log(gg, 'contact', `Ice Camp Nautilus tracking range: submarine, bearing ${fmtBrg(brg(gg.own, est))} from us, ${fmtRng(dist(gg.own, est))}.`);
        }
        if (d < 2) {
          if (!gg.flags.atCamp) log(gg, 'danger', 'Ice Camp Nautilus: the submarine is under the camp!', 'alarm');
          gg.flags.atCamp++;
        }
        if (gg.flags.atCamp >= 180) end(gg, false, 'The Type 095 put a torpedo up through the lead into the tracking range. Ice Camp Nautilus is being abandoned.');
      };
    },
  },

  R3: {
    key: 'R3', title: 'Northern Sea Route', era: '2029', place: 'Laptev Sea', date: 'October 2029, 0800',
    library: ['arc7lng', 'arktika', 'yasen', 'akula', 'lng', 'virginia'],
    brief: 'Russian gas is going east to China along the Northern Sea Route: three Arc7 LNG carriers in line astern behind the nuclear icebreaker Arktika, breaking a lane through the young ice. They are about 19 nm west-northwest of you, heading east at 10 knots, and a Yasen-M is sweeping ahead of them. Sink two of the three carriers before they leave the Laptev Sea, three and a half hours from now. The icebreaker\'s lane is full of rubble ice, no use for a launch, but there are two charted leads: one 6 nm south of you and one about 20 nm northeast. From open water, Tomahawk can reach the carriers, though their radar seekers struggle in the ice clutter. Under the pack it\'s torpedoes only.',
    build(g, r, carry) {
      g.startClock = clock(8);
      g.timeLimit = 3.5 * 3600;
      pack(g, [hole({ x: 2, y: -6 }, 1), hole({ x: 14, y: 14 }, 1.2)]);
      const ark = add(g, 'arktika', 'Arktika', 'enemy', { x: -18, y: 6 + r() * 2 }, 90, 10, go(90, 10, 1e9));
      const lng = screen(g, ark, 'arc7lng', ['Christophe de Margerie', 'Boris Vilkitsky', 'Fedor Litke'], [[180, 1], [180, 2], [180, 3]]);
      const ys = add(g, 'yasen', pick(carry, YASEN), 'enemy', offset(ark, 90 + (r() * 2 - 1) * 30, 5), 90, 10, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      setGoal(g, { targets: ids(lng), need: 2, win: 'Two gas carriers are burning in the ice. The Northern Sea Route is closed for the winter.', timeout: 'The convoy has crossed into the East Siberian Sea under its own air cover.' });
      g.script = (gg) => {
        iceClutter(gg, 0.4);
        // The Yasen sweeps a few miles ahead of the icebreaker, weaving across the track.
        if (ark.alive) keepCourse(ys, brg(ys, offset(ark, ark.hdg + Math.sin(gg.t / 600) * 50, 4)), 11);
      };
    },
  },

  R4: {
    key: 'R4', title: 'Polynya', era: '2029', place: 'North of Franz Josef Land', date: 'October 2029, 0200', night: true,
    library: ['yasen', 'akula', 'type095', 'virginia'],
    brief: 'Nagurskoye air base, on Alexandra Land about 105 nm south-southwest of you, flies the fighters and patrol planes that cover the Bastion. Put four Tomahawks on it within three hours. Under the pack you can\'t launch: you need open water. Yesterday\'s satellite pass showed two leads, one about 12 nm east-southeast of you and one about 20 nm southwest, but the ice has moved since; the upward-looking sonar will find a lead when you pass within 3 nm of it. Leads close as fast as they open. A Yasen-M is under the pack with you, and it can guess where you\'ll need to come up. Keels hang down to 400 feet here.',
    build(g, r, carry) {
      g.startClock = clock(2);
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = 180;
      pack(g);
      const near = offset(g.own, 115, 12), far = offset(g.own, 225, 20);
      const a = hole(offset(near, r() * 360, 1 + r() * 2), 0.8), b = hole(offset(far, r() * 360, 1 + r() * 2), 1);
      const c = hole(offset(g.own, r() * 360, 9 + r() * 6), 0.5);
      const leads = [a, b, c];
      const ks = keelField(r, 9, -20, 20, -22, 6, 300, 400);
      const base = offset(g.own, 195, 105);
      ['Nagurskoye runway', 'Nagurskoye hangars and fuel', 'Nagurskoye radar'].forEach((name, i) => {
        const p = offset(base, i * 120, 0.6);
        g.sites.push({ id: -(i + 1), name, x: p.x, y: p.y, hits: 0 });
      });
      const guard = r() < 0.6 ? a : b;
      const ys = add(g, 'yasen', pick(carry, YASEN, 1), 'enemy', offset(guard, r() * 360, 3), 0, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      setGoal(g, { targets: [], win: '', timeout: 'Three hours gone. Nagurskoye is still flying.' });
      g.script = (gg) => {
        seekLeads(gg, leads);
        keels(gg, ks);
        // The Yasen circles the lead it thinks we'll use.
        keepCourse(ys, brg(ys, offset(guard, gg.t / 15, 3)), 5);
        // The east-southeast lead is closing under pressure from the pack.
        at(gg, 80 * 60, 'squeeze', () => { if (gg.env.polynyas.includes(a)) log(gg, 'warn', 'Upward-looking sonar: the ice is moving. The east-southeast lead is closing.'); });
        if (gg.t > 80 * 60 && a.r > 0) { a.r = Math.max(0, 0.8 - (gg.t - 80 * 60) / 600); if (!a.r) closeLead(gg, a); }
        if (flag(gg, 'landHits') >= 4) end(gg, true, 'Four Tomahawks on Nagurskoye. The runway is cratered and the Bastion has lost its northern air cover.');
      };
    },
  },

  R5: {
    key: 'R5', title: 'Wolfpack', era: '2029', place: 'Chukchi Sea', date: 'October 2029, 2200', night: true,
    library: ['type093b', 'type095', 'taigei', 'kilo', 'virginia'],
    brief: 'Two Chinese Type 093Bs are working as a pair under the Chukchi ice, about 20 nm north of you. You are not alone this time: JS Taigei, 5 nm to your west, and JS Hakugei, 5 nm to your east, sweep north with you in line abreast. Sink both Chinese boats. The Japanese boats will fight anything they find, but they are slow and quiet diesel boats; lose both and the wolfpack is broken and the mission fails. They report on the acoustic link every ten minutes. Your torpedoes can\'t tell friend from foe: know where they are before you shoot.',
    build(g, r, carry) {
      g.startClock = clock(22);
      g.timeLimit = 4 * 3600;
      pack(g, [hole(offset(g.own, 30 + r() * 300, 8 + r() * 6), 0.8)]);
      const ks = keelField(r, 8, -15, 15, 2, 26);
      const allies = [jp(g, 'JS Taigei', { x: -5, y: -1 }, 0), jp(g, 'JS Hakugei', { x: 5, y: -1 }, 0, 2)];
      const c = offset(g.own, (r() * 2 - 1) * 30, 18 + r() * 4);
      const foes = [-1.5, 1.5].map((dx, i) => add(g, 'type093b', pick(carry, SHANG, 1 + i), 'enemy', { x: c.x + dx, y: c.y }, 180, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, i ? 2 : 1));
      setGoal(g, { targets: ids(foes), need: 2, protect: ids(allies), maxLosses: 1, lossText: 'Both Japanese boats are lost. The wolfpack is broken.',
        win: 'Both Chinese boats are sunk. The Chukchi is ours.', timeout: 'The Chinese pair slipped away under the pack.' });
      g.script = (gg) => {
        keels(gg, ks);
        phone(gg, allies);
        // The line sweeps north at 4 knots; each Japanese boat closes on what its sonar holds.
        const y = Math.min(24, -1 + gg.t * 4 / 3600);
        engage(allies, foes, [{ x: -5, y }, { x: 5, y }], 4, 6);
        stalk(foes, allies, 5);
        skirmish(gg, allies, foes, 4, 0.08, 0.08, 0.6);
      };
    },
  },

  R6: {
    key: 'R6', title: 'Keel Depth', era: '2029', place: 'Lomonosov Ridge', date: 'November 2029, 0300', night: true,
    library: ['yasen', 'type095', 'type093b', 'akula', 'virginia'],
    brief: 'Tang has to cross the Lomonosov Ridge, and Moscow and Beijing know it. A Yasen-M and a Type 095 are lying in wait, quiet and slow, somewhere over the crest about 11 nm north of you. Get through: reach open basin 24 nm north of you, or sink both. Over the crest, between 7 and 17 nm north, the bottom comes up to 520 to 640 feet, and pressure-ridge keels hang down to 340 to 420 feet: a slot not much deeper than the layer. The fathometer and upward-looking sonar will tell you where you are. You have three hours.',
    build(g, r, carry) {
      g.startClock = clock(3);
      g.timeLimit = 3 * 3600;
      pack(g);
      const crest = (p: Vec) => (p.y > 7 && p.y < 17 ? 480 + 120 * Math.abs(Math.sin(p.x * 0.6)) : null);
      const ks = keelField(r, 14, -9, 9, 7, 17, 340, 420);
      const lurk = [offset({ x: -4, y: 11 }, r() * 360, r() * 2.5), offset({ x: 4, y: 11 }, r() * 360, r() * 2.5)];
      const foes = [add(g, 'yasen', pick(carry, YASEN, 2), 'enemy', lurk[0], 180, 2, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1),
        add(g, 'type095', pick(carry, T095, 1), 'enemy', lurk[1], 180, 2, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1)];
      for (const f of foes) f.depthT = f.ordDepth = depthT(420);
      setGoal(g, { targets: ids(foes), need: 2, win: 'Both ambushers are sunk. The ridge is open.', timeout: 'Three hours, and we are still pinned on the ridge.' });
      g.script = (gg) => {
        keels(gg, ks);
        bottom(gg, crest);
        foes.forEach((f, i) => keepCourse(f, brg(f, lurk[i]), dist(f, lurk[i]) > 1 ? 3 : 1));
        if (gg.own.y >= 24) end(gg, true, 'We are over the ridge and into the Makarov Basin. The ambush failed.');
      };
    },
  },

  R7: {
    key: 'R7', title: 'Top of the World', era: '2029', place: 'North Pole', date: 'November 2029, 1200', night: true,
    library: ['yasen', 'type095', 'type093b', 'taigei', 'virginia', 'akula', 'il38'],
    brief: 'The big one. Russia and China have sent their best boats to take the pole, and the US and Japan are meeting them there. With you: USS Idaho, 6 nm to your west, JS Taigei, 6 nm east, and JS Jingei, 10 nm east. Ahead, about 18 nm north, a Yasen-M and a Type 095 are coming; intelligence expects a second pair to come in on the flanks within the hour. Sink three of the four between you. Lose two of your three allies and the line breaks. There is one lead at the pole itself, 9 nm north: open water where you can raise a mast or fire ASROC, but an Il-38 is watching it. The allies report on the acoustic link every ten minutes; the Mk 48 can\'t tell friend from foe.',
    build(g, r, carry) {
      g.startClock = clock(12);
      g.timeLimit = 4 * 3600;
      const pole = hole({ x: 0, y: 9 }, 1.6);
      pack(g, [pole]);
      const ks = keelField(r, 12, -16, 16, 3, 22);
      const allies = [add(g, 'virginia', 'USS Idaho (SSN-799)', 'allied', { x: -6, y: -1 }, 0, 5, undefined, 2), jp(g, 'JS Taigei', { x: 6, y: -1 }, 0), jp(g, 'JS Jingei', { x: 10, y: -2 }, 0, 2)];
      const sub = (cls: string, name: string, p: Vec) => add(g, cls, name, 'enemy', p, brg(p, g.own), 6, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.5 ? 2 : 1);
      // The flank pair starts far out and closes fast: it arrives about 40 minutes in.
      const foes = [sub('yasen', pick(carry, YASEN, 3), { x: -4 + r() * 3, y: 17 + r() * 2 }), sub('type095', pick(carry, T095, 2), { x: 3 + r() * 3, y: 19 + r() * 2 }),
        sub('yasen', pick(carry, YASEN, 4), { x: -20, y: 12 + r() * 4 }), sub('type093b', pick(carry, SHANG, 3), { x: 20, y: 10 + r() * 4 })];
      add(g, 'il38', 'Il-38N May', 'enemy', offset(pole, r() * 360, 60), 0, 230, { mode: 'search', center: { x: pole.x, y: pole.y }, wp: { x: pole.x, y: pole.y }, buoyT: 0, torps: 2, datum: null });
      setGoal(g, { targets: ids(foes), need: 3, protect: ids(allies), maxLosses: 1, lossText: 'Two of our three allied boats are on the bottom. The line at the pole has broken.',
        win: 'Three pact boats are sunk under the pole. The top of the world is ours.', timeout: 'The fight at the pole has ended without a decision.' });
      g.script = (gg) => {
        keels(gg, ks);
        phone(gg, allies);
        engage(allies, foes, [{ x: -6, y: 7 }, { x: 5, y: 7 }, { x: 10, y: 5 }], 5, 7);
        stalk(foes.slice(0, 2), allies, 6);
        stalk(foes.slice(2), allies, gg.t < 2400 ? 14 : 6);
        skirmish(gg, allies, foes, 4, 0.07, 0.07, 0.6);
        at(gg, 35 * 60, 'flank', () => log(gg, 'warn', 'USS Idaho on the acoustic link: more contacts on both flanks, east and west. The second pair is here.'));
      };
    },
  },

  R8: {
    key: 'R8', title: 'Borei Under the Ice', era: '2029', place: 'Barents ice edge', date: 'November 2029, 0500', night: true,
    library: ['borei', 'yasen', 'akula', 'il38', 'virginia'],
    brief: 'A Borei-A missile boat slipped under the ice edge 20 minutes ago, somewhere 5 to 8 nm east or west of you, with a Yasen-M sweeping ahead of it. It is heading for one of three patches of young ice 12 to 18 nm north of you, where it can break through and sit ready to fire its Bulavas. Find it and sink it before it does. Breaking through takes it about ten minutes, and you will hear it if you are close; another five and it is ready. The ice edge is 6 nm south of you: south of it is open water and an Il-38.',
    build(g, r, carry) {
      g.startClock = clock(5);
      g.timeLimit = 3.5 * 3600;
      pack(g, [edgeSouth(-6)], 3);
      const ks = keelField(r, 8, -14, 14, 2, 20);
      const patches = [-9, 0, 9].map((x) => ({ x: x + (r() * 2 - 1) * 2, y: 12 + r() * 6 }));
      const goal = patches[Math.floor(r() * 3)];
      const bp = { x: (r() < 0.5 ? -1 : 1) * (5 + r() * 3), y: -3 - r() * 2 };
      const bor = add(g, 'borei', 'Knyaz Pozharsky', 'enemy', bp, brg(bp, goal), 6, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      const ys = add(g, 'yasen', pick(carry, YASEN, 1), 'enemy', offset(bor, bor.hdg, 2), bor.hdg, 7, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      add(g, 'il38', 'Il-38N May', 'enemy', { x: 0, y: -60 }, 0, 230, { mode: 'search', center: { x: 0, y: -12 }, wp: { x: 0, y: -12 }, buoyT: 0, torps: 2, datum: null });
      setGoal(g, { targets: [bor.id], need: 1, win: 'Knyaz Pozharsky is breaking up under the ice. Sixteen Bulavas went down with her.', timeout: '' });
      g.flags.breakT = 0;
      g.script = (gg) => {
        keels(gg, ks);
        keepCourse(ys, brg(ys, offset(bor, bor.hdg, 2)), 7);
        if (!bor.alive) return;
        if (dist(bor, goal) > 0.3) return keepCourse(bor, brg(bor, goal), 6);
        keepCourse(bor, bor.hdg, 0);
        const t = ++gg.flags.breakT;
        if (t % 120 === 1 && dist(gg.own, bor) < 15) log(gg, 'contact', `Sonar: ice cracking and grinding, bearing ${fmtBrg(brg(gg.own, bor))}. Something big is pushing up into the ice.`);
        if (t === 600) { gg.env.polynyas.push(hole(bor, 0.3)); log(gg, 'danger', 'Intelligence: a Borei has broken through the ice. It is making ready to fire.', 'alarm'); }
        if (t >= 900) end(gg, false, 'Knyaz Pozharsky is up through the ice with her Bulavas ready to fire. The crisis has stepped up a rung.');
      };
    },
  },

  R9: {
    key: 'R9', title: 'Type 096', era: '2029', place: 'East Siberian Sea', date: 'November 2029, 0100', night: true,
    library: ['type096', 'type094', 'type095', 'yasen', 'virginia'],
    brief: 'China\'s newest missile boat, a Type 096, is on its first patrol under the Russian ice, about 5 nm east of you and heading east. Trail it, inside 8 nm, for 40 minutes of held contact, then come up in open water and send the report. It must never hear you: if it does, it will go deep and fast and the trail is blown. Don\'t sink it. It sprints and drifts, and changes depth; it threads its way through keel fields that reach down to 400 feet. There are two charted leads near its route, one about 12 nm east and one about 24 nm east, and you may find more. Lose it beyond 25 nm and the trail is cold.',
    build(g, r) {
      g.startClock = clock(1);
      g.timeLimit = 4 * 3600;
      const t0 = offset(g.own, 70 + r() * 40, 5 + r());
      pack(g, [hole(offset(offset(t0, 100, 12), 0, 4), 0.8), hole(offset(offset(t0, 100, 24), 180, 4), 1)]);
      const leads = [hole(offset(t0, 100 + (r() * 2 - 1) * 30, 8 + r() * 10), 0.5)];
      const ks = Array.from({ length: 10 }, (_, i) => keel(offset(offset(t0, 100, 3 + i * 3), r() * 360, r() * 1.5), 0.3 + r() * 0.3, 300 + r() * 100));
      const boom = add(g, 'type096', 'Changzheng 31', 'enemy', t0, 100, 5, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      setGoal(g, { protect: [boom.id], maxLosses: 0, lossText: 'We sank the Type 096. Orders were to trail it, and Beijing will call this a first strike on its deterrent.', timeout: 'Four hours, and the report never went out.' });
      g.flags.trail = 0;
      g.script = (gg) => {
        seekLeads(gg, leads);
        keels(gg, ks);
        if (!boom.alive) return;
        // Sprint and drift: 12 knots for five minutes in every 25, otherwise 5; a slow weave on its course.
        const sprint = gg.t % 1500 < 300;
        keepCourse(boom, norm(100 + Math.sin(gg.t / 1400) * 30), sprint ? 12 : 5);
        if (gg.t % 1800 === 900 && boom.ai!.mode === 'patrol') boom.ordDepth = boom.ordDepth === 2 ? 1 : 2;
        if (!gg.flags.blown && !weFired(gg) && boom.ai!.mode !== 'patrol') {
          gg.flags.blown = 1;
          end(gg, false, 'The Type 096 heard us. It has gone deep and fast, and the trail is blown.');
        }
        if (held(gg, boom) && dist(gg.own, boom) < 8) gg.flags.trail++;
        if (gg.flags.trail === 2400 && !gg.flags.ready) { gg.flags.ready = 1; log(gg, 'good', 'XO: forty minutes of track on the Type 096. Find open water and come up to send it.'); }
        if (gg.flags.ready && atPeriscopeDepth(gg)) end(gg, true, 'The report is out. Pacific Fleet has the Type 096\'s patrol track, tonals and all.');
        if (dist(gg.own, boom) > 25) end(gg, false, 'We lost the Type 096 under the ice. The trail is cold.');
      };
    },
  },

  R10: {
    key: 'R10', title: 'Trapped', era: '2029', place: 'Canada Basin', date: 'November 2029, 1500',
    library: ['type093b', 'type095', 'taigei', 'virginia'],
    brief: 'JS Hakugei hit a keel and is lying stopped under thick ice 4 nm north of you, flooded forward and nearly deaf. She has found a patch of thinner ice overhead and is working her sail up through it; she needs 90 minutes. A Chinese Type 093B heard the collision and is closing, about 11 nm from her; a second is expected within the hour. Keep Hakugei alive until she breaks out. If both Chinese boats are sunk before then, so much the better. There is no open water anywhere near: thick ice, and keels to 420 feet around her.',
    build(g, r, carry) {
      g.startClock = clock(15);
      g.timeLimit = 2 * 3600;
      pack(g);
      const hak = jp(g, 'JS Hakugei', { x: 0, y: 4 }, r() * 360, 2);
      hak.spd = hak.ordSpd = 0; hak.hp = 2;
      const ks = [...Array.from({ length: 6 }, (_, i) => keel(offset(hak, i * 60 + r() * 30, 1.2 + r()), 0.35, 330 + r() * 90)), ...keelField(r, 6, -12, 12, -8, 16)];
      const a = r() * 360;
      const one = add(g, 'type093b', pick(carry, SHANG, 4), 'enemy', offset(hak, a, 10 + r() * 2), 0, 7, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      const two = add(g, 'type093b', pick(carry, SHANG, 5), 'enemy', offset(hak, a + 120 + r() * 120, 20 + r() * 2), 0, 7, { mode: 'patrol', legT: 1e9, decoys: 2 }, 2);
      const foes = [one, two];
      setGoal(g, { targets: ids(foes), need: 2, protect: [hak.id], maxLosses: 0, lossText: 'JS Hakugei has been torpedoed under the ice. No one will get out.',
        win: 'Both Chinese boats are sunk. Hakugei can take her time.', timeout: 'Out of time.' });
      g.script = (gg) => {
        keels(gg, ks);
        phone(gg, [hak]);
        for (const f of foes) keepCourse(f, brg(f, hak), dist(f, hak) > 4 ? 8 : 4);
        skirmish(gg, [hak], foes, 3, 0.04, 0.12, 0.6);
        at(gg, 45 * 60, 'second', () => log(gg, 'warn', 'JS Hakugei on the acoustic link: a second submarine, faint, closing from another bearing.'));
        if (gg.t >= 90 * 60 && hak.alive) {
          gg.env.polynyas.push(hole(hak, 0.3));
          end(gg, true, 'JS Hakugei is up through the ice. USCGC Healy is on its way to take her crew off.');
        }
      };
    },
  },

  R11: {
    key: 'R11', title: 'Franz Josef Land', era: '2029', place: 'Off Franz Josef Land', date: 'November 2029, 0400', night: true,
    library: ['gorshkov', 'steregushchiy', 'ka27', 'yasen', 'virginia'],
    brief: 'Nagurskoye air base, 45 nm south-southwest of you on Alexandra Land, covers the Bastion. Land four Tomahawks on it within three hours. You are under the pack, with three patches of thin ice around you: about 3 nm north, 4 nm east and 5 nm west. Stop under one at 250 feet or shallower, at 3 knots or less, and in three minutes you can push the sail up through it, which opens a hole for masts and missiles. It is loud. The ice edge is 10 nm south, and the frigate Admiral Golovko patrols the open water beyond it with a Ka-27. Her Redut missiles will shoot down Tomahawks that fly within 10 nm of her: sink her, or fire from where the missiles pass well clear.',
    build(g, r, carry) {
      g.startClock = clock(4);
      g.timeLimit = 3 * 3600;
      pack(g, [edgeSouth(-10)], 3);
      const ks = keelField(r, 6, -12, 12, -8, 10);
      const patches = [{ x: (r() * 2 - 1), y: 3 }, { x: 4, y: (r() * 2 - 1) }, { x: -5, y: (r() * 2 - 1) }];
      const base = offset(g.own, 200, 45);
      ['Nagurskoye runway', 'Nagurskoye fighter shelters', 'Nagurskoye fuel depot'].forEach((name, i) => {
        const p = offset(base, i * 120, 0.6);
        g.sites.push({ id: -(i + 1), name, x: p.x, y: p.y, hits: 0 });
      });
      const gp = { x: -6 + r() * 12, y: -14 };
      const gor = add(g, 'gorshkov', 'Admiral Golovko', 'enemy', gp, 90, 10, { mode: 'patrol', legT: 1e9 });
      const helo = add(g, 'ka27', 'Ka-27PL Helix', 'enemy', offset(gp, 180, 3), 0, 120, { mode: 'search', center: { x: gp.x, y: -16 }, wp: offset({ x: gp.x, y: -16 }, r() * 360, 4), torps: 1, datum: null, hits: 0, dipT: 0 });
      void carry;
      setGoal(g, { targets: [], win: '', timeout: 'Three hours gone. Nagurskoye is still flying.' });
      g.flags.push = 0;
      g.script = (gg) => {
        keels(gg, ks);
        const o = gg.own;
        // Pushing up through thin ice: slow and shallow under a patch for three minutes.
        const under = patches.find((p) => dist(o, p) < 0.4 && !gg.env.polynyas.some((h) => dist(h, p) < 0.1));
        if (under && o.spd <= 3 && depthFeet(o.depthT) <= 260) {
          if (!gg.flags.push) log(gg, 'info', 'Stopped under thin ice. Planing up: the sail is against the ice.');
          if (++gg.flags.push >= 180) {
            gg.flags.push = 0;
            gg.env.polynyas.push(hole(under, 0.3));
            log(gg, 'good', 'The sail is through the ice. Masts and missiles are clear: come to periscope depth.', 'boom');
            if (gor.alive && dist(gor, o) < 18 && gor.ai!.mode === 'patrol') { gor.ai!.knows = { x: o.x + gg.r() - 0.5, y: o.y + gg.r() - 0.5, t: gg.t, deep: false }; gor.ai!.mode = 'attack'; }
          }
        } else gg.flags.push = 0;
        // The frigate walks the ice edge; she never goes into the pack.
        if (gor.alive) {
          keepCourse(gor, gor.x > 10 ? 270 : gor.x < -10 ? 90 : gor.hdg > 180 ? 270 : 90, 10);
          if (gor.y > -11) gor.ordHdg = 180;
          helo.ai!.center = { x: gor.x, y: Math.min(gor.y, -12) };
        }
        // A helicopter can't dip its sonar through the pack.
        if (helo.alive && helo.ai!.mode === 'dip' && underIce(gg, helo)) helo.ai!.dipT = 0;
        for (const w of gg.weapons) {
          if (w.dead || w.type !== 'tlam' || !gor.alive || gg.flags[`sam${w.id}`] || dist(w, gor) > 10) continue;
          gg.flags[`sam${w.id}`] = 1;
          if (gg.r() < 0.6) { w.dead = true; gg.flags.samKills = flag(gg, 'samKills') + 1; log(gg, 'warn', `Admiral Golovko's Redut missiles shot down ${w.label}.`); }
        }
        if (flag(gg, 'landHits') >= 4) end(gg, true, 'Four hits on Nagurskoye. The Bastion\'s northern air cover is out of action.');
      };
    },
  },

  R12: {
    key: 'R12', title: 'Bering Return', era: '2029', place: 'Bering Sea', date: 'November 2029, 1800', night: true,
    library: ['type093b', 'kilo', 'type095', 'yasen', 'il38', 'virginia'],
    brief: 'The pact is pulling boats back out of the Arctic before the pack closes the Bering Strait. Three are coming south through the strait, one after another, about 25 minutes apart: a Type 093B first, then a Kilo, then a Type 095. They are running for the Pacific, 16 nm south of you, and they are in a hurry: they will not stop to hunt you unless you have just shot at one of them. Sink two of them. If two get past you, they are gone. A November gale is blowing: wave noise covers the quiet ones, and the periscope sees half as far. An Il-38 is due over the exit in about 50 minutes to lay sonobuoys; it will see any missile you launch, so shoot it down or keep your ASROC in the tubes while it is about.',
    build(g, r, carry) {
      g.startClock = clock(18);
      g.timeLimit = 4 * 3600;
      g.env.sea = 5;
      const boats = [['type093b', pick(carry, SHANG, 2), 12, 0], ['kilo', pick(carry, KILO, 1), 9, 25], ['type095', pick(carry, T095, 3), 11, 50]].map(([cls, name, spd, late]) => {
        const p = { x: (r() * 2 - 1) * 5, y: 16 + (spd as number) * (late as number) / 60 };
        const exit = { x: (r() * 2 - 1) * 8, y: -16 };
        return { v: add(g, cls as string, name as string, 'enemy', p, brg(p, exit), spd as number, { mode: 'patrol', legT: 1e9, decoys: 2 }, r() < 0.5 ? 2 : 1), exit, spd: spd as number };
      });
      add(g, 'il38', 'Il-38N May', 'enemy', { x: 0, y: -190 }, 0, 230, { mode: 'search', center: { x: 0, y: -6 }, wp: { x: 0, y: -6 }, buoyT: 0, torps: 1, datum: null });
      setGoal(g, { targets: boats.map((b) => b.v.id), need: 2, win: 'Two of the three are sunk in the Bering Sea. They won\'t be back.', timeout: 'They waited out the gale and slipped past.' });
      g.flags.past = 0;
      g.script = (gg) => {
        inAHurry(gg, boats.map((b) => b.v));
        for (const b of boats) {
          keepCourse(b.v, brg(b.v, b.exit), b.spd);
          if (b.v.alive && b.v.y < -16) {
            b.v.alive = false; b.v.gone = true; gg.flags.past++;
            log(gg, 'danger', `${b.v.name} is past us and into the Pacific.`);
          }
        }
        if (gg.flags.past >= 2) end(gg, false, 'Two boats got past us into the Pacific.');
      };
    },
  },

  R13: {
    key: 'R13', title: 'Icebreaker', era: '2029', place: 'Chukchi Plateau', date: 'November 2029, 0900',
    library: ['xuelong2', 'arktika', 'type095', 'type093b', 'virginia'],
    brief: 'China\'s polar icebreaker Xue Long 2 is not doing research any more. She is breaking a path northeast across the Chukchi Plateau, surveying the ice and the bottom for the boats that will follow, and a Type 095 rides in her wake. She is about 10 nm northwest of you, heading 045 at 11 knots, ramming through the floes at full power. Sink her before she has crossed the plateau, three and a half hours from now. Every five minutes her ice-profiling sonar pings: it gives her away, but if you are inside 4 nm when it pings, she will have you, and so will the 095. Keels reach 400 feet; there is no open water.',
    build(g, r, carry) {
      g.startClock = clock(9);
      g.timeLimit = 3.5 * 3600;
      pack(g);
      const xp = offset(g.own, 300 + r() * 30, 9 + r() * 2);
      const xl = add(g, 'xuelong2', 'Xue Long 2', 'enemy', xp, 45, 11, go(45, 11, 1e9));
      const esc = add(g, 'type095', pick(carry, T095, 2), 'enemy', offset(xl, 225, 1.5), 45, 11, { mode: 'patrol', legT: 1e9, decoys: 2 }, 1);
      const ks = keelField(r, 12, -16, 22, -6, 26);
      setGoal(g, { targets: [xl.id], need: 1, win: 'Xue Long 2 is sinking in her own lane. The Chukchi Plateau stays closed to China\'s boats.', timeout: 'Xue Long 2 has crossed the plateau and the path is open.' });
      g.script = (gg) => {
        keels(gg, ks);
        if (xl.alive) keepCourse(esc, brg(esc, offset(xl, xl.hdg + 180, 1.5)), dist(esc, xl) > 2.5 ? 14 : 11);
        if (!xl.alive || gg.t % 300 !== 150) return;
        const d = dist(gg.own, xl);
        if (d < 20) log(gg, 'contact', `Sonar: active transmissions, bearing ${fmtBrg(brg(gg.own, xl))}. Xue Long 2's ice-profiling sonar.`, 'ping');
        if (d < 4) {
          log(gg, 'danger', 'That ping had us in it. The Type 095 will know where we are.', 'alarm');
          if (esc.alive && esc.ai) { esc.ai.knows = { x: gg.own.x, y: gg.own.y, t: gg.t, deep: gg.own.depthT > 1.5, exact: true }; if (esc.ai.mode === 'patrol') esc.ai.mode = 'attack'; }
        }
      };
    },
  },
};

// ---- Objectives -----------------------------------------------------------------------------------
const jpNote = (g: Game, names: RegExp) => {
  const v = g.vessels.filter((x) => x.side === 'allied' && names.test(x.name));
  return v.length ? `${listNames(v)}: ${v.map((x) => (isSunk(x) ? 'lost' : 'afloat')).join(', ')}.` : '';
};
const leadsOpen = (g: Game) => g.env.polynyas.filter((p) => p.r < 100).length;
export const extras: Record<MissionKey, ObjectiveFn> = {
  R1: (g, b) => [...b, watch('Let neither boat north past the Diomedes', !!g.over?.reason.includes('slipped north'), `12 nm north of where you started. ${jpNote(g, /Taigei/)}`)],
  R2: (g, b) => {
    const t = flag(g, 'atCamp');
    return [...b, watch('Keep it more than 2 nm from Ice Camp Nautilus', t >= 180, t ? `It has been under the camp for ${mins(t)} of 3 min.` : 'The camp is 5 nm north of where you started.')];
  },
  R3: (g, b) => [...b, { text: 'Find open water to use Tomahawk', state: leadsOpen(g) ? 'open' : 'failed', detail: 'Two charted leads: 6 nm south of where you started, and about 20 nm northeast. Optional: torpedoes work under the pack.' }],
  R4: (g, b) => {
    const hits = flag(g, 'landHits');
    return [
      { text: 'Find open water under the ice', state: leadsOpen(g) ? 'done' : 'open', detail: `${leadsOpen(g)} lead${leadsOpen(g) === 1 ? '' : 's'} found and open.` },
      { text: 'Land 4 Tomahawks on Nagurskoye', state: hits >= 4 ? 'done' : 'open', detail: `${hits} of 4 hits so far.` },
      ...b,
    ];
  },
  R6: (g, b) => [{ text: 'Either get 24 nm north, over the ridge', state: g.own.y >= 24 ? 'done' : 'open', detail: `${Math.max(0, g.own.y).toFixed(1)} of 24 nm so far. Keel hits: ${flag(g, 'keelHits')}.` },
    { text: 'Or sink both ambushers', state: b[0]?.state === 'done' ? 'done' : 'open', detail: b[0]?.detail }, ...b.slice(1)],
  R8: (g, b) => {
    const t = flag(g, 'breakT');
    return [...b, watch('Sink it before it breaks through the ice', t >= 900, t ? (t < 600 ? `It is breaking through: ${mins(600 - t)} until it is up.` : `It is through the ice: ${mins(900 - t)} until it can fire.`) : 'It hasn\'t reached the thin ice yet.')];
  },
  R9: (g) => {
    const trail = Math.min(flag(g, 'trail'), 2400);
    const t = g.vessels.find((v) => v.cls.key === 'type096');
    return [
      { text: 'Trail the Type 096 inside 8 nm for 40 minutes', state: trail >= 2400 ? 'done' : 'open', detail: trail >= 2400 ? 'Enough track.' : `${mins(trail)} of 40 min so far. Only time with the contact held counts.` },
      { text: 'Come up in open water and send the report', state: g.over?.win ? 'done' : 'open', detail: flag(g, 'ready') ? 'Ready: find a lead and come to periscope depth.' : 'After the trail.' },
      watch('Don\'t let it hear you', !!g.over?.reason.includes('heard us')),
      watch('Don\'t sink it', !!t && isSunk(t)),
      watch('Don\'t lose it: more than 25 nm away and the trail is cold', !!g.over?.reason.includes('cold')),
      ...baseObjectives(g).filter((o) => o.text.startsWith('Finish')),
    ];
  },
  R10: (g, b) => {
    const left = 90 * 60 - g.t;
    const hak = g.vessels.find((v) => v.name === 'JS Hakugei');
    return [
      { text: 'Keep JS Hakugei alive until she breaks out', state: hak && isSunk(hak) ? 'failed' : left <= 0 ? 'done' : 'open', detail: left > 0 ? `${mins(left)} until she is through the ice.` : 'She is through.' },
      { text: 'Or sink both Chinese boats', state: b[0]?.state === 'done' ? 'done' : 'open', detail: b[0]?.detail },
    ];
  },
  R11: (g, b) => {
    const hits = flag(g, 'landHits');
    const gor = g.vessels.find((v) => v.cls.key === 'gorshkov');
    return [
      { text: 'Break through the thin ice', state: leadsOpen(g) ? 'done' : 'open', detail: 'Stop under a patch at 250 feet or shallower, 3 knots or less, for three minutes.' },
      { text: 'Land 4 Tomahawks on Nagurskoye', state: hits >= 4 ? 'done' : 'open', detail: `${hits} of 4 hits so far.${flag(g, 'samKills') ? ` Admiral Golovko has shot down ${flag(g, 'samKills')}.` : ''}` },
      { text: 'Optional: sink Admiral Golovko', state: gor && isSunk(gor) ? 'done' : 'open', detail: 'Her Redut missiles shoot down Tomahawks that pass within 10 nm of her.' },
      ...b,
    ];
  },
  R12: (g, b) => [...b, watch('Don\'t let two boats past you to the south', flag(g, 'past') >= 2, `${flag(g, 'past')} of 2 have got through.`)],
};
const allied = (g: Game) => g.vessels.filter((v) => v.side === 'allied');
for (const k of ['R5', 'R7']) extras[k] = (g, b) => [...b, { text: 'Allied boats', state: 'open', detail: `${allied(g).map((v) => `${v.name} ${isSunk(v) ? 'lost' : 'afloat'}`).join(', ')}.` } as Objective];
