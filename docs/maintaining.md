# Maintaining the public repository

GitLab settings that can't live in the repository: set them by hand once, before
`sheziss-group/myorbiter` goes public, and check them again after any change to the project's or
the group's settings. Each line says where it is. Everything here works on GitLab Free.

## Going public, step by step

Every step in order, from a private project to the first public Stable installed by hand. Every step
needs the Maintainer role, and the group's settings (its visibility, its package settings) need the
group's Owner role; the ones marked **(maintainer)** are the maintainer's own clicks (the visibility
switch, the signing key, the runner, the promotions). Each step links to its details further down;
tick it here when it's done. The commands work in fish and in bash, from a clone whose `origin` is
`gitlab.com/sheziss-group/myorbiter`.

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
- [ ] **The account shows only the pseudonym (maintainer):** *User settings* → *Profile*: *Full
      name* Sheziss, *Public email* "Do not show on profile", *Commit email* the private
      `…@users.noreply.gitlab.com` address (the address of merges and edits made on the website);
      *Private profile* optional. GitLab Free doesn't check the author address of pushed commits,
      so a clone's `git config user.email` must already be a noreply address.
- [ ] **The settings below are in place:** *Protected branches and tags*, *CI/CD*, *The signing
      key*, *The runner*, *Packages*, *Issues*, *Features not in use*, *Dependency updates*.
- [ ] **The history is read once more** for anything personal or secret (real names, home paths,
      trade records, other players' names, tokens). Making a project public publishes every
      commit, every tag and every branch, not only `main`. GitLab Free has no secret push
      protection (GitHub refused a push with a known token; GitLab's is Ultimate-only), so scan the
      whole history for tokens once too, with a secret scanner such as gitleaks run from its
      container image on the clone, and act only on what it finds after reading each hit.
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
- [ ] **A deploy token for the builder image:** *Settings* → *Repository* → *Deploy tokens* →
      **Add token**, scopes `read_registry` and `write_registry` only (a push reads the registry
      too), with an expiry date. The token is kept outside the project: nothing in it holds it.
- [ ] **The builder image exists:** on this computer, with Docker, in a checkout of `main` that
      matches GitLab's (the script refuses one that doesn't, or with `ci/` or `.gitlab-ci.yml`
      not committed):

      ```fish
      env DEPLOY_TOKEN_USER=<the deploy token's user name> ci/build-image.sh
      ```

      It asks for the token, builds `ci/Dockerfile`, pushes `builder:<BUILDER_TAG>` and
      `builder:<BUILDER_TAG>.<UTC time>` (a tag no other push writes) and prints the digest: put
      it in `.gitlab-ci.yml` as `BUILDER_DIGEST` through a merge request. Docker keeps the sign-in
      in a folder made for the run and removed after. Never delete a `<BUILDER_TAG>.<UTC time>`
      tag (the cleanup policy under *Packages* keeps them). Until then, pipelines on `main` run in
      the image's tag and `sign` refuses, so nothing is published. After a change to
      `ci/Dockerfile`: a new `BUILDER_TAG`, merged, then the script once more and the new digest.
      `ci/build-image.sh <branch>`, in a checkout of that branch, pushes
      `builder:<BUILDER_TAG>-<branch slug>` for its own pipelines instead.
- [ ] **A first build on `main`:** New pipeline → branch `main`, *task* `release`, *windows*
      ticked. While the project is private the build signs and publishes as usual; installed
      copies just can't reach it yet.
- [ ] **Releases holds only GitLab builds:** *Deploy* → *Releases* lists `build-<n>` releases from
      100 up and nothing brought over from GitHub (whose files are gone).

**2. Make it public (maintainer)**

- [ ] The group first: the group's *Settings* → *General* → *Naming, visibility* → **Public** →
      Save. (A project can't be more visible than its group.)
- [ ] Then the project: *Settings* → *General* → *Visibility, project features, permissions* →
      *Project visibility* **Public** → **Save changes**.
- [ ] Anonymous reads work: each prints the channel's manifest, not an error.

      ```fish
      curl -fsS 'https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/experimental/latest.json'
      node scripts/issues-digest.mjs --fetch
      ```

**3. The website (maintainer):** New pipeline → branch `main`, *task* `pages`. Then *Deploy* →
*Pages* (the setting may only appear after that first deployment): untick **Use unique domain**
(so the site is `https://sheziss-group.gitlab.io/myorbiter/`, as the README links), Save. With no
Stable build yet its download buttons point at *Releases*; step 5 runs it again.

**4. A first public build**

- [ ] New pipeline → branch `main`, *task* `release`, *windows* ticked → **New pipeline**. Note
      the build number: the `build` job's log says "Build *n*, version 0.2.*n*".
- [ ] Every job is green; the `sign` log has no "No updater files" line.
- [ ] Release `build-<n>` (*Deploy* → *Releases*) links to the AppImage, the .deb, the setup.exe,
      both `.sig` files, `latest.json`, `SHA256SUMS` and `myorbiter-source.tar.gz`, and
      `channel/experimental/latest.json` names 0.2.*n*:

      ```fish
      curl -fsS 'https://gitlab.com/api/v4/projects/sheziss-group%2Fmyorbiter/packages/generic/channel/experimental/latest.json'
      ```

**5. Promote it to Stable (maintainer)**

- [ ] Install it from Experimental on Linux and on Windows, and use it for a while: start, sync,
      a page of each section, Settings → Updates → *Check now*.
- [ ] **It updates itself:** run step 4 once more. The copies installed from the first build offer
      the new one and install it with *Update and restart*, on Linux and on Windows. From here on,
      *n* is that newer build: it's the one that has been seen updating.
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

- [ ] On a computer without MyOrbiter, open the website's *Download*, take the AppImage (or
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
      pipelines** off. **Use separate caches for protected branches** on (GitLab's default), so a
      branch's pipeline can't leave files in the caches a release build restores; the cache keys
      in `.gitlab-ci.yml` keep them apart too.
- [ ] **Job token permissions** → *Authorized groups and projects*: **Only this project and any
      groups and projects in the allowlist**, with nothing in the allowlist.
- [ ] **Auto DevOps** off.
- [ ] Never add a pipeline that runs for merge requests from forks with the project's variables,
      or one triggered by issues, comments or webhooks. **Never press *Run pipeline* on a merge
      request from a fork:** it runs the fork's `.gitlab-ci.yml` and code in this project, with a
      job token that carries the role of whoever pressed it and can write the packages and the
      channels.
- [ ] **No pipeline schedules** (*Build* → *Pipeline schedules* stays empty, but for Renovate's,
      below): pipelines run only when started or for a release tag. The nightly build, the weekly
      audit and the daily website refresh of the GitHub days are gone: each release's `test` job
      audits both lockfiles and checks the MSRV, and the `pages` task refreshes the website when
      it's started.

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
      tags only), visibility **Masked and hidden**, **Expand variable reference** unticked. A masked
      value must be one line of at least 8 characters from GitLab's allowed set. If the password
      isn't, GitLab refuses to mask it: keep it **Visible**, still protected and scoped (the
      `sign` job never prints it), rather than changing the key.
- [ ] **Check it:** the next release pipeline's `sign` job has no "No updater files" line, and the
      release carries the `.sig` files and `latest.json`.

GitLab Free has no approval step for an environment (protected environments are a paid feature):
a pipeline on `main` or a protected tag signs as soon as `sign` runs.

## The runner

The `pc` jobs run on the project's own runner (*Settings* → *CI/CD* → *Runners* → **New project
runner**, tag `pc`, *Run untagged jobs* off):

Every job runs here unless *runner* says `cloud`, `sign` (with the signing key) too. Nothing on
`main` or a release tag needs gitlab.com's hosted runners, and the project's instance runners stay
off: a pipeline on any other branch, or with *runner* `cloud`, then waits for a runner, and needs
*Settings* → *CI/CD* → *Runners* → *Instance runners* turned on to run.

- [ ] **The Docker executor**, never the shell executor: each job then runs in its own container.
      The jobs share the executor's build volume, so `sign` has no checkout there: it clones the
      commit into its own container (no hooks, no git config from anywhere else), takes the signer
      from that clone (checked against `SIGNER_SHA256`), and from the volume only the build's
      files, checked (no links, made in the builder image by digest; only the files that build
      makes are signed) before the key is near them. Keep `/tmp` out of the runner's `volumes`:
      that's where `sign` clones.
- [ ] **Never privileged, no Docker socket:** `privileged = false` and no `/var/run/docker.sock` in
      its `volumes`. Either would let a build job out of its container, onto this computer and
      into the other jobs and caches. No job builds an image: `ci/build-image.sh` does, here.
- [ ] **Protected:** the runner's *Protected* box ticked, so only pipelines on `main` and protected
      tags run on it, and the signing key (a protected variable) reaches only them. A pipeline
      on any other branch can't use it: it runs on gitlab.com's hosted runners, whatever
      *runner* says, in that branch's own builder image (`ci/build-image.sh <branch>` first, on
      that branch). Such pipelines are optional.

## Packages

- [ ] **Duplicates allowed for generic packages:** the group's *Settings* → *Packages and
      registries* → *Duplicate packages* → Generic: **Allow duplicates** on (the default). Each
      file is replaced by uploading it again and then deleting the older copy (`ci/lib.sh`), so a
      re-run job and each channel's `latest.json` need it. Turning it off wouldn't make a build's
      files unchangeable: a job token that can upload can also delete. What protects installed
      copies is the signature check.
- [ ] Never delete the `channel` and `stable-builds` packages: every installed copy reads them.
- [ ] **Container registry cleanup policy** (*Settings* → *Packages and registries* → *Cleanup
      policies*): off, or set so it removes only branch images and keeps the builder images main
      runs in. *Keep tags matching* `^\d{4}-\d{2}-\d{2}(\.\d{14})?$`; *Remove tags matching*
      `^\d{4}-\d{2}-\d{2}-.+$`, older than 14 days. If it removed the `.<UTC time>` tag that
      `BUILDER_DIGEST` names, the registry would delete that image and every pipeline on `main`
      would stop until a new image is built and its digest merged.

## Issues

- [ ] **The labels** `bug` and `needs-triage` exist (*Manage* → *Labels*).
- [ ] **Confidential issues** stay available (they're how `SECURITY.md` asks for private reports);
      only members can read one.
- [ ] *Service Desk* off unless it will be read.

## Features not in use

*Settings* → *General* → *Visibility, project features, permissions*: untick **Wiki**, **Snippets**,
**Model experiments**, **Monitor** and any other feature not in use. Keep **Issues**,
**Repository**, **Merge requests**, **CI/CD**, **Container registry**, **Package registry**,
**Releases**, **Environments** and **Pages**.

## Dependency updates

`renovate.json` is Renovate's settings: weekly merge requests, minor and patch updates grouped,
majors alone, nothing merged by itself, and a merge request of its own for a dependency with a
known vulnerability (OSV), in place of Dependabot's alerts. Nothing runs Renovate yet: GitLab has
no built-in Renovate, and Mend's hosted Renovate app covers GitHub and Bitbucket, not gitlab.com.
On gitlab.com Renovate runs self-hosted: a pipeline running Renovate's own image once a week, with
a personal access token of a bot account (project access tokens need Premium on gitlab.com). That
is the one pipeline schedule this project would have, and it needs a change to `.gitlab-ci.yml`
first (a `renovate` task, and a rule for schedule pipelines, which today start nothing). Both are
the maintainer's choice. Renovate's `renovate/*` branches start no pipeline (`.gitlab-ci.yml` runs
only when started or for a release tag), so nothing a new dependency version contains runs on the
`pc` runner until a merge request is read and its branch tested by hand.

## Screenshots

The pictures in `docs/screenshots/` (the README and the docs, 1440×900) and `site/shots/` (the
site, 1280×800), both at twice those pixels, show the invented account in `demo/`, never
`public/dev-*.json`. `scripts/screenshots.mjs` takes them all again:

```fish
npm run screenshots
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

- [ ] **Never install an AI bot or integration that acts on public comments** (answers, labels,
      opens merge requests or runs anything because someone wrote an issue or comment). Anyone can
      write one, and its text would become that bot's instructions.
- [ ] Read issues in a Claude session through `scripts/issues-digest.mjs` (see `CLAUDE.md`), never
      by pasting them raw.
- [ ] Issues from the app's Report a bug come in with the `bug` and `needs-triage` labels (where
      GitLab lets the reporter set them); nothing acts on them by itself. Keep it that way: no
      pipeline, webhook or integration should trigger on issues, comments or those labels.
