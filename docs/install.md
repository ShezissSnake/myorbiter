# Installing MyOrbiter

The README has the short version. This page has the details: each platform, a window that stays
blank, console players, the first start and updates.

## Downloads

Each build is on *Releases* (github.com/ShezissSnake/myorbiter/releases): the Linux AppImage, a
`.deb` for Debian and Ubuntu, and the Windows installer. They carry TennoScope inside them, built
from `tennoscope/` in this repository (TennoScope with MyOrbiter's changes, see
`tennoscope/ORBITER.md`), with the OCR engine its reward overlay uses. Nothing else needs
installing. On Windows the one exception is WebView2: Windows 11 and an updated Windows 10 already
have it, and on an older Windows 10 the installer fetches it.

### Linux and Steam Deck

`myorbiter_<version>_amd64.AppImage`. Make it executable and open it:

- in Dolphin (the Deck's Desktop Mode): right-click → *Properties* → *Permissions* → *Is
  executable*, then double-click it;
- in a terminal: `chmod +x myorbiter_*.AppImage`, then run it.

On a Deck, play in Desktop Mode to have MyOrbiter beside the game. To start it from Game Mode, add it
in Steam with *Games → Add a Non-Steam Game*. Game Mode shows one app at a time, so you switch with
the Steam button.

### Windows

`myorbiter_<version>_x64-setup.exe`. It installs for your user only, so no administrator is needed.
It isn't signed, so SmartScreen warns the first time: *More info → Run anyway*.

Known cosmetic: the installer, the Start menu and Settings → Apps show the name in lower case,
`myorbiter`. Windows takes it from the package name, which stays lower case for the Linux packages;
the window itself says MyOrbiter.

### macOS

There is no macOS download: the release pipeline builds for Linux and Windows only. MyOrbiter may
build on a Mac from source, but nothing builds or tests it there, and there are no instructions for
it. Such a build isn't notarised: copied to another Mac, it's refused the first time it opens, and
*System Settings → Privacy & Security → Open Anyway* lets it run.
TennoScope doesn't run on macOS, so a Mac has no inventory. Your warframe.market listings and
sales, fissures, Baro and Varzia, the world's clocks and the riven finder work; the collection pages
stay empty. A macOS build never updates itself.

### Xbox, PlayStation, Switch or mobile

Use the same download on a PC and pick your platform in Settings → *Platform* (signing in to
warframe.market sets it from your account). MyOrbiter then reads and lists on that platform's market.
It can't read a game running on a console, so it shows only what works without it: Home (your
market, fissures, the world's clocks, what's worth doing today, Baro), Orders (list anything, keep
your listings at the market price, Sold when you sell one), Sales and the riven finder.
It doesn't know what you own or when a trade goes through, so it can't list things or mark them
sold by itself. The collection pages are PC only, and MyOrbiter doesn't start TennoScope.

## Checking a download

Every release lists the SHA-256 of each of its files in `SHA256SUMS`, beside them. The README shows
the check on Linux and Windows; on macOS it's `shasum -a 256 --check --ignore-missing SHA256SUMS`.

The builds made on GitLab (0.2.100 to 0.2.119) also have their files in the project's package
registry on gitlab.com, at the addresses their release page links to; each one's `SHA256SUMS` covers
them all. Builds made since (from 0.2.120) are on GitHub's *Releases* only.

## If the window stays blank (Linux)

MyOrbiter draws its window on the graphics card. If the window stays blank, flickers or closes as it
opens, start it once with `--compat-rendering`. For a Non-Steam Game in Steam, put it in the
shortcut's *Launch Options*; in a terminal, for example:

```fish
./myorbiter_*.AppImage --compat-rendering
```

From then on it draws without the graphics card, slower but everywhere, until you turn off
*Compatibility rendering* in Settings → *Display* (or start once with `--no-compat-rendering`).
If an accelerated start closes within its first minute, the next start switches to compatibility
rendering by itself. With NVIDIA's driver, MyOrbiter keeps the graphics card but passes frames
through shared memory. An experimental switch in Settings → *Logs* passes them as DMA-BUF instead
from the next start, to compare the two with *Record timings*; a start that closes within a minute
turns it off again, and a window that stays blank needs one start with `--no-dmabuf`.

WebKit's own variables (`WEBKIT_DISABLE_COMPOSITING_MODE`, `WEBKIT_FORCE_COMPOSITING_MODE`,
`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DMABUF_RENDERER_FORCE_SHM`,
`WEBKIT_FORCE_DMABUF_RENDERER`), when you set them yourself, override all of this. MyOrbiter's log
(Settings → *Logs*) says which way each start drew.

## The first start and Full mode

On the first start MyOrbiter walks you through what TennoScope needs, once, and asks whether
TennoScope should read your inventory: **Full mode**, off unless you turn it on (*Read my inventory
(Full mode)* there, in the TennoScope panel or in Settings). Full mode reads Warframe's memory to
fetch your inventory. Digital Extremes publishes no list of allowed or forbidden third-party
programs and leaves using them at your own risk: Full mode could put your account at risk. Nothing
is written to the game's memory; the login session found there goes to Digital Extremes, for your
inventory. Everything MyOrbiter and TennoScope read and send is listed on the page What MyOrbiter
reads and sends. ([That page](privacy.md); [Digital Extremes' forum
post](https://forums.warframe.com/topic/1383123/).)

Without Full mode, TennoScope reads only the game's log and the reward screen (Overlay mode), and
MyOrbiter shows everything that doesn't need your inventory. With it, TennoScope reads your account
when you're in the game. Some Linux systems (Ubuntu among them) only let a program read another's
memory if it started it. MyOrbiter tells you if yours does, with the command that allows it until you
restart.

## Updates

MyOrbiter updates itself from this project's releases on GitHub, with GitLab's frozen copy as a
fallback (Settings → *Updates*). Each installed copy follows one channel:

- **Stable** (the default): tested builds.
- **Beta**: the next Stable, a few days early.
- **Experimental**: every change, as soon as it's built. It may break.

A build keeps its version (`0.2.<n>`) on every channel. Moving it up a channel moves the same
files; it is never rebuilt.

How each kind updates:

- The Linux AppImage replaces its own file. It needs a folder you can write to; MyOrbiter says so if
  it can't.
- The Windows installer runs by itself (passive mode) and restarts MyOrbiter.
- The `.deb`, a `.rpm` (only from a build of your own) and a macOS build are not updated by
  MyOrbiter: install a newer one by hand.

MyOrbiter installs nothing without a click on *Update and restart*. A step back to an older build
(switching to a more stable channel that's behind) happens only on a click that names it, and a
native dialog asks once more. Updates are signed: a copy installs a download only if its signature
matches the key it was built with.

The first install is by hand, like any first install: download the AppImage or the setup.exe of a
build on the channel you want from *Releases*, then pick the channel in Settings → *Updates*. From
then on it updates itself. A build made on your own computer is version 0.1.0 (unless given
another) and is offered the channel's update like any older build: its AppImage and its Windows
installer check, and installing the update replaces your build with the published one (an
AppImage in a folder MyOrbiter can't write to is only told of it). A development build
(`npm run tauri dev`), the .deb and .rpm, and a build run straight from its folder don't check. A
copy of a build made before the project's time on GitLab (builds below 100) looks for updates at an
older address that isn't offered current builds: install a current build by hand once. Builds
made on GitLab (from 0.2.100) ask GitLab, whose channels keep offering the last build made there;
that build asks GitHub first, so a copy on it follows GitHub's builds from then on.

### From orbiter to MyOrbiter

Before the rename the app was called orbiter. orbiter and MyOrbiter shouldn't run side by side:
both would act on the same warframe.market account.

- **Linux:** the `myorbiter` `.deb` or `.rpm` replaces the `orbiter` package (with `apt`,
  `dpkg -i`, `dnf` or `rpm -U`), and `scripts/install-desktop.sh` removes the orbiter it installed.
  Delete an old orbiter AppImage by hand.
- **Windows:** uninstall orbiter first (Settings → Apps), leaving *Delete the application data*
  unticked, then install MyOrbiter.

orbiter's settings and data (the `dev.orbiter.app` folders) are kept: on its first start MyOrbiter
copies them to its own folders ([privacy.md](privacy.md)).
