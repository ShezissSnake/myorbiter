import { test } from "node:test";
import assert from "node:assert/strict";
import { eventViews } from "../src/lib/core/events";

test("events: names cleaned up, rewards once each, ended ones gone, soonest end first", () => {
  const now = Date.parse("2026-11-01T14:00:00Z");
  const v = eventViews(
    [
      { id: "tau", description: "Road To Tau Event Name", tooltip: "Road To Tau Short Event Desc", node: "None", expiry: "2026-11-17T16:00:00Z", currentScore: 69, maximumScore: 0 },
      {
        id: "tac",
        description: "Hallowed Nightmares Tactical Alert",
        node: "Earth",
        expiry: "2026-11-02T16:00:00Z",
        maximumScore: 1,
        rewards: [{ items: ["Pumpkin Melee Dangle", "Machete Manic Bobble Head"], countedItems: [{ type: "Pumpkin Melee Dangle", count: 1 }, { type: "Forma", count: 3 }], credits: 50000 }],
      },
      { id: "nab", description: "Nights of Naberus", tooltip: "Visit Daughter for Naberus Treats", node: "Necralisk (Deimos)", expiry: "2026-11-02T16:00:00Z" },
      { id: "old", description: "Over", expiry: "2026-11-01T13:00:00Z" },
      { id: "goal", description: "Thermia Fractures", expiry: "2026-11-03T00:00:00Z", currentScore: 40, maximumScore: 100, interimSteps: [{ goal: 50, reward: { countedItems: [{ type: "Opticor Vandal Barrel", count: 1 }] } }] },
    ],
    now,
  );
  assert.deepEqual(v.map((e) => e.id), ["tac", "nab", "goal", "tau"]);
  const tac = v[0];
  assert.deepEqual(tac.rewards, ["Pumpkin Melee Dangle", "3 × Forma", "Machete Manic Bobble Head", "50,000 credits"]);
  assert.equal(tac.progress, null, "a one-off alert has no progress to show");
  assert.equal(v[1].note, "Visit Daughter for Naberus Treats");
  assert.deepEqual(v[2].progress, { at: 40, of: 100 });
  assert.deepEqual(v[2].rewards, ["Opticor Vandal Barrel"]);
  const tau = v[3];
  assert.equal(tau.name, "Road To Tau");
  assert.equal(tau.note, null);
  assert.equal(tau.where, null);
});
