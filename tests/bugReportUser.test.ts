// Report a bug: this computer's user name (core/redact.ts, "user names"). MyOrbiter learns it, as the
// home folder's name, from the paths the page already holds and from a home folder written in the
// report's own lines; known, it is hidden as "[user]" wherever it stands as a word, unless it is an
// ordinary word a report needs. Every name here is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReport, detailsText, newIssuePage, type ReportDetails } from "../src/lib/core/bugReport";
import { homeNames, homeNamesIn, hideNames, ordinaryName, redact } from "../src/lib/core/redact";

const details = (log: string[]): ReportDetails => ({ version: "0.1.0", commit: "a1b2c3d", buildDate: "2026-11-03", channel: null, os: "linux", arch: "x86_64", page: "Orders", tennoscope: "connected", fullMode: "off", log });

test("user names: learned from the paths the page holds, by the home folder's shape", () => {
  // The game log's file as found under Proton (its Wine user is steamuser, no one's), TennoScope's
  // default folder on Windows (a name with a space), macOS and an immutable Linux.
  assert.deepEqual(homeNames(["/home/orrenvale/.local/share/Steam/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log"]), ["orrenvale"]);
  assert.deepEqual(homeNames(["C:\\Users\\Orren Taskwell\\AppData\\Roaming\\io.github.deftera186.tennoscope"]), ["Orren Taskwell"]);
  assert.deepEqual(homeNames(["C:\\Users\\Orren Taskwell\\AppData\\Local\\Warframe\\EE.log"]), ["Orren Taskwell"]);
  assert.deepEqual(homeNames(["/Users/kestrin/Library/Application Support/io.github.deftera186.tennoscope"]), ["kestrin"]);
  assert.deepEqual(homeNames(["/var/home/brynhal/.local/share/io.github.deftera186.tennoscope"]), ["brynhal"]);
  // A home of another shape, told by the folders a home holds.
  assert.deepEqual(homeNames(["/data/talqen/.local/share/io.github.deftera186.tennoscope"]), ["talqen"]);
  assert.deepEqual(homeNames(["D:\\Profiles\\Talqen\\AppData\\Local\\Warframe\\EE.log"]), ["Talqen"]);
  // Wine: its Z: drive, and a prefix's own user (not Proton's).
  assert.deepEqual(homeNames(["Z:\\home\\vexmora\\Games\\EE.log"]), ["vexmora"]);
  assert.deepEqual(homeNames(["/home/vexmora/.wine/drive_c/users/vexmora/AppData/Local/Warframe/EE.log"]), ["vexmora"]);
  assert.deepEqual(homeNames(["/run/media/vexmora/Games/SteamLibrary/x"]), ["vexmora"]);
  assert.deepEqual(homeNames(["~vexmora/Games/EE.log"]), ["vexmora"]);
  assert.deepEqual(homeNames(["file:///home/vexmora/x"]), ["vexmora"]);
  // Several paths, each name once.
  assert.deepEqual(homeNames(["/home/orrenvale/x", "", null, undefined, "/home/orrenvale/.local/share/io.github.deftera186.tennoscope"]), ["orrenvale"]);
  // Nothing to learn: no path saved or found, a folder outside any home, the browser's "~", a
  // data folder set elsewhere, Proton's steamuser, a variable.
  for (const p of ["", "~/.local/share/io.github.deftera186.tennoscope", "/srv/xdg/io.github.deftera186.tennoscope", "/mnt/games/SteamLibrary/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log", "$HOME/.local/share/x", "C:\\Users\\Public\\x", "/home"]) {
    assert.deepEqual(homeNames([p]), [], p);
  }
});

test("user names: learned from a home folder in the report's own lines; not from a stranger's chat", () => {
  assert.deepEqual(homeNamesIn(["found at /home/orrenvale/.local/x"]), ["orrenvale"]);
  assert.deepEqual(homeNamesIn(["copied to file:///home/orrenvale/x"]), ["orrenvale"]);
  assert.deepEqual(homeNamesIn(["~kestrin/Games/EE.log"]), ["kestrin"]);
  // With a slash after it, a name with spaces is whole; without, its first word, as the words
  // after it may be the sentence's.
  assert.deepEqual(homeNamesIn(["C:\\Users\\Orren Taskwell\\AppData"]), ["Orren Taskwell"]);
  assert.deepEqual(homeNamesIn(["C:\\Users\\Brynhal Kestrel said hi"]), ["Brynhal"]);
  assert.deepEqual(homeNamesIn(["/home/brynhal, has 30p"]), ["brynhal"]);
  // warframe.market's addresses and Proton's user are not a home.
  assert.deepEqual(homeNamesIn(["GET /v1/users/SellerExample/reviews", "https://warframe.market/users/SellerExample", "drive_c/users/steamuser/x"]), []);
  // A warframe.market chat's words are a stranger's: a home folder there teaches nothing.
  assert.deepEqual(homeNamesIn(["siteChat: SellerExample messaged you on warframe.market (SellerExample: see /home/sale/x)"]), []);
});

test("user names: known, hidden in a path of a shape the path rule leaves as written (T18's named gaps)", () => {
  // Each pair: as the path rule alone leaves it (pinned in bugReport.test.ts), then with the name known.
  const gaps: [string, string, string, string][] = [
    ["Orren", "D:\\Games\\Dev Orren", "D:\\Games\\Dev Orren", "D:\\Games\\Dev [user]"],
    ["Orren Taskwell", "drive_c/users/Orren Taskwell", "drive_c/users/[user] Taskwell", "drive_c/users/[user]"],
    ["Orren Taskwell", "~Orren Taskwell/x", "~Orren Taskwell/x", "~[user]/x"],
    ["Orren O'Taskwell", "'D:\\Games\\Orren O'Taskwell'", "'D:\\Games\\[folder]'Taskwell'", "'D:\\Games\\[user]'[user]'"],
    ["Orren A. Taskwell", "C:/Users/Orren A. Taskwell", "C:/Users/[user]. Taskwell", "C:/Users/[user]. [user]"],
    ["Orren Taskwell", "/home/Orren Taskwell,D:\\Kestrel\\Bryn", "/home/[user]:\\Kestrel\\Bryn", "/home/[user]:\\Kestrel\\Bryn"],
    ["Orren", '"/mnt/Orren see EE.log', '"/mnt/Orren see EE.log', '"/mnt/[user] see EE.log'],
    ["Orren", "found ~orren here", "found ~orren here", "found ~[user] here"],
  ];
  for (const [user, text, alone, known] of gaps) {
    assert.equal(redact(text), alone, text);
    assert.equal(redact(text, { user: [user] }), known, text);
    // The names step reads it the same way, whether a path is read or not.
    assert.ok(!hideNames(text, { user: [user] }).toLowerCase().includes(user.split(" ")[0].toLowerCase()), text);
  }
});

test("user names: known, a ~name/ or $name/ path still loses its folder names, as it does when the name isn't known", () => {
  // Each: the text, as the path rule alone leaves it, then with the name known (the name hidden
  // too where the path rule keeps it, as a variable's name).
  const cases: [string, string, string][] = [
    ["copied it to ~orrenvale/Brynwood Contract/notes/EE.log", "copied it to ~[user]/[folder]/[folder]/EE.log", "copied it to ~[user]/[folder]/[folder]/EE.log"],
    ["~Orrenvale.x/Hushfolder/x", "~[user]/[folder]/[folder]", "~[user]/[folder]/[folder]"],
    ["$Orrenvale/Hushfolder/x", "$Orrenvale/[folder]/[folder]", "$[user]/[folder]/[folder]"],
    ["${Orrenvale}/Hushfolder/x", "${Orrenvale}/[folder]/[folder]", "${[user]}/[folder]/[folder]"],
    ["%Orrenvale%\\Hushfolder\\x", "%Orrenvale%\\[folder]\\[folder]", "%[user]%\\[folder]\\[folder]"],
    ["https://warframe.market/profile/K,$Orrenvale/Secretproj", "https://warframe.market/profile/[player],$Orrenvale/[folder]", "https://warframe.market/profile/[player],$[user]/[folder]"],
    ["https://warframe.market/profile/K,~orrenvale/Secretproj/x", "https://warframe.market/profile/[player],~[user]/[folder]/[folder]", "https://warframe.market/profile/[player],~[user]/[folder]/[folder]"],
  ];
  for (const [text, alone, known] of cases) {
    assert.equal(redact(text), alone, text);
    assert.equal(redact(text, { user: ["orrenvale"] }), known, text);
  }
  // Learned from the line itself, with nothing held: the same.
  const r = buildReport({ what: "copied it to ~orrenvale/Brynwood Contract/notes/EE.log", steps: "", expected: "" }, details([]), {});
  assert.equal(r.what, "copied it to ~[user]/[folder]/[folder]/EE.log");
});

test("user names: a home folder, a folder or a profile with a mark glued to the user name loses what it loses when the name isn't known", () => {
  for (const [user, text] of [
    ["Orrenvale", "(/home/Orrenvale)-Brynwood x"],
    ["Orrenvale", "(/home/Orrenvale),Brynwood"],
    ["Orren Taskwell", "(/home/Taskwell;Brynwood"],
    ["Orrenvale", "C:\\Users\\Orrenvale words. Brynwood"],
    ["Orrenvale", "Z:\\home\\Orrenvale) Brynwood"],
    ["Orren Taskwell", "copied to /mnt/x/Orren Taskwell);Brynwood"],
    ["Orren Taskwell", "give //orren taskwell)(Brynwood) more +rep"],
    ["Orrenvale", "https://warframe.market/profile/Orrenvale),Brynwood"],
    ["Orrenvale", "https://warframe.market/profile/Orrenvale:Brynwood"],
  ]) {
    const alone = redact(text);
    assert.ok(!alone.includes("Brynwood"), text);
    const known = redact(text, { user: [user] });
    assert.ok(!known.includes("Brynwood") && !/orren|taskwell/i.test(known), `${text} → ${known}`);
  }
});

test("user names: another player's name found by its shape is hidden whole, also when it starts or ends with the user name", () => {
  const u = { user: ["Orrenvale"] };
  for (const [text, out] of [
    ["buyer: Orrenvale-Alt", "buyer: [player]"],
    ["Ash Prime Set: 20p from Orrenvale.Alt", "Ash Prime Set: 20p from [player]"],
    ["/w Orrenvale-Alt hi", "/w [player] hi"],
    ["https://warframe.market/profile/Orrenvale-Alt", "https://warframe.market/profile/[player]"],
    ["Alt-Orrenvale whispered you", "[player] whispered you"],
    ["3 people whispered you: Orrenvale-Alt, Kestrel", "3 people whispered you: [players]"],
    ["sold Ash Prime Set to Alt.Orrenvale for 20p", "sold Ash Prime Set to [player] for 20p"],
    ["Couldn't give Orrenvale-Alt +rep", "Couldn't give [player] +rep"],
    ["/Users/Orrenvale-Alt/x/y", "/Users/[user]/[folder]/[folder]"],
  ]) {
    assert.equal(redact(text), out, text);
    assert.equal(redact(text, u), out, text);
  }
  // The user name alone after such a mark stays [user]; outside such a line, [user]-PC as before.
  assert.equal(redact("buyer: Orrenvale", u), "buyer: [user]");
  assert.equal(redact("Orrenvale-PC froze", u), "[user]-PC froze");
});

test("user names: known, hidden bare in a log line's sentence, in any case, with spaces in it", () => {
  const u = { user: ["Orrenvale"] };
  assert.equal(redact("[2026-11-04][10:00:04][ui][ERROR] session for orrenvale ended", u), "[2026-11-04][10:00:04][ui][ERROR] session for [user] ended");
  // Another case than the folder's.
  assert.equal(redact("ORRENVALE's game froze; OrrenVale again", u), "[user]'s game froze; [user] again");
  // A two-word name: whole, with any spaces or %20 between, and each word on its own.
  const two = { user: ["Orren Taskwell"] };
  assert.equal(redact("Orren Taskwell signed in", two), "[user] signed in");
  assert.equal(redact("orren  TASKWELL signed in", two), "[user] signed in");
  assert.equal(redact("file:///C:/Users/Orren%20Taskwell/x", two), "file:///C:/Users/[user]/[folder]");
  assert.equal(redact("Hi Orren, said Taskwell", two), "Hi [user], said [user]");
  // A line cut at its length leaves half the name: its first word goes on its own.
  const long = buildReport({ what: "x", steps: "", expected: "" }, details([`${"y".repeat(370)} C:\\Users\\Orren Taskwell\\AppData\\Local\\Warframe\\EE.log`]), two);
  assert.ok(!/orren|taskwell/i.test(long.details!.log.join("\n")), long.details!.log.join("\n"));
  // Encoded paths, which the path rule passes as written: a slash, colon or space written %2F, %5C,
  // %3A or %20 is no letter.
  assert.equal(redact("file%3A%2F%2F%2Fhome%2Forrenvale%2Fx and %5C%5COrrenvale-PC%5Cshare", u), "file%3A%2F%2F%2Fhome%2F[user]%2Fx and %5C%5C[user]-PC%5Cshare");
  assert.equal(redact("x%2FOrrenvaleholm", u), "x%2FOrrenvaleholm");
  // Non-English letters: case folds, and a longer word keeps it.
  assert.equal(redact("josé JOSÉ Josélito", { user: ["José"] }), "[user] [user] Josélito");
});

test("user names: never cut out of a longer word; a hyphen, a dot or @ joins two words; an e-mail goes whole", () => {
  const u = { user: ["Kestrin"] };
  assert.equal(redact("Kestrinholm xKestrin Kestrin_2 Kestrin2", u), "Kestrinholm xKestrin Kestrin_2 Kestrin2");
  assert.equal(redact("Kestrin-PC and Kestrin.local", u), "[user]-PC and [user].local");
  assert.equal(redact("kestrin@example.org and a.kestrin@example.org", u), "[email] and [email]");
  // Beside "@" that isn't an e-mail address: a prompt's user@host, a mention.
  assert.equal(redact("kestrin@desktop:~$ ls; @Kestrin hi", u), "[user]@desktop:~$ ls; @[user] hi");
  assert.equal(redact("@Kestrin hi", { self: ["Kestrin"], user: ["Kestrin"] }), "@[user] hi");
  // Glued to a secret or an id, it never breaks one apart: what was hidden without the name stays so.
  for (const t of ["password=kestrin-secret123", "token=kestrin.abc123", "kestrin-0123456789abcdef0123", "Authorization: Bearer kestrin-xyz"]) {
    assert.equal(redact(t, u).replace("[user]", "kestrin"), redact(t).replace("[user]", "kestrin"), t);
  }
  assert.equal(redact("password=kestrin-secret123", u), "password=[redacted]");
  assert.equal(redact("kestrin-0123456789abcdef0123", u), "[user]-[id]");
});

test("user names: an ordinary word is hidden only where the path rule hides a user name", () => {
  // The Steam Deck's account is "deck": the report keeps "Steam Deck", the home folder goes.
  assert.equal(redact("Steam Deck froze at /home/deck/.local/share/Warframe/EE.log", { user: ["deck"] }), "Steam Deck froze at /home/[user]/.local/share/Warframe/EE.log");
  for (const word of ["deck", "user", "admin", "home", "steam", "games", "a", "1000", "Steam Deck", "PC", "x86_64"]) {
    assert.ok(ordinaryName(word), word);
    const line = `the ${word} page, ${word} again, at /home/${word}/x`;
    assert.equal(redact(line, { user: [word] }), redact(line), word);
  }
  // Not ordinary: a made-up name, or a name with one word that is not.
  for (const name of ["Orrenvale", "Orren Taskwell", "Deck Orren", "José"]) assert.ok(!ordinaryName(name), name);
  // A name with an ordinary word in it hides that word only as part of the whole name, the small
  // words of a sentence included.
  assert.equal(redact("Deck Orren left the Steam Deck", { user: ["Deck Orren"] }), "[user] left the Steam Deck");
  assert.equal(redact("the game froze on a new listing; The Orrenvale", { user: ["The Orrenvale"] }), "the game froze on a new listing; [user]");
  // Every word of it ordinary: an ordinary name.
  assert.equal(redact("the gamer froze; The Gamer", { user: ["The Gamer"] }), "the gamer froze; The Gamer");
  assert.equal(redact("the game froze on a new listing; New Orren", { user: ["New Orren"] }), "the game froze on a new listing; [user]");
  // Learned from a line without a slash after it, a name's first word may be a small word: it hides nothing.
  assert.deepEqual(homeNamesIn(["C:\\Users\\The Gamer said hi"]), ["The"]);
  assert.ok(ordinaryName("The"));
});

test("user names: the same name as the in-game name reads as [user], and goes everywhere", () => {
  const both = { self: ["Orrenvale"], user: ["Orrenvale"] };
  assert.equal(redact("Orrenvale sold Ash Prime Set for 20p", both), "[user] sold Ash Prime Set for 20p");
  assert.equal(redact("D:\\Games\\Dev Orrenvale", both), "D:\\Games\\Dev [user]");
  assert.equal(redact("/home/orrenvale/x", both), "/home/[user]/[folder]");
  // The in-game name alone stays [you], as before.
  assert.equal(redact("Orrenvale sold Ash Prime Set for 20p", { self: ["Orrenvale"] }), "[you] sold Ash Prime Set for 20p");
});

test("user names: a text without the name comes out as it does when the name isn't known, whatever letters and marks it holds", () => {
  // Short words, runs of one letter, the marks used while the rules run: none is taken for the name.
  const lines = [
    "can u fix it, siete u ocho, git push -u origin, QQ, uQQ, Q, QQQ u-Q u.QQ, ZZ, Zq, XJ x",
    "buyer: uQ 20p from QQ /w u hi, /profile/ZZ, give Q +rep",
    "U and QQ and Uq and u's, u%20QQ and %2Fu and u QQ QQ",
    "/home/u/x and /home/QQ/y ~u/a $QQ/b C:\\Users\\Q Z\\x /mnt/x/ZZ) more",
    "[usr] [plyusr] [usa] [plyusa] [user] [player] [you]",
  ];
  for (const line of lines) {
    for (const names of [{}, { self: ["Kestrel"], others: ["Vexmora"] }]) {
      for (const user of ["Orrenvale", "Orren Taskwell", "Bryn O'Hal"]) {
        assert.equal(redact(line, { ...names, user: [user] }), redact(line, names), `${line} with ${user}`);
        assert.equal(hideNames(line, { ...names, user: [user] }), hideNames(line, names), `${line} with ${user}`);
      }
    }
  }
  // With the name in it too, only the name changes.
  assert.equal(redact("can u fix it, QQ? Orrenvale says no", { user: ["Orrenvale"] }), "can u fix it, QQ? [user] says no");
  // A text that holds every letter still keeps its own words.
  const every = "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz Q QQ u uQ Z ZZ";
  assert.equal(redact(`${every} Orrenvale`, { user: ["Orrenvale"] }), `${every} [user]`);
  // Every letter and short words after an encoded slash or space: the word after `]%2F` is `Q`.
  // Every letter standing alone as a word, and runs of two.
  const alone = "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z a b c d e f g h i j k l m n o p q r s t u v w x y z";
  const crowded = [
    "sold Ash Prime Set to q%2F[usa]%2FQ) Brynwood-uQ/x/y",
    "buyer: [plyusr]%20QZZ\\uQQQ.u",
    "x XJ'[plyusa]%20Q) Zq",
    "https://warframe.market/profile/[user]%2FQ%2FuQ",
    `${alone} QZ ZQ QQ ZZ XJ uQ, /w QZ hi, buyer: ZZQ, /home/QZ/x, ~Q/a $ZZ/b`,
  ].map((l) => `Rewards QZXJKVUBGHCqzxjkvubghc ABCDEFGHIJKLMNOPQRSTUVWXYZ noted ${alone}\n${l}`);
  for (const line of crowded) {
    for (const names of [{}, { others: ["Orrenvale"] }]) {
      assert.equal(redact(line, { ...names, user: ["Orrenvale"] }), redact(line, names), line);
      assert.equal(hideNames(line, { ...names, user: ["Orrenvale"] }), hideNames(line, names), line);
    }
  }
});

test("user names: a report hides in every field a name one line shows, and keeps it nowhere", () => {
  const held = { self: ["MeExample"], user: ["Orren Taskwell"] };
  const input = { what: "brynhal here: it froze", steps: "1. Open Orders as Orren", expected: "Taskwell's sales listed" };
  const log = ["[ee_log][INFO] found at /home/brynhal/.local/share/Steam/x", "[ui][ERROR] brynhal: TypeError"];
  const report = buildReport(input, details(log), held);
  assert.equal(report.what, "[user] here: it froze");
  assert.equal(report.steps, "1. Open Orders as [user]");
  assert.equal(report.expected, "[user]'s sales listed");
  assert.deepEqual(report.details!.log, ["[ee_log][INFO] found at /home/[user]/.local/share/Steam/[folder]", "[ui][ERROR] [user]: TypeError"]);
  assert.ok(!/brynhal|orren|taskwell/i.test(JSON.stringify(report) + detailsText(report.details!)));
  // The names given are not changed, and the report carries no list of names.
  assert.deepEqual(held, { self: ["MeExample"], user: ["Orren Taskwell"] });
  assert.deepEqual(Object.keys(report).sort(), ["details", "expected", "steps", "title", "what"]);
  // Without the details, the player's words still teach the name to the rest of them.
  assert.equal(buildReport({ what: "C:\\Users\\Brynhal\\EE.log froze; Brynhal", steps: "", expected: "" }, null).what, "C:\\Users\\[user]\\EE.log froze; [user]");
});

test("user names: the address opened carries what it carried, a known name or not", () => {
  const env = { version: "0.2.140", os: "linux", arch: "x86_64" };
  assert.equal(newIssuePage(env, { user: ["Orrenvale", "deck"] }), newIssuePage(env));
  assert.equal(newIssuePage({ version: "0.2.140", os: "windows", arch: "x86_64" }, { user: ["Orren Taskwell"] }), newIssuePage({ version: "0.2.140", os: "windows", arch: "x86_64" }));
});

test("user names: the page reads them from what it holds, as the dialog opens, and keeps them nowhere", () => {
  const app = readFileSync("src/App.svelte", "utf8");
  const fn = app.slice(app.indexOf("function reportNames(): RedactOptions"), app.indexOf("function typing("));
  assert.match(fn, /user: homeNames\(\[settings\.eeLog, settings\.dataDir, defaultDir, mission\?\.path\]\),/);
  // No new command: every source is a value the page already has.
  assert.ok(!/invoke|await/.test(fn), "reportNames asks nothing");
  // Only reportNames uses it; the dialog reads it once as it opens, into a constant.
  const uses = (path: string) => (readFileSync(path, "utf8").match(/\bhomeNames\(/g) ?? []).length;
  assert.equal(uses("src/App.svelte"), 1);
  for (const f of ["src/lib/ui/BugReport.svelte", "src/lib/bugReport.svelte.ts", "src/lib/backend.ts"]) assert.equal(uses(f), 0, f);
  const ui = readFileSync("src/lib/ui/BugReport.svelte", "utf8");
  assert.match(ui, /const known = untrack\(\(\) => names\(\)\);/);
  assert.equal((ui.match(/\bknown\b/g) ?? []).length, 3, "declared once and passed to the report and the address only");
  assert.ok(!/logLine|saveSettings|localStorage/.test(ui), "the dialog logs and saves nothing");
});

test("user names: the privacy page, the dialog and the Guide say what is hidden, from where, and what then", () => {
  const doc = readFileSync("docs/privacy.md", "utf8");
  const from = doc.indexOf("\n## Reporting a bug\n");
  const para = doc.slice(from, doc.indexOf("\n## ", from + 1)).replace(/\s+/g, " ");
  assert.match(para, /Your user name on this computer is hidden as a known name, as `\[user\]` \(the path rule's own mark\), wherever it stands as a word/);
  assert.match(para, /learns it without asking your system anything new: from the paths it already holds as the report opens, the game log's file and TennoScope's folder, as saved in Settings or as found/);
  assert.match(para, /The name is kept only while the report is made: never saved, logged or sent\./);
  assert.match(para, /When MyOrbiter hasn't seen your home folder .* your user name is hidden only where the path rule hides a user name\./);
  assert.match(para, /Where the name such a gap leaves is your user name, MyOrbiter has seen it and it is no everyday word \(below\), it is hidden all the same\./);
  // The page's examples, as the code has them.
  for (const w of ["deck", "admin", "guest", "user", "home", "steam", "games", "linux", "connected", "a", "42"]) assert.ok(ordinaryName(w), w);
  assert.equal(redact("Orrenvale_2 Orrenvaleholm Orrenvale-PC", { user: ["Orrenvale"] }), "Orrenvale_2 Orrenvaleholm [user]-PC");
  assert.equal(redact("Steam Deck /home/deck/x", { user: ["deck"] }), "Steam Deck /home/[user]/[folder]");
  assert.match(para, /`~name\/a` becomes `~\[user\]\/\[folder\]`, `\$Name\/a` becomes `\$\[user\]\/\[folder\]`/);
  assert.equal(redact("~orrenvale/a", { user: ["Orrenvale"] }), "~[user]/[folder]");
  assert.equal(redact("$Orrenvale/a", { user: ["Orrenvale"] }), "$[user]/[folder]");
  assert.match(para, /`buyer: Name-Alt` becomes `buyer: \[player\]`/);
  assert.equal(redact("buyer: Orrenvale-Alt", { user: ["Orrenvale"] }), "buyer: [player]");
  assert.match(para, /Knowing the name hides nothing less than not knowing it: every other rule reads it as it reads the name itself and takes with it what it takes with the name \(`\/home\/name\),more` becomes `\/home\/\[user\]`, as it does when the name isn't known\)\./);
  for (const opts of [{}, { user: ["Orrenvale"] }, { self: ["Orrenvale"], user: ["Orrenvale"] }]) assert.equal(redact("/home/orrenvale),more", opts), "/home/[user]");
  assert.match(para, /`AppData\\Roaming`, `AppData\\Local`, `AppData\\LocalLow` or `Library\/Application Support`/);
  for (const sub of ["Roaming", "Local", "LocalLow"]) assert.deepEqual(homeNames([`D:\\Profiles\\Talqen\\AppData\\${sub}\\x`]), ["Talqen"], sub);
  const ui = readFileSync("src/lib/ui/BugReport.svelte", "utf8");
  assert.match(ui, /So is your user name on this computer, as your home folder's name, wherever it stands as a word, once MyOrbiter has seen that folder \(in the game log's or TennoScope's location, or in the report itself\); if it hasn't, or the name is an everyday word like deck or user, only in paths\./);
  const guide = readFileSync("src/lib/tabs/Guide.svelte", "utf8");
  assert.match(guide, /your user name on this computer \(your home folder's name\) wherever it stands as a word once MyOrbiter has seen that folder, in the game log's or TennoScope's location or in the report \(only in paths if it hasn't, or if the name is an everyday word like deck\)/);
  assert.match(detailsText(details(["x"])), /players' names, this computer's user name where known and folder names in recognised paths hidden/);
});
