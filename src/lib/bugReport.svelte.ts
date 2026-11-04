// Report a bug: whether its dialog is open, so any help corner can open it (Settings, the Guide,
// the sidebar, Shift+F1) and App.svelte draws it once (ui/BugReport.svelte).

class BugReportStore {
  open = $state(false);
  /** What's typed so far: kept while orbiter runs, so closing the dialog loses nothing. */
  draft = $state({ what: "", steps: "", expected: "", include: true });
  show() {
    this.open = true;
  }
}

export const bugReport = new BugReportStore();

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
