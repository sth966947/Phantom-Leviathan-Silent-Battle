// Ship class cards: acoustic, performance and signature data. Game numbers tuned
// for play, using approximate public figures; not real acoustic intelligence.
//
// Signature: `tonals` are steady machinery lines in Hz, strongest first, so a faint
// contact shows only the first one or two. `blades` and `shaftHzPerKt` give the
// propeller blade-rate line (blades x shaft rate), which shifts with speed.

import { CLASSES_80S, REFERENCE_80S } from './classes80s';

export type Kind = 'sub' | 'surface' | 'air';
export type Nation = 'US' | 'UK' | 'Germany' | 'Russia' | 'Japan' | 'Netherlands' | 'Italy'
  | 'China' | 'India' | 'Iran' | 'Brazil' | 'South Africa' | 'Venezuela' | 'Australia' | 'Norway' | 'Turkey' | 'Pakistan' | 'Liberia'
  | 'USSR';

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
  quiet?: boolean;         // a US nuclear boat: almost silent below 10 kt (see vesselSL)
  friendly?: boolean;      // an ally whatever its nation (modern Japan, say)
}

export const CLASSES: Record<string, ClassCard> = {
  virginia: {
    key: 'virginia', name: 'Virginia Block V', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 79, maxSpd: 32, threshold: 20, hp: 5, tonals: [60, 120], blades: 7, shaftHzPerKt: 0.08, quiet: true,
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

  // ---- Modern war, Act 1: Russia's Northern Fleet and the convoys it hunts ----
  oscar: {
    key: 'oscar', name: 'Oscar II', type: 'SSGN', nation: 'Russia', kind: 'sub',
    slBase: 101, maxSpd: 32, threshold: 22, hp: 7, tonals: [50, 9, 72, 130], blades: 7, shaftHzPerKt: 0.09,
  },
  kilo: {
    key: 'kilo', name: 'Improved Kilo (636.3)', type: 'SSK', nation: 'Russia', kind: 'sub',
    slBase: 86, maxSpd: 20, threshold: 25, hp: 4, tonals: [60, 12, 95], blades: 6, shaftHzPerKt: 0.15,
  },
  // A deep-diving spy submarine carried under a mother ship: slow, small and very quiet.
  deepsub: {
    key: 'deepsub', name: 'AS-31 deep submersible', type: 'special-purpose sub', nation: 'Russia', kind: 'sub',
    slBase: 80, maxSpd: 6, threshold: 32, hp: 2, tonals: [400, 50, 133], blades: 0, shaftHzPerKt: 0,
  },
  // Modern sub hunters: strong hull sonar (a low threshold stands in for active sonar) and torpedoes.
  udaloy: {
    key: 'udaloy', name: 'Udaloy I', type: 'ASW destroyer', nation: 'Russia', kind: 'surface',
    slBase: 81, maxSpd: 29, threshold: 15, hp: 6, tonals: [50, 30, 140, 75], blades: 4, shaftHzPerKt: 0.14, emitter: true,
  },
  yantar: {
    key: 'yantar', name: 'Yantar', type: 'oceanographic research ship', nation: 'Russia', kind: 'surface',
    slBase: 88, maxSpd: 15, threshold: null, hp: 3, tonals: [50, 100, 25], blades: 4, shaftHzPerKt: 0.2,
  },
  tu142: {
    key: 'tu142', name: 'Tu-142MK Bear-F', type: 'long-range ASW aircraft', nation: 'Russia', kind: 'air',
    slBase: 0, maxSpd: 440, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  tu22m3: {
    key: 'tu22m3', name: 'Tu-22M3 Backfire', type: 'maritime strike bomber', nation: 'Russia', kind: 'air',
    slBase: 0, maxSpd: 540, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  boxship: {
    key: 'boxship', name: 'Container ship', type: 'merchant', nation: 'US', kind: 'surface',
    slBase: 87, maxSpd: 22, threshold: null, hp: 4, tonals: [33, 66, 99], blades: 5, shaftHzPerKt: 0.12,
  },
  arleigh: {
    key: 'arleigh', name: 'Arleigh Burke Flight III', type: 'destroyer', nation: 'US', kind: 'surface',
    slBase: 79, maxSpd: 31, threshold: null, hp: 6, tonals: [60, 30, 180], blades: 5, shaftHzPerKt: 0.13, emitter: true,
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
  // ---- Modern war, 2029: NATO and its partners against the BRICS bloc ----
  // Russian boats keep the 50 Hz + 9 Hz pair; Chinese boats a 13 Hz line instead. Chinese
  // surface warships share a 34 Hz gas-turbine line, MEKO frigates 35 Hz, Scorpènes 17 Hz.
  // US and Japanese ships run 60 Hz generators, as do Brazil's.
  borei: {
    key: 'borei', name: 'Borei-A', type: 'SSBN', nation: 'Russia', kind: 'sub',
    slBase: 93, maxSpd: 29, threshold: 23, hp: 7, tonals: [50, 9, 66, 120], blades: 7, shaftHzPerKt: 0.08,
  },
  // Lengthened Oscar hull: Oscar's lines plus a hum from the special-mission equipment.
  belgorod: {
    key: 'belgorod', name: 'Belgorod (K-329)', type: 'special-purpose SSGN', nation: 'Russia', kind: 'sub',
    slBase: 100, maxSpd: 30, threshold: 22, hp: 8, tonals: [50, 9, 76, 112, 186], blades: 7, shaftHzPerKt: 0.09,
  },
  khabarovsk: {
    key: 'khabarovsk', name: 'Khabarovsk', type: 'special-purpose SSN', nation: 'Russia', kind: 'sub',
    slBase: 95, maxSpd: 28, threshold: 23, hp: 6, tonals: [50, 9, 64, 96, 172], blades: 7, shaftHzPerKt: 0.08,
  },
  // A nuclear-powered torpedo drone: small reactor, pump-jet, very fast and deep, and loud.
  poseidon: {
    key: 'poseidon', name: 'Poseidon (Status-6)', type: 'nuclear torpedo drone', nation: 'Russia', kind: 'sub',
    slBase: 100, maxSpd: 60, threshold: null, hp: 1, tonals: [70, 140, 35], blades: 0, shaftHzPerKt: 0,
  },
  kirov: {
    key: 'kirov', name: 'Kirov (Pyotr Velikiy, Admiral Nakhimov)', type: 'nuclear battlecruiser', nation: 'Russia', kind: 'surface',
    slBase: 84, maxSpd: 32, threshold: 15, hp: 12, tonals: [50, 22, 130, 64, 190], blades: 4, shaftHzPerKt: 0.12, emitter: true,
  },
  gorshkov: {
    key: 'gorshkov', name: 'Admiral Gorshkov', type: 'frigate', nation: 'Russia', kind: 'surface',
    slBase: 79, maxSpd: 29, threshold: 15, hp: 4, tonals: [50, 38, 145, 90], blades: 4, shaftHzPerKt: 0.15, emitter: true,
  },
  steregushchiy: {
    key: 'steregushchiy', name: 'Steregushchiy', type: 'corvette', nation: 'Russia', kind: 'surface',
    slBase: 81, maxSpd: 27, threshold: 17, hp: 2, tonals: [50, 25, 75, 150], blades: 4, shaftHzPerKt: 0.18, emitter: true,
  },
  ropucha: {
    key: 'ropucha', name: 'Ropucha', type: 'landing ship', nation: 'Russia', kind: 'surface',
    slBase: 86, maxSpd: 18, threshold: null, hp: 4, tonals: [42, 50, 84, 126], blades: 4, shaftHzPerKt: 0.2, emitter: true,
  },
  ivangren: {
    key: 'ivangren', name: 'Ivan Gren', type: 'landing ship', nation: 'Russia', kind: 'surface',
    slBase: 85, maxSpd: 18, threshold: null, hp: 4, tonals: [50, 26, 78, 104], blades: 4, shaftHzPerKt: 0.19, emitter: true,
  },
  // Old steam plant, eight boilers and four shafts: loud, with a deep 23 Hz feed-pump line, and worn out (24 kt flat out).
  kuznetsov: {
    key: 'kuznetsov', name: 'Admiral Kuznetsov', type: 'aircraft carrier', nation: 'Russia', kind: 'surface',
    slBase: 88, maxSpd: 24, threshold: null, hp: 14, tonals: [50, 23, 92, 46, 150], blades: 5, shaftHzPerKt: 0.13, emitter: true,
  },
  // Gas-turbine air-cushion craft: a high fan and turbine line, no screw in the water.
  serna: {
    key: 'serna', name: 'Serna landing craft', type: 'landing craft', nation: 'Russia', kind: 'surface',
    slBase: 84, maxSpd: 30, threshold: null, hp: 1, tonals: [66, 132, 198], blades: 3, shaftHzPerKt: 0.5,
  },
  // Turbo-electric nuclear icebreaker: reactor coolant pumps and a deep motor line, very loud.
  arktika: {
    key: 'arktika', name: 'Arktika (Project 22220)', type: 'nuclear icebreaker', nation: 'Russia', kind: 'surface',
    slBase: 92, maxSpd: 22, threshold: null, hp: 7, tonals: [50, 16, 110, 170], blades: 4, shaftHzPerKt: 0.12,
  },
  arc7lng: {
    key: 'arc7lng', name: 'Arc7 LNG carrier (Yamal LNG)', type: 'ice-class LNG carrier', nation: 'Russia', kind: 'surface',
    slBase: 89, maxSpd: 19, threshold: null, hp: 5, tonals: [50, 25, 100, 150], blades: 4, shaftHzPerKt: 0.14,
  },
  trawler: {
    key: 'trawler', name: 'Intelligence trawler (AGI)', type: 'intelligence collection ship', nation: 'Russia', kind: 'surface',
    slBase: 83, maxSpd: 16, threshold: null, hp: 2, tonals: [50, 18, 54, 108], blades: 4, shaftHzPerKt: 0.22,
  },

  // China
  type093b: {
    key: 'type093b', name: 'Type 093B Shang III', type: 'SSN', nation: 'China', kind: 'sub',
    slBase: 97, maxSpd: 30, threshold: 24, hp: 5, tonals: [50, 13, 84, 156], blades: 7, shaftHzPerKt: 0.1,
  },
  type095: {
    key: 'type095', name: 'Type 095', type: 'SSN', nation: 'China', kind: 'sub',
    slBase: 95, maxSpd: 31, threshold: 22, hp: 5, tonals: [50, 13, 92, 148], blades: 7, shaftHzPerKt: 0.09,
  },
  type094: {
    key: 'type094', name: 'Type 094 Jin', type: 'SSBN', nation: 'China', kind: 'sub',
    slBase: 103, maxSpd: 22, threshold: 26, hp: 7, tonals: [50, 13, 70, 124, 194], blades: 7, shaftHzPerKt: 0.1,
  },
  type096: {
    key: 'type096', name: 'Type 096', type: 'SSBN', nation: 'China', kind: 'sub',
    slBase: 97, maxSpd: 25, threshold: 24, hp: 7, tonals: [50, 13, 76, 136], blades: 7, shaftHzPerKt: 0.09,
  },
  type039: {
    key: 'type039', name: 'Type 039A/B Yuan', type: 'AIP SSK', nation: 'China', kind: 'sub',
    slBase: 85, maxSpd: 20, threshold: 26, hp: 4, tonals: [50, 13, 118], blades: 7, shaftHzPerKt: 0.15,
  },
  type055: {
    key: 'type055', name: 'Type 055 Renhai', type: 'cruiser', nation: 'China', kind: 'surface',
    slBase: 80, maxSpd: 30, threshold: 15, hp: 8, tonals: [50, 34, 152, 96, 186], blades: 5, shaftHzPerKt: 0.13, emitter: true,
  },
  type052d: {
    key: 'type052d', name: 'Type 052D Luyang III', type: 'destroyer', nation: 'China', kind: 'surface',
    slBase: 80, maxSpd: 30, threshold: 16, hp: 5, tonals: [50, 34, 138, 88], blades: 5, shaftHzPerKt: 0.14, emitter: true,
  },
  type054a: {
    key: 'type054a', name: 'Type 054A Jiangkai II', type: 'frigate', nation: 'China', kind: 'surface',
    slBase: 81, maxSpd: 27, threshold: 15, hp: 4, tonals: [50, 34, 72, 144], blades: 5, shaftHzPerKt: 0.16, emitter: true,
  },
  type056: {
    key: 'type056', name: 'Type 056A Jiangdao', type: 'corvette', nation: 'China', kind: 'surface',
    slBase: 82, maxSpd: 25, threshold: 18, hp: 2, tonals: [50, 36, 66, 132], blades: 4, shaftHzPerKt: 0.18, emitter: true,
  },
  type075: {
    key: 'type075', name: 'Type 075 Yushen', type: 'amphibious assault ship (LHD)', nation: 'China', kind: 'surface',
    slBase: 86, maxSpd: 23, threshold: null, hp: 9, tonals: [50, 31, 94, 124], blades: 5, shaftHzPerKt: 0.14, emitter: true,
  },
  type071: {
    key: 'type071', name: 'Type 071 Yuzhao', type: 'amphibious transport dock (LPD)', nation: 'China', kind: 'surface',
    slBase: 85, maxSpd: 20, threshold: null, hp: 7, tonals: [50, 31, 82, 164], blades: 5, shaftHzPerKt: 0.16, emitter: true,
  },
  // Hovercraft: gas turbines and lift fans, very loud for its size, no shaft in the water.
  type726: {
    key: 'type726', name: 'Type 726 Yuyi LCAC', type: 'air-cushion landing craft', nation: 'China', kind: 'surface',
    slBase: 90, maxSpd: 40, threshold: null, hp: 1, tonals: [75, 150, 225], blades: 4, shaftHzPerKt: 0.4,
  },
  // The two carriers share a 29 Hz feed-pump line from their steam plants.
  fujian: {
    key: 'fujian', name: 'Fujian', type: 'aircraft carrier', nation: 'China', kind: 'surface',
    slBase: 85, maxSpd: 31, threshold: null, hp: 14, tonals: [50, 29, 116, 58, 174], blades: 5, shaftHzPerKt: 0.13, emitter: true,
  },
  shandong: {
    key: 'shandong', name: 'Shandong', type: 'aircraft carrier', nation: 'China', kind: 'surface',
    slBase: 85, maxSpd: 31, threshold: null, hp: 12, tonals: [50, 29, 108, 62, 180], blades: 5, shaftHzPerKt: 0.13, emitter: true,
  },
  type901: {
    key: 'type901', name: 'Type 901 (Hulunhu, Chaganhu)', type: 'fast combat support ship', nation: 'China', kind: 'surface',
    slBase: 86, maxSpd: 25, threshold: null, hp: 6, tonals: [50, 31, 104, 156], blades: 5, shaftHzPerKt: 0.14,
  },
  type022: {
    key: 'type022', name: 'Type 022 Houbei', type: 'missile boat', nation: 'China', kind: 'surface',
    slBase: 84, maxSpd: 36, threshold: null, hp: 1, tonals: [50, 42, 84, 168], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  ccg: {
    key: 'ccg', name: 'China Coast Guard cutter (CCG 2901, 3901)', type: 'coast guard cutter', nation: 'China', kind: 'surface',
    slBase: 84, maxSpd: 25, threshold: null, hp: 5, tonals: [50, 27, 81, 135], blades: 4, shaftHzPerKt: 0.15, emitter: true,
  },
  xuelong2: {
    key: 'xuelong2', name: 'Xue Long 2', type: 'polar research icebreaker', nation: 'China', kind: 'surface',
    slBase: 87, maxSpd: 15, threshold: null, hp: 4, tonals: [50, 20, 120, 180], blades: 4, shaftHzPerKt: 0.16,
  },
  h6k: {
    key: 'h6k', name: 'Xian H-6K', type: 'long-range bomber', nation: 'China', kind: 'air',
    slBase: 0, maxSpd: 520, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  h6j: {
    key: 'h6j', name: 'Xian H-6J', type: 'naval strike bomber', nation: 'China', kind: 'air',
    slBase: 0, maxSpd: 520, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  kq200: {
    key: 'kq200', name: 'Shaanxi KQ-200 (Y-8Q)', type: 'maritime patrol aircraft', nation: 'China', kind: 'air',
    slBase: 0, maxSpd: 340, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  // Export Helix: same rotor and gearbox family as the Ka-27, a slightly different gearbox line.
  ka28: {
    key: 'ka28', name: 'Ka-28 Helix', type: 'ASW helicopter', nation: 'China', kind: 'air',
    slBase: 104, maxSpd: 140, threshold: null, hp: 1, tonals: [14, 28, 115, 46], blades: 0, shaftHzPerKt: 0,
  },

  // India
  vikrant: {
    key: 'vikrant', name: 'Vikrant', type: 'aircraft carrier', nation: 'India', kind: 'surface',
    slBase: 84, maxSpd: 28, threshold: null, hp: 11, tonals: [50, 21, 98, 146, 64], blades: 5, shaftHzPerKt: 0.13, emitter: true,
  },
  kolkata: {
    key: 'kolkata', name: 'Kolkata (Kolkata, Kochi, Chennai)', type: 'destroyer', nation: 'India', kind: 'surface',
    slBase: 80, maxSpd: 30, threshold: 16, hp: 5, tonals: [50, 37, 122, 86], blades: 5, shaftHzPerKt: 0.14, emitter: true,
  },
  talwar: {
    key: 'talwar', name: 'Talwar', type: 'frigate', nation: 'India', kind: 'surface',
    slBase: 81, maxSpd: 30, threshold: 16, hp: 4, tonals: [50, 30, 118, 66], blades: 4, shaftHzPerKt: 0.15, emitter: true,
  },
  kalvari: {
    key: 'kalvari', name: 'Kalvari (Scorpène)', type: 'SSK', nation: 'India', kind: 'sub',
    slBase: 84, maxSpd: 20, threshold: 25, hp: 4, tonals: [50, 17, 104], blades: 7, shaftHzPerKt: 0.15,
  },
  arihant: {
    key: 'arihant', name: 'Arihant (Arihant, Arighaat)', type: 'SSBN', nation: 'India', kind: 'sub',
    slBase: 102, maxSpd: 24, threshold: 26, hp: 5, tonals: [50, 11, 74, 128], blades: 7, shaftHzPerKt: 0.1,
  },
  jalashwa: {
    key: 'jalashwa', name: 'Jalashwa (ex-USS Trenton)', type: 'amphibious transport dock (LPD)', nation: 'India', kind: 'surface',
    slBase: 87, maxSpd: 21, threshold: null, hp: 6, tonals: [60, 20, 90, 150], blades: 5, shaftHzPerKt: 0.16, emitter: true,
  },
  p8i: {
    key: 'p8i', name: 'Boeing P-8I Neptune', type: 'maritime patrol aircraft', nation: 'India', kind: 'air',
    slBase: 0, maxSpd: 490, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },

  // Iran
  ghadir: {
    key: 'ghadir', name: 'Ghadir', type: 'midget submarine', nation: 'Iran', kind: 'sub',
    slBase: 84, maxSpd: 11, threshold: 34, hp: 1, tonals: [50, 100, 23], blades: 5, shaftHzPerKt: 0.25,
  },
  jamaran: {
    key: 'jamaran', name: 'Moudge (Jamaran, Dena)', type: 'frigate', nation: 'Iran', kind: 'surface',
    slBase: 82, maxSpd: 30, threshold: 22, hp: 3, tonals: [50, 33, 99, 140], blades: 4, shaftHzPerKt: 0.18, emitter: true,
  },
  fac: {
    key: 'fac', name: 'Iranian missile boat (Thondar, Houdong)', type: 'fast attack craft', nation: 'Iran', kind: 'surface',
    slBase: 84, maxSpd: 35, threshold: null, hp: 1, tonals: [50, 44, 88, 132], blades: 4, shaftHzPerKt: 0.3, emitter: true,
  },
  // Outboard-engined explosive boat: a high, clean engine line and a fast-turning screw.
  droneboat: {
    key: 'droneboat', name: 'Explosive drone boat', type: 'USV', nation: 'Iran', kind: 'surface',
    slBase: 86, maxSpd: 45, threshold: null, hp: 1, tonals: [90, 180, 45], blades: 3, shaftHzPerKt: 0.8,
  },

  // Brazil
  riachuelo: {
    key: 'riachuelo', name: 'Riachuelo (Scorpène)', type: 'SSK', nation: 'Brazil', kind: 'sub',
    slBase: 84, maxSpd: 20, threshold: 25, hp: 4, tonals: [60, 17, 104], blades: 7, shaftHzPerKt: 0.15,
  },
  alvaro: {
    key: 'alvaro', name: 'Álvaro Alberto', type: 'SSN', nation: 'Brazil', kind: 'sub',
    slBase: 96, maxSpd: 25, threshold: 24, hp: 5, tonals: [60, 17, 86, 152], blades: 7, shaftHzPerKt: 0.1,
  },
  tamandare: {
    key: 'tamandare', name: 'Tamandaré (MEKO A-100)', type: 'frigate', nation: 'Brazil', kind: 'surface',
    slBase: 80, maxSpd: 26, threshold: 17, hp: 3, tonals: [60, 35, 110, 74], blades: 5, shaftHzPerKt: 0.16, emitter: true,
  },
  p3am: {
    key: 'p3am', name: 'Lockheed P-3AM Orion', type: 'maritime patrol aircraft', nation: 'Brazil', kind: 'air',
    slBase: 0, maxSpd: 400, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },

  // South Africa and Venezuela
  type209: {
    key: 'type209', name: 'Type 209/1400', type: 'SSK', nation: 'South Africa', kind: 'sub',
    slBase: 87, maxSpd: 21, threshold: 28, hp: 3, tonals: [50, 26, 92, 38], blades: 5, shaftHzPerKt: 0.17,
  },
  valour: {
    key: 'valour', name: 'Valour (MEKO A-200SAN)', type: 'frigate', nation: 'South Africa', kind: 'surface',
    slBase: 80, maxSpd: 28, threshold: 18, hp: 3, tonals: [50, 35, 110, 74], blades: 5, shaftHzPerKt: 0.15, emitter: true,
  },

  // Allies, neutrals and merchants
  ford: {
    key: 'ford', name: 'Gerald R. Ford', type: 'aircraft carrier', nation: 'US', kind: 'surface', friendly: true,
    slBase: 84, maxSpd: 32, threshold: null, hp: 16, tonals: [60, 26, 118, 180, 90], blades: 5, shaftHzPerKt: 0.12, emitter: true,
  },
  taigei: {
    key: 'taigei', name: 'Taigei', type: 'SSK', nation: 'Japan', kind: 'sub', friendly: true,
    slBase: 83, maxSpd: 20, threshold: 22, hp: 4, tonals: [60, 15, 108], blades: 7, shaftHzPerKt: 0.14,
  },
  maya: {
    key: 'maya', name: 'Maya (Maya, Haguro)', type: 'destroyer', nation: 'Japan', kind: 'surface', friendly: true,
    slBase: 79, maxSpd: 30, threshold: 15, hp: 6, tonals: [60, 32, 166, 108], blades: 5, shaftHzPerKt: 0.13, emitter: true,
  },
  collins: {
    key: 'collins', name: 'Collins', type: 'SSK', nation: 'Australia', kind: 'sub', friendly: true,
    slBase: 87, maxSpd: 20, threshold: 23, hp: 4, tonals: [50, 28, 140], blades: 7, shaftHzPerKt: 0.15,
  },
  nansen: {
    key: 'nansen', name: 'Fridtjof Nansen', type: 'frigate', nation: 'Norway', kind: 'surface', friendly: true,
    slBase: 79, maxSpd: 27, threshold: 15, hp: 4, tonals: [50, 32, 144, 78], blades: 5, shaftHzPerKt: 0.15, emitter: true,
  },
  type26: {
    key: 'type26', name: 'Type 26 (City class)', type: 'ASW frigate', nation: 'UK', kind: 'surface', friendly: true,
    slBase: 76, maxSpd: 26, threshold: 14, hp: 5, tonals: [50, 28, 136, 84], blades: 5, shaftHzPerKt: 0.15, emitter: true,
  },
  qnlz: {
    key: 'qnlz', name: 'Queen Elizabeth (Queen Elizabeth, Prince of Wales)', type: 'aircraft carrier', nation: 'UK', kind: 'surface', friendly: true,
    slBase: 84, maxSpd: 26, threshold: null, hp: 14, tonals: [50, 24, 112, 168, 72], blades: 5, shaftHzPerKt: 0.12, emitter: true,
  },
  p8a: {
    key: 'p8a', name: 'Boeing P-8A Poseidon', type: 'maritime patrol aircraft', nation: 'US', kind: 'air', friendly: true,
    slBase: 0, maxSpd: 490, threshold: null, hp: 1, tonals: [], blades: 0, shaftHzPerKt: 0, emitter: true,
  },
  // Neutral: Turkey keeps its boats in harbour or shadows both sides.
  reis: {
    key: 'reis', name: 'Reis (Type 214TN)', type: 'AIP SSK', nation: 'Turkey', kind: 'sub',
    slBase: 84, maxSpd: 20, threshold: 24, hp: 4, tonals: [50, 22, 126], blades: 7, shaftHzPerKt: 0.15,
  },
  // Slow two-stroke diesels: low firing-rate lines and a slow-turning big screw.
  tanker: {
    key: 'tanker', name: 'Crude oil tanker', type: 'tanker', nation: 'Liberia', kind: 'surface',
    slBase: 88, maxSpd: 15, threshold: null, hp: 6, tonals: [28, 56, 84, 7], blades: 4, shaftHzPerKt: 0.1,
  },
  lng: {
    key: 'lng', name: 'LNG carrier', type: 'LNG carrier', nation: 'Liberia', kind: 'surface',
    slBase: 87, maxSpd: 19, threshold: null, hp: 5, tonals: [40, 20, 120, 80], blades: 5, shaftHzPerKt: 0.11,
  },
  tender: {
    key: 'tender', name: 'Emory S. Land', type: 'submarine tender', nation: 'US', kind: 'surface', friendly: true,
    slBase: 85, maxSpd: 20, threshold: null, hp: 6, tonals: [60, 22, 96, 150], blades: 5, shaftHzPerKt: 0.15,
  },
  // Dynamic-positioning thrusters make a rescue ship loud even when she is stopped.
  rescueship: {
    key: 'rescueship', name: 'Submarine rescue ship (SRDRS)', type: 'rescue support ship', nation: 'US', kind: 'surface', friendly: true,
    slBase: 86, maxSpd: 14, threshold: null, hp: 3, tonals: [60, 30, 90, 120], blades: 4, shaftHzPerKt: 0.18,
  },
  // The Red Storm Rising campaign's 1980s fleets (classes80s.ts).
  ...CLASSES_80S,
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
    armament: ['4 × 533 mm torpedo tubes (Mk 48, NSM)', '12 vertical tubes plus Virginia Payload Module'],
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
  oscar: {
    displacement: '24,000 t submerged',
    armament: ['24 × P-700 Granit or P-800 Oniks anti-ship missiles', '4 × 533 mm and 2 × 650 mm torpedo tubes'],
    armor: 'None. Double hull, very wide',
    notes: 'A carrier and convoy killer. Big and louder than Yasen. Two shafts.',
  },
  kilo: {
    displacement: '3,950 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Kalibr cruise missiles from the tubes', 'Mines'],
    armor: 'None',
    notes: 'Diesel-electric. On battery it is one of the quietest boats in the sea, but it is slow.',
  },
  deepsub: {
    displacement: 'About 2,000 t',
    armament: ['None. Manipulator arms and cable-cutting tools'],
    armor: 'Titanium spheres rated for very deep water',
    notes: 'Carried under a mother sub or worked from a research ship. Tiny, slow and quiet.',
  },
  udaloy: {
    displacement: '7,900 t full load',
    armament: ['8 × Rastrub (SS-N-14) ASW missiles', '8 × 533 mm torpedo tubes', '2 × RBU-6000 rocket launchers', '2 Ka-27 helicopters'],
    armor: 'None',
    notes: 'Built to hunt submarines. Powerful bow and towed sonars. Two funnels.',
  },
  yantar: {
    displacement: '5,700 t',
    armament: ['None. Carries deep submersibles'],
    armor: 'None',
    notes: 'Officially an oceanographic ship. Often seen loitering over undersea cables.',
  },
  tu142: {
    displacement: '185,000 kg max takeoff',
    armament: ['Sonobuoys', 'Torpedoes and depth charges'],
    armor: 'None',
    notes: 'Four contra-rotating turboprops. A slow, high-flying sub hunter: a JATM target.',
  },
  tu22m3: {
    displacement: '126,000 kg max takeoff',
    armament: ['Kh-22 or Kh-32 anti-ship missiles'],
    armor: 'None',
    notes: 'Swing-wing supersonic bomber. Comes in fast and high: an SM-6 target.',
  },
  boxship: {
    displacement: '60,000 to 100,000 t',
    armament: ['None'],
    armor: 'None',
    notes: 'Friendly. Large, loud and slow-turning. One big shaft.',
  },
  arleigh: {
    displacement: '9,700 t full load',
    armament: ['96 vertical launch cells', '5 in gun', 'Two MH-60R helicopters'],
    armor: 'None',
    notes: 'Friendly. SPY-6 radar. Escort for the convoys.',
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
    photo: { file: 'taiho.jpg', credit: 'Taiho, May 1944. Japanese photograph, via Wikimedia Commons · Public domain (Japanese photograph taken before 1946)' },
    displacement: '37,300 t full load',
    armament: ['12 × 10 cm AA guns in twin mounts', '51 × 25 mm AA guns', 'About 65 aircraft'],
    armor: '75 mm armored flight deck, up to 165 mm belt',
    notes: 'Enclosed hurricane bow and a big island with a raked funnel built in, like Shinano. Four shafts.',
  },
  shinano: {
    photo: { file: 'shinano.jpg', credit: 'Shinano on sea trials, 11 November 1944. Photo: Hiroshi Arakawa, via Wikimedia Commons · Public domain (Japanese photograph taken before 1946)' },
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
    photo: { file: 'agano.jpg', credit: 'Yahagi (Agano class) off Sasebo, December 1943. Imperial Japanese Navy photo, via Wikimedia Commons · Public domain (Japanese photograph taken before 1946)' },
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
    photo: { file: 'isub.jpg', credit: 'I-16 (Type C1 submarine), 1940. Japanese photograph, via Wikimedia Commons · Public domain (Japanese photograph taken before 1946)' },
    displacement: '3,560 t submerged',
    armament: ['8 × 53.3 cm bow torpedo tubes, 20 torpedoes', '1 × 14 cm deck gun', 'Carried a Type A midget submarine on deck at Pearl Harbor'],
    armor: 'None',
    notes: 'Large ocean-going boat. Noisy and slow submerged, with poor hydrophones. Two shafts.',
  },
  midget: {
    photo: { file: 'midget.jpg', credit: 'Type A midget submarine HA-19 aground on Oahu, December 1941. U.S. Navy photo, via Wikimedia Commons · Public domain (U.S. Navy photograph)' },
    displacement: '46 t submerged',
    armament: ['2 × 45 cm torpedo tubes (bow, one above the other)'],
    armor: 'None',
    notes: 'Two-man battery boat launched from a mother submarine. Fast for a short dash, then nearly spent. Contra-rotating screws.',
  },
  picket: {
    photo: { file: 'picket.jpg', credit: 'Guard boat No. 23 Nitto Maru sinking after being shelled by USS Nashville, 18 April 1942 (Doolittle Raid). U.S. Navy photo, via Wikimedia Commons, cropped · Public domain (U.S. Navy photograph)' },
    displacement: 'About 70 to 100 GRT',
    armament: ['Machine guns, sometimes a small gun', 'Radio to report sightings'],
    armor: 'None',
    notes: 'Requisitioned fishing trawler on the picket line, like Nittō Maru that reported the Doolittle force. Single screw.',
  },
  kate: {
    photo: { file: 'kate.jpg', credit: 'Nakajima B5N "Kate" in flight. San Diego Air and Space Museum archive, via Wikimedia Commons · Public domain (per Wikimedia Commons)' },
    displacement: '4,100 kg max takeoff',
    armament: ['1 × Type 91 aerial torpedo or 800 kg of bombs', '1 × 7.7 mm rear machine gun'],
    armor: 'None',
    notes: 'Three-seat carrier torpedo bomber with a long greenhouse canopy. Also flew ASW patrols.',
  },
  mavis: {
    photo: { file: 'mavis.jpg', credit: 'Kawanishi H6K "Mavis" flying boat from above. San Diego Air and Space Museum archive, via Wikimedia Commons, cropped · No known copyright restrictions (Flickr Commons)' },
    displacement: '17,000 kg max takeoff',
    armament: ['Up to 2 torpedoes or 1,000 kg of bombs', '1 × 20 mm cannon and 4 × 7.7 mm machine guns'],
    armor: 'None',
    notes: 'Four-engine parasol-wing flying boat with strut-braced wing. Long-range ocean patrol.',
  },
  jake: {
    photo: { file: 'jake.jpg', credit: 'Aichi E13A1 "Jake" floatplane, 1942. Via Wikimedia Commons · Public domain (Japanese photograph taken before 1946)' },
    displacement: '3,600 kg max takeoff',
    armament: ['1 × 250 kg bomb or depth charges', '1 × 7.7 mm rear machine gun'],
    armor: 'None',
    notes: 'Three-seat twin-float reconnaissance floatplane, catapulted from cruisers and battleships.',
  },
  tirpitz: {
    photo: { file: 'tirpitz.jpg', credit: 'Tirpitz seen from astern, 1941. NHHC photo NH 59672 · Public domain (per NHHC)' },
    displacement: '52,600 t full load',
    armament: ['8 × 38 cm guns in four twin turrets', '12 × 15 cm secondary guns', '16 × 10.5 cm AA guns', '8 × 53.3 cm torpedo tubes', '4 Arado Ar 196 floatplanes'],
    armor: '320 mm belt, 360 mm turret faces, up to 120 mm deck',
    notes: "Bismarck's sister, nearly identical at sea. Added torpedo tubes amidships. Three shafts.",
  },
  typevii: {
    photo: { file: 'typevii.jpg', credit: 'Type VII U-boat in the Atlantic, March 1941. Photo: Tolle, via Narodowe Archiwum Cyfrowe (Poland) and Wikimedia Commons · Public domain (per Wikimedia Commons)' },
    displacement: '871 t submerged',
    armament: ['4 bow and 1 stern 53.3 cm torpedo tubes, 14 torpedoes', '1 × 8.8 cm deck gun'],
    armor: 'None',
    notes: 'Workhorse U-boat of the Atlantic. Slow and short-legged on batteries, poor hydrophones at speed. Two shafts.',
  },
  fw200: {
    photo: { file: 'fw200.jpg', credit: 'Focke-Wulf Fw 200C Condor in flight over the sea, 1940. Via Wikimedia Commons; tail swastika painted out · Public domain (per Wikimedia Commons)' },
    displacement: '24,500 kg max takeoff',
    armament: ['Up to 2,100 kg of bombs', '1 to 2 × 20 mm cannon, 3 to 4 machine guns', 'Later models: FuG 200 search radar'],
    armor: 'Light crew armor',
    notes: 'Four-engine converted airliner. Shadowed convoys and homed U-boats onto them.',
  },
  yorktown: {
    photo: { file: 'yorktown.jpg', credit: 'USS Hornet (CV-8), Yorktown class, late 1941. NHHC photo NH 81313 · Public domain (U.S. Navy photograph)' },
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
    photo: { file: 'flower.jpg', credit: 'HMS Delphinium (K77), Flower-class corvette, 1943. Photo: Cmdr Vivian Funge Smith RNR, via Wikimedia Commons · Public domain (per Wikimedia Commons)' },
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
    photo: { file: 'renown.jpg', credit: 'HMS Repulse (Renown class) escorting a troop convoy, 1941. Royal Navy official photographer, IWM A 6793, via Wikimedia Commons, cropped · Public domain (UK Crown Copyright expired)' },
    displacement: '37,400 t full load',
    armament: ['6 × 15 in guns in three twin turrets', '20 × 4 in guns (Renown, twin DP mounts) or 9 × 4 in in triple mounts (Repulse)', '2-pounder pom-poms', '8 × 21 in torpedo tubes', '4 floatplanes'],
    armor: '152 to 229 mm belt, 76 to 127 mm deck (Renown after rebuild)',
    notes: 'Long, lean battlecruisers: two turrets forward, one aft, two funnels. Renown rebuilt with a tower bridge, Repulse kept a tripod. Four shafts.',
  },
  g4m: {
    photo: { file: 'g4m.jpg', credit: 'Mitsubishi G4M "Betty" on an airfield. San Diego Air and Space Museum archive, via Wikimedia Commons · Public domain (per Wikimedia Commons)' },
    displacement: '12,900 kg max takeoff',
    armament: ['1 × Type 91 aerial torpedo or 800 kg of bombs', '1 × 20 mm tail cannon', '4 × 7.7 mm machine guns'],
    armor: 'None, and unprotected fuel tanks',
    notes: 'Twin-engine land-based bomber with a fat cigar fuselage, glazed nose and tail gun cone. Sank Prince of Wales and Repulse.',
  },
  ryujo: {
    photo: { file: 'ryujo.jpg', credit: 'Ryujo underway. NHHC photo NH 73072 (Japanese photograph, donated by Kazutoshi Hando) · Public domain (Japanese photograph taken before 1946; donation of Kazutoshi Hando to NHHC)' },
    displacement: '12,500 t (Ryūjō) to 14,200 t (Shōhō) full load',
    armament: ['8 × 12.7 cm AA guns', '25 mm AA guns', '30 to 37 aircraft'],
    armor: 'Minimal',
    notes: 'Small flush-deck carriers with no island: bridge under the forward lip of the flight deck, small funnels curving down on the starboard side. Ryūjō has a tall, top-heavy double hangar. Two shafts.',
  },
  myoko: {
    photo: { file: 'myoko.jpg', credit: 'Haguro (Myoko class) underway. NHHC photo NH 73016 (Japanese photograph, donated by Kazutoshi Hando) · Public domain (Japanese photograph taken before 1946; donation of Kazutoshi Hando to NHHC)' },
    displacement: '15,900 t full load',
    armament: ['10 × 20.3 cm guns in five twin turrets', '8 × 12.7 cm AA guns', '16 × 61 cm torpedo tubes (Type 93)', '2 to 3 floatplanes'],
    armor: '102 mm belt, 35 mm deck',
    notes: 'Three turrets forward in a pyramid, two aft. Wide trunked forward funnel and a tall aft funnel. Smaller bridge than Takao. Four shafts.',
  },
  aoba: {
    photo: { file: 'aoba.jpg', credit: 'Japanese cruiser Aoba soon after completion, 1927. NHHC photo NH 97727 (from the collection of RAdm Samuel Eliot Morison) · Public domain (per NHHC)' },
    displacement: '10,800 t (Furutaka) to 11,700 t (Aoba) full load',
    armament: ['6 × 20.3 cm guns in three twin turrets', '4 × 12 cm AA guns', '8 × 61 cm torpedo tubes', '1 to 2 floatplanes'],
    armor: '76 mm belt, 32 to 35 mm deck',
    notes: 'Smallest Japanese heavy cruisers: two turrets forward, one aft, two funnels with the forward one wide and trunked. Low sweeping sheer line. Four shafts.',
  },
  sendai: {
    photo: { file: 'sendai.jpg', credit: 'Tama (5,500-ton light cruiser) in northern camouflage. NHHC photo NH 73040 (Japanese photograph, donated by Kazutoshi Hando) · Public domain (Japanese photograph taken before 1946; donation of Kazutoshi Hando to NHHC)' },
    displacement: '7,100 t full load',
    armament: ['7 × 14 cm guns in single mounts', '2 × 8 cm or 12.7 cm AA guns', '8 × 61 cm torpedo tubes', '1 floatplane'],
    armor: '64 mm belt, 29 mm deck',
    notes: 'Destroyer-squadron flagships: tall thin funnels (three, four on Sendai/Jintsū), tripod foremast, scattered single guns. Four shafts.',
  },
  mogami: {
    photo: { file: 'mogami.jpg', credit: 'Suzuya (Mogami class) at speed, aerial view. NHHC photo NH 73034 (Japanese photograph, donated by Kazutoshi Hando), cropped · Public domain (Japanese photograph taken before 1946; donation of Kazutoshi Hando to NHHC)' },
    displacement: '15,000 t full load',
    armament: ['10 × 20.3 cm guns in five twin turrets (rebuilt from 15 × 15.5 cm)', '8 × 12.7 cm AA guns', '12 × 61 cm torpedo tubes (Type 93)', '3 floatplanes'],
    armor: '100 mm belt, 35 to 60 mm deck',
    notes: 'Three turrets forward, two aft, and one big trunked funnel. Compact bridge, long open quarterdeck. Four shafts.',
  },
  scharnhorst: {
    photo: { file: 'scharnhorst.jpg', credit: 'Scharnhorst in harbour, early 1939. Via Wikimedia Commons; bow jack flag (swastika) painted out · Public domain (per Wikimedia Commons)' },
    displacement: '38,100 t full load',
    armament: ['9 × 28 cm guns in three triple turrets', '12 × 15 cm secondary guns', '14 × 10.5 cm AA guns', '6 × 53.3 cm torpedo tubes (from 1942)', '3 to 4 Arado Ar 196 floatplanes'],
    armor: '350 mm belt, 360 mm turret faces, up to 105 mm deck',
    notes: 'Fast, low battleships with a raked "Atlantic" bow. Two triple turrets forward, one aft, single capped funnel. Three shafts.',
  },
  usca: {
    photo: { file: 'usca.jpg', credit: 'USS Houston (CA-30) at sea, 1930s. NHHC photo NH 81592 · Public domain (U.S. Navy photograph)' },
    displacement: '11,500 to 12,500 t full load',
    armament: ['9 × 8 in guns in three triple turrets', '8 × 5 in/25 AA guns', '1.1 in and 20 mm AA guns', '4 floatplanes'],
    armor: '76 to 127 mm belt, 25 to 57 mm deck',
    notes: 'Friendly. Treaty cruisers: two triple turrets forward, one aft, two funnels and tripod masts, hangar amidships. Four shafts.',
  },
  brooklyn: {
    photo: { file: 'brooklyn.jpg', credit: 'USS Honolulu (CL-48), Brooklyn class, underway 9 February 1939. NHHC photo NH 53562 · Public domain (U.S. Navy photograph)' },
    displacement: '12,700 t full load',
    armament: ['15 × 6 in guns in five triple turrets', '8 × 5 in/25 AA guns', '1.1 in, 40 mm and 20 mm AA guns', '4 floatplanes (stern hangar)'],
    armor: '127 mm belt, 52 mm deck',
    notes: 'Friendly. Three triple turrets forward, two aft, two close-set funnels and a high square transom stern. Four shafts.',
  },
  lexington: {
    photo: { file: 'lexington.jpg', credit: 'USS Lexington (CV-2) off Panama, 25 March 1928. NHHC photo NH 64500, cropped · Public domain (U.S. Navy photograph)' },
    displacement: '48,500 t full load',
    armament: ['12 × 5 in/25 AA guns', '8 in twin turrets (removed early 1942)', '1.1 in and 20 mm AA guns', 'About 78 aircraft'],
    armor: '127 to 178 mm belt, 25 to 51 mm deck',
    notes: 'Friendly. Converted battlecruisers, long and big: small island and a huge flat-sided funnel on the starboard side. Turbo-electric drive, four shafts.',
  },
  deruyter: {
    photo: { file: 'deruyter.jpg', credit: 'HNLMS De Ruyter, circa 1942. Australian War Memorial 305837, via Wikimedia Commons, caption strip cropped · Public domain (per Wikimedia Commons)' },
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
    photo: { file: 'town.jpg', credit: 'HMS Sheffield (C24), Town class, underway in Scapa Flow, 28 October 1941. Photo: Lt R.G.G. Coote, Royal Navy official photographer · Public domain (UK Crown Copyright expired) · Wikimedia Commons' },
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
  // ---- Modern war, 2029 ----
  borei: {
    displacement: '24,000 t submerged',
    armament: ['16 × Bulava ballistic missiles', '6 × 533 mm torpedo tubes'],
    armor: 'None. Double hull',
    notes: 'Russia\'s newest missile boat. Long humped missile deck abaft the sail, pump-jet propulsor. Quiet, close to Yasen.',
  },
  belgorod: {
    displacement: '30,000 t submerged',
    armament: ['Up to 6 Poseidon nuclear torpedo drones', 'Carries a deep submersible under the hull', 'Torpedo tubes'],
    armor: 'None. Double hull',
    notes: 'The longest submarine in the world: a stretched Oscar II hull. Heard like an Oscar with extra machinery lines. Two shafts.',
  },
  khabarovsk: {
    displacement: 'About 10,000 t submerged',
    armament: ['Up to 6 Poseidon nuclear torpedo drones', 'Torpedo tubes'],
    armor: 'None',
    notes: 'Poseidon carrier built on Borei technology. Shorter and quieter than Belgorod. Pump-jet.',
  },
  poseidon: {
    displacement: 'About 100 t',
    armament: ['Nuclear warhead (multi-megaton)'],
    armor: 'None',
    notes: 'Uncrewed nuclear-powered torpedo, about 20 m long. Very deep and very fast but loud. A single torpedo hit kills it.',
  },
  kirov: {
    displacement: '25,000 t full load',
    armament: ['20 × P-700 Granit (Pyotr Velikiy) or up to 80 Kalibr, Oniks and Zircon (Admiral Nakhimov) in VLS', 'S-300F/Fort SAMs', '1 × twin 130 mm gun', '10 × 533 mm torpedo tubes, RBU rocket launchers', '3 Ka-27 helicopters'],
    armor: 'Light box armor over reactor and magazines',
    notes: 'Biggest surface warship afloat apart from carriers. Long flat foredeck over the missile silos, two tall towers and a big pyramid mast. Nuclear and steam plant, two shafts.',
  },
  gorshkov: {
    displacement: '5,400 t full load',
    armament: ['16 × Kalibr, Oniks or Zircon in VLS', '32 × Redut SAM cells', '1 × 130 mm gun', '8 × Paket 324 mm torpedo tubes', '1 Ka-27 helicopter'],
    armor: 'None',
    notes: 'Modern frigate, the first Zircon shooter at sea. Pyramid mast with flat phased-array panels, single funnel. Two shafts.',
  },
  steregushchiy: {
    displacement: '2,200 t full load',
    armament: ['8 × Uran anti-ship missiles', 'Redut SAM cells', '1 × 100 mm gun', '8 × Paket 324 mm torpedo tubes', '1 Ka-27 helicopter'],
    armor: 'None',
    notes: 'Stealthy diesel corvette for coastal ASW. Single tall enclosed mast, gun forward, hangar aft. Two shafts.',
  },
  ropucha: {
    displacement: '4,000 t full load',
    armament: ['2 × twin 57 mm guns', '2 × 122 mm rocket launchers (some)', '10 tanks or 25 vehicles, 190 to 225 troops'],
    armor: 'None',
    notes: 'Polish-built landing ship with bow and stern doors. Long, high hull with the superstructure aft of amidships. Two shafts.',
  },
  ivangren: {
    displacement: '6,600 t full load',
    armament: ['1 × 30 mm AK-630M-2 Duet gun mount', '13 tanks or 36 armored vehicles, 300 troops', '1 Ka-29 helicopter'],
    armor: 'None',
    notes: 'Larger successor to Ropucha. Blocky superstructure forward of amidships, crane on the cargo deck, bow ramp. Two shafts.',
  },
  kuznetsov: {
    displacement: '58,500 t full load',
    armament: ['12 × P-700 Granit anti-ship missiles (being removed)', 'Kinzhal SAMs, Kashtan and AK-630 close-in guns', 'Su-33 and MiG-29K fighters, Ka-27 and Ka-31 helicopters', '2 × RBU-12000 anti-torpedo rocket launchers'],
    armor: 'Light protection over magazines',
    notes: 'The only Russian carrier. Ski-jump bow, angled deck, tall island well aft of amidships with a big flat radar block and one funnel. Steam plant, four shafts, prone to breakdowns.',
  },
  serna: {
    displacement: '100 t full load',
    armament: ['1 tank or 2 armored vehicles, or about 90 troops', '2 × 7.62 mm machine guns'],
    armor: 'None',
    notes: 'Small fast landing craft carried by landing ships. Low open well deck, small wheelhouse aft. Fast, fragile, one hit stops it.',
  },
  arktika: {
    displacement: '33,500 t full load',
    armament: ['None'],
    armor: 'Ice belt',
    notes: 'Nuclear icebreaker, two reactors and turbo-electric drive. Tall white superstructure forward, no funnel, helicopter deck aft. Three shafts. Very loud.',
  },
  arc7lng: {
    displacement: '172,600 m³ cargo, about 128,000 t full load',
    armament: ['None'],
    armor: 'Arc7 ice belt',
    notes: 'Icebreaking LNG carrier on the Yamal LNG run. Long trunk deck, accommodation and bridge right aft, stern-first icebreaking with three azimuth pods.',
  },
  trawler: {
    displacement: '1,000 to 3,500 t',
    armament: ['Usually none, sometimes small arms'],
    armor: 'None',
    notes: 'Spy ship on a trawler or Vishnya-type hull, festooned with antennas and radomes. Loiters near exercises and sub bases. Diesel, single or twin screws.',
  },
  type093b: {
    displacement: '7,000 t submerged',
    armament: ['6 × 533 mm torpedo tubes', '12 vertical tubes (YJ-18 anti-ship and land-attack missiles)'],
    armor: 'None',
    notes: 'Improved Shang. Quieter than earlier Chinese boats but still louder than Yasen. Seven-bladed screw, towed array.',
  },
  type095: {
    displacement: 'About 9,000 t submerged',
    armament: ['533 mm torpedo tubes', 'Vertical tubes for YJ-18 missiles'],
    armor: 'None',
    notes: 'Newest Chinese attack boat and the quietest: pump-jet and rafted machinery. Easily mistaken for a Shang III on one line.',
  },
  type094: {
    displacement: '11,000 t submerged',
    armament: ['12 × JL-2 or JL-3 ballistic missiles', '6 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'Tall humped missile deck behind the sail. Noisy for a modern missile boat, with a strong reactor-pump line.',
  },
  type096: {
    displacement: 'About 16,000 t submerged',
    armament: ['16 to 24 × JL-3 ballistic missiles', '533 mm torpedo tubes'],
    armor: 'None',
    notes: 'Next-generation Chinese missile boat, much quieter than the Jin. Pump-jet.',
  },
  type039: {
    displacement: '3,600 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'YJ-82 anti-ship missiles from the tubes', 'Mines'],
    armor: 'None',
    notes: 'Air-independent (Stirling) diesel boat. Can creep quietly for weeks without snorkelling. Single shaft.',
  },
  type055: {
    displacement: '13,000 t full load',
    armament: ['112 vertical launch cells (HHQ-9, YJ-18, YJ-21, ASW rockets)', '1 × 130 mm gun', '324 mm torpedo tubes', '2 helicopters'],
    armor: 'None',
    notes: 'Large stealthy cruiser with an enclosed integrated mast carrying four flat radar faces, one wide funnel, long hangar aft. Two shafts.',
  },
  type052d: {
    displacement: '7,500 t full load',
    armament: ['64 vertical launch cells (HHQ-9, YJ-18, CY-5)', '1 × 130 mm gun', '324 mm torpedo tubes', '1 helicopter'],
    armor: 'None',
    notes: 'Aegis-style destroyer: flat radar faces on a pyramid bridge, single wide funnel, stealthy gun. Two shafts.',
  },
  type054a: {
    displacement: '4,000 t full load',
    armament: ['32 vertical launch cells (HHQ-16)', '8 × YJ-83 anti-ship missiles', '1 × 76 mm gun', '324 mm torpedo tubes', '1 Ka-28 or Z-9 helicopter'],
    armor: 'None',
    notes: 'Workhorse ASW frigate with variable-depth and towed sonar. Two funnels side by side, lattice-free mast. Diesel (CODAD), two shafts.',
  },
  type056: {
    displacement: '1,500 t full load',
    armament: ['4 × YJ-83 anti-ship missiles', '1 × 76 mm gun', 'HHQ-10 point defence', '324 mm torpedo tubes, towed sonar (056A)'],
    armor: 'None',
    notes: 'Small coastal corvette with a helicopter pad but no hangar. Single mast, angled superstructure. Two shafts.',
  },
  type075: {
    displacement: '40,000 t full load',
    armament: ['HHQ-10 point defence', 'Close-in guns', 'About 30 helicopters, landing craft, 900 to 1,200 troops'],
    armor: 'None',
    notes: 'Big-deck amphibious assault ship: full-length flight deck and a long island with two funnels. Two shafts.',
  },
  type071: {
    displacement: '25,000 t full load',
    armament: ['1 × 76 mm gun', 'Close-in guns', '4 hovercraft, 4 helicopters, 600 to 800 troops'],
    armor: 'None',
    notes: 'Amphibious dock ship: tall boxy superstructure forward, helicopter deck and hangar aft, stern well dock. Two shafts.',
  },
  type726: {
    displacement: '160 t full load',
    armament: ['1 tank or about 60 tonnes of vehicles and troops', '2 × 14.5 mm machine guns'],
    armor: 'None',
    notes: 'Chinese hovercraft landing craft carried in the wells of Type 071 and Type 075. Two big ducted fans aft, low square deck, small cab. Very fast, very fragile.',
  },
  fujian: {
    displacement: '80,000 t full load',
    armament: ['HHQ-10 point defence', 'Close-in guns', 'About 50 to 60 aircraft, launched by electromagnetic catapults'],
    armor: 'None',
    notes: 'First Chinese flat-top with catapults: flat flight deck, no ski-jump, a small island set well aft. Conventional steam plant, four shafts.',
  },
  shandong: {
    displacement: '70,000 t full load',
    armament: ['HHQ-10 point defence', 'Close-in guns', 'About 40 aircraft'],
    armor: 'None',
    notes: 'Ski-jump carrier: big upturned bow ramp, large island with a funnel. Steam plant, four shafts.',
  },
  type901: {
    displacement: '48,000 t full load',
    armament: ['Close-in guns', 'Fuel, ammunition and stores for a carrier group', '2 helicopters'],
    armor: 'None',
    notes: 'Fast replenishment ship that keeps up with the carriers. Tall bridge forward, replenishment gantries amidships, funnel and hangar aft.',
  },
  type022: {
    displacement: '224 t full load',
    armament: ['8 × YJ-83 anti-ship missiles', '1 × 30 mm gun'],
    armor: 'None',
    notes: 'Wave-piercing catamaran, very fast and low. Missile boxes aft, small stealthy deckhouse. Waterjets.',
  },
  ccg: {
    displacement: '12,000 t full load',
    armament: ['1 × 76 mm gun', 'Machine guns, water cannon', '1 helicopter'],
    armor: 'None',
    notes: 'Largest coast guard cutters in the world, white hull with a broad stripe. Used to push and shoulder other ships. Two shafts.',
  },
  xuelong2: {
    displacement: '14,000 t full load',
    armament: ['None'],
    armor: 'Ice belt',
    notes: 'Polar research icebreaker with an orange hull, bow and stern icebreaking, A-frame and cranes aft. Azimuth pods.',
  },
  h6k: {
    displacement: '76,000 kg max takeoff',
    armament: ['Up to 6 CJ-20 or KD-20 cruise missiles', 'YJ-12 anti-ship missiles'],
    armor: 'None',
    notes: 'Rebuilt 1950s twin-jet bomber. Swept wing, engines buried in the wing roots, solid radome nose.',
  },
  h6j: {
    displacement: '76,000 kg max takeoff',
    armament: ['Up to 6 YJ-12 supersonic anti-ship missiles'],
    armor: 'None',
    notes: 'Naval version of the H-6K. Same airframe; look for the anti-ship missiles under the wings.',
  },
  kq200: {
    displacement: '61,000 kg max takeoff',
    armament: ['Sonobuoys', 'Lightweight torpedoes, depth charges', 'Chin search radar, MAD tail boom'],
    armor: 'None',
    notes: 'Four-turboprop high-wing transport converted for ASW. Long tail stinger (MAD) and a big chin radome.',
  },
  ka28: {
    displacement: '12,000 kg max takeoff',
    armament: ['VGS-3 dipping sonar', 'Sonobuoys', 'Lightweight torpedo or depth charges'],
    armor: 'None',
    notes: 'Export Ka-27, flown from Chinese destroyers and frigates. Coaxial rotors. Heard on sonar only while its sonar is in the water.',
  },
  vikrant: {
    displacement: '45,000 t full load',
    armament: ['Barak 8 SAMs', 'Close-in guns', 'About 30 aircraft (MiG-29K or Rafale M, helicopters)'],
    armor: 'None',
    notes: 'India\'s home-built ski-jump carrier: upturned bow, island with two funnels. Gas turbines, two shafts.',
  },
  kolkata: {
    displacement: '7,400 t full load',
    armament: ['16 × BrahMos anti-ship missiles', '32 × Barak 8 SAMs', '1 × 76 mm gun', '533 mm torpedo tubes, RBU-6000', '2 helicopters'],
    armor: 'None',
    notes: 'Stealthy destroyer: flat radar faces on a big mast, single funnel, hangar aft. Two shafts.',
  },
  talwar: {
    displacement: '4,000 t full load',
    armament: ['8 × BrahMos or Kalibr in VLS', 'Shtil SAMs', '1 × 100 mm gun', '533 mm torpedo tubes, RBU-6000', '1 helicopter'],
    armor: 'None',
    notes: 'Russian-built frigate, sister of the Admiral Grigorovich. Sounds a little like Udaloy. Two shafts.',
  },
  kalvari: {
    displacement: '1,800 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Exocet SM39 anti-ship missiles', 'Mines'],
    armor: 'None',
    notes: 'French-designed Scorpène diesel boat. Very quiet on battery. Single shaft.',
  },
  arihant: {
    displacement: '6,000 t submerged',
    armament: ['4 × K-4 or 12 × K-15 ballistic missiles', '6 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'India\'s first missile boat, small and noisy for a nuclear sub. Single shaft.',
  },
  jalashwa: {
    displacement: '16,600 t full load',
    armament: ['Close-in guns', '4 landing craft, up to 6 helicopters, about 900 troops'],
    armor: 'None',
    notes: 'Ex-US Austin-class dock ship: long helicopter deck aft, tall block superstructure with two funnels side by side. Steam, two shafts.',
  },
  p8i: {
    displacement: '85,000 kg max takeoff',
    armament: ['Sonobuoys', 'Mk 54 torpedoes, Harpoon missiles', 'Search radar, ESM and a tail MAD boom'],
    armor: 'None',
    notes: 'Indian P-8: a 737 airliner rebuilt as a sub hunter. Unlike the US P-8A it has a MAD stinger in the tail.',
  },
  ghadir: {
    displacement: '125 t submerged',
    armament: ['2 × 533 mm torpedo tubes', 'Mines'],
    armor: 'None',
    notes: 'Midget diesel boat for the shallow Gulf. Hides on the bottom, short endurance. Poor sonar. Single screw.',
  },
  jamaran: {
    displacement: '1,500 t full load',
    armament: ['4 × Noor or Qader anti-ship missiles', 'SM-1 type SAMs', '1 × 76 mm gun', '324 mm torpedo tubes', '1 helicopter'],
    armor: 'None',
    notes: 'Iranian-built frigate on the lines of the old British Vosper Mk 5. Single funnel and a lattice mast. Two shafts.',
  },
  fac: {
    displacement: '200 t full load',
    armament: ['2 to 4 × C-802 or Noor anti-ship missiles', '1 × 76 mm or 30 mm gun'],
    armor: 'None',
    notes: 'Fast missile boat. Low hull, missile boxes aft, small bridge forward of amidships. Often in swarms with speedboats.',
  },
  droneboat: {
    displacement: 'About 2 t',
    armament: ['Explosive charge in the bow'],
    armor: 'None',
    notes: 'Small uncrewed speedboat packed with explosives, steered at ships by remote or GPS. Tiny, very fast, sinks to one hit.',
  },
  riachuelo: {
    displacement: '2,000 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Exocet SM39 anti-ship missiles', 'Mines'],
    armor: 'None',
    notes: 'Stretched Brazilian Scorpène. Sounds like a Kalvari except for its 60 Hz electrical line. Single shaft.',
  },
  alvaro: {
    displacement: '6,000 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Exocet SM39 anti-ship missiles'],
    armor: 'None',
    notes: 'Brazil\'s first nuclear attack boat, a scaled-up Scorpène with a home-built reactor. Noisier than the big navies\' boats.',
  },
  tamandare: {
    displacement: '3,500 t full load',
    armament: ['8 × Exocet MM40 anti-ship missiles', '12 × Sea Ceptor SAMs', '1 × 76 mm gun', '324 mm torpedo tubes', '1 helicopter'],
    armor: 'None',
    notes: 'German MEKO A-100 design: compact stealthy hull, single integrated mast. Two shafts.',
  },
  p3am: {
    displacement: '64,400 kg max takeoff',
    armament: ['Sonobuoys', 'Mk 46 torpedoes, Harpoon missiles', 'Search radar and a tail MAD boom'],
    armor: 'None',
    notes: 'Brazil\'s rebuilt Orions. Four turboprops, low wing and a long MAD stinger in the tail.',
  },
  type209: {
    displacement: '1,600 t submerged',
    armament: ['8 × 533 mm torpedo tubes', 'Mines'],
    armor: 'None',
    notes: 'German export diesel boat. South Africa\'s Heroine class and Venezuela\'s Sábalo and Caribe are this family. Single shaft.',
  },
  valour: {
    displacement: '3,600 t full load',
    armament: ['8 × Exocet anti-ship missiles', '16 × Umkhonto SAMs', '1 × 76 mm gun', '324 mm torpedo tubes', '1 helicopter'],
    armor: 'None',
    notes: 'German MEKO A-200 frigate. Sister design to Brazil\'s Tamandaré, on a 50 Hz grid. Two shafts and a waterjet.',
  },
  ford: {
    displacement: '100,000 t full load',
    armament: ['ESSM and RAM point defence', 'Close-in guns', 'About 75 aircraft, electromagnetic catapults'],
    armor: 'None',
    notes: 'Friendly. Nuclear supercarrier: angled deck and a small island set well aft. Four shafts.',
  },
  taigei: {
    displacement: '4,300 t submerged',
    armament: ['6 × 533 mm torpedo tubes (Type 18 torpedoes)', 'Harpoon from the tubes'],
    armor: 'None',
    notes: 'Friendly. Japanese diesel boat on lithium-ion batteries: very quiet and quick on battery. X-shaped rudders.',
  },
  maya: {
    displacement: '10,250 t full load',
    armament: ['96 vertical launch cells (SM-3, SM-6, SM-2)', 'Type 90 and Type 17 anti-ship missiles', '1 × 5 in gun', '324 mm torpedo tubes', '1 helicopter'],
    armor: 'None',
    notes: 'Friendly. Japanese Aegis destroyer, an enlarged Arleigh Burke with a taller bridge. Not the 1942 cruiser of the same name. Two shafts.',
  },
  collins: {
    displacement: '3,400 t submerged',
    armament: ['6 × 533 mm torpedo tubes (Mk 48)', 'Harpoon from the tubes', 'Mines'],
    armor: 'None',
    notes: 'Friendly. Large Australian diesel boat. Louder than the newest SSKs when snorting. Single shaft.',
  },
  nansen: {
    displacement: '5,300 t full load',
    armament: ['8 × Naval Strike Missiles', '8 Mk 41 cells (ESSM)', '1 × 76 mm gun', '324 mm torpedo tubes', '1 NH90 helicopter'],
    armor: 'None',
    notes: 'Friendly. Norwegian Aegis frigate: tall square tower carrying the flat SPY-1F radar faces. Two shafts.',
  },
  type26: {
    displacement: '8,000 t full load',
    armament: ['24 Mk 41 cells', '48 × Sea Ceptor SAMs', '1 × 5 in gun', 'Merlin or Wildcat helicopter', 'Type 2087 towed sonar'],
    armor: 'None',
    notes: 'Friendly. Very quiet British ASW frigate. Mission bay amidships, single funnel, tall mast forward. Two shafts.',
  },
  qnlz: {
    displacement: '65,000 t full load',
    armament: ['Phalanx close-in guns', 'Up to 36 F-35B jets plus helicopters'],
    armor: 'None',
    notes: 'Friendly. Ski-jump carrier with two islands: the forward one for navigation, the aft one for flying. Not the 1915 battleship. Two shafts.',
  },
  p8a: {
    displacement: '85,800 kg max takeoff',
    armament: ['Sonobuoys', 'Mk 54 torpedoes, Harpoon missiles', 'APY-10 search radar and ESM'],
    armor: 'None',
    notes: 'Friendly. A 737 airliner rebuilt as a sub hunter, with raked wingtips and no MAD boom in the tail.',
  },
  reis: {
    displacement: '2,000 t submerged',
    armament: ['8 × 533 mm torpedo tubes', 'Sub-Harpoon from the tubes', 'Mines'],
    armor: 'None',
    notes: 'Neutral. Turkish-built Type 214 with fuel-cell air-independent drive: very quiet. Do not fire on it. Single shaft.',
  },
  tanker: {
    displacement: '150,000 to 320,000 t (VLCC)',
    armament: ['None'],
    armor: 'None',
    notes: 'Huge, slow and loud. Flat deck with pipework, accommodation block and funnel right aft. One big slow-turning screw.',
  },
  lng: {
    displacement: '100,000 to 125,000 t',
    armament: ['None'],
    armor: 'None',
    notes: 'Gas carrier. Moss type has a row of big domed tanks along the deck; bridge and funnel aft. Single shaft.',
  },
  tender: {
    displacement: '23,500 t full load',
    armament: ['Close-in guns and machine guns', 'Workshops, spares and torpedoes for submarines'],
    armor: 'None',
    notes: 'Friendly. Submarine tender: tall block superstructure, big cranes amidships. Subs moor alongside. Single shaft.',
  },
  rescueship: {
    displacement: 'About 4,000 t',
    armament: ['None. Carries the SRDRS rescue system and its pressurized rescue module'],
    armor: 'None',
    notes: 'Friendly. Chartered offshore support ship: bridge forward, long open working deck aft with an A-frame. Thrusters keep her loud even when stopped.',
  },
  ...REFERENCE_80S,
};
