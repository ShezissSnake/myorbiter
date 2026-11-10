// The one-glance status strip under every page head (ui/StatusStrip.svelte): the game, the
// inventory read or the fissure under way, warframe.market, and platinum (or repricing, on Trade
// pages). All of it is state App already holds; the strip makes no request and runs no timer of
// its own. App says where to read it from, as it does for the page on screen (pane.svelte.ts).

export interface StatusItem {
  /** Short label, drawn as a register. */
  label: string;
  value: string;
  /** The longer story, on hover. */
  title?: string;
}

export interface Status {
  /** Game, then Fissure or Inventory, then Market: on every page. */
  items: StatusItem[];
  /** Platinum: on every page but Trade's. */
  plat: StatusItem | null;
  /** Repricing: in its place on Trade's pages. */
  repricing: StatusItem;
  /** "Updated n min ago": the freshest of the inventory read and the order list. */
  updated: string | null;
}

/** The context key under which each pane says which page it holds (ui/PaneId.svelte). */
export const PANE = Symbol("pane");

let read: () => Status | null = () => null;
/** App: where the strip reads its state from (a reactive read). */
export function setStatus(f: () => Status | null) {
  read = f;
}
/** What the strip shows now (reactive). */
export const status = () => read();
