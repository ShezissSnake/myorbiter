import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCounts, buildNumber, cameFrom, CHANNELS, CHECK_EVERY, checkDue, checkedAgo, checkHeadline, checkLine, clockTime, compareVersions, defaultUpdates, NEAREST, newInstallStep, newInstallUpdates, newInstallWhy, publishedTo, settleChannel, settlesByAsking, unsettledWords, installChecks, installInstalls, installNote, noteLines, noticeShows, releasePage, sanitizeUpdates, versionLine, type Install } from "../src/lib/core/updates";
import { openable } from "../src/lib/core/links";
import { defaultSettings } from "../src/lib/backend";
import { NEWS, showMeTarget } from "../src/lib/whatsNew";

test("the channel setting: Stable unless one of the three channels was saved", () => {
  assert.deepEqual(sanitizeUpdates(undefined), defaultUpdates());
  assert.equal(defaultUpdates().channel, "stable");
  assert.equal(defaultSettings().updates.channel, "stable");
  for (const c of ["stable", "beta", "experimental"]) assert.equal(sanitizeUpdates({ channel: c }).channel, c);
  for (const bad of ["nightly", "Stable", "", 3, null, ["beta"], { beta: true }]) assert.equal(sanitizeUpdates({ channel: bad }).channel, "stable", String(bad));
  assert.deepEqual(sanitizeUpdates("beta"), defaultUpdates());
  assert.deepEqual(sanitizeUpdates([1]), defaultUpdates());
});

test("the rest of the update settings: versions, times and where a build came from", () => {
  const s = sanitizeUpdates({ channel: "beta", later: "0.1.40", lastCheck: 1_700_000_000_000, from: { version: "0.1.39", channel: "experimental" } });
  assert.deepEqual(s, { channel: "beta", later: "0.1.40", lastCheck: 1_700_000_000_000, from: { version: "0.1.39", channel: "experimental" }, picked: true });
  assert.equal(sanitizeUpdates({ later: "soon" }).later, "");
  assert.equal(sanitizeUpdates({ later: "0.1" }).later, "");
  assert.equal(sanitizeUpdates({ lastCheck: -5 }).lastCheck, null);
  assert.equal(sanitizeUpdates({ lastCheck: Number.NaN }).lastCheck, null);
  assert.equal(sanitizeUpdates({ lastCheck: "1" }).lastCheck, null);
  assert.equal(sanitizeUpdates({ from: { version: "0.1.3", channel: "nightly" } }).from, null);
  assert.equal(sanitizeUpdates({ from: { version: "x", channel: "beta" } }).from, null);
  assert.equal(sanitizeUpdates({ from: "beta" }).from, null);
});

test("each channel has a tooltip saying what it is", () => {
  assert.deepEqual(CHANNELS.map((c) => c.v), ["stable", "beta", "experimental"]);
  assert.match(CHANNELS[0].title, /tested builds/);
  assert.match(CHANNELS[1].title, /next Stable, a few days early/);
  assert.match(CHANNELS[2].title, /every change, as soon as it's built.*may break/i);
});

test("versions compare by number, and a CI build's number is its release", () => {
  assert.equal(compareVersions("0.1.9", "0.1.52"), -1);
  assert.equal(compareVersions("0.1.52", "0.1.40"), 1);
  assert.equal(compareVersions("v0.1.52", "0.1.52"), 0);
  assert.equal(compareVersions("1.0.0", "0.9.99"), 1);
  assert.equal(buildNumber("0.2.52"), 52);
  assert.equal(buildNumber("0.1.48"), null, "builds from before the move have no release here");
  assert.equal(buildNumber("0.1.0"), null);
  assert.equal(buildNumber("0.3.5"), null);
  // Made on GitHub since the move back (120 on): its release there.
  assert.equal(releasePage("0.2.152"), "https://github.com/ShezissSnake/myorbiter/releases/tag/build-152");
  assert.equal(releasePage("0.2.120"), "https://github.com/ShezissSnake/myorbiter/releases/tag/build-120");
  // Made on GitLab (100 to 119): its release on the mirror.
  assert.equal(releasePage("0.2.119"), "https://gitlab.com/sheziss-group/myorbiter/-/releases/build-119");
  assert.equal(releasePage("0.2.100"), "https://gitlab.com/sheziss-group/myorbiter/-/releases/build-100");
  // Made before the move to GitLab, or a local build: the list.
  assert.equal(releasePage("0.2.52"), "https://github.com/ShezissSnake/myorbiter/releases");
  assert.equal(releasePage("0.1.0"), "https://github.com/ShezissSnake/myorbiter/releases");
  // Release notes open through the opener's allowed links.
  for (const v of ["0.2.152", "0.2.119", "0.1.0"]) assert.ok(openable(releasePage(v)), v);
});

test("Later hides that version's notice, and only that version's", () => {
  assert.equal(noticeShows("0.1.52", ""), true);
  assert.equal(noticeShows("0.1.52", "0.1.52"), false);
  assert.equal(noticeShows("0.1.51", "0.1.52"), true, "a lower build offered later shows");
  assert.equal(noticeShows("0.1.53", "0.1.52"), true);
});

test("Later on a version a manifest once named doesn't hide the builds below it", () => {
  // A channel's file named 9.0.0 for a while, and Later was pressed on it.
  assert.equal(noticeShows("0.2.150", "9.0.0"), true);
  assert.equal(noticeShows("9.0.0", "9.0.0"), false, "that version itself stays put off");
});

test("the version line says where the build came from", () => {
  const u = { ...defaultUpdates(), channel: "beta" as const };
  assert.equal(cameFrom("0.1.0", u), "local");
  assert.equal(versionLine("0.1.0", u), "0.1.0 · local build");
  assert.equal(versionLine("0.2.52", u), "0.2.52 · Beta");
  assert.equal(versionLine("0.2.52", { ...u, from: { version: "0.2.52", channel: "experimental" } }), "0.2.52 · Experimental");
  // Installed from Experimental, since switched and moved on by hand: the record is for another version.
  assert.equal(versionLine("0.2.53", { ...u, from: { version: "0.2.52", channel: "experimental" } }), "0.2.53 · Beta");
});

test("which installs check, which install, and what the others say", () => {
  const all: Install[] = [{ how: "appImage", path: "/a/myorbiter.AppImage" }, { how: "readOnly", folder: "/opt" }, { how: "windows" }, { how: "package" }, { how: "dev" }, { how: "manual" }, { how: "mac" }];
  assert.deepEqual(all.filter(installChecks).map((i) => i.how), ["appImage", "readOnly", "windows"]);
  assert.deepEqual(all.filter(installInstalls).map((i) => i.how), ["appImage", "windows"]);
  assert.equal(installNote({ how: "package" }), "Updates come from your package manager.");
  assert.equal(installNote({ how: "dev" }), "Updates aren't available in dev builds.");
  assert.match(installNote({ how: "readOnly", folder: "/opt" }) ?? "", /\/opt isn't writable/);
  assert.equal(installNote({ how: "appImage", path: "/a" }), null);
});

test("release notes as lines, and when the last check was", () => {
  assert.deepEqual(noteLines("- Faster sync\n\n* Fissures\n• Relics\nPlain"), ["Faster sync", "Fissures", "Relics", "Plain"]);
  assert.deepEqual(noteLines(null), []);
  assert.equal(noteLines("a\nb\nc", 2).length, 2);
  // Commit subjects from contributors: nothing hidden or reordered reaches the notice.
  assert.deepEqual(noteLines("Fix \u202Eslaer\u202C list\n\u200B\nx".concat("y".repeat(300))), ["Fix slaer list", "x".concat("y".repeat(199))]);
  const now = 10_000_000_000;
  assert.equal(checkedAgo(null, now), "not yet");
  assert.equal(checkedAgo(now - 10_000, now), "just now");
  assert.equal(checkedAgo(now - 12 * 60_000, now), "12 min ago");
  assert.equal(checkedAgo(now - 3 * 3_600_000, now), "3 h ago");
  assert.equal(checkedAgo(now - 2 * 86_400_000, now), "2 d ago");
});

test("when the periodic check is due: 6 hours after the last, however it ended", () => {
  const now = 10_000_000_000;
  assert.equal(checkDue(null, now), true, "never checked");
  assert.equal(checkDue(now - CHECK_EVERY + 1, now), false);
  assert.equal(checkDue(now - CHECK_EVERY, now), true);
  assert.equal(checkDue(now - 30 * 60_000, now), false);
  assert.equal(checkDue(now + 60_000, now), true, "a clock that went back");
});

test("the line under Check now: one state per check, with when", () => {
  const now = 10_000_000_000;
  assert.equal(checkLine(null, null, false, now), "Last checked not yet.");
  assert.equal(checkLine(null, now - 2 * 3_600_000, false, now), "Last checked 2 h ago.");
  assert.equal(checkLine(null, now, true, now), "Checking for updates…");
  assert.equal(checkLine({ kind: "newer", channel: "experimental", version: "0.2.106", at: now }, now, false, now), "0.2.106 is available on Experimental (checked just now).");
  assert.equal(checkLine({ kind: "current", channel: "beta", version: "0.2.104", at: now - 5 * 60_000 }, now, false, now), "Up to date (checked 5 min ago).");
  assert.equal(checkLine({ kind: "older", channel: "stable", version: "0.2.103", at: now }, now, false, now), "Stable has 0.2.103, older than this build (checked just now).");
  assert.equal(checkLine({ kind: "failed", channel: "experimental", reason: "Couldn't reach GitHub or GitLab", at: now }, now, false, now), `Couldn't reach GitHub or GitLab (at ${clockTime(now)}, just now).`);
  assert.match(clockTime(now), /^\d\d:\d\d$/);
  assert.equal(checkHeadline(null, false), "");
  assert.equal(checkHeadline(null, true), "Checking for updates…");
  assert.equal(checkHeadline({ kind: "newer", channel: "experimental", version: "0.2.106", at: now }, false), "0.2.106 is available on Experimental");
  assert.equal(checkHeadline({ kind: "current", channel: "beta", version: "0.2.104", at: now - 5 * 60_000 }, false), "Up to date", "no age in what's announced");
  assert.equal(checkHeadline({ kind: "failed", channel: "stable", reason: "Couldn't reach GitHub or GitLab", at: now }, false), "Couldn't reach GitHub or GitLab");
});

test("What's New announces updates, and its Show me opens Settings at Updates", () => {
  const item = NEWS.flatMap((n) => n.items).find((x) => typeof x !== "string" && x.title === "orbiter updates itself");
  assert.ok(item && typeof item !== "string");
  assert.equal(item.open, "settings#updates");
  assert.deepEqual(showMeTarget("settings#updates", () => null), { label: "Settings" });
  assert.deepEqual(showMeTarget("builds#hero", (p) => (p === "builds" ? "Builds" : null)), { label: "Builds" });
  assert.equal(showMeTarget("nowhere", () => null), null);
});

test("a new install that asks nothing: a local build on Stable, a copy that doesn't check on Experimental; saved settings keep theirs", () => {
  // Only a CI build that checks settles by asking the channels (`newInstallStep`); the others keep
  // what they had before, with no request.
  assert.equal(settlesByAsking("0.2.127", true), true);
  assert.equal(settlesByAsking("0.2.127", false), false, "an install that doesn't check");
  assert.equal(settlesByAsking("0.1.0", true), false, "a local build");
  assert.equal(settlesByAsking("0.1.0", false), false);
  // Each kind of build: every CI build (0.2.n) lands on Experimental; a local build is published nowhere.
  assert.equal(publishedTo("0.2.127"), "experimental");
  assert.equal(publishedTo("0.2.1"), "experimental");
  assert.equal(publishedTo("0.1.0"), "stable");
  assert.equal(publishedTo("junk"), "stable");
  const fresh = newInstallUpdates();
  assert.equal(fresh.picked, false);
  assert.equal(settleChannel(fresh, "0.2.127"), true);
  assert.deepEqual(fresh, { ...defaultUpdates(), channel: "experimental", picked: true });
  assert.equal(settleChannel(fresh, "0.2.128"), false, "once only: a later build doesn't move it");
  const local = newInstallUpdates();
  settleChannel(local, "0.1.0");
  assert.equal(local.channel, "stable");
  // Saved settings, whatever they hold, keep their channel: nobody is moved.
  for (const saved of [undefined, {}, { channel: "stable" }, { channel: "beta", lastCheck: 1 }, { channel: "stable", picked: true }]) {
    const u = sanitizeUpdates(saved);
    assert.equal(settleChannel(u, "0.2.127"), false, JSON.stringify(saved));
    assert.equal(u.channel, (saved as { channel?: string } | undefined)?.channel ?? "stable");
  }
  // A new install that saved before it learned its version settles at its next start.
  const half = sanitizeUpdates({ ...newInstallUpdates() });
  assert.equal(half.picked, false);
  settleChannel(half, "0.2.127");
  assert.equal(half.channel, "experimental");
  // The default object itself stays Stable and settled (settings saved before updates).
  assert.equal(defaultUpdates().picked, true);
});

test("a new install's channel: the most stable one whose build is this one or newer", () => {
  const run = "0.2.134";
  const v = (version: string) => ({ version });
  // Stable has a build: Stable, without asking Beta.
  assert.equal(newInstallStep(run, v("0.2.134")), "stable", "Stable has this build");
  assert.equal(newInstallStep(run, v("0.2.140")), "stable", "Stable has a newer one");
  // Stable empty: Beta is asked, and counts if it has a build.
  assert.equal(newInstallStep(run, "empty"), "ask beta");
  assert.equal(newInstallStep(run, "empty", v("0.2.134")), "beta", "only Beta has one");
  assert.equal(newInstallStep(run, "empty", v("0.2.136")), "beta");
  // Neither: Experimental, which is never asked for this.
  assert.equal(newInstallStep(run, "empty", "empty"), "experimental", "neither has one");
  // No answer from a channel that had to be asked: nothing settles.
  assert.equal(newInstallStep(run, null), "not yet", "no answer from Stable");
  assert.equal(newInstallStep(run, null, v("0.2.134")), "not yet", "Stable's silence isn't skipped over");
  assert.equal(newInstallStep(run, "empty", null), "not yet", "no answer from Beta after an empty Stable");
  assert.equal(newInstallStep(run, v("0.2.130"), null), "not yet", "nor after an older Stable");
  // A Stable answer that counts settles even when Beta (not needed) would have failed.
  assert.equal(newInstallStep(run, v("0.2.134"), null), "stable");
  // A channel whose build is older than the running one doesn't count.
  assert.equal(newInstallStep(run, v("0.2.130")), "ask beta", "running newer than Stable's");
  assert.equal(newInstallStep(run, v("0.2.130"), v("0.2.134")), "beta", "newer than Stable's, Beta has it");
  assert.equal(newInstallStep(run, "empty", v("0.2.131")), "experimental", "running newer than Beta's");
  assert.equal(newInstallStep(run, v("0.2.120"), v("0.2.131")), "experimental", "running newer than both");
  assert.equal(newInstallStep("0.2.9", v("0.2.10")), "stable", "by number, not by text");
  // Why, for the log line.
  assert.equal(newInstallWhy(run, "stable", v("0.2.134")), "the most stable channel with this build or a newer one (Stable has 0.2.134)");
  assert.equal(newInstallWhy(run, "beta", "empty", v("0.2.134")), "the most stable channel with this build or a newer one (Stable has no build, Beta has 0.2.134)");
  assert.equal(newInstallWhy(run, "experimental", v("0.2.120"), "empty"), "neither Stable nor Beta has this build or a newer one (Stable's build 0.2.120 is older, Beta has no build)");
  assert.equal(newInstallWhy(run, "experimental", "empty", "empty", v("0.2.134")), "neither Stable nor Beta has this build or a newer one (Stable has no build, Beta has no build, Experimental has 0.2.134)");
});

test("only a build that is the running one or newer counts: an empty or older answer, or none, proves nothing", () => {
  const run = "0.2.134";
  assert.equal(buildCounts({ version: "0.2.134" }, run), true);
  assert.equal(buildCounts({ version: "0.2.140" }, run), true);
  // What every channel reads as when its file fails at the first address: the second (GitLab's
  // frozen copy) has no manifest, or holds the bridge build, below 0.2.120.
  assert.equal(buildCounts("empty", run), false);
  assert.equal(buildCounts({ version: "0.2.112" }, run), false);
  assert.equal(buildCounts({ version: "0.2.133" }, run), false);
  assert.equal(buildCounts(null, run), false);
  assert.equal(buildCounts(undefined, run), false);
});

test("an unsettled new install says so: the version line names no channel, and Settings says what is shown", () => {
  const fresh = newInstallUpdates();
  assert.equal(versionLine("0.2.134", fresh), "0.2.134 · channel not chosen yet");
  assert.equal(versionLine("0.1.0", fresh), "0.1.0 · local build");
  assert.equal(versionLine("0.2.134", { ...fresh, picked: true }), "0.2.134 · Stable");
  const said = unsettledWords("stable", false);
  assert.match(said, /^Stable is shown, but no channel is chosen yet: MyOrbiter is still finding out/);
  assert.match(said, /asks them at its first check/);
  // The same words whether no channel answered or every channel answered without this build or a newer one.
  assert.match(unsettledWords("stable", true), /No channel has answered with this build or a newer one yet, so MyOrbiter asks again at its next check\./);
  assert.doesNotMatch(unsettledWords("stable", true), /couldn't reach/, "not said when every channel answered");
  // Both forms say what being unsettled costs, and the way out.
  for (const failed of [false, true]) assert.match(unsettledWords("stable", failed), /Until one is chosen no update is offered: pick a channel and MyOrbiter looks for its updates at once, and that channel stays\.$/);
  // Saved settings are never a new install: whatever they hold, they count as picked.
  for (const saved of [undefined, null, {}, { channel: "beta" }, { picked: "no" }, { picked: 0 }, { channel: "experimental", picked: true }]) assert.equal(sanitizeUpdates(saved).picked, true, JSON.stringify(saved));
  assert.equal(sanitizeUpdates({ picked: false }).picked, false, "only an unsettled new install saves false");
});

test("a new install, as the settings load it: whenever no settings object was read, but for a file that couldn't be read", () => {
  // The new-install rule settles the channel after a damaged file too (the maintainer, 2026-11-12):
  // only a file that couldn't be read at all, which is never saved over, keeps Stable as shown.
  // Run against a stand-in app in tests/damagedSettings.test.ts.
  const src = readFileSync(new URL("../src/lib/backend.ts", import.meta.url), "utf8");
  assert.match(src, /updates: raw \? sanitizeUpdates\(raw\.updates\) : loadFailed == null \? newInstallUpdates\(\) : defaultUpdates\(\)/, "saved settings are sanitized as before");
  // No file at all, said by the desktop app, or nothing in the browser's storage.
  assert.match(src, /fresh = loaded\.fresh === true;/);
  assert.match(src, /fresh = saved == null;/);
  const rs = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.match(rs, /NotFound => return Ok\(SettingsRead \{ settings: Value::Null, fresh: true, moved_aside: None \}\)/, "a missing file is fresh");
  assert.match(rs, /Ok\(SettingsRead \{ settings: Value::Null, fresh: false, moved_aside: Some\(name\) \}\)/, "a damaged file moved aside isn't, and is named");
});

test("an empty channel is said plainly, never as a failure, and the nearest channel comes first", () => {
  const at = Date.UTC(2026, 10, 12, 9, 0);
  const o = { kind: "empty" as const, channel: "stable" as const, system: false, nearest: { channel: "experimental" as const, version: "0.2.127" }, at };
  assert.equal(checkHeadline(o, false), "Stable has no build yet");
  assert.equal(checkLine(o, at, false, at), "Stable has no build yet, so there's nothing to update to there (checked just now).");
  assert.equal(checkHeadline({ ...o, system: true }, false), "Stable has no build for this system yet");
  assert.deepEqual(NEAREST.stable, ["beta", "experimental"]);
  assert.deepEqual(NEAREST.beta, ["stable", "experimental"]);
  assert.deepEqual(NEAREST.experimental, ["beta", "stable"]);
  for (const c of ["stable", "beta", "experimental"] as const) assert.ok(!NEAREST[c].includes(c));
});
