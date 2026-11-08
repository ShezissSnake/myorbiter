// A bug report, made in the app and sent by the player. MyOrbiter never posts it itself: there's no
// token and no network write. Open on GitLab puts the issue's text on the clipboard (the sections of
// the issue template, .gitlab/issue_templates/Bug report.md, and its labels line) and opens a blank
// new issue: nothing of the report is in the page's address, so gitlab.com receives it only once
// the player pastes it, adds a title and presses Create issue. Copy report puts it on the clipboard
// as Markdown, to send another way.
//
// What goes in is the player's own words (what happened, how to make it happen, what they
// expected) and, if they leave "Include technical details" on, a plain-text block they can read in
// full first: the version, the system, the page, TennoScope's state and the log's last lines.
// Everything is cleaned on the way in (core/untrusted.ts: no hidden characters, no HTML comments)
// and redacted (core/redact.ts: no sign-ins, addresses, ids or players' names). The technical block
// goes in a `text` code block no line of it can close, so GitLab shows it as text, never as
// Markdown or HTML; a line of the player's own that GitLab would run as a quick action (`/close`,
// `/label …`) is escaped and shows as typed.

import { redact, type RedactOptions } from "./redact";
import { cleanBlock, cleanLine, stripHidden, stripHtmlComments } from "./untrusted";

/** The project's new-issue page. Its host and path are in the opener's allowed sites (core/links.ts). */
export const NEW_ISSUE = "https://gitlab.com/sheziss-group/myorbiter/-/work_items/new";
/** The issue template (its file name without .md), and its section headings: the template and this
 *  list must agree (tests/bugReport.test.ts). */
export const TEMPLATE = "Bug report";
export const SECTIONS = { what: "What happened", steps: "Steps to reproduce", expected: "What you expected", details: "Technical details" } as const;
/** The labels a report gets, as the template's last line sets them (where the reporter may). */
export const LABELS = "/label ~bug ~needs-triage";
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

/** The technical block, as plain text. */
export function detailsText(d: ReportDetails): string {
  const lines = [
    `MyOrbiter ${d.version} (${d.commit}${d.buildDate ? `, ${d.buildDate}` : ""})`,
    `Channel: ${d.channel ?? "not known in this build"}`,
    `System: ${[d.os, d.arch].filter(Boolean).join(" ")}`,
    `Page: ${d.page}`,
    `TennoScope: ${d.tennoscope}`,
    `Full mode: ${d.fullMode}`,
    "",
  ];
  if (!d.log.length) lines.push("Log: no lines (MyOrbiter's log is only kept by the desktop app).");
  else {
    lines.push(`Log, last ${d.log.length} line${d.log.length === 1 ? "" : "s"} (sign-ins, addresses, ids and players' names hidden):`);
    lines.push(...d.log);
  }
  return lines.join("\n");
}

/** The player's text, with any line GitLab would run as a quick action escaped ("\/close" shows as
 *  "/close" and does nothing). */
export const noQuickActions = (s: string) => s.replace(/^([ \t]*)\//gm, "$1\\/");

/** The longest run of backticks in some text. */
const longestTicks = (s: string) => Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));

/** The report's sections in Markdown, as the template has them: the player's words, then the
 *  details (`details`: their text, "" when left out) in a text code block. */
function sections(what: string, steps: string, expected: string, details: string): string[] {
  const out = [`### ${SECTIONS.what}`, "", noQuickActions(what) || "_(not filled in)_"];
  if (steps) out.push("", `### ${SECTIONS.steps}`, "", noQuickActions(steps));
  if (expected) out.push("", `### ${SECTIONS.expected}`, "", noQuickActions(expected));
  if (details) {
    const fence = "`".repeat(Math.max(3, longestTicks(details) + 1));
    out.push("", `### ${SECTIONS.details}`, "", `${fence}text`, details, fence);
  }
  out.push("", "_Made with MyOrbiter's Report a bug._");
  return out;
}

/** The page Open on GitLab opens: a blank new issue. Nothing of the report is in its address, so
 *  gitlab.com receives none of it until the player pastes it in and presses Create issue. */
export const NEW_ISSUE_PAGE = `${NEW_ISSUE}?${encodeURIComponent("issue[issue_type]")}=issue`;

/** What Open on GitLab puts on the clipboard, to paste into the new issue's description: the
 *  template's sections, then its labels line. The title is typed on GitLab (`Report.title`
 *  suggests one). */
export function issueText(r: Report): string {
  return [...sections(r.what, r.steps, r.expected, r.details ? detailsText(r.details) : ""), "", LABELS].join("\n") + "\n";
}

/** The report as Markdown, for Copy report: the title, then the issue's sections, the details in a
 *  text code block. */
export function reportMarkdown(r: Report): string {
  return [`## ${r.title}`, "", ...sections(r.what, r.steps, r.expected, r.details ? detailsText(r.details) : "")].join("\n") + "\n";
}
