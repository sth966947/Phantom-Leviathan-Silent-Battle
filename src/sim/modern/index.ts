// The modern war's mission files, one per stretch of the war, each keyed by war mission id (A8, P3, R1...).
// The first Act 1 missions and the Kazan duel live in missions.ts under their own names (see PLAYABLE in warSave.ts).
import type { Mission, MissionKey, ObjectiveFn } from '../kit';
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

const FILES = { act1, pacific, pacific2, gulf, gulf2, arctic, home, counter, finale, chance };
export const MODERN_MISSIONS: Record<MissionKey, Mission> = Object.assign({}, ...Object.entries(FILES).map(([file, f]) =>
  Object.fromEntries(Object.entries(f.missions).map(([k, m]) => [k, { ...m, file }]))));
export const MODERN_EXTRA: Record<MissionKey, ObjectiveFn> = Object.assign({}, ...Object.values(FILES).map((f) => f.extras));
