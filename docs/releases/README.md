# How builds are made and released

This page is for whoever runs the releases. Players need only `docs/install.md`.

## Making the downloads

`.github/workflows/release.yml` (*Release*) builds them on GitHub Actions' hosted runners. It runs
only when started by hand: *Actions* → *Release* → *Run workflow*, on `main`. A push, a pull request
and a schedule start nothing. Its *task* input picks what it does: `release` (the default),
`promote` or `pages`; a release or a promotion that gets that far ends by rebuilding the website.

A release run is build *n*, version `0.2.n`, where *n* is the workflow's run number plus
`BUILD_OFFSET` (`docs/maintaining.md`, *Build numbers*): the first build made on GitHub is 0.2.120,
above every build made on GitLab (0.2.100 to 0.2.119) and every older GitHub build (below 100).
Runs that promote or publish the site use a number too, so build numbers have gaps. `test` runs the
tests, checks the MSRV and audits both lockfiles; `linux` (`ci/build.sh`) builds TennoScope from
`tennoscope/` and MyOrbiter for Linux (the AppImage and the .deb, on Ubuntu 22.04: they need
nothing newer than glibc 2.35, which `ci/build.sh` checks, and TennoScope uses the system's
PipeWire, 0.3.48 or newer: the AppImage runs on SteamOS and any x86-64 Linux with those (Ubuntu
22.04, Debian 12 and later), the .deb on Debian and Ubuntu from those releases on, not on SteamOS);
`windows`, with the *windows* box ticked, builds the Windows installer natively on a Windows
runner. Only a run on `main` goes further; on any other branch the downloads stay as the run's
artifacts for 3 days.

The jobs that build (and so run npm, pnpm and Cargo code) never see the signing key and hold only a
read-only token. `sign` signs; `assemble` adds `myorbiter-source.tar.gz`, the complete source of the
commit it built, as the GPL-3.0 asks, writes `latest.json` and `SHA256SUMS`; `attest` records
GitHub's build provenance for `SHA256SUMS`; `publish`, which checks out nothing, makes the
pre-release `build-<n>` at that commit with every file on it. TennoScope's licence and a notice
travel beside it. `cleanup` then deletes the run's artifacts, now on the release.

## Channels

Each installed copy follows one channel: Stable, Beta or Experimental (`docs/install.md`). A build
keeps its version on every channel: moving it up a channel moves the same files, never a rebuild.
Each channel is a release of its own, tagged with the channel's name (`stable`, `beta`,
`experimental`), holding only that channel's `latest.json`, at the address installed copies check
first (`https://github.com/ShezissSnake/myorbiter/releases/download/<channel>/latest.json`,
`src-tauri/src/updates.rs`). Their second address is the same channel on GitLab's package registry,
which keeps the manifests GitLab's last build left there.

- **A build on `main` becomes Experimental.** With the signing key available, the `sign` job signs
  the final AppImage (after `scripts/repack-appimage.sh`) and the Windows installer with
  `scripts/updater-sign.mjs` (plain Node, no dependencies, signatures of the form
  `tauri signer sign --app-version` writes), and checks each signature against the public key in
  `src-tauri/tauri.conf.json`. It checks out only the signer and the configuration, installs and
  builds nothing, and runs the signer with an emptied environment. `assemble` writes `latest.json`
  (`scripts/github-manifest.mjs`): the version, release notes made from the commit subjects since
  the previous Experimental build, and each download's address on `build-<n>` and signature. When
  the build has both the Linux and Windows downloads, `publish` copies its `latest.json` to the
  `experimental` release (never back to an older build). Without the key, the build is still
  published, unsigned and on no channel, and the run's summary says so.
- **Promoting.** Run workflow on `main` with *task* `promote`, the build's number and *beta* or
  *stable*. It checks the build (its `latest.json`, both downloads and their signatures) and
  copies exactly that `latest.json` to the `beta` or `stable` release. Promoting to Stable also
  makes `build-<n>` a full release and the repository's *Latest*, and moves Beta up to it if Beta's
  build is older.
- **Nothing is pruned.** Every `build-<n>` release stays, as do the channel releases: don't delete
  those, every installed copy on that channel reads them.

There are no macOS builds.

Copies installed from builds 0.2.100 to 0.2.119 (made on GitLab) read GitLab's channels, which
offer the last build made there; that build reads GitHub first. Copies from builds below 100 look
for updates at older addresses that offer no current build: install a current build by hand once,
and it updates itself from then on.

## The signing key

Updates are signed: an installed copy installs a download only if its signature matches the public
key it was built with (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, key id
`E8C1BC6BE2D5CFB9`) and names the version on offer. The key pair was made with
`npx tauri signer generate -w ~/.tauri/orbiter.key`. Its private key and password are the secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` of the GitHub environment
`release-signing` (*Settings* → *Environments*), which only `main` may deploy to. Only the `sign`
job is in that environment, so only it is given them; it runs on `main` only, and builds and
installs nothing. GitLab keeps its own copy as CI/CD variables of the same names, with the
environment scope `release-signing`, unused since its runner stopped. The builds themselves
never see the key: Tauri's own updater files (`createUpdaterArtifacts`) stay off, since `tauri build` would need the key to make them, and the
updater takes the AppImage and the setup.exe as they are.

**Back the key up** (`~/.tauri/orbiter.key` and its password, somewhere safe and offline). Losing it
means existing installs can never update again: they accept only downloads signed with it, so
everyone would have to download and install a new build by hand. Should it ever have to change,
make a new pair the same way, put its public key in `tauri.conf.json`, replace both secrets, and say
in the release notes that this one build has to be installed by hand.

## Release notes

`first-public.md` is the description for the first public Stable release: once a build is promoted
to Stable, it goes in that build's `build-<n>` release on GitHub (*Edit release*), above the notes
the workflow wrote.
