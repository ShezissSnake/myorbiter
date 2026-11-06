# orbiter — first public release

orbiter is a free desktop companion for Warframe, for Linux, the Steam Deck, Windows and macOS. It
reads what TennoScope stores on your PC (your inventory, the game's log, the fissure reward screen)
and answers what the game doesn't:

- **Which reward to take.** On the fissure reward screen, the four cards are scored by what they're
  worth to you, and the best one says *Take this*.
- **What you can sell, and for how much.** Spares are worked out from your inventory and your own
  keep rules, priced against warframe.market's sellers who are in game, and never offered under what
  their ducats are worth to you.
- **What's left to master,** and how to get it: the Codex rings, the Foundry, what each set is
  missing and which of your relics finish it.
- **Your warframe.market listings, looked after.** Once you sign in, orbiter keeps your listings at
  the cheapest in-game price, marks a listing sold when the trade goes through in game, and gives
  +rep after a trade, each only if you turn it on.
- **Builds** for anything that takes mods, in three tiers, with what you're missing for each.

It runs on your PC and collects nothing about you. It talks only to the sites its features need:
warframe.market, the game's world state, GitHub for updates, and Nox's Frame when you ask for its
builds. Full mode, which reads your inventory from the game's memory, stays off until you turn it
on; read the warning beside the switch first, as Warframe's EULA forbids unauthorised third-party
programs.

## New since 0.1.48

### Selling

- **Sell spares, your way.** Putting spares on sale has a page of its own, after Orders. One row per
  kind (prime sets and parts, mods, arcanes, relics, weapon parts, resources, imprints) says how it
  sells; open one to choose whole sets or loose parts, how many copies to keep, and the rest. Each
  line of the plan says which rule put it there.
- **Never sell.** The ⋯ on a line of the plan leaves it out this once, or for good.
- **Only proven spares are listed.** Before anything goes up, orbiter checks your keep rules once
  more against your latest inventory and refuses what it can't prove is spare, saying why.
- **Repricing stops at 70%.** Automatic repricing never takes a listing under 70% of the price you
  last set or approved, so a seller who undercuts every few minutes can't walk yours down while
  you're away.
- **Never under its ducats.** A prime part or set is never proposed at or under what its ducats are
  worth to you, by any path.
- **Sold, once.** A trade with several items, or a Sold click, can't close more than you listed or
  log a sale twice.
- **One +rep per player,** and a +rep that failed is tried again later.
- **Told when you sell:** a notification for every sale in game, with a +rep button for the buyer.

### Builds

- Mod and arcane builds for anything that takes them, in three tiers (New player, Intermediate,
  Veteran), laid out as the Arsenal shows them, with what you're missing: mods and the Endo to rank
  them, arcanes, shards, the Catalyst, adapters and Forma.
- orbiter's own suggestion in variants, with Archon shards and a Helminth ability; tags such as Steel
  Path or Nuke to narrow the list.
- Nox's Frame's top builds for the item, read only when you ask, and Overframe's most popular ones as
  links to their pages.

### Updates and help

- **orbiter updates itself.** A new build shows in the corner with what changed. It downloads,
  checks its signature and restarts, never without your click. Choose Stable, Beta or Experimental in
  Settings → Updates.
- **Report a bug from the app** (Shift+F1): a short form that opens a GitHub issue in your browser
  for you to check and submit, or copies the report. orbiter never sends anything itself, and your
  sign-in and every player's name are taken out of the details it adds.
- Your version and channel are on the Guide's last line and in Settings.

### Looks

- Each section has its colour and sigil: Fissures, Progress, Collection, Trade.
- The reward screen drawn as the game draws it; relics by era; the Codex rings on Mastery, Foundry
  and Wishlist; the Arsenal showcase on the collection pages; a live market ticker on the Trade pages.
- Kitgun chambers, zaws, amps, MOAs, hounds and K-Drives each say how to get them and what's next.
- Smoother on Linux: the window draws on the graphics card again, NVIDIA included. If it opens blank
  or flickers, turn on Compatibility rendering in Settings → Display, or start once with
  `--compat-rendering`.

### Sturdier

- A damaged settings file can no longer turn automatic repricing on or remove a price floor: anything
  that isn't a proper value reads as the usual one.
- Odd data from the game's log, warframe.market or Nox's Frame no longer stops orbiter or records a
  wrong sale.
- Dates and countdowns hold across clock changes and in every time zone.
- On Windows, an update waits for TennoScope to close before installing, and saving settings retries
  when another program briefly holds the file.

## Install

- **Linux and Steam Deck:** `orbiter_<version>_amd64.AppImage`. Make it executable and open it.
- **Windows:** `orbiter_<version>_x64-setup.exe`. It installs for your user only. It isn't signed,
  so SmartScreen warns the first time: *More info → Run anyway*.
- **macOS (Apple silicon):** `orbiter_<version>_aarch64.dmg`. No inventory on a Mac (TennoScope
  doesn't run there); the market, fissures and the world's clocks work.

Each file's SHA-256 is in `SHA256SUMS`. The README has the details.

orbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes. It is free software
under the GPL-3.0, with no warranty.
