// No file in the repository hides text: no zero-width, bidi-override, invisible or "tag"
// characters anywhere a reader (or a Claude session) could be shown one thing while the file holds
// another. Code that needs such a character writes it as an escape ("\u202E").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", "target", ".git", "dist", "gen", "vendor"]);
const TEXT = new Set([".ts", ".mts", ".mjs", ".js", ".svelte", ".css", ".html", ".json", ".md", ".rs", ".toml", ".yml", ".yaml", ".sh", ".ps1", ".py", ".txt", ".sql", ".tsx", ".hbs", ".spec", ".asc", ".desktop", ""]);
const HIDDEN = /[\u00AD\u034F\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* files(p);
    } else if (e.isFile() && TEXT.has(extname(e.name)) && statSync(p).size < 8_000_000) yield p;
  }
}

test("no file holds a hidden character", () => {
  const found: string[] = [];
  let read = 0;
  for (const f of files(".")) {
    if (f.startsWith("public/dev-")) continue; // browser dev mode's own local data, never committed
    read++;
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = HIDDEN.exec(line);
      if (m) found.push(`${f}:${i + 1}: U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
    });
  }
  assert.ok(read > 300, `read ${read} files`);
  assert.deepEqual(found, []);
});
