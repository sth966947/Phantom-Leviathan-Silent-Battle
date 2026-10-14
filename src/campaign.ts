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
    midway: ['Akagi', 'Kaga', 'Sōryū', 'Hiryū', 'Kirishima'],
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
    case 'doolittle':
      return r.win ? [
        'No picket report reached Tokyo. Hornet launched Doolittle\'s sixteen B-25s from the planned spot, 400 miles out, and every one of them reached China with fuel to spare.',
        `Before they arrived, ${r.flags.landHits ?? 0} explosions had already shaken Japan: Tang\'s Tomahawks, which no Japanese report could explain. Tokyo blames "a new long-range bomber", and fighter squadrons are pulled home from the Pacific to guard the cities.`,
        'The raid itself did little damage, but it shamed the Japanese high command, and Yamamoto pushes his Midway plan through.',
        'XO: "So Midway happens anyway. We know how that one is supposed to go. Do we?"',
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
        'XO: "Every week we take off this war is thousands of men who get to go home."',
      ] : [
        'The battleships shelled Henderson Field, and the struggle for Guadalcanal drags on into the new year.',
        'XO: "We can\'t win every one, sir."',
      ];
    case 'ons5':
      return [
        r.win ? `ONS-5 got through${r.lost.length ? ` with the loss of ${list(r.lost)}` : ' without loss'}. ${r.sunk.length} U-boats went down around it.` : `The wolfpack sank ${list(r.lost)}.`,
        'It\'s May 1943, "Black May": the month Dönitz loses the Battle of the Atlantic and pulls his U-boats out of the North Atlantic. This time it comes a little sooner.',
        'XO: "Back to the Pacific. The carriers they built to replace the ones we sank are at sea."',
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
