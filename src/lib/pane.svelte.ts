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
  return held(() => shownPage(id), f, () => ticks[id] ?? 0);
}

/**
 * The same for a part of a page that's kept drawn while out of sight (a tab, the table under the
 * cards): `f` while `visible()`, else what it was. Switching back is then only a matter of showing it.
 */
export function keepWhile<T>(visible: () => boolean, f: () => T): () => T {
  return held(visible, f, () => 0);
}

function held<T>(visible: () => boolean, f: () => T, tick: () => number): () => T {
  const live = $derived.by(f);
  let kept: T;
  let have = false;
  let seen = 0;
  const out = $derived.by(() => {
    const t = tick();
    // In sight: tracked, so a change shows at once. Out of sight: read untracked, so `live` isn't
    // a dependency and a change to what it reads doesn't wake this part.
    if (visible()) kept = live;
    else if (!have || t !== seen) kept = untrack(() => live);
    seen = t;
    have = true;
    return kept;
  });
  return () => out;
}

/**
 * Runs `f` once the app is really idle: an idle period with room for a slice of work (`room` ms),
 * so a slice doesn't start just before the next frame or a click. Where there's no
 * requestIdleCallback (WebKitGTK), a little later instead.
 */
export function whenIdle(f: () => void, room = 30): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    let id = 0;
    const ask = () => (id = window.requestIdleCallback((d) => (d.timeRemaining() >= room || d.didTimeout ? f() : ask()), { timeout: 10_000 }));
    ask();
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(f, 300);
  return () => clearTimeout(id);
}
