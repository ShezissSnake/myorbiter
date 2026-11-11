# Maintaining the public repository

MyOrbiter's home is GitHub: `github.com/ShezissSnake/myorbiter` holds the code, the issues, the
releases and, on GitHub Pages, the website (`https://shezisssnake.github.io/myorbiter/`). Builds run
on GitHub Actions' hosted runners (`.github/workflows/release.yml`). `gitlab.com/sheziss-group/myorbiter`
is frozen after the bridge build, not mirrored: it keeps the releases GitLab made (builds 0.2.100 to
the bridge build) and the channel manifests installed copies read before the move back, builds
nothing any more, and gets no more pushes.

This page is what can't live in the repository: settings made by hand once, and checked again
after any change to the repository's settings, and how to run a release, a promotion or the
website. Each line says where it is. The ones marked **(maintainer)** are the maintainer's own
clicks, signed in as `ShezissSnake`. The commands work in fish and in bash.

## The move back to GitHub, step by step

Once, in order. Tick each step here when it's done.

- [ ] **The merge request that moves the home back is merged on GitLab** (its merge commit is the
      bridge build's commit), and GitLab's pipeline has built it: New pipeline → branch `main`,
      *task* `release`, *windows* ticked. That build is the **bridge build**: the last one GitLab
      makes. Note its number (the `build` job's log says "Build *n*, version 0.2.*n*"); it must be
      below 120 (*Build numbers*, below). The pipeline's last job, `pages`, fails, as it does in
      the promote pipelines below: from this commit on, the site build reads GitHub's channels,
      which have no build yet. Everything before it has run; GitLab's site stays as it was until
      the redirect replaces it.
- [ ] **Promote the bridge build on GitLab** to Beta and Stable as wanted (*task* `promote`), so
      every GitLab channel names a build that checks GitHub first. After that, no release or
      promote runs on GitLab ever again: its channel manifests stay on the bridge build for good,
      for installs that haven't updated yet.
- [ ] **GitLab builds nothing more:** merge the second merge request ("GitLab: redirect pages, no
      more builds"), which reduces `.gitlab-ci.yml` to a Pages job that redirects the old site to
      GitHub Pages; run its `pages` pipeline once. The project's runner (tag `pc`) can then be
      stopped.
- [ ] **(maintainer) Push `main` to GitHub**, from a clone whose remote for GitHub is
      `git@github.com:ShezissSnake/myorbiter.git` (a plain push: GitHub's `main` is an ancestor
      of GitLab's, so it fast-forwards; never a force push):

      ```fish
      git push <GitHub remote> main
      ```

- [ ] **The settings below are in place:** *Actions*, *The signing key's environment*, *Branches
      and tags*, *Pages*, *Code security*, *Features not in use*.
- [ ] **(maintainer) The first GitHub release:** Actions → *Release* → **Run workflow** → *Use
      workflow from* `main`, *task* `release`, *windows* ticked → **Run workflow**. The *Test*
      job's summary says "Build 120, version 0.2.120" (*Build numbers*, below). If approval is on,
      approve *Sign the updater downloads* (Review deployments).
- [ ] **The run is green,** *Sign the updater downloads* has no "No updater files" line, and:
      - release `build-120` carries the AppImage, the .deb, the setup.exe, both `.sig` files,
        `latest.json`, `SHA256SUMS` and `myorbiter-source.tar.gz`;
      - the `experimental` release holds `latest.json`, naming 0.2.120 and the files on
        `build-120`:

        ```fish
        curl -fsSL https://github.com/ShezissSnake/myorbiter/releases/download/experimental/latest.json
        ```

      - its last jobs built the website and published it on Pages.
- [ ] **(maintainer) The website by hand once more:** Run workflow, *task* `pages`. When it's green,
      `https://shezisssnake.github.io/myorbiter/` offers 0.2.120 (until a Stable build exists, the
      buttons offer the best channel that has one), and the old address on GitLab Pages redirects
      there.
- [ ] **A copy of the bridge build on Experimental updates to 0.2.120** with *Update and restart*,
      on Linux and on Windows: its first address is GitHub's `experimental` release.
- [ ] **(maintainer) GitLab is left as it is** (*GitLab, frozen*, below): no mirror, no more pushes.

## Running a release, a promotion or the website

Everything runs by hand from the Actions tab: Actions → *Release* → **Run workflow**. *Use workflow
from* is the branch the run works on: `main` for anything published. The form's inputs:

- *task* **release** (the default) builds Linux (AppImage and .deb) and, with *windows* ticked,
  the Windows installer, as build *n* (*Build numbers*). On `main` it then signs, publishes the
  pre-release `build-<n>`, puts the build on Experimental when it has both systems and is signed
  (never moving the channel back to an older build), and rebuilds the website. On any other branch
  it stops after the builds: the downloads are the run's artifacts, for 3 days. With
  *experimental* unticked it signs and publishes `build-<n>` from whatever branch the run is on
  and leaves Experimental as it is (and, off `main`, doesn't rebuild the website): the build
  reaches Beta or Stable only by a promote run (*A fix for Beta*, below).
- *task* **promote**, with *build* (the *n* of `build-<n>`) and *channel* **beta** or **stable**,
  moves that build up: its `latest.json` is checked (version, both systems, every download on its
  own release, every signature against the public key in `tauri.conf.json`) and copied to the
  channel's release. Nothing is rebuilt. Stable also makes `build-<n>` a full release, the
  repository's *Latest*, and moves Beta up to it when Beta's build is older. The website is rebuilt
  after.
- *task* **pages** rebuilds the website alone: when a release or promotion stopped before its
  *Build and check the site* job, or that job failed.

*build* and *channel* are read only by promote; *windows* and *experimental* only by release.
Leave *experimental* ticked (the default) for every release except a fix for Beta.

Each channel is a release named after it (`stable`, `beta`, `experimental`), holding only that
channel's `latest.json`; the builds' files stay on their own `build-<n>` releases, which the
manifest names. Installed copies read `https://github.com/ShezissSnake/myorbiter/releases/download/<channel>/latest.json`
first and GitLab's `channel/<channel>/latest.json` second (`src-tauri/src/updates.rs`).

The jobs that move a channel and the site build share the concurrency group `channels`: one runs,
one waits, and GitHub cancels a waiting job when a third arrives. Start one task at a time; a job
that ends as cancelled is run again with **Re-run failed jobs**.

Nothing deletes a release, a tag or a branch. GitHub keeps a public repository's releases without a
storage quota, so the Experimental builds GitLab pruned (to stay within its 10 GiB) all stay.

## A fix for Beta while `main` carries other work

When `main` holds work that must not reach Beta yet (the TennoScope absorb), a fix reaches Beta
from a branch cut at Beta's build, without becoming Experimental's build:

1. **Find Beta's commit:** the `commit` field of
   `https://github.com/ShezissSnake/myorbiter/releases/download/beta/latest.json` (or the commit
   its `build-<n>` release was made at).
2. **(maintainer) Make the branch** `beta-fix/<name>` at that commit and push it to `origin`.
   A run reads the workflow from the branch it runs on: if that commit predates the *experimental*
   input, cherry-pick the commit that added it to `.github/workflows/release.yml` first, or the
   run never signs. Sessions push only `work/*` branches, so a fix prepared in a session goes into
   `beta-fix/<name>` by a pull request into that branch.
3. **The fix** on `beta-fix/<name>`, tested as for `main` (`npm test`, `npm run check -- --threshold
   error`, `cargo test` in `src-tauri/`). A fix that `main` needs too goes into `main` by its own
   pull request.
4. **Release run:** Run workflow, *Use workflow from* `beta-fix/<name>`, *task* `release`,
   *windows* ticked, ***experimental* unticked**. *Sign the updater downloads* fails unless
   `release-signing` allows the branch (*The signing key's environment*, below). It publishes the
   signed `build-<n>`, with release notes from the commits since Beta's build (the last 15
   subjects if Beta has no `latest.json` yet); Experimental and the website stay as they are.
5. **Promote run on `main`:** *task* `promote`, *build* that *n*, *channel* `beta`. The fix's
   number is higher than every earlier build, so Beta copies see it as an update and Experimental
   copies never see it.
6. **A release run on `main` straight away** (*experimental* ticked). Until Experimental holds a
   build numbered above the fix, a copy on Experimental that switches to Beta is offered the fix,
   which lacks what `main` carries, as a newer version. This run may also go before step 5, once
   step 4's run has started (so its number is higher): then that moment never comes.

**The updater key must not change until the absorb has reached Beta.** The promote run checks the
fix's signatures against the public key in `main`'s `tauri.conf.json`, while the fix is signed and
checked against its own branch's copy, and copies on Beta trust only the key they were built with.

## Build numbers

Build *n* is the Release workflow's run number plus `BUILD_OFFSET` (in
`.github/workflows/release.yml`), and its version is 0.2.*n*. The run number only grows, but every
run counts (promote and pages runs too, and runs that failed or were cancelled), so build numbers
have gaps. Promote and pages runs publish no build of their own.

`BUILD_OFFSET` is **26**. The rule: the first GitHub build is 0.2.120, so
`BUILD_OFFSET = 120 − (the workflow's last run number + 1)`. On 2026-11-09 the last run of
`release.yml` was #93 (`api.github.com/repos/ShezissSnake/myorbiter/actions/workflows/release.yml/runs?per_page=1`,
its `run_number`), so the next is #94 and 94 + 26 = 120. Every build is above every earlier one:
the GitHub builds before the move were 0.2.1 to 0.2.99, GitLab's are 0.2.100 to the bridge build
(GitLab's pipeline number plus 100: 0.2.110 by then), and GitHub's start at 0.2.120.

Check it again just before the first GitHub release: the bridge build must be below 120, and the
workflow's runs must still stand at #93 (no run of `release.yml` since). If either has moved,
change `BUILD_OFFSET` so the first build is still above the bridge build, through a merge request,
before running it. Never lower it afterwards: a version made twice, or one lower than an installed
build, is never offered.

## Actions

- [ ] **Fork pull requests wait for approval:** Settings → Actions → General → "Approval for running
      fork pull request workflows from contributors" → **Require approval for all outside
      collaborators**. (Nothing here runs for pull requests anyway.)
- [ ] **Read-only token by default:** Settings → Actions → General → Workflow permissions → **Read
      repository contents and packages permissions**. Each job asks for more itself.
- [ ] Same place: leave **Allow GitHub Actions to create and approve pull requests** unticked.
- [ ] **Pinned actions only:** Settings → Actions → General → Actions permissions → tick **Require
      actions to be pinned to a full-length commit SHA** (the workflow pins every one).
- [ ] **No other workflow runs:** the Actions tab lists *Release* alone. The workflows of the old
      `main` (nightly build, weekly audit and MSRV, website, promote, Dependabot) are gone with it;
      if one is still listed, open it → **⋯** → **Disable workflow**. No schedules: each release's
      *Test* job audits both lockfiles and checks the MSRV.
- [ ] Never add a workflow triggered by `push`, `schedule`, `pull_request_target`, `issue_comment`,
      `issues` or `workflow_run`, and never give a job that runs for one of them the release secrets.

## The signing key's environment

The updater's signing key and its password are read by one job only: *Sign the updater downloads*
in `release.yml`, on `main` (or on a fix branch with *experimental* unticked), which builds and
installs nothing. They are the `release-signing`
environment's two secrets, `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
set up before the move to GitLab; the names are the ones the workflow reads. Every step is the
maintainer's own:

- [ ] **The environment is there:** Settings → Environments → `release-signing`, with both secrets
      under *Environment secrets*, and Settings → Secrets and variables → Actions → *Repository
      secrets* lists neither (a repository copy would reach every job).
- [ ] **Main only:** in the environment, Deployment branches and tags → **Selected branches and
      tags** → the rule `main`. For a fix for Beta (above), add the branch rule `beta-fix/*`;
      without it a release run on such a branch fails at *Sign the updater downloads*. Any code
      on a branch the rule allows can be signed, so add it only while a fix is under way and
      remove it after, or protect `beta-fix/*` as `main` is (*Branches and tags*).
- [ ] **Optionally, approval:** **Required reviewers** → the maintainer. Every release then stops
      at *Sign the updater downloads* until approved on the run's page (Review deployments), within
      3 days while the build artifacts exist. Leave "Prevent self-review" off.
- [ ] **The key is the one installed copies trust:** `src-tauri/tauri.conf.json`'s public key (id
      `E8C1BC6BE2D5CFB9`), the same as GitLab's variables held. Without the secrets a build is
      published unsigned and no channel offers it; the run's summary says so.

## Branches and tags

- [ ] **A ruleset for `main`:** Settings → Rules → Rulesets → New branch ruleset, target the default
      branch: **Restrict deletions** and **Block force pushes** on. Optionally **Require a pull
      request before merging** with **Require review from Code Owners** (`.github/CODEOWNERS`).
- [ ] **A ruleset for builds and channels:** a tag ruleset for `build-*`, `stable`, `beta` and
      `experimental` with **Restrict updates** and **Restrict deletions**, bypassed only by the
      maintainer, so a published build or a channel can't be moved or removed. (A channel's release
      changes by its `latest.json` asset, never by its tag.)

## Pages

- [ ] Settings → Pages → *Build and deployment* → *Source*: **GitHub Actions**.
- [ ] Settings → Environments → `github-pages` → Deployment branches and tags: `main` only.

## Code security

- [ ] **Private vulnerability reporting:** Settings → Code security → Private vulnerability
      reporting → Enable. `SECURITY.md` and the issue form's "Report a security problem" link point
      at it.
- [ ] **Secret scanning and push protection:** Settings → Code security → Secret scanning →
      Enable, and Push protection → Enable.
- [ ] **Dependabot alerts:** Enable. Dependabot version updates aren't set up (no
      `.github/dependabot.yml`): dependency updates are a manual monthly change, and `renovate.json`
      stays as written intent.
- [ ] **Commit e-mail stays private (maintainer):** account Settings → Emails → **Keep my email
      addresses private** and **Block command line pushes that expose my email**.

## Features not in use

- [ ] **Wiki:** untick (the README and `docs/` are the docs). **Discussions:** off unless read.
      **Projects:** off if unused.
- [ ] **Issues** on, with the labels `bug` and `needs-triage` (Issues → Labels). Issues come through
      the bug report form (`.github/ISSUE_TEMPLATE/`); blank issues are off.

## GitLab, frozen

- [ ] **Nothing is kept in step (maintainer):** once the bridge build is out and `main` is on
      GitHub, GitLab gets nothing more: no push mirror in either direction, and no clone pushes to
      both. Its `main` stays at the bridge build's commit. Branches, pull requests, issues and
      releases are on GitHub (CLAUDE.md); no workflow here holds a GitLab token or pushes anywhere.
- [ ] **Its channel manifests stay on the bridge build:** `channel/<channel>/latest.json` in
      GitLab's package registry, every installed copy's second address. Never delete the
      `channel` or `stable-builds` packages, the builds 0.2.100 and up, or the releases that link
      them; never run a release or promote pipeline there again (after the second merge request,
      `.gitlab-ci.yml` has none).
- [ ] **Its Pages** publish only a page that redirects to `https://shezisssnake.github.io/myorbiter/`.
- [ ] **Its issues:** MyOrbiter's Report a bug opens GitHub's issue form; the issues made on GitLab
      before stay readable there, with `scripts/issues-digest.mjs` (`--fetch --from=gitlab`).
- [ ] **Its runner:** stopped once the bridge build is out; nothing on GitLab needs it.

The GitHub releases from before the move (`build-18`, `build-30`, `channel-experimental`) stay as
they are: builds from before 0.2.100 read `channel-<channel>` there.

## Screenshots

The pictures in `docs/screenshots/` (the README and the docs, 1440×900 at twice those pixels) and
`site/shots/` (the site's tour: 1280×800 on the page, and twice those pixels in `site/shots/large/`
for its viewer) show the invented account in `demo/`, never `public/dev-*.json`.
`scripts/screenshots.mjs` takes them all again, or one set with `--only docs` or `--only site`:

```fish
npm run screenshots
npm run screenshots -- --only site
```

Playwright is one of the project's development dependencies, but `npm install` downloads no
browser: the script's first step does (`playwright install chromium`, into Playwright's own cache
folder, once). Then it starts the demo dev server (`npm run dev:demo`'s, on port 1431 so a running
one on 1421 isn't in the way; `npm run screenshots -- --port <n>` picks another), stops if anything
else answers on that port or the server isn't the demo one, opens each page in Chromium, and
writes the WebP files over the ones in the repository. It needs ImageMagick (`magick`) too. The
demo's order books and price histories are files in `demo/`; the worldstate (fissures, Baro, the
clocks) is read live, so Home and Current fissure change from one run to the next
(`demo/README.md`). Nothing but GET requests would reach warframe.market. In a clone whose
`node_modules` is a link to another folder, Vite refuses to serve the fonts and the pictures come
out in fallback fonts: run it where `node_modules` is a real folder.

## AI and automation

- [ ] **Never install an AI bot, GitHub App or integration that acts on public comments** (answers,
      labels, opens pull requests or runs anything because someone wrote an issue or comment). Anyone can
      write one, and its text would become that bot's instructions.
- [ ] Read issues in a Claude session through `scripts/issues-digest.mjs` (see `CLAUDE.md`), never
      by pasting them raw.
- [ ] Issues from the bug report form and the app's Report a bug come in with the `bug` and
      `needs-triage` labels; nothing acts on them by itself. Keep it that way: no workflow, webhook
      or integration should trigger on issues, comments or those labels.
