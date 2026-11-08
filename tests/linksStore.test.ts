// Opening a link, as the page does it, with the app's side stubbed: a link on its way is known (its
// control reads "Opening…"), a second click while it is opens nothing more, a link that couldn't
// open raises the notice in the corner, and the next one that opens clears it. Nothing opens.
import "./support/runes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkOpener } from "../src/lib/backend";

const { links, openUrl } = await import("../src/lib/links.svelte");

/** The app's answer to each open, in turn; the links it was asked to open. */
function stub(answers: (Error | Promise<void> | null)[]) {
  const asked: string[] = [];
  linkOpener.open = async (safe: string) => {
    asked.push(safe);
    const a = answers.shift();
    if (a instanceof Error) throw a;
    if (a) return a;
  };
  return asked;
}

test("a link on its way is known, and a second click opens nothing more", async () => {
  let done!: () => void;
  const asked = stub([new Promise<void>((r) => (done = r))]);
  const first = openUrl("https://WARFRAME.MARKET/items/x");
  assert.equal(links.isOpening("https://warframe.market/items/x"), true, "known by its checked form");
  await openUrl("https://warframe.market/items/x");
  assert.deepEqual(asked, ["https://warframe.market/items/x"], "asked once");
  done();
  await first;
  assert.equal(links.isOpening("https://warframe.market/items/x"), false);
  assert.equal(links.trouble, null);
});

test("a link that couldn't open raises the notice; the next one that opens clears it", async () => {
  stub([new Error("Couldn't open the link (xdg-open exit 4)"), null]);
  await openUrl("https://wiki.warframe.com/w/Mesa_Prime");
  assert.equal(links.trouble, "Couldn't open the link (xdg-open exit 4)");
  assert.equal(links.isOpening("https://wiki.warframe.com/w/Mesa_Prime"), false, "not left on its way");
  await openUrl("https://wiki.warframe.com/w/Mesa_Prime");
  assert.equal(links.trouble, null);
  links.trouble = "x";
  links.dismiss();
  assert.equal(links.trouble, null);
});

test("a link to any other site is refused before the app is asked", async () => {
  const asked = stub([]);
  for (const url of ["http://warframe.market/", "https://evil.example/", "javascript:alert(1)"]) await openUrl(url);
  assert.deepEqual(asked, []);
  assert.equal(links.trouble, null, "a refusal isn't the browser's trouble");
});
