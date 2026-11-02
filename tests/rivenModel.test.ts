// The riven price model: the app's featurize and walk of the trees give train.py's numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cheap60, estimate, featurize, walk, type ModelInput, type RivenModel } from "../src/lib/core/rivenModel";

const model = JSON.parse(readFileSync(new URL("../src/lib/data/riven-model.json", import.meta.url), "utf8")) as RivenModel & { checks: { input: ModelInput; x: number[]; mid: number }[] };

test("featurize and the trees agree with train.py on its own sample listings", () => {
  assert.ok(model.checks.length >= 3);
  for (const c of model.checks) {
    const x = featurize(model, c.input);
    assert.equal(x.length, c.x.length);
    x.forEach((v, i) => assert.ok(Math.abs(v - c.x[i]) < 1e-6, `${model.features[i]}: ${v} vs ${c.x[i]}`));
    // Leaf values are kept to six places: 250 trees of rounding stay well under 0.1%.
    assert.ok(Math.abs(walk(model.mid, x) - c.mid) < 1e-3, `${walk(model.mid, x)} vs ${c.mid}`);
  }
});

test("an estimate: a middle guess inside its range, and what each stat does to it", () => {
  const base: ModelInput = { rivenType: "rifle", attributes: [{ url_name: "critical_chance", value: 180, positive: true }, { url_name: "multishot", value: 110, positive: true }, { url_name: "zoom", value: -40, positive: false }], rerolls: 5, mr: 12, rank: 8, polarity: "madurai", weeklyMedian: 400, weeklyPop: 20, cheap60: 60 };
  const e = estimate(model, base);
  assert.ok(e.lo <= e.mid && e.mid <= e.hi);
  assert.equal(e.factors.length, 3);
  // A worse weapon market (cheaper listings, lower trades) guesses lower.
  assert.ok(estimate(model, { ...base, cheap60: 10, weeklyMedian: 40 }).mid < e.mid);
});

test("the cheapest 60's middle price", () => {
  assert.equal(cheap60([10, 20, null, 30, 40, 50]), 30);
  assert.equal(cheap60([10, 20, 30]), null, "too few to say");
  assert.equal(cheap60([...Array(100).keys()].map((i) => i + 1)), 30.5, "only the 60 cheapest count");
});

test("a listing against its estimate, and a listed riven estimated like your own", async () => {
  const { dealOf, estimateListed } = await import("../src/lib/core/rivenModel");
  const e = { mid: 400, lo: 250, hi: 700, factors: [] };
  assert.deepEqual(dealOf(200, e), { ratio: 0.5, under: true });
  assert.deepEqual(dealOf(300, e), { ratio: 0.75, under: false });
  assert.equal(dealOf(null, e), null);
  assert.equal(dealOf(300, null), null);
  const meta = { weapons: [{ slug: "vinquibus_(melee)", gameRef: "x", name: "Vinquibus (Melee)", group: "melee", rivenType: "melee" }], attributes: [] };
  const any = Array.from({ length: 20 }, (_, i) => ({ price: 20 + i })) as never;
  const listed = { weapon: "vinquibus_(melee)", attributes: [{ url_name: "critical_chance", value: 150, positive: true }], rerolls: 3, mr: 12, rank: 8, polarity: "madurai" };
  assert.equal(estimateListed(model, meta as never, null, listed, any), null, "no estimate before last week's trades are read");
  const withTrade = estimateListed(model, meta as never, [{ kind: "Melee", weapon: "Vinquibus", rerolled: true, median: 300, avg: 320, min: 50, max: 900, pop: 30 }], listed, any)!;
  const without = estimateListed(model, meta as never, [], listed, any)!;
  assert.ok(withTrade && without);
  assert.notDeepEqual([withTrade.lo, withTrade.mid, withTrade.hi], [without.lo, without.mid, without.hi], "the weekly trades for Vinquibus (Melee) are found under DE's name");
});
