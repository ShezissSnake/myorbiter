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
// - the name part of any other file path, wherever it points (another drive, a mount, a network
//   share): see `cleanPath` below for what stays;
// - the player's balance (platinum, credits, Endo and the like held), in the shapes it can take; a
//   listing's or a sale's price stays ("for 120 platinum", "20p from …"): prices are public and
//   help find repricing bugs;
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

/** A balance by its key: the game's own wallet fields, and plain "balance" or "wallet". */
const BALANCE_KEY = /(["']?)\b(balance|wallet|PremiumCredits(?:Free)?|RegularCredits|FusionPoints|PrimeTokens|(?:platinum|plat|credits|endo)[_ -]?(?:held|balance|owned))\1(\s*[=:]\s*["']?)\d+(?:[,._]\d+)*(?:\s?k\b)?/gi;
/** The currencies a balance is counted in. */
const CURRENCY = "platinum|plat|p|credits?|endo|ducats|aya|kuva";
/** "you have 1,234 platinum", "You now hold 12k credits", and a line cut short after the number. */
const BALANCE_HAVE = new RegExp(`\\b(you(?:\\s+now)?\\s+(?:have|hold|own|have got|'ve got))\\s+\\d+(?:[,.]\\d+)*(?:\\s?k)?(?:\\s*(${CURRENCY})\\b|(?=\\s*[A-Za-z]{0,8}$))`, "gim");
/** "your platinum: 1234", "Your credits are 3,000,000". */
const BALANCE_YOUR = new RegExp(`(\\byour\\s+(?:platinum|plat|credits|endo|ducats|balance|wallet)(?:\\s+(?:is|are|was|were|now|balance))*\\s*[:=]?\\s*)\\d+(?:[,.]\\d+)*(?:\\s?k\\b)?`, "gi");
/** "1234 platinum held", "1234 platinum, as of the last inventory read". */
const BALANCE_HELD = new RegExp(`\\b\\d+(?:[,.]\\d+)*(?:\\s?k)?\\s*(platinum|plat|credits|endo)(,?\\s+(?:held|on hand|in hand|in (?:your|the) (?:account|wallet)|as of the last inventory read))`, "gi");

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
  // A balance: the platinum, credits or Endo the player holds. Never a price: those stay.
  [BALANCE_KEY, (_m, q, k, sep) => `${q}${k}${q}${sep}[balance]`],
  [BALANCE_HAVE, (_m, lead, unit) => `${lead} [balance]${unit ? ` ${unit}` : ""}`],
  [BALANCE_YOUR, (_m, lead) => `${lead}[balance]`],
  [BALANCE_HELD, (_m, unit, tail) => `[balance] ${unit}${tail}`],
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
// The rule for a file path anywhere in a line (a game on another drive, a mount, a network share,
// the log's "found at" line), with either slash, in quotes or bare: each folder name is kept only
// when it names no one, and replaced otherwise.
//
// - Kept: the kind of place (the root `/`, a drive letter `D:`, `~`, `/mnt`, `/media`,
//   `/run/media`, `/Volumes`, `\\` for a share); the folder names every system, Steam, Proton,
//   Wine, the game, its launcher, TennoScope and MyOrbiter use (`KEEP_FOLDERS`); numbers (Steam's
//   app ids); and any name with a file's extension (`EE.log`, `orbiter.AppImage`), the file's
//   name included.
// - Replaced: everything else. The name under `/home`, `/Users` or `C:\Users` becomes `[user]` (as
//   the home rules above already make it); a drive's label under `/mnt`, `/Volumes`,
//   `/media/<user>` or `/run/media/<user>` becomes `[drive]`; a share's computer becomes `[host]`;
//   any other folder becomes `[folder]`, one for each.
//
// A path in quotes runs to the closing quote. A bare one runs to the first space, except that a
// folder name with spaces inside it ("My Games") is taken whole when another slash follows it.
// Not paths: an address's path (after a host, or after GET, PATCH and the like) and the game's own
// item paths (`/Lotus/…`); a lone `/word` (a chat command) is left alone too.

/** Folder names that name no one, compared without case. */
const KEEP_FOLDERS = new Set([
  // Systems
  "home", "users", "user", "root", "mnt", "media", "run", "var", "usr", "opt", "srv", "tmp", "temp", "etc", "bin", "sbin", "lib", "lib32", "lib64", "share", "local", "data", "games", "game", "app", "apps", "applications", "library", "private", "volumes", "nix", "store", "snap", "flatpak", "proc", "sys", "dev", "boot",
  ".local", ".config", ".cache", ".var", ".steam", ".wine", "public", "shared", "default", "x86_64", "i386", "x64", "x86",
  "windows", "system32", "syswow64", "program files", "program files (x86)", "programdata", "appdata", "roaming", "locallow", "documents", "my documents", "documents and settings", "desktop", "downloads", "saved games", "my games",
  "application support", "caches", "logs", "log", "preferences", "containers",
  // Steam, Proton, Wine and other launchers
  "steam", "steamapps", "steamlibrary", "steam library", "common", "compatdata", "pfx", "drive_c", "dosdevices", "steamuser", "userdata", "shadercache", "workshop", "downloading", "ubuntu12_32", "ubuntu12_64", "steamrt", "steam linux runtime", "proton experimental", "com.valvesoftware.steam",
  "lutris", "heroic", "prefix", "prefixes", "wine", "bottles", "epic games", "epicgameslauncher", "legendary", "gog games",
  // The game, its launcher, TennoScope, MyOrbiter
  "warframe", "digital extremes", "tools", "launcher", "downloaded", "tennoscope", "myorbiter", "orbiter", "dev.myorbiter.app", "resources", "assets",
]);
/** A file's extension: a name ending in one is a file's (or a bundle's) name, kept. */
const FILE_EXT = /\.(?:log|txt|json|jsonl|toml|ini|cfg|conf|xml|ya?ml|csv|md|db|sqlite3?|db-wal|db-shm|wal|lock|dat|bin|cache|tmp|bak|old|exe|dll|so|dylib|msi|appimage|deb|rpm|dmg|app|desktop|sh|bat|cmd|ps1|zip|gz|xz|7z|tar|png|jpe?g|webp|ico|svg|js|mjs|wasm|html?|css|ts|rs|py|pdb|pak|toc|windows)$/i;
/** Where a path starts: `/` (not inside an address), `~/`, `D:\` or `D:/`, `\\` (a share; `\\\\` in JSON). */
const PATH_START = /(?<=^|[\s"'(=[,;<>]|file:\/\/)(?:\/(?=[^\s/])|~[\\/]|\\{2,4}(?=[^\s\\])|(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}(?=[^\s\\/]))|(?<=file:\/\/\/)[A-Za-z]:[\\/](?=[^\s\\/])/g;
const HTTP_METHOD = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+$/;
/** A placeholder another rule left: kept as it is. */
const PLACEHOLDER = /^\[[a-z ]+\]$/;

type PathKind = "unix" | "drive" | "share" | "home";

/** Where the path whose names start at `from` ends. `quote`: the quote it is in, if any. */
function pathEnd(s: string, from: number, quote: string | null, spacedFirst: boolean): number {
  let i = from;
  let end = from;
  for (;;) {
    let j = i;
    if (quote) {
      while (j < s.length && s[j] !== "/" && s[j] !== "\\" && s[j] !== "\n" && s[j] !== quote) j++;
    } else {
      // A folder name with spaces in it, when a slash follows (no space at either end of it).
      let k = i;
      while (k < s.length && !/[\\/\n"'<>|*?:]/.test(s[k])) k++;
      const name = s.slice(i, k);
      if (k < s.length && (s[k] === "/" || s[k] === "\\") && name.length > 0 && name.length <= 80 && (spacedFirst || i > from || !/\s/.test(name)) && !/^\s|\s$|\s\s/.test(name)) j = k;
      else {
        // The last name: up to a space or punctuation a path doesn't end with ("…/EE.log: error", "…/EE.log.").
        while (j < s.length && !/[\s\\/"'<>|*?:,;()]/.test(s[j])) j++;
        while (j > i && s[j - 1] === ".") j--;
      }
    }
    if (j === i) break;
    end = j;
    let k = j;
    while (k < s.length && (s[k] === "/" || s[k] === "\\")) k++;
    if (k === j) break;
    end = k;
    i = k;
  }
  return end;
}

/** One folder name, as the rule above has it. `before`: the names before it in the path. */
function cleanFolder(name: string, before: string[], kind: PathKind): string {
  const low = name.toLowerCase();
  const prev = (before[before.length - 1] ?? "").toLowerCase();
  const prev2 = (before[before.length - 2] ?? "").toLowerCase();
  if (kind === "share" && before.length === 0) return "[host]";
  if (PLACEHOLDER.test(name) || name === "." || name === "..") return name;
  // The user name: under /home, /Users, C:\Users, and Wine's drive_c\users (where Proton's is steamuser).
  if (prev === "home" || prev === "users" || prev === "documents and settings") return low === "public" || low === "default" || low === "steamuser" ? name : "[user]";
  if (/^\d+$/.test(name) || KEEP_FOLDERS.has(low) || FILE_EXT.test(name)) return name;
  // A drive's label: under /mnt, /Volumes, /media/<user>, /run/media/<user>.
  if (kind === "unix" && (((prev === "mnt" || prev === "volumes") && before.length === 1) || (prev === "[user]" && prev2 === "media"))) return "[drive]";
  return "[folder]";
}

/** A path, every folder name that may name someone replaced. */
function cleanPath(root: string, rest: string, kind: PathKind): string {
  const before: string[] = [];
  let out = root;
  for (const p of rest.split(/([\\/]+)/)) {
    if (!p || /^[\\/]+$/.test(p)) out += p;
    else {
      out += cleanFolder(p, before, kind);
      before.push(p);
    }
  }
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
    const before = s[start - 1];
    const kind: PathKind = root.startsWith("~") ? "home" : root.startsWith("\\") ? "share" : root.startsWith("/") ? "unix" : "drive";
    // A bare path from "/" doesn't start with a name with spaces: that is a sentence ("/w Name hi").
    const end = pathEnd(s, start + root.length, before === '"' || before === "'" ? before : null, kind !== "unix");
    const rest = s.slice(start + root.length, end);
    if (!rest) continue;
    if (kind === "unix") {
      const names = rest.split(/[\\/]+/).filter(Boolean);
      // A lone "/word" (a chat command), an address's path, the game's own item path: not a file's.
      if (names.length < 2 || names[0] === "Lotus" || HTTP_METHOD.test(s.slice(Math.max(0, start - 10), start))) continue;
    }
    out += s.slice(at, start) + cleanPath(root, rest, kind);
    at = end;
  }
  return out + s.slice(at);
}
