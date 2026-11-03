// The numbers the listing and buy forms send to warframe.market: whole platinum and whole copies.
// A number box takes 2.5, -5 or nothing at all; none of those is a price or a quantity.

/** The most platinum a listing, buy order or alert can ask. */
export const MAX_PLAT = 999_999;
/** The most copies one listing or buy order can be for. */
export const MAX_QTY = 9_999;

/** A whole number from `min` to `max`; empty, a fraction, a negative or NaN isn't. */
export function wholeIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** A form's number for a button label: "…" while the box is empty. */
export function shown(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "…";
}

/** What's wrong with a quantity or price typed in, for the line under the fields; null when fine or empty. */
export function amountProblem(quantity: unknown, platinum: unknown, minQuantity = 1): string | null {
  const typed = (v: unknown) => typeof v === "number" && !Number.isNaN(v);
  if (typed(quantity) && !wholeIn(quantity, minQuantity, MAX_QTY)) return `The quantity is a whole number from ${minQuantity} to ${MAX_QTY.toLocaleString("en")}.`;
  if (typed(platinum) && !wholeIn(platinum, 1, MAX_PLAT)) return `The price is a whole number of platinum from 1 to ${MAX_PLAT.toLocaleString("en")}.`;
  return null;
}
