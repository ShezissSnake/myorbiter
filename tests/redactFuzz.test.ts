// Redaction and untrusted text, fuzzed: hostile player names, chat lines, paths and secrets,
// planted in random text with hidden characters around them, through redact.ts, untrusted.ts, the
// bug report builder and the link check. Nothing private comes out, nothing hidden gets through,
// and links only go to the allowed sites. Seeds as in tests/support/prop.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/lib/core/redact";
import { cleanBlock, cleanLine, HIDDEN_CHARS, stripHidden } from "../src/lib/core/untrusted";
import { buildReport, issueLink, NEW_ISSUE, reportMarkdown, type ReportDetails } from "../src/lib/core/bugReport";
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
    { text: `/profile/${other}`, must: [other.toLowerCase()] },
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

test("bug reports: nothing private survives the report, its Markdown or its link, and nothing hidden gets through", () => {
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
    const link = issueLink(report);
    const all = [report.title, report.what, report.steps, report.expected, md, decodeURIComponent(link.url)].join("\n");
    const must = pick.flatMap((p) => p.must).concat([self, other]);
    // A name split by a hidden character is the name once it's cleaned: the report cleans first.
    assert.deepEqual(leaks(all, must), [], `PROPERTY_SEED=${seed}: leaked ${JSON.stringify(leaks(all, must))} from ${JSON.stringify(text).slice(0, 300)}`);
    assert.ok(!/\b[0-9a-f]{16,}\b/i.test(all), `PROPERTY_SEED=${seed}: a long hex id survived`);
    HIDDEN_CHARS.lastIndex = 0;
    const found = [...(report.what + report.steps + md).matchAll(HIDDEN_CHARS)].map((m) => `U+${m[0].codePointAt(0)!.toString(16)} at ${m.index}`);
    assert.deepEqual(found, [], `PROPERTY_SEED=${seed}: hidden characters in ${JSON.stringify(md.slice(0, 600))}`);
    HIDDEN_CHARS.lastIndex = 0;
    assert.ok(!/<!--/.test(report.what + report.steps), `PROPERTY_SEED=${seed}: an HTML comment`);
    assert.ok(link.url.startsWith(NEW_ISSUE + "?"), `PROPERTY_SEED=${seed}: ${link.url.slice(0, 80)}`);
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
