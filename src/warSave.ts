// The modern war kept in this browser: one war at a time, saved after every mission.
import { newWar, type WarState } from './sim/war';
import type { MissionKey } from './sim/missions';

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

/** War missions that are built and playable, by the scenario that plays them. The rest can be marked won or lost for now. */
export const PLAYABLE: Partial<Record<string, MissionKey>> = { A2: 'duel' };
