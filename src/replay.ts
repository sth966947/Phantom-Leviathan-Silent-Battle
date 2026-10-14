// Mission replay. The sim is deterministic: the same seed, the same carried-over history and
// the same orders given at the same simulated second play out the same mission. So a replay
// records only the seed and the captain's orders (and which contact was selected), then runs
// the mission again from the start with those orders, showing every ship where it really was.
import { orders, type Game } from './sim/sim';
import type { Carry, MissionKey } from './sim/missions';

interface Op { t: number; k: string; a: unknown[] }
export interface Recording { key: MissionKey; seed: number; carry: Carry; ops: Op[] }

type AnyOrder = (g: Game, ...a: unknown[]) => unknown;
const table = orders as unknown as Record<string, AnyOrder>;

let rec: Recording | null = null;
let live: Game | null = null; // the game being recorded
let lastSel: number | null = null;
let applying = false; // replaying a recorded order
let nested = 0; // orders that call other orders record only the outer call
let blocked: Game | null = null; // a replay game: the captain can't give it orders

// Wrap every order once, so that whoever calls it (keys, buttons, the plot, the windows) is recorded.
for (const k of Object.keys(table)) {
  const fn = table[k];
  table[k] = (g: Game, ...a: unknown[]) => {
    if (g === blocked && !applying) return;
    if (rec && g === live && nested === 0) rec.ops.push({ t: g.t, k, a });
    nested++;
    try { return fn(g, ...a); } finally { nested--; }
  };
}

export function record(g: Game, key: MissionKey, seed: number, carry: Carry) {
  rec = { key, seed, carry: { sunk: [...carry.sunk] }, ops: [] };
  live = g; lastSel = g.selected;
  blocked = null;
}
/** Call before each tick of the live game: notes a change of the selected contact. */
export function noteSelection(g: Game) {
  if (!rec || g !== live || g.selected === lastSel) return;
  lastSel = g.selected;
  rec.ops.push({ t: g.t, k: '_select', a: [g.selected] });
}
export const recording = () => rec;

/** Plays a recording back onto a fresh game built from the same seed. */
export class Player {
  private i = 0;
  constructor(readonly g: Game, private r: Recording) { g.replay = true; blocked = g; }
  /** Give the orders due by now; call before each tick. */
  apply() {
    const { g, r } = this;
    applying = true;
    try {
      while (this.i < r.ops.length && r.ops[this.i].t <= g.t) {
        const op = r.ops[this.i++];
        if (op.k === '_select') g.selected = op.a[0] as number | null;
        else table[op.k](g, ...op.a);
      }
    } finally { applying = false; }
  }
}
