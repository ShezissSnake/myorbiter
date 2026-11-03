// Overframe's popular builds (src/lib/core/builds/overframeList.ts): the bundled list file, the
// listing rule (at most 5 per item, the most voted updated within two years), loading from the
// app's own assets only, and the shipped file holding list fields only.
//
// tests/fixtures/overframe/popular.json: a few rows shaped like the real file (authors replaced),
// plus rows the parser must drop (an outside link, a bad date, a repeated id).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isBuildPath,
  loadOverframe,
  matchRate,
  overframeBuildUrl,
  overframeFor,
  overframeWithinAge,
  parseOverframeFile,
  resetOverframe,
  OVERFRAME_FILE,
  OVERFRAME_MAX_AGE_DAYS,
  OVERFRAME_SHOWN,
  type OverframeFile,
} from "../src/lib/core/builds";

const RAW = JSON.parse(readFileSync(new URL("./fixtures/overframe/popular.json", import.meta.url), "utf8"));
const FILE = parseOverframeFile(RAW) as OverframeFile;
const NOW = Date.parse("2026-11-03T12:00:00Z");
const MESA = "/Lotus/Powersuits/Cowgirl/MesaPrime";

test("the file: entries without a build path or with bad dates are dropped, ids once", () => {
  assert.ok(FILE);
  assert.equal(FILE.collected, "2026-11-03T19:22:13Z");
  assert.deepEqual(FILE.builds.map((b) => b.id), [11, 12, 13, 14, 15, 16, 17, 21]);
  assert.equal(FILE.builds.find((b) => b.id === 21)?.uniqueName, undefined);
  assert.equal(parseOverframeFile(null), null);
  assert.equal(parseOverframeFile({ builds: [] }), null, "no collected date");
  assert.equal(parseOverframeFile([]), null);
});

test("build paths: only overframe.gg build pages are linked", () => {
  assert.ok(isBuildPath("/build/374539/revenant-prime/the-lich-king/"));
  assert.ok(!isBuildPath("https://example.com/build/1/"));
  assert.ok(!isBuildPath("/user/2890/ninjase/"));
  assert.ok(!isBuildPath("/build/1/x/?ref=orbiter"));
  assert.equal(overframeBuildUrl("/build/12/mesa-prime/gunslinger/"), "https://overframe.gg/build/12/mesa-prime/gunslinger/");
});

test("overframeFor: the listing rule by default, 5 most voted updated within two years", () => {
  assert.equal(OVERFRAME_SHOWN, 5);
  assert.equal(OVERFRAME_MAX_AGE_DAYS, 730);
  const r = overframeFor(FILE, MESA, { now: NOW });
  // 11 (5000 votes) was updated 2023-11-11: older than two years, so it's left out.
  assert.deepEqual(r.builds.map((b) => b.id), [12, 13, 15, 17, 14], "35 votes each: 17 was updated later than 14");
  assert.equal(r.total, 7);
  assert.equal(r.older, 1);
});

test("overframeFor: equal votes go to the most recently updated; limit and age can be set", () => {
  const r = overframeFor(FILE, MESA, { now: NOW, limit: 10 });
  assert.deepEqual(r.builds.map((b) => b.id), [12, 13, 15, 17, 14, 16]);
  assert.deepEqual(overframeFor(FILE, MESA, { now: NOW, maxAgeDays: 0, limit: 1 }).builds.map((b) => b.id), [11]);
  assert.deepEqual(overframeFor(FILE, MESA, { now: NOW, maxAgeDays: 30 }).builds.map((b) => b.id), [15, 17, 14, 16]);
  assert.equal(overframeFor(FILE, MESA, { now: NOW, limit: 0 }).builds.length, 0);
});

test("overframeFor: an unmatched build is found by the item's name; nothing for other items or no file", () => {
  assert.equal(overframeFor(FILE, "/Lotus/Somewhere/PanzerClaws", { now: NOW }).builds.length, 0);
  assert.deepEqual(overframeFor(FILE, "/Lotus/Somewhere/PanzerClaws", { now: NOW, name: "panzer claws" }).builds.map((b) => b.id), [21]);
  assert.equal(overframeFor(FILE, "/Lotus/Powersuits/Excalibur/Excalibur", { now: NOW, name: "Excalibur" }).total, 0);
  assert.deepEqual(overframeFor(null, MESA), { builds: [], total: 0, older: 0 });
});

test("age: by the updated day, whole days counted", () => {
  const d = (s: string) => ({ updated: s });
  assert.ok(overframeWithinAge(d("2024-11-03"), 730, NOW));
  assert.ok(!overframeWithinAge(d("2024-11-01"), 730, NOW));
  assert.ok(overframeWithinAge(d("2001-01-01"), 0, NOW));
});

test("loadOverframe: reads the app's own file once, never a web address", async () => {
  resetOverframe();
  const asked: string[] = [];
  const get = async (u: string) => {
    asked.push(u);
    return RAW;
  };
  const a = await loadOverframe(get);
  const b = await loadOverframe(get);
  assert.equal(a, b);
  assert.deepEqual(asked, [OVERFRAME_FILE]);
  assert.ok(OVERFRAME_FILE.startsWith("/") && !OVERFRAME_FILE.includes("overframe.gg"));
  resetOverframe();
  assert.equal(await loadOverframe(async () => Promise.reject(new Error("missing"))), null);
  resetOverframe();
});
