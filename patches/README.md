# TennoScope patch: run it from orbiter, orbiter's reward pick, and "Vaulted" on the overlay

`tennoscope-orbiter.patch` changes TennoScope in three ways:

- **Background start.** `tennoscope --background` runs without its main window: it still follows the game, syncs your inventory and draws the reward overlay. orbiter starts it this way, so you only open orbiter. Opening TennoScope normally while it runs brings its window up; closing that window only hides it again. Without the flag nothing changes.
- **orbiter's pick.** When TennoScope reads the reward cards, it writes their names to `tennoscope-reward-screen.json` in your runtime folder (`$XDG_RUNTIME_DIR`; without one, a `tennoscope-orbiter-<uid>` folder in the temp dir that only you can open, and the hand-off stays off if that folder is anyone else's). orbiter scores them with your weights (plat, unmastered, ducats, complete set) and writes `orbiter-reward-pick.json` back. The overlay shows each card's score in its corner, and the card to take gets a gold outline and **Pick**. It only shows a pick made for exactly the cards on screen, so a stale one never appears. Without orbiter running, the overlay is unchanged.
- **Your warframe.market status stays with orbiter.** While orbiter holds your status (Orders → Invisible, Online or Online in game) it refreshes `orbiter-presence.json` in the same runtime folder every few seconds. While that file is fresh and orbiter is running, TennoScope closes its own status connection and its status switch refuses changes ("orbiter is managing your warframe.market status"), so the two apps never undo each other. When orbiter closes, TennoScope's switch works as before.
- **More for orbiter's scores.** The live price the overlay shows on each card is written next to the card names (same file, same timestamp), so orbiter scores with the numbers you see. And the builds waiting in your foundry go into TennoScope's status report, so orbiter counts a part being crafted as held.
- **Updates come with orbiter.** Started by an orbiter that carries it inside (`ORBITER_BUNDLED` set), TennoScope's own updater stands down: it would swap in a build without this patch, or fail on the read-only AppImage it runs from.
- **The overlay on Windows.** Click-through makes the overlay a layered window, which Windows doesn't draw at all until its layer attributes are set; tao never sets them, so the overlay was shown but invisible. The patch sets them (fully opaque at the layer level) whenever the overlay is configured or shown.
- **Started mid-mission.** TennoScope's log watcher starts at the end of EE.log, so one started during a fissure (orbiter restarting it) never saw the relics that fissure loaded and couldn't read its reward screen. At attach it now reads the log's recent tail (as it already did for the store screen) and arms for the coming reward screen when this mission's relics are loaded and no screen is open.
- **Vaulted.** A small **Vaulted** mark on a card when every relic that drops it is vaulted. TennoScope already downloads the relic data with a `vaulted` flag per relic, but doesn't read it.

It replaces `tennoscope-reward-vaulted.patch` (the Vaulted mark alone, which also only showed in the main window, not on the overlay). Use only this one.

The patch is written against TennoScope `main` at commit `7f66486` (v0.13.1). It changes:

- `app/src-tauri/src/orbiter_bridge.rs` (new): the two files. Includes a test.
- `app/src-tauri/src/update.rs`: no self-update for the copy inside orbiter.
- `app/src-tauri/src/monitor.rs`, `overlay_window.rs`, `lib.rs`: write the cards when they're read, clear them when the overlay hides, and an `orbiter_pick` command for the overlay. Also marks vaulted rewards, handles `--background` (hidden at start, close hides, a second start doesn't pop the window), makes the layered overlay visible on Windows, and catches up on a fissure in progress at attach.
- `app/src-tauri/src/reward_log.rs`: `adopt_tail`, the catch-up. `app/src-tauri/tests/reward_log.rs` covers it.
- `crates/warframe-acquisition/src/relic_catalog.rs`, `crates/warframe-domain/src/rewards.rs`: which rewards only drop from vaulted relics. Includes a test.
- `app/src/RewardOverlay.tsx`, `RewardCards.tsx`, `backend.ts`, `App.css`: ask orbiter for its pick every half second while cards are up, and draw the score, Pick and Vaulted in the card's corner. `app/src/OrbiterPick.test.tsx` covers it.

All 247 overlay tests pass, and so do the Rust tests, apart from one AppImage-update test that also fails without the patch whenever the tests run as root.

## Build a patched TennoScope

On CachyOS you need the toolchain once: `sudo pacman -S --needed base-devel rust clang pnpm nodejs libpipewire webkit2gtk-4.1 tesseract tesseract-data-eng` (or `npm install -g pnpm@10.33.2` for pnpm). Then:

```fish
cd ~/dev/projects
git clone https://github.com/Deftera186/tennoscope.git
cd tennoscope
git checkout 7f66486
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
git reset --hard 7f66486
git clean -fd
git apply ~/dev/projects/orbiter/patches/tennoscope-orbiter.patch
cd app
pnpm tauri build --no-bundle
```

`git clean -fd` only removes the patch's two new files; `node_modules` and the build output are kept, so the rebuild is quicker.
