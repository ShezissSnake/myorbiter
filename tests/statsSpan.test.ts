// Stats' "30 days" and Sales' "Last 30 days" cover the same days while the app stays open: each
// page keeps a clock that ticks while it's on screen and not while it's hidden, and works its
// span out from that clock, so a span picked days ago moves on with the time.
import { flush, effectRoot } from "./support/runes";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { whileShownEvery, setShownPage } = await import("../src/lib/pane.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const internal = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T; user_effect: (f: () => void | (() => void)) => void };

const DAY = 86_400_000;
const source = (page: string) => readFileSync(new URL(`../src/lib/tabs/${page}.svelte`, import.meta.url), "utf8");
/** The page's clock, as its source sets it up: the page id and how often it ticks. */
function clockOf(page: string) {
  const m = source(page).match(/\$effect\(\(\) => whileShownEvery\("(\w+)", ([\d_]+), \(\) => \(now = Date\.now\(\)\), \(\) => now\)\);/);
  assert.ok(m, `${page} keeps a clock that ticks while it's shown`);
  return { id: m[1], every: Number(m[2].replace(/_/g, "")) };
}

test("Stats works its span out from a clock that ticks while it's shown, as Sales does", () => {
  const stats = source("Stats");
  assert.match(stats, /const since = \$derived\(span === "all" \? 0 : now - Number\(span\) \* DAY\);/, "Stats' span starts from its clock");
  assert.doesNotMatch(stats, /const since = [^\n]*Date\.now\(\)/, "not from the moment the span was picked");
  assert.match(source("Sales"), /const month = \$derived\.by\(whileShown\("sales", \(\) => since\(now - 30 \* DAY\)\)\);/, "Sales' month starts from its clock");
  assert.deepEqual(clockOf("Stats"), { id: "stats", every: clockOf("Sales").every }, "the same period as Sales'");
});

test("two days on, with the app open all along: Stats' 30 days and Sales' last 30 days hold the same sales", () => {
  const start = Date.UTC(2026, 10, 10, 12);
  mock.timers.enable({ apis: ["Date", "setInterval"], now: start });
  try {
    // The audit's seed: 60p two days ago, 30p 20 days ago, 150p 29.5 days ago.
    const sales = [{ at: start - 2 * DAY, platinum: 60 }, { at: start - 20 * DAY, platinum: 30 }, { at: start - 29.5 * DAY, platinum: 150 }];
    const app = internal.proxy({ tab: "stats" });
    setShownPage(() => app.tab);
    const pages = ["Stats", "Sales"].map((p) => ({ ...clockOf(p), clock: internal.proxy({ now: Date.now() }), ticks: 0 }));
    const stop = effectRoot(() => {
      for (const p of pages)
        internal.user_effect(() => whileShownEvery(p.id, p.every, () => ((p.clock.now = Date.now()), p.ticks++), () => p.clock.now));
    });
    flush();
    // Each page's 30 days, as it works them out: from its own clock.
    const inSpan = (p: (typeof pages)[number]) => sales.filter((s) => s.at >= p.clock.now - 30 * DAY).reduce((n, s) => n + s.platinum, 0);
    const [stats, sales_] = pages;
    assert.equal(inSpan(stats), 240);
    app.tab = "sales";
    flush();
    assert.equal(inSpan(sales_), 240);
    // Two days pass with Sales on screen: Stats is hidden, and its clock doesn't tick.
    const before = stats.ticks;
    mock.timers.tick(2 * DAY);
    assert.equal(stats.ticks, before, "nothing ticks on the hidden page");
    assert.equal(inSpan(sales_), 90, "the 150p sale is now 31.5 days old");
    // Back on Stats: its clock catches up at once, and the two pages agree.
    app.tab = "stats";
    flush();
    assert.equal(stats.clock.now, Date.now());
    assert.equal(inSpan(stats), inSpan(sales_));
    assert.equal(inSpan(stats), 90);
    stop();
  } finally {
    mock.timers.reset();
  }
});
