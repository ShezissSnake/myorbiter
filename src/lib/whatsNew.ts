// What changed, newest first: shown once after an update (WhatsNew.svelte, the update screen), and
// on the Guide. One entry per batch of builds. The update screen shows what's new since the entry
// last seen; the Guide lists every day's entries together, as one update each. From
// entry 11 on, each change is an item: an icon, a few words for a title, a line on it as a player
// would put it (page names and game words in it get their icons, core/richText.ts) and where to see
// it, down to the spot on the page (Show me, and the tour). Older entries are a sentence each.

export interface NewsItem {
  title: string;
  text: string;
  /**
   * The game's icon, one of orbiter's line icons, a page's own sidebar icon, or the four sections'
   * sigils in their colours.
   */
  icon: { game: string } | { line: string } | { page: string } | { sections: true };
  /**
   * Where to see it, as App's links put it: a page, filters, and a spot on it that Show me lights
   * ("market?spares=1#spares", "home#today": a `data-card` or an id on the page, or in the sidebar).
   */
  open?: string;
}

export interface NewsEntry {
  /** One more than the entry before: what "seen" remembers (several builds can come out a day). */
  id: number;
  /** The day it came out. */
  date: string;
  items: (string | NewsItem)[];
}

export const NEWS: NewsEntry[] = [
  {
    id: 16,
    date: "2026-11-04",
    items: [
      { title: "Only proven spares go on sale", icon: { page: "market" }, text: "Before anything goes up on warframe.market (Put my spares on sale, the listing form, more copies on Orders, a hidden listing shown again) orbiter checks the keep rules once more against your latest inventory, and refuses what it can't prove is spare, saying why: no recent inventory read, a Requiem mod while Kuva or Tenet weapons are left, copies installed in a build, a prime set or part worth its ducats. A prime set is weighed whole against all its parts' ducats at your rate, and goes to Baro unless platinum clearly beats them (by a fifth, 2p at least). A Requiem listing an earlier build made comes down when you plan. Each listing orbiter makes is written to its log with why it was spare.", open: "market?spares=1#spares" },
      { title: "orbiter updates itself", icon: { line: "refresh" }, text: "A new build shows in the corner with what changed and Update and restart: it downloads, checks its signature and restarts into it, never without your click (Later hides it until the next one). Pick your channel in Settings, Updates: Stable (tested builds), Beta (the next Stable, a few days early) or Experimental (every change as soon as it's built, may break). There too: Check now, the version you're on and where it came from, and the release notes. The Linux AppImage and the Windows installer update this way; a .deb or .rpm goes through your package manager.", open: "settings#updates" },
      { title: "Which build you're on", icon: { line: "guide" }, text: "The Guide's last line, this screen and Settings say your version and the channel it came from (0.1.52 · Beta), beside the commit it was built from. Say it when you report a problem.", open: "guide#build" },
      { title: "Smoother on Linux", icon: { line: "refresh" }, text: "On Linux the window draws on the graphics card again, NVIDIA cards included, so scrolling Foundry, Relics and the other card pages and every animation run smoother. Cards are also cheaper to draw everywhere. If the window ever opens blank or flickers, turn on Compatibility rendering in Settings, Display, or start orbiter once with --compat-rendering.", open: "settings#display" },
      { title: "Report a bug from the app", icon: { line: "bug" }, text: "Something not working? Report a bug (Settings, the Guide, or Shift+F1) opens a short form: what happened, and how to make it happen again if you know. Open on GitHub fills in a new issue for you to check and submit in your browser; orbiter never sends anything itself. It can add technical details you read first (version, system, the log's last lines, with sign-ins and every player's name hidden), and Copy report puts it all on the clipboard if you don't have a GitHub account.", open: "guide#report-bug" },
      { title: "Build links go where they say", icon: { line: "external" }, text: "Overframe's and Nox's Frame's build names show as their authors wrote them, minus invisible characters that could disguise them, and every one opens only its own build page on overframe.gg or noxsframe.com.", open: "builds?item=Saryn Prime#popular" },
    ],
  },
  {
    id: 15,
    date: "2026-11-03",
    items: [
      { title: "Builds", icon: { page: "builds" }, text: "Mod and arcane builds for anything that takes them, in three tiers by how far along you are (New player, Intermediate, Veteran), laid out as the Arsenal shows them, with what you're missing for each: mods and the Endo to rank them, arcanes, shards, the Catalyst, adapters and Forma, and the cheapest seller's whisper for what you lack. Paste a build from anywhere (Nox's Frame, a friend, Discord), make your own, or start from orbiter's suggestion. Builds on any item's details opens it.", open: "builds#hero" },
      { title: "orbiter's suggestion, whole", icon: { game: "archon-shard" }, text: "orbiter's own build comes in variants (Star Chart, Steel Path nuke…), with its Tauforged Archon shards and Helminth ability in the grid and, under With it, the companion or primer, support weapons, Focus and mod sets that go with it, ✓ for what you hold. A weapon's shows its ideal riven (CC · CD · MS) and how close yours come.", open: "builds?item=Saryn Prime#withit" },
      { title: "Tags", icon: { line: "list" }, text: "Steel Path, Support, Shield gating, Nuke and the rest: pick tags above the builds to see only the ones carrying them, in every tier.", open: "builds?item=Saryn Prime#tags" },
      { title: "Nox's Frame's top builds", icon: { line: "import" }, text: "Under the tiers, the item's 5 most voted builds on Nox's Frame updated in the last two years (Hide older than changes that). Open one to see it in its tier with what you're missing; orbiter reads them only when you ask, never in the background.", open: "builds?item=Saryn Prime#nox" },
      { title: "Popular on Overframe", icon: { line: "external" }, text: "Up to 5 of the item's builds with 10 votes or more from the last two years, from orbiter's copy of Overframe's lists, taken with its permission. They're links: each opens on overframe.gg, so its author gets the visit.", open: "builds?item=Saryn Prime#popular" },
      { title: "Part recipes", icon: { game: "foundry" }, text: "Kitgun chambers, zaw strikes, amp prisms, MOAs, Hounds, Predasites and Vulpaphylas list their best part recipes beside their builds.", open: "builds?item=Catchmoon#recipes" },
      { title: "Full mode, only if you want it", icon: { line: "lock" }, text: "Reading your inventory from the game's memory is off until you turn it on (Read my inventory), with a plain warning beside the switch: Warframe's EULA forbids unauthorised third-party programs. Without it, orbiter reads only the log and the reward screen, and can't tell what you hold for a build.", open: "guide#fullmode" },
    ],
  },
  {
    id: 14,
    date: "2026-11-03",
    items: [
      { title: "Modular gear, where it belongs", icon: { game: "amp" }, text: "Kitgun chambers (Catchmoon and the rest) show under Primary and Secondary both, counted once in every total; amps and K-Drives have rings of their own on Mastery, Foundry and Wishlist, and companion weapons and the Plexus are with Companions. The Other ring is gone.", open: "foundry?group=primary&q=kitgun#chamber" },
      { title: "The next step for each", icon: { game: "solaris-united" }, text: "Every kitgun chamber, zaw strike, amp prism, MOA or hound model and K-Drive board says how to get it, then what's next once you have it: assemble it, gild it, or level it once gilded. Most modular gear only gives mastery after it's gilded; K-Drives never need it.", open: "mastery?group=amps#next-step" },
    ],
  },
  {
    id: 13,
    date: "2026-11-03",
    items: [
      { title: "Told when you sell", icon: { game: "platinum" }, text: "Every sale in game gets a notification: what you sold, to whom, for how much platinum, and whether its listing was marked sold on warframe.market. No more checking the website. Signed in and giving +rep by hand? The notification has a +rep button for the buyer, in orbiter and on your desktop.", open: "sales#notices" },
    ],
  },
  {
    id: 12,
    date: "2026-11-03",
    items: [
      { title: "Each section its own colour", icon: { sections: true }, text: "Fissures in Void violet, Progress in mastery teal, Collection in the Arsenal's steel, Trade in market gold, each with its sigil over the page's title and on its label in the sidebar (a rule in its colour between the icons when the sidebar is folded). You can tell where you are at a glance.", open: "relics#sections" },
      { title: "Current fissure, as the reward screen", icon: { game: "void-tear" }, text: "On the reward screen, the four rewards stand as the game shows them: art large, rarity along the bottom, the one to take lit in Void violet with Take this. Before it opens, the squad's four relics stand in their places, with Your relic on yours when the game's log tells which; between fissures, the last fissure's relics stay until the next loads.", open: "mission#hero" },
      { title: "Your relics on a plate", icon: { game: "relic-axi-radiant" }, text: "Relics and Planner open on each era's relics and radiant copies, with the Void Traces meter against your cap. Click an era to show only it.", open: "relics#hero" },
      { title: "The Codex rings", icon: { game: "mastery" }, text: "Mastery, Foundry and Wishlist open on the Codex: a ring for each category, filled by what you've mastered of it, with its name and count. On Mastery and Foundry, click one to show only that category, or All for every one; the line under them names what to build, level or get next. On Wishlist, a gold ★ counts what you starred in each.", open: "mastery#hero" },
      { title: "The Arsenal showcase", icon: { game: "warframes" }, text: "Inventory, Prime parts, Sets, Mods, Arcanes and Rivens open on up to five pieces, large, the way the Arsenal shows gear: your most valuable spares (Sets: the sets to sell; Rivens: your best-graded rivens). Click one for its details.", open: "inventory#hero" },
      { title: "The market ticker", icon: { game: "market" }, text: "Orders, Browse market, Sales and Stats carry a line of live figures (two on a narrow window) (trades left, listed value, today's sales), with a gold ▲ or ▼ on any that moved since you last looked.", open: "market#hero" },
      { title: "An update screen, with a tour", icon: { line: "guide" }, text: "What's New opens like the game's own: the biggest change first, the rest in a list, older ones folded. Take the tour shows you each change on its own page. Every update stays listed at the end of the Guide.", open: "guide#news" },
      { title: "Show me", icon: { line: "search" }, text: "Press it on any change to open that page with the changed part lit up.", open: "guide#showme" },
      { title: "Icons in the text, like the wiki", icon: { game: "platinum" }, text: "In What's New and the Guide, a page's name takes you there, and platinum, ducats, Void Traces, Kuva and the rest carry their game icon.", open: "guide#walks" },
    ],
  },
  {
    id: 11,
    date: "2026-11-03",
    items: [
      { title: "Requiem and Antivirus mods kept", icon: { game: "kuva" }, text: "Five of each, while a Kuva, Tenet or Coda weapon is left to master; copies beyond five can go. Mods says which weapons they're kept for.", open: "mods#liches" },
      { title: "A settled sidebar", icon: { line: "list" }, text: "Each section answers one question. Fissures: what should I crack? Progress: what's left to get? Collection: what do I hold, and what do I keep or sell? Trade: your activity on warframe.market.", open: "home#sections" },
      { title: "Never sold under its ducats", icon: { game: "ducats" }, text: "A prime part or set is judged at the price it would actually list at, and Reprice never takes one down to its ducat value. A set is weighed whole against all its parts' ducats.", open: "parts" },
      { title: "Trade tax, corrected", icon: { game: "credits" }, text: "Warframe charges whoever receives: selling costs you 500 credits for each platinum you're paid. The buyer pays the item's own tax.", open: "market?spares=1#spares" },
      { title: "Orders, rearranged", icon: { page: "market" }, text: "Put my spares on sale sits at the top, folded; applying a plan ticks each change off as it's sent. Sort the table by any column, see who whispered you, go invisible when your trades run out.", open: "market#sort" },
      { title: "Chores to tick off", icon: { game: "nightwave" }, text: "Worth doing today has a box for each chore, cleared at its reset, Kahl's Garrison and Netracells included; Nightwave tasks and Archimedea risks spelled out; +2 for each era's next best relics.", open: "home#today" },
      { title: "The same number, the same name", icon: { page: "inventory" }, text: "Spare value on Inventory, Worth selling on Prime parts, Mods and Arcanes, Ready to list on Home, and Stats agrees with Inventory.", open: "inventory" },
      { title: "One toolbar on every list", icon: { line: "rows" }, text: "Foundry and Rivens sort, count and switch to a table like the rest; Clear when a filter hides everything; Sell everywhere for selling.", open: "foundry" },
      { title: "Your foundry", icon: { game: "foundry" }, text: "Foundry shows what's building and what's ready to claim, soonest first.", open: "foundry#queue" },
      { title: "Your Void Traces", icon: { game: "void-traces" }, text: "Relics and Current fissure show your Void Traces against the cap; Ctrl+K finds anything warframe.market trades.", open: "relics#traces" },
      { title: "Sturdier", icon: { line: "check" }, text: "A page that hits an error offers Try again; number boxes take whole numbers; dialogs keep keyboard focus; Ctrl+1…9 lands on the page." },
    ],
  },
  {
    id: 10,
    date: "2026-11-03",
    items: [
      "Simpler pages: Details, by each page's title, shows the sentence under every figure, the full description and every column; off (the start), the rest is on hover. Filters most visits don't need sit under More filters ▾, with a count when any are set. Page modes are tabs.",
      "Buttons that take a while fill up as they work: Sync until the new inventory read arrives, Check prices and Reprice with a count, Plan and Apply the plan, Check prices on Rivens. Copy buttons say Copied ✓. Saving, removing or marking a listing sold shows on its row, and dismissing an alert, unstarring or removing a price alert can be undone.",
      "Orders: a listing for more than you hold keeps to one line, with \"You hold 2 · 3 gone since you listed. Sold?\" under it; a Check prices or Reprice that fails says why, with Try again. Sync is done only when an inventory read newer than your press arrives.",
      "Home: Bounties and Worth doing today fold to a line each (click for everything), a smaller prices note and \"Synced 5 d ago\" in the sidebar. Current fissure shows the six best rewards first (Show all for the rest), with the squad's relics behind a click.",
      "Looks: relic rewards drawn as on the reward screen (a square with a rarity bar), rarity colours everywhere, Meso and Requiem off the green and red that mean good and bad, faction sigils you can read on dark, and the game's icons for Duviri, the Archon and its shard, Regal Aya, bounties, the resets, Amp and Plexus.",
      "Game: invasions for a Catalyst, Reactor, Forma or Exilus are flagged; Forma blueprints valued on the reward screen; Copy recruit line says when the squad's relics don't make a 4b4; Teshin says when Umbra Forma is next; Deep and Temporal Archimedea, the 1999 Calendar and Descendia in Worth doing today; Baro's best ducat flips; the trade tax in the sell plan; a harmless riven curse says so; quick missions marked on the fissure board; Incarnon picks skip weapons that already have the adapter.",
    ],
  },
  {
    id: 9,
    date: "2026-11-03",
    items: [
      "Fissures told apart by shape: a glyph for each mission type (Survival's hourglass, Defense's shield, Spy's eye…) and the era's relic on every card. Relic rewards show their rarity with a mark, not just the ring's colour.",
      "Trades left today: your Mastery Rank's worth of trades, counted from the game's log, on Home and Orders. Put my spares on sale and Mods say how many days of trades selling it all would take.",
      "Ctrl+K (or the magnifier by Sync) finds any item, prime part, relic, mod or arcane by name and opens it.",
      "Price alerts: Alert me in Post a buy order, and Cheap buys tells you when someone lists it at your price or less.",
      "One way of counting what you can spare, on Inventory, Stats and the selling pages; Inventory opens on what your spares would sell for. \"Not worth a trade under 5p\" is judged per trade, so five 3p barrels sell together.",
      "Planner: odds averaged over the copies you hold (one radiant no longer stands for 18 intact), solo or radshare as set on Relics, a Finishes column, and your Void Trace cap. Recruit on the fissure board copies a squad line.",
      "The sidebar: Orders leads Trade, with Mods, Arcanes and Rivens beside the other selling pages; Market is now Browse market.",
      "Smaller things: Nightwave's dailies first, clearer Sold? questions on Orders, world clocks that keep their names on a laptop, shorter page headers, tooltips when you tab onto a button, and a fissure that went quiet 45 minutes ago no longer shows as live.",
    ],
  },
  {
    id: 8,
    date: "2026-11-02",
    items: [
      "Fissures and relics wear their era's colour, as the relics are cast in game: Lith copper, Meso green-tarnished steel, Neo silver, Axi gold, Requiem crimson, Omnia the Void's violet. The Watching column shows each fissure as a card, grouped by era (or soonest first with Only my alerts), and its alerts, clocks, Foundry and bounties as cards too.",
      "The game's own icons in more places: each mission's enemy as its faction sigil (Grineer, Corpus, Infested, Corrupted, the Murmur…), the Steel Path and Void Storm marks, relics by era and refinement on Current fissure, the Arsenal's icon beside each item's kind, and an icon where an item has no artwork yet. Home's Needs you is a card each: the reward's artwork, where, whom to fight or side with, and how far an invasion is.",
      "orbiter keeps a log (Settings, Logs): TennoScope starting or failing, every change made to your listings and every request warframe.market turned down, and errors in the window. Never your sign-in. Open it, and TennoScope's, from there when something misbehaves.",
      "The reward screen reads cards from the newest relics. TennoScope's relic list is a fixed snapshot, so a card from a relic added since (Gyre Prime Blueprint, from Axi S21) was read as the nearest name it knew. orbiter now hands it the current drop tables, from TennoScope's next start.",
    ],
  },
  {
    id: 7,
    date: "2026-11-02",
    items: [
      "Sets, Saving up: easiest to finish first. About how many relic cracks each set takes (each missing part at the best chance you can crack for it), and the chance the relics you hold finish it.",
      "Stats: the parts you got in the span, from relics, missions or anything but a trade, with what they're worth.",
      "A notification when a set you were saving parts for is complete and ready to sell (Notifications, Trading).",
      "A part claimed from the foundry no longer counts as one you got.",
    ],
  },
  {
    id: 6,
    date: "2026-11-02",
    items: [
      "A TennoScope that stops as soon as it starts is no longer started again every 15 seconds (a window flashing up): orbiter waits longer each time, and says why from TennoScope's own log, with what to do when it's an older TennoScope than the one that last opened your data.",
    ],
  },
  {
    id: 5,
    date: "2026-11-02",
    items: [
      "Prime parts wait for their set: a loose part isn't sold alone when its set sells for clearly more (10% and 5p or better) and you can still get the missing parts (a relic you own, relics that still drop, Varzia, or parts you keep getting). Sets, Saving up shows what's waiting, what's left and where from. Turn it off in Settings, Selling.",
      "orbiter counts the parts you get between inventory reads, from relics or anything else, trades left out: Got (30d) on Prime parts, and on Saving up. A part you keep getting (a Lato Vandal part, say) counts as one you can finish a set with.",
      "Sets you can sell shows what each set sells for over its parts, and how much faster it sells than its slowest part.",
      "Home's fissure board marks the eras where a relic of yours drops a part a set you're saving for is missing.",
    ],
  },
  {
    id: 4,
    date: "2026-11-02",
    items: [
      "Fissure alerts take several choices in each menu: Steel Path and Void Storm, Axi or Neo, Defense, Mobile Defense or Survival in one alert. Your alerts so far carry over.",
      "Only my alerts, on Home's fissure board, shows just the fissures your alerts match, every kind together (SP and Storm marked).",
    ],
  },
  {
    id: 3,
    date: "2026-11-02",
    items: [
      "Safer repricing: one seller far under everyone else isn't followed down (Orders says so), and on the timer a price is never more than halved without you pressing Reprice.",
      "Mods with variants (atragraph Serration), fish sizes and Ayatan sculptures with stars are priced and counted as their own listings, and a trade from the game marks a listing sold only when you were paid near its price.",
      "Online in game shows only while Warframe runs (as TennoScope sees it); Online until then.",
      "This list: shown once after each update, and kept at the end of the Guide with which build you're running.",
    ],
  },
  {
    id: 2,
    date: "2026-11-02",
    items: [
      "Rivens: an Estimate on each price-checked riven, from orbiter's own price model (trained on about 80,000 listings): what rivens like it are listed for, a range, and what each stat does to it. Sort by it, see a total, and see it for both rolls when you cycle.",
      "Find a riven: each listing's estimate, a mark on the ones well under it, and a Best deal sort. Sell starts the buyout at the estimate.",
      "Orders: your riven auctions are listed, with their estimate, a price change and Take down.",
      "Cycling a riven: both rolls show over the game for 25 seconds (Settings, Overlays). Set a riven key there to read them from in game without switching windows.",
      "Inventory, Not needed: gear you can't trade and don't need any more (the plain version once you own the Prime, extra copies), with what's kept back and why.",
      "Rivens sort by Any price and Similar price; Hek and Dark Split-Sword rivens price check again.",
      "Orders shows as cards in a narrow window.",
    ],
  },
  {
    id: 1,
    date: "2026-11-01",
    items: [
      "orbiter keeps what it last read and shows it at once on the next start: fissures, Baro, the clocks and riven prices. Each fissure, alert or offer goes when it ends.",
      "Home: Duviri's mood as a clock, the Sortie's modifiers and reward chances, an Events card, and when the world was last read.",
      "A note says when item prices are a day or more behind warframe.market's figures.",
      "Ayatan sculptures list on warframe.market again.",
      "When api.warframestat.us is down, fissures, bounties, Baro and the clocks come from the game's own worldstate.",
    ],
  },
];

export const NEWEST = String(NEWS[0].id);

/**
 * Where a change's Show me goes, by name: a page, or Settings (its panel opens at the section,
 * "settings#updates"). Null for anything else.
 */
export function showMeTarget(to: string, pageLabel: (page: string) => string | null): { label: string } | null {
  const page = to.split("#")[0].split("?")[0];
  if (page === "settings") return { label: "Settings" };
  const label = pageLabel(page);
  return label ? { label } : null;
}

/** One update as the update screen shows it: the entries out the same day, newest first. */
export interface NewsBatch {
  date: string;
  /** The entries' ids, newest first. */
  ids: number[];
  items: (string | NewsItem)[];
}

/** Entries (newest first) gathered into updates: the entries out on the same day are one. */
export function batches(entries: NewsEntry[]): NewsBatch[] {
  const out: NewsBatch[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) {
      last.ids.push(e.id);
      last.items.push(...e.items);
    } else out.push({ date: e.date, ids: [e.id], items: [...e.items] });
  }
  return out;
}

/** The changes in an update that have a place to show, in order: the tour's stops. */
export const tourStops = (items: (string | NewsItem)[]): NewsItem[] => items.filter((x): x is NewsItem => typeof x !== "string" && !!x.open);

/** The entries since the one last seen (all of them for "", or anything that isn't an id). */
export const newsSince = (seen: string) => {
  const last = /^\d+$/.test(seen) ? Number(seen) : 0;
  return NEWS.filter((n) => n.id > last);
};

/**
 * What the update screen shows: the changes since the entry last seen (at most the last `max`
 * entries), by day, newest first; how many changes that is; and the tour of all of them. The Guide
 * instead lists every day whole, each with a tour of its own (`batches`, `tourStops`).
 */
export function sinceSeen(seen: string, entries: NewsEntry[] = NEWS, max = 3) {
  const last = /^\d+$/.test(seen) ? Number(seen) : 0;
  const updates = batches(entries.filter((n) => n.id > last).slice(0, max));
  const items = updates.flatMap((u) => u.items);
  return { updates, count: items.length, stops: tourStops(items) };
}
