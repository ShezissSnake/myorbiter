// Gear you no longer need and can't trade, and what's kept back and why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/lib/core/model";
import { familyOf, notNeeded, INCARNON } from "../src/lib/core/notNeeded";
import type { Bundle, CatalogItem, InventoryRow } from "../src/lib/core/types";

const W = "/Lotus/Weapons/";
const item = (uniqueName: string, name: string, productCategory: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ uniqueName, name, category: "x", productCategory, masterable: true, ...extra });
const CATALOG: CatalogItem[] = [
  item(`${W}DualDecurion`, "Dual Decurion", "SpaceGuns"),
  item(`${W}PrismaDualDecurions`, "Prisma Dual Decurions", "SpaceGuns"),
  item(`${W}Bronco`, "Bronco", "Pistols"),
  item(`${W}BroncoPrime`, "Bronco Prime", "Pistols"),
  item(`${W}Akbronco`, "Akbronco", "Pistols", { components: [{ uniqueName: `${W}Bronco`, name: "Bronco", itemCount: 1 }, { uniqueName: `${W}Bronco`, name: "Bronco", itemCount: 1 }] }),
  item(`${W}Braton`, "Braton", "LongGuns"),
  item(`${W}MK1Braton`, "Mk1-Braton", "LongGuns"),
  item(`${W}BratonPrime`, "Braton Prime", "LongGuns"),
  item(`${W}BratonVandal`, "Braton Vandal", "LongGuns"),
  item(`${W}Skana`, "Skana", "Melee"),
  item(`${W}PrismaSkana`, "Prisma Skana", "Melee"),
  item(`${W}Lato`, "Lato", "Pistols"),
  item(`/Lotus/Powersuits/Saryn`, "Saryn", "Suits"),
  item(`/Lotus/Powersuits/SarynPrime`, "Saryn Prime", "Suits"),
];
const row = (u: string, quantity: number, mastered = true): InventoryRow => {
  const c = CATALOG.find((x) => x.uniqueName === u)!;
  return { item_id: u, name: c.name, category: c.productCategory === "Suits" ? "frame" : "weapon", quantity, mastered, image_name: null, rank: null, max_rank: null };
};
const model = (rows: InventoryRow[]) => buildModel({ observed_at: 1, inventory: rows, catalog: CATALOG, relics: [], prices: null } as Bundle);
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

test("families: the plain one, MK1 below it, every other version above, plurals alike", () => {
  assert.deepEqual(familyOf("Prisma Dual Decurions").key, familyOf("Dual Decurion").key);
  assert.equal(familyOf("Mk1-Braton").rank, 0);
  assert.equal(familyOf("Braton").rank, 1);
  assert.equal(familyOf("Braton Vandal").rank, 2);
  assert.equal(familyOf("Kuva Bramma").base, "Bramma");
  assert.notEqual(familyOf("Dual Skana").key, familyOf("Skana").key, "Dual isn't a version marker");
});

test("a mastered weapon a better version of which you own can go; one not mastered is kept back", () => {
  const m = model([row(`${W}DualDecurion`, 1), row(`${W}PrismaDualDecurions`, 1), row(`${W}Skana`, 1, false), row(`${W}PrismaSkana`, 1)]);
  const r = notNeeded(m, []);
  assert.deepEqual(names(r.go), ["Dual Decurion"]);
  assert.match(r.go[0].why, /Prisma Dual Decurions does everything it does/);
  assert.deepEqual(names(r.kept), ["Skana"]);
  assert.match(r.kept[0].why, /Not mastered yet/);
});

test("versions side by side aren't offered; MK1 goes once the plain one or better is yours", () => {
  const m = model([row(`${W}BratonPrime`, 1), row(`${W}BratonVandal`, 1), row(`${W}MK1Braton`, 1)]);
  assert.deepEqual(names(notNeeded(m, []).go), ["Mk1-Braton"]);
});

test("what a recipe you haven't mastered takes is kept, and extra copies past it can go", () => {
  const m = model([row(`${W}Bronco`, 3), row(`${W}BroncoPrime`, 1)]);
  const r = notNeeded(m, []);
  const b = r.go.find((g) => g.name === "Bronco")!;
  assert.equal(b.copies, 1, "two stay for the Akbronco");
  assert.ok(b.notes.some((n) => /Keep 2 copies for Akbronco/.test(n)));
  const two = notNeeded(model([row(`${W}Bronco`, 2), row(`${W}BroncoPrime`, 1)]), []);
  assert.deepEqual(names(two.go), []);
  assert.match(two.kept[0].why, /Akbronco takes it/);
});

test("an Incarnon installed keeps the weapon when the better one has none; without TennoScope's read it says to check", () => {
  const rows = [row(`${W}Braton`, 1), row(`${W}BratonPrime`, 1)];
  const withIt = notNeeded(model(rows), [{ type: `${W}Braton`, f: INCARNON | 1, p: 2 }, { type: `${W}BratonPrime`, f: 0, p: 0 }]);
  assert.deepEqual(names(withIt.go), []);
  assert.match(withIt.kept[0].why, /Incarnon Genesis is installed/);
  const both = notNeeded(model(rows), [{ type: `${W}Braton`, f: INCARNON, p: 0 }, { type: `${W}BratonPrime`, f: INCARNON, p: 0 }]);
  assert.deepEqual(names(both.go), ["Braton"], "the Prime has one too");
  const unknown = notNeeded(model(rows), null);
  assert.match(unknown.go[0].check ?? "", /can't see installed Incarnons/);
  const formaed = notNeeded(model(rows), [{ type: `${W}Braton`, f: 1, p: 3 }]);
  assert.ok(formaed.go[0].notes.some((n) => /3 Forma and an Orokin Catalyst/.test(n)));
});

test("extra copies of something mastered can go; a frame may go to the Helminth; your Keep holds", () => {
  const m = model([row(`${W}Lato`, 2), row(`/Lotus/Powersuits/Saryn`, 1), row(`/Lotus/Powersuits/SarynPrime`, 1)]);
  const r = notNeeded(m, []);
  const lato = r.go.find((g) => g.name === "Lato")!;
  assert.equal(`${lato.copies}/${lato.of}`, "1/2");
  assert.ok(r.go.find((g) => g.name === "Saryn")!.notes.some((n) => /Helminth/.test(n)));
  const kept = notNeeded(m, [], new Set([`/Lotus/Powersuits/Saryn`]));
  assert.deepEqual(names(kept.go), ["Lato"]);
  assert.ok(kept.kept.some((k) => k.name === "Saryn" && k.yours));
});
