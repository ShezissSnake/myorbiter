# What MyOrbiter reads, keeps and sends

MyOrbiter runs on your PC. This page lists every file it reads, where it keeps its own data, and
every host it talks to. Paths are given for Linux; Windows equivalents follow each list.

## TennoScope's folder

Everything about your account comes from TennoScope's folder
(`~/.local/share/io.github.deftera186.tennoscope` on Linux,
`%APPDATA%\io.github.deftera186.tennoscope` on Windows):

| File | Used for |
| --- | --- |
| `tennoscope.sqlite3` | your inventory and mastery (opened **read-only**; only the `inventory` and `snapshot_audit` tables) |
| `catalog/catalog-generation.json` | item data from WFCD: components, ducats, vault flags |
| `catalog/relic-generation.json` | relic contents and vault flags |
| `collection-prices.json` | TennoScope's daily warframe.market prices |

From MyOrbiter's TennoScope it also reads its status report (`tennoscope-status.json` in the runtime
folder: Foundry, mastery rank, platinum, credits, Endo, rivens, imprints, each copy of your gear),
the reward-screen file and TennoScope's reward log. The window reloads by itself whenever
TennoScope writes a new inventory snapshot.

## The game's log

MyOrbiter follows Warframe's `EE.log` (read-only), which it finds in your Steam libraries under the
Proton prefix on Linux, in `%LOCALAPPDATA%\Warframe` on Windows, or at a path you set in Settings.
It reads `EE.cfg` beside it for the display mode. `myorbiter-dump --ee-log` prints what it reads from
the log.

MyOrbiter never touches the game, and it never reads the warframe.market sign-in that TennoScope
keeps in the same database.

## MyOrbiter's own files

- `~/.config/io.gitlab.sheziss-group.myorbiter/` (`%APPDATA%\io.gitlab.sheziss-group.myorbiter` on Windows): `settings.json` (your
  settings and the last open page), the drop tables, Foundry recipes, the worldstate's place names,
  the confirmed Discord address (`discord-webhook`) and, without a keyring, the warframe.market
  token (`market-token`).
- `~/.cache/io.gitlab.sheziss-group.myorbiter/` (`%LOCALAPPDATA%\io.gitlab.sheziss-group.myorbiter` on Windows): the last worldstate,
  riven prices and trades, warframe.market's item and riven lists, Nox's Frame pages (a week), and
  item artwork in `img/`. Each picture is downloaded once and shrunk to a thumbnail, so after the
  first look it works offline.

## Signing in to warframe.market

MyOrbiter has its own sign-in: email and password, used once to get a token, or a pasted token. The
token is kept in your system's credential store (KWallet or GNOME Keyring on Linux, the Credential
Manager on Windows), or, if none is running, in a file only your user can read. Calls to
warframe.market are spaced at least 0.4 s apart, inside its limit of about 3 per second, and at
most 120 changes go out in any minute.

## Every host it talks to

- `api.warframestat.us`: active fissures, events, the open worlds' cycles and Duviri's mood,
  invasions, Varzia's stock, Baro's schedule and stock, Nightwave, the Sortie, the Archon Hunt,
  Teshin's offer, the Duviri Circuit and the open worlds' bounties. When it isn't answering, MyOrbiter
  reads the game's own worldstate (`api.warframe.com`, then `content.warframe.com`) instead, names
  its places with WFCD's tables, and Home says so. Bounty rewards then come from each bounty's
  level in the official drop tables. The last read is kept for the next start, so Home has
  fissures, Baro and the clocks at once while it reads again; each fissure, alert, bounty rotation
  and offer goes at its own end time (invasions, which don't say when they end, are kept an hour).
- `drops.warframestat.us`: the official drop tables (relics, bounty and Sortie rewards), checked
  twice a day and kept for offline use.
- `www-static.warframe.com`: last week's riven trades.
- GitHub: item images not cached yet (and `cdn.warframestat.us` or `warframe.market` for ones
  GitHub lacks), WFCD's relic list, and, once a week, every Foundry recipe (from
  warframe-public-export-plus, MIT: what each part's own blueprint takes) and WFCD's tables that
  name the game's places and bounties. Update checks read the channel's `latest.json` from this
  repository's releases, and an update downloads from there.
- `api.warframe.market`: the item list, order books, price history and riven searches and, once you
  sign in, your orders, auctions, chats, profiles and +rep.
- `ws.warframe.market`: a connection held while MyOrbiter is open, for warframe.market's live feed of
  new orders (no sign-in) and, when you choose one, your status.
- `noxsframe.com`: an item's popular builds, read when you open the item on Builds (Settings can
  turn this off); at most one request every 3 seconds, and each answer kept a week. Overframe is
  never contacted: its popular-build list ships with MyOrbiter as a file.
- Discord, only if you give MyOrbiter a webhook: the notifications you choose are posted there, text
  only (item names, prices and the players' names that come with whispers and riven listings). Only
  Discord webhook addresses are accepted. The first time an address is used, a native dialog asks
  for a yes; after a no, nothing new is asked until MyOrbiter restarts. At most 20 posts a minute.

Item prices come from warframe.market's daily figures, which TennoScope downloads when it starts;
when they're a day or more behind the newest, a note says so. When the network is down, the rest of
the app still works.
