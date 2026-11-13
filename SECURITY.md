# Security

## Reporting a vulnerability

Please report it privately, through GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/ShezissSnake/myorbiter/security/advisories/new)**
(*Security* → *Report a vulnerability*). Only you and the project's maintainers can see the report.
Don't open a public issue, and don't put details in the app's Report a bug, which makes a public
issue.

MyOrbiter is a hobby project with one maintainer: expect an answer within a week, and a fix when one
is possible. There is no bounty.

## In scope

- **MyOrbiter itself:** the desktop app (`src/`, `src-tauri/`, `crates/`) and the TennoScope build it
  carries (`tennoscope/`).
- **Leaking what's private:** the warframe.market sign-in (kept in the system keyring), Discord
  webhook addresses, or other players' names getting into a log, a bug report, a crash, a file
  others can read, or the network.
- **Reaching further than it should:** a link that opens anything other than https to the sites in
  `src/lib/core/links.ts`; a page that runs script or HTML from outside data (Overframe's or Nox's
  Frame's build names, warframe.market, the wiki data, the game's log); a request to a host MyOrbiter
  doesn't name; writing to warframe.market without the player's action or setting.
- **The release and update path:** the Release workflow (`.github/workflows/release.yml`, `ci/`), what ends up in a
  download, and the update signature check (below).

## Out of scope

- warframe.market, Overframe, Nox's Frame, api.warframestat.us and Warframe itself: report to them.
- Anything that needs the attacker to already control the player's account on the computer.
- The account risk of TennoScope's Full mode reading the game's memory: that's disclosed, and off
  until the player turns it on.

## The signing key

In-app updates are signed. Each release's update files carry a minisign signature made with the
project's private updater key, which lives only in the secrets of the `release-signing`
environment and is used only by the Release workflow's `sign` job. The app
carries the matching public key (`plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`) and installs an update only when its signature checks out against it.
Before that, it downloads an update only from the project's own address for the version on offer and
the player's system (a `build-<n>` release on github.com, or that version's folder in the GitLab
project's package registry: `download_allowed` in `src-tauri/src/updates.rs`); an update whose
manifest names any other address is refused.
A leaked private key, or a change that loosens either check, is a vulnerability: report it as above.
The downloads on the Releases page also come with `SHA256SUMS` (README, Checking a download).
