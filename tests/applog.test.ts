// The window's side of the log: nothing is wrapped in a browser (the console is the log there).
import { test } from "node:test";
import assert from "node:assert/strict";

test("in a browser, logging leaves the console alone", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = g.window;
  g.window = { addEventListener: () => { throw new Error("shouldn't listen"); } };
  const before = console.error;
  const { installLogging } = await import("../src/lib/applog");
  installLogging();
  assert.equal(console.error, before);
  g.window = had;
});
