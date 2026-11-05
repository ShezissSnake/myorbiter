# Maintaining the public repository

GitHub settings that can't live in the repository: switch them on by hand once
`ShezissSnake/orbiter` is public, and check them again after any change to the repository's
settings. Each line says where it is.

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
environment has none of that name), and they move once it's public:

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
      a channel can't be moved by hand. (Builds start from pushes to `main`, not from tags.)

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
