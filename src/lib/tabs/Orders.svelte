<script lang="ts">
  import { shownPage, whileShown, whileShownEvery } from "../pane.svelte";
  import { links, openUrl } from "../links.svelte";
  import Opening from "../ui/Opening.svelte";
  import Fold from "../ui/Fold.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import { MAX_PLAT, MAX_QTY, wholeIn } from "../core/amounts";
  import { tradeAllowance } from "../core/tradeLimit";
  import { until } from "../core/traders";
  import { untrack } from "svelte";
  import type { Model } from "../core/model";
  import type { AdviceSettings, MarketSettings, OrderSortKey } from "../backend";
  import { heldFor, holdings, listingKey, overAsked, overListed, wtsLines, type MyOrder, type Plan } from "../core/market";
  import { LISTING_LIMIT, minimumForItem } from "../core/bulk";
  import { minimumOf, minimumsText } from "../core/sparesRules";
  import { DRIFT_RULES, GREY_AREA } from "../core/drift";
  import { AUTO_REP_LINE, AUTO_TRADES_LINE } from "../core/automation";
  import { AUTO_FLOOR_SHARE } from "../core/approved";
  import { arcaneRows, saveForSets, spareOf } from "../core/views";
  import { drops } from "../drops.svelte";
  import { aboveCrack, relicCrackFor } from "../core/spares";
  import { mkt } from "../marketStore.svelte";
  import HelpMark from "../ui/HelpMark.svelte";
  import PageHead from "../ui/PageHead.svelte";
  import Vessel from "../ui/Vessel.svelte";
  import Named from "../ui/Named.svelte";
  import P from "../ui/P.svelte";
  import Chip from "../ui/Chip.svelte";
  import Seg from "../ui/Seg.svelte";
  import Presence from "../ui/Presence.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import { sparesSummary } from "../sparesSummary.svelte";
  import { flip, leave, opens, OUT_CSS, calm, SETTLE } from "../motion";
  import Check from "../ui/Tick.svelte";
  import Metal from "../ui/Metal.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import { named, refocus } from "../ui/refocus";
  import PriceHistory from "../ui/PriceHistory.svelte";
  import ProgressButton from "../ui/ProgressButton.svelte";
  import CopyButton from "../ui/CopyButton.svelte";
  import { Job, JobError, Jobs } from "../job.svelte";
  import { rivens } from "../rivenStore.svelte";
  import type { MyAuction, RivenAuction } from "../core/rivens";
  import { estimateListed } from "../core/rivenModel";

  // console: you play on a console or phone, so MyOrbiter can't see what you hold. New listing then
  // finds anything warframe.market trades, and what needs your inventory (spares, "Listed more than you hold") is left out.
  let { model, settings = $bindable(), advice, console = false, masteryRank = null, whispers = [], go = () => {} }: { model: Model; settings: MarketSettings; advice: AdviceSettings; console?: boolean; masteryRank?: number | null; whispers?: { name: string; uptime: number; at: number | null }[]; go?: (to: string) => void } = $props();

  // Remove all my listings, kept away from the buttons pressed every day: it asks first, with the
  // safe choice focused, so Esc or Enter keeps them.
  const removeJob = new Job();
  let confirmRemoveAll = $state(false);
  const removeFill = () => (mkt.op === "Removing every listing" && mkt.progress?.total ? mkt.progress.done / mkt.progress.total : null);
  const removeCount = () => (mkt.op === "Removing every listing" && mkt.progress ? `Removing ${mkt.progress.done}/${mkt.progress.total}` : "Removing…");
  function removeAll() {
    void removeJob.run(async () => {
      const r = await mkt.removeAll();
      if (!r) return null;
      const e = mkt.errorOf("Removing every listing");
      if (e) throw new JobError("Stopped", e);
      if (r.failed) throw new JobError(`${r.failed} failed`, `${r.done} removed, ${r.failed} couldn't be: Activity below says why`);
      return `${r.done} removed`;
    });
  }
  const keepOnEsc = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    confirmRemoveAll = false;
  };
  // Who whispered you this game session (from EE.log; the message itself isn't logged), newest first.
  const whisperers = $derived(
    [...new Map([...whispers].sort((a, b) => (a.at ?? a.uptime) - (b.at ?? b.uptime)).map((w) => [w.name, w])).values()].reverse().slice(0, 8),
  );
  const agoWord = (at: number | null) => (at == null ? "" : (() => { const m = Math.max(0, Math.round((minute / 1000 - at) / 60)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`; })());
  // The daily trade limit (core/tradeLimit.ts), refreshed each minute.
  let minute = $state(Date.now());
  $effect(() => whileShownEvery("market", 60_000, () => (minute = Date.now()), () => minute));
  const trades = $derived(tradeAllowance(settings.trades, masteryRank, minute));
  // Arcanes you're still collecting copies of to max: an unranked listing of one works against that.
  const collecting = $derived(console ? new Map<string, { copies: number; needed: number }>() : new Map(arcaneRows(model).filter((a) => !a.complete && a.copies > 0).map((a) => [a.name, { copies: a.copies, needed: a.needed }])));

  let email = $state("");
  let password = $state("");
  let token = $state("");
  let how = $state<"password" | "token">("password");
  let search = $state("");

  const orders = $derived.by(whileShown("market", () => [...mkt.orders].sort((a, b) => (mkt.item(a.itemId)?.name ?? "").localeCompare(mkt.item(b.itemId)?.name ?? ""))));
  // The table's order: by name until you click a column (kept). Ties stay in name order.
  const sortBy = $derived(settings.ordersSort ?? { key: "name" as OrderSortKey, desc: false });
  function sortOn(key: OrderSortKey) {
    // A number column starts high-first; the name column A to Z.
    settings.ordersSort = sortBy.key === key ? { key, desc: !sortBy.desc } : { key, desc: key !== "name" };
  }
  const sortValue = (o: MyOrder): number | string | null => {
    switch (sortBy.key) {
      case "name": return mkt.item(o.itemId)?.name ?? "";
      case "qty": return o.quantity;
      case "price": return o.platinum;
      case "total": return o.platinum * o.quantity;
      case "cheapest": return planOf(o)?.competitor.price ?? null;
      case "change": { const p = planOf(o); return p?.change ? p.target - o.platinum : null; }
    }
  };
  const sortedOrders = $derived.by(() => {
    const dir = sortBy.desc ? -1 : 1;
    // A ghost (sold out or removed, still saying so) keeps its place among the rest until it leaves.
    // While the page is hidden `orders` is the list it was last drawn with, which can still hold a
    // listing that has since become a ghost: it's there once.
    const gone = ghosts.filter((g) => !orders.some((o) => o.id === g.id));
    return (gone.length ? [...orders, ...gone] : orders)
      .map((o, i) => ({ o, i, v: sortValue(o) }))
      .sort((a, b) => {
        // Nothing to sort by (not checked yet) goes last either way.
        if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
        const c = typeof a.v === "string" ? a.v.localeCompare(b.v as string) : a.v - (b.v as number);
        return c * dir || a.i - b.i;
      })
      .map((x) => x.o);
  });
  const listed = $derived(orders.filter((o) => o.visible).reduce((n, o) => n + o.platinum * o.quantity, 0));
  const plans = $derived.by(whileShown("market", () => new Map(orders.map((o) => [o.id, mkt.planFor(model, settings, o)]))));
  /** A gone listing's last plan, so a ghost row sorts where the listing was. */
  const keptPlans = new Map<string, Plan | null | undefined>();
  const planOf = (o: MyOrder) => plans.get(o.id) ?? keptPlans.get(o.id);
  const hiddenOrders = $derived(orders.filter((o) => !o.visible));
  /** The folded repricer settings, in one line: "Auto: check every 5 min · floor 50% · min 10p". */
  const autoLine = $derived(`Auto: ${settings.auto ? `apply every ${settings.every} min` : settings.autoCheck ? `check every ${settings.every} min` : "off"} · floor ${settings.minShare ? `${settings.minShare * 100}%` : "none"} · min ${minimumsText(settings)}`);
  const pending = $derived(orders.filter((o) => o.visible && !settings.paused[listingKey(o)] && plans.get(o.id)?.change).length);
  // The timer waits longer while warframe.market isn't answering (passDelay): the next check is then, not at your interval.
  const passWait = $derived(mkt.passDelay(settings.every * 60_000));
  const nextPass = $derived((settings.auto || settings.autoCheck) && mkt.lastPass ? new Date(mkt.lastPass + passWait) : null);
  /** Oldest order book behind what's on screen, so you know how fresh "Market price" is. */
  const checkedAt = $derived.by(whileShown("market", () => {
    const times = orders.map((o) => mkt.books[mkt.item(o.itemId)?.slug ?? ""]?.at).filter((t): t is number => t != null);
    return times.length ? Math.min(...times) : null;
  }));
  /**
   * A listing's price against the cheapest other seller online or in game at the last check: its price as it
   * is on warframe.market (never a price being typed), minus that seller's. Above zero, undercut.
   * Null when there's no check or nobody else sells it. Shown only; nothing is priced from it (the
   * repricer follows the second-cheapest, core/drift.ts).
   */
  const againstLowest = (o: MyOrder, p: Plan | null | undefined): number | null =>
    p?.competitor.lowest && o.platinum > 0 ? o.platinum - p.competitor.lowest.platinum : null;
  /** The shown listings with a cheapest seller to stand against, and how many of them are undercut. */
  const against = $derived(orders.filter((o) => isShown(o)).map((o) => againstLowest(o, plans.get(o.id))).filter((d): d is number => d != null));
  const undercut = $derived(against.filter((d) => d > 0).length);

  // New listing: anything tradable you hold, searchable. On a console: anything tradable.
  const sellable = $derived.by(whileShown("market", () => {
    if (!mkt.items.length) return [];
    if (console) return mkt.items.map((it) => ({ it, held: 0 }));
    return mkt.items
      .map((it) => ({ it, held: (holdings(model, it) ?? []).reduce((n, h) => n + h.count, 0) }))
      .filter((x) => x.held > 0)
      .sort((a, b) => a.it.name.localeCompare(b.it.name));
  }));
  // Names that start with what you typed first, then the ones you hold most of; with what you can spare.
  const matches = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    if (console) {
      return sellable
        .filter((x) => x.it.name.toLowerCase().includes(q))
        .sort((a, b) => Number(b.it.name.toLowerCase().startsWith(q)) - Number(a.it.name.toLowerCase().startsWith(q)) || a.it.name.length - b.it.name.length || a.it.name.localeCompare(b.it.name))
        .slice(0, 10)
        .map((x) => ({ ...x, spare: null }));
    }
    return sellable
      .filter((x) => x.it.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.it.name.toLowerCase().startsWith(q)) - Number(a.it.name.toLowerCase().startsWith(q)) || b.held - a.held)
      .slice(0, 40)
      .map((x) => ({ ...x, spare: spareOf(model, x.it.name, x.it.tags, saveForSets(settings.sellable, advice.platPerDucat, drops.recent)) }))
      // Things you can actually spare first.
      .sort((a, b) => Number((b.spare?.quantity ?? b.held) > 0) - Number((a.spare?.quantity ?? a.held) > 0))
      .slice(0, 10);
  });

  // The results follow the arrow keys, Enter picks, Esc or a click elsewhere closes them.
  let searchOpen = $state(false);
  let active = $state(0);
  let searchBox = $state<HTMLElement | null>(null);
  function pick(x: (typeof matches)[number]) {
    const sp = x.spare;
    mkt.startListing(model, x.it.name, sp ? { unique: x.it.gameRef, rank: sp.rank, quantity: sp.quantity } : { unique: x.it.gameRef });
    search = "";
  }
  function searchKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (search) e.stopPropagation();
      search = "";
      return;
    }
    if (!matches.length || !searchOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const x = matches[active];
      if (x) pick(x);
    }
  }
  function outside(e: PointerEvent) {
    if (searchOpen && searchBox && !searchBox.contains(e.target as Node)) searchOpen = false;
  }

  // What you hold of each listing (as of TennoScope's last read): a listing for more than you
  // have, or for something you no longer have, sells what you can't deliver.
  function stock(o: MyOrder): number | null {
    const it = mkt.item(o.itemId);
    return it ? heldFor(model, it, o) : null;
  }
  // Counted like Home and the notices: the visible ones first (a buyer can be let down), the hidden
  // ones beside them (nobody can buy those, but their rows still ask "Sold?").
  const over = $derived.by(whileShown("market", () => overListed(orders, stock)));
  const shortShown = $derived(over.shown.length);
  const shortHidden = $derived(over.hidden.length);

  const rankLabel = (o: { rank: number | null; subtype: string | null }) =>
    [o.rank != null ? `R${o.rank}` : null, o.subtype].filter(Boolean).join(" · ");

  function setFloor(o: MyOrder, v: string) {
    const n = Math.round(Number(v));
    const key = listingKey(o);
    const floors = { ...settings.floors };
    if (!v || !Number.isFinite(n) || n <= 0) delete floors[key];
    else floors[key] = n;
    settings.floors = floors;
  }
  function togglePause(o: MyOrder) {
    const key = listingKey(o);
    settings.paused = { ...settings.paused, [key]: !settings.paused[key] };
  }
  // Quantity and price change a live listing, so an edit is held (gold) until you press Enter or
  // Save; Esc or Undo puts the listing's value back.
  let edits = $state<Record<string, { quantity?: string; platinum?: string }>>({});
  /** A whole number from 1 to `max` (core/amounts), as the dialogs take; anything else isn't a change. */
  const whole = (v: string | undefined, max: number) => {
    const n = v == null || v.trim() === "" ? NaN : Number(v);
    return wholeIn(n, 1, max) ? n : null;
  };
  /** What's wrong with a number typed into a row, so a box that can't be saved says why. */
  function badEdit(o: MyOrder): string | null {
    const e = edits[o.id];
    if (!e) return null;
    const off = (v: string | undefined, max: number) => v != null && v.trim() !== "" && whole(v, max) == null;
    if (off(e.quantity, MAX_QTY)) return `Quantity: a whole number from 1 to ${MAX_QTY.toLocaleString("en")}`;
    if (off(e.platinum, MAX_PLAT)) return `Price: whole platinum from 1 to ${MAX_PLAT.toLocaleString("en")}`;
    return null;
  }
  function changeOf(o: MyOrder): { quantity?: number; platinum?: number } | null {
    const e = edits[o.id];
    if (!e) return null;
    const out: { quantity?: number; platinum?: number } = {};
    const q = whole(e.quantity, MAX_QTY);
    const pr = whole(e.platinum, MAX_PLAT);
    if (q != null && q !== o.quantity) out.quantity = q;
    if (pr != null && pr !== o.platinum) out.platinum = pr;
    return Object.keys(out).length ? out : null;
  }
  function edit(o: MyOrder, field: "quantity" | "platinum", v: string) {
    edits[o.id] = { ...edits[o.id], [field]: v };
    // Held back from the repricer only while there's an actual change waiting.
    if (changeOf(o)) mkt.editing.add(o.id);
    else mkt.editing.delete(o.id);
  }
  // Your shown listings as trade chat lines (core/market.ts, wtsLines); each press copies the next.
  const wts = $derived.by(whileShown("market", () => wtsLines(mkt.orders.filter((o) => o.visible).map((o) => ({ name: mkt.item(o.itemId)?.name ?? o.itemId, rank: o.rank, platinum: o.platinum })))));
  let wtsNext = $state(0);
  const wtsAt = $derived(wts.length ? wtsNext % wts.length : 0);
  function revert(o: MyOrder) {
    delete edits[o.id];
    mkt.editing.delete(o.id);
  }
  async function save(o: MyOrder) {
    if (overHeld(o)) return;
    const change = changeOf(o);
    if (!change) return revert(o);
    // Refused (or warframe.market turned MyOrbiter away): what you typed stays, to save again.
    await rowAct(o.id, { working: "Saving…", done: "Saved", fail: "Couldn't save" }, async () => {
      if (!(await mkt.update(o, change))) return false;
      revert(o);
    });
  }

  // ------------------------------------------------------------ each row's own work
  // Save, Remove, Shown, Sold and the like: the row says what it's doing, then that it's done, or
  // why it failed with Try again, in the row itself. A row that is working ignores more clicks.
  // A failure stays a while, with its reason and Try again.
  const rowBusy = new Jobs(undefined, 20_000);
  let rowWords = $state<Record<string, { working: string; done: string; fail: string }>>({});
  let retryOf = $state<Record<string, () => void>>({});
  /** The store's error for a change you made on a row: shown in the row, so not at the top as well. */
  function rowError(): string {
    const why = mkt.error ?? "warframe.market didn't take it";
    mkt.error = null;
    return why;
  }
  /** Runs a row's change; `f` returns false (or throws) when it didn't go through. */
  function rowAct(id: string, words: { working: string; done: string; fail: string }, f: () => Promise<boolean | void>): Promise<boolean> {
    const j = rowBusy.get(id);
    rowWords[id] = words;
    const go = () =>
      j.run(async (job) => {
        job.phase = words.working;
        if ((await f()) === false) throw new Error(rowError());
        return words.done;
      });
    retryOf[id] = () => void go();
    return go();
  }
  /** A row action can be pressed: nothing you asked for is running, and this row isn't working. A timed check doesn't count. */
  const rowFree = (id: string) => !mkt.op && !rowBusy.busy(id);
  function removeRow(o: MyOrder, buy = false) {
    // A listing taken down leaves the table as warframe.market confirms it: a faded copy of its row
    // stays to say "✓ Removed", then goes and the rows close up (see ghosts).
    if (!buy) {
      removed[o.id] = o;
      keptPlans.set(o.id, plans.get(o.id));
    }
    void rowAct(o.id, { working: buy ? "Taking down…" : "Removing…", done: buy ? "Taken down" : "Removed", fail: buy ? "Couldn't take it down" : "Couldn't remove" }, () => mkt.remove(o));
  }
  // Shown moves at once: the switch (and the row's dimming) follow what you set while warframe.market
  // is asked; if it refuses, they go back with a shake, and the row says why with Try again.
  let shownNow = $state<Record<string, boolean>>({});
  const isShown = (o: MyOrder) => shownNow[o.id] ?? o.visible;
  /** Each listing's refusals so far: a new one shakes its switch. */
  let refusedShown = $state<Record<string, number>>({});
  function setVisible(o: MyOrder, v: boolean) {
    void rowAct(o.id, { working: v ? "Showing…" : "Hiding…", done: v ? "Shown" : "Hidden", fail: v ? "Couldn't show it" : "Couldn't hide it" }, async () => {
      shownNow[o.id] = v;
      let ok = false;
      try {
        ok = await mkt.update(o, { visible: v });
        return ok;
      } finally {
        delete shownNow[o.id];
        if (!ok) refusedShown[o.id] = (refusedShown[o.id] ?? 0) + 1;
      }
    });
  }
  /** A switch that went back: a short shake (none under reduced motion; the row's reason still shows). */
  function shake(node: HTMLElement, n: number | undefined) {
    let last = n;
    return {
      update(v: number | undefined) {
        if (v === last) return;
        last = v;
        if (v && !calm.current && typeof node.animate === "function")
          node.animate([{ transform: "none" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(2px)" }, { transform: "none" }], { duration: SETTLE, easing: OUT_CSS });
      },
    };
  }
  function lowerTo(o: MyOrder, n: number) {
    void rowAct(o.id, { working: "Saving…", done: `Listed ${n}`, fail: "Couldn't change it" }, () => mkt.update(o, { quantity: n }));
  }

  // The buttons above the table.
  const checkJob = new Job();
  const repriceJob = new Job();
  const reloadJob = new Job();
  const showJob = new Job();
  const retryJob = new Job();
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  // Why the last Check prices or Reprice went wrong, kept under the buttons (with Try again) until
  // the next press: the button's own word only lasts a moment.
  let lastFail = $state<{ why: string; again: () => void } | null>(null);
  function failed(short: string, why: string, again: () => void) {
    lastFail = { why, again };
    return new JobError(short, why);
  }
  function checkPrices() {
    lastFail = null;
    void checkJob.run(async () => {
      const r = await mkt.reprice(model, settings, false);
      if (!r) return null;
      if (r.error) throw failed("Failed", r.error, checkPrices);
      if (r.stopped) throw failed("Stopped", "warframe.market stopped answering part way through: try again in a minute", checkPrices);
      if (r.failed) throw failed(`${r.failed} unread`, `${plural(r.failed, "order book")} couldn't be read${r.off ? `; ${r.off} to reprice among the rest` : ""}. Check again in a minute.`, checkPrices);
      return r.off ? `${r.off} to reprice` : "All match";
    });
  }
  function repriceNow() {
    lastFail = null;
    void repriceJob.run(async () => {
      const r = await mkt.reprice(model, settings, true);
      if (!r) return null;
      if (r.error) throw failed("Failed", r.error, repriceNow);
      if (r.failed) throw failed(`${r.failed} failed`, `${plural(r.failed, "listing")} couldn't be repriced${r.changed ? `; ${r.changed} ${r.changed === 1 ? "was" : "were"}` : ""}. The Activity log below says why.`, repriceNow);
      return r.changed ? `${r.changed} repriced` : "All match";
    });
  }
  const passCount = $derived(mkt.passProgress ? `${mkt.passProgress.done}/${mkt.passProgress.total}` : "");
  const passFill = $derived(mkt.passProgress?.total ? mkt.passProgress.done / mkt.passProgress.total : null);
  function reloadListings() {
    void reloadJob.run(async () => {
      await mkt.reload();
      if (mkt.error) throw new Error(mkt.error);
      return "Reloaded";
    });
  }
  function showAll() {
    const list = hiddenOrders;
    void showJob.run(async (j) => {
      j.step(0, list.length);
      const n = await mkt.showHidden(list, (d, t) => j.step(d, t));
      if (n < list.length) throw new JobError(`${list.length - n} failed`, `${plural(list.length - n, "listing")} couldn't be shown; the Activity log below says why`);
      return `${n} shown`;
    });
  }
  function retryAccount() {
    void retryJob.run(async () => {
      await mkt.init();
      if (mkt.accountError) throw new Error(mkt.accountError);
      if (mkt.error) throw new Error(mkt.error);
      return "Connected";
    });
  }
  /** A quantity over what you hold can't be delivered: refused, as the List form refuses it. */
  /**
   * What it really goes for, when every seller online or in game asks more than twice that (the
   * listing follows it instead): judged by the cheapest of them, as plan() judges it.
   */
  function goesFor(p: Plan): number | null {
    const cheapest = p.competitor.lowest?.platinum ?? p.competitor.price;
    return cheapest != null && p.value != null && overAsked(cheapest, p.value) != null ? Math.round(p.value * 10) / 10 : null;
  }

  /** A relic held up by what a crack of it is worth: what that crack is worth. */
  /** The listing's minimum price (Sell spares), when it's what holds the price up: no other floor is as high. */
  function minimumHeld(o: MyOrder, p: Plan): number | null {
    if (p.reason !== "floor") return null;
    const it = mkt.item(o.itemId);
    const min = it ? minimumForItem(settings, model, it) : settings.minPrice;
    return p.floor === min && p.hard === min ? min : null;
  }
  function crackHeld(o: MyOrder, p: Plan): number | null {
    if (p.reason !== "floor") return null;
    const it = mkt.item(o.itemId);
    if (!it?.tags?.includes("relic")) return null;
    const crack = relicCrackFor(model, it.name, o.subtype ?? it.subtypes?.[0] ?? null, mkt.advice?.platPerDucat ?? 0, mkt.advice?.squad ?? 1);
    return crack != null && aboveCrack(crack) === p.floor ? crack : null;
  }

  function overHeld(o: MyOrder): string | null {
    const q = changeOf(o)?.quantity;
    const held = stock(o);
    if (q == null || held == null || q <= held) return null;
    return `You hold ${held}${o.rank != null ? " at this rank" : o.subtype ? " of this variant" : ""}: you can't list more than that.`;
  }
  function editKey(o: MyOrder, e: KeyboardEvent) {
    if (e.key === "Enter") {
      if (!overHeld(o)) save(o);
    }
    else if (e.key === "Escape") {
      e.stopPropagation();
      revert(o);
    }
  }
  // Edits that never got saved don't hold the repricer back once the page is gone.
  $effect(() => () => {
    for (const id of Object.keys(edits)) mkt.editing.delete(id);
  });
  // Your riven auctions: warframe.market keeps them apart from listings (Rivens has the same, per
  // riven). Read while this page is on screen, at most every 5 minutes (rivenStore, refreshMine);
  // repricing or closing one here reads them again at once.
  $effect(() => {
    void mkt.ordersAt;
    if (!mkt.linked) return;
    void rivens.loadMeta();
    if (shownPage("market")) void rivens.refreshMine(`${mkt.me?.id ?? ""}|${mkt.platform}`);
  });
  const auctions = $derived(rivens.mine.filter((a) => !a.closed));
  // Each auction against MyOrbiter's estimate for a riven like it: the weapon's cheapest listed
  // (one search per weapon, shared with Rivens), last week's trades and the price model.
  // Keyed by platform and weapon, and asked again after half an hour, so a long session doesn't
  // judge auctions by hours-old listings. One that failed is asked again on the next round.
  let anyBy = $state<Record<string, { at: number; auctions: RivenAuction[] }>>({});
  const anyAsking = new Set<string>();
  let anyTick = $state(0);
  let anyLast = Date.now();
  $effect(() => whileShownEvery("market", 5 * 60_000, () => ((anyLast = Date.now()), anyTick++), () => anyLast));
  const anyKey = (w: string) => `${mkt.platform}|${w}`;
  $effect(() => {
    void anyTick;
    const now = Date.now();
    const weapons = [...new Set(auctions.map((a) => a.weapon))].filter((w) => !anyAsking.has(anyKey(w)) && !(now - (untrack(() => anyBy[anyKey(w)])?.at ?? 0) < 30 * 60_000));
    if (!weapons.length) return;
    for (const w of weapons) anyAsking.add(anyKey(w));
    void rivens.loadModel();
    void rivens.loadTrades(mkt.platform);
    void (async () => {
      for (const w of weapons) {
        const k = anyKey(w);
        const any = await rivens.search(w, [], null).catch(() => null);
        anyAsking.delete(k);
        if (any) anyBy = { ...anyBy, [k]: { at: Date.now(), auctions: any } };
      }
    })();
  });
  const auctionEst = (a: MyAuction) => estimateListed(rivens.model, rivens.meta, rivens.trades, a, anyBy[anyKey(a.weapon)]?.auctions);
  const weaponOf = (a: MyAuction) => rivens.meta?.weapons.find((w) => w.slug === a.weapon);
  const auctionTitle = (a: MyAuction) => `${weaponOf(a)?.name ?? a.weapon.replace(/_/g, " ")} ${a.name.replace(/(^|-)\p{L}/gu, (c) => c.toUpperCase())}`;
  let auctionPrice = $state<{ id: string; buyout: number | null; busy: boolean; error: string | null } | null>(null);
  let auctionBusy = $state<string | null>(null);
  let auctionError = $state<string | null>(null);
  async function saveAuctionPrice(a: MyAuction) {
    const f = auctionPrice;
    if (!f || !f.buyout) return;
    const buyout = Math.round(f.buyout);
    f.busy = true;
    f.error = null;
    try {
      // No bidding stays no bidding; bids from where they were, never above the new buyout; hidden stays hidden.
      await rivens.reprice(a, buyout);
      auctionPrice = null;
    } catch (e) {
      f.error = String(e).replace(/^Error:\s*/, "");
      f.busy = false;
    }
  }
  async function takeDownAuction(a: MyAuction) {
    auctionBusy = a.id;
    auctionError = null;
    try {
      await rivens.close(a);
    } catch (e) {
      auctionError = String(e).replace(/^Error:\s*/, "");
    } finally {
      auctionBusy = null;
    }
  }
  /** Remove asks twice: the listing (and its place in the queue) is gone for good. */
  let removing = $state<string | null>(null);
  /** The listing whose "Sold" box is open, and how many. */
  let selling = $state<{ id: string; n: number } | null>(null);
  /** Sign out asks first: listing and repricing stop until you sign in again. */
  let signingOut = $state(false);
  // A confirm takes the focus on its safe choice, so Esc (or Enter) keeps things as they are.
  const focusIt = (node: HTMLInputElement | HTMLButtonElement) => {
    node.focus();
    if (node instanceof HTMLInputElement) node.select();
  };
  /** `keep`: a row's Remove? closing, whose focus goes back to the row's Remove (keepRow). */
  const onEsc = (undo: () => void, keep = false) => (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (keep) keepRow(e);
    undo();
  };
  /**
   * A row's Remove? closing (Keep, or Esc) takes its buttons away, and the keyboard focus would fall
   * to the top of the page: it goes back to the row's own Remove (or Take down) instead.
   */
  function keepRow(e: Event) {
    const from = e.currentTarget as HTMLElement;
    const row = from.closest(".acts, li");
    refocus(from, () => row?.querySelector<HTMLElement>('[aria-label="Remove"], [aria-label="Take down"]'));
  }
  // Sold waits a few seconds, with Undo, before it's sent: marking sold on warframe.market goes on
  // your profile and lowers or closes the listing, which a slip of the mouse shouldn't do.
  const SOLD_WAIT = 4000;
  let pendingSold = $state<Record<string, number>>({});
  const soldTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Each listing's quantity when you clicked Sold. */
  const soldFrom = new Map<string, number>();
  function recordSale(o: MyOrder, n: number) {
    if (n < 1 || n > o.quantity) return;
    selling = null;
    clearTimeout(soldTimers.get(o.id));
    pendingSold = { ...pendingSold, [o.id]: n };
    soldFrom.set(o.id, o.quantity);
    soldTimers.set(o.id, setTimeout(() => void commitSale(o.id), SOLD_WAIT));
  }
  function undoSale(id: string) {
    clearTimeout(soldTimers.get(id));
    soldTimers.delete(id);
    const { [id]: _, ...rest } = pendingSold;
    pendingSold = rest;
  }
  async function commitSale(id: string) {
    const n = pendingSold[id];
    undoSale(id);
    const o = mkt.orders.find((x) => x.id === id);
    if (!o || !n) return;
    // The game's trade log got there first while Undo was showing: it already marked copies sold
    // (the listing shrank since you clicked) and recorded the sale. Only what's left is yours.
    const already = Math.max(0, (soldFrom.get(id) ?? o.quantity) - o.quantity);
    soldFrom.delete(id);
    if (n - already < 1) return;
    await sendSale(o, Math.min(n - already, o.quantity));
  }
  /**
   * Sends a sale (after the undo wait, or Try again). A listing sold out leaves the table at once:
   * a faded copy of its row stays, saying "Sending…" then "Sold", until it's through; if
   * warframe.market refuses, the listing comes back with the reason and Try again.
   */
  let sending = $state<Record<string, MyOrder>>({});
  /** Listings you removed, still saying so on a faded row until it leaves. */
  let removed = $state<Record<string, MyOrder>>({});
  function sendSale(o: MyOrder, n: number) {
    sending[o.id] = o;
    keptPlans.set(o.id, plans.get(o.id));
    return rowAct(o.id, { working: `Sending ${n} sold…`, done: `Sold ${n}`, fail: "Couldn't mark sold" }, async () => {
      let why = "";
      const sale = await mkt.sold(o, n, { failed: (r) => (why = r) });
      if (!sale) throw new Error(why || "warframe.market didn't take it");
      settings.sales = [sale, ...settings.sales].slice(0, 2000);
    });
  }
  /**
   * Rows gone from your listings (sold out, or removed), still showing how it went: "Sending…" or
   * "Removing…", then ticked off ("✓ Sold 2", "✓ Removed"). Once the tick has been seen the row
   * leaves and the rows below close up, as Sell spares' plan lines do.
   */
  const ghosts = $derived([...new Map([...Object.values(sending), ...Object.values(removed)].map((o) => [o.id, o])).values()].filter((o) => !mkt.orders.some((x) => x.id === o.id) && rowBusy.get(o.id).state !== "idle"));
  const ghostIds = $derived(new Set(ghosts.map((o) => o.id)));
  /** How long a ticked-off row stays before it leaves (as Sell spares' plan lines). */
  const SEEN_MS = 650;
  const seeing = new Map<string, ReturnType<typeof setTimeout>>();
  $effect(() => {
    for (const o of ghosts) {
      const id = o.id;
      if (seeing.has(id) || rowBusy.get(id).state !== "done") continue;
      seeing.set(id, setTimeout(() => {
        seeing.delete(id);
        keptPlans.delete(id);
        delete sending[id];
        delete removed[id];
      }, SEEN_MS));
    }
  });
  $effect(() => () => {
    for (const t of seeing.values()) clearTimeout(t);
  });
  /** The table's rows: your listings, and any ghost, in its place. */
  const rows = $derived(sortedOrders);
  // Leaving the page (or quitting) doesn't lose a sale that was waiting.
  $effect(() => () => {
    for (const id of soldTimers.keys()) void commitSale(id);
  });
  const fmt = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  /** The listing whose price history is open under its row. */
  let charted = $state<string | null>(null);
  // A minimum typed in: a whole number from 1 to 100,000 (as Sell spares takes it); an emptied or odd box keeps the one you had.
  function minFrom(box: HTMLInputElement, was: number): number {
    const v = box.value.trim() === "" ? null : minimumOf(Number(box.value));
    if (v == null) {
      box.value = String(was);
      return was;
    }
    return v;
  }
</script>

<svelte:window onpointerdown={outside} />

<div class="page"><div class="page-inner">
  <PageHead title="Orders" brief="Your listings, kept at the market price." blurb="Your warframe.market listings, kept at the market price: the second-cheapest seller online or in game." />

  <!-- The figures you trade by, one tile each: the headline figures, so vessels (pass 2, §8). -->
  {#if mkt.linked}
    {@const hiddenN = orders.filter((o) => !o.visible).length}
    {@const allowed = LISTING_LIMIT - mkt.otherOrders}
    <section class="tiles" aria-label="Your trading">
      <div class="tile" title={`Listings: ${orders.length} of the ${allowed} warframe.market allows you here (${LISTING_LIMIT} in all, less your other orders), ${hiddenN} hidden`}>
        <span class="register">Listings</span>
        <div class="fv"><span class="mark fig" class:gold={mkt.room <= 0}>{orders.length}</span>
          <Vessel key="orders.listings" max={allowed} parts={[{ value: orders.length - hiddenN, label: "shown", tone: "var(--platinum)" }, { value: hiddenN, label: "hidden", tone: "var(--platinum-deep)" }]} label="Listings of those allowed" /></div>
        <p class="note">{mkt.room <= 0 ? "At warframe.market's limit" : `${mkt.room} more allowed`} · {hiddenN} hidden</p>
        {#if !console && (shortShown || shortHidden)}
          <!-- Something to fix, so it shows whatever Details is set to. -->
          <p class="note" class:over={shortShown} title={`Listed more than you hold: ${shortShown} visible listing${shortShown === 1 ? "" : "s"} for more copies than you hold now, as Home counts them${shortHidden ? `, and ${shortHidden} hidden, which nobody can buy` : ""}. Each is flagged in the list: Sold?`}>{shortShown ? `! ${shortShown} listed more than you hold: fix ${shortShown === 1 ? "it" : "them"} below` : `${shortHidden} hidden listed more than you hold`}</p>
        {/if}
      </div>
      <div class="tile" title="Listed value: your visible listings, price × quantity">
        <span class="register">Listed value</span>
        <div class="fv"><span class="mark fig plat"><P v={listed} big /></span></div>
        <p class="note">platinum, at your prices</p>
      </div>
      <div class="tile" title={checkedAt ? `Undercut: ${undercut} of your ${against.length} shown listing${against.length === 1 ? "" : "s"} with another seller online or in game ask more than the cheapest of those sellers, at the check of ${fmt(checkedAt)}${nextPass ? `; next at ${fmt(+nextPass)}` : ""}. Reprice follows the second-cheapest, so it may leave some of these as they are` : "Undercut: press Check prices to compare"}>
        <span class="register">Undercut</span>
        {#if checkedAt && against.length}
          <div class="fv"><span class="mark fig" class:bad={undercut}>{undercut}</span>
            <Vessel key="orders.undercut" value={undercut} max={against.length} tone="var(--oxblood)" label="Listings undercut, of those checked" /></div>
          <p class="note">of the {against.length} checked · {fmt(checkedAt)}</p>
        {:else}
          <div class="fv"><span class="mark fig none">–</span></div>
          <p class="note">{!checkedAt ? "not checked yet" : `${orders.some((o) => isShown(o)) ? "nobody else online sells them" : "none shown to buyers"} · ${fmt(checkedAt)}`}</p>
        {/if}
      </div>
      {#if !console && trades.limit != null}
        {@const resets = until(new Date(trades.resets).toISOString(), minute)}
        <div class="tile" title={`Trades left today: ${trades.used} made since 00:00 UTC, refreshes in ${resets}. Trades a day are your Mastery Rank (${trades.limit}; Founders get 2 more), each counting once whatever it carried (up to 6 items each way). Counted from the game's log while MyOrbiter was reading it`}>
          <span class="register">Trades left</span>
          {#if trades.left != null}
            <div class="fv"><span class="mark fig" class:gold={trades.left <= 3}>{trades.left}</span>
              <Vessel key="orders.trades" value={trades.left} max={trades.limit} label="Trades left today" /></div>
          {:else}
            <div class="fv"><span class="mark fig none">–</span></div>
          {/if}
          <p class="note">of {trades.limit} today · resets in {resets}</p>
        </div>
      {/if}
      <HelpMark part="orders.tiles" corner />
    </section>
  {/if}

  <!-- Only when signed in: it holds nothing else, and an empty plate would show. Beside the
       listings when the page is wide, above them otherwise; above the reason when warframe.market
       can't be reached. -->
  {#snippet statusPlate()}
    <section class="status">
      <span class="register">Your status</span>
      <div class="presence"><Presence {settings} tradesLeft={trades.left} resets={trades.resets} /></div>
      <div class="grow"></div>
      <span class="account">
        <span class="who register" title={`MyOrbiter's own sign-in to warframe.market; the token is kept in ${mkt.account?.backing === "keyring" ? "the system keyring" : "a private file"}`}>Signed in as <strong>{mkt.me?.ingameName ?? "?"}</strong></span>
        <ProgressButton variant="icon" icon="refresh" spin tone="quiet" job={reloadJob} label="Reload" working="Reloading…" doneLabel="Reloaded" failLabel="Couldn't reload" title="Fetch your listings from warframe.market again" disabled={!!mkt.op} onclick={reloadListings} />
        {@render signOut()}
      </span>
      <HelpMark part="orders.status" />
    </section>
  {/snippet}
  {#if mkt.linked && mkt.accountError}{@render statusPlate()}{/if}

  {#snippet signOut()}
    <span class="out">
      {#if signingOut}
        <span class="small">Sign out of warframe.market? Listing and repricing stop until you sign in again.</span>
        <button class="danger" onclick={() => { signingOut = false; mkt.signOut(); }} onkeydown={onEsc(() => (signingOut = false))}>Sign out</button>
        <button class="link quiet" onclick={() => (signingOut = false)} onkeydown={onEsc(() => (signingOut = false))} use:focusIt>Stay signed in</button>
      {:else}
        <IconButton icon="sign-out" tone="quiet" label="Sign out" title="Sign out: forget MyOrbiter's warframe.market sign-in" onclick={() => (signingOut = true)} />
      {/if}
    </span>
  {/snippet}

  <!-- A sortable column heading: click or Enter, again for the other way. -->
  {#snippet sh(key: OrderSortKey, label: string, cls: string, title: string)}
    <th class="sortable {cls}" {title} tabindex="0" aria-sort={sortBy.key === key ? (sortBy.desc ? "descending" : "ascending") : undefined} onclick={() => sortOn(key)} onkeydown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), sortOn(key))}>{label}{#if sortBy.key === key}<span class="arrow" aria-hidden="true">{sortBy.desc ? "▾" : "▴"}</span>{/if}</th>
  {/snippet}

  <!-- A row's own work: what it's doing, then done, or why it failed with Try again. -->
  {#snippet rowStatus(id: string)}
    {@const j = rowBusy.get(id)}
    {#if j.state !== "idle"}
      <div class="rowst {j.state}" role="status">
        {#if j.state === "working"}<span class="busyword">{j.phase}<i aria-hidden="true"></i></span>
        {:else if j.state === "done"}<span class="tickoff"><Check on drawn size={.95} /></span>{j.note}
        {:else}<b class="bang" aria-hidden="true">!</b><span>{rowWords[id]?.fail ?? "Failed"}: {j.error}</span>{#if retryOf[id]}<button type="button" class="link" title="Send the same change again" disabled={!!mkt.op} onclick={retryOf[id]}>Try again</button>{/if}{/if}
      </div>
    {/if}
  {/snippet}

  {#if mkt.error}<div class="alert">{mkt.error}</div>{/if}

  {#if mkt.accountError}
    <section class="panel">
      <HelpMark part="orders.unreachable" corner />
      {#if mkt.signInRefused}
        <h2 class="mark">warframe.market refused the sign-in</h2>
        <p class="prose">It no longer accepts MyOrbiter's sign-in (it expired, or was signed out elsewhere). Sign out, then sign in again: listing and repricing wait until you do.</p>
        <div class="row"><button class="stamp" onclick={() => mkt.signOut()}>Sign out</button></div>
      {:else}
        <h2 class="mark">Can't reach warframe.market</h2>
        <p class="prose">You're signed in, but warframe.market didn't answer: {mkt.accountError}. MyOrbiter tries again every minute; your listings and the repricer come back on their own.</p>
        <div class="row"><ProgressButton job={retryJob} label="Try again now" working="Trying…" doneLabel="Connected" failLabel="Still no answer" status title="Try reaching warframe.market now instead of waiting for the next minute" disabled={!!mkt.op} onclick={retryAccount} />{@render signOut()}</div>
      {/if}
    </section>
  {:else if !mkt.linked}
    <section class="panel signin">
      <HelpMark part="orders.sign-in" corner />
      <h2 class="mark">Sign in to warframe.market</h2>
      <p class="prose">{console ? "MyOrbiter signs in to warframe.market itself." : "MyOrbiter keeps its own sign-in, separate from TennoScope's."} The token goes into your system keyring; the password is sent to warframe.market once and never stored.</p>
      <Seg label="Sign in with" bind:value={how} options={[{ v: "password", label: "Email & password" }, { v: "token", label: "Paste a token" }]} />
      {#if how === "password"}
        <form class="row" onsubmit={(e) => { e.preventDefault(); mkt.signIn(email, password).then(() => (password = "")); }}>
          <input type="email" placeholder="Email" aria-label="warframe.market email" bind:value={email} autocomplete="username" />
          <input type="password" placeholder="Password" aria-label="warframe.market password" bind:value={password} autocomplete="current-password" />
          <button class="stamp" disabled={!email || !password || !!mkt.busy}>{mkt.busy ?? "Sign in"}</button>
        </form>
      {:else}
        <form class="row" onsubmit={(e) => { e.preventDefault(); mkt.useToken(token).then(() => (token = "")); }}>
          <input class="wide" type="password" placeholder="JWT token from a signed-in browser" aria-label="warframe.market token" bind:value={token} />
          <button class="stamp" disabled={!token || !!mkt.busy}>{mkt.busy ?? "Use token"}</button>
        </form>
        <p class="dim small">In a browser signed in to warframe.market: developer tools → Storage → Cookies → copy the value of <code>JWT</code>.</p>
      {/if}
    </section>
  {:else}
  <div class="desk">
  <div class="side">
    {@render statusPlate()}

    {#if whisperers.length}
      <!-- Who whispered you this session: one place to find a buyer again once the toast is gone. -->
      <section class="whispers" aria-label="Whispered you this session">
        <span class="register">Whispered you</span>
        {#each whisperers as w (w.name)}
          <span class="wh">
            <b>{w.name}</b>{#if w.at != null}<span class="dim small">{agoWord(w.at)}</span>{/if}
            <CopyButton look="chip" text={`/invite ${w.name}`} label="Invite" title="Copy /invite {w.name}, to paste in game chat and invite them to your squad for the trade" />
            <button type="button" class="link quiet small" title="Their warframe.market profile: reputation and reviews" aria-busy={links.isOpening(`https://warframe.market/profile/${encodeURIComponent(w.name)}`)} onclick={() => openUrl(`https://warframe.market/profile/${encodeURIComponent(w.name)}`)}><Opening url={`https://warframe.market/profile/${encodeURIComponent(w.name)}`}>profile ↗</Opening></button>
          </span>
        {/each}
        <HelpMark part="orders.whispers" />
        {#if settings.lastCopy.hidden.length}<span class="dim small" title="The last-copy rule (Settings, Trades): your last copies are hidden while a buyer whispers, so a second buyer doesn't come for the same one">{settings.lastCopy.hidden.length} last cop{settings.lastCopy.hidden.length === 1 ? "y" : "ies"} hidden for now</span>{/if}
      </section>
    {/if}

    <!-- Sell spares has a page of its own: one line here says what it would list, and a plan being
         applied stays in sight. -->
    {#if !console}
      {@const plan = mkt.bulk ? sparesSummary.changes : 0}
      <button type="button" class="sparesline" id="spares" title="Sell spares: choose what to sell and how, look over the plan, list it in one go" onclick={() => go("spares")}>
        <GameIcon name="platinum" size={18} />
        <span class="register">Sell spares</span>
        <span class="small dim sub">{#if mkt.applying && mkt.progress}Applying the plan: {mkt.progress.done} of {mkt.progress.total}{:else}{#if sparesSummary.at != null}{sparesSummary.listings} listing{sparesSummary.listings === 1 ? "" : "s"} ready from {sparesSummary.kinds} kind{sparesSummary.kinds === 1 ? "" : "s"} · {sparesSummary.estimate ? "~" : ""}<P v={Math.round(sparesSummary.plat)} dim />{:else}Choose what to sell and how{/if}{#if plan} · a plan of {plan} change{plan === 1 ? "" : "s"} to look over{/if}{/if}</span>
        <span class="go register">Open <Icon name="arrow-right" size={12} /></span>
      </button>
    {/if}

  </div>
  <div class="work">
    <!-- Your listings: the heading and the trade-chat line on one row, where to add one under it. -->
    <div class="listhead">
      <div class="lhtop">
      <h2 class="register yours">Your listings</h2>
      {#if wts.length}<CopyButton class="wts" text={() => wts[wtsAt]} label={wts.length > 1 ? `Copy trade-chat line ${wtsAt + 1} of ${wts.length}` : "Copy trade-chat line"} sizer={wts.length > 1 ? [`Copy trade-chat line ${wts.length} of ${wts.length}`] : []} oncopied={() => (wtsNext = wtsAt + 1)}
        title={`Copy your shown listings as a trade chat line, to paste in game too:\n${wts[wtsAt]}${wts.length > 1 ? `\n(${wts.length} lines: each press copies the next)` : ""}`} />{/if}
      <HelpMark part="orders.listings" />
      </div>
      <section class="newlisting" aria-label="New listing">
        <span class="register">New listing</span>
        <span class="searchbox" bind:this={searchBox}><input type="search" title="Shows only what matches what you type" placeholder={console ? "Find anything to sell…" : "Find something you own…"} bind:value={search} aria-label={console ? "Find anything to sell" : "Find something you own"}
          oninput={() => { searchOpen = true; active = 0; }} onfocus={() => (searchOpen = true)} onkeydown={searchKey} />
        {#if matches.length && searchOpen}<div class="results">
            {#each matches as x, i (x.it.id)}
              <button class="pick" class:active={i === active} tabindex="-1" onpointerenter={() => (active = i)} onclick={() => pick(x)}>
                <Named file={model.imageOf(x.it.name.replace(/ Set$/, ""))} name={x.it.name} size={26} />
                {#if !console}<span class="dim small">{x.spare ? `${x.spare.quantity} spare of ${x.held}` : `you hold ${x.held}`}</span>{/if}
              </button>
            {/each}
          </div>{/if}</span>
        {#if console && (!matches.length || !searchOpen)}<span class="dim small hint">Type a name, pick it, then set how many you have to sell and the price.</span>
        {:else if !matches.length || !searchOpen}<span class="dim small hint">or the <Icon name="list" size={13} /> on any card or row in Inventory, Sets, Prime parts, Arcanes, Mods or Relics.</span>{/if}
        <HelpMark part="orders.new-listing" />
      </section>
    </div>
    <div class="bar tools">
      <div class="grp">
        <ProgressButton job={checkJob} busy={mkt.pass === "Checking prices"} progress={mkt.pass === "Checking prices" ? passFill : undefined} label="Check prices" working={passCount ? `Checking ${passCount}` : "Checking…"} sizer={["Checking 00/00", "00 to reprice"]}
          title={mkt.pass === "Checking prices" && !mkt.passManual ? "The timer's own check is running" : "Read the order books and show, per listing below, what it would be repriced to"} disabled={!!mkt.busy} onclick={checkPrices} />
        <ProgressButton tone="primary" job={repriceJob} busy={mkt.pass === "Repricing"} progress={mkt.pass === "Repricing" ? passFill : undefined} label={pending ? `Reprice ${pending}` : "Reprice"} working={passCount ? `Repricing ${passCount}` : "Repricing…"} sizer={["Repricing 00/00", "00 repriced"]}
          title={mkt.pass === "Repricing" && !mkt.passManual ? "Apply automatically is sending new prices now" : pending ? `Send the new prices to warframe.market: the ${pending} listing${pending === 1 ? "" : "s"} with a Will set` : "Nothing to change: Check prices first, or every listing matches already"} disabled={!!mkt.busy || !pending} onclick={repriceNow} />
      </div>
      {#if lastFail && !mkt.pass}<p class="err small lastfail" role="status">{lastFail.why} <button type="button" class="link" onclick={lastFail.again}>Try again</button> <button type="button" class="link quiet" onclick={() => (lastFail = null)}>Dismiss</button></p>{/if}
      <!-- The repricer's settings fold into one line that says how it's set: they're set once, not each visit. -->
      <Fold label={autoLine} title="The repricer's settings: checking and applying on a timer, the floor under prices and the lowest price anything is listed at">
        <div class="grp autos">
          <!-- Time left to the next timed pass: a hairline that runs out (longer while warframe.market isn't answering). -->
          {#if nextPass && !mkt.pass}{#key `${mkt.lastPass}|${passWait}`}<i class="countdown" aria-hidden="true" style:animation-duration="{passWait}ms" style:animation-delay="-{Math.min(passWait, Math.max(0, Date.now() - (mkt.lastPass ?? 0)))}ms"></i>{/key}{/if}
          <Chip bind:on={settings.autoCheck} label="Check automatically" title="Read the order books on a timer while MyOrbiter is open, and show what each listing would change to" onchange={(on) => { if (!on) settings.auto = false; }} />
          <Chip bind:on={settings.auto} label="Apply automatically" title={`Automatic repricing: also send new prices to warframe.market on that timer, without asking. ${DRIFT_RULES}. ${GREY_AREA}.`} onchange={(on) => { if (on) settings.autoCheck = true; }} />
          <select bind:value={settings.every} aria-label="How often" title="How often the automatic check runs" disabled={!settings.autoCheck && !settings.auto}>
            {#each [1, 2, 5, 10, 15, 30, 60] as m (m)}<option value={m}>every {m} min</option>{/each}
          </select>
        </div>
        <p class="dim small limits">Apply automatically changes your prices without asking. {DRIFT_RULES}; never under {Math.round(AUTO_FLOOR_SHARE * 100)}% of the price you last set, nor under your floors. {GREY_AREA}.</p>
        <!-- The other automatic actions, the same switches and lines as Settings, Trades. -->
        {#if !console}
          <div class="grp autos">
            <Chip bind:on={settings.autoTrades} label="Mark sales sold from the game" title={AUTO_TRADES_LINE} />
            <Chip bind:on={settings.autoRep} label="Give +rep by itself" title={AUTO_REP_LINE} />
          </div>
          <p class="dim small limits"><b>Mark sales sold from the game</b>: {AUTO_TRADES_LINE} <b>Give +rep by itself</b>: {AUTO_REP_LINE}</p>
        {/if}
        <div class="grp">
          <span class="register">Floor</span>
          <select bind:value={settings.minShare} aria-label="Floor" title="Never lower a listing under this share of the item's daily market price (a per-listing floor in the table wins)">
            {#each [0, 0.3, 0.5, 0.7, 0.85] as f (f)}<option value={f}>{f ? `${f * 100}% of market` : "none"}</option>{/each}
          </select>
          <span class="register" title="Nothing is listed or repriced below this, anywhere in MyOrbiter, unless its kind has its own minimum on Sell spares. The same setting as Never under on Sell spares">never under</span>
          <input class="minp" type="number" min="1" inputmode="numeric" value={settings.minPrice} aria-label="Minimum price" onchange={(e) => (settings.minPrice = minFrom(e.currentTarget, settings.minPrice))} onwheel={(e) => e.currentTarget.blur()} />
          <Metal kind="plat" size={14} />
          <button type="button" class="link small" title="Minimums by kind (relics, mods, prime parts…), each replacing this one for its kind: set on Sell spares{Object.keys(settings.minByCategory ?? {}).length ? `. Now: ${minimumsText(settings)}` : ""}" onclick={() => go("spares")}>by kind on Sell spares</button>
        </div>
      </Fold>
      {#if nextPass}<span class="register next" title={mkt.passFailures ? `warframe.market didn't answer the last ${mkt.passFailures === 1 ? "pass" : `${mkt.passFailures} passes`}, so the timer waits longer (${Math.round(passWait / 60_000)} min) before the next` : `The timer checks every ${settings.every} min`}>{mkt.pass && !mkt.passManual ? "Checking now" : `Next check ${fmt(+nextPass)}`}</span>{/if}
      {#if hiddenOrders.length || showJob.state !== "idle"}<ProgressButton class="showall" variant="link" job={showJob} label={hiddenOrders.length === 1 ? "Make 1 hidden listing visible" : `Make ${hiddenOrders.length} hidden listings visible`} working="Showing {showJob.done}/{showJob.total ?? '…'}" sizer={[`Showing ${hiddenOrders.length}/${hiddenOrders.length}`]} title="Make every hidden listing visible to buyers again" disabled={!!mkt.op} onclick={showAll} />{/if}
      <HelpMark part="orders.reprice" />
    </div>

    <table class="orders" class:ownfloors={rows.some((o) => settings.floors[listingKey(o)] != null)}>
      <thead data-card="sort">
        <tr>
          {@render sh("name", "Item", "", "Sort by name")}{@render sh("qty", "Qty", "right", "Sort by how many you list")}{@render sh("price", "Your price", "right", "Sort by your price (click again for the other way)")}{@render sh("cheapest", "Market price", "", "The second-cheapest seller online or in game right now, one order each (the cheapest alone isn't followed: it may be bait), and how many sellers there are, from the last check. Sort by it")}<th class="vslow" title="Your price against the cheapest seller online or in game at the last check: +n when someone is under you (undercut), Even when you match them, −n when you're the cheapest. Reprice follows the second-cheapest, not this">Against lowest</th>
          {@render sh("change", "Will set", "right willset", "What the repricer would change the price to, and why. Sort by the change (the biggest rises first, falls last)")}<th class="right floorcol" title="Never go below this">Floor</th><th class="center" title="Auto-price on: when you check prices, this listing is moved to the market price, the second-cheapest seller online or in game (never under its floor). Off: MyOrbiter leaves its price as you set it">Auto-price</th><th class="center" title="Whether buyers see the listing on warframe.market (hidden ones keep their place)">Shown</th><th></th>
        </tr>
      </thead>
      <!-- One body a listing (its row, and the rows under it), so it can leave and the rest close up. -->
      {#each rows as o (o.id)}
        {@const it = mkt.item(o.itemId)}
        <tbody out:leave={{ duration: SETTLE }} animate:flip>
          {#if ghostIds.has(o.id)}
            <!-- Sold out or removed: the listing is gone, this row stays to say how it went, then leaves. -->
            <tr class="order ghost" class:done={rowBusy.get(o.id).state === "done"}>
              <td class="fade c-item" colspan="10"><div class="ghostline"><Named file={model.imageOf(it?.name ?? "")} name={it?.name ?? o.itemId} />{@render rowStatus(o.id)}</div></td>
            </tr>
          {:else}
          {@const p = plans.get(o.id)}
          {@const shown = isShown(o)}
          {@const paused = settings.paused[listingKey(o)]}
          {@const held = stock(o)}
          {@const change = changeOf(o)}
          <tr class="order" class:hidden={!shown}>
            <td class="fade c-item">
              <Named file={model.imageOf(it?.name ?? "")} name={it?.name ?? o.itemId}>
                {#if it}<button type="button" class="charted" class:on={charted === o.id} aria-label="Price history" aria-expanded={charted === o.id} title="What it sold for over the last 90 days, against your price" onclick={() => (charted = charted === o.id ? null : o.id)}><Icon name="chart" size={13} /></button>{/if}
                {#if rankLabel(o)}<span class="tag">{rankLabel(o)}</span>{/if}
                {#if it && collecting.has(it.name) && !o.rank}{@const c = collecting.get(it.name)!}<span class="tag ok" title="You're collecting copies to max it ({c.copies} of {c.needed}, on Arcanes): selling these sets you back">still collecting</span>{/if}
              </Named>
              {@render rowStatus(o.id)}
            </td>
            <td class="right c-qty" data-label="Qty">
              <input type="number" min="1" inputmode="numeric" class:edited={change?.quantity != null} value={edits[o.id]?.quantity ?? o.quantity}
                oninput={(e) => edit(o, "quantity", e.currentTarget.value)} onkeydown={(e) => editKey(o, e)} onwheel={(e) => e.currentTarget.blur()} aria-label="Quantity" />
            </td>
            <td class="right c-price" data-label="Your price">
              <input type="number" min="1" inputmode="numeric" class:edited={change?.platinum != null} value={edits[o.id]?.platinum ?? o.platinum}
                oninput={(e) => edit(o, "platinum", e.currentTarget.value)} onkeydown={(e) => editKey(o, e)} onwheel={(e) => e.currentTarget.blur()} aria-label="Your price" />
              <!-- Narrow windows hide Will set: what Reprice would do shows under the price instead. -->
              {#if p?.change && !paused && shown && !change}<div class="willnote" class:up={p.target > o.platinum} title={p.reason === "floor" ? "Reprice sets this, held up by the floor" : "Reprice sets this"}>→ {p.target}p{p.reason === "floor" ? (p.competitor.price != null && p.target > p.competitor.price ? " · over market" : " · floor") : ""}</div>{/if}
              {#if badEdit(o)}<p class="err small">{badEdit(o)}</p>{/if}
              {#if change}
                {@const over = overHeld(o)}
                {#if over}<p class="err small">{over}</p>{/if}
                <div class="save">
                  <ProgressButton variant="icon" icon="check" tone="gold" job={rowBusy.get(o.id)} state={rowBusy.get(o.id).working ? "working" : "idle"} label="Save" working="Saving…" title={over ?? "Save: update the listing on warframe.market (Enter)"} disabled={!!mkt.op || !!over} onclick={() => save(o)} />
                  <IconButton icon="undo" tone="quiet" label="Undo" title="Undo: put back {o.quantity} at {o.platinum}p (Esc)" onclick={() => revert(o)} />
                </div>
              {/if}
            </td>
            <td class="fade c-comp" data-label="Market price">
              {#if p && p.competitor.price != null}
                <span class="comp"><P v={p.competitor.price} /> <span class="dim small"><span class="who" title={p.competitor.cheapest?.name ?? undefined}>{p.competitor.cheapest?.name}</span>&nbsp;· <span class="nowrap" title="Sellers online or in game, one order each">{p.competitor.sellers} online</span>{#if p.competitor.lowest && p.competitor.lowest.platinum !== p.competitor.price}<span class="nowrap" title="{p.competitor.lowest.name ?? 'One seller'} asks {p.competitor.lowest.platinum}p, the cheapest. The cheapest alone isn't followed, the second-cheapest is, so one listing (bait or a mistake) can't pull your price down. Buy it if it's a deal."> · cheapest {p.competitor.lowest.platinum}p</span>{/if}</span></span>
                {@const goes = goesFor(p)}
                {#if goes != null}<div class="register goes" title="Every seller online or in game asks more than twice what it really goes for: what it sold for lately, or what sellers on the site ask if that's lower ({p.competitor.askLevel ?? '–'}p, in game or not). Priced at that, so it sells.">goes for ~{goes}p</div>
                {:else if p.competitor.ladder.length > 1}<div class="register ladder" title="The market price and the next ones up, sellers online or in game">{p.competitor.ladder.join(" · ")}</div>{/if}
              {:else if p}<span class="dim small" title="The market price needs two sellers online or in game">{p.competitor.sellers ? "One seller online" : "Nobody online"}</span>
              {:else if !shown || paused}<span class="none" title="The order book isn't read for a listing that's {shown ? 'left alone' : 'hidden'}">–</span>
              {:else}<span class="dim small">Not checked yet</span>{/if}
            </td>
            <td class="vslow">
              {#if shown}
                {@const d = againstLowest(o, p)}
                {#if d != null}<span class="tag vs" class:under={d > 0} title={d > 0 ? `${p?.competitor.lowest?.name ?? "A seller"} asks ${p?.competitor.lowest?.platinum}p, ${d}p under your ${o.platinum}p` : d === 0 ? "You match the cheapest seller online or in game" : `You're the cheapest, ${-d}p under the next seller online or in game`}>{d > 0 ? `+${d}` : d === 0 ? "Even" : `−${-d}`}</span>{/if}
              {/if}
            </td>
            <td class="right fade willset">
              {#if p?.change && !paused && shown}<span class="target" class:down={p.target < o.platinum} class:up={p.target > o.platinum}><span class="dim">{o.platinum} →</span> <P v={p.target} /> <span class="delta">{p.target > o.platinum ? "+" : "−"}{Math.abs(p.target - o.platinum)}</span>{#if p.reason === "floor" && crackHeld(o, p) != null}<span class="tag ok" title="Worth more cracked: a crack of it is worth about {crackHeld(o, p)}p, so it isn't listed under {p.floor}p. Take it down to crack it instead.">crack</span>{:else if p.reason === "floor" && p.competitor.price != null && p.target > p.competitor.price}<span class="tag alert" title={minimumHeld(o, p) != null ? `Your ${p.floor}p minimum (Sell spares) is over the market price (${p.competitor.price}p): at this price it's unlikely to sell. Lower the minimum on Sell spares, or take it down.` : `Your floor (${p.floor}p) is over the market price (${p.competitor.price}p): at this price it's unlikely to sell. Lower this listing's floor, or take it down.`}>over market</span>{:else if p.reason === "floor"}<span class="tag ok" title={minimumHeld(o, p) != null ? `Held up by your ${p.floor}p minimum (Sell spares)` : "Held up by the floor"}>{minimumHeld(o, p) != null ? "minimum" : "floor"}</span>{:else if p.reason === "median"}<span class="tag" title="Every seller online or in game asks more than twice what it really goes for ({p.competitor.lowest?.platinum ?? p.competitor.price}p and up): priced at that instead">sells for</span>{/if}</span>
              {:else if !shown}<span class="register" title="Hidden listings aren't repriced">hidden</span>
              {:else if paused}<span class="register" title="Auto-price is off: MyOrbiter leaves this price as you set it">left alone</span>
              {:else if p && goesFor(p) != null}<span class="register ok" title="At what it really goes for: sellers online or in game ask {p.competitor.lowest?.platinum ?? p.competitor.price}p and up">at its value</span>
              {:else if p}<span class="register ok">matched</span>{/if}
            </td>
            <td class="right floorcol"><input type="number" min="1" style:width="4.8rem" placeholder={p ? `auto ${p.floor}` : "auto"} aria-label="Floor for this listing" title="Your own floor for this listing; empty uses the automatic one" value={settings.floors[listingKey(o)] ?? ""} onchange={(e) => setFloor(o, e.currentTarget.value)} /></td>
            <td class="center c-auto" data-label="Auto-price"><Toggle on={!paused && shown} disabled={!shown} label="Auto-price: follow the market price" title={!shown ? "Hidden listings aren't repriced" : paused ? "Auto-price off: the price stays as you set it" : "Auto-price on: kept at the market price, the second-cheapest seller online or in game"} onchange={() => togglePause(o)} /></td>
            <td class="center c-shown" data-label="Shown"><span class="shake" use:shake={refusedShown[o.id]}><Toggle on={shown} label="Shown to buyers" title={shown ? "Visible to buyers" : "Hidden from buyers"} disabled={!rowFree(o.id)} onchange={(v) => setVisible(o, v)} /></span></td>
            <td class="right c-acts">
              <!-- Three fixed places, the same on every row: sold one, sold several, remove. A
                   confirm takes over the same places, its safe choice where the click just was. -->
              <span class="acts">
                {#if pendingSold[o.id]}
                  <span class="pendrow">
                    <span class="register pending" title="Sent to warframe.market in a moment: marked sold, the listing lowered, the sale logged">Sold {pendingSold[o.id]}<i aria-hidden="true"></i></span>
                    <button type="button" class="link undo" title="Undo: nothing is sent" onclick={(e) => { const acts = e.currentTarget.closest(".acts"); refocus(e.currentTarget, () => acts?.querySelector<HTMLElement>('[aria-label="Remove"]')); undoSale(o.id); }}>Undo</button>
                  </span>
                {:else if selling?.id === o.id}
                  {@const n = selling.n}
                  {@const bad = n < 1 ? "At least 1" : n > o.quantity ? `Only ${o.quantity} listed` : null}
                  <input type="number" min="1" max={o.quantity} inputmode="numeric" class:bad value={selling.n} aria-label="How many you sold" title={bad ?? "How many you sold"} use:focusIt oninput={(e) => selling && (selling.n = Math.round(Number(e.currentTarget.value)) || 0)} onkeydown={(e) => { if (e.key === "Enter") recordSale(o, selling?.n ?? 1); else if (e.key === "Escape") { e.stopPropagation(); selling = null; } }} onwheel={(e) => e.currentTarget.blur()} />
                  <IconButton icon="check" tone="gold" label={bad ?? `Sold ${n}`} title={bad ?? `Mark ${n} sold on warframe.market and log the sale`} disabled={!!bad} onclick={() => recordSale(o, selling?.n ?? 1)} />
                  <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => (selling = null)} />
                {:else if removing === o.id}
                  <span class="ask register">Remove?</span>
                  <IconButton icon="trash" tone="danger" label="Remove it" title="Remove it: take {it?.name ?? 'this listing'} off warframe.market" disabled={!rowFree(o.id)} onclick={() => { removing = null; removeRow(o); }} onkeydown={onEsc(() => (removing = null), true)} />
                  <button type="button" class="ib quiet" aria-label="Keep" title="Keep it" onclick={(e) => { keepRow(e); removing = null; }} onkeydown={onEsc(() => (removing = null), true)} use:focusIt><Icon name="close" /></button>
                {:else}
                  <IconButton icon="sold" tone="gold" disabled={rowBusy.busy(o.id)} label={o.quantity > 1 ? "Sold one" : "Sold"} title="Sold {o.quantity > 1 ? 'one' : 'it'} in game: marked sold on warframe.market (recorded on your profile), the listing goes down by one and the sale is logged. You get a few seconds to undo." onclick={() => recordSale(o, 1)} />
                  {#if o.quantity > 1}<IconButton icon="sold-many" tone="quiet" disabled={rowBusy.busy(o.id)} label="Sold several" title="Sold several at once: say how many" onclick={() => (selling = { id: o.id, n: 2 })} />{:else}<span class="slot"></span>{/if}
                  <!-- Set apart from the sale buttons: a slip of the mouse shouldn't land on it. -->
                  <span class="apart"><IconButton icon="trash" tone="danger quiet" label="Remove" title="Remove: take this listing off warframe.market" disabled={rowBusy.busy(o.id)} onclick={() => (removing = o.id)} /></span>
                {/if}
              </span>
            </td>
          </tr>
          {#if held != null && held < o.quantity}
            <!-- Its own row under the listing, so the listing keeps to one line. -->
            <tr class="fixrow"><td colspan="10">
                <!-- Holding fewer than you list usually means some sold: say so, and MyOrbiter closes them. -->
                <!-- A question with two answers: both buttons change the listing on warframe.market. -->
                <div class="fix">
                  <span class="small q"><b class="held" title="As of TennoScope's last read of your inventory">! You {held === 0 ? "have none" : `hold ${held}`}</b> <span class="dim">· {o.quantity - held} gone since you listed. Sold?</span></span>
                  <button class="stamp" disabled={rowBusy.busy(o.id)} onclick={() => recordSale(o, o.quantity - held)} title="Log the sale on Sales and {held === 0 ? 'close the listing' : `lower the listing to ${held}`} on warframe.market">Yes: log {o.quantity - held} sold</button>
                  {#if held === 0}<button class="stamp" onclick={() => (removing = o.id)} title="You didn't sell it (used it in game, say): just take the listing down on warframe.market">No: remove listing</button>
                  {:else}<button class="stamp" disabled={!rowFree(o.id)} onclick={() => lowerTo(o, held)} title="You didn't sell them (used in game, say): just lower the listing to {held} on warframe.market">No: list {held} instead</button>{/if}
                </div>
            </td></tr>
          {/if}
          {#if charted === o.id && it}
            <tr class="chartrow">
              <td colspan="10">
                <PriceHistory name={it.name} rank={it.maxRank != null ? (o.rank ?? 0) : null} subtype={o.subtype ?? it.subtypes?.[0] ?? null} height={160}
                  lines={[{ label: "Your price", value: o.platinum, color: "var(--chart-mine)" }, ...(p?.competitor.price != null ? [{ label: "Market price", value: p.competitor.price, color: "var(--chart-theirs)" }] : [])]} />
              </td>
            </tr>
          {/if}
          {/if}
        </tbody>
      {:else}
        <tbody><tr><td colspan="10" class="nothing">No sell listings yet</td></tr></tbody>
      {/each}
    </table>
    {#if mkt.orders.length}
      <!-- Away from the buttons you press every day: it takes every listing down. -->
      <div class="danger-zone">
        {#if confirmRemoveAll}
          <span class="small warn" in:opens>Take all {mkt.orders.length} listings off warframe.market?</span>
          <button class="danger" in:opens disabled={!!mkt.busy} title="Take every one of your sell listings down now" onclick={() => { confirmRemoveAll = false; removeAll(); }} onkeydown={keepOnEsc}>Remove all</button>
          <button in:opens title="Keep your listings as they are" onclick={(e) => { const zone = e.currentTarget.closest(".danger-zone"); refocus(e.currentTarget, () => named(zone, null)); confirmRemoveAll = false; }} onkeydown={keepOnEsc} use:focusIt>Keep them</button>
        {:else}
          <ProgressButton variant="link" tone="danger" class="removeall" job={removeJob} label="Remove all my listings" working={removeCount()} progress={removeFill()} sizer={["Removing 000/000"]} title="Take every one of your sell listings off warframe.market (it asks first)" disabled={!!mkt.busy} onclick={() => (confirmRemoveAll = true)} />
        {/if}
      </div>
      {#if removeJob.state === "failed" && removeJob.error}<p class="small err" role="status">{removeJob.error}</p>{/if}
    {/if}
    {#if mkt.buys.length}
      <!-- Buy orders you posted (from Wishlist, or on the website): what you're paying, and a way to take one down. -->
      <section class="buys" aria-label="Your buy orders">
        <h2 class="register yours">Your buy orders<HelpMark part="orders.buy-orders" /></h2>
        <ul>
          {#each mkt.buys as o (o.id)}
            {@const it = mkt.item(o.itemId)}
            <li out:leave animate:flip>
              <Named file={model.imageOf(it?.name ?? "")} name={it?.name ?? o.itemId} size={26}>{#if o.rank != null}<span class="tag">R{o.rank}</span>{/if}{#if !o.visible}<span class="tag">hidden</span>{/if}</Named>
              <span class="dim small">wants {o.quantity}</span>
              {@render rowStatus(o.id)}
              <P v={o.platinum} />
              {#if removing === o.id}
                <IconButton icon="trash" tone="danger" label="Take it down" title="Take this buy order off warframe.market" disabled={!rowFree(o.id)} onclick={() => { removing = null; removeRow(o, true); }} onkeydown={onEsc(() => (removing = null), true)} />
                <button type="button" class="ib quiet" aria-label="Keep" title="Keep it" onclick={(e) => { keepRow(e); removing = null; }} onkeydown={onEsc(() => (removing = null), true)} use:focusIt><Icon name="close" /></button>
              {:else}
                <IconButton icon="trash" tone="danger quiet" label="Remove" title="Remove: take this buy order off warframe.market" disabled={rowBusy.busy(o.id)} onclick={() => (removing = o.id)} />
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if auctions.length}
      <!-- Riven auctions: warframe.market keeps them apart from listings, and they aren't repriced automatically. -->
      <section class="buys" aria-label="Your riven auctions">
        <h2 class="register yours">Your riven auctions<HelpMark part="orders.auctions" /></h2>
        <ul>
          {#each auctions as a (a.id)}
            {@const w = weaponOf(a)}
            <li out:leave animate:flip>
              <Named file={w ? (model.catalogByUnique.get(w.gameRef)?.imageName ?? model.imageOf(w.name)) : null} name={auctionTitle(a)} size={26}>{#if !a.visible}<span class="tag">hidden</span>{/if}</Named>
              {#if auctionPrice?.id === a.id}
                <span class="plat"><input type="number" min="1" bind:value={auctionPrice.buyout} aria-label="New buyout price" use:focusIt onkeydown={onEsc(() => (auctionPrice = null))} /></span>
                <ProgressButton variant="icon" icon="check" tone="gold" state={auctionPrice.busy ? "working" : "idle"} label="Save the new price" working="Saving…" title="Save: change this auction's buyout on warframe.market" disabled={!auctionPrice.buyout} onclick={() => saveAuctionPrice(a)} />
                <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => (auctionPrice = null)} />
                {#if auctionPrice.error}<span class="err small">{auctionPrice.error}</span>{/if}
              {:else}
                {@const e = auctionEst(a)}
                <span class="dim small">{a.topBid != null ? `top bid ${a.topBid}p · ` : ""}{a.starting < (a.buyout ?? Infinity) ? `bids from ${a.starting}p` : "no bidding"}</span>
                {#if e}<span class="dim small nowrap" title="MyOrbiter's estimate of what a riven like it is listed for: the middle half of such listings ask {e.lo}–{e.hi}p">estimate ~{e.mid}p</span>{#if a.buyout != null && a.buyout > e.hi}<span class="tag alert" title="Your buyout is over what three in four rivens like it ask ({e.hi}p): it may sit unsold">over</span>{:else if a.buyout != null && a.buyout < e.lo}<span class="tag" title="Your buyout is under what three in four rivens like it ask ({e.lo}p): you may be leaving platinum behind">under</span>{/if}{/if}
                {#if a.buyout != null}<P v={a.buyout} />{:else}<span class="dim small">no buyout</span>{/if}
                <IconButton icon="pencil" tone="quiet" label="Change price" title="Change its buyout price" onclick={() => (auctionPrice = { id: a.id, buyout: a.buyout, busy: false, error: null })} />
                <ProgressButton variant="icon" icon="external" tone="quiet" label="Open on warframe.market" working="Opening…" busy={links.isOpening(`https://warframe.market/auction/${a.id}`)} onclick={() => openUrl(`https://warframe.market/auction/${a.id}`)} />
                {#if removing === `auction:${a.id}`}
                  <IconButton icon="trash" tone="danger" label="Take it down" title="Close this auction (it stays among your profile's closed auctions)" disabled={auctionBusy === a.id} onclick={() => { removing = null; void takeDownAuction(a); }} onkeydown={onEsc(() => (removing = null), true)} />
                  <button type="button" class="ib quiet" aria-label="Keep" title="Keep it" onclick={(e) => { keepRow(e); removing = null; }} onkeydown={onEsc(() => (removing = null), true)} use:focusIt><Icon name="close" /></button>
                {:else}
                  <ProgressButton variant="icon" icon="trash" tone="danger quiet" state={auctionBusy === a.id ? "working" : "idle"} label="Take down" working="Taking down…" title="Take down: close this auction on warframe.market" onclick={() => (removing = `auction:${a.id}`)} />
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
        {#if auctionError}<p class="err small">{auctionError}</p>{/if}
        <p class="dim small">Riven auctions aren't repriced automatically: change a price here or on Rivens, where each riven's card has what similar ones are listed for.</p>
      </section>
    {/if}
    {#if mkt.log.length}
      <section class="log" aria-label="Activity">
        <div class="loghead"><span class="register">Activity</span><HelpMark part="orders.activity" /></div>
        {#each mkt.log.slice(0, 30) as l (l.at + l.text)}
          <div class="line {l.tone}"><span class="register">{fmt(l.at)}</span> {l.text}</div>
        {/each}
      </section>
    {/if}
  </div>
  </div>
  {/if}
</div></div>

<style>
  /* The figure tiles: four across, two by two in a compact pane; three fill the row on a console. */
  .tiles { position: relative; display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 16px; margin-bottom: var(--step); }
  :global(html[data-room~="lt1100"]) .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile {
    min-width: 0; padding: 14px 18px 12px; clip-path: var(--cut);
    background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule); box-shadow: var(--plate-light);
  }
  .tile .register { color: var(--platinum-dim); }
  .fv { display: flex; align-items: center; gap: 14px; margin-top: 10px; min-width: 0; }
  .fv :global(.meter) { flex: 1; min-width: 0; }
  .fig { font-size: clamp(1.9rem, 2.6vw, 2.5rem); font-variant-numeric: tabular-nums; line-height: 1; }
  .fig.gold { color: var(--gold); }
  .fig.bad { color: var(--oxblood); }
  .fig.none { color: var(--platinum-deep); }
  .tile .note { margin: 8px 0 0; font-size: .74rem; color: var(--platinum-deep); }
  .tile .note.over { color: var(--oxblood); }
  /* A wide pane: your status, who whispered and Sell spares beside the listings rather than above them. */
  :global(html[data-room~="ge1700"]) .desk { display: grid; grid-template-columns: minmax(0, 1fr) 22rem; column-gap: 24px; align-items: start; }
  :global(html[data-room~="ge1700"]) .side { grid-column: 2; grid-row: 1; display: grid; gap: var(--step); margin-top: var(--step); }
  :global(html[data-room~="ge1700"]) .side > :global(*) { margin: 0; }
  :global(html[data-room~="ge1700"]) .work { grid-column: 1; grid-row: 1; min-width: 0; }
  :global(html[data-room~="ge1700"]) .side .sparesline { flex-wrap: wrap; }
  :global(html[data-room~="ge1700"]) .side .sparesline .sub { order: 3; flex-basis: 100%; white-space: normal; }
  :global(html[data-room~="ge1700"]) .side .sparesline .go { margin-left: auto; }
  .status { display: flex; flex-wrap: wrap; align-items: flex-start; gap: .6rem 1rem; margin-top: var(--step); padding: .6rem; background: var(--plate); border: 1px solid var(--rule); }
  .status > .register { padding-top: .55rem; }
  .status > :global(.helpmark) { margin-top: 4px; }
  .whispers > :global(.helpmark) { margin-left: auto; }
  /* The activity's head stays in sight while its lines scroll under it. */
  .loghead { position: sticky; top: -.7rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-top: -.2rem; background: var(--plate); }
  .account { display: inline-flex; align-items: center; gap: .4rem; white-space: nowrap; padding-top: .2rem; }
  .account .who { margin-right: .4rem; }
  .account :global(.ib) { --ib: 32px; }
  .who strong { color: var(--platinum); font-weight: 600; }
  h2.yours { margin: 0; }
  .buys { margin-top: var(--step); display: grid; gap: .5rem; }
  .buys ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .buys li { display: flex; align-items: center; gap: .9rem; padding: .35rem .5rem; border: 1px solid var(--rule); }
  .buys li > :global(.named) { flex: 1; }
  .buys .plat input { width: 5.5rem; }
  .listhead { display: grid; gap: .7rem; margin-top: var(--step); padding-top: .9rem; border-top: 1px solid var(--rule); }
  .lhtop { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1.6rem; }
  /* The trade-chat line and the "?" together at the right end. */
  .lhtop > h2 { margin-right: auto; }
  .lhtop > :global(.helpmark) { margin-left: -1rem; }
  .minp { width: 4.2rem; padding: .4rem .5rem; }

  /* New listing: a search with a dropdown of what you hold. */
  .newlisting { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; flex: 1; min-width: 0; }
  .newlisting input { min-width: 16rem; }
  .hint :global(svg) { display: inline-block; vertical-align: -2px; color: var(--gold); }
  .searchbox { position: relative; display: inline-block; }
  .results { position: absolute; z-index: 5; top: calc(100% + 2px); left: 0; width: max(100%, 32rem); display: grid; background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 1rem 2rem rgb(0 0 0 / 50%); }
  .results .pick { display: flex; align-items: center; justify-content: space-between; gap: 1rem; text-align: left; border: 0; border-bottom: 1px solid var(--rule); background: transparent; padding: .4rem .8rem; }
  .results .pick:last-child { border-bottom: 0; }
  .results .pick:hover, .results .pick.active { background: var(--raised); }
  .results .pick .small { white-space: nowrap; text-transform: none; letter-spacing: 0; font-family: var(--face-text); }

  /* Quiet text actions in the table; Remove turns red only when you reach for it. */
  input.edited { border-color: var(--gold); color: var(--gold); box-shadow: inset 0 0 0 1px var(--gold-dim); }
  .save { display: flex; justify-content: flex-end; gap: .35rem; margin-top: .35rem; }
  .err { color: var(--oxblood); margin: .3rem 0 0; text-align: right; white-space: normal; }
  .out { display: inline-flex; align-items: center; gap: .8rem; }
  .row .out { margin-left: 0; padding-left: 0; border-left: 0; }
  .acts { display: inline-grid; grid-template-columns: auto 30px 30px; align-items: center; justify-items: end; gap: .35rem; white-space: nowrap; vertical-align: middle; }
  .acts .slot { width: 30px; }
  .orders .acts input[type="number"] { width: 3.4rem; height: 30px; padding: .3rem .4rem; }
  .orders .acts input.bad { border-color: var(--oxblood); color: var(--oxblood); }
  .ask { color: var(--oxblood); font-size: 11px; }
  .pendrow { grid-column: 1 / -1; display: inline-flex; align-items: center; gap: .7rem; }
  .pending { position: relative; color: var(--gold); font-size: 11px; padding-bottom: 3px; }
  /* Time left before it's sent: a line that runs out. */
  .pending i { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--gold); transform-origin: left; animation: wait 4s linear forwards; }
  @keyframes wait { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { .pending i { animation: none; } }
  .undo { font-size: 11px; }
  .fix { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .9rem; padding-left: calc(34px + .75rem); }
  /* The sold question sits in a row of its own under its listing, joined to it (no rule between). */
  .orders tr.fixrow > td { padding-top: 0; }
  .orders tr.order:has(+ tr.fixrow) > td { border-bottom-color: transparent; }
  :global(html[data-room~="lt760"]) .orders tr.order:has(+ tr.fixrow) { border-bottom: 0; padding-bottom: .3rem; }
  :global(html[data-room~="lt760"]) .orders tr.fixrow { display: block; padding: 0 0 .7rem; border-bottom: 1px solid var(--rule); }
  :global(html[data-room~="lt760"]) .orders tr.fixrow > td { display: block; border: 0; padding: 0; }
  .lastfail { flex-basis: 100%; margin: 0; }
  .fix .held { color: var(--alert); font-weight: 600; }
  .fix .stamp { padding: .35rem .7rem; }
  /* Each button on one line; in a narrow window they sit under the name rather than squeezed beside it. */
  .fix button { white-space: nowrap; }
  :global(html[data-room~="lt1100"]) .fix { padding-left: 0; }

  /* The page's error box; not the tags of the same name ("over market"), which keep the tag's own look. */
  div.alert { border: 1px solid var(--oxblood); color: var(--oxblood); padding: .7rem 1rem; margin: var(--step) 0; font-size: .84rem; }
  .panel { position: relative; border: 1px solid var(--rule); background: var(--plate); padding: 1.2rem 1.4rem; margin: var(--step) 0; display: grid; gap: .8rem; }
  .signin h2 { font-size: 1.9rem; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }
  .wide { min-width: 28rem; }
  code { font-family: var(--face-figures); color: var(--platinum); }

  /* Groups kept apart by space, not rules: a rule would start the second line when they wrap. */
  .tools { gap: .6rem 2.2rem; }
  .grp { display: flex; align-items: center; gap: .5rem; }
  .next { margin-left: auto; }
  /* Check / Apply automatically: a hairline under them runs out until the next timed pass. */
  .autos { position: relative; }
  /* What Apply automatically may do, in a sentence, under its switch. */
  .limits { flex-basis: 100%; max-width: 70ch; margin: 0; line-height: 1.5; }
  .countdown { position: absolute; left: 0; right: 0; bottom: -5px; height: 1px; background: var(--gold-dim); transform-origin: left center; animation: runout linear forwards; pointer-events: none; }
  @keyframes runout { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { .countdown { display: none; } }

  /* A row's own work, under its name. */
  .rowst { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem .5rem; margin-top: .3rem; padding-left: calc(34px + .75rem); font-family: var(--face-register); font-size: .74rem; letter-spacing: .08em; text-transform: uppercase; color: var(--platinum-dim); white-space: normal; }
  .buys .rowst { margin-top: 0; padding-left: 0; }
  :global(html[data-room~="lt1100"]) .rowst { padding-left: 0; }
  .rowst.done { color: var(--verdigris); }
  .rowst.failed { color: var(--oxblood); text-transform: none; letter-spacing: 0; font-family: var(--face-text); font-size: .78rem; }
  .rowst .link { font-size: 11px; }
  .busyword { position: relative; padding-bottom: 3px; }
  /* The band runs by transform (app.css, sweep-band), clipped to the word's width. */
  .busyword i { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; overflow: hidden; }
  .busyword i::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 40%; background: linear-gradient(90deg, transparent, var(--gold), transparent); animation: sweep-band 1.2s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .busyword i { background: var(--gold-dim); } .busyword i::before { display: none; } }
  .bang { display: inline-grid; place-items: center; width: 1.05em; height: 1.05em; border: 1px solid currentColor; font-family: var(--face-register); font-size: .72rem; font-weight: 700; line-height: 1; }
  /* Sold out, on its way off: dimmed by colour, not opacity, so its words stay readable (about 5:1). */
  tr.ghost td { color: var(--platinum-deep); --platinum: var(--platinum-deep); --platinum-dim: var(--platinum-deep); }
  tr.ghost td :global(img), tr.ghost td :global(.mk) { opacity: .6; }
  /* Its name and how it went on one line, so the row keeps about a listing's height. */
  .ghostline { display: flex; align-items: center; flex-wrap: wrap; gap: .3rem 1.2rem; min-height: 36px; }
  .ghostline .rowst { margin-top: 0; padding-left: 0; }
  /* Ticked off: the name struck through, as Sell spares strikes a sent line. */
  tr.ghost.done :global(.name-mark) { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--verdigris) 70%, transparent); }
  .tickoff { display: inline-grid; line-height: 0; }
  /* The Shown switch's own box, for the shake when warframe.market refuses. */
  .shake { display: inline-block; }

  .log { margin-top: var(--step); max-height: 9.5rem; overflow: auto; display: grid; gap: .3rem; padding: .7rem 1rem; border: 1px solid var(--rule); background: var(--plate); }
  .line { font-size: .82rem; color: var(--platinum-dim); }
  .line.ok { color: var(--platinum); }
  .line.warn { color: var(--oxblood); }
  .line .register { margin-right: .6rem; }

  /* The listings table. */
  table.orders { width: 100%; border-collapse: collapse; margin-top: var(--step); border-top: 1px solid var(--rule); font-variant-numeric: tabular-nums; }
  .orders th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .15em; text-transform: uppercase; color: var(--platinum-deep); padding: .7rem .6rem; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  .orders th.right { text-align: right; }
  .whispers { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1.2rem; margin: var(--step) 0 0; padding: .55rem .8rem; border: 1px solid var(--rule); border-left: 2px solid var(--gold-dim); background: var(--plate); }
  .wh { display: inline-flex; align-items: center; gap: .45rem; }
  /* Sell spares in one line: the whole line opens the page. */
  .sparesline { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: .7rem; margin: var(--step) 0 .4rem; padding: .7rem .9rem; border: 1px solid var(--rule); background: var(--plate); cursor: pointer; transition: border-color var(--quick) var(--out); }
  .sparesline:hover, .sparesline:focus-visible { border-color: var(--rule-bright); }
  .sparesline:hover .register, .sparesline:focus-visible .register { color: var(--platinum); }
  .sparesline:focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }
  .sparesline:active .go { transform: translateX(1px); }
  .sparesline .sub { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: .25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sparesline .go { display: inline-flex; align-items: center; gap: .35rem; color: var(--platinum-dim); transition: transform var(--snap) var(--out); }
  .danger-zone .warn { color: var(--alert); }
  .danger-zone { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; justify-content: flex-end; margin-top: .7rem; }
  .danger-zone :global(.removeall:not(.done):not(.failed)) { color: var(--platinum-deep); white-space: nowrap; }
  .danger-zone :global(.removeall:not(.done):not(.failed):hover:not(:disabled)) { color: var(--oxblood); }
  .orders th.sortable { cursor: pointer; user-select: none; }
  .orders th.sortable:hover, .orders th[aria-sort] { color: var(--platinum); }
  .orders th.sortable:focus-visible { outline: none; box-shadow: inset 0 -2px 0 var(--gold); color: var(--platinum); }
  .orders .arrow { margin-left: .3rem; color: var(--gold); }
  .orders th.center { text-align: center; }
  .orders td { padding: var(--row-pad) .6rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  .orders tbody tr:hover td { background: rgb(255 255 255 / 1.5%); }
  /* The table is a plate (app.css): its first and last columns keep off the plate's edges. */
  .orders th:first-child, .orders td:first-child { padding-left: .6rem; }
  .orders th:last-child, .orders td:last-child { padding-right: .6rem; }
  .orders input[type="number"] { width: 4.6rem; padding: .35rem .45rem; text-align: right; }
  /* Less room: the "Will set" column goes first, its note under the price instead. Page area under
     950 px (App sets the flag, by the room pages actually have): a 1000 px window with the sidebar
     folded, where the row's actions otherwise ran past the right edge. */
  :global(html[data-room~="lt950"]) .willset { display: none; }
  /* Against lowest: a tag, red when someone is under you. Narrow windows keep the market price's own "cheapest" note instead. */
  .tag.vs { margin-left: 0; }
  .orders :is(th, td).vslow { width: 1%; white-space: nowrap; }
  /* Its heading on two lines: the tags under it are short, the room goes to the market price. */
  .orders th.vslow { white-space: normal; line-height: 1.35; }
  .tag.vs.under { color: var(--oxblood); border-color: color-mix(in srgb, var(--oxblood) 55%, transparent); background: color-mix(in srgb, var(--oxblood) 14%, transparent); }
  :global(html[data-room~="lt1100"]) .vslow { display: none; }
  .willnote { display: none; margin-top: .2rem; font-family: var(--face-register); font-size: .74rem; letter-spacing: .06em; color: var(--oxblood); white-space: nowrap; }
  .willnote.up { color: var(--verdigris); }
  :global(html[data-room~="lt950"]) .willnote { display: block; }
  /* "auto 10" whole: the floor's placeholder without the wide capitals (and the box set wide enough, inline). */
  .floorcol input::placeholder { text-transform: none; letter-spacing: 0; font-size: .74rem; }
  /* The per-listing floor box goes next (your floors still apply, and the overall floor is above
     the table): half a 1080p screen leaves the page about 800 px, where it no longer fits. */
  :global(html[data-room~="lt900"]) .floorcol { display: none; }
  /* Details off: the per-listing floor goes (the automatic one still applies; Details shows it),
     unless a listing has a floor of your own. */
  :global(html:not([data-details])) .orders:not(.ownfloors) .floorcol { display: none; }
  /* Less still: the headings wrap onto two lines rather than set the column widths. */
  :global(html[data-room~="lt760"]) .orders th { white-space: normal; line-height: 1.35; }
  /* A narrow window: each listing a card. The item across the top, the rest in a row under it, each with its name. */
  :global(html[data-room~="lt760"]) table.orders thead { display: none; }
  :global(html[data-room~="lt760"]) table.orders, :global(html[data-room~="lt760"]) table.orders tbody { display: block; }
  :global(html[data-room~="lt760"]) .orders tr.order { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto auto; grid-template-areas: "item item item item item item" "qty price comp auto shown acts"; column-gap: .6rem; row-gap: .45rem; align-items: end; padding: .7rem .6rem; border-bottom: 1px solid var(--rule); }
  :global(html[data-room~="lt760"]) .orders tr.order > td { display: block; height: auto; border: 0; padding: 0 !important; }
  :global(html[data-room~="lt760"]) .orders tr.order > td:is(.willset, .floorcol, .vslow) { display: none; }
  :global(html[data-room~="lt760"]) .orders tr.order > td[data-label]::before { content: attr(data-label); display: block; margin-bottom: .25rem; font-family: var(--face-register); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); text-align: left; white-space: nowrap; }
  :global(html[data-room~="lt760"]) .orders .c-item { grid-area: item; }
  :global(html[data-room~="lt760"]) .orders .c-qty { grid-area: qty; }
  :global(html[data-room~="lt760"]) .orders .c-price { grid-area: price; }
  :global(html[data-room~="lt760"]) .orders .c-comp { grid-area: comp; min-width: 0; }
  :global(html[data-room~="lt760"]) .orders .c-auto { grid-area: auto; }
  :global(html[data-room~="lt760"]) .orders .c-shown { grid-area: shown; }
  :global(html[data-room~="lt760"]) .orders .c-acts { grid-area: acts; }
  :global(html[data-room~="lt760"]) .orders tr.chartrow, :global(html[data-room~="lt760"]) .orders tr.chartrow > td { display: block; }
  :global(html[data-room~="lt760"]) .orders input[type="number"] { width: 3.3rem; }
  :global(html[data-room~="lt760"]) .acts { gap: .3rem; }
  :global(html[data-room~="lt760"]) .orders :is(td, th):not(:first-child):not(:last-child) { padding-left: .3rem; padding-right: .3rem; }
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .orders input[type="number"] { width: 3.8rem; }
  /* The floor's "auto 10" has to fit whole, or it reads as a 1p floor. */
  :global(html[data-room~="lt1100"]) .orders :is(td, th) { padding-left: .4rem; padding-right: .4rem; }
  :global(html[data-room~="lt1100"]) .orders :is(td, th):first-child { padding-left: .5rem; }
  :global(html[data-room~="lt1100"]) .orders :is(td, th):last-child { padding-right: .5rem; }
  :global(html[data-room~="lt1100"]) .ladder { display: none; }
  :global(html[data-room~="lt1100"]) .acts { gap: .6rem; }
  /* A hidden listing reads faded; its switches and actions stay at full strength. Faded by colour
     (the tokens its parts use, turned down), not opacity, so its words stay readable (about 5:1). */
  tr.hidden td.fade { color: var(--platinum-deep); --platinum: var(--platinum-deep); --platinum-dim: var(--platinum-deep); --gold: var(--gold-dim); }
  tr.hidden td.fade :global(img), tr.hidden td.fade :global(.mk) { opacity: .45; }
  .right { text-align: right; }
  .center { text-align: center; }
  /* One height for every listing (a cell's height is its least): one with a ladder or a tag under it no taller than the rest. */
  .orders tr.order:not(.ghost) > td { height: 3.65rem; }
  .comp { display: inline-flex; align-items: center; gap: .45rem; }
  /* The seller's name cut short (whole on hover), so who sets it, how many sell and the cheapest
     take two lines at most and the row keeps its height. */
  .comp .who { display: inline-block; max-width: 6.5rem; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
  :global(html[data-room~="lt1100"]) .comp .who { max-width: 4.5rem; }
  /* "3 in game" stays on one line when the seller's name wraps. */
  .nowrap { white-space: nowrap; }
  .ladder { margin-top: .15rem; font-size: 11px; }
  .goes { margin-top: .15rem; font-size: 11px; color: var(--gold); }
  .none { color: var(--platinum-deep); }
  .target { display: inline-flex; align-items: center; justify-content: flex-end; white-space: nowrap; }
  .target.down .delta { color: var(--oxblood); }
  .target.up .delta { color: var(--verdigris); }
  .delta { font-family: var(--face-register); font-size: .74rem; margin-left: .3rem; }
  .register.ok { color: var(--verdigris); }
  .charted { all: unset; cursor: pointer; display: inline-grid; place-items: center; width: 22px; height: 22px; color: var(--platinum-deep); border: 1px solid transparent; }
  .charted:hover, .charted:focus-visible { color: var(--platinum); border-color: var(--rule-control); }
  .charted:focus-visible { outline: 1px solid var(--gold); outline-offset: 2px; }
  .charted.on { color: var(--gold); border-color: var(--gold-dim); }
  /* The chart sits in from the table's edges, which its first and last cells otherwise touch. */
  .orders tr.chartrow > td, :global(html[data-room~="lt1100"]) .orders tr.chartrow > td { padding: .6rem 1rem 1.1rem; background: var(--well); }
  .apart { display: inline-flex; margin-left: .55rem; padding-left: .55rem; border-left: 1px solid var(--rule); }
</style>
