// Pages stay mounted once opened (App's panes), hidden while another is on screen. A hidden page
// shouldn't redo its heavy work every time something it reads changes (a sync, the squad, the
// ducat rate on another page): that work is what made clicks slow. So:
// - App says which page is on screen (`setShownPage`);
// - a page wraps its heavy rows in `whileShown`: worked out while the page is on screen, and kept
//   as they were while it's hidden;
// - after a change, App lets the hidden pages catch up one at a time when the app is idle
//   (`catchUp`), so the next visit finds them current, and a visit catches up at once anyway.
// What a page shows is always what the same rows would be worked out fresh: only *when* changes.
import { untrack } from "svelte";

let current: () => string = () => "";
/** App: where to read the page on screen from (its tab, a reactive read). */
export function setShownPage(read: () => string) {
  current = read;
}
/** The page `id` is the one on screen (reactive). */
export const shownPage = (id: string) => current() === id;

/** Per page, a count bumped when a hidden page should catch up (`catchUp`). */
const ticks = $state<Record<string, number>>({});
/** Lets the hidden page `id` work out what changed since it was last drawn. */
export function catchUp(id: string) {
  ticks[id] = (ticks[id] ?? 0) + 1;
}

/**
 * `f` worked out while page `id` is on screen; while it's hidden, what it was when last worked
 * out, until the page is shown again or catches up (then `f` runs only if what it reads changed:
 * it's a derived of its own). The first read always works it out, so a page opened in the
 * background is ready. Use as `const rows = $derived.by(whileShown("inventory", () => …))`.
 * Call while a component initializes (it creates deriveds that live as long as it).
 */
export function whileShown<T>(id: string, f: () => T): () => T {
  const live = $derived.by(f);
  let kept: T;
  let have = false;
  let seen = 0;
  const held = $derived.by(() => {
    const t = ticks[id] ?? 0;
    // On screen: tracked, so a change shows at once. Hidden: read untracked, so `live` isn't a
    // dependency and a change to what it reads doesn't wake this page.
    if (shownPage(id)) kept = live;
    else if (!have || t !== seen) kept = untrack(() => live);
    seen = t;
    have = true;
    return kept;
  });
  return () => held;
}

/** Runs `f` when the app is idle (or soon, where there's no requestIdleCallback: WebKitGTK). */
export function whenIdle(f: () => void, timeout = 2000): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(f, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(f, 40);
  return () => clearTimeout(id);
}
