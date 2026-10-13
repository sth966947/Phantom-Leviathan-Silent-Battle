# Red Storm Sonar

Playable prototype for the Red Storm Rising remake (working title *Phantom Leviathan: Silent Battle*).
You command USS Tang (SSN-805, Virginia Block V). Two scenarios, picked on the start screen:

- **Sink the Bismarck** (training mission, default). Tang comes out of the time vortex in the
  Denmark Strait at 0300 on 24 May 1941. Bismarck and Prinz Eugen run southwest at 27 kt with the
  British cruisers Suffolk and Norfolk shadowing 13 to 15 nm astern. Sink Bismarck before she
  breaks out (5 hours, or 60 nm clear of Tang). Sinking a British cruiser fails the mission.
- **Duel: Kazan** (2029). Tang against the Yasen-M Kazan in the Bear Gap.

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
| Fire Harpoon / Maritime Strike Tomahawk | Harpoon / Tomahawk | H / T |
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

## Planned

USS Tang's full loadout, per Scott. These need surface and land targets first; this prototype
has one submerged target, so only the Mk 48 is in the game today.

- **Torpedo room:** 25 weapons (unlimited in early versions) shared between Mk 48 ADCAP torpedoes and UGM-84 Harpoon
  anti-ship missiles, fired from the four 21-inch tubes.
- **Virginia Payload Module and bow VLS:** 40 Tomahawks (unlimited in early versions) from 12 vertical launch tubes, mixing
  Maritime Strike Tomahawk (anti-ship) and land-attack Tomahawk.
