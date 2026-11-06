import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLogged, recordScreen, refinementOf, resolvePicks, scoreRun, summarize, MAX_RUNS, SAME_SCREEN_MS, SESSION_GAP_MS, type RelicRun } from "../src/lib/core/relicRuns";

const MIN = 60_000;
const M = MIN;
const T0 = 1_792_000_000_000;
const R = (s: string) => `/Lotus/Types/Game/Projections/${s}`;
const prices: Record<string, number> = { A: 10, B: 4, C: 2, D: 30 };
const price = (n: string) => prices[n] ?? null;

test("a screen read again (its prices came in, or the log named your reward) updates the same run", () => {
  let runs = recordScreen([], { at: T0, cards: ["A", "B"], relics: [R("T1VoidProjectionXBronze")], before: { A: 0, B: 1 }, baseAt: T0 - MIN })!;
  assert.equal(runs.length, 1);
  runs = recordScreen(runs, { at: T0 + 2_000, cards: ["A", "B"], relics: [], own: "B", before: { A: 5, B: 5 }, baseAt: T0 + 1_000 })!;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].own, "B");
  assert.deepEqual(runs[0].before, { A: 0, B: 1 }, "what you held when the screen first opened");
  assert.equal(runs[0].relics.length, 1, "an empty relic list doesn't wipe the one read");
  assert.equal(recordScreen(runs, { at: T0 + 3_000, cards: ["A", "B"], relics: [] }), null, "nothing new: no change");
  runs = recordScreen(runs, { at: T0 + 4 * MIN, cards: ["C"], relics: [] })!;
  assert.equal(runs.length, 2);
});

test("TennoScope's log fills in the screens orbiter didn't see, and nothing twice", () => {
  const live = recordScreen([], { at: T0 + 10 * MIN, cards: ["A"], relics: [] })!;
  const logged = [
    { at: T0, cards: ["B"], relics: [] },
    { at: T0 + 10 * MIN + 1_000, cards: ["A"], relics: [] }, // the live one
    { at: T0 + 20 * MIN, cards: [], relics: [] },
  ];
  const runs = mergeLogged(live, logged)!;
  assert.deepEqual(runs.map((r) => r.at), [T0, T0 + 10 * MIN, T0 + 20 * MIN]);
  assert.equal(runs[1].imported, undefined, "the live run stays the live one");
  assert.equal(runs[0].imported, true);
  assert.equal(mergeLogged(runs, logged), null, "merging again adds nothing");
});

test("the card you took is the one whose item arrived in the next inventory read", () => {
  let runs: RelicRun[] = [{ at: T0, cards: ["A", "B", "C"], relics: [], before: { A: 0, B: 2, C: 1 }, baseAt: T0 - MIN }];
  const held = (h: Record<string, number>) => (n: string) => h[n] ?? 0;
  // A read during the mission: nothing has arrived yet.
  assert.equal(resolvePicks(runs, held({ A: 0, B: 2, C: 1 }), T0 + MIN), null);
  runs = resolvePicks(runs, held({ A: 0, B: 3, C: 1 }), T0 + 5 * MIN)!;
  assert.equal(runs[0].took, "B");
  // An inventory read from before the screen settles nothing.
  const fresh: RelicRun[] = [{ at: T0, cards: ["A"], relics: [], before: { A: 0 }, baseAt: T0 - MIN }];
  assert.equal(resolvePicks(fresh, held({ A: 1 }), T0 - 1_000), null);
});

test("rounds of one mission share out what arrived, oldest first", () => {
  const runs: RelicRun[] = [
    { at: T0, cards: ["A", "B"], relics: [], before: { A: 0, B: 0 }, baseAt: T0 - MIN },
    { at: T0 + 5 * MIN, cards: ["A", "C"], relics: [], before: { A: 0, C: 0 }, baseAt: T0 - MIN },
  ];
  // One A arrived and one C: the first round took A, so the second's A is spoken for.
  const out = resolvePicks(runs, (n) => ({ A: 1, C: 1 })[n] ?? 0, T0 + 10 * MIN)!;
  assert.equal(out[0].took, "A");
  assert.equal(out[1].took, "C");
  // Settled in an earlier read, the first round still claims its copy.
  const later: RelicRun[] = [{ ...runs[0], took: "A" }, { ...runs[1], cards: ["A", "B"], before: { A: 0, B: 0 } }];
  assert.equal(resolvePicks(later, (n) => ({ A: 1 })[n] ?? 0, T0 + 10 * MIN), null, "the one A is the first round's");
});

test("two cards arrived: your own relic's reward is the one; otherwise it stays unknown", () => {
  const run: RelicRun = { at: T0, cards: ["A", "B"], relics: [], before: { A: 0, B: 0 }, baseAt: T0 - MIN };
  const both = (n: string) => ({ A: 1, B: 1 })[n] ?? 0;
  assert.equal(resolvePicks([run], both, T0 + MIN), null);
  assert.equal(resolvePicks([{ ...run, own: "B" }], both, T0 + MIN)![0].took, "B");
  assert.equal(resolvePicks([{ ...run, imported: true }], both, T0 + MIN), null, "history from the log has no before");
});

test("a screen counts the card you took, else your own reward, else the average card", () => {
  const base: RelicRun = { at: T0, cards: ["A", "B", "Forma Blueprint"], relics: [] };
  assert.deepEqual(
    [scoreRun({ ...base, took: "B" }, price), scoreRun({ ...base, own: "A" }, price), scoreRun(base, price), scoreRun({ ...base, cards: [] }, price)].map((s) => [s.basis, s.value, s.best]),
    [["took", 4, 10], ["own", 10, 10], ["average", 14 / 3, 10], ["unread", 0, 0]],
  );
});

test("sessions break on long gaps; per hour counts a typical round before the first screen", () => {
  const runs: RelicRun[] = [
    { at: T0, cards: ["A", "B"], relics: [], took: "A" },
    { at: T0 + 4 * MIN, cards: ["D", "C"], relics: [], took: "C" },
    { at: T0 + 8 * MIN, cards: [], relics: [] },
    { at: T0 + 8 * MIN + SESSION_GAP_MS + 1, cards: ["B"], relics: [], took: "B" },
  ];
  const s = summarize(runs, price);
  assert.equal(s.sessions.length, 2);
  assert.equal(s.typical, 4 * MIN);
  const first = s.sessions[1];
  assert.equal(first.minutes, 12);
  // 10 + 2, and the unread screen counts as the average screen read: (10 + 2 + 4) / 3.
  assert.equal(Math.round(first.plat * 1000) / 1000, Math.round((12 + 16 / 3) * 1000) / 1000);
  assert.equal(first.unread, 1);
  assert.equal(Math.round(first.best), Math.round(10 + 30 + (10 + 30 + 4) / 3));
  assert.equal(s.screens, 4);
  assert.equal(Math.round(s.hours * 60), 16);
});

test("refinement from a projection path", () => {
  assert.equal(refinementOf(R("T3VoidProjectionGyrePrimeCPlatinum")), "Radiant");
  assert.equal(refinementOf(R("T1VoidProjectionXBronze")), "Intact");
  assert.equal(refinementOf("nonsense"), null);
});

test("a screen from before the newest (a clock change) goes in its place; a re-read that adds nothing changes nothing", () => {
  const a = recordScreen([], { at: 10 * M, cards: ["A"], relics: ["r"] })!;
  const b = recordScreen(a, { at: 30 * M, cards: ["B"], relics: ["r"] })!;
  const mid = recordScreen(b, { at: 20 * M, cards: ["C"], relics: ["r"] })!;
  assert.deepEqual(mid.map((r) => r.at), [10 * M, 20 * M, 30 * M]);
  // Read again with nothing new (no cards this time): the run keeps what it had, and nothing changes.
  assert.equal(recordScreen(mid, { at: 30 * M + 1000, cards: [], relics: [] }), null);
  const again = recordScreen(mid, { at: 30 * M + 1000, cards: [], relics: [], own: "B" })!;
  assert.deepEqual([again[2].cards, again[2].own], [["B"], "B"]);
  // One from TennoScope's log, then seen live: it's a live one now.
  const fromLog = recordScreen([{ at: 40 * M, cards: ["D"], relics: [], imported: true }], { at: 40 * M + 500, cards: ["D"], relics: [] })!;
  assert.equal(fromLog[0].imported, false);
});

test("the run list keeps the newest MAX_RUNS screens, from the game and from TennoScope's log", () => {
  const full = Array.from({ length: MAX_RUNS }, (_, i) => ({ at: i * 2 * SAME_SCREEN_MS, cards: ["A"], relics: [] }));
  const last = full[full.length - 1].at;
  const live = recordScreen(full, { at: last + 10 * M, cards: ["B"], relics: [] })!;
  assert.equal(live.length, MAX_RUNS);
  assert.equal(live[0].at, full[1].at, "the oldest went");
  const logged = mergeLogged(full, [{ at: last + 10 * M, cards: ["B"], relics: [] }, { at: last + 10 * M + 1000, cards: ["B"], relics: [] }])!;
  assert.equal(logged.length, MAX_RUNS, "one screen read twice in the log is one");
  assert.equal(logged.at(-1)!.imported, true);
});

test("a pick settled earlier holds its copy; a read from before the screen settles nothing", () => {
  const runs: RelicRun[] = [
    { at: 10 * M, cards: ["A", "B"], relics: [], before: { A: 0, B: 0 }, baseAt: 5 * M, took: "A" },
    { at: 20 * M, cards: ["A", "C"], relics: [], before: { A: 0, C: 0 }, baseAt: 5 * M },
  ];
  // One A arrived, already the first screen's: the second took nothing known.
  assert.equal(resolvePicks(runs, (n) => (n === "A" ? 1 : 0), 30 * M), null);
  // Two arrived: the second screen's is the other copy.
  assert.equal(resolvePicks(runs, (n) => (n === "A" ? 2 : 0), 30 * M)![1].took, "A");
  assert.equal(resolvePicks(runs, () => 5, 15 * M)?.[1].took, undefined, "an inventory read older than the screen");
});

test("a session of screens that couldn't be read counts the average read screen for each", () => {
  const price = (n: string) => ({ A: 10, B: 30 })[n] ?? null;
  const s = summarize([{ at: 0, cards: ["A", "B"], relics: [], took: "B" }, { at: 4 * M, cards: [], relics: [] }], price);
  assert.equal(s.unread, 1);
  assert.equal(s.plat, 60, "30 taken, and 30 for the unread one");
  assert.equal(s.best, 60);
  const none = summarize([{ at: 0, cards: [], relics: [] }], price);
  assert.deepEqual([none.plat, none.perScreen, none.sessions.length], [0, 0, 1]);
  assert.equal(summarize([], price).perHour, 0);
});
