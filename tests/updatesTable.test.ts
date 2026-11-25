// How a check reads what the two update addresses give, cell by cell, for a new install and for an
// install that has a channel. The app's side is stood in for by `feed`, which answers as
// updates.rs does: a new install's check (`firstOnly`) reads github.com alone, one read that
// follows no redirect, then the plugin's read of the file if one is there; its 404 is "empty",
// anything else that isn't a build is a failure. Every other check is the plugin's loop over both
// addresses, as before: a manifest at the first ends it; otherwise gitlab.com is read, its frozen
// copy reads as an older build, its error status as empty, its silence as a failure (the plugin's
// `updater.rs` check loop, and the Rust tests `a_new_install_asks_the_first_address_alone`,
// `the_first_address_says_file_none_or_failed`, `after_a_file_no_manifest_is_a_failure`). Nothing
// here reaches GitHub or GitLab.
import "./support/runes";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { updater, type UpdateCheck } from "../src/lib/backend";
import { defaultUpdates, type Channel, type UpdateSettings } from "../src/lib/core/updates";

const { Updates } = await import("../src/lib/updates.svelte");

const T0 = Date.UTC(2026, 10, 8, 17, 50);
const RUNNING = "0.2.130";

/** What github.com gives for a channel's file: a manifest of that version, its 404, another status, or nothing. */
type First = { build: string } | "404" | "503" | "offline";
/** What gitlab.com gives: its frozen manifest (the bridge build, below 0.2.120), an error status, or nothing. */
type Second = "frozen" | "status" | "offline";
type Feed = Record<Channel, { first: First; second: Second }>;

/** One address read, as the stand-in counts them (a manifest's redirect to GitHub's file storage not counted). */
type Read = `${Channel} ${"github" | "gitlab"}`;

const micro = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** The app's answer to one check of `c`, and the reads it made, as updates.rs gives them. */
function answer(feed: Feed, c: Channel, firstOnly: boolean, reads: Read[]): UpdateCheck {
  const { first, second } = feed[c];
  const built = (version: string): UpdateCheck => {
    const [a, b] = [version, RUNNING].map((v) => v.split(".").map(Number));
    const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    return cmp === 0 ? { state: "current", version } : { state: cmp > 0 ? "newer" : "older", version, notes: null, date: null };
  };
  reads.push(`${c} github`);
  if (firstOnly) {
    if (typeof first === "object") {
      reads.push(`${c} github`); // the plugin's read of the file the first read found
      return built(first.build);
    }
    if (first === "404") return { state: "empty", system: false };
    throw new Error(first === "offline" ? "GitHub didn't answer within 10 s" : `Couldn't read the ${c} channel's manifest on GitHub`);
  }
  if (typeof first === "object") return built(first.build);
  reads.push(`${c} gitlab`);
  if (second === "frozen") return built("0.2.110");
  if (second === "status") {
    if (first === "offline") throw new Error("Couldn't reach GitHub or GitLab");
    return { state: "empty", system: false };
  }
  throw new Error("Couldn't reach GitHub or GitLab");
}

/** A store on an AppImage of 0.2.130 whose checks the stand-in answers from `feed`. */
function store(t: TestContext, feed: Feed, settings: UpdateSettings) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const real = { ...updater };
  const reads: Read[] = [];
  const asked: [Channel, boolean][] = [];
  updater.info = async () => ({ version: RUNNING, install: { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" } });
  updater.check = async (c: Channel, firstOnly = false) => {
    asked.push([c, firstOnly]);
    return answer(feed, c, firstOnly, reads);
  };
  const u = new Updates();
  t.after(() => {
    u.stop();
    Object.assign(updater, real);
  });
  return { u, reads, asked };
}

/** The check at start, run to its end. */
async function firstStart(t: TestContext, u: InstanceType<typeof Updates>, settings: UpdateSettings) {
  u.start(() => settings);
  await micro();
  t.mock.timers.tick(0);
  t.mock.timers.tick(300);
  await micro();
}

const FIRSTS: [string, First][] = [
  ["a manifest", { build: RUNNING }],
  ["its 404", "404"],
  ["another error status (a 503)", "503"],
  ["no connection or a time-out", "offline"],
];
const SECONDS: [string, Second][] = [
  ["its frozen manifest", "frozen"],
  ["an error status", "status"],
  ["no connection or a time-out", "offline"],
];

/** Stable and Beta give `first` and `second`; Experimental has a newer build on GitHub (as today, plus one). */
const feedOf = (first: First, second: Second): Feed => ({
  stable: { first, second },
  beta: { first, second },
  experimental: { first: { build: "0.2.132" }, second },
});

// A new install: Stable shown, nothing chosen. What it settles on, by GitHub's answer alone.
for (const [fName, first] of FIRSTS) {
  for (const [sName, second] of SECONDS) {
    test(`new install, github.com gives ${fName}, gitlab.com ${sName}`, async (t) => {
      const settings: UpdateSettings = { ...defaultUpdates(), channel: "stable", picked: false };
      const { u, reads, asked } = store(t, feedOf(first, second), settings);
      await firstStart(t, u, settings);
      assert.ok(asked.every(([, firstOnly]) => firstOnly), "every check of a new install asks the first address alone");
      assert.ok(!reads.some((r) => r.endsWith("gitlab")), "gitlab.com is never read for it");
      if (typeof first === "object") {
        assert.equal(settings.channel, "stable");
        assert.equal(settings.picked, true, "GitHub's Stable has the build: settled there");
        assert.deepEqual(reads, ["stable github", "stable github"]);
      } else if (first === "404") {
        // GitHub's own "no build" for Stable and Beta: Experimental, offered its update, whatever
        // gitlab.com gives (no connection to it included).
        assert.equal(settings.channel, "experimental");
        assert.equal(settings.picked, true);
        assert.deepEqual(reads, ["stable github", "beta github", "experimental github", "experimental github"]);
        assert.equal(u.offer?.version, "0.2.132", "Experimental's update offered at once");
        assert.equal(u.unsettled, null);
      } else {
        // GitHub not asked, or answering otherwise: no answer this try, never a less stable channel.
        assert.equal(settings.picked, false, "unsettled");
        assert.equal(settings.channel, "stable", "still only shown");
        assert.deepEqual(reads, ["stable github"], "nothing more asked this try");
        assert.equal(u.offer, null, "nothing offered");
        assert.match(u.unsettled ?? "", /no update is offered: pick a channel and MyOrbiter looks for its updates at once/);
      }
    });
  }
}

// An install that has a channel (Stable, saved): asked, read and offered as on main, gitlab.com
// included, by the plugin's two-address loop.
for (const [fName, first] of FIRSTS) {
  for (const [sName, second] of SECONDS) {
    test(`install with a channel, github.com gives ${fName}, gitlab.com ${sName}`, async (t) => {
      const settings: UpdateSettings = { ...defaultUpdates(), channel: "stable", picked: true };
      const { u, reads, asked } = store(t, feedOf(first, second), settings);
      await firstStart(t, u, settings);
      assert.equal(settings.channel, "stable", "never moved");
      assert.ok(asked.every(([, firstOnly]) => !firstOnly), "every check is main's: both addresses");
      assert.deepEqual(asked[0], ["stable", false], "its own channel first, as on main");
      if (typeof first === "object") {
        assert.deepEqual(reads, ["stable github"], "GitHub's manifest: gitlab.com isn't asked");
        assert.equal(u.outcome?.kind, "current");
      } else if (second === "frozen") {
        assert.deepEqual(reads, ["stable github", "stable gitlab"]);
        assert.equal(u.outcome?.kind, "older", "GitLab's older build, offered only as a click");
        assert.equal(u.offer?.older, true);
      } else if (second === "status" && first !== "offline") {
        // Stable reads as empty; its nearest channels are asked for the Switch to offer, as on main.
        assert.equal(u.outcome?.kind, "empty");
        assert.deepEqual(reads, ["stable github", "stable gitlab", "beta github", "beta gitlab", "experimental github"]);
      } else {
        assert.equal(u.outcome?.kind, "failed");
        assert.deepEqual(reads, ["stable github", "stable gitlab"]);
      }
    });
  }
}

test("an install with a channel sends what it always did: the channel alone, never the first-address flag", async (t) => {
  const settings: UpdateSettings = { ...defaultUpdates(), channel: "experimental", picked: true };
  const { u, asked } = store(t, feedOf("404", "frozen"), settings);
  await firstStart(t, u, settings);
  assert.deepEqual(asked, [["experimental", false]], "main's one check at a first start");
  // And what reaches the app: `updater.check` sends `{ channel }` alone unless asked otherwise.
  const backend = (await import("node:fs")).readFileSync(new URL("../src/lib/backend.ts", import.meta.url), "utf8");
  assert.match(backend, /invoke\("updates_check", firstOnly \? \{ channel, firstOnly \} : \{ channel \}\)/);
});

test("a new install's first start, today's channels: four reads of github.com, none of gitlab.com", async (t) => {
  const settings: UpdateSettings = { ...defaultUpdates(), channel: "stable", picked: false };
  const { u, reads } = store(t, feedOf("404", "frozen"), settings);
  await firstStart(t, u, settings);
  assert.equal(reads.length, 4);
  assert.equal(settings.channel, "experimental");
  // Settled by itself, so it follows the most stable build: the next check first asks GitHub alone
  // for the two more stable channels (a 404 each), then its own as main's check asks it, one read
  // when GitHub has the manifest.
  assert.equal(settings.follows, true);
  reads.length = 0;
  await u.checkNow();
  assert.deepEqual(reads, ["stable github", "beta github", "experimental github"]);
  assert.equal(settings.channel, "experimental");
});

test("a new install that picks the channel it shows gets its updates looked for at once", async (t) => {
  const settings: UpdateSettings = { ...defaultUpdates(), channel: "stable", picked: false };
  const { u, asked } = store(t, feedOf("503", "offline"), settings);
  await firstStart(t, u, settings);
  assert.equal(settings.picked, false);
  asked.length = 0;
  u.setChannel("stable");
  await micro();
  assert.equal(settings.picked, true);
  assert.deepEqual(asked, [["stable", false]], "the pick's own check, at once, as main's");
});

test("the help line reads one way: nothing installs or changes a channel you picked without a click", async () => {
  const { readFileSync } = await import("node:fs");
  const help = readFileSync(new URL("../src/lib/help/settings.ts", import.meta.url), "utf8");
  assert.match(help, /"Release notes: this build's page\. Nothing installs, or changes a channel you picked, without your click\.",/);
  assert.doesNotMatch(help, /unasked/);
});
