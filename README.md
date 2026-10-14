# Red Storm Sonar

Playable prototype for the Red Storm Rising remake (working title *Phantom Leviathan: Silent Battle*).
You command USS Tang (SSN-805, Virginia Block V). Two scenarios, picked on the start screen:

- **Sink the Bismarck** (training mission, default). Tang comes out of the time vortex in the
  Denmark Strait at 0300 on 24 May 1941. Bismarck and Prinz Eugen run southwest at 27 kt with the
  British cruisers Suffolk and Norfolk shadowing 13 to 15 nm astern, and Bismarck's Arado Ar 196
  floatplane circling ahead of the group. Sink Bismarck before she
  breaks out (5 hours, or 60 nm clear of Tang). Sinking a British cruiser fails the mission.
- **Duel: Kazan** (2029). Tang against the Yasen-M Kazan in the Bear Gap, with an Il-38N May
  laying sonobuoys overhead and a Ka-27PL helicopter dipping its sonar, both passing what they
  find to Kazan.

Stack: TypeScript, Vite, PixiJS 8, Vitest. The simulation in `src/sim` has no rendering code.

## Play

- Online: https://sth966947.github.io/Phantom-Leviathan-Silent-Battle/ (rebuilt and deployed by
  GitHub Actions on every push to `main`).
- Locally: `npm install`, then `npm run dev` and open the printed URL.
- `npm run build` typechecks and writes `dist/index.html`, a single self-contained file that also
  opens straight from disk.
- `npm test` runs the sim tests. `npx vite-node scripts/balance.ts` plays 100 scripted games per
  scenario and prints the outcome mix.

## Controls (keyboard and mouse)

| Action | Mouse | Keys |
|---|---|---|
| Steer | Click the tactical plot, or the 10° buttons | A / D or ← / → |
| Speed | Speed buttons (Creep 3 to Flank 32) | W / S or ↑ / ↓ |
| Zoom | Scroll wheel on the plot, or + / − | = / - |
| Select contact | Click its marker on the plot or its row in Contacts | Tab |
| Accept the suggested class | Accept beside a match | K (top match) |
| Depth: periscope / 150 ft / 700 ft | Depth buttons | Q shallower, E deeper, L toggles 150/700 |
| Fire Mk 48 at the selected contact | Mk 48 | F |
| Fire Harpoon / Tomahawk anti-ship (Maritime Strike) | Harpoon / Tomahawk anti-ship | H / T |
| Fire ASROC at the selected sub (1 to 15 nm) | ASROC | G |
| Fire JATM / SM-6 at the selected aircraft | JATM / SM-6 | J / M |
| Radar on or off (periscope depth only) | Radar | R |
| Periscope view of the selected contact | Click a contact you can see, or Periscope view | V (Esc lowers) |
| Active ping | Active ping | P |
| Countermeasure | Countermeasure | C |
| Time compression | Pause / ×10 / ×30 / ×90 | Space, 1, 2, 3 |

## Layout

- `src/sim/`: pure game logic (no DOM, no PixiJS), deterministic for a seed. `sim.ts` holds
  platforms, weapons, the sonar equation, contact tracking, enemy AI, torpedoes and decoys.
- `src/render/plot.ts`: PixiJS tactical plot (smooth zoom, ping and blast effects).
- `src/ui/`: waterfall display, status panel and log, synthesized sounds.
- `src/main.ts`: input, game loop and lifecycle.

## Contact ID: signatures are seen, not heard

Selecting a contact shows its narrowband signature (frequency across, time down) beside the
broadband waterfall. Each class card in `src/sim/classes.ts` has machinery tonals (strongest
first), a blade count and a shaft rate per knot. Lines appear one by one as signal excess grows
(about 4 dB per extra line), and the blade-rate line appears above 6 dB. The crew lists the top
three library classes with a match %; Bismarck and Prinz Eugen share their strongest line, as do
the British ships, so a faint contact stays ambiguous. At periscope depth, ships within 8 nm are
identified by sight. Accepting a match labels the contact; friendly classes turn green.

## Model in brief (game numbers, not real data)

- Detection: `source level - 20·log10(range) - own self noise - layer loss - threshold (+ array gain) > 0`.
  Source level rises 1.5 dB per knot; self noise rises above 5 kt.
- Towed array (TB-34): +3 dB and no blind arc astern, but only at ≤12 kt and 90 s after the last turn.
- Thermal layer costs 9 dB and halves torpedo seeker range across it.
- Passive contacts give bearing only. Range error starts up to ±60% and shrinks with time on contact
  and with each leg change of 40°+. An active ping gives an exact fix and reveals you within 60 nm.
- Mk 48 ADCAP Mod 7: 55 kt, 22 nm, wire-guided to your solution until its 2.5 nm seeker acquires.
  The wire parts above 24 kt or beyond 16 nm. Four tubes, 120 s reload. Weapons are unlimited for early versions; only tube reloads limit firing.
- Harpoon Block II (torpedo tube, 470 kt, 67 nm) and Maritime Strike Tomahawk (vertical tube,
  480 kt, datalink updates in flight) launch from 150 ft or shallower, fly to the solution and
  home on the surface ship nearest it, friend or foe. Damage: Mk 48 5, Tomahawk 3, Harpoon 2.
  Bismarck takes 12, Prinz Eugen 7, a County cruiser 6. Damage slows a ship.
- Periscope depth: exact fix and class by sight within 8 nm; enemy ships within 6 nm may spot the
  periscope, and the group then turns away at full speed while still heading for the Atlantic.
- 1941 ships have no sonar. Being hit or spotted makes the German group run.
- Kazan (Yasen-M) AI: patrols; attacks after holding you ~90 s or hearing a ping or launch;
  fires UGST (50 kt, 13 nm, unlimited, one shot per 5 min); evades incoming torpedoes with a decoy, sprint, layer change and
  often a snap shot back down the bearing.

- ASROC (sub-launched RUM-139C, vertical tube): flies at 600 kt to the solution 1 to 15 nm out and
  drops a Mk 54 there. The Mk 54 (40 kt, 6 nm, 1.6 nm seeker) circles and switches layers until it
  acquires; it kills a submarine (5 damage) but only dents a ship (2).
- Air defence from the vertical tubes, fire and forget: the missile flies down the selected air
  contact's bearing (or own heading if none) and takes the nearest aircraft its seeker finds within
  50 nm and 45° either side; with nothing there it flies on until its fuel runs out. AIM-260 JATM
  (100 nm of fuel, Pk 0.85; a 7-round canister occupies one tube until it is empty) is for slow
  sub-hunting aircraft; SM-6 (130 nm, Pk 0.9) is for missiles and fast jets and also kills aircraft.
- Radar (periscope depth only, one sweep every 4 s): ships inside 15 nm are fixed and classified
  within a sweep or two; from 15 to 24 nm returns are patchy and classification is a matter of
  luck each sweep; aircraft show to 40 nm and are classified inside 20 nm. In 1941 nobody can
  detect it (radar warning receivers came later). In 2029 the Il-38's ESM hears it out to 100 nm.
- Contacts are named for the sensor that found them: Sierra (sonar), Victor (eyes), Romeo (radar),
  Echo (ESM). At periscope depth, ESM picks up the Il-38's search radar as a bearing.
- Periscope view: at periscope depth, a ship within 8 nm (or, in 2029, an aircraft within 10 nm)
  can be looked at. The view draws the class silhouette at the real range and angle on the bow,
  with the photonics mast zoomed to fit, hull-down beyond about 3 nm, snow and swell; the
  identification book beside it shows every class broadside with the crew's match % and Accept.
  Sighting fixes the contact but no longer classifies it on its own. Bismarck and Prinz Eugen look
  alike on purpose.
- 1941: aircraft put nothing in the water, so only radar finds them. 2029: sonobuoy splashes are on
  our sonar (a bearing and rough position on the aircraft that dropped them), and a hovering Ka-27
  with its dome in the water is a sonar contact with its own rotor and gearbox lines.
- Arado Ar 196: circles 12 nm from Bismarck. Inside 5 nm it may spot a periscope, and it sees
  missile launches within 20 nm; either turns the German group away. On spotting a periscope it
  drops its two 50 kg bombs (35% chance of 1 damage).
- Ka-27PL: hops between dips, hovering 3 minutes with its dome above or below the layer
  (threshold better than a buoy). Fifteen seconds of contact gives a datum for Kazan; a close one
  brings it in to drop its single APR-3E.
- Il-38N: searches the patrol box laying sonobuoys (shallow or deep), comes to any datum (buoy
  contact, periscope on its radar inside 12 nm, our radar on its ESM, a missile launch inside 20 nm),
  seeds buoys round it, drops an APR-3E (60 kt, 3 nm, 3 damage) on a fresh, close fix, and
  datalinks the datum to Kazan. Buoys hear a quiet, slow boat only close in; speed gives you away.
  Splashes within 5 nm are reported by sonar.

## Planned

USS Tang's full loadout, per Scott. Everything below except land-attack Tomahawk is now in the
game, with unlimited weapons and only tube reloads limiting fire.

- **Torpedo room:** 25 weapons (unlimited in early versions) shared between Mk 48 ADCAP torpedoes and UGM-84 Harpoon
  anti-ship missiles, fired from the four 21-inch tubes.
- **Virginia Payload Module and bow VLS:** 40 Tomahawks (unlimited in early versions) from 12 vertical launch tubes, mixing
  Maritime Strike Tomahawk (anti-ship) and land-attack Tomahawk.
