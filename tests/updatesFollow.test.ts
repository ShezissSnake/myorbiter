// A channel that follows the most stable build, and what is said outside Settings: an install whose
// channel MyOrbiter chose (a new install's first check) moves by itself to a more stable channel
// once that channel's build is the running one or newer, and never to a less stable one or an older
// build; a channel picked by hand, or kept from settings saved before this was recorded, never moves
// by itself, and an empty one is offered the switch in one click. The app's side is stubbed: nothing
// here reaches GitHub or GitLab.
import "./support/runes";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { updater, type UpdateCheck, type UpdateInfo } from "../src/lib/backend";
import { channelWord, defaultUpdates, followOrder, followStep, followWhy, followWords, newInstallStep, newInstallUpdates, sanitizeUpdates, switchOffer, type Channel, type UpdateSettings } from "../src/lib/core/updates";

const { Updates } = await import("../src/lib/updates.svelte");

const T0 = Date.UTC(2026, 10, 25, 12, 0);
const RUN = "0.2.141";
const EMPTY: UpdateCheck = { state: "empty", system: false };
const current = (version = RUN): UpdateCheck => ({ state: "current", version });
const newer = (version: string): UpdateCheck => ({ state: "newer", version, notes: "Sales chart\nRiven sold", date: null });
const older = (version: string): UpdateCheck => ({ state: "older", version, notes: null, date: null });
const OFFLINE = () => new Error("Couldn't read the Stable channel's manifest on GitHub");

const micro = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

type Answer = UpdateCheck | Error | Promise<UpdateCheck>;
const APPIMAGE: UpdateInfo["install"] = { how: "appImage", path: "/home/user/Apps/myorbiter.AppImage" };

/** A store on `install` of `version`, with `saved` update settings, whose checks answer `answers` in turn. */
function setup(t: TestContext, saved: Partial<UpdateSettings>, answers: Answer[], version = RUN, install: UpdateInfo["install"] = APPIMAGE) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: T0 });
  const real = { ...updater };
  const calls: string[] = [];
  updater.info = async () => ({ version, install });
  updater.check = async (c: Channel, firstOnly = false) => {
    calls.push(firstOnly ? `${c} (GitHub alone)` : c);
    const a = answers.shift();
    if (!a) throw new Error("no answer stubbed");
    if (a instanceof Error) throw a;
    return a;
  };
  const settings: UpdateSettings = { ...defaultUpdates(), ...saved };
  const u = new Updates();
  t.after(() => {
    u.stop();
    Object.assign(updater, real);
  });
  return { u, settings, calls, answers };
}

/** Starts the store and runs its check at start to the end. */
async function started(t: TestContext, u: InstanceType<typeof Updates>, settings: UpdateSettings) {
  u.start(() => settings);
  await micro();
  t.mock.timers.tick(0);
  t.mock.timers.tick(300);
  await micro();
}

/** The banner as it is now (a getter TypeScript would otherwise keep narrowed after an assertion). */
const bannerOf = (u: InstanceType<typeof Updates>) => u.banner;

// ---- the rule, without the app

test("following asks only the more stable channels, most stable first; Follow asks every channel", () => {
  assert.deepEqual(followOrder("stable"), []);
  assert.deepEqual(followOrder("beta"), ["stable"]);
  assert.deepEqual(followOrder("experimental"), ["stable", "beta"]);
  for (const c of ["stable", "beta", "experimental"] as const) assert.deepEqual(followOrder(c, true), ["stable", "beta", "experimental"]);
});

test("following moves only to a more stable channel whose build is the running one or newer", () => {
  const v = (version: string) => ({ version });
  const beta = followOrder("beta");
  assert.deepEqual(followStep(RUN, beta, {}), { ask: "stable" }, "Stable is asked first");
  assert.equal(followStep(RUN, beta, { stable: "empty" }), null, "Stable empty: stays on Beta");
  assert.equal(followStep(RUN, beta, { stable: v(RUN) }), "stable", "Stable has this build: moves");
  assert.equal(followStep(RUN, beta, { stable: v("0.2.150") }), "stable", "Stable has a newer one: moves");
  assert.equal(followStep(RUN, beta, { stable: v("0.2.140") }), null, "Stable's build is older: never a step back");
  assert.equal(followStep(RUN, beta, { stable: null }), null, "no build said: stays");
  const exp = followOrder("experimental");
  assert.deepEqual(followStep(RUN, exp, { stable: "empty" }), { ask: "beta" });
  assert.equal(followStep(RUN, exp, { stable: "empty", beta: v(RUN) }), "beta");
  assert.equal(followStep(RUN, exp, { stable: v("0.2.141"), beta: v("0.2.150") }), "stable", "the most stable that counts, not the newest");
  assert.equal(followStep(RUN, exp, { stable: v("0.2.120"), beta: v("0.2.130") }), null, "both older: stays on Experimental");
  // Never a less stable channel by itself: nothing less stable is ever in the order.
  assert.equal(followStep(RUN, followOrder("stable"), {}), null, "Stable never moves by itself");
  for (const c of ["stable", "beta", "experimental"] as const) {
    for (const to of followOrder(c)) assert.ok(followOrder("stable", true).indexOf(to) < followOrder("stable", true).indexOf(c), `${to} is more stable than ${c}`);
  }
  // Follow asked for by the player: every channel, so a less stable one may be the answer.
  assert.equal(followStep(RUN, followOrder("stable", true), { stable: "empty", beta: v(RUN) }), "beta");
  assert.equal(followStep(RUN, followOrder("stable", true), { stable: "empty", beta: "empty", experimental: v("0.2.140") }), null, "nothing with this build or newer: stays");
  assert.equal(followWhy(RUN, "beta", "stable", v(RUN)), "from Beta to Stable, the most stable channel with this build or a newer one (Stable has this build (0.2.141))");
  assert.equal(followWhy(RUN, "beta", "stable", v("0.2.150")), "from Beta to Stable, the most stable channel with this build or a newer one (Stable has 0.2.150, newer than this build (0.2.141))");
});

test("installs that exist: only a channel recorded as chosen by MyOrbiter follows; one kept from before counts as picked", () => {
  // Settings saved before this build don't say: their channel is kept as picked by hand.
  for (const saved of [undefined, {}, { channel: "stable" }, { channel: "beta", picked: true }, { follows: "yes" }, { follows: 1 }]) assert.equal(sanitizeUpdates(saved).follows, false, JSON.stringify(saved));
  assert.equal(sanitizeUpdates({ channel: "beta", picked: true, follows: true }).follows, true);
  assert.equal(newInstallUpdates().follows, false);
  assert.equal(defaultUpdates().follows, false);
});

test("outside Settings, an unsettled channel is never named as chosen", () => {
  const fresh = newInstallUpdates();
  assert.equal(fresh.channel, "stable", "Settings shows Stable meanwhile");
  assert.equal(channelWord(RUN, fresh), "channel not chosen yet");
  assert.equal(followWords(RUN, fresh), null, "Settings' unsettled line says it instead");
  assert.equal(channelWord(RUN, { ...fresh, picked: true }), "Stable");
  assert.equal(channelWord("0.1.0", fresh), "local build");
  assert.match(followWords(RUN, { ...fresh, channel: "beta", picked: true, follows: true }) ?? "", /moves to Stable by itself once Stable has this build or a newer one, never to a less stable channel or an older build/);
  assert.match(followWords(RUN, { ...fresh, channel: "experimental", picked: true, follows: true }) ?? "", /moves to Stable or Beta by itself once one of them has/);
  assert.equal(followWords(RUN, { ...fresh, channel: "beta", picked: true, follows: false }), "Beta stays as chosen: MyOrbiter never switches it by itself.");
});

test("an empty channel's switch is offered outside Settings only when it isn't a step back", () => {
  const at = T0;
  const empty = (version: string, channel: Channel = "beta") => ({ kind: "empty" as const, channel: "stable" as const, system: false, nearest: { channel, version }, at });
  assert.deepEqual(switchOffer(empty(RUN), "stable", RUN), { from: "stable", to: "beta", version: RUN });
  assert.deepEqual(switchOffer(empty("0.2.150"), "stable", RUN), { from: "stable", to: "beta", version: "0.2.150" });
  assert.equal(switchOffer(empty("0.2.140"), "stable", RUN), null, "an older build: Settings alone, as a step back");
  assert.equal(switchOffer(empty(RUN), "beta", RUN), null, "the outcome of another channel than the one chosen now");
  assert.equal(switchOffer({ ...empty(RUN), nearest: null }, "stable", RUN), null, "no channel with a build");
  assert.equal(switchOffer({ kind: "failed", channel: "stable", reason: "Couldn't check", at }, "stable", RUN), null, "a failed check offers nothing");
  assert.equal(switchOffer(null, "stable", RUN), null);
});

// ---- case 7: the maintainer's question, "a fault in the settling?"

test("a new install of 0.2.141, Stable empty and Beta at 0.2.141: settles on Beta, and follows", async (t) => {
  assert.equal(newInstallStep(RUN, "empty"), "ask beta");
  assert.equal(newInstallStep(RUN, "empty", { version: RUN }), "beta");
  const { u, settings, calls } = setup(t, { ...newInstallUpdates() }, [EMPTY, current()]);
  u.start(() => settings);
  await micro();
  assert.equal(channelWord(RUN, settings), "channel not chosen yet", "nothing outside Settings shows Stable as chosen meanwhile");
  assert.equal(u.banner, null);
  t.mock.timers.tick(0);
  t.mock.timers.tick(300);
  await micro();
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)"]);
  assert.equal(settings.channel, "beta");
  assert.equal(settings.picked, true);
  assert.equal(settings.follows, true, "chosen by MyOrbiter: it follows");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

test("a new install whose first check never heard back settles at the next one, and shows no channel meanwhile", async (t) => {
  const { u, settings, calls, answers } = setup(t, { ...newInstallUpdates() }, [OFFLINE()]);
  await started(t, u, settings);
  assert.equal(settings.picked, false);
  assert.equal(channelWord(RUN, settings), "channel not chosen yet");
  assert.equal(u.banner, null, "no banner from a check that failed");
  assert.equal(u.switchOffer, null);
  answers.push(EMPTY, current());
  await u.checkNow();
  assert.deepEqual(calls, ["stable (GitHub alone)", "stable (GitHub alone)", "beta (GitHub alone)"]);
  assert.equal(settings.channel, "beta");
  assert.equal(settings.follows, true);
});

// ---- case 5: following

test("following on Beta while Stable has no build: stays on Beta, Stable asked first and Beta last", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [EMPTY, newer("0.2.150")]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta"], "the app keeps the last check's update: Beta's");
  assert.equal(settings.channel, "beta");
  assert.deepEqual(u.banner, { kind: "update", offer: { channel: "beta", version: "0.2.150", notes: "Sales chart\nRiven sold", older: false }, installs: true });
});

test("following on Beta: moves to Stable by itself once Stable's build is the running one, one request", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)"], "Stable's answer is the check: Beta isn't asked");
  assert.equal(settings.channel, "stable");
  assert.equal(settings.follows, true, "still following (Stable is the top)");
  assert.equal(channelWord(RUN, settings), "Stable");
  assert.equal(u.status(Date.now()), "Up to date (checked just now).");
});

test("following on Beta: Stable with a newer build is moved to and offered, never installed by itself", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [newer("0.2.150")]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)"]);
  assert.equal(settings.channel, "stable");
  assert.equal(u.banner?.kind, "update");
  assert.equal(u.installJob.working, false, "nothing installs without the click");
  assert.equal(settings.from, null);
});

test("following never steps back: Stable's build older than the running one leaves it on Beta", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [older("0.2.140"), current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta"]);
  assert.equal(settings.channel, "beta");
  assert.equal(u.offer, null);
});

test("following on Experimental: Beta with the build is the move when Stable has none", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "experimental", follows: true }, [EMPTY, current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)"]);
  assert.equal(settings.channel, "beta");
});

test("following never moves to a less stable channel by itself: an empty Beta is offered the switch, not moved", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [EMPTY, EMPTY, current()]);
  await started(t, u, settings);
  // Stable (following), Beta (its check), then the nearest channels for the switch (Stable from
  // this check's answers, then Experimental).
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta", "experimental"]);
  assert.equal(settings.channel, "beta", "not moved");
  assert.deepEqual(u.switchOffer, { from: "beta", to: "experimental", version: RUN });
});

test("a channel on Stable that follows asks nothing more than before", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "stable", follows: true }, [current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable"], "main's one check");
});

// ---- case 5 and 6: picked by hand, or kept from before

test("a channel picked by hand never moves, and the more stable ones aren't asked", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: false }, [current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["beta"], "main's one check");
  assert.equal(settings.channel, "beta");
});

test("settings kept from before on an empty Stable: not moved, and offered the switch to Beta in one click", async (t) => {
  const settings0 = sanitizeUpdates({ channel: "stable", later: "", lastCheck: null, from: null, picked: true });
  const { u, settings, calls, answers } = setup(t, settings0, [EMPTY, current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable", "beta"], "its own check, then the nearest channel, as on main");
  assert.equal(settings.channel, "stable", "never switched by itself");
  assert.deepEqual(u.banner, { kind: "switch", from: "stable", to: "beta", version: RUN });
  // The click: Beta, picked as Stable was (it doesn't start following).
  answers.push(current());
  u.switchTo("beta");
  await micro();
  assert.equal(settings.channel, "beta");
  assert.equal(settings.follows, false, "a channel kept from before stays picked after Switch to");
  assert.deepEqual(calls.slice(2), ["beta"]);
  assert.equal(u.banner, null);
  // Stable gets this build: Beta stays, as it was switched to, until the player chooses again.
  answers.push(current());
  await u.checkNow();
  assert.deepEqual(calls.slice(3), ["beta"], "the more stable channels aren't asked");
  assert.equal(settings.channel, "beta");
});

test("a following channel left empty: Switch to keeps it following, and it comes back by itself", async (t) => {
  const { u, settings, calls, answers } = setup(t, { channel: "beta", follows: true }, [EMPTY, EMPTY, current()]);
  await started(t, u, settings);
  assert.deepEqual(u.banner, { kind: "switch", from: "beta", to: "experimental", version: RUN });
  answers.push(EMPTY, EMPTY, current());
  u.switchTo("experimental");
  await micro();
  assert.equal(settings.channel, "experimental");
  assert.equal(settings.follows, true);
  // Beta gets this build: the next check moves back there by itself.
  calls.length = 0;
  answers.push(EMPTY, current());
  await u.checkNow();
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)"]);
  assert.equal(settings.channel, "beta");
});

test("Later puts the switch away for that build; a newer one on the nearest channel shows it again", async (t) => {
  const { u, settings, answers } = setup(t, { channel: "stable" }, [EMPTY, current()]);
  await started(t, u, settings);
  u.later();
  assert.equal(settings.later, RUN);
  assert.equal(u.banner, null);
  assert.deepEqual(u.switchOffer, { from: "stable", to: "beta", version: RUN }, "still there for the place outside Settings");
  answers.push(EMPTY, current("0.2.150"));
  await u.checkNow();
  assert.deepEqual(u.banner, { kind: "switch", from: "stable", to: "beta", version: "0.2.150" });
});

test("a pick by hand ends the following; Follow brings it back and asks every channel", async (t) => {
  const { u, settings, calls, answers } = setup(t, { channel: "beta", follows: true }, [EMPTY, current()]);
  await started(t, u, settings);
  u.setChannel("beta");
  await micro();
  assert.equal(settings.follows, false, "a click on the channel shown is a pick too");
  answers.push(EMPTY, current());
  calls.length = 0;
  u.follow();
  await micro();
  assert.equal(settings.follows, true);
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)"], "every channel until one has this build");
  assert.equal(settings.channel, "beta");
});

test("Follow from an empty Stable kept from before: Beta, the most stable channel with this build", async (t) => {
  const { u, settings, calls, answers } = setup(t, { channel: "stable" }, [EMPTY, current()]);
  await started(t, u, settings);
  calls.length = 0;
  answers.push(EMPTY, current());
  u.follow();
  await micro();
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)"]);
  assert.equal(settings.channel, "beta");
  assert.equal(settings.follows, true);
});

test("Follow with no channel counting, from the middle: its own channel is read again, last, for the build the app keeps", async (t) => {
  const { u, settings, calls, answers } = setup(t, { channel: "beta" }, [older("0.2.130")]);
  await started(t, u, settings);
  calls.length = 0;
  answers.push(older("0.2.120"), older("0.2.130"), older("0.2.135"), older("0.2.130"));
  u.follow();
  await micro();
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)", "experimental (GitHub alone)", "beta"]);
  assert.equal(settings.channel, "beta");
  assert.equal(u.offer?.channel, "beta");
});

test("Follow when no channel has this build or a newer one: the channel stays", async (t) => {
  const { u, settings, calls, answers } = setup(t, { channel: "experimental" }, [current("0.2.141")], "0.2.141");
  await started(t, u, settings);
  calls.length = 0;
  answers.push(older("0.2.120"), older("0.2.130"), current());
  u.follow();
  await micro();
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta (GitHub alone)", "experimental (GitHub alone)"]);
  assert.equal(settings.channel, "experimental");
});

test("a pick by hand while the more stable channel is asked: the answer is dropped and the pick is asked", async (t) => {
  let answerStable: (r: UpdateCheck) => void = () => {};
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [new Promise<UpdateCheck>((r) => (answerStable = r)), current()]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)"]);
  u.setChannel("experimental");
  answerStable(current());
  await micro();
  assert.equal(settings.channel, "experimental", "the pick stands: Stable's answer moved nothing");
  assert.equal(settings.follows, false);
  assert.deepEqual(calls, ["stable (GitHub alone)", "experimental"]);
});

// ---- case 9: a check that failed

test("a more stable channel that can't be read: nothing moves, and the check goes on with its own channel as before", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [OFFLINE(), newer("0.2.150")]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta"], "Beta read as before, both addresses, last");
  assert.equal(settings.channel, "beta");
  assert.equal(settings.follows, true, "still following: the next check asks Stable again");
  assert.deepEqual(u.offer, { channel: "beta", version: "0.2.150", notes: "Sales chart\nRiven sold", older: false });
  assert.equal(bannerOf(u)?.kind, "update");
});

test("a check that failed: no up to date, no banner, and the next is 6 hours on", async (t) => {
  const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [OFFLINE(), new Error("Couldn't reach GitHub or GitLab")]);
  await started(t, u, settings);
  assert.deepEqual(calls, ["stable (GitHub alone)", "beta"]);
  assert.equal(settings.channel, "beta");
  assert.equal(u.outcome?.kind, "failed");
  assert.doesNotMatch(u.status(Date.now()), /Up to date/);
  assert.equal(u.banner, null);
  assert.equal(u.switchOffer, null);
  assert.equal(u.waiting, false);
  assert.equal(settings.lastCheck, Date.now(), "Last checked moves on: the next is 6 hours on");
});

test("a failed check after a newer build was offered takes the banner away until a check finishes", async (t) => {
  const { u, settings, answers } = setup(t, { channel: "beta" }, [newer("0.2.150")]);
  await started(t, u, settings);
  assert.equal(u.banner?.kind, "update");
  answers.push(new Error("Couldn't reach GitHub or GitLab"));
  await u.checkNow();
  assert.equal(u.banner, null, "the app may no longer keep that build: nothing is offered as if it did");
  assert.equal(u.waiting, false);
  answers.push(newer("0.2.150"));
  await u.checkNow();
  assert.equal(bannerOf(u)?.kind, "update");
});

test("no following move while an update downloads: the channel it restarts on stays", async (t) => {
  const { u, settings, calls, answers } = setup(t, { channel: "beta", follows: true }, [EMPTY, newer("0.2.150")]);
  await started(t, u, settings);
  updater.install = () => new Promise<void>(() => {});
  void u.install();
  await micro();
  assert.equal(u.installJob.working, true);
  calls.length = 0;
  answers.push(newer("0.2.150"));
  await u.checkNow();
  assert.deepEqual(calls, ["beta"], "Stable isn't asked while the install runs");
  assert.equal(settings.channel, "beta");
});

test("a failed check after an empty channel's switch was offered takes the offer away", async (t) => {
  const { u, settings, answers } = setup(t, { channel: "stable" }, [EMPTY, current()]);
  await started(t, u, settings);
  assert.equal(u.banner?.kind, "switch");
  answers.push(new Error("Couldn't reach GitHub or GitLab"));
  await u.checkNow();
  assert.equal(u.banner, null);
});

// ---- cases 1, 2 and 8: the banner

test("Later puts that build away; the offer stays in the place outside Settings and in Settings", async (t) => {
  const { u, settings, answers } = setup(t, { channel: "beta" }, [newer("0.2.150")]);
  await started(t, u, settings);
  assert.equal(u.banner?.kind, "update");
  u.later();
  assert.equal(u.banner, null);
  assert.equal(u.offer?.version, "0.2.150", "still offered there");
  answers.push(newer("0.2.151"));
  await u.checkNow();
  assert.equal(bannerOf(u)?.kind, "update", "another build shows it again");
});

test("an AppImage in a folder it can't write to is told of a new build without an install button", async (t) => {
  const { u, settings } = setup(t, { channel: "beta" }, [newer("0.2.150")], RUN, { how: "readOnly", folder: "/opt" });
  await started(t, u, settings);
  assert.equal(u.banner?.kind === "update" && u.banner.installs, false);
});

test("a copy that doesn't check, and a local build: no banner, nothing asked, Follow does nothing", async (t) => {
  for (const [version, install] of [["0.2.141", { how: "package" }], ["0.1.0", { how: "dev" }], ["0.2.141", { how: "manual" }]] as const) {
    const { u, settings, calls } = setup(t, { channel: "beta", follows: true }, [], version, install);
    await started(t, u, settings);
    u.follow();
    await micro();
    assert.deepEqual(calls, [], `${install.how}: nothing asked`);
    assert.equal(u.banner, null);
    u.stop();
    t.mock.timers.reset();
  }
});
