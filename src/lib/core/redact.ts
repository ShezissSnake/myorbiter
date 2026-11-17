// What a bug report must never carry, taken out of every line that goes into one (the log's last
// lines, and the player's own words too). MyOrbiter's log is private to the player (applog.rs keeps
// it readable by them only) and names trades and partners; a report is public. The log's lines are
// already passed through applog::redact when they're written (sign-ins); this goes further:
//
// - sign-ins and secrets: JWTs, "Bearer …"/"JWT …"/"token …", key=value pairs whose key names a
//   token, password, cookie, session, nonce or the like, Cookie and Authorization headers;
// - Discord, Slack and other webhook addresses;
// - e-mail addresses and IP addresses (v4 and v6);
// - account and user ids: long hex runs (warframe.market's and the game's ids are 24 hex digits),
//   and long opaque runs of letters and digits;
// - the user name in home-folder paths (/home/<name>, /Users/<name>, C:\Users\<name>…);
// - the folder names in any other file path of a shape it recognises, wherever it points (another
//   drive, a mount, a network share): see "paths" below for the shapes and what stays;
// - the player's in-game name and any other name MyOrbiter knows (trade partners, people who
//   whispered), wherever they appear;
// - this computer's user name, when MyOrbiter knows it (the name of the home folder in a path it
//   holds or in the report's lines: "user names" at the end), wherever it stands as a word;
// - names in whisper, trade and profile lines, by their shape, for names MyOrbiter doesn't know.
//
// It errs on the side of hiding: a report with "[player]" where an item name was is still useful;
// one with a stranger's name or a sign-in in it is not.

export interface RedactOptions {
  /** The player's own in-game name(s), if known: shown as "[you]". */
  self?: readonly (string | null | undefined)[];
  /** Other players' names MyOrbiter knows (trade partners, whispers): shown as "[player]". */
  others?: readonly (string | null | undefined)[];
  /** The name of this computer's home folder (the account's user name), as the paths MyOrbiter
   *  holds name it (`homeNames`) or a home folder in the report's own lines does
   *  (`homeNamesIn`): shown as "[user]", the path rule's mark, wherever it stands as a word, unless
   *  it is an ordinary word (`ordinaryName`). Held for the making of one report: never saved,
   *  logged or sent. */
  user?: readonly (string | null | undefined)[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** This computer's user name while the rules run, and the marks for an in-game name that is also it:
 *  chosen for each text from letters and marks the text doesn't hold, so that what turns them into
 *  "[user]" at the end (`un`) touches nothing the text had.
 *  - `standIn`: the name with its first letter or digit written as one plain letter (`a`) and the
 *    rest as another (`b`), its spaces and marks as they are ("Orren O'Hal" as "abbbb b'bbb"), so
 *    that each rule reads it as it reads the name and takes with it what it takes with the name. It
 *    names no one, is no folder the path rule keeps and no word the rules for names pass over.
 *  - `self`, `other`: an in-game name (the player's, or another player's) that is also the user
 *    name, as a mark every rule reads as it reads "[you]" or "[player]" (as long, in brackets, and
 *    the second runs on in a path as "[player]" does).
 *  - `un`: the marks, the stand-ins left at the end and what is left of one a rule took part of, as
 *    "[user]" (an encoded slash, colon or space before one is no letter, as for the name). */
type StandIn = { standIn: (m: string) => string; whole: RegExp; self: string; other: string; cut: RegExp; un: (s: string) => string };
const standInWith = (a: string, b: string, self: string, other: string): StandIn => {
  const bare = "(?<![\\p{L}\\p{N}_](?<!%(?:2[Ff0]|5[Cc]|3[Aa])))";
  const run = new RegExp(`\\[user\\](?:(?:\\s|%20)+${b}+)+(?![\\p{L}\\p{N}_])`, "gu");
  const one = new RegExp(`${bare}${a}${b}*(?:(?:%20|[\\s'.-])+${b}+)*(?![\\p{L}\\p{N}_])`, "gu");
  const rest = new RegExp(`${bare}${b}{2,}(?![\\p{L}\\p{N}_])`, "gu");
  return {
    standIn: (m) => m.replace(/%20|[\p{L}\p{M}\p{N}_]/gu, (c) => (c === "%20" ? c : b)).replace(b, a),
    whole: new RegExp(`^${a}${b}*(?:(?:%20|[^\\p{L}\\p{N}_])+${b}+)*$`, "u"),
    self,
    other,
    cut: new RegExp(`^\\[(user|player|${other.slice(1, -1)})\\]\\s`),
    un: (s) => s.replaceAll(self, "[user]").replaceAll(other, "[user]").replace(run, "[user]").replace(one, "[user]").replace(rest, "[user]"),
  };
};
/** Letters for the stand-in: none starts a word the rules for names pass over (`STOP`), and two of
 *  them spell no folder the path rule keeps, no file's ending and no placeholder. */
const STAND_IN_LETTERS = [..."QZXJKVUBGHCqzxjkvubghc"];
const MARK_CORES = [..."abcdefghijklmnopqrstuvwxyz"].flatMap((c) => [`us${c}`]);
/** Where the letters `a` and `b` alone make a word of `words` (split as `un` splits: at anything
 *  not a letter, digit or `_`, and at an encoded slash, colon or space). */
const onlyOf = (a: string, b: string, words: Iterable<string>, flags = "") => {
  const re = new RegExp(`^[${a}${b}]+$`, flags);
  for (const w of words) if (re.test(w)) return true;
  return false;
};
/** No user name known: nothing stands in, and nothing is turned into "[user]". */
const NO_STAND_IN: StandIn = { standIn: (m) => m, whole: /(?!)/, self: "\0", other: "\0", cut: /^\[(user|player)\]\s/, un: (s) => s };
/** The stand-in of the text being redacted (`knownAndRules` sets it; every step after reads it). */
let SI: StandIn = NO_STAND_IN;
/** The stand-in for `text`: letters the text doesn't hold, else letters that alone make none of its
 *  words; marks the text doesn't hold. */
function standInFor(text: string): StandIn {
  // The encoded marks go first, so that `]%2FQ` gives the word `Q` as `un` reads it, not `2FQ`.
  const words = text.replace(/%(?:2[Ff0]|5[Cc]|3[Aa])/g, " ").split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  const pairs = (PAIRS ??= standInPairs());
  const [a, b] = pairs.find(([a, b]) => !text.includes(a) && !text.includes(b)) ?? pairs.find(([a, b]) => !onlyOf(a, b, words)) ?? pairs[0];
  const core = MARK_CORES.find((c) => !text.includes(`[${c}]`) && !text.includes(`[ply${c}]`)) ?? MARK_CORES[0];
  return standInWith(a, b, `[${core}]`, `[ply${core}]`);
}
let PAIRS: (readonly [string, string])[] | undefined;
function standInPairs() {
  const fixed = [...KEEP_FOLDERS, ...STOP.split("|"), "user", "player", "players", "you", "folder", "drive", "host", "redacted", "webhook", "email", "ip", "id", "chat", "hidden"];
  const ends = [1, 2, 3, 4, 5, 6].map((n) => "b".repeat(n));
  return STAND_IN_LETTERS.flatMap((a) => STAND_IN_LETTERS.filter((b) => b.toLowerCase() !== a.toLowerCase()).map((b) => [a, b] as const)).filter(
    ([a, b]) => !onlyOf(a, b, fixed, "i") && !ends.some((e) => FILE_EXT.test(`x.${e.replaceAll("b", b)}`) || FILE_EXT.test(`x.${a}${e.slice(1).replaceAll("b", b)}`)),
  );
}
/** A Warframe or warframe.market name: letters, digits, `_`, `-` and `.`, up to 24 (a platform mark may follow). */
const NAME = "[A-Za-z0-9][A-Za-z0-9_.-]{1,23}";

/** Keys whose value is a secret or an identifier, in key=value, key: value or "key":"value". */
const SECRET_KEY = "(?:(?:access|refresh|id|auth|csrf|xsrf|session|bearer)?[_-]?token|secret|client[_-]?secret|passw(?:or)?d|pwd|cookie|session(?:[_-]?id)?|sid|nonce|jwt|auth(?:orization)?|api[_-]?key|signature|sig|credentials?|account[_-]?id|user[_-]?id|player[_-]?id|steam[_-]?id|ingame[_-]?name|e-?mail|ip(?:[_-]?addr(?:ess)?)?|webhook(?:[_-]?url)?)";
const KEY_VALUE = new RegExp(`(["']?\\b${SECRET_KEY}["']?\\s*[=:]\\s*)(?!\\[redacted)("[^"]*"|'[^']*'|[^\\s,;&}\\]]+)`, "gi");

type Rule = [RegExp, string | ((...m: string[]) => string)];
/** Sign-ins, secrets, webhooks, e-mail and IP addresses. */
const SECRETS: Rule[] = [
  // Headers that carry a sign-in: everything after them on the line.
  [/\b((?:set-)?cookie|authorization|proxy-authorization|x-api-key|x-auth-token)\s*:\s*[^\n]+/gi, (_m, h) => `${h}: [redacted]`],
  // JWTs anywhere (three base64url runs, the first starting eyJ), and one cut short after its
  // second (a log line cut at its length limit): the second part names the account.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, "[redacted]"],
  // Webhooks: Discord's, Slack's, and any URL with /webhooks/ or /hooks/ in it.
  [/\bhttps?:\/\/[^\s"'<>]*(?:\/api\/webhooks\/|hooks\.slack\.com\/|\/webhooks?\/|\/hooks\/)[^\s"'<>)]*/gi, "[redacted webhook]"],
  // Bearer / JWT / token followed by a value.
  [/\b(bearer|jwt|token)(\s*:?\s+)(?!\[redacted)[^\s,;]+/gi, (_m, k, sp) => `${k}${sp}[redacted]`],
  // key=value, key: value, "key": "value" with a secret-looking key.
  [KEY_VALUE, (_m, k) => `${k}[redacted]`],
  // E-mail addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
  // IPv4 (four parts, each 0-255), not part of a longer dotted number.
  [/(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g, "[ip]"],
  // IPv6: at least three groups with colons, or a "::" form.
  [/(?<![\w:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![\w:])|(?<![\w:])(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])/gi, "[ip]"],
];
/** Home folders: the user name in the path. */
const HOMES: Rule[] = [
  [/(\/(?:home|Users|var\/home|run\/media|media)\/)(?!\[user\])[^/\s"':]+/g, (_m, p) => `${p}[user]`],
  // The same under Wine's Z: drive, which maps / (Z:\home\<name>\…).
  [/(\b[A-Za-z]:\\+home\\+)(?!\[user\])[^\\\s"':]+/gi, (_m, p) => `${p}[user]`],
  // Wine's own users folder: Proton's is always "steamuser"; another Wine prefix uses the real name.
  [/(drive_c[\\/]+users[\\/]+)(?!steamuser\b|Public\b|\[user\])[^\\/\s"':]+/gi, (_m, p) => `${p}[user]`],
  // A Windows user name may have spaces in it: up to the next separator.
  [/(\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)(?!\[user\])[^\\/\n"':]+/gi, (_m, p) => `${p}[user]`],
];
/** Ids: 16+ hex digits (a 7–12 digit commit hash stays), and 24+ letters and digits mixed. */
const IDS: Rule[] = [
  [/\b[0-9a-f]{16,}\b/gi, "[id]"],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, (m) => (/^[a-z]+(_[a-z]+)+$/.test(m) ? m : "[id]")],
];

/** Words that follow "to", "from", "with" or "for" without being a name. */
const STOP = "the|a|an|your|you|yours|me|my|it|its|that|this|these|those|them|they|each|every|all|any|some|more|less|sale|sales|trade|trades|listing|listings|items?|platinum|plat|ducats|warframe|myorbiter|orbiter|tennoscope|now|later|again|free|sure";

/** Names in lines about whispers, trades and profiles, by their shape. */
const NAME_LINES: [RegExp, (...m: string[]) => string][] = [
  // A warframe.market chat: its partner and what they wrote ("siteChat: Name messaged you on
  // warframe.market (Name: the message)"), a stranger's words, so all of it in brackets goes.
  [/(\bsiteChat:[^\n]*?\()[^\n]*\)/g, (_m, lead) => `${lead}[chat hidden])`],
  // "Name whispered you", "Name messaged you", "3 people whispered you: A, B, C"
  [new RegExp(`\\b(?!people\\b)${NAME}(?=\\s+(?:whispered|messaged) you)`, "g"), () => "[player]"],
  [new RegExp(`(people whispered you[^\\n]*?(?:\\(|:|\\s·\\s|—)\\s*)((?:${NAME}\\s*,\\s*)*${NAME})`, "gi"), (_m, lead) => `${lead}[players]`],
  // A seller, after a price: "Ash Prime Set: 20p from Name", "Rubico Vexi-critacan: 300p from Name"
  [new RegExp(`(\\b\\d+\\s*(?:p|plat|platinum)\\s+from\\s+)(?!\\[)${NAME}`, "gi"), (_m, lead) => `${lead}[player]`],
  // "sold … to Name", "bought … from Name", "traded with Name", "trade with Name", "for Name"
  [new RegExp(`(\\b(?:sold|gave|give|giving|traded?|trading|bought|invited?|whisper(?:ed|ing)?|message(?:d)?|chat(?:ted)? with|\\+rep)\\b[^\\n]{0,80}?\\b(?:to|from|with|for)\\s+)(?!\\[|\\d|(?:${STOP})\\b)${NAME}`, "gi"), (_m, lead) => `${lead}[player]`],
  // "give Name +rep", "Couldn't give Name +rep"
  [new RegExp(`(\\bgive\\s+)(?!\\[)${NAME}(?=\\s+\\+rep)`, "gi"), (_m, lead) => `${lead}[player]`],
  // "+rep to Name" is covered above; "/invite Name", "/w Name", "/whisper Name"
  [new RegExp(`(\\/(?:invite|w|whisper|t|tell|r)\\s+)${NAME}`, "gi"), (_m, lead) => `${lead}[player]`],
  // warframe.market paths: /profile/Name, /user/Name, /users/Name, /orders/user/Name, /review(s)/Name
  // (Not Wine's own drive_c/users/<name>: that's a folder, and its user name is "steamuser".)
  [new RegExp(`((?<!drive_c)\\/(?:profile|user|users|orders\\/user|reviews?|chats?\\/with)\\/)(?!\\[)[^/\\s?#"']+`, "gi"), (_m, lead) => `${lead}[player]`],
  // "partner": "Name", "buyer": Name, "seller=Name", "from_player": …
  [new RegExp(`(["']?\\b(?:partner|buyer|seller|player|ingame_?name|user(?:name)?)["']?\\s*[=:]\\s*["']?)(?!\\[)${NAME}`, "gi"), (_m, lead) => `${lead}[player]`],
];
// Where one of them takes the user name's stand-in alone ("buyer: Name"), it reads "[user]", as the
// name does everywhere else; with more of a name glued to it ("buyer: Name-Alt"), the rule's own
// "[player]", as when the user name isn't known.
for (const rule of NAME_LINES) {
  const to = rule[1];
  rule[1] = (...m) => {
    const put = to(...m);
    const lead = typeof m[1] === "string" ? m[1].length : 0;
    return put.slice(lead) === "[player]" && SI.whole.test(m[0].slice(lead)) ? `${put.slice(0, lead)}[user]` : put;
  };
}

/** Known names, then the secrets, ids, this computer's user name and home folders: the steps before
 *  the names by their shape. */
function knownAndRules(text: string, opts: RedactOptions): { s: string; stood: boolean } {
  let s = text;
  const user = userPatterns(opts.user);
  SI = user.patterns.length > 0 ? standInFor(text) : NO_STAND_IN;
  // Known names first, longest first so "Name_2" goes before "Name". Case-insensitive, whole words.
  // One that is also this computer's user name reads as the path rule's "[user]" (through its mark,
  // `SI.self` or `SI.other`, which the later rules read as they read "[you]" or "[player]").
  const named = (list: readonly (string | null | undefined)[] | undefined, as: string) =>
    [...new Set((list ?? []).map((n) => (typeof n === "string" ? n.trim() : "")).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length).map((n) => [n, user.keys.has(n.toLowerCase()) ? (as === "[you]" ? SI.self : SI.other) : as] as const);
  // `wrote` counts where the name went in as a mark or a stand-in.
  let wrote = 0;
  for (const [name, as] of [...named(opts.self, "[you]"), ...named(opts.others, "[player]")]) {
    s = s.replace(new RegExp(`(?<![A-Za-z0-9_.-])${escapeRe(name)}(?![A-Za-z0-9_-])`, "gi"), () => {
      if (as === SI.self || as === SI.other) wrote++;
      return as;
    });
  }
  // This computer's user name after the secrets and ids, so it can't break one apart and leave the
  // rest of it ("password=name-…"), and before the home folders. It is written as its stand-in
  // (`SI.standIn`), so every rule after this reads it as it reads the name itself and takes with it
  // what it takes with the name ("buyer: Name-Alt", "/home/Name)…", "~Name/…"): knowing the name
  // hides nothing less. The stand-in becomes "[user]" at the end (`SI.un`).
  for (const [re, to] of [...SECRETS, ...IDS]) s = s.replace(re, to as never);
  for (const re of user.patterns) s = s.replace(re, (m) => (wrote++, SI.standIn(m)));
  // A text the name isn't in goes on as if no name were known: nothing of it is read as the
  // stand-in or turned into "[user]", whatever letters it holds.
  if (wrote === 0) SI = NO_STAND_IN;
  for (const [re, to] of HOMES) s = s.replace(re, to as never);
  return { s, stood: wrote > 0 };
}

/** Known names, the rules before them (`knownAndRules`) and the rules for names and chats, each a plain replace and nothing else:
 *  what the names step hides when no path is read. The tests compare `redact` with it. */
export function hideNames(text: string, opts: RedactOptions = {}): string {
  let { s, stood } = knownAndRules(text, opts);
  for (const [re, to] of NAME_LINES) s = s.replace(re, to as never);
  return stood ? SI.un(s) : s;
}

/** A placeholder a rule for names wrote over the text from `at` to `end` (in the text the rules
 *  started from). */
type Hidden = { at: number; end: number; text: string };

/** The rules for names and chats, run exactly as `hideNames` runs them, so that each rule reads
 *  the same text, reaches as far and stops at the same placeholders. Beside the text, each of its
 *  characters is marked with where it stood in `s`, or with the placeholder it belongs to (as
 *  -1 - its number in the list), so that each placeholder knows the text it was written over. */
function hideNamesMarked(s: string): { text: string; from: number[]; hidden: Hidden[] } {
  let text = s;
  let from = Array.from({ length: s.length }, (_, i) => i);
  const hidden: Hidden[] = [];
  const start = (i: number) => (from[i] >= 0 ? from[i] : hidden[-1 - from[i]].at);
  const stop = (i: number) => (from[i] >= 0 ? from[i] + 1 : hidden[-1 - from[i]].end);
  for (const [re, to] of NAME_LINES) {
    let out = "";
    const marks: number[] = [];
    let last = 0;
    text.replace(re, (...m) => {
      const whole = m[0] as string;
      const index = m[m.length - 2] as number;
      const put = (to as (...x: unknown[]) => string)(...m);
      // Every rule writes its lead back as it was, then the placeholder over the rest.
      const lead = typeof m[1] === "string" ? (m[1] as string).length : 0;
      const a = index + lead;
      const b = index + whole.length;
      out += text.slice(last, a);
      for (let i = last; i < a; i++) marks.push(from[i]);
      const n = hidden.push({ at: start(a), end: stop(b - 1), text: put.slice(lead) });
      out += put.slice(lead);
      for (let i = lead; i < put.length; i++) marks.push(-n);
      last = b;
      return put;
    });
    if (!last && !marks.length) continue;
    text = out + text.slice(last);
    from = marks.concat(from.slice(last));
  }
  return { text, from, hidden };
}

/** What a placeholder written over `s` from `at` to `end` may leave after it: where the text it
 *  was written over runs into a path's root ("traded with smb://…", "buyer: Name.smb://…",
 *  "/profile/Name,D:/…", "/profile/Name,//host", "to file:///…"), the roots from the first of
 *  them, and the marks before it, are left for the path's own cleaning. Each root is one that
 *  path cleaning reads there (PATH_START), several in a row with marks between them, and the
 *  last holds the end or starts right after it with a mark before it; `file` before `:///…`
 *  counts, since that root starts after the scheme. A root's own words are a scheme, a drive
 *  letter or a variable's name; a `~name` root's name is a user's, so a tail with one is only
 *  given when `tilde` is set, and `redact` checks that the path's cleaning hid that name. Every
 *  word before the roots stays under the placeholder. Null when nothing is left. */
function rootTail(s: string, roots: readonly (readonly [number, number])[], at: number, end: number, tilde: boolean): { keep: boolean; from: number; names: string[] } | null {
  const names: string[] = [];
  let from: number | null = null;
  let e = end;
  for (;;) {
    let root = roots.find(([a, b]) => a >= at && ((e > a && e <= b) || (e === a && e > at && /[\s"'(=[,;<>:`{|]/.test(s[e - 1]))));
    if (!root && e === end && s.startsWith(":///", e) && /(?<![A-Za-z0-9_])file$/.test(s.slice(at, e))) {
      const after = roots.find(([a]) => a === e + 3);
      if (after) root = [e - 4, e];
    }
    if (!root) break;
    const named = /^~([^\\/]+)/.exec(s.slice(root[0], root[1]));
    if (named) {
      if (!tilde) return null;
      names.push(named[1]);
    }
    from = root[0];
    e = at + s.slice(at, from).replace(/[\s"'(=[,;<>:`{|.-]+$/, "").length;
  }
  if (from === null) return null;
  return { keep: e > at, from: e, names };
}

/** One line (or several) with nothing private left in it. */
export function redact(text: string, opts: RedactOptions = {}): string {
  // Names by their shape before the paths: cleaning a path first could take a rule's anchor
  // ("/profile/", "buyer:"), its closing bracket or its reach. The rules run as hideNames runs
  // them; only then is a placeholder whose text ran into a path's root given back that root
  // (rootTail), so no rule reads a text hideNames' rules don't, and every word a placeholder was
  // written over stays under it but a root's own.
  const { s, stood } = knownAndRules(text, opts);
  const roots = [...s.matchAll(PATH_START)].map((m) => [m.index, m.index + m[0].length] as const);
  const { text: named, from, hidden } = hideNamesMarked(s);
  const write = (tilde: boolean) => {
    let out = "";
    const users: string[] = [];
    for (let i = 0; i < named.length; ) {
      if (from[i] >= 0) { out += named[i++]; continue; }
      const k = from[i];
      const h = hidden[-1 - k];
      while (i < named.length && from[i] === k) i++;
      const tail = rootTail(s, roots, h.at, h.end, tilde);
      if (tail) users.push(...tail.names);
      out += tail === null ? h.text : (tail.keep ? h.text : "") + s.slice(tail.from, h.end);
    }
    return { out: cleanPaths(out), users };
  };
  const first = write(true);
  // A `~name` given back whose path wasn't cleaned (nothing after its slash, or read inside the
  // path before it) would show the user name: then every such root stays under its placeholder.
  const out = first.users.some((u) => new RegExp(`~${escapeRe(u)}(?![A-Za-z0-9._-])`).test(first.out)) ? write(false).out : first.out;
  return stood ? SI.un(out) : out;
}

// ---------------------------------------------------------------- paths
//
// The folder names in a file path, wherever it points (another drive, a mount, a network share,
// the log's "found at" line), in the shapes below. Each name is kept only when it names no one.
//
// The shapes recognised, with either slash, bare or in quotes, after a space, a quote, an opening
// bracket, `=`, `,`, `;`, `:` (but `//host` not after `://`: that is an address), a backtick, `{`
// or `|`:
// - `/a/b` (two names or more), `\a\b`, `~/a`, `~name/a`, `$HOME/a`, `${HOME}/a`, `%USERPROFILE%\a`
//   (any variable);
// - `D:\a`, `D:/a`, `\\?\D:\a`;
// - a share: `\\host\share`, `\\?\UNC\host\share`, `//host/share`, `smb://host/share`,
//   `file://host/share`; `file:///…` addresses.
// Encoded slashes count in two places only: `%2F` at the start of a rooted path (`%2Fa%2Fb`), and
// `%2F` or `%5C` after a drive letter. An encoded share, `~`, variable root or whole address
// (`%5C%5Chost`, `~%2Fa`, `file%3A%2F%2F…`) passes as written.
// Not recognised, and left as written: a lone `/word` or `\word` (a chat command), `D:word` (a
// drive's current folder), a relative `./a/b` or `a/b`, and a path broken over two lines; hiding
// those would hide chat commands and addresses' paths, or need a parser. An address's path is not
// a file's: after a host, after GET, PATCH and the like, or starting `/v1/`, `/v2/` or `/api/` (the
// sites' APIs MyOrbiter calls; no system has those folders at its root), and the game's own item
// paths (`/Lotus/…`), are left alone.
//
// - Kept: the root (`/`, `D:`, `~`, a variable, `\\`); the folder names every system, Steam,
//   Proton, Wine, the game, its launcher, TennoScope and MyOrbiter use (`KEEP_FOLDERS`); numbers
//   (Steam's app ids), except the one after `userdata` (a Steam account's); `.` and `..`; and the
//   last name when it has a file's extension (`EE.log`): the file's name (not a bare one taken
//   over spaces, below).
// - Replaced: the name under `home`, `Users` or `drive_c\users` becomes `[user]` (Proton's
//   `steamuser` stays), and so does `~name`'s; in a recognised path, a user name with spaces goes
//   with its words as a last name does below; a drive's label under `/mnt`, `/Volumes`,
//   `/media/<user>` or `/run/media/<user>` becomes `[drive]`; a share's computer `[host]`; the
//   number after `userdata` `[id]`; any other name `[folder]`.
//
// Where a bare path ends: a name with spaces in it ("My Games") is taken whole when a slash follows
// it. A last name that is hidden takes the words after it with it, up to a sure end (`: `, `, `,
// `; `, `. `, ` (`, a double quote, the end of the line) or the next mark (`:`, `<`, `>`, `|`,
// `*`, `?`, `{`, `}`, a backtick, an arrow, or a space before another path or an address), where
// reading goes on; at a slash the path goes on. The words up to there go with the name
// ("D:\a\Alice Smith to E:\x" becomes "D:\[folder]\[folder] E:\[folder]"), a word too many may go
// with it (an amount too: "/home/alice has 30p" becomes "/home/[user]"), and what it took is never
// kept as a file's name. A `[user]` or `[player]` an early rule left runs on the same way. A later
// slash on the line takes the words before it as folder names, a file's name and a price among
// them ("D:\Games\EE.log, retrying 1/3" becomes "D:\Games\[folder]/3"), and a price written like
// `~name/x` is read as one ("~50p/each"). `'` is part of a name ("Alice's Games"). A path in
// quotes runs to the closing quote.
// Left as written (known gaps): a name's words after a sure end inside it ("…\Alice B. Smith"
// keeps ". Smith"; not under `C:\Users\` with a backslash, whose rule takes the name to the next
// separator); a last name whose first word is kept (a kept folder, a number, a file's name) and
// with no slash after it ("D:\Games\Dev Alice"), as it can't be told from a kept name followed by
// other words ("found at D:\Games\Warframe and more"); the words after the first of a user name
// under a bare `drive_c\users` that is not inside a longer path (a relative path:
// "drive_c/users/[user] Smith", and with an apostrophe "drive_c/users/[user]'Smith"); in
// single quotes, a name with an apostrophe ("'D:\a\Alice O'Smith'"), where the apostrophe reads as
// the closing quote; a path after a quote that never closes, whose last name runs to the end of the
// line and is kept when it ends in a file's name ("\"/mnt/Alice see EE.log"); `~` with a name with
// spaces ("~Alice Smith/x"); a path glued to `,`, `;`, `=` or a bracket after a last name with
// spaces, which the run takes up to its drive letter, so its folder names stay
// ("/home/Alice Smith,D:\x\y" becomes "/home/[user]:\x\y").

/** Folder names that name no one, compared without case. */
const KEEP_FOLDERS = new Set([
  // Systems
  "home", "users", "user", "root", "mnt", "media", "run", "var", "usr", "opt", "srv", "tmp", "temp", "etc", "bin", "sbin", "lib", "lib32", "lib64", "share", "local", "data", "games", "game", "app", "apps", "applications", "library", "private", "volumes", "nix", "store", "snap", "flatpak", "proc", "sys", "dev", "boot",
  ".local", ".config", ".cache", ".var", ".steam", ".wine", "public", "shared", "default", "x86_64", "i386", "x64", "x86",
  "windows", "system32", "syswow64", "program files", "program files (x86)", "programdata", "appdata", "roaming", "locallow", "documents", "my documents", "documents and settings", "desktop", "downloads", "saved games", "my games",
  "application support", "caches", "logs", "log", "preferences", "containers",
  // Steam, Proton, Wine and other launchers
  "steam", "steamapps", "steamlibrary", "remote", "config", "steam library", "common", "compatdata", "pfx", "drive_c", "dosdevices", "steamuser", "userdata", "shadercache", "workshop", "downloading", "ubuntu12_32", "ubuntu12_64", "steamrt", "steam linux runtime", "proton experimental", "com.valvesoftware.steam",
  "lutris", "heroic", "prefix", "prefixes", "wine", "bottles", "epic games", "epicgameslauncher", "legendary", "gog games",
  // The game, its launcher, TennoScope, MyOrbiter
  "warframe", "digital extremes", "tools", "launcher", "downloaded", "cache.windows", "tennoscope", "myorbiter", "orbiter", "dev.myorbiter.app", "resources", "assets",
]);
/** A file's extension: the last name of a path ending in one is the file's name, kept. */
const FILE_EXT = /\.(?:log|txt|json|jsonl|toml|ini|cfg|conf|xml|ya?ml|csv|md|db|sqlite3?|db-wal|db-shm|wal|lock|dat|bin|cache|tmp|bak|old|exe|dll|so|dylib|msi|appimage|deb|rpm|dmg|app|desktop|sh|bat|cmd|ps1|zip|gz|xz|7z|tar|png|jpe?g|webp|ico|svg|js|mjs|wasm|html?|css|ts|rs|py|pdb|pak|toc)$/i;
/** What may come before a path. */
const B = "(?<=^|[\\s\"'(=[,;<>:`{|])";
/** Where a path starts (its root), most specific first. */
const PATH_START = new RegExp(
  [
    `${B}\\\\\\\\\\?\\\\UNC\\\\(?=[^\\s\\\\])`, // \\?\UNC\host
    `${B}\\\\\\\\\\?\\\\[A-Za-z]:\\\\(?=[^\\s\\\\])`, // \\?\D:\
    `${B}\\\\{2,4}(?=[^\\s\\\\?])`, // \\host (\\\\host in JSON)
    `\\b(?:smb|file):\\/\\/(?=[^\\s\\/\\\\])`, // smb://host, file://host
    `(?<=^|[\\s"'(=[,;<>\`{|])\\/\\/(?=[^\\s\\/\\\\])`, // //host (not after a scheme's ":")
    `(?<=file:\\/\\/\\/)[A-Za-z]:[\\\\/](?=[^\\s\\\\/])`, // file:///D:/
    `${B}[A-Za-z]:(?:[\\\\/]{1,2}|%2[Ff]|%5[Cc])(?=[^\\s\\\\/])`, // D:\ D:/
    `${B}~[A-Za-z0-9._-]*[\\\\/](?=[^\\s\\\\/])`, // ~/ and ~name/
    `${B}(?:\\$\\{?[A-Za-z_][A-Za-z0-9_]*\\}?|%[A-Za-z_][A-Za-z0-9_]*%)[\\\\/](?=[^\\s\\\\/])`, // $HOME/ ${HOME}/ %USERPROFILE%\
    `(?:${B}|(?<=file:\\/\\/))(?:\\/|%2[Ff])(?=[^\\s\\/%])`, // /a/b
    `${B}\\\\(?=[^\\s\\\\?])`, // \a\b
  ].join("|"),
  "g",
);
const HTTP_METHOD = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+$/;
/** The first name of an address's path: the APIs MyOrbiter calls (warframe.market's /v1/, /v2/; /api/). */
const API_ROOT = /^(?:v\d+|api)$/i;
/** A placeholder another rule left: kept as it is. */
const PLACEHOLDER = /^\[[a-z ]+\]$/;

type PathKind = "unix" | "rooted" | "drive" | "share" | "home" | "named-home";

/** The length of the separator at `k` (a slash either way, or `%2F` / `%5C`), or 0. */
function sepAt(s: string, k: number): number {
  const c = s[k];
  if (c === "/" || c === "\\") return 1;
  return c === "%" && /^%(?:2f|5c)/i.test(s.slice(k, k + 3)) ? 3 : 0;
}

/** Where the words after a hidden last name stop: a sure end (`: `, `, `, `; `, `. `, ` (`, the
 *  end of the line) or a mark (`"`, `:`, `<`, `>`, `|`, `*`, `?`, `{`, `}`, a backtick, an arrow). */
const RUN_STOP = /^(?:[\n"<>|*?:`{}\u2190-\u21ff]|, |; |\. | \()/;
/** Another path or an address, after a space: the words before it are the name's, not it. */
const PATH_AHEAD = /^(?:[A-Za-z]:[\\/%]|[~$%\\/]|\.{1,2}[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/;

/** Whether a last name (no spaces) would be hidden: then it may run on over spaces. A `[user]` or
 *  `[player]` an early rule left runs on too: those rules stop at a space ("/home/[user] Smith",
 *  "/profile/[player] Smith"). */
const hiddenName = (t: string) => t === "[user]" || t === "[player]" || t === SI.other || !(PLACEHOLDER.test(t) || /^\d+$/.test(t) || KEEP_FOLDERS.has(t.toLowerCase()) || FILE_EXT.test(t) || t === "." || t === "..");

/** Where the path whose names start at `from` ends. `quote`: the quote it is in, if any.
 *  `spacedFirst`: whether its first name may have spaces in it. */
function pathEnd(s: string, from: number, quote: string | null, spacedFirst: boolean): number {
  let i = from;
  let end = from;
  for (;;) {
    let j = i;
    if (quote) {
      while (j < s.length && !sepAt(s, j) && s[j] !== "\n" && s[j] !== quote) j++;
    } else {
      // A name with spaces in it, when a slash follows: no space at either end of it, and not the
      // start of the next path ("…/data to ~/x", "…/data to ./x").
      let k = i;
      while (k < s.length && !sepAt(s, k) && !/[\n"<>|*?:`{}]/.test(s[k])) k++;
      const name = s.slice(i, k);
      if (sepAt(s, k) && name.length > 0 && (spacedFirst || i > from || !/\s/.test(name)) && !/^\s|\s$|\s[~.]/.test(name)) j = k;
      else {
        // The last name: up to a space or punctuation a path doesn't end with ("…/EE.log: error", "…/EE.log.").
        while (j < s.length && !sepAt(s, j) && !/[\s"<>|*?:,;()`{}]/.test(s[j])) j++;
        while (j > i && /[.']/.test(s[j - 1])) j--;
        // A last name that is hidden takes the words after it with it, up to a sure end or the next
        // mark ("…\Alice Smith: denied", "…\Alice Smith -> E:\x"): the name's words up to there go
        // with it. At a slash the path goes on ("/srv/Alice  Smith/x").
        let run = false;
        if (j > i && /^\s/.test(s.slice(j, j + 1)) && hiddenName(s.slice(i, j))) {
          let e = j;
          while (e < s.length && !RUN_STOP.test(s.slice(e, e + 2)) && !sepAt(s, e) && !(/\s/.test(s[e]) && PATH_AHEAD.test(s.slice(e + 1, e + 16)))) e++;
          if (sepAt(s, e)) {
            j = e;
            run = true;
          } else {
            while (e > j && /[\s=.-]/.test(s[e - 1])) e--;
            return e;
          }
        }
        if (!run) return j > i ? j : end;
      }
    }
    if (j === i) break;
    end = j;
    const n = sepAt(s, j);
    if (!n) break;
    let k = j;
    while (sepAt(s, k)) k += sepAt(s, k);
    end = k;
    i = k;
  }
  return end;
}

/** One folder name, as the rule above has it. `before`: the names before it in the path.
 *  `quoted`: whether the path is in quotes (then its last name runs to the closing quote). */
function cleanFolder(name: string, before: string[], kind: PathKind, last: boolean, quoted: boolean): string {
  const low = name.toLowerCase();
  const prev = (before[before.length - 1] ?? "").toLowerCase();
  const prev2 = (before[before.length - 2] ?? "").toLowerCase();
  // This computer's user name (its stand-in), as a folder or a computer's name of its own.
  if (SI.whole.test(name)) return "[user]";
  if (kind === "share" && before.length === 0) return "[host]";
  if (PLACEHOLDER.test(name) || name === "." || name === "..") return name;
  // A user's or player's name with a space in it, which an early rule cut at the space: all of it
  // is the name.
  const cut = SI.cut.exec(name);
  if (cut) return `[${cut[1]}]`;
  // The user name: under /home, /Users, C:\Users, and Wine's drive_c\users (where Proton's is steamuser).
  if (prev === "home" || prev === "users" || prev === "documents and settings") return low === "public" || low === "default" || low === "steamuser" ? name : "[user]";
  // Steam's userdata\<account id>.
  if (prev === "userdata" && /^\d+$/.test(name)) return "[id]";
  // A bare last name with a space in it was taken over words ("…\Alice Smith see EE.log"): never a
  // file's name. In quotes it is one ("EE log copy.txt").
  if (/^\d+$/.test(name) || KEEP_FOLDERS.has(low) || (last && FILE_EXT.test(name) && (quoted || !/\s/.test(name)))) return name;
  // A drive's label: under /mnt, /Volumes, /media/<user>, /run/media/<user>.
  if (kind === "unix" && (((prev === "mnt" || prev === "volumes") && before.length === 1) || (prev === "[user]" && prev2 === "media"))) return "[drive]";
  return "[folder]";
}

/** A path, every folder name that may name someone replaced. */
function cleanPath(root: string, rest: string, kind: PathKind, quoted: boolean): string {
  const before: string[] = [];
  const parts = rest.split(/((?:[\\/]|%2[Ff]|%5[Cc])+)/);
  const lastName = parts.reduce((at, p, i) => (p && i % 2 === 0 ? i : at), -1);
  let out = kind === "named-home" ? `~[user]${root.slice(-1)}` : root;
  parts.forEach((p, i) => {
    if (i % 2 === 1 || !p) out += p;
    else {
      out += cleanFolder(p, before, kind, i === lastName, quoted);
      before.push(p);
    }
  });
  return out;
}

/** Every path in `s`, cleaned. */
function cleanPaths(s: string): string {
  let out = "";
  let at = 0;
  for (const m of s.matchAll(PATH_START)) {
    const start = m.index;
    const root = m[0];
    if (start < at) continue;
    const kind: PathKind = /^~./.test(root) && !/^~[\\/]$/.test(root) ? "named-home" : /^[~$%]/.test(root) && !/^%(?:2f|5c)/i.test(root) ? "home" : /^(?:\\\\|\/\/|smb:|file:)/i.test(root) && !/^\\\\\?\\[A-Za-z]:/.test(root) ? "share" : /^(?:\/|%2f)/i.test(root) ? "unix" : root === "\\" ? "rooted" : "drive";
    const before = s[start - 1];
    // A bare path from "/" doesn't start with a name with spaces: that is a sentence ("/w Name hi").
    const quote = before === '"' || before === "'" ? before : null;
    const end = pathEnd(s, start + root.length, quote, kind !== "unix" && kind !== "rooted");
    const rest = s.slice(start + root.length, end);
    if (!rest) continue;
    if (kind === "unix" || kind === "rooted") {
      const names = rest.split(/(?:[\\/]|%2[Ff]|%5[Cc])+/).filter(Boolean);
      // A lone "/word" (a chat command), an address's path, the game's own item path: not a file's.
      if (names.length < 2 || names[0] === "Lotus" || API_ROOT.test(names[0]) || HTTP_METHOD.test(s.slice(Math.max(0, start - 10), start))) continue;
    }
    out += s.slice(at, start) + cleanPath(root, rest, kind, quote !== null);
    at = end;
  }
  return out + s.slice(at);
}

// ---------------------------------------------------------------- user names
//
// This computer's user name, as MyOrbiter knows it without asking the system anything new: the name
// of the home folder in the paths the page already holds (`homeNames`: the game log's file and
// TennoScope's folder, as saved in Settings or as found) and in a home folder written in the
// report's own lines (`homeNamesIn`). It is the folder's name, which is the account's user name on
// a usual setup. Known, it is hidden as "[user]" wherever it stands as a word, in any case, also
// outside paths and in the paths the path rule above leaves as written; never out of a longer word
// ("alice" stays in "malice" and "alice_2"; "alice-pc" is two words). A name with spaces is hidden
// whole when none of its words is ordinary, and each of its words on its own too, but an ordinary one. Unknown (no such path held, none in the lines), only the path rule hides it.
//
// A name that is also a word a report needs is not hidden as a word, so a report keeps its words
// ("deck", the Steam Deck's account, in "Steam Deck"): `ordinaryName`. It stays hidden where the path
// rule hides a user name (`/home/deck/…` becomes `/home/[user]/…`).

/** Words a user name can be that a report needs as words: the names systems and devices give an
 *  account (deck, admin, guest, pi…), the marks redaction writes, the words of the details' own
 *  lines (the system, the architecture, the channel, TennoScope's state), and the small words of a
 *  sentence a name of several words can hold (the, new, my…; the names step's `STOP` words too).
 *  The folder names the path rule keeps (`KEEP_FOLDERS`: home, user, steam, games…) count too. */
const ORDINARY_WORDS = new Set([
  "deck", "admin", "administrator", "guest", "owner", "pc", "player", "players", "gamer", "gaming", "pi", "test", "dev", "live", "main", "desktop", "laptop", "computer", "system", "account", "name",
  "ubuntu", "fedora", "debian", "arch", "steamos", "bazzite", "nobara", "mint",
  "you", "me", "redacted", "folder", "drive", "host", "id", "ip", "email", "webhook", "chat", "hidden",
  "linux", "windows", "macos", "mac", "android", "x86_64", "aarch64", "arm64", "arm", "unknown",
  "stable", "beta", "experimental", "build", "connected", "running", "reporting", "not", "used", "here", "on", "off",
  ...STOP.split("|"), "item", "items", "and", "or", "but", "nor", "of", "in", "at", "to", "from", "with", "by", "for", "as", "is", "are", "was", "be", "has", "have", "had", "can", "will", "just", "no", "yes",
  "new", "old", "big", "little", "our", "his", "her", "their", "one", "two", "three", "mr", "mrs", "ms", "miss", "dr", "jr", "sr", "family", "office", "work", "school", "kids", "other", "second", "first", "backup", "temp", "local",
]);

/** Words the rules after the user name read as an anchor (a rule's lead, an address's path, a
 *  share's scheme or root): a user name equal to one would take the anchor away with its stand-in,
 *  and with it what the rule hides. */
const RULE_WORDS = new Set([
  "sitechat", "people", "whisper", "whispered", "whispering", "message", "messaged", "chatted", "sold", "gave", "give", "giving", "traded", "trading", "bought", "invite", "invited", "rep", "tell",
  "profile", "review", "reviews", "chats", "partner", "buyer", "seller", "username",
  "smb", "file", "unc",
]);

/** A price ("20p", "300plat"), which the rule for a seller reads before "from". */
const PRICE_WORD = /^\d+(?:p|plat|platinum)$/i;
/** A word a rule reads: one of `RULE_WORDS`, or a price. */
const ruleWord = (w: string) => RULE_WORDS.has(w.toLowerCase()) || PRICE_WORD.test(w);

/** Whether a user name is an ordinary word, and so hidden only where the path rule hides one:
 *  fewer than 3 characters, no letter in it (a number), one of `ORDINARY_WORDS` or `KEEP_FOLDERS`,
 *  or a word a rule reads (`RULE_WORDS`, a price). A name of several words is ordinary when every
 *  word of it is. */
export function ordinaryName(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return !words.length || words.every((w) => w.length < 3 || !/\p{L}/u.test(w) || ORDINARY_WORDS.has(w.toLowerCase()) || KEEP_FOLDERS.has(w.toLowerCase()) || ruleWord(w));
}

/** A user name as a whole word, in any case: not inside a longer word (letters and digits of any
 *  script, and `_`, on either side; a hyphen or a dot joins two words, so `Name-PC` and `Name.local`
 *  hide it, and so does `@`: `name@host`, `@name`; an e-mail address went whole before this runs).
 *  The rules after it read it as a name (its stand-in), so another player's name by its shape that
 *  holds it ("buyer: Name-Alt") goes whole as "[player]", and a `~name/` path loses its folders.
 *  An encoded slash, colon or space before it (`%2F`, `%5C`, `%3A`, `%20`) is no letter. Its words
 *  may be apart by any spaces or `%20`. */
const userPattern = (words: string[]) => new RegExp(`(?<![\\p{L}\\p{N}_](?<!%(?:2[Ff0]|5[Cc]|3[Aa])))${words.map(escapeRe).join("(?:\\s|%20)+")}(?![\\p{L}\\p{N}_])`, "giu");

/** The patterns that hide the user names in `list`, longest first: each name that isn't ordinary,
 *  whole (but not one of several words that holds an ordinary word: "to", "you", "buyer" may be a
 *  rule's anchor, and the whole name would take it away), and each word of a name of several words
 *  that isn't ordinary on its own; and those names and words, in lower case. */
function userPatterns(list: readonly (string | null | undefined)[] | undefined): { patterns: RegExp[]; keys: Set<string> } {
  const seen = new Map<string, string[]>();
  for (const n of list ?? []) {
    if (typeof n !== "string") continue;
    const words = n.trim().split(/\s+/).filter(Boolean);
    for (const w of words.length > 1 ? [words, ...words.map((x) => [x])] : [words]) {
      const key = w.join(" ").toLowerCase();
      if (w.length && !ordinaryName(key) && !(w.length > 1 && w.some((x) => ordinaryName(x))) && !seen.has(key)) seen.set(key, w);
    }
  }
  return { patterns: [...seen.entries()].sort((a, b) => b[0].length - a[0].length).map(([, w]) => userPattern(w)), keys: new Set(seen.keys()) };
}

/** A home folder's name that is no one's: Proton's, Windows' shared ones, a placeholder, a variable. */
const notAUser = (name: string) => /^(?:steamuser|public|default|all users|default user)$/i.test(name) || /^[[~$%]/.test(name) || name === "." || name === "..";

/** The folders a home holds, which give the home away in any path: `.local/share`, `.steam`,
 *  `.var/app`, `AppData\Roaming` (or `Local`, `LocalLow`), `Library/Application Support`. */
const underHome = (rest: string[]) => {
  const [a, b] = rest.map((x) => x.toLowerCase());
  return (a === ".local" && b === "share") || a === ".steam" || (a === ".var" && b === "app") || (a === "appdata" && (b === "roaming" || b === "local" || b === "locallow")) || (a === "library" && b === "application support");
};

/** The name of the home folder in each path the page holds (the game log's file, TennoScope's
 *  folder; each a whole path, saved in Settings or as found), by its shape: the folder after
 *  `/home`, `/var/home`, `/Users`, `C:\Users`, `C:\Documents and Settings`, Wine's `Z:\home`, a
 *  Wine prefix's `drive_c\users` (not Proton's `steamuser`) and `/run/media`, a `~name`, and the
 *  folder that holds `.local/share`, `.steam`, `.var/app`, `AppData\Roaming` (or `Local`, `LocalLow`) or `Library/Application
 *  Support` (a home of another shape). A whole path's folder names may have spaces in them. */
export function homeNames(paths: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const add = (n: string | undefined) => {
    const t = (n ?? "").trim();
    if (t && !notAUser(t) && !out.includes(t)) out.push(t);
  };
  for (const p of paths) {
    if (typeof p !== "string" || !p.trim()) continue;
    const parts = p.trim().replace(/^file:\/\/\/?/i, "/").split(/[\\/]+/);
    const named = /^~(.+)$/.exec(parts[0]);
    if (named) add(named[1]);
    for (let i = 0; i < parts.length - 1; i++) {
      const low = parts[i].toLowerCase();
      const before = parts.slice(0, i).filter(Boolean).map((x) => x.toLowerCase());
      const top = before.length === 0 || (before.length === 1 && (before[0] === "var" || /^[a-z]:$/.test(before[0])));
      if (top && (low === "home" || low === "users" || low === "documents and settings")) add(parts[i + 1]);
      else if (low === "users" && before[before.length - 1] === "drive_c") add(parts[i + 1]);
      else if (low === "media" && before.length === 1 && before[0] === "run" && i + 2 < parts.length) add(parts[i + 1]);
      if (i > 0 && parts[i] && !/^[A-Za-z]:$/.test(parts[i]) && underHome(parts.slice(i + 1, i + 3))) add(parts[i]);
    }
  }
  return out;
}

/** Where a home folder's name starts in a line: after `/home/`, `/var/home/`, `/Users/`,
 *  `C:\Users\`, `C:\Documents and Settings\`, Wine's `Z:\home\`, `drive_c\users\` or `/run/media/`. */
const LINE_HOMES = [
  /(?<![\w.~-])\/(?:var\/)?home\/+/g,
  /(?<![\w.~-])\/Users\/+/g,
  /(?<![A-Za-z0-9])[A-Za-z]:[\\/]+(?:Users|Documents and Settings|home)[\\/]+/gi,
  /\bdrive_c[\\/]+users[\\/]+/gi,
  /(?<![\w.~-])\/run\/media\/+/g,
];

/** The home folders written in a report's own lines (`LINE_HOMES`, and a `~name/`): their names. A
 *  name with spaces in it counts whole only when a slash follows it (`C:\Users\Alice Smith\x`);
 *  otherwise its first word does, as the words after it may be the sentence's. A warframe.market
 *  chat's words, a stranger's, are not read. */
export function homeNamesIn(lines: readonly string[]): string[] {
  const out: string[] = [];
  const add = (n: string) => {
    const t = n.trim().replace(/[.,;!)]+$/, "");
    if (t && !notAUser(t) && !out.includes(t)) out.push(t);
  };
  for (const raw of lines) {
    const line = raw.replace(/(\bsiteChat:[^\n]*?\()[^\n]*\)/g, "$1)");
    for (const re of LINE_HOMES) {
      for (const m of line.matchAll(re)) {
        const at = m.index + m[0].length;
        const run = /^[^\\/\n"':<>|*?]+/.exec(line.slice(at))?.[0] ?? "";
        const slash = /[\\/]/.test(line[at + run.length] ?? "");
        if (slash && run === run.trim() && run.split(/\s+/).length <= 4) add(run);
        else add(run.split(/\s/)[0]);
      }
    }
    for (const m of line.matchAll(/(?<=^|[\s"'(=[,;<>:`{|])~([A-Za-z][A-Za-z0-9._-]*)[\\/](?=[^\s\\/])/g)) add(m[1]);
  }
  return out;
}
