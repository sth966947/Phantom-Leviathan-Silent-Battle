// Red Storm Rising missions, built to order: one Northern Fleet force to kill (force) from the year's
// roster, at a place in the Norwegian Sea. The force, its ships and their names, where they are and
// the briefing all come from the mission key's variant, so the briefing matches the scene; the game's
// own seed only jitters positions a little. Each mission names one force: other groups in the scene
// don't count. Every place the player has to act in or reach is marked on the plot.
import { brg, dist, fmtBrg, offset, type Vec } from '../math';
import { end, log, type Game, type Vessel } from '../sim';
import {
  add, arrive, at, byId, clock, flag, go, ids, isSunk, keepCourse, markAt, mins, pointDefence, screen, setGoal, watch,
  type Objective, type ObjectiveFn,
} from '../kit';
import { dipper, listen, patrolPlane, standBy, wander } from '../modern/fleets';
import type { Kit, Year } from '../boats';
import { CLASSES } from '../classes';
import { namer, rosterFor, type Place } from './roster';

/** The forces a mission can name as its target, and the battle-sim and training fights. */
export const FORCES = ['sag', 'asw', 'cvbg', 'amphib', 'convoy', 'wolfpack', 'bastion', 'spetsnaz', 'airbase'] as const;
export type Force = (typeof FORCES)[number] | 'duel' | 'cms' | 'november' | 'kashin';
/** Where each force can be met. */
export const FORCE_PLACES: Record<Force, string[]> = {
  sag: ['giuk', 'janmayen', 'lofoten', 'bear', 'faroes'],
  asw: ['bear', 'barents', 'lofoten', 'janmayen', 'northcape'],
  cvbg: ['janmayen', 'lofoten', 'bear', 'northcape'],
  amphib: ['vestfjord', 'iceland', 'trondheim', 'faroes', 'shetland', 'lofoten'],
  convoy: ['vestfjord', 'lofoten', 'trondheim', 'northcape'],
  wolfpack: ['giuk', 'faroes', 'iceland', 'shetland'],
  bastion: ['barents', 'kola'],
  spetsnaz: ['vestfjord', 'trondheim', 'shetland', 'iceland'],
  airbase: ['kola', 'northcape'],
  duel: ['giuk', 'janmayen', 'bear', 'lofoten'],
  cms: ['giuk', 'iceland', 'faroes'],
  november: ['giuk', 'janmayen'],
  kashin: ['barents', 'bear'],
};

export interface Spec {
  force: Force; place: Place; year: Year; kit: Kit; boat: string; level: number;
  /** A battle sim or training fight, not a campaign mission. */
  sim: boolean;
  /** The variant's own dice: everything the briefing describes. */
  kr: () => number;
}
export interface Plan {
  title: string; brief: string; library: string[]; hour: number;
  build: (g: Game, r: () => number) => void;
  extra?: ObjectiveFn;
}

// ---- Helpers ----------------------------------------------------------------------------------
const O: Vec = { x: 0, y: 0 };
const P = (b: number, rng: number) => offset(O, b, rng);
const jit = (p: Vec, r: () => number, s = 1) => ({ x: p.x + (r() * 2 - 1) * s, y: p.y + (r() * 2 - 1) * s });
const B = (b: number) => fmtBrg(b);
const cname = (cls: string) => CLASSES[cls].name;
/** The place in a sentence: "in the Barents Sea", "off the Faroes", "near Jan Mayen". */
export const where = (p: Place) => (p.name.startsWith('The ') ? `in the ${p.name.slice(4)}` : p.name[0].toLowerCase() + p.name.slice(1));
/** Where a group starts that runs `len` nm in to `to`, its track `ang`° off the line from `to` out to us: bearing and range from us. */
function runIn(to: Vec, len: number, ang: number): [number, number] {
  const p = offset(to, brg(to, O) + ang, len);
  return [Math.round(brg(O, p)), Math.round(dist(O, p))];
}
const sub = (g: Game, cls: string, name: string, p: Vec, hdg: number, spd: number, decoys = 2) =>
  add(g, cls, name, 'enemy', p, hdg, spd, { mode: 'patrol', legT: 600, decoys }, 1);
const air = (g: Game, cls: string, name: string, p: Vec, center: Vec) =>
  add(g, cls, name, 'enemy', p, brg(p, center), CLASSES[cls].maxSpd > 200 ? 230 : 120, CLASSES[cls].maxSpd > 200 ? patrolPlane(center, 1) : dipper(center));
/** "Udaloy, Krivak II and Grisha III" with names: "the Udaloy Admiral Tributs and the Krivak II Bodry". */
/** Every name, however many: "A, B and C". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const ships = (vs: { cls: string; name: string }[]) => andList(vs.map((v) => `${v.name} (${cname(v.cls)})`));
const an = (w: string) => `${/^[AEIOU]/.test(w) ? 'an' : 'a'} ${w}`;
const An = (w: string) => an(w).replace(/^a/, 'A');
/** Fail when too few targets are left afloat to make up the number. */
function short(g: Game, why: string) {
  const t = byId(g, g.goal.targets);
  if (t.filter(isSunk).length + t.filter((v) => v.alive).length < g.goal.need) end(g, false, why);
}
/** A group's leader for the plot, aircraft and escape checks: the first of `vs` still afloat. */
const lead = (vs: Vessel[]) => vs.find((v) => v.alive) ?? vs[0];
const escape = (g: Game, vs: Vessel[], nm: number, why: string) => { const l = lead(vs); if (l.alive && dist(g.own, l) > nm) end(g, false, why); };
/** The NATO side doesn't count air contacts as part of a force: only ships and boats. */
const sinkLine = (g: Game, text: string): Objective => {
  const t = byId(g, g.goal.targets), s = t.filter(isSunk).length;
  return { text, state: s >= g.goal.need ? 'done' : s + t.filter((v) => v.alive).length < g.goal.need ? 'failed' : 'open', detail: `${s} of ${g.goal.need} sunk. ${t.filter((v) => v.alive).map((v) => v.name).join(', ')} still afloat.` };
};
/** Patrol aircraft on task from the Kola fields part way through, working a box around `center()`. */
function planeAt(g: Game, t: number, cls: string, from: number, center: () => Vec) {
  at(g, t, `plane${cls}${t}`, () => {
    const c = center();
    air(g, cls, `${cname(cls)}`, offset(c, from, 45), c);
    log(g, 'warn', `ESM: a patrol aircraft's search radar to the ${from < 90 || from > 270 ? 'north' : 'south'}, closing. ${cname(cls)} coming on task.`);
  });
}

// ---- Surface action group ---------------------------------------------------------------------
function sag(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const fc = pick(R.flag), flagName = name(fc);
  const n = Math.min(4, 2 + Math.floor(kr() * 2) + (s.level >= 2 ? 1 : 0));
  const esc = Array.from({ length: n }, () => { const c = pick(R.escort); return { cls: c, name: name(c) }; });
  const b = Math.round(kr() * 360), rng = 22 + Math.round(kr() * 6), course = (b + 180 + Math.round((kr() * 2 - 1) * 15) + 360) % 360, spd = 12 + Math.round(kr() * 4);
  const need = n >= 4 ? 3 : 2;
  const hunter = kr() < 0.45 ? { cls: pick(R.ssn), name: name('sub') } : null;
  const hour = Math.floor(kr() * 24);
  return {
    title: `${cname(fc)} Group`, hour,
    library: [fc, ...esc.map((e) => e.cls), R.helo[0], ...(hunter ? [hunter.cls] : []), R.plane[0]],
    brief: `A Northern Fleet surface action group is at sea ${where(s.place)}: the flagship ${flagName} (${cname(fc)}) with ${ships(esc)}. They are about ${rng} nm from you, bearing ${B(b)}, making ${spd} knots on course ${B(course)}, out to cut the convoy routes. Sink ${need} of the ${n + 1} ships. Their missiles and guns shoot down most anti-ship missiles that come at them, so the torpedo is the surer weapon. ${An(cname(R.helo[0]))} flies off the flagship, and ${an(cname(R.plane[0]))} will come out from Kola to cover them. If the group gets more than 50 nm away from you, it's gone.${hunter ? ` ${An(cname(hunter.cls))} is sweeping ahead of the group; she isn't part of it and doesn't count, but she will hunt you.` : ''}`,
    build(g, r) {
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = b;
      const p = jit(P(b, rng), r);
      const fl = add(g, fc, flagName, 'enemy', p, course, spd, go(course, spd));
      const spots: [number, number][] = [[0, 4], [90, 3.5], [270, 3.5], [180, 3]];
      const scr = esc.map((e, i) => screen(g, fl, e.cls, [e.name], [spots[i]])[0]);
      const all = [fl, ...scr];
      const helo = air(g, R.helo[0], `${cname(R.helo[0])} (${flagName})`, offset(fl, course, 3), offset(fl, course, 7));
      const ssn = hunter ? sub(g, hunter.cls, hunter.name, offset(fl, course + 30, 10), course, 8) : null;
      setGoal(g, {
        targets: ids(all), need,
        win: `The ${flagName} group has lost ${need} ships, and what is left of it is turning back for the Kola Inlet.`,
        timeout: `The ${flagName} group is still at sea and through to the convoy routes.`,
      });
      g.script = (gg) => {
        pointDefence(gg, all, 0.5 + 0.08 * s.level);
        listen(gg, scr);
        standBy(gg, fl, scr, course);
        const l = lead(all);
        if (helo.alive) helo.ai!.center = offset(l, course, 7);
        if (ssn) keepCourse(ssn, course + Math.sin(gg.t / 600) * 40, 8);
        if (s.level >= 1) planeAt(gg, 3600, R.plane[0], course + 180, () => offset(lead(all), course, 6));
        short(gg, `Too many of the ${flagName} group are away. It is through.`);
        escape(gg, all, 50, `The ${flagName} group is more than 50 nm away and still going. We have lost it.`);
      };
    },
    extra: (g, base) => [sinkLine(g, `Sink ${need} of the ${flagName} group`), ...base.filter((o) => !o.text.startsWith('Sink')),
      watch('Don\'t let the group get 50 nm away', !!g.over?.reason.includes('lost it'), lead(byId(g, g.goal.targets)).alive ? `${dist(g.own, lead(byId(g, g.goal.targets))).toFixed(0)} nm away now.` : undefined)],
  };
}

// ---- ASW group ---------------------------------------------------------------------------------
function asw(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const fc = pick(R.hunter), flagName = name(fc);
  const n = 2 + (kr() < 0.5 ? 1 : 0) + (s.level >= 3 ? 1 : 0);
  const esc = Array.from({ length: n }, () => { const c = pick(R.corvette); return { cls: c, name: name(c) }; });
  const b = Math.round(kr() * 360), rng = 15 + Math.round(kr() * 5);
  const hour = Math.floor(kr() * 24);
  const ice = !!s.place.ice && kr() < 0.4;
  return {
    title: `${cname(fc)} Hunting Group`, hour,
    library: [fc, ...esc.map((e) => e.cls), ...R.helo, R.plane[0]],
    brief: `An ASW hunting group is sweeping ${where(s.place)} for NATO submarines, and it is between you and your patrol area: ${flagName} (${cname(fc)}) with ${ships(esc)}, about ${rng} nm from you, bearing ${B(b)}, coming your way at 10 knots. Helicopters work ahead of them with dipping sonar, and ${an(cname(R.plane[0]))} lays sonobuoys. They are hunting: one of the escorts is already out ahead on her own, and the rest will come at anything they hear. Sink ${n} of the ${n + 1} inside three hours.${ice ? ' The edge of the pack ice is close: the group keeps to the open water.' : ''}`,
    build(g, r) {
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = b;
      const p = jit(P(b, rng), r), course = brg(p, O);
      const fl = add(g, fc, flagName, 'enemy', p, course, 10, go(course, 10, 600));
      const spots: [number, number][] = [[0, 4], [70, 4], [290, 4], [180, 3]];
      const scr = esc.map((e, i) => screen(g, fl, e.cls, [e.name], [spots[i]])[0]);
      Object.assign(scr[0].ai!, { mode: 'patrol', legT: 400 }); // out ahead, hunting on her own
      const all = [fl, ...scr];
      const helos = R.helo.slice(0, 2).map((h, i) => air(g, h, `${cname(h)} ${i + 1}`, offset(fl, course, 3), offset(fl, course + (i ? 30 : -30), 8)));
      setGoal(g, {
        targets: ids(all), need: n,
        win: `${n} of the hunting group are sinking. The rest are pulling back to pick up survivors; the way through is open.`,
        timeout: 'Three hours, and the hunting group is still sweeping. The way through stays shut.',
      });
      g.script = (gg) => {
        pointDefence(gg, all, 0.45 + 0.08 * s.level);
        listen(gg, scr);
        const l = lead(all);
        if (l.ai?.mode === 'transit') l.ai.baseCourse = brg(l, O) + Math.sin(gg.t / 900) * 50;
        helos.forEach((h, i) => { if (h.alive && h.ai?.mode === 'search') h.ai.center = offset(l, l.hdg + (i ? 30 : -30), 8); });
        planeAt(gg, 1800, R.plane[0], course + 180, () => offset(lead(all), course, 8));
      };
    },
    extra: (g, base) => [sinkLine(g, `Sink ${n} of the ${flagName} group`), ...base.filter((o) => !o.text.startsWith('Sink'))],
  };
}

// ---- Carrier task force ------------------------------------------------------------------------
function cvbg(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const cc = R.carrier, cvName = name(cc), bc = pick(R.flag), bcName = name(bc);
  const n = 2 + (kr() < 0.5 ? 1 : 0) + (s.level >= 2 ? 1 : 0);
  const esc = Array.from({ length: n }, () => { const c = pick(['sovremenny', 'udaloy80', 'krivak']); return { cls: c, name: name(c) }; });
  const b = Math.round(kr() * 360), rng = 24 + Math.round(kr() * 5), course = (b + 180 + Math.round((kr() * 2 - 1) * 20) + 360) % 360, spd = 14;
  const hour = Math.floor(kr() * 24);
  return {
    title: `${cvName} Task Force`, hour,
    library: [cc, bc, ...esc.map((e) => e.cls), ...R.helo, R.plane[0]],
    brief: `The Northern Fleet has sent its carrier south. ${cc === 'kiev' ? 'The aviation cruiser' : 'The carrier'} ${cvName} is at the centre of a task force about ${rng} nm from you, bearing ${B(b)}, making ${spd} knots on course ${B(course)}, with ${bcName} (${cname(bc)}) ahead of her and ${ships(esc)} on the screen. Sink ${cvName}. She takes three torpedo hits; her screen stops nearly every missile. Helicopters work round the group and ${an(cname(R.plane[0]))} covers it from Kola. If she gets more than 40 nm away from you, she's gone. Nothing else in the task force counts.`,
    build(g, r) {
      g.timeLimit = 5 * 3600;
      g.own.hdg = g.own.ordHdg = b;
      const cv = add(g, cc, cvName, 'enemy', jit(P(b, rng), r), course, spd, go(course, spd));
      const scr = [
        ...screen(g, cv, bc, [bcName], [[0, 5]]),
        ...esc.map((e, i) => screen(g, cv, e.cls, [e.name], [[[70, 4], [290, 4], [180, 3.5], [130, 5]][i] as [number, number]])[0]),
      ];
      const helos = R.helo.slice(0, 2).map((h, i) => air(g, h, `${cname(h)} (${cvName}) ${i + 1}`, offset(cv, course, 3), offset(cv, course + (i ? 40 : -40), 8)));
      setGoal(g, { targets: [cv.id], need: 1, win: `${cvName} is going down. The Northern Fleet has lost its only carrier.`, timeout: `${cvName} is still at sea.` });
      g.script = (gg) => {
        pointDefence(gg, [cv, ...scr], 0.65 + 0.07 * s.level);
        listen(gg, scr);
        standBy(gg, cv, scr, course);
        const l = cv.alive ? cv : lead(scr);
        helos.forEach((h, i) => { if (h.alive && h.ai?.mode === 'search') h.ai.center = offset(l, course + (i ? 40 : -40), 8); });
        planeAt(gg, 5400, R.plane[0], course + 180, () => offset(cv.alive ? cv : lead(scr), course, 6));
        if (cv.alive && dist(gg.own, cv) > 40) end(gg, false, `${cvName} is more than 40 nm away and still going. We have lost her.`);
      };
    },
    extra: (g, base) => {
      const cv = byId(g, g.goal.targets)[0];
      return [...base, watch('Don\'t let her get 40 nm away', !!g.over?.reason.includes('lost her'), cv?.alive ? `${dist(g.own, cv).toFixed(0)} nm away now. Damage ${cv.cls.hp - cv.hp} of ${cv.cls.hp}.` : undefined)];
    },
  };
}

// ---- Amphibious group --------------------------------------------------------------------------
function amphib(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const lift = [{ cls: 'ivanrogov', name: name('ivanrogov') }, ...Array.from({ length: 2 + (kr() < 0.5 ? 1 : 0) }, () => ({ cls: 'ropucha80', name: name('ropucha80') }))];
  const esc = Array.from({ length: 2 + (kr() < 0.5 || s.level >= 2 ? 1 : 0) }, () => { const c = pick(R.corvette); return { cls: c, name: name(c) }; });
  const beachName = s.place.beach ?? 'the beach';
  const bb = (s.place.coast + Math.round((kr() * 2 - 1) * 15) + 360) % 360, beachR = 16 + Math.round(kr() * 4);
  // The group runs in along the coast, not over us: its track passes some 8 to 11 nm off, so we have to go and meet it.
  const [gb, gr] = runIn(P(bb, beachR), 18 + Math.round(kr() * 4), (kr() < 0.5 ? 1 : -1) * (28 + Math.round(kr() * 8)));
  const need = lift.length - 1;
  const hour = Math.floor(kr() * 6);
  return {
    title: `Landing at ${beachName}`, hour,
    library: ['ivanrogov', 'ropucha80', ...esc.map((e) => e.cls), R.helo[0], R.plane[0]],
    brief: `Soviet naval infantry are on their way to ${beachName}. The landing group is about ${gr} nm from you, bearing ${B(gb)}, steering for the beach at 15 knots: the landing ship ${lift[0].name} (Ivan Rogov class) and the Ropuchas ${andList(lift.slice(1).map((l) => l.name))}, with ${ships(esc)} as escort. The beach is about ${beachR} nm from you, bearing ${B(bb)}, and it is marked on the plot. Sink ${need} of the ${lift.length} landing ships before any of them reaches the beach: once one is there, her troops are ashore and the mission fails. The escorts don't count.`,
    build(g, r) {
      g.timeLimit = 4 * 3600;
      const beach = jit(P(bb, beachR), r, 0.5);
      const mark = markAt(g, beach, `Beach at ${beachName}`, 1.5);
      const p = jit(P(gb, gr), r);
      g.own.hdg = g.own.ordHdg = brg(O, p);
      const c = brg(p, beach);
      const lifts = lift.map((l, i) => add(g, l.cls, l.name, 'enemy', offset(p, c + 90, (i - (lift.length - 1) / 2) * 1.5), c, 15, go(c, 15, 1e9)));
      const scr = esc.map((e, i) => screen(g, lifts[0], e.cls, [e.name], [[[0, 3], [180, 3], [90, 3]][i] as [number, number]])[0]);
      const helo = air(g, R.helo[0], `${cname(R.helo[0])}`, offset(p, c, 3), offset(p, c, 6));
      setGoal(g, {
        targets: ids(lifts), need,
        win: `${need} landing ships are sinking. The landing at ${beachName} is off; the troops who got ashore are cut off.`,
        timeout: `The landing ships are still off ${beachName}, putting troops ashore.`,
      });
      g.flags.landed = 0;
      g.script = (gg) => {
        pointDefence(gg, [...lifts, ...scr], 0.4 + 0.08 * s.level);
        listen(gg, scr);
        for (const v of lifts) {
          if (!v.alive || !v.ai) continue;
          if (v.ai.mode === 'transit') { v.ai.baseCourse = brg(v, beach); v.ai.zig = 0; }
          if (arrive(gg, v, beach, 1.5)) { gg.flags.landed++; log(gg, 'danger', `${v.name} is on the beach at ${beachName} and putting her troops ashore.`); }
        }
        mark.label = flag(gg, 'landed') ? `Beach at ${beachName}: troops ashore` : `Beach at ${beachName}`;
        if (helo.alive && helo.ai?.mode === 'search') helo.ai.center = offset(lead(lifts), c, 6);
        if (flag(gg, 'landed') >= 1) end(gg, false, `A landing ship reached ${beachName}. Soviet troops are ashore.`);
        short(gg, `Too many landing ships got through to ${beachName}.`);
      };
    },
    extra: (g, base) => [...base, watch('Don\'t let a landing ship reach the beach', flag(g, 'landed') >= 1, (() => { const l = byId(g, g.goal.targets).filter((v) => v.alive); return l.length ? `The nearest is ${Math.min(...l.map((v) => dist(v, g.marks![0]))).toFixed(1)} nm from the beach.` : undefined; })())],
  };
}

// ---- Merchant convoy ---------------------------------------------------------------------------
function convoy(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const merch = [...Array.from({ length: 3 + Math.floor(kr() * 2) }, () => ({ cls: 'sovmerch', name: name('sovmerch') })), { cls: 'chilikin', name: name('chilikin') }];
  const esc = Array.from({ length: 2 + (s.level >= 1 ? 1 : 0) }, () => { const c = pick(R.corvette); return { cls: c, name: name(c) }; });
  const port = s.place.port ?? 'the port';
  const pb = (s.place.coast + Math.round((kr() * 2 - 1) * 20) + 360) % 360, pr = 22 + Math.round(kr() * 4);
  const [gb, gr] = runIn(P(pb, pr), 24 + Math.round(kr() * 4), (kr() < 0.5 ? 1 : -1) * (25 + Math.round(kr() * 10)));
  const need = merch.length - 1;
  const hour = Math.floor(kr() * 24);
  return {
    title: `Convoy for ${port}`, hour,
    library: ['sovmerch', 'chilikin', ...esc.map((e) => e.cls), R.helo[0], R.plane[0]],
    brief: `The Soviet army in Norway lives on what comes in by sea. A supply convoy is running for ${port}: ${andList(merch.map((m) => m.name))}, ${merch.length} ships in all, about ${gr} nm from you, bearing ${B(gb)}, at 14 knots, escorted by ${ships(esc)}. ${port} is about ${pr} nm from you, bearing ${B(pb)}, marked on the plot. Sink ${need} of the ${merch.length} supply ships before they get in. The escorts don't count.`,
    build(g, r) {
      g.timeLimit = 4 * 3600;
      const dest = jit(P(pb, pr), r, 0.5);
      const mark = markAt(g, dest, `${port} (convoy's destination)`, 2);
      const p = jit(P(gb, gr), r);
      g.own.hdg = g.own.ordHdg = brg(O, p);
      const c = brg(p, dest);
      const ms = merch.map((m, i) => add(g, m.cls, m.name, 'enemy', offset(offset(p, c + 90, ((i % 2) - 0.5) * 1.2), c, -Math.floor(i / 2) * 1.2), c, 14, go(c, 14)));
      const scr = esc.map((e, i) => screen(g, ms[0], e.cls, [e.name], [[[0, 3], [90, 3], [270, 3]][i] as [number, number]])[0]);
      setGoal(g, { targets: ids(ms), need, win: `${need} supply ships are on the bottom. ${port} won't get what it was waiting for.`, timeout: `The convoy is into ${port}.` });
      g.flags.inPort = 0;
      g.script = (gg) => {
        pointDefence(gg, [...ms, ...scr], 0.35 + 0.07 * s.level);
        listen(gg, scr);
        for (const v of ms) {
          if (!v.alive || !v.ai) continue;
          if (v.ai.mode === 'transit') v.ai.baseCourse = brg(v, dest);
          if (arrive(gg, v, dest, 2)) { gg.flags.inPort++; log(gg, 'warn', `${v.name} is inside the minefields at ${port}. ${gg.flags.inPort} in so far.`); }
        }
        mark.label = `${port}: ${flag(gg, 'inPort')} in`;
        if (s.level >= 1) planeAt(gg, 2700, R.plane[0], c + 180, () => offset(lead(ms), c, 5));
        short(gg, `Too many supply ships got into ${port}.`);
      };
    },
    extra: (g, base) => [...base, watch(`Sink them before they reach ${port}`, !!g.over && !g.over.win, `${flag(g, 'inPort')} in port so far; ${byId(g, g.goal.targets).length - g.goal.need} may get in.`)],
  };
}

// ---- Wolfpack ----------------------------------------------------------------------------------
function wolfpack(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const n = 3;
  const pack = Array.from({ length: n }, (_, i) => { const c = i === n - 1 ? pick(R.ssk) : pick(R.ssn); return { cls: c, name: name('sub') }; });
  const b = Math.round(kr() * 360), rng = 11 + Math.round(kr() * 4), cr = 22 + Math.round(kr() * 4);
  const need = n - 1;
  const hour = Math.floor(kr() * 24);
  return {
    title: 'The Wolfpack', hour,
    library: [...new Set(pack.map((p) => p.cls)), R.plane[0]],
    brief: `A NATO reinforcement convoy is crossing behind you, about ${cr} nm away, bearing ${B(b + 180)}: it is marked on the plot. Our SOSUS lines have a Soviet wolfpack heading for it, ${n} boats strung out across about 16 nm, the nearest about ${rng} nm from you, bearing ${B(b)}: ${andList(pack.map((p) => `${an(cname(p.cls))}`))}. Sink ${need} of them. If two reach the convoy, they will be in among the troopships and the mission fails. Each boat hunts you as soon as she hears you.`,
    build(g, r) {
      g.timeLimit = 5 * 3600;
      g.own.hdg = g.own.ordHdg = b;
      const cv = jit(P(b + 180, cr), r, 0.5);
      const mark = markAt(g, cv, 'NATO convoy', 6);
      const mid = jit(P(b, rng), r);
      const c = brg(mid, cv);
      const subs = pack.map((p, i) => sub(g, p.cls, p.name, offset(offset(mid, c + 90, (i - (n - 1) / 2) * 8), c, -i * 4), c, CLASSES[p.cls].type === 'SSK' ? 7 : 9, 1));
      setGoal(g, { targets: ids(subs), need, win: `${need} boats of the wolfpack are on the bottom. The convoy goes through.`, timeout: 'The wolfpack is still out there, and so is the convoy.' });
      g.flags.atConvoy = 0;
      g.script = (gg) => {
        for (const v of subs) {
          keepCourse(v, brg(v, cv) + Math.sin(gg.t / 500 + v.id) * 25, CLASSES[v.cls.key].type === 'SSK' ? 7 : 9);
          if (arrive(gg, v, cv, 6)) { gg.flags.atConvoy++; log(gg, 'danger', `Flash from the convoy escorts: a submarine is in among the convoy. Explosions. ${gg.flags.atConvoy} of 2.`, 'boom'); }
        }
        mark.label = `NATO convoy: ${flag(gg, 'atConvoy')} of 2 boats through`;
        if (s.level >= 1) planeAt(gg, 3600, R.plane[0], b, () => lead(subs));
        if (flag(gg, 'atConvoy') >= 2) end(gg, false, 'Two boats of the wolfpack got in among the convoy. The troopships are burning.');
        short(gg, 'Too many of the wolfpack got through to the convoy.');
      };
    },
    extra: (g, base) => [...base, watch('Don\'t let two boats reach the convoy', flag(g, 'atConvoy') >= 2, `${flag(g, 'atConvoy')} of 2 have got through.`)],
  };
}

// ---- Boomer in its bastion ---------------------------------------------------------------------
function bastion(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const ssbn = { cls: pick(R.ssbn), name: name('sub') }, guard = { cls: pick(R.ssn), name: name('sub') };
  const ice = !!s.place.ice;
  const pickets = ice ? [] : Array.from({ length: 1 + (s.level >= 2 ? 1 : 0) }, () => { const c = pick(R.corvette); return { cls: c, name: name(c) }; });
  const b = Math.round(kr() * 360), rng = 17 + Math.round(kr() * 4);
  const hour = Math.floor(kr() * 24);
  return {
    title: `The ${cname(ssbn.cls)} Bastion`, hour,
    library: [ssbn.cls, guard.cls, ...pickets.map((p) => p.cls), ...(ice ? [] : [R.plane[1]])],
    brief: `NATO is going after the missile boats in their bastions before Moscow thinks of using them. ${An(cname(ssbn.cls))} is on patrol in a bastion ${where(s.place)}, somewhere within 8 nm of a point about ${rng} nm from you, bearing ${B(b)}. The bastion is marked on the plot. She creeps along at 3 or 4 knots and is hard to hear. Sink her. The ${cname(guard.cls)} guarding her patrols the ring, and she doesn't count${pickets.length ? `; nor do ${ships(pickets)} on the edge of the bastion, or the ${cname(R.plane[1])} overhead` : ''}.${ice ? ' The bastion is under the pack ice: no periscope, no masts and no missiles, except in open water.' : ''}`,
    build(g, r) {
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = b;
      if (ice) { g.env.ice = true; g.env.polynyas = [{ ...P(b + 180, 3), r: 2 }]; g.env.sea = 1; }
      const c = jit(P(b, rng), r, 0.5);
      markAt(g, c, 'Bastion', 8);
      const boomer = sub(g, ssbn.cls, ssbn.name, offset(c, r() * 360, r() * 4), r() * 360, 4, 1);
      const ssn = sub(g, guard.cls, guard.name, offset(c, b, 7), b + 90, 6);
      const ps = pickets.map((p, i) => add(g, p.cls, p.name, 'enemy', offset(c, b + 180 + (i ? 50 : -50), 9), b + 90, 8, wander(offset(c, b + 180 + (i ? 50 : -50), 8), 4, 10)));
      let wp = offset(c, r() * 360, 4);
      setGoal(g, { targets: [boomer.id], need: 1, win: `${ssbn.name} is breaking up inside her own bastion. Moscow has one fewer missile boat.`, timeout: `${ssbn.name} is still on patrol in her bastion.` });
      g.script = (gg) => {
        if (dist(boomer, wp) < 0.5) wp = offset(c, gg.r() * 360, 2 + gg.r() * 4);
        keepCourse(boomer, brg(boomer, wp), 4);
        keepCourse(ssn, brg(ssn, c) + 90, 6); // she circles the ring
        listen(gg, ps);
        if (!ice && s.level >= 1) planeAt(gg, 2400, R.plane[1], b, () => offset(c, b + 180, 6));
      };
    },
  };
}

// ---- Spetsnaz submarine ------------------------------------------------------------------------
function spetsnaz(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const boat = { cls: pick(R.ssk), name: name('sub') }, patrol = { cls: 'grisha', name: name('grisha') };
  const where = s.place.beach ?? 'the coast';
  const db = (s.place.coast + Math.round((kr() * 2 - 1) * 20) + 360) % 360, dr = 15 + Math.round(kr() * 4);
  const sb = (s.place.coast + 180 + Math.round((kr() * 2 - 1) * 40) + 360) % 360, sr = 8 + Math.round(kr() * 3);
  const hour = 18 + Math.floor(kr() * 6);
  return {
    title: `Spetsnaz for ${where}`, hour,
    library: [boat.cls, 'grisha', R.helo[0], R.plane[0]],
    brief: `${An(cname(boat.cls))} is carrying a Spetsnaz team in to ${where}: they are to cut the radar and the airfield before the main attack. A P-3 had her on a sonobuoy an hour ago, about ${sr} nm from you, bearing ${B(sb)}, heading for her drop point at 6 or 7 knots. The drop point is about ${dr} nm from you, bearing ${B(db)}, marked on the plot. If she spends 10 minutes inside 2 nm of it, the team is ashore and the mission fails. Sink her. The Grisha ${patrol.name} is patrolling off the drop point to cover her; the Grisha doesn't count.`,
    build(g, r) {
      g.timeLimit = 4 * 3600;
      const drop = jit(P(db, dr), r, 0.5);
      const mark = markAt(g, drop, 'Spetsnaz drop point', 2);
      const p = jit(P(sb, sr), r, 3);
      g.own.hdg = g.own.ordHdg = sb;
      const k = sub(g, boat.cls, boat.name, p, brg(p, drop), 6);
      const gr = add(g, 'grisha', patrol.name, 'enemy', offset(drop, db + 180, 3), db + 90, 8, wander(offset(drop, db + 180, 3), 4, 9));
      setGoal(g, { targets: [k.id], need: 1, win: `${boat.name} is going down with the Spetsnaz team still aboard.`, timeout: `${boat.name} is still out there.` });
      g.flags.dropT = 0;
      g.script = (gg) => {
        keepCourse(k, brg(k, drop) + Math.sin(gg.t / 400) * 20, dist(k, drop) < 2 ? 1 : 6.5);
        if (k.alive && dist(k, drop) < 2) {
          if (!gg.flags.dropT) log(gg, 'danger', `Intelligence: the ${cname(boat.cls)} is at her drop point. Swimmers will be going out of her lockout trunk.`, 'alarm');
          gg.flags.dropT++;
        }
        mark.label = gg.flags.dropT ? `Drop point: team going ashore, ${mins(600 - flag(gg, 'dropT'))} left` : 'Spetsnaz drop point';
        listen(gg, [gr]);
        if (s.level >= 1) planeAt(gg, 3000, R.plane[0], db, () => offset(drop, db + 180, 5));
        if (flag(gg, 'dropT') >= 600) end(gg, false, `The Spetsnaz team is ashore near ${where}.`);
      };
    },
    extra: (g, base) => [...base, watch('Stop her before the team goes ashore', flag(g, 'dropT') >= 600, flag(g, 'dropT') ? `She is at the drop point: ${mins(600 - flag(g, 'dropT'))} left.` : 'She has not reached the drop point.')],
  };
}

// ---- Tomahawk strike on the Kola airfields -----------------------------------------------------
const FIELDS = ['Severomorsk-1', 'Severomorsk-3', 'Olenya', 'Kilpyavr', 'Monchegorsk'];
function airbase(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const fields = [...FIELDS].sort(() => kr() - 0.5).slice(0, 3).map((f, i) => ({ name: `${f} airfield`, b: (s.place.coast + (i - 1) * 18 + 360) % 360, r: 90 + Math.round(kr() * 50) }));
  const hunters = Array.from({ length: 2 + (s.level >= 3 ? 1 : 0) }, () => { const c = pick(R.corvette); return { cls: c, name: name(c) }; });
  const hb = (s.place.coast + Math.round((kr() * 2 - 1) * 60) + 360) % 360;
  const need = 4;
  const hour = 1 + Math.floor(kr() * 4);
  return {
    title: 'Strike on Kola', hour,
    library: [...hunters.map((h) => h.cls), ...R.helo, R.plane[0]],
    brief: `The Backfire bombers that savage the convoys fly from the Kola airfields. Close them: put ${need} Tomahawk hits on ${andList(fields.map((f) => f.name))}, all marked on the plot, inside three hours. The fields lie ${fields.map((f) => `${B(f.b)} at ${f.r} nm`).join(', ')}. Launch from 150 feet or shallower; each Tomahawk goes out of a torpedo tube${s.kit.mk48 === 'mk48' ? ' or a vertical tube' : ''}. SAM batteries round the fields shoot some down. Every launch is a flash on the surface: ${ships(hunters)} are patrolling about 12 nm from you, bearing ${B(hb)}, and about ten minutes after each salvo, helicopters or ${an(cname(R.plane[0]))} come to where they saw it.`,
    build(g, r) {
      g.timeLimit = 3 * 3600;
      g.own.hdg = g.own.ordHdg = s.place.coast;
      fields.forEach((f, i) => g.sites.push({ id: -(i + 1), name: f.name, ...P(f.b, f.r), hits: 0, kind: 'airfield' }));
      const hp = jit(P(hb, 12), r);
      const hs = hunters.map((h, i) => add(g, h.cls, h.name, 'enemy', offset(hp, i * 120, 2), r() * 360, 10, { mode: 'patrol', legT: 500 }));
      setGoal(g, { win: `${need} Tomahawks are through. The Kola airfields are cratered and the bombers are grounded.`, timeout: 'Three hours, and the Kola airfields are still flying.' });
      let seen = 0;
      g.script = (gg) => {
        // Each Tomahawk launch is seen: the hunters get a rough datum on it.
        const fired = gg.stats.fired.tlam ?? 0;
        if (fired > seen) {
          const first = !seen;
          seen = fired;
          const d = jit(gg.own, gg.r, 3);
          for (const h of hs) if (h.alive && h.ai && dist(h, d) < 25) h.ai.knows = { x: d.x, y: d.y, t: gg.t, deep: false };
          if (first || !gg.flags.airDue) { gg.flags.airDue = gg.t + 600; gg.flags.dx = d.x; gg.flags.dy = d.y; log(gg, 'warn', 'ESM: Soviet air search radar sweeping. They saw the launch, and aircraft will be over the datum in about ten minutes.'); }
        }
        if (gg.flags.airDue && gg.t >= gg.flags.airDue) {
          const d = { x: gg.flags.dx, y: gg.flags.dy }, n = gg.flags.airN = (gg.flags.airN ?? 0) + 1;
          gg.flags.airDue = 0;
          if (n === 2) air(gg, R.plane[0], cname(R.plane[0]), offset(d, s.place.coast, 20), d);
          else air(gg, R.helo[0], `${cname(R.helo[0])} ${n}`, offset(d, hb, 3), d);
        }
        // The SA-10 batteries round the fields.
        for (const w of gg.weapons) {
          if (w.dead || w.type !== 'tlam' || gg.flags[`sam${w.id}`] || dist(w, w.aim) > 15) continue;
          gg.flags[`sam${w.id}`] = 1;
          if (gg.r() < 0.2 + 0.07 * s.level) { w.dead = true; log(gg, 'warn', `${w.label} was shot down short of the target.`); }
        }
        if (flag(gg, 'landHits') >= need) end(gg, true, gg.goal.win);
      };
    },
    extra: (g, base) => [
      { text: `Put ${need} Tomahawk hits on the Kola airfields`, state: flag(g, 'landHits') >= need ? 'done' : 'open', detail: `${flag(g, 'landHits')} of ${need}. ${g.sites.map((x) => `${x.name.replace(' airfield', '')} ${x.hits}`).join(', ')}.` },
      ...base,
    ],
  };
}

// ---- Battle sims and training ------------------------------------------------------------------
function duel(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const foe = { cls: s.force === 'november' ? 'november' : pick(R.ssn), name: name('sub') };
  const train = s.force === 'november';
  const b = Math.round(kr() * 360), rng = (train ? 12 : 7) + Math.round(kr() * 3);
  return {
    title: train ? 'Training: Open Sea' : 'A Duel', hour: Math.floor(kr() * 24),
    library: [foe.cls],
    brief: train
      ? `A training fight with no real damage: hits on us count, but do no harm. A November-class boat, the loudest Soviet submarine at sea, is somewhere about ${rng} nm from you, bearing ${B(b)}. Find her, get a solution and sink her inside an hour.`
      : `One on one. ${An(cname(foe.cls))} is hunting ${where(s.place)}, about ${rng} nm from you, bearing ${B(b)}. She will hear you as soon as you are loud enough, and she shoots back. Sink her.`,
    build(g, r) {
      g.timeLimit = (train ? 1 : 3) * 3600;
      g.own.hdg = g.own.ordHdg = b;
      const k = sub(g, foe.cls, foe.name, jit(P(b, rng), r, 1.5), r() * 360, 6);
      setGoal(g, { targets: [k.id], need: 1, win: `${foe.name} is breaking up.`, timeout: `${foe.name} is still out there.` });
      g.script = (gg) => { if (k.ai?.mode === 'patrol') keepCourse(k, brg(k, gg.own) + 60 + Math.sin(gg.t / 600) * 50, 6); };
    },
  };
}
function cms(s: Spec): Plan {
  const { kr } = s, R = rosterFor(s.year), name = namer(kr), pick = <T>(a: T[]) => a[Math.floor(kr() * a.length)];
  const foe = { cls: pick(R.ssgn), name: name('sub') };
  const b = Math.round(kr() * 360), rng = 14 + Math.round(kr() * 3), cr = 22;
  return {
    title: 'The Cruise Missile Sub', hour: Math.floor(kr() * 24),
    library: [foe.cls],
    brief: `${An(cname(foe.cls))} cruise missile boat is closing on a NATO carrier group, marked on the plot about ${cr} nm behind you, bearing ${B(b + 180)}. She is about ${rng} nm from you, bearing ${B(b)}. Once she has spent three minutes inside 30 nm of the carrier group she will fire, and the mission fails. Sink her first.`,
    build(g, r) {
      g.timeLimit = 4 * 3600;
      g.own.hdg = g.own.ordHdg = b;
      const cv = P(b + 180, cr);
      const mark = markAt(g, cv, 'NATO carrier group', 30);
      const k = sub(g, foe.cls, foe.name, jit(P(b, rng), r, 1.5), b + 180, 10);
      setGoal(g, { targets: [k.id], need: 1, win: `${foe.name} is going down with her missiles still in their tubes.`, timeout: `${foe.name} is still closing on the carriers.` });
      g.flags.inRange = 0;
      g.script = (gg) => {
        keepCourse(k, brg(k, cv) + Math.sin(gg.t / 500) * 25, 10);
        if (k.alive && dist(k, cv) < 30) gg.flags.inRange++;
        mark.label = gg.flags.inRange ? `NATO carrier group: she fires in ${mins(180 - flag(gg, 'inRange'))}` : 'NATO carrier group (her firing range)';
        if (flag(gg, 'inRange') >= 180) end(gg, false, `${foe.name} has fired her missiles at the carrier group.`);
      };
    },
    extra: (g, base) => [...base, watch('Stop her before she fires', flag(g, 'inRange') >= 180, `${mins(Math.max(0, 180 - flag(g, 'inRange')))} of firing time left to her.`)],
  };
}
function kashin(s: Spec): Plan {
  const { kr } = s, name = namer(kr);
  const n = name('kashin'), b = Math.round(kr() * 360), rng = 10 + Math.round(kr() * 2);
  const ice = s.level >= 2;
  return {
    title: 'Training: The Kashin', hour: Math.floor(kr() * 24),
    library: ['kashin', 'ka25'],
    brief: `A training fight with no real damage: hits on us count, but do no harm. The Kashin-class destroyer ${n} is hunting you about ${rng} nm away, bearing ${B(b)}, with her hull sonar and torpedoes. Sink her inside an hour.${ice ? ' The fight is at the edge of the pack ice: she keeps to the open water, marked on the plot, and under the ice you can\'t use the periscope, masts or missiles.' : ''}`,
    build(g, r) {
      g.timeLimit = 3600;
      g.own.hdg = g.own.ordHdg = b;
      const p = jit(P(b, rng), r, 1);
      if (ice) { g.env.ice = true; g.env.polynyas = [{ ...p, r: 7 }]; g.env.sea = 1; markAt(g, p, 'Open water', 7); }
      const k = add(g, 'kashin', n, 'enemy', p, brg(p, O), 12, { mode: 'patrol', legT: 400 });
      setGoal(g, { targets: [k.id], need: 1, win: `${n} is sinking.`, timeout: `${n} is still hunting.` });
      g.script = (gg) => {
        if (k.ai?.mode !== 'patrol') return;
        if (ice && dist(k, p) > 6) k.ordHdg = brg(k, p);
        else keepCourse(k, brg(k, gg.own) + Math.sin(gg.t / 300) * 50, 10);
      };
    },
  };
}

const BUILDERS: Record<Force, (s: Spec) => Plan> = { sag, asw, cvbg, amphib, convoy, wolfpack, bastion, spetsnaz, airbase, duel, cms, november: duel, kashin };
export const planFor = (s: Spec) => BUILDERS[s.force](s);
export { clock };
