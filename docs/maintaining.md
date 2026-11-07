# Maintaining the public repository

GitLab settings that can't live in the repository: set them by hand once, before
`sheziss-group/orbiter` goes public, and check them again after any change to the project's or
the group's settings. Each line says where it is. Everything here works on GitLab Free.

## Going public, step by step

Every step in order, from a private project to the first public Stable installed by hand. Every
step needs the Owner or Maintainer role; the ones marked **(maintainer)** are the maintainer's own
clicks (the visibility switch, the signing key, the runner, the promotions). Each step links to
its details further down; tick it here when it's done. The commands work in fish and in bash,
from a clone whose `origin` is `gitlab.com/sheziss-group/orbiter`.

**1. Before the switch** (the project is still private)

- [ ] **The signing key is backed up offline (maintainer).** `~/.tauri/orbiter.key` and its
      password are kept somewhere off this computer; `docs/releases/README.md`, *The signing key*,
      says why.
- [ ] **Every merge request meant for the first public build is merged**, and the branches that
      only held finished work are deleted, so only `main` and the branches of open merge requests
      go public: *Code* → *Branches* → the bin icon on each merged branch. Or, from a terminal,
      once per such branch (here one named `work/example`):

      ```fish
      git push origin --delete work/example
      ```

      Then `git ls-remote --heads origin` lists `main` and open merge requests' branches only.
- [ ] **The settings below are in place:** *Protected branches and tags*, *CI/CD*, *The signing
      key*, *The runner*, *Packages*, *Issues*, *Features not in use*.
- [ ] **The history is read once more** for anything personal or secret (real names, home paths,
      trade records, other players' names, tokens). Making a project public publishes every
      commit, every tag and every branch, not only `main`.
- [ ] **No tag points at a commit it shouldn't:** the `build-<n>` tags from GitHub (below 100) name
      the commits those builds came from; GitLab's builds start at 100.

      ```fish
      git ls-remote --tags origin
      ```

- [ ] **Everything passes on `main`:**

      ```fish
      git switch main
      git pull
      npm ci
      npm test
      npm run check -- --threshold error
      cargo test --manifest-path src-tauri/Cargo.toml
      ```

      The tests on the real catalogue (`public/dev-*.json`) skip without those files. On a computer
      with a TennoScope folder, run `npm run dev-bundle` and `npm run dev-data` before `npm test` so
      they run too; they must pass there as well. Elsewhere skip both: `dev-bundle` needs that
      folder.
- [ ] **The builder image exists:** *Build* → *Pipelines* → **New pipeline** → branch `main`,
      *task* `image` → **New pipeline**. Its log ends with the image's digest; pin
      `BUILDER_IMAGE` in `.gitlab-ci.yml` to it through a merge request.
- [ ] **A first build on `main`:** New pipeline → branch `main`, *task* `release`, *windows*
      ticked. While the project is private the build signs and publishes as usual; installed
      copies just can't reach it yet.

**2. Make it public (maintainer)**

- [ ] The group first: the group's *Settings* → *General* → *Naming, visibility* → **Public** →
      Save. (A project can't be more visible than its group.)
- [ ] Then the project: *Settings* → *General* → *Visibility, project features, permissions* →
      *Project visibility* **Public** → **Save changes**.
- [ ] Anonymous reads work: each prints the channel's manifest, not an error.

      ```fish
      curl -fsS 'https://gitlab.com/api/v4/projects/sheziss-group%2Forbiter/packages/generic/channel/experimental/latest.json'
      node scripts/issues-digest.mjs --fetch
      ```

**3. The website (maintainer):** *Deploy* → *Pages*: untick **Use unique domain** (so the site is
`https://sheziss-group.gitlab.io/orbiter/`, as the README links), Save. Then New pipeline →
branch `main`, *task* `pages`. With no Stable build yet its download buttons point at
*Releases*; step 5 runs it again.

**4. A first public build**

- [ ] New pipeline → branch `main`, *task* `release`, *windows* ticked → **New pipeline**. Note
      the build number: the `build` job's log says "Build *n*, version 0.2.*n*".
- [ ] Every job is green; the `sign` log has no "No updater files" line.
- [ ] Release `build-<n>` (*Deploy* → *Releases*) links to the AppImage, the .deb, the setup.exe,
      both `.sig` files, `latest.json`, `SHA256SUMS` and `orbiter-source.tar.gz`, and
      `channel/experimental/latest.json` names 0.2.*n*:

      ```fish
      curl -fsS 'https://gitlab.com/api/v4/projects/sheziss-group%2Forbiter/packages/generic/channel/experimental/latest.json'
      ```

**5. Promote it to Stable (maintainer)**

- [ ] Install it from Experimental on Linux and on Windows, and use it for a while: start, sync,
      a page of each section, Settings → Updates → *Check now*.
- [ ] New pipeline → branch `main`, *task* `promote`, *build* *n*, *channel* **beta**; when it's
      green, the same with **stable**. (Stable alone also moves Beta up.)
- [ ] `channel/stable/latest.json` and `channel/beta/latest.json` name 0.2.*n*.
- [ ] Release notes: in `docs/releases/first-public.md`, put the version (0.2.*n*) in place of
      each `<0.2.N>`, through a merge request like any change, then open release `build-<n>` →
      **Edit this release** → replace its description with that file's text → **Save changes**.
      (The update screen's notes come from `latest.json`, not from this description, so they
      don't change.)
- [ ] New pipeline → branch `main`, *task* `pages`, so the download buttons point at this build.

**6. The first manual install**, as a new player would do it

- [ ] On a computer without orbiter, open the website's *Download*, take the AppImage (or
      setup.exe) and `SHA256SUMS`, and check it (README, *Checking a download*).
- [ ] Install and start it: the first-start walk-through appears, Full mode is off, and Settings →
      Updates says Stable and the version 0.2.*n*.
- [ ] *Check now* says it's up to date. When the next build reaches Stable, that copy offers it and
      updates with one click.

## Protected branches and tags

- [ ] **`main`:** *Settings* → *Repository* → *Protected branches*: `main`, allowed to merge and to
      push: Maintainers; *Allowed to force push* off.
- [ ] **Release tags:** *Settings* → *Repository* → *Protected tags* → `release-*`, allowed to
      create: Maintainers. Only a protected tag's pipeline gets the signing key, and a tag
      pipeline builds whatever commit the tag names (the pipeline stops if it isn't on `main`).
- [ ] **Build tags:** the same for `build-*`, so a published build's tag can't be moved by
      someone else (the release job makes them, with the role of whoever started the pipeline).

## CI/CD

*Settings* → *CI/CD*:

- [ ] **Variables** → *Minimum role to use pipeline variables*: **No one allowed**. The pipeline's
      inputs (task, build, channel, windows, runner) are all it takes; a variable set by hand could
      otherwise change what a job runs. Never set `CI_DEBUG_TRACE`.
- [ ] **General pipelines** → untick **Public pipelines** (the jobs' logs and artifacts stay
      members-only; the releases and their files are public anyway). **Auto-cancel redundant
      pipelines** off.
- [ ] **Job token permissions** → *Limit access to this project* on, with nothing in the allowlist.
- [ ] **Auto DevOps** off.
- [ ] Never add a pipeline that runs for merge requests from forks with the project's variables,
      or one triggered by issues, comments or webhooks.

What GitLab can't narrow: every job's `CI_JOB_TOKEN` can write this project's packages and
releases with the role of whoever started the pipeline, the jobs that run build code included.
The signing key is what protects installed copies (`.gitlab-ci.yml`, at the top).

## The signing key

The updater's signing key and its password are read by one job only: `sign` in `.gitlab-ci.yml`,
which builds and installs nothing. Every step here is the maintainer's own (the key and its
password are only on the maintainer's side):

- [ ] **The environment:** *Operate* → *Environments* → **Create an environment** named exactly
      `release-signing`. (The first release pipeline may have made it already: then it's there.)
- [ ] **The two variables:** *Settings* → *CI/CD* → *Variables* → **Add variable**, twice:
      `TAURI_SIGNING_PRIVATE_KEY` (the whole text of `~/.tauri/orbiter.key`, from the offline
      backup) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Each: type **Variable** (not File),
      environment scope **release-signing**, **Protect variable** ticked (`main` and protected
      tags only), visibility **Masked and hidden**, **Expand variable reference** unticked.
- [ ] **Check it:** the next release pipeline's `sign` job has no "No updater files" line, and the
      release carries the `.sig` files and `latest.json`.

GitLab Free has no approval step for an environment (protected environments are a paid feature):
a pipeline on `main` or a protected tag signs as soon as `sign` runs.

## The runner

The `pc` jobs run on the project's own runner (*Settings* → *CI/CD* → *Runners* → **New project
runner**, tag `pc`, *Run untagged jobs* off):

- [ ] **The Docker executor**, never the shell executor: each job then runs in its own container,
      which is what keeps the signing key away from the jobs that build.
- [ ] `privileged = false`. The `image` task needs Buildah's user namespace, which Docker's default
      seccomp profile refuses: run that task with *runner* `cloud` (gitlab.com's hosted runners
      allow it), or give the runner a second, separate entry for it.
- [ ] Branch pipelines run that branch's code on this computer, as any build of it there would.

## Packages

- [ ] **Duplicates allowed for generic packages:** the group's *Settings* → *Packages and
      registries* → *Duplicate packages* → Generic: **Allow duplicates** on (the default). Each
      channel's `latest.json` is replaced by uploading it again.
- [ ] Never delete the `channel` and `stable-builds` packages: every installed copy reads them.

## Issues

- [ ] **The labels** `bug` and `needs-triage` exist (*Manage* → *Labels*).
- [ ] **Confidential issues** stay available (they're how `SECURITY.md` asks for private reports);
      only members can read one.
- [ ] *Service Desk* off unless it will be read.

## Features not in use

*Settings* → *General* → *Visibility, project features, permissions*: untick **Wiki**,
**Snippets**, **Requirements**, **Model experiments**, **Monitor** and any other feature not in
use. Keep **Issues**, **Repository**, **Merge requests**, **CI/CD**, **Container registry**,
**Package registry**, **Releases**, **Environments** and **Pages**.

## AI and automation

- [ ] **Never install an AI bot or integration that acts on public comments** (answers, labels,
      opens merge requests or runs anything because someone wrote an issue or comment). Anyone can write
      one, and its text would become that bot's instructions.
- [ ] Read issues in a Claude session through `scripts/issues-digest.mjs` (see `CLAUDE.md`), never
      by pasting them raw.
- [ ] Issues from the app's Report a bug come in with the `bug` and `needs-triage` labels (where
      GitLab lets the reporter set them); nothing acts on them by itself. Keep it that way: no
      pipeline, webhook or integration should trigger on issues, comments or those labels.
