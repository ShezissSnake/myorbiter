// What's New and the Guide written like the wiki: page names link, game words carry their icon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { richPieces } from "../src/lib/core/richText";

const PAGES = [
  { label: "Orders", id: "market" },
  { label: "Prime parts", id: "parts" },
  { label: "Mastery", id: "mastery" },
  { label: "Sets", id: "sets" },
];

test("a page's name links to it, a game word gets its icon, the first mention only", () => {
  const p = richPieces("Sell spare Prime parts on Orders for platinum, more platinum than ducats.", PAGES);
  assert.deepEqual(p, [
    { kind: "text", text: "Sell spare " },
    { kind: "page", text: "Prime parts", page: "parts" },
    { kind: "text", text: " on " },
    { kind: "page", text: "Orders", page: "market" },
    { kind: "text", text: " for " },
    { kind: "icon", text: "platinum", icon: "platinum" },
    { kind: "text", text: ", more platinum than " },
    { kind: "icon", text: "ducats", icon: "ducats" },
    { kind: "text", text: "." },
  ]);
});

test("Mastery Rank is the game's word, not the Mastery page; lowercase sets isn't the Sets page", () => {
  const p = richPieces("Your Mastery Rank decides trades; complete sets sell on Sets.", PAGES);
  assert.deepEqual(p.filter((x) => x.kind !== "text"), [
    { kind: "icon", text: "Mastery Rank", icon: "mastery" },
    { kind: "page", text: "Sets", page: "sets" },
  ]);
});

test("longest first: Regal Aya over Aya, and words inside other words are left alone", () => {
  const p = richPieces("Varzia takes Regal Aya, not Aya. Endowment isn't Endo.", PAGES);
  assert.deepEqual(p.filter((x) => x.kind !== "text").map((x) => x.text), ["Varzia", "Regal Aya", "Aya", "Endo"]);
  assert.equal(p.map((x) => x.text).join(""), "Varzia takes Regal Aya, not Aya. Endowment isn't Endo.", "nothing lost or added");
});
