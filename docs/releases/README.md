# How builds are made and released

This page is for whoever runs the releases. Players need only `docs/install.md`.

## Making the downloads

`.github/workflows/release.yml` builds them on GitHub. Once a night `.github/workflows/nightly.yml`
starts it on `main` if `main` has moved since the newest build (a night with nothing new builds
nothing), and *Release builds* → *Run workflow* on the *Actions* tab starts one by hand. While the
repository is private the nightly check starts nothing, so only runs started by hand spend Actions
minutes; once it's public, the nightly builds run by themselves.

A run started by hand builds Linux and Windows, with a tick box each for Windows and macOS. A
private repository on GitHub Free gets 2,000 Actions minutes a month; Windows minutes count double
and macOS ten times. A Linux-only build costs about 15 of them, Linux and Windows about 45, and macOS
about 20 more.

A run that has started is never cancelled; a newer one waits behind it (and replaces any run still
waiting). Each run is build *n* (the run number), version `0.2.n`, and puts its downloads on a
pre-release of its own, `build-<n>`. Only a run on `main` publishes; a run started by hand on another
branch builds the same files and leaves them as the run's artifacts for 3 days. Between jobs the
files travel as run artifacts, kept 3 days at most and deleted as soon as they're on the release.

The jobs that build (and so run npm, pnpm and Cargo code) can read the repository and nothing else:
no secret, no write access. Signing and publishing are separate jobs that build and install nothing;
only the publish and prune jobs can write to the repository (the job graph is at the top of
`release.yml`). It builds TennoScope from `tennoscope/` for Linux (on Ubuntu 22.04, so the AppImage
runs on anything from the last few years, SteamOS included) and Windows, puts TennoScope's licence
and a notice beside it, and attaches `orbiter-source.tar.gz`, the complete source of the commit it
built, as the GPL-3.0 asks. Each release also lists the SHA-256 of its files in `SHA256SUMS`, and,
once the repository is public, carries GitHub's attestation of where its files were built.

## Channels

Each installed copy follows one channel: Stable, Beta or Experimental (`docs/install.md`). A build
keeps its version on every channel: moving it up a channel moves the same files, never a rebuild.

- **A build on `main` becomes Experimental.** With the signing key in the secrets, the release
  workflow's sign job signs the final AppImage (after `scripts/repack-appimage.sh`) and the Windows
  installer with `scripts/updater-sign.mjs` (plain Node, no dependencies, signatures of the form
  `tauri signer sign --app-version` writes), and checks each signature against the public key in
  `src-tauri/tauri.conf.json`. The next job writes `latest.json` (`scripts/updater-manifest.mjs`):
  the version, release notes made from the commit subjects since the previous Experimental build,
  and each download's address and signature on the build's own release. When the build has both
  the Linux and Windows downloads, its `latest.json` is copied to the `channel-experimental`
  release, where copies on Experimental look. Without the key, the build still succeeds, unsigned
  and on no channel, and its summary says so.
- **Promoting.** *Actions* → *Promote a build* → *Run workflow*, with the build's number and *beta*
  or *stable*. It checks the build (its release, its `latest.json`, both downloads and their
  signatures) and copies its `latest.json` to `channel-beta` or `channel-stable`. Promoting to Stable
  also makes the build a full release and the repository's *Latest*, and moves Beta up to it if
  Beta's build is older.
- **Older builds go.** After each publish, the release workflow's `prune` job deletes Experimental
  pre-releases beyond the newest 10. It never deletes a build a channel's `latest.json` names, or a
  full release (one promoted to Stable), and it keeps each deleted build's `build-<n>` tag. If a
  channel can't be read, it deletes nothing.
- The `channel-…` releases are pre-releases holding only `latest.json`: don't delete them, every
  installed copy on that channel reads them. While the repository is private, update checks can't
  reach them, and orbiter just says *Couldn't check for updates*.

macOS builds are made only when asked for, and no channel carries them.

## The signing key

Updates are signed: an installed copy installs a download only if its signature matches the public
key it was built with (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, key id
`E8C1BC6BE2D5CFB9`) and names the version on offer. The key pair was made with
`npx tauri signer generate -w ~/.tauri/orbiter.key`. Its private key and password are the secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: secrets of the
`release-signing` environment once the repository is public, repository secrets until then (GitHub
Free has no environments for private repositories; `docs/maintaining.md` says how to move them).
Only `release.yml`'s sign job reads them, in its signing step, and that job runs on `main` only and
builds nothing. The builds themselves never see the key: Tauri's own updater files
(`createUpdaterArtifacts`) stay off, since `tauri build` would need the key to make them, and the
updater takes the AppImage and the setup.exe as they are.

**Back the key up** (`~/.tauri/orbiter.key` and its password, somewhere safe and offline). Losing it
means existing installs can never update again: they accept only downloads signed with it, so
everyone would have to download and install a new build by hand. Should it ever have to change,
make a new pair the same way, put its public key in `tauri.conf.json`, replace both secrets, and say
in the release notes that this one build has to be installed by hand.

## Release notes

`first-public.md` is the description for the first public Stable release (`docs/maintaining.md`,
step 6, says when to paste it).
