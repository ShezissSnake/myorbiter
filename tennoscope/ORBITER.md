# TennoScope inside orbiter

This folder is [TennoScope](https://github.com/Deftera186/tennoscope) by Deftera186 and its
contributors, GPL-3.0-only (`LICENSE` here), with orbiter's changes on top. orbiter builds it from
here and ships it inside its Linux and Windows downloads.

## History

- Until build 45, orbiter built TennoScope by cloning upstream at a pinned commit and applying
  `patches/tennoscope-orbiter.patch`, which a weekly workflow checked against upstream `main`.
- Since build 46, TennoScope's source lives here. It was brought in with
  `git subtree add --prefix=tennoscope` at upstream commit `e5755f8` (v0.14.0, 30 October 2026),
  without `--squash`, so every upstream commit and its author is in orbiter's history
  (`git log e5755f8`, or `git blame` on any file here).
- The next commit applied the patch as it was, unchanged: its tree is byte for byte upstream
  `e5755f8` with the patch applied. Every change since is an ordinary orbiter commit:
  `git log -- tennoscope` lists them. The patch's own write-up of each change is in
  `git show ecbb9c0:patches/README.md`.

What orbiter changes, in short: TennoScope starts without a window (`--background`) and leaves
updates to orbiter; it shares the reward cards with orbiter and draws orbiter's pick, score,
mastery seal, vault word and set row on its overlay, and orbiter's riven cycle over the game; it
leaves your warframe.market status to orbiter while orbiter holds it; it passes each copy of your
gear (polarities, archon shards, Helminth abilities, modular parts), imprints and consumed
warframes in its status report; it reads card titles in coloured UI themes, catches up on a fissure
already in progress, uses orbiter's relic tables, makes the overlay visible on Windows, and bundles
Tesseract and the licences in the Linux build. Full access (reading the game's memory) is never
preselected: its first run starts on Overlay with the account-risk warning beside Full, and orbiter
turns Full on or off for it (`--access=full` / `--access=overlay`, orbiter's *Read my inventory*
switch, which shows the same warning).

## Build it on your PC

Once, on Arch Linux or CachyOS: `sudo pacman -S --needed base-devel rust clang pnpm nodejs libpipewire
webkit2gtk-4.1 tesseract tesseract-data-eng patchelf`. Then, from orbiter's folder:

```fish
cd tennoscope
../scripts/vendor-linux-tesseract.sh app/src-tauri/vendor/tesseract
cd app
pnpm install --frozen-lockfile
pnpm tauri build --no-bundle
```

The program is `tennoscope/target/release/tennoscope`. A development orbiter (`npm run tauri dev`)
finds it there by itself; Settings → TennoScope can point any orbiter at it. After pulling changes
to `tennoscope/`, run the last two lines again.

TennoScope is its own Cargo workspace and pnpm project, separate from orbiter's (it uses Rust
edition 2024 and the toolchain in `rust-toolchain.toml`; orbiter's crates stay on Rust 1.77.2).
Its checks, run here: `cargo clippy --workspace --all-targets -- -D warnings`,
`cargo test --workspace` (as root, the AppImage-update test and two memory-permission tests fail,
as they do upstream), and `pnpm test` in `app`.

## What's left out

- Upstream's `.github/` (its CI, release, APT and issue-labeler workflows, issue templates and
  `FUNDING.yml`) was removed: orbiter's own workflows in the repository's `.github/` build and check
  this copy, and the funding link was upstream's to give. The packaging notes in `packaging/` still
  describe upstream's release process, for reference.
- This TennoScope never updates itself: its updater stands down whether or not orbiter started it,
  and it never asks upstream's release feed about a newer version (`UPDATES_COME_WITH_ORBITER` in
  `app/src-tauri/src/update.rs`). orbiter brings the next one.

## Looking at upstream changes

Nothing follows upstream automatically. When you choose to look:

```fish
git remote add upstream https://github.com/Deftera186/tennoscope.git   # once
git fetch upstream
# the upstream commit last merged here
set last (git log -1 --format=%B --grep='^git-subtree-split:' | sed -n 's/^git-subtree-split: //p')
git log --oneline $last..upstream/main        # what's new upstream
git diff --stat $last upstream/main           # which files it touches
```

To take them, on a branch of its own:

```fish
git subtree pull --prefix=tennoscope upstream main
```

This merges upstream's new commits (again with their history) into `tennoscope/`. Resolve any
conflicts with orbiter's changes there, run the checks above, and build a release to try it.
