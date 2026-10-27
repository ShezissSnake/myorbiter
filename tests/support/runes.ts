// Import this first in a test that loads a store (`*.svelte.ts`): it registers the hooks that
// compile runes, and gives the tests Svelte's own flush and effect root.
import { register } from "node:module";

register("./runes-hooks.mjs", import.meta.url);

// @ts-expect-error: Svelte's client internals have no type declarations
const internal: { flush: () => void; effect_root: (f: () => void) => () => void } = await import("svelte/internal/client");
/** Runs pending effects now. */
export const flush = () => internal.flush();
/** Effects created inside `f` live until the returned function is called. */
export const effectRoot = (f: () => void) => internal.effect_root(f);
/** Lets queued promise callbacks (a mocked request finishing) run. */
export const settle = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
