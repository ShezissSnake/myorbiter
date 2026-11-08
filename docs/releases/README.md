# How builds are made and released

This page is for whoever runs the releases. Players need only `docs/install.md`.

## Making the downloads

`.gitlab-ci.yml` builds them on gitlab.com. A pipeline runs only when started: *Build* →
*Pipelines* → *New pipeline* (or the pipelines API), or by pushing a tag named `release-<anything>`
on a commit of `main` (`release-*` is a protected tag: only a maintainer can make one, and only a
protected tag's pipeline is given the signing key). A push to a branch and a merge request start
nothing. The *task* field of New pipeline picks what it does: `release` (the default),
`promote` or `pages`; a release or a promotion that gets that far ends by rebuilding the
website. The builder image (`ci/Dockerfile`, which the jobs run in) isn't built by a
pipeline: `ci/build-image.sh` builds it with Docker on the maintainer's computer, pushes it with a
deploy token and prints its digest, once before the first build and again after every change to
the Dockerfile, with a new `BUILDER_TAG` (`docs/maintaining.md`). The digest goes in
`BUILDER_DIGEST`: pipelines on `main` and release tags run in the image by that digest, and until
it's set `sign` refuses, so nothing is published.

Every job, `sign` included, runs on the project's own runner (tag `pc`, with the Docker executor,
so each job runs in a container of its own; never privileged, and protected, so only `main` and
protected tags use it and only they get the signing key), or, with the *runner* field set to
`cloud`, on gitlab.com's hosted Linux runners, which spend the namespace's compute minutes; nothing
on `main` or a release tag needs them, and the project's instance runners stay off. A pipeline on a
branch other than `main` can only run on the hosted runners, in that branch's own builder image
(`ci/build-image.sh <branch>` first, on that branch); such pipelines are optional.

A release pipeline is build *n*, version `0.2.n`, where *n* is the pipeline's number in the project
plus 100 (builds made on GitHub before the move were numbered below 100; pipelines that promote or
publish the site use a number too, so build numbers have gaps). A job that has started is never
cancelled. `test` runs the tests, checks the MSRV and audits both lockfiles; `build` (`ci/build.sh`)
builds TennoScope from `tennoscope/` and MyOrbiter for Linux (the AppImage and the .deb, on Ubuntu
22.04: they need nothing newer than glibc 2.35, which `ci/build.sh` checks, and TennoScope uses the
system's PipeWire, 0.3.48 or newer: the AppImage runs on SteamOS and any x86-64 Linux with those
(Ubuntu 22.04, Debian 12 and later), the .deb on Debian and Ubuntu from those releases on, not on
SteamOS) and, with the *windows* box ticked, the Windows installer, cross-compiled with cargo-xwin
in the same job. Only a pipeline on `main` or a release tag goes further; on any other branch the
downloads stay as the build job's artifacts for 3 days. Between jobs the files travel as job
artifacts, kept 3 days.

The jobs that build (and so run npm, pnpm and Cargo code) never see the signing key. Unlike on
GitHub, they can write the package registry and the releases: GitLab gives every job a token with
the same reach. What keeps installed copies safe is the signature each one checks. `publish`
(`ci/publish.sh`) adds `myorbiter-source.tar.gz`, the complete source of the commit it built, as the
GPL-3.0 asks, and `SHA256SUMS`, and puts every file in the project's generic package registry as
`myorbiter/0.2.n/<file>`; `release` makes the release `build-<n>` at that commit, linking to them.
TennoScope's licence and a notice travel beside it.

## Channels

Each installed copy follows one channel: Stable, Beta or Experimental (`docs/install.md`). A build
keeps its version on every channel: moving it up a channel moves the same files, never a rebuild.
Each channel is one file in the package registry, `channel/<stable|beta|experimental>/latest.json`,
at the address installed copies check
(`https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/<channel>/latest.json`,
`src-tauri/src/updates.rs`).

- **A build on `main` becomes Experimental.** With the signing key available, the `sign` job signs
  the final AppImage (after `scripts/repack-appimage.sh`) and the Windows installer with
  `scripts/updater-sign.mjs` (plain Node, no dependencies, signatures of the form
  `tauri signer sign --app-version` writes), and checks each signature against the public key in
  `src-tauri/tauri.conf.json`. It has no checkout on the runner's shared build volume: it clones
  the commit into its own container (no hooks, no git config from elsewhere), takes the signer and
  the public key from that clone and runs the signer only if it matches `SIGNER_SHA256` in
  `.gitlab-ci.yml` (`tests/ciSigner.test.ts` says when a change to the signer needs a new one).
  From the volume it takes only `release-files/`, refusing any link there, and signs only the
  files this build makes. `publish` writes
  `latest.json` (`scripts/updater-manifest.mjs`):
  the version, release notes made from the commit subjects since the previous Experimental build,
  and each download's address in the registry and signature. When the build has both the Linux and
  Windows downloads, `experimental` copies its `latest.json` to `channel/experimental/`. Without
  the key, the build is still published, unsigned and on no channel, and the job log says so.
- **Promoting.** New pipeline on `main` with *task* `promote`, the build's number and *beta* or
  *stable*. It checks the build (its `latest.json`, both downloads and their signatures) and
  copies exactly that `latest.json` to `channel/beta/` or `channel/stable/`. Promoting to Stable
  also records the build in `stable-builds/`, so it's never pruned, and moves Beta up to it if
  Beta's build is older.
- **Older builds go.** After each publish, `prune` deletes the registry's Experimental builds
  beyond the newest 10 (not counting the ones a channel keeps) and their `build-<n>` releases. It never deletes a build a channel's
  `latest.json` names or one ever promoted to Stable, and it keeps each deleted build's tag. If a
  channel can't be read, it deletes nothing.
- The `channel/…` and `stable-builds/…` packages hold only `latest.json` files: don't delete them,
  every installed copy on that channel reads them. While the project is private, update checks
  can't reach them, and MyOrbiter says so under Check now (*gitlab.com didn't serve the Stable
  channel's manifest*).

There are no macOS builds on GitLab.

Copies installed from builds made on GitHub (below 100) look for updates at the old GitHub
addresses, which no longer answer: install a GitLab build by hand once, and it updates itself
from then on.

## The signing key

Updates are signed: an installed copy installs a download only if its signature matches the public
key it was built with (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, key id
`E8C1BC6BE2D5CFB9`) and names the version on offer. The key pair was made with
`npx tauri signer generate -w ~/.tauri/orbiter.key`. Its private key and password are the CI/CD
variables `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (*Settings* → *CI/CD* →
*Variables*): type Variable, protected, masked and hidden, with the environment scope
`release-signing`. Only the `sign` job is in that environment, so only it is given them; it runs on
`main` or a protected release tag only, and builds and installs nothing. The builds themselves
never see the key: Tauri's own updater files (`createUpdaterArtifacts`) stay off, since `tauri build` would need the key to make them, and the
updater takes the AppImage and the setup.exe as they are.

**Back the key up** (`~/.tauri/orbiter.key` and its password, somewhere safe and offline). Losing it
means existing installs can never update again: they accept only downloads signed with it, so
everyone would have to download and install a new build by hand. Should it ever have to change,
make a new pair the same way, put its public key in `tauri.conf.json`, replace both variables, and say
in the release notes that this one build has to be installed by hand.

## Release notes

`first-public.md` is the description for the first public Stable release (`docs/maintaining.md`,
step 5, says when to paste it).
