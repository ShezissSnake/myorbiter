// In a browser (the demo, dev mode): an error thrown outside a page and outside a promise (one of
// App.svelte's own effects, flushed from a microtask) reaches the window as an "error" event, not a
// rejection. It shows the same line a rejection does, once a session; a picture that didn't load,
// or a browser notice that carries no thrown value, shows nothing.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

test("in a browser, an error thrown outside a page shows the line once a session; a resource or a notice doesn't", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = g.window;
  const heard: Record<string, ((e: unknown) => void)[]> = {};
  g.window = { addEventListener: (type: string, f: (e: unknown) => void) => (heard[type] ??= []).push(f) };
  try {
    const { watchFailures } = await import("../src/lib/applog");
    const { bugReport } = await import("../src/lib/bugReport.svelte");
    watchFailures();
    watchFailures();
    assert.equal(heard.error?.length, 1, "error events listened to once");
    const fire = (e: unknown) => heard.error[0](e);

    // A picture that failed to load: a plain event, no message, no thrown value.
    fire({ type: "error", target: { tagName: "IMG" } });
    // The browser's own notice: an ErrorEvent with a message and no thrown value.
    fire({ type: "error", message: "ResizeObserver loop completed with undelivered notifications.", error: null });
    // A script from another origin, muted.
    fire({ type: "error", message: "Script error.", filename: "", lineno: 0, error: null });
    assert.equal(bugReport.failed, false, "none of them is the app's code failing");

    fire({ type: "error", message: "Uncaught Error: an effect failed", error: new Error("an effect failed") });
    assert.equal(bugReport.failed, true, "a thrown error shows the line");

    bugReport.failed = false;
    fire({ type: "error", message: "Uncaught Error: again", error: new Error("again") });
    heard.unhandledrejection[0]({ reason: new Error("and a rejection") });
    assert.equal(bugReport.failed, false, "once a session, whichever way the next failure comes");
  } finally {
    g.window = had;
  }
});
