// The relic plate on Relics and the Planner: your relics by era.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { relicsByEra } from "../src/lib/core/relicHold";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number): InventoryRow => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
const bundle = (inventory: InventoryRow[]): Bundle => ({ observed_at: 1, inventory, catalog: [], relics: [], prices: { prices: {}, max_rank_prices: {} } }) as unknown as Bundle;

test("a relic MyOrbiter can only name by its path still counts, under the era its tier says", () => {
  // Neither the relic list nor the drop tables know it yet (a new relic): the row keeps the path's name.
  const m = buildModel(
    bundle([
      inv("/Lotus/Types/Game/Projections/T1VoidProjectionZZNewBronze", "T 1 Void Projection ZZ New Bronze", "relic", 2),
      inv("/Lotus/Types/Game/Projections/T4VoidProjectionZZNewPlatinum", "T 4 Void Projection ZZ New Platinum", "relic", 3),
      inv("/Lotus/Types/Game/Projections/T4VoidProjectionVaultAGold", "T 4 Void Projection Vault A Gold", "relic", 1),
      inv("/Lotus/Types/Game/Projections/T5VoidProjectionZZNewBronze", "T 5 Void Projection ZZ New Bronze", "relic", 1),
      inv("/R/A2G", "Axi B2 Flawless", "relic", 1),
    ]),
  );
  assert.deepEqual(
    relicsByEra(m).map((e) => [e.era, e.total, e.radiant]),
    [["Lith", 2, 0], ["Meso", 0, 0], ["Neo", 0, 0], ["Axi", 5, 3], ["Requiem", 1, 0]],
    "Platinum is Radiant, as the squad's relics read it",
  );
});

test("a relic with no tier in its path or name counts under no era, and the plate's total says nothing of it", () => {
  const m = buildModel(bundle([inv("/Lotus/Types/Game/Projections/Strange", "Strange Thing", "relic", 4), inv("/R/L1B", "Lith A1 Intact", "relic", 1)]));
  assert.deepEqual(relicsByEra(m).map((e) => [e.era, e.total]), [["Lith", 1], ["Meso", 0], ["Neo", 0], ["Axi", 0]]);
});

test("relics by era: held and radiant, the four main eras always, others only when held", () => {
  const m = buildModel(
    bundle([
      inv("/R/L1B", "Lith A1 Intact", "relic", 3),
      inv("/R/L1P", "Lith A1 Radiant", "relic", 2),
      inv("/R/A2G", "Axi B2 Flawless", "relic", 1),
      inv("/R/Req", "Requiem Eterna Relic", "relic", 1),
      inv("/R/Gone", "Neo Z9 Radiant", "relic", 0),
    ]),
  );
  assert.deepEqual(
    relicsByEra(m).map((e) => [e.era, e.total, e.radiant]),
    [["Lith", 5, 2], ["Meso", 0, 0], ["Neo", 0, 0], ["Axi", 1, 0], ["Requiem", 1, 0]],
  );
});
