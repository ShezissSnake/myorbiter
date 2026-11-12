// What's New on start: opened once, after an update whose changes haven't been seen, and only once
// the saved settings are in (before that, `seen` is the defaults' "everything seen"). App says when
// that is with `ready()`, after the first start's question (FirstRun.svelte) if there is one.
// `ready` is reactive on purpose: the settings arrive (and the check runs, too early) a moment
// before App is ready, and nothing in `seen` changes after that to run the check again.
import { newsSince } from "./whatsNew";

export function whatsNewOnce(seen: () => string, open: () => void) {
  let ready = $state(false);
  let checked = false;
  $effect(() => {
    const s = seen();
    if (!ready || checked) return;
    checked = true;
    if (newsSince(s).length) open();
  });
  return {
    ready() {
      ready = true;
    },
  };
}
