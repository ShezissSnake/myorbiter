// A +rep given from the strip at the top of the page, or from a sale's notification, is recorded
// for the trade it was clicked for, whatever changes on the page while warframe.market answers:
// the strip's time runs out, a newer trade lands (its partner known on warframe.market or not), the
// notification's day runs out, the player signs out, or automatic +rep is turned on. Never for
// another trade, and never lost; and nothing more is sent than the one give.
//
// The real RepButton is mounted on a stand-in DOM (support/dom.ts) and clicked; it gives through the
// real `mkt` store, whose backend (`market`) is faked here, with warframe.market's answer held open
// until the test lets it go. The page around it is App.svelte's own: its +rep offers (`repDue`,
// `repShown`), how it records a give (`markRep`, `givenFor`) and its two RepButton tags are taken
// from App.svelte's source and put in a small component with the state they read (settings, the
// page's clock, the notifications).
import "./support/dom";
import { flush, settle } from "./support/runes";
import { register } from "node:module";
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { market, type MarketUser } from "../src/lib/backend";
import { REP_OFFER_WINDOW, REP_STRIP_WINDOW } from "../src/lib/core/saleNotice";
import type { Element } from "./support/dom";

const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
/** App.svelte's text from `start` to the first `end` after it, `end` included. */
function piece(start: string, end: string): string {
  const from = app.indexOf(start);
  assert.ok(from >= 0, `App.svelte has ${start.trim()}`);
  assert.equal(app.indexOf(start, from + 1), -1, `one ${start.trim()} in App.svelte`);
  const to = app.indexOf(end, from);
  assert.ok(to > from, `${start.trim()} ends`);
  return app.slice(from, to + end.length);
}
const tag = (re: RegExp) => {
  const m = app.match(re);
  assert.ok(m, `App.svelte has ${re}`);
  return m[0];
};
const src = (p: string) => new URL(`../src/${p}`, import.meta.url).href;
const givenFor = app.match(/^ {2}const givenFor = .*$/m)?.[0] ?? "";
const harness = `<script module lang="ts">
  export { mount, unmount } from "svelte";
</script>
<script lang="ts">
  import RepButton from "${src("lib/ui/RepButton.svelte")}";
  import { mkt } from "${src("lib/marketStore.svelte")}";
  import { offerTime, repOffered, repStripOpen } from "${src("lib/core/saleNotice")}";
  let { page }: { page: any } = $props();
  const settings = page.settings;
  const clock = $derived(page.clock);
${piece("  const repDue = $derived.by(() => {", "\n  });\n")}
${piece("  function markRep(", "\n  }\n")}
${givenFor}
${piece("  function repShown(", "\n  }\n")}
</script>

{#if repDue}<div class="strip">${tag(/<RepButton partner=\{repDue\.t\.partner\}[^\n]*?\/>/)}</div>{/if}
{#each page.notices as n (n.id)}
  {@const r = repShown(n)}
  {#if r}<div class="notice">${tag(/<RepButton partner=\{r\.partner\}[^\n]*?\/>/)}</div>{/if}
{/each}
`;
const HARNESS = new URL("./repOffers.virtual.svelte", import.meta.url).href;
register("./support/client-component-hooks.mjs", import.meta.url, { data: { virtual: { [HARNESS]: harness } } });

const { mkt } = await import("../src/lib/marketStore.svelte");
const { default: Offers, mount, unmount } = (await import(HARNESS)) as { default: unknown; mount: (c: unknown, o: unknown) => object; unmount: (c: object) => void };
// @ts-expect-error: Svelte's client internals have no type declarations
const internal = (await import("svelte/internal/client")) as { proxy: <T>(v: T) => T };
const { document } = await import("./support/dom");

const MIN = 60_000;
const START = Date.UTC(2026, 10, 27, 12);
const user = (name: string): MarketUser => ({ ingameName: name, slug: name.toLowerCase(), reputation: 3, status: "ingame" });
const trade = (key: string, partner: string, at: number) => ({ key, partner, at, uptime: 0, offered: [], received: [], platinum_offered: 0, platinum_received: 12 });

const real = { ...market };
/** What reached warframe.market's side: the lookups, the reads of one's review, the gives. */
let sent: { user: string[]; myReview: string[]; giveRep: string[] };
/** Lets the give on its way answer (warframe.market's reply). */
let answer: () => void;
beforeEach(() => {
  sent = { user: [], myReview: [], giveRep: [] };
  market.user = (async (name: string) => (sent.user.push(name), null)) as never;
  market.myReview = (async (name: string) => (sent.myReview.push(name), 0)) as never;
  market.giveRep = ((name: string) => new Promise<void>((r) => (sent.giveRep.push(name), (answer = r)))) as never;
  mkt.account = { linked: true, backing: "keyring", profile: { id: "me", ingameName: "ExamplePlayer", platform: "pc", crossplay: true }, error: null } as never;
  mkt.users = { alpha: user("Alpha"), bravo: user("Bravo") };
  mock.timers.enable({ apis: ["Date"], now: START });
});
afterEach(() => {
  mock.timers.reset();
  Object.assign(market, real);
});

/** The page with `trades` (latest first) and `notices`, at START. */
function open(trades: ReturnType<typeof trade>[], notices: { id: string; at: number; rep: { key: string; partner: string } }[] = []) {
  const page = internal.proxy({
    settings: { market: { trades, rep: {} as Record<string, string>, repText: ":)", autoRep: false } },
    clock: Date.now(),
    notices: notices.map((n) => ({ ...n, kind: "sold", title: "Sold", body: "", read: false })),
  });
  const target = document.body.appendChild(document.createElement("div"));
  const shown = mount(Offers, { target, props: { page } });
  flush();
  const buttons = (where: "strip" | "notice") => target.findAll((e) => e.localName === "div" && e.className === where).flatMap((d) => d.findAll((e) => e.localName === "button"));
  return {
    page,
    target,
    buttons,
    /** The time moves to `t`, and the page's clock with it. */
    at(t: number) {
      mock.timers.setTime(t);
      page.clock = t;
      flush();
    },
    close() {
      unmount(shown);
      target.remove();
    },
  };
}
const press = async (b: Element) => {
  b.click();
  flush();
  await settle();
};
/** warframe.market answers the give, and the page settles. */
const answered = async () => {
  answer();
  await settle();
  flush();
};

test("the strip: a give that ends after the strip's time is recorded for the trade clicked, with no error", async () => {
  const p = open([trade("t1", "Alpha", START - 29 * MIN)]);
  const [b] = p.buttons("strip");
  assert.ok(b, "the strip offers +rep for Alpha");
  await press(b);
  assert.deepEqual(sent.giveRep, ["Alpha"], "on its way");
  p.at(START + 2 * MIN); // the strip's 30 minutes are over: it folds away
  assert.equal(p.buttons("strip").length, 0, "the strip is gone");
  await answered();
  assert.deepEqual(p.page.settings.market.rep, { t1: "given" });
  assert.equal(p.target.textContent.includes("Couldn"), false, "no error");
  assert.deepEqual(sent, { user: [], myReview: ["Alpha"], giveRep: ["Alpha"] }, "one read of the review and one give, as before");
  p.close();
});

test("the strip: a newer trade lands while the give is on its way, its partner known on warframe.market", async () => {
  const p = open([trade("t1", "Alpha", START - MIN)]);
  await press(p.buttons("strip")[0]);
  p.page.settings.market.trades = [trade("t2", "Bravo", START), ...p.page.settings.market.trades];
  flush();
  await answered();
  assert.deepEqual(p.page.settings.market.rep, { t1: "given" }, "the trade clicked is recorded, the newer one is not");
  assert.deepEqual(sent, { user: [], myReview: ["Alpha"], giveRep: ["Alpha"] }, "the +rep went to the partner clicked, once");
  // The newer trade is still offered, by its own partner's name.
  const [b] = p.buttons("strip");
  assert.ok(b, "the strip offers the newer trade");
  assert.match(b.getAttribute("title") ?? "", /^Give Bravo \+rep/);
  assert.equal(b.textContent, "+rep");
  p.close();
});

test("the strip: a newer trade lands while the give is on its way, its partner not known on warframe.market yet", async () => {
  const p = open([trade("t1", "Alpha", START - MIN)]);
  await press(p.buttons("strip")[0]);
  p.page.settings.market.trades = [trade("t2", "Charlie", START), ...p.page.settings.market.trades];
  flush();
  assert.equal(p.buttons("strip").length, 0, "no strip until Charlie is looked up");
  await answered();
  assert.deepEqual(p.page.settings.market.rep, { t1: "given" });
  assert.deepEqual(sent, { user: [], myReview: ["Alpha"], giveRep: ["Alpha"] });
  // Charlie looked up: the newer trade is offered, as it would have been.
  mkt.users = { ...mkt.users, charlie: user("Charlie") };
  flush();
  assert.match(p.buttons("strip")[0]?.getAttribute("title") ?? "", /^Give Charlie \+rep/);
  p.close();
});

for (const [why, change] of [
  ["its day ends", (p: ReturnType<typeof open>) => p.at(START + 2 * MIN)],
  ["the player signs out", () => (mkt.account = { linked: false, backing: "keyring", profile: null, error: null } as never)],
  ["automatic +rep is turned on", (p: ReturnType<typeof open>) => (p.page.settings.market.autoRep = true)],
] as const) {
  test(`a sale's notification: the give is recorded for its trade when ${why} while the give is on its way`, async () => {
    const at = START - REP_OFFER_WINDOW + MIN;
    // The strip's time is long over: only the notification offers +rep.
    const p = open([trade("t1", "Alpha", at)], [{ id: "n1", at, rep: { key: "t1", partner: "Alpha" } }]);
    assert.equal(p.buttons("strip").length, 0);
    const [b] = p.buttons("notice");
    assert.ok(b, "the notification offers +rep for Alpha");
    await press(b);
    change(p);
    flush();
    assert.equal(p.buttons("notice").length, 0, "the offer is gone");
    await answered();
    assert.deepEqual(p.page.settings.market.rep, { t1: "given" });
    assert.deepEqual(sent, { user: [], myReview: ["Alpha"], giveRep: ["Alpha"] });
    p.close();
  });
}

test("a sale's notification: a newer trade with the same partner leaves the give with the trade clicked", async () => {
  const at = START - 2 * REP_STRIP_WINDOW;
  const p = open([trade("t1", "Alpha", at)], [{ id: "n1", at, rep: { key: "t1", partner: "Alpha" } }]);
  await press(p.buttons("notice")[0]);
  p.page.settings.market.trades = [trade("t2", "Alpha", START), ...p.page.settings.market.trades];
  flush();
  await answered();
  assert.deepEqual(p.page.settings.market.rep, { t1: "given" });
  // One +rep per player: Alpha has it, so neither the strip nor the notification offers more.
  assert.equal(p.buttons("strip").length + p.buttons("notice").length, 0);
  assert.deepEqual(sent, { user: [], myReview: ["Alpha"], giveRep: ["Alpha"] });
  p.close();
});

test("a click after the offer's end is still refused: nothing sent, nothing recorded", async () => {
  // The page's clock is a tick behind: the strip still shows, but its time is over by the click's.
  const p = open([trade("t1", "Alpha", START - REP_STRIP_WINDOW + 1_000)]);
  const [b] = p.buttons("strip");
  assert.ok(b);
  mock.timers.setTime(START + 2_000);
  await press(b);
  assert.deepEqual(sent, { user: [], myReview: [], giveRep: [] });
  assert.deepEqual(p.page.settings.market.rep, {});
  p.close();
});

test("a give with nothing changing on the way records its trade, as before", async () => {
  const p = open([trade("t1", "Alpha", START - MIN)]);
  await press(p.buttons("strip")[0]);
  assert.equal(p.buttons("strip")[0]?.textContent, "Giving…");
  await answered();
  assert.deepEqual(p.page.settings.market.rep, { t1: "given" });
  assert.equal(p.buttons("strip").length, 0, "given: the strip goes");
  assert.deepEqual(sent, { user: [], myReview: ["Alpha"], giveRep: ["Alpha"] });
  p.close();
});
