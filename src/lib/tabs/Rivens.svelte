<script lang="ts">
  import { shownPage, whileShown } from "../pane.svelte";
  import { links, openUrl } from "../links.svelte";
  import { untrack } from "svelte";
  // Your rivens, read from the game: each stat as the game shows it, how good each roll is, and
  // what comparable rivens sell for. Below, a finder for rivens on warframe.market, and alerts for
  // the ones you want at your price.
  import type { Model } from "../core/model";
  import type { RivenWatch, Settings } from "../backend";
  import { marketUrl, marketWaitLeft } from "../backend";
  import { tradesFor, type RivenTrade } from "../core/rivens";
  import { attributeSlug, auctionItemFor, auctionOf, checkedWhen, curseWord, cycleCost, gradeAuction, kuvaSpent, lastCycle, parseRiven, priceCheck, rivenTables, rollChoice, cycleKey, searchFor, searchKey, statMarket, unpackListed, unpackPrices, weaponChoices, type MyAuction, type Riven, type RivenAuction, type RivenChange, type RollChoice } from "../core/rivens";
  import { mkt } from "../marketStore.svelte";
  import { rivens } from "../rivenStore.svelte";
  import { dealOf, estimateListed, estimateRiven, type Estimate } from "../core/rivenModel";
  import PageHead from "../ui/PageHead.svelte";
  import Stat from "../ui/Stat.svelte";
  import Art from "../ui/Art.svelte";
  import P from "../ui/P.svelte";
  import GameIcon from "../ui/GameIcon.svelte";
  import Chip from "../ui/Chip.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import Thumb from "../ui/Thumb.svelte";
  import ProgressButton from "../ui/ProgressButton.svelte";
  import UndoSlot from "../ui/UndoSlot.svelte";
  import { UndoSlots } from "../undo.svelte";
  import { Job, JobError } from "../job.svelte";
  import { matches, sortRows, type Column } from "../ui/table";
  import Browse from "../ui/Browse.svelte";
  import Named from "../ui/Named.svelte";
  import Showcase, { type Exhibit } from "../ui/Showcase.svelte";
  import { pickShowcase } from "../core/showcase";
  import { arrive, calm, confirm, flip, leave, reveal } from "../motion";
  import Kind from "../ui/Kind.svelte";
  import Segments from "../ui/Segments.svelte";

  // console: you play on a console or phone, where MyOrbiter can't read your rivens: the finder and
  // alerts only.
  let { model, settings = $bindable(), console = false }: { model: Model; settings: Settings; console?: boolean } = $props();

  const tables = $derived(rivenTables(model.catalogByUnique.values()));
  const mine = $derived((settings.game.rivens ?? []).map((r) => parseRiven(model, tables, r)).filter((r): r is Riven => !!r));
  const veiled = $derived([...model.inventoryByBase.entries()].filter(([u]) => /\/Randomized\/Raw/.test(u)).reduce((n, [, rows]) => n + rows.reduce((k, r) => k + r.quantity, 0), 0));
  // What the last cycle MyOrbiter saw did to each riven.
  // Rivens mid-cycle: the roll each has and the one on offer, and which to keep.
  const choices = $derived((settings.game.rivens ?? []).filter((raw) => raw.pending).map((raw) => ({ key: cycleKey(raw), c: rollChoice(model, tables, raw) })).filter((x): x is { key: string; c: RollChoice } => !!x.c));
  // What similar rivens are listed for, each roll, to settle a close call: per cycle, not per riven.
  let rollPrices = $state<Record<string, { current: number | null; next: number | null; any?: RivenAuction[] }>>({});
  $effect(() => {
    const m = meta;
    if (!m) return;
    for (const { key, c } of choices) {
      if (rollPrices[key]) continue;
      rollPrices[key] = { current: null, next: null };
      void (async () => {
        const price = async (r: Riven) => {
          const q = searchFor(m, r);
          if (!q.weapon) return null;
          return priceCheck(await rivens.search(q.weapon, q.positive.slice(0, 2), null).catch(() => [])).typical;
        };
        const qw = searchFor(m, c.current).weapon;
        // The weapon's cheapest listed, for the price model's estimate of each roll.
        const any = qw ? await rivens.search(qw, [], null).catch(() => undefined) : undefined;
        rollPrices[key] = { current: await price(c.current), next: await price(c.next), any };
      })();
    }
  });
  const cycles = $derived.by(whileShown("rivens", () => {
    const out: Record<string, RivenChange> = {};
    for (const raw of settings.game.rivens ?? []) {
      const c = lastCycle(model, tables, raw, settings.game.rivenHistory ?? {});
      if (c) out[raw.id] = c;
    }
    return out;
  }));
  let sort = $state({ key: "grade", desc: true });
  // Filters: the riven's kind (Rifle, Melee…), spliced ones only, and a weapon or name.
  let kind = $state("all");
  let splicedOnly = $state(false);
  let query = $state("");
  // Companions' weapons take the usual riven kinds (a sentinel's rifle takes a rifle riven): they're
  // a kind of their own here, and Rifle, Melee… are your own weapons'.
  const kindOf = (r: Riven) => (r.companion ? "companion" : r.kind);
  const kinds = $derived([...new Set(mine.filter((r) => !r.companion).map((r) => r.kind))].sort().map((k) => ({ k, n: mine.filter((r) => !r.companion && r.kind === k).length })));
  const companions = $derived(mine.filter((r) => r.companion).length);
  const splicedCount = $derived(mine.filter((r) => r.spliced).length);
  const best = $derived(mine.reduce<Riven | null>((b, r) => (r.quality != null && (b?.quality == null || r.quality > b.quality) ? r : b), null));
  // By weapon first, so rivens that tie on the chosen sort stay in weapon order.
  const shown = $derived(mine.filter((r) => (kind === "all" || (kind === "regular" ? !r.companion : kindOf(r) === kind)) && (!splicedOnly || r.spliced) && matches(query, r.weapon, r.name, ...r.stats.map((x) => x.label))).sort((a, b) => a.weapon.localeCompare(b.weapon)));
  const filtered = $derived(kind !== "all" || splicedOnly || !!query.trim());
  function clear() {
    kind = "all";
    splicedOnly = false;
    query = "";
  }
  // The same sorts as cards or as a table; ones not price checked yet go last either way.
  const columns: Column<Riven>[] = [
    { key: "weapon", label: "Weapon", value: (r) => `${r.weapon} ${r.name}`, cell: nameCell, defaultDesc: false, width: "20rem", title: "By weapon, A to Z" },
    { key: "grade", label: "Best rolls", value: (r) => r.grade, sortValue: (r) => r.quality, align: "center", cell: gradeCell, title: "The overall grade: how good the roll is within its range (S the top of it, B the middle, F the bottom)" },
    { key: "rank", label: "Rank", value: (r) => r.rank, align: "right", muted: true, minor: true, title: "Its rank, out of 8" },
    { key: "cycles", label: "Cycles", value: (r) => r.rerolls, align: "right", muted: true, minor: true, title: "How many times it's been cycled (0: unrolled)" },
    { key: "traded", label: "Trade value", value: (r) => tradeValue(r), align: "right", cell: tradedCell, title: "What rivens for the weapon (cycled or not, like yours) traded for in game last week: the ones worth selling, whatever their stats" },
    { key: "any", label: "Any price", value: (r) => anyPrice(r), align: "right", cell: anyCell, minor: true, title: "The cheapest riven listed for the weapon on warframe.market, whatever its stats. Not price checked yet: blank" },
    { key: "similar", label: "Similar price", value: (r) => similarPrice(r), align: "right", cell: similarCell, title: "What rivens with the same two best stats are mostly listed for. Not price checked yet: blank" },
    { key: "estimate", label: "Estimate", value: (r) => estimateOf(r), align: "right", cell: estimateCell, title: "MyOrbiter's estimate of what a riven like it is listed for, from all its stats. Not price checked yet: blank" },
  ];
  const sorted = $derived(sortRows(shown, columns, sort));

  $effect(() => {
    void rivens.loadMeta();
  });
  // The page stays open once opened: a list that failed to load is asked for again each minute.
  $effect(() => {
    if (!rivens.metaError) return;
    const t = setInterval(() => void rivens.loadMeta(), 60_000);
    return () => clearInterval(t);
  });
  // What rivens traded for in game last week, per weapon (DE's weekly figures).
  $effect(() => {
    void rivens.loadTrades(settings.market.platform);
  });
  const traded = (r: Riven) => (rivens.trades ? tradesFor(rivens.trades, r.kind, r.weapon, r.rerolls > 0) : null);
  const tradeValue = (r: Riven) => traded(r)?.same?.median ?? null;
  const fmtP = (v: number) => `${Math.round(v).toLocaleString("en")}p`;
  const tradeTitle = (r: Riven, t: RivenTrade) =>
    `Riven trades completed in game ${rivens.tradesWeek ?? "last week"} for ${t.weapon} rivens that were ${t.rerolled ? "cycled" : "unrolled (never cycled)"}: median ${t.median == null ? "?" : fmtP(t.median)}, average ${fmtP(t.avg)}, from ${fmtP(t.min)} to ${fmtP(t.max)} (Digital Extremes' weekly figures, 1p trades left out). They don't say which stats sold, so a great roll goes well over the median and a poor one under it.`;
  const meta = $derived(rivens.meta);

  // Price checks, per riven: rivens listed with its two best stats ("similar"), and any riven for
  // its weapon at all, whose cheapest is the floor anyone can buy one at. Both are asking prices:
  // warframe.market keeps no record of what rivens sold for.
  // A check kept from an earlier run shows until it's checked again: `saved` marks it, `at` is when
  // it was made. While a riven is checked again, or if that fails, what it had stays shown.
  let checks = $state<Record<string, { loading: boolean; error?: string; auctions?: RivenAuction[]; any?: RivenAuction[]; at?: number; saved?: boolean }>>({});
  // Turned away for going too fast: warframe.market asked to wait (until a time, market.rs).
  const SLOW = /slow down|asked us to wait/;
  // The price model's guess for each riven, once it's been price checked (the weapon's cheapest
  // 60 listed are one of the things it reads). See core/rivenModel.ts.
  $effect(() => {
    void rivens.loadModel();
  });
  const estimateFor = (r: Riven, any: RivenAuction[] | undefined) => estimateRiven(rivens.model, meta, rivens.trades, r, any);
  const estimates = $derived.by(whileShown("rivens", () => {
    const out: Record<string, Estimate> = {};
    for (const r of mine) {
      const e = estimateFor(r, checks[r.id]?.any);
      if (e) out[r.id] = e;
    }
    return out;
  }));
  const estimateOf = (r: Riven) => estimates[r.id]?.mid ?? null;
  const factorLabel = (r: Riven, f: Estimate["factors"][number]) => {
    const s = r.stats.find((x) => meta && attributeSlug(meta, x.tag) === f.slug);
    return `${f.positive ? "" : "−"}${s?.label ?? f.slug.replace(/_/g, " ")}`;
  };
  const fmtRatio = (x: number) => (x >= 0.95 ? `×${x.toFixed(x >= 10 ? 0 : 1)}` : `÷${(1 / x).toFixed(1 / x >= 10 ? 0 : 1)}`);
  /** The cheapest riven listed for its weapon, and what similar ones mostly ask, from its price check. */
  const anyPrice = (r: Riven) => (checks[r.id]?.any ? priceCheck(checks[r.id]!.any!).lowest : null);
  const similarPrice = (r: Riven) => (checks[r.id]?.auctions ? priceCheck(checks[r.id]!.auctions!).typical : null);
  const DAY = 86_400_000;
  /** When a queued riven search goes, as the clock shows it ("14:05:30"). */
  const waitTime = (at: number | null) => (at == null ? "" : new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  async function check(r: Riven, fresh = false) {
    if (!meta) return;
    const q = searchFor(meta, r);
    if (!q.weapon) {
      checks[r.id] = { loading: false, error: "warframe.market doesn't list rivens for this weapon" };
      return;
    }
    const before = checks[r.id];
    checks[r.id] = { ...before, loading: true, error: undefined };
    try {
      const positive = q.positive.slice(0, 2);
      const auctions = await rivens.search(q.weapon, positive, null, fresh ? 0 : undefined);
      // The weapon's own search is shared by every riven for it, and kept a while.
      const any = await rivens.search(q.weapon, [], null).catch(() => undefined);
      checks[r.id] = { loading: false, auctions, any: any ?? before?.any, at: Date.now() };
      rivens.remember(settings.market.platform, r.id, searchKey(q.weapon, positive), auctions, q.weapon, any);
    } catch (e) {
      checks[r.id] = { ...before, loading: false, error: String(e).replace(/^Error: /, "") };
    }
  }
  // Checks kept from the last run, for rivens that still have the roll they were checked with.
  // Kept ones over a day old are checked again by themselves once the page is open (one after
  // another, as Price check all does), and show until then.
  let restoredFor: string | null = null;
  $effect(() => {
    const m = meta;
    const list = mine;
    const platform = settings.market.platform;
    if (!m || restoredFor === platform) return;
    // Another platform's kept checks don't count here.
    if (restoredFor != null) untrack(() => { for (const [id, c] of Object.entries(checks)) if (c.saved) delete checks[id]; });
    restoredFor = platform;
    void rivens.loadSaved(platform).then((s) => {
      if (restoredFor !== platform) return;
      const stale: Riven[] = [];
      for (const r of list) {
        const q = searchFor(m, r);
        const k = q.weapon ? s.rivens[r.id] : undefined;
        if (!q.weapon || !k || k.key !== searchKey(q.weapon, q.positive.slice(0, 2)) || checks[r.id]) continue;
        const w = s.weapons[q.weapon];
        checks[r.id] = { loading: false, auctions: unpackPrices(k.prices), any: w ? unpackListed(w.listed) : undefined, at: k.at, saved: true };
        if (Date.now() - k.at >= DAY) stale.push(r);
      }
      // Only those: one never checked, or checked minutes ago, waits for you to ask.
      if (stale.length && !checkingAll) void checkAll(stale);
    });
  });
  const keptAt = $derived(Math.min(...sorted.map((r) => (checks[r.id]?.saved ? checks[r.id]!.at! : Infinity))));
  // Price check every riven, one after another (warframe.market is asked at its own pace), skipping
  // ones already checked. Stop halts after the one in progress. Ones that fail on the way (turned
  // away, timed out) are tried once more at the end, after a pause; what still fails is said.
  let checkingAll = $state<{ done: number; total: number; paused?: boolean; retry?: boolean } | null>(null);
  let checkedAll = $state<{ ok: number; failed: Riven[]; reason: string } | null>(null);
  let stopAll = $state(false);
  // The pause after warframe.market asks to wait: half a minute, or until the time it gave if
  // that's later (never sooner: market.rs wouldn't send it anyway). The button's fill drains over it.
  const PAUSE_MS = 30_000;
  let pauseMs = $state(PAUSE_MS);
  let pausedAt = $state<number | null>(null);
  let pauseNow = $state(0);
  const allJob = new Job();
  /** Price check all, pressed: the button fills as it goes and ends on how many were checked. */
  function checkAllPressed(only?: Riven[]) {
    void allJob.run(async () => {
      await checkAll(only);
      if (stopAll) return "Stopped";
      if (!checkedAll) return null;
      const n = checkedAll.failed.length;
      if (n) throw new JobError(`${n} failed`, `${checkedAll.ok} checked; ${n} couldn't be: ${checkedAll.reason}`);
      return `${checkedAll.ok} checked`;
    });
  }
  const allFill = $derived(
    !checkingAll ? null : checkingAll.paused && pausedAt != null ? Math.max(0, 1 - (pauseNow - pausedAt) / pauseMs) : checkingAll.total ? checkingAll.done / checkingAll.total : null,
  );
  const allWord = $derived(
    !checkingAll ? "" : stopAll ? "Stopping…" : checkingAll.paused ? `Waiting ${Math.max(0, Math.ceil((pauseMs - (pauseNow - (pausedAt ?? pauseNow))) / 1000))}s` : `${checkingAll.retry ? "Retrying" : "Checking"} ${checkingAll.done}/${checkingAll.total}`,
  );
  const failedCheck = (r: Riven) => !!checks[r.id]?.error;
  /** Not checked this run: never, or only kept from an earlier one. */
  const toCheck = (r: Riven) => !checks[r.id]?.auctions || !!checks[r.id]?.saved;
  /** Of the last run's failures, the ones still failing (one checked by hand since drops out). */
  const stillFailed = $derived(checkedAll?.failed.filter(failedCheck) ?? []);
  async function checkAll(only?: Riven[]) {
    const listed = meta ? (only ?? sorted).filter((r) => searchFor(meta, r).weapon) : [];
    // Everything checked already: check them all again (prices move).
    const fresh = listed.filter(toCheck);
    const again = !only && !fresh.length;
    const todo = again ? listed : fresh;
    checkedAll = null;
    stopAll = false;
    if (!meta || !todo.length) return;
    checkingAll = { done: 0, total: todo.length };
    const wait = async () => {
      checkingAll = { ...checkingAll!, paused: true };
      pausedAt = pauseNow = Date.now();
      pauseMs = Math.max(PAUSE_MS, marketWaitLeft() + 1_000);
      const t = setInterval(() => (pauseNow = Date.now()), 250);
      await new Promise((res) => setTimeout(res, pauseMs));
      clearInterval(t);
      pausedAt = null;
      checkingAll = { ...checkingAll!, paused: false };
    };
    for (const r of todo) {
      if (stopAll) break;
      await check(r, again);
      // Still turned away after MyOrbiter's own retries: a longer pause, then once more.
      if (SLOW.test(checks[r.id]?.error ?? "") && !stopAll) {
        await wait();
        if (!stopAll) await check(r, again);
      }
      checkingAll = { ...checkingAll, done: checkingAll.done + 1, total: todo.length };
    }
    // A second go at the ones that failed, after a pause.
    const failed = todo.filter(failedCheck);
    if (failed.length && !stopAll) {
      checkingAll = { done: 0, total: failed.length, retry: true };
      await wait();
      for (const r of failed) {
        if (stopAll) break;
        await check(r, true);
        checkingAll = { ...checkingAll, done: checkingAll.done + 1 };
      }
    }
    const still = todo.filter(failedCheck);
    checkedAll = { ok: todo.filter((r) => !checks[r.id]?.error && checks[r.id]?.auctions).length, failed: still, reason: still.length ? checks[still[0].id]!.error! : "" };
    checkingAll = null;
  }
  // Selling: your riven auctions on warframe.market, and the form to put one up.
  // Read while this page is on screen, and again with each read of your listings (every 30 s) at
  // most every 5 minutes (rivenStore, refreshMine).
  $effect(() => {
    void mkt.ordersAt;
    if (mkt.linked && meta && shownPage("rivens")) void rivens.refreshMine(`${mkt.me?.id ?? ""}|${mkt.platform}`);
  });
  let sell = $state<Record<string, { buyout: number | null; bids: boolean; starting: number | null; busy: boolean; error: string | null }>>({});
  function openSell(r: Riven, suggest: number | null) {
    sell[r.id] = { buyout: suggest, bids: false, starting: null, busy: false, error: null };
  }
  async function list(r: Riven) {
    const f = sell[r.id];
    if (!meta || !f || !f.buyout) return;
    const made = auctionItemFor(meta, r);
    if ("error" in made) {
      f.error = made.error;
      return;
    }
    const buyout = Math.round(f.buyout);
    const starting = f.bids && f.starting ? Math.min(Math.round(f.starting), buyout) : buyout;
    f.busy = true;
    f.error = null;
    try {
      await rivens.sell(made.item, buyout, starting);
      delete sell[r.id];
    } catch (e) {
      f.error = String(e).replace(/^Error:\s*/, "");
    } finally {
      if (sell[r.id]) sell[r.id].busy = false;
    }
  }
  let reprice = $state<Record<string, { buyout: number | null; busy: boolean; error: string | null }>>({});
  async function savePrice(a: MyAuction) {
    const f = reprice[a.id];
    if (!f?.buyout) return;
    f.busy = true;
    f.error = null;
    try {
      const buyout = Math.round(f.buyout);
      // A bid auction keeps its starting price unless the buyout goes under it (see Rivens.reprice).
      await rivens.reprice(a, buyout);
      delete reprice[a.id];
    } catch (e) {
      f.error = String(e).replace(/^Error:\s*/, "");
      f.busy = false;
    }
  }
  let closing = $state<string | null>(null);
  let closeError = $state<Record<string, string>>({});
  async function takeDown(a: MyAuction) {
    closing = a.id;
    try {
      await rivens.close(a);
    } catch (e) {
      closeError[a.id] = String(e).replace(/^Error:\s*/, "");
    } finally {
      closing = null;
    }
  }

  const tradedSum = $derived.by(() => {
    let total = 0;
    let n = 0;
    for (const r of mine) {
      const v = tradeValue(r);
      if (v != null) {
        total += v;
        n++;
      }
    }
    return { total, n };
  });
  // The showcase: your five best-graded rivens as their cards, with what each weapon's rivens go for
  // (last week's trades, else what similar ones are listed for, else MyOrbiter's estimate).
  let opened = $state<Riven | null>(null);
  const shelf = $derived(pickShowcase(mine, { spare: () => null, held: (r) => r.quality, name: (r) => `${r.weapon} ${r.name}`, key: (r) => r.id }));
  const goingRate = (r: Riven): { v: number | null; how: string } => {
    const t = tradeValue(r);
    if (t != null) return { v: t, how: "last week's in-game median for the weapon's rivens" };
    const sp = similarPrice(r);
    if (sp != null) return { v: sp, how: "what similar ones are listed for (asking)" };
    const e = estimateOf(r);
    return e != null ? { v: e, how: "MyOrbiter's estimate" } : { v: null, how: "not priced yet: press Check prices" };
  };
  const exhibits = $derived(
    shelf.items.map(({ row: r }): Exhibit => {
      const g = goingRate(r);
      return {
        key: r.id,
        name: r.weapon,
        sub: r.name,
        value: g.v == null ? null : Math.round(g.v),
        grade: r.grade,
        title: `${r.weapon} ${r.name} (${r.rerolls ? `${r.rerolls} cycle${r.rerolls === 1 ? "" : "s"}` : "unrolled"}): grade ${r.grade}, its stats rolled ${r.quality == null ? "?" : Math.round(r.quality * 100)}% of the way up their ranges on average. ${g.v == null ? "No price yet" : `About ${Math.round(g.v).toLocaleString("en")}p`}: ${g.how}. Click for its card`,
        open: () => (opened = r),
        image: r.image,
        look: "riven",
        card: { rank: r.rank, maxRank: 8, label: `${r.kind} riven`, polarity: r.polarity ?? null },
      };
    }),
  );
  const priced = $derived(mine.map((r) => checks[r.id]?.auctions).filter((a): a is RivenAuction[] => !!a).map((a) => priceCheck(a)));
  const worth = $derived(priced.reduce((n, p) => n + (p.typical ?? 0), 0));
  const estimated = $derived(Object.values(estimates));
  const estimatedSum = $derived(estimated.reduce((n, e) => n + e.mid, 0));
  // Rivens for weapons warframe.market doesn't list can't be checked: they don't count as left to do.
  // Price check all goes through the rivens the filters show.
  const unchecked = $derived(meta ? shown.filter((r) => toCheck(r) && searchFor(meta, r).weapon).length : shown.length);
  const keptCount = $derived(shown.filter((r) => checks[r.id]?.saved).length);

  const searchUrl = (r: Riven) => {
    const q = meta ? searchFor(meta, r) : null;
    return q?.weapon ? `https://warframe.market/auctions/search?type=riven&weapon_url_name=${q.weapon}&positive_stats=${q.positive.slice(0, 2).join(",")}&polarity=any&sort_by=price_asc` : marketUrl(r.weapon);
  };

  // ---------------------------------------------------------------- finder and alerts
  let weaponName = $state("");
  /** The weapon field's suggestions, drawn the first time it's focused rather than with the page. */
  let weaponsWanted = $state(false);
  let pos = $state<string[]>(["", "", ""]);
  let neg = $state("");
  let maxPrice = $state<number | null>(null);
  const weapon = $derived(meta?.weapons.find((w) => w.name.toLowerCase() === weaponName.trim().toLowerCase()) ?? null);
  const attrsFor = $derived(
    meta && weapon
      ? meta.attributes.filter((a) => !a.exclusiveTo?.length || a.exclusiveTo.includes(weapon.group === "archgun" ? "archgun" : weapon.group === "kitgun" ? "kitgun" : weapon.group === "zaw" ? "zaw" : weapon.rivenType))
      : (meta?.attributes ?? []),
  );
  const attrName = (slug: string) => meta?.attributes.find((a) => a.slug === slug)?.name ?? slug;
  /** A stat picked in another box (wanted or curse) isn't offered again: a riven can't roll it twice. */
  const takenBut = (keep: string) => new Set([...pos, neg].filter((s) => s && s !== keep));
  // The results keep the weapon they were searched for, whatever the box says now.
  let found = $state<{ key: string; weapon: { slug: string; name: string }; auctions?: RivenAuction[]; any?: RivenAuction[]; error?: string; loading: boolean } | null>(null);
  /** Results by price as listed, or the best deal against the estimate first. */
  let foundSort = $state<"price" | "deal">("price");
  // Search: working while it reads, then how many it found (at your price, when you set one).
  const findJob = new Job();
  function search() {
    void findJob.run(async () => {
      await find();
      if (found?.error) throw new JobError("Failed", found.error);
      const n = (found?.auctions ?? []).filter((a) => !maxPrice || (a.price ?? Infinity) <= maxPrice).length;
      return `${n} found`;
    });
  }
  async function find() {
    if (!weapon) return;
    const positive = pos.filter(Boolean);
    const key = `${weapon.slug}|${positive.join(",")}|${neg}`;
    const w = { slug: weapon.slug, name: weapon.name };
    found = { key, weapon: w, loading: true };
    try {
      const auctions = await rivens.search(w.slug, positive, neg || null, 60_000);
      if (found?.key !== key) return;
      // Results first; then the weapon's cheapest listed, for each result's estimate (shared with price checks).
      found = { key, weapon: w, loading: false, auctions };
      const any = await rivens.search(w.slug, [], null).catch(() => undefined);
      if (found?.key === key && any) found = { ...found, any };
    } catch (e) {
      if (found?.key === key) found = { key, weapon: w, loading: false, error: String(e).replace(/^Error: /, "") };
    }
  }
  let watchNote = $state<string | null>(null);
  // A changed form is a new alert: the note was about the last one.
  $effect(() => {
    void [weaponName, neg, maxPrice, ...pos];
    watchNote = null;
  });
  const sameStats = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const sameWatch = (x: RivenWatch, w: Pick<RivenWatch, "weapon" | "positive" | "negative" | "maxPrice">) => x.weapon === w.weapon && sameStats(x.positive, w.positive) && x.negative === w.negative && x.maxPrice === w.maxPrice;
  /** The form describes an alert you have: Alert me reads Watching ✓ until the form changes. */
  const watching = $derived.by(() => {
    if (!weapon || !maxPrice) return false;
    const w = { weapon: weapon.slug, positive: pos.filter(Boolean), negative: neg || null, maxPrice: Math.round(maxPrice) };
    return settings.rivenWatch.some((x) => !undo.has(x.id) && sameWatch(x, w));
  });
  /** Each press of Alert me that set (or found) an alert: the button's gold ring. */
  let watchedAt = $state(0);
  /** The alert just set: its chip arrives, scrolled into view if it's off screen. */
  let justWatched = $state<string | null>(null);
  function watch() {
    if (!weapon || !maxPrice) return;
    const w: RivenWatch = { id: `${Date.now()}`, weapon: weapon.slug, weaponName: weapon.name, positive: pos.filter(Boolean), negative: neg || null, maxPrice: Math.round(maxPrice) };
    watchedAt = Date.now();
    if (settings.rivenWatch.some((x) => !undo.has(x.id) && sameWatch(x, w))) {
      watchNote = "You're already watching for that.";
      return;
    }
    watchNote = null;
    justWatched = w.id;
    settings.rivenWatch = [...settings.rivenWatch, w];
  }
  /** Brings a chip that just arrived into view, unless it's on screen already. */
  function inView(node: HTMLElement, on: boolean) {
    if (!on) return;
    requestAnimationFrame(() => {
      const r = node.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) node.scrollIntoView({ block: "nearest", behavior: calm.current ? "auto" : "smooth" });
    });
  }
  // Stop watching waits a few seconds, with Undo, before the alert is gone.
  const undo = new UndoSlots();
  $effect(() => () => undo.flush());
  const unwatch = (id: string) => undo.hold(id, () => (settings.rivenWatch = settings.rivenWatch.filter((w) => w.id !== id)));
  /** Each result's estimate, and its price against it. */
  const foundEst = $derived.by(() => {
    const out = new Map<string, { e: Estimate; deal: ReturnType<typeof dealOf> }>();
    const f = found;
    if (!f?.auctions || !f.any) return out;
    for (const a of f.auctions) {
      const e = estimateListed(rivens.model, meta, rivens.trades, { weapon: f.weapon.slug, attributes: a.attributes, rerolls: a.rerolls, mr: a.mr, rank: a.rank, polarity: a.polarity }, f.any);
      if (e) out.set(a.id, { e, deal: dealOf(a.price, e) });
    }
    return out;
  });
  const shownAuctions = $derived.by(() => {
    const list = (found?.auctions ?? []).filter((a) => !maxPrice || (a.price ?? Infinity) <= maxPrice);
    if (foundSort !== "deal") return list;
    const r = (a: RivenAuction) => foundEst.get(a.id)?.deal?.ratio ?? Infinity;
    return [...list].sort((a, b) => r(a) - r(b));
  });
  const statusLabel: Record<string, string> = { ingame: "In game", online: "Online", offline: "Offline" };
</script>

{#snippet grade(g: string, big = false)}<span class="grade g-{g.replace('+', 'p').replace('−', 'm')}" class:big title="Grade {g}: how good the roll is within its range (S the top of it, B the middle, F the bottom)">{g}</span>{/snippet}
<!-- A curse gets a word, not a letter: whether it costs anything (a red C− on a harmless Ammo Maximum curse misleads). -->
{#snippet curse(s: { tag: string; label: string; quality: number | null })}{@const w = curseWord(s.tag)}<span class="cw cw-{w}" title={w === "hurts" ? `A curse on ${s.label}, which players want on a riven: it costs you something. Rolled ${s.quality == null ? "?" : Math.round(s.quality * 100)}% of the way to the mildest curse` : `A curse on ${s.label}, which hardly matters on most builds: it costs next to nothing`}>{w}</span>{/snippet}

{#snippet nameCell(r: Riven)}<Named file={r.image} name="{r.weapon} {r.name}" hover={false} kind="{r.kind} riven" />{/snippet}
{#snippet gradeCell(r: Riven)}{#if r.grade}{@render grade(r.grade)}{/if}{/snippet}
{#snippet tradedCell(r: Riven)}<P v={tradeValue(r)} />{/snippet}
{#snippet anyCell(r: Riven)}<P v={anyPrice(r)} dim />{/snippet}
{#snippet similarCell(r: Riven)}<P v={similarPrice(r)} />{/snippet}
{#snippet estimateCell(r: Riven)}<P v={estimateOf(r)} />{/snippet}
{#snippet card(r: Riven)}{@render rivenCard(r)}{/snippet}
<!-- In the table, a row opens to the whole card. -->
{#snippet rivenDetail(r: Riven)}<div class="indetail">{@render rivenCard(r)}</div>{/snippet}
{#snippet rivenCard(r: Riven)}
  {@const c = checks[r.id]}
  {@const pc = c?.auctions ? priceCheck(c.auctions) : null}
  <article class="riven">
    <header>
      <Art file={r.image} size={74} fallback="riven" />
      <div class="t">
        <span class="register"><Kind kind={r.kind} label="{r.kind} riven · {r.weapon}{r.companion ? ' · companion' : ''}" size={12} /></span>
        <h3 class="mark" title="{r.weapon} {r.name}">{r.weapon} {r.name}</h3>
        <span class="meta dim small">
          {#if r.polarity}<img src="/game/pol/{r.polarity}.png" alt={r.polarity} title={r.polarity} class="pol" />{/if}
          Rank {r.rank}/8 · MR {r.mastery} · {r.rerolls ? `${r.rerolls} cycle${r.rerolls === 1 ? "" : "s"}` : "unrolled"}
        </span>
        {#if r.rerolls}<span class="meta dim small" title="Kuva its cycles have cost (counting any before it was yours), and what the next cycle costs"><GameIcon name="kuva" size={13} />{kuvaSpent(r.rerolls).toLocaleString("en")} Kuva spent · next roll {cycleCost(r.rerolls).toLocaleString("en")}</span>{/if}
      </div>
      <span class="gcol">
        {@render grade(r.grade, true)}
        <!-- The grade measures how high each stat rolled; this says how many of its stats buyers pay more for. -->
        {#if meta && c?.any}{@const sm = statMarket(meta, r, c.any)}{#if sm?.some((x) => x.sought)}{@const n = sm.filter((x) => x.sought).length}<span class="demand" title="{n} of its stats are ones buyers pay clearly more for on this weapon (★ under Its stats on the market): the grade only says how high each one rolled">★ {n} in demand</span>{/if}{/if}
      </span>
    </header>
    <ul class="stats">
      {#each r.stats as s, i (i)}
        <li class:curse={!s.buff}>
          <b class="val">{s.display}</b><span class="lbl">{s.label}{#if s.spliced}<span class="tag ok" title="From Riven Splicing: it stays locked through cycles">spliced</span>{/if}</span>
          <span class="rbar" title="Roll {s.quality == null ? '?' : Math.round(s.quality * 100)}% of its range"><Segments key="riven:{r.id}:{i}" value={s.quality ?? 0} max={1} cells={10} fill tone="var(--platinum-dim)" label="Roll {s.quality == null ? 'unknown' : `${Math.round(s.quality * 100)}%`} of its range" /></span>
          {#if s.buff}{@render grade(s.grade)}{:else}{@render curse(s)}{/if}
        </li>
      {/each}
    </ul>
    {#if meta && c?.any}
      {@const sm = statMarket(meta, r, c.any)}
      {#if sm?.length}
        <div class="sm" title="From the cheapest {r.weapon} rivens listed on warframe.market right now (up to 60, asking prices): how many carry each of this riven's stats, and the middle price of those with it against those without. A hint, not a valuation">
          <span class="register">Its stats on the market</span>
          <ul>
            {#each sm as x (x.slug)}
              {@const s = r.stats.find((y) => y.tag === x.tag)}
              <li class:sought={x.sought}><span class="nm">{x.sought ? "★ " : ""}{s?.label ?? x.slug}</span><span class="dim small">on {Math.round(x.share * 100)}% of listings</span><span class="small">{x.withIt != null ? `~${x.withIt.toLocaleString("en")}p` : "–"} <span class="dim">vs {x.without != null ? `${x.without.toLocaleString("en")}p` : "–"} without</span></span></li>
            {/each}
          </ul>
          {#if sm.some((x) => x.sought)}<span class="dim small">★ among the cheapest listed, those with it ask clearly more (half again, and 20p or more).</span>{/if}
        </div>
      {/if}
    {/if}
    {#if cycles[r.id]}
      {@const ch = cycles[r.id]}
      {#if ch.kept}
        <p class="cycle dim small">You cycled it and kept this roll.</p>
      {:else}
        <div class="cycle">
          <span class="register">Your previous roll</span>
          <span class="was"><span class="dim">{ch.prev.name}</span>{@render grade(ch.prev.grade)}<span class="arrow" class:up={(r.quality ?? 0) > (ch.prev.quality ?? 0)} class:down={(r.quality ?? 0) < (ch.prev.quality ?? 0)}>{(r.quality ?? 0) > (ch.prev.quality ?? 0) ? "▲ better roll" : (r.quality ?? 0) < (ch.prev.quality ?? 0) ? "▼ worse roll" : "same quality"}</span></span>
          <ul class="prev">{#each ch.prev.stats as s, i (i)}<li class:curse={!s.buff}><b>{s.display}</b> {s.label}</li>{/each}</ul>
        </div>
      {/if}
    {/if}
    {#if meta}
      {@const listed = auctionOf(meta, r, rivens.mine)}
      {@const f = sell[r.id]}
      {#if listed}
        {@const rp = reprice[listed.id]}
        <div class="selling on">
          <span class="register">On warframe.market</span>
          {#if rp}
            <span class="plat"><input type="number" min="1" bind:value={rp.buyout} aria-label="New buyout price" /><GameIcon name="platinum" size={14} /></span>
            <IconButton icon="check" tone="gold" label={rp.busy ? "Saving…" : "Save the new price"} disabled={rp.busy || !rp.buyout} onclick={() => savePrice(listed)} />
            <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => delete reprice[listed.id]} />
            {#if rp.error}<span class="err small">{rp.error}</span>{/if}
          {:else}
            <span>{#if listed.buyout != null}buyout <P v={listed.buyout} />{/if}{#if listed.starting < (listed.buyout ?? Infinity)}<span class="dim small">{" · "}bids from {listed.starting}p</span>{/if}{#if listed.topBid != null}<span class="small">{" · "}top bid <b>{listed.topBid}p</b></span>{/if}</span>
            <span class="grow"></span>
            <IconButton icon="pencil" tone="quiet" label="Change price" onclick={() => (reprice[listed.id] = { buyout: listed.buyout, busy: false, error: null })} />
            <IconButton icon="stop" tone="danger quiet" label={closing === listed.id ? "Taking down…" : "Take down"} title="Take down: close the auction (it stays in your profile's closed auctions)" disabled={closing === listed.id} onclick={() => takeDown(listed)} />
            {#if closeError[listed.id]}<span class="err small">{closeError[listed.id]}</span>{/if}
          {/if}
        </div>
      {:else if f}
        <div class="reveal" transition:reveal><div>
        <form class="selling" onsubmit={(e) => { e.preventDefault(); void list(r); }}>
          <label><span class="register">Buyout</span><span class="plat"><input type="number" min="1" bind:value={f.buyout} aria-label="Buyout price" /><GameIcon name="platinum" size={14} /></span></label>
          <Chip bind:on={f.bids} label="Take bids from" title="Let buyers bid below the buyout, from a starting price" />
          {#if f.bids}<span class="plat"><input type="number" min="1" bind:value={f.starting} aria-label="Starting bid" /><GameIcon name="platinum" size={14} /></span>{/if}
          <button class="stamp" title="Put it up as an auction on warframe.market at this buyout" disabled={f.busy || !f.buyout}>{f.busy ? "Listing…" : "Sell it"}</button>
          <IconButton icon="close" tone="quiet" label="Cancel" onclick={() => delete sell[r.id]} />
          {#if estimates[r.id] || pc?.lowest != null}<span class="dim small hint">{#if estimates[r.id]}Estimate {estimates[r.id].mid}p (the middle half of listings like it ask {estimates[r.id].lo}–{estimates[r.id].hi}p){pc?.lowest != null ? "; " : ""}{/if}{#if pc?.lowest != null}cheapest similar {pc.lowest}p{pc.typical != null ? `, most around ${pc.typical}p` : ""}{/if}. To sell sooner, ask toward the lower end.</span>{/if}
          {#if f.error}<span class="err small">{f.error}</span>{/if}
        </form>
        </div></div>
      {/if}
    {/if}
    {#if rivens.trades}
      {@const tr = traded(r)}
      <p class="traded small">
        {#if tr?.same}<span title={tradeTitle(r, tr.same)}><span class="dim">Traded in game {rivens.tradesWeek ?? "last week"}</span> <b>~{tr.same.median == null ? "?" : fmtP(tr.same.median)}</b> <span class="dim">· {fmtP(tr.same.min)}–{fmtP(tr.same.max)}</span></span>{#if tr.other?.median != null}<span class="dim" title={tradeTitle(r, tr.other)}>{" · "}{tr.other.rerolled ? "cycled" : "unrolled"} ones ~{fmtP(tr.other.median)}</span>{/if}
        {:else if tr?.other}<span class="dim" title={tradeTitle(r, tr.other)}>No {r.rerolls ? "cycled" : "unrolled"} {r.weapon} rivens traded in game last week; {tr.other.rerolled ? "cycled" : "unrolled"} ones went for ~{tr.other.median == null ? "?" : fmtP(tr.other.median)}</span>
        {:else}<span class="dim" title="Digital Extremes' weekly figures list no in-game trade of a riven for this weapon last week: little demand">No {r.weapon} rivens traded in game last week</span>{/if}
      </p>
    {/if}
    {#if estimates[r.id]}
      {@const e = estimates[r.id]}
      <div class="est" title="MyOrbiter's estimate of what a riven like this one is listed for on warframe.market (asking prices: what rivens sell for isn't published), from all its stats and how good each roll is, its cycles, mastery and rank, what its weapon's rivens traded for in game last week and what the cheapest listed for it ask now. Trained on {rivens.model?.listings.toLocaleString('en')} listings for {rivens.model?.weapons} weapons ({rivens.model?.trained}){rivens.model?.accuracy ? `; on listings from sellers it hadn't learned from, half its guesses were within ×${rivens.model.accuracy.typical.toFixed(1)} and ${Math.round(rivens.model.accuracy.within2 * 100)}% within ×2 (listings at both ends of the price range)` : ""}. A guide, not a promise">
        <span class="register">Estimate</span>
        <span class="v"><P v={e.mid} /> <span class="dim small">the middle half of listings like it ask {e.lo.toLocaleString("en")}–{e.hi.toLocaleString("en")}p</span></span>
        {#if e.factors.length}<span class="small fx"><span class="dim">What moves it:</span>{" "}{#each [...e.factors].sort((x, y) => Math.abs(Math.log(y.ratio)) - Math.abs(Math.log(x.ratio))) as f, i (f.slug)}{i ? " · " : ""}<span class:up={f.ratio >= 1.15} class:down={f.ratio <= 1 / 1.15} title={f.positive ? `The estimate with this stat as rolled, against the same riven without it` : `The estimate with this curse, against the same riven without it`}>{factorLabel(r, f)} {fmtRatio(f.ratio)}</span>{/each}</span>{/if}
      </div>
    {/if}
    <footer>
      {#if pc}
        {@const fl = c?.any ? priceCheck(c.any) : null}
        <span class="pcs">
          {#if fl}<span class="pc" title={fl.count ? `The cheapest ${r.weapon} riven listed right now, whatever its stats: what anyone can buy one for` : undefined}>{#if fl.count}<span class="dim small">Any {r.weapon} riven from</span><P v={fl.lowest} />{:else}<span class="dim small">No {r.weapon} rivens listed</span>{/if}</span>{/if}
          <span class="pc" title={pc.count ? `${pc.count} rivens with the same two best stats listed${c?.saved ? ` when MyOrbiter last checked (${checkedWhen(c.at!, Date.now())})` : ""}: the cheapest at ${pc.lowest}p, most around ${pc.typical}p. Asking prices: what they sell for isn't published` : undefined}>{#if pc.count}<span class="dim small">{pc.count} similar listed from</span><P v={pc.lowest} /><span class="dim small">· most around</span><P v={pc.typical} />{:else}<span class="dim small">None like it listed {c?.saved ? "then" : "right now"}</span>{/if}</span>
          {#if c?.saved && (c.loading || Date.now() - c.at! >= DAY)}<span class="dim small when" title={c.loading ? "Checking it again now" : c.error ? `Kept from MyOrbiter's last check; checking again failed: ${c.error}` : "Kept from MyOrbiter's last check; checked again when you update prices"}>{c.loading ? "updating…" : `checked ${checkedWhen(c.at!, Date.now())}`}</span>{/if}
        </span>
      {:else if c?.error}<span class="dim small">{c.error}</span>
      {:else if c?.loading && rivens.searchWait}<span class="dim small" role="status" title="warframe.market takes 10 riven searches a minute: this one goes at {waitTime(rivens.searchWait)}">Waiting for warframe.market's search limit…</span>
      {:else if c?.loading}<span class="dim small">Checking prices…</span>
      {:else}<span class="dim small">Not checked yet</span>{/if}
      <span class="grow"></span>
      <!-- The same three places on every card: check prices, sell, open on warframe.market. -->
      <ProgressButton variant="icon" icon={pc || c?.error || c?.loading ? "refresh" : "search"} spin tone="quiet" state={c?.loading ? "working" : "idle"} label={pc ? "Check again" : c?.error ? "Try again" : "Check prices"} working="Checking…" title={pc ? "Check again: find similar rivens for sale now" : "Check prices: find similar rivens for sale"} disabled={!meta} onclick={() => check(r)} />
      {#if meta && auctionOf(meta, r, rivens.mine)}<span class="slot"></span>
      {:else}<button type="button" class="ib rsell" class:on={!!sell[r.id]} aria-label="Sell: {r.weapon} {r.name}" title={!mkt.linked ? "Sign in to warframe.market on Orders first" : "Sell: put it up as an auction on warframe.market"} disabled={!meta || !mkt.linked || !!sell[r.id]} onclick={() => openSell(r, estimates[r.id]?.mid ?? pc?.typical ?? pc?.lowest ?? null)}><Icon name="list" /><span>Sell</span></button>{/if}
      <ProgressButton variant="icon" icon="external" tone="quiet" label="Similar rivens on warframe.market" working="Opening…" busy={links.isOpening(searchUrl(r))} onclick={() => openUrl(searchUrl(r))} />
    </footer>
  </article>
{/snippet}

{#snippet showcase()}
  <Showcase items={exhibits} caption="Your best-graded rivens" note="By grade, with what the weapon's rivens go for · click one for its card" />
{/snippet}

<div class="page"><div class="page-inner">
  <PageHead hero={!console && mine.length ? showcase : undefined} title="Rivens" brief={console ? "Rivens for sale, graded, and alerts." : "Your rivens graded, and what they sell for."} blurb={console ? "Find rivens for sale, each roll graded, what each weapon's rivens traded for last week, and alerts when one you want is listed at your price." : "Your rivens graded stat by stat, and what each weapon's rivens sold for last week."}>
    {#snippet band()}
      {#if !console}
      <Stat label="Unveiled" note="Read from your inventory">{mine.length}</Stat>
      <Stat label="Veiled" tone="dim" note="Challenges still to do">{veiled}</Stat>
      <Stat keep label="Best roll" note={best ? `${best.weapon} ${best.name}` : "–"}>{#if best?.grade}<span class="g-{best.grade.replace('+', 'p').replace('−', 'm')}">{best.grade}</span>{:else}–{/if}</Stat>
      {#if tradedSum.n}<Stat label="Your rivens' going rate" tone="gold" note={`Last week's in-game median for each weapon, ${tradedSum.n} of ${mine.length} rivens`}><P v={Math.round(tradedSum.total)} big /></Stat>{:else if priced.length}<Stat label="Listed around" tone="gold" note={`What similar ones are listed for (asking, not sold), ${priced.length} of ${mine.length} checked`}><P v={worth} big /></Stat>{/if}
      {#if estimated.length}<Stat label="Estimated" note={`MyOrbiter's estimate of what each would be listed for, ${estimated.length} of ${mine.length} price checked`}><P v={estimatedSum} big /></Stat>{/if}
      {/if}
      <Stat extra label="Alerts" note="Rivens you're watching for">{settings.rivenWatch.length}</Stat>
    {/snippet}
  </PageHead>

  {#if choices.length}
    <section class="cycling" aria-label="Cycling now">
      {#each choices as { key, c } (key)}
        {@const pc = rollPrices[key]}
        <article class="choice">
          <header><Thumb file={c.current.image} name={c.current.weapon} size={30} /><b class="mark">Cycling {c.current.weapon}</b><span class="verdict v-{c.verdict}">{c.verdict === "take" ? "Take the new roll" : c.verdict === "keep" ? "Keep the one it has" : "Too close to call"}</span></header>
          <p class="small">{c.why}{#if pc?.current != null && pc?.next != null}{" "}Similar rivens are listed around <b>{pc.current}p</b> for the one it has and <b>{pc.next}p</b> for the new roll.{/if}</p>
          <div class="rolls">
            {#each [{ r: c.current, label: "It has", win: c.verdict === "keep" }, { r: c.next, label: "New roll", win: c.verdict === "take" }] as x (x.label)}
              <div class="roll" class:win={x.win}>
                <span class="register">{x.label}</span>
                <span class="rn"><b>{x.r.name}</b>{@render grade(x.r.grade)}</span>
                <ul>{#each x.r.stats as s, i (i)}<li class:curse={!s.buff}><b>{s.display}</b> {s.label} {#if s.buff}{@render grade(s.grade)}{:else}{@render curse(s)}{/if}</li>{/each}</ul>
                {#if estimateFor(x.r, pc?.any)}{@const e = estimateFor(x.r, pc?.any)!}<span class="small" title="MyOrbiter's estimate of what a riven like this roll is listed for (see Estimate on the cards below)"><span class="dim">Estimate</span> <b>{e.mid.toLocaleString("en")}p</b> <span class="dim">({e.lo.toLocaleString("en")}–{e.hi.toLocaleString("en")}p)</span></span>{/if}
              </div>
            {/each}
          </div>
        </article>
      {/each}
      <p class="dim small">Read while you're choosing in game (press Sync at the cycle screen if it doesn't show). The stats are weighed by what players look for on a riven: crit, multishot, damage and elements first; a curse on zoom or recoil costs nothing.</p>
    </section>
  {/if}

  {#if console}
    <!-- No rivens of your own to show on a console: straight to the finder. -->
  {:else if settings.game.rivens == null}
    <section class="panel note">
      <h2 class="mark">Your rivens show up after TennoScope's next read</h2>
      <p class="prose">MyOrbiter gets your rivens' stats through TennoScope, which needs three things:</p>
      <ol class="prose steps">
        <li>TennoScope rebuilt from MyOrbiter's current <code>tennoscope/</code> folder (<code>tennoscope/ORBITER.md</code> has the commands).</li>
        <li>Full mode on (Settings → TennoScope → <i>Read my inventory</i>).</li>
        <li>A read of your inventory: press <b>Sync</b> while Warframe is running.</li>
      </ol>
      <p class="prose dim">Find a riven and alerts, below, work without any of this.</p>
    </section>
  {:else if !mine.length}
    <p class="dim">No unveiled rivens in your inventory.</p>
  {:else}
    <div class="bar">
      <input type="search" placeholder="Filter rivens…" bind:value={query} aria-label="Filter rivens by weapon, name or stat" title="A weapon, a riven's name or a stat" />
      <select bind:value={kind} aria-label="Riven kind" title="Only rivens for one kind of weapon: your own weapons by type, or your companions' (a sentinel's or MOA's gun, a hound's claws)">
        <option value="all">All kinds ({mine.length})</option>
        {#if companions}<option value="regular">Your weapons ({mine.length - companions})</option>{/if}
        {#each kinds as x (x.k)}<option value={x.k}>{x.k} ({x.n})</option>{/each}
        {#if companions}<option value="companion">Companion weapons ({companions})</option>{/if}
      </select>
      {#if splicedCount}<Chip bind:on={splicedOnly} label="Spliced ({splicedCount})" title="Only rivens with a stat from Riven Splicing (Gas, Corrosive, Weak Point Damage…), which can't roll by cycling" />{/if}
      <span class="dim small explain">Grades compare each roll with its range: S is the top of it, B the middle, F the bottom. A curse says whether it hurts (on a stat players want) or is harmless (ammo, zoom, recoil and the like). Dispositions are 1.2 for every weapon since the 22 October 2026 hotfix.</span>
    </div>
    <Browse id="rivens" bind:opened rows={shown} {columns} key={(r) => r.id} bind:sort {card} detail={rivenDetail} title={(r) => `${r.weapon} ${r.name}`} min="23rem" cardLimit={36} clear={filtered ? clear : null} empty="No unveiled rivens in your inventory.">
      {#snippet tools()}
        {#if checkingAll?.paused}
          <span class="dim small">{checkingAll.retry ? "Some checks failed" : "warframe.market asked us to wait"}: waiting {pauseMs > PAUSE_MS ? `until ${new Date(pausedAt! + pauseMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "half a minute"}, then {checkingAll.retry ? "trying those again" : `${checkingAll.done + 1} of ${checkingAll.total}`}</span>
        {:else if !checkingAll}
          {#if stillFailed.length}
            <span class="checking"><span class="dim small" title={checkedAll!.reason}>Checked {checkedAll!.ok}; {stillFailed.length} couldn't be ({checkedAll!.reason.replace(/(; |\. ).*$/, "")})</span><button class="link" title="Check the ones that failed again" onclick={() => checkAllPressed(stillFailed)}>Try those again</button></span>
          {/if}
          {#if keptCount && Date.now() - keptAt >= DAY}<span class="dim small kept" title="Some prices shown are from MyOrbiter's last check, a day or more ago: riven prices move little from one day to the next. They're checked again by themselves while this page is open">Some prices from {checkedWhen(keptAt, Date.now())}</span>{/if}
        {/if}
        {#if checkingAll && rivens.searchWait}<span class="dim small" role="status" title="warframe.market takes 10 riven searches a minute: this one goes at {waitTime(rivens.searchWait)}">Waiting for warframe.market's search limit…</span>{/if}
        <ProgressButton job={allJob} busy={!!checkingAll} progress={checkingAll ? allFill : undefined} working={allWord} onstop={() => (stopAll = true)} sizer={["Checking 000/000", "Stopping…", "000 checked"]}
          label={!unchecked ? "Check prices again" : keptCount === unchecked ? "Update prices" : unchecked === shown.length ? (shown.length === mine.length ? "Check prices" : `Check these ${unchecked}`) : `Check the other ${unchecked}`}
          title={!meta ? "Waiting for warframe.market's riven list" : !unchecked ? "Check every riven's price again" : keptCount === unchecked ? "Check again the prices kept from earlier, one after another" : "Find similar rivens for sale for each of yours, one after another. Click again while it runs to stop"} disabled={!meta} onclick={() => checkAllPressed()} />
      {/snippet}
    </Browse>
  {/if}

  <section class="finder">
    <h2 class="register lead">Find a riven</h2>
    {#if !meta}
      <p class="dim small">{#if rivens.metaError}Couldn't load warframe.market's riven list ({rivens.metaError}); MyOrbiter tries again each minute. <button class="link" onclick={() => void rivens.loadMeta()}>Try now</button>{:else}Loading warframe.market's riven list…{/if}</p>
    {:else}
      <div class="form">
        <input list="riven-weapons" placeholder="Weapon" bind:value={weaponName} onfocus={() => (weaponsWanted = true)} aria-label="Weapon" />
        {#if weaponsWanted}<datalist id="riven-weapons">{#each weaponChoices(meta) as w (w.slug)}<option value={w.name}></option>{/each}</datalist>{/if}
        {#each [0, 1, 2] as i (i)}
          {@const taken = takenBut(pos[i])}
          <select bind:value={pos[i]} aria-label="Wanted stat {i + 1}"><option value="">{i === 0 ? "Stat you want" : i === 1 ? "2nd stat (any)" : "3rd stat (any)"}</option>{#each attrsFor.filter((a) => !a.negativeOnly && !taken.has(a.slug)) as a (a.slug)}<option value={a.slug}>{a.name}</option>{/each}</select>
        {/each}
        <select bind:value={neg} aria-label="Curse"><option value="">Any curse or none</option>{#each attrsFor.filter((a) => !a.positiveOnly && !takenBut(neg).has(a.slug)) as a (a.slug)}<option value={a.slug}>−{a.name}</option>{/each}</select>
        <span class="plat"><input type="number" min="1" placeholder="Max price" bind:value={maxPrice} aria-label="Most you'd pay" /><GameIcon name="platinum" size={14} /></span>
        <span class="go">
          <ProgressButton icon="search" job={findJob} label="Search" working="Searching…" sizer={["000 found"]} title={weapon ? "Find rivens for sale with these stats" : "Pick a weapon first"} disabled={!weapon} onclick={search} />
          <button class="stamp" disabled={!weapon || !maxPrice} title={!weapon || !maxPrice ? "Pick a weapon and the most you'd pay first" : watching ? "You're watching for this one: a notification comes when one is listed at or under your price (checked every 5 minutes)" : "Get a notification when one is listed at or under your price (checked every 5 minutes)"} onclick={watch} use:confirm={watchedAt}><Icon name="bell" /><span class="swap"><span class:off={watching}>Alert me</span><span class:off={!watching} aria-hidden={!watching}>Watching ✓</span></span></button>
        </span>
      </div>
      {#if weaponName && !weapon}<p class="dim small">Pick a weapon from the list.</p>{/if}
      {#if weapon && rivens.trades}
        {@const k = weapon.group === "archgun" ? "Archgun" : weapon.group === "kitgun" ? "Kitgun" : weapon.group === "zaw" ? "Zaw" : weapon.rivenType.charAt(0).toUpperCase() + weapon.rivenType.slice(1)}
        {@const t = tradesFor(rivens.trades, k, weapon.name, false)}
        <p class="small traded">
          {#if t.same || t.other}<span class="dim">{weapon.name} rivens traded in game last week:</span>
            {#each [t.same, t.other].filter((x): x is RivenTrade => !!x) as x, i (i)}{i ? " · " : " "}<span title="Digital Extremes' weekly figures for trades completed in game (1p trades left out); they don't say which stats sold"><span class="dim">{x.rerolled ? "cycled" : "unrolled"}</span> <b>~{x.median == null ? "?" : fmtP(x.median)}</b> <span class="dim">({fmtP(x.min)}–{fmtP(x.max)})</span></span>{/each}
          {:else}<span class="dim">No {weapon.name} rivens traded in game last week.</span>{/if}
        </p>
      {/if}
      {#if watchNote}<p class="dim small">{watchNote}</p>{/if}

      {#if settings.rivenWatch.length}
        <div class="watching">
          <span class="register">Watching</span>
          {#each settings.rivenWatch as w (w.id)}
            <span class="w" in:arrive out:leave animate:flip use:inView={w.id === justWatched}>
              {#if undo.has(w.id)}<UndoSlot label="Stopped watching" what={w.weaponName} onundo={() => undo.undo(w.id)} />
              {:else}<span class="rule">{w.weaponName}{w.positive.length ? ` · ${w.positive.map(attrName).join(", ")}` : ""}{w.negative ? ` · −${attrName(w.negative)}` : ""} · ≤ {w.maxPrice}p<IconButton icon="close" tone="quiet" size={12} label="Stop watching" title="Stop watching for this riven (you get a few seconds to undo)" onclick={() => unwatch(w.id)} /></span>{/if}
            </span>
          {/each}
        </div>
      {/if}

      {#if found}
        {#if found.loading && rivens.searchWait}<p class="dim small" role="status" title="warframe.market takes 10 riven searches a minute: this one goes at {waitTime(rivens.searchWait)}">Waiting for warframe.market's search limit…</p>
        {:else if found.loading}<p class="dim small">Searching…</p>
        {:else if found.error}<p class="dim small">{found.error}</p>
        {:else if !shownAuctions.length}<p class="dim small">Nothing listed{maxPrice ? ` at ${maxPrice}p or less` : ""} right now.</p>
        {:else}
          <div class="rsort">
            <span class="dim small">{shownAuctions.length > 30 ? `The first 30 of ${shownAuctions.length}` : `${shownAuctions.length} listed`}</span>
            <label class="sortsel" title="By price as listed, or the best deal against the estimate first"><span class="register">Sort</span><select bind:value={foundSort} aria-label="Sort results"><option value="price">Price</option><option value="deal">Best deal</option></select></label>
          </div>
          <table class="results">
            <thead><tr><th>Riven</th><th>Stats</th><th class="right">Roll</th><th class="right">Rank · rerolls</th><th>Seller</th><th class="right" title="MyOrbiter's estimate of what a riven like this one is listed for (see Estimate on your rivens' cards)">Estimate</th><th class="right">Price</th></tr></thead>
            <tbody>
              {#each shownAuctions.slice(0, 30) as a (a.id)}
                {@const g = gradeAuction(meta, tables, found.weapon.slug, a)}
                {@const fe = foundEst.get(a.id)}
                <tr>
                  <td class="nowrap"><b class="name-mark">{found.weapon.name} {a.name}</b></td>
                  <td>{#each a.attributes as x, i (i)}<span class="att" class:curse={!x.positive}>{x.value > 0 && x.positive ? "+" : ""}{x.value}{meta.attributes.find((m) => m.slug === x.url_name)?.unit === "percent" ? "%" : ""} {attrName(x.url_name)}{#if g}<em>{g.grades[i]}</em>{/if}</span>{/each}</td>
                  <td class="right">{#if g}{@render grade(g.grade)}{/if}</td>
                  <td class="right dim small nowrap">R{a.rank} · {a.rerolls}</td>
                  <td class="nowrap"><span class="st st-{a.status}">{statusLabel[a.status] ?? a.status}</span> {a.seller}</td>
                  <td class="right dim small nowrap" title={fe ? `The middle half of listings like it ask ${fe.e.lo}–${fe.e.hi}p` : "No estimate: the weapon's listings or last week's trades aren't read yet"}>{fe ? `~${fe.e.mid.toLocaleString("en")}p` : "–"}</td>
                  <td class="right nowrap"><P v={a.price} />{#if fe?.deal?.under}<span class="tag ok deal" title="Listed under the lower end of the estimate's range ({fe.e.lo}p): cheap for a riven like it, unless something about it the stats don't show (a seller who won't answer, a typo)">{Math.round((1 - fe.deal.ratio) * 100)}% under</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="dim small">Rolls are worked out from the numbers sellers typed in; "?" means a number the riven couldn't have rolled (often a listing from before the disposition change). Estimates come from the same numbers, so a typo moves them too.</p>
        {/if}
      {/if}
    {/if}
  </section>
</div></div>

<style>
  .gcol { display: grid; justify-items: end; gap: .2rem; align-self: start; }
  .demand { font-size: .7rem; color: var(--gold); white-space: nowrap; }
  .sortsel { display: inline-flex; align-items: center; gap: .55rem; }
  .rsort { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: .4rem 0; }
  .deal { margin-left: .4rem; }
  .est { display: grid; gap: .2rem; padding: .55rem .7rem; border: 1px solid var(--rule); background: rgb(214 174 74 / 4%); }
  .est .register { font-size: 11px; }
  .est .v { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .5rem; }
  .est .fx .up { color: var(--jade, #7fc79a); }
  .est .fx .down { color: #e07a6a; }
  .sortsel .register { font-size: 11px; }
  .selling { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .8rem; padding: .6rem .7rem; margin-top: .6rem; border: 1px solid var(--rule-bright); background: var(--well); }
  .selling.on { border-color: color-mix(in srgb, var(--verdigris) 45%, transparent); box-shadow: inset 2px 0 0 var(--verdigris); }
  .selling label { display: inline-flex; align-items: center; gap: .45rem; }
  .selling input[type="number"] { width: 6.5rem; }
  /* One height for the form's fields and buttons. */
  .selling input, .selling :global(button:not(.link)) { height: 34px; }
  .selling .stamp { padding-top: 0; padding-bottom: 0; }
  .selling :global(.ib) { --ib: 34px; }
  .selling .plat { display: inline-flex; align-items: center; gap: .3rem; }
  .selling .hint { flex-basis: 100%; }
  .err { color: var(--oxblood); flex-basis: 100%; }
  .note { margin: var(--step) 0; padding: 1.2rem 1.4rem; border: 1px solid var(--rule); background: var(--plate); clip-path: var(--cut); }
  .riven { display: flex; flex-direction: column; border: 1px solid var(--rule); background: linear-gradient(180deg, color-mix(in srgb, var(--rarity-riven) 6%, var(--plate)), var(--plate) 45%); clip-path: var(--cut); padding: .8rem .9rem .6rem; gap: .6rem; }
  .explain { max-width: 75ch; }
  .indetail { max-width: 36rem; padding: .4rem 0; }
  /* The grading key is for Details; the grades themselves carry it in their tooltips. */
  :global(html:not([data-details])) .explain { display: none; }
  .riven header { display: grid; grid-template-columns: auto 1fr auto; gap: .7rem; align-items: start; }
  .t { display: grid; gap: .25rem; min-width: 0; }
  .t .register { font-size: 11px; color: var(--rarity-riven); }
  .t h3 { font-size: 1.15rem; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { display: inline-flex; align-items: center; gap: .35rem; }
  .pol { width: 14px; height: 14px; opacity: .85; }
  .stats { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
  .stats li { display: grid; grid-template-columns: 4.6rem 1fr 4rem 3.4rem; gap: .5rem; align-items: center; font-size: .84rem; }
  .val { font-family: var(--face-mark); font-size: 1rem; color: var(--verdigris); font-variant-numeric: tabular-nums; }
  .curse .val { color: var(--oxblood); }
  .lbl { color: var(--platinum-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rbar { display: flex; min-width: 0; }
  .cycle { margin: 0; padding: .5rem .6rem; border: 1px dashed var(--rule-bright); display: grid; gap: .3rem; }
  .cycle .register { font-size: 11px; }
  .was { display: flex; align-items: center; gap: .45rem; font-size: .84rem; }
  .arrow { margin-left: auto; font-family: var(--face-register); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .arrow.up { color: var(--verdigris); }
  .arrow.down { color: var(--oxblood); }
  .prev { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .15rem .8rem; font-size: .76rem; color: var(--platinum-dim); }
  .prev b { color: var(--platinum); font-weight: 600; }
  .prev .curse b { color: var(--oxblood); }
  /* Cards in a row share a height; the footer sits at the bottom of each. */
  .riven footer { margin-top: auto; display: flex; align-items: center; gap: .35rem; padding-top: .5rem; border-top: 1px solid var(--rule); min-height: 1.6rem; }
  .riven footer .slot { width: 30px; }
  /* Sell with its word, as on every other card (ListButton's look). */
  .rsell { width: auto; display: inline-flex; gap: .35rem; padding: 0 .55rem 0 .45rem; font-size: 11px; color: var(--platinum-dim); border-color: var(--rule-bright); background: transparent; }
  .riven:hover .rsell:not(:disabled) { color: var(--gold); border-color: var(--gold-dim); }
  .rsell:hover:not(:disabled), .rsell.on { background: var(--gold); border-color: var(--gold); color: var(--slab); }
  .rsell:disabled { color: var(--platinum-deep); border-color: var(--rule); opacity: .6; }
  .traded { margin: 0; line-height: 1.4; }
  .traded b { color: var(--platinum); font-family: var(--face-mark); font-size: .95rem; }
  .pcs { display: grid; gap: .15rem; min-width: 0; }
  .pc { display: inline-flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
  .grow { flex: 1; }
  .grade { font-family: var(--face-mark); font-weight: 700; font-size: .9rem; text-align: center; min-width: 1.8rem; color: var(--platinum-dim); }
  .grade.big { font-size: 1.9rem; min-width: 2.6rem; }
  .cw { font-family: var(--face-register); font-size: .82rem; text-align: center; min-width: 1.8rem; }
  .stats li > .grade, .stats li > .cw { justify-self: end; }
  .cw-hurts { color: var(--oxblood); }
  .cw-harmless { color: var(--platinum-deep); }
  .g-S { color: var(--gold); }
  .g-Ap, .g-A, .g-Am { color: var(--verdigris); }
  .g-Cp, .g-C, .g-Cm, .g-F { color: var(--oxblood); }
  .finder { margin-top: var(--course); }
  .finder h2 { margin: 0 0 .8rem; }
  /* Four even columns, so the second row lines up under the first. */
  .form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; align-items: center; }
  .form > input, .form > select { width: 100%; min-height: 36px; }
  /* The platinum mark sits inside the field, so this column is as wide as the one above it. */
  .form .plat { position: relative; }
  .form .plat input { flex: 1; min-width: 0; width: auto; min-height: 36px; padding-right: 2rem; }
  .form .plat > :global(:last-child) { position: absolute; right: .7rem; pointer-events: none; }
  .form .go { grid-column: span 2; display: flex; gap: .5rem; justify-content: flex-end; }
  .form .go :global(.stamp) { display: inline-flex; align-items: center; gap: .5rem; height: 36px; }
  /* Page area under 760 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt760"]) .form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .plat { display: inline-flex; align-items: center; gap: .35rem; }
  .watching { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; margin-top: .9rem; }
  .w { display: inline-flex; min-width: 0; max-width: 100%; }
  /* Alert me and Watching ✓ share one place (the wider sets the width), crossfading over QUICK. */
  .swap { display: inline-grid; }
  .swap > span { grid-area: 1 / 1; transition: opacity var(--quick) var(--out); }
  .swap > .off { opacity: 0; }
  .rule { display: inline-flex; align-items: center; gap: .3rem; padding: .1rem .1rem .1rem .55rem; border: 1px solid var(--gold-dim); font-size: .8rem; }
  .rule :global(.ib) { --ib: 22px; }
  .results { width: 100%; border-collapse: collapse; margin-top: 1rem; font-variant-numeric: tabular-nums; }
  .results th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .72rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .45rem .5rem; border-bottom: 1px solid var(--rule); }
  .results td { padding: var(--row-pad) .5rem; border-bottom: 1px solid var(--rule); vertical-align: middle; }
  .right { text-align: right; }
  .nowrap { white-space: nowrap; }
  .att { display: inline-flex; gap: .25rem; align-items: baseline; margin-right: .7rem; font-size: .8rem; color: var(--verdigris); white-space: nowrap; }
  .att.curse { color: var(--oxblood); }
  .att em { font-style: normal; font-family: var(--face-register); font-size: .72rem; color: var(--platinum-deep); }
  .st { font-family: var(--face-register); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .st-ingame { color: var(--verdigris); }
  .st-online { color: var(--gold); }
  .checking { display: inline-flex; align-items: center; gap: .6rem; }
  .steps { margin: .2rem 0 .6rem; padding-left: 1.2rem; display: grid; gap: .2rem; }
  /* A riven mid-cycle: the two rolls side by side, the one to keep lit. */
  .cycling { display: grid; gap: .8rem; margin-bottom: var(--step); }
  .choice { border: 1px solid var(--gold-dim); background: var(--plate); padding: .9rem 1rem; display: grid; gap: .6rem; }
  .choice header { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .choice header b { font-size: 1.1rem; }
  .choice p { margin: 0; color: var(--platinum-dim); }
  .verdict { margin-left: auto; padding: .2rem .55rem; font-family: var(--face-register); font-size: .74rem; letter-spacing: .12em; text-transform: uppercase; border: 1px solid var(--rule-bright); }
  .verdict.v-take { color: var(--slab); background: var(--gold); border-color: var(--gold); }
  .verdict.v-keep { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 55%, transparent); }
  .rolls { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .8rem; }
  .roll { display: grid; gap: .35rem; padding: .6rem .7rem; border: 1px solid var(--rule); background: var(--well); }
  .roll.win { border-color: var(--gold); box-shadow: inset 3px 0 0 var(--gold); }
  .roll .rn { display: flex; align-items: center; gap: .5rem; }
  .roll ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; font-size: .84rem; color: var(--platinum-dim); }
  .roll li b { color: var(--platinum); font-weight: 600; }
  .roll li.curse b { color: var(--oxblood); }
  /* A riven's stats against what's listed for its weapon. */
  .sm { display: grid; gap: .3rem; padding: .5rem .6rem; border: 1px solid var(--rule); background: var(--well); }
  .sm ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; }
  .sm li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: .7rem; align-items: baseline; font-size: .84rem; }
  .sm .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--platinum-dim); }
  .sm li.sought .nm { color: var(--gold); }
</style>
