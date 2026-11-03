import { test } from "node:test";
import assert from "node:assert/strict";
import { shareCheck } from "../src/lib/core/radshare";

const r = (name: string, refinement = "Radiant") => ({ name, refinement });

test("four of the same relic at the same refinement is a 4b4", () => {
  const c = shareCheck([r("Axi A1"), r("Axi A1"), r("Axi A1"), r("Axi A1")])!;
  assert.equal(c.matched, true);
  assert.equal(c.text, "4b4: four radiant Axi A1");
});

test("a different relic or refinement is named against the squad's main one", () => {
  const c = shareCheck([r("Axi A1"), r("Lith C13", "Intact"), r("Axi A1"), r("Axi A1")])!;
  assert.equal(c.matched, false);
  assert.equal(c.text, "Not a 4b4: 1 intact Lith C13");
  assert.equal(c.main, "radiant Axi A1");
  // The same relic, a lower refinement.
  assert.equal(shareCheck([r("Axi A1"), r("Axi A1", "Flawless"), r("Axi A1"), r("Axi A1", "Flawless")])!.text, "Not a 4b4: 2 flawless Axi A1", "a tie goes to the better refinement");
  assert.equal(shareCheck([r("Neo N1"), r("Meso M1", "Intact"), r("Neo N1"), r("Lith L1", "Exceptional")])!.text, "Not a 4b4: 1 intact Meso M1, 1 exceptional Lith L1");
});

test("four different relics say so", () => {
  assert.equal(shareCheck([r("Lith C13", "Intact"), r("Neo P9"), r("Axi A22"), r("Meso C10")])!.text, "Not a 4b4: four different relics");
});

test("only with four relics", () => {
  assert.equal(shareCheck([]), null);
  assert.equal(shareCheck([r("Axi A1"), r("Axi A1"), r("Axi A1")]), null);
});
