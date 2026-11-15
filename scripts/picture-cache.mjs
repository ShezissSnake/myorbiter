// The checks' picture cache. In the browser dev mode the demo's pages load item pictures from
// WFCD's copy on raw.githubusercontent.com, and Rivens reads Digital Extremes' weekly riven file
// from www-static.warframe.com. The sweep (scripts/ui-sweep.mjs), the screenshots and the
// help-picture check (scripts/screenshots.mjs, scripts/help-shots.mjs) contact no host: they
// answer those requests from this cache, on disk outside the repository, and refuse every other
// request that isn't to this machine, counting it; a run that refused any fails. The guard is on
// each page's browser context, so it holds for any window a page opens too, and a script's own
// routes that ask again (`route.fetch()`) only ever ask the demo server. Their browser resolves no
// name but localhost either (LAUNCH_ARGS), so a request no route answered fails rather than
// leaving the machine.
//
// A request the cache can't answer is refused and its address kept in the cache's wanted list.
// One step, run by hand, fetches what that list holds and the cache hasn't got, by GET, from those
// two hosts only (and only the paths the demo's pictures and the riven file are under), a few at
// a time with a pause, each with a time limit and a size limit, and is the only part of the checks
// that contacts a host:
//
//   node scripts/picture-cache.mjs --fill
//
// So on a new machine, for each check: run it (it lists the pictures it lacks and fails), run the
// fill step, and run it again. Each check shows pictures of its own, so the first run of another
// check can want a fill of its own. The cache is `myorbiter-check-pictures` in $XDG_CACHE_HOME (by
// default ~/.cache): per address, the answer's body in a file named by the address's SHA-256, and
// beside it a JSON file with the address, the status, the headers kept (KEEP) and the time of the
// fetch, plus `wanted.txt`, the addresses runs asked for. Nothing in it expires: to renew it,
// delete the folder, run each check once and fill.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { worldStateAsked } from "./no-world-state.mjs";

/** The two hosts the fill step may fetch from and the cache answers for, each with the path the demo's addresses start with. */
export const SOURCES = { "raw.githubusercontent.com": "/WFCD/warframe-items/", "www-static.warframe.com": "/repos/" };
/** The fill step, as a run's messages name it. */
export const FILL = "node scripts/picture-cache.mjs --fill";
/** Chromium resolves no host name but localhost: whatever no route answers can't leave the machine. */
export const LAUNCH_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"];
/** The fill step's limits for one address: the time to the end of its body, and the body's size. */
const FETCH_MS = 30_000;
const MAX_BYTES = 8 * 1024 * 1024;

const xdg = process.env.XDG_CACHE_HOME;
const useXdg = !!xdg && isAbsolute(xdg);
const dir = join(useXdg ? xdg : join(homedir(), ".cache"), "myorbiter-check-pictures");
/** The cache's folder as messages show it: never the resolved path, which holds a user name. */
const shown = `${useXdg ? "$XDG_CACHE_HOME" : "~/.cache"}/myorbiter-check-pictures`;
const wantedFile = join(dir, "wanted.txt");
/** The response headers kept and served again: what the pages read (the riven file's date) or need across origins. */
const KEEP = ["content-type", "last-modified", "access-control-allow-origin", "access-control-expose-headers"];

/**
 * Text with the cache's folder and the home folder as messages show them: for any line that may
 * carry a path (an error's message, a tool's output), since a resolved path holds a user name.
 */
export function hidePaths(text) {
  let s = String(text).replaceAll(dir, shown);
  const home = homedir();
  if (home && home !== "/") s = s.replaceAll(home, "~");
  return s;
}

/** A file error as a line may show it: its code and the cache's folder, never the path. */
const fileError = (e) => `${e?.code ?? e?.name ?? "error"} in ${shown}`;

/**
 * Passes a child's output on line by line, with paths hidden: what a server it starts prints (an
 * error naming a file of the repository) goes through here.
 */
export function relay(stream, to) {
  if (!stream) return;
  createInterface({ input: stream, crlfDelay: Infinity }).on("line", (line) => to.write(`${hidePaths(line)}\n`));
}

const key = (address) => createHash("sha256").update(address).digest("hex");
const metaFile = (address) => join(dir, `${key(address)}.json`);
const bodyFile = (address) => join(dir, key(address));
const cached = (address) => existsSync(metaFile(address));
/** An address the cache may hold: https, on one of the two hosts, under the path the demo's addresses there take. */
const fillable = (address) => {
  try {
    const u = new URL(address);
    return u.protocol === "https:" && !u.port && Object.hasOwn(SOURCES, u.hostname) && u.pathname.startsWith(SOURCES[u.hostname]);
  } catch {
    return false;
  }
};
/** This machine, as the scripts reach it: the demo server on localhost, and what a page makes itself. */
const local = (address) => {
  try {
    const u = new URL(address);
    return u.protocol === "data:" || u.protocol === "blob:" || u.hostname === "localhost";
  } catch {
    return false;
  }
};
/** Why the wanted list couldn't be read, when it couldn't. */
let wantedError = null;
/** The wanted list, or null when it can't be read. */
const wanted = () => {
  try {
    return existsSync(wantedFile) ? [...new Set(readFileSync(wantedFile, "utf8").split("\n").filter(fillable))] : [];
  } catch (e) {
    wantedError = e;
    return null;
  }
};

/** What the windows of this run were answered and refused, together. */
const run = { served: 0, missed: new Set(), missedAsked: 0, refused: new Map(), errors: new Set() };

/**
 * Before anything else on the page `p`, on its browser context (each `browser.newPage` has its
 * own), so a window it opens is held too: every request that isn't to this machine is answered
 * from the cache or refused and counted. The page's own routes come before its context's, so the
 * world-state stop (scripts/no-world-state.mjs) and a view's own stand-ins keep their own say.
 */
export async function guard(p) {
  await p.context().route(
    (u) => !local(u.href),
    async (r) => {
      const address = r.request().url();
      const get = r.request().method() === "GET";
      try {
        if (get && fillable(address) && cached(address)) {
          const meta = JSON.parse(readFileSync(metaFile(address), "utf8"));
          const body = readFileSync(bodyFile(address));
          run.served++;
          return await r.fulfill({ status: meta.status, headers: meta.headers, body }).catch(() => {});
        }
        if (get && fillable(address)) {
          run.missedAsked++;
          if (!run.missed.has(address)) {
            run.missed.add(address);
            mkdirSync(dir, { recursive: true });
            appendFileSync(wantedFile, `${address}\n`);
          }
        } else {
          let host = "?";
          try {
            host = new URL(address).host || new URL(address).protocol;
          } catch {}
          run.refused.set(host, (run.refused.get(host) ?? 0) + 1);
        }
      } catch (e) {
        // The cache can't be read or written: the request is refused, and the run fails.
        run.errors.add(fileError(e));
      }
      return r.abort("blockedbyclient").catch(() => {});
    },
  );
}

/** The line a run prints at its start: what the cache lacks of what earlier runs, of every check, asked for. */
export function cacheStartLine() {
  const all = wanted();
  if (all === null) return `the picture cache's list of wanted addresses can't be read (${fileError(wantedError)})`;
  const lacking = all.filter((a) => !cached(a)).length;
  if (!all.length) return `the picture cache (${shown}) has nothing yet: a picture this run asks for is listed and fails the run; then run ${FILL} and run this again`;
  if (lacking) return `${lacking} of the ${all.length} pictures checks have asked for are not in the cache (${shown}): run ${FILL} first; one this run asks for fails it`;
  return `pictures from the cache (${shown}), ${all.length} addresses asked for so far, all of them there (a picture no check asked for before is listed at the end)`;
}

/** The lines a run ends with, and whether they fail it: pictures the cache lacked, and any request outside this machine. */
export function cacheEnd() {
  const lines = [...run.missed].sort().map((a) => `NOT IN THE CACHE ${a}`);
  if (run.missed.size) lines.push(`${run.missed.size} pictures not in the cache: run ${FILL}`);
  for (const e of run.errors) lines.push(`PICTURE CACHE ${e}: the request was refused`);
  // Every request for another host that the cache didn't answer: each refused, none sent.
  const refused = [...run.refused].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`);
  if (run.missedAsked) refused.unshift(`${run.missedAsked} for pictures not in the cache`);
  if (worldStateAsked.count) refused.push(`${worldStateAsked.count} world-state`);
  const outside = run.missedAsked + [...run.refused.values()].reduce((n, c) => n + c, 0) + worldStateAsked.count;
  lines.push(`requests outside this machine, ${outside}${outside ? ` (each refused: ${refused.join(", ")})` : ""}; ${run.served} answered from the picture cache`);
  return { lines, failed: run.missed.size > 0 || run.refused.size > 0 || run.errors.size > 0 };
}

/** The body of `res`, or an error past MAX_BYTES. */
async function bodyOf(res) {
  const told = Number(res.headers.get("content-length"));
  if (told > MAX_BYTES) throw new Error(`over ${MAX_BYTES} bytes (${told})`);
  const parts = [];
  let size = 0;
  for await (const part of res.body ?? []) {
    size += part.length;
    if (size > MAX_BYTES) throw new Error(`over ${MAX_BYTES} bytes`);
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/** The fill step: fetches each wanted address the cache hasn't got, from the two hosts only. */
async function fill() {
  const list = wanted();
  if (list === null) {
    console.log(`the wanted list can't be read (${fileError(wantedError)})`);
    process.exitCode = 1;
    return;
  }
  const todo = list.filter((a) => !cached(a));
  console.log(`${todo.length} addresses to fetch into ${shown}`);
  const agent = "myorbiter-picture-cache (+https://github.com/ShezissSnake/myorbiter)";
  let fetched = 0;
  const failed = [];
  const one = async (address) => {
    if (!fillable(address)) return;
    let res;
    let body;
    try {
      // No redirects: a redirect could lead to another host. The time limit runs to the body's end.
      res = await fetch(address, { headers: { "user-agent": agent }, redirect: "manual", signal: AbortSignal.timeout(FETCH_MS) });
      // A missing picture is kept as the page met it (WFCD answers 404), so the page shows the same.
      if (res.status !== 200 && res.status !== 404) throw new Error(`answered ${res.status}`);
      body = await bodyOf(res);
    } catch (e) {
      const why = e?.name === "TimeoutError" ? `no answer within ${FETCH_MS / 1000} s` : hidePaths(e instanceof Error ? e.message : e);
      failed.push(`${address}: ${why}`);
      return;
    }
    try {
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
      failed.push(`${address}: not written (${fileError(e)})`);
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
  try {
    if (process.argv.includes("--fill")) await fill();
    else console.log(`usage: ${FILL}\n${cacheStartLine()}`);
  } catch (e) {
    console.error(hidePaths(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  }
}
