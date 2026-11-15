// The tables sort text as the game counts: Axi A1, A2, A10 (Planner's relics, Browse market's
// items). Text without numbers keeps the order it had, and numbers, nulls and direction as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortRows, type Column } from "../src/lib/ui/table";

type R = { n: string | null };
const cols: Column<R>[] = [{ key: "name", label: "Name", value: (r) => r.n }];
const sorted = (ns: (string | null)[], desc = false) => sortRows(ns.map((n) => ({ n })), cols, { key: "name", desc }).map((r) => r.n);

test("relic names in the game's order (Axi A2 before Axi A10), both ways", () => {
  assert.deepEqual(sorted(["Axi A10", "Axi A2", "Axi A1"]), ["Axi A1", "Axi A2", "Axi A10"]);
  assert.deepEqual(sorted(["Axi A10 Relic", "Lith B2 Relic", "Axi A2 Relic", "Lith B10 Relic"]), ["Axi A2 Relic", "Axi A10 Relic", "Lith B2 Relic", "Lith B10 Relic"]);
  assert.deepEqual(sorted(["Axi A10", "Axi A2", "Axi A1"], true), ["Axi A10", "Axi A2", "Axi A1"]);
});

test("text without numbers sorts as before, nulls last either way", () => {
  // Accents, case, spaces, hyphens and punctuation, as item, weapon and category names have them.
  const names = ["Mesa Prime", "mesa", "Équinox Prime", "Equinox", "Kuva Bramma", "Ack & Brunt", "Dual Kamas Prime", "Dual Keres", "Visi-critatox", "Primed Flow", "Arcane Energize", "Zaw", "Ash", "ash", "Saryn Prime Set", "Prime parts", "Sets", "Other"];
  const before = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(sorted(names), before);
  assert.deepEqual(sorted([...names].reverse(), true), [...before].reverse());
  assert.deepEqual(sorted([null, "b", "a", null]), ["a", "b", null, null]);
  assert.deepEqual(sorted([null, "b", "a"], true), ["b", "a", null]);
});

test("numbers still sort as numbers", () => {
  const num: Column<{ v: number | null }>[] = [{ key: "v", label: "V", value: (r) => r.v }];
  assert.deepEqual(sortRows([{ v: 10 }, { v: null }, { v: 2 }], num, { key: "v", desc: false }).map((r) => r.v), [2, 10, null]);
});
