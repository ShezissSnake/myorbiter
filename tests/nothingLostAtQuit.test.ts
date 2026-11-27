// A Sold clicked on Orders, and a removal inside its Undo time, are carried out before MyOrbiter
// quits, its window reloads or an update restarts it (backend.ts › beforeLeaving, beforeUpdating,
// soldWait.svelte.ts, undo.svelte.ts); a Sold whose send isn't answered in time, or fails while
// MyOrbiter leaves, leaves a saved record, told at the next start in words that say no more than
// is known, and never sent again (core/soldOut.ts). The page's side is driven as Orders drives it:
// its SoldWaits, a record while the send is out, the sale logged as warframe.market answers, the
// settings saved by the effects.
import { effectRoot, flush } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeLeaving, beforeUpdating, defaultSettings, leaving, flushSettings, LEAVE_CAP, LEAVE_WAIT, loadSettings, quit, stayed, updater, whenStaying, type Settings, type UpdateCheck } from "../src/lib/backend";
import { NO_LONGER_LISTED, sentWhen, soldAnswered, soldFailure, soldOutNotice, soldOutOf, soldStayed, withSoldOut, type SoldOut } from "../src/lib/core/soldOut";
import { clockTime, waitWords } from "../src/lib/core/marketWait";
import { defaultUpdates } from "../src/lib/core/updates";

const { SoldWaits } = await import("../src/lib/soldWait.svelte");
const { UndoSlots } = await import("../src/lib/undo.svelte");
const { persistSettings } = await import("../src/lib/persist.svelte");
const { bugReport } = await import("../src/lib/bugReport.svelte");
const { Updates } = await import("../src/lib/updates.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const { proxy } = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Rust side's words for each kind of failure (src-tauri/src/market.rs, MarketError's Display). */
const REFUSED = "warframe.market rejected the request: 400 Example refusal";
const UNREACHABLE = "warframe.market is unreachable: Network Error: Example reset";
const UNREADABLE = "warframe.market answered with something MyOrbiter couldn't read: expected value at line 1";
const SERVER_ERROR = "warframe.market rejected the request: 504 Example gateway timeout";

/** Settings saved as App.svelte saves them, into a stand-in for the browser's storage. */
async function saved() {
  // A test that failed part-way may have left a leaving under way: the next starts once it's over,
  // so one test's leaving never carries another's clicks.
  for (let i = 0; leaving() && i < 300; i++) await later(10);
  assert.equal(leaving(), false, "no leaving left from an earlier test");
  const stored: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => (stored[k] = v) };
  const settings = proxy(defaultSettings()) as Settings;
  const stop = effectRoot(() => persistSettings(() => settings, () => true));
  flush();
  await flushSettings();
  const file = () => JSON.parse(stored["orbiter-settings"]) as Settings;
  return { settings, stop, file };
}

/** The stand-in's hook for a window that stays after all, one at a time (the latest test's). */
let unstay: (() => void) | null = null;
/**
 * Orders' Sold, step for step: the record goes in as the send goes out and comes away as it is
 * answered, the sale logged with it (Orders.svelte › soldOut, sendSale); a failure kept is let go
 * when the window stays after all (Orders.svelte › whenStaying). `close` stands in for
 * warframe.market: true when it took the sale, or the failure's words.
 */
function orders(settings: Settings, close: (id: string, n: number) => Promise<true | string>, ms?: number) {
  const sent: [string, number][] = [];
  let k = 0;
  unstay?.();
  unstay = whenStaying(() => (settings.market.soldOut = soldStayed(settings.market.soldOut ?? [])));
  const waits = new SoldWaits(async (id, n) => {
    const key = `${id}|${++k}`;
    settings.market.soldOut = withSoldOut(settings.market.soldOut ?? [], { key, id, item: "Example Prime Set", rank: null, quantity: n, platinum: 45, at: Date.now() });
    sent.push([id, n]);
    const p = close(id, n).then((a) => {
      const ok = a === true;
      settings.market.soldOut = soldAnswered(settings.market.soldOut ?? [], key, { ok, why: ok ? "" : a, leaving: leaving() });
      return ok;
    });
    waits.track(p);
    if (await p) settings.market.sales = [{ at: Date.now(), item: "Example Prime Set", rank: null, quantity: n, platinum: 45 }, ...settings.market.sales];
  }, ms);
  return { waits, sent };
}
const answers = (ms: number) => () => later(ms).then(() => true as const);
const fails = (why: string, ms = 20) => () => later(ms).then(() => why);
/** A warframe.market that answers only when the test is over (`end`: unreachable), so no send stays out into the next test. */
function unanswered() {
  const ends: ((v: string) => void)[] = [];
  return {
    close: () => new Promise<true | string>((r) => void ends.push(r)),
    end: async () => {
      for (const r of ends) r(UNREACHABLE);
      await later(5);
    },
  };
}
/** A save that hangs until `release`. */
function hangingSave() {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  return { save: () => held, release };
}

// ---- carried out before leaving

test("a Sold clicked and then quit inside its wait is sent, and its sale saved, before the app leaves", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, answers(20));
  waits.hold("listing-1", 2, 3);
  try {
    await quit();
    assert.deepEqual(sent, [["listing-1", 2]], "sent at quit, not 4 s later");
    assert.deepEqual(waits.pending, {}, "no longer waiting");
    const f = file();
    assert.equal(f.market.sales.length, 1, "the sale is in the saved settings");
    assert.equal(f.market.sales[0].quantity, 2);
    assert.deepEqual(f.market.soldOut, [], "answered: no record left");
  } finally {
    waits.flush();
    stop();
  }
});

test("Reload the window sends a waiting Sold, and saves its sale, before the page reloads", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, answers(20));
  let reloadedWith: Settings | null = null;
  const realLocation = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { reload: () => (reloadedWith = file()) };
  waits.hold("listing-1", 1, 1);
  try {
    await bugReport.reload();
    assert.deepEqual(sent, [["listing-1", 1]]);
    assert.ok(reloadedWith, "the page reloaded");
    assert.equal((reloadedWith as Settings).market.sales.length, 1, "with the sale saved before it");
  } finally {
    (globalThis as { location?: unknown }).location = realLocation;
    waits.flush();
    stop();
  }
});

test("a send that isn't answered doesn't hold the quit: the app leaves, and the next start finds the record", async () => {
  const { settings, stop, file } = await saved();
  // warframe.market slow or unreachable: no answer while the app leaves.
  const late = unanswered();
  const { waits, sent } = orders(settings, late.close);
  waits.hold("listing-1", 2, 2);
  try {
    const t0 = Date.now();
    await beforeLeaving(50);
    assert.ok(Date.now() - t0 < 1000, "it waited only its moment");
    assert.deepEqual(sent, [["listing-1", 2]], "sent once");
    const f = file();
    assert.equal(f.market.sales.length, 0, "no sale logged");
    assert.equal(f.market.soldOut?.length, 1, "the record is saved");
    // The next start: the record is read back as it was saved, and no send is made by itself.
    const next = await loadSettings();
    const [r] = next.market.soldOut ?? [];
    assert.equal(r.id, "listing-1");
    assert.equal(r.quantity, 2);
    assert.equal(r.answer, undefined, "no answer known");
    const words = soldOutNotice(r);
    assert.match(words.title, /Example Prime Set: maybe not marked sold/);
    assert.match(words.body, /before warframe\.market answered\. It may or may not have gone through/);
    assert.match(words.body, /Nothing was sent again/);
    assert.doesNotMatch(words.body, /refused/);
    assert.deepEqual(sent, [["listing-1", 2]], "nothing more sent");
  } finally {
    await late.end();
    stop();
  }
});

test("the record is saved before leaving waits for the answer: an app gone during the wait still left it", async () => {
  const { settings, stop, file } = await saved();
  const late = unanswered();
  const { waits } = orders(settings, late.close);
  waits.hold("listing-1", 1, 1);
  try {
    const going = beforeLeaving(400);
    // The window's X ends the app 2 s on whatever the page does: what is on disk during the wait is what the next start finds.
    await later(150);
    assert.equal(leaving(), true, "still waiting for the answer");
    assert.equal(file().market.soldOut?.length, 1, "the record is already saved");
    await going;
  } finally {
    await late.end();
    stop();
  }
});

test("quit, with no wait given, ends within its cap when warframe.market doesn't answer", async () => {
  const { settings, stop } = await saved();
  const late = unanswered();
  const { waits } = orders(settings, late.close);
  waits.hold("listing-1", 1, 1);
  try {
    const t0 = Date.now();
    await quit();
    const took = Date.now() - t0;
    assert.ok(took >= LEAVE_WAIT - 50 && took < LEAVE_WAIT + 700, `took ${took} ms`);
  } finally {
    await late.end();
    stop();
  }
});

test("an Undo clicked before quitting or reloading still sends nothing", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, answers(5));
  const realLocation = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { reload: () => {} };
  try {
    waits.hold("listing-1", 1, 1);
    waits.undo("listing-1");
    await quit();
    waits.hold("listing-2", 1, 1);
    waits.undo("listing-2");
    await bugReport.reload();
    assert.deepEqual(sent, [], "nothing sent");
    assert.equal(file().market.sales.length, 0);
    assert.deepEqual(file().market.soldOut, []);
  } finally {
    (globalThis as { location?: unknown }).location = realLocation;
    stop();
  }
});

test("Reload the window makes every waiting Undo removal first, as quitting does, and saves it", async () => {
  const { settings, stop, file } = await saved();
  settings.favourites = ["/Lotus/Example/Kept", "/Lotus/Example/Removed"];
  flush();
  await flushSettings();
  let reloadedWith: Settings | null = null;
  const realLocation = (globalThis as { location?: unknown }).location;
  (globalThis as { location?: unknown }).location = { reload: () => (reloadedWith = file()) };
  const u = new UndoSlots();
  u.hold("/Lotus/Example/Removed", () => (settings.favourites = settings.favourites.filter((x) => x !== "/Lotus/Example/Removed")));
  try {
    await bugReport.reload();
    assert.ok(reloadedWith, "the page reloaded");
    assert.deepEqual((reloadedWith as Settings).favourites, ["/Lotus/Example/Kept"], "saved without it before the reload");
    assert.equal(u.has("/Lotus/Example/Removed"), false, "no longer waiting");
  } finally {
    (globalThis as { location?: unknown }).location = realLocation;
    u.flush();
    stop();
  }
});

// ---- rule 2: clicked while MyOrbiter is already leaving

test("a Sold clicked while MyOrbiter is already leaving is sent at once, and its sale saved before it goes", async () => {
  const { settings, stop, file } = await saved();
  // The first Sold is answered 120 ms into leaving; the second, clicked at 60 ms, 150 ms after its
  // click: only another round of leaving waits for it.
  const { waits, sent } = orders(settings, (id) => (id === "listing-1" ? answers(120)() : answers(150)()));
  waits.hold("listing-1", 1, 1);
  try {
    const going = beforeLeaving(400);
    await later(60);
    assert.equal(leaving(), true);
    waits.hold("listing-2", 1, 1);
    assert.deepEqual(sent, [["listing-1", 1], ["listing-2", 1]], "sent at the click, not 4 s later");
    await going;
    const f = file();
    assert.equal(f.market.sales.length, 2, "both sales saved before the app went");
    assert.deepEqual(f.market.soldOut, [], "both answered: nothing left to tell");
  } finally {
    waits.flush();
    stop();
  }
});

test("a Sold clicked while leaving whose answer doesn't come in time is recorded and told like the others", async () => {
  const { settings, stop, file } = await saved();
  const late = unanswered();
  const { waits, sent } = orders(settings, late.close);
  try {
    // Nothing waiting at the quit: leaving is one save; the click comes during it.
    const going = beforeLeaving(100);
    assert.equal(leaving(), true);
    waits.hold("listing-3", 2, 2);
    await going;
    assert.deepEqual(sent, [["listing-3", 2]], "sent at the click");
    assert.deepEqual(
      soldOutOf(file().market.soldOut).map((r) => r.id),
      ["listing-3"],
      "its record saved for the next start",
    );
  } finally {
    await late.end();
    stop();
  }
});

test("an Undo removal clicked while MyOrbiter is already leaving is made at once and saved", async () => {
  const { settings, stop, file } = await saved();
  settings.favourites = ["/Lotus/Example/Kept", "/Lotus/Example/Late"];
  flush();
  await flushSettings();
  const late = unanswered();
  const { waits } = orders(settings, late.close);
  waits.hold("listing-1", 1, 1);
  const u = new UndoSlots();
  try {
    const going = beforeLeaving(300);
    await later(60);
    u.hold("/Lotus/Example/Late", () => (settings.favourites = settings.favourites.filter((x) => x !== "/Lotus/Example/Late")));
    assert.equal(u.has("/Lotus/Example/Late"), false, "made, not waiting five seconds");
    await going;
    assert.deepEqual(file().favourites, ["/Lotus/Example/Kept"], "saved without it before the app went");
  } finally {
    await late.end();
    u.flush();
    stop();
  }
});

test("a Sold or a removal clicked while the app stays open still waits for its Undo", async () => {
  const { settings, stop } = await saved();
  const { waits, sent } = orders(settings, answers(5), 40);
  const u = new UndoSlots(40);
  let removed = false;
  try {
    waits.hold("listing-1", 1, 1);
    u.hold("k", () => (removed = true));
    await later(10);
    assert.deepEqual(sent, []);
    assert.equal(removed, false);
    waits.undo("listing-1");
    u.undo("k");
    await later(60);
    assert.deepEqual(sent, []);
    assert.equal(removed, false);
  } finally {
    stop();
  }
});

// ---- rule 4: a second quit joins the first, held no longer than its cap

test("a second quit while one runs joins it: both end together, the first's wait not cut short", async () => {
  const { settings, stop } = await saved();
  const late = unanswered();
  const { waits, sent } = orders(settings, late.close);
  waits.hold("listing-1", 1, 1);
  try {
    const t0 = Date.now();
    let firstAt = 0;
    let secondAt = 0;
    const first = beforeLeaving(300).then(() => (firstAt = Date.now() - t0));
    await later(100);
    const second = beforeLeaving().then(() => (secondAt = Date.now() - t0));
    await Promise.all([first, second]);
    assert.ok(firstAt >= 280, `the first waited its time (${firstAt} ms)`);
    assert.ok(Math.abs(secondAt - firstAt) < 60, `the second ended with the first (${firstAt} and ${secondAt} ms)`);
    assert.deepEqual(sent, [["listing-1", 1]], "sent once");
  } finally {
    await late.end();
    stop();
  }
});

test("a later Ctrl+Q isn't held by a save that hangs any longer than the first one's cap", async () => {
  await saved();
  const hang = hangingSave();
  const t0 = Date.now();
  const first = beforeLeaving(50, hang.save);
  try {
    await later(20);
    const second = await Promise.race([beforeLeaving().then(() => "went"), later(50 + (LEAVE_CAP - LEAVE_WAIT) + 600).then(() => "held")]);
    assert.equal(second, "went", "the second quit goes on");
    const took = Date.now() - t0;
    assert.ok(took < 50 + (LEAVE_CAP - LEAVE_WAIT) + 200, `within the first's cap (${took} ms)`);
  } finally {
    hang.release();
    await first;
  }
});

test("nothing is sent twice: the wait running out after a quit, or a second quit while one runs", async () => {
  const { settings, stop } = await saved();
  const { waits, sent } = orders(settings, answers(30), 40);
  waits.hold("listing-1", 1, 2);
  try {
    // Ctrl+Q, then the window's X while the first is waiting for the answer.
    await Promise.all([quit(), later(5).then(() => quit())]);
    await later(80);
    assert.deepEqual(sent, [["listing-1", 1]], "one send");
    // The page going away afterwards finds nothing waiting.
    waits.flush();
    assert.deepEqual(sent, [["listing-1", 1]]);
  } finally {
    stop();
  }
});

test("a Sold sent by its wait while the app stays open is sent once, after the wait, and leaves no hook behind", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, answers(5), 30);
  waits.hold("listing-1", 1, 1);
  try {
    await later(10);
    assert.deepEqual(sent, [], "still waiting");
    await later(60);
    assert.deepEqual(sent, [["listing-1", 1]]);
    flush();
    await flushSettings();
    assert.equal(file().market.sales.length, 1);
    // Quitting now has nothing to wait for: as quick as with nothing ever clicked.
    const t0 = Date.now();
    await quit();
    assert.ok(Date.now() - t0 < LEAVE_WAIT / 2, "no wait");
    assert.deepEqual(sent, [["listing-1", 1]]);
  } finally {
    stop();
  }
});

test("quitting with nothing waiting doesn't wait", async () => {
  await saved();
  const t0 = Date.now();
  await quit();
  assert.ok(Date.now() - t0 < LEAVE_WAIT / 2);
});

// ---- rule 3: Update and restart

test("the step before an update's restart makes what waits, and is never held past the cap nor stopped by failing", async () => {
  const { settings, stop } = await saved();
  const { waits, sent } = orders(settings, answers(10));
  waits.hold("listing-1", 1, 1);
  try {
    await beforeUpdating();
    assert.deepEqual(sent, [["listing-1", 1]], "the waiting Sold is sent before the restart");
  } finally {
    stop();
  }
  // A save that hangs: the restart goes ahead at the cap.
  const hang = hangingSave();
  const t0 = Date.now();
  try {
    const went = await Promise.race([beforeUpdating(hang.save).then(() => "went"), later(LEAVE_CAP + 800).then(() => "held")]);
    assert.equal(went, "went", "the restart goes ahead");
    const took = Date.now() - t0;
    assert.ok(took < LEAVE_CAP + 300, `held ${took} ms`);
  } finally {
    hang.release();
    await later(5);
  }
  // A save that fails: the step ends, and the restart goes ahead.
  await assert.doesNotReject(beforeUpdating(() => Promise.reject(new Error("Example disk full"))));
});

/**
 * Update and restart, clicked (`click`) with the updater faked: `install` and `restart` stand in
 * for downloading and installing, and for the restart. Everything else is the real Updates.
 */
async function updateAndRestart(install: () => Promise<void>, restart: () => Promise<void>, click: (u: InstanceType<typeof Updates>) => Promise<unknown>) {
  const real = { ...updater };
  const newer: UpdateCheck = { state: "newer", version: "0.2.150", notes: null, date: null };
  updater.info = async () => ({ version: "0.2.141", install: { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" } });
  updater.check = async () => newer;
  updater.install = install;
  updater.restart = restart;
  const u = new Updates();
  const us = { ...defaultUpdates(), channel: "beta" as const };
  try {
    u.start(() => us);
    // The build's own version read, as at a start; then Check now.
    await later(20);
    await u.checkNow();
    assert.equal(u.offer?.version, "0.2.150");
    return await click(u);
  } finally {
    u.stop();
    Object.assign(updater, real);
  }
}

test("Update and restart makes what waits at the click before the install begins, and one clicked during the download before the restart", async () => {
  const { stop } = await saved();
  const order: string[] = [];
  const waits = new SoldWaits(async (id) => {
    order.push(`sent ${id}`);
  });
  try {
    await updateAndRestart(
      async () => {
        order.push("installing");
        // Clicked during the download: the window stays open meanwhile, so it waits for its Undo.
        assert.equal(leaving(), false, "the window stays open during the download");
        waits.hold("listing-2", 1, 1);
        await later(20);
        order.push("installed");
      },
      async () => void order.push("restart"),
      (u) => {
        waits.hold("listing-1", 1, 1);
        return u.install();
      },
    );
    // On Windows the installer closes MyOrbiter during "installing": listing-1 was made before it began.
    assert.deepEqual(order, ["sent listing-1", "installing", "installed", "sent listing-2", "restart"]);
  } finally {
    waits.flush();
    stop();
  }
});

test("the step before the install never holds the install past the cap, even for a Sold never answered", async () => {
  const { settings, stop } = await saved();
  const market = unanswered();
  const { waits, sent } = orders(settings, market.close);
  let began = 0;
  const t0 = Date.now();
  try {
    await updateAndRestart(
      async () => void (began = Date.now()),
      async () => {},
      (u) => {
        waits.hold("listing-1", 1, 1);
        return u.install();
      },
    );
    assert.deepEqual(sent, [["listing-1", 1]], "sent before the install");
    assert.ok(began > 0 && began - t0 < LEAVE_CAP + 300, `the install began ${began - t0} ms after the click`);
  } finally {
    await market.end();
    stop();
  }
});

test("a Sold failing in the step before the install is said on its row, not kept for the next start: the window stays", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, fails(REFUSED, 5));
  let kept: unknown = null;
  try {
    await updateAndRestart(
      async () => {
        // During the download: the failure's row shows it; nothing is kept for the next start.
        flush();
        await flushSettings();
        kept = file().market.soldOut;
      },
      async () => {},
      (u) => {
        waits.hold("listing-1", 1, 1);
        return u.install();
      },
    );
    assert.deepEqual(sent, [["listing-1", 1]]);
    assert.deepEqual(kept, []);
  } finally {
    stop();
  }
});

test("a restart that fails: a Sold failing in the restart's step, shown on its row, isn't told again at the next start", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, fails(REFUSED, 5));
  let atRestart: unknown = null;
  try {
    const done = await updateAndRestart(
      async () => {
        // Clicked during the download: made by the restart's step, where it fails.
        waits.hold("listing-1", 1, 1);
      },
      async () => {
        atRestart = file().market.soldOut[0]?.answer;
        throw new Error("Example restart failure");
      },
      (u) => u.install(),
    );
    assert.equal(atRestart, "refused", "kept while the window was going");
    assert.equal(done, false, "the update says it failed");
    assert.deepEqual(sent, [["listing-1", 1]]);
    assert.equal(leaving(), false, "the window stays: nothing counts as leaving");
    flush();
    await flushSettings();
    assert.deepEqual(file().market.soldOut, [], "the row shows it: not told again");
  } finally {
    waits.flush();
    stop();
  }
});

test("a failure kept for the next start is let go when the window stays; a send still out keeps its record", () => {
  const out: SoldOut = { key: "a|1", id: "a", item: "Example Prime Set", rank: null, quantity: 1, platinum: 20, at: 1 };
  const failed: SoldOut = { ...out, key: "b|2", id: "b", answer: "refused", why: REFUSED };
  assert.deepEqual(soldStayed([out, failed]), [out]);
  // stayed() runs the hooks, and nothing counts as leaving afterwards.
  let ran = 0;
  const off = whenStaying(() => ran++);
  stayed();
  off();
  stayed();
  assert.equal(ran, 1);
  assert.equal(leaving(), false);
});

// ---- rule 1: the words at the next start say no more than is known

test("what a failure's words say is known: refused only when warframe.market answered so", () => {
  assert.equal(soldFailure(REFUSED), "refused");
  assert.equal(soldFailure("Error: warframe.market rejected the request: 403 Example"), "refused");
  assert.equal(soldFailure("warframe.market refused the sign-in; sign in again"), "refused");
  assert.equal(soldFailure("warframe.market rejected the request: 504 Example gateway timeout"), "unclear", "a server or gateway error: it may have gone through");
  assert.equal(soldFailure("warframe.market rejected the request: 500 Example"), "unclear");
  assert.equal(soldFailure(UNREACHABLE), "unclear", "a network error: it may have gone through");
  assert.equal(soldFailure(UNREADABLE), "unclear", "an answer that couldn't be read");
  assert.equal(soldFailure("warframe.market answered too late"), "unclear", "words not known here");
  assert.equal(soldFailure(NO_LONGER_LISTED), "gone");
  assert.equal(soldFailure("warframe.market asked us to wait until 1795744859843"), "unsent");
  assert.equal(soldFailure(waitWords("warframe.market asked us to wait until 1795744859843")), "unsent", "the form the page gets");
  assert.equal(soldFailure("Not signed in to warframe.market"), "unsent");
  assert.equal(soldFailure("couldn't keep the warframe.market sign-in: Example"), "unsent");
  assert.equal(soldFailure("warframe.market rejected the request: bad order id"), "unsent", "MyOrbiter's own check, before sending");
});

async function failedWhileLeaving(why: string): Promise<SoldOut> {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, fails(why));
  waits.hold("listing-1", 1, 1);
  try {
    await quit();
    assert.deepEqual(sent, [["listing-1", 1]], "sent once, not again");
    const f = file();
    assert.equal(f.market.sales.length, 0, "no sale logged");
    const [r] = soldOutOf(f.market.soldOut);
    assert.ok(r, "kept for the next start");
    return r;
  } finally {
    stop();
  }
}

test("refused by warframe.market while the app leaves: told as not marked sold, refused, with why", async () => {
  const r = await failedWhileLeaving(REFUSED);
  assert.equal(r.answer, "refused");
  const words = soldOutNotice(r);
  assert.equal(words.title, "Example Prime Set: not marked sold");
  assert.match(words.body, /^warframe\.market refused to mark 1 sold/);
  assert.match(words.body, /Example refusal\. No sale was logged\. Nothing was sent again/);
});

test("a network error or an unreadable answer while the app leaves is told as maybe, never as refused", async () => {
  for (const why of [UNREACHABLE, UNREADABLE]) {
    const r = await failedWhileLeaving(why);
    assert.equal(r.answer, "unclear");
    const words = soldOutNotice(r);
    assert.equal(words.title, "Example Prime Set: maybe not marked sold");
    assert.match(words.body, /It may or may not have gone through/);
    assert.doesNotMatch(words.body, /refused|not marked sold/);
  }
  // An answer that came but couldn't be read is never said not to have come.
  const unread = soldOutNotice({ ...(await failedWhileLeaving(UNREADABLE)) });
  assert.match(unread.body, /warframe\.market answered, but MyOrbiter couldn't read the answer/);
  assert.doesNotMatch(unread.body, /didn't come/);
});

test("a server or gateway error while the app leaves is told as maybe, in no words of a refusal, and as an answer that came", async () => {
  const r = await failedWhileLeaving(SERVER_ERROR);
  assert.equal(r.answer, "unclear");
  const words = soldOutNotice(r);
  assert.equal(words.title, "Example Prime Set: maybe not marked sold");
  assert.match(words.body, /warframe\.market answered with a server error \(504\), which doesn't say whether it was made\. It may or may not have gone through/);
  assert.doesNotMatch(words.line, /refus|reject|didn't come/);
  assert.doesNotMatch(words.body, /not marked sold/);
});

test("a listing already gone when the Sold went: told that nothing was sent, not blamed on warframe.market", async () => {
  const r = await failedWhileLeaving(NO_LONGER_LISTED);
  assert.equal(r.answer, "gone");
  const words = soldOutNotice(r);
  assert.equal(words.title, "Example Prime Set: nothing sent");
  assert.match(words.body, /wasn't sent: the listing was already gone from your listings/);
  assert.doesNotMatch(words.line, /refused|warframe\.market answered/);
});

test("not sent (a wait warframe.market asked for): not marked sold, without blaming a refusal, the wait as the clock says it", async () => {
  // The form the page gets: backend.ts's invoke turns the Rust side's milliseconds into the
  // clock's time (core/marketWait.ts › waitWords) before Orders sees the failure.
  const until = Date.now() + 10 * 60_000;
  const why = waitWords(`warframe.market asked us to wait until ${until}`);
  assert.equal(why, `warframe.market asked us to wait until ${clockTime(until)}`);
  const r = await failedWhileLeaving(why);
  assert.equal(r.answer, "unsent");
  const words = soldOutNotice(r);
  assert.equal(words.title, "Example Prime Set: not marked sold");
  assert.ok(words.body.includes(`didn't go through: warframe.market asked us to wait until ${clockTime(until)}.`), words.body);
  assert.doesNotMatch(words.body, /refused|\d{12}/);
});

test("a refusal while the app stays open leaves no record: its row says so, with Try again", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, fails(REFUSED, 5), 10);
  waits.hold("listing-1", 1, 1);
  try {
    await later(60);
    assert.deepEqual(sent, [["listing-1", 1]]);
    flush();
    await flushSettings();
    assert.deepEqual(file().market.soldOut, []);
  } finally {
    stop();
  }
});

test("the notice says when the Sold was sent, and the log line says the same as the notice", () => {
  const now = Date.UTC(2026, 10, 27, 15, 0);
  const r: SoldOut = { key: "a|1", id: "a", item: "Example Prime Set", rank: null, quantity: 1, platinum: 20, at: now - 30 * 60_000 };
  const today = soldOutNotice(r, now);
  assert.ok(today.body.includes(`sent ${sentWhen(r.at, now)}`), today.body);
  assert.match(sentWhen(r.at, now), /^at /);
  // Told days later (an older build kept the record meanwhile): the day is said too.
  const old = { ...r, at: now - 3 * 86_400_000 };
  assert.match(sentWhen(old.at, now), /^on .+ at /);
  assert.ok(soldOutNotice(old, now).body.includes(sentWhen(old.at, now)));
  for (const x of [r, { ...r, answer: "refused" as const, why: REFUSED }, { ...r, answer: "gone" as const, why: NO_LONGER_LISTED }, { ...r, answer: "unsent" as const, why: "Not signed in to warframe.market" }, { ...r, answer: "unclear" as const, why: UNREACHABLE }]) {
    const w = soldOutNotice(x, now);
    assert.equal(w.line, `${w.title}: ${w.body}`);
    assert.ok(w.body.includes(sentWhen(x.at, now)), `${x.answer}: says when`);
  }
});

test("a saved record is read back only when whole", () => {
  const r = { key: "a|1", id: "a", item: "Example Prime Set", rank: 3, quantity: 1, platinum: 20, at: 1 };
  assert.deepEqual(soldOutOf([r]), [r]);
  assert.deepEqual(soldOutOf("nonsense"), []);
  assert.deepEqual(soldOutOf([{ ...r, quantity: 0 }, { ...r, item: "" }, { ...r, at: "x" }, null, 3]), []);
  assert.deepEqual(soldOutOf([{ ...r, rank: "x" }]), [{ ...r, rank: null }]);
  assert.equal(soldOutNotice(r).title, "Example Prime Set R3: maybe not marked sold");
  assert.match(soldOutNotice(r).body, /No sale was logged/);
  // "That sale" for a trade: the trade logged the sale, so the notice doesn't say none was.
  const t = { ...r, trade: true as const, answer: "refused" as const, why: REFUSED };
  assert.deepEqual(soldOutOf([t, { ...r, key: "b", trade: "yes", why: 3 }]), [t, { ...r, key: "b" }]);
  assert.match(soldOutNotice(t).body, /The trade from the game logged its sale already/);
  assert.doesNotMatch(soldOutNotice(t).body, /No sale was logged/);
  // A reason with no known kind, or a kind not known, says no more than "maybe".
  assert.deepEqual(soldOutOf([{ ...r, why: "Example" }]), [{ ...r, answer: "unclear", why: "Example" }]);
  assert.deepEqual(soldOutOf([{ ...r, answer: "sold" }]), [r]);
});
