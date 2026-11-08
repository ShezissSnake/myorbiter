// The window's side of MyOrbiter's log (applog.rs): errors nobody would otherwise see (a page that
// failed, a promise that went wrong), and what console.error and console.warn report, go to the
// log file too. Installed once, at start.
import { logLine } from "./backend";

let installed = false;

const text = (x: unknown): string => {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack.split("\n").slice(1, 6).join("\n")}` : ""}`;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
};

export function installLogging() {
  // Only the desktop app has a log file; in a browser the console is the log (and wrapping it would
  // send each line back to itself).
  if (installed || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  installed = true;
  window.addEventListener("error", (e) => logLine("error", "ui", `${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}${e.error ? `\n${text(e.error)}` : ""}`));
  window.addEventListener("unhandledrejection", (e) => logLine("error", "ui", `Unhandled: ${text(e.reason)}`));
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      logLine(level, "ui", args.map(text).join(" "));
    };
  }
}
