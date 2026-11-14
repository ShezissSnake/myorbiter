// Talks to the Rust side inside Tauri; in a plain browser (`npm run dev`) it falls back to
// public/dev-bundle.json and localStorage so the UI can be worked on without a build.

import { deferredUntil, waitWords } from "./core/marketWait";
import { approvedOf } from "./core/approved";
import { SECTION_NAMES } from "./pages";
import { changesOf, type ChangeLog } from "./core/drift";
import type { RelicMarket } from "./core/model";
import type { BaroRate } from "./core/traders";
import type { LoggedScreen, RelicRun } from "./core/relicRuns";
import { emptyDropLog, type DropLog } from "./core/drops";
import { defaultSellChoices, type SellChoices } from "./core/spares";
import { defaultBulkRules, type BulkRules } from "./core/bulk";
import { defaultMinByCategory, defaultSparesRules, minByCategoryOf, minimumFor, sparesSettingsOf, toStored, type MinByCategory, type SparesRules } from "./core/sparesRules";
import type { BuyAlert } from "./core/deals";
import { normalizeRule, type FissureRule } from "./core/timers";
import type { RivenAuction, RivenMeta, RivenRaw, RivenSnap } from "./core/rivens";
import type { ImprintRaw } from "./core/imprints";
import { salesOf, tradesOf } from "./core/saleLog";
import { gearOf, noticesOf, relicRunsOf, rivenWatchOf, rivensOf, valueHistoryOf } from "./core/savedGame";
import type { GearCopy } from "./core/notNeeded";
import { NEWEST } from "./whatsNew";
import { DEFAULT_HIDE_MINUTES, type HiddenForWhisper } from "./core/lastCopy";
import { isStandIn, STAND_IN_KEY, EMPTY_CHANNEL_KEY, standInLoadError, standInSignedIn, standInStatus, type StandIn } from "./core/standIn";
import type { Invasion } from "./core/invasions";
import { choiceFromHome, fissureChoiceOf, type FissureChoice, type SyndicateMission } from "./core/board";
import type { RecipeData } from "./core/buildPlan";
import type { WorldAlert } from "./core/worldNeeds";
import type { RelicData } from "./core/relicData";
import { marketItemsOf, recipeDataOf, relicDataOf, rivenMetaOf } from "./core/shapes";
import type { Archimedea, Bundle, Calendar1999, CatalogPart, CollectionPart, DarvoDeal, Descendia, DuviriCycle, Fissure, Live, MissionState, Nightwave, SortieLike, SteelPath, VaultTraderItem, WorldEvent } from "./core/types";
import { defaultPickWeights, type PickWeights } from "./core/pick";
import type { Notice } from "./notices";
import { DEFAULT_BUILDS_MAX_AGE_DAYS, sanitizeBuilds, sanitizeMaxAgeDays, type Build } from "./core/builds/types";
import { timing, type TimingEnv } from "./timing";
import { defaultUpdates, newInstallUpdates, sanitizeUpdates, type Channel, type Install, type UpdateSettings } from "./core/updates";
import type { NoxAnswer, NoxFetcher, NoxListing, NoxPage } from "./core/builds/noxsframe";
import { meterMemoryOf } from "./core/meterMemory";


/** warframe.market's platforms: whose market MyOrbiter reads and lists on. */
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
  /**
   * Per listing (see listingKey): the price you last set or approved (core/approved.ts). Automatic
   * repricing never takes a listing under 70% of it.
   */
  approved: Record<string, number>;
  /**
   * Per listing (see listingKey): when repricing changed its price in the last day (core/drift.ts).
   * Kept, so a restart doesn't reset the cooldown: at most one change an hour and six a day.
   */
  changes: ChangeLog;
  /** The warframe.market status you last chose; MyOrbiter holds it again when it starts. Null: none. */
  presence: Presence | null;
  /**
   * Gone invisible for the rest of the day because your trades ran out: the status to go back to,
   * and when (the daily trade reset, 00:00 UTC). Null: nothing to go back to.
   */
  presenceBack?: { p: Presence; until: number } | null;
  /** How Orders' table is sorted (by name until you click a column). */
  ordersSort?: { key: OrderSortKey; desc: boolean };
  /** Nothing is listed or repriced below this many platinum, unless its category has its own minimum. */
  minPrice: number;
  /**
   * Minimums by Sell spares category, each replacing `minPrice` for things in it (relics, which
   * sell for a few platinum each and go in stacks, have a lower one by default). A category left
   * out uses `minPrice`. See core/sparesRules.ts, minimumFor.
   */
  minByCategory: MinByCategory;
  /**
   * The Relics minimum, written on every save (lightSettings) for an older build reading the same
   * file, which had only this; never read by this build once `minByCategory` is saved.
   */
  minRelicPrice?: number;
  /** Relic prices by refinement from warframe.market's sales, refreshed daily (see RelicMarket). */
  relicPrices: RelicMarket;
  /** What Sell spares lists and keeps, row by row (core/sparesRules.ts). */
  spares: SparesRules;
  /**
   * The six switches Sell spares replaced, for an older build reading the same settings file:
   * written from `spares` on every save (lightSettings), never read by this build.
   */
  bulk?: BulkRules;
  /**
   * Veiled rivens: spare only when on. Relics: spare when they sell for more than a crack is worth,
   * and never one that drops a part you still need (`relicsWorthSelling` is always on: whether
   * relics are listed is the Relics row on Sell spares now).
   */
  sellable: SellChoices;
  /** Things you sold, newest first (the last 2,000). */
  sales: Sale[];
  /** Trades read from the game log mark their listing sold and log the sale on their own (off unless turned on). */
  autoTrades: boolean;
  /** Trades already handled (session|uptime), newest first. */
  tradesSeen: string[];
  /** Trades the sale notification has looked at (session|uptime), newest first: told once, never again after a restart. */
  tradesTold: string[];
  /** Every trade from the game log, newest first. */
  trades: TradeLogEntry[];
  /** Price alerts: tell me when someone lists one of these at or under my price (Cheap buys). */
  buyAlerts: BuyAlert[];
  /** +rep on warframe.market, by trade key: "given" once the partner has your +rep, "skipped" for Not now. */
  rep: Record<string, "given" | "skipped">;
  /** The message that goes with +rep (warframe.market's reputation is a positive review). */
  repText: string;
  /** Give each trade partner +rep on warframe.market by itself, with repText, once per player (off unless turned on). */
  autoRep: boolean;
  /**
   * While someone whispers you, hide listings down to their last copy so a second buyer doesn't
   * find one already promised; each comes back after `minutes`, and only if an inventory read
   * newer than its hide still has the copy (core/lastCopy.ts). `hidden`: the ones MyOrbiter hid,
   * and when; one shown or hidden by hand leaves it.
   */
  /** optIn, not the first version's `on`: that one was on for everyone, and hid nearly every listing on any whisper. */
  lastCopy: { optIn: boolean; minutes: number; hidden: HiddenForWhisper[] };
}

export type OrderSortKey = "name" | "qty" | "price" | "total" | "cheapest" | "change";
const ORDER_SORT_KEYS: OrderSortKey[] = ["name", "qty", "price", "total", "cheapest", "change"];
/** A saved Orders sort, if it's one the table knows. */
function ordersSortOf(v: unknown): { key: OrderSortKey; desc: boolean } | undefined {
  const o = v as { key?: unknown; desc?: unknown } | null;
  return o && typeof o === "object" && ORDER_SORT_KEYS.includes(o.key as OrderSortKey) && typeof o.desc === "boolean" ? { key: o.key as OrderSortKey, desc: o.desc } : undefined;
}
/** A saved "back to this status at the reset", if it's whole: a status MyOrbiter knows and a time. */
function presenceBackOf(v: unknown): { p: Presence; until: number } | null {
  const o = v as { p?: unknown; until?: unknown } | null;
  return o && typeof o === "object" && (o.p === "invisible" || o.p === "online" || o.p === "ingame") && typeof o.until === "number" && Number.isFinite(o.until) ? { p: o.p, until: o.until } : null;
}

export const defaultMarketSettings = (): MarketSettings => ({ platform: "pc", auto: false, autoCheck: false, every: 5, minShare: 0.5, floors: {}, paused: {}, approved: {}, changes: {}, presence: null, minPrice: 10, minByCategory: defaultMinByCategory(), minRelicPrice: 3, relicPrices: {}, spares: defaultSparesRules(), bulk: defaultBulkRules(), sellable: defaultSellChoices(), sales: [], autoTrades: false, tradesSeen: [], tradesTold: [], trades: [], buyAlerts: [], rep: {}, repText: ":)", autoRep: false, lastCopy: { optIn: false, minutes: DEFAULT_HIDE_MINUTES, hidden: [] } });

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

/** What TennoScope's reward cards show, each on or off. */
export interface OverlayShow { mastered: boolean; vault: boolean; set: boolean; plat: boolean; ducats: boolean; pick: boolean }
export interface OverlaySettings {
  /** The fissure reward screen's overlay. */
  reward: boolean;
  /** Baro's Ducat Kiosk overlay. */
  kiosk: boolean;
  /** A riven being cycled: both rolls and which to keep, over the game. */
  riven: boolean;
  /** The riven key ("Ctrl+Shift+R"): pressed in game, TennoScope reads the inventory. Empty: none. */
  rivenKey: string;
  show: OverlayShow;
}
export const defaultOverlay = (): OverlaySettings => ({ reward: true, kiosk: true, riven: true, rivenKey: "", show: { mastered: true, vault: true, set: true, plat: true, ducats: true, pick: true } });

export interface Settings {
  advice: AdviceSettings;
  /** How much each thing counts when scoring reward cards. */
  pick: PickWeights;
  /** Switch to Current fissure when the reward screen opens. */
  jumpToPick: boolean;
  /** TennoScope's overlays: which show over the game, and what the reward cards show. */
  overlay: OverlaySettings;
  /** Start TennoScope (in the background) with MyOrbiter and close it with MyOrbiter. */
  /** opaqueOverlay: TennoScope's overlay on a solid background (Windows, when a transparent one is invisible). */
  tennoscope: { launch: boolean; opaqueOverlay: boolean };
  market: MarketSettings;
  dataDir: string;
  /** Custom EE.log location; empty finds it in the Steam libraries. */
  eeLog: string;
  /** Carry on without an inventory until TennoScope has read one (always so on macOS). */
  withoutInventory: boolean;
  /**
   * The first start's question was answered: whether TennoScope may read the game's memory (Full
   * mode) or only the reward screen. Asked once, before TennoScope first starts (FirstRun.svelte);
   * the answer is changed in Settings, TennoScope. An install from before the question counts as
   * asked: it chose on the setup steps.
   */
  fullModeAsked: boolean;
  /** Home's cards you turned off (Home → Customise): "market", "baro"… */
  homeHidden: string[];
  /** Which fissures Home lists: normal, Steel Path or Void Storms. */
  homeFissures: "normal" | "steel" | "storm";
  /** Home's fissure board: only the fissures your alerts match, of every kind. */
  homeFissuresOnly: boolean;
  /**
   * The column on the right of a wide window: shown or folded, what it shows, in order, and which
   * fissures its Fissures card lists (its own choice, apart from Home's board).
   */
  side: { on: boolean; cards: string[]; fissures: FissureChoice };
  /** Lines under Needs you on Home you dismissed (an alert, an invasion, a Varzia rotation). */
  homeDismissed: string[];
  /** What you get notifications for (the bell in the sidebar). */
  notify: NotifySettings;
  notifyOptions: NotifyOptions;
  /** Pages you took out of the sidebar (Settings → Pages). */
  pagesHidden: string[];
  /** The What's new entry last seen (its date); "" for none yet. */
  newsSeen: string;
  /**
   * Which tidy-ups of the sidebar have been applied (1: Planner, Market and Stats out by default,
   * Oct 2026; 2: the four sections of Nov 2026, so an order saved for the old ones is let go).
   */
  simplified: number;
  /**
   * Show details: the sentence under each figure, full page descriptions, the minor table
   * columns. Off: the pages say the essentials and the rest is on hover (lib/view.svelte.ts).
   */
  details: boolean;
  /** Home's Start here card put away (it also goes once every step is done). */
  startDone: boolean;
  /** The player has chosen Home's cards at least once (any choice, every card shown included): "Choose Home's cards" counts as done (core/homeCards.ts). */
  homeChosen: boolean;
  /** Home's chores ticked off by hand: chore → the reset the tick was for (core/chores.ts). */
  chores: Record<string, number>;
  /** The sidebar's order, when you changed it (Settings → Pages): page ids. */
  pageOrder: string[];
  /** The page MyOrbiter opens on: "last" is where you left it. */
  startPage: string;
  tab: string;
  /** The sidebar: true icons only, false with page names, null folds by itself in a narrow window. */
  folded: boolean | null;
  /** The sidebar's sections you closed (their bars fold them): section names. Absent: open. */
  sectionsClosed: string[];
  /** What each meter last showed, oldest first (core/meterMemory.ts): a changed value moves from it. */
  meters: [string, number][];
  /** The Planner's view: relics to crack for sets, or relics worth making radiant. */
  plannerMode: "sets" | "radiant";
  /** Settings layout version, for one-off moves when a default changes. */
  schema: number;
  /** Invasion rewards already announced (invasion id | part), newest first. */
  notifiedInvasions: string[];
  /** What MyOrbiter last learned about your account and has already told you. */
  game: GameState;
  /** Items you starred, by unique name. */
  favourites: string[];
  /** Fissures you want to hear about. */
  fissureRules: FissureRule[];
  /** Rivens you want: a notification when one is listed at or under your price. */
  rivenWatch: RivenWatch[];
  /** Mod and arcane loadouts: pasted, your own, MyOrbiter's suggestions (core/builds). */
  builds: Build[];
  /** Builds older than this many days are hidden (their source's date, else when added); 0: no limit. */
  buildsMaxAgeDays: number;
  /** Read an item's builds from Nox's Frame when its builds are opened (core/builds/noxsframe.ts). */
  buildsFromNox: boolean;
  /** Record timings (Settings › Logs, lib/timing.ts): off unless switched on. */
  recordTimings: boolean;
  /** Updates: the release channel, a version put off with Later, the last check (core/updates.ts). */
  updates: UpdateSettings;
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
  /** Imprints from the patched TennoScope's last read (null before one has passed them). */
  imprints: ImprintRaw[] | null;
  /** Each copy of a warframe, weapon or companion from the patched TennoScope's last read (null before one has passed them). */
  gear: GearCopy[] | null;
  /** The warframes fed to the Helminth, by path, from the same read (null before a TennoScope that passes them has). */
  consumedSuits: string[] | null;
  /** Gear you chose to keep though MyOrbiter says you don't need it (item paths). */
  keepGear: string[];
  /** Each riven's rolls as MyOrbiter has seen them (by riven id, oldest first): for before-and-after on a cycle. */
  rivenHistory: Record<string, RivenSnap[]>;
  /** Announced already (newest first, capped). */
  foundryNotified: string[];
  whispersSeen: string[];
  /** warframe.market chats already announced: chat id → its last update then. */
  chatsSeen: Record<string, string>;
  dealsNotified: string[];
  fissuresNotified: string[];
  rivensNotified: string[];
  /** Riven cycles already told about (riven, cycle and roll), so a restart doesn't tell again. */
  cyclesNotified: string[];
  /** Listings for more than you held, already told (order id | quantity listed). */
  shortNotified: string[];
  /** Inventory value over time: one point per inventory read. */
  valueHistory: ValuePoint[];
  /** Every relic reward screen, oldest first: Stats' relic runs. */
  relicRuns: RelicRun[];
  /** Parts that turned up between inventory reads, from anything but a trade (core/drops.ts). */
  drops: DropLog;
  /** The sets your loose parts were saved for at the last read, with how many complete ones you held then: one more is a set done. */
  savingFor: Record<string, { set: string; complete: number }>;
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
  /**
   * Worked out with warframe.market's item list, the relic tables and the recipes all in. Until then
   * the point is worked out again as they arrive (App.svelte).
   */
  complete?: boolean;
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
export const defaultGame = (): GameState => ({ foundryReady: [], masteryRank: null, platinum: null, credits: null, endo: null, rivens: null, imprints: null, gear: null, consumedSuits: null, keepGear: [], rivenHistory: {}, foundryNotified: [], whispersSeen: [], chatsSeen: {}, dealsNotified: [], fissuresNotified: [], rivensNotified: [], cyclesNotified: [], shortNotified: [], valueHistory: [], relicRuns: [], drops: emptyDropLog(), savingFor: {}, notices: [], worldNotified: [] });

export interface NotifySettings {
  /** The reward screen opened: which card to take. */
  reward: boolean;
  /** Listing problems: a listing outgrew what you hold, a change refused, the sign-in expired. */
  market: boolean;
  /** A trade in game sold one of your listings (marked sold and logged). */
  sold: boolean;
  /** A set your loose parts were saved for is complete and can be sold. */
  setDone: boolean;
  /** Apply automatically moved listings to the market price. */
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
  /** A riven you're cycling: which roll to keep. */
  cycle: boolean;
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
export const defaultNotify = (): NotifySettings => ({ reward: true, market: true, sold: true, setDone: true, repriced: true, tennoscope: true, invasions: true, foundry: true, whispers: true, deals: true, fissures: true, rivens: true, cycle: true, wishlist: true, siteChat: true, alerts: true, alertLoot: true, baro: true, varzia: true, circuit: true });

/** How notifications reach you, whatever they're about. */
export interface NotifyOptions {
  /** Paused: notifications still go in the history, but nothing pops up. */
  paused: boolean;
  /** Paused until then (ms), for "an hour" or "until tomorrow"; null: not paused for a while. */
  pausedUntil: number | null;
  /** Which of the two that was, so the panel lights its button. */
  pausedHow?: "hour" | "tomorrow" | null;
  /** While you're looking at MyOrbiter: a pop-up in its window. */
  toasts: boolean;
  /** While you're not: your desktop's notifications. */
  desktop: boolean;
  /** Nothing pops up while you're in a fissure, but the reward to take. */
  quietInFissure: boolean;
  /** Kinds that only go in the history, never pop up. */
  quiet: string[];
  /** A Discord webhook the chosen kinds also go to, for when you're away from the PC. "" = none. */
  discord: { url: string; kinds: string[] };
}
export const DISCORD_DEFAULT_KINDS = ["rivens", "deals", "fissures", "whispers", "sold"];
export const defaultNotifyOptions = (): NotifyOptions => ({ paused: false, pausedUntil: null, toasts: true, desktop: true, quietInFissure: false, quiet: [], discord: { url: "", kinds: DISCORD_DEFAULT_KINDS } });
/** A Discord webhook address, and nothing else: MyOrbiter only ever posts to one of these. */
export const isDiscordWebhook = (url: string) => /^https:\/\/(?:(?:ptb\.|canary\.)?discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url.trim());
/**
 * Whether MyOrbiter may post to this Discord address: true once confirmed. A new one is asked about
 * in a window of MyOrbiter's own (not the page); false when the answer was no, or another question
 * is open. Called while the player is there: when an address is pasted, and as MyOrbiter starts.
 */
export async function discordConfirm(url: string): Promise<boolean> {
  if (!isDiscordWebhook(url)) return false;
  return inTauri ? invoke<boolean>("discord_confirm", { url: url.trim() }) : true;
}

/**
 * What the Discord address field does with its value: an empty or blank field removes the
 * confirmed address at once (on input, and again when the field changes or is left); a webhook
 * address is asked about when the field is left (its change event, or focus out, which also
 * covers an address taken out and put back unchanged), never while it is typed or pasted; and
 * anything else does neither. Asking about the address already confirmed reads one file and shows
 * no dialog.
 */
export function discordFieldAction(value: string, event: "input" | "change" | "blur"): "forget" | "confirm" | "none" {
  if (value.trim() === "") return "forget";
  return event !== "input" && isDiscordWebhook(value) ? "confirm" : "none";
}

/**
 * The Discord address field emptied: the confirmed address leaves MyOrbiter's config folder.
 * `field` is the field's value; nothing is removed unless it is empty.
 */
export async function discordForget(field: string): Promise<void> {
  if (field.trim() !== "") return;
  if (inTauri) await invoke("discord_forget", { field });
}

/** Posts a notification to your Discord webhook. */
export async function discordPost(url: string, content: string): Promise<void> {
  if (!isDiscordWebhook(url)) throw new Error("Not a Discord webhook address");
  if (inTauri) await invoke("discord_post", { url: url.trim(), content });
}

export const defaultSettings = (): Settings => ({
  advice: defaultAdvice(),
  market: defaultMarketSettings(),
  pick: defaultPickWeights(),
  jumpToPick: true,
  overlay: defaultOverlay(),
  tennoscope: { launch: true, opaqueOverlay: false },
  dataDir: "",
  eeLog: "",
  withoutInventory: false,
  fullModeAsked: false,
  homeHidden: [],
  homeFissures: "normal",
  homeFissuresOnly: false,
  side: { on: true, cards: ["alerts", "fissures", "clocks", "foundry", "bounties"], fissures: choiceFromHome("normal", false) },
  homeDismissed: [],
  notify: defaultNotify(),
  notifyOptions: defaultNotifyOptions(),
  pagesHidden: ["planner", "browse", "stats"],
  newsSeen: NEWEST,
  simplified: 2,
  details: false,
  chores: {},
  startDone: false,
  homeChosen: false,
  pageOrder: [],
  startPage: "last",
  tab: "home",
  folded: null,
  sectionsClosed: [],
  meters: [],
  plannerMode: "sets",
  schema: 2,
  notifiedInvasions: [],
  game: defaultGame(),
  favourites: [],
  fissureRules: [],
  rivenWatch: [],
  builds: [],
  buildsMaxAgeDays: DEFAULT_BUILDS_MAX_AGE_DAYS,
  buildsFromNox: true,
  recordTimings: false,
  updates: defaultUpdates(),
});

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** Set by vite.config.ts: true only on the demo dev server (MYORBITER_DEMO=1), false in a build and in `npm run dev`. */
declare const __MYORBITER_DEMO__: boolean | undefined;
const inDemo = !inTauri && typeof __MYORBITER_DEMO__ !== "undefined" && __MYORBITER_DEMO__ === true;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  // Record timings: each command's round trip, by name only (never its arguments or answer).
  const t0 = timing.on ? performance.now() : 0;
  let ok = false;
  try {
    const out = await invoke<T>(cmd, args);
    ok = true;
    return out;
  } catch (e) {
    // A warframe.market request held back until a time warframe.market gave: that time as the
    // clock shows it (core/marketWait.ts). Any other error goes on as it came.
    const until = typeof e === "string" ? deferredUntil(e) : null;
    if (until != null) {
      marketWaitUntil = Math.max(marketWaitUntil, until);
      throw waitWords(e as string);
    }
    throw e;
  } finally {
    // The recorder's own (its minute line in the log, its report) are listed apart.
    if (t0) timing.command(cmd, performance.now() - t0, ok, cmd.startsWith("timing_") || (cmd === "log_line" && args?.area === "timings"));
  }
}

/** The latest time warframe.market asked MyOrbiter to wait until (unix ms; 0: never asked). */
let marketWaitUntil = 0;
/** How long until warframe.market's last "wait until" is over, in ms (0 when it is). */
export const marketWaitLeft = (now = Date.now()) => Math.max(0, marketWaitUntil - now);

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

/** No inventory and no item data: MyOrbiter before TennoScope has read anything (or on a Mac). */
export const emptyBundle = (): Bundle => ({ observed_at: null, inventory: [], catalog: [], relics: [], prices: null });

/** TennoScope runs but hasn't read an inventory yet. */
export const NO_INVENTORY_YET = "No inventory read yet";

/**
 * A read that failed because there's nothing there yet, not because something broke: no folder,
 * no item data downloaded yet ("not found at", from the desktop app on every system; os errors 2
 * and 3 are Linux's and Windows' missing file or folder, from an older build), no inventory read.
 */
export const nothingYet = (e: string) => /not found at|No dev bundle|HOME is not set|os error [23]\b|No inventory read yet/i.test(e);

/** Browser dev mode: the catalogs of the last read and the file version they came from. */
let devCatalogs: { tag: string; catalog: Bundle["catalog"]; relics: Bundle["relics"] } | null = null;

export async function loadBundle(dataDir: string): Promise<Bundle> {
  if (inTauri) return tauriBundle(dataDir);
  const stand = demoStandIn();
  if (stand) throw new Error(standInLoadError(stand));
  // The browser dev mode reads the whole bundle from one file. While the file is the same, its
  // catalogs stay the objects read last, as the desktop app keeps them across syncs (bundleLoader):
  // what's worked out from them alone is then kept too (model.ts), here as there.
  const res = await fetch("/dev-bundle.json");
  if (!res.ok) throw new Error("No dev bundle. Run `npm run dev-bundle` first.");
  const read: Bundle = await res.json();
  const tag = res.headers.get("etag");
  if (tag && devCatalogs?.tag === tag) return { ...read, catalog: devCatalogs.catalog, relics: devCatalogs.relics };
  devCatalogs = tag ? { tag, catalog: read.catalog, relics: read.relics } : null;
  return read;
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

/**
 * A new worldstate read over the last one: a part the new read lacks (null) keeps its last value,
 * for the parts that stay right for a while (Baro's visit, Varzia, the cycles, which count on from
 * there, the week's Sortie and Nightwave). Alerts, invasions and Darvo's deal don't: an old one
 * would mislead.
 */
const KEEP_LIVE = new Set(["fissures", "baro", "resurgence", "resurgenceExpiry", "cycles", "sortie", "archonHunt", "steelPath", "nightwave", "duviriCycle", "syndicates", "events", "archimedeas", "calendar", "descendia"]);
export function mergeLive(old: Live, next: Live, now = Date.now()): Live {
  const out = { ...next } as Record<string, unknown>;
  for (const [k, v] of Object.entries(old)) {
    if (!KEEP_LIVE.has(k)) continue;
    // Something with an end that has passed (last week's Circuit, yesterday's Teshin offer) isn't kept.
    const ends = k === "duviriCycle" ? circuitEnds(v as DuviriCycle) : v && typeof v === "object" && !Array.isArray(v) ? (v as { expiry?: string }).expiry : undefined;
    if (ends && Date.parse(ends) <= now) continue;
    const n = out[k];
    // Clocks by place: one the new read lacks (the game's own file has no Zariman clock) keeps
    // its last reading, which the page rolls forward.
    if (k === "cycles" && Array.isArray(n) && Array.isArray(v)) {
      const have = new Set((n as { key: string }[]).map((c) => c.key));
      out[k] = [...n, ...(v as { key: string }[]).filter((c) => !have.has(c.key))];
    } else if (n == null) out[k] = v;
  }
  return pruneLive(out as unknown as Live, now);
}

/**
 * The worldstate without what has ended: each fissure, alert, bounty rotation, Nightwave act,
 * Sortie, Baro's visit, Varzia's stock and Darvo's deal goes at its own end time, so a kept read
 * never shows something gone by. The clocks stay: the pages count them on from their last reading.
 * The same object when nothing has ended.
 */
export function pruneLive(live: Live, now = Date.now()): Live {
  const over = (end: string | undefined | null) => typeof end === "string" && Date.parse(end) <= now;
  const out: Live = { ...live };
  let changed = false;
  const list = <T extends { expiry?: string }>(k: "fissures" | "alerts" | "syndicates" | "events" | "archimedeas") => {
    const xs = live[k] as T[] | null | undefined;
    if (!Array.isArray(xs)) return;
    const kept = xs.filter((x) => !over(x?.expiry));
    if (kept.length !== xs.length) {
      (out as unknown as Record<string, unknown>)[k] = kept;
      changed = true;
    }
  };
  list("fissures");
  list("alerts");
  list("syndicates");
  list("events");
  list("archimedeas");
  for (const k of ["baro", "sortie", "archonHunt", "steelPath", "darvo", "nightwave", "calendar", "descendia"] as const) {
    if (over((live[k] as { expiry?: string } | null | undefined)?.expiry)) {
      out[k] = null;
      changed = true;
    }
  }
  // The Circuit's picks last the week; its expiry is only the current mood's end, two hours on.
  if (live.duviriCycle && over(circuitEnds(live.duviriCycle))) {
    out.duviriCycle = null;
    changed = true;
  }
  // Invasions kept from last time say nothing of when they end: an hour after that read, they go.
  if (live.invasions && live.invasionsAt != null && now - live.invasionsAt > 3_600_000) {
    out.invasions = null;
    out.invasionsAt = undefined;
    changed = true;
  }
  const nw = out.nightwave;
  if (nw && Array.isArray(nw.activeChallenges) && nw.activeChallenges.some((c) => over(c.expiry))) {
    out.nightwave = { ...nw, activeChallenges: nw.activeChallenges.filter((c) => !over(c.expiry)) };
    changed = true;
  }
  // Varzia's stock goes with its end: kept past it, Home would count down to a time gone by.
  if (over(live.resurgenceExpiry)) {
    out.resurgence = null;
    out.resurgenceExpiry = null;
    changed = true;
  }
  return changed ? out : live;
}

/** When the Circuit's weekly picks change: the Monday 00:00 UTC after the reading (its mood began two hours before its expiry). */
export function circuitEnds(c: DuviriCycle | null | undefined): string | undefined {
  if (!c) return undefined;
  const from = Date.parse(c.activation ?? "") || Date.parse(c.expiry) - 2 * 3_600_000;
  if (!Number.isFinite(from)) return undefined;
  const d = new Date(from);
  const days = (8 - d.getUTCDay()) % 7 || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days)).toISOString();
}

/** The worldstate as it was last read, kept for the next start. */
export interface SavedLive {
  at: number;
  live: Live;
}

/**
 * A kept worldstate read, with what has ended since taken out (see pruneLive). Invasions say
 * nothing of when they end, so they're kept only an hour; anything a day old isn't used at all.
 */
export function restoreLive(raw: unknown, now = Date.now()): SavedLive | null {
  const s = raw as SavedLive | null;
  if (!s || typeof s.at !== "number" || !s.live || typeof s.live !== "object" || now - s.at > 86_400_000 || s.at > now + 60_000) return null;
  const live = pruneLive({ ...s.live, invasions: s.live.invasions ?? null, invasionsAt: s.at }, now);
  return { at: s.at, live };
}

export async function loadLive(): Promise<Live> {
  let raw: Record<string, unknown> | null = null;
  try {
    if (inTauri) raw = await invoke("worldstate");
    // The demo (npm run dev:demo, the screenshots, the help-picture check, the sweep): its own
    // invented world state, demo/dev-worldstate.json, so every run sees the same world, online or
    // not; no world-state service is asked.
    else if (inDemo) raw = await fetch("/dev-worldstate.json").then((r) => (r.ok ? r.json() : null));
    else {
      const get = (p: string) => fetch(`https://api.warframestat.us/pc/${p}?language=en`).then((r) => r.json()).catch(() => null);
      const names = ["fissures", "vaultTrader", "voidTrader", "invasions", "nightwave", "sortie", "archonHunt", "steelPath", "duviriCycle", "earthCycle", "cetusCycle", "vallisCycle", "cambionCycle", "zarimanCycle", "alerts", "dailyDeals", "syndicateMissions", "events", "archimedeas", "calendar", "descendia"];
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
    syndicates: Array.isArray(raw?.syndicateMissions) ? (raw!.syndicateMissions as SyndicateMission[]) : null,
    events: Array.isArray(raw?.events) ? (raw!.events as WorldEvent[]).filter((e) => e && typeof e.description === "string" && typeof e.expiry === "string") : null,
    fromGame: raw?.fromGame === true,
    nightwave: obj<Nightwave>(raw?.nightwave, "activeChallenges"),
    sortie: obj<SortieLike>(raw?.sortie, "boss"),
    archonHunt: obj<SortieLike>(raw?.archonHunt, "boss"),
    steelPath: obj<SteelPath>(raw?.steelPath, "currentReward"),
    archimedeas: Array.isArray(raw?.archimedeas) ? (raw!.archimedeas as Archimedea[]).filter((a) => a && typeof a.expiry === "string") : null,
    calendar: obj<Calendar1999>(raw?.calendar, "days"),
    descendia: obj<Descendia>(raw?.descendia, "challenges"),
    darvo: Array.isArray(raw?.dailyDeals) ? ((raw!.dailyDeals as DarvoDeal[]).find((d) => d && typeof d.item === "string" && typeof d.salePrice === "number") ?? null) : null,
    duviriCycle: obj<DuviriCycle>(raw?.duviriCycle, "choices"),
    cycles: (["earth", "cetus", "vallis", "cambion", "zariman", "duviri"] as const)
      .map((k) => ({ key: k, c: obj<{ state: string; expiry: string }>(raw?.[`${k}Cycle`], "state") }))
      .filter((x): x is { key: (typeof x)["key"]; c: { state: string; expiry: string } } => !!x.c?.expiry)
      .map((x) => ({ key: x.key, state: x.c.state, expiry: x.c.expiry })),
    baro: (raw?.voidTrader as { activation?: string; expiry?: string; location?: string } | null)?.activation
      ? (raw!.voidTrader as { activation: string; expiry: string; location: string })
      : null,
  };
}

/**
 * What MyOrbiter last read from the network, kept for its next start so pages show it at once and
 * update as new reads come in: your rivens' price checks, the worldstate, last week's riven trades.
 * Null when nothing was kept (or it can't be read). In the browser, kept in localStorage.
 */
export type SavedName = "riven-prices" | "worldstate" | "riven-trades";
export const saved = {
  read: async (name: SavedName): Promise<unknown> => {
    try {
      return inTauri ? await invoke("saved_read", { name }) : JSON.parse(localStorage.getItem(`orbiter-saved-${name}`) ?? "null");
    } catch {
      return null;
    }
  },
  write: async (name: SavedName, value: unknown): Promise<void> => {
    if (inTauri) await invoke("saved_write", { name, value });
    else localStorage.setItem(`orbiter-saved-${name}`, JSON.stringify(value));
  },
};

/** Saves a CSV export in Downloads; where it went. In the browser, a download instead. */
export async function exportFile(what: string, text: string): Promise<string> {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (inTauri) return invoke<string>("export_file", { what, text, day });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = `myorbiter-${what}.csv`;
  a.click();
  return a.download;
}

/** Every Foundry recipe, parts' own blueprints included (recipes.rs). Null when it can't be read. */
export async function recipeData(): Promise<RecipeData | null> {
  try {
    if (inTauri) return recipeDataOf(await invoke<unknown>("recipe_data"));
    const res = await fetch("/dev-recipe-data.json");
    return res.ok ? recipeDataOf(await res.json()) : null;
  } catch {
    return null;
  }
}

/**
 * The official drop tables' relics (relicdata.rs): cached for half a day, `force` checks now.
 * Null when they can't be read and nothing was kept; the relic list is then TennoScope's alone.
 */
export async function relicData(force = false): Promise<RelicData | null> {
  try {
    if (inTauri) return relicDataOf(await invoke<unknown>("relic_data", { force }));
    const res = await fetch("/dev-relic-data.json");
    return res.ok ? relicDataOf(await res.json()) : null;
  } catch {
    return null;
  }
}

/** A finite number in [lo, hi], or `fallback` (a damaged settings file: a string, NaN, a huge number). */
const numIn = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback);

/**
 * The settings that decide what's listed and repriced by itself, and how low, read from a saved
 * file strictly: anything but `true` leaves automatic repricing, checking and hiding off, and a
 * value that isn't a number in range is the usual one, never a missing floor.
 */
function marketSafetyOf(raw: unknown, base: MarketSettings): Pick<MarketSettings, "auto" | "minPrice" | "minByCategory" | "minRelicPrice" | "minShare" | "every" | "floors" | "paused" | "changes" | "autoTrades" | "autoRep" | "presence"> {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>) : []);
  return {
    auto: r.auto === true,
    minPrice: Math.round(numIn(r.minPrice, 1, 100_000, base.minPrice)),
    // Per category: only known ones, each a minimum in range; an old file's relic minimum moves in.
    minByCategory: minByCategoryOf(r),
    minRelicPrice: undefined,
    minShare: numIn(r.minShare, 0, 1, base.minShare),
    every: numIn(r.every, 1, 24 * 60, base.every),
    floors: Object.fromEntries(record(r.floors).filter(([, v]) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100_000)) as Record<string, number>,
    paused: Object.fromEntries(record(r.paused).filter(([, v]) => v === true)) as Record<string, boolean>,
    // Repricing's recent changes: only real times of the last day count (never a reason to change sooner).
    changes: changesOf(r.changes, Date.now()),
    // Automatic actions on warframe.market: on only when a file says true. A missing key is off,
    // whatever the defaults were when the file was written (they were on until 2026-11).
    autoTrades: r.autoTrades === true,
    autoRep: r.autoRep === true,
    presence: r.presence === "invisible" || r.presence === "online" || r.presence === "ingame" ? r.presence : null,
  };
}

/** Ducat and selling advice from a saved file: each number in range, or the usual one. */
function adviceOf(raw: unknown, base: AdviceSettings): AdviceSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    ...base,
    ...r,
    platPerDucat: numIn(r.platPerDucat, 0, 100, base.platPerDucat),
    minPlat: numIn(r.minPlat, 0, 100_000, base.minPlat),
    slowBelow: numIn(r.slowBelow, 0, 10_000, base.slowBelow),
    squad: Math.round(numIn(r.squad, 1, 4, base.squad)),
    maxMissing: Math.round(numIn(r.maxMissing, 0, 50, base.maxMissing)),
    vosforLens: r.vosforLens === "market" ? "market" : "need",
  } as AdviceSettings;
}

export async function loadSettings(): Promise<Settings> {
  let raw: Partial<Settings> | null = null;
  /** No settings file at all: a new install. */
  let fresh = false;
  if (inTauri) {
    // A file briefly held by something else (an antivirus, a backup): tried a few times. Still
    // unreadable, MyOrbiter runs on defaults but never saves over the file (see flushSettings).
    for (let i = 0; ; i++) {
      try {
        const loaded = await invoke<{ settings: Partial<Settings> | null; page: number; fresh?: boolean }>("load_settings");
        // A reply without a page token can't be saved to: taken as unreadable, so nothing is
        // saved over the file.
        if (typeof loaded?.page !== "number" || !("settings" in loaded)) throw new Error("load_settings gave an unexpected reply");
        raw = loaded.settings;
        fresh = loaded.fresh === true;
        savePage = loaded.page;
        break;
      } catch (e) {
        if (i >= 4) {
          loadFailed = String(e).replace(/^Error:\s*/, "");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } else {
    try {
      const saved = localStorage.getItem("orbiter-settings");
      fresh = saved == null;
      raw = JSON.parse(saved ?? "null");
    } catch {
      raw = null;
    }
  }
  const base = defaultSettings();
  // A file that isn't a settings object at all (a number, a list, text): the usual settings.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = null;
  // Schema 2: cracking alone became the default for Relics and Planner alike.
  if (raw && (raw.schema ?? 1) < 2 && raw.advice && typeof raw.advice === "object") raw.advice.squad = 1;
  // `view` was never used; settings saved before it went still carry it.
  if (raw) delete (raw as { view?: unknown }).view;
  // Arcane tiers were taken out: settings saved with them drop them.
  if (raw) delete (raw as { tiers?: unknown }).tiers;
  // TennoScope's program is chosen in a native dialog and kept by MyOrbiter itself: an old path the
  // page saved is dropped rather than carried along (into exports and bug reports).
  if (raw?.tennoscope && typeof raw.tennoscope === "object") delete (raw.tennoscope as { path?: unknown }).path;
  const homeFissures: Settings["homeFissures"] = raw?.homeFissures === "steel" || raw?.homeFissures === "storm" ? raw.homeFissures : "normal";
  const homeFissuresOnly = raw?.homeFissuresOnly === true;
  return {
    ...base,
    ...(raw ?? {}),
    folded: typeof raw?.folded === "boolean" ? raw.folded : null,
    // Only the four sections' names, once each: anything else is dropped.
    sectionsClosed: Array.isArray(raw?.sectionsClosed) ? [...new Set(raw.sectionsClosed.filter((k: unknown): k is string => typeof k === "string" && SECTION_NAMES.includes(k)))] : [],
    // Pairs of a short key and a number only, each key once, at most METER_CAP.
    meters: meterMemoryOf(raw?.meters),
    withoutInventory: raw?.withoutInventory === true,
    // A first start (no settings yet) asks; settings from before the question don't.
    fullModeAsked: raw ? raw.fullModeAsked !== false : false,
    homeDismissed: Array.isArray(raw?.homeDismissed) ? raw.homeDismissed.filter((k: unknown): k is string => typeof k === "string") : [],
    side: {
      on: raw?.side?.on !== false,
      cards: Array.isArray(raw?.side?.cards) ? raw.side.cards.filter((k: unknown): k is string => typeof k === "string") : base.side.cards,
      // The Fissures card's own choice; a file from before it (or a part of it that isn't valid)
      // starts from what the card showed then: Home's board's kind and its Only my alerts.
      fissures: fissureChoiceOf(raw?.side?.fissures, choiceFromHome(homeFissures, homeFissuresOnly)),
    },
    homeFissures,
    homeFissuresOnly,
    details: raw?.details === true,
    startDone: raw?.startDone === true,
    homeChosen: raw?.homeChosen === true,
    chores: raw?.chores && typeof raw.chores === "object" && !Array.isArray(raw.chores) ? Object.fromEntries(Object.entries(raw.chores).filter(([, v]) => typeof v === "number" && v > Date.now())) as Record<string, number> : {},
    homeHidden: Array.isArray(raw?.homeHidden) ? raw.homeHidden.filter((k: unknown): k is string => typeof k === "string") : [],
    plannerMode: raw?.plannerMode === "radiant" ? "radiant" : "sets",
    // Sell spares' choices: version 2, or the old switches (and the old relic setting) migrated.
    market: { ...base.market, ...(raw?.market ?? {}), spares: sparesSettingsOf(raw?.market), bulk: undefined, sellable: { veiledRivens: raw?.market?.sellable?.veiledRivens === true, relicsWorthSelling: true, saveForSets: raw?.market?.sellable?.saveForSets !== false }, sales: salesOf(raw?.market?.sales), tradesSeen: Array.isArray(raw?.market?.tradesSeen) ? raw.market.tradesSeen : [], tradesTold: Array.isArray(raw?.market?.tradesTold) ? raw.market.tradesTold.filter((k: unknown): k is string => typeof k === "string") : [], trades: tradesOf(raw?.market?.trades), buyAlerts: Array.isArray(raw?.market?.buyAlerts) ? raw.market.buyAlerts.filter((a: unknown): a is BuyAlert => !!a && typeof (a as BuyAlert).name === "string" && typeof (a as BuyAlert).maxPrice === "number") : [], rep: raw?.market?.rep && typeof raw.market.rep === "object" ? Object.fromEntries(Object.entries(raw.market.rep).filter(([, v]) => v === "given" || v === "skipped")) : {}, platform: raw?.market?.platform && raw.market.platform in PLATFORM_LABEL ? raw.market.platform : "pc", autoCheck: typeof raw?.market?.autoCheck === "boolean" ? raw.market.autoCheck : raw?.market?.auto === true, relicPrices: raw?.market?.relicPrices && typeof raw.market.relicPrices === "object" && !Array.isArray(raw.market.relicPrices) ? raw.market.relicPrices : {}, repText: typeof raw?.market?.repText === "string" && raw.market.repText.trim() && raw.market.repText !== "Smooth trade, thanks!" ? raw.market.repText : ":)", lastCopy: { optIn: raw?.market?.lastCopy?.optIn === true, minutes: typeof raw?.market?.lastCopy?.minutes === "number" && raw.market.lastCopy.minutes >= 1 ? Math.round(raw.market.lastCopy.minutes) : DEFAULT_HIDE_MINUTES, hidden: Array.isArray(raw?.market?.lastCopy?.hidden) ? raw.market.lastCopy.hidden.filter((h: unknown): h is HiddenForWhisper => !!h && typeof (h as HiddenForWhisper).id === "string" && typeof (h as HiddenForWhisper).at === "number") : [] } , presenceBack: presenceBackOf(raw?.market?.presenceBack), ordersSort: ordersSortOf(raw?.market?.ordersSort), approved: approvedOf(raw?.market?.approved), ...marketSafetyOf(raw?.market, base.market) },
    advice: adviceOf(raw?.advice, base.advice),
    // `forma` came later: settings saved before it get the default (3p).
    pick: { ...base.pick, ...(raw?.pick ?? {}), forma: typeof raw?.pick?.forma === "number" && Number.isFinite(raw.pick.forma) && raw.pick.forma >= 0 ? raw.pick.forma : base.pick.forma },
    overlay: { reward: raw?.overlay?.reward !== false, kiosk: raw?.overlay?.kiosk !== false, riven: raw?.overlay?.riven !== false, rivenKey: typeof raw?.overlay?.rivenKey === "string" ? raw.overlay.rivenKey.slice(0, 40) : "", show: { ...base.overlay.show, ...(raw?.overlay?.show ?? {}) } },
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
      discord: {
        url: typeof raw?.notifyOptions?.discord?.url === "string" ? raw.notifyOptions.discord.url : "",
        kinds: Array.isArray(raw?.notifyOptions?.discord?.kinds) ? raw.notifyOptions.discord.kinds.filter((k: unknown): k is string => typeof k === "string") : DISCORD_DEFAULT_KINDS,
      },
    },
    // Once: the pages most people rarely open leave the sidebar (Settings → Pages puts them back).
    // Someone who had MyOrbiter before this was kept: everything is new to them. A first start: nothing is.
    newsSeen: typeof raw?.newsSeen === "string" ? raw.newsSeen : raw ? "" : NEWEST,
    pagesHidden: (() => {
      const had: string[] = Array.isArray(raw?.pagesHidden) ? raw.pagesHidden.filter((k: unknown): k is string => typeof k === "string") : [];
      return raw && (raw.simplified ?? 0) < 1 ? [...new Set([...had, "planner", "browse", "stats"])] : raw ? had : base.pagesHidden;
    })(),
    simplified: 2,
    // An order saved for the old sections would scatter the new ones: once, the sidebar starts fresh.
    pageOrder: raw && (raw.simplified ?? 0) < 2 ? [] : withPage(Array.isArray(raw?.pageOrder) ? raw.pageOrder.filter((k: unknown): k is string => typeof k === "string") : [], "spares", "market"),
    startPage: typeof raw?.startPage === "string" && raw.startPage ? raw.startPage : "last",
    schema: base.schema,
    notifiedInvasions: Array.isArray(raw?.notifiedInvasions) ? raw.notifiedInvasions : [],
    game: { ...defaultGame(), ...(raw?.game ?? {}), relicRuns: relicRunsOf(raw?.game?.relicRuns), drops: raw?.game?.drops && typeof raw.game.drops.at === "number" && raw.game.drops.counts && Array.isArray(raw.game.drops.windows) ? raw.game.drops : emptyDropLog(), savingFor: raw?.game?.savingFor && typeof raw.game.savingFor === "object" && !Array.isArray(raw.game.savingFor) ? raw.game.savingFor : {}, notices: noticesOf(raw?.game?.notices), worldNotified: Array.isArray(raw?.game?.worldNotified) ? raw.game.worldNotified : [], keepGear: Array.isArray(raw?.game?.keepGear) ? raw.game.keepGear.filter((x: unknown) => typeof x === "string") : [], gear: gearOf(raw?.game?.gear), rivens: rivensOf(raw?.game?.rivens), valueHistory: valueHistoryOf(raw?.game?.valueHistory), imprints: Array.isArray(raw?.game?.imprints) ? raw.game.imprints.filter((x: unknown) => !!x && typeof x === "object" && !Array.isArray(x)) : null, consumedSuits: Array.isArray(raw?.game?.consumedSuits) ? raw.game.consumedSuits.filter((x: unknown) => typeof x === "string") : null },
    favourites: Array.isArray(raw?.favourites) ? raw.favourites : [],
    fissureRules: Array.isArray(raw?.fissureRules) ? raw.fissureRules.map(normalizeRule).filter((r: FissureRule | null): r is FissureRule => !!r) : [],
    rivenWatch: rivenWatchOf(raw?.rivenWatch),
    // Settings from before builds get none, and the one-year age limit.
    builds: sanitizeBuilds(raw?.builds),
    buildsMaxAgeDays: sanitizeMaxAgeDays(raw?.buildsMaxAgeDays),
    // On unless turned off.
    buildsFromNox: raw?.buildsFromNox !== false,
    // Off unless switched on.
    recordTimings: raw?.recordTimings === true,
    // Settings from before updates: Stable, never checked. A new install (no settings file at all;
    // not a damaged one moved aside, nor one that couldn't be read): the channel its build came
    // from, once that's known (updates.svelte.ts).
    updates: raw ? sanitizeUpdates(raw.updates) : fresh ? newInstallUpdates() : defaultUpdates(),
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
  ["game", "drops"],
  ["game", "notices"],
] as const;
export type HeavyKey = `${(typeof HEAVY_SETTINGS)[number][0]}.${(typeof HEAVY_SETTINGS)[number][1]}`;

/**
 * A page added since the sidebar order was saved goes in right after its neighbour (Sell spares
 * after Orders), where the usual order has it; with no order saved, the usual order has it anyway.
 */
export function withPage(order: string[], page: string, after: string): string[] {
  if (!order.length || order.includes(page)) return order;
  const i = order.indexOf(after);
  return i < 0 ? [...order, page] : [...order.slice(0, i + 1), page, ...order.slice(i + 1)];
}

/** The settings without the heavy parts (shallow copies; nothing is deep-read). */
export function lightSettings(s: Settings) {
  return {
    ...s,
    // The old switches beside Sell spares' choices, and the old relic minimum, for an older build (sparesRules.ts).
    market: { ...s.market, ...(s.market.spares ? toStored(s.market.spares) : {}), minRelicPrice: minimumFor(s.market, "relics"), sales: undefined, trades: undefined, relicPrices: undefined },
    game: { ...s.game, valueHistory: undefined, rivenHistory: undefined, relicRuns: undefined, drops: undefined, notices: undefined },
  };
}

/**
 * Puts the settings back together from their serialized parts. `kept`: each long log as last read
 * back from its text, read back again only once its text changed. A save follows every change (a
 * page switch saves the page), and reading every log back each time made thousands of objects
 * per switch for the garbage collector. What's read back is only serialized, never changed.
 */
export function joinSettings(light: string, heavy: Partial<Record<HeavyKey, string>>, kept?: Map<HeavyKey, { text: string; value: unknown }>): Settings {
  const s = JSON.parse(light) as Record<string, Record<string, unknown>>;
  for (const [a, b] of HEAVY_SETTINGS) {
    const key: HeavyKey = `${a}.${b}`;
    const text = heavy[key];
    if (text === undefined) continue;
    let hit = kept?.get(key);
    if (!hit || hit.text !== text) {
      hit = { text, value: JSON.parse(text) };
      kept?.set(key, hit);
    }
    s[a][b] = hit.value;
  }
  return s as unknown as Settings;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Each save's number, so the app writes them in the order they were made. */
let saveRev = 0;
/** The token load_settings gave this page: the app drops saves from a page that has since reloaded. */
let savePage = 0;
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
  // Your saved settings couldn't be read: saving now would replace them (sales, floors) with these.
  if (loadFailed) {
    saveFailed = true;
    saveListener?.(`MyOrbiter couldn't read your saved settings (${loadFailed}), so it won't save over them. Restart MyOrbiter`);
    return;
  }
  try {
    const s = get();
    if (inTauri) await invoke("save_settings", { settings: s, page: savePage, rev: ++saveRev });
    else localStorage.setItem("orbiter-settings", JSON.stringify(s));
    if (saveFailed) {
      saveFailed = false;
      saveListener?.(null);
    }
  } catch (e) {
    console.error("saving settings failed", e);
    saveFailed = true;
    saveListener?.(String(e).replace(/^Error:\s*/, ""));
    // Tried again shortly (a file briefly locked, a full disk freed up), unless a newer save came in.
    if (!pendingSave) {
      pendingSave = get;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSettings, 15_000);
    }
  }
}

let saveFailed = false;
/** Why the saved settings couldn't be read at start, if they couldn't: nothing is saved then. */
let loadFailed: string | null = null;
let saveListener: ((error: string | null) => void) | null = null;
/** Told when saving settings fails (the error), and when a save goes through again (null). */
export function onSaveTrouble(f: (error: string | null) => void) {
  saveListener = f;
}
/** Whether the saved settings couldn't be read at start (then nothing is saved, so nothing is asked). */
export const settingsUnreadable = () => loadFailed != null;

/**
 * Opens a link MyOrbiter has already checked (`openable` in core/links.ts) in your browser: the
 * app opens it (link.rs, which checks it again), on Linux without the AppImage's libraries, which a
 * browser started through the opener plugin inherited. Rejects with the reason when it couldn't.
 * Pages open links with `openUrl` (links.svelte.ts), which checks them and says how it went.
 */
export const linkOpener = {
  open: async (safe: string): Promise<void> => {
    if (inTauri) return invoke<void>("open_link", { url: safe });
    window.open(safe, "_blank", "noopener");
  },
};

/** warframe.market URL slug for an item name. */
export const marketUrl = (name: string) =>
  `https://warframe.market/items/${name.toLowerCase().replace(/&/g, "and").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

export const wikiUrl = (name: string) => `https://wiki.warframe.com/w/${encodeURIComponent(name.replace(/ /g, "_"))}`;

/** The squad's relics from EE.log. `null` when the log isn't found. In the browser dev mode it
 * reads public/dev-mission.json if present. */
export interface TennoscopeStatus {
  /** The program MyOrbiter would start, if found. */
  binary: string | null;
  /** The program chosen in Settings, if one is. */
  custom?: string | null;
  /** That program is the TennoScope that comes inside MyOrbiter. */
  bundled?: boolean;
  /** TennoScope runs on this system (it doesn't on macOS). */
  supported?: boolean;
  running: boolean;
  started_by_myorbiter: boolean;
  /** What a patched TennoScope last reported, while fresh. */
  report: TennoscopeReport | null;
  /** How MyOrbiter handles a TennoScope that ended by itself: starts in a row that each ended soon, whether it has stopped trying, the wait before the next start. */
  restart?: { tries: number; gave_up: boolean; retry_in_ms: number | null };
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
  /** Kubrow and Kavat imprints, the inventory's own rows, passed through. */
  imprints?: ImprintRaw[] | null;
  /**
   * Each copy of a warframe, weapon or companion: path, feature bits, Forma, section, and when it
   * has them a modular build's parts, affinity, slot polarities, archon shards and Helminth abilities.
   */
  gear?: GearCopy[] | null;
  /** The warframes fed to the Helminth (`InfestedFoundry.ConsumedSuits`), by path; absent from an older TennoScope. */
  consumed_suits?: string[] | null;
}

/** `--access=…`: the Full mode switch (FullMode.svelte), Full or back to Overlay. */
export type TennoscopeAsk = "--sync" | "--authorize-capture" | TennoscopeAccess;
/** Full mode, or back to Overlay (never Companion): the switch, and the first start's answer. */
export type TennoscopeAccess = "--access=full" | "--access=overlay";

/** Your warframe.market status as MyOrbiter holds it on its own connection (see presence.rs). */
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

/** Browser dev mode: a stand-in for TennoScope (core/standIn.ts), when the demo browser picked one. */
function demoStandIn(): StandIn | null {
  if (inTauri) return null;
  try {
    const k = localStorage.getItem(STAND_IN_KEY);
    return isStandIn(k) ? k : null;
  } catch {
    return null;
  }
}

/** Browser dev mode: Stable and Beta with no build yet, Experimental with this one (the help picture of an empty channel). */
const demoEmptyChannel = () => {
  try {
    return !inTauri && localStorage.getItem(EMPTY_CHANNEL_KEY) === "1";
  } catch {
    return false;
  }
};
const EMPTY_DEMO = {
  info: { version: "0.2.130", install: { how: "appImage", path: "/opt/MyOrbiter.AppImage" } } as UpdateInfo,
  check: (c: Channel): UpdateCheck => (c === "experimental" ? { state: "current", version: "0.2.130" } : { state: "empty", system: false }),
};

/** Browser dev mode: public/dev-tennoscope.json fakes a running TennoScope. */
const devTennoscope = async (): Promise<TennoscopeStatus | null> => {
  const stand = demoStandIn();
  if (stand) return standInStatus(stand, Date.now());
  const res = await fetch("/dev-tennoscope.json").catch(() => null);
  if (!(res?.ok && res.headers.get("content-type")?.includes("json"))) return null;
  const s = (await res.json()) as TennoscopeStatus;
  return { ...s, report: s.report ? { ...s.report, at: Date.now() } : null };
};

/** TennoScope, started and stopped by MyOrbiter. Only the desktop app does this. */
/** This copy of MyOrbiter: its version, and how it was installed (so how it updates). */
export interface UpdateInfo {
  version: string;
  install: Install;
}

/** What a channel's manifest offered (src-tauri/src/updates.rs `Check`). */
export type UpdateCheck =
  | { state: "current"; version: string }
  | { state: "newer" | "older"; version: string; notes: string | null; date: string | null }
  | { state: "empty"; system: boolean }
  | { state: "off" };

/**
 * Updates (src-tauri/src/updates.rs): what this copy is, a channel's offer, installing it, and the
 * restart after. In the browser (development) nothing updates.
 */
export const updater = {
  info: (): Promise<UpdateInfo> => (inTauri ? invoke("updates_info") : Promise.resolve(demoEmptyChannel() ? EMPTY_DEMO.info : { version: "0.1.0", install: { how: "dev" } })),
  check: (channel: Channel): Promise<UpdateCheck> => (inTauri ? invoke("updates_check", { channel }) : Promise.resolve(demoEmptyChannel() ? EMPTY_DEMO.check(channel) : { state: "off" })),
  /** Downloads and installs `version` from `channel`; `older` only for an explicit switch to an older build. */
  async install(channel: Channel, version: string, older: boolean, onProgress: (done: number, total: number | null) => void): Promise<void> {
    if (!inTauri) throw new Error("updates aren't available in dev builds");
    const { Channel: Ipc } = await import("@tauri-apps/api/core");
    const progress = new Ipc<{ done: number; total: number | null }>();
    progress.onmessage = (p) => onProgress(p.done, p.total);
    await invoke("updates_install", { channel, version, older, progress });
  },
  /** Starts the new build (the process plugin's restart). */
  restart: (): Promise<void> => (inTauri ? invoke("plugin:process|restart") : Promise.resolve(location.reload())),
};

export const tennoscope = {
  /** Linux's Yama ptrace_scope: above 0, TennoScope can't read the game's memory. Null: no such limit. */
  ptraceScope: (): Promise<number | null> => (inTauri ? invoke<number | null>("ptrace_scope") : Promise.resolve(null)),
  status: (): Promise<TennoscopeStatus | null> => (inTauri ? invoke("tennoscope_status") : devTennoscope()),
  /**
   * The program MyOrbiter starts as TennoScope, picked in a native file dialog that MyOrbiter's Rust
   * side opens: the page never names one. Null when the dialog was closed without a choice. Kept
   * by the Rust side, which refuses anything not named like TennoScope.
   */
  chooseProgram: (): Promise<TennoscopeStatus | null> => (inTauri ? invoke("tennoscope_choose_program") : Promise.resolve(null)),
  /** MyOrbiter finds TennoScope again, forgetting the program chosen in the dialog. */
  forgetProgram: (): Promise<TennoscopeStatus | null> => (inTauri ? invoke("tennoscope_forget_program") : devTennoscope()),
  /** `force`: Start was pressed, so it starts even while MyOrbiter waits out a restart or has stopped trying. */
  start: (force = false): Promise<TennoscopeStatus | null> => (inTauri ? invoke("tennoscope_start", { force }) : devTennoscope()),
  show: (): Promise<void> => (inTauri ? invoke("tennoscope_show") : Promise.resolve()),
  ask: (ask: TennoscopeAsk): Promise<void> => (inTauri ? invoke("tennoscope_ask", { ask }) : Promise.resolve()),
  /** The last time TennoScope's log says it failed to start, and why (Unix ms, UTC). */
  failure: (dataDir: string): Promise<{ at: number; message: string } | null> => (inTauri ? invoke("tennoscope_failure", { dir: dataDir || null }) : Promise.resolve(null)),
};

/** The reward cards a patched TennoScope read off the screen (empty once it closes), or null. */
// ---------------------------------------------------------------- desktop

// ---------------------------------------------------------------- the log

/** A line for MyOrbiter's log (see applog.rs): the desktop app writes it; in a browser, the console. */
export function logLine(level: "info" | "warn" | "error", area: string, message: string) {
  if (inTauri) void invoke("log_line", { level, area, message }).catch(() => {});
  else if (level !== "info") console[level === "error" ? "error" : "warn"](`[${area}] ${message}`);
}

/** Where MyOrbiter's and TennoScope's logs are (null: none yet, or not the desktop app). */
export async function logFolders(dataDir: string): Promise<{ myorbiter: string | null; tennoscope: string | null }> {
  return inTauri ? invoke("log_folders", { dir: dataDir || null }) : { myorbiter: null, tennoscope: null };
}

/** Opens a log folder in the file manager. The app decides where it is (TennoScope's from the saved settings). */
export async function openLogFolder(which: "myorbiter" | "tennoscope"): Promise<void> {
  if (inTauri) await invoke("open_log_folder", { which });
}

// ---------------------------------------------------------------- bug reports

/** The last `lines` lines of MyOrbiter's log, redacted by applog.rs (none in a browser). */
export async function logTail(lines: number): Promise<string[]> {
  return inTauri ? invoke<string[]>("log_tail", { lines }) : [];
}

/** This copy's version and the system it runs on, for a bug report. */
export async function reportEnv(): Promise<{ version: string; os: string; arch: string }> {
  if (inTauri) return invoke("report_env");
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Windows/i.test(ua) ? "windows" : /Mac OS/i.test(ua) ? "macos" : /Linux/i.test(ua) ? "linux" : "unknown";
  return { version: "dev (browser)", os, arch: "" };
}

/** How the window is drawn on Linux (src-tauri/src/rendering.rs): this start's mode, and the saved choice. */
export interface RenderingState {
  linux: boolean;
  now: { mode: "accelerated" | "sharedMemory" | "dmaBuf" | "compat" | "yours"; why: "none" | "chosen" | "afterCrash" | "dmaBufFailed"; nvidia: boolean; wayland: boolean; set: string[]; yours: string[] } | null;
  /** Compatibility rendering saved for the next start. */
  next: boolean;
  /** The experimental DMA-BUF frames (NVIDIA) saved for the next start. */
  dmabuf: boolean;
}
export async function renderingState(): Promise<RenderingState> {
  return inTauri ? invoke<RenderingState>("rendering_state") : { linux: false, now: null, next: false, dmabuf: false };
}
/** Experimental, NVIDIA on Linux: frames handed over as DMA-BUF from the next start, or back to shared memory. */
export async function setDmabufRendering(on: boolean): Promise<void> {
  if (inTauri) await invoke("set_dmabuf_rendering", { on });
}

// ---------------------------------------------------------------- Record timings

/** Where a timing report is taken (timing.rs); null in a browser. */
export async function timingEnv(): Promise<TimingEnv | null> {
  return inTauri ? invoke<TimingEnv>("timing_env") : null;
}
/** Saves a timing report in the log folder; gives the file's name (null in a browser). */
export async function saveTimingReport(text: string): Promise<string | null> {
  return inTauri ? invoke<string>("timing_save_report", { text }) : null;
}
/** Compatibility rendering on or off, from the next start. */
export async function setCompatRendering(on: boolean): Promise<void> {
  if (inTauri) await invoke("set_compat_rendering", { on });
}

/**
 * A desktop notification (App's `tell` decides when). `id`: its entry in the history, so clicking
 * it opens what it's about (see onNoticeOpen). `actions`: buttons beside Open, as [action, label]
 * (a sale's "Give +rep"); pressing one tells the page (onNoticeAction) without bringing MyOrbiter up.
 * Linux and Windows. Resolves once the desktop's notification service took it, and rejects with why
 * it didn't (what became of it is written on its history entry). In the browser dev mode it's
 * logged and rejects: there's no desktop to send to.
 */
export async function notify(summary: string, body: string, id?: string, actions: [string, string][] = []): Promise<void> {
  if (inTauri) {
    // Resolves once the desktop's notification service took it; rejects with why not.
    await invoke("notify", { summary, body, id: id ?? null, actions }).catch((e) => {
      throw new Error(String(e).replace(/^Error:\s*/, ""));
    });
  } else {
    // A browser has no desktop to send to (the demo, the tests): the console stands in, and the caller is told.
    console.info(`[notification] ${summary}: ${body}${actions.length ? ` [${actions.map((a) => a[1]).join("] [")}]` : ""}`);
    throw new Error("only the desktop app can send them");
  }
}

/** Quit MyOrbiter (Ctrl+Q, or the window's X), closing the TennoScope it started. */
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
    // The X still closes MyOrbiter, 2 s later and without the last changes.
    console.error("can't hear the window close", e);
    return () => {};
  }
}

/**
 * Calls `onwait` with when the next riven search goes (unix ms) each time one has to wait for
 * warframe.market's contract budget (10 a minute, market.rs). Resolves to a way to stop.
 */
export async function onSearchWait(onwait: (until: number) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<number>("market-search-wait", (e) => onwait(e.payload));
}

/**
 * Sets the riven key (see `set_riven_key`), or none with "". Resolves to why it couldn't be set,
 * or null. Each press calls `onpress`.
 */
let rivenKeyListener: Promise<() => void> | null = null;
export async function setRivenKey(key: string, onpress: () => void): Promise<string | null> {
  if (!inTauri) return null;
  rivenKeyListener ??= import("@tauri-apps/api/event").then(({ listen }) => listen("riven-key", () => onpress()));
  try {
    await invoke("set_riven_key", { key: key.trim() || null });
    return null;
  } catch (e) {
    return String(e).replace(/^Error:\s*/, "");
  }
}

export async function rewardCards(): Promise<ScreenCards | null> {
  if (inTauri) return invoke<ScreenCards | null>("reward_cards");
  const res = await fetch("/dev-reward-screen.json").catch(() => null);
  return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : null;
}

/** MyOrbiter's pick, for TennoScope's overlay. Only the desktop app writes it. */
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
  /** Where each can still be had (Prime Resurgence included); null for what isn't a Prime part. */
  vault: ("vaulted" | "resurgence" | "farmable" | null)[];
}

/** The overlay write under way, if one is: each waits for the one before. */
let overlayWrite: Promise<unknown> = Promise.resolve();
/**
 * Your overlay settings, for TennoScope. Only the desktop app writes them. One at a time, in the
 * order they're made: the Rust side writes off the main thread, where two at once could finish
 * the wrong way round and leave TennoScope with settings already changed.
 */
export function writeOverlayPrefs(prefs: OverlaySettings): Promise<void> {
  if (!inTauri) return Promise.resolve();
  const next = overlayWrite.catch(() => {}).then(() => invoke<void>("write_overlay_prefs", { prefs }));
  overlayWrite = next;
  return next;
}

/** A riven cycle for TennoScope to show over the game (see core/rivens.ts, cycleOverlay). */
export async function writeRivenCycle(cycle: unknown): Promise<void> {
  if (inTauri) await invoke("write_riven_cycle", { cycle });
}

/** Every relic reward screen in TennoScope's own logs, oldest first (see crates/myorbiter-data/src/reward_log.rs). */
export async function rewardScreens(dataDir: string): Promise<LoggedScreen[]> {
  if (inTauri) return invoke<LoggedScreen[]>("reward_screens", { dir: dataDir || null });
  const res = await fetch("/dev-reward-screens.json").catch(() => null);
  return res?.ok && res.headers.get("content-type")?.includes("json") ? res.json() : [];
}

/** Warframe's display mode from its EE.cfg ("MODE_BORDERLESS", "MODE_FULLSCREEN"…), when known. */
export async function warframeWindowMode(eeLog: string): Promise<string | null> {
  return inTauri ? invoke<string | null>("warframe_window_mode", { path: eeLog || null }).catch(() => null) : null;
}

/** TennoScope's overlay on a solid background from its next start (see settings.tennoscope). */
export async function tennoscopeOpaqueOverlay(on: boolean): Promise<void> {
  if (inTauri) await invoke("tennoscope_opaque_overlay", { on }).catch(() => {});
}

export async function missionState(eeLog: string): Promise<MissionState | null> {
  if (inTauri) return invoke<MissionState | null>("mission_state", { path: eeLog || null });
  const res = await fetch("/dev-mission.json").catch(() => null);
  const m: MissionState | null = res?.ok ? await res.json() : null;
  const stand = demoStandIn();
  return m && stand ? { ...m, signed_in: standInSignedIn(stand) ? 1 : null } : m;
}

// Item artwork goes through MyOrbiter's local cache, its own "img" protocol. Windows' webview
// (WebView2) only reaches an app's protocol as http://img.localhost; Linux and macOS take
// img://localhost. In the browser dev mode it comes straight from WFCD.
export const onWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
const IMG_BASE = onWindows ? "http://img.localhost/" : "img://localhost/";
/** An item's WFCD artwork: a thumbnail, or the larger copy cards and the details sheet show. */
// "wfm." names are warframe.market's own thumbnails (the Market page, for items WFCD has no art for).
export const imageUrl = (file: string, large = false) =>
  inTauri
    ? `${IMG_BASE}${large ? "l/" : ""}${encodeURIComponent(file)}`
    : file.startsWith("wfm.")
      ? `https://warframe.market/static/assets/items/images/en/thumbs/${encodeURIComponent(file.slice(4))}`
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
/** Browser dev mode only: /dev-books.json, order books by item slug, read once; null without one. */
let devBooksRead: Promise<Record<string, BookOrder[]> | null> | null = null;
const devBooks = () =>
  (devBooksRead ??= fetch("/dev-books.json")
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? (r.json() as Promise<Record<string, BookOrder[]>>) : null))
    .catch(() => null));
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

/** One of a desktop notification's own buttons was pressed (see notify's `actions`): its id in the history and the action. */
export async function onNoticeAction(fn: (id: string, action: string) => void): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ id: string; action: string }>("notice-action", (e) => fn(e.payload.id, e.payload.action));
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
    inTauri ? invoke<MarketAccount>("market_account").then((a) => (a.error ? { ...a, error: waitWords(a.error) } : a)) : ((await devMarket())?.account ?? { linked: false, backing: "file", profile: null, error: null }),
  signIn: (email: string, password: string): Promise<Me> => (inTauri ? invoke("market_sign_in", { email, password }) : needApp()),
  useToken: (token: string): Promise<Me> => (inTauri ? invoke("market_use_token", { token }) : needApp()),
  signOut: (): Promise<void> => (inTauri ? invoke("market_sign_out") : Promise.resolve()),
  items: async (): Promise<MarketItem[]> => {
    if (inTauri) return marketItemsOf(await invoke<unknown>("market_items"));
    const res = await fetch("/dev-market-items.json").catch(() => null);
    return res?.ok && res.headers.get("content-type")?.includes("json") ? marketItemsOf(await res.json()) : [];
  },
  myOrders: async (): Promise<MyOrder[]> => (inTauri ? invoke("market_my_orders") : ((await devMarket())?.orders ?? needApp())),
  rivenMeta: async (): Promise<RivenMeta> =>
    rivenMetaOf(await (inTauri ? invoke<unknown>("market_riven_meta") : fetch("/dev-rivens.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("no riven data in the browser")))))),
  rivenAuctions: async (weapon: string, positive: string[], negative: string | null): Promise<RivenAuction[]> =>
    inTauri
      ? invoke<RivenAuction[]>("market_riven_auctions", { weapon, positive, negative })
      : fetch("/dev-auctions.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("warframe.market can only be searched from the desktop app")))),
  /** Your riven auctions (raw; see parseMyAuctions). In the browser dev mode, /dev-market.json's `auctions`, or none. */
  myAuctions: async (): Promise<unknown> => (inTauri ? invoke("market_my_auctions") : ((await devMarket()) as { auctions?: unknown } | null)?.auctions ?? []),
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
    // Browser dev mode with /dev-books.json (the demo account has one): its books stand in for
    // the whole market, and an item it hasn't got has nobody selling.
    const kept = await devBooks();
    if (kept) return kept[slug] ?? [];
    const res = await fetch(`https://api.warframe.market/v2/orders/item/${slug}`, { headers: { Platform: devPlatform, Crossplay: "true" } });
    return (await res.json()).data;
  },
  create: (order: { itemId: string; platinum: number; quantity: number; rank?: number | null; subtype?: string | null; visible?: boolean; type?: "sell" | "buy" }): Promise<MyOrder> =>
    inTauri ? invoke("market_create", { order }) : devNoop().then(() => ({ id: `dev-${Date.now()}`, itemId: order.itemId, type: order.type ?? "sell", platinum: order.platinum, quantity: order.quantity, rank: order.rank ?? null, subtype: order.subtype ?? null, visible: true, updatedAt: null })),
  update: (id: string, change: { platinum?: number; quantity?: number; visible?: boolean }): Promise<void> =>
    inTauri ? invoke("market_update", { id, change }) : devNoop(),
  remove: (id: string): Promise<void> => (inTauri ? invoke("market_delete", { id }) : devNoop()),
  /** warframe.market's own "Sold": records the sale on your profile and lowers or closes the order. */
  close: (id: string, quantity: number): Promise<void> => (inTauri ? invoke("market_close", { id, quantity }) : devNoop()),
};

// ------------------------------------------------------------------ Nox's Frame builds

/** A pasted build code unpacked in the browser (dev mode only; the app unpacks it in Rust). */
async function decodeNoxInBrowser(code: string): Promise<unknown> {
  const body = code.trim().replace(/^NFB1:/, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (body === code.trim() || typeof DecompressionStream === "undefined") throw new Error("not a Nox's Frame build code");
  const bin = atob(body + "=".repeat((4 - (body.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return JSON.parse(await new Response(stream).text());
}

const needAppForNox = (): Promise<never> => Promise.reject(new Error("Reading Nox's Frame needs the MyOrbiter app"));

/**
 * Nox's Frame through the Rust side (src-tauri/src/noxsframe.rs): spaced 3 s apart, kept a week.
 * Hand it to makeNox (core/builds/noxsframe.ts).
 */
export const noxFetcher: NoxFetcher = {
  list: (item, refresh = false) => (inTauri ? invoke<NoxAnswer<NoxListing[]>>("nox_item_builds", { item, refresh }) : needAppForNox()),
  build: (path, opts = {}) => (inTauri ? invoke<NoxAnswer<NoxPage> | null>("nox_build", { path, refresh: opts.refresh === true, cachedOnly: opts.cachedOnly === true }) : opts.cachedOnly ? Promise.resolve(null) : needAppForNox()),
  decode: (code) => (inTauri ? invoke<unknown>("nox_decode_code", { code }) : decodeNoxInBrowser(code)),
};
