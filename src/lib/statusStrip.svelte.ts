// How the app is doing, said in one place, the sidebar's foot: the game, the inventory read or the
// fissure under way, and warframe.market (with repricing); platinum at the sidebar's top. All of it
// is state App already holds: no request and no timer of its own. The pane context (PANE) also
// tells what's drawn inside a page which page it is (ui/PaneId.svelte; the page head's section).

export interface StatusItem {
  /** Short label, drawn as a register. */
  label: string;
  value: string;
  /** The longer story, on hover. */
  title?: string;
  /** Fine (a filled diamond), or not yet, off or not running (a hollow one). */
  ok: boolean;
}

export interface Status {
  /** Game, then Fissure or Inventory, then Market (on a console, Market alone). */
  items: StatusItem[];
  /** Platinum, at the sidebar's top (none on a console). */
  plat: StatusItem | null;
  /** Repricing (also folded into the Market item). */
  repricing: StatusItem;
}

/** The context key under which each pane says which page it holds (ui/PaneId.svelte). */
export const PANE = Symbol("pane");
