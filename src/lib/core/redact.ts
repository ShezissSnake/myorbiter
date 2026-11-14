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
// - names in whisper, trade and profile lines, by their shape, for names MyOrbiter doesn't know.
//
// It errs on the side of hiding: a report with "[player]" where an item name was is still useful;
// one with a stranger's name or a sign-in in it is not.

export interface RedactOptions {
  /** The player's own in-game name(s), if known: shown as "[you]". */
  self?: readonly (string | null | undefined)[];
  /** Other players' names MyOrbiter knows (trade partners, whispers): shown as "[player]". */
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
  // Home folders: the user name in the path.
  [/(\/(?:home|Users|var\/home|run\/media|media)\/)(?!\[user\])[^/\s"':]+/g, (_m, p) => `${p}[user]`],
  // The same under Wine's Z: drive, which maps / (Z:\home\<name>\…).
  [/(\b[A-Za-z]:\\+home\\+)(?!\[user\])[^\\\s"':]+/gi, (_m, p) => `${p}[user]`],
  // Wine's own users folder: Proton's is always "steamuser"; another Wine prefix uses the real name.
  [/(drive_c[\\/]+users[\\/]+)(?!steamuser\b|Public\b|\[user\])[^\\/\s"':]+/gi, (_m, p) => `${p}[user]`],
  // A Windows user name may have spaces in it: up to the next separator.
  [/(\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)(?!\[user\])[^\\/\n"':]+/gi, (_m, p) => `${p}[user]`],
  // Ids: 16+ hex digits (a 7–12 digit commit hash stays), and 24+ letters and digits mixed.
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
  s = cleanPaths(s);
  for (const [re, to] of NAME_LINES) s = s.replace(re, to as never);
  return s;
}

// ---------------------------------------------------------------- paths
//
// The folder names in a file path, wherever it points (another drive, a mount, a network share,
// the log's "found at" line), in the shapes below. Each name is kept only when it names no one.
//
// The shapes recognised, with either slash, `%2F` or `%5C` for a slash, bare or in quotes, after a
// space, a quote, a bracket, `=`, `,`, `;`, `:`, a backtick, `{` or `|`:
// - `/a/b` (two names or more), `\a\b`, `~/a`, `~name/a`, `$HOME/a`, `${HOME}/a`, `%USERPROFILE%\a`
//   (any variable);
// - `D:\a`, `D:/a`, `\\?\D:\a`;
// - a share: `\\host\share`, `\\?\UNC\host\share`, `//host/share`, `smb://host/share`,
//   `file://host/share`; `file:///…` addresses.
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
//   last name when it has a file's extension (`EE.log`): the file's name.
// - Replaced: the name under `home`, `Users` or `drive_c\users` becomes `[user]` (Proton's
//   `steamuser` stays), and so does `~name`'s; a drive's label under `/mnt`, `/Volumes`,
//   `/media/<user>` or `/run/media/<user>` becomes `[drive]`; a share's computer `[host]`; the
//   number after `userdata` `[id]`; any other name `[folder]`.
//
// Where a bare path ends: a name with spaces in it ("My Games") is taken whole when a slash follows
// it, and the last name, when it is one that is hidden, runs over spaces up to `: `, `, `, `; `,
// `. `, ` (` or the end of the line ("…\Alice Smith: denied"), so no part of it is left behind.
// `'` is part of a name ("Alice's Games"). A path in quotes runs to the closing quote.

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
/** The longest folder name (NTFS's and ext4's limit): a run of words longer than this isn't one. */
const MAX_NAME = 255;

type PathKind = "unix" | "rooted" | "drive" | "share" | "home" | "named-home";

/** The length of the separator at `k` (a slash either way, or `%2F` / `%5C`), or 0. */
function sepAt(s: string, k: number): number {
  const c = s[k];
  if (c === "/" || c === "\\") return 1;
  return c === "%" && /^%(?:2f|5c)/i.test(s.slice(k, k + 3)) ? 3 : 0;
}

/** Whether a last name (no spaces) would be hidden: then it may run on over spaces. */
const hiddenName = (t: string) => !(PLACEHOLDER.test(t) || /^\d+$/.test(t) || KEEP_FOLDERS.has(t.toLowerCase()) || FILE_EXT.test(t) || t === "." || t === "..");

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
      if (sepAt(s, k) && name.length > 0 && name.length <= MAX_NAME && (spacedFirst || i > from || !/\s/.test(name)) && !/^\s|\s$|\s\s|\s[~.]/.test(name)) j = k;
      else {
        // The last name: up to a space or punctuation a path doesn't end with ("…/EE.log: error", "…/EE.log.").
        while (j < s.length && !sepAt(s, j) && !/[\s"<>|*?:,;()`{}]/.test(s[j])) j++;
        while (j > i && /[.']/.test(s[j - 1])) j--;
        // A last name that is hidden runs on over spaces up to where the line goes on ("…\Alice Smith: denied").
        if (j > i && /^\s/.test(s.slice(j, j + 1)) && hiddenName(s.slice(i, j))) {
          const m = /^[^\n\\/"<>|*?:`{}]*?(?=:(?:\s|$)|, |; |\. | \(|\.?$|\.?\n)/.exec(s.slice(j));
          if (m && m[0].length + j - i <= MAX_NAME && !/%2f|%5c|\s[~.]/i.test(m[0])) return j + m[0].length;
        }
        if (j > i) end = j;
        return end;
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

/** One folder name, as the rule above has it. `before`: the names before it in the path. */
function cleanFolder(name: string, before: string[], kind: PathKind, last: boolean): string {
  const low = name.toLowerCase();
  const prev = (before[before.length - 1] ?? "").toLowerCase();
  const prev2 = (before[before.length - 2] ?? "").toLowerCase();
  if (kind === "share" && before.length === 0) return "[host]";
  if (PLACEHOLDER.test(name) || name === "." || name === "..") return name;
  // The user name: under /home, /Users, C:\Users, and Wine's drive_c\users (where Proton's is steamuser).
  if (prev === "home" || prev === "users" || prev === "documents and settings") return low === "public" || low === "default" || low === "steamuser" ? name : "[user]";
  // Steam's userdata\<account id>.
  if (prev === "userdata" && /^\d+$/.test(name)) return "[id]";
  if (/^\d+$/.test(name) || KEEP_FOLDERS.has(low) || (last && FILE_EXT.test(name))) return name;
  // A drive's label: under /mnt, /Volumes, /media/<user>, /run/media/<user>.
  if (kind === "unix" && (((prev === "mnt" || prev === "volumes") && before.length === 1) || (prev === "[user]" && prev2 === "media"))) return "[drive]";
  return "[folder]";
}

/** A path, every folder name that may name someone replaced. */
function cleanPath(root: string, rest: string, kind: PathKind): string {
  const before: string[] = [];
  const parts = rest.split(/((?:[\\/]|%2[Ff]|%5[Cc])+)/);
  const lastName = parts.reduce((at, p, i) => (p && i % 2 === 0 ? i : at), -1);
  let out = kind === "named-home" ? `~[user]${root.slice(-1)}` : root;
  parts.forEach((p, i) => {
    if (i % 2 === 1 || !p) out += p;
    else {
      out += cleanFolder(p, before, kind, i === lastName);
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
    const end = pathEnd(s, start + root.length, before === '"' || before === "'" ? before : null, kind !== "unix" && kind !== "rooted");
    const rest = s.slice(start + root.length, end);
    if (!rest) continue;
    if (kind === "unix" || kind === "rooted") {
      const names = rest.split(/(?:[\\/]|%2[Ff]|%5[Cc])+/).filter(Boolean);
      // A lone "/word" (a chat command), an address's path, the game's own item path: not a file's.
      if (names.length < 2 || names[0] === "Lotus" || API_ROOT.test(names[0]) || HTTP_METHOD.test(s.slice(Math.max(0, start - 10), start))) continue;
    }
    out += s.slice(at, start) + cleanPath(root, rest, kind);
    at = end;
  }
  return out + s.slice(at);
}
