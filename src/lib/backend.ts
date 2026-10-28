// Talks to the Rust side inside Tauri; in a plain browser (`npm run dev`) it falls back to
// public/dev-bundle.json and localStorage so the UI can be worked on without a build.

import type { RelicMarket } from "./core/model";
import type { BaroRate } from "./core/traders";
import type { LoggedScreen, RelicRun } from "./core/relicRuns";
import { defaultSellChoices, type SellChoices } from "./core/spares";
import { defaultBulkRules, type BulkRules } from "./core/bulk";
import type { FissureRule } from "./core/timers";
import type { RivenAuction, RivenMeta, RivenRaw, RivenSnap } from "./core/rivens";
import type { Invasion } from "./core/invasions";
import type { WorldAlert } from "./core/worldNeeds";
import type { RelicData } from "./core/relicData";
import type { Bundle, CatalogPart, CollectionPart, DuviriCycle, Fissure, Live, MissionState, Nightwave, SortieLike, SteelPath, VaultTraderItem } from "./core/types";
import { defaultPickWeights, type PickWeights } from "./core/pick";
import type { Notice } from "./notices";


/** warframe.market's platforms: whose market orbiter reads and lists on. */
export type Platform = "pc" | "xbox" | "ps4" | "switch" | "mobile";
export const PLATFORM_LABEL: Record<Platform, string> = { pc: "PC", xbox: "Xbox", ps4: "PlayStation", switch: "Nintendo Switch", mobile: "iOS / Android" };

export interface MarketSettings {
  /** Your platform. Anything but PC has no inventory: TennoScope only reads Warframe on a PC. */
  platform: Platform;
  /** Reprice automatically on a timer: check, and send the new prices (Auto-match). */
  auto: boolean;
  /** Check prices on the timer without sending them: Orders shows what each listing would change to. */
  autoCheck: boolean;
  /** Minutes between automatic passes. */
  every: number;
  /** Never below this share of the item's daily market price. */
  minShare: number;
  /** Per listing (see listingKey): your own floor, and whether it is left alone. */
  floors: Record<string, number>;
  paused: Record<string, boolean>;
  /** The warframe.market status you last chose; orbiter holds it again when it starts. Null: none. */
  presence: Presence | null;
  /** Nothing is listed or repriced below this many platinum. */
  minPrice: number;
  /**
   * The same for relics, which sell for a few platinum each and go in stacks: a stack of twenty
   * at 5p is worth a trade where one mod at 5p isn't.
   */
  minRelicPrice: number;
  /** Relic prices by refinement from warframe.market's sales, refreshed daily (see RelicMarket). */
  relicPrices: RelicMarket;
  /** What "Put my spares on sale" covers. */
  bulk: BulkRules;
  /** Veiled rivens: spare only when on. Relics: spare only when on and they sell for more than a crack is worth, and never one that drops a part you still need. */
  sellable: SellChoices;
  /** Things you sold, newest first (the last 2,000). */
  sales: Sale[];
  /** Trades read from the game log mark their listing sold and log the sale on their own. */
  autoTrades: boolean;
  /** Trades already handled (session|uptime), newest first. */
  tradesSeen: string[];
  /** Every trade from the game log, newest first. */
  trades: TradeLogEntry[];
  /** +rep on warframe.market, by trade key: "given" once the partner has your +rep, "skipped" for Not now. */
  rep: Record<string, "given" | "skipped">;
  /** The message that goes with +rep (warframe.market's reputation is a positive review). */
  repText: string;
}

export const defaultMarketSettings = (): MarketSettings => ({ platform: "pc", auto: false, autoCheck: false, every: 5, minShare: 0.5, floors: {}, paused: {}, presence: null, minPrice: 10, minRelicPrice: 3, relicPrices: {}, bulk: defaultBulkRules(), sellable: defaultSellChoices(), sales: [], autoTrades: true, tradesSeen: [], trades: [], rep: {}, repText: ":)" });

export interface AdviceSettings {
  platPerDucat: number;
  minPlat: number;
  slowBelow: number;
  squad: number;
  maxMissing: number;
  /** What Vosfor from dissolving arcanes is worth: packs toward arcanes you need, or at market prices. */
  vosforLens: "need" | "market";
  /** The ducat rate Baro's stock gave on his last visit, offered beside Your rates (see traders.ts). */
  baroRate?: BaroRate | null;
}

export const defaultAdvice = (): AdviceSettings => ({ platPerDucat: 0.1, minPlat: 5, slowBelow: 1, squad: 1, maxMissing: 2, vosforLens: "need" });

export interface Settings {
  advice: AdviceSettings;
  /** How much each thing counts when scoring reward cards. */
  pick: PickWeights;
  /** Switch to In mission when the reward screen opens. */
  jumpToPick: boolean;
  /** Start TennoScope (in the background) with orbiter and close it with orbiter. */
  tennoscope: { launch: boolean; path: string };
  market: MarketSettings;
  dataDir: string;
  /** Custom EE.log location; empty finds it in the Steam libraries. */
  eeLog: string;
  /** Carry on without an inventory until TennoScope has read one (always so on macOS). */
  withoutInventory: boolean;
  /** Home's cards you turned off (Home → Customise): "market", "baro"… */
  homeHidden: string[];
  /** What you get notifications for (the bell in the sidebar). */
  notify: NotifySettings;
  notifyOptions: NotifyOptions;
  /** Pages you took out of the sidebar (Settings → Pages). */
  pagesHidden: string[];
  /** The sidebar's order, when you changed it (Settings → Pages): page ids. */
  pageOrder: string[];
  /** The page orbiter opens on: "last" is where you left it. */
  startPage: string;
  tab: string;
  /** The sidebar: true icons only, false with page names, null folds by itself in a narrow window. */
  folded: boolean | null;
  /** The Planner's view: relics to crack for sets, or relics worth making radiant. */
  plannerMode: "sets" | "radiant";
  /** Settings layout version, for one-off moves when a default changes. */
  schema: number;
  /** Invasion rewards already announced (invasion id | part), newest first. */
  notifiedInvasions: string[];
  /** What orbiter last learned about your account and has already told you. */
  game: GameState;
  /** Items you starred, by unique name. */
  favourites: string[];
  /** Fissures you want to hear about. */
  fissureRules: FissureRule[];
  /** Rivens you want: a notification when one is listed at or under your price. */
  rivenWatch: RivenWatch[];
}

export interface RivenWatch {
  id: string;
  /** warframe.market weapon slug, and its name to show. */
  weapon: string;
  weaponName: string;
  positive: string[];
  negative: string | null;
  maxPrice: number;
}

export interface Sale {
  at: number;
  item: string;
  rank: number | null;
  quantity: number;
  /** Each. */
  platinum: number;
  /** The item's daily median when it sold (recorded within a day or two of the sale), for "vs market". */
  median?: number;
  /**
   * The game-log trade this sale is (see tradeKey): set when a trade logged it, or when a trade
   * matched it to a sale you had logged by hand. Absent: logged by hand, not matched yet.
   */
  trade?: string;
  /** The warframe.market order this sale closed (imported from, or matched to, your profile's closed orders). */
  wfm?: string;
}

export interface GameState {
  /** From TennoScope's last report, kept so alerts and figures outlive a TennoScope restart. */
  foundryReady: [string, number][];
  masteryRank: number | null;
  platinum: number | null;
  credits: number | null;
  endo: number | null;
  /** Unveiled rivens from the patched TennoScope's last read. */
  rivens: RivenRaw[] | null;
  /** Each riven's rolls as orbiter has seen them (by riven id, oldest first): for before-and-after on a cycle. */
  rivenHistory: Record<string, RivenSnap[]>;
  /** Announced already (newest first, capped). */
  foundryNotified: string[];
  whispersSeen: string[];
  /** warframe.market chats already announced: chat id → its last update then. */
  chatsSeen: Record<string, string>;
  dealsNotified: string[];
  fissuresNotified: string[];
  rivensNotified: string[];
  /** Listings for more than you held, already told (order id | quantity listed). */
  shortNotified: string[];
  /** Inventory value over time: one point per inventory read. */
  valueHistory: ValuePoint[];
  /** Every relic reward screen, oldest first: Stats' relic runs. */
  relicRuns: RelicRun[];
  /** Notifications sent, newest first (the bell in the sidebar). */
  notices: Notice[];
  /** Alerts, Baro visits, Varzia rotations and Circuit weeks already announced. */
  worldNotified: string[];
}
export interface ValuePoint {
  at: number;
  /** Everything tradable at the daily median. */
  worth: number;
  /** Only what trades at least once a day. */
  liquid: number;
  platinum: number | null;
  /** From the patched TennoScope's read, when it gave them. */
  credits?: number | null;
  endo?: number | null;
  /** What you held of each currency and relics in total: ducats, aya, kuva, traces, vosfor, essence, relics. */
  held?: Record<string, number>;
}

/** Every trade the game log showed, sales, purchases and swaps alike. */
export interface TradeLogEntry {
  /** Game session and time in it: the trade's identity. */
  key: string;
  at: number;
  partner: string;
  offered: { name: string; rank: number | null; count: number }[];
  received: { name: string; rank: number | null; count: number }[];
  platOut: number;
  platIn: number;
}
export const defaultGame = (): GameState => ({ foundryReady: [], masteryRank: null, platinum: null, credits: null, endo: null, rivens: null, rivenHistory: {}, foundryNotified: [], whispersSeen: [], chatsSeen: {}, dealsNotified: [], fissuresNotified: [], rivensNotified: [], shortNotified: [], valueHistory: [], relicRuns: [], notices: [], worldNotified: [] });

export interface NotifySettings {
  /** The reward screen opened: which card to take. */
  reward: boolean;
  /** Listing problems: a listing outgrew what you hold, a change refused, the sign-in expired. */
  market: boolean;
  /** A trade in game sold one of your listings (marked sold and logged). */
  sold: boolean;
  /** Apply automatically moved listings to the cheapest price in game. */
  repriced: boolean;
  /** TennoScope couldn't be started or a request to it failed. */
  tennoscope: boolean;
  /** An invasion rewards a part for something you haven't mastered. */
  invasions: boolean;
  /** A foundry build is ready to claim. */
  foundry: boolean;
  /** Someone whispered you in game (usually a buyer). */
  whispers: boolean;
  /** A part or arcane you're after is listed well under its usual price. */
  deals: boolean;
  /** A fissure opened that matches one of your fissure alerts. */
  fissures: boolean;
  /** A riven you're watching for is listed at or under your price. */
  rivens: boolean;
  /** A fissure opens where a relic you hold drops something on your wishlist. */
  wishlist: boolean;
  /** Someone messaged you on warframe.market's own chat (the website, not the game). */
  siteChat: boolean;
  /** An alert rewards something you haven't mastered, or a part toward it. */
  alerts: boolean;
  /** An alert rewards a catalyst, reactor, Forma, Exilus Adapter or Nitain. */
  alertLoot: boolean;
  /** Baro arrives with gear you haven't mastered or mods you don't have. */
  baro: boolean;
  /** Varzia's rotation changes, with primes you haven't mastered or can't build. */
  varzia: boolean;
  /** The Duviri Circuit's weekly picks include something for you. */
  circuit: boolean;
}
export const defaultNotify = (): NotifySettings => ({ reward: true, market: true, sold: true, repriced: true, tennoscope: true, invasions: true, foundry: true, whispers: true, deals: true, fissures: true, rivens: true, wishlist: true, siteChat: true, alerts: true, alertLoot: true, baro: true, varzia: true, circuit: true });

/** How notifications reach you, whatever they're about. */
export interface NotifyOptions {
  /** Paused: notifications still go in the history, but nothing pops up. */
  paused: boolean;
  /** Paused until then (ms), for "an hour" or "until tomorrow"; null: not paused for a while. */
  pausedUntil: number | null;
  /** Which of the two that was, so the panel lights its button. */
  pausedHow?: "hour" | "tomorrow" | null;
  /** While you're looking at orbiter: a pop-up in its window. */
  toasts: boolean;
  /** While you're not: your desktop's notifications. */
  desktop: boolean;
  /** Nothing pops up while you're in a fissure, but the reward to take. */
  quietInFissure: boolean;
  /** Kinds that only go in the history, never pop up. */
  quiet: string[];
}
export const defaultNotifyOptions = (): NotifyOptions => ({ paused: false, pausedUntil: null, toasts: true, desktop: true, quietInFissure: false, quiet: [] });

export const defaultSettings = (): Settings => ({
  advice: defaultAdvice(),
  market: defaultMarketSettings(),
  pick: defaultPickWeights(),
  jumpToPick: true,
  tennoscope: { launch: true, path: "" },
  dataDir: "",
  eeLog: "",
  withoutInventory: false,
  homeHidden: [],
  notify: defaultNotify(),
  notifyOptions: defaultNotifyOptions(),
  pagesHidden: [],
  pageOrder: [],
  startPage: "last",
  tab: "home",
  folded: null,
  plannerMode: "sets",
  schema: 2,
  notifiedInvasions: [],
  game: defaultGame(),
  favourites: [],
  fissureRules: [],
  rivenWatch: [],
});

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** The Bundle `buildModel` reads, from the fresh part and the catalogs held. */
export function assembleBundle(fresh: CollectionPart, catalogs: CatalogPart): Bundle {
  return { observed_at: fresh.observed_at, inventory: fresh.inventory, catalog: catalogs.catalog, relics: catalogs.relics, prices: fresh.prices };
}

/**
 * Loads the Bundle in two parts: the inventory and prices on every call, the catalogs (most of
 * the data) only when their revision differs from the one held, or the data folder changed.
 * Calls made while the catalogs are on their way share that one request.
 */
export function bundleLoader(get: { collection: (dir: string) => Promise<CollectionPart>; catalogs: (dir: string) => Promise<CatalogPart> }) {
  type Held = { dir: string; rev: string | null; part: Promise<CatalogPart> };
  let held: Held | null = null;
  return async (dir: string): Promise<Bundle> => {
    const fresh = await get.collection(dir);
    const rev = fresh.catalog_rev;
    let entry = held;
    if (!entry || entry.dir !== dir || rev === null || entry.rev !== rev) {
      const next: Held = { dir, rev, part: get.catalogs(dir) };
      held = entry = next;
      next.part.then(
        // The revision they were read at: newer than `rev` if TennoScope wrote in between.
        (p) => (next.rev = p.rev),
        // Failed: the next call asks again.
        () => {
          if (held === next) held = null;
        },
      );
    }
    return assembleBundle(fresh, await entry.part);
  };
}

const tauriBundle = bundleLoader({
  collection: (dir) => invoke<CollectionPart>("load_collection", { dir: dir || null }),
  catalogs: (dir) => invoke<CatalogPart>("load_catalogs", { dir: dir || null }),
});

/** No inventory and no item data: orbiter before TennoScope has read anything (or on a Mac). */
export const emptyBundle = (): Bundle => ({ observed_at: null, inventory: [], catalog: [], relics: [], prices: null });

/** TennoScope runs but hasn't read an inventory yet. */
export const NO_INVENTORY_YET = "No inventory read yet";

/**
 * A read that failed because there's nothing there yet, not because something broke: no folder,
 * no item data downloaded yet ("not found at", from the desktop app on every system; os errors 2
 * and 3 are Linux's and Windows' missing file or folder, from an older build), no inventory read.
 */
export const nothingYet = (e: string) => /not found at|No dev bundle|HOME is not set|os error [23]\b|No inventory read yet/i.test(e);

export async function loadBundle(dataDir: string): Promise<Bundle> {
  if (inTauri) return tauriBundle(dataDir);
  // The browser dev mode reads the whole bundle from one file.
  const res = await fetch("/dev-bundle.json");
  if (!res.ok) throw new Error("No dev bundle. Run `npm run dev-bundle` first.");
  return res.json();
}

export async function defaultDataDir(): Promise<string> {
  if (inTauri) return (await invoke<string | null>("default_data_dir")) ?? "";
  return "~/.local/share/io.github.deftera186.tennoscope";
}

export async function dataStamp(dataDir: string): Promise<number> {
  if (!inTauri) return 0;
  return invoke<number>("data_stamp", { dir: dataDir || null });
}

/** A worldstate object if it has the field we need; the API answers {} or an error otherwise. */
const obj = <T,>(v: unknown, key: string): T | null => (v && typeof v === "object" && key in (v as object) ? (v as T) : null);

export async function loadLive(): Promise<Live> {
  let raw: Record<string, unknown> | null = null;
  try {
    if (inTauri) raw = await invoke("worldstate");
    else {
      const get = (p: string) => fetch(`https://api.warframestat.us/pc/${p}?language=en`).then((r) => r.json()).catch(() => null);
      const names = ["fissures", "vaultTrader", "voidTrader", "invasions", "nightwave", "sortie", "archonHunt", "steelPath", "duviriCycle", "earthCycle", "cetusCycle", "vallisCycle", "cambionCycle", "zarimanCycle", "alerts"];
      raw = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await get(n)] as const)));
    }
  } catch {
    raw = null;
  }
  // Nothing at all (offline, api.warframestat.us down): say so, so the caller keeps what it had
  // rather than showing no fissures, no Baro and no cycles until the next read.
  if (!raw || Object.values(raw).every((v) => v == null)) throw new Error("The worldstate couldn't be read");
  const vt = (raw?.vaultTrader ?? null) as { inventory?: VaultTraderItem[]; expiry?: string } | null;
  return {
    fissures: Array.isArray(raw?.fissures) ? (raw!.fissures as Fissure[]) : null,
    resurgence: vt?.inventory ?? null,
    resurgenceExpiry: vt?.expiry ?? null,
    invasions: Array.isArray(raw?.invasions) ? (raw!.invasions as Invasion[]) : null,
    alerts: Array.isArray(raw?.alerts) ? (raw!.alerts as WorldAlert[]) : null,
    nightwave: obj<Nightwave>(raw?.nightwave, "activeChallenges"),
    sortie: obj<SortieLike>(raw?.sortie, "boss"),
    archonHunt: obj<SortieLike>(raw?.archonHunt, "boss"),
    steelPath: obj<SteelPath>(raw?.steelPath, "currentReward"),
    duviriCycle: obj<DuviriCycle>(raw?.duviriCycle, "choices"),
    cycles: (["earth", "cetus", "vallis", "cambion", "zariman"] as const)
      .map((k) => ({ key: k, c: obj<{ state: string; expiry: string }>(raw?.[`${k}Cycle`], "state") }))
      .filter((x): x is { key: (typeof x)["key"]; c: { state: string; expiry: string } } => !!x.c?.expiry)
      .map((x) => ({ key: x.key, state: x.c.state, expiry: x.c.expiry })),
    baro: (raw?.voidTrader as { activation?: string; expiry?: string; location?: string } | null)?.activation
      ? (raw!.voidTrader as { activation: string; expiry: string; location: string })
      : null,
  };
}

/**
 * The official drop tables' relics (relicdata.rs): cached for half a day, `force` checks now.
 * Null when they can't be read and nothing was kept; the relic list is then TennoScope's alone.
 */
export async function relicData(force = false): Promise<RelicData | null> {
  try {
    if (inTauri) return await invoke<RelicData>("relic_data", { force });
    const res = await fetch("/dev-relic-data.json");
    return res.ok ? ((await res.json()) as RelicData) : null;
  } catch {
    return null;
  }
}

export async function loadSettings(): Promise<Settings> {
  let raw: Partial<Settings> | null = null;
  try {
    if (inTauri) raw = await invoke<Partial<Settings> | null>("load_settings");
    else raw = JSON.parse(localStorage.getItem("orbiter-settings") ?? "null");
  } catch {
    raw = null;
  }
  const base = defaultSettings();
  // Schema 2: cracking alone became the default for Relics and Planner alike.
  if (raw && (raw.schema ?? 1) < 2 && raw.advice) raw.advice.squad = 1;
  // `view` was never used; settings saved before it went still carry it.
  if (raw) delete (raw as { view?: unknown }).view;
  // Arcane tiers were taken out: settings saved with them drop them.
  if (raw) delete (raw as { tiers?: unknown }).tiers;
  return {
    ...base,
    ...(raw ?? {}),
    folded: typeof raw?.folded === "boolean" ? raw.folded : null,
    withoutInventory: raw?.withoutInventory === true,
    homeHidden: Array.isArray(raw?.homeHidden) ? raw.homeHidden.filter((k: unknown): k is string => typeof k === "string") : [],
    plannerMode: raw?.plannerMode === "radiant" ? "radiant" : "sets",
    market: { ...base.market, ...(raw?.market ?? {}), bulk: { ...base.market.bulk, ...(raw?.market?.bulk ?? {}) }, sellable: { veiledRivens: raw?.market?.sellable?.veiledRivens === true, relicsWorthSelling: raw?.market?.sellable?.relicsWorthSelling ?? base.market.sellable.relicsWorthSelling }, sales: Array.isArray(raw?.market?.sales) ? raw.market.sales : [], tradesSeen: Array.isArray(raw?.market?.tradesSeen) ? raw.market.tradesSeen : [], trades: Array.isArray(raw?.market?.trades) ? raw.market.trades : [], rep: raw?.market?.rep && typeof raw.market.rep === "object" ? Object.fromEntries(Object.entries(raw.market.rep).filter(([, v]) => v === "given" || v === "skipped")) : {}, platform: raw?.market?.platform && raw.market.platform in PLATFORM_LABEL ? raw.market.platform : "pc", autoCheck: typeof raw?.market?.autoCheck === "boolean" ? raw.market.autoCheck : raw?.market?.auto === true, every: typeof raw?.market?.every === "number" && raw.market.every >= 1 ? raw.market.every : base.market.every, minRelicPrice: typeof raw?.market?.minRelicPrice === "number" && raw.market.minRelicPrice >= 1 ? Math.round(raw.market.minRelicPrice) : base.market.minRelicPrice, relicPrices: raw?.market?.relicPrices && typeof raw.market.relicPrices === "object" && !Array.isArray(raw.market.relicPrices) ? raw.market.relicPrices : {}, repText: typeof raw?.market?.repText === "string" && raw.market.repText.trim() && raw.market.repText !== "Smooth trade, thanks!" ? raw.market.repText : ":)" },
    advice: { ...base.advice, ...(raw?.advice ?? {}) },
    pick: { ...base.pick, ...(raw?.pick ?? {}) },
    tennoscope: { ...base.tennoscope, ...(raw?.tennoscope ?? {}) },
    // "Your listings" was one switch before it was split: off stays off for all three.
    notify: { ...base.notify, ...(raw?.notify?.market === false ? { sold: false, repriced: false } : {}), ...(raw?.notify ?? {}) },
    notifyOptions: {
      paused: raw?.notifyOptions?.paused === true,
      pausedUntil: typeof raw?.notifyOptions?.pausedUntil === "number" ? raw.notifyOptions.pausedUntil : null,
      pausedHow: raw?.notifyOptions?.pausedHow === "tomorrow" ? "tomorrow" : raw?.notifyOptions?.pausedHow === "hour" ? "hour" : null,
      toasts: raw?.notifyOptions?.toasts !== false,
      desktop: raw?.notifyOptions?.desktop !== false,
      quietInFissure: raw?.notifyOptions?.quietInFissure === true,
      quiet: Array.isArray(raw?.notifyOptions?.quiet) ? raw.notifyOptions.quiet.filter((k: unknown): k is string => typeof k === "string") : [],
    },
    pagesHidden: Array.isArray(raw?.pagesHidden) ? raw.pagesHidden.filter((k: unknown): k is string => typeof k === "string") : [],
    pageOrder: Array.isArray(raw?.pageOrder) ? raw.pageOrder.filter((k: unknown): k is string => typeof k === "string") : [],
    startPage: typeof raw?.startPage === "string" && raw.startPage ? raw.startPage : "last",
    schema: base.schema,
    notifiedInvasions: Array.isArray(raw?.notifiedInvasions) ? raw.notifiedInvasions : [],
    game: { ...defaultGame(), ...(raw?.game ?? {}), relicRuns: Array.isArray(raw?.game?.relicRuns) ? raw.game.relicRuns : [], notices: Array.isArray(raw?.game?.notices) ? raw.game.notices : [], worldNotified: Array.isArray(raw?.game?.worldNotified) ? raw.game.worldNotified : [] },
    favourites: Array.isArray(raw?.favourites) ? raw.favourites : [],
    fissureRules: Array.isArray(raw?.fissureRules) ? raw.fissureRules : [],
    rivenWatch: Array.isArray(raw?.rivenWatch) ? raw.rivenWatch : [],
  };
}

/**
 * The parts of the settings that grow long (logs and history). They're serialized on their own
 * (see persist.svelte.ts), so a small change elsewhere doesn't re-read thousands of entries.
 */
export const HEAVY_SETTINGS = [
  ["market", "sales"],
  ["market", "trades"],
  ["market", "relicPrices"],
  ["game", "valueHistory"],
  ["game", "rivenHistory"],
  ["game", "relicRuns"],
  ["game", "notices"],
] as const;
export type HeavyKey = `${(typeof HEAVY_SETTINGS)[number][0]}.${(typeof HEAVY_SETTINGS)[number][1]}`;

/** The settings without the heavy parts (shallow copies; nothing is deep-read). */
export function lightSettings(s: Settings) {
  return {
    ...s,
    market: { ...s.market, sales: undefined, trades: undefined, relicPrices: undefined },
    game: { ...s.game, valueHistory: undefined, rivenHistory: undefined, relicRuns: undefined, notices: undefined },
  };
}

/** Puts the settings back together from their serialized parts. */
export function joinSettings(light: string, heavy: Partial<Record<HeavyKey, string>>): Settings {
  const s = JSON.parse(light) as Record<string, Record<string, unknown>>;
  for (const [a, b] of HEAVY_SETTINGS) {
    const text = heavy[`${a}.${b}`];
    if (text !== undefined) s[a][b] = JSON.parse(text);
  }
  return s as unknown as Settings;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSave: (() => Settings) | null = null;
/**
 * Saves the settings 300 ms after the last change. `s` can be a function, so the settings are
 * put together once per save rather than once per change.
 */
export function saveSettings(s: Settings | (() => Settings)) {
  clearTimeout(saveTimer);
  pendingSave = typeof s === "function" ? s : () => s;
  saveTimer = setTimeout(flushSettings, 300);
}

/** Saves now what's waiting to be saved (before quitting). */
export async function flushSettings() {
  clearTimeout(saveTimer);
  const get = pendingSave;
  pendingSave = null;
  if (!get) return;
  try {
    const s = get();
    if (inTauri) await invoke("save_settings", { settings: s });
    else localStorage.setItem("orbiter-settings", JSON.stringify(s));
  } catch (e) {
    console.error("saving settings failed", e);
  }
}

export async function openUrl(url: string) {
  if (inTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank", "noopener");
}

/** warframe.market URL slug for an item name. */
export const marketUrl = (name: string) =>
  `https://warframe.market/items/${name.toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

export const wikiUrl = (name: string) => `https://wiki.warframe.com/w/${encodeURIComponent(name.replace(/ /g, "_"))}`;

/** The squad's relics from EE.log. `null` when the log isn't found. In the browser dev mode it
 * reads public/dev-mission.json if present. */
export interface TennoscopeStatus {
  /** The program orbiter would start, if found. */
  binary: string | null;
  /** That program is the TennoScope that comes inside orbiter. */
  bundled?: boolean;
  /** TennoScope runs on this system (it doesn't on macOS). */
  supported?: boolean;
  running: boolean;
  started_by_orbiter: boolean;
  /** What a patched TennoScope last reported, while fresh. */
  report: TennoscopeReport | null;
}

export type HealthState = "ready" | "idle" | "degraded" | "failed";
export interface Health {
  state: HealthState;
  message: string;
  last_success: string | null;
}
export type Presence = "online" | "ingame" | "invisible";
export interface TennoscopeReport {
  at: number;
  pid: number;
  game_running: boolean;
  health: Record<"game_reader" | "log_monitor" | "capture" | "catalog" | "market" | "collection_prices" | "database" | "market_account", Health>;
  market: {
    link: "unlinked" | "linked" | "needs_relink";
    backing: "keyring" | "database" | null;
    presence: { status: Presence | null; wanted: Presence | null; auto: boolean };
  };
  setup: { setup_complete: boolean; access_mode: "companion" | "overlay" | "full" | null; desktop_capture_action_available: boolean };
  last_error: { at: number; message: string } | null;
  /** Builds waiting in the foundry, by recipe path; null until TennoScope read the inventory this run. */
  foundry?: Record<string, number> | null;
  /** When each of those builds finishes: [recipe path, unix ms]. */
  foundry_ready?: [string, number][] | null;
  /** Your mastery rank and platinum, from the same read. */
  mastery_rank?: number | null;
  platinum?: number | null;
  credits?: number | null;
  endo?: number | null;
  /** Unveiled rivens: the game's own fingerprint, passed through. */
  rivens?: RivenRaw[] | null;
}

export type TennoscopeAsk = "--sync" | "--authorize-capture";

/** Your warframe.market status as orbiter holds it on its own connection (see presence.rs). */
export interface PresenceState {
  /** What you chose; null: no connection held, which warframe.market shows as offline. */
  wanted: Presence | null;
  /** What warframe.market confirmed: what buyers see. */
  committed: Presence | null;
  connected: boolean;
  error: string | null;
}
let devPresence: PresenceState = { wanted: null, committed: null, connected: false, error: null };
export const presence = {
  state: (): Promise<PresenceState> => (inTauri ? invoke("presence_state") : Promise.resolve(devPresence)),
  /** Hold a status, or "offline" to close the connection. */
  set: (status: Presence | "offline"): Promise<PresenceState> => {
    if (inTauri) return invoke("presence_set", { status });
    devPresence = status === "offline" ? { wanted: null, committed: null, connected: false, error: null } : { wanted: status, committed: status, connected: true, error: null };
    return Promise.resolve(devPresence);
  },
};

/** Browser dev mode: public/dev-tennoscope.json fakes a running TennoScope. */
const devTennoscope = async (): Promise<TennoscopeStatus | null> => {
  const res = await fetch("/dev-tennoscope.json").catch(() => null);
  if (!(res?.ok && res.headers.get("content-type")?.includes("json"))) return null;
  const s = (await res.json()) as TennoscopeStatus;
  return { ...s, report: s.report ? { ...s.report, at: Date.now() } : null };
};

/** TennoScope, started and stopped by orbiter. Only the desktop app does this. */
export const tennoscope = {
  /** Linux's Yama ptrace_scope: above 0, TennoScope can't read the game's memory. Null: no such limit. */
  ptraceScope: (): Promise<number | null> => (inTauri ? invoke<number | null>("ptrace_scope") : Promise.resolve(null)),
  status: (path: string): Promise<TennoscopeStatus | null> => (inTauri ? invoke("tennoscope_status", { path: path || null }) : devTennoscope()),
  start: (path: string): Promise<TennoscopeStatus | null> => (inTauri ? invoke("tennoscope_start", { path: path || null }) : devTennoscope()),
  show: (path: string): Promise<void> => (inTauri ? invoke("tennoscope_show", { path: path || null }) : Promise.resolve()),
  ask: (path: string, ask: TennoscopeAsk): Promise<void> => (inTauri ? invoke("tennoscope_ask", { path: path || null, ask }) : Promise.resolve()),
};

/** The reward cards a patched TennoScope read off the screen (empty once it closes), or null. */
// ---------------------------------------------------------------- desktop

/**
 * A desktop notification (App's `tell` decides when). `id`: its entry in the history, so clicking
 * it opens what it's about (see onNoticeOpen). In the browser dev mode it's logged.
 */
export function notify(summary: string, body: string, id?: string) {
  if (inTauri) invoke("notify", { summary, body, id: id ?? null }).catch(() => {});
  else console.info(`[notification] ${summary}: ${body}`);
}

/** Quit orbiter (Ctrl+Q, or the window's X), closing the TennoScope it started. */
export async function quit() {
  // A change from the last 300 ms would otherwise be lost.
  await flushSettings();
  if (inTauri) await invoke("quit");
}

/**
 * The window's X: the desktop app holds the window open and sends "quit-requested" (see
 * `on_close_requested` in src-tauri/src/lib.rs); this saves and quits as Ctrl+Q does. If the page
 * doesn't get that far within 2 s, the app quits without it. Resolves to a function that stops
 * listening.
 */
export async function quitOnWindowClose(): Promise<() => void> {
  if (!inTauri) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen("quit-requested", () => {
      quit().catch((e) => console.error("quitting failed", e));
    });
  } catch (e) {
    // The X still closes orbiter, 2 s later and without the last changes.
    console.error("can't hear the window close", e);
    return () => {};
  }
}

export async function rewardCards(): Promise<ScreenCards | null> {
  if (inTauri) return invoke<ScreenCards | null>("reward_cards");
  const res = await fetch("/dev-reward-screen.json").catch(() => null);
  return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : null;
}

/** orbiter's pick, for TennoScope's overlay. Only the desktop app writes it. */
export async function writeRewardPick(pick: RewardPickFile): Promise<void> {
  if (inTauri) await invoke("write_reward_pick", { pick });
}

export interface ScreenCards {
  /** Unix ms when TennoScope read the screen. */
  at: number;
  cards: string[];
  /** The live prices TennoScope's overlay shows on the cards, by card name, once it has them. */
  prices?: Record<string, number>;
}

/** What TennoScope's overlay reads: one entry per card, in screen order. */
export interface RewardPickFile {
  at: number;
  cards: string[];
  scores: number[];
  best: number | null;
  reasons: string[][];
}

/** Every relic reward screen in TennoScope's own logs, oldest first (see crates/orbiter-data/src/reward_log.rs). */
export async function rewardScreens(dataDir: string): Promise<LoggedScreen[]> {
  if (inTauri) return invoke<LoggedScreen[]>("reward_screens", { dir: dataDir || null });
  const res = await fetch("/dev-reward-screens.json").catch(() => null);
  return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : [];
}

export async function missionState(eeLog: string): Promise<MissionState | null> {
  if (inTauri) return invoke<MissionState | null>("mission_state", { path: eeLog || null });
  const res = await fetch("/dev-mission.json").catch(() => null);
  return res?.ok ? res.json() : null;
}

/** URL for an item image file. In the app it goes through the local cache (img:// protocol);
 * in the browser dev mode straight to WFCD. */
/** An item's WFCD artwork: a thumbnail, or the larger copy cards and the details sheet show. */
export const imageUrl = (file: string, large = false) =>
  inTauri
    ? `img://localhost/${large ? "l/" : ""}${encodeURIComponent(file)}`
    : `https://raw.githubusercontent.com/WFCD/warframe-items/master/data/img/${encodeURIComponent(file)}`;

// ---------------------------------------------------------------- warframe.market (own sign-in)

import type { BookOrder, MarketItem, Me, MyOrder } from "./core/market";

export interface MarketAccount {
  linked: boolean;
  backing: "keyring" | "file";
  profile: Me | null;
  error: string | null;
}

const needApp = () => Promise.reject(new Error("warframe.market needs the desktop app (not the browser dev mode)"));

/** Browser dev mode only: public/dev-market.json fakes a signed-in account and its orders. */
const devMarket = async (): Promise<{ account: MarketAccount; orders: MyOrder[] } | null> => {
  const res = await fetch("/dev-market.json").catch(() => null);
  return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : null;
};
/** In the browser dev mode, changes to listings are pretended: nothing reaches warframe.market. */
const devNoop = () => new Promise<void>((done) => setTimeout(done, 40));

/** A player on warframe.market, from their public profile. */
export interface MarketUser {
  ingameName: string;
  slug: string;
  reputation: number;
  status: string | null;
}
/** Their warframe.market profile page. */
export const profileUrl = (u: MarketUser) => `https://warframe.market/profile/${encodeURIComponent(u.ingameName)}`;

/** One chat on warframe.market's own messenger. */
export interface ChatSummary {
  id: string;
  with: string;
  unread: number;
  lastUpdate: string;
  lastMessage: string | null;
}

/** warframe.market's live feed of new orders (src-tauri/src/feed.rs). */
export interface FeedState {
  running: boolean;
  connected: boolean;
  received: number;
  error: string | null;
}

/** A desktop notification was clicked: its id in the history. Resolves to a function that stops listening. */
export async function onNoticeOpen(fn: (id: string) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("notice-open", (e) => fn(e.payload));
}

/** Each sell order from the live feed, as it goes up. Resolves to a function that stops listening. */
export async function onMarketOrder(fn: (order: import("./core/deals").FeedOrder) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<import("./core/deals").FeedOrder>("market-order", (e) => fn(e.payload));
}

let devPlatform: Platform = "pc";
export const market = {
  /** Starts (or stops) the live feed of new orders; returns how it's doing. */
  feed: (on: boolean): Promise<FeedState> => (inTauri ? invoke("market_feed", { on }) : Promise.resolve({ running: false, connected: false, received: 0, error: null })),
  /** A player's closed orders on warframe.market (newest first). */
  closedOrders: async (name: string): Promise<import("./core/closedOrders").ClosedOrder[]> => (inTauri ? invoke("market_closed_orders", { name }) : []),
  /** An item's daily closed trades, last 90 days. */
  history: async (slug: string): Promise<import("./core/priceTrend").PricePoint[]> => {
    if (inTauri) return invoke("market_item_history", { slug });
    const res = await fetch(`/dev-history-${slug}.json`).catch(() => null);
    return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : [];
  },
  /** Your chats on warframe.market's messenger. */
  chats: async (): Promise<ChatSummary[]> => (inTauri ? invoke("market_chats") : []),
  feedState: (): Promise<FeedState> => (inTauri ? invoke("market_feed_state") : Promise.resolve({ running: false, connected: false, received: 0, error: null })),
  /** A trade partner's warframe.market profile by in-game name; null when there's no such account. */
  user: async (name: string): Promise<MarketUser | null> =>
    inTauri ? invoke("market_user", { name }) : { ingameName: name, slug: name.toLowerCase(), reputation: 3, status: "offline" },
  /** The review you've left a player: 1 for +rep, -1 for a report, null for none. */
  myReview: (name: string): Promise<number | null> => (inTauri ? invoke("market_my_review", { name }) : Promise.resolve(null)),
  /** +rep: a positive review with your message, from your account. */
  giveRep: (name: string, text: string): Promise<void> => (inTauri ? invoke("market_give_rep", { name, text }) : Promise.resolve()),
  account: async (): Promise<MarketAccount> =>
    inTauri ? invoke("market_account") : ((await devMarket())?.account ?? { linked: false, backing: "file", profile: null, error: null }),
  signIn: (email: string, password: string): Promise<Me> => (inTauri ? invoke("market_sign_in", { email, password }) : needApp()),
  useToken: (token: string): Promise<Me> => (inTauri ? invoke("market_use_token", { token }) : needApp()),
  signOut: (): Promise<void> => (inTauri ? invoke("market_sign_out") : Promise.resolve()),
  items: async (): Promise<MarketItem[]> => {
    if (inTauri) return invoke("market_items");
    const res = await fetch("/dev-market-items.json").catch(() => null);
    return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : [];
  },
  myOrders: async (): Promise<MyOrder[]> => (inTauri ? invoke("market_my_orders") : ((await devMarket())?.orders ?? needApp())),
  rivenMeta: async (): Promise<RivenMeta> =>
    inTauri ? invoke<RivenMeta>("market_riven_meta") : fetch("/dev-rivens.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("no riven data in the browser")))),
  rivenAuctions: async (weapon: string, positive: string[], negative: string | null): Promise<RivenAuction[]> =>
    inTauri
      ? invoke<RivenAuction[]>("market_riven_auctions", { weapon, positive, negative })
      : fetch("/dev-auctions.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("warframe.market can only be searched from the desktop app")))),
  /** Your riven auctions (raw; see parseMyAuctions). */
  myAuctions: (): Promise<unknown> => (inTauri ? invoke("market_my_auctions") : Promise.resolve([])),
  createAuction: (auction: { starting_price: number; buyout_price: number | null; minimal_reputation: number; private: boolean; note: string; item: import("./core/rivens").AuctionItem }): Promise<unknown> =>
    inTauri ? invoke("market_create_auction", { auction }) : needApp(),
  updateAuction: (id: string, change: { starting_price: number; buyout_price: number | null; minimal_reputation: number; private: boolean; note: string }): Promise<unknown> =>
    inTauri ? invoke("market_update_auction", { id, change }) : needApp(),
  closeAuction: (id: string): Promise<void> => (inTauri ? invoke("market_close_auction", { id }) : needApp()),
  /** Which platform's market to use from now on. */
  setPlatform: (platform: Platform): Promise<void> => {
    devPlatform = platform;
    return inTauri ? invoke("market_platform", { platform }) : Promise.resolve();
  },
  book: async (slug: string): Promise<BookOrder[]> => {
    if (inTauri) return invoke("market_order_book", { slug });
    const res = await fetch(`https://api.warframe.market/v2/orders/item/${slug}`, { headers: { Platform: devPlatform, Crossplay: "true" } });
    return (await res.json()).data;
  },
  create: (order: { itemId: string; platinum: number; quantity: number; rank?: number | null; subtype?: string | null; visible?: boolean }): Promise<MyOrder> =>
    inTauri ? invoke("market_create", { order }) : devNoop().then(() => ({ id: `dev-${Date.now()}`, itemId: order.itemId, type: "sell", platinum: order.platinum, quantity: order.quantity, rank: order.rank ?? null, subtype: order.subtype ?? null, visible: true, updatedAt: null })),
  update: (id: string, change: { platinum?: number; quantity?: number; visible?: boolean }): Promise<void> =>
    inTauri ? invoke("market_update", { id, change }) : devNoop(),
  remove: (id: string): Promise<void> => (inTauri ? invoke("market_delete", { id }) : devNoop()),
  /** warframe.market's own "Sold": records the sale on your profile and lowers or closes the order. */
  close: (id: string, quantity: number): Promise<void> => (inTauri ? invoke("market_close", { id, quantity }) : devNoop()),
};
