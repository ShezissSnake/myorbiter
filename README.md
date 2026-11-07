# orbiter

orbiter is a desktop companion for Warframe, for Linux, the Steam Deck and Windows. It reads what
TennoScope stores on your PC (the game's log, the fissure reward screen and, if you allow it, your
inventory) and answers what the game doesn't: which reward to take, what to sell and for how much,
what's left to master, and which relics finish your sets. It can also keep your warframe.market
listings at the cheapest price in game.

**Unofficial.** orbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes.
Warframe and its artwork are © and ™ Digital Extremes Ltd.

![Home: the world's clocks, your orders and status, what's ready to list, and the open fissures with your best relic for each era](docs/screenshots/home.webp)

The screenshot shows an invented account (`demo/`), not a real one.

## Full mode is your call

With Full mode on (it's off unless you turn it on), TennoScope reads the game's memory to fetch
your inventory. That may violate Warframe's EULA, which forbids unauthorised third-party programs:
you choose whether to turn it on, at your own risk. It only reads, and only sends your login session
to Digital Extremes.

**It acts on your warframe.market account.** Once you sign in, what you press and the automatic
features you turn on (repricing, marking sales sold, +rep, hiding your last copies, holding your
online status) list, change and close orders and post reviews as you.

## Install

Download the latest Stable build from
[the website](https://sheziss-group.gitlab.io/orbiter/#download) (every build, Beta and
Experimental too, is on [Releases](https://gitlab.com/sheziss-group/orbiter/-/releases)).
TennoScope is inside it; there is nothing else to install.

- **Linux and Steam Deck:** `orbiter_<version>_amd64.AppImage`. Make it executable
  (`chmod +x orbiter_*.AppImage`, or *Properties → Permissions → Is executable* in Dolphin), then
  run it.
- **Windows:** `orbiter_<version>_x64-setup.exe`. It installs for your user only. It isn't signed,
  so SmartScreen warns the first time: *More info → Run anyway*.

If the window stays blank or flickers on Linux, start it once with `--compat-rendering`.
[docs/install.md](docs/install.md) has the details: the Steam Deck, consoles, macOS, updates.

### Checking a download

Download `SHA256SUMS` from the same release into the same folder, then:

- **Linux:** `sha256sum --check --ignore-missing SHA256SUMS`. It should say `OK` beside your file.
- **Windows (PowerShell):** `Get-FileHash .\orbiter_<version>_x64-setup.exe`, then compare the hash
  with its line in `SHA256SUMS`.

## Run it from source

You need Rust 1.95, Node 20.19+ or 22.12+, and webkit2gtk-4.1.
[docs/development.md](docs/development.md) has the rest.

```fish
npm install
npm run tauri dev        # a development window
npm run dev:demo         # the interface in a browser, on the invented account
npm test
```

## Licence

orbiter is free software under the GPL-3.0-only ([LICENSE](LICENSE)), with no warranty. The written
offer for the GPL and LGPL libraries in the downloads, and every other licence, are in
[NOTICE.md](NOTICE.md). Digital Extremes' artwork is not covered by the GPL.

## Reporting a bug

In orbiter, Shift+F1 opens *Report a bug*: it fills in an issue for you to check and send, and posts
nothing by itself. Security problems go through [SECURITY.md](SECURITY.md).

## More

- [The Guide](https://sheziss-group.gitlab.io/orbiter/guide/) (also in the app: F1) and
  [What's New](https://sheziss-group.gitlab.io/orbiter/whats-new.html)
- [docs/](docs/): what orbiter does, what it reads and sends, running it from source, releases
- [The website](https://sheziss-group.gitlab.io/orbiter/)
