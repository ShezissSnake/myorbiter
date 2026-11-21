// Only the pages are inside an error boundary: a promise that fails outside them (in the frame
// around the pages) is said in one line, once a session, with a reload and Report a bug (App.svelte).
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";

test("a failure outside a page raises the line once a session; dismissed, it doesn't come back", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = g.window;
  const heard: Record<string, ((e: unknown) => void)[]> = {};
  g.window = { addEventListener: (type: string, f: (e: unknown) => void) => (heard[type] ??= []).push(f) };
  try {
    const { watchFailures } = await import("../src/lib/applog");
    const { bugReport } = await import("../src/lib/bugReport.svelte");
    watchFailures();
    watchFailures();
    assert.equal(heard.unhandledrejection?.length, 1, "listened to once");
    assert.equal(bugReport.failed, false);
    heard.unhandledrejection[0]({ reason: new Error("example") });
    assert.equal(bugReport.failed, true);
    bugReport.failed = false;
    heard.unhandledrejection[0]({ reason: new Error("again") });
    assert.equal(bugReport.failed, false, "once a session");
  } finally {
    g.window = had;
  }
});
