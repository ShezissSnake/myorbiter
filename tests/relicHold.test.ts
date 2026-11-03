// The relic plate on Relics and the Planner: your relics by era.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { relicsByEra } from "../src/lib/core/relicHold";
import type { Bundle, InventoryRow } from "../src/lib/core/types";

const inv = (item_id: string, name: string, category: string, quantity: number): InventoryRow => ({ item_id, name, category, quantity, mastered: false, image_name: null, rank: null, max_rank: null });
const bundle = (inventory: InventoryRow[]): Bundle => ({ observed_at: 1, inventory, catalog: [], relics: [], prices: { prices: {}, max_rank_prices: {} } }) as unknown as Bundle;

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
