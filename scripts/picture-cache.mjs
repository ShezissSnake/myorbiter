// The checks' picture cache. In the browser dev mode the demo's pages load item pictures from
// WFCD's copy on raw.githubusercontent.com, and Rivens reads Digital Extremes' weekly riven file
// from www-static.warframe.com. The sweep (scripts/ui-sweep.mjs), the screenshots and the
// help-picture check (scripts/screenshots.mjs, scripts/help-shots.mjs) contact no host: they
// answer those requests from this cache, on disk outside the repository, and refuse every other
// request that isn't to this machine, counting it. Their browser resolves no name but localhost
// either (LAUNCH_ARGS), so a request no route answered fails rather than leaving the machine.
//
// A request the cache can't answer is refused and its address kept in the cache's wanted list.
// One step, run by hand, fetches what that list holds and the cache hasn't got, by GET, from those
// two hosts only, a few at a time with a pause, and is the only part of the checks that contacts
// a host:
//
//   node scripts/picture-cache.mjs --fill
//
// So on a new machine: run a check (it lists the pictures it lacks and fails), run the fill step,
// and run the check again. The cache is `myorbiter-check-pictures` in $XDG_CACHE_HOME (by default
// ~/.cache): one file per address, named by its SHA-256, with its status and headers beside it.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worldStateAsked } from "./no-world-state.mjs";

/** The two hosts the fill step may fetch from, and the only ones the cache answers for. */
export const HOSTS = ["raw.githubusercontent.com", "www-static.warframe.com"];
/** The fill step, as a run's messages name it. */
export const FILL = "node scripts/picture-cache.mjs --fill";
/** Chromium resolves no host name but localhost: whatever no route answers can't leave the machine. */
export const LAUNCH_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"];

const xdg = process.env.XDG_CACHE_HOME;
const useXdg = !!xdg && isAbsolute(xdg);
const dir = join(useXdg ? xdg : join(homedir(), ".cache"), "myorbiter-check-pictures");
/** The cache's folder as messages show it: never the resolved path, which holds a user name. */
const shown = `${useXdg ? "$XDG_CACHE_HOME" : "~/.cache"}/myorbiter-check-pictures`;
const wantedFile = join(dir, "wanted.txt");
/** The response headers kept and served again: what the pages read (the riven file's date) or need across origins. */
const KEEP = ["content-type", "last-modified", "access-control-allow-origin", "access-control-expose-headers"];

const key = (address) => createHash("sha256").update(address).digest("hex");
const metaFile = (address) => join(dir, `${key(address)}.json`);
const bodyFile = (address) => join(dir, key(address));
const cached = (address) => existsSync(metaFile(address));
/** An address the cache may hold: https, on one of the two hosts. */
const fillable = (address) => {
  try {
    const u = new URL(address);
    return u.protocol === "https:" && HOSTS.includes(u.host);
  } catch {
    return false;
  }
};
const local = (address) => {
  try {
    const u = new URL(address);
    return u.protocol === "data:" || u.protocol === "blob:" || ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
};
const wanted = () => (existsSync(wantedFile) ? [...new Set(readFileSync(wantedFile, "utf8").split("\n").filter(fillable))] : []);

/** What the windows of this run were answered and refused, together. */
const run = { served: 0, missed: new Set(), refused: new Map() };

/**
 * Before anything else on the page `p`: every request that isn't to this machine is answered from
 * the cache or refused and counted. Routes added after this one come first, so the world-state
 * stop (scripts/no-world-state.mjs) and a view's own stand-ins keep their own say.
 */
export async function guard(p) {
  await p.route(
    (u) => !local(u.href),
    async (r) => {
      const address = r.request().url();
      if (r.request().method() === "GET" && fillable(address) && cached(address)) {
        const meta = JSON.parse(readFileSync(metaFile(address), "utf8"));
        run.served++;
        return r.fulfill({ status: meta.status, headers: meta.headers, body: readFileSync(bodyFile(address)) }).catch(() => {});
      }
      if (r.request().method() === "GET" && fillable(address)) {
        if (!run.missed.has(address)) {
          run.missed.add(address);
          mkdirSync(dir, { recursive: true });
          appendFileSync(wantedFile, `${address}\n`);
        }
      } else {
        const host = new URL(address).host || address.split(":")[0];
        run.refused.set(host, (run.refused.get(host) ?? 0) + 1);
      }
      return r.abort("blockedbyclient").catch(() => {});
    },
  );
}

/** The line a run prints at its start: what the cache lacks of what earlier runs asked for. */
export function cacheStartLine() {
  const all = wanted();
  const lacking = all.filter((a) => !cached(a)).length;
  if (!existsSync(dir) || !all.length) return `the picture cache (${shown}) has nothing yet: this run lists the pictures it needs and fails; then run ${FILL} and run this again`;
  if (lacking) return `${lacking} pictures not in the cache (${shown}): run ${FILL} first, or this run fails on them`;
  return `pictures from the cache (${shown}), ${all.length} addresses asked for so far, all of them there`;
}

/** The lines a run ends with, and whether they fail it: pictures the cache lacked, and requests outside this machine. */
export function cacheEnd() {
  const lines = [...run.missed].sort().map((a) => `NOT IN THE CACHE ${a}`);
  if (run.missed.size) lines.push(`${run.missed.size} pictures not in the cache: run ${FILL}`);
  // Every request for another host that the cache didn't answer: each refused, none sent.
  const refused = [...run.refused].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`);
  if (run.missed.size) refused.unshift(`${run.missed.size} pictures not in the cache`);
  if (worldStateAsked.count) refused.push(`${worldStateAsked.count} world-state`);
  const outside = run.missed.size + [...run.refused.values()].reduce((n, c) => n + c, 0) + worldStateAsked.count;
  lines.push(`requests outside this machine, ${outside}${outside ? ` (each refused: ${refused.join(", ")})` : ""}; ${run.served} answered from the picture cache`);
  return { lines, failed: run.missed.size > 0 };
}

/** The fill step: fetches each wanted address the cache hasn't got, from the two hosts only. */
async function fill() {
  const todo = wanted().filter((a) => !cached(a));
  console.log(`${todo.length} addresses to fetch into ${shown}`);
  const agent = "myorbiter-picture-cache (+https://github.com/ShezissSnake/myorbiter)";
  let fetched = 0;
  const failed = [];
  const one = async (address) => {
    if (!fillable(address)) return;
    try {
      // No redirects: a redirect could lead to another host.
      const res = await fetch(address, { headers: { "user-agent": agent }, redirect: "manual" });
      // A missing picture is kept as the page met it (WFCD answers 404), so the page shows the same.
      if (res.status !== 200 && res.status !== 404) throw new Error(`answered ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const headers = {};
      for (const h of KEEP) if (res.headers.get(h) !== null) headers[h] = res.headers.get(h);
      mkdirSync(dir, { recursive: true });
      // The body first, then its status and headers: an address counts as cached once those are there.
      const tmp = `.${process.pid}.tmp`;
      writeFileSync(bodyFile(address) + tmp, body);
      renameSync(bodyFile(address) + tmp, bodyFile(address));
      writeFileSync(metaFile(address) + tmp, JSON.stringify({ address, status: res.status, headers, at: new Date().toISOString() }));
      renameSync(metaFile(address) + tmp, metaFile(address));
      fetched++;
    } catch (e) {
      failed.push(`${address}: ${e instanceof Error ? e.message : e}`);
    }
  };
  // Four at a time, half a second between each four.
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(one));
    if (i + 4 < todo.length) await new Promise((r) => setTimeout(r, 500));
  }
  for (const f of failed) console.log(`FAILED ${f}`);
  console.log(`fetched ${fetched} of ${todo.length}, ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--fill")) await fill();
  else {
    console.log(`usage: ${FILL}\n${cacheStartLine()}`);
  }
}
