// How many cards a long card grid (ui/Browse.svelte) shows. Only the cards a grid shows are drawn,
// so the two numbers here are what a long list costs:
// - in sight, `cardsAhead`: as the page scrolls, the cards down to the screen's bottom and a screen
//   and a half more, so a scroll finds the next cards already there. They're drawn a few at a time
//   in idle moments (progress.svelte.ts), the ones in sight at once.
// - once its page is left, `cardsToKeep`: the cards down to where the player was and those drawn
//   ahead of it, and no further, so a page left with hundreds drawn below the screen doesn't carry
//   them through every switch. Coming back shows the same cards in the same place and draws none:
//   everything above, on and just below the screen stays.
// Whole rows always, so a fold never leaves a short row at the bottom of the screen.

export interface CardsAt {
  /** The cards the list has. */
  total: number;
  /** The cards it shows now. */
  shown: number;
  /** The cards from the list's start to just past the screen's bottom (progress.svelte.ts, `inView`). */
  reach: number;
  /** Cards a row. */
  perRow: number;
  /** Cards a screen holds. */
  screenful: number;
}

/** `n` cards rounded up to whole rows of `perRow`. */
export function wholeRows(n: number, perRow: number): number {
  const per = Math.max(1, Math.floor(perRow) || 1);
  return Math.ceil(Math.max(0, n) / per) * per;
}

/**
 * The cards a grid in sight shows: down to `reach` and `ahead` screens more, in whole rows, never
 * fewer than it shows already (a list in sight never folds) and never more than it has. `more`:
 * the end of what's drawn came near anyway (the marker under the cards, a fallback for a grid not
 * measured yet): a screen more than it shows, at least a row; but only once the cards `drawn` so far
 * are all it shows. The marker sits under the cards drawn, so it stays near while they're still
 * coming, and adding more each time it's seen then ran ahead to the whole list. Not `scrolled` (a
 * page shown again, a first measure): only the cards in sight, so a page switch draws no more than
 * the screen shows; the rest come with the first scroll.
 */
export function cardsAhead(
  { total, shown, reach, perRow, screenful }: CardsAt,
  { ahead = 1.5, more = false, drawn = shown, scrolled = true }: { ahead?: number; more?: boolean; drawn?: number; scrolled?: boolean } = {},
): number {
  let goal = wholeRows(reach + (scrolled ? ahead * screenful : 0), perRow);
  if (more && drawn >= shown) goal = Math.max(goal, wholeRows(shown + Math.max(screenful, perRow, 1), perRow));
  return Math.max(shown, Math.min(total, goal));
}

/**
 * The cards a grid keeps once its page is left: down to `reach` (where the player was) and the
 * `ahead` screens `cardsAhead` draws below it, so coming back draws nothing more; and the card at
 * index `keep` (the one with the focus, or Tab's place in the grid; -1 for none), in whole rows; at
 * least `least` (the first screenful a page opens with); never more than it shows. A grid no more
 * than `slack` screens past that keeps all it shows: folding a few screens saves little, and they'd
 * be drawn again on the next scroll.
 */
export function cardsToKeep(
  { shown, reach, perRow, screenful }: Pick<CardsAt, "shown" | "reach" | "perRow" | "screenful">,
  keep = -1,
  least = 24,
  { ahead = 1.5, slack = 4 }: { ahead?: number; slack?: number } = {},
): number {
  const base = Math.max(least, wholeRows(reach + ahead * screenful, perRow), keep >= 0 ? wholeRows(keep + 1, perRow) : 0);
  return shown - base < slack * screenful ? shown : Math.min(shown, base);
}

/** The cards a grid shows after the next slice of a fold toward `keep`: `slice` fewer (at least one), never fewer than `keep`. */
export function foldStep(shown: number, keep: number, slice: number): number {
  return shown <= keep ? shown : Math.max(keep, shown - Math.max(1, Math.floor(slice) || 1));
}
