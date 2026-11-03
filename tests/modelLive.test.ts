// A worldstate read that changes nothing the collection reads keeps the collection as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepModelLive, liveForModel } from "../src/lib/core/modelLive";
import type { Fissure, Live } from "../src/lib/core/types";

const fissure = (id: string, eta = "5m"): Fissure => ({ id, node: "Hepit (Void)", missionType: "Capture", enemy: "Corrupted", tier: "Lith", tierNum: 1, isStorm: false, isHard: false, expiry: "2026-11-03T20:00:00Z", eta } as Fissure);
const live = (over: Partial<Live> = {}): Live => ({
  fissures: [fissure("a")],
  resurgence: [{ uniqueName: "/Lotus/StoreItems/Types/Game/Projections/T1VoidProjectionVaultAPrimeABronze", item: "Lith A1 Relic", ducats: null, credits: 20 }],
  resurgenceExpiry: "2026-11-10T00:00:00Z",
  baro: { activation: "2026-11-06T13:00:00Z", expiry: "2026-11-08T13:00:00Z", location: "Strata Relay (Earth)" },
  cycles: [{ key: "cetus", state: "day", expiry: "2026-11-03T19:00:00Z" }],
  invasions: [],
  ...over,
});

test("the collection's worldstate is only what it reads", () => {
  const l = liveForModel(live());
  assert.deepEqual(Object.keys(l).sort(), ["baro", "fissures", "resurgence", "resurgenceExpiry"]);
});

test("a read that changes only what the collection doesn't read keeps the same object", () => {
  const first = keepModelLive(null, live());
  const second = keepModelLive(first, live({ cycles: [{ key: "cetus", state: "night", expiry: "2026-11-03T21:00:00Z" }], invasions: null, fissures: [fissure("a", "4m")] }));
  assert.equal(second, first, "cycles, invasions and a fissure's countdown changed: same collection");
});

test("a new fissure, Varzia's rotation or Baro's stock makes a new one", () => {
  const first = keepModelLive(null, live());
  const fis = keepModelLive(first, live({ fissures: [fissure("a"), fissure("b")] }));
  assert.notEqual(fis, first);
  assert.equal(fis.fissures?.length, 2);
  assert.notEqual(keepModelLive(first, live({ resurgenceExpiry: "2026-11-17T00:00:00Z" })), first);
  assert.notEqual(keepModelLive(first, live({ baro: { activation: "2026-11-06T13:00:00Z", expiry: "2026-11-08T13:00:00Z", location: "Strata Relay (Earth)", inventory: [{ uniqueName: "x", item: "Primed Flow", ducats: 350, credits: 175000 }] } })), first);
  assert.notEqual(keepModelLive(first, live({ fissures: null })), first, "the feed failing isn't the same as an empty one");
});
