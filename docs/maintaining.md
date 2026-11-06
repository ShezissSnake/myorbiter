# Maintaining the public repository

GitHub settings that can't live in the repository: switch them on by hand once
`ShezissSnake/orbiter` is public, and check them again after any change to the repository's
settings. Each line says where it is.

## Going public, step by step

Every step in order, from a private repository to the first public Stable installed by hand.
Every step needs admin rights on the repository; the ones marked **(maintainer)** are the
maintainer's own clicks, signed in to GitHub as `ShezissSnake` (the account's settings, the
visibility switch, the signing key, the promotions). Each step links to its details further
down; tick it here when it's done. The commands work in fish and in bash, from a clone of the
repository whose `origin` is `ShezissSnake/orbiter`.

**1. Before the switch** (the repository is still private)

- [ ] **The signing key is backed up offline (maintainer).** `~/.tauri/orbiter.key` and its
      password are kept somewhere off this computer; `docs/releases/README.md`, *The signing key*,
      says why.
- [ ] **Every pull request meant for the first public build is merged**, and the branches that
      only held finished work are deleted, so only `main` and the branches of open pull requests go
      public: *Code* → *Branches* → the bin icon on each branch whose pull request is merged or
      closed, Dependabot's included. Or, from a terminal, once per such branch (here one named
      `work/example`):

      ```fish
      git push origin --delete work/example
      ```

      Then `git ls-remote --heads origin` lists `main` and open pull requests' branches only.
- [ ] **Releases hold only 0.2 builds:** *Releases* lists `build-<n>` pre-releases and the
      `channel-…` releases, nothing older.
- [ ] **Commit e-mail stays private (maintainer)** (*Before making it public*, below).
- [ ] **The history is read once more** for anything personal or secret, and no leftover
      `build-<n>` tag points at a commit its run didn't build (*Before making it public*):

      ```fish
      git ls-remote --tags origin 'build-*'
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
      they run too; they must pass there as well. Elsewhere skip both: `dev-bundle` without a
      TennoScope folder leaves an empty `public/dev-bundle.json`, which makes those tests fail
      (delete it). - [ ] **The newest Experimental build** installed, and updated itself once.

**2. Make it public (maintainer)**

- [ ] Settings → General → *Danger Zone* → **Change repository visibility** → **Change to
      public** → read the warnings → type `ShezissSnake/orbiter` → **I want to make this
      repository public** (GitHub may ask for the password or a passkey).
- [ ] From now on `nightly.yml` starts an Experimental build each night that `main` has
      changed (03:17 UTC); the weekly audit and MSRV checks already run while it's private.
      Nothing is built at the switch itself. Steps 2 to 5 are best done in one sitting: a nightly build
      that comes first is fine (it signs with the repository secrets while they're still
      there), and step 5 then builds once more by hand.

**3. GitHub settings** (most of these exist on GitHub Free only for public repositories)

- [ ] Private vulnerability reporting, secret scanning with push protection, Dependabot alerts
      and security updates (*Before making it public*).
- [ ] The Actions settings: fork pull requests wait for approval, a read-only token, pinned
      actions only (*Actions*).
- [ ] Rulesets for `main` and the release tags (*Branches and tags*).
- [ ] Wiki, Discussions and Projects off unless used (*Features not in use*).
- [ ] **The website (maintainer):** Settings → Pages → *Build and deployment* → *Source*:
      **GitHub Actions**. Then Actions → *Website* → **Run workflow** → branch `main` → **Run
      workflow**; when it's green, its *Publish on Pages* job links to the site
      (`https://shezisssnake.github.io/orbiter/`). With no Stable release yet its download
      buttons point at *Releases*; step 6 runs it again.

**4. Move the signing secrets (maintainer)** into the `release-signing` environment (*The
signing key's environment*, below, step by step): create it, limit it to `main`, add the two
secrets, delete the repository copies, optionally require approval.

- [ ] Done: Settings → Secrets and variables → Actions → *Repository secrets* no longer lists
      `TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and Settings →
      Environments → `release-signing` → *Environment secrets* lists both.

**5. A first public build**

- [ ] Actions → *Release builds* → **Run workflow** → *Use workflow from*: `main`, *Windows
      installer* ticked, *macOS dmg* as wanted → **Run workflow**. Note the run's number *n*
      (shown as `#n` in the list).
- [ ] The run is green; its *Sign the updater downloads* job names the `release-signing`
      environment (if approval is on: **Review deployments** → tick `release-signing` →
      **Approve and deploy**); its summary has no "No updater files" line.
- [ ] Release `build-<n>` carries the AppImage, the setup.exe, both `.sig` files, `latest.json`,
      `SHA256SUMS` and `orbiter-source.tar.gz`; `channel-experimental` names 0.2.*n*.
- [ ] Its files were built here (attestations exist only for builds made while the repository is
      public), on any computer with the GitHub CLI, in an empty folder, with the build's number
      in place of `N` (for build 31, `build-31` and `0.2.31`):

      ```fish
      gh release download build-N --repo ShezissSnake/orbiter --pattern '*.AppImage' --pattern '*-setup.exe'
      gh attestation verify orbiter_0.2.N_amd64.AppImage --repo ShezissSnake/orbiter
      gh attestation verify orbiter_0.2.N_x64-setup.exe --repo ShezissSnake/orbiter
      ```

**6. Promote it to Stable (maintainer)**

- [ ] Install it from Experimental on Linux and on Windows, and use it for a while: start, sync,
      a page of each section, Settings → Updates → *Check now*.
- [ ] Actions → *Promote a build* → **Run workflow** → *Use workflow from*: `main`, *Build
      number*: *n*, *Channel*: **beta** → **Run workflow**; when it's green, the same with
      **stable**. (Stable alone also moves Beta up.)
- [ ] `channel-stable` and `channel-beta` name 0.2.*n*, and `build-<n>` is a full release marked
      *Latest*.
- [ ] Release notes: in `docs/releases/first-public.md`, put the version (0.2.*n*) in place of
      each `<0.2.N>`, through a pull request like any change (the ruleset on `main` may ask for
      one; the next nightly build then picks it up), then open `build-<n>` → the pencil icon (*Edit*) → replace its
      description with that file's text → **Update release**. (The update screen's notes come from
      `latest.json`, not from this description, so they don't change.)
- [ ] Actions → *Website* → **Run workflow**, so its download buttons point at this release
      (it also does it by itself once a day).

**7. The first manual install**, as a new player would do it

- [ ] On a computer without orbiter, open the website's *Download* or the repository's
      *Releases*, take *Latest*'s AppImage (or setup.exe) and `SHA256SUMS`, and check it
      (README, *Checking a download*).
- [ ] Install and start it: the first-start walk-through appears, Full mode is off, and Settings →
      Updates says Stable and the version 0.2.*n*.
- [ ] *Check now* says it's up to date. When the next build reaches Stable, that copy offers it and
      updates with one click.

## Before making it public

- [ ] **Private vulnerability reporting:** Settings → Code security → Private vulnerability
      reporting → Enable. `SECURITY.md` and the issue form's "Report a security problem" link point
      at it.
- [ ] **Secret scanning and push protection:** Settings → Code security → Secret scanning → Enable,
      and Push protection → Enable. Push protection refuses a push that carries a recognised token.
- [ ] **Dependabot alerts and security updates:** Settings → Code security → Dependabot alerts and
      Dependabot security updates → Enable. (Version updates are already set up in
      `.github/dependabot.yml`.)
- [ ] **Read the history once more** for anything personal or secret (real names, home paths, trade
      records, other players' names, tokens). Making a repository public publishes every commit,
      every tag and every branch, Dependabot's included, not only `main`.
- [ ] **Commit e-mail stays private:** account Settings → Emails → tick **Keep my email addresses
      private** and **Block command line pushes that expose my email**. Commits made on github.com
      then carry the `users.noreply.github.com` address, and a push with any other address is
      refused.
- [ ] **No leftover tags from before this repository:** every `build-<n>` tag must point at the
      commit run `<n>` of `release.yml` built. Release runs are numbered from 1 in this repository;
      `gh release create --target` reuses a tag that already exists, so an older `build-<n>` tag
      would put run `<n>`'s release on the older commit. List them with
      `git ls-remote --tags origin 'build-*'` and compare each with its release's commit.

## Actions

- [ ] **Fork pull requests wait for approval:** Settings → Actions → General → "Approval for running
      fork pull request workflows from contributors" → **Require approval for all outside
      collaborators**.
- [ ] **Read-only token by default:** Settings → Actions → General → Workflow permissions → **Read
      repository contents and packages permissions**. Each workflow asks for more itself, job by job.
- [ ] Same place: leave **Allow GitHub Actions to create and approve pull requests** unticked.
- [ ] **Pinned actions only:** Settings → Actions → General → Actions permissions → tick **Require
      actions to be pinned to a full-length commit SHA** (every workflow here already pins them).
- [ ] Never add a workflow triggered by `pull_request_target`, `issue_comment`, `issues` or
      `workflow_run`, and never give a job that runs for one of them the release secrets.

## The signing key's environment

The updater's signing key and its password (`TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are read by one job only: `sign` in `release.yml`, which runs
on `main`, builds and installs nothing, and names the `release-signing` environment. Kept as
environment secrets, no other job in any workflow can read them, and GitHub can hold the sign job
until it's approved. GitHub Free offers environments to public repositories only, so while the
repository is private the two stay repository secrets (a job reads a repository secret when its
environment has none of that name), and they move once it's public. Every step here is the
maintainer's own (the key and its password are only on the maintainer's side):

- [ ] **Create the environment:** Settings → Environments → New environment, named exactly
      `release-signing`. (The first release run after it's public may have made it already, empty:
      then open that one.)
- [ ] **Main only:** in the environment, Deployment branches and tags → **Selected branches and
      tags** → add the rule `main`. A run on any other branch can then never get the key, even if a
      workflow there asks for it.
- [ ] **Move the two secrets:** in the environment, Environment secrets → Add secret, once for
      `TAURI_SIGNING_PRIVATE_KEY` (the whole text of `~/.tauri/orbiter.key`, from the offline backup)
      and once for `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Then delete both from Settings → Secrets and
      variables → Actions → Repository secrets: while a repository copy exists, any job could read it.
- [ ] **Optionally, approval:** in the environment, **Required reviewers** → the maintainer. Every
      build on `main` then stops at "Sign the updater downloads" until it's approved on the run's
      page (Review deployments). Approve within 3 days, while the run's build artifacts still exist,
      or start a new run. Leave "Prevent self-review" off while there's one maintainer, or no run
      could ever be approved.
- [ ] **Check it:** the next release run's sign job shows the environment, its summary has no "No
      updater files" line, and the release carries the `.sig` files and `latest.json`.

## Branches and tags

- [ ] **A ruleset for `main`:** Settings → Rules → Rulesets → New branch ruleset, target the default
      branch: **Restrict deletions** and **Block force pushes** on. Optionally **Require a pull
      request before merging** with **Require review from Code Owners** (`.github/CODEOWNERS`), once
      there's a second person who can review.
- [ ] **A ruleset for release tags:** a tag ruleset for `build-*` and `channel-*` with **Restrict
      updates** and **Restrict deletions**, bypassed only by the maintainer, so a published build or
      a channel can't be moved by hand. (Builds start from `nightly.yml` or Run workflow, not from
      tags.)

## Features not in use

- [ ] **Wiki:** Settings → General → Features → untick Wikis (the README and `docs/` are the docs).
- [ ] **Discussions:** leave off unless they'll be read; spam and injection attempts land there too.
- [ ] **Projects:** untick if unused.

## AI and automation

- [ ] **Never install an AI bot or GitHub App that acts on public comments** (answers, labels, opens
      pull requests or runs anything because someone wrote an issue or comment). Anyone can write
      one, and its text would become that bot's instructions.
- [ ] Read issues in a Claude session through `scripts/issues-digest.mjs` (see `CLAUDE.md`), never
      by pasting them raw.
- [ ] Issues from the app's Report a bug come in with the `bug` and `needs-triage` labels; nothing
      acts on them by itself. Keep it that way: no workflow should trigger on those labels.
