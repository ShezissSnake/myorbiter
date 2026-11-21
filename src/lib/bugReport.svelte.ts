// Report a bug: whether its dialog is open, so any help corner can open it (Settings, the Guide,
// the sidebar, Shift+F1) and App.svelte draws it once (ui/BugReport.svelte). And the line that
// offers it when something outside a page failed (applog.ts).
import { flushSettings } from "./backend";
import { whenSomethingFails } from "./applog";

class BugReportStore {
  open = $state(false);
  /** What's typed so far: kept while MyOrbiter runs, so closing the dialog loses nothing. */
  draft = $state({ what: "", steps: "", expected: "", include: true });
  /** Something outside a page failed: App.svelte says so in one line, with a reload and Report a bug. */
  failed = $state(false);
  private told = false;
  show() {
    this.open = true;
  }
  /** Once a session: dismissed, the line doesn't come back until the window starts again. */
  noteFailure() {
    if (this.told) return;
    this.told = true;
    this.failed = true;
  }
  /** The line's way on: the window starts again, with what's waiting to be saved saved first. */
  async reload() {
    await flushSettings().catch(() => {});
    location.reload();
  }
}

export const bugReport = new BugReportStore();
whenSomethingFails(() => bugReport.noteFailure());

/**
 * The release channel this copy came from (Stable, Beta, Experimental, or "local build"), for a
 * report's technical details. App.svelte sets it once the settings are read; until then it's null
 * and a report carries the version only.
 */
let channelOf: () => string | null = () => null;
export const reportChannel = (): string | null => channelOf();
export function setReportChannel(f: () => string | null) {
  channelOf = f;
}
