import { test } from "node:test";
import assert from "node:assert/strict";
import { bountyBoards, fissureCounts, fissuresByEra } from "../src/lib/core/board";
import type { Fissure } from "../src/lib/core/types";

const NOW = Date.parse("2026-10-31T20:00:00Z");
const f = (id: string, tier: string, extra: Partial<Fissure> = {}): Fissure => ({ id, node: "Everest (Earth)", missionType: "Excavation", enemy: "Grineer", tier, tierNum: 1, isStorm: false, isHard: false, expiry: "2026-10-31T21:00:00Z", ...extra });

test("fissures: every open one, by kind and era, soonest to close first", () => {
  const fs = [
    f("a", "Meso", { expiry: "2026-10-31T21:30:00Z" }),
    f("b", "Lith"),
    f("c", "Meso", { expiry: "2026-10-31T20:30:00Z" }),
    f("d", "Lith", { isHard: true }),
    f("e", "Neo", { isStorm: true }),
    f("old", "Axi", { expiry: "2026-10-31T19:00:00Z" }),
  ];
  assert.deepEqual(fissureCounts(fs, NOW), { normal: 3, steel: 1, storm: 1 });
  const normal = fissuresByEra(fs, "normal", NOW);
  assert.deepEqual(normal.map((e) => [e.era, e.list.map((x) => x.id)]), [["Lith", ["b"]], ["Meso", ["c", "a"]]], "no empty eras, and the closed Axi is gone");
  assert.deepEqual(fissuresByEra(fs, "steel", NOW).map((e) => e.era), ["Lith"]);
});

test("bounties: listed ones carry their rewards, the headline is what you need or the rarest", () => {
  const boards = bountyBoards(
    [
      {
        syndicate: "Ostrons",
        expiry: "2026-10-31T22:40:00Z",
        jobs: [
          {
            type: "Search and Rescue",
            enemyLevels: [20, 40],
            standingStages: [640, 640, 640, 940],
            minMR: 2,
            rewardPoolDrops: [
              { item: "200 Endo", rarity: "Uncommon", chance: 29.31 },
              { item: "Madurai Lens", rarity: "Uncommon", chance: 13.79 },
              { item: "Madurai Lens", rarity: "Rare", chance: 9.04 },
              { item: "Gara Neuroptics Blueprint", rarity: "Rare", chance: 9.04 },
              { item: "Augur Accord", rarity: "Rare", chance: 6 },
            ],
          },
        ],
      },
      { syndicate: "The Holdfasts", expiry: "2026-10-31T22:40:00Z", jobs: [] },
    ],
    [{ place: "zariman", level: "50 - 55", rewards: [{ name: "500 Endo", chance: 17.39, rarity: "Uncommon" }, { name: "Entrati Lanthorn", chance: 4.35, rarity: "Rare" }] }],
  );
  assert.deepEqual(boards.map((b) => b.key), ["cetus", "zariman"]);
  const job = boards[0].jobs[0];
  assert.equal(job.levels, "20–40");
  assert.equal(job.standing, 2860);
  assert.deepEqual(job.rewards.map((r) => r.name), ["Augur Accord", "Gara Neuroptics Blueprint", "Madurai Lens", "200 Endo"], "rarest first, each once at its best chance");
  assert.equal(job.rewards.find((r) => r.name === "Madurai Lens")!.chance, 13.79);
  assert.equal(job.headline!.name, "Augur Accord");
  const needGara = bountyBoards([{ syndicate: "Ostrons", expiry: "x", jobs: [{ rewardPoolDrops: [{ item: "Augur Accord", chance: 6 }, { item: "Gara Neuroptics Blueprint", chance: 9 }] }] }], null, (n) => n.startsWith("Gara"));
  assert.deepEqual([needGara[0].jobs[0].headline!.name, needGara[0].jobs[0].wanted], ["Gara Neuroptics Blueprint", true]);
  const z = boards[1];
  assert.equal(z.rotating, true);
  assert.equal(z.jobs[0].headline!.name, "Entrati Lanthorn", "endo is never the headline");
  assert.equal(z.expiry, "2026-10-31T22:40:00Z");
});
