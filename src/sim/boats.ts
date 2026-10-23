// The boat the player commands. Every mission but the Red Storm Rising campaign's sends USS Tang
// with her full 2029 kit; that campaign lets the player take a 1980s US attack boat instead, with
// the weapons of the year the war is fought in. A boat's speed, noise and sonar come from its class
// card (classes80s.ts); this file says what it carries and how it launches.

/** Boats the player can command. */
export type BoatKey = 'tang' | 'permit' | 'sturgeon' | 'la688' | 'la688i' | 'seawolf';
/** The year of the Red Storm Rising war: it sets both sides' fleets and weapons. */
export type Year = 1984 | 1988 | 1992 | 1996;
export const YEARS: Year[] = [1984, 1988, 1992, 1996];

/**
 * What goes out of each weapon button. The buttons keep their 2029 names in the code (mk48, nsm,
 * mst, asroc, jatm); a 1980s boat fires its own weapon from the same button, or has none there.
 */
export interface Kit {
  /** Heavyweight torpedo: ADCAP (1988 on) or the older Mk 48. */
  mk48: 'mk48' | 'mk48old';
  /** Tube-launched anti-ship missile. */
  nsm: 'nsm' | 'harpoon' | null;
  /** Anti-ship Tomahawk: Maritime Strike (2029) or TASM. */
  mst: 'mst' | 'tasm' | null;
  /** Stand-off ASW weapon: ASROC (2029), SUBROC (to 1990) or Sea Lance (1992 on). */
  asroc: 'asroc' | 'subroc' | 'sealance' | null;
  /** Anti-air: JATM (2029) or a mast-mounted Stinger (1992 on). */
  jatm: 'jatm' | 'stinger' | null;
  sm6: boolean; mk96: boolean; mjolnir: boolean; tlam: boolean;
  /** Torpedoes swim out of the tube under their own power (quiet), rather than being blown out by an impulse. */
  swimOut: boolean;
  drones: number; blackwings: number; mines: number; stingers: number;
}

export interface BoatProfile {
  key: BoatKey;
  /** Class card key for the hull: speed, noise and sonar. */
  cls: string;
  /** The boat's name in the log and on the own-ship card. */
  name: string;
  tubes: number; vls: number; decoys: number;
  kit: Kit;
  /** Test depth, feet. The game's depth model stops at 800 ft, which every boat here can reach. */
  testFt: number;
  /** How much a kill in this boat counts toward the efficiency rating: older boats count for more. */
  er: number;
}

/** USS Tang, Virginia Block V: every mission's boat unless the mission says otherwise. */
export const TANG: BoatProfile = {
  key: 'tang', cls: 'virginia', name: 'USS Tang (SSN-805)', tubes: 4, vls: 12, decoys: 4, testFt: 1600, er: 0.5,
  kit: { mk48: 'mk48', nsm: 'nsm', mst: 'mst', asroc: 'asroc', jatm: 'jatm', sm6: true, mk96: true, mjolnir: true, tlam: true, swimOut: true, drones: 6, blackwings: 4, mines: 0, stingers: 0 },
};

interface Hull { cls: string; name: string; hull: string; tubes: number; vls: number; testFt: number; er: number; from: Year; to: Year; swimOut: boolean }
/** The 1980s boats, oldest first, with the years the campaign offers each one. Names are boats that served in the Atlantic fleet. */
export const HULLS: Record<Exclude<BoatKey, 'tang'>, Hull> = {
  permit: { cls: 'permit', name: 'USS Flasher (SSN-613)', hull: 'Permit', tubes: 4, vls: 0, testFt: 1300, er: 1.5, from: 1984, to: 1992, swimOut: false },
  sturgeon: { cls: 'sturgeon', name: 'USS Pargo (SSN-650)', hull: 'Sturgeon', tubes: 4, vls: 0, testFt: 1300, er: 1.35, from: 1984, to: 1996, swimOut: false },
  la688: { cls: 'la688', name: 'USS Dallas (SSN-700)', hull: 'Los Angeles', tubes: 4, vls: 0, testFt: 950, er: 1.15, from: 1984, to: 1996, swimOut: false },
  la688i: { cls: 'la688i', name: 'USS Newport News (SSN-750)', hull: 'Los Angeles, vertical tubes (688I)', tubes: 4, vls: 12, testFt: 950, er: 1, from: 1988, to: 1996, swimOut: false },
  seawolf: { cls: 'seawolf', name: 'USS Seawolf (SSN-21)', hull: 'Seawolf', tubes: 8, vls: 0, testFt: 1600, er: 0.85, from: 1996, to: 1996, swimOut: true },
};
export const BOATS: BoatKey[] = ['tang', 'permit', 'sturgeon', 'la688', 'la688i', 'seawolf'];

/** Can this boat sail in this year's war? Tang always can. */
export const inService = (b: BoatKey, y: Year) => b === 'tang' || (HULLS[b].from <= y && y <= HULLS[b].to);

/**
 * The boat as it sails in a given year. Tang keeps her full 2029 kit whatever the year. A 1980s boat
 * has the old Mk 48 and Harpoon in 1984; ADCAP, the anti-ship and land-attack Tomahawks from 1988;
 * Sea Lance in place of SUBROC and a mast Stinger from 1992.
 */
export function boatFor(b: BoatKey, y: Year): BoatProfile {
  if (b === 'tang') return TANG;
  const h = HULLS[b];
  const kit: Kit = {
    mk48: y >= 1988 ? 'mk48' : 'mk48old', nsm: 'harpoon', mst: y >= 1988 ? 'tasm' : null,
    asroc: y >= 1992 ? (b === 'permit' ? null : 'sealance') : (b === 'permit' || b === 'sturgeon' ? 'subroc' : null),
    jatm: y >= 1992 ? 'stinger' : null, sm6: false, mk96: false, mjolnir: false, tlam: y >= 1988,
    swimOut: h.swimOut, drones: 0, blackwings: 0, mines: 4, stingers: y >= 1992 ? 4 : 0,
  };
  return { key: b, cls: h.cls, name: h.name, tubes: h.tubes, vls: h.vls, decoys: 6, kit, testFt: h.testFt, er: h.er };
}
