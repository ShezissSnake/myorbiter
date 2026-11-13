# What MyOrbiter reads and sends

MyOrbiter runs on your PC and has no server or account of its own. No telemetry, analytics or crash
reports are built in. What it does read, what it sends and to whom, and what it keeps on your disk
is all listed below, as the code does it.

The page covers MyOrbiter and the TennoScope that comes with it (`tennoscope/ORBITER.md`), which
MyOrbiter starts in the background on Linux and Windows. Paths are given for Linux, with the Windows
path beside each.

## In short

| What | Where it goes | When |
| --- | --- | --- |
| The game's memory, read only | your login session goes to Digital Extremes, for your inventory; the rest stays on your PC | only in Full mode, which is off until you choose it |
| Pictures of the game's screen (the monitor it's on, its own window, or whole monitors, by system: below), captured and read on your PC | the pictures stay on your PC; the item names on them are priced on warframe.market | in TennoScope's Overlay mode (what the first start's "Not now" picks) and Full mode, during void fissure missions and at Baro's kiosk |
| Running programs' names; on Linux, the memory maps of Chromium-based apps while the game is closed | stays on your PC | while TennoScope watches for the game, to find it and its launcher |
| The game's log (`EE.log`) | a trade that sold one of your listings marks it sold on warframe.market (off unless you turn it on); each player you traded with in the last 24 hours, whatever the trade, gets +rep there, a review in your name (off unless you turn it on, whether or not sales are marked); the names of players you trade with or who whisper you are looked up there, and appear in your Discord notifications if you set them up; the rest stays on your PC | while MyOrbiter runs, on PC |
| Order books, prices, the live feed of new orders; signed in: your profile, orders, auctions, chats, status and your changes | warframe.market | while MyOrbiter runs (below) |
| Item data, drop tables, world state, pictures | WFCD (`api.warframestat.us`, `drops.warframestat.us`, `cdn.warframestat.us`, `raw.githubusercontent.com`), Digital Extremes, relics.run, warframe.market | at start, on timers, and as pages need them (below) |
| Builds | Nox's Frame | when you open an item or a build on Builds (on unless you turn it off) |
| The notifications you pick | your Discord webhook | only if you set one |
| An update check | github.com, then gitlab.com if GitHub has no answer | at start and every 6 hours, on the AppImage and the Windows installer |
| A bug report | github.com: the issue form opens with the app's version and your system in its address; the report itself only if you paste it in and submit | when you press Open on GitHub in Report a bug |

## Full mode: the game's memory

Full mode is off until you choose it: in Settings (TennoScope), on the TennoScope panel, in the
first-run steps, or in TennoScope's own window. One exception: a TennoScope folder kept from an
older TennoScope where Full mode (or its old "risk accepted" setting) was chosen starts in Full
mode, without asking again. With Full mode on:

- **What is read.** TennoScope opens Warframe's process (`Warframe.x64.exe`) for reading and
  searches its memory for your login session: your account id and the session's nonce, in the
  game's own request text or its login data. It reads about 150 MB of the game's writable memory
  first, then samples 64 MB more and, if the pair still isn't there, reads the rest of its readable
  memory. When the samples turned up one pair that isn't confirmed yet, it first reads again, whole,
  the parts of memory that hold that pair, and reads the rest only if that doesn't confirm it.
- **What is sent.** It downloads your inventory from Digital Extremes
  (`mobile.warframe.com/api/inventory.php`), with those two values in the address and nothing else;
  the request names no program (no User-Agent), and redirects elsewhere are refused. The pair isn't
  logged or kept. The inventory gives MyOrbiter your items, mastery, platinum, credits, Endo,
  rivens, imprints, each copy of your gear, the warframes fed to the Helminth and your Foundry.
- **When.** When the game's log says an inventory sync finished; when a new game process appears,
  and when TennoScope starts or Full mode is turned on while the game runs; when you press Sync (in
  MyOrbiter or in TennoScope); and when MyOrbiter asks: 90 seconds into a game session if the last
  read is older than the session, once more five minutes later if that read didn't arrive, after a
  trade in the log is marked as a sale, and when you press the riven overlay key. At most one read
  every 15 seconds; an ask inside that time is dropped.
- **Nothing is written into the game's memory or folder.** No keys, no clicks, no input of any kind.
  On Linux, memory is opened for reading only: `/proc/<pid>/mem` opened read-only. On Windows it
  reads through `ReadProcessMemory` and `VirtualQueryEx`, with handles that two libraries open. What
  the code shows: MyOrbiter's code doesn't set their access rights itself, and its comments call them
  read access (`PROCESS_VM_READ`). What wasn't audited: the access those libraries actually ask
  Windows for. Nothing in the code writes to the game's memory on either system, and TennoScope
  writes nothing to the game's process at all.
- **The risk.** Digital Extremes publishes no list of allowed or forbidden third-party programs;
  [its forum post](https://forums.warframe.com/topic/1383123/) leaves using them at your own risk.
  Full mode could put your account at risk: that's your call. MyOrbiter never calls it safe.

## Overlay mode: the game's screen

Until a mode is chosen, TennoScope runs in Companion mode and doesn't look at the game at all. In
Overlay mode (the first-run "Not now", or Full mode turned off), and in Full mode, it reads the
game's log and captures the game's screen: every 2 seconds during a void fissure mission (from when
the log shows the relics loaded until the reward screen closes, at most 45 minutes), more often
once the cards show, and at Baro's kiosk. To find the game's window it reads the titles of the open
windows and takes the largest one named "Warframe"; on Linux, when none is, it also runs
`xwininfo -root -tree` (at most every 5 seconds) to look for the game inside a Wine virtual desktop.
What is captured depends on the system:

- **Windows, and Linux on an X11 desktop:** the whole monitor the game's window is on, cut in memory
  to the game's window before anything is read from it. No permission is asked.
- **Linux on a Wayland desktop, with the game under XWayland** (found among the open windows, as
  above): the game's own window, nothing around it. No permission is asked.
- **Linux on a Wayland desktop, with the game a Wayland window of its own:** no program may ask
  where another program's window is, so whole monitors are captured, nothing is cut away, and each
  is read in turn as the game's screen. On desktops that offer wlroots' screen copy, every monitor,
  with no permission asked. On KDE, every monitor with no permission asked, but only for a
  TennoScope that doesn't run from an AppImage; the TennoScope inside MyOrbiter is an AppImage, so
  it doesn't capture this way. Otherwise, the monitors you choose (one or more) in the desktop's
  screen-share dialog, which a button in TennoScope's own window opens while the game runs and
  nothing else can capture it; the desktop shows a screen being shared while that capture is open,
  and the permission is kept in `screencast.token` (below).

The captures stay in memory. It reads the cards with Tesseract on your PC: each card's title is cut
out to your temporary folder for Tesseract and deleted once read (if Tesseract fails to run, that
cut-out is left there; a debug build made from source keeps more there).

To find the game and its log on Linux, TennoScope reads every process's name in `/proc` on each pass
of its watch, about ten times a second and about a hundred while a reward screen is open, and the
game's `stat`, `maps`, `exe` link and `environ` (for its Wine prefix). While the
game isn't running, it also reads the `maps` of any process whose name starts with `Cr`
(Chromium-based apps) to tell whether Warframe's launcher is open. On Windows it reads the process
list (names and start times) and the log in `%LOCALAPPDATA%\Warframe`.

## The game's log

MyOrbiter reads Warframe's `EE.log` (read only) every 2 seconds, every 10 while TennoScope says the
game isn't running, and not at all for console players. The first read goes through the log from
the start of the game session; each one after takes only what the game added. On Linux it finds the
log through Steam's library list (`steamapps/libraryfolders.vdf` in Steam's folders, Flatpak
included) under each library's Proton prefix for Warframe, and looks again every minute; on Windows
in `%LOCALAPPDATA%\Warframe`; or at a path you set in Settings (a local file named `EE.log`, nothing
else).

From the log MyOrbiter takes:

- the relics the squad brings into a fissure, with their refinement, and the rewards the log says
  were given (yours among them);
- the name and start time of each mission this game session, and the session's clock;
- from private chats, only the name of each player a private chat tab opens with (yours or theirs),
  never what is written;
- from each trade that goes through: the other player's name, the items on both sides (with rank
  and count) and the platinum each way.

The log's first 4 KB (which hold the game's command line, your user name and computer name) stay in
memory to notice a new game session; they're never saved or sent. The log's location goes into
MyOrbiter's own log with your home folder written `~`, so without your user name.

What is kept: every trade (partner, items, platinum) in your trade history, up to 2000; the names of
players who whispered you, up to 300; and the sale and whisper notifications, with names, in the
notification history and in MyOrbiter's own log. When you're signed in to warframe.market and
marking sales automatically is on (it is off unless you turn it on), a trade from the last 30
minutes that sold one of your listings goes into your sales log, the listing is marked sold on
warframe.market, and TennoScope is asked to read your inventory again. When you're signed in and
*Give +rep by itself after a trade* is on (it is off unless you turn it on), each player you traded
with in the last 24 hours gets +rep, once per player, whatever the trade was (a sale, a purchase, a
swap or a gift), whether marking sales is on or not. A +rep is a positive review, with your +rep
message, posted on the other player's warframe.market profile in your name. The names of players
you trade with, and of a player who whispers you (with whisper notifications on), are looked up on
warframe.market to show their reputation.

MyOrbiter reads `EE.cfg` beside the log and keeps only the display mode (`Graphics.WindowMode`): at
start, every 5 minutes, and when you change the log's path (not on console).
`myorbiter-dump --ee-log`, a developer tool built from the source (`crates/myorbiter-data`, not in
the downloads), prints everything MyOrbiter reads from the log.

TennoScope reads the same log, only in Overlay and Full mode and only while the game runs (ten
times a second, a hundred while a reward screen is open): for the inventory sync, the reward screen
(the squad's relics, the screen opening and closing, the rewards, and the squad's account ids,
which nothing uses any more), and when Baro's Ducat Kiosk opens and closes. Its own bug report can
save a copy of the log on this computer, only if you ask for it, in `reports/` in TennoScope's
folder (the five newest reports kept). Only IP and e-mail addresses are removed from that copy; the rest of the log stays in it, other players'
names, the squad's account ids, your trades and the log's first lines (the game's command line,
your user name and computer name) among them.

## warframe.market

Every request MyOrbiter makes to warframe.market says who it is, with the User-Agent
`MyOrbiter/<version> (+https://github.com/ShezissSnake/myorbiter)`. Its API calls also carry your
platform (`Platform`), `Crossplay: true` and `Language: en`, except the item and riven lists (only
`Language: en`) and signing in with an email and password (neither).

- **Read without signing in:**
  - the item list and the riven lists (weapons and stats), when MyOrbiter starts or a page needs
    them, if the copy kept is more than a day old;
  - order books: when you open an item, price or list something, post a buy order, plan Sell spares
    or reprice; every 10 minutes on PC, once your inventory is read, for cheap buys (up to 20 things
    you're missing, plus one per price alert you set); and, if you turn on automatic checking or
    repricing, each of your listings' books every 5 minutes or the interval you set;
  - price history: when you open an item's chart or the buy form, and once a day for each relic you
    hold;
  - riven searches: when you search, every 5 minutes for each riven you watch, when a riven cycle
    is on screen, and, on Orders, every 30 minutes for each weapon you have an auction for;
  - pictures of items WFCD has no picture of (once per size, then kept; a missing one is asked for
    again after a day);
  - the in-game names of players you trade with or who whisper you (their profile and reputation),
    signed in or not;
  - your closed orders, when you press Import on Sales;
  - warframe.market's live feed of new orders on your platform: one connection, held while there
    is something to watch for (up to 300 things you're after, your price alerts among them) and
    closed once there has been nothing for 10 minutes.
- **Signed in** (your own sign-in: an email and password used once for a token, or a pasted
  token): your profile (at start and after signing in, and every minute or more while
  warframe.market isn't answering); your orders (every 30 seconds, every 2 minutes while the window
  is hidden, backing off to 10 minutes while warframe.market isn't answering, and after each
  change); your riven auctions (while Orders or Rivens is on screen, at most every 5 minutes, at
  once for another account or platform, a minute after a failed read; before putting one up, if
  the last read is over 30 seconds old; and after each change); your chats (every minute);
  before giving +rep, that player's reviews, to see whether you already gave one; and, if you
  choose a status, a second connection held while MyOrbiter is open, which sends it again every 2
  minutes, puts it back if something else changes it, and switches "online in game" to online
  while the game isn't running.
- **Changes** go out when you ask (list, change a price or quantity, hide or show, mark sold,
  remove one listing or all, reprice, post a buy order, apply a Sell spares plan, give +rep, put up,
  reprice or close a riven auction); when a trade in the game's log in the last half hour shows you
  sold a listing (off unless you turn it on in Settings, Trades or on Orders); to give each player
  you trade with +rep with your message (off unless you turn it on); to hide your last copies while someone
  whispers you and show each again after the minutes you set, once an inventory read newer than the
  whisper still has the copy (if you turn it on); and with automatic
  repricing (off unless you turn it on; its limits are in Settings, Trades).
- **How often, at most.** API calls go out one at a time, at least 0.4 seconds apart (1.5 seconds
  for a minute and a half after warframe.market says to slow down), which keeps them under 3 a
  second, warframe.market's published limit for listings; warframe.market's pictures keep their
  own 0.4-second spacing. Riven auction requests (searches for a price check, a comparison, a
  riven alert or Search on Rivens; your own auctions; putting one up, changing or closing it)
  also share a budget of 10 a minute, warframe.market's limit for contracts: more wait their turn,
  in order, and Rivens says "Waiting for warframe.market's search limit…" meanwhile.
  At most 120 changes (listings, auctions, +rep) go out in any minute; more wait their turn. A
  status sent on the status connection isn't counted among them. When warframe.market answers
  "too many requests", nothing more goes to it before the time its reply gives (Retry-After, in
  full; a minute when it gives none): a read or change that would wait more than 10 seconds isn't
  sent, and MyOrbiter says "warframe.market asked us to wait until" that time. A read turned away
  is tried again only after that wait, at most twice; a change is never sent again on its own.

TennoScope talks to warframe.market too, on its own clock (at least a third of a second between
requests), naming itself `TennoScope/<version> (+https://github.com/Deftera186/tennoscope)` on its
web requests; its status connection sends no User-Agent.

- In Overlay and Full mode it reads the top orders (the lowest sell prices) for every reward your
  squad's relics can give, while the mission runs, and for any card still unpriced when the reward
  screen opens; prices are kept 15 minutes. It also reads them for the items you refresh in its own
  window.
- Only with a sign-in made in TennoScope's own window (kept from an earlier run): the item list and
  your orders when it starts and after each change, with no timer; changes to your orders only when
  you press them there; and your status, which it can switch with the game. While MyOrbiter holds
  your status, TennoScope lets go of its own and refuses to change it.

## Item data, world state and pictures

- **WFCD's item catalogue** (`api.warframestat.us/items`, about 70 MB), downloaded by TennoScope:
  once, when it starts watching for the game and has no copy; in Full mode, again at an inventory
  read once its copy is a day old; after a failed download, again an hour later while TennoScope
  keeps running (at once after a restart, and at every inventory read while there is no copy at
  all). This request names no program (no User-Agent).
- **WFCD's relic list** (a fixed version on `raw.githubusercontent.com`, no User-Agent), downloaded
  by TennoScope only if MyOrbiter hasn't given it its relic tables and it has no copy of its own.
- **Prices**: TennoScope downloads the daily price history from `relics.run` when it starts and when
  you choose its mode, unless it already has today's or yesterday's (today's file, then up to 5
  days back: at most 6 requests). The files usually run two days behind, so most starts download
  again (about 4 MB).
- **World state**: `api.warframestat.us` at start, every 5 minutes, and when you press Sync or Try
  again (fissures, events, alerts, cycles, invasions, Baro, Varzia, Darvo, Nightwave, the Sortie,
  Archon Hunt, Archimedeas, Steel Path, the Duviri Circuit, the 1999 calendar, Descendia,
  bounties). When it doesn't answer, or leaves out fissures, Baro, Varzia, a cycle, the Sortie,
  Archon Hunt or bounties, MyOrbiter reads the game's own world state (`api.warframe.com`, then
  `content.warframe.com`) and WFCD's tables that name its places (four files on
  `raw.githubusercontent.com`, kept a week).
- **Drop tables**: `drops.warframestat.us` is asked whether they changed at start and every 3 hours,
  once the last successful check is 12 hours old (a failed check is tried again 3 hours later); the
  tables and WFCD's relic list (`raw.githubusercontent.com`) are downloaded only when they changed.
- **Foundry recipes**: warframe-public-export-plus on `raw.githubusercontent.com`, three files, once
  a week (a failed download is tried again at the next start or 3 hours later).
- **Last week's riven trades** for your platform: `www-static.warframe.com`, when you open Rivens,
  when Orders shows your riven auctions, and when a riven reroll is shown; at most once every 6
  hours while MyOrbiter runs (a failed read is tried again on the next visit). This one is read by
  MyOrbiter's window, so it carries the window's own User-Agent, not MyOrbiter's.
- **Item pictures**: WFCD's (`raw.githubusercontent.com`, then `cdn.warframestat.us`, which may
  send the request on to `raw.githubusercontent.com`; MyOrbiter follows it there and to no other
  host); for items WFCD has no picture of, warframe.market's. MyOrbiter downloads each size once
  and keeps it.
  TennoScope's own window, when you open it, loads WFCD's pictures from `raw.githubusercontent.com`
  itself, with the window's User-Agent, and keeps only what the window caches.

## Builds: Overframe and Nox's Frame

- **Overframe is never contacted.** Its popular-build list ships with MyOrbiter as a file; a build
  link you click opens overframe.gg in your browser.
- **Nox's Frame** (`noxsframe.com`): an item's top builds, read when you open the item on Builds,
  and a build's page when you open it (on unless you turn it off in Settings). At most one request
  every 3 seconds; each answer kept a week (Refresh reads it again; a page MyOrbiter can't read
  isn't kept); after a refusal or a browser check, nothing goes out for 15 minutes. These requests say
  `MyOrbiter/<version> (Warframe companion; build lookup; contact via noxsframe Discord)`.

## Discord, only if you set a webhook

If you give MyOrbiter a Discord webhook, the notifications of the kinds ticked under *Send these to
Discord* are posted there. Five are ticked to begin with: Rivens you watch for, Cheap parts and
arcanes, Fissures you watch for, Someone whispers you and Something sold; all of them but the
fissures carry other players' names (the seller of a riven or a cheap part, whoever whispered you,
the buyer). Posts are text, the same title and text MyOrbiter shows: item names, prices, places, your ducats, other
players' names (buyers, sellers, whoever whispered you, with their reputation) and, if you pick
warframe.market messages, the first 140 characters of each. Posts are cut to 1,900 characters,
@mentions are off, and they're signed "MyOrbiter". Only Discord webhook addresses are accepted
(`discord.com`, `discordapp.com`, `ptb.discord.com`, `canary.discord.com`). When you enter a new
address, or at start for one saved but not yet confirmed, a native dialog asks for a yes; nothing
is posted to an address until then, and after a no, nothing new is asked until MyOrbiter restarts.
At most 20 posts a minute. Test sends a sample post. Without a webhook, nothing goes to Discord.

## Updates

The AppImage and the Windows installer check for a new build at start, every 6 hours (counted from
the last check, so a check missed while the computer slept runs when it wakes), when you press Check
now and when you change the channel. They read the channel's `latest.json` from this
project's releases on github.com and, only if github.com can't be reached or doesn't serve that
channel's manifest, from its package registry on gitlab.com, with the updater's own User-Agent
(`tauri-plugin-updater/<version>`); the address names only the channel you picked (stable, beta or
experimental), with no version, system or id. When the channel you picked has no build yet, the same
check also reads the nearest other channel's `latest.json` (the next one if that one is empty too),
the same way, so Settings can name a channel that has one; it switches nothing. A new install starts
on the channel its build was published to (Experimental, where every build lands first); an install
that has saved settings keeps its channel, even when that file turns out damaged and is moved
aside (it then starts on Stable, as installs did before channels). An update downloads only when you click, from where
that `latest.json` points, and only if that is one of this project's own addresses for the version
on offer and your system: a `build-<n>` release of this project on github.com, which hands the
download to GitHub's file storage (`release-assets.githubusercontent.com` or
`objects.githubusercontent.com`), or that version's folder in this project's package registry on
gitlab.com, which may hand it to a file storage of its choosing that wasn't audited. A `latest.json`
that points anywhere else is refused, and nothing is downloaded. Other installs
(.deb and .rpm, a build run straight from its folder, a development build) don't check.
TennoScope's own updater is switched off in this build: it never asks GitHub for a new version, and
MyOrbiter's update brings the next TennoScope.

On Windows, the installer downloads Microsoft's WebView2 installer if WebView2 is missing (Tauri's
usual setting, which the configuration doesn't change; the hosts that download uses weren't
audited).

## Reporting a bug

MyOrbiter itself sends nothing. Report a bug shows you the report first; *Open on GitHub* then puts
it on the clipboard and opens the repository's issue form on github.com in your browser. The page's
address carries only `template=bug_report.yml` and the app's version and your system (`MyOrbiter
<version>`, `System: <system> <architecture>`), nothing of what you wrote or of the log, for you to
paste the report into, give it a title and submit; your browser may keep that address in its
history. *Copy report* only puts it on the clipboard.
Either way the report stays on the clipboard, and in its history if your system keeps one. What
github.com's page does with what you type or paste there before you press Submit new issue (drafts
it may keep, for one) is github.com's and wasn't audited. Technical details are
included unless you untick them, and you can read them in full first: the version, commit and build
date, channel, system and architecture, the page open, TennoScope's state, whether Full mode is on,
and the last 50 lines of MyOrbiter's log, with sign-ins, e-mail and IP addresses, account ids, your
user name in paths and players' names hidden.

## Links

Links open in your browser, which then visits that site. MyOrbiter opens only https links to
warframe.market, wiki.warframe.com, warframe.fandom.com, overframe.gg, noxsframe.com, this
project on github.com (its releases, its issues and Report a bug, its files on `main`, this page
among them, and its security pages) and its website (shezisssnake.github.io/myorbiter), and this
project's pages on gitlab.com (older builds' release pages, its issues). TennoScope opens its upstream project on github.com
(its own bug report and release pages).

## Nothing else

Those are all the hosts MyOrbiter and its TennoScope contact themselves: `api.warframe.market`,
`ws.warframe.market`, `warframe.market` (pictures), `api.warframestat.us`, `drops.warframestat.us`,
`cdn.warframestat.us`, `raw.githubusercontent.com`, `api.warframe.com`, `content.warframe.com`,
`www-static.warframe.com`, `mobile.warframe.com`, `relics.run`, `noxsframe.com`, `github.com`,
`gitlab.com`, and the Discord webhook address you give it. More can be reached on the way: github.com
hands an update download to `release-assets.githubusercontent.com` or
`objects.githubusercontent.com`, gitlab.com may hand one to its file storage, and the Windows
installer fetches Microsoft's WebView2 installer when WebView2 is missing; gitlab.com's and
Microsoft's hosts are theirs to choose and weren't audited. If you set a proxy (`HTTPS_PROXY` and the like), requests go through it. This page
covers what MyOrbiter's and TennoScope's code does; what the system's web view (WebView2, WebKitGTK)
does on its own wasn't audited. No telemetry, analytics or crash reporting is built in, and your
records (sales, trades, value over time, settings) stay on this computer, in `settings.json`
(below); single events reach warframe.market or Discord only as described above.

## Files on this computer

### TennoScope's folder

Your Warframe inventory and account figures come from TennoScope
(`~/.local/share/io.github.deftera186.tennoscope` on Linux,
`%APPDATA%\io.github.deftera186.tennoscope` on Windows, or the folder set in Settings):

| File | Used for |
| --- | --- |
| `tennoscope.sqlite3` | your inventory and mastery (opened **read-only**; only the `inventory` and `snapshot_audit` tables) |
| `catalog/catalog-generation.json` | WFCD's item data: names, categories, stats, components and ducats, vault flags, drop locations |
| `catalog/relic-generation.json` | relic contents, vault flags and where each relic drops |
| `collection-prices.json` | the daily prices TennoScope downloads (relics.run) |
| `logs/tennoscope*.log` | TennoScope's own log, read in full for the reward screens and start failures (on Windows also in `%LOCALAPPDATA%\io.github.deftera186.tennoscope\logs`) |

MyOrbiter reloads whenever TennoScope's database, prices or item data change.

TennoScope and MyOrbiter also share a runtime folder: `$XDG_RUNTIME_DIR` (usually
`/run/user/<uid>`), or else `tennoscope-orbiter-<uid>` in the temporary folder, readable only by you
(refused otherwise); on Windows `%TEMP%\tennoscope-orbiter`. From there MyOrbiter reads TennoScope's
status report (`tennoscope-status.json`, written every 3 seconds: Foundry and its finish times,
mastery rank, platinum, credits, Endo, rivens, imprints, each copy of your gear, the warframes fed
to the Helminth, whether the game runs, and whether TennoScope is signed in to warframe.market and
where it keeps that sign-in, not the sign-in itself) and the reward-screen file
(`tennoscope-reward-screen.json`: the cards, the time and their prices). MyOrbiter writes a few
small files there for TennoScope (`orbiter-*.json`: the reward pick, the overlay, the riven cycle,
the relics, the status it holds) and notes the TennoScope it started (`orbiter-tennoscope.pid`). To
find that TennoScope, MyOrbiter reads process names and start times (`/proc/*/comm` and `stat` on
Linux).

MyOrbiter never reads the warframe.market sign-in TennoScope keeps (in its database or the system
keyring).

TennoScope also keeps the reports its own bug report saves, in `reports/` in its folder (above). On
Linux, once you've given it the desktop's screen-share permission, it keeps that permission in
`~/.config/tennoscope/screencast.token` (under `$XDG_CONFIG_HOME` when that is set), readable only
by you, and offers it to the desktop again the next time the button in its window that asks for it is used.

### MyOrbiter's own files

- `~/.config/dev.myorbiter.app/` (`%APPDATA%\dev.myorbiter.app` on Windows):
  - `settings.json`: your settings (the Discord address you entered among them); your records:
    the sales log, the trade log (other players' names, items, platinum), value history, riven
    history, relic runs and drops, notifications, who you gave +rep, the whispers and chats already
    seen; and what MyOrbiter last learned of your account from TennoScope, kept so alerts and
    figures outlive a TennoScope restart: the Foundry's builds and their finish times, mastery rank,
    platinum, credits, Endo, rivens, imprints, each copy of your gear, the warframes fed to the
    Helminth, the sets your loose parts were saved for, the gear you chose to keep, and what it has
    already told you about;
  - `relic-data.json` (drop tables), `recipe-data.json` (Foundry recipes),
    `worldstate-tables.json` (the world state's place names);
  - `tennoscope-program` (a TennoScope you chose in Settings), and on Linux `rendering` and
    `rendering-trial` (and `rendering-dmabuf` while the experimental DMA-BUF switch is on);
  - `discord-webhook`: the address you confirmed in the dialog, which posts go to; and, when the
    keyring can't store it, the warframe.market token (`market-token`).
- `~/.cache/dev.myorbiter.app/` (`%LOCALAPPDATA%\dev.myorbiter.app` on Windows): the last world
  state, riven prices and trades, warframe.market's item and riven lists, Nox's Frame pages (a
  week), and item pictures in `img/`, each kept in two sizes, so after the first look they work
  offline.
- `~/.local/share/dev.myorbiter.app/logs/` (`%LOCALAPPDATA%\dev.myorbiter.app\logs`): its log,
  `myorbiter.log` (and `myorbiter.1.log`, 2 MB each; Settings, Logs opens the folder): what it did
  on warframe.market, your notifications (with other players' names), the game log's location and
  errors. Readable only by you on Linux. Anything shaped like a token, password or webhook address
  is cut out before it's written, and your home folder is written `~` (so paths carry no user name). Its last lines leave your PC only in a bug report you paste into
  GitHub (or copy and send another way).
- Record timings (Settings, Logs; off unless you turn it on) writes how long clicks, page switches, opening and closing panels, scrolling, frames and MyOrbiter's own work take into that log each minute, and Copy timing report saves a `timings-<date>.txt` beside it (the ten newest kept): numbers, MyOrbiter's version, the system and its architecture, the web view's version, how frames reach the window (the rendering line) and the graphics card's maker, never a name or a price; it sends nothing.
- CSV exports go to your Downloads folder as `myorbiter-<what>-<date>.csv`, never over an existing
  file.
- The window's own storage (kept by the system web view) remembers the cards or rows layout of each
  page.
- The same folders under `dev.orbiter.app`, their name before the rename to MyOrbiter: on its first
  start MyOrbiter copies each one to its new place and puts a `.copied-from-dev.orbiter.app` file
  in the copy (also where there was no old folder). Until that file is there, every start checks
  again (a copy that failed is tried again, and what that start wrote in between is kept beside it
  as `dev.myorbiter.app.before-copy-<n>`, without the warframe.market sign-in or the Discord
  webhook address; a new folder that was a link is set aside as that link, and nothing changes where
  it points). The old folders are only read, never changed or removed. Two empty lock files beside
  the config folder keep starts apart: `dev.myorbiter.app.copy.lock` while a start copies, and
  `dev.myorbiter.app.lock` for as long as MyOrbiter runs, so a second start leaves the folders
  alone. A sign-in kept in the system keyring under the old name isn't read: sign in once more.

### Your warframe.market sign-in

The token is kept in your system's credential store (a Secret Service keyring on Linux: GNOME
Keyring, or KWallet with Secret Service on; the Credential Manager on Windows), under
`dev.myorbiter.app` / `warframe.market`. When the keyring can't store it, it goes to `market-token`
in the config folder (readable only by your user on Linux; on Windows it has the folder's usual
permissions).

### Removing what is kept

To remove what MyOrbiter keeps on this computer, delete it by hand, with MyOrbiter closed (it
writes `settings.json` as it runs):

- MyOrbiter's folders: `~/.config/dev.myorbiter.app/`, `~/.cache/dev.myorbiter.app/` and
  `~/.local/share/dev.myorbiter.app/` (`%APPDATA%\dev.myorbiter.app` and
  `%LOCALAPPDATA%\dev.myorbiter.app` on Windows), and the two lock files beside the config folder;
- the folders left from the rename: the old `dev.orbiter.app` folders, and any
  `dev.myorbiter.app.before-copy-<n>`; the config ones keep an old `settings.json`, with the trade
  log it held then;
- the sign-in in the system keyring, `dev.myorbiter.app` / `warframe.market` (and one kept under the
  old name);
- TennoScope's own folder (above), the sign-in it keeps if you signed in through its window, and on
  Linux `screencast.token`.

Clearing the Discord address in Notifications leaves the address you confirmed in `discord-webhook`
in the config folder: delete that file to remove it. The trade log (other players' names, items and
platinum, up to 2000 trades) has no removal in the app: nothing there takes out a trade, a player or
the whole log. `settings.json` can be edited by hand (the log is `trades`, under `market`) or deleted.

### Without a network

Item values on most pages come from warframe.market's daily figures, which TennoScope downloads
from relics.run when it starts; when they're a day or more behind the newest, a note says so.
Orders and price checks use live order books. Without a network, what comes from TennoScope's
files, the game's log and the saved copies (the last world state, riven prices, pictures already
fetched) still shows; warframe.market, Nox's Frame, a fresh world state and update checks don't.
That's what the code reads from disk; it wasn't tried page by page without a network.
