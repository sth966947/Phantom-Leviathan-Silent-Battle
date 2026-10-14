// Ship class cards: acoustic, performance and signature data. Game numbers tuned
// for play, using approximate public figures; not real acoustic intelligence.
//
// Signature: `tonals` are steady machinery lines in Hz, strongest first, so a faint
// contact shows only the first one or two. `blades` and `shaftHzPerKt` give the
// propeller blade-rate line (blades x shaft rate), which shifts with speed.

export type Kind = 'sub' | 'surface' | 'air';
export type Nation = 'US' | 'UK' | 'Germany' | 'Russia' | 'Japan' | 'Netherlands' | 'Italy';

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

  // ---- Pacific and Atlantic WWII classes ----
  // Japanese capital ships share a strong 47 Hz turbo-generator line (Yamato and Shinano
  // share 44 Hz), and the fleet carriers of the Sōryū/Shōkaku/Taihō line share 53 Hz, so a
  // contact heard on one line alone stays ambiguous.
  akagi: {
    key: 'akagi', name: 'Akagi', type: 'aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 82, maxSpd: 31, threshold: null, hp: 9, tonals: [47, 18, 112, 66, 168], blades: 3, shaftHzPerKt: 0.14,
  },
  kaga: {
    key: 'kaga', name: 'Kaga', type: 'aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 83, maxSpd: 28, threshold: null, hp: 9, tonals: [47, 21, 104, 72], blades: 3, shaftHzPerKt: 0.15,
  },
  soryu: {
    key: 'soryu', name: 'Sōryū (Sōryū, Hiryū)', type: 'aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 80, maxSpd: 34, threshold: null, hp: 8, tonals: [53, 20, 126, 88, 182], blades: 3, shaftHzPerKt: 0.15,
  },
  shokaku: {
    key: 'shokaku', name: 'Shōkaku (Shōkaku, Zuikaku)', type: 'aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 81, maxSpd: 34, threshold: null, hp: 9, tonals: [53, 24, 118, 94, 172], blades: 3, shaftHzPerKt: 0.14,
  },
  taiho: {
    key: 'taiho', name: 'Taihō', type: 'armored aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 81, maxSpd: 33, threshold: null, hp: 10, tonals: [53, 26, 132, 78], blades: 3, shaftHzPerKt: 0.14,
  },
  shinano: {
    key: 'shinano', name: 'Shinano', type: 'aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 83, maxSpd: 27, threshold: null, hp: 14, tonals: [44, 14, 96, 138, 186], blades: 3, shaftHzPerKt: 0.13,
  },
  kongo: {
    key: 'kongo', name: 'Kongō (Hiei, Kirishima)', type: 'battleship', nation: 'Japan', kind: 'surface',
    slBase: 82, maxSpd: 30, threshold: null, hp: 11, tonals: [47, 16, 108, 62, 178], blades: 3, shaftHzPerKt: 0.15,
  },
  yamato: {
    key: 'yamato', name: 'Yamato (Yamato, Musashi)', type: 'battleship', nation: 'Japan', kind: 'surface',
    slBase: 84, maxSpd: 27, threshold: null, hp: 20, tonals: [44, 12, 92, 146, 190], blades: 3, shaftHzPerKt: 0.12,
  },
  takao: {
    key: 'takao', name: 'Takao (Atago, Maya, Chōkai)', type: 'heavy cruiser', nation: 'Japan', kind: 'surface',
    slBase: 79, maxSpd: 35, threshold: null, hp: 7, tonals: [55, 22, 102, 76, 164], blades: 3, shaftHzPerKt: 0.17,
  },
  agano: {
    key: 'agano', name: 'Agano (Yahagi)', type: 'light cruiser', nation: 'Japan', kind: 'surface',
    slBase: 78, maxSpd: 35, threshold: null, hp: 6, tonals: [55, 28, 134, 84], blades: 3, shaftHzPerKt: 0.18,
  },
  kagero: {
    key: 'kagero', name: 'Kagerō', type: 'destroyer', nation: 'Japan', kind: 'surface',
    slBase: 80, maxSpd: 35, threshold: null, hp: 3, tonals: [61, 31, 144, 92], blades: 3, shaftHzPerKt: 0.22,
  },
  // WWII submarines: speeds are submerged on batteries, and their hydrophones are poor.
  isub: {
    key: 'isub', name: 'I-16 (Type C1)', type: 'submarine', nation: 'Japan', kind: 'sub',
    slBase: 96, maxSpd: 8, threshold: 40, hp: 3, tonals: [37, 74, 11, 148], blades: 3, shaftHzPerKt: 0.2,
  },
  midget: {
    key: 'midget', name: 'Type A Ko-hyōteki', type: 'midget submarine', nation: 'Japan', kind: 'sub',
    slBase: 96, maxSpd: 19, threshold: 40, hp: 1, tonals: [83, 166, 41], blades: 3, shaftHzPerKt: 0.25,
  },
  picket: {
    key: 'picket', name: 'Picket boat (Nittō Maru)', type: 'guard boat', nation: 'Japan', kind: 'surface',
    slBase: 80, maxSpd: 9, threshold: null, hp: 2, tonals: [28, 56, 84, 14], blades: 4, shaftHzPerKt: 0.25,
  },
  kate: {
    key: 'kate', name: 'Nakajima B5N "Kate"', type: 'torpedo bomber', nation: 'Japan', kind: 'air',
    slBase: 0, maxSpd: 204, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0,
  },
  mavis: {
    key: 'mavis', name: 'Kawanishi H6K "Mavis"', type: 'flying boat', nation: 'Japan', kind: 'air',
    slBase: 0, maxSpd: 208, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0,
  },
  jake: {
    key: 'jake', name: 'Aichi E13A "Jake"', type: 'floatplane', nation: 'Japan', kind: 'air',
    slBase: 0, maxSpd: 202, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0,
  },
  tirpitz: {
    key: 'tirpitz', name: 'Tirpitz', type: 'battleship', nation: 'Germany', kind: 'surface',
    slBase: 80, maxSpd: 30, threshold: null, hp: 12, tonals: [42, 16, 120, 52, 175], blades: 3, shaftHzPerKt: 0.15,
  },
  typevii: {
    key: 'typevii', name: 'Type VIIC U-boat', type: 'submarine', nation: 'Germany', kind: 'sub',
    slBase: 96, maxSpd: 8, threshold: 40, hp: 3, tonals: [33, 66, 9, 132], blades: 3, shaftHzPerKt: 0.22,
  },
  fw200: {
    key: 'fw200', name: 'Focke-Wulf Fw 200 Condor', type: 'maritime patrol aircraft', nation: 'Germany', kind: 'air',
    slBase: 0, maxSpd: 194, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0,
  },
  yorktown: {
    key: 'yorktown', name: 'Yorktown (Hornet, Enterprise)', type: 'aircraft carrier', nation: 'US', kind: 'surface',
    slBase: 81, maxSpd: 32, threshold: null, hp: 9, tonals: [60, 19, 122, 86, 178], blades: 3, shaftHzPerKt: 0.14,
  },
  fletcher: {
    key: 'fletcher', name: 'Fletcher', type: 'destroyer', nation: 'US', kind: 'surface',
    slBase: 80, maxSpd: 36, threshold: null, hp: 3, tonals: [60, 29, 150, 96], blades: 3, shaftHzPerKt: 0.21,
  },
  wickes: {
    key: 'wickes', name: 'Wickes (USS Ward)', type: 'destroyer', nation: 'US', kind: 'surface',
    slBase: 81, maxSpd: 35, threshold: null, hp: 3, tonals: [50, 33, 100, 156], blades: 3, shaftHzPerKt: 0.22,
  },
  atlanta: {
    key: 'atlanta', name: 'Atlanta (Atlanta, Juneau)', type: 'light cruiser', nation: 'US', kind: 'surface',
    slBase: 79, maxSpd: 33, threshold: null, hp: 6, tonals: [60, 27, 138, 82, 170], blades: 3, shaftHzPerKt: 0.18,
  },
  flower: {
    key: 'flower', name: 'Flower', type: 'corvette', nation: 'UK', kind: 'surface',
    slBase: 81, maxSpd: 16, threshold: null, hp: 3, tonals: [30, 15, 60, 104], blades: 3, shaftHzPerKt: 0.2,
  },
  liberty: {
    key: 'liberty', name: 'Liberty ship', type: 'merchant', nation: 'US', kind: 'surface',
    slBase: 84, maxSpd: 11, threshold: null, hp: 3, tonals: [26, 52, 78, 12], blades: 4, shaftHzPerKt: 0.2,
  },
  maru: {
    key: 'maru', name: 'Maru transport', type: 'transport', nation: 'Japan', kind: 'surface',
    slBase: 83, maxSpd: 12, threshold: null, hp: 3, tonals: [55, 27, 110, 83], blades: 4, shaftHzPerKt: 0.21,
  },
  frachter: {
    key: 'frachter', name: 'German freighter', type: 'merchant', nation: 'Germany', kind: 'surface',
    slBase: 84, maxSpd: 11, threshold: null, hp: 3, tonals: [50, 25, 100, 75], blades: 4, shaftHzPerKt: 0.19,
  },
  // ---- 1942 additions: Java Sea, Coral Sea, Solomons and the Arctic ----
  // Japanese cruisers keep the 55 Hz line, Allied European ships 50 Hz, US ships 60 Hz.
  renown: {
    key: 'renown', name: 'Renown (Renown, Repulse)', type: 'battlecruiser', nation: 'UK', kind: 'surface',
    slBase: 82, maxSpd: 31, threshold: null, hp: 10, tonals: [50, 17, 124, 37, 184], blades: 3, shaftHzPerKt: 0.14,
  },
  g4m: {
    key: 'g4m', name: 'Mitsubishi G4M "Betty"', type: 'land-based bomber', nation: 'Japan', kind: 'air',
    slBase: 0, maxSpd: 230, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0,
  },
  ryujo: {
    key: 'ryujo', name: 'Light carrier (Ryūjō, Shōhō, Zuihō)', type: 'light aircraft carrier', nation: 'Japan', kind: 'surface',
    slBase: 79, maxSpd: 28, threshold: null, hp: 6, tonals: [53, 30, 140, 70], blades: 3, shaftHzPerKt: 0.17,
  },
  myoko: {
    key: 'myoko', name: 'Myōkō (Nachi, Haguro, Ashigara)', type: 'heavy cruiser', nation: 'Japan', kind: 'surface',
    slBase: 79, maxSpd: 34, threshold: null, hp: 7, tonals: [55, 23, 110, 80, 166], blades: 3, shaftHzPerKt: 0.17,
  },
  aoba: {
    key: 'aoba', name: 'Aoba / Furutaka (Aoba, Kinugasa, Furutaka, Kako)', type: 'heavy cruiser', nation: 'Japan', kind: 'surface',
    slBase: 78, maxSpd: 33, threshold: null, hp: 6, tonals: [55, 25, 98, 72], blades: 3, shaftHzPerKt: 0.18,
  },
  sendai: {
    key: 'sendai', name: '5,500-ton light cruiser (Jintsū, Nagara, Tama, Abukuma)', type: 'light cruiser', nation: 'Japan', kind: 'surface',
    slBase: 79, maxSpd: 35, threshold: null, hp: 5, tonals: [55, 32, 128, 90, 174], blades: 3, shaftHzPerKt: 0.19,
  },
  mogami: {
    key: 'mogami', name: 'Mogami (Mogami, Mikuma)', type: 'heavy cruiser', nation: 'Japan', kind: 'surface',
    slBase: 79, maxSpd: 35, threshold: null, hp: 7, tonals: [55, 20, 116, 68, 158], blades: 3, shaftHzPerKt: 0.17,
  },
  scharnhorst: {
    key: 'scharnhorst', name: 'Scharnhorst (Scharnhorst, Gneisenau)', type: 'battleship', nation: 'Germany', kind: 'surface',
    slBase: 81, maxSpd: 31, threshold: null, hp: 11, tonals: [42, 18, 112, 61, 168], blades: 3, shaftHzPerKt: 0.15,
  },
  usca: {
    key: 'usca', name: 'US heavy cruiser (Northampton, Houston, New Orleans, Astoria, Quincy, Vincennes, Minneapolis, Salt Lake City)', type: 'heavy cruiser', nation: 'US', kind: 'surface',
    slBase: 79, maxSpd: 32, threshold: null, hp: 7, tonals: [60, 23, 114, 79, 162], blades: 3, shaftHzPerKt: 0.17,
  },
  brooklyn: {
    key: 'brooklyn', name: 'Brooklyn (Honolulu, Helena)', type: 'light cruiser', nation: 'US', kind: 'surface',
    slBase: 79, maxSpd: 32, threshold: null, hp: 6, tonals: [60, 31, 126, 88, 182], blades: 3, shaftHzPerKt: 0.18,
  },
  // Turbo-electric drive: a loud, clean motor line at 15 Hz under the 60 Hz generator.
  lexington: {
    key: 'lexington', name: 'Lexington (Lexington, Saratoga)', type: 'aircraft carrier', nation: 'US', kind: 'surface',
    slBase: 83, maxSpd: 33, threshold: null, hp: 10, tonals: [60, 15, 120, 180, 94], blades: 3, shaftHzPerKt: 0.14,
  },
  deruyter: {
    key: 'deruyter', name: 'Dutch light cruiser (De Ruyter, Java)', type: 'light cruiser', nation: 'Netherlands', kind: 'surface',
    slBase: 79, maxSpd: 32, threshold: null, hp: 5, tonals: [50, 26, 106, 66], blades: 3, shaftHzPerKt: 0.18,
  },
  town: {
    key: 'town', name: 'Town (Belfast, Sheffield)', type: 'light cruiser', nation: 'UK', kind: 'surface',
    slBase: 79, maxSpd: 32, threshold: null, hp: 6, tonals: [50, 29, 118, 86, 166], blades: 3, shaftHzPerKt: 0.17,
  },
  // ---- 1939 to 1941: River Plate, Narvik, Matapan and the Mediterranean ----
  // Italian ships share a 39 Hz generator line. The Deutschlands run on diesels: firing-rate
  // lines instead of turbine whine, unlike anything else in the book.
  deutschland: {
    key: 'deutschland', name: 'Deutschland (Admiral Graf Spee, Admiral Scheer)', type: 'heavy cruiser', nation: 'Germany', kind: 'surface',
    slBase: 82, maxSpd: 28, threshold: null, hp: 8, tonals: [28, 56, 7, 84, 112], blades: 3, shaftHzPerKt: 0.16,
  },
  zerstorer: {
    key: 'zerstorer', name: 'Zerstörer 1934/1936 (Z-class destroyers)', type: 'destroyer', nation: 'Germany', kind: 'surface',
    slBase: 81, maxSpd: 38, threshold: null, hp: 3, tonals: [42, 34, 146, 100], blades: 3, shaftHzPerKt: 0.22,
  },
  cavour: {
    key: 'cavour', name: 'Conte di Cavour (Giulio Cesare, Conte di Cavour)', type: 'battleship', nation: 'Italy', kind: 'surface',
    slBase: 81, maxSpd: 28, threshold: null, hp: 11, tonals: [39, 16, 104, 58, 172], blades: 2, shaftHzPerKt: 0.16,
  },
  littorio: {
    key: 'littorio', name: 'Littorio (Vittorio Veneto, Littorio)', type: 'battleship', nation: 'Italy', kind: 'surface',
    slBase: 82, maxSpd: 30, threshold: null, hp: 13, tonals: [39, 14, 98, 66, 188], blades: 3, shaftHzPerKt: 0.14,
  },
  zara: {
    key: 'zara', name: 'Zara (Zara, Fiume, Pola)', type: 'heavy cruiser', nation: 'Italy', kind: 'surface',
    slBase: 79, maxSpd: 32, threshold: null, hp: 7, tonals: [39, 21, 108, 74, 160], blades: 3, shaftHzPerKt: 0.17,
  },
  soldati: {
    key: 'soldati', name: 'Soldati (Italian destroyers)', type: 'destroyer', nation: 'Italy', kind: 'surface',
    slBase: 81, maxSpd: 38, threshold: null, hp: 3, tonals: [39, 35, 152, 104], blades: 3, shaftHzPerKt: 0.22,
  },
  qe: {
    key: 'qe', name: 'Queen Elizabeth (Warspite)', type: 'battleship', nation: 'UK', kind: 'surface',
    slBase: 81, maxSpd: 24, threshold: null, hp: 12, tonals: [50, 14, 100, 46, 176], blades: 3, shaftHzPerKt: 0.15,
  },
  leander: {
    key: 'leander', name: 'Leander (Ajax, Achilles, Perth)', type: 'light cruiser', nation: 'UK', kind: 'surface',
    slBase: 79, maxSpd: 32, threshold: null, hp: 5, tonals: [50, 24, 132, 78], blades: 3, shaftHzPerKt: 0.18,
  },
  hclass: {
    key: 'hclass', name: 'British fleet destroyer (Hardy, Hotspur, Cossack)', type: 'destroyer', nation: 'UK', kind: 'surface',
    slBase: 80, maxSpd: 36, threshold: null, hp: 3, tonals: [50, 36, 148, 102], blades: 3, shaftHzPerKt: 0.22,
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
  /** Photo under public/ships/, free to use, with its credit line. Falls back to the drawn silhouette. */
  photo?: { file: string; credit: string };
}

export const REFERENCE: Record<string, Reference> = {
  bismarck: {
    photo: { file: 'bismarck.jpg', credit: 'Bismarck in Grimstadfjord, Norway, May 1941. Photo: Paul S. Schmalenbach · Public domain · Wikimedia Commons' },
    displacement: '50,300 t full load',
    armament: ['8 × 38 cm guns in four twin turrets', '12 × 15 cm secondary guns', '16 × 10.5 cm AA guns', '2 to 4 Arado Ar 196 floatplanes'],
    armor: '320 mm belt, 360 mm turret faces, up to 120 mm deck',
    notes: 'Two forward and two aft turrets, single large funnel amidships. Three shafts.',
  },
  hipper: {
    photo: { file: 'hipper.jpg', credit: 'Admiral Hipper off Norway, 1942. Photo: U.S. Navy · Public domain · Wikimedia Commons' },
    displacement: '18,750 t full load',
    armament: ['8 × 20.3 cm guns in four twin turrets', '12 × 10.5 cm AA guns', '12 × 53.3 cm torpedo tubes', '3 Arado Ar 196 floatplanes'],
    armor: '80 mm belt, 30 mm deck',
    notes: 'Looks like a smaller Bismarck at a distance. Raked funnel cap. Three shafts.',
  },
  county: {
    photo: { file: 'county.jpg', credit: 'HMS Suffolk (County-class cruiser). Photo: Royal Navy official photographer · Public domain (UK Crown Copyright expired) · Wikimedia Commons' },
    displacement: '13,500 t full load',
    armament: ['8 × 8 in guns in four twin turrets', '8 × 4 in AA guns', 'Type 284/286 search radar'],
    armor: 'Belt up to 114 mm, boxed magazines',
    notes: 'Three tall funnels. Friendly: these are the shadowing cruisers. Four shafts.',
  },
  admiral: {
    photo: { file: 'admiral.jpg', credit: 'HMS Hood, 17 March 1924. Photo: Allan C. Green (State Library of Victoria); restoration by Adam Cuerden · Public domain · Wikimedia Commons' },
    displacement: '47,400 t full load',
    armament: ['8 × 15 in guns in four twin turrets', '14 × 4 in AA guns', '4 × 21 in torpedo tubes'],
    armor: '305 mm belt, thin deck (up to 76 mm)',
    notes: 'Long, low battlecruiser with two funnels. Four shafts.',
  },
  kgv: {
    photo: { file: 'kgv.jpg', credit: 'HMS King George V, 1941. Photo: Royal Navy · Public domain (UK Crown Copyright expired) · Wikimedia Commons' },
    displacement: '42,000 t full load',
    armament: ['10 × 14 in guns (two quadruple, one twin turret)', '16 × 5.25 in dual-purpose guns'],
    armor: '374 mm belt, up to 152 mm deck',
    notes: 'Two widely spaced funnels, slab-sided superstructure. Four shafts.',
  },
  merchant: {
    photo: { file: 'merchant.jpg', credit: 'Cargo ship Empire Halley on sea trials, 1940s. Photo: Tyne & Wear Archives & Museums · No known copyright restrictions (Flickr Commons) · Wikimedia Commons' },
    displacement: '5,000 to 10,000 GRT',
    armament: ['Usually unarmed', 'Sometimes one 4 in gun aft'],
    armor: 'None',
    notes: 'Single funnel, cargo derricks fore and aft. Slow single screw.',
  },
  yasen: {
    photo: { file: 'yasen.jpg', credit: 'K-560 Severodvinsk (Yasen class). Photo: Ministry of Defence of the Russian Federation (mil.ru) · CC BY 4.0 · Wikimedia Commons' },
    displacement: '13,800 t submerged',
    armament: ['10 × 533 mm torpedo tubes (UGST torpedoes)', '8 vertical silos, 32 Kalibr, Oniks or Zircon missiles'],
    armor: 'None. Double hull, low-magnetic steel',
    notes: 'Very quiet. Single shaft, seven-bladed screw.',
  },
  akula: {
    photo: { file: 'akula.jpg', credit: 'Akula-class submarine. Photo: U.S. Navy · Public domain · Wikimedia Commons' },
    displacement: '12,770 t submerged',
    armament: ['4 × 533 mm and 4 × 650 mm torpedo tubes', 'Kalibr cruise missiles from the tubes'],
    armor: 'None. Double hull',
    notes: 'Noisier than Yasen. Pod on the rudder fin holds the towed array.',
  },
  virginia: {
    photo: { file: 'virginia.jpg', credit: 'PCU Virginia (SSN 774), 2004. U.S. Navy photo by General Dynamics Electric Boat · Public domain · Wikimedia Commons' },
    displacement: '10,200 t submerged',
    armament: ['4 × 533 mm torpedo tubes (Mk 48, Harpoon)', '12 vertical tubes plus Virginia Payload Module'],
    armor: 'None. Single hull',
    notes: 'Friendly. Pump-jet propulsor.',
  },
  ka27: {
    photo: { file: 'ka27.jpg', credit: 'Kamov Ka-27 (Ukrainian Navy). Photo: U.S. Navy · Public domain · Wikimedia Commons' },
    displacement: '12,000 kg max takeoff',
    armament: ['VGS-3 dipping sonar', 'Sonobuoys', '1 APR-3 or lightweight torpedo, or depth charges'],
    armor: 'None',
    notes: 'Coaxial rotors. Heard on sonar only while its sonar is in the water.',
  },
  il38: {
    photo: { file: 'il38.jpg', credit: 'Ilyushin Il-38 "May" in flight. Photo: unknown (U.S. government) · Public domain · Wikimedia Commons' },
    displacement: '63,500 kg max takeoff',
    armament: ['Sonobuoys', 'Torpedoes and depth charges', 'Novella search radar and ESM'],
    armor: 'None',
    notes: 'Four turboprops. Its radar warning receiver hears our mast radar.',
  },
  ar196: {
    photo: { file: 'ar196.jpg', credit: 'Arado Ar 196A-2 taxiing, 1940. Photo: unknown author · Public domain · Wikimedia Commons · tail marking removed' },
    displacement: '3,700 kg max takeoff',
    armament: ['2 × 20 mm cannon', '1 to 2 × 7.92 mm machine guns', '2 × 50 kg bombs'],
    armor: 'None',
    notes: 'Twin-float monoplane, catapulted from German heavy ships.',
  },
  akagi: {
    photo: { file: 'akagi.jpg', credit: 'Akagi at anchor, late 1930s. NHHC photo NH 73058 (Japanese photograph, donated by Kazutoshi Hando) · Public domain · Naval History and Heritage Command' },
    displacement: '42,500 t full load',
    armament: ['6 × 20 cm guns in casemates', '12 × 12 cm AA guns in twin mounts', '28 × 25 mm AA guns', 'About 66 aircraft'],
    armor: '152 mm belt, 79 mm deck',
    notes: 'Converted battlecruiser hull. Small island on the port side, big funnel curving down to starboard below the flight deck. Four shafts.',
  },
  kaga: {
    photo: { file: 'kaga.jpg', credit: 'Kaga underway, after reconstruction. NHHC photo NH 73060 (Japanese photograph, donated by Kazutoshi Hando) · Public domain · Naval History and Heritage Command' },
    displacement: '42,500 t full load',
    armament: ['10 × 20 cm guns in casemates', '16 × 12.7 cm AA guns in twin mounts', '22 × 25 mm AA guns', 'About 72 aircraft'],
    armor: '152 mm belt, 38 mm deck',
    notes: 'Converted battleship hull, slower than Akagi. Small starboard island, downturned funnel to starboard. Four shafts.',
  },
  soryu: {
    photo: { file: 'soryu.jpg', credit: 'Hiryu underway. NHHC photo NH 73063 (Japanese photograph, donated by Kazutoshi Hando) · Public domain · Naval History and Heritage Command' },
    displacement: '19,800 t full load (Hiryū 20,250 t)',
    armament: ['12 × 12.7 cm AA guns in twin mounts', '28 to 31 × 25 mm AA guns', 'About 63 aircraft'],
    armor: 'Light: 41 mm belt over machinery, 55 mm over magazines',
    notes: 'Light, fast fleet carrier. Small island (port side on Hiryū), two small funnels curving down to starboard. Four shafts.',
  },
  shokaku: {
    photo: { file: 'shokaku.jpg', credit: 'Shokaku underway. NHHC photo NH 73066 (Japanese photograph, donated by Kazutoshi Hando) · Public domain · Naval History and Heritage Command' },
    displacement: '32,100 t full load',
    armament: ['16 × 12.7 cm AA guns in twin mounts', '36 to 70 × 25 mm AA guns', 'About 72 aircraft'],
    armor: '46 to 215 mm belt over machinery and magazines, 65 to 170 mm deck',
    notes: 'Best Japanese carriers of 1941. Starboard island forward of two downturned funnels. Four shafts.',
  },
  taiho: {
    displacement: '37,300 t full load',
    armament: ['12 × 10 cm AA guns in twin mounts', '51 × 25 mm AA guns', 'About 65 aircraft'],
    armor: '75 mm armored flight deck, up to 165 mm belt',
    notes: 'Enclosed hurricane bow and a big island with a raked funnel built in, like Shinano. Four shafts.',
  },
  shinano: {
    displacement: '71,900 t full load',
    armament: ['16 × 12.7 cm AA guns in twin mounts', '137 × 25 mm AA guns', '336 AA rockets', 'About 47 aircraft'],
    armor: '75 mm flight deck, 160 to 200 mm belt, 190 mm deck over magazines',
    notes: 'Third Yamato hull completed as a support carrier. Largest carrier of the war. Large island with raked funnel. Four shafts.',
  },
  kongo: {
    photo: { file: 'kongo.jpg', credit: 'Kirishima at anchor. NHHC photo NH 73076 (Japanese photograph, donated by Kazutoshi Hando) · Public domain · Naval History and Heritage Command' },
    displacement: '37,200 t full load',
    armament: ['8 × 35.6 cm guns in four twin turrets', '14 × 15.2 cm secondary guns', '8 × 12.7 cm AA guns', '3 floatplanes'],
    armor: '203 mm belt, up to 120 mm deck',
    notes: 'Rebuilt battlecruisers, the fastest Japanese battleships. Tall pagoda foremast and two funnels. Four shafts.',
  },
  yamato: {
    photo: { file: 'yamato.jpg', credit: 'Yamato on sea trials, October 1941. NHHC photo NH 73092 (Japanese photograph) · Public domain · Naval History and Heritage Command' },
    displacement: '72,800 t full load',
    armament: ['9 × 46 cm guns in three triple turrets', '6 to 12 × 15.5 cm secondary guns', '12 to 24 × 12.7 cm AA guns', 'Up to 7 floatplanes'],
    armor: '410 mm belt, 650 mm turret faces, 200 to 230 mm deck',
    notes: 'Largest battleships ever built. Compact tower bridge and one huge raked funnel. Four shafts.',
  },
  takao: {
    photo: { file: 'takao.jpg', credit: 'Chokai (Takao class). NHHC photo NH 73023 (Japanese photograph, donated by Kazutoshi Hando), cropped · Public domain · Naval History and Heritage Command' },
    displacement: '15,800 t full load',
    armament: ['10 × 20.3 cm guns in five twin turrets', '4 × 12 cm AA guns', '16 × 61 cm torpedo tubes (Type 93)', '3 floatplanes'],
    armor: '102 mm belt, 35 mm deck',
    notes: 'Massive bridge block, trunked forward funnel and a tall raked aft funnel. Three turrets forward. Four shafts.',
  },
  agano: {
    displacement: '8,500 t full load',
    armament: ['6 × 15.2 cm guns in three twin turrets', '4 × 8 cm AA guns', '8 × 61 cm torpedo tubes (Type 93)', '2 floatplanes'],
    armor: '60 mm belt, 20 mm deck',
    notes: 'Destroyer-flotilla leader. Single large raked funnel. Four shafts.',
  },
  kagero: {
    photo: { file: 'kagero.jpg', credit: 'Yukikaze (Kagero class). NHHC photo NH 73052 (Japanese photograph, donated by Kazutoshi Hando) · Public domain · Naval History and Heritage Command' },
    displacement: '2,500 t full load',
    armament: ['6 × 12.7 cm guns in three twin mounts', '8 × 61 cm torpedo tubes (Type 93), with reloads', 'Depth charges'],
    armor: 'None',
    notes: 'Two funnels, one twin mount forward and two aft. Two shafts.',
  },
  isub: {
    displacement: '3,560 t submerged',
    armament: ['8 × 53.3 cm bow torpedo tubes, 20 torpedoes', '1 × 14 cm deck gun', 'Carried a Type A midget submarine on deck at Pearl Harbor'],
    armor: 'None',
    notes: 'Large ocean-going boat. Noisy and slow submerged, with poor hydrophones. Two shafts.',
  },
  midget: {
    displacement: '46 t submerged',
    armament: ['2 × 45 cm torpedo tubes (bow, one above the other)'],
    armor: 'None',
    notes: 'Two-man battery boat launched from a mother submarine. Fast for a short dash, then nearly spent. Contra-rotating screws.',
  },
  picket: {
    displacement: 'About 70 to 100 GRT',
    armament: ['Machine guns, sometimes a small gun', 'Radio to report sightings'],
    armor: 'None',
    notes: 'Requisitioned fishing trawler on the picket line, like Nittō Maru that reported the Doolittle force. Single screw.',
  },
  kate: {
    displacement: '4,100 kg max takeoff',
    armament: ['1 × Type 91 aerial torpedo or 800 kg of bombs', '1 × 7.7 mm rear machine gun'],
    armor: 'None',
    notes: 'Three-seat carrier torpedo bomber with a long greenhouse canopy. Also flew ASW patrols.',
  },
  mavis: {
    displacement: '17,000 kg max takeoff',
    armament: ['Up to 2 torpedoes or 1,000 kg of bombs', '1 × 20 mm cannon and 4 × 7.7 mm machine guns'],
    armor: 'None',
    notes: 'Four-engine parasol-wing flying boat with strut-braced wing. Long-range ocean patrol.',
  },
  jake: {
    displacement: '3,600 kg max takeoff',
    armament: ['1 × 250 kg bomb or depth charges', '1 × 7.7 mm rear machine gun'],
    armor: 'None',
    notes: 'Three-seat twin-float reconnaissance floatplane, catapulted from cruisers and battleships.',
  },
  tirpitz: {
    displacement: '52,600 t full load',
    armament: ['8 × 38 cm guns in four twin turrets', '12 × 15 cm secondary guns', '16 × 10.5 cm AA guns', '8 × 53.3 cm torpedo tubes', '4 Arado Ar 196 floatplanes'],
    armor: '320 mm belt, 360 mm turret faces, up to 120 mm deck',
    notes: "Bismarck's sister, nearly identical at sea. Added torpedo tubes amidships. Three shafts.",
  },
  typevii: {
    displacement: '871 t submerged',
    armament: ['4 bow and 1 stern 53.3 cm torpedo tubes, 14 torpedoes', '1 × 8.8 cm deck gun'],
    armor: 'None',
    notes: 'Workhorse U-boat of the Atlantic. Slow and short-legged on batteries, poor hydrophones at speed. Two shafts.',
  },
  fw200: {
    displacement: '24,500 kg max takeoff',
    armament: ['Up to 2,100 kg of bombs', '1 to 2 × 20 mm cannon, 3 to 4 machine guns', 'Later models: FuG 200 search radar'],
    armor: 'Light crew armor',
    notes: 'Four-engine converted airliner. Shadowed convoys and homed U-boats onto them.',
  },
  yorktown: {
    displacement: '25,500 t full load',
    armament: ['8 × 5 in/38 dual-purpose guns', '16 × 1.1 in AA guns, later 20 mm and 40 mm', 'About 90 aircraft'],
    armor: '64 to 102 mm belt, 38 mm deck',
    notes: 'Friendly. Large starboard island with tripod mast and a big flat-sided funnel. Four shafts.',
  },
  fletcher: {
    photo: { file: 'fletcher.jpg', credit: 'USS Johnston (DD-557), Fletcher class, 27 October 1943. NHHC photo NH 63495 · Public domain · Naval History and Heritage Command' },
    displacement: '2,900 t full load',
    armament: ['5 × 5 in/38 guns in single mounts', '10 × 21 in torpedo tubes', '40 mm and 20 mm AA guns', 'Depth charges'],
    armor: 'Light splinter protection',
    notes: 'Friendly. Flush deck, two funnels, two gun mounts forward and three aft. Two shafts.',
  },
  wickes: {
    photo: { file: 'wickes.jpg', credit: 'USS Ward (DD-139), 26 February 1919. NHHC photo NH 63240 · Public domain · Naval History and Heritage Command' },
    displacement: '1,250 t full load',
    armament: ['4 × 4 in/50 guns', '12 × 21 in torpedo tubes', 'Depth charges'],
    armor: 'None',
    notes: 'Friendly. World War I "four-piper": flush deck and four thin funnels. USS Ward fired the first shot at Pearl Harbor. Two shafts.',
  },
  atlanta: {
    photo: { file: 'atlanta.jpg', credit: 'USS Atlanta (CL-51) at high speed, circa November 1941. NHHC photo NH 57455 · Public domain · Naval History and Heritage Command' },
    displacement: '8,300 t full load',
    armament: ['16 × 5 in/38 guns in eight twin mounts', '8 × 21 in torpedo tubes', '1.1 in and 20 mm AA guns'],
    armor: '95 mm belt, 32 mm deck',
    notes: 'Friendly. Anti-aircraft cruiser: twin 5 in mounts stacked three high fore and aft, two funnels. Two shafts.',
  },
  flower: {
    displacement: '1,170 t full load',
    armament: ['1 × 4 in gun', '1 × 2-pounder pom-pom', 'Depth charges, later Hedgehog', 'ASDIC'],
    armor: 'None',
    notes: 'Friendly. Whale-catcher design: short, round-bottomed, single funnel and mast. Reciprocating engine, single screw.',
  },
  liberty: {
    photo: { file: 'liberty.jpg', credit: 'Liberty ship SS George Dewey, 6 September 1943. U.S. Navy photo 80-G-84349 via NHHC · Public domain · Naval History and Heritage Command' },
    displacement: '14,250 t full load (7,176 GRT)',
    armament: ['1 × 4 in or 5 in gun aft', '1 × 3 in gun forward', '20 mm AA guns'],
    armor: 'None',
    notes: 'Mass-produced wartime freighter. Midships bridge and single funnel, three cargo masts. Triple-expansion engine, single screw.',
  },
  maru: {
    displacement: '4,000 to 9,000 GRT',
    armament: ['Often one or two old field guns', 'Machine guns'],
    armor: 'None',
    notes: 'Requisitioned freighter or liner carrying troops and supplies. Japanese merchant names end in Maru. Bridge and funnel amidships, derricks fore and aft.',
  },
  frachter: {
    displacement: '5,000 to 8,000 GRT',
    armament: ['Usually unarmed'],
    armor: 'None',
    notes: 'German cargo steamer. Single funnel amidships, cargo masts fore and aft. Single screw.',
  },
  renown: {
    displacement: '37,400 t full load',
    armament: ['6 × 15 in guns in three twin turrets', '20 × 4 in guns (Renown, twin DP mounts) or 9 × 4 in in triple mounts (Repulse)', '2-pounder pom-poms', '8 × 21 in torpedo tubes', '4 floatplanes'],
    armor: '152 to 229 mm belt, 76 to 127 mm deck (Renown after rebuild)',
    notes: 'Long, lean battlecruisers: two turrets forward, one aft, two funnels. Renown rebuilt with a tower bridge, Repulse kept a tripod. Four shafts.',
  },
  g4m: {
    displacement: '12,900 kg max takeoff',
    armament: ['1 × Type 91 aerial torpedo or 800 kg of bombs', '1 × 20 mm tail cannon', '4 × 7.7 mm machine guns'],
    armor: 'None, and unprotected fuel tanks',
    notes: 'Twin-engine land-based bomber with a fat cigar fuselage, glazed nose and tail gun cone. Sank Prince of Wales and Repulse.',
  },
  ryujo: {
    displacement: '12,500 t (Ryūjō) to 14,200 t (Shōhō) full load',
    armament: ['8 × 12.7 cm AA guns', '25 mm AA guns', '30 to 37 aircraft'],
    armor: 'Minimal',
    notes: 'Small flush-deck carriers with no island: bridge under the forward lip of the flight deck, small funnels curving down on the starboard side. Ryūjō has a tall, top-heavy double hangar. Two shafts.',
  },
  myoko: {
    displacement: '15,900 t full load',
    armament: ['10 × 20.3 cm guns in five twin turrets', '8 × 12.7 cm AA guns', '16 × 61 cm torpedo tubes (Type 93)', '2 to 3 floatplanes'],
    armor: '102 mm belt, 35 mm deck',
    notes: 'Three turrets forward in a pyramid, two aft. Wide trunked forward funnel and a tall aft funnel. Smaller bridge than Takao. Four shafts.',
  },
  aoba: {
    displacement: '10,800 t (Furutaka) to 11,700 t (Aoba) full load',
    armament: ['6 × 20.3 cm guns in three twin turrets', '4 × 12 cm AA guns', '8 × 61 cm torpedo tubes', '1 to 2 floatplanes'],
    armor: '76 mm belt, 32 to 35 mm deck',
    notes: 'Smallest Japanese heavy cruisers: two turrets forward, one aft, two funnels with the forward one wide and trunked. Low sweeping sheer line. Four shafts.',
  },
  sendai: {
    displacement: '7,100 t full load',
    armament: ['7 × 14 cm guns in single mounts', '2 × 8 cm or 12.7 cm AA guns', '8 × 61 cm torpedo tubes', '1 floatplane'],
    armor: '64 mm belt, 29 mm deck',
    notes: 'Destroyer-squadron flagships: tall thin funnels (three, four on Sendai/Jintsū), tripod foremast, scattered single guns. Four shafts.',
  },
  mogami: {
    displacement: '15,000 t full load',
    armament: ['10 × 20.3 cm guns in five twin turrets (rebuilt from 15 × 15.5 cm)', '8 × 12.7 cm AA guns', '12 × 61 cm torpedo tubes (Type 93)', '3 floatplanes'],
    armor: '100 mm belt, 35 to 60 mm deck',
    notes: 'Three turrets forward, two aft, and one big trunked funnel. Compact bridge, long open quarterdeck. Four shafts.',
  },
  scharnhorst: {
    displacement: '38,100 t full load',
    armament: ['9 × 28 cm guns in three triple turrets', '12 × 15 cm secondary guns', '14 × 10.5 cm AA guns', '6 × 53.3 cm torpedo tubes (from 1942)', '3 to 4 Arado Ar 196 floatplanes'],
    armor: '350 mm belt, 360 mm turret faces, up to 105 mm deck',
    notes: 'Fast, low battleships with a raked "Atlantic" bow. Two triple turrets forward, one aft, single capped funnel. Three shafts.',
  },
  usca: {
    displacement: '11,500 to 12,500 t full load',
    armament: ['9 × 8 in guns in three triple turrets', '8 × 5 in/25 AA guns', '1.1 in and 20 mm AA guns', '4 floatplanes'],
    armor: '76 to 127 mm belt, 25 to 57 mm deck',
    notes: 'Friendly. Treaty cruisers: two triple turrets forward, one aft, two funnels and tripod masts, hangar amidships. Four shafts.',
  },
  brooklyn: {
    displacement: '12,700 t full load',
    armament: ['15 × 6 in guns in five triple turrets', '8 × 5 in/25 AA guns', '1.1 in, 40 mm and 20 mm AA guns', '4 floatplanes (stern hangar)'],
    armor: '127 mm belt, 52 mm deck',
    notes: 'Friendly. Three triple turrets forward, two aft, two close-set funnels and a high square transom stern. Four shafts.',
  },
  lexington: {
    displacement: '48,500 t full load',
    armament: ['12 × 5 in/25 AA guns', '8 in twin turrets (removed early 1942)', '1.1 in and 20 mm AA guns', 'About 78 aircraft'],
    armor: '127 to 178 mm belt, 25 to 51 mm deck',
    notes: 'Friendly. Converted battlecruisers, long and big: small island and a huge flat-sided funnel on the starboard side. Turbo-electric drive, four shafts.',
  },
  deruyter: {
    displacement: '7,550 t (De Ruyter) to 8,200 t (Java) full load',
    armament: ['De Ruyter: 7 × 15 cm guns in three twin and one single turret', 'Java: 10 × 15 cm guns in single mounts', '4 to 6 × 40 mm AA guns', '2 floatplanes'],
    armor: '50 to 75 mm belt, 25 to 30 mm deck',
    notes: 'Friendly (ABDA). De Ruyter has a tall tower bridge and one big funnel; Java has two funnels and a tripod. Lost in the Java Sea, February 1942. Three shafts.',
  },
  town: {
    displacement: '11,500 to 14,000 t full load',
    armament: ['12 × 6 in guns in four triple turrets', '8 × 4 in twin AA mounts', '2-pounder pom-poms', '6 × 21 in torpedo tubes', '2 to 3 Walrus amphibians'],
    armor: '114 mm belt, 32 to 76 mm deck',
    notes: 'Friendly. Two triple turrets forward and two aft, two widely spaced raked funnels with the hangars between bridge and fore funnel, tripod masts. Four shafts.',
  },
  deutschland: {
    displacement: '16,000 t full load',
    armament: ['6 × 28 cm guns in two triple turrets', '8 × 15 cm secondary guns', '6 × 10.5 cm AA guns', '8 × 53.3 cm torpedo tubes', '2 Arado Ar 196 floatplanes'],
    armor: '60 to 80 mm belt, 40 to 45 mm deck',
    notes: '"Pocket battleships": one triple turret forward, one aft, a tall tower bridge and a single funnel. Diesel-driven, very long range. Two shafts.',
  },
  zerstorer: {
    displacement: '3,200 to 3,400 t full load',
    armament: ['5 × 12.7 cm guns in single mounts', '8 × 53.3 cm torpedo tubes', '3.7 cm and 2 cm AA guns', 'Depth charges, up to 60 mines'],
    armor: 'None',
    notes: 'Big German destroyers: two raked, capped funnels, two guns forward and three aft. Wet forecastle. Two shafts.',
  },
  cavour: {
    displacement: '29,000 t full load',
    armament: ['10 × 32 cm guns (two triple and two twin turrets)', '12 × 12 cm secondary guns', '8 × 10 cm AA guns'],
    armor: '250 mm belt, 280 mm turret faces, up to 135 mm deck',
    notes: 'World War I battleships rebuilt in the 1930s: triple turrets low fore and aft with twins superfiring, two funnels, tower bridge. Two shafts.',
  },
  littorio: {
    displacement: '45,000 t full load',
    armament: ['9 × 38.1 cm guns in three triple turrets', '12 × 15.2 cm secondary guns', '12 × 9 cm AA guns', '3 floatplanes'],
    armor: '350 mm belt, 350 mm turret faces, up to 162 mm deck',
    notes: 'Modern, handsome battleships: two triple turrets forward, one aft, two close-set funnels and a tall tower bridge. High raised stern with catapult. Four shafts.',
  },
  zara: {
    displacement: '14,300 t full load',
    armament: ['8 × 20.3 cm guns in four twin turrets', '16 × 10 cm AA guns', '2 floatplanes'],
    armor: '150 mm belt, 70 mm deck',
    notes: 'The best-armored treaty cruisers: two turrets forward, two aft, two funnels and a tower bridge. Zara, Fiume and Pola were all lost at Matapan. Two shafts.',
  },
  soldati: {
    displacement: '2,450 t full load',
    armament: ['4 × 120 mm guns in two twin mounts (some with a fifth gun amidships)', '6 × 53.3 cm torpedo tubes', '20 mm AA guns', 'Depth charges'],
    armor: 'None',
    notes: 'Fast Italian destroyers: single large funnel, one twin mount forward and one aft. Two shafts.',
  },
  qe: {
    displacement: '36,500 t full load',
    armament: ['8 × 15 in guns in four twin turrets', '8 × 6 in secondary guns', '8 × 4 in AA guns', '2-pounder pom-poms', '4 Walrus amphibians'],
    armor: '330 mm belt, 330 mm turret faces, up to 127 mm deck',
    notes: "Friendly. Rebuilt World War I battleship: two turrets forward, two aft, single funnel and a tall 'Queen Anne's castle' bridge. Four shafts.",
  },
  leander: {
    displacement: '9,200 t full load',
    armament: ['8 × 6 in guns in four twin turrets', '8 × 4 in AA guns', '8 × 21 in torpedo tubes', '1 floatplane'],
    armor: '76 mm belt, 51 mm deck',
    notes: 'Friendly. Two turrets forward, two aft and one big trunked funnel (Perth, of the modified Amphion type, has two). Four shafts.',
  },
  hclass: {
    displacement: '1,900 t (H class) to 2,500 t (Tribal) full load',
    armament: ['4 × 4.7 in guns (8 in twin mounts on Tribals)', '8 × 21 in torpedo tubes (4 on Tribals)', 'Pom-poms and machine guns', 'Depth charges'],
    armor: 'None',
    notes: 'Friendly. Two raked funnels, two gun mounts forward and two aft. Hardy and Hotspur fought at Narvik; Cossack boarded the Altmark. Two shafts.',
  },
};
