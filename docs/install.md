# Installing orbiter

The README has the short version. This page has the details: each platform, a window that stays
blank, console players, the first start and updates.

## Downloads

Each build is on *Releases*. The Linux and Windows downloads carry TennoScope inside them, built
from `tennoscope/` in this repository (TennoScope with orbiter's changes, see
`tennoscope/ORBITER.md`), with the OCR engine its reward overlay uses. Nothing else needs
installing. On Windows the one exception is WebView2: Windows 11 and an updated Windows 10 already
have it, and on an older Windows 10 the installer fetches it.

### Linux and Steam Deck

`orbiter_<version>_amd64.AppImage`. Make it executable and open it:

- in Dolphin (the Deck's Desktop Mode): right-click → *Properties* → *Permissions* → *Is
  executable*, then double-click it;
- in a terminal: `chmod +x orbiter_*.AppImage`, then run it.

On a Deck, play in Desktop Mode to have orbiter beside the game. To start it from Game Mode, add it
in Steam with *Games → Add a Non-Steam Game*. Game Mode shows one app at a time, so you switch with
the Steam button.

### Windows

`orbiter_<version>_x64-setup.exe`. It installs for your user only, so no administrator is needed.
It isn't signed, so SmartScreen warns the first time: *More info → Run anyway*.

### macOS

There is no macOS download on the usual builds. A release run can build an Apple silicon `.dmg`
when one is asked for. Such a build isn't notarised: the first time, macOS refuses to open it, and
*System Settings → Privacy & Security → Open Anyway* lets it run. TennoScope doesn't run on macOS,
so a Mac has no inventory. Your warframe.market listings and sales, fissures, Baro and Varzia, the
world's clocks and the riven finder work; the collection pages stay empty. No channel carries a
macOS build, so it never updates itself.

### Xbox, PlayStation, Switch or mobile

Use the same download on a PC and pick your platform in Settings → *Platform* (signing in to
warframe.market sets it from your account). orbiter then reads and lists on that platform's market.
It can't read a game running on a console, so it shows only what works without it: Home (your
market, fissures, the world's clocks, what's worth doing today, Baro), Orders (list anything, keep
your listings at the cheapest in-game price, Sold when you sell one), Sales and the riven finder.
It doesn't know what you own or when a trade goes through, so it can't list things or mark them
sold by itself. The collection pages are PC only, and orbiter doesn't start TennoScope.

## Checking a download

Every release lists the SHA-256 of each of its files in `SHA256SUMS`, beside them. The README shows
the check on Linux and Windows; on macOS it's `shasum -a 256 --check --ignore-missing SHA256SUMS`.

Once the repository is public, each release also carries GitHub's record of where its files were
built: `gh attestation verify <file> --repo ShezissSnake/orbiter` checks that a file came from this
repository's release workflow, unchanged.

## If the window stays blank (Linux)

orbiter draws its window on the graphics card. If the window stays blank, flickers or closes as it
opens, start it once with `--compat-rendering`. For a Non-Steam Game in Steam, put it in the
shortcut's *Launch Options*; in a terminal, for example:

```fish
./orbiter_*.AppImage --compat-rendering
```

From then on it draws without the graphics card, slower but everywhere, until you turn off
*Compatibility rendering* in Settings → *Display* (or start once with `--no-compat-rendering`).
If an accelerated start closes within its first minute, the next start switches to compatibility
rendering by itself. With NVIDIA's driver, orbiter keeps the graphics card but passes frames
through shared memory.

WebKit's own variables (`WEBKIT_DISABLE_COMPOSITING_MODE`, `WEBKIT_FORCE_COMPOSITING_MODE`,
`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DMABUF_RENDERER_FORCE_SHM`,
`WEBKIT_FORCE_DMABUF_RENDERER`), when you set them yourself, override all of this. orbiter's log
(Settings → *Logs*) says which way each start drew.

## The first start and Full mode

On the first start orbiter walks you through what TennoScope needs, once, and asks whether
TennoScope should read your inventory: **Full mode**, off unless you turn it on (*Read my inventory
(Full mode)* there, in the TennoScope panel or in Settings). Full mode reads Warframe's memory to
fetch your inventory. Warframe's EULA forbids unauthorised third-party programs, so using it could
put your account at risk. orbiter only reads, and only sends your login session to Digital
Extremes.

Without Full mode, TennoScope reads only the game's log and the reward screen (Overlay mode), and
orbiter shows everything that doesn't need your inventory. With it, TennoScope reads your account
when you're in the game. Some Linux systems (Ubuntu among them) only let a program read another's
memory if it started it. orbiter tells you if yours does, with the command that allows it until you
restart.

## Updates

orbiter updates itself from this repository's releases (Settings → *Updates*). Each installed copy
follows one channel:

- **Stable** (the default): tested builds.
- **Beta**: the next Stable, a few days early.
- **Experimental**: every change, as soon as it's built. It may break.

A build keeps its version (`0.2.<n>`) on every channel. Moving it up a channel moves the same
files; it is never rebuilt.

How each kind updates:

- The Linux AppImage replaces its own file. It needs a folder you can write to; orbiter says so if
  it can't.
- The Windows installer runs by itself (passive mode) and restarts orbiter.
- A `.deb` or `.rpm` (only from a build of your own) and a macOS build are not updated by orbiter.

orbiter installs nothing without a click on *Update and restart*. A step back to an older build
(switching to a more stable channel that's behind) happens only on a click that names it, and a
native dialog asks once more. Updates are signed: a copy installs a download only if its signature
matches the key it was built with.

The first install is by hand, like any first install: download the AppImage or the setup.exe of a
build on the channel you want from *Releases*, then pick the channel in Settings → *Updates*. From
then on it updates itself. A build made on your own computer is version 0.1.0 and never updates
itself.
