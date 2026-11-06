// Bookkeeping for long sessions: back-off, bounded seen-lists, value history thinning, and which
// hand-logged sale a trade stands for.
process.env.TZ = "America/Los_Angeles";
import { test } from "node:test";
import assert from "node:assert/strict";
import { backoff, handLoggedSale, keepSeen, thinHistory } from "../src/lib/core/upkeep";
import type { Sale, ValuePoint } from "../src/lib/backend";

test("back-off doubles per failure and stops at the cap", () => {
  assert.equal(backoff(30_000, 0, 600_000), 30_000);
  assert.equal(backoff(30_000, 1, 600_000), 60_000);
  assert.equal(backoff(30_000, 3, 600_000), 240_000);
  assert.equal(backoff(30_000, 50, 600_000), 600_000);
  assert.equal(backoff(30_000, -2, 600_000), 30_000);
});

test("seen keys stay capped, but never drop the live session's", () => {
  const old = Array.from({ length: 300 }, (_, i) => `100|${i}`);
  assert.equal(keepSeen(["200|1"], old, 300, "200").length, 300, "other sessions' keys are capped");
  // A session with more trades than the cap: none of its keys fall off (they'd be handled again).
  const live = Array.from({ length: 320 }, (_, i) => `200|${i}`);
  const kept = keepSeen(["200|999"], [...live, ...old], 300, "200");
  assert.ok(live.every((k) => kept.includes(k)));
  assert.ok(kept.includes("200|999"));
  assert.ok(!kept.includes("100|0"));
});

const point = (at: number): ValuePoint => ({ at, worth: 1, liquid: 1, platinum: null });

test("value history keeps every recent read and one a day before that", () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const H = 3_600_000;
  // A read every 3 hours for a year.
  const pts = Array.from({ length: 365 * 8 }, (_, i) => point(now - (365 * 8 - i) * 3 * H));
  const out = thinHistory(pts, now);
  assert.ok(out[0].at < now - 360 * 24 * H, "a year back is still there");
  const recent = out.filter((p) => p.at >= now - 30 * 24 * H);
  assert.equal(recent.length, pts.filter((p) => p.at >= now - 30 * 24 * H).length, "the last month at full detail");
  const older = out.filter((p) => p.at < now - 30 * 24 * H);
  const days = new Set(older.map((p) => new Date(p.at).toDateString()));
  assert.equal(older.length, days.size, "one point per day before that");
  assert.deepEqual(thinHistory(out, now), out, "thinning again changes nothing");
});

test("value history days are local days, across the clock change", () => {
  // Los Angeles: summer time ends 1 Nov 2026 at 02:00 local, a 25-hour day. Reads at 00:30 and
  // 23:30 local are the same day; 00:30 the next day is not.
  const at = (d: number, h: number, m: number) => +new Date(2026, 10, d, h, m);
  const pts = [at(1, 0, 30), at(1, 23, 30), at(2, 0, 30)].map(point);
  const out = thinHistory(pts, +new Date(2027, 0, 1));
  assert.deepEqual(out.map((p) => p.at), [at(1, 23, 30), at(2, 0, 30)]);
});

const sale = (at: number, item: string, trade?: string): Sale => ({ at, item, rank: null, quantity: 1, platinum: 10, ...(trade ? { trade } : {}) });

test("a sale logged by hand is matched once; a sale from an earlier trade isn't a match", () => {
  const t0 = 1_800_000_000_000;
  // You sold Energize to one buyer (logged from the trade), then another 4 minutes later.
  assert.equal(handLoggedSale([sale(t0, "Arcane Energize", "s|1")], "Arcane Energize", t0 + 4 * 60_000), -1);
  // You pressed Sold on Orders, then the trade showed up in the log: that's the same sale.
  assert.equal(handLoggedSale([sale(t0, "Arcane Energize")], "Arcane Energize", t0 + 60_000), 0);
  // Too far apart, or another item.
  assert.equal(handLoggedSale([sale(t0, "Arcane Energize")], "Arcane Energize", t0 + 11 * 60_000), -1);
  assert.equal(handLoggedSale([sale(t0, "Arcane Grace")], "Arcane Energize", t0), -1);
});

test("why TennoScope won't start, in words, with what to do when it's known", async () => {
  const { failureWords } = await import("../src/lib/core/upkeep");
  const old = failureWords("local store operation failed: database schema version 5 is not supported", 120_000);
  assert.match(old, /older than the TennoScope that last opened your data/);
  assert.match(old, /tries again in 2 min/);
  assert.equal(failureWords("something else", 0), 'TennoScope stops as it starts. Its log says: "something else".');
});
