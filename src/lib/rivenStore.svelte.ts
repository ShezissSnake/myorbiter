// warframe.market's riven data: weapon and stat names (cached for a day on the Rust side) and
// riven auctions, cached a few minutes per search so opening a card twice doesn't refetch.
import { market, saved as disk } from "./backend";
import { packListed, packPrices, startingFor, parseMyAuctions, parseWeeklyRivens, readSavedPrices, tradeUrl, withSaved, type AuctionItem, type MyAuction, type RivenAuction, type RivenMeta, type RivenTrade, type SavedRivenPrices } from "./core/rivens";

const TTL = 10 * 60_000;

class Rivens {
  meta = $state.raw<RivenMeta | null>(null);
  metaError = $state<string | null>(null);
  results = $state.raw<Record<string, { at: number; auctions: RivenAuction[] } | { at: number; error: string }>>({});
  private loading: Promise<RivenMeta | null> | null = null;

  async loadMeta(): Promise<RivenMeta | null> {
    if (this.meta) return this.meta;
    this.loading ??= market
      .rivenMeta()
      .then((m) => {
        this.meta = m;
        this.metaError = null;
        return m;
      })
      .catch((e) => {
        this.metaError = String(e).replace(/^Error:\s*/, "");
        this.loading = null;
        return null;
      });
    return this.loading;
  }

  static key(weapon: string, positive: string[], negative: string | null) {
    return `${weapon}|${[...positive].sort().join(",")}|${negative ?? ""}`;
  }

  async search(weapon: string, positive: string[], negative: string | null, maxAge = TTL): Promise<RivenAuction[]> {
    const key = Rivens.key(weapon, positive, negative);
    const hit = this.results[key];
    // Results are reused for a while; a failure isn't, so "Try again" really tries again.
    if (hit && !("error" in hit) && Date.now() - hit.at < maxAge) return hit.auctions;
    try {
      const auctions = await market.rivenAuctions(weapon, positive, negative);
      this.keep(key, { at: Date.now(), auctions });
      return auctions;
    } catch (e) {
      this.keep(key, { at: Date.now(), error: String(e) });
      throw e;
    }
  }

  // ------------------------------------------------------------ price checks kept between runs

  /** Your rivens' last price checks, read once per platform (see SavedRivenPrices). */
  saved = $state.raw<SavedRivenPrices | null>(null);
  private savedRead: { platform: string; done: Promise<SavedRivenPrices> } | null = null;
  async loadSaved(platform: string): Promise<SavedRivenPrices> {
    if (this.savedRead?.platform !== platform) {
      this.savedRead = {
        platform,
        done: disk
          .read("riven-prices")
          .then((raw) => (this.saved = readSavedPrices(raw, platform))),
      };
    }
    return this.savedRead.done;
  }
  /** Keeps a check of one of your rivens; written to disk a moment later, once for a run of them. */
  remember(platform: string, id: string, key: string, similar: RivenAuction[], weapon: string, listed: RivenAuction[] | undefined) {
    // Kept per platform: a check made after switching isn't filed under the old one.
    if (this.saved?.platform !== platform) return void this.loadSaved(platform);
    this.saved = withSaved(this.saved, Date.now(), { id, key, prices: packPrices(similar) }, listed ? { slug: weapon, listed: packListed(listed) } : undefined);
    clearTimeout(this.writeSoon);
    this.writeSoon = setTimeout(() => void disk.write("riven-prices", this.saved).catch(() => {}), 3000);
  }
  private writeSoon: ReturnType<typeof setTimeout> | undefined;

  // ------------------------------------------------------------ last week's trades in game

  /** DE's weekly riven trade figures for your platform (see core/rivens.ts, RivenTrade). */
  trades = $state.raw<RivenTrade[] | null>(null);
  /** The week the figures cover ("19–25 Oct"): the seven days before the Monday they were published. */
  tradesWeek = $state<string | null>(null);
  tradesError = $state<string | null>(null);
  private tradesFor: { platform: string; at: number } | null = null;
  /** The platform `trades` are for. */
  private tradesPlatform: string | null = null;
  /** Read once per platform, and again after six hours: the file changes on Mondays. */
  async loadTrades(platform: string) {
    if (this.tradesFor?.platform === platform && Date.now() - this.tradesFor.at < 6 * 3600_000) return;
    this.tradesFor = { platform, at: Date.now() };
    // Last read's figures show at once (they change once a week), until this read comes in.
    if (this.tradesPlatform !== platform) {
      const k = (await disk.read("riven-trades")) as { platform?: string; at?: number; week?: string | null; trades?: RivenTrade[] } | null;
      const kept = k?.platform === platform && typeof k.at === "number" && Date.now() - k.at < 8 * 86_400_000 && Array.isArray(k.trades);
      if (this.tradesFor?.platform === platform) {
        this.trades = kept ? k!.trades! : null;
        this.tradesWeek = kept ? (k!.week ?? null) : null;
        this.tradesPlatform = platform;
      }
    }
    try {
      const res = await fetch(tradeUrl(platform), { cache: "no-cache" });
      if (!res.ok) throw new Error(`warframe.com answered ${res.status}`);
      const trades = parseWeeklyRivens(await res.text());
      const published = Date.parse(res.headers.get("last-modified") ?? "");
      const week = Number.isFinite(published) ? weekBefore(published) : null;
      if (this.tradesFor?.platform !== platform) return;
      this.trades = trades;
      this.tradesWeek = week;
      this.tradesPlatform = platform;
      this.tradesError = null;
      void disk.write("riven-trades", { platform, at: Date.now(), week, trades }).catch(() => {});
    } catch (e) {
      // Tried again on the next visit to the page rather than in six hours.
      this.tradesFor = null;
      this.tradesError = String(e).replace(/^Error:\s*/, "");
    }
  }

  // ------------------------------------------------------------ your auctions

  /** Your riven auctions on warframe.market (signed in), from the last read. */
  mine = $state.raw<MyAuction[]>([]);
  mineAt = $state<number | null>(null);
  mineError = $state<string | null>(null);
  async loadMine() {
    try {
      this.mine = parseMyAuctions(await market.myAuctions());
      this.mineAt = Date.now();
      this.mineError = null;
    } catch (e) {
      this.mineError = String(e).replace(/^Error:\s*/, "");
    }
  }
  /**
   * Puts a riven up: `buyout` is the price to buy it outright; `starting` the lowest bid taken
   * (the same as the buyout: no bidding, it just sells at that price).
   */
  async sell(item: AuctionItem, buyout: number, starting: number, note = "", minRep = 0) {
    await market.createAuction({ starting_price: starting, buyout_price: buyout, minimal_reputation: minRep, private: false, note, item });
    await this.loadMine();
  }
  /**
   * A new buyout for one of your auctions. It stays what it was: one with no bidding (starting at
   * the buyout) keeps starting at the new buyout; one taking bids keeps its starting bid unless the
   * buyout goes under it; a hidden one stays hidden.
   */
  async reprice(a: MyAuction, buyout: number) {
    const starting = startingFor(a, buyout);
    await market.updateAuction(a.id, { starting_price: starting, buyout_price: buyout, minimal_reputation: a.minRep, private: !a.visible, note: a.note });
    await this.loadMine();
  }
  async close(a: MyAuction) {
    await market.closeAuction(a.id);
    await this.loadMine();
  }

  /** Stores a result; ones older than three times the cache life go, so hours of browsing don't pile up. */
  private keep(key: string, entry: { at: number; auctions: RivenAuction[] } | { at: number; error: string }) {
    const old = entry.at - 3 * TTL;
    const next: typeof this.results = {};
    for (const [k, v] of Object.entries(this.results)) if (v.at >= old) next[k] = v;
    next[key] = entry;
    this.results = next;
  }
}

/** "19–25 Oct": the seven days before a Monday the weekly figures came out (UTC). */
export function weekBefore(publishedMs: number): string {
  const day = 86_400_000;
  const monday = Math.floor(publishedMs / day) * day;
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const from = monday - 7 * day;
  const to = monday - day;
  const a = fmt(from);
  const b = fmt(to);
  return a.split(" ")[1] === b.split(" ")[1] ? `${a.split(" ")[0]}–${b}` : `${a} – ${b}`;
}

export const rivens = new Rivens();
