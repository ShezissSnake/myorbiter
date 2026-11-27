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
  // installLogging wraps console.error and console.warn, so anything else said on the console while
  // the test runs is logged too: a warning Node raises itself goes out through console.error, and
  // Node 26 raised a deprecation warning in test processes. Each event's line is told by what it
  // says, never by the number of lines. The console is quiet meanwhile, so the warning raised below
  // prints nothing.
  const lines = (says: RegExp) => logged.filter((l) => says.test(l.message));
  /** What reached the log, for a failure's message. */
  const all = () => JSON.stringify(logged.map((l) => l.message));
  const console0 = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  /** Lets the log's invoke (an awaited import first) reach the fake. */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const notice = /^ResizeObserver loop completed with undelivered notifications\.$/;
  const effect = /^Uncaught Error: an effect failed \(index\.js:7\)\nError: an effect failed/;
  const again = /^Uncaught Error: again\nError: again/;
  const rejection = /^Unhandled: Error: and a rejection/;
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
    assert.equal(lines(notice).length, 1, `and is logged, once: ${all()}`);

    // Something else said on the console in the middle of the test, and a warning raised as Node
    // raises its own (whether Node writes it out is Node's affair, so the test doesn't ask): logged,
    // and not taken for a line of the test's own events.
    process.emitWarning("a warning raised in the middle of the test", "ExampleWarning");
    console.warn("something else said on the console");
    await settle();
    assert.equal(lines(/^something else said on the console$/).length, 1, `the console is still logged: ${all()}`);

    fire({ type: "error", message: "Uncaught Error: an effect failed", filename: "http://tauri.localhost/assets/index.js", lineno: 7, error: new Error("an effect failed") });
    await settle();
    assert.equal(bugReport.failed, true, "a thrown error shows the line");
    assert.equal(lines(effect).length, 1, `and is logged, once: ${all()}`);
    assert.equal(lines(effect)[0].level, "error");

    bugReport.failed = false;
    fire({ type: "error", message: "Uncaught Error: again", error: new Error("again") });
    heard.unhandledrejection[0]({ reason: new Error("and a rejection") });
    await settle();
    assert.equal(bugReport.failed, false, "once a session, whichever way the next failure comes");
    assert.equal(lines(again).length, 1, `each one still logged, once: ${all()}`);
    assert.equal(lines(rejection).length, 1, `each one still logged, once: ${all()}`);
    assert.equal(lines(notice).length + lines(effect).length, 2, `and the earlier lines not again: ${all()}`);
  } finally {
    console.error = console0.error;
    console.warn = console0.warn;
    g.window = had;
  }
});
