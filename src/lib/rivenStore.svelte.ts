// warframe.market's riven data: weapon and stat names (cached for a day on the Rust side) and
// riven auctions, cached a few minutes per search so opening a card twice doesn't refetch.
import { market } from "./backend";
import { parseMyAuctions, type AuctionItem, type MyAuction, type RivenAuction, type RivenMeta } from "./core/rivens";

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
        this.metaError = String(e);
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
  async reprice(a: MyAuction, buyout: number, starting: number) {
    await market.updateAuction(a.id, { starting_price: starting, buyout_price: buyout, minimal_reputation: a.minRep, private: false, note: a.note });
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

export const rivens = new Rivens();
