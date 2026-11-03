import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readdirSync, rmSync } from "node:fs";
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

// Tauri expects a fixed port; 1421 so it never clashes with another Tauri app on the default 1420.
export default defineConfig({
  plugins: [svelte(), dropDevData()],
  define: { __ORBITER_BUILD__: JSON.stringify(buildStamp()) },
  clearScreen: false,
  server: { port: 1421, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/tennoscope/**"] } },
});
