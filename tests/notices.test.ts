import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultNotify } from "../src/lib/backend";
import { NOTICE_KINDS, growNotice, kindsFor, logNotice, NOTICE_LOG, onItsPage, outcomeOf, outcomeText, pageOf, routeOf, splitTarget, type NoticeKind, type NoticeOutcome, type OnScreen, type PopupFacts } from "../src/lib/notices";
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
const facts = (o: Partial<PopupFacts> = {}): PopupFacts => ({ paused: false, quietKind: false, quietFissure: false, focused: false, toasts: true, desktop: true, onItsPage: false, ...o });

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

test("inside MyOrbiter, a notification held over its page (the reward over Current fissure) doesn't pop up; the desktop's is unchanged", () => {
  // The reward to take, while Current fissure shows its cards: under the bell only, and it says why.
  assert.deepEqual(routeOf(facts({ focused: true, onItsPage: true })), { how: "held", why: "page" });
  // Away from MyOrbiter it goes to the desktop as before, whatever page was left open.
  assert.deepEqual(routeOf(facts({ onItsPage: true })), { how: "desktop" });
  // Pop-ups inside MyOrbiter off: that's what it says, as before.
  assert.deepEqual(routeOf(facts({ focused: true, toasts: false, onItsPage: true })), { how: "off", where: "app" });
  // Another page on screen: it pops up.
  assert.deepEqual(routeOf(facts({ focused: true, onItsPage: false })), { how: "app" });
});

const shown = (kind: NoticeKind, to?: string) => ({ kind, ...(to ? { to } : {}) });
const screen = (tab: string, o: Partial<OnScreen> = {}): OnScreen => ({ tab, drawn: true, covered: false, up: false, ...o });

test("the reward to take is held while Current fissure is drawn with nothing over it", () => {
  // The audit's case: its pop-up would cover the cards it names.
  assert.equal(onItsPage("reward", shown("reward"), screen("mission")), true);
  // Another page on screen: it pops up.
  assert.equal(onItsPage("reward", shown("reward"), screen("home")), false);
  // Its pop-up already up is kept up to date, as before.
  assert.equal(onItsPage("reward", shown("reward"), screen("mission", { up: true })), false);
  // The Settings test has no page of its own.
  assert.equal(onItsPage("test", shown("reward"), screen("mission")), false);
});

test("the reward to take pops up when Current fissure is covered or not drawn", () => {
  // A sheet or the help over it.
  assert.equal(onItsPage("reward", shown("reward"), screen("mission", { covered: true })), false);
  // The setup page or a "Can't read" page in its place.
  assert.equal(onItsPage("reward", shown("reward"), screen("mission", { drawn: false })), false);
});

test("every other kind pops up as before, its page on screen or not", () => {
  // A Home notice while Home is open, site chat or a listing problem on Orders, a sale on Sales.
  assert.equal(onItsPage("baro", shown("baro"), screen("home")), false);
  assert.equal(onItsPage("tennoscope", shown("tennoscope"), screen("home")), false);
  assert.equal(onItsPage("siteChat", shown("siteChat"), screen("market")), false);
  assert.equal(onItsPage("market", shown("market", "spares#cat-mods"), screen("spares")), false);
  assert.equal(onItsPage("sold", shown("sold"), screen("sales")), false);
  for (const k of NOTICE_KINDS) if (k.kind !== "reward") assert.equal(onItsPage(k.kind, shown(k.kind), screen(splitTarget(k.to).page)), false, k.kind);
});

test("App reads the screen for the hold as it is: the page chosen, drawn once there's a collection, and anything modal over it", () => {
  const app = readFileSync(join(import.meta.dirname, "../src/App.svelte"), "utf8");
  const facts = /onItsPage: onItsPage\(gate, n, \{([^}]*)\}\)/.exec(app)?.[1] ?? "";
  assert.match(facts, /tab: settings\.tab,/);
  // The pages are drawn in the {:else} after the setup and "Can't read" pages, which show while there's no model.
  assert.match(facts, /drawn: !!model,/);
  assert.match(app, /\{:else if !model\}[\s\S]{0,400}\{:else\}/);
  // A sheet, the help and every dialog are aria-modal while open.
  assert.match(facts, /covered: [^,]*document\.querySelector\('\[aria-modal="true"\]'\)/);
  for (const f of ["ui/Sheet.svelte", "ui/HelpDialog.svelte"]) assert.match(readFileSync(join(import.meta.dirname, "../src/lib", f), "utf8"), /aria-modal/, f);
  assert.match(facts, /up: toasts\.list\.some\(\(t\) => t\.id === n\.id\)/);
});

test("the page a notification opens: its own target, else its kind's, without the card", () => {
  const n = (kind: NoticeKind, to?: string) => ({ id: "x", at: 0, kind, title: "t", body: "", read: false, ...(to ? { to } : {}) });
  assert.equal(pageOf(n("reward")), "mission");
  assert.equal(pageOf(n("baro")), "home");
  assert.equal(pageOf(n("market", "spares#cat-mods")), "spares");
});

test("every outcome has its words", () => {
  const words: [NoticeOutcome, string][] = [
    [{ how: "desktop" }, "Sent to the desktop"],
    [{ how: "app" }, "Shown in the app"],
    [{ how: "held", why: "paused" }, "Held: paused"],
    [{ how: "held", why: "quiet" }, "Held: on the quiet list"],
    [{ how: "held", why: "fissure" }, "Held: quiet in a fissure"],
    [{ how: "held", why: "page" }, "Held: its page was on screen"],
    [{ how: "off", where: "app" }, "Not shown: pop-ups inside MyOrbiter are off"],
    [{ how: "off", where: "desktop" }, "Not sent: desktop notifications are off"],
    [{ how: "failed", why: "no notification service" }, "Could not be sent: no notification service"],
  ];
  for (const [o, text] of words) assert.equal(outcomeText(o), text);
});

test("a saved outcome reads back; one of another shape is left off and its entry stays", () => {
  for (const o of [{ how: "desktop" }, { how: "app" }, { how: "held", why: "fissure" }, { how: "held", why: "page" }, { how: "off", where: "desktop" }, { how: "failed", why: "x" }] as NoticeOutcome[]) assert.deepEqual(outcomeOf(o), o);
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
