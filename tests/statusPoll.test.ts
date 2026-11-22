import { test } from "node:test";
import assert from "node:assert/strict";
import { statusPollDue } from "../src/lib/core/statusPoll";

const idle = { wanted: null, committed: null, connected: false, error: null };

test("the status poll reads while signed in, whatever the status", () => {
  assert.equal(statusPollDue({ linked: true, asked: null, status: idle }), true);
  assert.equal(statusPollDue({ linked: true, asked: null, status: null }), true);
});

test("signed out, it reads until the connection shows let go, then waits", () => {
  // Nothing read yet (the first poll, or just after a sign-out cleared it).
  assert.equal(statusPollDue({ linked: false, asked: null, status: null }), true);
  // Still letting go: held, confirmed, connected or failed.
  assert.equal(statusPollDue({ linked: false, asked: null, status: { ...idle, wanted: "online" } }), true);
  assert.equal(statusPollDue({ linked: false, asked: null, status: { ...idle, committed: "online" } }), true);
  assert.equal(statusPollDue({ linked: false, asked: null, status: { ...idle, connected: true } }), true);
  assert.equal(statusPollDue({ linked: false, asked: null, status: { ...idle, error: "refused" } }), true);
  // Let go: no read until something changes.
  assert.equal(statusPollDue({ linked: false, asked: null, status: idle }), false);
});

test("signed out, a choice still settling keeps the poll going", () => {
  assert.equal(statusPollDue({ linked: false, asked: "offline", status: idle }), true);
});
