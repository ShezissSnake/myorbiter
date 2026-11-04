import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNumber, cameFrom, CHANNELS, checkedAgo, compareVersions, defaultUpdates, installChecks, installInstalls, installNote, noteLines, noticeShows, releasePage, sanitizeUpdates, versionLine, type Install } from "../src/lib/core/updates";
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
  assert.deepEqual(s, { channel: "beta", later: "0.1.40", lastCheck: 1_700_000_000_000, from: { version: "0.1.39", channel: "experimental" } });
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
  assert.equal(buildNumber("0.1.52"), 52);
  assert.equal(buildNumber("0.1.0"), null);
  assert.equal(buildNumber("0.2.5"), null);
  assert.equal(releasePage("0.1.52"), "https://github.com/ShezissSnake/orbiter/releases/tag/build-52");
  assert.equal(releasePage("0.1.0"), "https://github.com/ShezissSnake/orbiter/releases");
  // Release notes open through the opener's allowed links.
  assert.ok(openable(releasePage("0.1.52")));
  assert.ok(openable(releasePage("0.1.0")));
});

test("Later hides that version's notice until a newer one", () => {
  assert.equal(noticeShows("0.1.52", ""), true);
  assert.equal(noticeShows("0.1.52", "0.1.52"), false);
  assert.equal(noticeShows("0.1.51", "0.1.52"), false);
  assert.equal(noticeShows("0.1.53", "0.1.52"), true);
});

test("the version line says where the build came from", () => {
  const u = { ...defaultUpdates(), channel: "beta" as const };
  assert.equal(cameFrom("0.1.0", u), "local");
  assert.equal(versionLine("0.1.0", u), "0.1.0 · local build");
  assert.equal(versionLine("0.1.52", u), "0.1.52 · Beta");
  assert.equal(versionLine("0.1.52", { ...u, from: { version: "0.1.52", channel: "experimental" } }), "0.1.52 · Experimental");
  // Installed from Experimental, since switched and moved on by hand: the record is for another version.
  assert.equal(versionLine("0.1.53", { ...u, from: { version: "0.1.52", channel: "experimental" } }), "0.1.53 · Beta");
});

test("which installs check, which install, and what the others say", () => {
  const all: Install[] = [{ how: "appImage", path: "/a/orbiter.AppImage" }, { how: "readOnly", folder: "/opt" }, { how: "windows" }, { how: "package" }, { how: "dev" }, { how: "manual" }, { how: "mac" }];
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

test("What's New announces updates, and its Show me opens Settings at Updates", () => {
  const item = NEWS.flatMap((n) => n.items).find((x) => typeof x !== "string" && x.title === "orbiter updates itself");
  assert.ok(item && typeof item !== "string");
  assert.equal(item.open, "settings#updates");
  assert.deepEqual(showMeTarget("settings#updates", () => null), { label: "Settings" });
  assert.deepEqual(showMeTarget("builds#hero", (p) => (p === "builds" ? "Builds" : null)), { label: "Builds" });
  assert.equal(showMeTarget("nowhere", () => null), null);
});
