// Red Storm Rising: who the Northern Fleet sends to sea in each year of the war, what the ships are
// called, and where the fighting happens. Soviet names belong to this campaign only (Scott's call,
// 23 Oct 2026). The ship names are real Soviet names; which ship sails in which year is play, not history.
import type { Year } from '../boats';

/** Classes the Northern Fleet has at sea, by role, in a given year (class keys from classes80s.ts). */
export interface Roster {
  /** Attack boats that hunt us. */ ssn: string[];
  /** Diesel boats: quiet on the battery, slow. */ ssk: string[];
  /** Cruise missile boats. */ ssgn: string[];
  /** Ballistic missile boats in their bastions. */ ssbn: string[];
  /** Flagships of a surface action group. */ flag: string[];
  /** Destroyers and frigates for a group's screen. */ escort: string[];
  /** Sub hunters for an ASW group. */ hunter: string[];
  /** Small ASW ships for coastal work. */ corvette: string[];
  carrier: string; helo: string[]; plane: string[];
}

export function rosterFor(y: Year): Roster {
  return {
    // November and Echo II, the old noisy first generation, are gone by 1996; Yankee too. Sierra, Akula and Kilo arrive in 1988.
    ssn: [...(y <= 1992 ? ['victor1', 'victor2', 'alfa'] : ['victor2']), 'victor3', ...(y >= 1988 ? ['sierra', 'akula80'] : []), ...(y === 1984 ? ['november'] : []), ...(y >= 1992 ? ['akula80', 'sierra'] : [])],
    ssk: [...(y <= 1992 ? ['foxtrot'] : []), 'tango', ...(y >= 1988 ? ['kilo80'] : [])],
    ssgn: [...(y <= 1992 ? ['echo2'] : []), 'charlie', 'oscar80'],
    ssbn: [...(y <= 1992 ? ['yankee'] : []), 'delta', 'typhoon'],
    flag: ['kirov80', 'slava'],
    escort: ['sovremenny', 'udaloy80', ...(y <= 1992 ? ['kresta'] : []), 'krivak'],
    hunter: ['kara', 'udaloy80', ...(y <= 1992 ? ['kresta'] : [])],
    corvette: ['grisha', 'krivak'],
    carrier: y >= 1992 ? 'kuznetsov80' : 'kiev',
    helo: y >= 1992 ? ['helix'] : ['ka25', 'helix'],
    plane: ['may', 'bear'],
  };
}

const NAMES: Record<string, string[]> = {
  kirov80: ['Kirov', 'Frunze', 'Kalinin'],
  slava: ['Slava', 'Marshal Ustinov', 'Chervona Ukraina'],
  kiev: ['Kiev', 'Minsk', 'Novorossiysk', 'Baku'],
  kuznetsov80: ['Admiral Kuznetsov'],
  sovremenny: ['Sovremenny', 'Otchayanny', 'Otlichny', 'Osmotritelny', 'Bezuprechny', 'Boyevoy', 'Stoyky', 'Okrylenny', 'Burny', 'Gremyashchy', 'Bystry', 'Rastoropny'],
  udaloy80: ['Udaloy', 'Vice-Admiral Kulakov', 'Marshal Vasilevsky', 'Admiral Zakharov', 'Admiral Spiridonov', 'Admiral Tributs', 'Marshal Shaposhnikov', 'Simferopol', 'Admiral Levchenko', 'Admiral Vinogradov', 'Admiral Kharlamov', 'Admiral Panteleyev'],
  kara: ['Nikolayev', 'Ochakov', 'Kerch', 'Azov', 'Petropavlovsk', 'Tashkent', 'Tallinn'],
  kresta: ['Kronshtadt', 'Admiral Isakov', 'Admiral Makarov', 'Marshal Voroshilov', 'Admiral Oktyabrsky', 'Admiral Isachenkov', 'Marshal Timoshenko', 'Vasily Chapayev', 'Admiral Yumashev'],
  kashin: ['Komsomolets Ukrainy', 'Smetlivy', 'Krasny Kavkaz', 'Obraztsovy', 'Odarenny', 'Skory', 'Provorny', 'Reshitelny', 'Strogy', 'Smyshleny', 'Krasny Krym'],
  krivak: ['Bditelny', 'Razumny', 'Bodry', 'Svirepy', 'Silny', 'Storozhevoy', 'Druzhny', 'Ladny', 'Zharky', 'Rezvy', 'Pylky', 'Grozyashchy', 'Neukrotimy', 'Bessmenny'],
  grisha: ['Aleksin', 'Brest', 'Kholmsk', 'Yeysk', 'Snezhnogorsk', 'Onega', 'Monchegorsk', 'Naryan-Mar', 'Yunga', 'Kazanets'],
  ivanrogov: ['Ivan Rogov', 'Aleksandr Nikolayev', 'Mitrofan Moskalenko'],
  ropucha80: ['BDK-91', 'Olenegorsky Gornyak', 'Kondopoga', 'Aleksandr Otrakovsky', 'Georgy Pobedonosets', 'BDK-45', 'BDK-55', 'BDK-58'],
  sovmerch: ['Kapitan Smirnov', 'Inzhener Machulsky', 'Vladimir Vaslyayev', 'Kapitan Mezentsev', 'Akademik Tupolev', 'Nikolai Cherkasov', 'Kapitan Man', 'Stakhanovets Kotov'],
  chilikin: ['Boris Chilikin', 'Dnestr', 'Genrikh Gasanov', 'Ivan Bubnov', 'Vladimir Kolechitsky', 'Sergei Osipov'],
};

/** A name-picker for one mission: no name twice. Submarines go by their hull numbers. */
export function namer(r: () => number) {
  const used = new Set<string>();
  return (cls: string) => {
    const list = NAMES[cls];
    for (let i = 0; i < 40; i++) {
      const n = list ? list[Math.floor(r() * list.length)] : `K-${100 + Math.floor(r() * 400)}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
    const n = `${list?.[0] ?? 'K-1'} (${used.size})`;
    used.add(n);
    return n;
  };
}

/**
 * Where a mission happens. `coast` is the bearing from the scene toward land (beaches, ports and
 * drop points lie that way); `ice` means the pack is close.
 */
export interface Place { key: string; name: string; coast: number; sea: number; ice?: boolean; port?: string; beach?: string }
export const PLACES: Record<string, Place> = {
  giuk: { key: 'giuk', name: 'The Greenland–Iceland–UK gap', coast: 300, sea: 4 },
  iceland: { key: 'iceland', name: 'Off Keflavík, Iceland', coast: 60, sea: 4, beach: 'Keflavík', port: 'Reykjavík' },
  faroes: { key: 'faroes', name: 'Off the Faroes', coast: 330, sea: 4, beach: 'Tórshavn', port: 'Tórshavn' },
  shetland: { key: 'shetland', name: 'East of Shetland', coast: 260, sea: 3, beach: 'Sullom Voe', port: 'Lerwick' },
  trondheim: { key: 'trondheim', name: 'Off Trondheim, Norway', coast: 110, sea: 3, beach: 'Ørland', port: 'Trondheim' },
  vestfjord: { key: 'vestfjord', name: 'The Vestfjord, Norway', coast: 70, sea: 2, beach: 'Bodø', port: 'Narvik' },
  lofoten: { key: 'lofoten', name: 'West of Lofoten', coast: 100, sea: 3, beach: 'Andøya', port: 'Narvik' },
  janmayen: { key: 'janmayen', name: 'Near Jan Mayen', coast: 0, sea: 4 },
  bear: { key: 'bear', name: 'The Bear Island gap', coast: 20, sea: 3 },
  northcape: { key: 'northcape', name: 'Off North Cape', coast: 160, sea: 3, port: 'Hammerfest' },
  barents: { key: 'barents', name: 'The Barents Sea', coast: 150, sea: 2, ice: true },
  kola: { key: 'kola', name: 'Off the Kola coast', coast: 170, sea: 2 },
};
