// What's New as an update screen: entries out the same day are one update, the tour steps through
// the changes that have a place to show, and every Show me lands on a page and spot that exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NEWS, batches, tourStops, type NewsEntry } from "../src/lib/whatsNew";
import { PAGES } from "../src/lib/pages";

/** A link's page and spot, as App's goTo reads it ("market?spares=1#spares"). */
const parseTarget = (to: string) => {
  const [rest, spot] = to.split("#");
  return { page: rest.split("?")[0], spot: spot ?? null };
};

const item = (title: string, open?: string) => ({ title, text: "", icon: { line: "check" }, ...(open ? { open } : {}) });

test("entries out the same day are one update, newest first, their changes in order", () => {
  const entries: NewsEntry[] = [
    { id: 4, date: "2026-11-04", items: [item("d", "home")] },
    { id: 3, date: "2026-11-04", items: [item("c"), "an older sentence"] },
    { id: 2, date: "2026-11-02", items: ["b"] },
    { id: 1, date: "2026-11-01", items: ["a"] },
  ];
  const b = batches(entries);
  assert.deepEqual(b.map((u) => [u.date, u.ids]), [["2026-11-04", [4, 3]], ["2026-11-02", [2]], ["2026-11-01", [1]]]);
  assert.deepEqual(b[0].items.map((x) => (typeof x === "string" ? x : x.title)), ["d", "c", "an older sentence"]);
  // The entries themselves are left as they were.
  assert.equal(entries[0].items.length, 1);
  assert.deepEqual(batches([]), []);
});

test("the tour stops at each change with a place to show, in order", () => {
  const stops = tourStops([item("a", "home#today"), "a sentence", item("b"), item("c", "relics")]);
  assert.deepEqual(stops.map((s) => s.title), ["a", "c"]);
});

/** Every .svelte file under src, read once. */
function sources(dir = "src"): string {
  let out = "";
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out += sources(p);
    else if (e.name.endsWith(".svelte")) out += readFileSync(p, "utf8");
  }
  return out;
}

test("every Show me opens a real page, at a spot that page (or the sidebar) has", () => {
  const ids = new Set<string>(PAGES.map((p) => p.id));
  const src = sources();
  for (const n of NEWS) {
    for (const x of n.items) {
      if (typeof x === "string" || !x.open) continue;
      const t = parseTarget(x.open);
      assert.ok(ids.has(t.page), `${x.title}: no page ${t.page}`);
      if (!t.spot) continue;
      // data-card="spot", id="spot", Stat's spot="spot", or a spot chosen in code ("spot" : …).
      const at = [`data-card="${t.spot}"`, `id="${t.spot}"`, `spot="${t.spot}"`, `"${t.spot}" :`, `: "${t.spot}"`].some((s) => src.includes(s));
      assert.ok(at, `${x.title}: nothing on ${t.page} is marked "${t.spot}"`);
    }
  }
});

test("the latest update leads with a change that has a title and somewhere to show it", () => {
  const latest = batches(NEWS)[0];
  const head = latest.items[0];
  assert.ok(typeof head !== "string" && head.open, "the headline has Show me");
  assert.ok(tourStops(latest.items).length > 1, "a tour of more than one stop");
});
