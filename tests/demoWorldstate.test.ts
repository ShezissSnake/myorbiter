// The demo's world state (demo/dev-worldstate.json): read in the demo instead of any service, with
// every part the pages show, and nothing in it ending soon after the moment it's written as of.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// What vite.config.ts defines on the demo dev server; set before backend.ts is loaded.
(globalThis as { __MYORBITER_DEMO__?: boolean }).__MYORBITER_DEMO__ = true;
const { loadLive, pruneLive } = await import("../src/lib/backend");

const file = JSON.parse(readFileSync(new URL("../demo/dev-worldstate.json", import.meta.url), "utf8")) as Record<string, unknown>;
const { now } = JSON.parse(readFileSync(new URL("../demo/meta.json", import.meta.url), "utf8")) as { now: number };

test("the demo reads its own world state and asks no service", async () => {
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    asked.push(String(url));
    return new Response(JSON.stringify(file), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const live = await loadLive();
    assert.deepEqual(asked, ["/dev-worldstate.json"]);
    for (const [k, v] of Object.entries(live)) if (k !== "fromGame") assert.notEqual(v, null, `${k} is in the demo's world state`);
    assert.equal(live.fromGame, false);
    // Every kind the fissure board groups, every era.
    const fs = live.fissures!;
    assert.deepEqual([...new Set(fs.map((f) => (f.isStorm ? "storm" : f.isHard ? "steel" : "normal")))].sort(), ["normal", "steel", "storm"]);
    assert.deepEqual([...new Set(fs.map((f) => f.tier))].sort(), ["Axi", "Lith", "Meso", "Neo", "Omnia", "Requiem"]);
    assert.deepEqual(live.cycles!.map((c) => c.key).sort(), ["cambion", "cetus", "duviri", "earth", "vallis", "zariman"]);
    assert.ok(live.baro!.inventory!.length && Date.parse(live.baro!.activation) <= now, "Baro is here, with stock");
    assert.ok(live.resurgence!.length);
    for (const k of ["alerts", "invasions", "syndicates", "events", "archimedeas"] as const) assert.ok((live[k] as unknown[]).length, `${k} has some`);
    // Nothing has ended within the first 45 minutes after it's served: a run of the checks never
    // sees a part go (the page reads it again every 5 minutes, moved up to the time again).
    const later = now + 45 * 60_000;
    assert.equal(pruneLive(live, later), live, "nothing pruned 45 minutes on");
    for (const f of fs) assert.ok(Date.parse(f.expiry) > later, `fissure ${f.id} lasts`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the demo's world state is invented: every id is its own", () => {
  const text = JSON.stringify(file);
  const ids = [...text.matchAll(/"id":"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0 && ids.every((id) => id.startsWith("demo-")), "every id is the demo's own");
});
