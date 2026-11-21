// The cheap-buy scan reads up to 20 order books from warframe.market, and one more per price
// alert. It runs only while its result can reach the player: the Cheap buys notification is on,
// or Home's Cheap buys card is on and the window is not hidden. These tests count the scans a day
// of the page's 30-second clock asks for. Nothing reaches the network: only the decision is run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEALS_EVERY, dealsScanDue } from "../src/lib/core/deals";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const START = 1_792_700_000_000;

/** Scans over `span` ms of 30-second ticks, with the gate's inputs at each tick from `at`. */
function scans(at: (t: number) => { notify: boolean; cardOn: boolean; hidden: boolean }, span = DAY): number[] {
  let last = 0;
  const out: number[] = [];
  for (let t = 0; t < span; t += 30_000) {
    const now = START + t;
    if (dealsScanDue({ now, last, model: true, console: false, ...at(t) })) {
      last = now;
      out.push(t);
    }
  }
  return out;
}

test("with the notification off and Home's card off, no order book is asked for the scan", () => {
  assert.equal(scans(() => ({ notify: false, cardOn: false, hidden: false })).length, 0, "a day: no scan");
  assert.equal(scans(() => ({ notify: false, cardOn: false, hidden: true })).length, 0, "hidden too");
});

test("with only Home's card on, nothing is scanned while the window is hidden", () => {
  assert.equal(scans(() => ({ notify: false, cardOn: true, hidden: true })).length, 0);
  // Shown for the first 12 hours, hidden for the rest: the shown half only.
  assert.equal(scans((t) => ({ notify: false, cardOn: true, hidden: t >= DAY / 2 })).length, 72);
});

test("while the result can reach the player, the scan keeps its pace of one every 10 minutes", () => {
  assert.equal(DEALS_EVERY, 10 * MIN);
  assert.equal(scans(() => ({ notify: false, cardOn: true, hidden: false })).length, 144, "the card on, the window shown");
  assert.equal(scans(() => ({ notify: true, cardOn: false, hidden: true })).length, 144, "the notification on reaches the player hidden too");
  assert.equal(scans(() => ({ notify: true, cardOn: true, hidden: false })).length, 144);
});

test("when the card or the notification comes back, the next scan is due at once, and never sooner than 10 minutes after the last", () => {
  // Off for the first 3 hours, then the card is turned on: a scan at that very tick.
  const back = scans((t) => ({ notify: false, cardOn: t >= 3 * 60 * MIN, hidden: false }), 4 * 60 * MIN);
  assert.equal(back[0], 3 * 60 * MIN, "at once");
  assert.equal(back.length, 6, "then every 10 minutes");
  // A scan at 0, the window hidden from minute 2 to minute 6: shown again, it waits for minute 10.
  const brief = scans((t) => ({ notify: false, cardOn: true, hidden: t >= 2 * MIN && t < 6 * MIN }), 30 * MIN);
  assert.deepEqual(brief, [0, 10 * MIN, 20 * MIN], "no scan more often than before");
});

test("on a console, or before the collection is built, there is no scan, as before", () => {
  const on = { now: START, last: 0, notify: true, cardOn: true, hidden: false };
  assert.equal(dealsScanDue({ ...on, model: true, console: true }), false);
  assert.equal(dealsScanDue({ ...on, model: false, console: false }), false);
  assert.equal(dealsScanDue({ ...on, model: true, console: false }), true);
});

test("the page's scan goes by the decision, with the notification, Home's card and the window's visibility", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const effect = app.slice(app.indexOf("// Cheap buys: the watchlist's order books"), app.indexOf("mkt.scanDeals(m,"));
  assert.match(effect, /dealsScanDue\(\{[^}]*notify: settings\.notify\.deals/);
  assert.match(effect, /cardOn: !settings\.homeHidden\.includes\("deals"\)/);
  assert.match(effect, /hidden: pageHidden/);
  assert.match(app, /document\.addEventListener\("visibilitychange", seen\)/, "the window's visibility is followed, so a scan is due as soon as it shows");
});
