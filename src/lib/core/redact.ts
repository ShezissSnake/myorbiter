// What a bug report must never carry, taken out of every line that goes into one (the log's last
// lines, and the player's own words too). orbiter's log is private to the player (applog.rs keeps
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
// - the player's in-game name and any other name orbiter knows (trade partners, people who
//   whispered), wherever they appear;
// - names in whisper, trade and profile lines, by their shape, for names orbiter doesn't know.
//
// It errs on the side of hiding: a report with "[player]" where an item name was is still useful;
// one with a stranger's name or a sign-in in it is not.

export interface RedactOptions {
  /** The player's own in-game name(s), if known: shown as "[you]". */
  self?: readonly (string | null | undefined)[];
  /** Other players' names orbiter knows (trade partners, whispers): shown as "[player]". */
  others?: readonly (string | null | undefined)[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A Warframe or warframe.market name: letters, digits, `_`, `-` and `.`, up to 24 (a platform mark may follow). */
const NAME = "[A-Za-z0-9][A-Za-z0-9_.-]{1,23}";

/** Keys whose value is a secret or an identifier, in key=value, key: value or "key":"value". */
const SECRET_KEY = "(?:(?:access|refresh|id|auth|csrf|xsrf|session|bearer)?[_-]?token|secret|client[_-]?secret|passw(?:or)?d|pwd|cookie|session(?:[_-]?id)?|sid|nonce|jwt|auth(?:orization)?|api[_-]?key|signature|sig|credentials?|account[_-]?id|user[_-]?id|player[_-]?id|steam[_-]?id|ingame[_-]?name|e-?mail|ip(?:[_-]?addr(?:ess)?)?|webhook(?:[_-]?url)?)";
const KEY_VALUE = new RegExp(`(["']?\\b${SECRET_KEY}["']?\\s*[=:]\\s*)(?!\\[redacted)("[^"]*"|'[^']*'|[^\\s,;&}\\]]+)`, "gi");

const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  // Headers that carry a sign-in: everything after them on the line.
  [/\b((?:set-)?cookie|authorization|proxy-authorization|x-api-key|x-auth-token)\s*:\s*[^\n]+/gi, (_m, h) => `${h}: [redacted]`],
  // JWTs anywhere (three base64url runs, the first starting eyJ).
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[redacted]"],
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
  // Home folders: the user name in the path.
  [/(\/(?:home|Users|var\/home|run\/media|media)\/)(?!\[user\])[^/\s"':]+/g, (_m, p) => `${p}[user]`],
  // Wine's own users folder: Proton's is always "steamuser"; another Wine prefix uses the real name.
  [/(drive_c[\\/]+users[\\/]+)(?!steamuser\b|Public\b|\[user\])[^\\/\s"':]+/gi, (_m, p) => `${p}[user]`],
  // A Windows user name may have spaces in it: up to the next separator.
  [/(\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)(?!\[user\])[^\\/\n"':]+/gi, (_m, p) => `${p}[user]`],
  // Ids: 16+ hex digits (a 7–12 digit commit hash stays), and 24+ letters and digits mixed.
  [/\b[0-9a-f]{16,}\b/gi, "[id]"],
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, (m) => (/^[a-z]+(_[a-z]+)+$/.test(m) ? m : "[id]")],
];

/** Words that follow "to", "from", "with" or "for" without being a name. */
const STOP = "the|a|an|your|you|yours|me|my|it|its|that|this|these|those|them|they|each|every|all|any|some|more|less|sale|sales|trade|trades|listing|listings|items?|platinum|plat|ducats|warframe|orbiter|tennoscope|now|later|again|free|sure";

/** Names in lines about whispers, trades and profiles, by their shape. */
const NAME_LINES: [RegExp, (...m: string[]) => string][] = [
  // "Name whispered you", "3 people whispered you: A, B, C"
  [new RegExp(`\\b(?!people\\b)${NAME}(?=\\s+whispered you)`, "g"), () => "[player]"],
  [new RegExp(`(people whispered you[^\\n]*?(?:\\(|:|\\s·\\s|—)\\s*)((?:${NAME}\\s*,\\s*)*${NAME})`, "gi"), (_m, lead) => `${lead}[players]`],
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

/** One line (or several) with nothing private left in it. */
export function redact(text: string, opts: RedactOptions = {}): string {
  let s = text;
  // Known names first, longest first so "Name_2" goes before "Name". Case-insensitive, whole words.
  const named = (list: readonly (string | null | undefined)[] | undefined, as: string) =>
    [...new Set((list ?? []).map((n) => (typeof n === "string" ? n.trim() : "")).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length).map((n) => [n, as] as const);
  for (const [name, as] of [...named(opts.self, "[you]"), ...named(opts.others, "[player]")]) {
    s = s.replace(new RegExp(`(?<![A-Za-z0-9_.-])${escapeRe(name)}(?![A-Za-z0-9_-])`, "gi"), as);
  }
  for (const [re, to] of RULES) s = s.replace(re, to as never);
  for (const [re, to] of NAME_LINES) s = s.replace(re, to as never);
  return s;
}

/** Each line redacted. */
export const redactLines = (lines: readonly string[], opts: RedactOptions = {}): string[] => lines.map((l) => redact(l, opts));
