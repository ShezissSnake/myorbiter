// The No relic mark: the Guide's "What the marks mean" says what it means, and on Mastery its tip
// says no more than is known: a prime of which only some missing parts have no relic is not said to
// be in no relic at all. Every other mark keeps its label, tip and place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missingChip, missingChipTip } from "../src/lib/tabs/masteryList";

const parts = (...a: string[]) => a.map((availability) => ({ availability }));

test("a prime with only some missing parts in no relic: the tip counts them and names the rest", () => {
  const some = parts("unknown", "farmable", "farmable");
  assert.equal(missingChip(some), "unknown");
  assert.equal(missingChipTip(some), "1 of 3 missing parts not found in any relic; the others drop from relics still in the drop tables");
  assert.equal(missingChipTip(parts("unknown", "unknown", "farmable")), "2 of 3 missing parts not found in any relic; the others drop from relics still in the drop tables");
});

test("every missing part in no relic, or another mark: the mark keeps its own tip", () => {
  assert.equal(missingChipTip(parts("unknown")), undefined);
  assert.equal(missingChipTip(parts("unknown", "unknown")), undefined);
  for (const a of [parts("vaulted", "unknown"), parts("resurgence", "unknown"), parts("farmable", "farmable")]) assert.equal(missingChipTip(a), undefined);
});

test("Mastery hands the tip to both of its chips", () => {
  const mastery = readFileSync("src/lib/tabs/Mastery.svelte", "utf8");
  assert.equal(mastery.match(/<Avail v=\{worst\} tip=\{missingChipTip\(r\.missingParts\)\} \/>/g)?.length, 2);
  assert.doesNotMatch(mastery, /<Avail v=\{worst\} \/>/);
});

test("the marks' labels and tips are as they were; a tip given replaces the state's own", () => {
  const avail = readFileSync("src/lib/ui/Avail.svelte", "utf8");
  assert.match(avail, /\{ farmable: "Farmable", vaulted: "Vaulted", resurgence: "Resurgence", unknown: "No relic" \}/);
  assert.match(avail, /farmable: "At least one relic that drops it is in the current drop tables",\s+vaulted: "Every relic that drops it is vaulted",\s+resurgence: "Vaulted, but Varzia has it in Prime Resurgence right now",\s+unknown: "Not found in any relic",/);
  assert.match(avail, /title=\{own \?\? tip\[v\]\}/);
});

test("the Guide's marks name No relic after the other three vault marks, with what to do about it", () => {
  const guide = readFileSync("src/lib/tabs/Guide.svelte", "utf8");
  const start = guide.indexOf(">What the marks mean<");
  const legend = guide.slice(start, guide.indexOf("</ul>", start));
  const order = [...legend.matchAll(/<Avail v="(\w+)" \/>/g)].map((m) => m[1]);
  assert.deepEqual(order, ["farmable", "vaulted", "resurgence", "unknown"]);
  const line = legend.slice(legend.indexOf('<Avail v="unknown" />'));
  const text = line.slice(0, line.indexOf("</li>"));
  assert.match(text, /no relic in the drop tables drops it, and Varzia doesn't sell it/);
  assert.match(text, /buy it from other players/);
  assert.match(text, /when only some are, pointing at the mark says how many/);
});
