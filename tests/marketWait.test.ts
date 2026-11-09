// A request warframe.market asked to wait for (a 429's Retry-After, market.rs): its error names
// the time, shown as the clock does, never as a raw number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clockTime, deferredUntil, waitWords } from "../src/lib/core/marketWait";

const at = new Date(2026, 10, 9, 14, 5, 30).getTime();

test("the time a deferred request waits for is read from the Rust side's words", () => {
  assert.equal(deferredUntil(`warframe.market asked us to wait until ${at}`), at);
  assert.equal(deferredUntil(`Error: warframe.market asked us to wait until ${at}`), at);
  assert.equal(deferredUntil("warframe.market is unreachable: timed out"), null);
  assert.equal(deferredUntil("warframe.market asked us to wait until 12"), null, "not a time");
});

test("it's shown as the clock shows it: minutes, or seconds when it's under a minute away", () => {
  const words = waitWords(`warframe.market asked us to wait until ${at}`, at - 10 * 60_000);
  assert.equal(words, `warframe.market asked us to wait until ${clockTime(at, at - 10 * 60_000)}`);
  assert.match(words, /until \d{1,2}[:.]\d{2}(\s?[AP]M)?$/i);
  assert.doesNotMatch(words, new RegExp(String(at)));
  assert.match(clockTime(at, at - 30_000), /\d{2}[:.]\d{2}[:.]\d{2}/);
  // Anything else goes on unchanged.
  assert.equal(waitWords("warframe.market rejected the request: 400"), "warframe.market rejected the request: 400");
});
