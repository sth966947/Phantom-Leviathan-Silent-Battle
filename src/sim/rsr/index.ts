// Red Storm Rising missions by key. A key names everything a mission is built from:
//   rsr:<force>:<place>:<year>:<boat>:<level>:<variant>[:sim]
// so `MISSIONS[key]` works for any of them (missions.ts resolves the key here and keeps the result),
// a saved campaign only has to keep keys, and a replay rebuilds the same scene.
import { mulberry32 } from '../math';
import { clock, type Mission, type ObjectiveFn } from '../kit';
import type { Mods } from '../sim';
import { BOATS, TANG, boatFor, inService, YEARS, type BoatKey, type BoatProfile, type Year } from '../boats';
import { FORCE_PLACES, planFor, type Force } from './forces';
import { PLACES } from './roster';

export { FORCES, FORCE_PLACES, type Force } from './forces';
export { PLACES } from './roster';

/** The four challenge levels: what the enemy hears, what a hit does to us, whether the crew offers matches, and the ER weight. */
export const LEVELS: { name: string; mods: Mods; er: number; note: string }[] = [
  { name: 'Introductory', mods: { ear: -3, dmg: 0.6, noId: false }, er: 0.6, note: 'Soviet sonar is a little deaf, and hits do less damage.' },
  { name: 'Normal', mods: { ear: 0, dmg: 1, noId: false }, er: 1, note: 'The game as it is.' },
  { name: 'Serious', mods: { ear: 3, dmg: 1, noId: false }, er: 1.3, note: 'Soviet sonar hears 3 dB better, and the bigger forces bring an extra escort.' },
  { name: 'Ultimate', mods: { ear: 5, dmg: 1.7, noId: true }, er: 1.6, note: 'Sharp Soviet ears, heavy damage, and no crew matches: identify every contact yourself.' },
];
/** The boats on offer: Tang as she is, and the 1980s hulls. */
export type Hull = 'tang' | BoatKey;
export const HULLS: Hull[] = [...BOATS];
export const hullFor = (h: Hull, y: Year): BoatProfile => (h === 'tang' ? TANG : boatFor(h, y));
export const hullOK = (h: Hull, y: Year) => h === 'tang' || inService(h, y);
export { YEARS };

export interface RsrKey { force: Force; place: string; year: Year; boat: Hull; level: number; variant: number; sim: boolean }
export const rsrKey = (k: RsrKey) => `rsr:${k.force}:${k.place}:${k.year}:${k.boat}:${k.level}:${k.variant}${k.sim ? ':sim' : ''}`;
export function parseKey(key: string): RsrKey | null {
  const p = key.split(':');
  if (p[0] !== 'rsr' || p.length < 7) return null;
  const [, force, place, year, boat, level, variant, sim] = p;
  if (!FORCE_PLACES[force as Force] || !PLACES[place] || !YEARS.includes(Number(year) as Year) || !HULLS.includes(boat as Hull)) return null;
  return { force: force as Force, place, year: Number(year) as Year, boat: boat as Hull, level: Number(level) || 0, variant: Number(variant) || 0, sim: sim === 'sim' };
}
/** Training fights: hits on us count but do no damage. */
export const TRAINING: Force[] = ['november', 'kashin'];

const MONTHS = ['May', 'June', 'July', 'August', 'September', 'October'];
const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

const built = new Map<string, { m: Mission; extra?: ObjectiveFn }>();
function resolve(key: string) {
  if (built.has(key)) return built.get(key)!;
  const k = parseKey(key);
  if (!k) return undefined;
  const place = PLACES[k.place], boat = hullFor(k.boat, k.year);
  const kr = mulberry32(hash(`${k.force}:${k.place}:${k.year}`) ^ k.variant);
  const plan = planFor({ force: k.force, place, year: k.year, kit: boat.kit, boat: boat.name, level: k.level, sim: k.sim, kr });
  const minute = Math.floor(kr() * 4) * 15, month = MONTHS[Math.floor(kr() * MONTHS.length)];
  const level = LEVELS[k.level] ?? LEVELS[1];
  const m: Mission = {
    key, title: plan.title, era: '2029', place: place.name,
    date: `${month} ${k.year}, ${String(plan.hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`,
    night: plan.hour < 4 || plan.hour >= 22,
    library: [...new Set([...plan.library, boat.cls])], brief: plan.brief,
    boat, mods: TRAINING.includes(k.force) ? { ...level.mods, dmg: 0 } : level.mods,
    build(g, r) {
      g.startClock = clock(plan.hour, minute);
      g.env.sea = place.sea;
      plan.build(g, r);
    },
  };
  const out = { m, extra: plan.extra };
  built.set(key, out);
  return out;
}
export const rsrMission = (key: string): Mission | undefined => resolve(key)?.m;
export const rsrExtra = (key: string): ObjectiveFn | undefined => resolve(key)?.extra;
export const isRsr = (key: string) => key.startsWith('rsr:');
