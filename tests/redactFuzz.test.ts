// Redaction and untrusted text, fuzzed: hostile player names, chat lines, paths and secrets,
// planted in random text with hidden characters around them, through redact.ts, untrusted.ts, the
// bug report builder and the link check. Nothing private comes out, nothing hidden gets through,
// and links only go to the allowed sites. Seeds as in tests/support/prop.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ordinaryName, redact } from "../src/lib/core/redact";
import { cleanBlock, cleanLine, HIDDEN_CHARS, stripHidden } from "../src/lib/core/untrusted";
import { buildReport, issueText, reportMarkdown, type ReportDetails } from "../src/lib/core/bugReport";
import { LINK_SITES, openable } from "../src/lib/core/links";
import { forAll, type Rng } from "./support/prop";

/** Characters that draw nothing: these can sit anywhere, inside a secret too. */
const HIDDEN = ["\u200B", "\u200C", "\u200D", "\u202E", "\u2066", "\uFEFF", "\u00AD", "\u{E0041}", "\u0007"];
/** Terminal colour codes leave visible text behind ("[31m"): only between words, as a log has them. */
const ANSI = ["\u001B[31m", "\u001B[0m"];
const FILLER = ["sold", "to", "from", "Ash Prime Set", "for 20p", "whispered you", "traded with", ":", ",", "(", ")", "\n", "  ", "ok", "Platinum x 17", "R5", "😀", "é", "<!-- note -->", "```", "\\", "/"];

const randomName = (r: Rng) => {
  const a = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const b = a + "0123456789_-.";
  return a[r.int(0, a.length - 1)] + Array.from({ length: r.int(3, 15) }, () => b[r.int(0, b.length - 1)]).join("") + a[r.int(0, 25)];
};
const casing = (r: Rng, s: string) => r.pick([s, s.toLowerCase(), s.toUpperCase()]);
const hex = (r: Rng, n: number) => Array.from({ length: n }, () => "0123456789abcdef"[r.int(0, 15)]).join("");

/** Secrets of every kind, each with the text that must not survive. */
function secrets(r: Rng, self: string, other: string): { text: string; must: string[] }[] {
  const user = randomName(r).replace(/[.]/g, "x");
  const ip = `${r.int(11, 223)}.${r.int(0, 255)}.${r.int(0, 255)}.${r.int(1, 254)}`;
  const jwt = `eyJ${hex(r, 12)}.${hex(r, 20)}.${hex(r, 16)}`;
  const token = hex(r, 8) + "Zq" + hex(r, 8);
  return [
    { text: casing(r, self), must: [self.toLowerCase()] },
    { text: `sold Ash Prime Set to ${casing(r, other)}`, must: [other.toLowerCase()] },
    { text: `${user}${r.int(1, 99)}@example.org`, must: ["@example.org"] },
    { text: jwt, must: [jwt.slice(0, 20)] },
    // A token cut short after its second part (a log line at its length limit).
    { text: jwt.slice(0, jwt.lastIndexOf(".")), must: [jwt.split(".")[1]] },
    { text: `Authorization: Bearer ${token}`, must: [token] },
    { text: `token=${token}`, must: [token] },
    { text: `https://discord.com/api/webhooks/${r.int(1e6, 9e6)}/${token}`, must: [token] },
    { text: ip, must: [ip] },
    { text: hex(r, 24), must: [] }, // checked as "no 16+ hex run" below
    { text: `/home/${user}/.local/share/x`, must: [`/home/${user}`] },
    { text: `C:\\Users\\${user} Name\\AppData`, must: [`Users\\${user}`] },
    // Paths outside a home folder: a drive's label, a folder of the player's own, a share's computer.
    { text: `/mnt/${user}/SteamLibrary/steamapps/common/Warframe/EE.log`, must: [user] },
    { text: `D:${r.pick(["\\", "/"])}${user} Games${r.pick(["\\", "/"])}Warframe${r.pick(["\\", "/"])}EE.log`, must: [user] },
    { text: `"E:/${user} Stuff/x y/EE.log"`, must: [user] },
    { text: `\\\\${user}-PC\\Games\\Warframe`, must: [user] },
    { text: `~/Games/${user}/Warframe/EE.log`, must: [user] },
    { text: `D:\\Games\\${user}'s Stuff\\${user} Smith: denied`, must: [user, "Smith"] },
    { text: r.pick([`//${user}-PC/share/x`, `smb://${user}-PC/share`, `\\\\?\\UNC\\${user}-PC\\share\\x`, `~${user}/Games`, `$HOME/${user}/x`, `%2Fmnt%2F${user}%2Fx`]), must: [user] },
    { text: `/profile/${other}`, must: [other.toLowerCase()] },
  ];
}

/** The user name itself (`name`, one word or more) where a rule reads it with what is around it: a
 *  path whose root holds it (`~name/`, `$name/`, a variable), a folder of its own with a mark and
 *  more glued to it, another player's name glued to it. Each with the text that went with it. */
function userShapes(r: Rng, name: string): { text: string; must: string[] }[] {
  const folder = randomName(r).replace(/[.]/g, "x");
  const tail = randomName(r).replace(/[.]/g, "x");
  const g = r.pick(["-", "."]);
  const mark = r.pick([")", "),", ");", ")(", ",", ";", "(", ") ", ":", "'", "=", "]"]);
  const u = casing(r, name);
  return [
    { text: r.pick([`~${u}/${folder}/x`, `copied to ~${u}/${folder} Stuff/notes/EE.log`, `$${u}/${folder}/x`, `\${${u}}/${folder}/x`, `%${u}%\\${folder}\\x`, `https://warframe.market/profile/K,$${u}/${folder}`, `https://warframe.market/profile/K,~${u}/${folder}/x`]), must: [folder] },
    { text: r.pick([`buyer: ${u}${g}${tail}`, `Ash Prime Set: 20p from ${u}${g}${tail}`, `/w ${u}${g}${tail} hi`, `https://warframe.market/profile/${u}${g}${tail}`, `${tail}${g}${u} whispered you`, `sold Ash Prime Set to ${tail}${g}${u} for 20p`]), must: [tail] },
    { text: r.pick([`(/home/${u}${mark}${folder}`, `C:\\Users\\${u}${mark}${folder} more. x`, `drive_c/users/${u}${mark}${folder}`, `Z:\\home\\${u}${mark}${folder}`, `/run/media/${u}${mark}${folder}/x`, `/mnt/x/${u}${mark}${folder}`, `smb://${u}${mark}${folder}`, `D:\\Games\\${u}${mark}${folder}`, `https://warframe.market/profile/${u}${mark}${folder}`, `buyer: ${u}${mark}${folder}`]), must: [folder] },
  ];
}

/** Random text with the secrets placed in it, and hidden characters scattered (inside them too). */
function plant(r: Rng, parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    for (let i = r.int(0, 3); i > 0; i--) out.push(r.pick(FILLER));
    out.push(p);
    out.push(r.pick([" ", "\n", ", ", ". ", " (", ") ", ` ${r.pick(ANSI)} `]));
  }
  let s = out.join(" ");
  // Hidden characters: between words, and sometimes inside a secret.
  for (let i = r.int(0, 6); i > 0; i--) {
    const at = r.int(0, s.length);
    s = s.slice(0, at) + r.pick(HIDDEN) + s.slice(at);
  }
  return s;
}

const leaks = (out: string, must: string[]) => must.filter((m) => m && out.toLowerCase().includes(m.toLowerCase()));

test("bug reports: nothing private survives the report or the text to paste, and nothing hidden gets through", () => {
  forAll("report", (r, seed) => {
    const self = randomName(r);
    const other = randomName(r);
    if (self.toLowerCase().includes(other.toLowerCase()) || other.toLowerCase().includes(self.toLowerCase())) return;
    const planted = secrets(r, self, other);
    const pick = planted.filter(() => r.bool(0.6));
    const text = plant(r, pick.map((p) => p.text));
    const details: ReportDetails = {
      version: "0.2.18", commit: "abc1234", buildDate: "2026-11-05", channel: "Experimental", os: "linux", arch: "x86_64",
      page: "orders", tennoscope: "connected", fullMode: "off",
      log: [plant(r, pick.map((p) => p.text)), `market: listed for ${other}`, `whisper from ${self}`],
    };
    const report = buildReport({ what: text, steps: plant(r, [other]), expected: "ok" }, details, { self: [self], others: [other] });
    const md = reportMarkdown(report);
    const paste = issueText(report);
    const all = [report.title, report.what, report.steps, report.expected, md, paste].join("\n");
    const must = pick.flatMap((p) => p.must).concat([self, other]);
    // A name split by a hidden character is the name once it's cleaned: the report cleans first.
    assert.deepEqual(leaks(all, must), [], `PROPERTY_SEED=${seed}: leaked ${JSON.stringify(leaks(all, must))} from ${JSON.stringify(text).slice(0, 300)}`);
    assert.ok(!/\b[0-9a-f]{16,}\b/i.test(all), `PROPERTY_SEED=${seed}: a long hex id survived`);
    HIDDEN_CHARS.lastIndex = 0;
    const found = [...(report.what + report.steps + md + paste).matchAll(HIDDEN_CHARS)].map((m) => `U+${m[0].codePointAt(0)!.toString(16)} at ${m.index}`);
    assert.deepEqual(found, [], `PROPERTY_SEED=${seed}: hidden characters in ${JSON.stringify(md.slice(0, 600))}`);
    HIDDEN_CHARS.lastIndex = 0;
    assert.ok(!/<!--/.test(report.what + report.steps), `PROPERTY_SEED=${seed}: an HTML comment`);
  }, 1500);
});

test("bug reports: this computer's user name, held or seen in a home folder, survives as no word, in any shape or case", () => {
  forAll("user", (r, seed) => {
    const words = r.bool(0.4) ? [randomName(r), randomName(r)] : [randomName(r)];
    const user = words.join(" ");
    if (words.some((w) => ordinaryName(w))) return;
    const one = !user.includes(" ");
    const sep = () => r.pick(["\\", "/"]);
    const shapes = [
      casing(r, user),
      `${casing(r, user)}'s game froze`,
      `/home/${user}/.local/share/x`,
      `C:${sep()}Users${sep()}${user}${sep()}AppData`,
      `drive_c/users/${user}`,
      `D:\\Games\\Dev ${user}`,
      `'D:\\Games\\${user}'`,
      `"/mnt/${user} see EE.log`,
      one ? `~${user}/Games` : `~${user}/x`,
      `${user}-PC`,
      `${casing(r, user)}@desktop:~$ ls`,
      `@${user} hi`,
      `file:///C:/Users/${words.join("%20")}/x`,
    ];
    const pick = shapes.filter(() => r.bool(0.5));
    // Known from a held path, or only from a home folder one of the lines writes.
    const held = r.bool(0.5);
    const log = [plant(r, pick), held ? "ok" : `found at /home/${user}/.local/share/Steam/x`];
    const report = buildReport({ what: plant(r, pick.slice().reverse()), steps: casing(r, words[0]), expected: "ok" }, { version: "0.2.18", commit: "abc1234", buildDate: "", channel: null, os: "linux", arch: "x86_64", page: "Orders", tennoscope: "connected", fullMode: "off", log }, held ? { user: [user] } : {});
    const all = [report.title, report.what, report.steps, reportMarkdown(report)].join("\n");
    for (const w of [user, ...words]) {
      const word = new RegExp(`(?<![\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "iu");
      assert.ok(!word.test(all), `PROPERTY_SEED=${seed}: ${JSON.stringify(w)} survived in ${JSON.stringify(all.slice(0, 600))}`);
    }
  }, 1500);
});

test("redact: knowing this computer's user name never lets out what was hidden without it, glued to a secret or not", () => {
  forAll("user-secrets", (r, seed) => {
    const self = randomName(r);
    const other = randomName(r);
    // The user name: a name of its own, or the same as the in-game name or another player's.
    const user = r.pick([randomName(r), randomName(r), self, other]);
    if (user !== self && user !== other && [self, other].some((n) => n.toLowerCase().includes(user.toLowerCase()) || user.toLowerCase().includes(n.toLowerCase()))) return;
    for (const { text, must } of secrets(r, self, other)) {
      const glue = r.pick(["-", ".", "_", "", " ", "=", ":", "/"]);
      const t = r.pick([`${user}${glue}${text}`, `${text}${glue}${user}`, text.replace(/=|: /, (m) => `${m}${user}${glue}`)]);
      const names = { self: [self], others: [other] };
      const without = redact(t, names);
      const known = redact(t, { ...names, user: r.pick([[user], [casing(r, user)], [`${user} ${randomName(r)}`]]) });
      // Whatever the text kept hidden without the user name, it keeps hidden with it.
      const hidden = must.filter((m) => m && !without.toLowerCase().includes(m.toLowerCase()));
      assert.deepEqual(leaks(known, hidden), [], `PROPERTY_SEED=${seed}: ${JSON.stringify(t)} → ${JSON.stringify(known)} (without: ${JSON.stringify(without)})`);
      // An id or a long hex run that went stays gone.
      if (!/\b[0-9a-f]{16,}\b/i.test(without)) assert.ok(!/\b[0-9a-f]{16,}\b/i.test(known), `PROPERTY_SEED=${seed}: ${JSON.stringify(known)}`);
    }
    // The user name itself in a path's root or in another player's name: what went with it
    // without the name known (the path's folders, the rest of the player's name) goes with it known.
    // One word or several.
    const name = r.bool(0.3) ? `${user} ${randomName(r)}` : user;
    for (const { text, must } of userShapes(r, name)) {
      const names = { self: [self], others: [other] };
      const without = redact(text, names);
      const known = redact(text, { ...names, user: r.pick([[name], [casing(r, name)]]) });
      const hidden = must.filter((m) => m && !without.toLowerCase().includes(m.toLowerCase()));
      assert.deepEqual(leaks(known, hidden), [], `PROPERTY_SEED=${seed}: ${JSON.stringify(text)} → ${JSON.stringify(known)} (without: ${JSON.stringify(without)})`);
    }
  }, 1500);
});

/** Lines each rule reads by an anchor word (a lead, a scheme, a share's or a home's root, a method),
 *  with random names, hosts and folders, and the secrets and shapes above. */
function anchored(r: Rng): string {
  const P = () => casing(r, randomName(r).replace(/[.]/g, "x"));
  const F = () => randomName(r).replace(/[.]/g, "x");
  const self = randomName(r);
  const other = randomName(r);
  const lines = [
    `buyer: ${P()}`, `"seller": "${P()}"`, `partner=${P()}`, `username: ${P()}`, `ingame_name: ${P()}`, `player: ${P()}`,
    `sold Ash Prime Set to ${P()}`, `bought Ash Prime Set from ${P()}`, `traded with ${P()}`, `gave Ash Prime Set to ${P()}`, `trading Ash Prime Set with ${P()}`, `invited by ${P()}`, `whispering with ${P()}`, `chatted with ${P()}`, `+rep to ${P()}`,
    `${P()} whispered you`, `${P()} messaged you`, `3 people whispered you: ${P()}, ${P()}, ${P()}`, `Ash Prime Set: 20p from ${P()}`, `Couldnt give ${P()} +rep`,
    `/tell ${P()} hi`, `/w ${P()} hi`, `/whisper ${P()} hi`, `/invite ${P()}`, `/r ${P()} ok`, `/t ${P()} ok`,
    `https://warframe.market/profile/${P()}`, `https://warframe.market/orders/user/${P()}`, `/reviews/${P()}`, `/review/${P()}`, `/chats/with/${P()}`, `/users/${P()}`,
    `siteChat: ${P()} messaged you on warframe.market (${P()}: ${F()} hi)`,
    `smb://${F()}/${F()}/x`, `\\\\?\\UNC\\${F()}\\${F()}\\x`, `\\\\${F()}\\${F()}\\x`, `//${F()}/${F()}/x`, `file://${F()}/${F()}/x`, `file:///D:/${F()}/x`,
    `/run/media/${F()}/${F()}/x`, `/var/home/${F()}/${F()}/x`, `/home/${F()}/${F()}/x`, `/Users/${F()}/${F()}`, `/media/${F()}/${F()}/x`, `C:\\Documents and Settings\\${F()}\\${F()}\\x`, `C:\\Users\\${F()}\\${F()}\\x`, `Z:\\home\\${F()}\\${F()}`, `drive_c/users/${F()}/${F()}/x`,
    `GET /api/${F()}/x`, `PATCH https://api.warframe.market/v2/${F()}`, `POST /v1/${F()}/x`, `D:\\Games\\${F()}\\x`, `~/${F()}/x`, `~${F()}/${F()}/x`, `$HOME/${F()}/x`, `\${HOME}/${F()}/x`, `%APPDATA%\\${F()}\\x`, `%2Fmnt%2F${F()}%2Fx`,
    ...secrets(r, self, other).map((s) => s.text),
    ...userShapes(r, randomName(r)).map((s) => s.text),
  ];
  return Array.from({ length: r.int(1, 3) }, () => r.pick(lines)).join(r.pick(["\n", " ", ", "]));
}

/** Every word redaction may meet in its own rules: the words of redact.ts. */
const RULE_SOURCE_WORDS = [...new Set(readFileSync("src/lib/core/redact.ts", "utf8").match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [])];
/** The words of `s`, apart from the placeholders redaction writes. */
const wordsOf = (s: string) => s.replace(/\[[a-z][a-z ]*\]/g, " ").split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length >= 2);

test("redact: a user name that is a word of the text or of the rules never lets out what was hidden without it", () => {
  forAll("user-words", (r, seed) => {
    const t = anchored(r);
    const own = wordsOf(t).filter((w) => w.length >= 3);
    const word = () => (own.length && r.bool(0.6) ? r.pick(own) : r.pick(RULE_SOURCE_WORDS));
    // Two or three words that stand next to each other in the text, short ones too.
    const all = t.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    const at = r.int(0, Math.max(0, all.length - 2));
    const run = all.slice(at, at + r.int(2, 3)).join(" ") || word();
    // One word, two words of the text or the rules, one with a made-up word, or a run of the text's.
    const user = casing(r, r.pick([word(), word(), `${word()} ${word()}`, `${word()} ${randomName(r)}`, `${randomName(r)} ${word()}`, run, run]));
    const names = r.pick([{}, { self: [randomName(r)], others: [randomName(r)] }]);
    // Known as held, or learned only from a home folder another line of the log writes.
    const held = r.bool(0.7);
    const line = held ? t : t.replace(/\n/g, " ");
    const without = redact(line, names);
    const known = held
      ? redact(line, { ...names, user: [user] })
      : buildReport({ what: "x", steps: "", expected: "" }, { version: "0.2.18", commit: "abc1234", buildDate: "", channel: null, os: "linux", arch: "x86_64", page: "Orders", tennoscope: "connected", fullMode: "off", log: [line, `found at /home/${user.split(" ")[0]}/.local/share/Steam/x`] }, names).details!.log[0];
    const shown = (out: string) => new Set(wordsOf(out).map((w) => w.toLowerCase()));
    const before = shown(without);
    const hidden = [...new Set(wordsOf(line).map((w) => w.toLowerCase()))].filter((w) => !before.has(w));
    const after = shown(known);
    assert.deepEqual(hidden.filter((w) => after.has(w)), [], `PROPERTY_SEED=${seed}: user ${JSON.stringify(user)}: ${JSON.stringify(t)} → ${JSON.stringify(known)} (without: ${JSON.stringify(without)})`);
  }, 1500);
});

test("redact: knowing this computer's user name changes nothing in a text that doesn't hold it", () => {
  // Short words and runs of one or two letters (what a name looks like while the rules run), the
  // marks, placeholders and real words, glued every way, after the leads of paths and names.
  const TOKENS = ["u", "U", "Q", "QQ", "uQ", "uQQQ", "Qu", "q", "Z", "ZZ", "QZZ", "Zq", "X", "XJ", "J", "K", "KV", "V", "B", "G", "H", "C", "a", "I", "x", "zz", "[usr]", "[plyusr]", "[usa]", "[plyusa]", "[user]", "[player]", "[you]", "Brynwood", "word", "it", "the"];
  const GLUE = [" ", " ", "-", ".", "'", "/", "\\", "%20", "%2F", ", ", ") ", ":", "=", ""];
  const LEADS = ["", "buyer: ", "20p from ", "/w ", "https://warframe.market/profile/", "sold Ash Prime Set to ", "/home/", "~", "$", "C:\\Users\\", "Z:\\home\\", "drive_c/users/", "/mnt/x/", "D:\\Games\\", "(/home/", "give ", "x "];
  forAll("user-absent", (r, seed) => {
    const self = randomName(r);
    const other = randomName(r);
    const user = r.pick([randomName(r), `${randomName(r)} ${randomName(r)}`, self, other]);
    let t = r.pick(LEADS);
    for (let k = r.int(1, 6); k > 0; k--) t += r.pick(TOKENS) + (k > 1 ? r.pick(GLUE) : "");
    t += r.pick(["", " whispered you", " +rep", "/x/y", " see EE.log", ")"]);
    if (user.split(" ").some((w) => t.toLowerCase().includes(w.toLowerCase()))) return;
    const names = r.pick([{}, { self: [self], others: [other] }]);
    assert.equal(redact(t, { ...names, user: [casing(r, user)] }), redact(t, names), `PROPERTY_SEED=${seed}: ${JSON.stringify(t)}, user ${JSON.stringify(user)}`);
  }, 1500);
});

test("redact: known names go in any case and next to any punctuation; names with regex characters don't break it", () => {
  forAll("names", (r, seed) => {
    const name = randomName(r) + r.pick(["", ".", "-x", "_"]);
    const around = r.pick(["(", "[", "\"", "'", " ", ":", ",", "\uE000", "\n"]);
    const after = r.pick([")", "]", "\"", "'", " ", ":", ",", "\uE000", "\n", "."]);
    const out = redact(`x${around}${casing(r, name)}${after}y`, { others: [name, "a(b", "c+d", "e*"] });
    assert.ok(!out.toLowerCase().includes(name.toLowerCase()), `PROPERTY_SEED=${seed}: ${JSON.stringify(out)}`);
  }, 3000);
});

test("untrusted text: cleaned text holds no hidden or control character, is stable, and is cut by whole characters", () => {
  forAll("untrusted", (r, seed) => {
    const parts = Array.from({ length: r.int(0, 30) }, () => r.pick([...HIDDEN, ...ANSI, ...FILLER, "\r\n", "\r", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", "\u{1F3F3}\uFE0F\u200D\u{1F308}", "a\u0301"]));
    const s = parts.join("");
    const clean = stripHidden(s);
    HIDDEN_CHARS.lastIndex = 0;
    assert.ok(!HIDDEN_CHARS.test(clean), `PROPERTY_SEED=${seed}: ${JSON.stringify(clean)}`);
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\r]/.test(clean), `PROPERTY_SEED=${seed}: a control character`);
    assert.equal(stripHidden(clean), clean, `PROPERTY_SEED=${seed}: not stable`);
    const max = r.int(1, 20);
    for (const c of [cleanLine(s, max), cleanBlock(s, max)]) {
      if (c == null) continue;
      assert.ok([...c].length <= max, `PROPERTY_SEED=${seed}: ${[...c].length} > ${max}`);
      // Never half an emoji: no lone surrogate.
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(c), `PROPERTY_SEED=${seed}: a split character`);
    }
  }, 3000);
});

test("links: only https, only the allowed sites and paths, whatever tricks the address uses", () => {
  const hosts = ["warframe.market", "wiki.warframe.com", "github.com", "gitlab.com", "overframe.gg", "noxsframe.com", "evil.example", "warframe.market.evil.example", "evil-warframe.market", "WARFRAME.MARKET", "warframe.market.", "xn--warframe-market-xyz.example", "127.0.0.1", "localhost"];
  const paths = ["/", "/items/khra", "/ShezissSnake/orbiter/issues/new", "/ShezissSnake/../someone/else", "/sheziss-group/myorbiter/-/work_items/new", "/sheziss-group/myorbiter/../../someone/else", "/someone/else", "/%2e%2e/x", "//evil.example/x", "/x?next=https://evil.example"];
  forAll("links", (r, seed) => {
    const scheme = r.pick(["https://", "http://", "javascript:", "file://", "HTTPS://", "https:/", "https:\\\\", "  https://"]);
    const userinfo = r.pick(["", "", "", "user@", "user:pass@", "warframe.market@"]);
    const port = r.pick(["", "", "", ":443", ":8080"]);
    const url = `${scheme}${userinfo}${r.pick(hosts)}${port}${r.pick(paths)}${r.pick(["", "#frag", "?q=1"])}`;
    const ok = openable(url);
    if (ok == null) return;
    const u = new URL(ok);
    const site = LINK_SITES.find((s) => s.host === u.hostname);
    assert.ok(u.protocol === "https:" && !u.username && !u.password && !u.port, `PROPERTY_SEED=${seed}: ${url} → ${ok}`);
    assert.ok(site && u.pathname.startsWith(site.path), `PROPERTY_SEED=${seed}: ${url} → ${ok}`);
  }, 3000);
});

test("stripHidden: a hidden character split by another one doesn't come back", () => {
  assert.equal(stripHidden("a\uDB40\u200B\uDC41b"), "ab");
  assert.equal(stripHidden("a\uDB40\u200B\u200C\uDC41b"), "ab");
  assert.equal(stripHidden("😀"), "😀", "a real pair stays");
});
