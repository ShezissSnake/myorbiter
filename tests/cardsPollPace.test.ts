// The reward screen's file is asked for every 0.8 s while a TennoScope can be writing it. These
// tests count the reads a minute of the page's ticks asks for: none on a console account (the
// game isn't on this computer, as the mission poll already says), and the slow pace (once in 5 s)
// while no TennoScope reports at all, as while one says the game is closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS_TICK_MS, cardsPollDue, type CardsPollState } from "../src/lib/core/cardsPoll";

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
  assert.match(poll, /clock = Date\.now\(\);\s*\n\s*if \(!cardsPollDue\(\{ now: clock, last: lastCardsPoll, polling: cardsPolling, console: onConsole, report: ts\.report \}\)\) return;/);
});
