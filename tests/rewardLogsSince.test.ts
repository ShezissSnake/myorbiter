// TennoScope's logs are looked at every 10 minutes for reward screens MyOrbiter didn't see live.
// The page passes back the key of its last merged pass; a pass where no log file's size or time
// changed reads nothing (crates/myorbiter-data/src/reward_log.rs, reward_logs_since, counts the
// reads) and the page then merges nothing. Nothing here reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the page passes its last key, merges only screens that were read, and keeps the key once merged", () => {
  const app = source("src/App.svelte");
  const pass = app.slice(app.indexOf("async function importScreensNow()"), app.indexOf('console.error("reading TennoScope\'s reward log failed"'));
  assert.match(pass, /const \{ key, screens \} = await rewardScreens\(settings\.dataDir, screensKey\);/);
  assert.match(pass, /if \(screens\) \{\s*const next = mergeLogged\(settings\.game\.relicRuns, screens\);/, "nothing to merge when nothing changed");
  assert.ok(pass.indexOf("screensKey = key || null") > pass.indexOf("mergeLogged("), "the key is kept after the merge, so a failed one reads again");
});

test("the command takes the key and answers with the logs' key and the screens or none", () => {
  const lib = source("src-tauri/src/lib.rs");
  assert.match(lib, /async fn reward_screens\(dir: Option<String>, since: Option<String>\) -> Result<myorbiter_data::reward_log::LoggedScreens, String>/);
  assert.match(lib, /reward_logs_since\(&myorbiter_data::reward_log::reward_log_dirs\(&dir\), since\.as_deref\(\)\)/);
  const backend = source("src/lib/backend.ts");
  assert.match(backend, /invoke<LoggedScreens>\("reward_screens", \{ dir: dataDir \|\| null, since \}\)/);
});
