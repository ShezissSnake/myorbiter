// A bug report, made in the app and sent by the player. MyOrbiter never posts it itself: there's no
// token and no network write. Open on GitHub opens the repository's issue form in the player's
// browser with its fields filled in (.github/ISSUE_TEMPLATE/bug_report.yml; the report is in the
// link, so github.com receives it when the page opens, before the player presses Submit, which is
// what they do there after reading it), or Copy report puts it on the clipboard as Markdown to send
// another way.
//
// What goes in is the player's own words (what happened, how to make it happen, what they
// expected) and, if they leave "Include technical details" on, a plain-text block they can read in
// full first: the version, the system, the page, TennoScope's state and the log's last lines.
// Everything is cleaned on the way in (core/untrusted.ts: no hidden characters, no HTML comments)
// and redacted (core/redact.ts: no sign-ins, addresses, ids or players' names). The technical block
// goes into the form's `render: text` field, so GitHub shows it as text, never as Markdown or HTML.

import { redact, type RedactOptions } from "./redact";
import { cleanBlock, cleanLine, stripHidden, stripHtmlComments } from "./untrusted";

/** The repository's new-issue page. Its host and path are in the opener's allowed sites (core/links.ts). */
export const NEW_ISSUE = "https://github.com/ShezissSnake/myorbiter/issues/new";
/** The issue form, and its fields' ids: the form and this list must agree (tests/bugReport.test.ts). */
export const TEMPLATE = "bug_report.yml";
export const FIELDS = { what: "what", steps: "steps", expected: "expected", details: "details" } as const;
/** The form's field labels, which Copy report uses as its headings. */
export const SECTIONS = { what: "What happened", steps: "Steps to reproduce", expected: "What you expected", details: "Technical details" } as const;
/** GitHub and browsers handle links up to about 8,000 characters; this leaves room. */
export const URL_MAX = 7500;
/** How many of the log's last lines a report offers. */
export const LOG_LINES = 50;
/** The most each field keeps. */
export const MAX = { title: 90, what: 4000, steps: 4000, expected: 2000, logLine: 400 } as const;

export interface ReportInput {
  what: string;
  steps: string;
  expected: string;
}

/** The technical details, as gathered when the dialog opens. */
export interface ReportDetails {
  version: string;
  /** The commit it was built from, and its date. */
  commit: string;
  buildDate: string;
  /** Stable, Beta or Experimental; null where this build doesn't know (no in-app updates yet). */
  channel: string | null;
  os: string;
  arch: string;
  /** The page open behind the dialog. */
  page: string;
  /** "connected", "running, not reporting", "not running", "not used here". */
  tennoscope: string;
  /** "on", "off" or "unknown". */
  fullMode: string;
  /** MyOrbiter's log, last lines (already redacted once by applog.rs). */
  log: string[];
}

/** The report as it will be sent: every field cleaned and redacted. */
export interface Report {
  title: string;
  what: string;
  steps: string;
  expected: string;
  /** Null when technical details are left out. */
  details: ReportDetails | null;
}

/** The player's text, cleaned: no hidden characters, no HTML comments, nothing private, capped. */
export function cleanUserText(s: string, max: number, names: RedactOptions = {}): string {
  // Hidden characters first: one inside "<!--" would otherwise hide a comment from the check.
  const c = cleanBlock(stripHtmlComments(stripHidden(s ?? "")), max);
  return c ? redact(c, names) : "";
}

/** Text that goes inside a code block: a run of backticks can't close it. */
const inert = (s: string) => s.replace(/`{3,}/g, (m) => "'".repeat(m.length));

/** The details, cleaned and redacted line by line. */
export function cleanDetails(d: ReportDetails, names: RedactOptions = {}): ReportDetails {
  const line = (v: string, max = 80) => inert(redact(cleanLine(v, max) ?? "", names));
  return {
    version: line(d.version, 40) || "unknown",
    commit: line(d.commit, 40) || "unknown",
    buildDate: line(d.buildDate, 20),
    channel: d.channel ? line(d.channel, 30) || null : null,
    os: line(d.os, 30) || "unknown",
    arch: line(d.arch, 30),
    page: line(d.page, 40) || "unknown",
    tennoscope: line(d.tennoscope, 40) || "unknown",
    fullMode: line(d.fullMode, 20) || "unknown",
    log: d.log.slice(-LOG_LINES).map((l) => inert(redact(cleanLine(l, MAX.logLine) ?? "", names))).filter(Boolean),
  };
}

/** The whole report, cleaned and redacted. `include`: whether the technical details go in. */
export function buildReport(input: ReportInput, details: ReportDetails | null, names: RedactOptions = {}): Report {
  const what = cleanUserText(input.what, MAX.what, names);
  const first = (cleanLine(what.split("\n")[0] ?? "", MAX.title) ?? "").replace(/[.:;,\s]+$/, "");
  return {
    title: first || "Bug report",
    what,
    steps: cleanUserText(input.steps, MAX.steps, names),
    expected: cleanUserText(input.expected, MAX.expected, names),
    details: details ? cleanDetails(details, names) : null,
  };
}

/**
 * The technical block, as plain text. `dropped`: how many of the oldest log lines were left out
 * to keep the link short (said in the block, so a reader knows).
 */
export function detailsText(d: ReportDetails, dropped = 0): string {
  const lines = [
    `MyOrbiter ${d.version} (${d.commit}${d.buildDate ? `, ${d.buildDate}` : ""})`,
    `Channel: ${d.channel ?? "not known in this build"}`,
    `System: ${[d.os, d.arch].filter(Boolean).join(" ")}`,
    `Page: ${d.page}`,
    `TennoScope: ${d.tennoscope}`,
    `Full mode: ${d.fullMode}`,
    "",
  ];
  const kept = d.log.slice(dropped);
  if (!d.log.length) lines.push("Log: no lines (MyOrbiter's log is only kept by the desktop app).");
  else {
    lines.push(`Log, last ${kept.length} line${kept.length === 1 ? "" : "s"} (sign-ins, addresses, ids and players' names hidden):`);
    if (dropped) lines.push(`(${dropped} earlier line${dropped === 1 ? "" : "s"} left out to keep the link short; Copy report has them all)`);
    lines.push(...kept);
  }
  return lines.join("\n");
}

const enc = encodeURIComponent;

/** The prefilled new-issue link, for the given text: the form's name, the title and each field by its id. */
function linkFor(title: string, fields: [id: string, value: string][]): string {
  const q = [`template=${enc(TEMPLATE)}`, `title=${enc(title)}`, ...fields.filter(([, v]) => v).map(([k, v]) => `${enc(k)}=${enc(v)}`)];
  return `${NEW_ISSUE}?${q.join("&")}`;
}

/** Cuts a field to `n` characters (by code point), saying so. */
const cutTo = (s: string, n: number) => {
  const chars = [...s];
  return chars.length <= n ? s : `${chars.slice(0, Math.max(0, n)).join("").trimEnd()}\n[cut to fit the link: Copy report has it all]`;
};

export interface IssueLink {
  url: string;
  /** Log lines left out to fit. */
  dropped: number;
  /** A field of the player's own was cut to fit. */
  cut: boolean;
}

/**
 * The link that opens the issue form on GitHub with everything filled in, at most `max`
 * characters: the oldest log lines go first, then (only if the player wrote a great deal) the
 * end of their longest field.
 */
export function issueLink(r: Report, max = URL_MAX): IssueLink {
  const make = (what: string, steps: string, expected: string, dropped: number) =>
    linkFor(r.title, [
      [FIELDS.what, what],
      [FIELDS.steps, steps],
      [FIELDS.expected, expected],
      [FIELDS.details, r.details ? detailsText(r.details, dropped) : ""],
    ]);
  const lines = r.details?.log.length ?? 0;
  let dropped = 0;
  let url = make(r.what, r.steps, r.expected, 0);
  // Drop log lines oldest first: a halving search for the fewest to drop.
  if (url.length > max && lines) {
    let lo = 1;
    let hi = lines;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (make(r.what, r.steps, r.expected, mid).length <= max) hi = mid;
      else lo = mid + 1;
    }
    dropped = lo;
    url = make(r.what, r.steps, r.expected, dropped);
  }
  if (url.length <= max) return { url, dropped, cut: false };
  // Still too long: the player's own fields, longest first, cut down until it fits.
  let f = { what: r.what, steps: r.steps, expected: r.expected };
  for (let guard = 0; guard < 40 && make(f.what, f.steps, f.expected, dropped).length > max; guard++) {
    const over = make(f.what, f.steps, f.expected, dropped).length - max;
    const key = (["what", "steps", "expected"] as const).reduce((a, b) => (enc(f[b]).length > enc(f[a]).length ? b : a));
    // Encoded text is up to ~9 characters per character: cut by enough to get under, with room.
    const chars = [...f[key]].length;
    f = { ...f, [key]: cutTo(f[key], Math.max(0, chars - Math.ceil(over / 3) - 60)) };
  }
  url = make(f.what, f.steps, f.expected, dropped);
  if (url.length > max) url = linkFor(r.title, [[FIELDS.what, "(too long for a link: use Copy report and paste it here)"]]);
  return { url, dropped, cut: true };
}

/** The longest run of backticks in some text. */
const longestTicks = (s: string) => Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));

/** The report as Markdown, for Copy report: the title, then the form's sections, the details in a
 *  text code block. */
export function reportMarkdown(r: Report): string {
  const out = [`## ${r.title}`, "", `### ${SECTIONS.what}`, "", r.what || "_(not filled in)_"];
  if (r.steps) out.push("", `### ${SECTIONS.steps}`, "", r.steps);
  if (r.expected) out.push("", `### ${SECTIONS.expected}`, "", r.expected);
  if (r.details) {
    const text = detailsText(r.details);
    const fence = "`".repeat(Math.max(3, longestTicks(text) + 1));
    out.push("", `### ${SECTIONS.details}`, "", `${fence}text`, text, fence);
  }
  out.push("", "_Made with MyOrbiter's Report a bug._");
  return out.join("\n") + "\n";
}
