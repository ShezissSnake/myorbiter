// The checks' picture cache. In the browser dev mode the demo's pages load item pictures from
// WFCD's copy on raw.githubusercontent.com, and Rivens reads Digital Extremes' weekly riven file
// from www-static.warframe.com. The sweep (scripts/ui-sweep.mjs), the screenshots and the
// help-picture check (scripts/screenshots.mjs, scripts/help-shots.mjs) are built to contact no
// host. What the guard is shown, and what it does with it:
// - Requests and WebSockets, through Playwright's routes on each page's browser context (so from
//   the page, its frames and the windows it opens). One to localhost, `data:` or `blob:` goes
//   through; a GET for an item picture or the riven file is answered from this cache, on disk
//   outside the repository; any other is refused and counted.
// - The constructors that reach the network past a route (Worker, SharedWorker, WebTransport,
//   RTCPeerConnection, and registering a service worker), taken from each page and frame before
//   its own scripts run: using one is refused and counted.
// - The sweep's reward-screen route answers only the demo server's file, asking it again with
//   `route.fetch({ maxRedirects: 0 })`. Node's own requests ask the demo server's port only and
//   follow no redirect.
// A run that refused any fails; one that refused none ends with `requests outside this machine, 0`.
//
// Not shown to the guard, and left to the browser's launch rule (LAUNCH_ARGS: it resolves no name
// but localhost):
// - a redirect from localhost that the browser follows (a route sees a request's first address
//   only), the reward-screen route's answer included, as it passes a 3xx on;
// - speculation-rules prefetch and prerender (`<script type=speculationrules>`);
// - a connection or name lookup made ahead of any request (`<link rel=preconnect>`,
//   `dns-prefetch`).
// None of them is counted: a run with one passes. In probes the launch rule held the redirects
// and the speculation rules (with it off, they reached another host); a preconnect made no
// connection with the rule on or off. Not probed: `dns-prefetch`, and an address written as
// numbers, other than 127.0.0.1, against the launch rule. The demo's pages use none of these
// today.
//
// No printed line names the home folder, the repository's folder, this cache's, Playwright's
// browsers' (when PLAYWRIGHT_BROWSERS_PATH is set) or the temporary folder (when it isn't /tmp):
// each is shown as `~`, `<repository>`, the cache's variable, `$PLAYWRIGHT_BROWSERS_PATH` or
// `$TMPDIR` (hidePaths). That holds for a stop before a run begins once this helper has loaded (a
// bad argument, Playwright not installed). A script of the repository that can't be found stops
// Node before this helper loads, and that error prints its full path. Another path an error names
// is not hidden.
//
// A picture request the guard is shown and the cache can't answer is refused and its address kept
// in the cache's wanted list. One step, run by hand, fetches what that list holds and the cache
// hasn't got, by GET, from those two hosts only and only addresses of the two shapes the demo uses
// (SHAPES), a few at a time with a pause, each with a time limit and a size limit, and is the only
// part of the checks written to fetch:
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
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { worldStateAsked } from "./no-world-state.mjs";

/**
 * The two hosts the fill step may fetch from and the cache answers for, each with the one shape of
 * path the demo's addresses there take: a WFCD item picture (`imageUrl` in src/lib/backend.ts) and
 * the weekly riven file (`tradeUrl` in src/lib/core/rivens.ts).
 */
export const SHAPES = {
  "raw.githubusercontent.com": /^\/WFCD\/warframe-items\/[A-Za-z0-9_-][A-Za-z0-9._-]*\/data\/img\/[A-Za-z0-9_~%-][A-Za-z0-9._~%-]*$/,
  "www-static.warframe.com": /^\/repos\/weeklyRivens[A-Za-z0-9]*\.json$/,
};
/** The fill step, as a run's messages name it. */
export const FILL = "node scripts/picture-cache.mjs --fill";
/** Chromium resolves no host name but localhost: what the head comment leaves to it is held by this. */
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
 * The folders a printed line may name, each with what it shows instead, longest first: the
 * cache's, Playwright's browsers' when set, the repository's, the temporary folder when it isn't
 * /tmp, and the home folder. A resolved path can hold a user name, wherever the checkout is.
 */
const HIDDEN = [
  [dir, shown],
  [process.env.PLAYWRIGHT_BROWSERS_PATH, "$PLAYWRIGHT_BROWSERS_PATH"],
  [fileURLToPath(new URL("..", import.meta.url)), "<repository>"],
  [tmpdir() === "/tmp" ? null : tmpdir(), "$TMPDIR"],
  [homedir(), "~"],
]
  .filter(([p]) => p && isAbsolute(p) && p !== "/")
  .flatMap(([p, as]) => {
    const bare = p.replace(/[/\\]+$/, "");
    // The path as written, and as a file: address writes it (an error's stack).
    return [bare, pathToFileURL(bare).pathname].map((form) => [new RegExp(`${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![^/\\\\:'"\`\\s),\\]])`, "g"), as]);
  })
  .sort((a, b) => b[0].source.length - a[0].source.length);

/** Text with every folder of HIDDEN as messages show it: for any line that may carry a path. */
export function hidePaths(text) {
  let s = String(text);
  for (const [re, as] of HIDDEN) s = s.replace(re, as);
  return s;
}

// A script that stops before its run begins, once this one has loaded (a bad argument, a missing
// file, Playwright not installed), would have Node print its error with the script's full path:
// printed here with the paths hidden instead. A static import that can't be found (a script of the
// repository missing) stops Node before this runs, and is printed as Node prints it.
const stopped = (e) => {
  console.error(hidePaths(e instanceof Error ? (e.stack ?? e.message) : e));
  process.exit(1);
};
process.on("uncaughtException", stopped);
process.on("unhandledRejection", stopped);

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
    // Written as the browser writes it (no other spelling of the same address), with nothing but
    // the host and the path: no port, sign-in, query or fragment, and no encoded slash, backslash
    // or dot that a server might decode into another path. A bare `?` or `#` at the end still
    // passes: the `?` asks the same host for the same file, and a `#` is never sent.
    return (
      address === u.href &&
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      Object.hasOwn(SHAPES, u.hostname) &&
      SHAPES[u.hostname].test(u.pathname) &&
      !/%2f|%5c|%2e/i.test(u.pathname)
    );
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
/** Counts one refused request or connection, by its host (or by what it was, for one with no address yet). */
const refuse = (what) => run.refused.set(what, (run.refused.get(what) ?? 0) + 1);
const hostOf = (address) => {
  try {
    return new URL(address).host || new URL(address).protocol;
  } catch {
    return "?";
  }
};
/**
 * What a page could reach the network with past a route: Playwright routes requests (from a page,
 * its frames, its windows, a dedicated worker or a service worker) and WebSockets, but not what a
 * shared worker asks, a WebTransport session, a peer connection's packets, or a worker's own
 * sockets. The demo uses none of these, so each is taken from each page and frame before its own
 * scripts run: using one is refused, counted, and fails the run. (Vite's client asks for a shared worker
 * only when its socket to the dev server has dropped.)
 */
const TAKEN = ["Worker", "SharedWorker", "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection"];

/**
 * Before anything else on the page `p`, on its browser context (each `browser.newPage` has its
 * own), so a window or frame it opens is held too: a request or WebSocket the routes are shown
 * that isn't to this machine is answered from the cache or refused and counted, and the ways past
 * a route (TAKEN, and registering a service worker) are refused and counted. The page's own routes
 * come before its context's, so the world-state stop (scripts/no-world-state.mjs) and a view's own
 * stand-ins keep their own say. Left to the browser's launch rule (LAUNCH_ARGS), as no route is
 * shown them (the head comment lists them): a redirect the browser follows from localhost,
 * speculation-rules prefetch and prerender, and a connection or name lookup made ahead of any
 * request (`<link rel=preconnect>`, `dns-prefetch`).
 */
export async function guard(p) {
  const context = p.context();
  await context.routeWebSocket(
    (u) => !local(u.href),
    (ws) => {
      refuse(hostOf(ws.url()));
      ws.close();
    },
  );
  await context.exposeBinding("__checksRefuse", (_source, what) => refuse(String(what)));
  await context.addInitScript((taken) => {
    const no = (what) => {
      try {
        globalThis.__checksRefuse?.(what);
      } catch {}
      return new DOMException(`${what} is refused while the checks run`, "SecurityError");
    };
    for (const name of taken) {
      if (!(name in globalThis)) continue;
      Object.defineProperty(globalThis, name, {
        configurable: false,
        writable: false,
        value: function () {
          throw no(name);
        },
      });
    }
    if (globalThis.ServiceWorkerContainer) {
      Object.defineProperty(ServiceWorkerContainer.prototype, "register", {
        configurable: false,
        writable: false,
        value: () => Promise.reject(no("a service worker")),
      });
    }
  }, TAKEN);
  await context.route(
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
        } else refuse(hostOf(address));
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
  // The requests for another host that the guard was shown and the cache didn't answer: each
  // refused, none sent.
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
