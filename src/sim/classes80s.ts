// Ship class cards for the Red Storm Rising campaign: the Soviet Northern Fleet of 1984 to 1996 and
// the US attack boats the player can take into it. Soviet names belong to this campaign only (Scott's
// call, 23 Oct 2026); everywhere else the game keeps to Russia.
// Noise numbers are invented for play, not real acoustic data. Kirov, Udaloy, Ropucha, Akula, Kilo,
// Oscar, the Tu-142, Il-38 and Ka-27 already have cards in classes.ts and are used as they are.
import type { ClassCard, Reference } from './classes';

// Soviet boats share the 50 Hz grid and a 9 Hz line of the Russian boats; the third line tells the
// classes apart. Older hulls are much louder: November and Echo II are the loudest boats at sea.
// Soviet diesels run a 60 Hz battery plant line instead, as the Kilo does.
export const CLASSES_80S: Record<string, ClassCard> = {
  // ---- US attack boats the player can command ----
  permit: {
    key: 'permit', name: 'Permit (Thresher)', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 92, maxSpd: 28, threshold: 25, hp: 5, tonals: [60, 120, 45], blades: 5, shaftHzPerKt: 0.11, quiet: true,
  },
  sturgeon: {
    key: 'sturgeon', name: 'Sturgeon', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 90, maxSpd: 26, threshold: 24, hp: 5, tonals: [60, 120, 48], blades: 5, shaftHzPerKt: 0.11, quiet: true,
  },
  la688: {
    key: 'la688', name: 'Los Angeles (688)', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 86, maxSpd: 33, threshold: 22, hp: 5, tonals: [60, 120, 52], blades: 7, shaftHzPerKt: 0.1, quiet: true,
  },
  la688i: {
    key: 'la688i', name: 'Improved Los Angeles (688I)', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 83, maxSpd: 33, threshold: 21, hp: 5, tonals: [60, 120, 54], blades: 7, shaftHzPerKt: 0.1, quiet: true,
  },
  seawolf: {
    key: 'seawolf', name: 'Seawolf', type: 'SSN', nation: 'US', kind: 'sub',
    slBase: 78, maxSpd: 35, threshold: 19, hp: 6, tonals: [60, 120], blades: 7, shaftHzPerKt: 0.08, quiet: true,
  },

  // ---- Soviet submarines ----
  alfa: {
    key: 'alfa', name: 'Alfa', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 101, maxSpd: 41, threshold: 26, hp: 4, tonals: [50, 9, 400, 200], blades: 7, shaftHzPerKt: 0.13,
  },
  victor1: {
    key: 'victor1', name: 'Victor I', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 104, maxSpd: 32, threshold: 25, hp: 5, tonals: [50, 9, 70, 140], blades: 5, shaftHzPerKt: 0.11,
  },
  victor2: {
    key: 'victor2', name: 'Victor II', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 102, maxSpd: 31, threshold: 25, hp: 5, tonals: [50, 9, 74, 148], blades: 5, shaftHzPerKt: 0.11,
  },
  victor3: {
    key: 'victor3', name: 'Victor III', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 98, maxSpd: 30, threshold: 23, hp: 5, tonals: [50, 9, 78, 156], blades: 7, shaftHzPerKt: 0.1,
  },
  sierra: {
    key: 'sierra', name: 'Sierra', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 96, maxSpd: 34, threshold: 22, hp: 5, tonals: [50, 9, 84, 168], blades: 7, shaftHzPerKt: 0.1,
  },
  mike: {
    key: 'mike', name: 'Mike', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 97, maxSpd: 30, threshold: 23, hp: 6, tonals: [50, 9, 88, 176], blades: 7, shaftHzPerKt: 0.09,
  },
  november: {
    key: 'november', name: 'November', type: 'SSN', nation: 'USSR', kind: 'sub',
    slBase: 114, maxSpd: 28, threshold: 30, hp: 4, tonals: [50, 9, 52, 104, 26], blades: 6, shaftHzPerKt: 0.12,
  },
  charlie: {
    key: 'charlie', name: 'Charlie II', type: 'SSGN', nation: 'USSR', kind: 'sub',
    slBase: 104, maxSpd: 24, threshold: 26, hp: 5, tonals: [50, 9, 66, 132], blades: 5, shaftHzPerKt: 0.12,
  },
  echo2: {
    key: 'echo2', name: 'Echo II', type: 'SSGN', nation: 'USSR', kind: 'sub',
    slBase: 110, maxSpd: 22, threshold: 28, hp: 6, tonals: [50, 9, 58, 116, 30], blades: 4, shaftHzPerKt: 0.13,
  },
  typhoon: {
    key: 'typhoon', name: 'Typhoon', type: 'SSBN', nation: 'USSR', kind: 'sub',
    slBase: 96, maxSpd: 25, threshold: 24, hp: 10, tonals: [50, 9, 62, 124, 186], blades: 7, shaftHzPerKt: 0.08,
  },
  delta: {
    key: 'delta', name: 'Delta III/IV', type: 'SSBN', nation: 'USSR', kind: 'sub',
    slBase: 101, maxSpd: 24, threshold: 25, hp: 7, tonals: [50, 9, 68, 136], blades: 5, shaftHzPerKt: 0.1,
  },
  yankee: {
    key: 'yankee', name: 'Yankee', type: 'SSBN', nation: 'USSR', kind: 'sub',
    slBase: 107, maxSpd: 26, threshold: 27, hp: 6, tonals: [50, 9, 56, 112], blades: 5, shaftHzPerKt: 0.11,
  },
  foxtrot: {
    key: 'foxtrot', name: 'Foxtrot', type: 'SSK', nation: 'USSR', kind: 'sub',
    slBase: 92, maxSpd: 16, threshold: 28, hp: 4, tonals: [60, 14, 90, 45], blades: 6, shaftHzPerKt: 0.17,
  },
  tango: {
    key: 'tango', name: 'Tango', type: 'SSK', nation: 'USSR', kind: 'sub',
    slBase: 89, maxSpd: 16, threshold: 27, hp: 4, tonals: [60, 13, 105, 52], blades: 6, shaftHzPerKt: 0.16,
  },

  // ---- Soviet surface ships ----
  // Steam plants (Kiev, Sovremenny, Kresta, Kashin's older sisters) give a deep feed-pump line; gas turbines a higher whine.
  kiev: {
    key: 'kiev', name: 'Kiev', type: 'aviation cruiser', nation: 'USSR', kind: 'surface',
    slBase: 87, maxSpd: 32, threshold: 17, hp: 12, tonals: [50, 21, 118, 62, 172], blades: 4, shaftHzPerKt: 0.12, emitter: true,
  },
  slava: {
    key: 'slava', name: 'Slava', type: 'missile cruiser', nation: 'USSR', kind: 'surface',
    slBase: 83, maxSpd: 32, threshold: 17, hp: 8, tonals: [50, 27, 136, 82], blades: 4, shaftHzPerKt: 0.13, emitter: true,
  },
  kara: {
    key: 'kara', name: 'Kara', type: 'ASW cruiser', nation: 'USSR', kind: 'surface',
    slBase: 81, maxSpd: 34, threshold: 16, hp: 7, tonals: [50, 36, 108, 180], blades: 4, shaftHzPerKt: 0.14, emitter: true,
  },
  kresta: {
    key: 'kresta', name: 'Kresta II', type: 'ASW cruiser', nation: 'USSR', kind: 'surface',
    slBase: 83, maxSpd: 34, threshold: 17, hp: 6, tonals: [50, 29, 87, 145], blades: 4, shaftHzPerKt: 0.14, emitter: true,
  },
  sovremenny: {
    key: 'sovremenny', name: 'Sovremenny', type: 'destroyer', nation: 'USSR', kind: 'surface',
    slBase: 83, maxSpd: 32, threshold: 20, hp: 6, tonals: [50, 33, 99, 165], blades: 4, shaftHzPerKt: 0.15, emitter: true,
  },
  kashin: {
    key: 'kashin', name: 'Kashin', type: 'destroyer', nation: 'USSR', kind: 'surface',
    slBase: 82, maxSpd: 35, threshold: 18, hp: 5, tonals: [50, 44, 132, 88], blades: 4, shaftHzPerKt: 0.16, emitter: true,
  },
  krivak: {
    key: 'krivak', name: 'Krivak II', type: 'ASW frigate', nation: 'USSR', kind: 'surface',
    slBase: 80, maxSpd: 32, threshold: 15, hp: 4, tonals: [50, 41, 123, 82], blades: 4, shaftHzPerKt: 0.17, emitter: true,
  },
  grisha: {
    key: 'grisha', name: 'Grisha III', type: 'ASW corvette', nation: 'USSR', kind: 'surface',
    slBase: 81, maxSpd: 32, threshold: 16, hp: 2, tonals: [50, 47, 94, 141], blades: 3, shaftHzPerKt: 0.2, emitter: true,
  },
  ivanrogov: {
    key: 'ivanrogov', name: 'Ivan Rogov', type: 'landing ship (LPD)', nation: 'USSR', kind: 'surface',
    slBase: 86, maxSpd: 19, threshold: null, hp: 6, tonals: [50, 19, 76, 114], blades: 4, shaftHzPerKt: 0.18, emitter: true,
  },
  sovmerch: {
    key: 'sovmerch', name: 'Soviet merchant (ro-ro)', type: 'merchant', nation: 'USSR', kind: 'surface',
    slBase: 87, maxSpd: 18, threshold: null, hp: 3, tonals: [50, 25, 75, 125], blades: 5, shaftHzPerKt: 0.17,
  },
  chilikin: {
    key: 'chilikin', name: 'Boris Chilikin', type: 'fleet oiler', nation: 'USSR', kind: 'surface',
    slBase: 88, maxSpd: 17, threshold: null, hp: 4, tonals: [50, 17, 68, 102], blades: 5, shaftHzPerKt: 0.18,
  },

  // ---- Aircraft ----
  ka25: {
    key: 'ka25', name: 'Ka-25PL Hormone-A', type: 'ASW helicopter', nation: 'USSR', kind: 'air',
    slBase: 106, maxSpd: 120, threshold: null, hp: 1, tonals: [16, 32, 105, 48], blades: 0, shaftHzPerKt: 0,
  },
};

/**
 * Ships that serve in both wars fly here under their 1980s Soviet names, on their 2029 card's numbers
 * with these changes. Each looks like the class it copies (`ALIAS_80S` points the drawings at it).
 */
export const ALIAS_80S: Record<string, string> = {
  kirov80: 'kirov', udaloy80: 'udaloy', ropucha80: 'ropucha', akula80: 'akula', kilo80: 'kilo', oscar80: 'oscar', may: 'il38', bear: 'tu142', helix: 'ka27',
};
export const CHANGES_80S: Record<string, Partial<ClassCard>> = {
  kirov80: { name: 'Kirov', type: 'nuclear battlecruiser' },
  udaloy80: { name: 'Udaloy', type: 'ASW destroyer' },
  ropucha80: { name: 'Ropucha', type: 'landing ship' },
  // The first Akulas of 1988 are a little louder than the improved boats of 2029, and so is the first Kilo.
  akula80: { name: 'Akula', slBase: 99 },
  kilo80: { name: 'Kilo', slBase: 88 },
  oscar80: { name: 'Oscar', type: 'SSGN' },
  may: { name: 'Il-38 May' },
  bear: { name: 'Tu-142 Bear-F' },
  helix: { name: 'Ka-27 Helix' },
};

export const REFERENCE_80S: Record<string, Reference> = {
  kirov80: {
    displacement: '28,000 t full load',
    armament: ['20 × SS-N-19 Shipwreck anti-ship missiles under the forecastle', 'SA-N-6 and SA-N-4 SAMs', 'SS-N-14 or SA-N-9, guns', 'Torpedo tubes, 3 helicopters'],
    armor: 'Light armour over the reactors and magazines',
    notes: 'Nuclear battlecruiser, the biggest surface warship built since the Second World War. Tall tower mast, big pyramid superstructure. Two shafts.',
  },
  udaloy80: {
    displacement: '8,500 t full load',
    armament: ['8 × SS-N-14 ASW missiles in two quad launchers', 'SA-N-9 SAMs', '2 × 100 mm guns', '8 × 533 mm torpedo tubes, 2 helicopters'],
    armor: 'None',
    notes: 'Big ASW destroyer with two hull sonars and two helicopters. Two pairs of funnels. The sub hunter to fear. Two shafts.',
  },
  ropucha80: {
    displacement: '4,400 t full load',
    armament: ['2 × 57 mm guns', 'SA-N-5 launchers', 'Naval infantry and up to 10 tanks'],
    armor: 'None',
    notes: 'Tank landing ship with doors at both ends and a long superstructure. Polish-built. Two shafts.',
  },
  akula80: {
    displacement: '12,700 t submerged',
    armament: ['4 × 533 mm and 4 × 650 mm torpedo tubes', 'Torpedoes and ASW missiles'],
    armor: 'None',
    notes: 'New in 1988: the quietest Soviet attack boat, thanks to quieting technology bought from the West. Long sail blended into a hump with a towed array pod on the rudder.',
  },
  kilo80: {
    displacement: '3,000 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Torpedoes and mines'],
    armor: 'None',
    notes: 'New diesel boat for the 1980s: a fat teardrop hull, very quiet on the battery. Single six-bladed screw.',
  },
  oscar80: {
    displacement: '16,000 t submerged',
    armament: ['24 × SS-N-19 anti-ship missiles in tubes outside the pressure hull', '4 × 533 mm and 4 × 650 mm torpedo tubes'],
    armor: 'None',
    notes: 'The carrier killer: a very broad double hull with the missile tubes along each side. Big and fairly loud. Two screws.',
  },
  may: {
    displacement: '63,500 kg max takeoff',
    armament: ['Sonobuoys', 'Torpedoes and depth bombs', 'Search radar in a chin radome, MAD tail boom'],
    armor: 'None',
    notes: 'Four-turboprop patrol plane built on the Il-18 airliner, from the Kola bases.',
  },
  bear: {
    displacement: '185,000 kg max takeoff',
    armament: ['Sonobuoys', 'Torpedoes and depth bombs'],
    armor: 'None',
    notes: 'Long-range sub hunter on the Tu-95 bomber: swept wings, four big contra-rotating turboprops. Hunts far out over the Norwegian Sea.',
  },
  helix: {
    displacement: '12,000 kg max takeoff',
    armament: ['Dipping sonar, sonobuoys', 'A torpedo or depth bombs'],
    armor: 'None',
    notes: 'The new coaxial-rotor ASW helicopter of the 1980s, replacing the Ka-25 on the newer ships. Twin fins.',
  },
  permit: {
    displacement: '4,300 t submerged',
    armament: ['4 × 533 mm torpedo tubes amidships', 'Mk 48 torpedoes, Harpoon, SUBROC', 'Mines'],
    armor: 'None',
    notes: 'Friendly. The first deep-diving US attack boats after Thresher was lost. Small sail well forward. Noisy by later standards. Single screw.',
  },
  sturgeon: {
    displacement: '4,700 t submerged',
    armament: ['4 × 533 mm torpedo tubes amidships', 'Mk 48 torpedoes, Harpoon, Tomahawk, SUBROC', 'Mines'],
    armor: 'None',
    notes: 'Friendly. The 1970s workhorse: tall sail with fairwater planes that rotate for surfacing through ice. Single screw.',
  },
  la688: {
    displacement: '6,900 t submerged',
    armament: ['4 × 533 mm torpedo tubes', 'Mk 48 torpedoes, Harpoon, Tomahawk from the tubes', 'Mines'],
    armor: 'None',
    notes: 'Friendly. Fast and quiet for her day, with a big bow sonar. Sail planes. Single screw.',
  },
  la688i: {
    displacement: '7,100 t submerged',
    armament: ['4 × 533 mm torpedo tubes', '12 vertical launch tubes for Tomahawk', 'Mk 48 ADCAP, Harpoon, Sea Lance'],
    armor: 'None',
    notes: 'Friendly. The improved 688: quieter, under-ice capable with bow planes instead of sail planes, and a row of vertical Tomahawk tubes in the bow.',
  },
  seawolf: {
    displacement: '9,100 t submerged',
    armament: ['8 × 660 mm torpedo tubes, swim-out', 'Up to 50 Mk 48 ADCAP, Harpoon, Tomahawk', 'Mines'],
    armor: 'None',
    notes: 'Friendly. The quietest boat at sea in 1996, fast at a tactical speed, with eight wide tubes. Pump-jet.',
  },
  alfa: {
    displacement: '3,200 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Torpedoes and anti-ship missiles'],
    armor: 'None',
    notes: 'Titanium hull and a lead-bismuth reactor: over 40 knots and very deep, but loud at speed. Small rounded sail blended into the hull. Single screw.',
  },
  victor1: {
    displacement: '5,300 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Torpedoes and mines'],
    armor: 'None',
    notes: 'First of the Soviet teardrop attack boats. Low sail set well aft of the bow. Noisy. Single screw.',
  },
  victor2: {
    displacement: '5,700 t submerged',
    armament: ['4 × 533 mm and 2 × 650 mm torpedo tubes', 'Wake-homing torpedoes, ASW missiles'],
    armor: 'None',
    notes: 'A stretched Victor I with big 650 mm tubes. A little quieter.',
  },
  victor3: {
    displacement: '6,300 t submerged',
    armament: ['4 × 533 mm and 2 × 650 mm torpedo tubes', 'Torpedoes, ASW missiles'],
    armor: 'None',
    notes: 'The best Soviet attack boat of the early 1980s. A streamlined pod on the upper rudder holds her towed array. Seven-bladed screw.',
  },
  sierra: {
    displacement: '7,600 t submerged',
    armament: ['4 × 533 mm and 4 × 650 mm torpedo tubes', 'Torpedoes, ASW missiles'],
    armor: 'None',
    notes: 'Titanium hull, deep and fairly quiet. Broad, squared-off sail. New in 1988.',
  },
  mike: {
    displacement: '8,000 t submerged',
    armament: ['6 × 533 mm torpedo tubes', 'Torpedoes and ASW missiles'],
    armor: 'None',
    notes: 'A single titanium deep-diving prototype, the deepest-diving boat at sea. Long smooth hull, low sail.',
  },
  november: {
    displacement: '4,700 t submerged',
    armament: ['8 × 533 mm bow tubes', 'Torpedoes'],
    armor: 'None',
    notes: 'The first Soviet nuclear boats, from the 1950s. Very loud: easy to hear and a good one to learn on. Long hull, streamlined sail. Two screws.',
  },
  charlie: {
    displacement: '5,500 t submerged',
    armament: ['8 × SS-N-9 anti-ship missiles, fired submerged', '6 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'Cruise missile boat. Bulged bow holds the missile tubes. Single screw. Fires from inside 60 nm of her target.',
  },
  echo2: {
    displacement: '5,800 t submerged',
    armament: ['8 × SS-N-12 anti-ship missiles, fired from the surface', '6 × 533 mm and 4 × 406 mm torpedo tubes'],
    armor: 'None',
    notes: 'Old cruise missile boat. Must surface and raise her missile tubes to fire, and is very loud. Long casing with launcher recesses. Two screws.',
  },
  typhoon: {
    displacement: '48,000 t submerged',
    armament: ['20 × SS-N-20 ballistic missiles', '6 × 533 mm and 650 mm torpedo tubes'],
    armor: 'None',
    notes: 'The biggest submarine ever built: two pressure hulls side by side under one casing, missiles forward of the sail. Built to break through ice. Two screws.',
  },
  delta: {
    displacement: '13,000 to 18,000 t submerged',
    armament: ['16 × SS-N-18 or SS-N-23 ballistic missiles', '4 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'Missile boat with a tall humped casing behind the sail over the missile tubes. Keeps to the bastions under guard. Two screws.',
  },
  yankee: {
    displacement: '9,600 t submerged',
    armament: ['16 × SS-N-6 ballistic missiles', '6 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'Older missile boat, flat-topped casing behind the sail. Noisy. Some are converted to cruise missile or special boats. Two screws.',
  },
  foxtrot: {
    displacement: '2,500 t submerged',
    armament: ['10 × 533 mm torpedo tubes, six forward and four aft', 'Torpedoes and mines'],
    armor: 'None',
    notes: 'Diesel patrol boat from the 1950s. Quiet on the battery when slow; loud when she snorkels. Three screws.',
  },
  tango: {
    displacement: '3,800 t submerged',
    armament: ['6 × 533 mm bow tubes', 'Torpedoes'],
    armor: 'None',
    notes: 'Big, long-endurance diesel boat with a large battery: very quiet when creeping. Raised bow casing. Three screws.',
  },
  kiev: {
    displacement: '43,000 t full load',
    armament: ['8 × SS-N-12 anti-ship missiles', 'SA-N-3 and SA-N-4 SAMs', 'SUW-N-1 ASW rockets, torpedo tubes', 'Yak-38 jets and Ka-25/27 helicopters'],
    armor: 'None',
    notes: 'Half cruiser, half carrier: angled flight deck aft and to port, a big island, and a heavily armed bow. Four shafts.',
  },
  slava: {
    displacement: '11,500 t full load',
    armament: ['16 × SS-N-12 anti-ship missiles in big paired tubes on either side', 'SA-N-6 SAMs', '2 × 130 mm guns', 'Torpedo tubes, 1 helicopter'],
    armor: 'None',
    notes: 'Missile cruiser with the huge SS-N-12 launch tubes along the forecastle. Gas turbines. Two shafts.',
  },
  kara: {
    displacement: '9,700 t full load',
    armament: ['8 × SS-N-14 ASW missiles', 'SA-N-3 and SA-N-4 SAMs', '4 × 76 mm guns', 'Torpedo tubes, 1 Ka-25'],
    armor: 'None',
    notes: 'ASW cruiser: a tall pyramid mast block and one big square funnel. Strong sonar. Gas turbines, two shafts.',
  },
  kresta: {
    displacement: '7,500 t full load',
    armament: ['8 × SS-N-14 ASW missiles', 'SA-N-3 SAMs', '4 × 57 mm guns', 'Torpedo tubes, 1 Ka-25'],
    armor: 'None',
    notes: 'ASW cruiser with a single big tower mast and one funnel. Steam turbines, two shafts.',
  },
  sovremenny: {
    displacement: '8,000 t full load',
    armament: ['8 × SS-N-22 Sunburn anti-ship missiles', 'SA-N-7 SAMs', '4 × 130 mm guns in two twin turrets', 'Torpedo tubes, 1 helicopter'],
    armor: 'None',
    notes: 'Anti-surface destroyer, the Udaloy\'s partner. Big guns fore and aft, a large single funnel. Weak sonar. Steam plant, two shafts.',
  },
  kashin: {
    displacement: '4,500 t full load',
    armament: ['SA-N-1 SAMs fore and aft', '4 × 76 mm guns', 'ASW rocket launchers', '5 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'The first all gas-turbine warships: two pairs of raked funnels amidships. Old but fast. Two shafts.',
  },
  krivak: {
    displacement: '3,700 t full load',
    armament: ['4 × SS-N-14 ASW missiles in a box launcher on the bow', 'SA-N-4 SAMs', '2 × 100 mm guns', '8 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'ASW frigate with very good sonar and a towed body aft. The big quad launcher on the bow is her mark. Two shafts.',
  },
  grisha: {
    displacement: '1,200 t full load',
    armament: ['SA-N-4 SAMs', '2 × 57 mm guns', 'ASW rockets, depth charges', '4 × 533 mm torpedo tubes'],
    armor: 'None',
    notes: 'Small coastal sub chaser with a dipping sonar. Short range, but there are a lot of them near the bases. Three shafts.',
  },
  ivanrogov: {
    displacement: '14,000 t full load',
    armament: ['SA-N-4 SAMs', '2 × 76 mm guns', 'Naval infantry battalion, tanks, air-cushion landing craft', '4 Ka-29 helicopters'],
    armor: 'None',
    notes: 'Landing ship with a dock aft, a bow door and a helicopter deck. Tall block superstructure amidships. Two shafts.',
  },
  sovmerch: {
    displacement: '20,000 t full load',
    armament: ['None'],
    armor: 'None',
    notes: 'Roll-on roll-off cargo ship: high slab sides, stern ramp, bridge forward. Carries vehicles and supplies for the northern front.',
  },
  chilikin: {
    displacement: '23,000 t full load',
    armament: ['None in war fit'],
    armor: 'None',
    notes: 'Fleet oiler: replenishment rigs and goalpost masts along the deck, bridge and funnel aft. Single screw.',
  },
  ka25: {
    displacement: '7,500 kg max takeoff',
    armament: ['Dipping sonar', 'A torpedo or depth bombs'],
    armor: 'None',
    notes: 'Coaxial-rotor ASW helicopter flown from cruisers and the Kiev. Older and slower than the Ka-27, with a boxy cabin and three fins.',
  },
};
