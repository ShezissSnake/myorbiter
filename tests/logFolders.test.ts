// Settings, Logs: each log folder button opens its folder through the app (folder.rs, with the
// AppImage's libraries kept away from the file manager) and answers on the button itself: "Opened",
// or "Couldn't open" with the reason under it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("both log folder buttons run a job that opens the folder, and say how it went on the button", () => {
  const sheet = src("src/lib/SettingsSheet.svelte");
  for (const which of ["myorbiter", "tennoscope"]) {
    const button = sheet.match(new RegExp(`<ProgressButton job=\\{logJobs\\.get\\("${which}"\\)\\}[^\\n]*/>`))?.[0] ?? "";
    assert.ok(button, `${which}: a button that answers`);
    assert.match(button, new RegExp(`onclick=\\{\\(\\) => openLogs\\("${which}"\\)\\}`), `${which}: the click opens it`);
    assert.match(button, /failLabel="Couldn't open"/);
    assert.match(button, /\bstatus\b/, `${which}: the reason shows under the button`);
  }
  assert.match(sheet, /logJobs\.get\(which\)\.run\(async \(\) => \{\s*await openLogFolder\(which, settings\.dataDir\);\s*return "Opened";/);
  assert.doesNotMatch(sheet, /logError/, "no separate error line that a click could miss");
});

test("the app opens a log folder through folder.rs, not straight through the opener plugin", () => {
  const lib = src("src-tauri/src/lib.rs");
  const command = lib.slice(lib.indexOf("fn open_log_folder"), lib.indexOf("// ---------------------------------------------------------------- bug reports"));
  assert.match(command, /spawn_blocking\(move \|\| open_log_folder_now/, "waits for the opener off the async runtime");
  assert.match(command, /folder::open\(app, Path::new\(&path\)\)/);
  assert.doesNotMatch(command, /open_path/);
  const folder = src("src-tauri/src/folder.rs");
  assert.match(folder, /crate::companion::plain_command\(bin\)/, "each opener without the AppImage's environment");
  assert.match(folder, /\("xdg-open", &\[\]\), \("gio", &\["open"\]\)/);
  assert.match(folder, /#\[cfg\(not\(target_os = "linux"\)\)\]\s*\{\s*use tauri_plugin_opener::OpenerExt;/, "the opener plugin only off Linux");
});
