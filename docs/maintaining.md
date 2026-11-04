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
      records, other players' names, tokens). Making a repository public publishes every commit.

## Actions

- [ ] **Fork pull requests wait for approval:** Settings → Actions → General → "Approval for running
      fork pull request workflows from contributors" → **Require approval for all outside
      collaborators**.
- [ ] **Read-only token by default:** Settings → Actions → General → Workflow permissions → **Read
      repository contents and packages permissions**. Each workflow asks for more itself, job by job.
- [ ] Same place: leave **Allow GitHub Actions to create and approve pull requests** unticked.
- [ ] **Pinned actions only:** Settings → Actions → General → Actions permissions → tick **Require
      actions to be pinned to a full-length commit SHA** (every workflow here already pins them).
- [ ] Keep the release secrets (the updater's signing key and its password) as repository secrets
      only the release workflows read. Never add a workflow triggered by `pull_request_target`,
      `issue_comment`, `issues` or `workflow_run` that can see them.

## Branches and tags

- [ ] **A ruleset for `main`:** Settings → Rules → Rulesets → New branch ruleset, target the default
      branch: **Restrict deletions** and **Block force pushes** on. Optionally **Require a pull
      request before merging** with **Require review from Code Owners** (`.github/CODEOWNERS`), once
      there's a second person who can review.
- [ ] **A ruleset for release tags:** a tag ruleset for `v*` with **Restrict creations**, **Restrict
      updates** and **Restrict deletions**, bypassed only by the maintainer: a `v*` tag starts a
      release build.

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
