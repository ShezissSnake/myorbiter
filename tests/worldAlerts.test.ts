// What MyOrbiter says about the world and announces from it: an old list said as old, never as
// empty; nothing announced from a world state older than its own expiry; each notification once
// (the wishlist's eras, cheap buys, the Circuit's week); what couldn't be read said as that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pruneLive } from "../src/lib/backend";
import { chosenFissures, missionTypes, MISSIONS } from "../src/lib/core/board";
import { inFissure } from "../src/lib/core/mission";
import { cycleTimers, matchedFissures, ruleLabel, ruleMatches, sameRule, type FissureRule } from "../src/lib/core/timers";
import { alertNeeds, type WorldAlert } from "../src/lib/core/worldNeeds";
import { couldntRead, fissuresOutOfDate, liveCurrent, notInWorld, unreadParts, watchingAlertsNote, type WorldRead } from "../src/lib/core/worldAge";
import { circuitNews, dealNews, wishlistNews } from "../src/lib/core/worldOnce";
import type { Fissure, Live, MissionState } from "../src/lib/core/types";

const T0 = Date.parse("2026-11-12T10:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const fissure = (id: string, tier: string, mins: number, extra: Partial<Fissure> = {}): Fissure =>
  ({ id, node: "Hepit (Void)", missionType: "Capture", enemy: "Corrupted", tier, tierNum: 1, isStorm: false, isHard: false, expiry: new Date(T0 + mins * MIN).toISOString(), ...extra });
const read = (at: number | null, extra: Partial<WorldRead> = {}): WorldRead => ({ at, error: null, read: true, ...extra });
const live = (l: Partial<Live>): Live => ({ fissures: [], resurgence: null, resurgenceExpiry: null, ...l });
const WISHED = new Set(["Lith", "Meso", "Neo", "Axi", "Requiem"]);

// ------------------------------------------------------------ 4: an old fissure list

test("after a sleep longer than every fissure's life, the list the 30 s prune leaves reads as out of date, not as none open", () => {
  const kept = live({ fissures: [fissure("a", "Lith", 30), fissure("b", "Axi", 90)] });
  const now = T0 + 3 * HOUR;
  const after = pruneLive(kept, now).fissures;
  assert.deepEqual(after, [], "the prune empties the list");
  assert.equal(fissuresOutOfDate(after, read(T0), now), true, "read three hours ago, nothing open: old");
  assert.equal(fissuresOutOfDate(after, read(T0, { error: "api.warframestat.us didn't answer" }), T0 + 5 * MIN), true, "the last read failed: old");
  assert.equal(fissuresOutOfDate(after, read(T0, { read: false }), T0 + MIN), true, "kept from last time, no read since start: old");
  assert.equal(fissuresOutOfDate([], read(now - MIN), now), false, "a read a minute ago with none open: none open");
  assert.equal(fissuresOutOfDate(kept.fissures, read(T0), now), true, "every fissure read has closed: old (as before)");
  assert.equal(fissuresOutOfDate([fissure("c", "Neo", 200)], read(T0), now), false, "one still open: the board lists it");
});

// ------------------------------------------------------------ 3 and 13: the wishlist's eras

test("after a sleep the wishlist notice compares the first fresh read with the last one before the sleep", () => {
  let before: Set<string> | null = null;
  const step = (fs: Fissure[], r: WorldRead, now: number) => {
    const out = wishlistNews(before, fs, now, liveCurrent(r, now), WISHED);
    before = out.baseline;
    return out.fresh;
  };
  assert.deepEqual(step([fissure("a", "Axi", 60), fissure("b", "Lith", 60)], read(T0), T0), [], "the first read only sets what's open");
  // Asleep for three hours: the first tick prunes everything, before any read.
  const now = T0 + 3 * HOUR;
  assert.deepEqual(step(pruneLive(live({ fissures: [fissure("a", "Axi", 60), fissure("b", "Lith", 60)] }), now).fissures!, read(T0), now), [], "nothing from the old list");
  // The fresh read: Axi and Lith open again, as they were all along in the game.
  assert.deepEqual(step([fissure("c", "Axi", 250), fissure("d", "Lith", 250)], read(now + MIN), now + MIN), [], "no era announced as newly open");
});

test("after an outage the wishlist notice isn't raised for eras whose fissures ended while nothing could be read", () => {
  let before: Set<string> | null = null;
  const step = (fs: Fissure[], r: WorldRead, now: number) => {
    const out = wishlistNews(before, fs, now, liveCurrent(r, now), WISHED);
    before = out.baseline;
    return out.fresh;
  };
  step([fissure("a", "Axi", 2), fissure("b", "Lith", 60)], read(T0), T0);
  // The next read fails; meanwhile the Axi fissure ends and the prune takes it out.
  const fs = pruneLive(live({ fissures: [fissure("a", "Axi", 2), fissure("b", "Lith", 60)] }), T0 + 6 * MIN).fissures!;
  assert.deepEqual(step(fs, read(T0, { error: "api.warframestat.us didn't answer" }), T0 + 6 * MIN), []);
  assert.deepEqual(step([fissure("c", "Axi", 90), fissure("b", "Lith", 60)], read(T0 + 10 * MIN), T0 + 10 * MIN), [], "Axi isn't news: the gap wasn't seen");
});

test("while the reads are current, an era that closed and opens again is news, as before", () => {
  let before: Set<string> | null = null;
  const step = (fs: Fissure[], r: WorldRead, now: number) => {
    const out = wishlistNews(before, fs, now, liveCurrent(r, now), WISHED);
    before = out.baseline;
    return out.fresh;
  };
  step([fissure("a", "Axi", 2), fissure("b", "Lith", 60)], read(T0), T0);
  step(pruneLive(live({ fissures: [fissure("a", "Axi", 2), fissure("b", "Lith", 60)] }), T0 + 3 * MIN).fissures!, read(T0), T0 + 3 * MIN);
  assert.deepEqual(step([fissure("c", "Axi", 90), fissure("b", "Lith", 60)], read(T0 + 5 * MIN), T0 + 5 * MIN), ["Axi"]);
});

test("an Omnia fissure counts for the wishlist notice: it takes any relic but a Requiem one, as the Wishlist page says", () => {
  let before: Set<string> | null = null;
  const step = (fs: Fissure[], now: number, wished: Set<string>) => {
    const out = wishlistNews(before, fs, now, true, wished);
    before = out.baseline;
    return out.fresh;
  };
  step([fissure("l", "Lith", 60)], T0, new Set(["Axi", "Requiem"]));
  assert.deepEqual(step([fissure("l", "Lith", 60), fissure("o", "Omnia", 60)], T0 + 5 * MIN, new Set(["Axi", "Requiem"])), ["Axi"], "an Axi relic can be cracked now; a Requiem one can't");
  assert.deepEqual(step([fissure("l", "Lith", 60), fissure("o", "Omnia", 60), fissure("x", "Axi", 60)], T0 + 10 * MIN, new Set(["Axi", "Requiem"])), [], "Axi's own fissure opening while the Omnia one is open isn't news again");
});

// ------------------------------------------------------------ 5: cheap buys

const deal = (slug: string, price: number) => ({ slug, rank: null, price });
/** Scans in a row: each gives the Cheap buys list, the books it couldn't read, and whether a scan has run yet. */
const scans = () => {
  let notified: string[] = [];
  return (deals: ReturnType<typeof deal>[], unread: string[], now: number, scanned = true) => {
    const out = dealNews(deals, unread, notified, now, scanned);
    notified = out.notified;
    return out.fresh.map((d) => `${d.slug} ${d.price}`);
  };
};
test("a cheap buy that was announced is news again once it has left the Cheap buys list, at most once an hour", () => {
  const scan = scans();
  assert.deepEqual(scan([deal("thing", 40)], [], T0), ["thing 40"]);
  assert.deepEqual(scan([deal("thing", 40)], [], T0 + 10 * MIN), [], "still listed: not news");
  assert.deepEqual(scan([], [], T0 + 20 * MIN), [], "gone");
  assert.deepEqual(scan([deal("thing", 45)], [], T0 + 30 * MIN), [], "back within the hour: not yet");
  assert.deepEqual(scan([deal("thing", 45)], [], T0 + 70 * MIN), ["thing 45"], "still there past the hour: news, though dearer than the first");
  assert.deepEqual(scan([], [], T0 + 80 * MIN), []);
  assert.deepEqual(scan([deal("thing", 40)], [], T0 + 135 * MIN), ["thing 40"], "gone and back, an hour after the last: news");
});

test("a cheap buy isn't forgotten when its book couldn't be read, nor before the first scan", () => {
  const scan = scans();
  assert.deepEqual(scan([deal("thing", 40)], [], T0), ["thing 40"]);
  assert.deepEqual(scan([], ["thing"], T0 + 2 * HOUR), [], "its book couldn't be read: still remembered");
  assert.deepEqual(scan([], [], T0 + 2 * HOUR + MIN, false), [], "a restart, no scan yet: still remembered");
  assert.deepEqual(scan([deal("thing", 40)], [], T0 + 3 * HOUR), [], "the same deal, still listed: not news");
  assert.deepEqual(scan([deal("thing", 35)], [], T0 + 4 * HOUR), ["thing 35"], "a lower price, past the hour: news");
});

test("a cheap buy the live feed caught, outside the scan's own items, is forgotten once the list no longer has it", () => {
  const scan = scans();
  // The feed adds it between scans; the next scan's list doesn't hold it (the scan never asks its book).
  assert.deepEqual(scan([deal("other", 30)], [], T0), ["other 30"]);
  assert.deepEqual(scan([], [], T0 + 10 * MIN), [], "the scan's list: gone");
  assert.deepEqual(scan([deal("other", 30)], [], T0 + 2 * HOUR), ["other 30"], "the feed catches it again later: news");
});

test("cheap buys remembered by an earlier version (item@price) carry over", () => {
  const out = dealNews([deal("thing", 40), deal("other", 30)], [], ["thing|@40"], T0, true);
  assert.deepEqual(out.fresh.map((d) => d.slug), ["other"], "the same price as remembered: not news");
});

// ------------------------------------------------------------ 6: the Circuit

test("the Circuit's notification: once per week and wanted item, whatever else the wanted list gains or loses", () => {
  let known: string[] = [];
  const week = (frames: string[], incarnons: string[], resets = "2026-11-16T00:00:00.000Z") => {
    const out = circuitNews({ resets, frames: frames.map((name) => ({ name, wanted: true })), incarnons: incarnons.map((name) => ({ name, wanted: true })) }, known);
    known = [...out.keys, ...known];
    return [...out.frames, ...out.incarnons];
  };
  assert.deepEqual(week(["Nekros", "Excalibur"], ["Braton"]), ["Nekros", "Excalibur", "Braton"]);
  assert.deepEqual(week(["Excalibur"], ["Braton"]), [], "Nekros mastered mid-week: nothing new");
  assert.deepEqual(week(["Nekros", "Excalibur"], ["Braton", "Lato"]), ["Lato"], "a weapon bought mid-week: only it");
  assert.deepEqual(week(["Nekros"], ["Braton"], "2026-11-23T00:00:00.000Z"), ["Nekros", "Braton"], "a new week");
});

test("the Circuit's notification already sent by an earlier version this week isn't sent again", () => {
  const out = circuitNews({ resets: "R", frames: [{ name: "Nekros", wanted: true }], incarnons: [{ name: "Braton", wanted: true }, { name: "Lato", wanted: true }] }, ["circuit|R|Nekros,Braton"]);
  assert.deepEqual([...out.frames, ...out.incarnons], ["Lato"]);
});

// ------------------------------------------------------------ 7 and 12: what couldn't be read

test("Watching's alerts card says the alerts couldn't be read, not that nothing needs you", () => {
  const r = read(T0);
  assert.notEqual(watchingAlertsNote(live({ alerts: null, invasions: [] }), r, true), "Nothing that needs you right now.");
  assert.match(watchingAlertsNote(live({ alerts: null, invasions: null }), r, true) ?? "", /alerts and invasions couldn't be read/i);
  assert.match(watchingAlertsNote(live({ alerts: [], invasions: null }), r, false) ?? "", /invasions couldn't be read/i, "said beside what is listed too");
  assert.equal(watchingAlertsNote(live({ alerts: [], invasions: [] }), r, true), "Nothing that needs you right now.");
  assert.equal(watchingAlertsNote(live({ alerts: [], invasions: [] }), r, false), null);
  assert.match(watchingAlertsNote(live({ alerts: null, invasions: null }), read(null), true) ?? "", /reading/i, "the first read on its way");
});

test("Home names each part of the world state it couldn't read, where that part would be", () => {
  const all = live({
    alerts: [], invasions: [], events: [], darvo: { item: "Lato", originalPrice: 10, salePrice: 5, expiry: "2099-01-01T00:00:00Z" },
    nightwave: { activeChallenges: [] } as unknown as Live["nightwave"], steelPath: { currentReward: { name: "Umbra Forma", cost: 150 } } as unknown as Live["steelPath"],
    duviriCycle: { choices: [] } as unknown as Live["duviriCycle"],
    cycles: [{ key: "zariman", state: "corpus", expiry: "2099-01-01T00:00:00Z" }, { key: "duviri", state: "joy", expiry: "2099-01-01T00:00:00Z" }],
  });
  assert.deepEqual(unreadParts(all, read(T0)), { needs: [], today: [], events: [], clocks: [] }, "everything read");
  assert.deepEqual(unreadParts({ ...all, nightwave: null }, read(T0)).today, ["Nightwave"], "Nightwave alone missing");
  assert.deepEqual(unreadParts({ ...all, alerts: null, darvo: null, events: null, cycles: all.cycles!.slice(1) }, read(T0)), { needs: ["Alerts"], today: ["Darvo's deal"], events: ["Events"], clocks: ["The Zariman's clock"] });
  assert.deepEqual(unreadParts(live({}), read(null)), { needs: [], today: [], events: [], clocks: [] }, "the first read on its way: nothing said yet");
});

test("Worth doing today's parts that ended (Darvo's deal at its rollover) aren't called unreadable", () => {
  const l = pruneLive(live({ darvo: { item: "Lato", originalPrice: 10, salePrice: 5, expiry: new Date(T0 - MIN).toISOString() } }), T0);
  const today = unreadParts({ ...l, nightwave: { activeChallenges: [] } as unknown as Live["nightwave"], steelPath: {} as Live["steelPath"], duviriCycle: {} as Live["duviriCycle"] }, read(T0 - 2 * MIN)).today;
  assert.deepEqual(today, ["Darvo's deal"]);
  assert.equal(notInWorld(today), "Darvo's deal isn't in the worldstate right now.");
  assert.equal(notInWorld(["Darvo's deal", "Nightwave"]), "Darvo's deal and Nightwave aren't in the worldstate right now.");
  assert.equal(couldntRead(["Alerts", "Invasions"]), "Alerts and invasions couldn't be read just now.");
});

// ------------------------------------------------------------ 8: a reward listed once

test("an alert whose items repeat its counted item is one entry, not two", () => {
  const a: WorldAlert = { id: "a1", expiry: "2099-01-01T00:00:00Z", mission: { node: "Xini (Eris)", type: "Survival", reward: { countedItems: [{ uniqueName: "/Lotus/StoreItems/Types/Recipes/Components/FormaBlueprint", type: "Forma Blueprint", count: 1 }], items: ["Forma Blueprint"] } } };
  assert.deepEqual(alertNeeds(null, [a]).rare.map((x) => x.reward), ["Forma Blueprint"]);
  const both: WorldAlert = { ...a, id: "a2", mission: { ...a.mission, reward: { countedItems: [{ type: "Forma Blueprint", count: 1 }], items: ["Forma Blueprint", "Orokin Reactor Blueprint"] } } };
  assert.deepEqual(alertNeeds(null, [both]).rare.map((x) => x.key), ["a2|Forma Blueprint", "a2|Orokin Reactor Blueprint"], "one key each");
});

// ------------------------------------------------------------ 9: alert rules told apart

test("two different fissure alerts don't read the same", () => {
  const rule = (r: Partial<FissureRule>): FissureRule => ({ id: "r", kinds: [], tiers: [], missions: [], planets: [], ...r });
  const a = ruleLabel(rule({ tiers: ["Axi"] }));
  const b = ruleLabel(rule({ kinds: ["normal", "steel", "storm"], tiers: ["Axi"] }));
  assert.notEqual(a, b, "one takes Void Storms, the other doesn't");
  assert.match(b, /Void Storm/);
  assert.equal(ruleLabel(rule({ kinds: ["normal", "steel", "storm"] })), "Any fissure or Void Storm", "as before");
});

// ------------------------------------------------------------ 10: in a fissure

test("without the log's session clock, 'in a fissure' ends with the fissure's own expiry", () => {
  const ms = { mission: "Hepit (Void)", relics: ["/Lotus/Types/Game/Projections/T1VoidProjectionABronze"], session_start: null, last_event: 100 } as unknown as MissionState;
  const fs = [fissure("a", "Lith", 60)];
  assert.equal(inFissure(ms, T0 + 30 * MIN, fs), true, "its fissure still open");
  assert.equal(inFissure(ms, T0 + 61 * MIN, fs), false, "its fissure has ended");
  assert.equal(inFissure(ms, T0 + 3 * 86_400_000, []), false, "days later, the fissure long gone");
  assert.equal(inFissure(ms, T0 + 3 * 86_400_000, null), false, "nothing to go by");
  const clocked = { ...ms, session_start: (T0 - 10 * MIN) / 1000, last_event: 0 } as MissionState;
  assert.equal(inFissure(clocked, T0, []), true, "with the clock, the log decides, as before");
  assert.equal(inFissure(clocked, T0 + HOUR, fs), false);
});

// ------------------------------------------------------------ 11: a clock that isn't a time

test("a clock whose expiry isn't a time is left out, and the others keep counting", () => {
  const l = live({ cycles: [{ key: "earth", state: "day", expiry: "soon" }, { key: "cetus", state: "day", expiry: new Date(T0 + 30 * MIN).toISOString() }] });
  assert.deepEqual(cycleTimers(l, T0).map((c) => c.key), ["cetus"]);
});

// ------------------------------------------------------------ one name for Exterminate

test("the mission list offers Exterminate once, by the world state's name", () => {
  assert.ok(MISSIONS.includes("Exterminate"));
  assert.ok(!MISSIONS.includes("Extermination"));
  const ext = [fissure("e", "Axi", 60, { missionType: "Exterminate" })];
  assert.equal(missionTypes(ext).filter((m) => /^Extermina/.test(m)).length, 1);
  assert.deepEqual(missionTypes(ext, ["Extermination"]).filter((m) => /^Extermina/.test(m)), ["Exterminate"], "an old saved choice isn't offered as a second mission");
});

test("an alert or a Watching choice saved with Extermination still matches Exterminate", () => {
  const old: FissureRule = { id: "o", kinds: [], tiers: [], missions: ["Extermination"], planets: [] };
  const f = fissure("e", "Axi", 60, { missionType: "Exterminate" });
  assert.equal(ruleMatches(old, f), true);
  assert.deepEqual(matchedFissures([old], [f], T0).map((x) => x.fissure.id), ["e"]);
  assert.equal(sameRule(old, { ...old, missions: ["Exterminate"] }), true, "the same alert under either name");
  assert.equal(ruleLabel(old), "Exterminate");
  const r = chosenFissures([f], { kinds: ["normal"], eras: [], missions: ["Extermination"], only: false }, [], T0);
  assert.equal(r.count, 1);
});

// ------------------------------------------------------------ damaged saved lists

test("a damaged list of announced deals is passed over where damaged, never thrown on", () => {
  for (const bad of ["oops", null, undefined, 42, { a: 1 }]) {
    assert.deepEqual(dealNews([deal("thing", 40)], [], bad, T0, true).fresh.map((d) => d.slug), ["thing"], `not a list: ${JSON.stringify(bad)}`);
  }
  const out = dealNews([deal("thing", 40), deal("other", 30)], [], [42, null, { a: 1 }, ["x"], `thing|@40@${T0}`], T0 + 2 * HOUR, true);
  assert.deepEqual(out.fresh.map((d) => d.slug), ["other"], "the text entry is kept: thing at 40 isn't news");
  assert.ok(out.notified.every((k) => typeof k === "string"), "only text is written back");
});

test("an announced deal dated far in the future counts as announced now, not for good", () => {
  const notified = [`thing|@40@${T0 + 365 * 86_400_000}`];
  const first = dealNews([deal("thing", 30)], [], notified, T0, true);
  assert.deepEqual(first.fresh, [], "within the hour");
  assert.deepEqual(first.notified, [`thing|@40@${T0}`], "kept as announced now");
  const later = dealNews([deal("thing", 30)], [], first.notified, T0 + 2 * HOUR, true);
  assert.deepEqual(later.fresh.map((d) => d.price), [30], "a lower price past the hour is news");
});

test("a damaged list of announced world events is passed over where damaged, never thrown on", () => {
  const c = { resets: "R", frames: [{ name: "Nekros", wanted: true }], incarnons: [{ name: "Braton", wanted: true }] };
  for (const bad of ["oops", null, 42, { a: 1 }]) assert.deepEqual(circuitNews(c, bad).keys, ["circuit|R|Nekros", "circuit|R|Braton"], JSON.stringify(bad));
  const out = circuitNews(c, [1, null, { a: 1 }, "circuit|R|Nekros"]);
  assert.deepEqual([...out.frames, ...out.incarnons], ["Braton"]);
});

// ------------------------------------------------------------ the gaps the review named

test("the Circuit: a pick that isn't wanted isn't announced, and a name in both lists is said once", () => {
  const out = circuitNews({ resets: "R", frames: [{ name: "Nekros", wanted: false }, { name: "Excalibur", wanted: true }], incarnons: [{ name: "Excalibur", wanted: true }, { name: "Lato", wanted: false }] }, []);
  assert.deepEqual([out.frames, out.incarnons, out.keys], [["Excalibur"], [], ["circuit|R|Excalibur"]]);
});

test("an era that truly opened while the computer slept is announced at the first fresh read", () => {
  let before: Set<string> | null = null;
  const step = (fs: Fissure[], r: WorldRead, now: number) => {
    const out = wishlistNews(before, fs, now, liveCurrent(r, now), WISHED);
    before = out.baseline;
    return out.fresh;
  };
  step([fissure("b", "Lith", 60)], read(T0), T0);
  const now = T0 + 3 * HOUR;
  step(pruneLive(live({ fissures: [fissure("b", "Lith", 60)] }), now).fissures!, read(T0), now);
  assert.deepEqual(step([fissure("c", "Axi", 250), fissure("d", "Lith", 250)], read(now + MIN), now + MIN), ["Axi"]);
});

test("without the log's clock, only a fissure on the mission's own node keeps it live", () => {
  const ms = { mission: "Hepit (Void)", relics: ["/r"], session_start: null, last_event: 100 } as unknown as MissionState;
  assert.equal(inFissure(ms, T0, [fissure("u", "Lith", 60, { node: "Ukko (Void)" })]), false, "another node's fissure");
  assert.equal(inFissure(ms, T0, [fissure("u", "Lith", 60, { node: "Ukko (Void)" }), fissure("h", "Lith", 60)]), true);
  assert.equal(inFissure({ ...ms, mission: null } as unknown as MissionState, T0, [fissure("h", "Lith", 60)]), false, "no mission name");
});

test("a read is current up to ten minutes old, and not a moment longer", () => {
  assert.equal(liveCurrent(read(T0), T0 + 10 * MIN), true);
  assert.equal(liveCurrent(read(T0), T0 + 10 * MIN + 1), false);
  assert.equal(fissuresOutOfDate([], read(T0), T0 + 10 * MIN), false, "none open, read ten minutes ago: none open");
  assert.equal(fissuresOutOfDate([], read(T0), T0 + 10 * MIN + 1), true);
  assert.equal(fissuresOutOfDate(null, read(T0), T0 + HOUR), false, "no list yet: the board says loading, not out of date");
});

test("announced deals keep the 300 most recent, newest first", () => {
  const notified = Array.from({ length: 310 }, (_, i) => `item${i}|@10@${T0 - i * MIN}`);
  const out = dealNews([deal("new", 5)], [], notified, T0 + MIN, false).notified;
  assert.equal(out.length, 300);
  assert.equal(out[0], `new|@5@${T0 + MIN}`);
  assert.equal(out[1], `item0|@10@${T0}`);
  assert.equal(out[299], `item298|@10@${T0 - 298 * MIN}`);
});

// ------------------------------------------------------------ wiring

test("App, Home and Watching go by these rules", () => {
  const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
  assert.match(app, /wishlistNews\(/);
  assert.match(app, /dealNews\(/);
  assert.match(app, /circuitNews\(/);
  assert.match(app, /inFissure\(mission, [^)]*live\.fissures\)/);
  const home = readFileSync(new URL("../src/lib/tabs/Home.svelte", import.meta.url), "utf8");
  assert.match(home, /unreadParts\(/);
  const side = readFileSync(new URL("../src/lib/ui/SideWatch.svelte", import.meta.url), "utf8");
  assert.match(side, /watchingAlertsNote\(/);
  assert.match(side, /fissuresOutOfDate\(/);
  const board = readFileSync(new URL("../src/lib/ui/FissureBoard.svelte", import.meta.url), "utf8");
  assert.match(board, /fissuresOutOfDate\(/);
});
