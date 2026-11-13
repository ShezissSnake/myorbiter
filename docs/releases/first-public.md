# MyOrbiter <0.2.N>: the first public Stable release

MyOrbiter is a free desktop companion for Warframe. It reads the game's log itself, and what
TennoScope stores on your PC (your inventory, the fissure reward screen), and answers what the game
doesn't: which reward to take, what you can sell and for how much, what's left to master and how to get it, which
relics finish your sets. It also looks after your warframe.market listings, each automatic feature
only if you turn it on. It runs on your PC and collects nothing about you.

MyOrbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes.

## Install

One download, nothing else to install. TennoScope and its OCR engine are inside it.

- **Linux and Steam Deck:** `myorbiter_<0.2.N>_amd64.AppImage`. Make it executable and open it: in
  Dolphin (the Deck's Desktop Mode) right-click → *Properties* → *Permissions* → *Is executable*,
  then double-click; in a terminal, `chmod +x myorbiter_*.AppImage` and run it. On a Deck, Desktop Mode
  keeps MyOrbiter beside the game.
- **Windows:** `myorbiter_<0.2.N>_x64-setup.exe`. It installs for your user only. It isn't signed, so
  SmartScreen warns the first time: *More info → Run anyway*.

Each release lists the SHA-256 of its files in `SHA256SUMS`. [Installing MyOrbiter](../install.md)
has the details, including what to do if the window opens blank (Compatibility rendering).

## Updates

MyOrbiter updates itself from this repository's releases. Choose a channel in Settings → *Updates*:

- **Stable** (the default): tested builds.
- **Beta**: the next Stable, a few days early.
- **Experimental**: every change, as soon as it's built. It may break.

Nothing installs without your click on *Update and restart*, and going back to an older build only
happens on a click that names it. Updates are signed; MyOrbiter installs a download only if its
signature matches.

## Full mode: your call

Full mode reads Warframe's memory to fetch your inventory. It is **off** unless you turn it on, and
the switch comes with a warning. Digital Extremes publishes no list of allowed or forbidden
third-party programs and leaves using them at your own risk, so using it could put your account at
risk. MyOrbiter does not call it safe, and you turn it on at your own risk. It doesn't write to the
game's memory, and the login session it finds there goes to Digital Extremes, for your inventory;
[What MyOrbiter reads and sends](../privacy.md) lists everything MyOrbiter and TennoScope read and
send. Without it, MyOrbiter still shows everything that doesn't need your inventory.

## Report a bug

Shift+F1 opens a short form. It never posts anything by itself: it opens a prefilled issue form in
your browser for you to check and submit, or copies the report. The technical details it adds are
shown before you send, with your sign-in and players' names taken out.

## Licence

MyOrbiter is free software under the GPL-3.0-only (`LICENSE`), with no warranty. Every release carries
its complete source as `myorbiter-source.tar.gz`. For the GPL and LGPL libraries bundled in the
downloads, each download lists them with their sources, and the complete corresponding source is
available on request for three years from the release: the written offer is in
[NOTICE.md](../../NOTICE.md). Digital Extremes' artwork is not covered by the GPL: the game icons
are © Digital Extremes, used to identify what they show.

## Credits

- **TennoScope**, by Deftera186 and its contributors (GPL-3.0-only), is merged into this repository
  with its history, and carries MyOrbiter's changes; see
  [`tennoscope/ORBITER.md`](../../tennoscope/ORBITER.md).
- **@wfcd/items** (MIT), whose game data fills the demo account behind the screenshots.
- **[Overframe](https://overframe.gg/)**: its popular builds are shown as links to their pages.
- **[Nox's Frame](https://noxsframe.com/)**: its top builds are read only when you ask.

[NOTICE.md](../../NOTICE.md) lists every other licence.

## Known limits

- There is no macOS build yet.
- On Linux, the first open of Mods, Arcanes, Sets and Planner is slower.
