// The modern war kept in this browser: one war at a time, saved after every mission.
import { newWar, type WarState } from './sim/war';
import { MISSIONS, type MissionKey } from './sim/missions';

const KEY = 'phantom-leviathan-war';
const fresh = () => newWar((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0);

function load(): WarState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as WarState;
    if (s?.v === 1 && Array.isArray(s.history)) return s;
  } catch { /* nothing saved yet */ }
  return fresh();
}
let war = load();

export const currentWar = () => war;
export function saveWar() { try { localStorage.setItem(KEY, JSON.stringify(war)); } catch { /* private window: keep it for this visit */ } }
export function restartWar() { war = fresh(); saveWar(); }

/** The first Act 1 missions were built under their own names. Every other war mission is built under its war id. */
const NAMED: Record<string, MissionKey> = {
  A1: 'vortex', A2: 'duel', A3: 'raiderloose', A17: 'eyes', A4: 'giuk', A5: 'bremerhaven', A6: 'cables', A7: 'darkwater', A19: 'lostsister',
};
/** The scenario that plays a war mission, if it is built. The rest can be marked won or lost for now. */
export const playable = (id: string): MissionKey | undefined => NAMED[id] ?? (MISSIONS[id] ? id : undefined);
