# Running MyOrbiter from source

## What you need

Rust 1.95 or newer, Node 20.19 or 22.12 and newer, and the usual Tauri Linux dependencies
(webkit2gtk-4.1). TennoScope (`tennoscope/`) has its own toolchain and uses pnpm; see
`tennoscope/ORBITER.md`.

```fish
npm install
npm run tauri dev        # a development window
npm run tauri build      # AppImage, .deb and .rpm in target/release/bundle
```

A build made this way is version 0.1.0, never updates itself, and carries no TennoScope inside it.
A development window (`npm run tauri dev`) starts the TennoScope built in
`tennoscope/target/release/` by itself; for any other build without one, build TennoScope as
`tennoscope/ORBITER.md` says and point Settings → TennoScope at the program.

## The interface in a browser

Work on the UI in a normal browser, without Tauri:

```fish
npm run dev-bundle       # writes public/dev-bundle.json from your TennoScope folder
npm run dev-data         # writes public/dev-market-items.json, dev-rivens.json and dev-recipe-data.json (read-only requests)
npm run dev              # http://localhost:1421
```

`npm run dev-data` fetches the item list and riven names from warframe.market and the Foundry
recipes from warframe-public-export-plus: the same sources and shape the app reads, requested one at
a time at the app's pace. All of `public/dev-*.json` stays out of git: it holds your own account.
`npm run dev` reads the world state (fissures, Baro, the clocks and the rest) live from
api.warframestat.us, from the browser.

Or use the invented account in `demo/` (the one in the screenshots), with no data of your own:
`npm run dev:demo`. `demo/README.md` says how it's made. The demo has a world state of its own
(`demo/dev-worldstate.json`) and asks no world-state service, so the screenshots
(`npm run screenshots`), the help pictures and their check (`npm run screenshots -- --only help
[--check]`) and the sweep (`npm run sweep`) see the same world on every run, online or not; each of
them stops and counts any world-state request, and fails if there was one.

## Tests

```fish
npm test                                   # the analysis core
npm run check -- --threshold error         # type-checks the project
cargo test --manifest-path src-tauri/Cargo.toml
```

The tests that need the dev data (the Sell spares plan, riven stats, the real catalogue) are
skipped until `npm run dev-bundle` and `npm run dev-data` have run. Property tests replay with
`PROPERTY_SEED=<n>` and run longer with `PROPERTY_RUNS=<n>`.

## Sending a change

Work on a branch named `work/<short-slug>` from the latest `main`, run the three checks above
before each commit (and `node scripts/site.mjs --check --offline` when the site or a download link
changed), and push the branch to `origin`, which is the GitHub repository
(`git@github.com:ShezissSnake/myorbiter.git`). The change comes in as a pull request on GitHub,
opened as a draft until it has been looked over; nothing is pushed to `main` directly. GitLab
builds nothing any more (it keeps builds 0.2.100 to 0.2.119 and the fallback update feed), so
nothing is sent there.

## App icon

`src-tauri/icons/icon.svg` is the master: a detailed drawing for 48 px and up and a bolder one for
smaller sizes. The PNGs, `icon.ico`, `icon.icns` and `icon-small.svg` are rendered from it, never
edited by hand:

```fish
npm run icons              # writes the PNGs, icon.ico, icon.icns and icon-small.svg
npm run icons -- --check   # fails if any of them differs from what icon.svg renders
```

It needs `rsvg-convert` (librsvg); the same files come out byte for byte with the same
`rsvg-convert` and the cairo and zlib under it, so `--check` may report differences after a system
update. `icon-mono.svg`
is drawn by hand: a one-colour hull for small monochrome places such as a tray, which nothing uses
yet. `npm test` checks that every icon `tauri.conf.json` lists is there and square, and that
`icon-small.svg` matches the master.

## A release-style AppImage on your own PC

`scripts/build-local.sh` builds the Linux AppImage the way the release workflow's Linux job does:
Tesseract put inside TennoScope, TennoScope's own AppImage, MyOrbiter's with TennoScope inside it,
and the same repack step (`scripts/repack-appimage.sh`). Use it to try a build without spending
Actions minutes. It is made for Arch Linux and CachyOS; install what it needs once:

```fish
sudo pacman -S --needed base-devel rust clang pnpm nodejs npm libpipewire webkit2gtk-4.1 tesseract tesseract-data-eng patchelf xdg-utils
```

Then, from MyOrbiter's folder:

```fish
scripts/build-local.sh --check                  # only check the tools are there
scripts/build-local.sh                          # the whole build (TennoScope first; a long first run)
scripts/build-local.sh --skip-tennoscope        # MyOrbiter only, reusing the last TennoScope
scripts/build-local.sh --version 0.2.900        # carry a version of your choice
```

The AppImage lands in `target/release/bundle/appimage/`. It differs from a release build in three
ways: it isn't signed (so it never offers itself as an update), it links against your system's newer
libraries (so it may not start on an older distribution or SteamOS), and its bundled libraries'
notices are matched with pacman, without the list of their sources. Fine for testing; share the
release builds.

## On your desktop (KDE, GNOME, Hyprland)

```fish
scripts/install-desktop.sh               # build, then add MyOrbiter to your app menu
scripts/install-desktop.sh --no-build    # install the last build again
scripts/install-desktop.sh --uninstall
```

This puts the program in `~/.local/bin`, its icon in your icon theme folder and `myorbiter.desktop` in
`~/.local/share/applications`, all in your home folder. That entry is what gives the window its icon
in the taskbar, dock or Waybar: on Wayland the desktop matches a window to its launcher entry by app
id, and MyOrbiter's is `myorbiter`. A window from `npm run tauri dev` picks the icon up too once it's
installed. The installed program carries no TennoScope, so point Settings → TennoScope at one.

## Testing the updater locally

The `e2e-updater` Cargo feature is never used for a release: the release workflow's Linux and
Windows jobs fail a build whose binary carries it. It lets a local build take
`MYORBITER_UPDATER_E2E_ENDPOINT` (a `http://127.0.0.1:…` manifest) and `MYORBITER_UPDATER_E2E_PUBKEY`
(a test key's public key). So two local builds signed with a throwaway key can update one into the
other against a local server. `MYORBITER_UPDATER_E2E_AUTO=1` makes it check, install and restart by
itself, printing each step, for a run with no window to click in.
