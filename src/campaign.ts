// The WWII campaign around the missions: which are open, what each one changed, and the
// interlude written from those results. Progress is kept in this browser only.
import { CLASSES } from './sim/classes';
import { CAMPAIGN, MISSIONS, type Carry, type MissionKey } from './sim/missions';
import type { Game } from './sim/sim';

export interface Result {
  win: boolean; reason: string; minutes: number;
  /** Enemy ships and aircraft that went down, by name. */
  sunk: string[]; aircraft: number;
  /** Friendly ships lost. */
  lost: string[];
  flags: Record<string, number>;
}
interface Progress { results: Partial<Record<MissionKey, Result>> }

const KEY = 'phantom-leviathan-campaign';
function load(): Progress {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '') as Progress; } catch { return { results: {} }; }
}
let progress: Progress = load();
if (!progress?.results) progress = { results: {} };
function save() { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private window: keep it for this visit */ } }

export const results = () => progress.results;
export function resetCampaign() { progress = { results: {} }; save(); }

/** A mission is open once the one before it has been won. */
export function unlocked(key: MissionKey): boolean {
  const i = CAMPAIGN.indexOf(key);
  return i <= 0 || !!progress.results[CAMPAIGN[i - 1]]?.win;
}

/** Ships sunk in earlier missions stay sunk. Only missions before this one count. */
export function carryFor(key: MissionKey): Carry {
  const i = CAMPAIGN.indexOf(key);
  const before = i < 0 ? [] : CAMPAIGN.slice(0, i);
  return { sunk: before.flatMap((k) => progress.results[k]?.sunk ?? []) };
}

export function record(g: Game): Result {
  const r: Result = {
    win: !!g.over?.win, reason: g.over?.reason ?? '', minutes: Math.round(g.t / 60),
    sunk: g.sunk.filter((s) => s.side === 'enemy' && CLASSES[s.cls].kind !== 'air').map((s) => s.name),
    aircraft: g.sunk.filter((s) => s.side === 'enemy' && CLASSES[s.cls].kind === 'air').length,
    lost: g.sunk.filter((s) => s.side === 'allied').map((s) => s.name),
    flags: { ...g.flags },
  };
  // Keep a win once earned; a later loss on a replay doesn't undo history.
  const prev = progress.results[g.scenario];
  if (!prev?.win || r.win) progress.results[g.scenario] = r;
  if (CAMPAIGN.includes(g.scenario)) save();
  return r;
}

/** Names from the carry that matter to this mission's briefing. */
export function changedFor(key: MissionKey): string[] {
  const sunk = carryFor(key).sunk;
  const watch: Partial<Record<MissionKey, string[]>> = {
    javasea: ['Nachi', 'Haguro'],
    sunda: ['Mogami', 'Mikuma'],
    coralsea: ['Shōkaku', 'Zuikaku'],
    midway: ['Akagi', 'Kaga', 'Sōryū', 'Hiryū', 'Kirishima'],
    savo: ['Chōkai'],
    eastsol: ['Jintsū'],
    santacruz: ['Shōkaku', 'Zuikaku', 'Kongō', 'Haruna'],
    komandorski: ['Nachi', 'Maya'],
    guadalcanal: ['Hiei', 'Kirishima'],
    philsea: ['Shōkaku', 'Zuikaku'],
    leyte: ['Yamato', 'Musashi'],
    tengo: ['Yamato', 'Musashi'],
  };
  return (watch[key] ?? []).filter((n) => sunk.includes(n));
}

const list = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const has = (r: Result, n: string) => r.sunk.includes(n);

/** The war after this mission: a few paragraphs, ending with the XO. */
export function interlude(key: MissionKey, r: Result): string[] {
  const sunkAll = (k: MissionKey) => progress.results[k]?.sunk ?? [];
  switch (key) {
    case 'bismarck':
      return r.win ? [
        'The Admiralty signals of 24 May 1941 are full of confusion: Bismarck has blown up and sunk in the Denmark Strait, and nobody aboard Suffolk or Norfolk saw a British submarine. HMS Hood, steaming hard to intercept, is ordered home. Her 1,415 men will never fight the battle that killed all but three of them.',
        'Berlin announces nothing. Hitler is said to have flown into a rage, and Raeder\'s plans for Tirpitz in the Atlantic are shelved.',
        'XO: "Captain, Hood is still afloat because of us. Nobody alive knows what that changes. We should talk about whether we keep doing this."',
      ] : [
        'Bismarck is loose in the Atlantic. The convoy routes are scattered and Hood is racing to cut her off, as she did in 1941, and may die the same way.',
        'XO: "We\'re a warship, wherever we are. Let\'s go back and finish it."',
      ];
    case 'midgets':
      return r.win ? [
        `Five midget submarines are missing from the Japanese order of battle. ${r.flags.midgetsIn ? 'One got through the nets, and USS Monaghan rammed and depth-charged it at 0840, as history has it.' : 'None got into the harbour.'} USS Ward\'s log for the night records explosions offshore that her crew can\'t explain.`,
        'Two hundred and thirty miles north, Nagumo\'s six carriers are turning into the wind. Their aircraft are already on deck.',
        'XO: "That was the easy part, sir. The carriers are next."',
      ] : [
        'Midget subs are inside Pearl Harbor, and the carriers are about to launch. Tang has one more chance to change what happens at 0755.',
        'XO: "Whatever we do now, it has to be the carriers."',
      ];
    case 'kidobutai': {
      const cv = r.sunk.filter((n) => ['Akagi', 'Kaga', 'Sōryū', 'Hiryū', 'Shōkaku', 'Zuikaku'].includes(n));
      const through = r.flags.strikesThrough ?? 0;
      return [
        cv.length ? `${list(cv)} ${cv.length > 1 ? 'are' : 'is'} on the bottom north of Oahu.` : 'The Kido Butai escaped untouched.',
        through === 0 ? 'Not one Japanese aircraft reached Pearl Harbor. Arizona, Oklahoma and the rest of the Pacific Fleet\'s battleships are still afloat on Sunday afternoon. Roosevelt goes to Congress with a stranger story: a Japanese fleet off Hawaii, and carriers sunk by "an American submarine of a new type" the Navy cannot name.'
          : `${through} strike flight${through > 1 ? 's' : ''} reached Oahu. Pearl Harbor was hit, but ${cv.length >= 3 ? 'far less hard than it might have been' : 'the attack was as brutal as history remembers'}.`,
        r.aircraft ? `Tang\'s missiles brought down ${r.aircraft} strike flight${r.aircraft > 1 ? 's' : ''} on the way south.` : '',
        cv.length >= 3 ? 'Yamamoto has lost half his carriers on the first day of the war. The Japanese plan for the Pacific is already coming apart.' : 'Japan still has its carriers. Doolittle\'s raid goes ahead in April.',
        'XO: "History says we lose a lot of men in the next six months. Maybe not now."',
      ].filter(Boolean);
    }
    case 'forcez': {
      const lost = r.lost.filter((n) => /Prince of Wales|Repulse/.test(n));
      return [
        r.win ? `Prince of Wales and Repulse are steaming back to Singapore. ${r.aircraft} Japanese bombers fell into the South China Sea around them.` : `${list(lost)} went down off Kuantan, as in history.`,
        r.win ? 'Churchill, who heard of their loss in 1941 as the worst shock of the war, hears instead of a battle won against aircraft. Nobody can explain how.' : 'Without them, the Royal Navy has nothing east of Ceylon.',
        'XO: "The Dutch and the Australians are about to make a stand in the Java Sea. History says it goes very badly."',
      ];
    }
    case 'javasea':
      return [
        r.win ? `${list(r.sunk.filter((n) => ['Nachi', 'Haguro', 'Ashigara', 'Myōkō'].includes(n)))} went down in the Java Sea, and the invasion convoy turned back north.` : 'The Japanese cruisers smashed Doorman\'s squadron, and the convoy came on.',
        r.lost.length ? `The squadron still lost ${list(r.lost)}.` : 'Karel Doorman takes his ships back into Surabaya, all of them.',
        'XO: "Houston and Perth are trying to get out through the Sunda Strait tomorrow night."',
      ];
    case 'sunda':
      return [
        r.win ? `Mogami and Mikuma are on the bottom of Bantam Bay. ${r.lost.length ? `${list(r.lost)} did not make it out.` : 'Houston and Perth are out in the Indian Ocean, and more than a thousand men who should have died or spent the war as prisoners are going home.'}` : 'Houston and Perth went down in Bantam Bay, fighting to the end.',
        'XO: "Hornet is loading Army bombers in San Francisco. They sail for Japan in April."',
      ];
    case 'coralsea': {
      const cv = r.sunk.filter((n) => ['Shōkaku', 'Zuikaku', 'Shōhō'].includes(n));
      return [
        cv.length ? `${list(cv)} went down in the Coral Sea. Neither will be at Midway or Santa Cruz.` : 'The Japanese carriers withdrew north, damaged but alive.',
        r.lost.length ? `${list(r.lost)} was lost.` : 'Lexington comes home. History wrote her off in the Coral Sea.',
        'XO: "Nimitz knows where they\'re going next. So do we: Midway."',
      ];
    }
    case 'savo':
      return [
        r.win ? `Mikawa lost ${list(r.sunk)}. The transports off Guadalcanal never saw him.` : 'Mikawa\'s cruisers tore through the Allied screen, as in history.',
        r.lost.length ? `The night still cost ${list(r.lost)}.` : 'Every Allied cruiser came through the night.',
        'XO: "The Japanese will run reinforcements down the Slot every night they can. The first big convoy is coming."',
      ];
    case 'eastsol':
      return [
        r.win ? `Ryūjō is gone and Tanaka\'s transports are burning. ${r.sunk.length} ships sunk in all.` : 'Tanaka\'s convoy got through and the troops landed.',
        'The fight for Guadalcanal goes on, but the Japanese garrison is starving.',
        'XO: "Nagumo is bringing his carriers south again in October. Hornet is the one history loses."',
      ];
    case 'santacruz': {
      const cv = r.sunk.filter((n) => ['Shōkaku', 'Zuikaku', 'Zuihō', 'Jun\'yō'].includes(n));
      return [
        cv.length ? `${list(cv)} went down north of the Santa Cruz Islands.` : 'Nagumo\'s carriers escaped north.',
        r.lost.includes('USS Hornet') ? 'Hornet is gone, as in history.' : 'Hornet is still flying aircraft. History had her sunk this afternoon, and the US Navy with one damaged carrier left in the Pacific.',
        'XO: "Two battleships are coming down the Slot to shell Henderson Field in a fortnight."',
      ];
    }
    case 'tassafaronga':
      return [
        r.win ? `Tanaka lost ${list(r.sunk)}, and the drums never reached the beach.` : 'The Long Lances did their work again.',
        r.lost.length ? `Wright lost ${list(r.lost)}.` : 'Wright\'s cruisers all came home. History had four of them torn open and Northampton sunk.',
        'XO: "Guadalcanal is ours. The next fight is a long way north, in the Aleutians."',
      ];
    case 'komandorski':
      return [
        r.win ? `${list(r.sunk.filter((n) => ['Nachi', 'Maya', 'Ashigara', 'Takao'].includes(n)))} went down in the Bering Sea, and the Aleutian garrisons are cut off.` : 'Hosogaya\'s cruisers turned for home.',
        r.lost.includes('USS Salt Lake City') ? 'Salt Lake City was lost.' : 'Salt Lake City was hit and stopped, as in history, and towed home.',
        'XO: "The Atlantic needs us. Dönitz has forty U-boats on the convoy routes."',
      ];
    case 'northcape':
      return [
        r.win ? `Scharnhorst went down off the North Cape${r.lost.length ? `, but not before she sank ${list(r.lost)}` : ' before she ever saw the convoy'}.` : 'Scharnhorst broke into JW 55B.',
        'With Tirpitz crippled or gone and Scharnhorst sunk, the German surface fleet is finished as a threat. The Home Fleet goes east.',
        'XO: "The Philippine Sea, sir. The last of the Japanese carriers."',
      ];
    case 'riverplate':
      return [r.win ? 'Graf Spee is on the bottom of the South Atlantic, and Exeter comes home.' : 'Graf Spee reached Montevideo, and will be scuttled in the river mouth in four days.', 'This was a battle from before the vortex. The campaign story is unchanged.'];
    case 'narvik':
      return [r.win ? `${r.sunk.length} German destroyers are on the bottom of Ofotfjord, and Warburton-Lee lives to take his flotilla home.` : 'Warburton-Lee\'s flotilla was badly hurt, and Warspite will have to come and finish the job.', 'This was a battle from before the vortex. The campaign story is unchanged.'];
    case 'calabria':
      return [r.win ? 'Giulio Cesare and Conte di Cavour are sunk off Calabria. The Regia Marina has lost half its battle fleet in an afternoon.' : 'The Italian fleet escaped behind its smoke, as in history.', 'This was a battle from before the vortex. The campaign story is unchanged.'];
    case 'taranto':
      return [r.win ? `${list(r.sunk.filter((n) => !/Zara|Fiume|Gorizia|Lampo|Fulmine|Baleno|Strale/.test(n)))} lie on the bottom of the Mar Grande, and will not be raised.` : 'The Swordfish did their work, and the Italians raised and repaired their battleships.', 'This was a battle from before the vortex. The campaign story is unchanged.'];
    case 'matapan':
      return [r.win ? 'Vittorio Veneto is on the bottom off Cape Matapan. The Italian battle fleet has lost its best ship.' : 'Vittorio Veneto got home to Taranto, as in history.', 'This was a battle from before the vortex. The campaign story is unchanged.'];
    case 'doolittle':
      return r.win ? [
        'No picket report reached Tokyo. Hornet launched Doolittle\'s sixteen B-25s from the planned spot, 400 miles out, and every one of them reached China with fuel to spare.',
        `Before they arrived, ${r.flags.landHits ?? 0} explosions had already shaken Japan: Tang\'s Tomahawks, which no Japanese report could explain. Tokyo blames "a new long-range bomber", and fighter squadrons are pulled home from the Pacific to guard the cities.`,
        'The raid itself did little damage, but it shamed the Japanese high command, and Yamamoto pushes his Midway plan through.',
        'XO: "So the carriers come south to the Coral Sea next month, and then Midway. We know how those are supposed to go. Do we?"',
      ] : [
        'The picket\'s report reached Tokyo. The bombers launched ten hours early, too far out, and most crashed in China when their fuel ran out, as history has it.',
        'XO: "Same history, then. Midway is next."',
      ];
    case 'midway': {
      const before = sunkAll('kidobutai').filter((n) => ['Akagi', 'Kaga', 'Sōryū', 'Hiryū'].includes(n));
      return [
        before.length === 4 ? 'With Nagumo\'s carriers already gone, Yamamoto brought Yamato and the battleships forward himself.' : before.length ? `${list(before)} ${before.length > 1 ? 'were' : 'was'} already gone from the Kido Butai.` : '',
        r.win ? (has(r, 'Yamato') ? 'Yamato is on the bottom northwest of Midway, and the Combined Fleet turns for home with nothing to show.' : 'The Kido Butai is finished, and USS Yorktown, which history loses at Midway, comes home.') : 'The Japanese carriers struck Midway and slipped away. US dive bombers find them later in the day, as history has it, and lose many crews doing it.',
        'In Washington, the admirals start moving carriers to the Atlantic. The Pacific may be won sooner, and the Arctic convoys need help now.',
        'XO: "Convoy PQ-17 sails next week, sir. Every history book says it\'s a slaughter."',
      ].filter(Boolean);
    }
    case 'pq17': {
      const lost = r.lost.length;
      return [
        r.win ? `PQ-17 made it to Russia with ${lost ? `the loss of ${list(r.lost)}` : 'every ship you could reach'}. Twenty-four ships were lost in the real disaster; this time ${lost} were.` : `${list(r.lost)} went down in the Barents Sea. The disaster is happening again.`,
        has(r, 'Tirpitz') ? 'Tirpitz is gone. Without her, the Royal Navy can release its battleships from Scapa Flow to the Mediterranean and the Pacific.' : 'Tirpitz is back in her Norwegian fjord, still tying down half the Home Fleet.',
        'The tanks and aircraft that reach Murmansk will be at Stalingrad by the autumn.',
        'XO: "We\'re rewriting the convoys and the battle fleets. Do you ever think about what 2029 looks like now?"',
      ];
    }
    case 'guadalcanal':
      return r.win ? [
        `${list(r.sunk.filter((n) => ['Hiei', 'Kirishima', 'Kongō', 'Haruna'].includes(n)))} sank in Ironbottom Sound before firing a shell at Henderson Field.`,
        r.lost.length ? `The night still cost ${list(r.lost)}.` : 'Callaghan\'s ships came through the night intact, and Admiral Callaghan lives.',
        'Guadalcanal is secure by Christmas instead of February.',
        'XO: "Every week we take off this war is thousands of men who get to go home. Tanaka will try again by the end of the month."',
      ] : [
        'The battleships shelled Henderson Field, and the struggle for Guadalcanal drags on into the new year.',
        'XO: "We can\'t win every one, sir."',
      ];
    case 'ons5':
      return [
        r.win ? `ONS-5 got through${r.lost.length ? ` with the loss of ${list(r.lost)}` : ' without loss'}. ${r.sunk.length} U-boats went down around it.` : `The wolfpack sank ${list(r.lost)}.`,
        'It\'s May 1943, "Black May": the month Dönitz loses the Battle of the Atlantic and pulls his U-boats out of the North Atlantic. This time it comes a little sooner.',
        'XO: "Scharnhorst is still in Altafjord, sir, and the winter convoys to Murmansk are about to sail."',
      ];
    case 'philsea':
      return [
        r.win ? `${list(r.sunk.filter((n) => ['Taihō', 'Shōkaku', 'Zuikaku'].includes(n)))} went down west of the Marianas.` : 'Ozawa\'s carriers escaped west, with their air groups shot to pieces by Task Force 58.',
        r.aircraft ? `Tang shot down ${r.aircraft} strike flights before they reached the fleet.` : '',
        'Saipan, Tinian and Guam fall. The B-29s will be over Japan by autumn.',
        'XO: "Leyte is next. The biggest naval battle in history, and Yamato and Musashi are in it."',
      ].filter(Boolean);
    case 'leyte': {
      const bb = r.sunk.filter((n) => ['Yamato', 'Musashi'].includes(n));
      return [
        r.win ? `Center Force was broken in the Palawan Passage: ${list(r.sunk)}.` : 'Kurita cleared the Palawan Passage with his battleships.',
        bb.length ? `${list(bb)} will never reach Samar, where history has Kurita\'s battleships falling on the escort carriers of Taffy 3.` : 'Off Samar, two days from now, the escort carriers and destroyers of Taffy 3 will fight one of the bravest actions in the Navy\'s history.',
        'XO: "Japan\'s newest carrier is fitting out at Yokosuka. She sails at the end of November."',
      ];
    }
    case 'shinano':
      return [
        r.win ? 'Shinano sank on her first voyage, as she did in history. Archerfish\'s crew will never know they were beaten to it.' : 'Shinano reached Kure and was finished. She will never have aircraft to fly.',
        'XO: "One sortie left in the Imperial Navy, sir. Yamato\'s, if she\'s still afloat."',
      ];
    case 'tengo':
      return [
        r.win ? `${r.sunk[0] ?? 'The flagship'} went down in the East China Sea, and the Imperial Japanese Navy\'s last sortie is over.` : 'The flagship reached Okinawa and beached herself under her own guns.',
        'Four months later the war ends. Tang has done what she could.',
        'That night the sea starts to glow, as it did in the Denmark Strait. The vortex is opening again. Tang is going home, to a 2029 that may not be the one she left.',
        'XO: "Whatever\'s waiting for us, Captain, we earned it."',
      ];
    default:
      return [r.reason];
  }
}

export const missionTitle = (k: MissionKey) => MISSIONS[k].title;
