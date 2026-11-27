// In the desktop app: an error thrown outside a page and outside a promise (one of App.svelte's own
// effects, flushed from a microtask) reaches the window as an "error" event. It is logged and shows
// the same line a rejection does, once a session; a browser notice with no thrown value is logged
// and shows nothing.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

test("in the desktop app, an error thrown outside a page is logged and shows the line once a session", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = g.window;
  const heard: Record<string, ((e: unknown) => void)[]> = {};
  const logged: { level: string; area: string; message: string }[] = [];
  g.window = {
    addEventListener: (type: string, f: (e: unknown) => void) => (heard[type] ??= []).push(f),
    __TAURI_INTERNALS__: {
      invoke: async (cmd: string, args: { level: string; area: string; message: string }) => {
        if (cmd === "log_line") logged.push(args);
        return null;
      },
    },
  };
  const console0 = { error: console.error, warn: console.warn };
  /** Lets the log's invoke (an awaited import first) reach the fake. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  try {
    const { installLogging } = await import("../src/lib/applog");
    const { bugReport } = await import("../src/lib/bugReport.svelte");
    installLogging();
    installLogging();
    assert.equal(heard.error?.length, 1, "error events listened to once");
    const fire = (e: unknown) => heard.error[0](e);

    fire({ type: "error", message: "ResizeObserver loop completed with undelivered notifications.", error: null });
    await settle();
    assert.equal(bugReport.failed, false, "a notice with no thrown value shows nothing");
    assert.equal(logged.length, 1, "and is logged");

    fire({ type: "error", message: "Uncaught Error: an effect failed", filename: "http://tauri.localhost/assets/index.js", lineno: 7, error: new Error("an effect failed") });
    await settle();
    assert.equal(bugReport.failed, true, "a thrown error shows the line");
    assert.equal(logged.length, 2);
    assert.equal(logged[1].level, "error");
    assert.match(logged[1].message, /an effect failed \(index\.js:7\)/);

    bugReport.failed = false;
    fire({ type: "error", message: "Uncaught Error: again", error: new Error("again") });
    heard.unhandledrejection[0]({ reason: new Error("and a rejection") });
    await settle();
    assert.equal(bugReport.failed, false, "once a session, whichever way the next failure comes");
    assert.equal(logged.length, 4, "each one still logged");
  } finally {
    console.error = console0.error;
    console.warn = console0.warn;
    g.window = had;
  }
});
