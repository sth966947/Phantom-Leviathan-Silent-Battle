// Contact identification from the narrowband signature, the way a sonarman and the
// fire control computer would: compare the lines on display with each class card.
import { CLASSES, type ClassCard } from './classes';

export interface SigLine { hz: number; level: number }
export interface PropReadout { blades: number; shaftHz: number }
export interface SignatureView { lines: SigLine[]; prop: PropReadout | null; smear: boolean }
export interface Match { key: string; name: string; pct: number }

const LINE_STEP_DB = 4;   // each further tonal needs this much more signal excess
const PROP_SE = 6;        // signal excess needed to resolve the propeller blade rate

/** What the narrowband display shows for a contact at a given signal excess and speed. */
export function signatureView(cls: ClassCard, se: number, spd: number, jitter: () => number): SignatureView {
  const lines: SigLine[] = [];
  cls.tonals.forEach((hz, i) => {
    const margin = se - i * LINE_STEP_DB;
    if (margin > 0) lines.push({ hz: hz + jitter() * 0.6, level: Math.min(1, 0.35 + margin / 14) });
  });
  const shaftHz = cls.shaftHzPerKt * spd;
  let prop: PropReadout | null = null;
  if (se > PROP_SE && spd > 0.5) {
    prop = { blades: cls.blades, shaftHz: shaftHz + jitter() * 0.05 };
    lines.push({ hz: cls.blades * shaftHz, level: Math.min(1, 0.3 + (se - PROP_SE) / 16) });
  }
  // Cavitation smears the low end for surface ships at speed and subs sprinting shallow.
  const smear = cls.kind === 'surface' ? spd > 18 : spd > 22;
  return { lines, prop, smear };
}

/**
 * Likelihood of each library class given the tonals seen so far. Every visible line
 * that a class card has (within 2 Hz) counts for it; one it lacks counts against it.
 * A resolved blade count is strong evidence. Sighting by periscope is near-certain.
 */
export function matchClasses(view: SignatureView, library: string[], sighted: string | null): Match[] {
  const tonals = view.lines.slice(0, view.prop ? -1 : undefined);
  if (!tonals.length && !sighted) return [];
  const scores = library.map((key) => {
    const c = CLASSES[key];
    let p = 1;
    for (const l of tonals) p *= c.tonals.some((t) => Math.abs(t - l.hz) < 2) ? 0.9 : 0.08;
    if (view.prop) p *= c.blades === view.prop.blades ? 0.9 : 0.05;
    if (sighted) p *= sighted === key ? 50 : 0.02;
    return { key, name: c.name, p };
  });
  const total = scores.reduce((a, b) => a + b.p, 0);
  return scores
    .map(({ key, name, p }) => ({ key, name, pct: Math.round((100 * p) / total) }))
    .sort((a, b) => b.pct - a.pct);
}
