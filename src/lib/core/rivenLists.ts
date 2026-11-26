// warframe.market's public riven lists (weapon and stat names, `rivens.meta`) for a riven given in a
// trade (core/rivenSold.ts). Telling which of the player's auctions fits that riven goes by
// warframe.market's weapon names, so a riven trade that is due while the lists are missing asks for
// them itself, with the read the pages make (`rivens.loadMeta`: signed out, the copy kept a day),
// instead of waiting for a page to read them. A few tries at most, spaced; after that it waits for
// a page or a riven cycle, as before. Nothing here decides a riven: that stays rivenSold.ts's.
import type { RivenMeta } from "./rivens";
import type { Trade } from "./types";
import { rivenTradesDue, type RivenSold } from "./rivenSold";

/**
 * Tries at the lists for one trade, at most: the first, then two more while they fail, counted in
 * one run of the app (the same bound as the reads of the player's auctions, RIVEN_READS). One try
 * serves every trade due at that moment, and counts for each of them.
 */
export const RIVEN_LISTS_TRIES = 3;
/**
 * After a try that failed, how long until the next (ms), counted from when it failed. A try is one
 * read of the lists: answered from the copy kept while it is under a day old, otherwise two
 * requests (weapons, then stats) through warframe.market's queue in market.rs, whose own waits and
 * time limits set how long it takes. A minute apart is the pace the Rivens page tries again at
 * while it is open, so a trade never asks faster than a page.
 */
export const RIVEN_LISTS_GAP_MS = 60_000;

/**
 * Lists a riven can be told by: loaded, with at least one weapon. An empty weapon list would fit no
 * auction and read as "no auction fits", so it counts as missing.
 */
export function rivenListsUsable(meta: RivenMeta | null): meta is RivenMeta {
  return meta != null && meta.weapons.length > 0;
}

export type RivenTradeStep =
  /** No riven trade due: signed out, no trade, none with a riven, or every riven decided or being decided. */
  | { do: "nothing" }
  /** Rivens due and the lists missing: ask for them first (RivenListsTries says whether a try may go now). */
  | { do: "lists"; due: Trade[] }
  /** Rivens due and the lists there: decide them (core/rivenSold.ts). */
  | { do: "decide"; due: Trade[]; meta: RivenMeta };

/**
 * What the trade's effect in App.svelte does now about rivens given in trades. Nothing while signed
 * out (the auctions aren't known), nor with no riven due (`rivenTradesDue`: a riven not decided yet;
 * `busy`: trades being decided now, by their key); with some due, the lists first when they are
 * missing, then the decision. The switch "Mark sales sold from the game" isn't asked: a riven is
 * looked at whatever it says, since the telling needs the same lists and auctions.
 */
export function rivenTradeStep(f: { trades: Trade[]; linked: boolean; sold: RivenSold[]; key: (t: Trade) => string; busy: (key: string) => boolean; meta: RivenMeta | null }): RivenTradeStep {
  if (!f.trades.length || !f.linked) return { do: "nothing" };
  const due = rivenTradesDue(f.sold, f.trades, f.key).filter((t) => !f.busy(f.key(t)));
  if (!due.length) return { do: "nothing" };
  if (!rivenListsUsable(f.meta)) return { do: "lists", due };
  return { do: "decide", due, meta: f.meta };
}

/**
 * The tries at the lists made for riven trades in this run: at most RIVEN_LISTS_TRIES per trade, one
 * at a time, and RIVEN_LISTS_GAP_MS after one failed before the next.
 */
export class RivenListsTries {
  private tries = new Map<string, number>();
  private out = false;
  private againAt = 0;

  /**
   * Whether a try may go now for trades `keys`: the try's number (the most any of them has had,
   * this one included), counted for each one with tries left; null while a try is out, before the
   * gap after a failed one is over, or when none of them has tries left.
   */
  take(keys: string[], now: number): number | null {
    if (this.out || now < this.againAt) return null;
    const left = keys.filter((k) => (this.tries.get(k) ?? 0) < RIVEN_LISTS_TRIES);
    if (!left.length) return null;
    let n = 0;
    for (const k of left) {
      const next = (this.tries.get(k) ?? 0) + 1;
      this.tries.set(k, next);
      n = Math.max(n, next);
    }
    this.out = true;
    return n;
  }

  /** The try has ended (`ok`: usable lists came back) at `now`; after a failure, the next waits the gap. */
  done(ok: boolean, now: number) {
    this.out = false;
    this.againAt = ok ? 0 : now + RIVEN_LISTS_GAP_MS;
  }

  /** Whether any of trades `keys` has a try left. */
  left(keys: string[]): boolean {
    return keys.some((k) => (this.tries.get(k) ?? 0) < RIVEN_LISTS_TRIES);
  }
}
