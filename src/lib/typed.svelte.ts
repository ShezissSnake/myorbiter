// A search box that filters a long list: the box shows each letter at once, and the list follows
// a moment later. The first change after a pause is applied right after the box has drawn it (the
// next task), and changes while you keep typing once the typing pauses. So a key is never held up
// by refiltering and redrawing thousands of rows, and a word typed is filtered once, not per letter.
// Clearing the box is the same: the empty box draws at once, the full list just after.

/** After this long without a change, the next one counts as the first of a burst. */
const BURST_MS = 250;
/** While typing, the list follows once the keys pause this long. */
const PAUSE_MS = 110;

/**
 * What `get()` was, following it as above. Use as `const q = $derived.by(typed(() => query))`, and
 * filter on `q`. `now(v)`: a value to take at once. Call while a component initializes.
 */
export function typed<T>(get: () => T, now?: (v: T) => boolean): () => T {
  let value = $state.raw(get());
  let last = 0;
  $effect(() => {
    const next = get();
    if (next === value) return;
    // Some values are cheap to show and wrong to show late (an emptied box over old matches).
    if (now?.(next)) return void (value = next);
    const at = performance.now();
    const first = at - last > BURST_MS;
    last = at;
    let t: ReturnType<typeof setTimeout> | undefined;
    // The first of a burst: once the box has drawn the change (the frame after it, then a task).
    const f = first && typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame(() => (t = setTimeout(() => apply(next), 0))) : null;
    if (f == null) t = setTimeout(() => apply(next), first ? 0 : PAUSE_MS);
    return () => {
      if (f != null) cancelAnimationFrame(f);
      clearTimeout(t);
    };
  });
  function apply(next: T) {
    value = next;
  }
  return () => value;
}
