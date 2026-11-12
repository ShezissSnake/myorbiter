// The first start's steps against stand-ins for TennoScope and a fake clock: one that never starts,
// one that starts and never reports, one that refuses Full access, one that never reads, one whose
// read MyOrbiter can't load, and the game's own log. Every step has a way on without TennoScope
// ever answering: each wait ends at its limit in a plain state with a reason, and Finish later is
// always there (App.svelte draws it on every step).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstStart, gameLine, inventoryLine, LIMITS, logLine, type ReportSigns, type Signs } from "../src/lib/core/firstStart";

const T0 = Date.UTC(2026, 10, 12, 18, 0);
const S = 1000;

const report = (over: Partial<ReportSigns> & { reader?: [string, string] } = {}): ReportSigns => ({
  game_running: false,
  setup: { access_mode: "overlay" },
  health: { game_reader: { state: over.reader?.[0] ?? "idle", message: over.reader?.[1] ?? "Warframe is not running" }, catalog: { state: "ready", message: "Item data up to date" } },
  last_error: null,
  mastery_rank: null,
  ...over,
});

const signs = (over: Partial<Signs> = {}): Signs => ({
  now: T0,
  status: { supported: true, running: true, binary: "/opt/tennoscope", report: null },
  tsError: null,
  since: T0,
  runningSince: T0,
  asked: null,
  gameSince: null,
  signedInSince: null,
  log: { found: true, signedIn: false },
  pickup: { error: "not found at ~/.local/share/io.github.deftera186.tennoscope/tennoscope.sqlite3: TennoScope hasn't written it yet", entries: 0, observedAt: null },
  ptraceScope: 0,
  ...over,
});

test("a TennoScope that never starts: waiting, then stuck at the limit with why, and Try again", () => {
  const off = { supported: true, running: false, binary: "/opt/tennoscope", report: null };
  const w = firstStart(signs({ status: off, runningSince: null }));
  assert.equal(w.step, "start");
  assert.equal(w.stuck, false);
  assert.equal(w.waitingFor, "TennoScope to start");
  const t = firstStart(signs({ status: off, runningSince: null, now: T0 + LIMITS.start }));
  assert.equal(t.stuck, true);
  assert.equal(t.stage, "TennoScope didn't start");
  assert.match(t.reason ?? "", /wasn't running after 30 s/);
  assert.ok(t.actions.includes("retry"));
  // Its own failure, said at once.
  assert.equal(firstStart(signs({ status: off, runningSince: null, tsError: "Couldn't start /opt/tennoscope: no such file" })).stuck, true);
  // Not found at all: no wait, Settings.
  const none = firstStart(signs({ status: { ...off, binary: null }, runningSince: null }));
  assert.equal(none.stuck, true);
  assert.deepEqual(none.actions, ["settings"]);
});

test("a TennoScope that starts and never reports: stuck after its limit, not for ever", () => {
  assert.equal(firstStart(signs({ now: T0 + LIMITS.report - S })).stuck, false);
  const t = firstStart(signs({ now: T0 + LIMITS.report }));
  assert.equal(t.step, "start");
  assert.equal(t.stage, "TennoScope runs but doesn't answer");
  assert.match(t.reason ?? "", /no report from it in 45 s/);
  assert.match(logLine(t), /^first start: TennoScope runs but doesn't answer; no report/);
});

test("Full mode off: the step says it's what the inventory needs and offers the choice, it doesn't wait", () => {
  const x = firstStart(signs({ status: { supported: true, running: true, binary: "x", report: report({ game_running: true }) } }));
  assert.equal(x.step, "access");
  assert.equal(x.waitingFor, null);
  assert.match(x.todo, /only read in Full mode/);
  assert.deepEqual(x.actions, ["full", "overlay"]);
});

test("a TennoScope that refuses Full access: said with its reason, or at the limit", () => {
  const asked = { mode: "full" as const, at: T0 };
  const turnedDown = firstStart(signs({ asked, status: { supported: true, running: true, binary: "x", report: report({ last_error: { at: T0 + 2 * S, message: "access mode is already changing" } }) } }));
  assert.equal(turnedDown.stuck, true);
  assert.equal(turnedDown.reason, "access mode is already changing");
  const silent = firstStart(signs({ asked, now: T0 + LIMITS.access, status: { supported: true, running: true, binary: "x", report: report() } }));
  assert.equal(silent.stuck, true);
  assert.match(silent.reason ?? "", /still reports overlay 30 s after/);
  assert.ok(silent.actions.includes("retry") && silent.actions.includes("overlay"));
});

const full = (over: Partial<ReportSigns> & { reader?: [string, string] } = {}) => ({ supported: true, running: true, binary: "x", report: report({ setup: { access_mode: "full" }, ...over }) });

test("the game step tells not running, waiting for sign-in and signed in apart, from every sign", () => {
  assert.equal(firstStart(signs({ status: full() })).stage, "Warframe isn't running");
  // Running, at the login screen.
  const login = signs({ status: full({ game_running: true, reader: ["degraded", "inventory authorization was not found"] }), gameSince: T0 });
  assert.equal(firstStart(login).stage, "Warframe is running, waiting for you to sign in");
  assert.equal(gameLine(login).value, "At sign-in");
  // Signed in, by the game's log alone (a line written before MyOrbiter watched counts: ee_log.rs).
  const byLog = signs({ status: full({ game_running: true, reader: ["ready", "Warframe process connected"] }), gameSince: T0, log: { found: true, signedIn: true } });
  assert.equal(firstStart(byLog).step, "inventory");
  assert.equal(gameLine(byLog).value, "Signed in · Full mode");
  // By TennoScope's read alone (a log in a form MyOrbiter doesn't know, or no log found).
  const byRead = signs({ status: full({ game_running: true, mastery_rank: 22, reader: ["ready", "Inventory synchronized from warframe-memory"] }), log: { found: false, signedIn: false } });
  assert.equal(firstStart(byRead).step, "inventory");
  // The game closed since: TennoScope's view wins over an old line in the log.
  const closed = signs({ status: full({ game_running: false }), log: { found: true, signedIn: true } });
  assert.equal(firstStart(closed).stage, "Warframe isn't running");
  // Waiting for the player has a limit too.
  assert.equal(firstStart({ ...login, now: T0 + LIMITS.signIn }).stuck, true);
  assert.equal(firstStart(signs({ status: full(), now: T0 + LIMITS.signIn })).stuck, true);
});

test("signed in, and TennoScope never reads: stuck at the limit with what it said", () => {
  const s = signs({ status: full({ game_running: true, reader: ["ready", "Warframe process connected"] }), gameSince: T0, signedInSince: T0, log: { found: true, signedIn: true } });
  assert.equal(firstStart(s).stage, "Signed in: reading your inventory");
  const t = firstStart({ ...s, now: T0 + LIMITS.read });
  assert.equal(t.stuck, true);
  assert.equal(t.reason, "TennoScope hasn't read it, and doesn't say why");
  assert.deepEqual(t.actions, ["retry"]);
  // A failed read says so at once, with TennoScope's words.
  const failed = firstStart({ ...s, status: full({ game_running: true, reader: ["failed", "inventory request failed"] }) });
  assert.equal(failed.stuck, true);
  assert.equal(failed.reason, "TennoScope: inventory request failed");
  // The item data missing.
  const noCatalog = firstStart({ ...s, now: T0 + LIMITS.read, status: { ...full({ game_running: true }), report: { ...report({ game_running: true, setup: { access_mode: "full" } }), health: { game_reader: { state: "ready", message: "Warframe process connected" }, catalog: { state: "failed", message: "No valid WFCD catalog is available" } } } } });
  assert.match(noCatalog.reason ?? "", /no item data/);
});

test("the system refusing the read: said plainly, with what to do", () => {
  const s = signs({ ptraceScope: 1, status: full({ game_running: true, mastery_rank: null, reader: ["failed", "permission denied while reading Warframe process 12; check Yama ptrace settings"] }), log: { found: true, signedIn: true }, gameSince: T0 });
  const x = firstStart(s);
  assert.equal(x.stage, "Signed in, but the system won't let TennoScope read the game");
  assert.equal(x.stuck, true);
  assert.match(x.todo, /ptrace_scope=0/);
  assert.match(firstStart({ ...s, ptraceScope: 0 }).todo, /same user/);
});

test("read by TennoScope but not loaded by MyOrbiter: the reason is MyOrbiter's, shown and logged", () => {
  const err = "not found at ~/.local/share/io.github.deftera186.tennoscope/catalog/relic-generation.json: TennoScope hasn't written it yet";
  const s = signs({ status: full({ game_running: true, mastery_rank: 22, reader: ["ready", "Inventory synchronized from warframe-memory"] }), log: { found: true, signedIn: true }, gameSince: T0, signedInSince: T0, pickup: { error: err, entries: 0, observedAt: null } });
  // While MyOrbiter is still picking it up, it says so, not a failure.
  assert.equal(firstStart(s).stage, "Signed in, read by TennoScope: loading it");
  assert.equal(firstStart(s).stuck, false);
  const x = firstStart({ ...s, now: T0 + LIMITS.read });
  assert.equal(x.stage, "Signed in, read by TennoScope, but MyOrbiter couldn't load it");
  assert.equal(x.reason, err);
  assert.equal(x.stuck, true);
  assert.equal(inventoryLine(s).value, "Not loaded");
  assert.match(logLine(x), /relic-generation\.json/);
});

test("an inventory picked up ends the first start, whatever else is said", () => {
  const x = firstStart(signs({ status: null, pickup: { error: null, entries: 3183, observedAt: T0 } }));
  assert.equal(x.step, "done");
});

test("every step has a way on without TennoScope ever answering", () => {
  // The worst case at each step, an hour on: stuck, with a reason, and a way on besides Finish
  // later (always drawn): or, where the choice is the player's, the choice.
  const cases: Signs[] = [
    signs({ status: null }),
    signs({ status: { supported: true, running: false, binary: "x", report: null }, runningSince: null }),
    signs({ status: { supported: true, running: false, binary: null, report: null }, runningSince: null }),
    signs({}),
    signs({ status: full({ setup: { access_mode: null } }) }),
    signs({ status: { supported: true, running: true, binary: "x", report: report() }, asked: { mode: "full", at: T0 } }),
    signs({ status: full() }),
    signs({ status: full({ game_running: true }), gameSince: T0 }),
    // App.svelte notes when the player is first seen signed in, as the inventory step comes up.
    signs({ status: full({ game_running: true }), gameSince: T0, signedInSince: T0, log: { found: true, signedIn: true } }),
    signs({ status: full({ game_running: true, mastery_rank: 22 }), gameSince: T0, signedInSince: T0, log: { found: true, signedIn: true } }),
  ];
  for (const c of cases) {
    const x = firstStart({ ...c, now: T0 + 60 * 60_000 });
    const choice = x.step === "access" && !x.waitingFor;
    assert.ok(x.stuck || choice, `${x.stage}: still waiting after an hour`);
    assert.ok(choice || x.reason, `${x.stage}: stuck without a reason`);
    assert.ok(x.actions.length > 0 || x.step === "game", `${x.stage}: no way on but Finish later`);
    assert.ok(!/\/home\/[a-z]/.test(logLine(x)), "no home folder in the log line");
  }
});

test("Finish later and Esc are on every step, and leave the automatic actions off", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  assert.match(app, /data-field="setup\.later"/, "the Finish later button");
  assert.match(app, /function finishLater\(\)/);
  const body = app.slice(app.indexOf("function finishLater()"), app.indexOf("function finishLater()") + 1200);
  assert.match(body, /withoutInventory\(\)/);
  for (const k of ["auto", "autoTrades", "autoRep"]) assert.match(body, new RegExp(`settings\\.market\\.${k} = false`), k);
  // While it's open the sidebar waits: inert (out of the Tab order, not clickable) and dimmed.
  assert.match(app, /<aside class="rail" aria-label="MyOrbiter" inert=\{setupOpen\}/);
  // Esc leaves it.
  assert.match(app, /setupOpen && e\.key === "Escape"/);
});
