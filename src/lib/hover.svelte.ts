// Hover cards: point at anything with a name (a relic, a part, a mod, a warframe) and a card shows
// what it is and what it's worth to you. `use:info={name}` on any element; App renders the card.
//
// One set of listeners on the document serves every element (pages have thousands of names), and
// the action only records what each element is about.
export interface HoverTarget {
  name: string;
  unique?: string | null;
  rect: DOMRect;
  /** A click on it opens the item's details (a card, a row, a button), so the card can say so. */
  opens?: boolean;
}

/** What a click opens details from: marked with `data-opens`, a clickable card or row, or a button that is itself the name. */
const OPENS = "[data-opens], [role=button], tr.clickable, button[data-hover]";

class Hover {
  target = $state.raw<HoverTarget | null>(null);
}
export const hover = new Hover();

type Info = { name: string; unique: string | null };
type Arg = string | null | undefined | { name: string | null | undefined; unique?: string | null };
const norm = (a: Arg): Info | null =>
  a == null ? null : typeof a === "string" ? (a ? { name: a, unique: null } : null) : a.name ? { name: a.name, unique: a.unique ?? null } : null;

const about = new WeakMap<HTMLElement, Info>();
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
const SHOW_AFTER = 260;
/** The element the card is showing for, and the one waiting to show: only they may close it. */
let owner: HTMLElement | null = null;
let pending: HTMLElement | null = null;

export function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hover.target = null;
  owner = pending = null;
}

function show(node: HTMLElement) {
  const a = about.get(node);
  if (!a || node === owner || node === pending) {
    if (node === owner) clearTimeout(hideTimer);
    return;
  }
  clearTimeout(hideTimer);
  clearTimeout(showTimer);
  // Already showing something: switch at once, so moving along a row of icons feels quick.
  const delay = hover.target ? 40 : SHOW_AFTER;
  pending = node;
  showTimer = setTimeout(() => {
    pending = null;
    owner = node;
    hover.target = { ...a, rect: node.getBoundingClientRect(), opens: !!node.closest(OPENS) };
  }, delay);
}

function leave(node: HTMLElement) {
  if (pending === node) {
    clearTimeout(showTimer);
    pending = null;
  }
  if (owner !== node) return;
  hideTimer = setTimeout(() => {
    hover.target = null;
    owner = null;
  }, 90);
}

const target = (e: Event) => ((e.target as Element | null)?.closest?.("[data-hover]") as HTMLElement | null) ?? null;

// The keyboard: a focused card, row or button shows the card for the name it is or holds. Only
// keyboard focus (:focus-visible), so a click doesn't leave a card hanging over what it opened.
const FOCUSABLE = "a[href], button, [role=button], tr[tabindex], [tabindex]:not([tabindex='-1'])";
function focusTarget(e: Event): HTMLElement | null {
  const t = e.target as HTMLElement | null;
  if (!t?.closest) return null;
  return (t.closest("[data-hover]") as HTMLElement | null) ?? (t.matches(FOCUSABLE) ? t.querySelector<HTMLElement>("[data-hover]") : null);
}
function keyboardFocus(e: Event) {
  try {
    return (e.target as Element).matches(":focus-visible");
  } catch {
    return true;
  }
}

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointerover", (e) => {
    const el = target(e);
    if (el) show(el);
  });
  document.addEventListener("pointerout", (e) => {
    const el = target(e);
    // Moving within the same element (onto a child) isn't leaving it.
    if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) leave(el);
  });
  document.addEventListener("focusin", (e) => {
    const el = focusTarget(e);
    if (el && keyboardFocus(e)) show(el);
  });
  document.addEventListener("focusout", (e) => {
    const el = focusTarget(e);
    if (el) leave(el);
  });
  document.addEventListener("pointerdown", () => hover.target && hide(), true);
}

export function info(node: HTMLElement, arg: Arg) {
  install();
  const set = (a: Info | null) => {
    if (a) {
      about.set(node, a);
      node.dataset.hover = "";
    } else {
      about.delete(node);
      delete node.dataset.hover;
    }
  };
  set(norm(arg));
  return {
    update(next: Arg) {
      const a = norm(next);
      set(a);
      // Showing for this element: follow the new name.
      if (owner === node && hover.target) {
        if (a) hover.target = { ...a, rect: hover.target.rect, opens: hover.target.opens };
        else hide();
      }
    },
    destroy() {
      about.delete(node);
      // Only the element the card belongs to closes it: a chip inside the card going away mustn't.
      if (pending === node) {
        clearTimeout(showTimer);
        pending = null;
      }
      if (owner === node) hide();
    },
  };
}
