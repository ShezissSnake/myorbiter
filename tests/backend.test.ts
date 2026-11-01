// backend.ts: saving before quitting, an unreachable worldstate, and loading the bundle in two parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleBundle, bundleLoader, defaultSettings, flushSettings, loadLive, loadSettings, quit, saveSettings } from "../src/lib/backend";
import type { CatalogPart, CollectionPart } from "../src/lib/core/types";

test("quitting saves a change made in the last 300 ms", async () => {
  const stored: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = { setItem: (k: string, v: string) => (stored[k] = v) };
  const s = defaultSettings();
  s.tab = "sales";
  let built = 0;
  saveSettings(() => (built++, s));
  saveSettings(() => (built++, s));
  assert.equal(stored["orbiter-settings"], undefined, "waits for the debounce");
  await quit();
  assert.equal(JSON.parse(stored["orbiter-settings"]).tab, "sales");
  assert.equal(built, 1, "put together once for the burst");
  await flushSettings();
  assert.equal(built, 1, "nothing left to save");
});

test("an unreachable worldstate is an error, so the last one read stays on screen", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    await assert.rejects(loadLive());
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** Fake Rust commands: the collection says which catalog revision is on disk; each catalogs call is counted. */
function fakeData() {
  const disk = { rev: "r1" as string | null, observed: 1 };
  const calls = { catalogs: 0 };
  let failNext = false;
  const get = {
    collection: async (_dir: string): Promise<CollectionPart> => ({
      observed_at: disk.observed,
      inventory: [{ item_id: "/A", name: "A", category: "mod", quantity: disk.observed, mastered: false, image_name: null, rank: null, max_rank: null }],
      prices: { prices: { A: 3 } },
      catalog_rev: disk.rev,
    }),
    catalogs: async (_dir: string): Promise<CatalogPart> => {
      calls.catalogs++;
      if (failNext) {
        failNext = false;
        throw new Error("catalog half-written");
      }
      return { rev: disk.rev, catalog: [{ uniqueName: "/A", name: `A@${disk.rev}`, category: "Mods" }], relics: [] };
    },
  };
  return { disk, calls, get, failOnce: () => (failNext = true) };
}

test("the bundle is put together in the shape buildModel reads", () => {
  const fresh: CollectionPart = { observed_at: 5, inventory: [], prices: null, catalog_rev: "r" };
  const cats: CatalogPart = { rev: "r", catalog: [{ uniqueName: "/A", name: "A", category: "Mods" }], relics: [] };
  assert.deepEqual(assembleBundle(fresh, cats), { observed_at: 5, inventory: [], catalog: cats.catalog, relics: [], prices: null });
});

test("the catalogs are fetched again only when their revision or the folder changes", async () => {
  const { disk, calls, get } = fakeData();
  const load = bundleLoader(get);
  const first = await load("");
  assert.equal(calls.catalogs, 1);
  assert.equal(first.catalog[0].name, "A@r1");

  disk.observed = 2;
  const second = await load("");
  assert.equal(calls.catalogs, 1, "same revision: the catalogs held are reused");
  assert.equal(second.inventory[0].quantity, 2, "the inventory is always fresh");
  assert.equal(second.catalog, first.catalog);

  disk.rev = "r2";
  assert.equal((await load("")).catalog[0].name, "A@r2");
  assert.equal(calls.catalogs, 2, "new revision: fetched again");

  await load("/elsewhere");
  assert.equal(calls.catalogs, 3, "another data folder: fetched again");
  await load("/elsewhere");
  assert.equal(calls.catalogs, 3);

  disk.rev = null;
  await load("/elsewhere");
  await load("/elsewhere");
  assert.equal(calls.catalogs, 5, "no revision: fetched every time");
});

test("reloads at once share one catalogs request, and a failed one is asked again", async () => {
  const { calls, get } = fakeData();
  const load = bundleLoader(get);
  await Promise.all([load(""), load(""), load("")]);
  assert.equal(calls.catalogs, 1);

  const { calls: calls2, get: get2, failOnce: fail2 } = fakeData();
  const load2 = bundleLoader(get2);
  fail2();
  await assert.rejects(load2(""));
  await load2("");
  assert.equal(calls2.catalogs, 2, "the failure isn't held");
  await load2("");
  assert.equal(calls2.catalogs, 2);
});

test("catalogs read at a newer revision than the collection said are held as that revision", async () => {
  const { disk, calls, get } = fakeData();
  // TennoScope writes a new catalog between the two requests.
  const load = bundleLoader({ ...get, catalogs: async (dir) => ((disk.rev = "r2"), get.catalogs(dir)) });
  await load("");
  assert.equal(calls.catalogs, 1);
  await load("");
  assert.equal(calls.catalogs, 1, "the collection now says r2, which is what is held");
});

test("the sidebar fold, the Planner's mode and the short-listing notices are kept; the old `view` goes", async () => {
  const saved = { folded: true, plannerMode: "radiant", view: { x: 1 }, game: { shortNotified: ["o1|5"] } };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(saved) };
  const s = await loadSettings();
  assert.equal(s.folded, true);
  assert.equal(s.plannerMode, "radiant");
  assert.deepEqual(s.game.shortNotified, ["o1|5"]);
  assert.equal("view" in s, false);
  // Settings from before these existed: folds by itself, Complete sets, nothing told yet.
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ plannerMode: "bogus", game: {} }) };
  const old = await loadSettings();
  assert.equal(old.folded, null);
  assert.equal(old.plannerMode, "sets");
  assert.deepEqual(old.game.shortNotified, []);
});

test("platform, automatic checks and Home's cards are kept; old tiers and unknown values go", async () => {
  const saved = { tiers: { "Arcane Energize": "S" }, homeHidden: ["baro", 3], market: { platform: "xbox", auto: true } };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(saved) };
  const s = await loadSettings();
  assert.equal(s.market.platform, "xbox");
  assert.equal(s.market.autoCheck, true, "settings from when Auto-match did both: checking stays on with applying");
  assert.deepEqual(s.homeHidden, ["baro"]);
  assert.equal("tiers" in s, false);
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ market: { platform: "dreamcast", every: 0 } }) };
  const odd = await loadSettings();
  assert.equal(odd.market.platform, "pc");
  assert.equal(odd.market.every, 5);
  assert.equal(odd.market.autoCheck, false);
});

test("a worldstate read keeps what it couldn't get from the last one", async () => {
  const { mergeLive } = await import("../src/lib/backend");
  const old = { fissures: [], resurgence: null, resurgenceExpiry: "x", baro: { activation: "a", expiry: "b", location: "Relay" }, cycles: [{ key: "earth", state: "day", expiry: "e" }] } as never;
  const next = { fissures: [{ id: "f" }], resurgence: null, resurgenceExpiry: null, baro: null, cycles: [] } as never;
  const m = mergeLive(old, next) as unknown as Record<string, unknown>;
  assert.deepEqual(m.fissures, [{ id: "f" }], "new parts win");
  assert.equal((m.baro as { location: string }).location, "Relay", "a part the read lacked keeps its last value");
  assert.equal(m.resurgenceExpiry, "x");
  assert.equal((m.cycles as unknown[]).length, 1);
});

test("only Discord webhook addresses are posted to", async () => {
  const { isDiscordWebhook } = await import("../src/lib/backend");
  assert.ok(isDiscordWebhook("https://discord.com/api/webhooks/1234567890/AbC_dEf-123"));
  assert.ok(isDiscordWebhook("https://ptb.discord.com/api/webhooks/1/x"));
  assert.ok(!isDiscordWebhook("https://discord.com.evil.example/api/webhooks/1/x"));
  assert.ok(!isDiscordWebhook("http://discord.com/api/webhooks/1/x"));
  assert.ok(!isDiscordWebhook("https://discord.com/api/webhooks/1/x?wait=true"));
});

test("a kept worldstate part whose end has passed isn't kept", async () => {
  const { mergeLive } = await import("../src/lib/backend");
  const now = Date.parse("2026-11-02T12:00:00Z");
  const old = { fissures: null, resurgence: null, resurgenceExpiry: null, duviriCycle: { expiry: "2026-11-02T00:00:00Z", choices: [] }, steelPath: { expiry: "2026-11-09T00:00:00Z", currentReward: null } } as never;
  const next = { fissures: [], resurgence: null, resurgenceExpiry: null, duviriCycle: null, steelPath: null } as never;
  const m = mergeLive(old, next, now) as unknown as Record<string, unknown>;
  assert.equal(m.duviriCycle, null, "last week's Circuit is gone");
  assert.ok(m.steelPath, "this week's Teshin offer stays");
});

test("a clock the new read lacks keeps its last reading, and Varzia's stock goes with its end", async () => {
  const { mergeLive } = await import("../src/lib/backend");
  const now = Date.parse("2026-11-02T12:00:00Z");
  const old = { fissures: null, resurgence: [{ uniqueName: "x" }], resurgenceExpiry: "2026-11-02T11:00:00Z", cycles: [{ key: "earth", state: "day", expiry: "e1" }, { key: "zariman", state: "corpus", expiry: "z" }] } as never;
  const next = { fissures: [], resurgence: null, resurgenceExpiry: null, cycles: [{ key: "earth", state: "night", expiry: "e2" }] } as never;
  const m = mergeLive(old, next, now) as unknown as { cycles: { key: string; state: string }[]; resurgence: unknown; resurgenceExpiry: unknown };
  assert.deepEqual(m.cycles.map((c) => `${c.key}:${c.state}`), ["earth:night", "zariman:corpus"]);
  assert.equal(m.resurgence, null, "her rotation ended");
  assert.equal(m.resurgenceExpiry, null);
});

test("the Watching column and Discord settings load safely", async () => {
  const { loadSettings, DISCORD_DEFAULT_KINDS } = await import("../src/lib/backend");
  const saved = { side: { on: false, cards: ["fissures", 7, "clocks"] }, notifyOptions: { discord: { url: "https://discord.com/api/webhooks/1/x", kinds: ["sold", null] } } };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify(saved) };
  const s = await loadSettings();
  assert.equal(s.side.on, false);
  assert.deepEqual(s.side.cards, ["fissures", "clocks"], "only names of cards");
  assert.equal(s.notifyOptions.discord.url, "https://discord.com/api/webhooks/1/x");
  assert.deepEqual(s.notifyOptions.discord.kinds, ["sold"]);
  // From before either existed: the column on with its usual cards, no Discord.
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => JSON.stringify({ notifyOptions: { discord: { url: 42 } } }) };
  const old = await loadSettings();
  assert.equal(old.side.on, true);
  assert.ok(old.side.cards.includes("fissures"));
  assert.equal(old.notifyOptions.discord.url, "");
  assert.deepEqual(old.notifyOptions.discord.kinds, DISCORD_DEFAULT_KINDS);
});

test("a kept worldstate loses each thing at its own end time", async () => {
  const { pruneLive, restoreLive } = await import("../src/lib/backend");
  const now = Date.parse("2026-11-01T12:00:00Z");
  const at = (min: number) => new Date(now + min * 60_000).toISOString();
  const live = {
    fissures: [{ id: "gone", expiry: at(-1) }, { id: "37 min left", expiry: at(37) }],
    resurgence: [{ uniqueName: "x" }],
    resurgenceExpiry: at(600),
    alerts: [{ id: "a", expiry: at(-5) }],
    syndicates: [{ syndicateKey: "CetusSyndicate", expiry: at(20) }],
    nightwave: { expiry: at(9000), activeChallenges: [{ id: "daily", expiry: at(-2) }, { id: "weekly", expiry: at(3000) }] },
    sortie: { expiry: at(-30), boss: "x" },
    baro: { activation: at(-100), expiry: at(100), location: "Relay" },
    invasions: [{ id: "i" }],
    cycles: [{ key: "earth", state: "day", expiry: at(-10) }],
  } as never;
  const p = pruneLive(live, now) as unknown as Record<string, unknown>;
  assert.deepEqual((p.fissures as { id: string }[]).map((f) => f.id), ["37 min left"]);
  assert.deepEqual(p.alerts, []);
  assert.equal(p.sortie, null);
  assert.deepEqual((p.nightwave as { activeChallenges: { id: string }[] }).activeChallenges.map((c) => c.id), ["weekly"]);
  assert.ok(p.baro && p.resurgence, "Baro and Varzia are still here");
  assert.equal((p.cycles as unknown[]).length, 1, "the clocks count on from their last reading");
  // 37 minutes on, that fissure is gone too; nothing ended: the same object back.
  assert.deepEqual((pruneLive(p as never, now + 38 * 60_000) as unknown as { fissures: unknown[] }).fissures, []);
  const fresh = pruneLive(p as never, now);
  assert.equal(fresh, p);
  // Kept for the next start: invasions only for an hour (they don't say when they end), nothing past a day.
  const soon = restoreLive(JSON.parse(JSON.stringify({ at: now, live })), now + 10 * 60_000)!;
  assert.ok(soon.live.invasions?.length);
  assert.equal(soon.at, now);
  const later = restoreLive({ at: now, live }, now + 2 * 3_600_000)!;
  assert.equal(later.live.invasions, null);
  assert.deepEqual(later.live.fissures, []);
  assert.equal(restoreLive({ at: now, live }, now + 25 * 3_600_000), null);
  assert.equal(restoreLive(null, now), null);
  assert.equal(restoreLive({ at: "x", live }, now), null);
});
