import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultNotify } from "../src/lib/backend";
import { NOTICE_KINDS, growNotice, kindsFor, logNotice, NOTICE_LOG, splitTarget } from "../src/lib/notices";
import { PAGES } from "../src/lib/pages";

test("every notification switch is in the panel once, and every kind in the panel has a switch", () => {
  const switches = Object.keys(defaultNotify()).sort();
  const kinds = NOTICE_KINDS.map((k) => k.kind).sort();
  assert.deepEqual(kinds, switches);
});

test("every kind opens a page that exists", () => {
  const ids = new Set(PAGES.map((p) => p.id as string));
  for (const k of NOTICE_KINDS) assert.ok(ids.has(splitTarget(k.to).page), `${k.kind} → ${k.to}`);
});

test("on a console only the kinds that don't need the game read", () => {
  const c = kindsFor(true).map((k) => k.kind);
  assert.ok(c.includes("repriced") && c.includes("rivens") && c.includes("baro") && c.includes("alertLoot"));
  assert.ok(!c.includes("invasions") && !c.includes("whispers") && !c.includes("sold"));
});

test("the history keeps the newest, up to its length", () => {
  let log = [] as ReturnType<typeof logNotice>;
  for (let i = 0; i < NOTICE_LOG + 5; i++) log = logNotice(log, { at: i, kind: "market", title: `n${i}`, body: "" });
  assert.equal(log.length, NOTICE_LOG);
  assert.equal(log[0].title, `n${NOTICE_LOG + 4}`);
  assert.equal(log[0].read, false);
});

test("a growing notice changes in place and moves to the top, unread", () => {
  const log = logNotice(logNotice([], { at: 1, kind: "repriced", title: "Repricing: 1 so far", body: "A: 9p → 8p" }), { at: 2, kind: "market", title: "Other", body: "" });
  const id = log[1].id;
  const grown = growNotice(log.map((n) => ({ ...n, read: true })), id, { at: 3, kind: "repriced", title: "2 listings repriced", body: "B: 5p → 4p\nA: 9p → 8p" });
  assert.equal(grown.length, 2);
  assert.deepEqual([grown[0].id, grown[0].title, grown[0].read], [id, "2 listings repriced", false]);
  assert.equal(growNotice(grown, "gone", { at: 4, kind: "repriced", title: "x", body: "" }).length, 3, "no longer there: logged as new");
});
