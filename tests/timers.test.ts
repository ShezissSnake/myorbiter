import { test } from "node:test";
import assert from "node:assert/strict";
import { cycleTimers, matchedFissures, nextDailyUtc, normalizeRule, planetOf, resetTimers, ruleLabel, ruleMatches, sameRule, tidyRule, type FissureRule } from "../src/lib/core/timers";
import type { Fissure, Live } from "../src/lib/core/types";

const NOW = Date.parse("2026-10-21T12:00:00Z"); // a Wednesday
const fissure = (x: Partial<Fissure>): Fissure => ({ id: "f", node: "Io (Jupiter)", missionType: "Disruption", enemy: "Corpus", tier: "Neo", tierNum: 3, isStorm: false, isHard: false, expiry: "2026-10-21T13:00:00Z", ...x });
const rule = (x: Partial<FissureRule>): FissureRule => ({ id: "r", kinds: [], tiers: [], missions: [], planets: [], ...x });

test("fissure rules match on era, mission, planet and kind, any of the ones ticked", () => {
  const f = fissure({});
  assert.equal(planetOf(f.node), "Jupiter");
  assert.ok(ruleMatches(rule({ missions: ["Disruption"] }), f));
  assert.ok(ruleMatches(rule({ tiers: ["Neo"], planets: ["Jupiter"], kinds: ["normal"] }), f));
  assert.ok(!ruleMatches(rule({ kinds: ["steel"] }), f));
  assert.ok(ruleMatches(rule({ kinds: ["steel"] }), fissure({ isHard: true })));
  assert.ok(!ruleMatches(rule({ kinds: ["normal"] }), fissure({ isStorm: true })));
  assert.ok(!ruleMatches(rule({ planets: ["Mars"] }), f));
  assert.ok(!ruleMatches(rule({}), fissure({ isStorm: true })), "Void Storms only when ticked");
  assert.ok(ruleMatches(rule({ kinds: ["storm"] }), fissure({ isStorm: true })));
  // Several of one kind: any of them.
  const def = rule({ missions: ["Defense", "Mobile Defense"], tiers: ["Axi", "Neo"], kinds: ["steel", "storm"] });
  assert.ok(ruleMatches(def, fissure({ missionType: "Mobile Defense", tier: "Axi", isHard: true })));
  assert.ok(ruleMatches(def, fissure({ missionType: "Defense", tier: "Neo", isStorm: true })));
  assert.ok(!ruleMatches(def, fissure({ missionType: "Defense", tier: "Neo" })), "normal not ticked");
  assert.ok(!ruleMatches(def, fissure({ missionType: "Survival", tier: "Neo", isHard: true })));
  assert.equal(ruleLabel(rule({ tiers: ["Axi"], kinds: ["steel"] })), "Steel Path Axi fissure");
  assert.equal(ruleLabel(def), "Steel Path or Void Storm Axi or Neo Defense or Mobile Defense");
});

test("alerts saved before multi-choice carry over", () => {
  assert.deepEqual(normalizeRule({ id: "a", tier: "Axi", mission: "any", planet: "Sedna", mode: "steel" }), { id: "a", kinds: ["steel"], tiers: ["Axi"], missions: [], planets: ["Sedna"] });
  assert.deepEqual(normalizeRule({ id: "b", tier: "any", mission: "any", planet: "any", mode: "any" }), { id: "b", kinds: [], tiers: [], missions: [], planets: [] });
  assert.equal(normalizeRule(null), null);
  // Normal and Steel Path ticked is the same as nothing ticked; kinds keep their usual order.
  assert.deepEqual(tidyRule(rule({ kinds: ["steel", "normal"] })).kinds, []);
  assert.deepEqual(tidyRule(rule({ kinds: ["storm", "normal"] })).kinds, ["normal", "storm"]);
});

test("alerts read as words, the catch-all as Any fissure, and the same alert twice is spotted", () => {
  assert.equal(ruleLabel(rule({})), "Any fissure");
  assert.equal(ruleLabel(rule({ planets: ["Sedna"] })), "Any fissure on Sedna");
  assert.equal(ruleLabel(rule({ tiers: ["Lith"], missions: ["Capture"], planets: ["Void"] })), "Lith Capture on Void");
  assert.equal(ruleLabel(rule({ kinds: ["storm"] })), "Void Storm fissure");
  assert.ok(sameRule(rule({ id: "a", tiers: ["Lith", "Meso"] }), rule({ id: "b", tiers: ["Meso", "Lith"] })), "the id and the order don't make it a different alert");
  assert.ok(!sameRule(rule({ tiers: ["Lith"] }), rule({ tiers: ["Lith"], kinds: ["steel"] })));
});

test("only open fissures are matched, each with the first rule it fits", () => {
  const rules = [rule({ id: "a", missions: ["Disruption"] }), rule({ id: "b" })];
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
