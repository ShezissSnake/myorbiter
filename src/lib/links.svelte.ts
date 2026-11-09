// Links opening in your browser: which are on their way (their control reads "Opening…", see
// ui/Opening.svelte), and whether the last one couldn't open (the notice in the corner,
// LinkTrouble.svelte, which points to the logs). Every link a page opens goes through `openUrl`.
import { linkOpener, logLine } from "./backend";
import { openable } from "./core/links";

class Links {
  /** The links on their way, as checked (normalised). */
  opening = $state<string[]>([]);
  /** Why the last link couldn't open; cleared when one opens, or the notice is dismissed. */
  trouble = $state<string | null>(null);

  /** Whether `url` is on its way. */
  isOpening(url: string): boolean {
    const safe = openable(url);
    return safe != null && this.opening.includes(safe);
  }

  /** Opens `url` if it's a link to one of MyOrbiter's sites (anything else is refused and logged). */
  async open(url: string): Promise<void> {
    const safe = openable(url);
    if (!safe) {
      logLine("warn", "app", `refused to open a link outside MyOrbiter's sites: ${url.slice(0, 200)}`);
      return;
    }
    // A second click while it's on its way opens nothing more.
    if (this.opening.includes(safe)) return;
    this.opening = [...this.opening, safe];
    try {
      await linkOpener.open(safe);
      this.trouble = null;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // Only the address up to its query: a bug report link carries the whole report there.
      logLine("warn", "app", `couldn't open ${safe.split("?")[0]}: ${why}`);
      this.trouble = why || "the browser didn't start";
    } finally {
      this.opening = this.opening.filter((u) => u !== safe);
    }
  }

  dismiss() {
    this.trouble = null;
  }
}

export const links = new Links();

/** Opens a link in your browser: only https links to the sites in core/links.ts. */
export const openUrl = (url: string): Promise<void> => links.open(url);
