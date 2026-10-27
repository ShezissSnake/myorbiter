// Shared warframe.market state: account, your orders, cached order books, and the repricer.

import { market, presence, type ChatSummary, type FeedState, type MarketAccount, type MarketSettings, type MarketUser, type Sale, type Presence, type PresenceState } from "./backend";
import {
  findItem,
  holdings,
  indexItems,
  listingKey,
  plan,
  referencePrice,
  type BookOrder,
  type MarketItem,
  type Me,
  type MyOrder,
  type Plan,
} from "./core/market";
import type { Model } from "./core/model";
import { dealFromOrder, findDeals, type Deal, type FeedOrder, type Watch } from "./core/deals";
import { recentPrice, type PricePoint } from "./core/priceTrend";
import type { RelicMarket } from "./core/model";
import { aboveCrack, relicCrackFor } from "./core/spares";
import { LISTING_LIMIT, bulkPlan, cheapByMedian, planSignature, resolve, sellTargets, type BulkAction } from "./core/bulk";
import type { DucatOptions } from "./core/advice";
import { backoff } from "./core/upkeep";

export interface Draft {
  itemId: string;
  name: string;
  slug: string;
  platinum: number | null;
  quantity: number;
  rank: number | null;
  subtype: string | null;
  maxRank: number | null;
  subtypes: string[] | null;
  /** How many orbiter thinks you can sell (spare copies), when the page knew. */
  available: number | null;
  /** The order book was read for the current rank / variant. */
  priced: boolean;
  /** In-game sellers and their prices, cheapest first. */
  inGame: number;
  ladder: number[];
  /** Add to your existing listing for the same thing instead of making a second one. */
  addToExisting: boolean;
  /** What you hold, by rank and variant, so changing either recounts what you can list. */
  held: { rank: number | null; subtype: string | null; count: number }[];
  /** The rank and variant the page asked for, with the copies it said you can spare. */
  asked: { rank: number | null; subtype: string | null; available: number | null };
}

/** What a page knows about the thing it asks to list. */
export interface ListRequest {
  unique?: string | null;
  rank?: number | null;
  subtype?: string | null;
  /** Copies you can spare. Defaults to everything you hold at that rank. */
  quantity?: number | null;
}

export interface LogLine {
  at: number;
  text: string;
  tone: "ok" | "warn" | "info";
  /** In the Activity log only, no desktop notification: told some other way, or told within the hour. */
  quiet?: boolean;
}

/** The same warning notifies at most once in this long (Auto-match runs every few minutes). */
const WARN_AGAIN_MS = 60 * 60_000;
/** Stepping through the status switch with the arrow keys sends only where you stop. */
const STATUS_SETTLE_MS = 400;

/** Order books are cached briefly so opening the tab twice doesn't refetch everything. */
const BOOK_TTL = 60_000;

/** The lowest price orbiter lists or reprices an item at: your relic minimum for relics, your minimum for the rest. */
export function minFor(s: Pick<MarketSettings, "minPrice" | "minRelicPrice">, it: { tags?: string[] | null }): number {
  return it.tags?.includes("relic") ? (s.minRelicPrice ?? s.minPrice) : s.minPrice;
}

class MarketStore {
  account = $state<MarketAccount | null>(null);
  items = $state.raw<MarketItem[]>([]);
  index = $derived(indexItems(this.items));
  orders = $state.raw<MyOrder[]>([]);
  books = $state.raw<Record<string, { at: number; orders: BookOrder[] }>>({});
  /** A user action in progress (save, remove, sign in...). */
  op = $state<string | null>(null);
  /** Listings with an unsaved edit on Orders: the repricer leaves them alone until it's saved or undone. */
  editing = new Set<string>();
  /** A repricing pass in progress. Kept apart from `op` so a quick edit can't end a pass early. */
  pass = $state<string | null>(null);
  get busy(): string | null {
    return this.op ?? this.pass;
  }
  /** Shown when signed in but warframe.market couldn't be reached. */
  get accountError(): string | null {
    return this.account?.linked && !this.account.profile ? this.account.error : null;
  }
  /** Signed in, but warframe.market turned the sign-in down (expired or revoked): sign out and in again. */
  get signInRefused(): boolean {
    return isAuthError(this.accountError ?? "");
  }
  error = $state<string | null>(null);
  /** Your warframe.market status, held on orbiter's own connection. */
  status = $state<PresenceState | null>(null);
  /** Clicked and not confirmed yet. */
  statusAsked = $state<Presence | "offline" | null>(null);
  statusError = $state<string | null>(null);
  log = $state<LogLine[]>([]);
  lastPass = $state<number | null>(null);
  /** Repricing passes in a row that got no answer from warframe.market: the timer waits longer after each. */
  passFailures = $state(0);
  /** When your listings were last read from warframe.market (null: not since signing in). */
  ordersAt = $state<number | null>(null);
  /** Bumped by every change made to `orders` on the spot, so a read that started before it doesn't undo it. */
  private localEdits = 0;
  /** Attempts in a row to pick the account back up after an outage, and when the last was. */
  private retries = 0;
  private lastRetry = 0;
  /** The listing form (a dialog over whatever page you're on). */
  draft = $state<Draft | null>(null);
  /** Why the listing form couldn't open (not tradable, no item list...). */
  draftError = $state<string | null>(null);
  /** The form is being prepared. */
  drafting = $state<string | null>(null);
  /** What the form just listed, shown in it for a moment before it closes. */
  draftDone = $state<string | null>(null);

  get me(): Me | null {
    return this.account?.profile ?? null;
  }
  get linked() {
    return !!this.account?.linked && !!this.account.profile;
  }

  /** Warnings that notified, and when: a repeat within the hour goes to the log quietly. */
  private warned = new Map<string, number>();
  note(text: string, tone: LogLine["tone"] = "info", quiet = false) {
    const at = Date.now();
    if (tone === "warn" && !quiet) {
      const last = this.warned.get(text);
      if (last != null && at - last < WARN_AGAIN_MS) quiet = true;
      else this.warned.set(text, at);
    }
    this.log = [{ at, text, tone, ...(quiet ? { quiet } : {}) }, ...this.log].slice(0, 200);
  }

  async init() {
    try {
      this.account = await market.account();
      await this.ensureItems();
      if (this.linked) await this.refresh();
    } catch (e) {
      this.error = clean(e);
    }
  }

  /**
   * Called on a timer: after starting offline, or after an outage, picks the account back up.
   * Tries after one minute, then waits twice as long after each failure (up to 15 minutes).
   */
  async retryIfDisconnected(now = Date.now()) {
    if (!this.account?.linked || this.account.profile) {
      this.retries = 0;
      return;
    }
    if (this.busy || now - this.lastRetry < backoff(60_000, this.retries, 15 * 60_000) - 1000) return;
    this.lastRetry = now;
    this.retries++;
    await this.init();
    if (this.linked) this.retries = 0;
  }

  /** How long the repricing timer waits after the last pass: your interval, longer while warframe.market isn't answering. */
  passDelay(everyMs: number) {
    return backoff(everyMs, this.passFailures, Math.max(everyMs, 60 * 60_000));
  }

  async ensureItems() {
    if (!this.items.length) this.items = await market.items();
  }

  async signIn(email: string, password: string) {
    await this.guard("Signing in", async () => {
      await market.signIn(email, password);
      this.account = await market.account();
      await this.refresh();
    });
  }

  async useToken(token: string) {
    await this.guard("Checking token", async () => {
      await market.useToken(token);
      this.account = await market.account();
      await this.refresh();
    });
  }

  async pollStatus() {
    try {
      this.status = await presence.state();
      // A choice still settling hasn't been sent yet: the switch keeps showing it.
      if (this.statusTimer) return;
      const a = this.statusAsked;
      // Settled: confirmed, gone offline as asked, or refused (the switch then shows the truth).
      if (a && (a === "offline" ? !this.status.wanted : this.status.committed === a || !!this.status.error || !this.status.wanted)) this.statusAsked = null;
    } catch {
      /* not in the app */
    }
  }

  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private statusSettled: (() => void) | null = null;
  /** A choice not sent yet is dropped (a newer one replaces it, or you signed out). */
  private dropStatusTimer() {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.statusSettled?.();
    this.statusSettled = null;
  }
  /**
   * Hold a status on warframe.market, or "offline" to drop the connection. The switch shows the
   * choice at once; it's sent once you've stopped on it for a moment, so stepping through with
   * the arrow keys sends only the last one.
   */
  setStatus(s: Presence | "offline"): Promise<void> {
    this.statusAsked = s;
    this.statusError = null;
    this.dropStatusTimer();
    return new Promise((done) => {
      this.statusSettled = done;
      this.statusTimer = setTimeout(async () => {
        this.statusTimer = null;
        this.statusSettled = null;
        try {
          const st = await presence.set(s);
          // Changed again while this was on its way: that newer choice gets its own answer.
          if (this.statusAsked !== s || this.statusTimer) return;
          this.status = st;
          if (s === "offline") this.statusAsked = null;
        } catch (e) {
          if (this.statusAsked === s && !this.statusTimer) {
            this.statusAsked = null;
            this.statusError = clean(e);
          }
        } finally {
          done();
        }
      }, STATUS_SETTLE_MS);
    });
  }

  async signOut() {
    await market.signOut();
    this.dropStatusTimer();
    this.statusAsked = null;
    this.status = null;
    this.account = await market.account();
    this.orders = [];
    this.otherOrders = 0;
    this.ordersAt = null;
  }

  async refresh() {
    const edits = this.localEdits;
    const all = await market.myOrders();
    // A sale was marked on the spot while this read was on its way: the read may predate it, and
    // would bring the sold listing back. The next read has it.
    if (edits !== this.localEdits) return;
    this.orders = all.filter((o) => o.type === "sell");
    this.otherOrders = all.length - this.orders.length;
    this.ordersAt = Date.now();
  }

  /** Reload pressed on Orders: your listings read again, and the Activity log says how it went. */
  async reload() {
    await this.guard("Reloading", async () => {
      await this.refresh();
      this.note(`Listings reloaded from warframe.market: ${this.orders.length}`, "info");
    });
  }

  /** Buy orders: not shown, but they count toward warframe.market's 100-order limit. */
  otherOrders = $state(0);
  /** Listings warframe.market still has room for. */
  get room() {
    return Math.max(0, LISTING_LIMIT - this.orders.length - this.otherOrders);
  }

  item(id: string): MarketItem | undefined {
    return this.index.byId.get(id);
  }

  /** Trade partners' warframe.market profiles, by lower-case name: null when there's no such account. */
  users = $state<Record<string, MarketUser | null>>({});
  private userLookups = new Map<string, Promise<MarketUser | null>>();
  /** A player's profile, looked up once per run (a failed lookup is tried again next time). */
  user(name: string): Promise<MarketUser | null> {
    const key = name.toLowerCase();
    if (key in this.users) return Promise.resolve(this.users[key]);
    let p = this.userLookups.get(key);
    if (!p) {
      p = market
        .user(name)
        .then((u) => {
          this.users = { ...this.users, [key]: u };
          return u;
        })
        .finally(() => this.userLookups.delete(key));
      this.userLookups.set(key, p);
    }
    return p;
  }

  /**
   * +rep for a trade partner, from your account: "given" now, "already" when they have your +rep
   * from before (warframe.market takes one review per player), "reported" when your review of them
   * is a report (left as it is). Throws with a reason in words.
   */
  async giveRep(name: string, text: string): Promise<"given" | "already" | "reported"> {
    if (!this.linked) throw new Error("Sign in to warframe.market on Orders first");
    try {
      const mine = await market.myReview(name);
      if (mine === 1) return "already";
      if (mine === -1) return "reported";
      await market.giveRep(name, text);
      this.note(`Gave ${name} +rep on warframe.market`, "info", true);
      const key = name.toLowerCase();
      const u = this.users[key];
      if (u) this.users = { ...this.users, [key]: { ...u, reputation: u.reputation + 1 } };
      return "given";
    } catch (e) {
      const s = String(e);
      throw new Error(/Unauthorized|401|403/i.test(s) ? "warframe.market refused it: your account may not be allowed to leave reviews yet, or your sign-in expired (sign out on Orders and in again)" : /429|RateLimited/i.test(s) ? "warframe.market asked to slow down: try again in a minute" : s.replace(/^Error:\s*/, ""));
    }
  }

  async book(slug: string, maxAge = BOOK_TTL): Promise<BookOrder[]> {
    const hit = this.books[slug];
    if (hit && Date.now() - hit.at < maxAge) return hit.orders;
    const orders = await market.book(slug);
    this.books = { ...this.books, [slug]: { at: Date.now(), orders } };
    return orders;
  }

  /** Your pricing rules (floor share, minimum price), set by the app, so a new listing is priced the way Auto-match would price it. */
  rules: MarketSettings | null = null;
  /** The model the open listing form was started from, for its market reference price. */
  private draftModel: Model | null = null;

  /** Your ducat rate and how you crack relics, set by the app: a relic listing never goes under what a crack is worth. */
  advice: DucatOptions | null = null;
  /** The floor a relic listing keeps: just above what a crack of it is worth. Null for anything else. */
  crackFloor(m: Model, name: string, subtype: string | null): number | null {
    return aboveCrack(relicCrackFor(m, name, subtype, this.advice?.platPerDucat ?? 0, this.advice?.squad ?? 1));
  }

  planFor(m: Model, s: MarketSettings, o: MyOrder): Plan | null {
    const it = this.item(o.itemId);
    const book = it ? this.books[it.slug]?.orders : undefined;
    if (!it || !book || !this.me) return null;
    const own = s.floors[listingKey(o)] ?? null;
    const crack = this.crackFloor(m, it.name, o.subtype ?? it.subtypes?.[0] ?? null);
    return plan(o, book, this.me, {
      floor: crack != null ? Math.max(own ?? 0, crack) : own,
      minShare: s.minShare,
      reference: referencePrice(m, it, o.rank, o.subtype ?? it.subtypes?.[0] ?? null),
      defaultSubtype: it.subtypes?.[0] ?? null,
      min: minFor(s, it),
      capByAsks: !!it.tags?.includes("relic"),
    });
  }

  /**
   * One pass over your visible sell orders. With `apply`, changed prices are sent.
   * Only one pass runs at a time; a pass that fails still counts as a pass, so the timer waits
   * its full interval instead of retrying every few seconds.
   */
  async reprice(m: Model, s: MarketSettings, apply: boolean) {
    if (!this.linked || this.pass) return;
    this.pass = apply ? "Repricing" : "Checking prices";
    this.error = null;
    let changed = 0;
    let skipped = 0;
    let deferred = 0;
    let failed = 0;
    let read = 0;
    // While warframe.market isn't answering, say so once, not on every pass.
    const tone = (): LogLine["tone"] => (this.passFailures > 0 ? "info" : "warn");
    try {
      await this.ensureItems();
      if (!this.items.length) throw new Error("Couldn't load warframe.market's item list; nothing was checked");
      await this.refresh();
      for (const planned of this.orders) {
        // The list can change under a pass (you hid or edited something); act on the latest.
        const o = this.orders.find((x) => x.id === planned.id);
        if (!o || !o.visible || s.paused[listingKey(o)]) continue;
        const it = this.item(o.itemId);
        if (!it) {
          skipped++;
          continue;
        }
        try {
          await this.book(it.slug, apply ? 0 : BOOK_TTL);
          read++;
        } catch (e) {
          if (isAuthError(e)) throw e;
          failed++;
          continue;
        }
        const p = this.planFor(m, s, o);
        if (!p?.change || !apply) continue;
        const now = this.orders.find((x) => x.id === o.id);
        if (!now || !now.visible || now.platinum !== o.platinum) continue;
        // You're editing or removing something right now: leave the listings alone this pass
        // rather than race your change (the next pass picks them up).
        if (this.op || this.editing.has(o.id)) {
          deferred++;
          continue;
        }
        try {
          await market.update(o.id, { platinum: p.target });
          changed++;
          const why = p.reason === "floor" ? `held at your floor (${p.floor}p)` : `cheapest in game: ${p.competitor.cheapest?.name ?? "?"}`;
          this.note(`${it.name}${o.rank != null ? ` R${o.rank}` : ""}: ${o.platinum}p → ${p.target}p, ${why}`, "ok");
        } catch (e) {
          if (isAuthError(e)) throw e;
          failed++;
          this.note(`${it.name}: couldn't update (${clean(e)})`, "warn");
        }
      }
      if (skipped) this.note(`${skipped} listing${skipped === 1 ? "" : "s"} skipped: item not in warframe.market's list`, "warn");
      if (deferred) this.note(`${deferred} listing${deferred === 1 ? "" : "s"} left for the next pass: you were editing`, "info");
      if (failed) this.note(`${failed} listing${failed === 1 ? "" : "s"} couldn't be checked; trying again next pass`, read ? "warn" : tone());
      if (apply && !changed && !failed && !skipped && !deferred) this.note("Prices checked: everything already matches", "info");
      if (!apply) {
        const off = this.orders.filter((o) => o.visible && this.planFor(m, s, o)?.change).length;
        const checked = this.orders.filter((o) => o.visible && this.planFor(m, s, o)).length;
        this.note(
          off
            ? `Prices checked: ${off} listing${off === 1 ? "" : "s"} off the cheapest in-game price (press Reprice)`
            : failed
              ? `Prices checked for ${checked} listing${checked === 1 ? "" : "s"}: none off the cheapest in-game price`
              : "Prices checked: every listing matches",
          "info",
        );
      }
      if (changed) await this.refresh();
      if (failed && !read) this.passFailures++;
      else {
        if (this.passFailures) this.note("warframe.market is answering again", "info");
        this.passFailures = 0;
      }
    } catch (e) {
      this.error = clean(e);
      if (isAuthError(e) && this.account) {
        this.note(clean(e), "warn");
        // Signed out on warframe.market's side: stop acting until you sign in again.
        this.account = { ...this.account, profile: null, error: clean(e) };
        this.ordersAt = null;
      } else {
        this.note(clean(e), tone());
        this.passFailures++;
      }
    } finally {
      if (apply) this.lastPass = Date.now();
      this.pass = null;
    }
  }

  /** Opens the listing form for something from your collection, priced at the cheapest in-game seller. */
  async startListing(m: Model, name: string, req: ListRequest = {}) {
    this.draft = null;
    this.draftError = null;
    this.draftDone = null;
    this.drafting = name;
    try {
      await this.ensureItems();
    } catch (e) {
      this.draftError = `Couldn't load warframe.market's item list: ${clean(e)}`;
      this.drafting = null;
      return;
    }
    const it = findItem(this.index, name, req.unique);
    if (!it) {
      this.draftError = `${name} isn't tradable on warframe.market.`;
      this.drafting = null;
      return;
    }
    this.draftModel = m;
    const held = holdings(m, it) ?? [];
    // Ranked items: the lowest rank you hold (the spare copies), unless the page says otherwise.
    // Relics: the refinement you hold the most of.
    const rank = req.rank !== undefined ? req.rank : it.maxRank != null ? ([...held].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0]?.rank ?? 0) : null;
    const atRank = held.filter((h) => h.rank === rank && (req.subtype == null || h.subtype === req.subtype)).sort((a, b) => b.count - a.count);
    const pick = atRank[0] ?? null;
    const subtype = req.subtype ?? pick?.subtype ?? it.subtypes?.[0] ?? null;
    const available = req.quantity ?? pick?.count ?? null;
    this.draft = {
      itemId: it.id,
      name: it.name,
      slug: it.slug,
      platinum: null,
      quantity: Math.max(1, Math.min(available ?? 1, 999)),
      rank,
      subtype,
      maxRank: it.maxRank,
      subtypes: it.subtypes,
      available,
      priced: false,
      inGame: 0,
      ladder: [],
      addToExisting: true,
      held,
      asked: { rank, subtype, available },
    };
    this.drafting = null;
    await this.priceDraft();
  }

  /** After the rank or variant changed in the form: what you can list at the new one, then its price. */
  async retarget() {
    const d = this.draft;
    if (!d) return;
    const def = d.subtypes?.[0] ?? null;
    const same = d.rank === d.asked.rank && (d.subtype ?? def) === (d.asked.subtype ?? def);
    // The page's own spare count only holds for what it asked about; elsewhere, what you hold.
    const available = same
      ? d.asked.available
      : d.held.filter((h) => h.rank === d.rank && (h.subtype ?? def) === (d.subtype ?? def)).reduce((n, h) => n + h.count, 0);
    d.available = available;
    d.quantity = Math.min(available ?? 1, 999);
    // Another rank or variant sells at another price: the old one doesn't carry over.
    d.platinum = null;
    await this.priceDraft();
  }

  /** Your listing of the same item, rank and variant, if there is one. */
  existingFor(d: Draft): MyOrder | null {
    const def = d.subtypes?.[0] ?? null;
    return this.orders.find((o) => o.itemId === d.itemId && (o.rank ?? null) === (d.rank ?? null) && (o.subtype ?? def) === (d.subtype ?? def)) ?? null;
  }

  async priceDraft() {
    const d = this.draft;
    if (!d || !this.me) return;
    d.priced = false;
    this.draftError = null;
    try {
      const book = await this.book(d.slug);
      const p = plan(
        { id: "", itemId: d.itemId, type: "sell", platinum: 0, quantity: d.quantity, rank: d.rank, subtype: d.subtype, visible: true, updatedAt: null },
        book,
        this.me,
        // The same floor as Auto-match uses, so the price it proposes isn't raised on the next pass.
        (() => {
          const s = this.rules;
          const it = this.item(d.itemId);
          const existing = this.existingFor(d);
          const own = s && existing ? (s.floors[listingKey(existing)] ?? null) : null;
          const crack = it && this.draftModel ? this.crackFloor(this.draftModel, it.name, d.subtype ?? d.subtypes?.[0] ?? null) : null;
          return {
            floor: crack != null ? Math.max(own ?? 0, crack) : own,
            minShare: s?.minShare ?? 0,
            reference: s && it && this.draftModel ? referencePrice(this.draftModel, it, d.rank, d.subtype ?? d.subtypes?.[0] ?? null) : null,
            defaultSubtype: d.subtypes?.[0] ?? null,
            min: s && it ? minFor(s, it) : s?.minPrice,
            capByAsks: !!it?.tags?.includes("relic"),
          };
        })(),
      );
      if (this.draft !== d) return;
      d.platinum = p.competitor.price == null ? d.platinum : p.target;
      d.inGame = p.competitor.sellers;
      d.ladder = p.competitor.ladder;
      d.priced = true;
    } catch (e) {
      if (this.draft === d) this.draftError = clean(e);
    }
  }

  async submitDraft() {
    const d = this.draft;
    if (!d || d.platinum == null) return;
    const existing = d.addToExisting ? this.existingFor(d) : null;
    await this.guard("Listing", async () => {
      const tag = `${d.name}${d.rank != null ? ` R${d.rank}` : ""}${d.subtype ? ` (${d.subtype})` : ""}`;
      if (existing) {
        await market.update(existing.id, { platinum: d.platinum!, quantity: existing.quantity + d.quantity, visible: true });
        this.note(
          d.quantity ? `Added ${d.quantity}× ${tag} to your listing: now ${existing.quantity + d.quantity} at ${d.platinum}p` : `${tag}: listing set to ${d.platinum}p`,
          "ok",
        );
      } else {
        if (this.room <= 0) throw new Error(`warframe.market allows ${LISTING_LIMIT} listings and you have that many: add to an existing listing or remove one first`);
        await market.create({ itemId: d.itemId, platinum: d.platinum!, quantity: d.quantity, rank: d.rank, subtype: d.subtype, visible: true });
        this.note(`Listed ${d.quantity}× ${tag} at ${d.platinum}p`, "ok");
      }
      this.draftDone = this.log[0]?.text ?? null;
      this.draft = null;
      await this.refresh();
    });
    if (this.draft === d && this.error) this.draftError = this.error;
  }

  closeDraft() {
    this.draft = null;
    this.draftError = null;
    this.drafting = null;
    this.draftDone = null;
  }

  async update(o: MyOrder, change: { platinum?: number; quantity?: number; visible?: boolean }) {
    await this.guard("Saving", async () => {
      await market.update(o.id, change);
      await this.refresh();
    });
  }

  /**
   * You sold `n` of a listing in game. It goes to warframe.market as its own "Sold" (the sale is
   * recorded on your profile and the order lowered, or closed when that was all of it). The
   * listing changes on screen at once; if warframe.market refuses, it's put back.
   * Returns the sale to log, or null if it didn't go through. `quiet`: the caller tells you about
   * a failure itself, so the log line doesn't notify too.
   */
  async sold(o: MyOrder, n: number, { quiet = false }: { quiet?: boolean } = {}): Promise<Sale | null> {
    const name = this.item(o.itemId)?.name ?? "order";
    n = Math.max(1, Math.min(o.quantity, Math.round(n)));
    const before = this.orders;
    this.localEdits++;
    this.orders = n >= o.quantity ? before.filter((x) => x.id !== o.id) : before.map((x) => (x.id === o.id ? { ...x, quantity: x.quantity - n } : x));
    try {
      await market.close(o.id, n);
      this.note(`Sold ${n} × ${name}${o.rank != null ? ` R${o.rank}` : ""} for ${o.platinum}p${n >= o.quantity ? ": listing closed" : `: ${o.quantity - n} left listed`}`, "ok");
      return { at: Date.now(), item: name, rank: o.rank, quantity: n, platinum: o.platinum };
    } catch (e) {
      // Put it back unless something else changed the list meanwhile.
      if (this.orders.every((x) => before.some((b) => b.id === x.id))) this.orders = before;
      this.note(`${name}: couldn't mark it sold (${clean(e)})`, "warn", quiet);
      if (isAuthError(e) && this.account) {
        this.error = clean(e);
        this.account = { ...this.account, profile: null, error: clean(e) };
        this.ordersAt = null;
      }
      return null;
    }
  }

  async remove(o: MyOrder) {
    const name = this.item(o.itemId)?.name ?? "order";
    await this.guard("Removing", async () => {
      await market.remove(o.id);
      this.note(`Removed ${name}${o.rank != null ? ` R${o.rank}` : ""}`, "info");
      await this.refresh();
    });
  }

  // ------------------------------------------------------------ cheap buys

  /** Bargains on what you're after, from the last scan (see deals.ts). */
  deals = $state.raw<Deal[]>([]);
  dealsAt = $state<number | null>(null);
  private scanning = false;

  /**
   * Reads the order books for the watchlist, a few a second, and keeps the bargains. Works signed
   * out too: order books are public. Skipped while something else is talking to warframe.market.
   */
  /** How many order books the last scan could read. */
  dealsChecked = $state(0);

  /** Items' last 90 days of trades, by slug, read at most once an hour. */
  private histories = new Map<string, { at: number; points: Promise<PricePoint[]> }>();
  history(slug: string): Promise<PricePoint[]> {
    const hit = this.histories.get(slug);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.points;
    const points = market.history(slug);
    this.histories.set(slug, { at: Date.now(), points });
    points.catch(() => this.histories.delete(slug));
    return points;
  }

  /**
   * What each relic you hold sold for lately at every refinement, for the ones not read in the last
   * day: one statistics request each, paced like every other request. Returns the merged prices,
   * or null when there was nothing to read. Runs one at a time.
   */
  /** The read in progress, so a plan can wait for it. */
  relicRead = $state.raw<Promise<RelicMarket | null> | null>(null);
  readRelicPrices(bases: string[], had: RelicMarket, now = Date.now()): Promise<RelicMarket | null> {
    if (this.relicRead) return Promise.resolve(null);
    // Read again when older than a day, or read before prices were the middle sale (an average let one odd sale lift a relic tenfold).
    const stale = bases.filter((b) => !had[b] || now - had[b].at > 86_400_000 || had[b].how !== "median");
    if (!stale.length) return Promise.resolve(null);
    const read = this.readRelics(stale, had, now);
    this.relicRead = read;
    void read.finally(() => {
      if (this.relicRead === read) this.relicRead = null;
    });
    return read;
  }
  private async readRelics(stale: string[], had: RelicMarket, now: number): Promise<RelicMarket | null> {
    const out: RelicMarket = { ...had };
    try {
      await this.ensureItems();
      for (const base of stale) {
        const it = this.index.byName.get(`${base} relic`.toLowerCase());
        if (!it) continue;
        try {
          const points = await this.history(it.slug);
          const prices: Record<string, number> = {};
          for (const sub of it.subtypes ?? ["intact", "exceptional", "flawless", "radiant"]) {
            // At least two sales in 30 days: one is too thin to decide on.
            const p = recentPrice(points, null, sub, 30, 2);
            if (p != null) prices[sub] = p;
          }
          out[base] = { at: now, prices, how: "median" };
        } catch {
          // Not answering: tried again on the next read.
        }
      }
    } catch {
      return null;
    }
    return out;
  }

  /** Your chats on warframe.market's messenger, from the last read (signed in only). */
  chats = $state.raw<ChatSummary[]>([]);
  private chatsReading = false;
  async readChats() {
    if (!this.linked || this.chatsReading) return;
    this.chatsReading = true;
    try {
      this.chats = await market.chats();
    } catch {
      // Not answering, or the sign-in expired: the market log already says so elsewhere.
    } finally {
      this.chatsReading = false;
    }
  }

  /** The live feed of new orders: how it's doing, and what it watches for (set by the app). */
  feed = $state<FeedState | null>(null);
  /** Deals the live feed caught, since orbiter started. */
  liveDeals = $state(0);
  private liveWatch = new Map<string, Watch>();
  private liveModel: Model | null = null;
  /** What the live feed looks for: a longer list than the scan's, as it costs no requests. */
  watchLive(m: Model, watch: Watch[]) {
    this.liveModel = m;
    const map = new Map<string, Watch>();
    for (const w of watch) {
      const it = findItem(this.index, w.name, null);
      if (it && !map.has(it.slug)) map.set(it.slug, w);
    }
    this.liveWatch = map;
  }
  /** One sell order from the live feed: a deal joins the list (and so gets announced). */
  feedOrder(o: FeedOrder) {
    if (!this.liveModel || !this.liveWatch.size) return;
    const d = dealFromOrder(this.liveModel, this.index, o, this.liveWatch, this.me);
    if (!d || this.deals.some((x) => x.key === d.key)) return;
    this.deals = [d, ...this.deals].slice(0, 40);
    this.liveDeals++;
  }
  async scanDeals(m: Model, watch: Watch[]) {
    if (this.scanning || this.busy || !watch.length) return;
    this.scanning = true;
    try {
      await this.ensureItems();
      const slugs = [...new Set(watch.map((w) => findItem(this.index, w.name, null)?.slug).filter((x): x is string => !!x))];
      let failing = 0;
      for (const slug of slugs) {
        if (this.busy) break; // something you asked for comes first
        try {
          await this.book(slug, 5 * 60_000);
          failing = 0;
        } catch {
          // One item failing doesn't stop the rest; three in a row is warframe.market not
          // answering, and the rest would only wait for their own time-outs.
          if (++failing >= 3) break;
        }
      }
      const books = Object.fromEntries(slugs.map((sl) => [sl, this.books[sl]?.orders]));
      this.dealsChecked = Object.values(books).filter(Boolean).length;
      const me = this.me ?? { id: "", ingameName: "", platform: "pc", crossplay: true };
      this.deals = findDeals(m, this.index, books, watch, me as Me);
      this.dealsAt = Date.now();
    } finally {
      this.scanning = false;
    }
  }

  // ------------------------------------------------------------ put my spares on sale

  /** The changes "Put my spares on sale" would make, for you to look over before applying. */
  bulk = $state.raw<{ actions: BulkAction[]; at: number } | null>(null);
  /** A long run's progress (planning, applying, removing everything). */
  progress = $state<{ done: number; total: number } | null>(null);

  async planBulk(m: Model, s: MarketSettings, advice: DucatOptions) {
    if (!this.linked || this.busy) return;
    this.bulk = null;
    await this.guard("Working out what to list", async () => {
      await this.ensureItems();
      if (!this.items.length) throw new Error("Couldn't load warframe.market's item list");
      await this.refresh();
      const me = this.me;
      if (!me) throw new Error("Not signed in to warframe.market");
      const targets = sellTargets(m, s.bulk, advice, this.index, s.sellable);
      // Fresh order books for everything that might be listed, one at a time (warframe.market
      // allows a few requests a second; the app paces them).
      // Things clearly under your minimum by their daily median are settled without a fetch.
      const slugs = [
        ...new Set(
          targets
            // Held back (better as ducats): no price needed.
            .filter((t) => !t.hold)
            .map((t) => {
              const it = resolve(this.index, t);
              return it && cheapByMedian(m, it, t.rank, minFor(s, it), t.subtype ?? it.subtypes?.[0] ?? null) == null ? it.slug : null;
            })
            .filter((x): x is string => !!x),
        ),
      ];
      this.progress = { done: 0, total: slugs.length };
      for (const slug of slugs) {
        try {
          await this.book(slug);
        } catch (e) {
          if (isAuthError(e)) throw e;
        }
        this.progress = { done: this.progress.done + 1, total: slugs.length };
      }
      const books = Object.fromEntries(slugs.map((sl) => [sl, this.books[sl]?.orders]));
      this.bulk = {
        actions: bulkPlan({ model: m, index: this.index, orders: this.orders, me, books, minPrice: s.minPrice, minRelicPrice: s.minRelicPrice, minShare: s.minShare, floors: s.floors, paused: s.paused, otherOrders: this.otherOrders, sell: s.sellable, advice }, s.bulk, targets),
        at: Date.now(),
      };
    });
    this.progress = null;
  }

  /**
   * Sends the planned changes, one at a time. What fails is logged and the rest still go. First it
   * works the plan out again from your current inventory and listings (no network: the prices it
   * fetched are reused); if anything changed since you looked, it shows the new plan instead.
   */
  async applyBulk(m: Model, s: MarketSettings, advice: DucatOptions) {
    const shown = this.bulk;
    if (!shown || this.busy || !this.me) return;
    await this.refresh().catch(() => {});
    const books = Object.fromEntries(Object.entries(this.books).map(([slug, b]) => [slug, b.orders]));
    const fresh = bulkPlan({ model: m, index: this.index, orders: this.orders, me: this.me, books, minPrice: s.minPrice, minRelicPrice: s.minRelicPrice, minShare: s.minShare, floors: s.floors, paused: s.paused, otherOrders: this.otherOrders, sell: s.sellable, advice }, s.bulk, sellTargets(m, s.bulk, advice, this.index, s.sellable));
    if (planSignature(fresh) !== planSignature(shown.actions)) {
      this.bulk = { actions: fresh, at: Date.now() };
      this.note("Your inventory or listings changed since the plan: here is the updated plan. Look it over and apply again.", "warn");
      return;
    }
    // Removals first, so new listings have room under the 100-listing limit.
    const ORDER = { remove: 0, update: 1, create: 2, skip: 3 } as const;
    const todo = shown.actions.filter((a) => a.type !== "skip").sort((a, b) => ORDER[a.type] - ORDER[b.type]);
    const sent = new Set<BulkAction>();
    let failed = 0;
    await this.guard("Updating your listings", async () => {
      this.progress = { done: 0, total: todo.length };
      for (const a of todo) {
        const tag = (name: string, rank: number | null) => `${name}${rank != null ? ` R${rank}` : ""}`;
        try {
          if (a.type === "create") {
            await market.create({ itemId: a.item.id, platinum: a.platinum, quantity: a.quantity, rank: a.rank, subtype: a.subtype, visible: true });
            this.note(`Listed ${a.quantity}× ${tag(a.item.name, a.rank)} at ${a.platinum}p`, "ok");
          } else if (a.type === "update") {
            await market.update(a.order.id, { quantity: a.quantity, platinum: a.platinum });
            this.note(`${tag(a.item.name, a.order.rank)}: ${a.order.quantity}× ${a.order.platinum}p → ${a.quantity}× ${a.platinum}p`, "info");
          } else if (a.type === "remove") {
            await market.remove(a.order.id);
            this.note(`Removed ${tag(a.item.name, a.order.rank)} (${a.why.toLowerCase()})`, "info");
          }
          sent.add(a);
        } catch (e) {
          if (isAuthError(e)) throw e;
          failed++;
          this.note(`${a.item.name}: couldn't ${a.type} (${clean(e)})`, "warn");
        }
        this.progress = { done: sent.size + failed, total: todo.length };
      }
    });
    this.progress = null;
    await this.refresh().catch(() => {});
    if (this.error) {
      // Stopped part way (the sign-in expired): keep only what wasn't sent, so a second Apply
      // doesn't list things twice.
      const left = shown.actions.filter((a) => !sent.has(a));
      this.bulk = left.some((a) => a.type !== "skip") ? { actions: left, at: Date.now() } : null;
      this.note(`Stopped after ${sent.size} of ${todo.length} changes: ${this.error}`, "warn");
      return;
    }
    this.bulk = null;
    this.note(`Your spares are on sale: ${sent.size} change${sent.size === 1 ? "" : "s"} made${failed ? `, ${failed} failed (see above)` : ""}`, failed ? "warn" : "ok");
  }

  /** Takes every one of your sell listings off warframe.market. */
  async removeAll() {
    if (this.busy) return;
    let done = 0;
    let failed = 0;
    await this.guard("Removing every listing", async () => {
      await this.refresh();
      const all = [...this.orders];
      this.progress = { done: 0, total: all.length };
      for (const o of all) {
        try {
          await market.remove(o.id);
          done++;
        } catch (e) {
          if (isAuthError(e)) throw e;
          failed++;
          this.note(`${this.item(o.itemId)?.name ?? "A listing"}: couldn't remove (${clean(e)})`, "warn");
        }
        this.progress = { done: done + failed, total: all.length };
      }
      this.bulk = null;
      await this.refresh();
    });
    this.progress = null;
    this.note(`Removed ${done} listing${done === 1 ? "" : "s"} from warframe.market${failed ? `; ${failed} couldn't be removed` : ""}`, failed ? "warn" : "info");
  }

  private async guard(label: string, f: () => Promise<void>) {
    this.op = label;
    this.error = null;
    try {
      await f();
    } catch (e) {
      this.error = clean(e);
    } finally {
      this.op = null;
    }
  }
}

const clean = (e: unknown) => String(e).replace(/^Error: /, "");
const isAuthError = (e: unknown) => /refused the sign-in|Not signed in/i.test(String(e));

export const mkt = new MarketStore();
