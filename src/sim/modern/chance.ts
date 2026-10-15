// Modern war missions: chance. See the Modern Campaign Plan and src/sim/warData.ts for where each one sits in the war.
import type { Mission, MissionKey, ObjectiveFn } from '../kit';

export const missions: Record<MissionKey, Mission> = {};
export const extras: Record<MissionKey, ObjectiveFn> = {};
