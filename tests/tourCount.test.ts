// A tour's button counts the stops the tour will really make: the tour leaves out a stop on a
// page this player doesn't have, and Settings, which is a panel and not a page. A tour that would
// make none (or only one) isn't offered.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NEWS, batches, sinceSeen, tourStops } from "../src/lib/whatsNew";
import { pagesFor } from "../src/lib/pages";

const { tour, tourGate, tourKept, startTour, endTour } = await import("../src/lib/tour.svelte");

/** The gate App sets: a page this player has (a console player has fewer). */
const gate = (onConsole: boolean) => (page: string) => pagesFor(onConsole).some((p) => p.id === page);

test("every day's tour, on PC and on console: the count is the stops the tour makes", () => {
  for (const onConsole of [false, true]) {
    tourGate.ok = gate(onConsole);
    for (const u of [...batches(NEWS), ...sinceSeen("").updates]) {
      const kept = tourKept(tourStops(u.items));
      startTour(tourStops(u.items));
      assert.deepEqual(tour.stops.map((s) => s.title), kept.map((s) => s.title), `${u.date}: the tour makes the stops counted`);
      assert.ok(kept.every((s) => !s.open?.startsWith("settings")), `${u.date}: no Settings stop is counted`);
      endTour();
    }
  }
});

test("a day whose changes are all in Settings has no stop to make", () => {
  tourGate.ok = gate(false);
  const settingsOnly = batches(NEWS).filter((u) => {
    const s = tourStops(u.items);
    return s.length > 1 && s.every((x) => x.open!.startsWith("settings"));
  });
  assert.ok(settingsOnly.length > 0, "the news has such a day (November 7)");
  for (const u of settingsOnly) assert.equal(tourKept(tourStops(u.items)).length, 0, `${u.date}: nothing kept`);
  startTour([]);
  assert.equal(tour.stops.length, 0);
});

test("What's New counts and offers its tour by the stops kept", () => {
  const src = readFileSync("src/lib/WhatsNew.svelte", "utf8");
  assert.match(src, /const stops = \$derived\(tourKept\(since\.stops\)\);/, "the button's count is the tour's");
  assert.match(src, /\{#if stops\.length > 1 && go\}/, "offered only with more than one stop to make");
});
