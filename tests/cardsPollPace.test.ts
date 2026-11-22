// The reward screen's file is asked for every 0.8 s while a TennoScope can be writing it. These
// tests count the reads a minute of the page's ticks asks for: none on a console account (the
// game isn't on this computer, as the mission poll already says), and the slow pace (once in 5 s)
// while no TennoScope reports at all, as while one says the game is closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS_SLOW_MS, CARDS_TICK_MS, cardsPollDue, clockMoves, type CardsPollState } from "../src/lib/core/cardsPoll";
import { REP_OFFER_WINDOW, REP_STRIP_WINDOW, repDeadlines, repOffered, repStripOpen } from "../src/lib/core/saleNotice";

const START = 1_792_700_000_000;

/** Reads asked for in a minute of ticks, each read done before the next tick. */
function reads(s: Omit<CardsPollState, "now" | "last" | "polling">): number {
  let last = 0;
  let n = 0;
  for (let t = 0; t < 60_000; t += CARDS_TICK_MS) {
    if (cardsPollDue({ ...s, now: START + t, last, polling: false })) {
      last = START + t;
      n++;
    }
  }
  return n;
}

test("on a console account the reward screen's file is never asked for", () => {
  assert.equal(reads({ console: true, report: null }), 0);
  assert.equal(reads({ console: true, report: { game_running: true } }), 0);
});

test("while no TennoScope reports, the file is asked for once in 5 s, as while the game is closed", () => {
  assert.equal(reads({ console: false, report: null }), 11, "no report: at 0 s, 5.6 s, 11.2 s… on the 0.8 s ticks");
  assert.equal(reads({ console: false, report: { game_running: false } }), 11, "the game closed: as before");
});

test("while TennoScope says the game runs, the pace stays 0.8 s", () => {
  assert.equal(reads({ console: false, report: { game_running: true } }), 75);
  assert.equal(cardsPollDue({ console: false, report: null, now: START, last: 0, polling: false }), true, "the first read is at once");
  assert.equal(cardsPollDue({ console: false, report: { game_running: true }, now: START, last: START - 100, polling: true }), false, "never two at once");
});

test("the page's cards poll goes by the decision, and its clock still runs on a console", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  const poll = app.slice(app.indexOf("async function pollCardsNow()"), app.indexOf("const next = await rewardCards()"));
  assert.match(poll, /const due = cardsPollDue\(\{ now, last: lastCardsPoll, polling: cardsPolling, console: onConsole, report: ts\.report \}\);/);
  // The clock moves with a read, and at least at the slow pace without one (a console account
  // never reads): what reads it isn't worked out again on every 0.8 s tick, and still expires.
  assert.match(poll, /if \(clockMoves\(\{ now, clock: untrack\(\(\) => clock\), due, deadlines: untrack\(\(\) => repEnds\) \}\)\) clock = now;\s*\n\s*if \(!due\) return;/);
  // The deadlines are the +rep offers' ends, and both offers read that clock by their own rules.
  assert.match(app, /const repEnds = \$derived\(repDeadlines\(settings\.market\.trades, settings\.game\.notices\)\);/);
  assert.match(app, /if \(!t \|\| !repStripOpen\(t\.at, clock\) \|\| settings\.market\.rep\[t\.key\]\) return null;/);
  assert.match(app, /const ok = repOffered\(\{ key: r\.key, partner: r\.partner, at, now: clock,/);
});

test("on a console the clock moves once in 5 s; while the game runs, on every read", () => {
  /** The clock's moves in a minute of ticks, by the page's rule. */
  const moves = (s: Omit<CardsPollState, "now" | "last" | "polling">) => {
    let last = 0;
    let clock = START - CARDS_SLOW_MS;
    let n = 0;
    for (let t = 0; t < 60_000; t += CARDS_TICK_MS) {
      const now = START + t;
      const due = cardsPollDue({ ...s, now, last, polling: false });
      if (clockMoves({ now, clock, due, deadlines: [] })) {
        clock = now;
        n++;
      }
      if (due) last = now;
    }
    return n;
  };
  assert.equal(moves({ console: true, report: null }), 11);
  assert.equal(moves({ console: false, report: null }), 11);
  assert.equal(moves({ console: false, report: { game_running: true } }), 75);
});

test("both +rep offers end on time: the strip's 30 min and a notification's 24 h, within a tick", () => {
  // A console account: no reads, so without a deadline the clock moves only once in 5 s. The
  // offers' own rules (repStripOpen, repOffered) are read with the page's clock, as the page does.
  const offer = { key: "t1", partner: "ExamplePlayer", autoRep: false, linked: true, onMarket: true, rep: {}, trades: [] };
  for (let off = 0; off < 6_000; off += 100) {
    const at = START + off;
    const ends = repDeadlines([{ key: "t1", at }], [{ at: at + 2_000, rep: { key: "t1" } }]);
    const offers: [string, number, (clock: number) => boolean][] = [
      ["strip", at + REP_STRIP_WINDOW, (clock) => repStripOpen(at, clock)],
      ["notification", at + REP_OFFER_WINDOW, (clock) => repOffered({ ...offer, at, now: clock })],
    ];
    for (const [name, end, open] of offers) {
      // Ticks from a little before the end, the clock as the poll left it (up to 5 s behind).
      let clock = end - 4_900;
      let closed = -1;
      for (let now = end - 4_000; now < end + 10_000; now += CARDS_TICK_MS) {
        if (clockMoves({ now, clock, due: false, deadlines: ends })) clock = now;
        if (closed < 0 && !open(clock)) closed = now;
      }
      assert.ok(closed > end && closed <= end + CARDS_TICK_MS, `${name} (trade at +${off} ms): closed ${closed - end} ms after its end`);
    }
  }
});
