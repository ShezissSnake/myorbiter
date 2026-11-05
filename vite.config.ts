import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/** The commit being built and its date, for the Guide ("This build: …"); "dev" outside a git checkout. */
function buildStamp(): { commit: string; date: string } {
  try {
    const out = execSync("git log -1 --format=%h%x20%cs", { encoding: "utf8" }).trim().split(" ");
    return { commit: out[0], date: out[1] ?? "" };
  } catch {
    return { commit: "dev", date: "" };
  }
}

/** public/dev-*.json is browser dev mode's stand-in for your own data: never ship it in a build. */
function dropDevData(): Plugin {
  let outDir = "dist";
  return {
    name: "orbiter-drop-dev-data",
    apply: "build",
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      for (const f of readdirSync(outDir)) if (/^dev-.*\.json$/.test(f)) rmSync(join(outDir, f));
    },
  };
}

/**
 * Times in a demo file, moved by `shift` ms: Unix seconds and milliseconds of these years, ISO
 * times, and the price date ("2026-11-04"). The files are written as of demo/meta.json's `now`.
 */
function shiftTimes(v: unknown, shift: number, key = ""): unknown {
  if (typeof v === "number") {
    if (v > 1.5e12 && v < 2.2e12) return v + shift;
    if (Number.isInteger(v) && v > 1.5e9 && v < 2.2e9) return v + Math.round(shift / 1000);
    return v;
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) return new Date(Date.parse(v) + shift).toISOString();
    if (key === "dump_date" && /^\d{4}-\d\d-\d\d$/.test(v)) return new Date(Date.parse(v) + Math.round(shift / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => shiftTimes(x, shift));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shiftTimes(x, shift, k)]));
  return v;
}

/**
 * `ORBITER_DEMO=1` (npm run dev:demo): the dev server answers /dev-*.json from demo/, an invented
 * account (scripts/demo-data.mjs), instead of public/, with its times moved up to now. A file
 * demo/ hasn't got is a 404, never public/'s copy.
 */
function demoData(): Plugin {
  const dir = join(process.cwd(), "demo");
  return {
    name: "orbiter-demo-data",
    apply: "serve",
    configureServer(server) {
      if (process.env.ORBITER_DEMO !== "1") return;
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { now: number };
      server.middlewares.use((req, res, next) => {
        const name = /^\/(dev-[A-Za-z0-9_.-]+\.json)$/.exec((req.url ?? "").split("?")[0])?.[1];
        if (!name) return next();
        // An item's price history (/dev-history-<slug>.json) is one entry of demo/dev-history.json.
        const slug = /^dev-history-(.+)\.json$/.exec(name)?.[1];
        const file = join(dir, slug ? "dev-history.json" : name);
        const data: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
        const body = slug ? (data as Record<string, unknown> | undefined)?.[slug] : data;
        if (body === undefined) {
          res.statusCode = 404;
          res.end();
          return;
        }
        // Whole minutes: a file reads the same for a minute, so the reward screen is new once a
        // minute rather than on every poll.
        const shift = Math.floor((Date.now() - meta.now) / 60_000) * 60_000;
        const st = statSync(file);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        // loadBundle (backend.ts) keeps the catalogs while the tag stays: the file's, not the shift's.
        res.setHeader("ETag", `"${st.size}-${Math.round(st.mtimeMs)}"`);
        res.end(JSON.stringify(shiftTimes(body, shift)));
      });
    },
  };
}

// Tauri expects a fixed port; 1421 so it never clashes with another Tauri app on the default 1420.
export default defineConfig({
  plugins: [svelte(), dropDevData(), demoData()],
  define: { __ORBITER_BUILD__: JSON.stringify(buildStamp()) },
  clearScreen: false,
  server: { port: 1421, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/tennoscope/**"] } },
});
