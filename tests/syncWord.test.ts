// Sync's word between syncs (core/syncWord.ts): one case per way a sync can end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncIdleWord, type SyncEnd } from "../src/lib/core/syncWord";

const done = (note: string | null): SyncEnd => ({ failed: false, note });
const failed = (short: string | null): SyncEnd => ({ failed: true, short });

test("before the first load: waiting; once the data is in: up to date", () => {
  assert.equal(syncIdleWord(null, false, false), "Waiting…");
  assert.equal(syncIdleWord(null, false, true), "Up to date");
});

test("a sync that went through: up to date", () => {
  assert.equal(syncIdleWord(done("Synced"), false, true), "Up to date");
  assert.equal(syncIdleWord(done("Up to date"), false, true), "Up to date");
});

test("a sync that ended without a new read keeps its own word", () => {
  assert.equal(syncIdleWord(done("Old read"), false, true), "Old read");
  assert.equal(syncIdleWord(done("No read"), false, true), "No read");
});

test("a sync that failed keeps its word, or says not synced", () => {
  // The saved data couldn't be read.
  assert.equal(syncIdleWord(failed("Not read"), false, true), "Not read");
  // TennoScope didn't answer, or no new read came in time: no short word of its own.
  assert.equal(syncIdleWord(failed(null), false, true), "Not synced");
  // Never up to date, whatever loaded before.
  assert.notEqual(syncIdleWord(failed(null), false, true), "Up to date");
});

test("saved data that couldn't be read: not synced", () => {
  assert.equal(syncIdleWord(null, true, true), "Not synced");
  assert.equal(syncIdleWord(done("Synced"), true, true), "Not synced");
});

test("a later sync that succeeds puts it back to up to date", () => {
  let last: SyncEnd = failed(null);
  assert.equal(syncIdleWord(last, false, true), "Not synced");
  last = done("Synced");
  assert.equal(syncIdleWord(last, false, true), "Up to date");
});
