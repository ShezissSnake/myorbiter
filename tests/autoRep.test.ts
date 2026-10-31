import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_REP_WINDOW, repCandidates } from "../src/lib/core/trades";
import type { TradeLogEntry } from "../src/lib/backend";

const trade = (key: string, partner: string, at: number): TradeLogEntry => ({ key, at, partner, offered: [], received: [], platOut: 0, platIn: 20 });
const now = 10 * AUTO_REP_WINDOW;

test("auto +rep: one per partner, oldest trade first, none for someone already given", () => {
  const trades = [trade("c", "Bob", now - 1000), trade("b", "Ann", now - 2000), trade("a", "ann", now - 3000), trade("d", "Cid", now - 500)];
  assert.deepEqual(repCandidates(trades, { d: "given" }, now).map((t) => t.key), ["a", "c"], "Ann once (the older trade), Bob; Cid already has it");
});

test("auto +rep: skipped trades and old ones are left alone", () => {
  const trades = [trade("a", "Ann", now - 1000), trade("b", "Bob", now - AUTO_REP_WINDOW - 1)];
  assert.deepEqual(repCandidates(trades, { a: "skipped" }, now), []);
});
