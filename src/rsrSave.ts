// The Red Storm Rising campaign kept in this browser, under its own key: one war at a time, saved
// after every mission. Nothing saved means the setup screen comes first.
import { newRsr, type RsrState } from './sim/rsr/campaign';
import type { Hull } from './sim/rsr';
import type { Year } from './sim/boats';

const KEY = 'phantom-leviathan-rsr';
/** The setup choices, kept so the setup screen and the battle sims open on the last ones picked. */
const PICK = 'phantom-leviathan-rsr-pick';
export interface Pick { boat: Hull; year: Year; level: number }

function load(): RsrState | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as RsrState;
    if (s?.v === 1 && Array.isArray(s.history) && Array.isArray(s.offer)) return s;
  } catch { /* nothing saved yet */ }
  return null;
}
let war = load();

export const currentRsr = () => war;
export function saveRsr() { try { if (war) localStorage.setItem(KEY, JSON.stringify(war)); else localStorage.removeItem(KEY); } catch { /* private window: keep it for this visit */ } }
export function startRsr(p: Pick) {
  war = newRsr((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0, p.boat, p.year, p.level);
  savePick(p);
  saveRsr();
  return war;
}
/** Back to the setup screen. */
export function endRsr() { war = null; saveRsr(); }

export function lastPick(): Pick {
  try {
    const p = JSON.parse(localStorage.getItem(PICK) ?? '') as Pick;
    if (p?.boat && p.year) return p;
  } catch { /* first visit */ }
  return { boat: 'la688', year: 1988, level: 1 };
}
export function savePick(p: Pick) { try { localStorage.setItem(PICK, JSON.stringify(p)); } catch { /* fine without it */ } }
