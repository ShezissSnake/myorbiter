// What changed, newest first: shown once after an update (WhatsNew.svelte), and on the Guide.
// One entry per batch of builds; a line per change, in a sentence, as a player would put it.

export interface NewsEntry {
  /** Its id, and the day it came out. */
  date: string;
  items: string[];
}

export const NEWS: NewsEntry[] = [
  {
    date: "2026-11-02",
    items: [
      "Rivens: an Estimate on each price-checked riven, from orbiter's own price model (trained on about 80,000 listings): what rivens like it are listed for, a range, and what each stat does to it. Sort by it, see a total, and see it for both rolls when you cycle.",
      "Find a riven: each listing's estimate, a mark on the ones well under it, and a Best deal sort. Sell starts the buyout at the estimate.",
      "Orders: your riven auctions are listed, with their estimate, a price change and Take down.",
      "Cycling a riven: both rolls show over the game for 25 seconds (Settings, Overlays). Set a riven key there to read them from in game without switching windows.",
      "Inventory, Not needed: gear you can't trade and don't need any more (the plain version once you own the Prime, extra copies), with what's kept back and why.",
      "Rivens sort by Any price and Similar price; Hek and Dark Split-Sword rivens price check again.",
      "Orders shows as cards in a narrow window.",
      "Safer repricing: one seller far under everyone else isn't followed down (Orders says so), and on the timer a price is never more than halved without you pressing Reprice.",
      "Mods with variants (atragraph Serration), fish sizes and Ayatan sculptures with stars are priced and counted as their own listings, and a trade from the game marks a listing sold only when you were paid near its price.",
      "Online in game shows only while Warframe runs; Online until then.",
      "This list: shown once after each update, and kept at the end of the Guide with which build you're running.",
    ],
  },
  {
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

export const NEWEST = NEWS[0].date;

/** The entries since the one last seen (all of them for "" ). */
export const newsSince = (seen: string) => NEWS.filter((n) => n.date > seen);
