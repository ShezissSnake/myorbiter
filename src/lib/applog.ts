// The window's side of MyOrbiter's log (applog.rs): errors nobody would otherwise see (a page that
// failed, a promise that went wrong), and what console.error and console.warn report, go to the
// log file too. Installed once, at start.
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
 * Something that failed outside a page (a promise nothing waited on): only the pages are inside an
 * error boundary, so the window says so itself, once a session (bugReport.svelte.ts registers it).
 */
let failed: () => void = () => {};
export function whenSomethingFails(f: () => void) {
  failed = f;
}

export function installLogging() {
  // Only the desktop app has a log file; in a browser the console is the log (and wrapping it would
  // send each line back to itself).
  if (installed || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  installed = true;
  window.addEventListener("error", (e) => logLine("error", "ui", `${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}${e.error ? `\n${text(e.error)}` : ""}`));
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
}
