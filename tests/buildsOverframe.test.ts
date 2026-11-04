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
  // Slugs in other scripts are real (Overframe keeps them), and stay on the build page.
  assert.ok(isBuildPath("/build/807531/quatz/квтц/"));
  assert.ok(isBuildPath("/build/288950/wisp/one-true-goddess-700~900-strength/"));
});

test("build paths: nothing that could leave overframe.gg/build/ once the browser reads it", () => {
  for (const p of [
    "/build/1/../../user/2890/",
    "/build/1/./x/",
    "/build/1/..\\..\\evil/",
    "/build/1/%2e%2e/%2e%2e/evil/",
    "/build/1/x#frag",
    "/build/1//evil.example/x",
    "/build//x/",
    "/build/1/x\u202e/",
    "/build/1/x\u200b/",
    "/build/1/a b/",
    "//evil.example/build/1/",
    "/build/12345678901/x/",
  ])
    assert.ok(!isBuildPath(p), JSON.stringify(p));
});

test("the file's text: hidden characters out, lengths capped, odd catalog paths dropped", () => {
  const row = { id: 99, path: "/build/99/mesa-prime/x/", item: "Mesa Prime", created: "2026-01-01", updated: "2026-10-01", category: "warframes" };
  const file = parseOverframeFile({
    collected: "2026-11-03T19:22:13Z",
    builds: [
      { ...row, title: "Gun\u202eslinger\u200b \u2066mesa\u2069 ❤\ufe0f", author: "a\u0000uthor\u{e0041}", patch: "Update 44.0\u200d", uniqueName: "/Lotus/Powersuits/Cowgirl/MesaPrime" },
      { ...row, id: 100, title: "x".repeat(500), author: "y".repeat(200), uniqueName: "https://evil.example/" },
      { ...row, id: 101, title: "\u200b\u202e" },
    ],
  });
  assert.ok(file);
  assert.deepEqual(file.builds.map((b) => b.id), [99, 100], "a title of nothing but hidden characters is no title");
  assert.equal(file.builds[0].title, "Gunslinger mesa ❤\ufe0f");
  assert.equal(file.builds[0].author, "author");
  assert.equal(file.builds[0].patch, "Update 44.0");
  assert.equal(file.builds[0].uniqueName, "/Lotus/Powersuits/Cowgirl/MesaPrime");
  assert.equal(file.builds[1].title.length, 200);
  assert.equal(file.builds[1].author.length, 80);
  assert.equal(file.builds[1].uniqueName, undefined);
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
  const r = overframeFor(FILE, MESA, { now: NOW, limit: 10, minVotes: 0 });
  assert.deepEqual(r.builds.map((b) => b.id), [12, 13, 15, 17, 14, 16]);
  assert.deepEqual(overframeFor(FILE, MESA, { now: NOW, maxAgeDays: 0, limit: 1, minVotes: 0 }).builds.map((b) => b.id), [11]);
  assert.deepEqual(overframeFor(FILE, MESA, { now: NOW, maxAgeDays: 30, minVotes: 0 }).builds.map((b) => b.id), [15, 17, 14, 16]);
  assert.equal(overframeFor(FILE, MESA, { now: NOW, limit: 0 }).builds.length, 0);
});

test("overframeFor: only popular builds, 10 votes or more by default", () => {
  const all = overframeFor(FILE, MESA, { now: NOW, limit: 10, minVotes: 0 }).builds;
  const shown = overframeFor(FILE, MESA, { now: NOW, limit: 10 }).builds;
  assert.deepEqual(shown.map((b) => b.id), all.filter((b) => b.score >= 10).map((b) => b.id));
  assert.ok(shown.every((b) => b.score >= 10));
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

test("the shipped file: list fields only, every link a build page, dated", () => {
  const raw = JSON.parse(readFileSync(new URL("../public/data/overframe/popular.json", import.meta.url), "utf8"));
  const file = parseOverframeFile(raw);
  assert.ok(file);
  assert.equal(file.builds.length, raw.builds.length, "every row parses");
  assert.match(raw.permission, /lists only/);
  const allowed = new Set(["id", "path", "title", "item", "uniqueName", "author", "score", "formas", "created", "updated", "patch", "category"]);
  for (const b of raw.builds) {
    for (const k of Object.keys(b)) assert.ok(allowed.has(k), `unexpected field ${k}`);
    assert.ok(isBuildPath(b.path), b.path);
    assert.equal(new URL(overframeBuildUrl(b.path)).host, "overframe.gg");
    for (const k of ["title", "item", "author", "patch"]) assert.doesNotMatch(String(b[k] ?? ""), /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u, `${k} of ${b.id} has a hidden character`);
  }
  assert.ok(matchRate(file) > 0.9);
});
