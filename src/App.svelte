<script lang="ts">
  import PageHead from "./lib/ui/PageHead.svelte";
  import { discordSent } from "./lib/discordStatus.svelte";
  import { onMount, untrack } from "svelte";
  import { invasionNeeds, invasionRares } from "./lib/core/invasions";
  import { foldSetSales, repCandidates, salesFromTrade, tradeKey } from "./lib/core/trades";
  import { foundryBuilds } from "./lib/core/foundry";
  import { matchedFissures, pricesBehind } from "./lib/core/timers";
  import { watchlist } from "./lib/core/deals";
  import { inventoryRows, masteryRows, relicRows, saveForSets, type SetSave } from "./lib/core/views";
  import { allSetRows, allSetSaves, inventoryValue, spareRows } from "./lib/core/spares";
  import { baroRate, baroStock, until, varziaNeeds } from "./lib/core/traders";
  import { buildModel, ERAS, type Model } from "./lib/core/model";
  import { mergeRelics, type RelicData } from "./lib/core/relicData";
  import { BUILD } from "./lib/build";
  import type { RecipeData } from "./lib/core/buildPlan";
  import { today } from "./lib/core/today";
  import { bestCard, resolveName, scoreCards, vaultWord } from "./lib/core/pick";
  import { DEFAULT_HIDE_MINUTES, dueToShow, hideNow, lastCopies } from "./lib/core/lastCopy";
  import { mergeLogged, recordScreen, resolvePicks } from "./lib/core/relicRuns";
  import { dropBuilding, dropCounts, laterClaims, recentDrops, recordRead } from "./lib/core/drops";
  import { drops } from "./lib/drops.svelte";
  import { heldFor } from "./lib/core/market";
  import type { Bundle, Live, MissionState } from "./lib/core/types";
  import {
    dataStamp,
    defaultDataDir,
    defaultSettings,
    loadBundle,
    loadLive,
    loadSettings,
    tennoscopeOpaqueOverlay,
    warframeWindowMode,
    missionState,
    rewardCards,
    rewardScreens,
    writeRewardPick,
    writeOverlayPrefs,
    writeRivenCycle,
    setRivenKey,
    market,
    onMarketOrder,
    onNoticeOpen,
    relicData,
    recipeData,
    mergeLive,
    pruneLive,
    restoreLive,
    saved,
    discordPost,
    notify,
    openUrl,
    quit,
    quitOnWindowClose,
    type ScreenCards,
    type Settings,
    emptyBundle,
    nothingYet,
    PLATFORM_LABEL,
    type Platform,
    NO_INVENTORY_YET,
    tennoscope,
    onSaveTrouble,
    logLine,
  } from "./lib/backend";
  import { persistSettings } from "./lib/persist.svelte";
  import { backoff, handLoggedSale, keepSeen, thinHistory } from "./lib/core/upkeep";
  import Parts from "./lib/tabs/Parts.svelte";
  // Pages opened now and then load when first opened, so the app starts on less: Home, Orders,
  // Current fissure and the collection pages people live on stay in the first bundle.
  // One import per page, kept; one that failed is tried again (Retry below, `lazyTry`).
  const once = <T,>(f: () => Promise<T>) => {
    let p: Promise<T> | null = null;
    return (_try = 0) => (p ??= f().catch((e) => {
      p = null;
      throw e;
    }));
  };
  let lazyTry = $state(0);
  const loadSets = once(() => import("./lib/tabs/Sets.svelte"));
  const loadMastery = once(() => import("./lib/tabs/Mastery.svelte"));
  const loadArcanes = once(() => import("./lib/tabs/Arcanes.svelte"));
  const loadMods = once(() => import("./lib/tabs/Mods.svelte"));
  const loadPlanner = once(() => import("./lib/tabs/Planner.svelte"));
  const loadSales = once(() => import("./lib/tabs/Sales.svelte"));
  const loadGuide = once(() => import("./lib/tabs/Guide.svelte"));
  const loadMarket = once(() => import("./lib/tabs/Market.svelte"));
  const loadStats = once(() => import("./lib/tabs/Stats.svelte"));
  const loadRivens = once(() => import("./lib/tabs/Rivens.svelte"));
  const loadWishlist = once(() => import("./lib/tabs/Wishlist.svelte"));
  import Relics from "./lib/tabs/Relics.svelte";
  import InMission from "./lib/tabs/InMission.svelte";
  import Orders from "./lib/tabs/Orders.svelte";
  import Home from "./lib/tabs/Home.svelte";
  import Inventory from "./lib/tabs/Inventory.svelte";
  import WhatsNew from "./lib/WhatsNew.svelte";
  import TourBar from "./lib/ui/TourBar.svelte";
  import { tourGate, tourStop } from "./lib/tour.svelte";
  import { NEWEST, newsSince } from "./lib/whatsNew";
  import Foundry from "./lib/tabs/Foundry.svelte";
  import { openEras, wishlistEras } from "./lib/core/wishlist";
  import { rivens } from "./lib/rivenStore.svelte";
  import { cycleKey, cycleOverlay, recordRivens, rivenTables, rollChoice, searchFor } from "./lib/core/rivens";
  import { estimateRiven } from "./lib/core/rivenModel";
  import ItemDetails from "./lib/ItemDetails.svelte";
  import HoverCard from "./lib/HoverCard.svelte";
  import ListDialog from "./lib/ui/ListDialog.svelte";
  import SettingsSheet from "./lib/SettingsSheet.svelte";
  import TennoscopeSheet from "./lib/TennoscopeSheet.svelte";
  import Icon from "./lib/ui/Icon.svelte";
  import IconButton from "./lib/ui/IconButton.svelte";
  import ProgressButton from "./lib/ui/ProgressButton.svelte";
  import { Job, JobError } from "./lib/job.svelte";
  import { SYNC_LIMIT_MS, syncFill, waitForNewRead } from "./lib/core/syncWait";
  import RepButton from "./lib/ui/RepButton.svelte";
  import GameIcon from "./lib/ui/GameIcon.svelte";
  import { drawnOrder, orderPages, pageById, pagesFor, migrateTab, sectionsOf, type Page, type PageId } from "./lib/pages";
  import { growNotice, logNotice, noticeKind, splitTarget, type NoticeKind } from "./lib/notices";
  import { toasts } from "./lib/toasts.svelte";
  import { alertNeeds, describeHelp } from "./lib/core/worldNeeds";
  import NoticesSheet from "./lib/NoticesSheet.svelte";
  import Toasts from "./lib/ui/Toasts.svelte";
  import BuyDialog from "./lib/ui/BuyDialog.svelte";
  import SideWatch from "./lib/ui/SideWatch.svelte";
  import { mkt } from "./lib/marketStore.svelte";
  import { inFissure } from "./lib/core/mission";
  import Lookup from "./lib/ui/Lookup.svelte";
  import { view } from "./lib/view.svelte";
  import { parseTarget, setIntent } from "./lib/intent.svelte";
  import { ts } from "./lib/tennoscopeStore.svelte";

  /** Your choice from the fold button (kept in settings); until you make one, it folds by itself in a narrow window. */
  let width = $state(typeof window === "undefined" ? 1600 : window.innerWidth);
  /**
   * How much room the pages have, as flags on <html> that page styles key off: "lt900" while the
   * page area is under 900 px wide, and so on. The page area, not the window: with the sidebar
   * open a 1280 px window leaves less room than a 960 px one with it folded. (Not CSS container
   * queries: they'd trap the item sheets, which open from inside a page, in the page area.)
   */
  const ROOM_BELOW = [1100, 950, 930, 900, 760, 640];
  const ROOM_ABOVE = [1850];
  function room(node: HTMLElement) {
    const set = (w: number) => {
      const flags = [...ROOM_BELOW.filter((b) => w < b).map((b) => `lt${b}`), ...ROOM_ABOVE.filter((b) => w >= b).map((b) => `ge${b}`)].join(" ");
      if (document.documentElement.dataset.room !== flags) document.documentElement.dataset.room = flags;
    };
    const ro = new ResizeObserver((e) => set(e[0].contentRect.width));
    ro.observe(node);
    set(node.getBoundingClientRect().width);
    return { destroy: () => ro.disconnect() };
  }
  const compact = $derived.by(() => settings.folded ?? width < 1180);
  /** Room for the Watching column on the right (SideWatch) without squeezing the page. */
  const wideEnough = $derived(width >= 1640);
  // Not beside Home: Home already shows the alerts, fissures, clocks and the rest it would repeat.
  const sideShown = $derived.by(() => wideEnough && settings.side.on && settings.tab !== "home");

  // Show details (Settings, and the switch by each page's title): marks <html> for the shared
  // components' styles, and lets PageHead's switch change the setting.
  view.set = (on: boolean) => (settings.details = on);
  $effect(() => {
    view.details = settings.details;
    document.documentElement.toggleAttribute("data-details", settings.details);
  });

  // Pages stay mounted once opened, so filters, sorting and scroll survive switching tabs.
  let visited = $state<Record<string, boolean>>({});
  $effect(() => {
    if (!visited[settings.tab]) visited[settings.tab] = true;
  });
  // Once the app is idle after starting, open the other pages in the background one at a time, so
  // the first visit to each is as quick as switching back to it. Rivens waits for a visit: opening
  // it asks warframe.market for its riven list.
  let warmed = false;
  $effect(() => {
    if (!model || warmed) return;
    warmed = true;
    const queue = available.map((p) => p.id).filter((id) => id !== "rivens");
    const idle = (f: () => void) =>
      "requestIdleCallback" in window ? window.requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 250);
    const next = () => {
      const id = queue.shift();
      if (!id) return;
      if (!visited[id]) visited[id] = true;
      idle(next);
    };
    setTimeout(() => idle(next), 1500);
  });

  let settings = $state<Settings>(defaultSettings());
  let settingsReady = false;
  /** Now, to the half minute: clocks, "synced 3 min ago", pauses running out. */
  let tick = $state(Date.now());
  let bundle = $state.raw<Bundle | null>(null);
  let live = $state.raw<Live>({ fissures: null, resurgence: null, resurgenceExpiry: null });
  /**
   * The worldstate's state, for Home. `liveAt`: when the worldstate shown was read (null: none read
   * yet). `liveError`: the last read failed (null while a read is on its way, or after one worked).
   * Both null: still loading.
   */
  let liveAt = $state<number | null>(null);
  let liveError = $state<string | null>(null);
  /** A worldstate read worked since start (until then, what's shown may be the one kept from last time). */
  let liveRead = $state(false);
  /** The last read of TennoScope's data failed: with nothing loaded yet, a notice instead of the pages; else a note above them. */
  let error = $state<string | null>(null);
  /**
   * Running without an inventory: TennoScope hasn't read one yet and you chose to carry on, or
   * this is a Mac, where TennoScope doesn't run. The pages work from an empty collection, and the
   * real one replaces it as soon as TennoScope writes it.
   */
  let noInventory = $state(false);
  /** TennoScope doesn't run on this system (macOS). */
  const tsUnsupported = $derived(ts.status?.supported === false);
  /** You play on a console or phone (Settings → Platform): TennoScope only reads Warframe on a PC. */
  const onConsole = $derived(settings.market.platform !== "pc");
  /** No TennoScope here: a Mac, or a console player. orbiter works without an inventory. */
  const noTennoScope = $derived(tsUnsupported || onConsole);
  /**
   * The sidebar's pages. On a console only what works without reading the game: Home, Orders,
   * Sales, the riven finder and the Guide. Less any you hid in Settings → Pages (Home and the
   * Guide always stay). A page that isn't there opens Home instead.
   */
  const available = $derived(pagesFor(onConsole));
  const pages = $derived(orderPages(available, settings.pageOrder).filter((p) => p.id === "home" || p.id === "guide" || !settings.pagesHidden.includes(p.id)));
  const sections = $derived(sectionsOf(pages));
  // A hidden page still opens from a link on another page; one this platform doesn't have doesn't.
  $effect(() => {
    if (!available.some((p) => p.id === settings.tab)) settings.tab = "home";
  });
  // The market follows your platform; a new one means new order books and prices.
  $effect(() => {
    void mkt.usePlatform(settings.market.platform).catch(() => {});
  });
  // Switching to or from a console changes what an empty TennoScope folder means.
  let wasConsole: boolean | null = null;
  $effect(() => {
    const c = onConsole;
    if (wasConsole != null && wasConsole !== c) void reload();
    wasConsole = c;
  });
  /** Linux's limit on reading another program's memory, when it stops TennoScope reading the game. */
  let ptraceScope = $state<number | null>(null);
  $effect(() => {
    if (!model && error && nothingYet(error) && ptraceScope == null) tennoscope.ptraceScope().then((v) => (ptraceScope = v && v > 0 ? v : 0)).catch(() => {});
  });
  /** Where a first start stands: 1 TennoScope isn't running, 2 it hasn't been told what it may read, 3 waiting for the game. */
  const setupStep = $derived(!ts.running || ts.unpatched ? 1 : !ts.report?.setup.setup_complete || !ts.report.setup.access_mode ? 2 : 3);
  /** When the data on screen was read. */
  let loadedAt = $state<number | null>(null);
  let loading = $state(true);
  let showSettings = $state(false);
  let showTennoscope = $state(false);
  // What's new: once after an update, when there's something you haven't seen.
  let showNews = $state(false);
  /** Ctrl+K: find anything by name (ui/Lookup.svelte). */
  let showLookup = $state(false);
  let newsChecked = false;
  $effect(() => {
    // Read first: settingsReady isn't reactive, the loaded settings are.
    const seen = settings.newsSeen;
    if (!settingsReady || newsChecked) return;
    newsChecked = true;
    if (newsSince(seen).length) showNews = true;
  });
  let defaultDir = $state("");
  let stamp = 0;
  let mission = $state.raw<MissionState | null>(null);
  let missionError = $state<string | null>(null);

  let missionPolling = false;
  let missionText = "";
  /** TennoScope says the game isn't running: the game log and the reward screen are read less often. */
  const gameIdle = () => ts.report?.game_running === false;
  let lastMissionPoll = 0;
  async function pollMission() {
    // A console player's game isn't on this computer: no log to follow.
    if (onConsole) {
      mission = null;
      missionError = null;
      return;
    }
    if (missionPolling || (gameIdle() && Date.now() - lastMissionPoll < 10_000)) return;
    lastMissionPoll = Date.now();
    missionPolling = true;
    try {
      const next = await missionState(settings.eeLog);
      // Read every 2 s, and the same most of the time: only a change goes on (the trade, whisper
      // and screen effects below would otherwise all run again on every read).
      const text = JSON.stringify(next);
      if (text !== missionText) {
        missionText = text;
        mission = next;
      }
      missionError = null;
    } catch (e) {
      missionError = String(e);
    } finally {
      missionPolling = false;
    }
  }

  // What's in the foundry, from TennoScope's reports: kept as one object until it changes, so the
  // model isn't rebuilt on every report.
  let foundry = $state.raw<Record<string, number> | null>(null);
  $effect(() => {
    const next = ts.report?.foundry ?? null;
    if (next && JSON.stringify(next) !== JSON.stringify(foundry)) foundry = next;
  });
  /** The official drop tables' relics, over TennoScope's (see relicData.ts): current relics and vaulting. */
  let relicTables = $state.raw<RelicData | null>(null);
  const withTables = $derived(bundle && relicTables ? { ...bundle, relics: mergeRelics(bundle.relics, relicTables) } : bundle);
  /** Every Foundry recipe, parts' own included: what building something still takes. */
  let recipes = $state.raw<RecipeData | null>(null);
  // A read the model can't be built from says so (with Try again) rather than leaving the app on
  // "Reading your collection…" for good.
  const built = $derived.by((): { model: Model | null; error: string | null } => {
    if (!withTables) return { model: null, error: null };
    try {
      return { model: buildModel(withTables, live, foundry, settings.market.relicPrices, settings.game.imprints, recipes), error: null };
    } catch (e) {
      console.error("Building the collection failed:", e);
      return { model: null, error: `Building your collection failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
  const model = $derived(built.model);
  /** A page that threw (its boundary shows "This page hit an error"): what went wrong goes to the log. */
  const pageError = (id: string, e: unknown) => console.error(`The ${id} page hit an error:`, e);
  /** TennoScope's item prices: days out of date, when a day or more (see pricesBehind). */
  const pricesOld = $derived(onConsole ? null : pricesBehind(model?.priceDate, tick));
  let pricesOldDismissed = $state<string | null>(null);

  // The reward screen: the cards a patched TennoScope read off it, scored here, and the pick
  // written back for TennoScope's overlay to show over the game.
  let screenCards = $state.raw<ScreenCards | null>(null);
  const CARDS_FRESH_MS = 120_000;
  let clock = $state(Date.now());
  const freshCards = $derived(screenCards && screenCards.cards.length && clock - screenCards.at < CARDS_FRESH_MS ? screenCards : null);
  let cardsPolling = false;
  let lastCardsPoll = 0;
  async function pollCards() {
    clock = Date.now();
    if (cardsPolling || (gameIdle() && clock - lastCardsPoll < 5_000)) return;
    lastCardsPoll = clock;
    cardsPolling = true;
    try {
      const next = await rewardCards();
      // The same screen comes again once its live prices are in: that's a change too.
      if (next?.at !== screenCards?.at || next?.cards.join("|") !== screenCards?.cards.join("|") || JSON.stringify(next?.prices ?? {}) !== JSON.stringify(screenCards?.prices ?? {})) screenCards = next;
    } catch {
      // No file, or TennoScope isn't patched: the pool ranking still works.
    } finally {
      cardsPolling = false;
    }
  }
  let lastWritten = "";
  // A failed write of the pick or the overlay settings (a file briefly locked, say by an antivirus
  // scan) is tried again a few times, a little later each time: nothing else would trigger it.
  let pickRetry = $state(0);
  let overlayRetry = $state(0);
  const retryLater = (n: number, again: () => void) => {
    if (n < 5) setTimeout(again, 1000 * 2 ** n);
  };
  // Saving settings failed (a full disk, a locked file): said above the page until it works again.
  let saveError = $state<string | null>(null);
  onSaveTrouble((e) => (saveError = e));
  $effect(() => {
    void pickRetry;
    if (!model || !freshCards) return;
    const cards = scoreCards(model, freshCards.cards, settings.pick, freshCards.prices);
    const file = { at: freshCards.at, cards: freshCards.cards, scores: cards.map((c) => c.score), best: bestCard(cards), reasons: cards.map((c) => c.reasons), vault: cards.map((c) => vaultWord(model!, c.name)) };
    const key = JSON.stringify(file);
    if (key === lastWritten) return;
    lastWritten = key;
    const tries = untrack(() => pickRetry);
    writeRewardPick(file).then(
      () => untrack(() => pickRetry) && (pickRetry = 0),
      (e) => {
        console.error("writing the reward pick failed", e);
        if (lastWritten === key) lastWritten = "";
        retryLater(tries, () => pickRetry++);
      },
    );
    // Once per reward screen, for a second monitor: the card to take and why.
    const best = file.best == null ? null : cards[file.best];
    if (best && settings.notify.reward && notifiedScreen !== freshCards.at) {
      notifiedScreen = freshCards.at;
      const why = [best.price != null ? `${best.price}p` : null, best.needed ? `you need it${best.neededFor ? ` for ${best.neededFor}` : ""}` : null, best.ducats ? `${best.ducats} ducats` : null, best.set === 1 ? "completes a set" : null].filter(Boolean).join(", ");
      const of = cards.length > 1 ? `(best of the ${["", "", "two", "three", "four"][cards.length] ?? cards.length})` : "(the only card read)";
      tell("reward", `Take ${best.name}`, why ? `${why} ${of}` : of);
    }
  });
  let notifiedScreen = 0;

  // The riven key: set when it changes (and at start); a press asks TennoScope to read the
  // inventory, and a riven waiting for keep-or-take then shows over the game (see the cycle effect).
  let rivenKeyError = $state<string | null>(null);
  let rivenKeySet: string | null = null;
  /** The riven key's last press (a few seconds apart at most: each asks TennoScope for a read). */
  let rivenKeyAt = $state(0);
  $effect(() => {
    const key = settings.overlay.riven ? settings.overlay.rivenKey : "";
    if (!settingsReady || key === rivenKeySet) return;
    rivenKeySet = key;
    void setRivenKey(key, () => {
      if (settings.market.platform !== "pc" || Date.now() - rivenKeyAt < 4000) return;
      rivenKeyAt = Date.now();
      void ts.ask("--sync");
    }).then((why) => (rivenKeyError = why));
  });

  // Your overlay settings, for TennoScope: written when they change, and once at start.
  let lastOverlay = "";
  $effect(() => {
    void overlayRetry;
    const prefs = $state.snapshot(settings.overlay);
    const key = JSON.stringify(prefs);
    if (key === lastOverlay) return;
    lastOverlay = key;
    const tries = untrack(() => overlayRetry);
    writeOverlayPrefs(prefs).then(
      () => untrack(() => overlayRetry) && (overlayRetry = 0),
      (e) => {
        console.error("writing the overlay settings failed", e);
        if (lastOverlay === key) lastOverlay = "";
        retryLater(tries, () => overlayRetry++);
      },
    );
  });

  // Each new sale gets the item's daily median of the day it sold, so Sales compares it with the
  // market as it was then rather than as it is when you look.
  $effect(() => {
    const m = model;
    const count = settings.market.sales.length;
    if (!m || !settingsReady || !count) return;
    untrack(() => {
      const recent = Date.now() - 2 * 86_400_000;
      let changed = false;
      const next = settings.market.sales.map((s) => {
        if (s.median != null || s.at < recent) return s;
        const v = s.rank != null && s.rank > 0 ? (m.priceMax(s.item) ?? m.price(s.item)) : m.price(s.item);
        if (v == null) return s;
        changed = true;
        return { ...s, median: Math.round(v * 10) / 10 };
      });
      if (changed) settings.market.sales = next;
    });
  });

  // ---------------------------------------------------------------- notifications
  /**
   * Every notification goes through here: dropped when its kind is off (or needs a PC and you play
   * on a console), kept in the history (the bell), and shown unless notifications are paused, as
   * a pop-up inside orbiter while you're looking at it, else on the desktop.
   */
  function tell(kind: NoticeKind, title: string, body: string, to?: string) {
    if (!settings.notify[kind] || (onConsole && noticeKind[kind].pcOnly)) return;
    logLine(kind === "tennoscope" || kind === "market" ? "warn" : "info", "notice", `${kind}: ${title}${body ? ` (${body.split("\n")[0].slice(0, 200)})` : ""}`);
    settings.game.notices = logNotice(settings.game.notices, { at: Date.now(), kind, title, body, ...(to ? { to } : {}) });
    toDiscord(kind, title, body);
    if (quietNow(kind)) return;
    const n = settings.game.notices[0];
    if (typeof document !== "undefined" && document.hasFocus()) {
      if (settings.notifyOptions.toasts) toasts.push(n);
    } else if (settings.notifyOptions.desktop) notify(title, body, n.id);
  }
  /**
   * Repricing: one notification per pass, which grows as listings move (newest first, so the
   * pop-up shows the latest) and settles once the pass ends, rather than one per listing. A pass
   * that moves a single listing reads like a notification for that one. The desktop, which can't
   * change a notification it sent, only gets the total once the pass is over.
   */
  let repricing: { id: string; lines: string[]; done: ReturnType<typeof setTimeout> | null } | null = null;
  function tellRepriced(lines: string[]) {
    if (!settings.notify.repriced) return;
    const all = [...lines.slice().reverse(), ...(repricing?.lines ?? [])];
    const running = !!mkt.pass;
    const title = running ? `Repricing: ${all.length} so far` : `${all.length} listing${all.length === 1 ? "" : "s"} repriced`;
    settings.game.notices = growNotice(settings.game.notices, repricing?.id ?? null, { at: Date.now(), kind: "repriced", title, body: all.join("\n") });
    const n = settings.game.notices[0];
    const first = !repricing;
    repricing = { id: n.id, lines: all, done: repricing?.done ?? null };
    if (!running) settleRepriced();
    // A pass you started by hand shows its progress on its own button: no "so far" pop-up.
    if (running && mkt.passManual) return;
    if (quietNow("repriced")) return;
    if (typeof document !== "undefined" && document.hasFocus()) {
      if (settings.notifyOptions.toasts) toasts.push(n);
    } else if (first && !running && settings.notifyOptions.desktop) notify(title, n.body, n.id);
  }
  /** The pass ended: the notification gets its final title, and the next pass starts a new one. */
  function settleRepriced() {
    if (!repricing || repricing.done) return;
    repricing.done = setTimeout(() => {
      const r = repricing;
      repricing = null;
      if (!r) return;
      const title = `${r.lines.length} listing${r.lines.length === 1 ? "" : "s"} repriced`;
      settings.game.notices = growNotice(settings.game.notices, r.id, { at: Date.now(), kind: "repriced", title, body: r.lines.join("\n") });
      const n = settings.game.notices[0];
      toDiscord("repriced", title, n.body);
      if (quietNow("repriced")) return;
      if (typeof document !== "undefined" && document.hasFocus()) {
        if (settings.notifyOptions.toasts && toasts.list.some((t) => t.id === n.id)) toasts.push(n);
      } else if (settings.notifyOptions.desktop) notify(title, n.body, n.id);
    }, 1500);
  }
  $effect(() => {
    if (!mkt.pass) untrack(settleRepriced);
  });
  /** The kinds you chose also go to your Discord webhook, unless notifications are paused. */
  function toDiscord(kind: NoticeKind, title: string, body: string) {
    const d = settings.notifyOptions.discord;
    const o = settings.notifyOptions;
    if (!d?.url || !d.kinds.includes(kind) || o.paused || (o.pausedUntil != null && Date.now() < o.pausedUntil)) return;
    discordPost(d.url, `**${title}**${body ? `\n${body}` : ""}`).then(() => discordSent(null), discordSent);
  }
  /** Why nothing pops up right now for this kind, if anything: kept in the history only. */
  function quietNow(kind: NoticeKind): boolean {
    const o = settings.notifyOptions;
    if (o.paused || (o.pausedUntil != null && Date.now() < o.pausedUntil)) return true;
    if (o.quiet.includes(kind)) return true;
    // In a fissure: only the reward to take, which is what you'd want then.
    return o.quietInFissure && inFissure(mission) && kind !== "reward";
  }
  /** Settings' test: shows how a notification looks, whatever is switched off, and keeps nothing. */
  function testNotice() {
    const o = settings.notifyOptions;
    const until = o.paused ? "until you set Pause back to Off" : o.pausedUntil ? `until ${new Date(o.pausedUntil).toLocaleString(undefined, { weekday: new Date(o.pausedUntil).toDateString() === new Date().toDateString() ? undefined : "short", hour: "2-digit", minute: "2-digit" })}` : "";
    toasts.push({ id: `test-${Date.now()}`, at: Date.now(), kind: "repriced", title: "This is how notifications look", body: until ? `Paused ${until}: the real ones go to Recent without popping up. Click this to see Recent.` : "Click one to open what it's about; this one opens Recent. Your desktop gets them while orbiter is behind other windows.", read: true });
  }
  // A pause for a while ends by itself.
  $effect(() => {
    const until = settings.notifyOptions.pausedUntil;
    if (until == null) return;
    const ms = until - Date.now();
    if (ms <= 0) {
      settings.notifyOptions.pausedUntil = null;
      return;
    }
    const t = setTimeout(() => (settings.notifyOptions.pausedUntil = null), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  });
  let showNotices = $state(false);
  /** What the bell's panel opens on: what's new, or (from Settings) the switches. */
  let noticesView = $state<"recent" | "choose">("recent");
  function openNotices(view: "recent" | "choose" = "recent") {
    noticesView = view;
    showNotices = true;
  }
  /** Notifications don't pop up now: paused, for good or for a while. */
  const pausedNow = $derived(settings.notifyOptions.paused || (settings.notifyOptions.pausedUntil != null && settings.notifyOptions.pausedUntil > tick));
  const unread = $derived(settings.game.notices.filter((n) => !n.read).length);
  /** Opens what a notification is about, and marks it read. */
  function openNotice(id: string) {
    toasts.dismiss(id);
    // The test one: where the real ones are kept.
    if (id.startsWith("test-")) return openNotices("recent");
    const n = settings.game.notices.find((x) => x.id === id);
    if (!n) return;
    settings.game.notices = settings.game.notices.map((x) => (x.id === id ? { ...x, read: true } : x));
    const { page, card } = splitTarget(n.to ?? noticeKind[n.kind]?.to ?? "home");
    showNotices = false;
    goTo(available.some((p) => p.id === page) ? page : "home", card);
  }
  /** A card on Home a notification opened: shown even if Customise hides it, until you leave Home. */
  let homeReveal = $state<string | null>(null);
  $effect(() => {
    if (settings.tab !== "home") homeReveal = null;
  });
  /**
   * Opens a page, from a link like "parts?best=Ducats#top": the filters go to the page (intent),
   * and a spot ("home#baro", "market#spares") is scrolled to and lit up briefly. `hold`: the spot
   * stays outlined until the next goTo (the tour, one change at a time).
   */
  function goTo(target: string, spot: string | null = null, hold = false) {
    const t = parseTarget(target);
    const page = t.page;
    const card = spot ?? t.spot;
    setIntent(page, t.want);
    settings.tab = page;
    held?.cancel();
    held = null;
    if (!card) return;
    if (page === "home") homeReveal = card;
    const asked = ++spotAsk;
    // After the page has drawn it: a page opened for the first time loads, so look again for a
    // moment. The glow is an animation of its own (the page redraws the spot's classes, which
    // would wipe a class put on by hand), starting once the scroll lands. A spot outside the page
    // (the sidebar's sections) is looked for there.
    let tries = 0;
    const look = () => {
      if (asked !== spotAsk) return;
      const sel = `[data-card="${CSS.escape(card)}"]`;
      const el = document.querySelector<HTMLElement>(`.pane.shown ${sel}, .pane.shown #${CSS.escape(card)}`) ?? document.querySelector<HTMLElement>(`.rail ${sel}`);
      if (!el || !el.getClientRects().length) {
        if (++tries < 30) setTimeout(look, 80);
        return;
      }
      held = spotlight(el, hold);
    };
    setTimeout(look, 60);
  }
  /** The last spot asked for: a slower look for an earlier one gives up. */
  let spotAsk = 0;
  /** The tour's spot, outlined until the next. */
  let held: Animation | null = null;
  /**
   * Brings a spot into view and lights it: a gold ring and glow that fades (with `hold`, settles to
   * the ring). Reduced motion: no scrolling glide and no fade, a plain gold outline for a moment.
   */
  function spotlight(el: HTMLElement, hold: boolean): Animation {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A tall spot (a table, a list) shows its top, a little below the page's edge; a small one
    // comes to the middle.
    const page = el.closest<HTMLElement>(".page");
    const behavior = still ? "auto" : "smooth";
    if (page && el.offsetHeight > page.clientHeight * 0.6) page.scrollTo({ top: page.scrollTop + el.getBoundingClientRect().top - page.getBoundingClientRect().top - 24, behavior });
    else el.scrollIntoView({ block: "center", behavior });
    // Show me from the keyboard: Tab goes on from the spot, not from the top of the window.
    if (!hold && (document.activeElement === document.body || !document.activeElement)) {
      if (!el.matches("a[href], button, input, select, textarea, summary, [tabindex]")) el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
    // The inner ring shows even where the page clips the outer glow.
    const ring = "inset 0 0 0 1px rgb(214 174 74), 0 0 0 1px rgb(214 174 74)";
    const lit = `${ring}, 0 0 26px rgb(214 174 74 / 45%)`;
    const off = "inset 0 0 0 1px transparent, 0 0 0 1px transparent, 0 0 0 transparent";
    if (still) return el.animate([{ boxShadow: ring }, { boxShadow: ring }], hold ? { duration: 1, fill: "forwards" } : { duration: 3000 });
    return el.animate(
      [
        { boxShadow: off, offset: 0 },
        { boxShadow: lit, offset: 0.15 },
        { boxShadow: lit, offset: 0.45 },
        { boxShadow: hold ? ring : off, offset: 1 },
      ],
      { duration: 2000, delay: 350, easing: "ease-out", fill: hold ? "forwards" : "none" },
    );
  }
  tourGate.ok = (page) => available.some((p) => p.id === page);
  // The tour (What's New, Take the tour): each change's page, its spot held lit; ended, the light goes.
  $effect(() => {
    const s = tourStop();
    untrack(() => {
      if (s?.open) goTo(s.open, null, true);
      else if (!s) {
        held?.cancel();
        held = null;
      }
    });
  });
  /** Marks a world event announced; false when it was already. Remembers the last 300. */
  function firstTime(key: string): boolean {
    if (settings.game.worldNotified.includes(key)) return false;
    settings.game.worldNotified = [key, ...settings.game.worldNotified].slice(0, 300);
    return true;
  }
  const names = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));

  // Alerts: a reward toward something you haven't mastered, or a rare one. Once per alert and reward.
  $effect(() => {
    const alerts = live.alerts;
    const m = onConsole ? null : model;
    if (!alerts?.length || !settingsReady || (!m && !onConsole)) return;
    untrack(() => {
      const { mastery, rare } = alertNeeds(m, alerts);
      const freshM = mastery.filter((a) => firstTime(`alert|${a.key}`));
      const freshR = rare.filter((a) => firstTime(`alert|${a.key}`));
      const line = (a: (typeof mastery)[number]) => `${a.help ? describeHelp(a.reward, a.help) : a.reward}: ${a.mission} at ${a.node}, ${until(a.expiry)} left`;
      if (freshM.length) tell("alerts", freshM.length === 1 ? `Alert: ${freshM[0].reward}` : `${freshM.length} alerts with something to master`, freshM.map(line).join("\n"));
      if (freshR.length) tell("alertLoot", freshR.length === 1 ? `Alert: ${freshR[0].reward}` : `${freshR.length} alerts with rare rewards`, freshR.map(line).join("\n"));
    });
  });
  // Invasions paying a rare reward (a Catalyst or Reactor blueprint, Forma…): as alerts' rare
  // rewards, once per invasion and reward. No inventory needed, so consoles get them too.
  $effect(() => {
    const invs = live.invasions;
    if (!invs?.length || !settingsReady) return;
    untrack(() => {
      const fresh = invasionRares(invs).filter((n) => firstTime(`invasion|${n.key}`));
      if (fresh.length) tell("alertLoot", fresh.length === 1 ? `Invasion: ${fresh[0].reward}` : `${fresh.length} invasions with rare rewards`, fresh.map((n) => `${n.reward}: side with ${n.side} at ${n.node}`).join("\n"));
    });
  });
  // Baro's arrival: what he brings that you haven't mastered or don't have. Once per visit.
  $effect(() => {
    const b = live.baro;
    const m = model;
    if (!m || !b || !settingsReady) return;
    if (Date.now() < Date.parse(b.activation) || Date.now() > Date.parse(b.expiry)) return;
    untrack(() => {
      // A console: nothing to hold his stock against, so just that he's here.
      if (onConsole) {
        if (firstTime(`baro|${b.activation}`)) tell("baro", `Baro is at ${b.location}`, `${b.inventory?.length ? `${b.inventory.length} thing${b.inventory.length === 1 ? "" : "s"} in stock. ` : ""}He leaves in ${until(b.expiry)}.`);
        return;
      }
      if (!b.inventory?.length) return;
      const stock = baroStock(m);
      const need = stock.filter((x) => x.mark === "mastery" || x.mark === "new");
      if (!need.length || !firstTime(`baro|${b.activation}`)) return;
      const ducats = (m.inventoryByBase.get("/Lotus/Types/Items/MiscItems/PrimeBucks") ?? []).reduce((n, r) => n + r.quantity, 0);
      tell("baro", `Baro is at ${b.location}: ${need.length} new to you`, `${names(need.map((x) => x.name), 6)}. You hold ${ducats.toLocaleString("en")} ducats; he leaves in ${until(b.expiry)}.`);
    });
  });
  // Varzia's new rotation, with primes you need from it. Once per rotation.
  $effect(() => {
    const exp = live.resurgenceExpiry;
    const m = model;
    if (!m || !exp || !live.resurgence?.length || !settingsReady || onConsole) return;
    untrack(() => {
      const needs = varziaNeeds(m, masteryRows(m));
      if (!needs.length || !firstTime(`varzia|${exp}`)) return;
      const only = needs.filter((v) => v.onlyHere > 0).length;
      tell("varzia", `Varzia: ${needs.length} prime${needs.length === 1 ? "" : "s"} you need`, `${names(needs.map((v) => v.name), 6)}${only ? `. ${only} only from her relics right now` : ""}. Rotation ends in ${until(exp)}.`);
    });
  });
  // The Duviri Circuit's week: warframes you haven't mastered, adapters for weapons you have. Once a week.
  $effect(() => {
    const m = model;
    if (!m || !live.duviriCycle || !settingsReady || onConsole) return;
    untrack(() => {
      const c = today(m, live, Date.now(), settings.game.gear).circuit;
      if (!c) return;
      const frames = c.frames.filter((x) => x.wanted).map((x) => x.name);
      const incarnons = c.incarnons.filter((x) => x.wanted).map((x) => x.name);
      if (!frames.length && !incarnons.length) return;
      if (!firstTime(`circuit|${c.resets}|${[...frames, ...incarnons].join(",")}`)) return;
      tell("circuit", "Duviri Circuit this week", [frames.length ? `Warframes to master: ${names(frames)}` : "", incarnons.length ? `Steel Path Incarnon for weapons you have: ${names(incarnons)}` : ""].filter(Boolean).join("\n"));
    });
  });

  // Market and TennoScope trouble, as it happens.
  let seenNote = 0;
  $effect(() => {
    const fresh = mkt.log.filter((l) => l.at > seenNote);
    if (!fresh.length) return;
    seenNote = Math.max(...fresh.map((l) => l.at));
    // Auto-match's changes as one notification ("Serration R0: 9p → 8p, …"), problems one each,
    // headed by what went wrong ("Couldn't reprice Serration").
    const moved = fresh.filter((l) => l.tone === "ok" && l.text.includes("→"));
    if (moved.length) tellRepriced(moved.map((l) => l.text.replace(/, .*$/, "")).reverse());
    for (const l of fresh.filter((l) => l.tone === "warn" && !l.quiet)) {
      const head = l.text.split(/[:.](\s|$)/)[0];
      tell("market", head.length <= 70 ? head : "Something went wrong on warframe.market", l.text);
    }
  });
  /** Visible listings for more than you hold now (as of TennoScope's last read): sold, or used. */
  const shortListings = $derived(
    model
      ? mkt.orders.filter((o) => {
          const it = mkt.item(o.itemId);
          if (!it || !o.visible) return false;
          const held = heldFor(model, it, o);
          return held != null && held < o.quantity;
        })
      : [],
  );
  // A listing for more than you now hold (you sold or used some in game): said once per listing and
  // quantity listed, remembered across restarts. (A count orbiter can't make isn't short: see above.)
  $effect(() => {
    const short = shortListings;
    const m = model;
    if (!m || !short.length || !settingsReady) return;
    untrack(() => {
      const key = (o: (typeof short)[number]) => `${o.id}|${o.quantity}`;
      const seen = new Set(settings.game.shortNotified);
      const fresh = short.filter((o) => !seen.has(key(o)));
      if (!fresh.length) return;
      settings.game.shortNotified = [...fresh.map(key), ...settings.game.shortNotified].slice(0, 300);
      if (!settings.notify.market) return;
      const lines = fresh.map((o) => {
        const it = mkt.item(o.itemId)!;
        return `${it.name}: listed ${o.quantity}, you hold ${heldFor(m, it, o)}`;
      });
      tell("market", "Listed more than you hold", lines.join("\n"));
    });
  });
  // The status connection failing (refused sign-in, or warframe.market unreachable): once per problem.
  // A connection that keeps dropping (each drop clears and sets the error again) is told at most
  // every 15 minutes.
  let lastStatusError: string | null = null;
  let statusNotifiedAt = 0;
  $effect(() => {
    const e = mkt.status?.error ?? null;
    if (e && !lastStatusError && settings.notify.market && Date.now() - statusNotifiedAt > 15 * 60_000) {
      statusNotifiedAt = Date.now();
      tell("market", "warframe.market status", e);
    }
    lastStatusError = e;
  });
  // An invasion rewarding a part you need: one notification per invasion and part, remembered
  // across restarts so the same invasion doesn't announce itself every time orbiter opens.
  const invasionsNeeded = $derived(model && !onConsole ? invasionNeeds(model, live.invasions) : []);
  $effect(() => {
    const needs = invasionsNeeded;
    if (!needs.length) return;
    untrack(() => {
      const seen = new Set(settings.notifiedInvasions);
      const fresh = needs.filter((n) => !seen.has(n.key));
      if (!fresh.length) return;
      if (settings.notify.invasions) {
        tell("invasions", 
          fresh.length === 1 ? `Invasion: ${fresh[0].reward}` : `${fresh.length} invasions with parts you need`,
          fresh.map((n) => `${n.reward} for ${n.item}: side with ${n.side} at ${n.node}`).join("\n"),
        );
      }
      settings.notifiedInvasions = [...fresh.map((n) => n.key), ...settings.notifiedInvasions].slice(0, 300);
    });
  });
  // Every trade in the game log goes in the trade history (Stats), sales, purchases and swaps.
  $effect(() => {
    const trades = mission?.trades ?? [];
    const session = mission?.session_start ?? null;
    if (!trades.length) return;
    untrack(() => {
      repairRanks(trades, session);
      const have = new Set(settings.market.trades.map((t) => t.key));
      const fresh = trades.filter((t) => !have.has(tradeKey(session, t)));
      if (!fresh.length) return;
      const entries = fresh.map((t) => ({ key: tradeKey(session, t), at: t.at ? t.at * 1000 : Date.now(), partner: t.partner, offered: t.offered, received: t.received, platOut: t.platinum_offered, platIn: t.platinum_received }));
      settings.market.trades = [...entries.reverse(), ...settings.market.trades].slice(0, 2000);
      // Whether a fresh trade's partner is on warframe.market, for the +rep strip.
      for (const e of entries) if (Date.now() - e.at < REP_WINDOW) mkt.user(e.partner).catch(() => {});
      void runAutoRep();
    });
  });

  // warframe.market's own chat: messages buyers send on the website, not in game. Read each minute
  // while signed in; each new message once (a notification, and the strip at the top).
  const chatsDue = $derived(mkt.chats.filter((c) => c.unread > 0 && settings.game.chatsSeen[c.id] !== c.lastUpdate));
  $effect(() => {
    const due = chatsDue;
    if (!due.length) return;
    untrack(() => {
      const fresh = due.filter((c) => !notifiedChats.has(`${c.id}@${c.lastUpdate}`));
      for (const c of fresh) notifiedChats.add(`${c.id}@${c.lastUpdate}`);
      if (fresh.length && settings.notify.siteChat) tell("siteChat", fresh.length === 1 ? `${fresh[0].with} messaged you on warframe.market` : `${fresh.length} chats on warframe.market`, fresh.map((c) => (c.lastMessage ? `${c.with}: ${c.lastMessage.slice(0, 140)}` : `${c.with}: ${c.unread} unread`)).join("\n"));
    });
  });
  const notifiedChats = new Set<string>();
  function chatsRead() {
    settings.game.chatsSeen = { ...settings.game.chatsSeen, ...Object.fromEntries(chatsDue.map((c) => [c.id, c.lastUpdate])) };
  }

  // +rep after a trade: for the latest trade of the last half hour, when its partner is on
  // warframe.market and you haven't given it or said Not now.
  const REP_WINDOW = 30 * 60_000;
  const repDue = $derived.by(() => {
    const t = settings.market.trades[0];
    if (!t || clock - t.at > REP_WINDOW || settings.market.rep[t.key]) return null;
    // One +rep per player: already given on an earlier trade.
    if (settings.market.trades.some((x) => x.partner === t.partner && settings.market.rep[x.key] === "given")) return null;
    const u = mkt.users[t.partner.toLowerCase()];
    return u ? { t, u } : null;
  });
  // +rep by itself (Settings, Trades): each partner of the last day's trades, once per player,
  // with your message. Also when orbiter opens after the trade (the game log still has it) and
  // once you sign in to warframe.market. A partner not on warframe.market is let go; one that
  // fails waits for the next run, and says why once.
  // "Online in game" only while Warframe runs (as TennoScope sees it): buyers who pick it expect
  // an answer in game. Online until then, and again after you close the game (mkt.presenceFor).
  $effect(() => {
    mkt.gameRunning = ts.report ? !!ts.report.game_running : null;
  });
  $effect(() => {
    const want = settings.market.presence;
    const running = mkt.gameRunning;
    if (want !== "ingame" || running == null || !mkt.linked || !mkt.status?.wanted) return;
    untrack(() => {
      const now = mkt.presenceFor(want);
      if (mkt.status?.wanted !== now && mkt.statusAsked !== now) void mkt.setStatus(now);
    });
  });
  // Gone invisible for the rest of the day because your trades ran out (Presence's offer): back to
  // what you had at the reset, whichever page is open (checked on the half-minute clock).
  $effect(() => {
    const b = settings.market.presenceBack;
    if (!b || tick < b.until || !mkt.linked) return;
    untrack(() => {
      settings.market.presenceBack = null;
      // A status you chose since stands; only the invisible orbiter set goes back.
      if (settings.market.presence !== "invisible") return;
      settings.market.presence = b.p;
      void mkt.setStatus(mkt.presenceFor(b.p));
    });
  });
  let repRunning = false;
  const repFailed = new Set<string>();
  async function runAutoRep() {
    if (repRunning || !settings.market.autoRep || !mkt.linked) return;
    repRunning = true;
    try {
      for (const t of repCandidates(settings.market.trades, settings.market.rep, Date.now())) {
        if (repFailed.has(t.key)) continue;
        // Turned off, or signed out, part way through: stop there.
        if (!settings.market.autoRep || !mkt.linked) break;
        let u: Awaited<ReturnType<typeof mkt.user>>;
        try {
          u = await mkt.user(t.partner);
        } catch {
          continue; // warframe.market didn't answer: next run
        }
        if (u === null) {
          markRep(t.key, "skipped"); // not on warframe.market: nothing to rate
          continue;
        }
        try {
          const r = await mkt.giveRep(t.partner, settings.market.repText);
          markRep(t.key, r === "reported" ? "skipped" : "given");
        } catch (e) {
          repFailed.add(t.key);
          tell("sold", `Couldn't give ${t.partner} +rep`, `${String(e).replace(/^Error:\s*/, "")}. Stats has a +rep button for that trade.`);
        }
        // warframe.market asks for some room between requests.
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally {
      repRunning = false;
    }
  }
  // On start and on signing in: trades read while signed out, or while orbiter was closed.
  $effect(() => {
    if (mkt.linked && settings.market.autoRep) untrack(() => void runAutoRep());
  });
  function markRep(key: string, how: "given" | "skipped") {
    let rep = { ...settings.market.rep, [key]: how };
    // Only trades still in the history are worth remembering.
    if (Object.keys(rep).length > 2500) {
      const live = new Set(settings.market.trades.map((t) => t.key));
      rep = Object.fromEntries(Object.entries(rep).filter(([k]) => live.has(k)));
    }
    settings.market.rep = rep;
  }

  // Whole sets sold in one trade before orbiter logged them as sets: one sale per part becomes one
  // set sale. Runs when the data loads; does nothing once they're folded.
  $effect(() => {
    const m = model;
    if (!m || !settingsReady) return;
    untrack(() => {
      const next = foldSetSales(settings.market.sales, settings.market.trades, m);
      if (next) settings.market.sales = next;
    });
  });

  // Trades logged before orbiter read an arcane's rank (shown as pips in the trade window): once the
  // game log still has the trade, fill the rank in, on the trade and on the sale it made, so the sale
  // is compared with the maxed price rather than the unranked one.
  function repairRanks(trades: NonNullable<MissionState["trades"]>, session: number | null) {
    const byKey = new Map(trades.map((t) => [tradeKey(session, t), t]));
    const fixes: { name: string; rank: number; at: number }[] = [];
    const next = settings.market.trades.map((e) => {
      const t = byKey.get(e.key);
      if (!t) return e;
      let changed = false;
      const offered = e.offered.map((x, i) => {
        const now = t.offered[i];
        if (x.rank != null || !now || now.name !== x.name || now.rank == null) return x;
        changed = true;
        fixes.push({ name: x.name, rank: now.rank, at: e.at });
        return { ...x, rank: now.rank };
      });
      return changed ? { ...e, offered } : e;
    });
    if (!fixes.length) return;
    settings.market.trades = next;
    settings.market.sales = settings.market.sales.map((sale) => {
      const f = sale.rank == null && fixes.find((x) => x.name === sale.item && Math.abs(x.at - sale.at) < 60_000);
      return f ? { ...sale, rank: f.rank } : sale;
    });
  }

  // Trades in the game log: a sale (items out, only platinum in) marks its listing sold on
  // warframe.market and goes in the sales log, seconds after the trade window closes. Each trade
  // once; one you already logged by hand around the same time isn't logged again.
  $effect(() => {
    const trades = mission?.trades ?? [];
    const session = mission?.session_start ?? null;
    // Not before your listings are read (orbiter starting, or back after an outage): matched
    // against none, every sale would log as "not listed" and its listing would stay up.
    if (!trades.length || !mkt.linked || mkt.ordersAt == null || !mkt.items.length) return;
    untrack(() => {
      // A sale logged from one of these trades before orbiter could read its rank (an arcane's
      // pips): the rank is filled in now, so it's compared with the right price.
      for (const t of trades) {
        const key = tradeKey(session, t);
        for (const x of t.offered) {
          if (x.rank == null) continue;
          const i = settings.market.sales.findIndex((s) => s.trade === key && s.rank == null && (s.item === x.name || s.item === mkt.index.byName.get(x.name.toLowerCase())?.name));
          if (i >= 0) settings.market.sales[i] = { ...settings.market.sales[i], rank: x.rank };
        }
      }
      const seen = new Set(settings.market.tradesSeen);
      const fresh = trades.filter((t) => !seen.has(tradeKey(session, t)));
      if (!fresh.length) return;
      // This session's keys stay however many there are: the log shows its trades on every read.
      settings.market.tradesSeen = keepSeen(fresh.map((t) => tradeKey(session, t)), settings.market.tradesSeen, 300, session == null ? "?" : String(session));
      if (!settings.market.autoTrades) return;
      // Only trades from the last half hour are acted on. Older ones turn up when orbiter first
      // reads a log (just installed, or settings reset) or was closed at the time: by now that
      // listing may have been put back up, and closing it again would be wrong.
      // A trade with no time (the log's session start wasn't seen) is acted on only once it turns
      // up new after this run's first read of that session: the first read can be hours late.
      const firstRead = !tradeSessionsRead.has(session ?? "?");
      tradeSessionsRead.add(session ?? "?");
      const recent = fresh.filter((t) => (t.at ? Date.now() - t.at * 1000 < 30 * 60_000 : !firstRead));
      if (recent.length) void handleTrades(recent, session);
    });
  });
  /** Game sessions whose trade log this run has read once (see the trade effect). */
  const tradeSessionsRead = new Set<number | string>();
  async function handleTrades(trades: NonNullable<MissionState["trades"]>, session: number | null) {
    const done: string[] = [];
    let unmarked = 0;
    for (const t of trades) {
      const sales = salesFromTrade(t, mkt.orders, mkt.index, model);
      if (!sales) continue;
      const at = t.at ? t.at * 1000 : Date.now();
      const key = tradeKey(session, t);
      for (const s of sales) {
        // Logged by hand within ten minutes of the trade: already counted. Only by hand: a sale
        // this logged from an earlier trade (the same item to another buyer) is a sale of its own.
        const hand = handLoggedSale(settings.market.sales, s.name, at);
        if (hand >= 0) {
          settings.market.sales[hand] = { ...settings.market.sales[hand], trade: key };
          continue;
        }
        const marked = s.order ? await mkt.sold(s.order, Math.min(s.count, s.order.quantity), { quiet: true }) : null;
        if (s.order && !marked) unmarked++;
        settings.market.sales = [{ at, item: s.name, rank: s.rank, quantity: s.count, platinum: s.platinumEach, trade: key }, ...settings.market.sales].slice(0, 2000);
        done.push(`${s.count > 1 ? `${s.count} × ` : ""}${s.name} for ${s.count * s.platinumEach}p${s.order ? (marked ? "" : " (still listed)") : " (not listed)"}`);
      }
    }
    if (!done.length) return;
    const outcome = unmarked ? `Logged; ${unmarked} couldn't be marked sold on warframe.market (see Orders).` : "Marked sold on warframe.market and logged.";
    tell("sold", done.length === 1 ? `Sold ${done[0]}` : `${done.length} sales`, `${done.join("\n")}\n${outcome}`, "sales");
    // Your inventory changed: have TennoScope read it again so spares and listings line up.
    if (ts.report?.setup.access_mode === "full" && ts.report.game_running) void ts.ask("--sync");
  }
  // The game restarted, or started after TennoScope: its read of your inventory is from before
  // this game session. TennoScope reads it when it sees the game start, which is often before you
  // log in (nothing to read yet), and doesn't try again by itself. So once you've had time to log
  // in, orbiter asks it to read again; and once more a few minutes later if that read didn't land.
  const syncAsked = new Map<number, number>();
  $effect(() => {
    const session = mission?.session_start ?? null;
    const at = model?.observedAt ? +model.observedAt / 1000 : null;
    const r = ts.report;
    if (!session || onConsole || !r || r.setup.access_mode !== "full" || !r.game_running) return;
    if (at != null && at >= session) return;
    const asked = syncAsked.get(session) ?? 0;
    if (asked >= 2) return;
    // 90 s after the game started for the first ask (the login screen takes about that), five
    // minutes after the first for the second.
    const due = asked === 0 ? session * 1000 + 90_000 : (syncAsked.get(-session) ?? 0) + 300_000;
    const t = setTimeout(() => {
      syncAsked.set(session, asked + 1);
      syncAsked.set(-session, Date.now());
      void ts.ask("--sync");
    }, Math.max(0, due - Date.now()));
    return () => clearTimeout(t);
  });

  // ---------------------------------------------------------------- account facts and alerts

  // TennoScope's read of your account: foundry finish times, mastery rank, platinum. Kept in
  // settings so they outlive a TennoScope restart.
  $effect(() => {
    const r = ts.report;
    if (!r) return;
    untrack(() => {
      const g = settings.game;
      if (r.foundry_ready && JSON.stringify(r.foundry_ready) !== JSON.stringify(g.foundryReady)) g.foundryReady = r.foundry_ready;
      if (r.mastery_rank != null && r.mastery_rank !== g.masteryRank) g.masteryRank = r.mastery_rank;
      if (r.platinum != null && r.platinum !== g.platinum) g.platinum = r.platinum;
      if (r.credits != null && r.credits !== g.credits) g.credits = r.credits;
      if (r.endo != null && r.endo !== g.endo) g.endo = r.endo;
      if (r.rivens && JSON.stringify(r.rivens) !== JSON.stringify(g.rivens)) g.rivens = r.rivens;
      if (r.imprints && JSON.stringify(r.imprints) !== JSON.stringify(g.imprints)) g.imprints = r.imprints;
      if (r.gear && JSON.stringify(r.gear) !== JSON.stringify(g.gear)) g.gear = r.gear;
      if (r.rivens) {
        const hist = recordRivens(g.rivenHistory ?? {}, r.rivens);
        if (hist) g.rivenHistory = hist;
      }
      // The wallet can arrive after the inventory it goes with: bring the latest chart point up to date.
      const last = g.valueHistory.at(-1);
      const at = model?.observedAt ? +model.observedAt : null;
      if (last && at != null && last.at === at && (last.platinum !== g.platinum || last.credits !== g.credits || last.endo !== g.endo)) {
        g.valueHistory = [...g.valueHistory.slice(0, -1), { ...last, platinum: g.platinum, credits: g.credits, endo: g.endo }];
      }
    });
  });

  // Foundry builds turning ready: checked every half minute against their finish times.
  $effect(() => {
    const t = setInterval(() => {
      tick = Date.now();
      // A fissure, alert or offer that ends goes when it ends, not at the next read.
      const p = pruneLive(live, tick);
      if (p !== live) live = p;
    }, 30_000);
    return () => clearInterval(t);
  });
  $effect(() => {
    const now = tick;
    if (!model || onConsole) return;
    const ready = foundryBuilds(model, settings.game.foundryReady, now).filter((b) => b.ready);
    untrack(() => {
      const seen = new Set(settings.game.foundryNotified);
      const fresh = ready.filter((b) => !seen.has(b.key));
      if (!fresh.length) return;
      // Builds that were already done before orbiter first saw them don't need announcing.
      const old = fresh.filter((b) => now - b.readyAt > 6 * 3_600_000);
      const news = fresh.filter((b) => !old.includes(b));
      if (news.length && settings.notify.foundry) {
        tell("foundry", 
          news.length === 1 ? `Ready in the Foundry: ${news[0].name}` : `${news.length} Foundry builds ready`,
          news.length === 1
            ? news[0].points ? `Claim it: +${news[0].points.toLocaleString("en")} mastery once levelled` : "Claim it from the Foundry"
            : news.map((b) => `${b.name}${b.points ? `: +${b.points.toLocaleString("en")} mastery once levelled` : ""}`).join("\n"),
        );
      }
      settings.game.foundryNotified = [...fresh.map((b) => b.key), ...settings.game.foundryNotified].slice(0, 200);
    });
  });

  // Someone whispered you: one alert per chat per game session.
  $effect(() => {
    const ws = mission?.whispers ?? [];
    const session = mission?.session_start ?? null;
    if (!ws.length) return;
    untrack(() => {
      const seen = new Set(settings.game.whispersSeen);
      const fresh = ws.filter((w) => !seen.has(`${session}|${w.name}`));
      if (!fresh.length) return;
      settings.game.whispersSeen = [...fresh.map((w) => `${session}|${w.name}`), ...settings.game.whispersSeen].slice(0, 300);
      // Opening orbiter mid-session: chats from more than 15 minutes ago aren't news any more.
      const recent = fresh.filter((w) => w.at == null || Date.now() / 1000 - w.at < 15 * 60);
      // A buyer is on the way: hide your last copies so a second one doesn't come for the same.
      if (recent.length) void hideLastCopies(recent.map((w) => w.name));
      if (!settings.notify.whispers || !recent.length) return;
      const listed = mkt.orders.filter((o) => o.visible).length;
      const tail = listed ? `You have ${listed} listing${listed === 1 ? "" : "s"} up on warframe.market` : "Check your chat in game";
      if (recent.length > 1) {
        tell("whispers", `${recent.length} people whispered you`, [recent.map((w) => w.name).join(", "), tail].join(" · "));
        return;
      }
      // One person: who they are on warframe.market, if it answers within a couple of seconds.
      const who = recent[0].name;
      void Promise.race([mkt.user(who).catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), 2500))]).then((u) => {
        const rep = u === null ? "Not on warframe.market" : u ? `${u.reputation} reputation on warframe.market` : "";
        tell("whispers", `${who} whispered you`, [rep, tail].filter(Boolean).join(" · "));
      });
    });
  });

  // Last copies hidden while someone whispers you (lastCopy.ts): hidden on the whisper, shown
  // again once the wait is over unless they sold.
  async function hideLastCopies(who: string[]) {
    const lc = settings.market.lastCopy;
    if (!lc.optIn || !mkt.linked) return;
    const toHide = lastCopies(mkt.orders);
    const hiddenNow = toHide.length ? await mkt.setShown(toHide, false) : [];
    settings.market.lastCopy.hidden = hideNow(settings.market.lastCopy.hidden, hiddenNow, Date.now());
    if (hiddenNow.length) {
      const names = hiddenNow.map((o) => mkt.item(o.itemId)?.name ?? "a listing");
      mkt.note(`${who.join(", ")} whispered you: hid ${names.length === 1 ? names[0] : `${names.length} last-copy listings (${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""})`} for ${lc.minutes >= 1 ? lc.minutes : DEFAULT_HIDE_MINUTES} min, back then unless sold`, "info");
    }
  }
  async function showLastCopiesDue() {
    const lc = settings.market.lastCopy;
    if (!lc.hidden.length || !mkt.linked || !mkt.orders.length) return;
    // An emptied minutes box mustn't leave them hidden for ever.
    // Turned off: whatever it hid comes back now.
    const minutes = !lc.optIn ? 0 : lc.minutes >= 1 ? lc.minutes : DEFAULT_HIDE_MINUTES;
    const { show, keep } = dueToShow(lc.hidden, mkt.orders, Date.now(), minutes);
    if (!show.length) {
      if (keep.length !== lc.hidden.length) settings.market.lastCopy.hidden = keep;
      return;
    }
    const before = new Set(lc.hidden.map((h) => h.id));
    const kept = new Set(keep.map((h) => h.id));
    const shown = await mkt.setShown(show, true);
    const failed = show.filter((o) => !shown.includes(o)).map((o) => ({ id: o.id, at: Date.now() }));
    // From the list as it is now: a whisper while this waited may have hidden more, and those stay.
    settings.market.lastCopy.hidden = [...settings.market.lastCopy.hidden.filter((h) => !before.has(h.id) || kept.has(h.id)), ...failed];
    if (shown.length) mkt.note(`Shown again${minutes ? `, not sold in ${minutes} min` : ""}: ${shown.map((o) => mkt.item(o.itemId)?.name ?? "a listing").join(", ")}`, "info");
  }
  $effect(() => {
    const t = setInterval(() => void showLastCopiesDue(), 30_000);
    return () => clearInterval(t);
  });

  // Fissure alerts: a fissure that matches one of your rules, once per fissure.
  $effect(() => {
    const rules = settings.fissureRules;
    const fs = live.fissures;
    if (!rules.length || !fs) return;
    untrack(() => {
      const seen = new Set(settings.game.fissuresNotified);
      const fresh = matchedFissures(rules, fs).filter((x) => !seen.has(x.fissure.id));
      if (!fresh.length) return;
      settings.game.fissuresNotified = [...fresh.map((x) => x.fissure.id), ...settings.game.fissuresNotified].slice(0, 300);
      if (!settings.notify.fissures) return;
      const f = fresh[0].fissure;
      const what = (x: (typeof fresh)[number]) => `${x.fissure.isHard ? "Steel Path " : x.fissure.isStorm ? "Void Storm " : ""}${x.fissure.tier} ${x.fissure.missionType} · ${x.fissure.node}`;
      tell("fissures", fresh.length === 1 ? `Fissure: ${f.tier} ${f.missionType}` : `${fresh.length} fissures you're watching for`, fresh.map(what).join("\n"));
    });
  });

  // Wishlist: an era that had no fissure open gets one, and you hold relics of that era with a part
  // you starred. Every era usually has fissures open (and Omnia takes any but Requiem), so this only speaks
  // up after a gap; the Wishlist page shows what to crack at any moment.
  let erasOpenBefore: Set<string> | null = null;
  $effect(() => {
    const fs = live.fissures;
    const m = model;
    // Not from the worldstate kept from last time: eras whose fissures ended since would seem to open.
    if (!m || !fs || !liveRead) return;
    untrack(() => {
      const open = openEras(fs);
      const openNow = new Set(ERAS.filter((e) => (open[e]?.length ?? 0) > 0));
      const before = erasOpenBefore;
      erasOpenBefore = openNow;
      if (!before || onConsole || !settings.favourites.length || !settings.notify.wishlist) return;
      const eras = wishlistEras(m, settings.favourites);
      const fresh = [...openNow].filter((e) => !before.has(e) && eras.has(e));
      if (!fresh.length) return;
      const lines = fresh.map((e) => {
        const r = eras.get(e)![0];
        return `${e}: crack ${r.relic} for ${r.part}`;
      });
      tell("wishlist", fresh.length === 1 ? `${fresh[0]} fissure open for your wishlist` : "Fissures open for your wishlist", lines.join("\n"));
    });
  });

  // Riven alerts: every 5 minutes (one request per riven you watch, well inside warframe.market's limit), each riven you're watching for, listed at or under your price.
  let lastRivens = 0;
  $effect(() => {
    const now = tick;
    if (!settings.rivenWatch.length || now - lastRivens < 5 * 60_000) return;
    lastRivens = now;
    untrack(() => void scanRivens());
  });
  // A riven mid-cycle (TennoScope read it while you choose): which roll to keep, as a notification
  // once per cycle, and over the game on TennoScope's overlay: when a fresh read first shows it, or
  // when a read after a press of the riven key does (again, if you ask again).
  /** The cycle the overlay was last given, and when each was. */
  let overlayLatest = "";
  const overlayAt = new Map<string, number>();
  $effect(() => {
    const raws = settings.game.rivens;
    const m = model;
    const pressed = rivenKeyAt;
    if (!raws?.some((r) => r.pending) || !m) return;
    untrack(() => {
      const tables = rivenTables(m.catalogByUnique.values());
      const seen = new Set(settings.game.cyclesNotified ?? []);
      const readAt = m.observedAt ? +m.observedAt : 0;
      for (const raw of raws) {
        if (!raw.pending) continue;
        const key = cycleKey(raw);
        const first = !seen.has(key);
        if (first) settings.game.cyclesNotified = [key, ...(settings.game.cyclesNotified ?? [])].slice(0, 100);
        const c = rollChoice(m, tables, raw);
        if (!c) continue;
        // Not one read while orbiter was closed and long since settled; one read after the key, yes.
        const fresh = Date.now() - readAt < 120_000;
        const asked = pressed > 0 && readAt >= pressed - 1000 && (overlayAt.get(key) ?? 0) < pressed;
        if (settings.overlay.riven && ((first && fresh) || asked)) showCycle(key, c);
        if (first) tell("cycle", `${c.current.weapon}: ${c.verdict === "take" ? "take the new roll" : c.verdict === "keep" ? "keep the one it has" : "close call"}`, `${c.next.name} (${c.next.grade}) vs ${c.current.name} (${c.current.grade}). ${c.why}`, "rivens");
      }
    });
  });
  /** Both rolls over the game for 25 seconds; then again with the price model's estimate for each once it can say. */
  function showCycle(key: string, c: NonNullable<ReturnType<typeof rollChoice>>) {
    const shown = cycleOverlay(key, c);
    overlayLatest = key;
    overlayAt.set(key, shown.at);
    void writeRivenCycle(shown).catch(() => {});
    void (async () => {
      const meta = await rivens.loadMeta();
      await Promise.all([rivens.loadModel(), rivens.loadTrades(settings.market.platform)]);
      const weapon = meta ? searchFor(meta, c.current).weapon : null;
      if (!meta || !weapon) return;
      const any = await rivens.search(weapon, [], null).catch(() => undefined);
      const cur = estimateRiven(rivens.model, meta, rivens.trades, c.current, any);
      const next = estimateRiven(rivens.model, meta, rivens.trades, c.next, any);
      // A newer cycle on the overlay since, or this one's time up: leave it.
      if ((!cur && !next) || overlayLatest !== key || Date.now() > shown.until) return;
      await writeRivenCycle({ ...shown, current: { ...shown.current, price: cur?.mid ?? null }, next: { ...shown.next, price: next?.mid ?? null } });
    })().catch(() => {});
  }
  async function scanRivens() {
    const found: string[] = [];
    const ids: string[] = [];
    const seen = new Set(settings.game.rivensNotified);
    let failing = 0;
    for (const w of settings.rivenWatch) {
      try {
        const list = await rivens.search(w.weapon, w.positive, w.negative, 4 * 60_000);
        failing = 0;
        for (const a of list) {
          if (a.price == null || a.price > w.maxPrice || seen.has(a.id)) continue;
          // Two of your searches can find the same riven: one line for it.
          seen.add(a.id);
          ids.push(a.id);
          found.push(`${w.weaponName} ${a.name}: ${a.price}p from ${a.seller}`);
        }
      } catch {
        // warframe.market didn't answer; next round. Twice in a row: it's down, stop asking.
        if (++failing >= 2) break;
      }
    }
    if (!ids.length) return;
    settings.game.rivensNotified = [...ids, ...settings.game.rivensNotified].slice(0, 500);
    if (settings.notify.rivens) tell("rivens", found.length === 1 ? "A riven you want is listed" : `${found.length} rivens you want are listed`, found.slice(0, 6).join("\n"));
  }

  // What your relics sell for at each refinement (TennoScope's prices are mostly intact only),
  // read once a day while relic selling is on: whether one is worth more sold than cracked
  // depends on it. Checked hourly; only relics not read in the last day are fetched.
  let relicPricesChecked = 0;
  $effect(() => {
    const m = model;
    const on = settings.market.sellable.relicsWorthSelling;
    const items = mkt.items.length;
    if (!m || !on || !items || !settingsReady) return;
    untrack(() => {
      if (Date.now() - relicPricesChecked < 3_600_000) return;
      relicPricesChecked = Date.now();
      const bases = relicRows(m).map((r) => r.base);
      void mkt.readRelicPrices(bases, $state.snapshot(settings.market.relicPrices)).then((next) => {
        if (next) settings.market.relicPrices = next;
      });
    });
  });

  // While Baro is here: what a ducat is worth by his stock, kept for Prime parts' Your rates.
  $effect(() => {
    const m = model;
    if (!m || !settingsReady || !m.live.baro?.inventory?.length) return;
    const next = baroRate(m);
    untrack(() => {
      const had = settings.advice.baroRate;
      if (next && (had?.visit !== next.visit || had.rate !== next.rate)) settings.advice.baroRate = next;
    });
  });

  // The live feed watches a longer list than the scan: it costs no requests.
  $effect(() => {
    const m = model;
    const items = mkt.items.length;
    // Your price alerts: a new one is watched at once, a removed one stops.
    const alerts = $state.snapshot(settings.market.buyAlerts);
    if (!m) return;
    untrack(() => {
      if (!items) void mkt.ensureItems().catch(() => {});
      else mkt.watchLive(m, watchlist(m, 300, alerts));
    });
  });
  // An alert added or removed: scan again soon, and a removed alert's finds go now.
  let alertKey = "";
  $effect(() => {
    const key = settings.market.buyAlerts.map((a) => `${a.name}|${a.rank ?? ""}|${a.subtype ?? ""}|${a.maxPrice}`).join(",");
    untrack(() => {
      if (key === alertKey) return;
      const first = !alertKey && !key;
      alertKey = key;
      if (first) return;
      lastDeals = 0;
      const still = new Set(settings.market.buyAlerts.map((a) => a.name));
      mkt.deals = mkt.deals.filter((d) => !d.why.startsWith("your alert") || still.has(d.name));
    });
  });
  // Cheap buys: the watchlist's order books every ten minutes, while orbiter is open.
  let lastDeals = 0;
  $effect(() => {
    const now = tick;
    if (!model || onConsole || now - lastDeals < 10 * 60_000) return;
    lastDeals = now;
    const m = model;
    untrack(() => void mkt.scanDeals(m, watchlist(m, 20, settings.market.buyAlerts)));
  });
  $effect(() => {
    const deals = mkt.deals;
    if (!deals.length) return;
    untrack(() => {
      // Once per item and price: another seller at the same price isn't news, a lower price is.
      const said = (d: (typeof deals)[number]) => `${d.slug}|${d.rank ?? ""}`;
      const lowest = new Map<string, number>();
      for (const k of settings.game.dealsNotified) {
        const [item, price] = k.split("@");
        if (price && !(lowest.get(item)! <= +price)) lowest.set(item, +price);
      }
      const fresh = deals.filter((d) => !(lowest.get(said(d))! <= d.price));
      if (!fresh.length) return;
      settings.game.dealsNotified = [...fresh.map((d) => `${said(d)}@${d.price}`), ...settings.game.dealsNotified].slice(0, 300);
      if (settings.notify.deals) tell("deals", fresh.length === 1 ? `Cheap: ${fresh[0].name} for ${fresh[0].price}p` : `${fresh.length} cheap buys`, fresh.map((d) => `${d.name}: ${d.price}p from ${d.seller} (usually ${d.usual}p)`).join("\n"));
    });
  });

  // Relic runs (Stats): every reward screen, with your own relic's reward and what you held of
  // each card's item as it opened; the next inventory reads tell which card you took.
  const heldOf = (m: NonNullable<typeof model>, name: string) => m.ownedPartQty.get(name) ?? (m.inventoryByName.get(name) ?? []).reduce((n, r) => n + r.quantity, 0);
  $effect(() => {
    const c = freshCards;
    const m = model;
    const ms = mission;
    if (!c || !m || !settingsReady) return;
    untrack(() => {
      const names = c.cards.map((n) => resolveName(m, n));
      const own = (ms?.rewards_given ?? []).map((p) => resolveName(m, m.nameOf(p))).find((n) => names.includes(n)) ?? null;
      const before = Object.fromEntries([...new Set(names)].map((n) => [n, heldOf(m, n)]));
      const next = recordScreen(settings.game.relicRuns, {
        at: c.at,
        cards: names,
        relics: ms ? (ms.relics.length ? ms.relics : ms.last_relics) : [],
        mission: ms?.mission ?? null,
        own,
        before,
        baseAt: m.observedAt ? +m.observedAt : undefined,
      });
      if (next) settings.game.relicRuns = next;
    });
  });
  $effect(() => {
    const m = model;
    if (!m?.observedAt || !settingsReady) return;
    const at = +m.observedAt;
    untrack(() => {
      const next = resolvePicks(settings.game.relicRuns, (n) => heldOf(m, n), at, (n) => resolveName(m, n));
      if (next) settings.game.relicRuns = next;
    });
  });
  // Parts that turned up between inventory reads, from anything but a trade (core/drops.ts): what
  // you keep getting counts as a way to finish a set (Settings → Selling, Save prime parts for sets).
  let dropsReadAt = 0;
  $effect(() => {
    const m = model;
    if (!m?.observedAt || !settingsReady) return;
    const at = +m.observedAt;
    // Once per read; the model is also rebuilt for other reasons (prices, the world, a later foundry
    // report) with the same read, and then only a claim the report was late with is taken off.
    if (at === dropsReadAt) {
      untrack(() => {
        const next = laterClaims(settings.game.drops, dropBuilding(m), Date.now());
        if (next) settings.game.drops = next;
      });
      return;
    }
    dropsReadAt = at;
    untrack(() => {
      const since = settings.game.drops.at;
      // What you gave away in trades since the last read: a part gone that way was sold, not missed.
      const away = settings.market.trades.filter((t) => t.at > since && t.at <= at + 60_000).flatMap((t) => t.offered.map((o) => o.name));
      const next = recordRead(settings.game.drops, dropCounts(m), at, Date.now(), dropBuilding(m), away);
      if (next) settings.game.drops = next;
    });
  });
  $effect(() => {
    const log = settings.game.drops;
    const trades = settings.market.trades;
    drops.recent = recentDrops(log, trades);
  });
  // A set your loose parts were saved for, complete now (one more whole set than when it was being
  // saved for, and one you can sell): say so. Checked once per inventory read.
  let savingCheckedAt = 0;
  $effect(() => {
    const m = model;
    if (!m?.observedAt || !settingsReady) return;
    const at = +m.observedAt;
    if (at === savingCheckedAt) return;
    savingCheckedAt = at;
    untrack(() => {
      // A read the drop log took for a partial one (most parts missing, or a kind of item gone)
      // isn't compared: the full read after it would look like sets coming in.
      const log = settings.game.drops;
      if (log.lowAt === at || (log.at === at && log.gone?.length)) return;
      const index = mkt.index.byId.size ? mkt.index : null;
      const rows = new Map(allSetRows(m, index).map((r) => [r.unique, r]));
      const done: string[] = [];
      for (const [u, was] of Object.entries(settings.game.savingFor)) {
        const r = rows.get(u);
        if (r && r.completeSets > was.complete && r.sellable > 0) done.push(`${r.name} Set`);
      }
      const opts = saveForSets(settings.market.sellable, settings.advice.platPerDucat, drops.recent);
      const now = opts ? allSetSaves(m, index, opts) : new Map<string, SetSave>();
      const next: Record<string, { set: string; complete: number }> = Object.fromEntries([...now].map(([u, s]) => [u, { set: s.set, complete: rows.get(u)?.completeSets ?? 0 }]));
      // Before warframe.market's item list is in, sets that aren't prime can't be counted: kept as they were.
      if (!index) for (const [u, was] of Object.entries(settings.game.savingFor)) if (!m.partsByParent.has(u) && !(u in next)) next[u] = was;
      if (JSON.stringify(next) !== JSON.stringify(settings.game.savingFor)) settings.game.savingFor = next;
      if (done.length) tell("setDone", done.length === 1 ? `${done[0]} complete` : `${done.length} sets complete`, `${done.join(", ")}: the parts you were saving came in. Ready to sell on Sets.`, "sets");
    });
  });
  /** Screens from TennoScope's own log that orbiter didn't see live: history, and while it was closed. */
  async function importScreens() {
    try {
      const logged = await rewardScreens(settings.dataDir);
      const next = mergeLogged(settings.game.relicRuns, logged);
      if (next) settings.game.relicRuns = next;
    } catch (e) {
      console.error("reading TennoScope's reward log failed", e);
    }
  }

  // What your inventory is worth, one point per inventory read, for the value chart on Stats.
  // warframe.market's item list, the relic tables and the recipes arrive after the first model:
  // until all three are in, the read's point is worked out again as each arrives (as the wallet
  // patches it above), so Stats ends up with the figures Inventory shows for the same read.
  let pointInputs = 0;
  $effect(() => {
    const m = model;
    if (!m?.observedAt) return;
    const at = +m.observedAt;
    const inputs = (mkt.index.byId.size ? 1 : 0) + (relicTables ? 1 : 0) + (recipes ? 1 : 0);
    untrack(() => {
      const h = settings.game.valueHistory;
      const last = h.at(-1);
      if (last && last.at > at) return;
      const again = last?.at === at;
      if (again && (last.complete || inputs <= pointInputs)) return;
      pointInputs = inputs;
      // Worked out as Inventory does (core/spares.ts, inventoryValue), so the chart and its figures agree.
      const rows = inventoryRows(m);
      const ledger = new Map(spareRows(m, mkt.index, settings.market.sellable, settings.advice.platPerDucat, settings.advice.squad, drops.recent).map((x) => [x.key, x]));
      const { market: worth, easy: liquid } = inventoryValue(rows, ledger);
      const held = (u: string) => (m.inventoryByBase.get(u) ?? []).reduce((n, r) => n + r.quantity, 0);
      const relics = [...m.inventoryByBase.values()].flat().filter((r) => r.category === "relic").reduce((n, r) => n + r.quantity, 0);
      const M = "/Lotus/Types/Items/MiscItems/";
      const point = {
        at,
        worth,
        liquid,
        platinum: settings.game.platinum,
        credits: settings.game.credits,
        endo: settings.game.endo,
        held: { ducats: held(`${M}PrimeBucks`), aya: held(`${M}SchismKey`), kuva: held(`${M}Kuva`), traces: held(`${M}VoidTearDrop`), vosfor: held(`${M}DistillPoints`), essence: held(`${M}SteelEssence`), relics },
        ...(inputs === 3 ? { complete: true } : {}),
      };
      settings.game.valueHistory = again ? [...h.slice(0, -1), point] : [...h, point];
      // Every read of the last month, one a day before that: a cap of 500 reads kept only a few
      // weeks for someone whose inventory is read many times a day.
      if (!again) settings.game.valueHistory = thinHistory(settings.game.valueHistory, at);
    });
  });

  let lastTsError: string | null = null;
  $effect(() => {
    // The same trouble with a new countdown ("tries again in 4 min") isn't news.
    const e = ts.error;
    const key = e?.replace(/ orbiter tries again in \d+ min\.$/, "") ?? null;
    if (key && key !== lastTsError) logLine("warn", "tennoscope", e!);
    // Not where TennoScope can't run at all (macOS): there's nothing to fix.
    if (key && key !== lastTsError && settings.notify.tennoscope && ts.status?.supported !== false) tell("tennoscope", "TennoScope", e!);
    lastTsError = key;
  });
  // TennoScope runs in the background (orbiter starts it); its settings live in orbiter's. Not
  // for a console player: it only reads Warframe on a PC.
  $effect(() => {
    ts.path = settings.tennoscope.path;
    ts.dataDir = settings.dataDir;
    ts.launch = settings.tennoscope.launch && !onConsole;
  });
  $effect(() => {
    void tennoscopeOpaqueOverlay(settings.tennoscope.opaqueOverlay);
  });
  // Warframe's display mode: on Windows exclusive fullscreen leaves no room for TennoScope's
  // overlay. Read at start and every few minutes (you can change it in game).
  let windowMode = $state<string | null>(null);
  $effect(() => {
    const log = settings.eeLog;
    if (onConsole) return;
    const read = () => warframeWindowMode(log).then((m) => (windowMode = m));
    void read();
    const t = setInterval(read, 5 * 60_000);
    return () => clearInterval(t);
  });

  /**
   * Sync: with Warframe running and TennoScope on Full access, TennoScope is asked to read the
   * inventory from the game, and the sync lasts until that new read lands in its folder (the data
   * stamp changes), up to half a minute. Otherwise it reloads TennoScope's last saved read and the
   * live worldstate. Either way the button fills as it goes and says how it ended.
   */
  // A failed sync stays a while: its reason is under the button.
  const syncJob = new Job(undefined, 15_000);
  let syncButton = $state<{ flash: () => void } | null>(null);
  const syncMode = $derived(!onConsole && ts.report?.setup.access_mode === "full" && !!ts.report.game_running);
  /** The sync's step in words, for the button's tooltip (the button itself has a word for it). */
  let syncStep = $state<string | null>(null);
  function refreshAll() {
    // Already at it (Ctrl+R again): the button flashes rather than the key doing nothing.
    if (syncJob.working) {
      syncButton?.flash();
      return;
    }
    void syncJob.run(async (j) => {
      try {
        if (syncMode) {
          j.phase = "Asking…";
          syncStep = "Asking TennoScope to read your inventory";
          j.fraction = 0.05;
          // What's there now, so the new read is known when it lands.
          const before = await dataStamp(settings.dataDir).catch(() => stamp);
          await ts.ask("--sync");
          if (ts.error) throw new Error(ts.error);
          void refreshLive();
          j.phase = "Waiting…";
          syncStep = "Waiting for TennoScope's new read";
          j.fraction = syncFill(0);
          // Any write to TennoScope's folder changes the stamp (a reward screen, the request
          // itself), so a change is only the new read once the inventory it holds was read after
          // the ask; until then, keep waiting for the next change (2 s for the two clocks).
          const asked = Date.now();
          const deadline = asked + SYNC_LIMIT_MS;
          let seen: number | null = before;
          let reloaded = false;
          for (;;) {
            try {
              seen = await waitForNewRead(() => dataStamp(settings.dataDir), seen, { limit: Math.max(1_000, deadline - Date.now()), abort: () => ts.error, onTick: () => (j.fraction = syncFill(Date.now() - asked)) });
            } catch (e) {
              // Data did change but no read newer than the ask came: say what's there, not "Synced".
              if (reloaded && !ts.error) return bundle?.observed_at ? `Read ${fmtTime(new Date(bundle.observed_at * 1000))}` : "No new read";
              throw e;
            }
            j.phase = "Reading…";
            syncStep = "Reading the new inventory";
            await reload();
            reloaded = true;
            if (error) throw new JobError("Not read", loadProblem(error));
            if ((bundle?.observed_at ?? 0) * 1000 >= asked - 2_000) break;
            j.phase = "Waiting…";
            syncStep = "Waiting for TennoScope's new read";
          }
          j.fraction = 1;
          return "Synced";
        }
        j.phase = "Reading…";
        syncStep = "Reloading TennoScope's saved data and the live worldstate";
        // The worldstate comes on its own (21 requests, a slow site can take a while): the button
        // is about your data, and the world's cards update as it lands.
        void refreshLive();
        await Promise.all([reload(), onConsole && mkt.linked ? mkt.reload() : null]);
        if (error) throw new JobError("Not read", loadProblem(error));
        return "Up to date";
      } finally {
        syncStep = null;
      }
    });
  }

  // ---------------------------------------------------------------- keyboard, like a desktop app
  // Ctrl+1…9 pages · Ctrl+PgUp/PgDn (or Ctrl+Shift+Tab/Ctrl+Tab) the previous/next page · Ctrl+F or / filter ·
  // Ctrl+R or F5 sync · Ctrl+, settings · F1 guide · Ctrl+Q quit. Esc closes panels (they handle it).
  // As the sidebar draws them, section by section.
  const ORDER: string[] = $derived(drawnOrder(pages).filter((p) => p.id !== "guide").map((p) => p.id));
  const shortcutOf = (id: string) => {
    const i = ORDER.indexOf(id);
    return i >= 0 && i < 9 ? `Ctrl+${i + 1}` : null;
  };
  function typing(el: EventTarget | null) {
    return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
  }
  function onKey(e: KeyboardEvent) {
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    if (ctrl && e.key.toLowerCase() === "q") {
      e.preventDefault();
      quit();
      return;
    }
    // From Settings, Notifications or TennoScope's panel, F1 and Ctrl+, still go where they say.
    const sheetOpen = showSettings || showNotices || showTennoscope || showNews;
    if (sheetOpen && (e.key === "F1" || (ctrl && e.key === ","))) {
      e.preventDefault();
      showNotices = showTennoscope = showNews = false;
      showSettings = e.key !== "F1";
      if (e.key === "F1") settings.tab = "guide";
      return;
    }
    // A dialog or panel is open: it owns the keyboard (Esc closes it).
    if (document.querySelector('[aria-modal="true"]')) return;
    if (ctrl && e.key.toLowerCase() === "k" && model) {
      e.preventDefault();
      showLookup = true;
      return;
    }
    const go = (id: string) => {
      e.preventDefault();
      settings.tab = id;
      focusPage(document.activeElement);
    };
    if (ctrl && /^[1-9]$/.test(e.key) && ORDER[Number(e.key) - 1]) return go(ORDER[Number(e.key) - 1]);
    if (ctrl && (e.key === "PageDown" || e.key === "PageUp" || e.key === "Tab")) {
      const step = e.key === "PageUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      // The Guide sits after the last page: next from it is Home, previous the last page.
      const at = ORDER.indexOf(settings.tab);
      const i = at >= 0 ? at : step > 0 ? -1 : ORDER.length;
      return go(ORDER[(i + step + ORDER.length) % ORDER.length]);
    }
    if (e.key === "F1") return go("guide");
    if ((ctrl && e.key.toLowerCase() === "f") || (e.key === "/" && !typing(e.target) && !e.ctrlKey)) {
      const field = document.querySelector<HTMLInputElement>('.pane.shown input[type="search"]');
      if (field) {
        e.preventDefault();
        field.focus();
        field.select();
      }
      return;
    }
    if ((ctrl && e.key.toLowerCase() === "r") || e.key === "F5") {
      e.preventDefault();
      refreshAll();
      return;
    }
    if (ctrl && e.key === ",") {
      e.preventDefault();
      showSettings = true;
    }
  }
  /**
   * After a page switch by keyboard (or Skip to page): the focus on the page's title, so the next
   * Tab is in the page rather than back in the sidebar. A page still loading gets a moment; the
   * focus stays put if you've moved it meanwhile.
   */
  function focusPage(from: Element | null, tries = 20) {
    setTimeout(() => {
      const now = document.activeElement;
      if (now && now !== from && now !== document.body && now.getClientRects().length) return;
      const title = document.querySelector<HTMLElement>(".pane.shown h1");
      if (!title) {
        if (tries > 0) focusPage(from, tries - 1);
        else document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
        return;
      }
      if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
      title.focus({ preventScroll: true });
    }, 50);
  }
  /** No web-page menu (Back, Reload…) on right-click; text fields and selected text keep theirs. */
  function onContextMenu(e: MouseEvent) {
    if (typing(e.target) || String(window.getSelection() ?? "").length) return;
    e.preventDefault();
  }

  // Bring Current fissure forward when the reward screen opens (once per screen).
  let screenWasOpen = false;
  // The listing form prices new listings by the same rules as Auto-match.
  $effect(() => {
    mkt.rules = settings.market;
    mkt.advice = settings.advice;
  });

  $effect(() => {
    const open = !!mission?.reward_screen_open || !!freshCards;
    if (open && !screenWasOpen && settings.jumpToPick) settings.tab = "mission";
    screenWasOpen = open;
  });

  // A read that fails keeps what was loaded on screen (the pages stay as they are, with a note
  // above them), and its error stays until a read works: the note doesn't blink on each retry.
  async function reload() {
    loading = true;
    try {
      // The stamp first: if TennoScope writes while the bundle loads, the next check sees a newer
      // stamp and reloads, rather than the change being taken as already read.
      const next = await dataStamp(settings.dataDir);
      const read = await loadBundle(settings.dataDir);
      stamp = next;
      // TennoScope has started but not read the game yet: its item data, no inventory.
      const empty = read.observed_at == null && !read.inventory.length;
      if (empty && !(settings.withoutInventory || noTennoScope) && (!bundle || noInventory)) throw new Error(NO_INVENTORY_YET);
      bundle = read;
      noInventory = empty;
      loadedAt = Date.now();
      error = null;
    } catch (e) {
      // Nothing to read yet, and you'd rather carry on (or TennoScope can't run here): an empty
      // collection until it can. The stamp poll reloads once TennoScope writes its data.
      if (nothingYet(String(e)) && (settings.withoutInventory || noTennoScope) && (!bundle || noInventory)) {
        bundle = emptyBundle();
        noInventory = true;
        error = null;
      } else error = String(e);
    } finally {
      loading = false;
    }
  }
  /** Carry on without an inventory until TennoScope reads one (remembered). */
  function withoutInventory() {
    settings.withoutInventory = true;
    void reload();
  }
  /** What went wrong reading TennoScope's data, in words (the error itself is under Details). */
  function loadProblem(e: string) {
    if (/HOME is not set/.test(e)) return "orbiter can't tell where TennoScope keeps its data: set the folder in Settings.";
    if (/not found at|No dev bundle/i.test(e)) return `There's no TennoScope data in ${settings.dataDir || defaultDir || "its folder"} yet.`;
    if (/parse|database|could not read/i.test(e)) return "TennoScope's data is there but couldn't be read. TennoScope may have been writing it just then.";
    return "orbiter couldn't read TennoScope's data.";
  }
  const hhmm = (at: number | null) => (at == null ? "?" : new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));

  async function refreshLive() {
    liveError = null;
    try {
      // A part this read couldn't get keeps what was read before (Baro's visit, the cycles, which
      // count on from there), rather than going blank because another part could be read.
      live = mergeLive(live, await loadLive());
      liveAt = Date.now();
      liveRead = true;
      // Kept for the next start, which shows it at once (what has ended taken out) until it reads.
      void saved.write("worldstate", { at: liveAt, live }).catch(() => {});
    } catch {
      // Unreachable: what was read last stays (timers count down from it); the next read in 5 minutes.
      liveError = "api.warframestat.us didn't answer";
    }
  }
  /** Try again after a failed read: TennoScope's data and the worldstate. */
  function retry() {
    reload();
    refreshLive();
  }

  onMount(() => {
    let poll: ReturnType<typeof setInterval>;
    let livePoll: ReturnType<typeof setInterval>;
    let tablesPoll: ReturnType<typeof setInterval>;
    let screensPoll: ReturnType<typeof setInterval>;
    let missionPoll: ReturnType<typeof setInterval>;
    let marketPoll: ReturnType<typeof setInterval>;
    let lastOrders = Date.now();
    let accountPoll: ReturnType<typeof setInterval>;
    let cardsPoll: ReturnType<typeof setInterval>;
    let tsPoll: ReturnType<typeof setInterval>;
    let statusPoll: ReturnType<typeof setInterval>;
    /** warframe.market reads of your listings that failed in a row (the 30 s timer backs off). */
    let orderFailures = 0;
    // Gone before starting finished (a hot reload in development): don't start timers nobody clears.
    let stopped = false;
    // The window's X saves and quits like Ctrl+Q. First, so a close during startup is answered too.
    const closeListener = quitOnWindowClose();
    // warframe.market's live feed of new orders: cheap buys the moment they're listed.
    const orderListener = onMarketOrder((o) => mkt.feedOrder(o));
    // A desktop notification clicked: open what it's about (the window is brought up already).
    const noticeListener = onNoticeOpen((id) => openNotice(id));
    let feedPoll: ReturnType<typeof setInterval> | undefined;
    market
      .feed(true)
      .then((s) => {
          mkt.feed = s;
        })
      .catch(() => {});
    feedPoll = setInterval(() => {
      market
        .feedState()
        .then((s) => {
          mkt.feed = s;
        })
        .catch(() => {});
    }, 30_000);
    // The worldstate as last read, at once, until the first read comes in (see restoreLive).
    void saved.read("worldstate").then((raw) => {
      const kept = restoreLive(raw);
      if (kept && liveAt == null) {
        live = kept.live;
        liveAt = kept.at;
      }
    });
    (async () => {
      settings = await loadSettings();
      if (stopped) return;
      settings.tab = migrateTab(settings.startPage !== "last" ? settings.startPage : settings.tab);
      settingsReady = true;
      logLine("info", "app", `build ${BUILD.commit}${BUILD.date ? ` (${BUILD.date})` : ""}, ${settings.market.platform}${onConsole ? " (console)" : ""}`);
      // Before reading its data: a fresh TennoScope re-reads the inventory once the game is up.
      ts.path = settings.tennoscope.path;
      ts.dataDir = settings.dataDir;
      ts.launch = settings.tennoscope.launch && settings.market.platform === "pc";
      // Before it starts: how TennoScope draws its overlay is set when it launches.
      await tennoscopeOpaqueOverlay(settings.tennoscope.opaqueOverlay);
      // Awaited: whether TennoScope runs here at all decides what an empty folder means.
      await ts.check(true);
      // Every 15 s: if it stopped (crashed, or you quit it), start it again in the background.
      tsPoll = setInterval(() => ts.check(true), 15_000);
      defaultDir = await defaultDataDir();
      await reload();
      if (stopped) return;
      refreshLive();
      importScreens();
      // TennoScope re-reads the inventory when the game starts and on its own schedule; follow it.
      poll = setInterval(async () => {
        try {
          const s = await dataStamp(settings.dataDir);
          if (s && s !== stamp) reload();
        } catch {
          /* folder briefly missing during a write */
        }
      }, 20_000);
      livePoll = setInterval(refreshLive, 5 * 60_000);
      // The drop tables' relics: now, then every few hours (the cache says when to read them again).
      const tables = () => relicData().then((d) => { if (d) relicTables = d; });
      void tables();
      tablesPoll = setInterval(() => {
        void tables();
        void recipeData().then((r) => { if (r) recipes = r; });
      }, 3 * 3_600_000);
      void recipeData().then((r) => { if (r) recipes = r; });
      // TennoScope's log, for screens orbiter missed (a reading it didn't pass on, or a restart).
      screensPoll = setInterval(importScreens, 10 * 60_000);
      // EE.log is followed incrementally, so a short interval only reads what the game appended.
      pollMission();
      missionPoll = setInterval(pollMission, 2_000);
      // A tiny file, read often: the reward screen gives you 15 s to choose.
      cardsPoll = setInterval(pollCards, 800);
      // warframe.market: sign-in state, your orders, and the auto-match timer.
      // Your warframe.market status: held again from where you left it (see Orders).
      mkt.init().then(() => {
        // Signed in: your account says which platform you play on.
        const theirs = mkt.me?.platform;
        if (theirs && theirs in PLATFORM_LABEL && theirs !== settings.market.platform) {
          settings.market.platform = theirs as Platform;
          settings.market.relicPrices = {};
        }
        if (mkt.linked && settings.market.presence) mkt.setStatus(mkt.presenceFor(settings.market.presence));
      });
      mkt.pollStatus();
      statusPoll = setInterval(() => mkt.pollStatus(), 3_000);
      marketPoll = setInterval(() => {
        if (stopped) return;
        const s = settings.market;
        // Your listings as warframe.market has them, every 30 s (every 2 minutes while orbiter's
        // window is hidden): changes made on the website (or a sale marked there) show up here
        // without a reload. While warframe.market doesn't answer, each wait is twice the last.
        const every = backoff(document.hidden ? 120_000 : 30_000, orderFailures, 10 * 60_000);
        if (mkt.linked && !mkt.busy && Date.now() - lastOrders > every - 1000) {
          lastOrders = Date.now();
          mkt.refresh().then(
            () => (orderFailures = 0),
            () => orderFailures++,
          );
        }
        // Check (and, with Apply automatically, send) on your timer.
        if (!model || !(s.auto || s.autoCheck) || !mkt.linked || mkt.busy) return;
        if (mkt.lastPass && Date.now() - mkt.lastPass < mkt.passDelay(s.every * 60_000)) return;
        mkt.reprice(model, s, s.auto, true);
      }, 15_000);
      // Signed in but warframe.market was unreachable (offline start, outage): try again each minute.
      // And the website's chat, each minute while signed in.
      accountPoll = setInterval(() => {
        mkt.retryIfDisconnected();
        void mkt.readChats();
      }, 60_000);
      void mkt.readChats();
    })();
    return () => {
      stopped = true;
      closeListener.then((stop) => stop());
      orderListener.then((stop) => stop());
      noticeListener.then((stop) => stop());
      clearInterval(feedPoll);
      clearInterval(poll);
      clearInterval(livePoll);
      clearInterval(tablesPoll);
      clearInterval(screensPoll);
      clearInterval(missionPoll);
      clearInterval(marketPoll);
      clearInterval(accountPoll);
      clearInterval(cardsPoll);
      clearInterval(tsPoll);
      clearInterval(statusPoll);
    };
  });

  // Saved on every change (300 ms after the last), each long log re-read only when it changed.
  persistSettings(
    () => settings,
    () => settingsReady,
  );

  const fmtTime = (d: Date | null) =>
    d ? d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "unknown";

  /** How long ago, as of `now` (pass `tick`, so it ages while on screen). */
  const ago = (d: Date | null, now: number) => {
    if (!d) return "never";
    const m = Math.floor((now - d.getTime()) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 30 * 1440 ? `${Math.round(m / 1440)} d ago` : fmtTime(d);
  };
  /** One word for the TennoScope button: fine, something to look at, or not running. */
  const tsTone = $derived.by(() => {
    if (!ts.status) return "off";
    if (!ts.running) return "bad";
    const r = ts.report;
    if (!r) return "warn";
    if (Object.values(r.health).some((h) => h.state === "failed")) return "bad";
    // A request from orbiter (a sync, a status change) failed in the last minute: the panel says why.
    if (r.last_error && Date.now() - r.last_error.at < 60_000) return "warn";
    if (r.setup.desktop_capture_action_available || !r.setup.access_mode) return "warn";
    return "ok";
  });
  // The page list scrolls on a short window: a fade at its foot says there's more below, and at
  // its head that there's more above.
  let navEl = $state<HTMLElement | null>(null);
  let navMore = $state(false);
  let navAbove = $state(false);
  // The page you're on stays in view, clear of the fades at either end.
  $effect(() => {
    const tab = settings.tab;
    const n = navEl;
    if (!n) return;
    // By hand: scrollIntoView would also move where the next Tab starts, past Skip to page.
    queueMicrotask(() => {
      const on = n.querySelector<HTMLElement>(".nav.on")?.getBoundingClientRect();
      const box = n.getBoundingClientRect();
      const css = getComputedStyle(n);
      const top = box.top + (parseFloat(css.scrollPaddingTop) || 0);
      const bottom = box.bottom - (parseFloat(css.scrollPaddingBottom) || 0);
      if (on && on.top < top) n.scrollTop -= top - on.top;
      else if (on && on.bottom > bottom) n.scrollTop += on.bottom - bottom;
    });
    void tab;
  });
  const checkNav = () => {
    const n = navEl;
    navMore = !!n && n.scrollTop + n.clientHeight < n.scrollHeight - 4;
    navAbove = !!n && n.scrollTop > 4;
  };
  $effect(() => {
    const n = navEl;
    if (!n) return;
    const ro = new ResizeObserver(checkNav);
    ro.observe(n);
    checkNav();
    return () => ro.disconnect();
  });
  const resurgenceCount = $derived(model ? [...model.relicGroups.values()].filter((g) => g.resurgence).length : 0);
</script>

<svelte:window onkeydown={onKey} oncontextmenu={onContextMenu} bind:innerWidth={width} />

<!-- Keyboard: the first Tab offers to jump past the sidebar to the page. -->
<a class="skip" href="#main" title="Jump past the sidebar to this page's title" onclick={(e) => { e.preventDefault(); focusPage(document.activeElement, 0); }}>Skip to page</a>
<div class="shell" class:compact class:withside={sideShown}>
  <aside class="rail" aria-label="orbiter">
    <div class="brand">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <g transform="rotate(-20 16 16)" fill="none" stroke="var(--gold)" stroke-width="2"><path d="M3.5 16a12.5 5 0 0 1 25 0" /></g>
        <circle cx="16" cy="16" r="5.2" fill="var(--platinum)" />
        <g transform="rotate(-20 16 16)" fill="none"><path d="M28.5 16a12.5 5 0 0 1-25 0" stroke="var(--slab)" stroke-width="3.6" /><path d="M28.5 16a12.5 5 0 0 1-25 0" stroke="var(--gold)" stroke-width="2" /></g>
        <rect x="23.6" y="6.4" width="4" height="4" transform="rotate(45 25.6 8.4)" fill="var(--gold)" stroke="var(--slab)" stroke-width="1" />
      </svg>
      <span class="brand-name">Orbiter</span>
      <button class="fold" aria-label={compact ? "Show labels" : "Icons only"} title={compact ? "Show the page names" : "Icons only"} onclick={() => (settings.folded = !compact)}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d={compact ? "M6 3l5 5-5 5" : "M10 3 5 8l5 5"} fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </div>

    {#snippet navItem(p: Page)}
      <button class="nav" class:on={settings.tab === p.id} data-section={p.group || undefined} title={shortcutOf(p.id) ? `${p.label}: ${p.hint} (${shortcutOf(p.id)})` : `${p.label}: ${p.hint}`} aria-current={settings.tab === p.id ? "page" : undefined} onclick={() => (settings.tab = p.id)}>
        <span class="ic">{#if "game" in p.icon}<GameIcon name={p.icon.game} size={20} />{:else}<Icon name={p.icon.line} size={18} stroke={1.5} />{/if}</span>
        <span class="lbl">{p.label}</span>
        {#if p.id === "mission" && inFissure(mission, tick)}<span class="live" title="Fissure in progress"></span>{/if}
        {#if p.id === "market" && shortListings.length}<span class="badge" title="Listings for more than you hold: sold, or used in game">{shortListings.length}</span>{/if}
        {#if p.id === "market" && settings.market.auto && mkt.linked && !shortListings.length}<span class="live dim" title="Apply automatically is on: your listings follow the cheapest in-game price"></span>{/if}
      </button>
    {/snippet}

    <nav aria-label="Pages" data-card="sections" bind:this={navEl} onscroll={checkNav} class:more={navMore} class:above={navAbove}>
      {@render navItem(pages[0])}
      {#each sections as sec (sec)}
        <div class="sec register" data-section={sec} title={compact ? sec : undefined}>{sec}</div>
        {#each pages.filter((p) => p.group === sec) as p (p.id)}{@render navItem(p)}{/each}
      {/each}
    </nav>

    <div class="foot">
      {#if !onConsole}<div class="game" title={[mission?.mission ?? (mission ? "Watching Warframe's log" : "No game log found"), model ? `Inventory read ${model.observedAt ? fmtTime(model.observedAt) : "never"}` : null].filter(Boolean).join(" · ")}>
        <span class="pill" class:live={inFissure(mission, tick)} class:idle={!mission}><i></i></span>
        <span class="lbl"><strong>{inFissure(mission, tick) ? "In a fissure" : model ? `Synced ${ago(model.observedAt, tick)}` : mission ? "Reading the log" : "Idle"}</strong><small>{inFissure(mission, tick) ? (mission?.mission ?? "") : mission ? "Warframe's log: found" : "No game log found"}</small></span>
      </div>{/if}
      <div class="syncrow">
      <ProgressButton bind:this={syncButton} class="sync" job={syncJob} busy={loading && !bundle} icon="refresh" spin label="Sync" working={syncJob.phase ?? "Reading…"} failLabel={syncJob.short ?? "Not synced"} sizer={["Waiting…", "Up to date", "Not synced"]}
        title={`${syncStep ? `${syncStep}…\n\n` : ""}${onConsole ? "Reload your warframe.market listings, the fissures and Baro" : syncMode ? "Sync: ask TennoScope to read your inventory from the game now, and wait for the new read" : "Sync: reload TennoScope's last saved read and the live fissures. With Warframe running and TennoScope on Full access, it asks TennoScope for a fresh read from the game instead"} (Ctrl+R)`}
        onclick={refreshAll} />
        {#if model && !onConsole}<button class="tool" aria-label="Find anything" aria-expanded={showLookup} title="Find anything by name: an item, a prime part, a relic, a mod or arcane you hold (Ctrl+K)" onclick={() => (showLookup = true)}><Icon name="search" size={14} /></button>{/if}
        <button class="tool bell" class:paused={pausedNow} aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} aria-expanded={showNotices} title={pausedNow ? `Notifications (paused${unread ? `, ${unread} new` : ""}): what orbiter told you, and what it tells you about` : unread ? `Notifications: ${unread} new` : "Notifications: what orbiter told you, and what it tells you about"} onclick={() => openNotices("recent")}><Icon name="bell" size={14} />{#if unread}<span class="count">{unread > 99 ? "99+" : unread}</span>{/if}</button>
      </div>
      {#if syncJob.state === "failed" && syncJob.error}<p class="syncerr" role="status">{syncJob.error}</p>{/if}
      <div class="tools">
        {#if ts.status && !noTennoScope}
          <button class="tool tsbtn tone-{tsTone}" aria-label="TennoScope" title={tsTone === "ok" ? "TennoScope: status, inventory sync, screen capture" : tsTone === "bad" ? "TennoScope: not running, or something failed. Open for details" : "TennoScope: something needs a look. Open for details"} onclick={() => (showTennoscope = true)}>
            <i></i><span class="lbl">TennoScope</span>
          </button>
        {/if}
        <button class="tool" class:on={settings.tab === "guide"} aria-label="Guide" title="How to use orbiter (F1)" onclick={() => (settings.tab = "guide")}><Icon name="guide" size={14} /></button>
        <button class="tool" aria-label="Settings" aria-expanded={showSettings} title="Settings (Ctrl+,)" onclick={() => (showSettings = true)}><Icon name="settings" size={14} /></button>
      </div>
    </div>
  </aside>

  <main id="main" tabindex="-1" aria-busy={loading && !bundle} use:room class:touring={!!tourStop()}>
    <!-- The first read of TennoScope's data, before there's anything to show. Everything after
         that (a sync, a warframe.market change, the background re-read when TennoScope writes)
         shows its progress in the button that started it, not up here. -->
    {#if loading && !bundle}<div class="progress" role="progressbar" aria-label="Reading TennoScope's data"></div>{/if}
    {#if !model && error && nothingYet(error)}
      <!-- First start: nothing read yet. What TennoScope needs, step by step. -->
      <div class="page-inner"><div class="notice">
        <h2 class="mark">Getting set up</h2>
        {#if noTennoScope}
          <p class="prose">orbiter learns what you own from TennoScope, which reads it from the game. {onConsole ? `TennoScope only reads Warframe on a PC, and you play on ${PLATFORM_LABEL[settings.market.platform]}` : "TennoScope doesn't run on macOS"}, so orbiter can't see your inventory here. Your warframe.market listings and sales, fissures, Baro and Varzia, the world's clocks and the riven finder all work without it.</p>
          <div class="row"><button class="stamp gold" onclick={withoutInventory}>Continue without inventory</button></div>
        {:else}
          <p class="prose">orbiter learns what you own from TennoScope, which {ts.status?.bundled ? "comes inside orbiter and " : ""}reads it from the game. Three steps, once:</p>
          <ol class="steps">
            <li class:done={setupStep > 1} class:now={setupStep === 1}>
              <strong>TennoScope runs</strong>
              <span class="prose">
                {#if ts.running && ts.unpatched}It's running, but it's a TennoScope that doesn't talk to orbiter. Close it, and orbiter starts its own.
                {:else if ts.running}Running in the background{ts.status?.bundled ? ": the copy inside orbiter" : ""}. orbiter closes it when you close orbiter.
                {:else if ts.status?.binary}Starting it…
                {:else}orbiter couldn't find TennoScope. Set its program in Settings.{/if}
              </span>
              {#if ts.error}<span class="err small">{ts.error}</span>{/if}
            </li>
            <li class:done={setupStep > 2} class:now={setupStep === 2}>
              <strong>Let it read your account</strong>
              <span class="prose">Its window asks once what it may read. Choose <b>Full</b>: it then reads your inventory from the running game. Its window explains how, and the small risk that carries for your account.</span>
              {#if setupStep === 2}<div><button class="stamp gold" onclick={() => ts.show()}>Open TennoScope</button></div>{/if}
              {#if ts.report?.setup.access_mode && ts.report.setup.access_mode !== "full"}<span class="dim small">You chose {ts.report.setup.access_mode === "overlay" ? "Overlay" : "Companion"}: it won't read your inventory. Open TennoScope again to change it.</span>{/if}
            </li>
            <li class:now={setupStep === 3}>
              <strong>Start Warframe and log in</strong>
              <span class="prose">{ts.report?.game_running ? "Warframe is running: TennoScope reads your inventory in a moment, and this page turns into your collection by itself." : "TennoScope reads your inventory once you're in the game, and this page turns into your collection by itself."}</span>
              {#if ptraceScope}
                <span class="prose small">This system only lets a program read another one's memory if it started it, and TennoScope doesn't start Warframe. To allow it until you restart, run this in a terminal (it asks for your password):</span>
                <code class="cmd">sudo sysctl kernel.yama.ptrace_scope=0</code>
              {:else if ts.report?.game_running && (ts.report.health.game_reader.state === "failed" || ts.report.health.game_reader.state === "degraded")}
                <span class="err small">TennoScope: {ts.report.health.game_reader.message}</span>
              {/if}
            </li>
          </ol>
          <div class="row">
            <button onclick={withoutInventory}>Use orbiter without inventory for now</button>
            <button onclick={() => (showSettings = true)}>Settings</button>
          </div>
        {/if}
      </div></div>
    {:else if !model && built.error}
      <div class="page-inner"><div class="notice" role="alert">
        <h2 class="mark">Can't make sense of TennoScope's data</h2>
        <p class="prose">TennoScope's last read has something orbiter can't use. It may have been writing it just then: try again, or sync once Warframe is running. The log has the details.</p>
        <details class="why"><summary>Details</summary><code>{built.error}</code></details>
        <div class="row">
          <button class="stamp" onclick={() => (showTennoscope = true)}>TennoScope panel</button>
          <button onclick={retry} disabled={loading} title="Read TennoScope's data again">{loading ? "Trying…" : "Try again"}</button>
        </div>
      </div></div>
    {:else if !model && error}
      <div class="page-inner"><div class="notice">
        <h2 class="mark">Can't read TennoScope's data</h2>
        <p class="prose">{loadProblem(error)}</p>
        <p class="prose">TennoScope needs to have read your inventory at least once. orbiter starts it in the background; start Warframe and it reads your account when the game is up, and orbiter picks the data up by itself as soon as TennoScope writes it. If it doesn't, the TennoScope panel says why. If its data lives somewhere else, set the folder in Settings.</p>
        <details class="why"><summary>Details</summary><code>{error}</code></details>
        <div class="row">
          <button class="stamp" onclick={() => (showTennoscope = true)}>TennoScope panel</button>
          <button onclick={() => (showSettings = true)}>Settings</button>
          <button onclick={retry} disabled={loading}>{loading ? "Trying…" : "Try again"}</button>
        </div>
      </div></div>
    {:else if !model}
      <div class="page-inner"><div class="notice"><span class="register">Reading your collection…</span></div></div>
    {:else}
      {#if noInventory && !onConsole}
        <div class="stale" role="status">
          <span>{onConsole ? `No inventory: TennoScope only reads Warframe on a PC, and you play on ${PLATFORM_LABEL[settings.market.platform]}. Listings, prices and sales use the ${PLATFORM_LABEL[settings.market.platform]} market.` : tsUnsupported ? "No inventory: TennoScope, which reads it from the game, doesn't run on macOS." : "No inventory yet: your collection fills in as soon as TennoScope reads it from the game."}</span>
          {#if !noTennoScope}<button class="link" onclick={() => (showTennoscope = true)}>Set up</button>{/if}
        </div>
      {/if}
      {#if saveError}
        <div class="stale" role="alert" title={saveError}>
          <span>Couldn't save your settings ({saveError}): what you change now may not be kept. orbiter keeps trying.</span>
        </div>
      {/if}
      {#if error}
        <div class="stale" role="alert" title={`${loadProblem(error)}\n${error}`}>
          <span>Couldn't re-read TennoScope's data: showing what was loaded at {hhmm(loadedAt)}.</span>
          <button class="link" onclick={retry} disabled={loading}>{loading ? "Trying…" : "Try again"}</button>
        </div>
      {/if}
      {#if pricesOld != null && model.priceDate !== pricesOldDismissed}
        <!-- Short: a warning on every page that reads like a paragraph teaches you to skip warnings. -->
        <div class="stale slim" role="status" title="Item prices on every page (prime parts, sets, mods, relics…) come from warframe.market's daily figures for {new Date(`${model.priceDate}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, which TennoScope downloads when it starts: starting TennoScope again gets newer ones">
          <span><b>Prices {pricesOld === 1 ? "a day" : `${pricesOld} days`} old</b> <span class="dim">· TennoScope updates them when it starts</span></span>
          <IconButton icon="close" tone="quiet" label="Dismiss" onclick={() => (pricesOldDismissed = model?.priceDate ?? null)} />
        </div>
      {/if}
      {#if chatsDue.length}
        <div class="stale repdue" role="status">
          <span>{chatsDue.length === 1 ? `${chatsDue[0].with} messaged you on warframe.market` : `${chatsDue.length} unread chats on warframe.market`}{#if chatsDue.length === 1 && chatsDue[0].lastMessage}: <i class="msg">“{chatsDue[0].lastMessage.slice(0, 120)}”</i>{/if}</span>
          <IconButton icon="external" tone="quiet" label="Open warframe.market" onclick={() => openUrl("https://warframe.market/")} />
          <IconButton icon="close" tone="quiet" label="Dismiss" onclick={chatsRead} />
        </div>
      {/if}
      {#if repDue}
        <div class="stale repdue" role="status">
          <span>Traded with <b>{repDue.t.partner}</b>, who's on warframe.market ({repDue.u.reputation} reputation).</span>
          <RepButton partner={repDue.t.partner} text={settings.market.repText} ongiven={() => markRep(repDue.t.key, "given")} />
          <IconButton icon="close" tone="quiet" label="Not now" title="Not now: no +rep for this trade" onclick={() => markRep(repDue.t.key, "skipped")} />
        </div>
      {/if}
      <!-- A page that throws says so, with Try again, instead of staying blank or loading for good.
           Pages loaded on first visit get their own boundary inside {:then}: one around the
           {#await} doesn't catch what throws once it has resolved. -->
      {#snippet pageFailed(_e: unknown, reset: () => void)}<div class="page-inner"><p class="pagefail dim" role="alert">This page hit an error · <button class="link" title="Draw the page again (the log has what went wrong)" onclick={reset}>Try again</button></p></div>{/snippet}
      {#snippet pane(id: string, body: import("svelte").Snippet)}
        {#if visited[id] && available.some((p) => p.id === id)}<div class="pane" class:shown={settings.tab === id} data-section={pageById[id as PageId]?.group || undefined}><svelte:boundary failed={pageFailed} onerror={(e) => pageError(id, e)}>{@render body()}</svelte:boundary></div>{/if}
      {/snippet}
      {#snippet pMission()}<InMission {model} masteryRank={settings.game.masteryRank} state={mission} error={missionError} cards={freshCards} bind:weights={settings.pick} {windowMode} tennoscopeRunning={!!ts.status?.running} onsettings={() => (showSettings = true)} />{/snippet}
      {#snippet pSets()}{#await loadSets(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("sets", e)}><Page {model} advice={settings.advice} sell={settings.market.sellable} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pParts()}<Parts {model} bind:advice={settings.advice} sell={settings.market.sellable} />{/snippet}
      {#snippet pMastery()}{#await loadMastery(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("mastery", e)}><Page {model} masteryRank={settings.game.masteryRank} bind:wishlist={settings.favourites} foundryReady={settings.game.foundryReady} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pArcanes()}{#await loadArcanes(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("arcanes", e)}><Page {model} bind:advice={settings.advice} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pMods()}{#await loadMods(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("mods", e)}><Page {model} masteryRank={settings.game.masteryRank} minPlat={settings.advice.minPlat} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pRelics()}<Relics {model} bind:advice={settings.advice} wishlist={settings.favourites} masteryRank={settings.game.masteryRank} />{/snippet}
      {#snippet pPlanner()}{#await loadPlanner(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("planner", e)}><Page {model} bind:settings={settings.advice} bind:mode={settings.plannerMode} fissures={live.fissures} wishlist={settings.favourites} masteryRank={settings.game.masteryRank} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pHome()}<Home {model} {live} {mission} console={onConsole} reveal={homeReveal} bind:settings={settings} go={(t: string) => goTo(t)} {shortListings} {liveAt} {liveError} {liveRead} bountyTables={relicTables?.bounties ?? null} sortieRewards={relicTables?.sortie ?? null} />{/snippet}
      {#snippet pSales()}{#await loadSales(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("sales", e)}><Page {model} bind:settings={settings} go={(t: string) => (settings.tab = t)} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pMarket()}<Orders {model} console={onConsole} whispers={mission?.whispers ?? []} bind:settings={settings.market} advice={settings.advice} masteryRank={settings.game.masteryRank} credits={settings.game.credits} />{/snippet}
      {#snippet pGuide()}{#await loadGuide(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("guide", e)}><Page console={onConsole} platform={PLATFORM_LABEL[settings.market.platform]} go={(t: string) => goTo(t)} bind:plannerMode={settings.plannerMode} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pFoundry()}<Foundry {model} bind:settings={settings} />{/snippet}
      {#snippet pInventory()}<Inventory {model} sell={settings.market.sellable} platPerDucat={settings.advice.platPerDucat} squad={settings.advice.squad} gear={settings.game.gear} bind:keepGear={settings.game.keepGear} />{/snippet}
      {#snippet pBrowse()}{#await loadMarket(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("browse", e)}><Page {model} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pWishlist()}{#await loadWishlist(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("wishlist", e)}><Page {model} bind:settings={settings} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      <!-- Rivens is the slowest page to load the first time: its heading shows at once, not a bare Loading…. -->
      {#snippet pRivens()}{#await loadRivens(lazyTry)}<div class="page"><div class="page-inner"><PageHead title="Rivens" brief={onConsole ? "Rivens for sale, graded, and alerts." : "Your rivens graded, and what they sell for."} /><p class="lazyload register" role="status">Loading your rivens…</p></div></div>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("rivens", e)}><Page {model} console={onConsole} bind:settings={settings} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {#snippet pStats()}{#await loadStats(lazyTry)}<p class="lazyload register" role="status">Loading…</p>{:then { default: Page }}<svelte:boundary failed={pageFailed} onerror={(e) => pageError("stats", e)}><Page {model} {settings} /></svelte:boundary>{:catch}<p class="lazyfail dim">This page didn\'t load. <button class="link" onclick={() => lazyTry++}>Try again</button></p>{/await}{/snippet}
      {@render pane("mission", pMission)}
      {@render pane("sets", pSets)}
      {@render pane("parts", pParts)}
      {@render pane("mastery", pMastery)}
      {@render pane("arcanes", pArcanes)}
      {@render pane("mods", pMods)}
      {@render pane("relics", pRelics)}
      {@render pane("planner", pPlanner)}
      {@render pane("home", pHome)}
      {@render pane("sales", pSales)}
      {@render pane("market", pMarket)}
      {@render pane("guide", pGuide)}
      {@render pane("inventory", pInventory)}
      {@render pane("foundry", pFoundry)}
      {@render pane("stats", pStats)}
      {@render pane("rivens", pRivens)}
      {@render pane("wishlist", pWishlist)}
      {@render pane("browse", pBrowse)}
      <ListDialog {model} market={settings.market} advice={onConsole ? null : settings.advice} go={(t: string) => (settings.tab = t)} />
      <BuyDialog {model} go={(t: string) => (settings.tab = t)} onalert={(a) => { settings.market.buyAlerts = [a, ...settings.market.buyAlerts.filter((x) => x.name !== a.name || x.rank !== a.rank || (x.subtype ?? null) !== (a.subtype ?? null))].slice(0, 40); lastDeals = 0; }} />
      <ItemDetails {model} bind:settings={settings} />
      {#if !onConsole}<Lookup bind:open={showLookup} {model} go={(t: string) => (settings.tab = t)} />{/if}
      <HoverCard {model} platPerDucat={settings.advice.platPerDucat} squad={settings.advice.squad > 1 ? 4 : 1} />
    {/if}
    <TourBar go={(t: string) => goTo(t)} />
  </main>
  {#if sideShown && model}
    <SideWatch {model} {live} bind:settings console={onConsole} bountyTables={relicTables?.bounties ?? null} go={(t: string) => goTo(t)} {shortListings} {liveError} />
  {:else if wideEnough && model && !settings.side.on}
    <button class="sidetab" title="Show the Watching column: fissures, alerts, clocks and more beside every page" onclick={() => (settings.side.on = true)}>«</button>
  {/if}
</div>

<NoticesSheet bind:open={showNotices} bind:view={noticesView} bind:settings console={onConsole} open_={openNotice} test={testNotice} />
<Toasts open={openNotice} left={compact ? "5.2rem" : "15.3rem"} />
<WhatsNew bind:open={showNews} seen={settings.newsSeen} ondone={() => (settings.newsSeen = NEWEST)} go={(t: string) => goTo(t)} />
<SettingsSheet bind:open={showSettings} bind:settings {rivenKeyError} onnotices={() => openNotices("choose")} {defaultDir} eeFound={mission?.path ?? null} onpaths={() => { reload(); pollMission(); ts.check(true); }} />
<TennoscopeSheet bind:open={showTennoscope} synced={model ? ago(model.observedAt, tick) : "not yet"} job={syncJob} onsync={refreshAll} {windowMode} bind:opaqueOverlay={settings.tennoscope.opaqueOverlay} />

<style>
  /* The frame: a sidebar of pages, and the page. minmax(0, 1fr): a wide table never stretches the window. */
  .shell { display: grid; grid-template-columns: 14.5rem minmax(0, 1fr); height: 100vh; }
  .shell.compact { grid-template-columns: 4.4rem minmax(0, 1fr); }
  .shell.withside { grid-template-columns: 14.5rem minmax(0, 1fr) 17.5rem; }
  .shell.compact.withside { grid-template-columns: 4.4rem minmax(0, 1fr) 17.5rem; }
  .sidetab { position: fixed; right: 0; top: 50%; z-index: 6; width: 18px; height: 64px; padding: 0; border: 1px solid var(--rule); border-right: 0; background: var(--plate); color: var(--platinum-deep); }
  .sidetab:hover { color: var(--gold); }
  .pane { display: none; flex: 1; min-height: 0; min-width: 0; flex-direction: column; }
  .pane.shown { display: flex; }
  /* The tour's bar on the page's bottom edge: room under the page to scroll past it. */
  main.touring :global(.page-inner) { padding-bottom: 7rem; }
  main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; outline: none; }
  /* Out of sight until the keyboard lands on it. */
  .skip { position: fixed; z-index: 80; top: .5rem; left: .5rem; padding: .55rem .9rem; background: var(--plate); color: var(--platinum); border: 1px solid var(--gold); font-size: .85rem; transform: translateY(calc(-100% - 1rem)); }
  .skip:focus { transform: none; }
  /* A page's title takes the focus after a keyboard page switch: no ring on it (Home's too). */
  .pane :global(h1:focus) { outline: none; }
  .progress { position: absolute; top: 0; left: 0; right: 0; height: 2px; z-index: 5; overflow: hidden; pointer-events: none; background: rgb(214 174 74 / 12%); }
  .progress::after { content: ""; position: absolute; top: 0; bottom: 0; width: 30%; background: linear-gradient(90deg, transparent, var(--gold), transparent); animation: sweep 1.1s ease-in-out infinite; }
  @keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
  /* A page still loading its code: one quiet line where it will be. */
  .lazyload { margin: 0; padding: 3rem 1rem; text-align: center; }
  /* A page that threw: the same quiet line, with Try again. */
  .pagefail { margin: 0; padding: 3rem 1rem; text-align: center; }

  /* ---- sidebar: a dark struck plate, gold hairline on its edge */
  .rail {
    display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    background: linear-gradient(180deg, #0d0f12, #090a0c); border-right: 1px solid var(--rule);
    box-shadow: inset -1px 0 0 rgb(214 174 74 / 12%);
  }
  .brand { display: flex; align-items: center; gap: .6rem; padding: .95rem 1rem .8rem 1.1rem; border-bottom: 1px solid var(--rule); }
  .brand-name { font-family: var(--face-mark); font-weight: 700; font-size: 1.3rem; letter-spacing: .03em; text-transform: uppercase; }
  .fold { margin-left: auto; padding: .35rem; line-height: 0; border-color: transparent; background: transparent; color: var(--platinum-deep); }
  .fold:hover { color: var(--platinum); }
  /* The page list scrolls on a short window; Sync, TennoScope and Settings stay pinned below it. */
  nav { display: grid; align-content: start; gap: 1px; padding: .6rem .55rem; flex: 1 1 auto; min-height: 0; overflow: hidden auto; scrollbar-width: thin; }
  nav { scroll-padding-block: 2.5rem 3rem; }
  nav.more { mask-image: linear-gradient(180deg, #000 calc(100% - 3rem), transparent); }
  nav.above { mask-image: linear-gradient(0deg, #000 calc(100% - 2.5rem), transparent); }
  nav.more.above { mask-image: linear-gradient(180deg, transparent, #000 2.5rem, #000 calc(100% - 3rem), transparent); }
  .sec { padding: .85rem .65rem .35rem; font-size: .6rem; color: var(--sec); letter-spacing: .2em; display: flex; align-items: center; gap: .5rem; }
  .sec::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--sec-dim), transparent); }
  .nav {
    position: relative; display: flex; align-items: center; gap: .75rem; width: 100%; text-align: left;
    border: 0; background: transparent; padding: .44rem .65rem; color: var(--platinum-dim);
    font-family: var(--face-text); font-size: .9rem; font-weight: 500; letter-spacing: 0; text-transform: none;
  }
  .nav .ic { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; flex: none; opacity: .78; transition: opacity .12s; }
  .nav:hover:not(:disabled) { color: var(--platinum); background: rgb(230 233 238 / 4%); }
  .nav:hover .ic, .nav.on .ic { opacity: 1; }
  .nav.on { color: var(--platinum); background: linear-gradient(90deg, color-mix(in srgb, var(--sec) 14%, transparent), color-mix(in srgb, var(--sec) 2%, transparent) 70%); box-shadow: inset 2px 0 0 var(--sec); }
  .nav.on .ic :global(svg) { color: var(--sec); }
  .lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { margin-left: auto; min-width: 1.35rem; padding: .05rem .35rem; text-align: center; font-family: var(--face-register); font-size: .62rem; font-weight: 700; color: var(--slab); background: var(--gold); clip-path: var(--cut); }
  .nav .live { margin-left: auto; width: .5rem; height: .5rem; background: var(--gold); transform: rotate(45deg); flex: none; box-shadow: 0 0 6px rgb(214 174 74 / 60%); }
  .nav .live.dim { background: var(--gold-dim); box-shadow: none; }

  .foot { flex: none; display: grid; gap: .5rem; padding: .75rem .8rem .8rem; border-top: 1px solid var(--rule); }
  .game { display: flex; align-items: center; gap: .65rem; min-width: 0; padding: 0 .2rem; }
  .game .lbl { display: grid; min-width: 0; }
  .game strong { font-family: var(--face-register); font-size: .6rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
  .game small { font-size: .7rem; color: var(--platinum-deep); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill i { width: .62rem; height: .74rem; background: var(--platinum); clip-path: var(--cartouche); display: block; }
  .pill.live i { background: var(--gold); }
  .pill.live + .lbl strong { color: var(--gold); }
  .pill.idle i { clip-path: none; background: var(--platinum-deep); }
  .syncrow { display: flex; gap: .4rem; }
  .syncrow :global(.sync) { display: flex; justify-content: center; align-items: center; gap: .5rem; flex: 1; min-width: 0; }
  /* Every button down here is one height, folded or not. */
  .syncrow :global(.sync), .tool { height: 36px; padding-top: 0; padding-bottom: 0; }
  /* Why the last sync failed, under the button (it goes with the button's failed look). */
  .syncerr { margin: 0; font-size: .7rem; line-height: 1.35; color: var(--oxblood); }
  .compact .syncerr { display: none; }
  .tools { display: flex; gap: .4rem; }
  .tool { display: inline-flex; align-items: center; justify-content: center; gap: .5rem; padding-left: .6rem; padding-right: .6rem; }
  /* The page that's open (Guide): marked the way the sidebar marks its page, a gold edge, not a white block. */
  .tool.on { color: var(--platinum); background: rgb(214 174 74 / 12%); box-shadow: inset 2px 0 0 var(--gold); }
  .tsbtn { flex: 1; min-width: 0; justify-content: flex-start; }
  .bell { position: relative; }
  .bell .count { position: absolute; top: -.45rem; right: -.45rem; min-width: 1.1rem; padding: .05rem .25rem; font-family: var(--face-register); font-size: .55rem; font-weight: 700; line-height: 1.3; text-align: center; color: var(--slab); background: var(--gold); clip-path: var(--cut); animation: pop .25s ease-out; }
  .bell.paused :global(svg) { opacity: .45; }
  /* Paused: a slash through the bell, not just a dimmer one. */
  .bell.paused::after { content: ""; position: absolute; left: 50%; top: 50%; width: 1.1rem; height: 1px; background: var(--platinum-dim); transform: translate(-50%, -50%) rotate(-45deg); }
  /* Folded, Sync sits right above: the count stays inside the button. */
  /* Folded: no room for a number, a gold dot says there's something new (the tooltip has how many). */
  .compact .bell .count { top: 3px; right: 3px; min-width: 0; width: .45rem; height: .45rem; padding: 0; font-size: 0; clip-path: none; border-radius: 50%; }
  @keyframes pop { from { transform: scale(.4); } to { transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { .bell .count { animation: none; } }
  .tsbtn i { width: .5rem; height: .5rem; background: var(--platinum-deep); transform: rotate(45deg); flex: none; }
  .tsbtn.tone-ok i { background: var(--verdigris); }
  .tsbtn.tone-warn i { background: var(--gold); }
  .tsbtn.tone-bad i { background: var(--oxblood); }

  /* ---- icons only: folded by hand, or a narrow window */
  .compact .brand { justify-content: center; padding-left: .5rem; padding-right: .5rem; flex-direction: column; gap: .4rem; }
  .compact .fold { margin-left: 0; }
  .compact .brand-name, .compact .lbl { display: none; }
  /* Folded, a section keeps a short rule in its colour between the groups (its name on hover). */
  .compact .sec { justify-content: center; padding: .6rem 0 .35rem; font-size: 0; letter-spacing: 0; gap: 0; }
  .compact .sec::after { flex: none; width: 1.5rem; height: 2px; background: var(--sec); }
  .compact .nav { justify-content: center; padding: .48rem 0; }
  .compact .foot { padding: .7rem .6rem .8rem; gap: .45rem; }
  .compact .nav .badge, .compact .nav .live { position: absolute; top: .2rem; right: .35rem; margin: 0; }
  .compact .badge { min-width: 1.05rem; font-size: .52rem; padding: 0 .2rem; }
  .compact .game { justify-content: center; }
  /* Folded: under the game light, Sync across, then the bell, TennoScope, Guide and Settings two by two. */
  .compact .foot { grid-template-columns: 1fr 1fr; gap: .35rem; padding: .6rem .5rem .7rem; }
  .compact .game, .compact :global(.sync) { grid-column: 1 / -1; }
  .compact :global(.sync .lbls) { display: none; }
  .compact .tools, .compact .syncrow { display: contents; }
  .compact :global(.sync), .compact .tool { padding-left: 0; padding-right: 0; min-width: 0; }
  .compact .tsbtn { justify-content: center; }
  /* A short window: tighter rows, so every page and the tools fit (all 16 folded at 700 px high). */
  @media (max-height: 900px) {
    .compact .brand { padding-top: .6rem; padding-bottom: .5rem; gap: .2rem; }
    .compact nav { padding-top: .35rem; padding-bottom: .35rem; }
    .compact .sec { padding: .4rem 0 .25rem; }
    .compact .nav { padding: .2rem 0; }
    .compact .nav .ic { width: 1.35rem; height: 1.35rem; }
    .shell:not(.compact) .nav { padding-top: .32rem; padding-bottom: .32rem; }
    .shell:not(.compact) .sec { padding-top: .6rem; padding-bottom: .25rem; }
  }
  /* Steam Deck height (800 px): every page still fits unfolded. */
  @media (max-height: 820px) {
    .shell:not(.compact) .brand { padding-top: .6rem; padding-bottom: .5rem; }
    .shell:not(.compact) nav { padding-top: .3rem; padding-bottom: .3rem; }
    .shell:not(.compact) .nav { padding-top: .2rem; padding-bottom: .2rem; }
    .shell:not(.compact) .sec { padding-top: .45rem; padding-bottom: .15rem; }
    .shell:not(.compact) .foot { gap: .4rem; padding-top: .55rem; padding-bottom: .6rem; }
  }

  .notice { clip-path: var(--cut); margin-top: var(--field); padding: 1.6rem 1.8rem; border: 1px solid var(--rule); background: var(--plate); max-width: 52rem; display: grid; gap: .8rem; }
  .notice h2 { font-size: 2rem; }
  .notice .row { display: flex; gap: .6rem; flex-wrap: wrap; }
  .notice .why { font-size: .78rem; color: var(--platinum-deep); }
  .steps { list-style: none; margin: 0; padding: 0; display: grid; gap: .9rem; counter-reset: step; }
  /* Steps to come and done are turned down by colour, not opacity, so they stay readable (about 5:1 and 7:1). */
  .steps li { counter-increment: step; display: grid; grid-template-columns: 2rem 1fr; gap: .25rem .8rem; align-items: start; }
  .steps li:not(.now, .done) { color: var(--platinum-deep); --platinum: var(--platinum-deep); --platinum-dim: var(--platinum-deep); }
  .steps li::before { content: counter(step); grid-row: span 4; display: grid; place-items: center; width: 1.7rem; height: 1.7rem; border: 1px solid var(--rule-bright); font-family: var(--face-register); font-size: .8rem; color: var(--platinum-dim); }
  .steps li > * { grid-column: 2; }
  .steps li.now::before { border-color: var(--gold); color: var(--gold); }
  .steps li.done { color: var(--platinum-dim); --platinum: var(--platinum-dim); }
  .steps li.done::before { content: "✓"; border-color: var(--verdigris); color: var(--verdigris); }
  .steps .cmd { display: block; padding: .45rem .7rem; background: var(--well); border: 1px solid var(--rule); font-family: var(--face-register); font-size: .8rem; user-select: all; }
  .steps strong { font-family: var(--face-mark); text-transform: uppercase; font-size: 1.05rem; letter-spacing: .01em; }
  .notice .why code { display: block; margin-top: .4rem; font-family: var(--face-register); font-size: .9em; white-space: pre-wrap; word-break: break-word; }
  /* A reload failed with data on screen: one slim line above the page, which stays as it was. */
  .stale { flex: none; display: flex; align-items: center; gap: .9rem; padding: .45rem 1.4rem; font-size: .8rem; color: var(--platinum-dim); background: color-mix(in srgb, var(--alert) 7%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--alert) 55%, transparent); box-shadow: inset 3px 0 0 var(--alert); }
  .stale::before { content: "!"; font-weight: 700; color: var(--alert); margin-right: -.4rem; }
  .stale .link { font-size: .64rem; }
  .stale.slim { padding-top: .3rem; padding-bottom: .3rem; font-size: .76rem; }
  .stale.slim b { font-weight: 600; color: var(--platinum); }
  .repdue { background: rgb(111 183 163 / 7%); border-bottom-color: color-mix(in srgb, var(--verdigris) 45%, transparent); box-shadow: inset 3px 0 0 var(--verdigris); }
  .repdue b { color: var(--platinum); font-weight: 600; }
  .repdue .msg { color: var(--platinum); font-style: normal; }
</style>
