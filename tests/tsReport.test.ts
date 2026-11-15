// TennoScope's report is checked once where it comes in: a report without what the pages read is
// taken as "runs but doesn't answer", and a health component it doesn't name reads as not known.
// The sidebar's lines and the setup steps then never meet a report they can't read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportOf, statusOf } from "../src/lib/core/tsReport";
import { firstStart, gameLine, inventoryLine, LIMITS, type Signs } from "../src/lib/core/firstStart";
import type { TennoscopeReport, TennoscopeStatus } from "../src/lib/backend";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const health = (state: string, message: string) => ({ state, message, last_success: null });
const KEYS = ["game_reader", "log_monitor", "capture", "catalog", "market", "collection_prices", "database", "market_account"];

const good: TennoscopeReport = {
  at: 9_000,
  pid: 42,
  game_running: true,
  health: Object.fromEntries(KEYS.map((k) => [k, health("ready", "ok")])) as TennoscopeReport["health"],
  market: { link: "unlinked", backing: null, presence: { status: null, wanted: null, auto: false } },
  setup: { setup_complete: true, access_mode: "full", desktop_capture_action_available: false },
  last_error: null,
  mastery_rank: 12,
};
const status = (report: unknown): TennoscopeStatus => ({ binary: "/opt/tennoscope", running: true, started_by_myorbiter: true, report: report as TennoscopeReport });

/** The setup steps' signs from a status as the store holds it. */
const signs = (st: TennoscopeStatus | null, now = 0): Signs => ({
  now,
  status: st ? { supported: true, running: st.running, binary: st.binary, report: st.report } : null,
  tsError: null,
  since: 0,
  runningSince: 0,
  asked: null,
  gameSince: null,
  signedInSince: null,
  log: { found: true, signedIn: false },
  pickup: { error: "No inventory read yet", entries: 0, observedAt: null },
  ptraceScope: null,
});

test("a whole report comes through as it is", () => {
  assert.deepEqual(reportOf(good), good);
  assert.deepEqual(statusOf(status(good)), status(good));
  assert.equal(statusOf(null), null);
  assert.deepEqual(statusOf(status(null)), status(null));
});

test("a report without setup or health is taken as no report: TennoScope runs but doesn't answer", () => {
  const other = { at: 9_000, pid: 42, game_running: true, last_error: null };
  for (const bad of [other, { ...good, setup: undefined }, { ...good, health: null }, { ...good, setup: "full" }, { ...good, game_running: "yes" }, "junk", 7, null]) {
    assert.equal(reportOf(bad), null, JSON.stringify(bad));
    const st = statusOf(status(bad));
    assert.equal(st?.report, null);
    // The sidebar's two lines and the setup steps draw from it without an exception.
    assert.doesNotThrow(() => gameLine(signs(st)));
    assert.doesNotThrow(() => inventoryLine(signs(st)));
    assert.equal(inventoryLine(signs(st)).value, "No report");
    const x = firstStart(signs(st, LIMITS.report));
    assert.equal(x.stage, "TennoScope runs but doesn't answer");
    assert.equal(x.stuck, true);
  }
});

test("a health component the report doesn't name reads as not known", () => {
  const few = { ...good, health: { game_reader: health("ready", "Inventory synchronized from warframe-memory"), catalog: "broken" } };
  const r = reportOf(few);
  assert.ok(r);
  for (const k of KEYS) assert.equal(typeof r.health[k as keyof TennoscopeReport["health"]].message, "string", k);
  assert.equal(r.health.game_reader.state, "ready");
  assert.equal(r.health.catalog.state, "unknown");
  assert.equal(r.health.market_account.state, "unknown");
  assert.equal(r.health.market_account.last_success, null);
  // A state of its own invention is not known either.
  assert.equal(reportOf({ ...good, health: { ...good.health, capture: health("sleeping", "zzz") } })?.health.capture.state, "unknown");
  // The panel has words for it.
  assert.match(src("lib/TennoscopeSheet.svelte"), /unknown: "Not known"/);
});

test("a mode or an error in another shape reads as none", () => {
  assert.equal(reportOf({ ...good, setup: { access_mode: "everything" } })?.setup.access_mode, null);
  assert.equal(reportOf({ ...good, setup: {} })?.setup.desktop_capture_action_available, false);
  assert.equal(reportOf({ ...good, last_error: "it broke" })?.last_error, null);
  assert.equal(reportOf({ ...good, last_error: { at: "now", message: "x" } })?.last_error, null);
  assert.deepEqual(reportOf({ ...good, last_error: { at: 5, message: "x" } })?.last_error, { at: 5, message: "x" });
});

test("every way a status comes in goes through the check", () => {
  const store = src("lib/tennoscopeStore.svelte.ts");
  // The status is set in one place, and that place checks it.
  assert.deepEqual(store.match(/this\.status = /g), ["this.status = "]);
  const put = store.slice(store.indexOf("private put("), store.indexOf("private put(") + 400);
  assert.match(put, /statusOf\(/);
  assert.ok(put.indexOf("statusOf(") < put.indexOf("this.status = "));
});
