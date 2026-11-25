// A riven sold in a trade in game, and the player's auction for it on warframe.market. The game's
// log names a riven in a trade by its weapon's name and its own, with its rank
// (`Braton Crita-hexacan (RIVEN RANK 0)`, `TradeItem.riven`); an auction keeps warframe.market's
// name for the weapon, the riven's name and its rank. With "Mark sales sold from the game" on,
// the auction is closed by MyOrbiter itself only when it is sure which one it is (`rivenVerdict`);
// in every other case where an open auction fits the riven given away, nothing is written and the
// player is told, with one click to close.
import type { MyAuction, RivenMeta } from "./rivens";
import type { Trade, TradeItem } from "./types";
import { isSale } from "./saleNotice";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Whether one of the player's auctions fits a riven the log named ("Braton Crita-hexacan"): open,
 * and the logged name is exactly warframe.market's name for the auction's weapon, a space and the
 * riven's name (case and spacing aside). Nothing is guessed about where the weapon's name ends: a
 * weapon warframe.market names otherwise than the game does fits no auction.
 */
export function auctionFits(meta: RivenMeta, a: MyAuction, logged: string): boolean {
  if (a.closed || !a.name) return false;
  const want = norm(logged);
  return meta.weapons.some((w) => w.slug === a.weapon && norm(`${w.name} ${a.name}`) === want);
}

/** A riven of the last inventory read, as far as it tells one from another: warframe.market's weapon and the riven's name (null when it couldn't be worked out). */
export interface HeldRiven {
  weapon: string | null;
  name: string | null;
}

/** The last inventory read's rivens and when it was taken (unix ms; null when not known). */
export interface HeldRivens {
  rivens: HeldRiven[];
  at: number | null;
}

/** How many rivens of the read may be the auction's riven: of its weapon and name, or of a weapon or name the read couldn't make out. */
export function heldLike(held: HeldRiven[], a: Pick<MyAuction, "weapon" | "name">): number {
  return held.filter((h) => (h.weapon == null || h.weapon === a.weapon) && (h.name == null || norm(h.name) === norm(a.name))).length;
}

/** Everything the decision reads, as it is at the moment of deciding. */
export interface RivenSaleFacts {
  trade: Trade;
  /** The riven given, one of `trade.offered`. */
  item: TradeItem;
  /** "Mark sales sold from the game". */
  autoTrades: boolean;
  /** Signed in to warframe.market: without it the player's auctions aren't known. */
  linked: boolean;
  /** The trade is inside the window in which sales are marked (recentTrade). */
  recent: boolean;
  /** The player's auctions, from a read made for this decision. */
  auctions: MyAuction[];
  meta: RivenMeta;
  /** The last inventory read; null when there is none. */
  held: HeldRivens | null;
}

export type RivenVerdict =
  /** Close this auction: every condition holds. */
  | { do: "close"; auction: MyAuction }
  /** Write nothing; tell the player, naming the open auctions that fit and why it wasn't closed. */
  | { do: "tell"; auctions: MyAuction[]; why: string }
  /** No open auction fits (or the auctions aren't known): nothing to write or tell. */
  | { do: "nothing" };

/**
 * What to do about one riven given in a trade. It closes only when all of these hold: the switch is
 * on and the player is signed in; the trade went through and is inside the window; the riven is on
 * the side the player gave and the other side is platinum only (a sale, `isSale`), and it is the
 * trade's only riven; exactly one open auction fits it (`auctionFits`); its rank in the log is the
 * auction's; and the last inventory read holds at most one riven that may be the auction's, and
 * that one only if the read is from before the trade (a read after it that still holds one is a
 * riven the player kept). Any doubt is a tell. A riven received is never looked at.
 *
 * The inventory never closes anything on its own: it can only turn a close into a tell, so a read
 * that is partial, old or empty takes nothing down.
 */
export function rivenVerdict(f: RivenSaleFacts): RivenVerdict {
  if (!f.linked || !f.item.riven || !f.trade.offered.includes(f.item)) return { do: "nothing" };
  const fits = f.auctions.filter((a) => auctionFits(f.meta, a, f.item.name));
  if (!fits.length) return { do: "nothing" };
  const tell = (why: string): RivenVerdict => ({ do: "tell", auctions: fits, why });
  if (!f.autoTrades) return tell("Mark sales sold from the game is off");
  if (!isSale(f.trade)) return tell("the trade wasn't a sale for platinum alone");
  if (!f.recent) return tell("the trade is older than half an hour, or was made while MyOrbiter was closed");
  const given = f.trade.offered.filter((x) => x.riven).reduce((n, x) => n + x.count, 0);
  if (given > 1) return tell("the trade held more than one riven");
  if (fits.length > 1) return tell("more than one of your auctions fits it");
  const a = fits[0];
  if (f.item.rank == null || f.item.rank !== a.rank) return tell(`its rank in the game (${f.item.rank ?? "not logged"}) isn't the auction's (${a.rank})`);
  if (!f.held) return tell("your inventory hasn't been read, so another riven of that name can't be ruled out");
  const like = heldLike(f.held.rivens, a);
  if (like > 1) return tell("your inventory holds more than one riven that may be it");
  if (like === 1) {
    const before = f.held.at != null && f.trade.at != null && f.held.at < f.trade.at * 1000;
    if (!before) return tell("your inventory still holds a riven that may be it");
  }
  return { do: "close", auction: a };
}

/** What became of a riven given in a trade, kept in the settings so a trade is decided once. */
export type RivenSoldState =
  /** The close was sent; until it answers. Found at load: the close may or may not have gone, so it is told. */
  | "closing"
  /** Closed by MyOrbiter (or found closed). */
  | "closed"
  /** Told, waiting for the player: one click to close. */
  | "told"
  /** A close that failed: told, one click to try again. */
  | "failed"
  /** Put away by the player: the auction stays up. */
  | "kept"
  /** No open auction fitted it. */
  | "none";

export interface RivenSold {
  /** The trade's key (tradeKey) and the riven as the log named it. */
  trade: string;
  riven: string;
  rank: number | null;
  /** The trade's time (unix ms). */
  at: number;
  partner: string;
  /** The open auctions that fitted it when the trade was decided: one to close by a click, or several (told only). */
  auctions: string[];
  state: RivenSoldState;
  /** Why it wasn't closed, or why the close failed. */
  why?: string;
}

/** Riven sales kept: the newest, and every one of the game session still running. */
export const RIVEN_SOLD_MAX = 100;

/** Whether this riven of this trade has been decided already (kept across restarts). */
export const rivenDecided = (list: RivenSold[], trade: string, riven: TradeItem) => list.some((r) => r.trade === trade && r.riven === riven.name);

/** The list with `r` first, the oldest going past RIVEN_SOLD_MAX except those of `session` (the game session's key prefix). */
export function keepRivenSold(list: RivenSold[], r: RivenSold, session: string | null): RivenSold[] {
  const all = [r, ...list.filter((x) => !(x.trade === r.trade && x.riven === r.riven))];
  if (all.length <= RIVEN_SOLD_MAX) return all;
  const live = session == null ? null : `${session}|`;
  return all.filter((x, i) => i < RIVEN_SOLD_MAX || (live != null && x.trade.startsWith(live)));
}

/** The list with one entry's state (and reason) changed. */
export function setRivenSold(list: RivenSold[], r: Pick<RivenSold, "trade" | "riven">, state: RivenSoldState, why?: string): RivenSold[] {
  return list.map((x) => (x.trade === r.trade && x.riven === r.riven ? { ...x, state, ...(why ? { why } : { why: undefined }) } : x));
}

/**
 * The riven sales to show the player now: told or failed (a close found unfinished at load is
 * loaded as failed, rivenSoldOf), whose auction is still open in `open` (the last read of the player's auctions). Once the auction
 * is closed, wherever that was done, or the player has put it away, it isn't shown again.
 */
export function rivenSoldShown(list: RivenSold[], open: MyAuction[]): { sold: RivenSold; auctions: MyAuction[] }[] {
  const out: { sold: RivenSold; auctions: MyAuction[] }[] = [];
  for (const sold of list) {
    if (sold.state !== "told" && sold.state !== "failed") continue;
    const auctions = open.filter((a) => !a.closed && sold.auctions.includes(a.id));
    if (auctions.length) out.push({ sold, auctions });
  }
  return out;
}

/**
 * Whether a fresh read still has the auction to close as it was decided: open, the same id, and
 * still fitting the riven (`auctionFits`) at the logged rank. A close is sent only then.
 */
export function stillToClose(meta: RivenMeta, auctions: MyAuction[], id: string, riven: string, rank: number | null): MyAuction | null {
  const a = auctions.find((x) => x.id === id);
  return a && !a.closed && auctionFits(meta, a, riven) && (rank == null || a.rank === rank) ? a : null;
}

/** Settings' list as saved: entries of the right shape only; a close found unfinished is told (it may or may not have gone). */
export function rivenSoldOf(raw: unknown): RivenSold[] {
  if (!Array.isArray(raw)) return [];
  const states: RivenSoldState[] = ["closing", "closed", "told", "failed", "kept", "none"];
  const out: RivenSold[] = [];
  for (const x of raw as Partial<RivenSold>[]) {
    if (!x || typeof x !== "object" || typeof x.trade !== "string" || typeof x.riven !== "string" || typeof x.at !== "number" || !Number.isFinite(x.at)) continue;
    if (!states.includes(x.state as RivenSoldState) || !Array.isArray(x.auctions)) continue;
    const auctions = x.auctions.filter((a): a is string => typeof a === "string").slice(0, 10);
    const rank = typeof x.rank === "number" && Number.isFinite(x.rank) ? x.rank : null;
    const closing = x.state === "closing";
    const why = closing ? "MyOrbiter was closed while it was closing the auction" : typeof x.why === "string" ? x.why.slice(0, 300) : undefined;
    out.push({ trade: x.trade, riven: x.riven, rank, at: x.at, partner: typeof x.partner === "string" ? x.partner : "", auctions, state: closing ? "failed" : (x.state as RivenSoldState), ...(why ? { why } : {}) });
    if (out.length >= RIVEN_SOLD_MAX * 3) break;
  }
  return out;
}
