// Balance captains for the modern mission files: one file here per file in src/sim/modern.
// A captain plays one tick of its mission from what the player could see. It returns true when it
// handled the tick itself, or the classes to hunt (and how sure a match must be) to hand the tick
// to the generic captain in balance.ts.
import type { Game } from '../../src/sim/sim';
import * as act1 from './act1';
import * as pacific from './pacific';
import * as pacific2 from './pacific2';
import * as gulf from './gulf';
import * as gulf2 from './gulf2';
import * as arctic from './arctic';
import * as home from './home';
import * as counter from './counter';
import * as finale from './finale';
import * as chance from './chance';

export interface CaptainState {
  legs: number; lastLeg: number; sprintT: number; deepT: number; cutBrg: number; cutT: number;
  /** Scratch space for a mission's own captain. */
  m: Record<string, number>;
}
export type Captain = (g: Game, i: number, s: CaptainState) => true | { extra?: string[]; minPct?: number } | void;

export const CAPTAINS: Record<string, Captain> = Object.assign({}, ...[act1, pacific, pacific2, gulf, gulf2, arctic, home, counter, finale, chance].map((f) => f.captains));
