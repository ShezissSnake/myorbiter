# TennoScope patch: run it from orbiter, orbiter's reward pick, and "Vaulted" on the overlay

`tennoscope-orbiter.patch` changes TennoScope in three ways:

- **Background start.** `tennoscope --background` runs without its main window: it still follows the game, syncs your inventory and draws the reward overlay. orbiter starts it this way, so you only open orbiter. Opening TennoScope normally while it runs brings its window up; closing that window only hides it again. Without the flag nothing changes.
- **orbiter's pick.** When TennoScope reads the reward cards, it writes their names to `tennoscope-reward-screen.json` in your runtime folder (`$XDG_RUNTIME_DIR`; without one, a `tennoscope-orbiter-<uid>` folder in the temp dir that only you can open, and the hand-off stays off if that folder is anyone else's). orbiter scores them with your weights (plat, unmastered, ducats, complete set) and writes `orbiter-reward-pick.json` back. The overlay shows each card's score in its corner, and the card to take gets a gold outline and **Pick**. It only shows a pick made for exactly the cards on screen, so a stale one never appears. Without orbiter running, the overlay is unchanged.
- **Your warframe.market status stays with orbiter.** While orbiter holds your status (Orders → Invisible, Online or Online in game) it refreshes `orbiter-presence.json` in the same runtime folder every few seconds. While that file is fresh and orbiter is running, TennoScope closes its own status connection and its status switch refuses changes ("orbiter is managing your warframe.market status"), so the two apps never undo each other. When orbiter closes, TennoScope's switch works as before.
- **More for orbiter's scores.** The live price the overlay shows on each card is written next to the card names (same file, same timestamp), so orbiter scores with the numbers you see. And the builds waiting in your foundry go into TennoScope's status report, so orbiter counts a part being crafted as held.
- **Updates come with orbiter.** Started by an orbiter that carries it inside (`ORBITER_BUNDLED` set), TennoScope's own updater stands down: it would swap in a build without this patch, or fail on the read-only AppImage it runs from.
- **The overlay on Windows.** Click-through makes the overlay a layered window, which Windows doesn't draw at all until its layer attributes are set; tao never sets them, so the overlay was shown but invisible. The patch sets them (fully opaque at the layer level) whenever the overlay is configured or shown.
- **Started mid-mission.** TennoScope's log watcher starts at the end of EE.log, so one started during a fissure (orbiter restarting it) never saw the relics that fissure loaded and couldn't read its reward screen. At attach it now reads the log's recent tail (as it already did for the store screen) and arms for the coming reward screen when this mission's relics are loaded and no screen is open.
- **Coloured UI themes.** The card reader graded each title pixel by its grey value, which suits the default near-white titles; a theme that draws them blue made them darker than bright card art, so those cards read as blank and the screen was never read. It now grades by each pixel's brightest channel, which reads any bright title whatever its hue. When that fails (a custom theme with dim titles), it learns the title colour from the screen: every card's title shares one colour while the art behind each differs, so the colours all the title strips share are tried as the text, each checked against the relic pool like any read. The colour that worked is tried first on the next screen. Twelve hues at full, 60% and 45% brightness all read (`any_title_colour_reads`). A real blue-theme capture (`tests/fixtures/reward-screen-blue-theme.png`, blanked outside the card titles) is the test. The Windows overlay step also logs at Info now, so a release log says whether it ran.
- **The reward cards, laid out by orbiter's settings.** A green seal by the name says the item is mastered (an empty ring: not yet); a word says where the reward can still be had (Vaulted, Resurgence or Farmable: orbiter's word, since it knows Prime Resurgence, else the relic tables'); and every Prime part shows its set's parts, the ones held solid, this card's underlined, counted toward your next whole set. The dual pistols' slots (two Bronco Prime for an Akbronco, and Aklex, Akmagnus, Akvasto) get the pistol's own icon as a white silhouette like the others, and count as held when the pistol is built or every part to build it is in hand. A card that finishes a set, a first one or an extra to sell, is double-framed with "Completes set". orbiter writes `orbiter-overlay.json` to the same runtime folder: the fissure and Ducat Kiosk overlays can each be turned off, and the cards' seal, vault word, set, plat, ducats and pick each hidden.
- **Imprints.** The inventory read keeps your Kubrow and Kavat imprints (`KubrowPetPrints`) and passes them to orbiter in the status report, which lists them for sale.
- **orbiter's riven cycle over the game.** A third overlay window (`/riven`, `RivenOverlay.tsx`): when orbiter writes `orbiter-riven-cycle.json` to the runtime folder (a riven read waiting for keep-or-take: both rolls, each stat graded, and which to keep), TennoScope shows it centred near the top of the game until the file's `until` time (orbiter gives it 25 seconds), then hides it. Off when orbiter's overlay settings say `riven: false`. A thread checks the file every 0.7 s; the overlay asks for it every half second.
- **Each copy of your gear.** The same read passes each copy of a warframe, weapon or companion to orbiter as `{type, f, p}`: its path, the game's feature bits (`Features`: 1 an Orokin Catalyst or Reactor, 512 an Incarnon Genesis installed…) and its Forma (`Polarized`). orbiter's list of gear you no longer need keeps a weapon whose Incarnon is installed when the better version has none, and says what Forma and catalysts a copy holds.
- **Vaulted.** A small **Vaulted** mark on a card when every relic that drops it is vaulted. TennoScope already downloads the relic data with a `vaulted` flag per relic, but doesn't read it.

It replaces `tennoscope-reward-vaulted.patch` (the Vaulted mark alone, which also only showed in the main window, not on the overlay). Use only this one.

The patch is written against TennoScope `main` at commit `e5755f8` (30 October 2026, TennoScope v0.14.0). It changes:

- `app/src-tauri/src/orbiter_bridge.rs` (new): the two files. Includes a test.
- `app/src-tauri/src/update.rs`: no self-update for the copy inside orbiter.
- `app/src-tauri/src/monitor.rs`, `overlay_window.rs`, `lib.rs`: write the cards when they're read, clear them when the overlay hides, and an `orbiter_pick` command for the overlay. Also marks vaulted rewards, handles `--background` (hidden at start, close hides, a second start doesn't pop the window), makes the layered overlay visible on Windows, and catches up on a fissure in progress at attach.
- `app/src-tauri/src/reward_log.rs`: `adopt_tail`, the catch-up. `app/src-tauri/tests/reward_log.rs` covers it.
- `app/src-tauri/src/reward_ocr.rs`, `lib.rs`, `tests/reward_ocr.rs` and a new fixture: titles graded by their brightest channel, or by a title colour learned from the screen.
- `crates/warframe-acquisition/src/inventory.rs`, `crates/app-core/src/lib.rs` and `tests/inventory_decoder.rs`: imprints and each copy of your gear kept for orbiter.
- `app/src/RivenOverlay.tsx` (new, with `RivenOverlay.test.tsx`), `Root.tsx`, `routing.ts`, `backend.ts`, `App.css`, `tauri.conf.json` and `capabilities/default.json` (the `riven-overlay` window), `overlay_window.rs` (`show_riven_overlay`, its geometry and a test), `orbiter_bridge.rs` (`read_riven`, with a test) and `lib.rs` (the `orbiter_riven` command and the thread that shows and hides it): orbiter's riven cycle over the game.
- `crates/win-capture/src/layered.rs` (new): the one Windows call that makes the layered overlay visible, in the crate that already holds TennoScope's Windows API code (the app crate forbids `unsafe`).
- `crates/warframe-acquisition/src/relic_catalog.rs`, `crates/warframe-domain/src/rewards.rs`: which rewards only drop from vaulted relics. Includes a test.
- `app/src/RewardOverlay.tsx`, `RewardCards.tsx`, `backend.ts`, `App.css`: ask orbiter for its pick every half second while cards are up, and draw the score, Pick and Vaulted in the card's corner. `app/src/OrbiterPick.test.tsx` covers it.

All 266 overlay tests pass, and so do the Rust tests, apart from three that also fail without the patch whenever the tests run as root (one AppImage-update test and two memory-permission tests: root can read a file with no permissions).

## Keeping up with TennoScope

Every Monday the *TennoScope patch check* workflow tries the patch on TennoScope's latest `main`. Its summary lists what TennoScope changed since the pinned commit; the run fails (and GitHub e-mails you) once the patch no longer applies. Builds keep working meanwhile, since they use the pinned commit. To move to a newer TennoScope: in a clone, check out the new commit, `git apply --3way` the patch, fix any conflicts, run TennoScope's checks (`cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and `pnpm test` in `app`), then regenerate the patch with `git diff --cached <new commit> > tennoscope-orbiter.patch` and move `TENNOSCOPE_COMMIT` in `.github/workflows/release.yml` and `scripts/tennoscope-notice.sh`, and the commit in this file.

## Build a patched TennoScope

On CachyOS you need the toolchain once: `sudo pacman -S --needed base-devel rust clang pnpm nodejs libpipewire webkit2gtk-4.1 tesseract tesseract-data-eng` (or `npm install -g pnpm@10.33.2` for pnpm). Then:

```fish
cd ~/dev/projects
git clone https://github.com/Deftera186/tennoscope.git
cd tennoscope
git checkout e5755f8
git apply ~/dev/projects/orbiter/patches/tennoscope-orbiter.patch
cd app
pnpm install --frozen-lockfile
pnpm tauri build --no-bundle
```

`--no-bundle` skips the AppImage/.deb/.rpm, which you don't need (and whose last step fails without TennoScope's signing key). The program is `~/dev/projects/tennoscope/target/release/tennoscope`, which orbiter finds and starts on its own. It uses the same data folder and settings as an installed TennoScope.

### Updating an existing patched copy

When the patch changes, put the clone back to the original and apply the new one:

```fish
cd ~/dev/projects/tennoscope
git fetch --quiet origin
git reset --hard e5755f8
git clean -fd
git apply ~/dev/projects/orbiter/patches/tennoscope-orbiter.patch
cd app
pnpm tauri build --no-bundle
```

`git clean -fd` only removes the patch's two new files; `node_modules` and the build output are kept, so the rebuild is quicker.
