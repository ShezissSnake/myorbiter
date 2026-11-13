// warframe.market's riven data: weapon and stat names (cached for a day on the Rust side) and
// riven auctions, cached a few minutes per search so opening a card twice doesn't refetch.
import { market, onSearchWait, saved as disk } from "./backend";
import type { RivenModel } from "./core/rivenModel";
import { waitWords } from "./core/marketWait";
import { packListed, packPrices, startingFor, isAuctionOf, mayBeAuctionOf, sameRiven, parseMyAuctions, parseWeeklyRivens, readSavedPrices, tradeUrl, withSaved, type AuctionItem, type MyAuction, type RivenAuction, type RivenMeta, type RivenTrade, type SavedRivenPrices } from "./core/rivens";

const TTL = 10 * 60_000;
/** How often the pages read your riven auctions at most (`refreshMine`). */
export const MINE_EVERY_MS = 5 * 60_000;
/** After a failed read, how long until the pages try again. */
const MINE_RETRY_MS = 60_000;
/** How old a read of your auctions putting one up may go by (as the pages read them before). */
const SELL_FRESH_MS = 30_000;

class Rivens {
  meta = $state.raw<RivenMeta | null>(null);
  metaError = $state<string | null>(null);
  results = $state.raw<Record<string, { at: number; auctions: RivenAuction[] } | { at: number; error: string }>>({});
  private loading: Promise<RivenMeta | null> | null = null;

  /**
   * While a search, or a riven being put up, waits for warframe.market's contract budget (10 a
   * minute, kept in market.rs): when the queued one goes (unix ms). Requests wait their turn; none
   * is dropped. Null otherwise.
   */
  searchWait = $state<number | null>(null);
  private waitDone: ReturnType<typeof setTimeout> | undefined;
  private waitListener: Promise<() => void> | null = null;
  /** Hears from the Rust side when a riven request (a search, or putting one up) waits its turn. */
  private listenForWaits() {
    this.waitListener ??= onSearchWait((until) => this.waiting(until)).catch(() => () => {});
  }
  /** A search queued until `until`: shown until then, or a later one's time. */
  waiting(until: number) {
    if (this.searchWait != null && this.searchWait > until) return;
    this.searchWait = until;
    clearTimeout(this.waitDone);
    this.waitDone = setTimeout(() => (this.searchWait = null), Math.max(0, until - Date.now()) + 500);
  }

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
    this.listenForWaits();
    try {
      const auctions = await market.rivenAuctions(weapon, positive, negative);
      this.keep(key, { at: Date.now(), auctions });
      return auctions;
    } catch (e) {
      this.keep(key, { at: Date.now(), error: String(e) });
      throw e;
    }
  }

  // ------------------------------------------------------------ the price model

  /** MyOrbiter's riven price model (core/rivenModel.ts), loaded when the Rivens page first wants it. */
  model = $state.raw<RivenModel | null>(null);
  private modelLoad: Promise<void> | null = null;
  loadModel() {
    this.modelLoad ??= import("./data/riven-model.json")
      .then((m) => {
        this.model = (m.default ?? m) as unknown as RivenModel;
      })
      .catch(() => {
        this.modelLoad = null;
      });
    return this.modelLoad;
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
  /** When the pages last asked for your auctions (`refreshMine`), and for whose. */
  private mineAsked: { at: number; who: string } | null = null;
  /**
   * The pages' read of your auctions (Orders, Rivens, while one of them is on screen): at most once
   * every 5 minutes for the same account and platform (`who`); another one reads at once, and a
   * read that failed is tried again after a minute. Putting one up, repricing or closing one reads
   * them again at once (`loadMine`).
   */
  async refreshMine(who: string, now = Date.now()) {
    const last = this.mineAsked;
    if (last && last.who === who && now - last.at < MINE_EVERY_MS) return;
    const asked = (this.mineAsked = { at: now, who });
    const ok = await this.loadMine();
    if (!ok && this.mineAsked === asked) this.mineAsked = { at: now - MINE_EVERY_MS + MINE_RETRY_MS, who };
  }
  /** A create failed and the read after it did too: it may have been made, so the next Sell reads first. */
  private unchecked = false;
  /**
   * Moved each time a create ends and each time one of Sell's own reads ends. A read sent before
   * that and answered after it is out of date (each request runs on its own thread in the app, so
   * answers can come back in any order): its list could lack an auction just made, which would let
   * that riven be sent again. Such an answer changes neither the list nor its time.
   */
  private epoch = 0;
  /**
   * Reads your auctions: the list, or null if the read failed. Kept as `mine` unless the answer is
   * out of date (`epoch`); one of Sell's own reads (`own`) moves `epoch` when it ends.
   */
  private async readMine(own: boolean): Promise<MyAuction[] | null> {
    const asked = this.epoch;
    try {
      const list = parseMyAuctions(await market.myAuctions());
      if (asked === this.epoch) {
        this.mine = list;
        this.unchecked = false;
        this.mineAt = Date.now();
        this.mineError = null;
      }
      return list;
    } catch (e) {
      // Sell's own read keeps its reason for the message it shows, however late it came back.
      if (own || asked === this.epoch) this.mineError = String(e).replace(/^Error:\s*/, "");
      return null;
    } finally {
      if (own) this.epoch++;
    }
  }
  /**
   * Reads your auctions (the pages, a reprice, a close); whether the read worked. An answer that
   * came back out of date is dropped and counts as worked: the Sell read sent after it keeps the
   * fresher list, and nothing waits to try it again.
   */
  async loadMine(): Promise<boolean> {
    const asked = this.epoch;
    const list = await this.readMine(false);
    return list != null || asked !== this.epoch;
  }
  /** Rivens being put up now: a second Sell for one of them is refused until the first has ended. */
  private sending: AuctionItem[] = [];
  /** Rivens whose create failed and wasn't found by the look after it: their next Sell reads first, however fresh the list. */
  private notFound: AuctionItem[] = [];
  /**
   * Puts a riven up: `buyout` is the price to buy it outright; `starting` the lowest bid taken
   * (the same as the buyout: no bidding, it just sells at that price). `others`: the player's
   * other rivens of its weapon and name (core/rivens.ts, othersLike), so that an auction of one
   * of them isn't taken for this one.
   */
  async sell(item: AuctionItem, buyout: number, starting: number, note = "", minRep = 0, others: AuctionItem[] = []) {
    // One Sell at a time per riven, whatever the page does (a form cancelled and opened again
    // while the first create is out): until the first has ended (made, failed, or failed and
    // looked for), a second one can't tell whether the first was made. Marked before anything is
    // awaited, so two calls in a row can't both pass.
    if (this.sending.some((s) => sameRiven(s, item))) throw new Error("This riven is still being put up: wait for it to finish.");
    this.sending.push(item);
    // A create waits in the same queue as searches; the form says so while it does (`searchWait`).
    this.listenForWaits();
    try {
      await this.put(item, buyout, starting, note, minRep, others);
    } finally {
      const at = this.sending.indexOf(item);
      if (at >= 0) this.sending.splice(at, 1);
    }
  }
  private async put(item: AuctionItem, buyout: number, starting: number, note: string, minRep: number, others: AuctionItem[]) {
    // What you have up already, read first if it hasn't been, or not in the last half minute (the
    // pages read it only every few minutes): without it, one that timed out but was made can't be
    // told from one that wasn't, and sending again would put the riven up twice; with an old list,
    // one put up meanwhile on the site could be taken for this one.
    // When that read fails nothing is sent: an earlier create may have been made, and the list
    // can't say. The same, however fresh the list, after a create whose check failed
    // (`unchecked`), and for a riven whose create failed and wasn't found (`notFound`): the site
    // may have made it after that look.
    // What this Sell goes by is its own read's answer, even when that answer came back too late to
    // be kept as `mine` (another Sell's create ended meanwhile).
    const retry = this.notFound.some((s) => sameRiven(s, item));
    let list = this.mine;
    if (retry || this.unchecked || this.mineAt == null || Date.now() - this.mineAt > SELL_FRESH_MS) {
      const read = await this.readMine(true);
      if (!read) {
        // The read's own reason: where the site asked to wait or the sign-in ended, a moment won't do.
        const why = (this.mineError ? waitWords(this.mineError) : "").replace(/[.\s]+$/, "").replace(/^[A-Z](?=[a-z'])/, (c) => c.toLowerCase());
        throw new Error(`MyOrbiter could not check the auctions already up on warframe.market, so nothing was sent${why ? `: ${why}.` : ". Try again in a moment."}`);
      }
      // Cleared only by this Sell's own read, not by a page's read that may have begun earlier.
      if (retry) this.notFound = this.notFound.filter((s) => !sameRiven(s, item));
      list = read;
    }
    // Already up (put up on the site since the page last read your auctions): not a second time.
    // The same match as the page's "up for sale" mark (core/rivens.ts, auctionOf): weapon and
    // name, unless the auction is exactly another of your rivens of that name and not this one.
    if (list.some((a) => !a.closed && mayBeAuctionOf(a, item, others))) throw new Error("This riven is already up on warframe.market: reprice or close that auction instead");
    const before = new Set(list.map((a) => a.id));
    try {
      await market.createAuction({ starting_price: starting, buyout_price: buyout, minimal_reputation: minRep, private: false, note, item });
    } catch (e) {
      // Ended: a read sent before now and answered later is out of date (`epoch`).
      this.epoch++;
      // No answer in time doesn't mean it wasn't made: look before letting you send it again.
      // If that look fails too, the next Sell reads first (and sends nothing if that fails).
      const look = await this.readMine(true);
      this.unchecked = !look;
      // Only this riven counts: another one for the same weapon, put up meanwhile, doesn't.
      if (look?.some((a) => !before.has(a.id) && !a.closed && isAuctionOf(a, item))) return;
      // Not found: it may still be made after this look, so this riven's next Sell reads first.
      if (!this.notFound.some((s) => sameRiven(s, item))) this.notFound.push(item);
      throw e;
    }
    this.epoch++;
    // The create worked; if the read after it fails, the next Sell reads first (the list lacks this auction).
    this.unchecked = !(await this.readMine(true));
  }
  /**
   * A new buyout for one of your auctions. It stays what it was: one with no bidding (starting at
   * the buyout) keeps starting at the new buyout; one taking bids keeps its starting bid unless the
   * buyout goes under it. Everything else goes back as it was read: the minimum reputation, the
   * note and `private`.
   */
  async reprice(a: MyAuction, buyout: number) {
    const starting = startingFor(a, buyout);
    await market.updateAuction(a.id, { starting_price: starting, buyout_price: buyout, minimal_reputation: a.minRep, private: a.private, note: a.note });
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
