// The window's side of MyOrbiter's log (applog.rs): errors nobody would otherwise see (a page that
// failed, a promise that went wrong, an error thrown outside a page), and what console.error and
// console.warn report, go to the log file too. Installed once, at start.
import { logLine } from "./backend";

let installed = false;
let watching = false;

const text = (x: unknown): string => {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack.split("\n").slice(1, 6).join("\n")}` : ""}`;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

/**
 * Something that failed outside a page: only the pages are inside an error boundary, so the window
 * says so itself, once a session (bugReport.svelte.ts registers it). It reaches the window two ways:
 * a promise nothing waited on (an "unhandledrejection" event), or an error thrown outside a promise,
 * as in one of App.svelte's own effects, which Svelte runs from a microtask (an "error" event).
 */
let failed: () => void = () => {};
export function whenSomethingFails(f: () => void) {
  failed = f;
}

/**
 * An "error" event that carries a thrown value: the app's own code failed. Not a picture or another
 * resource that didn't load (a plain Event with no `error`, which doesn't reach the window's own
 * listener anyway, as it doesn't bubble), nor a notice the browser raises with no thrown value, such
 * as "ResizeObserver loop completed with undelivered notifications" or a muted "Script error.".
 * Those are still logged on the desktop, and say nothing to the player.
 */
export const thrownByCode = (e: Event): boolean => (e as ErrorEvent).error != null;

export function installLogging() {
  // Only the desktop app has a log file; in a browser the console is the log (and wrapping it would
  // send each line back to itself).
  if (installed || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  installed = true;
  window.addEventListener("error", (e) => {
    logLine("error", "ui", `${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}${e.error ? `\n${text(e.error)}` : ""}`);
    if (thrownByCode(e)) failed();
  });
  window.addEventListener("unhandledrejection", (e) => {
    logLine("error", "ui", `Unhandled: ${text(e.reason)}`);
    failed();
  });
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      logLine(level, "ui", args.map(text).join(" "));
    };
  }
}

/** In a browser (the demo, dev mode), where installLogging listens to nothing: the same line, with no log. */
export function watchFailures() {
  if (watching || typeof window === "undefined" || "__TAURI_INTERNALS__" in window) return;
  watching = true;
  window.addEventListener("unhandledrejection", () => failed());
  window.addEventListener("error", (e) => {
    if (thrownByCode(e)) failed();
  });
}
