// The modern war's mission files, one per stretch of the war, each keyed by war mission id (A8, P3, R1...).
// The first Act 1 missions and the Kazan duel live in missions.ts under their own names (see PLAYABLE in warSave.ts).
import type { Mission, MissionKey, ObjectiveFn } from '../kit';
import * as act1 from './act1';
import * as pacific from './pacific';
import * as gulf from './gulf';
import * as arctic from './arctic';
import * as home from './home';
import * as counter from './counter';
import * as chance from './chance';

const FILES = [act1, pacific, gulf, arctic, home, counter, chance];
export const MODERN_MISSIONS: Record<MissionKey, Mission> = Object.assign({}, ...FILES.map((f) => f.missions));
export const MODERN_EXTRA: Record<MissionKey, ObjectiveFn> = Object.assign({}, ...FILES.map((f) => f.extras));
