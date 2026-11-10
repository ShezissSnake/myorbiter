import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultNotify } from "../src/lib/backend";
import { NOTICE_KINDS, growNotice, kindsFor, logNotice, NOTICE_LOG, outcomeOf, outcomeText, routeOf, splitTarget, type NoticeOutcome, type PopupFacts } from "../src/lib/notices";
import { noticesOf } from "../src/lib/core/savedGame";
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

// ---------------------------------------------------------------- what became of a pop-up
// By default: not paused, not quiet, away from MyOrbiter (the game in front), both places on.
const facts = (o: Partial<PopupFacts> = {}): PopupFacts => ({ paused: false, quietKind: false, quietFissure: false, focused: false, toasts: true, desktop: true, ...o });

test("a notification goes to the desktop when MyOrbiter isn't in front, and inside it when it is", () => {
  assert.deepEqual(routeOf(facts()), { how: "desktop" });
  assert.deepEqual(routeOf(facts({ focused: true })), { how: "app" });
});

test("each gate holds a pop-up back, and says which", () => {
  assert.deepEqual(routeOf(facts({ paused: true })), { how: "held", why: "paused" });
  assert.deepEqual(routeOf(facts({ quietKind: true })), { how: "held", why: "quiet" });
  assert.deepEqual(routeOf(facts({ quietFissure: true })), { how: "held", why: "fissure" });
  // Held whether or not MyOrbiter is in front.
  assert.deepEqual(routeOf(facts({ paused: true, focused: true })), { how: "held", why: "paused" });
  assert.deepEqual(routeOf(facts({ quietFissure: true, focused: true })), { how: "held", why: "fissure" });
});

test("when more than one gate holds, the pause is the one named, then the quiet list, then the fissure", () => {
  assert.deepEqual(routeOf(facts({ paused: true, quietKind: true, quietFissure: true })), { how: "held", why: "paused" });
  assert.deepEqual(routeOf(facts({ quietKind: true, quietFissure: true })), { how: "held", why: "quiet" });
});

test("a place whose switch is off shows nothing, and says so", () => {
  assert.deepEqual(routeOf(facts({ desktop: false })), { how: "off", where: "desktop" });
  assert.deepEqual(routeOf(facts({ focused: true, toasts: false })), { how: "off", where: "app" });
  // The other place's switch doesn't matter.
  assert.deepEqual(routeOf(facts({ focused: true, desktop: false })), { how: "app" });
  assert.deepEqual(routeOf(facts({ toasts: false })), { how: "desktop" });
});

test("every outcome has its words", () => {
  const words: [NoticeOutcome, string][] = [
    [{ how: "desktop" }, "Sent to the desktop"],
    [{ how: "app" }, "Shown in the app"],
    [{ how: "held", why: "paused" }, "Held: paused"],
    [{ how: "held", why: "quiet" }, "Held: on the quiet list"],
    [{ how: "held", why: "fissure" }, "Held: quiet in a fissure"],
    [{ how: "off", where: "app" }, "Not shown: pop-ups inside MyOrbiter are off"],
    [{ how: "off", where: "desktop" }, "Not sent: desktop notifications are off"],
    [{ how: "failed", why: "no notification service" }, "Could not be sent: no notification service"],
  ];
  for (const [o, text] of words) assert.equal(outcomeText(o), text);
});

test("a saved outcome reads back; one of another shape is left off and its entry stays", () => {
  for (const o of [{ how: "desktop" }, { how: "app" }, { how: "held", why: "fissure" }, { how: "off", where: "desktop" }, { how: "failed", why: "x" }] as NoticeOutcome[]) assert.deepEqual(outcomeOf(o), o);
  for (const bad of [null, 5, "desktop", {}, { how: "held" }, { how: "held", why: "nap" }, { how: "off", where: "moon" }, { how: "failed" }, { how: "failed", why: 3 }]) assert.equal(outcomeOf(bad), undefined);
  assert.equal((outcomeOf({ how: "failed", why: "x".repeat(900) }) as { why: string }).why.length, 300);
  const n = { id: "1-abc", at: 3, kind: "whispers", title: "A whispered you", body: "", read: false };
  assert.deepEqual(noticesOf([{ ...n, outcome: { how: "held", why: "quiet" } }, { ...n, id: "2", outcome: { how: "nap" } }, n]), [{ ...n, outcome: { how: "held", why: "quiet" } }, { ...n, id: "2" }, n]);
});

test("a notice that grows starts over: what became of its earlier pop-up isn't its own", () => {
  let log = logNotice([], { at: 1, kind: "repriced", title: "Repricing: 1 so far", body: "A: 9p → 8p", outcome: { how: "app" } });
  assert.deepEqual(log[0].outcome, { how: "app" });
  log = growNotice(log, log[0].id, { at: 2, kind: "repriced", title: "2 listings repriced", body: "x" });
  assert.equal(log[0].outcome, undefined);
  assert.ok(!("outcome" in log[0]));
});
