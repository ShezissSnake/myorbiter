// A Sold clicked on Orders, and a removal inside its Undo time, are carried out before MyOrbiter
// quits or its window reloads (backend.ts › beforeLeaving, soldWait.svelte.ts); a Sold whose send
// isn't answered in time leaves a saved record, told at the next start and never sent again
// (core/soldOut.ts). The page's side is driven as Orders drives it: its SoldWaits, a record while
// the send is out, the sale logged as warframe.market answers, the settings saved by the effects.
import { effectRoot, flush } from "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { beforeLeaving, defaultSettings, leaving, flushSettings, LEAVE_WAIT, loadSettings, quit, type Settings } from "../src/lib/backend";
import { soldAnswered, soldOutNotice, soldOutOf, withSoldOut } from "../src/lib/core/soldOut";

const { SoldWaits } = await import("../src/lib/soldWait.svelte");
const { UndoSlots } = await import("../src/lib/undo.svelte");
const { persistSettings } = await import("../src/lib/persist.svelte");
const { bugReport } = await import("../src/lib/bugReport.svelte");
// @ts-expect-error: Svelte's client internals have no type declarations
const { proxy } = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };
const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Settings saved as App.svelte saves them, into a stand-in for the browser's storage. */
async function saved() {
  const stored: Record<string, string> = {};
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => (stored[k] = v) };
  const settings = proxy(defaultSettings()) as Settings;
  const stop = effectRoot(() => persistSettings(() => settings, () => true));
  flush();
  await flushSettings();
  const file = () => JSON.parse(stored["orbiter-settings"]) as Settings;
  return { settings, stop, file };
}

/**
 * Orders' Sold, step for step: the record goes in as the send goes out and comes away as it is
 * answered, the sale logged with it (Orders.svelte › soldOut, sendSale). `close` stands in for
 * warframe.market: true when it took the sale.
 */
function orders(settings: Settings, close: (id: string, n: number) => Promise<boolean>, ms?: number) {
  const sent: [string, number][] = [];
  let k = 0;
  const waits = new SoldWaits(async (id, n) => {
    const key = `${id}|${++k}`;
    settings.market.soldOut = withSoldOut(settings.market.soldOut ?? [], { key, id, item: "Example Prime Set", rank: null, quantity: n, platinum: 45, at: Date.now() });
    sent.push([id, n]);
    const p = close(id, n).then((ok) => ((settings.market.soldOut = soldAnswered(settings.market.soldOut ?? [], key, { ok, why: ok ? "" : "Example refusal", leaving: leaving() })), ok));
    waits.track(p);
    if (await p) settings.market.sales = [{ at: Date.now(), item: "Example Prime Set", rank: null, quantity: n, platinum: 45 }, ...settings.market.sales];
  }, ms);
  return { waits, sent };
}
const answers = (ms: number) => () => later(ms).then(() => true);
/** A warframe.market that answers only when the test is over (`end`: a refusal), so no send stays out into the next test. */
function unanswered() {
  const ends: ((v: boolean) => void)[] = [];
  return {
    close: () => new Promise<boolean>((r) => void ends.push(r)),
    end: async () => {
      for (const r of ends) r(false);
      await later(5);
    },
  };
}

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
    const words = soldOutNotice(r);
    assert.match(words.title, /Example Prime Set: maybe not marked sold/);
    assert.match(words.body, /may or may not have gone through/);
    assert.match(words.body, /Nothing was sent again/);
    assert.deepEqual(sent, [["listing-1", 2]], "nothing more sent");
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

test("a Sold warframe.market refuses while the app leaves is kept with its reason, and told as not marked sold", async () => {
  const { settings, stop, file } = await saved();
  // Offline, a sign-in expired, a server error: a quick refusal, inside the wait.
  const { waits, sent } = orders(settings, () => later(20).then(() => false));
  waits.hold("listing-1", 1, 1);
  try {
    await quit();
    assert.deepEqual(sent, [["listing-1", 1]], "sent once, not again");
    const f = file();
    assert.equal(f.market.sales.length, 0, "no sale logged");
    const [r] = soldOutOf(f.market.soldOut);
    assert.equal(r?.why, "Example refusal", "kept, with why");
    const words = soldOutNotice(r);
    assert.equal(words.title, "Example Prime Set: not marked sold");
    assert.match(words.body, /Example refusal\. No sale was logged\. Nothing was sent again/);
  } finally {
    stop();
  }
});

test("a refusal while the app stays open leaves no record: its row says so, with Try again", async () => {
  const { settings, stop, file } = await saved();
  const { waits, sent } = orders(settings, () => later(5).then(() => false), 10);
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

test("a saved record is read back only when whole", () => {
  const r = { key: "a|1", id: "a", item: "Example Prime Set", rank: 3, quantity: 1, platinum: 20, at: 1 };
  assert.deepEqual(soldOutOf([r]), [r]);
  assert.deepEqual(soldOutOf("nonsense"), []);
  assert.deepEqual(soldOutOf([{ ...r, quantity: 0 }, { ...r, item: "" }, { ...r, at: "x" }, null, 3]), []);
  assert.deepEqual(soldOutOf([{ ...r, rank: "x" }]), [{ ...r, rank: null }]);
  assert.equal(soldOutNotice(r).title, "Example Prime Set R3: maybe not marked sold");
  assert.match(soldOutNotice(r).body, /No sale was logged/);
  // "That sale" for a trade: the trade logged the sale, so the notice doesn't say none was.
  const t = { ...r, trade: true as const, why: "Example refusal" };
  assert.deepEqual(soldOutOf([t, { ...r, key: "b", trade: "yes", why: 3 }]), [t, { ...r, key: "b" }]);
  assert.match(soldOutNotice(t).body, /The trade from the game logged its sale already/);
  assert.doesNotMatch(soldOutNotice(t).body, /No sale was logged/);
});
