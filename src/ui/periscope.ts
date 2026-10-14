// Periscope view: what the selected contact looks like through the photonics mast,
// drawn from its class silhouette at the real range and aspect, with the ID book
// alongside so the player can compare shapes and accept a class.
import { CLASSES } from '../sim/classes';
import { contactById, contactLabel, inPeriscope, isFriendlyClass, orders, type Game, type Vessel } from '../sim/sim';
import { angDiff, brg, dist, fmtBrg, fmtRng } from '../sim/math';

// ---- Silhouettes ------------------------------------------------------------------------
// Ships: x runs 0 (stern) to 1 (bow), heights in metres above the waterline.
// Approximate shapes from period photographs; enough to tell the classes apart, and to
// see why Hood's gunners took Prinz Eugen for Bismarck.
type Part =
  | { t: 'box'; x0: number; x1: number; h: number }
  | { t: 'funnel'; x: number; w: number; h: number; rake?: number }
  | { t: 'turret'; x: number; w: number; h: number; gun: number }
  | { t: 'mast'; x: number; h: number; tripod?: boolean }
  // A thin horizontal plate `th` metres deep under height h: flight decks with open space
  // beneath them, rangefinder arms, pagoda platforms.
  | { t: 'slab'; x0: number; x1: number; h: number; th: number }
  // A Japanese carrier funnel that leaves the hull side under the flight deck and bends down,
  // its mouth at height m. Seen broadside it shows only where the hull is open around it.
  | { t: 'dfunnel'; x: number; w: number; h: number; m: number };
interface ShipSil { kind: 'ship'; len: number; deck: [number, number][]; parts: Part[] }
interface AirSil { kind: 'air'; len: number; alt: number; draw: (c: CanvasRenderingContext2D, L: number) => void }
type Sil = ShipSil | AirSil;

const T = (x: number, h: number, w = 0.045, gun = 0.07): Part => ({ t: 'turret', x, w, h, gun });
const B = (x0: number, x1: number, h: number): Part => ({ t: 'box', x0, x1, h });
const F = (x: number, w: number, h: number, rake?: number): Part => ({ t: 'funnel', x, w, h, rake });
const M = (x: number, h: number, tripod?: boolean): Part => ({ t: 'mast', x, h, tripod });
const S = (x0: number, x1: number, h: number, th = 1.2): Part => ({ t: 'slab', x0, x1, h, th });
const D = (x: number, w: number, h: number, m: number): Part => ({ t: 'dfunnel', x, w, h, m });
/** Pillars holding up a flight-deck overhang. */
const pillars = (xs: number[], h: number): Part[] => xs.map((x) => B(x, x + 0.004, h));

const SHIPS: Record<string, ShipSil> = {
  bismarck: {
    kind: 'ship', len: 251, deck: [[0, 7], [0.15, 8], [0.55, 8], [0.85, 9], [1, 11]],
    parts: [T(0.12, 12), T(0.21, 15), { t: 'box', x0: 0.28, x1: 0.38, h: 16 }, { t: 'mast', x: 0.34, h: 34 },
      T(0.4, 13, 0.025, 0.035), { t: 'funnel', x: 0.47, w: 0.05, h: 26 }, T(0.56, 13, 0.025, 0.035),
      { t: 'box', x0: 0.52, x1: 0.63, h: 20 }, { t: 'box', x0: 0.55, x1: 0.61, h: 28 }, { t: 'mast', x: 0.58, h: 38 },
      T(0.7, 15), T(0.79, 13)],
  },
  hipper: {
    kind: 'ship', len: 212, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 10]],
    parts: [T(0.12, 10, 0.045, 0.06), T(0.2, 13, 0.045, 0.06), { t: 'box', x0: 0.27, x1: 0.36, h: 13 }, { t: 'mast', x: 0.33, h: 28 },
      { t: 'funnel', x: 0.46, w: 0.055, h: 23, rake: 0.01 }, { t: 'box', x0: 0.52, x1: 0.61, h: 19 }, { t: 'box', x0: 0.55, x1: 0.6, h: 25 },
      { t: 'mast', x: 0.57, h: 33 }, T(0.72, 13, 0.045, 0.06), T(0.8, 11, 0.045, 0.06)],
  },
  county: {
    kind: 'ship', len: 192, deck: [[0, 8], [0.6, 10], [1, 11]],
    parts: [T(0.12, 12, 0.04, 0.05), T(0.2, 15, 0.04, 0.05), { t: 'mast', x: 0.3, h: 32, tripod: true },
      { t: 'funnel', x: 0.4, w: 0.028, h: 30 }, { t: 'funnel', x: 0.48, w: 0.028, h: 30 }, { t: 'funnel', x: 0.56, w: 0.028, h: 30 },
      { t: 'box', x0: 0.61, x1: 0.68, h: 20 }, { t: 'mast', x: 0.63, h: 36, tripod: true }, T(0.74, 15, 0.04, 0.05), T(0.82, 13, 0.04, 0.05)],
  },
  admiral: {
    kind: 'ship', len: 262, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 10]],
    parts: [T(0.13, 11), T(0.22, 14), { t: 'box', x0: 0.35, x1: 0.43, h: 14 }, { t: 'mast', x: 0.39, h: 30, tripod: true },
      { t: 'funnel', x: 0.48, w: 0.04, h: 24 }, { t: 'funnel', x: 0.56, w: 0.04, h: 24 },
      { t: 'box', x0: 0.6, x1: 0.69, h: 22 }, { t: 'box', x0: 0.62, x1: 0.67, h: 30 }, { t: 'mast', x: 0.65, h: 38, tripod: true },
      T(0.72, 14), T(0.81, 12)],
  },
  kgv: {
    kind: 'ship', len: 227, deck: [[0, 7], [0.5, 8], [1, 10]],
    parts: [T(0.15, 12, 0.06), { t: 'box', x0: 0.3, x1: 0.41, h: 17 }, { t: 'mast', x: 0.37, h: 32 },
      { t: 'funnel', x: 0.44, w: 0.05, h: 23 }, { t: 'funnel', x: 0.53, w: 0.05, h: 23 },
      { t: 'box', x0: 0.57, x1: 0.67, h: 22 }, { t: 'box', x0: 0.59, x1: 0.65, h: 28 }, { t: 'mast', x: 0.62, h: 36 },
      T(0.7, 15, 0.04), T(0.79, 12, 0.06)],
  },
  merchant: {
    kind: 'ship', len: 130, deck: [[0, 7], [0.1, 8], [0.12, 6], [0.85, 6], [0.88, 8], [1, 9]],
    parts: [{ t: 'box', x0: 0, x1: 0.1, h: 10 }, { t: 'mast', x: 0.24, h: 24 }, { t: 'box', x0: 0.42, x1: 0.56, h: 15 },
      { t: 'funnel', x: 0.5, w: 0.06, h: 21 }, { t: 'mast', x: 0.74, h: 24 }, { t: 'box', x0: 0.88, x1: 1, h: 10 }],
  },

  // ---- Pacific and Atlantic WWII ----
  // Carriers: hull, hangar block, then the flight deck as a slab so its overhangs and the
  // open galleries under it show against the sky.
  akagi: {
    kind: 'ship', len: 261, deck: [[0, 7], [0.1, 9], [0.85, 10], [1, 12]],
    parts: [B(0.06, 0.47, 20.5), B(0.61, 0.85, 20.5), B(0.85, 0.88, 15), S(0.02, 0.9, 22, 1.4),
      ...pillars([0.03, 0.88], 22), D(0.535, 0.06, 20.5, 11), F(0.585, 0.018, 21),
      B(0.62, 0.66, 28), M(0.645, 34), T(0.94, 15, 0.03, 0.03)],
  },
  kaga: {
    kind: 'ship', len: 248, deck: [[0, 8], [0.5, 9], [0.88, 10], [1, 12]],
    parts: [B(0.05, 0.44, 20), B(0.56, 0.9, 20), S(0.01, 0.94, 21.5, 1.4), ...pillars([0.02, 0.92], 21.5),
      D(0.5, 0.07, 20, 11.5), B(0.66, 0.71, 27), B(0.67, 0.7, 30), M(0.69, 34)],
  },
  soryu: {
    kind: 'ship', len: 227, deck: [[0, 7], [0.5, 8], [0.9, 9], [1, 10]],
    parts: [B(0.07, 0.5, 12.5), B(0.61, 0.9, 12.5), S(0.0, 0.96, 14, 1.2), ...pillars([0.02, 0.93], 14),
      D(0.535, 0.025, 12.5, 8.5), D(0.575, 0.025, 12.5, 8.5), B(0.72, 0.77, 20), M(0.745, 27)],
  },
  shokaku: {
    kind: 'ship', len: 257, deck: [[0, 8], [0.5, 9], [0.88, 10], [1, 12]],
    parts: [B(0.05, 0.5, 14.5), B(0.61, 0.92, 14.5), S(0.0, 0.96, 16, 1.3), ...pillars([0.02, 0.94], 16),
      D(0.535, 0.028, 14.5, 9.5), D(0.575, 0.028, 14.5, 9.5), B(0.65, 0.7, 23), B(0.66, 0.69, 26), M(0.675, 32)],
  },
  taiho: {
    kind: 'ship', len: 260, deck: [[0, 8], [0.5, 9], [0.9, 10], [0.96, 15], [1, 17]],
    parts: [B(0.04, 0.97, 16.5), S(0.0, 0.98, 18, 1.5), ...pillars([0.015], 18),
      B(0.58, 0.66, 27), B(0.6, 0.65, 31), F(0.575, 0.045, 36, 0.025), M(0.63, 40)],
  },
  shinano: {
    kind: 'ship', len: 266, deck: [[0, 8], [0.3, 8.5], [0.85, 9.5], [0.95, 13], [1, 16]],
    parts: [B(0.04, 0.96, 17), S(0.0, 0.97, 19, 1.6), ...pillars([0.015], 19),
      B(0.55, 0.65, 28), B(0.57, 0.64, 32), F(0.555, 0.05, 38, 0.03), M(0.62, 42)],
  },
  kongo: {
    kind: 'ship', len: 222, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 10]],
    parts: [T(0.13, 10), T(0.37, 11), M(0.3, 28, true), F(0.44, 0.04, 22), F(0.54, 0.045, 22),
      B(0.6, 0.7, 16), B(0.615, 0.69, 24), B(0.625, 0.68, 32), B(0.635, 0.67, 40), S(0.605, 0.705, 25), S(0.615, 0.69, 33),
      S(0.625, 0.68, 41), M(0.65, 48), T(0.76, 13), T(0.84, 10)],
  },
  yamato: {
    kind: 'ship', len: 263, deck: [[0, 8], [0.3, 9], [0.6, 9.5], [0.85, 11], [1, 13]],
    parts: [T(0.24, 13, 0.06, 0.08), T(0.33, 16, 0.035, 0.035), M(0.37, 30), F(0.445, 0.07, 30, 0.035),
      B(0.48, 0.57, 18), B(0.5, 0.56, 28), B(0.51, 0.55, 37), S(0.495, 0.575, 40, 1.6), M(0.53, 46),
      T(0.6, 17, 0.035, 0.035), T(0.67, 17, 0.06, 0.08), T(0.75, 14, 0.06, 0.08)],
  },
  takao: {
    kind: 'ship', len: 204, deck: [[0, 6], [0.4, 6.5], [0.45, 8.5], [0.85, 9], [1, 10]],
    parts: [T(0.12, 10, 0.04, 0.05), T(0.19, 12.5, 0.04, 0.05), M(0.32, 26), F(0.42, 0.03, 23),
      F(0.51, 0.07, 22, 0.03), B(0.56, 0.69, 18), B(0.575, 0.68, 23), B(0.59, 0.67, 27), M(0.6, 32, true),
      T(0.73, 12.5, 0.04, 0.05), T(0.8, 15, 0.04, 0.05), T(0.87, 12.5, 0.04, 0.05)],
  },
  agano: {
    kind: 'ship', len: 174, deck: [[0, 5], [0.5, 6], [0.62, 7.5], [1, 9]],
    parts: [T(0.17, 9, 0.04, 0.05), M(0.34, 24), B(0.38, 0.43, 9), F(0.47, 0.065, 20, 0.02),
      B(0.58, 0.67, 15), B(0.6, 0.66, 19), M(0.57, 30, true), T(0.73, 13, 0.04, 0.05), T(0.8, 10.5, 0.04, 0.05)],
  },
  kagero: {
    kind: 'ship', len: 119, deck: [[0, 4], [0.62, 4.5], [0.64, 6.5], [0.9, 7], [1, 8]],
    parts: [T(0.13, 7, 0.05, 0.05), T(0.22, 9, 0.05, 0.05), B(0.35, 0.41, 6.5), F(0.47, 0.035, 13, 0.01),
      B(0.52, 0.57, 6.5), F(0.6, 0.045, 14, 0.012), M(0.665, 22), B(0.68, 0.77, 12), T(0.84, 10, 0.055, 0.05)],
  },
  fletcher: {
    kind: 'ship', len: 114, deck: [[0, 4], [0.5, 5], [0.85, 6], [1, 7]],
    parts: [T(0.12, 7.5, 0.045, 0.04), T(0.21, 9.5, 0.045, 0.04), B(0.25, 0.33, 7), T(0.3, 11, 0.045, 0.04),
      B(0.36, 0.4, 7.5), F(0.45, 0.035, 14), B(0.49, 0.53, 7.5), F(0.57, 0.04, 14.5), M(0.64, 25),
      B(0.65, 0.75, 13), B(0.67, 0.74, 15.5), T(0.8, 10.5, 0.045, 0.04), T(0.87, 8.5, 0.045, 0.04)],
  },
  wickes: {
    kind: 'ship', len: 95, deck: [[0, 3.5], [0.6, 4], [0.85, 5], [1, 6]],
    parts: [B(0.12, 0.24, 6), T(0.18, 7.5, 0.025, 0.04), M(0.3, 16), F(0.42, 0.025, 12), F(0.5, 0.025, 12.5),
      F(0.58, 0.025, 12.5), F(0.66, 0.025, 12), M(0.73, 20), B(0.75, 0.83, 9.5), T(0.88, 7.5, 0.025, 0.04)],
  },
  atlanta: {
    kind: 'ship', len: 165, deck: [[0, 5], [0.55, 6], [0.62, 8], [1, 9]],
    parts: [T(0.13, 9, 0.04, 0.04), T(0.2, 12, 0.04, 0.04), T(0.27, 15, 0.04, 0.04), B(0.31, 0.36, 12),
      M(0.36, 24), F(0.43, 0.035, 19), F(0.52, 0.035, 19), B(0.59, 0.69, 16), B(0.61, 0.68, 20), M(0.64, 32, true),
      T(0.73, 16, 0.04, 0.04), T(0.8, 13, 0.04, 0.04), T(0.87, 10, 0.04, 0.04)],
  },
  flower: {
    kind: 'ship', len: 62, deck: [[0, 3.5], [0.55, 3.5], [0.6, 5.5], [0.9, 6], [1, 7]],
    parts: [B(0.15, 0.3, 6), T(0.24, 7.5, 0.04, 0.05), F(0.47, 0.07, 12, 0.012), M(0.58, 18),
      B(0.62, 0.76, 10), B(0.64, 0.74, 11.5), T(0.86, 8, 0.05, 0.09)],
  },
  liberty: {
    kind: 'ship', len: 135, deck: [[0, 7], [0.09, 9], [0.11, 6], [0.88, 6], [0.9, 8.5], [1, 9.5]],
    parts: [B(0, 0.1, 10), T(0.05, 11.5, 0.03, 0.04), M(0.27, 26), B(0.4, 0.58, 13), B(0.48, 0.58, 17),
      F(0.45, 0.04, 23, 0.008), M(0.65, 26), M(0.78, 26), B(0.9, 1, 9.5)],
  },
  picket: {
    kind: 'ship', len: 35, deck: [[0, 2.5], [0.7, 3], [1, 4.5]],
    parts: [M(0.15, 9), B(0.3, 0.42, 5), F(0.36, 0.06, 8.5), B(0.45, 0.62, 7.5), M(0.72, 13)],
  },
  tirpitz: {
    kind: 'ship', len: 251, deck: [[0, 7], [0.15, 8], [0.55, 8], [0.85, 9], [1, 11]],
    parts: [T(0.12, 12), T(0.21, 15), { t: 'box', x0: 0.28, x1: 0.38, h: 16 }, { t: 'box', x0: 0.31, x1: 0.36, h: 20 }, { t: 'mast', x: 0.34, h: 34 },
      T(0.4, 13, 0.025, 0.035), { t: 'funnel', x: 0.47, w: 0.05, h: 26 }, T(0.56, 13, 0.025, 0.035),
      { t: 'box', x0: 0.52, x1: 0.63, h: 20 }, { t: 'box', x0: 0.55, x1: 0.61, h: 28 }, { t: 'mast', x: 0.58, h: 38 },
      T(0.7, 15), T(0.79, 13)],
  },
  yorktown: {
    kind: 'ship', len: 252, deck: [[0, 8], [0.5, 9], [0.9, 10], [1, 12]],
    parts: [B(0.06, 0.9, 16), S(0.0, 0.97, 17.5, 1.3), ...pillars([0.02, 0.94], 17.5),
      B(0.54, 0.66, 25), B(0.56, 0.64, 30), F(0.6, 0.06, 35, 0.006), M(0.63, 44, true)],
  },
  // ---- 1942 additions ----
  renown: {
    kind: 'ship', len: 242, deck: [[0, 7], [0.5, 8], [0.85, 9], [1, 11]],
    parts: [T(0.2, 12, 0.05, 0.07), M(0.33, 30, true), F(0.44, 0.04, 24), F(0.53, 0.04, 24),
      B(0.58, 0.68, 20), B(0.6, 0.66, 28), M(0.63, 38, true), T(0.72, 14, 0.05, 0.07), T(0.8, 12, 0.05, 0.07)],
  },
  // Flush deck, no island: bridge tucked under the forward lip of the flight deck.
  ryujo: {
    kind: 'ship', len: 180, deck: [[0, 6], [0.5, 7], [0.9, 8], [1, 10]],
    parts: [B(0.08, 0.84, 16), S(0.02, 0.86, 17.5, 1.2), ...pillars([0.03], 17.5),
      D(0.55, 0.03, 16, 9), D(0.6, 0.03, 16, 9), B(0.84, 0.88, 15.5)],
  },
  myoko: {
    kind: 'ship', len: 204, deck: [[0, 6], [0.4, 6.5], [0.45, 8.5], [0.85, 9], [1, 10]],
    parts: [T(0.12, 10, 0.04, 0.05), T(0.19, 12.5, 0.04, 0.05), M(0.3, 26), F(0.41, 0.035, 22, 0.02),
      F(0.5, 0.07, 21, 0.03), B(0.56, 0.66, 17), B(0.58, 0.65, 22), M(0.6, 30, true),
      T(0.71, 12.5, 0.04, 0.05), T(0.78, 15, 0.04, 0.05), T(0.85, 12.5, 0.04, 0.05)],
  },
  aoba: {
    kind: 'ship', len: 185, deck: [[0, 5], [0.45, 5.5], [0.5, 7.5], [1, 9]],
    parts: [T(0.15, 9, 0.04, 0.05), M(0.27, 24), F(0.42, 0.035, 19, 0.02), F(0.5, 0.06, 19, 0.02),
      B(0.58, 0.67, 15), B(0.6, 0.66, 19), M(0.62, 28, true), T(0.73, 12.5, 0.04, 0.05), T(0.8, 10.5, 0.04, 0.05)],
  },
  sendai: {
    kind: 'ship', len: 163, deck: [[0, 4.5], [0.6, 5], [0.66, 7], [1, 8]],
    parts: [T(0.08, 7, 0.025, 0.05), T(0.2, 7, 0.025, 0.05), M(0.27, 22), F(0.38, 0.03, 17), F(0.46, 0.03, 17), F(0.54, 0.03, 17),
      B(0.66, 0.73, 13), B(0.67, 0.72, 16), M(0.7, 28, true), T(0.8, 10, 0.025, 0.05), T(0.88, 9, 0.025, 0.05)],
  },
  mogami: {
    kind: 'ship', len: 201, deck: [[0, 6], [0.42, 6.5], [0.46, 8.5], [0.85, 9], [1, 10]],
    parts: [T(0.12, 10, 0.04, 0.05), T(0.19, 12.5, 0.04, 0.05), M(0.3, 24, true), F(0.47, 0.08, 21, 0.03),
      B(0.55, 0.66, 18), B(0.57, 0.65, 23), M(0.59, 30),
      T(0.71, 12.5, 0.04, 0.05), T(0.78, 15, 0.04, 0.05), T(0.85, 12.5, 0.04, 0.05)],
  },
  scharnhorst: {
    kind: 'ship', len: 235, deck: [[0, 7], [0.15, 7.5], [0.55, 8], [0.85, 9.5], [1, 12]],
    parts: [T(0.2, 12, 0.05), B(0.3, 0.36, 15), M(0.33, 30), T(0.4, 12, 0.025, 0.035), F(0.48, 0.05, 24, 0.012),
      T(0.55, 12, 0.025, 0.035), B(0.57, 0.66, 20), B(0.59, 0.65, 27), B(0.6, 0.64, 32), M(0.62, 38),
      T(0.72, 15, 0.05), T(0.8, 12.5, 0.05)],
  },
  usca: {
    kind: 'ship', len: 183, deck: [[0, 6], [0.5, 6.5], [0.55, 9], [1, 10]],
    parts: [T(0.18, 10, 0.045, 0.06), M(0.3, 30, true), B(0.33, 0.37, 13), F(0.43, 0.035, 21), F(0.52, 0.035, 21),
      B(0.58, 0.67, 16), B(0.6, 0.66, 21), M(0.63, 34, true), T(0.73, 15, 0.045, 0.06), T(0.81, 12, 0.045, 0.06)],
  },
  // High square transom stern with the aircraft hangar in it.
  brooklyn: {
    kind: 'ship', len: 186, deck: [[0, 7], [0.5, 7.5], [1, 9.5]],
    parts: [T(0.08, 10, 0.04, 0.045), T(0.16, 12.5, 0.04, 0.045), B(0.24, 0.31, 14), M(0.28, 26),
      F(0.41, 0.035, 20), F(0.49, 0.035, 20), B(0.56, 0.64, 16), B(0.57, 0.63, 21), M(0.6, 30),
      T(0.7, 11, 0.04, 0.045), T(0.78, 14, 0.04, 0.045), T(0.86, 11, 0.04, 0.045)],
  },
  // Huge flat-sided funnel abaft a small island.
  lexington: {
    kind: 'ship', len: 270, deck: [[0, 8], [0.5, 9], [0.9, 10], [1, 12]],
    parts: [B(0.06, 0.9, 17), S(0.0, 0.97, 19, 1.4), ...pillars([0.02, 0.94], 19),
      F(0.49, 0.13, 34, 0.003), B(0.58, 0.63, 27), B(0.59, 0.62, 31), M(0.6, 40, true)],
  },
  // De Ruyter: twin and single turret forward, two twins aft, one funnel, tower bridge.
  deruyter: {
    kind: 'ship', len: 171, deck: [[0, 5], [0.55, 5.5], [0.6, 7.5], [1, 8.5]],
    parts: [T(0.12, 9, 0.045, 0.05), T(0.2, 11.5, 0.045, 0.05), M(0.3, 22), F(0.45, 0.06, 20, 0.015),
      B(0.56, 0.66, 15), B(0.575, 0.65, 22), B(0.59, 0.64, 27), M(0.62, 32),
      T(0.73, 12, 0.03, 0.05), T(0.8, 9.5, 0.045, 0.05)],
  },
  town: {
    kind: 'ship', len: 187, deck: [[0, 6], [0.45, 6.5], [0.5, 8.5], [1, 9.5]],
    parts: [T(0.12, 10, 0.045, 0.05), T(0.2, 13, 0.045, 0.05), B(0.24, 0.3, 13), M(0.3, 28, true),
      F(0.4, 0.035, 21, 0.012), B(0.45, 0.56, 14), F(0.53, 0.035, 21, 0.012),
      B(0.58, 0.67, 17), B(0.6, 0.66, 22), M(0.63, 32, true), T(0.73, 13, 0.045, 0.05), T(0.81, 10, 0.045, 0.05)],
  },

  // ---- 1939 to 1941 ----
  deutschland: {
    kind: 'ship', len: 186, deck: [[0, 5.5], [0.5, 6], [0.85, 7], [1, 8.5]],
    parts: [T(0.18, 10, 0.055, 0.06), B(0.3, 0.35, 11), M(0.33, 24), F(0.47, 0.05, 21, 0.012),
      B(0.56, 0.66, 15), B(0.58, 0.65, 21), B(0.59, 0.64, 27), M(0.62, 32), T(0.75, 12, 0.055, 0.06)],
  },
  zerstorer: {
    kind: 'ship', len: 120, deck: [[0, 4], [0.65, 4.5], [0.68, 6.5], [1, 7.5]],
    parts: [T(0.1, 7, 0.03, 0.04), T(0.18, 9, 0.03, 0.04), B(0.26, 0.3, 7), T(0.34, 8, 0.03, 0.04),
      F(0.47, 0.04, 14, 0.012), F(0.57, 0.04, 14, 0.012), M(0.66, 22), B(0.68, 0.76, 12),
      T(0.82, 10, 0.03, 0.04), T(0.88, 8, 0.03, 0.04)],
  },
  cavour: {
    kind: 'ship', len: 186, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 10]],
    parts: [T(0.14, 10, 0.055, 0.065), T(0.22, 13, 0.045, 0.065), M(0.33, 22), F(0.42, 0.045, 22, 0.01), F(0.51, 0.045, 22, 0.01),
      B(0.56, 0.66, 18), B(0.58, 0.65, 25), B(0.59, 0.64, 31), M(0.62, 36),
      T(0.72, 13, 0.045, 0.065), T(0.8, 10, 0.055, 0.065)],
  },
  littorio: {
    kind: 'ship', len: 238, deck: [[0, 9], [0.06, 9], [0.1, 7.5], [0.5, 8], [0.85, 9], [1, 11]],
    parts: [T(0.2, 13, 0.06, 0.075), B(0.3, 0.36, 16), M(0.34, 28), F(0.45, 0.045, 25, 0.01), F(0.53, 0.045, 25, 0.01),
      B(0.57, 0.66, 20), B(0.585, 0.65, 28), B(0.6, 0.64, 34), M(0.62, 40),
      T(0.72, 16, 0.06, 0.075), T(0.8, 13, 0.06, 0.075)],
  },
  zara: {
    kind: 'ship', len: 182, deck: [[0, 5.5], [0.5, 6.5], [0.85, 7.5], [1, 9]],
    parts: [T(0.12, 9.5, 0.04, 0.05), T(0.2, 12, 0.04, 0.05), M(0.3, 24, true), F(0.43, 0.04, 20), F(0.52, 0.04, 20),
      B(0.57, 0.66, 16), B(0.585, 0.65, 22), B(0.595, 0.64, 27), M(0.62, 32),
      T(0.73, 12, 0.04, 0.05), T(0.81, 9.5, 0.04, 0.05)],
  },
  soldati: {
    kind: 'ship', len: 107, deck: [[0, 3.5], [0.66, 4], [0.7, 6], [1, 7]],
    parts: [T(0.12, 7, 0.045, 0.045), B(0.25, 0.3, 6), M(0.3, 14), F(0.5, 0.06, 13, 0.012), M(0.67, 20),
      B(0.7, 0.78, 11), T(0.85, 9, 0.045, 0.045)],
  },
  qe: {
    kind: 'ship', len: 196, deck: [[0, 6], [0.5, 7], [0.85, 8], [1, 9.5]],
    parts: [T(0.12, 11, 0.05, 0.07), T(0.2, 14, 0.05, 0.07), M(0.3, 26, true), B(0.36, 0.44, 12), F(0.5, 0.06, 24, 0.006),
      B(0.56, 0.67, 20), B(0.58, 0.66, 27), B(0.59, 0.65, 32), M(0.62, 36),
      T(0.73, 14, 0.05, 0.07), T(0.81, 11, 0.05, 0.07)],
  },
  leander: {
    kind: 'ship', len: 169, deck: [[0, 5], [0.45, 5.5], [0.5, 7.5], [1, 8.5]],
    parts: [T(0.12, 9, 0.04, 0.05), T(0.2, 11.5, 0.04, 0.05), M(0.3, 26, true), F(0.47, 0.07, 20, 0.01),
      B(0.56, 0.65, 15), B(0.575, 0.64, 19), M(0.61, 30, true), T(0.72, 12, 0.04, 0.05), T(0.8, 9.5, 0.04, 0.05)],
  },
  hclass: {
    kind: 'ship', len: 100, deck: [[0, 3.5], [0.66, 4], [0.68, 6], [1, 7]],
    parts: [T(0.1, 6.5, 0.035, 0.045), T(0.18, 8.5, 0.035, 0.045), F(0.42, 0.04, 12, 0.012), F(0.53, 0.045, 13, 0.012),
      M(0.66, 22), B(0.68, 0.76, 11), T(0.82, 9, 0.035, 0.045), T(0.88, 7.5, 0.035, 0.045)],
  },
};

// Aircraft are drawn nose to the right in a box `L` pixels long.
const AIR: Record<string, AirSil> = {
  ar196: {
    kind: 'air', len: 11, alt: 300, draw(c, L) {
      c.fillRect(0, -0.07 * L, L * 0.85, 0.12 * L);                 // fuselage
      c.beginPath(); c.moveTo(0, -0.05 * L); c.lineTo(0.08 * L, -0.3 * L); c.lineTo(0.16 * L, -0.06 * L); c.fill(); // fin
      c.fillRect(0.38 * L, -0.03 * L, 0.3 * L, 0.04 * L);           // wing root
      c.fillRect(0.3 * L, 0.3 * L, 0.6 * L, 0.07 * L);              // float
      c.fillRect(0.45 * L, 0.05 * L, 0.03 * L, 0.26 * L); c.fillRect(0.72 * L, 0.05 * L, 0.03 * L, 0.26 * L); // struts
      c.fillRect(0.85 * L, -0.18 * L, 0.03 * L, 0.36 * L);          // propeller disc
    },
  },
  il38: {
    kind: 'air', len: 40, alt: 600, draw(c, L) {
      c.beginPath(); c.ellipse(0.5 * L, 0, 0.5 * L, 0.06 * L, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(0.02 * L, -0.03 * L); c.lineTo(0.08 * L, -0.26 * L); c.lineTo(0.18 * L, -0.26 * L); c.lineTo(0.2 * L, -0.03 * L); c.fill();
      c.fillRect(0.4 * L, -0.02 * L, 0.24 * L, 0.03 * L);                         // wing
      for (const x of [0.5, 0.6]) { c.fillRect(x * L, -0.01 * L, 0.08 * L, 0.05 * L); c.fillRect((x + 0.08) * L, -0.08 * L, 0.008 * L, 0.18 * L); } // nacelles, props
      c.beginPath(); c.ellipse(0.62 * L, 0.06 * L, 0.06 * L, 0.025 * L, 0, 0, Math.PI * 2); c.fill(); // search radar
    },
  },
  ka27: {
    kind: 'air', len: 16, alt: 25, draw(c, L) {
      c.beginPath(); c.ellipse(0.62 * L, 0, 0.26 * L, 0.13 * L, 0, 0, Math.PI * 2); c.fill(); // cabin
      c.fillRect(0.2 * L, -0.04 * L, 0.4 * L, 0.07 * L);                           // tail boom
      c.fillRect(0.18 * L, -0.16 * L, 0.04 * L, 0.2 * L);                          // twin fins
      c.fillRect(0.6 * L, -0.4 * L, 0.03 * L, 0.28 * L);                           // rotor mast
      c.fillRect(0.1 * L, -0.4 * L, L, 0.02 * L); c.fillRect(0.1 * L, -0.32 * L, L, 0.02 * L); // coaxial rotors
      c.fillRect(0.5 * L, 0.13 * L, 0.03 * L, 0.06 * L); c.fillRect(0.75 * L, 0.13 * L, 0.03 * L, 0.06 * L); // gear
    },
  },
  // Japanese carrier torpedo bomber: low wing, long greenhouse canopy, torpedo slung under.
  kate: {
    kind: 'air', len: 10.3, alt: 150, draw(c, L) {
      c.beginPath(); c.moveTo(0, -0.05 * L); c.lineTo(0.35 * L, -0.08 * L); c.lineTo(0.86 * L, -0.08 * L); c.lineTo(0.88 * L, 0.05 * L); c.lineTo(0.4 * L, 0.06 * L); c.lineTo(0, 0.01 * L); c.fill(); // fuselage
      c.beginPath(); c.moveTo(0.01 * L, -0.04 * L); c.lineTo(0.05 * L, -0.24 * L); c.lineTo(0.12 * L, -0.24 * L); c.lineTo(0.18 * L, -0.06 * L); c.fill(); // fin
      c.beginPath(); c.moveTo(0.36 * L, -0.07 * L); c.lineTo(0.41 * L, -0.14 * L); c.lineTo(0.72 * L, -0.14 * L); c.lineTo(0.76 * L, -0.07 * L); c.fill(); // canopy
      c.fillRect(0.45 * L, 0.03 * L, 0.32 * L, 0.04 * L);           // low wing root
      c.fillRect(0.6 * L, 0.06 * L, 0.025 * L, 0.05 * L);           // torpedo crutch
      c.fillRect(0.38 * L, 0.1 * L, 0.4 * L, 0.035 * L);            // torpedo
      c.fillRect(0.88 * L, -0.2 * L, 0.025 * L, 0.36 * L);          // propeller disc
    },
  },
  // Four-engine flying boat: slender hull, parasol wing on struts, twin fins, wingtip floats.
  mavis: {
    kind: 'air', len: 25.6, alt: 500, draw(c, L) {
      c.beginPath(); c.moveTo(0, -0.06 * L); c.lineTo(0.88 * L, -0.06 * L); c.quadraticCurveTo(L, -0.02 * L, 0.96 * L, 0.05 * L);
      c.lineTo(0.55 * L, 0.06 * L); c.lineTo(0.5 * L, 0.035 * L); c.lineTo(0.08 * L, -0.02 * L); c.fill(); // boat hull with step
      c.fillRect(0.0, -0.1 * L, 0.16 * L, 0.025 * L);                // tailplane
      c.beginPath(); c.moveTo(0.0, -0.08 * L); c.lineTo(0.02 * L, -0.2 * L); c.lineTo(0.07 * L, -0.2 * L); c.lineTo(0.08 * L, -0.08 * L); c.fill(); // fins
      c.fillRect(0.44 * L, -0.24 * L, 0.26 * L, 0.035 * L);          // parasol wing
      c.fillRect(0.5 * L, -0.21 * L, 0.03 * L, 0.16 * L); c.fillRect(0.62 * L, -0.21 * L, 0.03 * L, 0.16 * L); // cabane struts
      c.beginPath(); c.moveTo(0.52 * L, -0.06 * L); c.lineTo(0.47 * L, -0.21 * L); c.lineTo(0.49 * L, -0.21 * L); c.lineTo(0.54 * L, -0.06 * L); c.fill(); // wing strut
      c.fillRect(0.6 * L, -0.22 * L, 0.17 * L, 0.04 * L);            // engine nacelles
      c.fillRect(0.77 * L, -0.3 * L, 0.012 * L, 0.2 * L);            // propeller disc
      c.fillRect(0.56 * L, -0.2 * L, 0.01 * L, 0.14 * L); c.fillRect(0.52 * L, -0.07 * L, 0.09 * L, 0.025 * L); // wingtip float
    },
  },
  // Three-seat floatplane: low wing, long canopy, two long floats.
  jake: {
    kind: 'air', len: 11.3, alt: 300, draw(c, L) {
      c.beginPath(); c.moveTo(0, -0.05 * L); c.lineTo(0.35 * L, -0.08 * L); c.lineTo(0.86 * L, -0.08 * L); c.lineTo(0.88 * L, 0.05 * L); c.lineTo(0.4 * L, 0.05 * L); c.lineTo(0, 0.01 * L); c.fill(); // fuselage
      c.beginPath(); c.moveTo(0.01 * L, -0.04 * L); c.lineTo(0.06 * L, -0.26 * L); c.lineTo(0.12 * L, -0.26 * L); c.lineTo(0.17 * L, -0.06 * L); c.fill(); // fin
      c.beginPath(); c.moveTo(0.34 * L, -0.07 * L); c.lineTo(0.38 * L, -0.14 * L); c.lineTo(0.72 * L, -0.14 * L); c.lineTo(0.76 * L, -0.07 * L); c.fill(); // canopy
      c.fillRect(0.45 * L, 0.02 * L, 0.3 * L, 0.04 * L);             // low wing root
      c.beginPath(); c.moveTo(0.25 * L, 0.24 * L); c.lineTo(0.9 * L, 0.22 * L); c.quadraticCurveTo(0.97 * L, 0.26 * L, 0.9 * L, 0.3 * L); c.lineTo(0.3 * L, 0.3 * L); c.fill(); // float
      c.fillRect(0.5 * L, 0.05 * L, 0.03 * L, 0.18 * L); c.fillRect(0.72 * L, 0.05 * L, 0.03 * L, 0.18 * L); // struts
      c.fillRect(0.88 * L, -0.2 * L, 0.025 * L, 0.36 * L);           // propeller disc
    },
  },
  // Four-engine converted airliner: long slim fuselage, low wing, ventral gondola.
  fw200: {
    kind: 'air', len: 23.5, alt: 500, draw(c, L) {
      c.beginPath(); c.moveTo(0, -0.04 * L); c.lineTo(0.9 * L, -0.05 * L); c.quadraticCurveTo(L, -0.02 * L, 0.96 * L, 0.03 * L); c.lineTo(0.05 * L, 0.0); c.fill(); // fuselage
      c.beginPath(); c.moveTo(0.0, -0.03 * L); c.lineTo(0.04 * L, -0.24 * L); c.lineTo(0.11 * L, -0.24 * L); c.lineTo(0.17 * L, -0.04 * L); c.fill(); // tall fin
      c.fillRect(0.0, -0.06 * L, 0.14 * L, 0.02 * L);                // tailplane
      c.fillRect(0.48 * L, 0.0, 0.36 * L, 0.06 * L);                 // ventral gondola
      c.fillRect(0.42 * L, 0.0, 0.24 * L, 0.03 * L);                 // low wing
      c.fillRect(0.58 * L, -0.06 * L, 0.22 * L, 0.05 * L);           // engine nacelles above the wing
      c.fillRect(0.8 * L, -0.15 * L, 0.012 * L, 0.2 * L);            // propeller disc
    },
  },
  // Twin-engine land bomber: fat cigar fuselage, glazed nose, tail gun cone, mid wing.
  g4m: {
    kind: 'air', len: 20, alt: 300, draw(c, L) {
      c.beginPath(); c.moveTo(0, -0.03 * L); c.lineTo(0.12 * L, -0.07 * L); c.lineTo(0.85 * L, -0.07 * L); c.quadraticCurveTo(L, -0.05 * L, 0.98 * L, 0.02 * L);
      c.lineTo(0.85 * L, 0.06 * L); c.lineTo(0.12 * L, 0.04 * L); c.lineTo(0, 0.0); c.fill(); // fuselage
      c.beginPath(); c.moveTo(0.02 * L, -0.05 * L); c.lineTo(0.06 * L, -0.24 * L); c.lineTo(0.13 * L, -0.24 * L); c.lineTo(0.2 * L, -0.06 * L); c.fill(); // fin
      c.fillRect(0.0, -0.02 * L, 0.14 * L, 0.025 * L);               // tailplane
      c.beginPath(); c.ellipse(0.42 * L, -0.075 * L, 0.04 * L, 0.025 * L, 0, 0, Math.PI * 2); c.fill(); // dorsal blister
      c.fillRect(0.45 * L, -0.01 * L, 0.25 * L, 0.03 * L);           // mid wing
      c.fillRect(0.56 * L, -0.04 * L, 0.22 * L, 0.07 * L);           // engine nacelle
      c.fillRect(0.78 * L, -0.15 * L, 0.012 * L, 0.24 * L);          // propeller disc
    },
  },
};
const silOf = (key: string): Sil | null => SHIPS[key] ?? AIR[key] ?? null;

/** Draw a silhouette with its waterline (or centre, for aircraft) at the origin, bow toward +x. */
function drawSil(c: CanvasRenderingContext2D, sil: Sil, lenPx: number, foreshorten: number, ppm: number) {
  const L = lenPx * foreshorten;
  if (sil.kind === 'air') {
    c.save(); c.translate(-L / 2, 0); c.scale(foreshorten, 1); sil.draw(c, lenPx); c.restore();
    return;
  }
  const X = (x: number) => -L / 2 + x * L;
  const Y = (h: number) => -h * ppm;
  c.beginPath();
  c.moveTo(X(0.01), 1.5 * ppm);
  for (const [x, h] of sil.deck) c.lineTo(X(x), Y(h));
  c.lineTo(X(0.99), 1.5 * ppm);
  c.closePath(); c.fill();
  const deckAt = (x: number) => {
    const d = sil.deck;
    for (let i = 1; i < d.length; i++) if (x <= d[i][0]) { const [x0, h0] = d[i - 1], [x1, h1] = d[i]; return h0 + ((x - x0) / (x1 - x0)) * (h1 - h0); }
    return d[d.length - 1][1];
  };
  const line = Math.max(1, ppm * 0.6);
  for (const p of sil.parts) {
    if (p.t === 'box') c.fillRect(X(p.x0), Y(p.h), (p.x1 - p.x0) * L, (p.h - deckAt(p.x0)) * ppm + 1);
    else if (p.t === 'funnel') {
      const w = p.w * L, r = (p.rake ?? 0.004) * L, base = deckAt(p.x);
      c.beginPath(); c.moveTo(X(p.x) - w / 2, Y(base)); c.lineTo(X(p.x) - w / 2 - r, Y(p.h)); c.lineTo(X(p.x) + w / 2 - r, Y(p.h)); c.lineTo(X(p.x) + w / 2, Y(base)); c.fill();
    } else if (p.t === 'turret') {
      const w = p.w * L, base = deckAt(p.x);
      // Superfiring turrets sit on a barbette.
      c.fillRect(X(p.x) - w * 0.35, Y(p.h - 2.5), w * 0.7, (p.h - 2.5 - base) * ppm + 1);
      c.fillRect(X(p.x) - w / 2, Y(p.h), w, 3.5 * ppm);
      const dir = p.x > 0.5 ? 1 : -1;
      c.fillRect(dir > 0 ? X(p.x) + w / 2 : X(p.x) - w / 2 - p.gun * L, Y(p.h - 1.2), p.gun * L, Math.max(1, ppm * 0.8));
    } else if (p.t === 'slab') {
      c.fillRect(X(p.x0), Y(p.h), (p.x1 - p.x0) * L, Math.max(1, p.th * ppm));
    } else if (p.t === 'dfunnel') {
      // Trunk out of the hull side, bending down; mouth slightly aft and flared.
      const w = p.w * L, x = X(p.x);
      c.beginPath(); c.moveTo(x - w / 2, Y(p.h)); c.lineTo(x + w / 2, Y(p.h));
      c.quadraticCurveTo(x + w / 2, Y(p.m), x, Y(p.m)); c.lineTo(x - w * 0.75, Y(p.m));
      c.quadraticCurveTo(x - w / 2, Y((p.h + p.m) / 2), x - w / 2, Y(p.h)); c.fill();
    } else {
      const base = deckAt(p.x);
      c.fillRect(X(p.x) - line / 2, Y(p.h), line, (p.h - base) * ppm);
      c.fillRect(X(p.x) - L * 0.02, Y(p.h * 0.8), L * 0.04, line); // yard
      if (p.tripod) { c.beginPath(); c.moveTo(X(p.x), Y(p.h * 0.75)); c.lineTo(X(p.x) - L * 0.02, Y(base)); c.lineTo(X(p.x) - L * 0.02 + line, Y(base)); c.lineTo(X(p.x) + line, Y(p.h * 0.75)); c.fill(); }
    }
  }
}

/** Broadside recognition picture of a class, scaled to fit the canvas (ships to a common scale). */
export function drawClassPicture(cv: HTMLCanvasElement, key: string) {
  const sil = silOf(key);
  const x = cv.getContext('2d')!;
  x.clearRect(0, 0, cv.width, cv.height);
  if (!sil) return;
  x.save();
  x.fillStyle = isFriendlyClass(key) ? '#6fd3a8' : '#c9dbe8';
  const air = sil.kind === 'air';
  x.translate(cv.width / 2, cv.height * (air ? 0.56 : 0.82));
  const lenPx = (cv.width - 14) * (air ? 0.8 : sil.len / 262);
  drawSil(x, sil, lenPx, 1, lenPx / sil.len);
  x.restore();
}

// ---- The view ------------------------------------------------------------------------------
const $ = (id: string) => document.getElementById(id)!;
const NM = 1852;

export class Periscope {
  open = false;
  private flakes = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.5 }));
  private refFor = '';
  constructor(private canvas: HTMLCanvasElement, private g: () => Game) {
    $('scopeRef').addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('button[data-classify]');
      if (b) { orders.classify(this.g(), Number(b.dataset.contact), b.dataset.classify!); this.refFor = ''; }
    });
    $('scopeClose').addEventListener('click', () => this.close());
  }

  /** Try to raise the view on the selected contact; says why not if it can't. */
  toggle(): string | null {
    if (this.open) { this.close(); return null; }
    const g = this.g();
    const c = contactById(g, g.selected);
    if (!inPeriscope(g, c)) return 'Periscope: nothing to look at. Select a ship within 8 nm (aircraft within 10 nm) at periscope depth.';
    this.show();
    return null;
  }
  show() { this.open = true; this.refFor = ''; $('scope').hidden = false; }
  close() { this.open = false; $('scope').hidden = true; }

  draw(g: Game, now: number) {
    if (!this.open) return;
    const c = contactById(g, g.selected);
    const v = inPeriscope(g, c);
    if (!c || !v) { this.close(); return; }
    this.reference(g, c.id, v);
    const read = this.render(this.canvas, g, v, now);
    if ($('scopeRead').textContent !== read) $('scopeRead').textContent = read;
    const title = `Periscope · ${contactLabel(c)}`;
    if ($('scopeTitle').textContent !== title) $('scopeTitle').textContent = title;
  }

  /** Draw the view of `v` into any canvas; returns the bearing, range and angle-on-the-bow readout. */
  render(cv: HTMLCanvasElement, g: Game, v: Vessel, now: number): string {
    const ctx = cv.getContext('2d')!;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const sil = silOf(v.cls.key);
    const rNm = dist(g.own, v), rM = rNm * NM;
    const theta = angDiff(v.hdg, brg(g.own, v));           // target course across our line of sight
    const fore = Math.max(0.14, Math.abs(Math.sin((theta * Math.PI) / 180)));
    const len = sil?.len ?? 100;
    // The photonics mast zooms so the target fills about half the frame.
    const fov = Math.min(0.14, Math.max(0.004, (len * fore) / rM * 1.5));
    const ppm = W / (rM * fov);
    const zoom = Math.max(1, Math.round(0.14 / fov * 1.5));
    const night = g.night;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.clip();
    // Train the scope on the target: aircraft sit above the horizon by their elevation.
    const elevPx = sil?.kind === 'air' ? (sil.alt / rM) * (W / fov) : 0;
    const air = sil?.kind === 'air';
    const horizon = Math.min(H * 2, air ? cy + elevPx : cy + H * 0.12);
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, night ? '#2c3d4e' : '#6d7b86'); sky.addColorStop(1, night ? '#5a6d7c' : '#aab4ba');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, horizon);
    const sea = ctx.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, night ? '#18242c' : '#4d5c63'); sea.addColorStop(1, night ? '#070d12' : '#26333a');
    ctx.fillStyle = sea; ctx.fillRect(0, horizon, W, H - horizon);
    // Swell lines.
    ctx.strokeStyle = night ? 'rgba(160,190,200,0.08)' : 'rgba(220,230,235,0.12)';
    for (let i = 1; i < 14; i++) {
      const y = horizon + (H - horizon) * (i / 14) ** 1.6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) ctx.lineTo(x, y + Math.sin(x / 30 + now / 900 + i) * (1 + i * 0.3));
      ctx.stroke();
    }
    if (sil) {
      // Haze and snow thin the image with range.
      const vis = Math.max(0.25, 1 - rNm / (sil.kind === 'air' ? 14 : 11));
      ctx.fillStyle = night ? `rgba(4,8,10,${vis})` : `rgba(28,34,38,${vis})`;
      ctx.save();
      ctx.translate(cx, air ? cy : horizon);
      if (Math.sin((theta * Math.PI) / 180) < 0) ctx.scale(-1, 1); // bow toward the way she is heading
      if (sil.kind === 'ship') {
        // Beyond about 3 nm a periscope 2 m above the water starts to lose the hull below the horizon.
        const hiddenM = rNm > 3 ? (((rNm - 3) / 1.17) ** 2) * 0.3048 : 0;
        ctx.beginPath(); ctx.rect(-W, -H * 2, W * 2, H * 2 + 1); ctx.clip();
        ctx.translate(0, hiddenM * ppm + Math.sin(now / 1300) * ppm * 0.6);
        ctx.rotate(Math.sin(now / 1700) * 0.01); // rolling in the swell
      }
      drawSil(ctx, sil, len * ppm, fore, ppm);
      ctx.restore();
    }
    // Snow in 1941, spray at night in 2029.
    ctx.fillStyle = 'rgba(235,240,245,0.55)';
    for (const f of this.flakes) {
      const y = (f.y + now / 9000 * f.s) % 1, x = (f.x + Math.sin(now / 2000 + f.y * 9) * 0.01) % 1;
      if (!night || f.s > 1.6) ctx.fillRect(x * W, y * H, f.s, f.s);
    }
    // Reticle with stadimeter ticks.
    ctx.strokeStyle = 'rgba(200,255,220,0.65)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    for (let i = -8; i <= 8; i++) { if (!i) continue; const x = cx + i * W / 18; ctx.beginPath(); ctx.moveTo(x, cy - (i % 4 ? 4 : 9)); ctx.lineTo(x, cy + (i % 4 ? 4 : 9)); ctx.stroke(); }
    const vg = ctx.createRadialGradient(cx, cy, W * 0.3, cx, cy, W / 2);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.strokeStyle = '#0d2133'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); ctx.stroke();

    const aob = angDiff(brg(v, g.own), v.hdg);
    return `Bearing ${fmtBrg(brg(g.own, v))}° · range ${fmtRng(rNm)} · angle on the bow ${Math.abs(Math.round(aob))}° ${aob >= 0 ? 'starboard' : 'port'} · zoom ×${zoom}`;
  }

  /** The ID book: every class this contact could be, broadside, with the crew's match % and Accept. */
  private reference(g: Game, contactId: number, v: Vessel) {
    const c = contactById(g, contactId)!;
    const keys = g.library.filter((k) => (v.cls.kind === 'air' ? CLASSES[k].kind === 'air' : CLASSES[k].kind === 'surface'));
    const sig = `${contactId}|${c.classified}|${c.matches.map((m) => m.key + m.pct).join()}`;
    if (sig === this.refFor) return;
    this.refFor = sig;
    const host = $('scopeRef');
    host.innerHTML = '';
    for (const key of keys) {
      const cl = CLASSES[key], m = c.matches.find((x) => x.key === key);
      const card = document.createElement('div');
      card.className = 'ref' + (c.classified === key ? ' chosen' : '');
      const cv = document.createElement('canvas');
      cv.width = 150; cv.height = 46;
      drawClassPicture(cv, key);
      const name = document.createElement('span');
      name.textContent = cl.name + (m ? ` · crew ${m.pct}%` : '');
      card.append(cv, name);
      if (c.classified === key) { const d = document.createElement('span'); d.className = 'done'; d.textContent = 'classified'; card.append(d); }
      else { const b = document.createElement('button'); b.dataset.classify = key; b.dataset.contact = String(contactId); b.textContent = 'Accept'; card.append(b); }
      host.append(card);
    }
  }
}
