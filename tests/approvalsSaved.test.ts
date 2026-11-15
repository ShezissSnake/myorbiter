// What this change saves comes back at the next start, through the same save and load the app
// uses (persist.svelte.ts › lightSettings and joinSettings, backend.ts › saveSettings and
// loadSettings, the browser path): each listing's approval with its order id, a filled
// sculpture's own floor and pause, and the per-key approvals an older build reads.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings, flushSettings, joinSettings, lightSettings, loadSettings, saveSettings, type Settings } from "../src/lib/backend";
import { approvedForOf, approvedOf } from "../src/lib/core/approved";

const stored = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, v),
  removeItem: (k: string) => void stored.delete(k),
};
beforeEach(() => stored.clear());

const STAR = "ay|||2|2";

function withApprovals(): Settings {
  const s = defaultSettings();
  s.market.approved = { "it||": 70, [STAR]: 60 };
  (s.market as unknown as { approvedFor: unknown }).approvedFor = { a: { key: "it||", platinum: 70 }, full: { key: STAR, platinum: 60 } };
  s.market.floors = { "ay||": 20, [STAR]: 45 };
  s.market.paused = { [STAR]: true };
  return s;
}

test("each listing's approval, and a filled sculpture's own floor and pause, come back after a save and a start", async () => {
  const s = withApprovals();
  // As persistSettings puts it together: the light part and the long logs apart.
  saveSettings(() => joinSettings(JSON.stringify(lightSettings(s)), {}));
  await flushSettings();
  const loaded = await loadSettings();
  assert.deepEqual(approvedForOf((loaded.market as unknown as { approvedFor?: unknown }).approvedFor), { a: { key: "it||", platinum: 70 }, full: { key: STAR, platinum: 60 } });
  assert.deepEqual(loaded.market.approved, { "it||": 70, [STAR]: 60 });
  assert.deepEqual(loaded.market.floors, { "ay||": 20, [STAR]: 45 });
  assert.deepEqual(loaded.market.paused, { [STAR]: true });
});

test("a step back: the saved file still holds every approval per key, as an older build reads them", async () => {
  saveSettings(withApprovals());
  await flushSettings();
  const raw = JSON.parse(stored.get("orbiter-settings")!);
  assert.deepEqual(approvedOf(raw.market.approved), { "it||": 70, [STAR]: 60 });
  assert.deepEqual(raw.market.floors["ay||"], 20, "the empty sculpture's floor, read by an older build for every Anasa listing, as before");
});
