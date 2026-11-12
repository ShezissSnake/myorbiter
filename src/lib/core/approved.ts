// The price you last set or approved for a listing, and how far an automatic repricing pass may
// take it from there. You set or approve a price by listing it (the listing form, a Sell spares
// plan you apply), by editing it on Orders, or by pressing Reprice; a pass on the timer never
// does. Unattended, a listing never goes under AUTO_FLOOR_SHARE of that price: it stops there and
// MyOrbiter says so, for you to decide.

/** The share of your last approved price an unattended pass may lower a listing to. */
export const AUTO_FLOOR_SHARE = 0.7;

/**
 * What automatic repricing never does, in words: Settings, Orders and the Guide show this one
 * sentence. The 70% is `unattendedMove`; the halving is the pass in marketStore; the floors and the
 * raise to them are `planFor` in market.ts.
 */
const limits = (how: string) =>
  `On its own it never takes a price under ${Math.round(AUTO_FLOOR_SHARE * 100)}% of the one you last set or approved (${how}; it stops there and says so) ` +
  "and never more than halves one (that waits for you to press Reprice). It never goes under your floors or your minimum price, and it raises a listing that sits under them up to them";
export const AUTO_LIMITS = limits("listing it, typing it, pressing Reprice or applying a Sell spares plan");
/** The same for a console, where there is no Sell spares. */
export const AUTO_LIMITS_CONSOLE = limits("listing it, typing it or pressing Reprice");

/** The least an unattended pass may set: 70% of `approved`, rounded up to a whole platinum. */
export const autoFloor = (approved: number) => Math.ceil(approved * AUTO_FLOOR_SHARE - 1e-9);

export type Unattended =
  /** Go ahead at `target`. */
  | { go: true; target: number; atFloor: boolean }
  /** Leave it: the listing is already at (or under) the floor, and the market is lower still. */
  | { go: false; floor: number };

/**
 * What an unattended pass may do with a listing at `current` that the market would take to
 * `target`, given the price you last approved. Above the floor it goes as planned; under it, down
 * to the floor and no further (`atFloor`), or not at all once it's there.
 */
export function unattendedMove(target: number, current: number, approved: number): Unattended {
  const floor = autoFloor(approved);
  if (target >= floor) return { go: true, target, atFloor: false };
  if (current <= floor) return { go: false, floor };
  return { go: true, target: floor, atFloor: true };
}

/** Saved approvals, kept only where they're whole positive prices (a damaged settings file). */
export function approvedOf(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof k === "string" && Number.isInteger(v) && (v as number) >= 1)) as Record<string, number>;
}
