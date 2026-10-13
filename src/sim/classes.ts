// Ship class cards: acoustic, performance and signature data. Game numbers tuned
// for play, using approximate public figures; not real acoustic intelligence.
//
// Signature: `tonals` are steady machinery lines in Hz, strongest first, so a faint
// contact shows only the first one or two. `blades` and `shaftHzPerKt` give the
// propeller blade-rate line (blades x shaft rate), which shifts with speed.

export type Kind = 'sub' | 'surface' | 'air';
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
  emitter?: boolean;       // carries a search radar that our ESM can intercept
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
  // Aircraft: no acoustic signature. Found by radar, by eye at periscope depth, or by ESM.
  ar196: {
    key: 'ar196', name: 'Arado Ar 196', type: 'floatplane', nation: 'Germany', kind: 'air',
    slBase: 0, maxSpd: 165, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0,
  },
  il38: {
    key: 'il38', name: 'Il-38N May', type: 'maritime patrol aircraft', nation: 'Russia', kind: 'air',
    slBase: 0, maxSpd: 350, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  // Heard only while hovering with its dipping sonar in the water: rotor and gearbox lines.
  ka27: {
    key: 'ka27', name: 'Ka-27PL Helix', type: 'ASW helicopter', nation: 'Russia', kind: 'air',
    slBase: 104, maxSpd: 140, threshold: null, hp: 1, tonals: [14, 28, 115, 42], blades: 0, shaftHzPerKt: 0,
  },
};

/** Which classes the signature library offers for each scenario's era. */
export const LIBRARY: Record<'1941' | '2029', string[]> = {
  '1941': ['bismarck', 'hipper', 'county', 'admiral', 'kgv', 'merchant'],
  '2029': ['yasen', 'akula', 'virginia', 'ka27'],
};

/**
 * Recognition-book entries shown in the solution window: approximate public figures,
 * for the captain's reference. Max speed comes from the class card so it matches play.
 */
export interface Reference {
  displacement: string;
  armament: string[];
  armor: string;
  notes?: string;
}

export const REFERENCE: Record<string, Reference> = {
  bismarck: {
    displacement: '50,300 t full load',
    armament: ['8 × 38 cm guns in four twin turrets', '12 × 15 cm secondary guns', '16 × 10.5 cm AA guns', '2 to 4 Arado Ar 196 floatplanes'],
    armor: '320 mm belt, 360 mm turret faces, up to 120 mm deck',
    notes: 'Two forward and two aft turrets, single large funnel amidships. Three shafts.',
  },
  hipper: {
    displacement: '18,750 t full load',
    armament: ['8 × 20.3 cm guns in four twin turrets', '12 × 10.5 cm AA guns', '12 × 53.3 cm torpedo tubes', '3 Arado Ar 196 floatplanes'],
    armor: '80 mm belt, 30 mm deck',
    notes: 'Looks like a smaller Bismarck at a distance. Raked funnel cap. Three shafts.',
  },
  county: {
    displacement: '13,500 t full load',
    armament: ['8 × 8 in guns in four twin turrets', '8 × 4 in AA guns', 'Type 284/286 search radar'],
    armor: 'Belt up to 114 mm, boxed magazines',
    notes: 'Three tall funnels. Friendly: these are the shadowing cruisers. Four shafts.',
  },
  admiral: {
    displacement: '47,400 t full load',
    armament: ['8 × 15 in guns in four twin turrets', '14 × 4 in AA guns', '4 × 21 in torpedo tubes'],
    armor: '305 mm belt, thin deck (up to 76 mm)',
    notes: 'Long, low battlecruiser with two funnels. Four shafts.',
  },
  kgv: {
    displacement: '42,000 t full load',
    armament: ['10 × 14 in guns (two quadruple, one twin turret)', '16 × 5.25 in dual-purpose guns'],
    armor: '374 mm belt, up to 152 mm deck',
    notes: 'Two widely spaced funnels, slab-sided superstructure. Four shafts.',
  },
  merchant: {
    displacement: '5,000 to 10,000 GRT',
    armament: ['Usually unarmed', 'Sometimes one 4 in gun aft'],
    armor: 'None',
    notes: 'Single funnel, cargo derricks fore and aft. Slow single screw.',
  },
  yasen: {
    displacement: '13,800 t submerged',
    armament: ['10 × 533 mm torpedo tubes (UGST torpedoes)', '8 vertical silos, 32 Kalibr, Oniks or Zircon missiles'],
    armor: 'None. Double hull, low-magnetic steel',
    notes: 'Very quiet. Single shaft, seven-bladed screw.',
  },
  akula: {
    displacement: '12,770 t submerged',
    armament: ['4 × 533 mm and 4 × 650 mm torpedo tubes', 'Kalibr cruise missiles from the tubes'],
    armor: 'None. Double hull',
    notes: 'Noisier than Yasen. Pod on the rudder fin holds the towed array.',
  },
  virginia: {
    displacement: '10,200 t submerged',
    armament: ['4 × 533 mm torpedo tubes (Mk 48, Harpoon)', '12 vertical tubes plus Virginia Payload Module'],
    armor: 'None. Single hull',
    notes: 'Friendly. Pump-jet propulsor.',
  },
  ka27: {
    displacement: '12,000 kg max takeoff',
    armament: ['VGS-3 dipping sonar', 'Sonobuoys', '1 APR-3 or lightweight torpedo, or depth charges'],
    armor: 'None',
    notes: 'Coaxial rotors. Heard on sonar only while its sonar is in the water.',
  },
  il38: {
    displacement: '63,500 kg max takeoff',
    armament: ['Sonobuoys', 'Torpedoes and depth charges', 'Novella search radar and ESM'],
    armor: 'None',
    notes: 'Four turboprops. Its radar warning receiver hears our mast radar.',
  },
  ar196: {
    displacement: '3,700 kg max takeoff',
    armament: ['2 × 20 mm cannon', '1 to 2 × 7.92 mm machine guns', '2 × 50 kg bombs'],
    armor: 'None',
    notes: 'Twin-float monoplane, catapulted from German heavy ships.',
  },
};
