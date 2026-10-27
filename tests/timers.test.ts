import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleTimers, matchedFissures, nextDailyUtc, planetOf, resetTimers, ruleLabel, ruleMatches, sameRule, type FissureRule } from "../src/lib/core/timers";
import type { Fissure, Live } from "../src/lib/core/types";

const NOW = Date.parse("2026-10-21T12:00:00Z"); // a Wednesday
const fissure = (x: Partial<Fissure>): Fissure => ({ id: "f", node: "Io (Jupiter)", missionType: "Disruption", enemy: "Corpus", tier: "Neo", tierNum: 3, isStorm: false, isHard: false, expiry: "2026-10-21T13:00:00Z", ...x });
const rule = (x: Partial<FissureRule>): FissureRule => ({ id: "r", tier: "any", mission: "any", planet: "any", mode: "any", ...x });

test("fissure rules match on era, mission, planet and Steel Path", () => {
  const f = fissure({});
  assert.equal(planetOf(f.node), "Jupiter");
  assert.ok(ruleMatches(rule({ mission: "Disruption" }), f));
  assert.ok(ruleMatches(rule({ tier: "Neo", planet: "Jupiter", mode: "normal" }), f));
  assert.ok(!ruleMatches(rule({ mode: "steel" }), f));
  assert.ok(ruleMatches(rule({ mode: "steel" }), fissure({ isHard: true })));
  assert.ok(!ruleMatches(rule({ mode: "normal" }), fissure({ isStorm: true })));
  assert.ok(!ruleMatches(rule({ planet: "Mars" }), f));
  assert.ok(!ruleMatches(rule({}), fissure({ isStorm: true })), "Void Storms only when asked for");
  assert.ok(ruleMatches(rule({ mode: "storm" }), fissure({ isStorm: true })));
  assert.equal(ruleLabel(rule({ tier: "Axi", mode: "steel" })), "Steel Path Axi fissure");
});

test("alerts read as words, the catch-all as Any fissure, and the same alert twice is spotted", () => {
  assert.equal(ruleLabel(rule({})), "Any fissure");
  assert.equal(ruleLabel(rule({ planet: "Sedna" })), "Any fissure on Sedna");
  assert.equal(ruleLabel(rule({ tier: "Lith", mission: "Capture", planet: "Void" })), "Lith Capture on Void");
  assert.equal(ruleLabel(rule({ mode: "storm" })), "Void Storm fissure");
  assert.ok(sameRule(rule({ id: "a", tier: "Lith" }), rule({ id: "b", tier: "Lith" })), "the id doesn't make it a different alert");
  assert.ok(!sameRule(rule({ tier: "Lith" }), rule({ tier: "Lith", mode: "steel" })));
});

test("only open fissures are matched, each with the first rule it fits", () => {
  const rules = [rule({ id: "a", mission: "Disruption" }), rule({ id: "b" })];
  const hits = matchedFissures(rules, [fissure({ id: "1" }), fissure({ id: "2", missionType: "Spy" }), fissure({ id: "3", expiry: "2026-10-21T11:00:00Z" })], NOW);
  assert.deepEqual(hits.map((h) => [h.fissure.id, h.rule.id]), [["1", "a"], ["2", "b"]]);
});

test("world clocks: cycles still running, and the resets", () => {
  const live: Live = { fissures: [], resurgence: [], resurgenceExpiry: null, cycles: [{ key: "cetus", state: "day", expiry: "2026-10-21T12:30:00Z" }, { key: "earth", state: "night", expiry: "2026-10-21T11:00:00Z" }] };
  assert.deepEqual(cycleTimers(live, NOW).map((c) => [c.label, c.state, c.next]), [["Plains of Eidolon", "day", "night"], ["Earth", "day", "night"]]);
  // A clock whose state ran out before the next worldstate refresh rolls on by itself.
  const vallis: Live = { ...live, cycles: [{ key: "vallis", state: "warm", expiry: "2026-10-21T11:55:00Z" }] };
  assert.deepEqual(cycleTimers(vallis, NOW).map((c) => [c.state, c.ends]), [["cold", "2026-10-21T12:15:00.000Z"]]);
  assert.equal(nextDailyUtc(NOW), "2026-10-22T00:00:00.000Z");
  assert.deepEqual(resetTimers(live, NOW).map((r) => [r.key, r.ends]), [["daily", "2026-10-22T00:00:00.000Z"], ["weekly", "2026-10-26T00:00:00.000Z"]]);
});
