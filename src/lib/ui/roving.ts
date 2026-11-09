// use:roving on a grid of cards: one Tab stop for the whole grid, the arrow keys between its cards.
// A page of four hundred cards would otherwise take four hundred Tab presses to get past. The card
// last focused (the first, to begin with) is the one Tab lands on, together with its own buttons
// (the star, List); every other card and the buttons in it are skipped by Tab but can still be
// clicked, and the arrows reach them. Enter and Space open the focused card (ItemCard does that).
//
// The grid's items are its direct children that can take the focus (a card with `tabindex`).

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
/** On what the action set to -1 inside a card that isn't the one Tab lands on: its own tabindex, to give back. */
const MARK = "data-roving";

/** The columns of a grid, from the top edge of each item in order: how many share the first one's row. */
export function columnsOf(tops: number[]): number {
  if (!tops.length) return 1;
  let n = 0;
  while (n < tops.length && Math.abs(tops[n] - tops[0]) < 2) n++;
  return Math.max(1, n);
}

/**
 * Where an arrow key (or Home, End) takes the focus from item `from` of `count`, in a grid of
 * `columns`: the item's index, or null when the key goes nowhere (the first card's Left, the
 * bottom row's Down, any other key). Up and Down keep to the column, staying put on the first and
 * last row; Left and Right carry over to the next row.
 */
export function arrowTarget(key: string, from: number, count: number, columns: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return from < last ? from + 1 : null;
    case "ArrowLeft":
      return from > 0 ? from - 1 : null;
    case "ArrowDown":
      // The row below; from the one above a short last row, its last card; from the last row, nowhere.
      return from + columns <= last ? from + columns : Math.floor(from / columns) < Math.floor(last / columns) ? last : null;
    case "ArrowUp":
      return from - columns >= 0 ? from - columns : null;
    case "Home":
      return from > 0 ? 0 : null;
    case "End":
      return from < last ? last : null;
    default:
      return null;
  }
}

/** The parts of a keyboard event the handler reads. */
export interface KeyLike {
  key: string;
  target: unknown;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
}

/**
 * The grid's keydown: an arrow key on one of its items focuses another. A key pressed in a field
 * or button inside a card is left alone. Returns whether it moved the focus.
 */
export function rovingKey(e: KeyLike, items: { focus: () => void; getBoundingClientRect: () => { top: number } }[]): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const from = items.indexOf(e.target as never);
  if (from < 0) return false;
  const to = arrowTarget(e.key, from, items.length, columnsOf(items.map((i) => i.getBoundingClientRect().top)));
  if (to == null) return false;
  e.preventDefault();
  items[to].focus();
  return true;
}

export function roving(node: HTMLElement) {
  const items = () => [...node.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("tabindex"));
  let active: HTMLElement | null = null;

  /** `item` and what's in it: Tab-reachable (the active one) or skipped. */
  function set(item: HTMLElement, reachable: boolean) {
    item.tabIndex = reachable ? 0 : -1;
    for (const el of item.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (reachable) {
        const was = el.getAttribute(MARK);
        if (was == null) continue;
        el.removeAttribute(MARK);
        if (was) el.setAttribute("tabindex", was);
        else el.removeAttribute("tabindex");
      } else if (el.tabIndex >= 0) {
        el.setAttribute(MARK, el.getAttribute("tabindex") ?? "");
        el.tabIndex = -1;
      }
    }
  }
  /** A card drawn after the pass (the rest of a long grid comes a few a frame): skipped like its neighbours. */
  function drawn(item: HTMLElement) {
    if (!active?.isConnected) active = items()[0] ?? null;
    set(item, item === active);
  }
  function settle() {
    const all = items();
    if (!active || !active.isConnected || !all.includes(active)) active = all[0] ?? null;
    for (const item of all) set(item, item === active);
  }
  /** The item the element is in, if it's one of the grid's. */
  const itemOf = (el: EventTarget | Node | null): HTMLElement | null => {
    let n = el instanceof Node ? el : null;
    while (n && n.parentNode !== node) n = n.parentNode;
    return n instanceof HTMLElement && n.hasAttribute("tabindex") ? n : null;
  };

  function onfocusin(e: FocusEvent) {
    const item = itemOf(e.target);
    if (!item || item === active) return;
    const was = active;
    active = item;
    if (was?.isConnected) set(was, false);
    set(item, true);
  }
  function onkeydown(e: KeyboardEvent) {
    rovingKey(e, items());
  }

  settle();
  // Cards come and go (a filter, the rest of a long grid drawn a few at a time, a sort).
  const mo = new MutationObserver((records) => {
    let again = false;
    for (const r of records) {
      for (const added of r.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        // A card, or something drawn inside one (its List button arriving).
        const item = itemOf(added);
        if (item) drawn(item);
      }
      if (r.removedNodes.length && active && !active.isConnected) again = true;
    }
    if (again) settle();
  });
  mo.observe(node, { childList: true, subtree: true });
  node.addEventListener("focusin", onfocusin);
  node.addEventListener("keydown", onkeydown);
  return {
    destroy() {
      mo.disconnect();
      node.removeEventListener("focusin", onfocusin);
      node.removeEventListener("keydown", onkeydown);
    },
  };
}
