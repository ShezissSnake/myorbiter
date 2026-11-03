// What changed, newest first: shown once after an update (WhatsNew.svelte), and on the Guide.
// One entry per batch of builds; a line per change, in a sentence, as a player would put it.

export interface NewsEntry {
  /** One more than the entry before: what "seen" remembers (several builds can come out a day). */
  id: number;
  /** The day it came out. */
  date: string;
  items: string[];
}

export const NEWS: NewsEntry[] = [
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
    date: "2026-11-03",
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

/** The entries since the one last seen (all of them for "", or anything that isn't an id). */
export const newsSince = (seen: string) => {
  const last = /^\d+$/.test(seen) ? Number(seen) : 0;
  return NEWS.filter((n) => n.id > last);
};
