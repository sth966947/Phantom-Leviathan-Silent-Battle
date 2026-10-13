// Ship class cards: acoustic, performance and signature data. Game numbers tuned
// for play, using approximate public figures; not real acoustic intelligence.
//
// Signature: `tonals` are steady machinery lines in Hz, strongest first, so a faint
// contact shows only the first one or two. `blades` and `shaftHzPerKt` give the
// propeller blade-rate line (blades x shaft rate), which shifts with speed.

export type Kind = 'sub' | 'surface';
export type Nation = 'US' | 'UK' | 'Germany' | 'Russia';

export interface ClassCard {
  key: string;
  name: string;
  type: string;
  nation: Nation;
  kind: Kind;
  slBase: number;          // source level at 0 kt, dB
  maxSpd: number;          // kt
  threshold: number | null; // passive sonar detection threshold, null = no sonar
  hp: number;              // hits to sink, in weapon damage points
  tonals: number[];
  blades: number;
  shaftHzPerKt: number;
}

export const CLASSES: Record<string, ClassCard> = {
  virginia: {
    key: 'virginia', name: 'Virginia Block V', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 91, maxSpd: 32, threshold: 20, hp: 5, tonals: [60, 120], blades: 7, shaftHzPerKt: 0.08,
  },
  yasen: {
    key: 'yasen', name: 'Yasen-M', type: 'SSGN', nation: 'Russia', kind: 'sub',
    slBase: 94, maxSpd: 31, threshold: 23, hp: 5, tonals: [50, 9, 81, 150], blades: 7, shaftHzPerKt: 0.09,
  },
  akula: {
    key: 'akula', name: 'Improved Akula', type: 'SSN', nation: 'Russia', kind: 'sub',
    slBase: 97, maxSpd: 33, threshold: 23, hp: 5, tonals: [50, 9, 60, 140], blades: 7, shaftHzPerKt: 0.1,
  },
  bismarck: {
    key: 'bismarck', name: 'Bismarck', type: 'battleship', nation: 'Germany', kind: 'surface',
    slBase: 80, maxSpd: 30, threshold: null, hp: 12, tonals: [42, 16, 120, 58, 175], blades: 3, shaftHzPerKt: 0.15,
  },
  hipper: {
    key: 'hipper', name: 'Admiral Hipper (Prinz Eugen)', type: 'heavy cruiser', nation: 'Germany', kind: 'surface',
    slBase: 78, maxSpd: 32, threshold: null, hp: 7, tonals: [42, 64, 22, 150, 98], blades: 3, shaftHzPerKt: 0.17,
  },
  county: {
    key: 'county', name: 'County (Suffolk, Norfolk)', type: 'heavy cruiser', nation: 'UK', kind: 'surface',
    slBase: 79, maxSpd: 31, threshold: null, hp: 6, tonals: [50, 25, 110, 75, 160], blades: 3, shaftHzPerKt: 0.16,
  },
  // Library-only entries: they are never in the water in the current scenarios, but the
  // crew still weighs them, which keeps a thin signature honestly ambiguous.
  admiral: {
    key: 'admiral', name: 'Admiral (Hood)', type: 'battlecruiser', nation: 'UK', kind: 'surface',
    slBase: 82, maxSpd: 31, threshold: null, hp: 12, tonals: [50, 16, 120, 33, 190], blades: 3, shaftHzPerKt: 0.14,
  },
  kgv: {
    key: 'kgv', name: 'King George V', type: 'battleship', nation: 'UK', kind: 'surface',
    slBase: 81, maxSpd: 28, threshold: null, hp: 12, tonals: [50, 58, 25, 140, 175], blades: 3, shaftHzPerKt: 0.15,
  },
  merchant: {
    key: 'merchant', name: 'Merchant steamer', type: 'merchant', nation: 'UK', kind: 'surface',
    slBase: 84, maxSpd: 11, threshold: null, hp: 3, tonals: [30, 60, 90], blades: 4, shaftHzPerKt: 0.2,
  },
};

/** Which classes the signature library offers for each scenario's era. */
export const LIBRARY: Record<'1941' | '2029', string[]> = {
  '1941': ['bismarck', 'hipper', 'county', 'admiral', 'kgv', 'merchant'],
  '2029': ['yasen', 'akula', 'virginia'],
};
