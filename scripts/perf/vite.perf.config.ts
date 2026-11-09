// The app's own Vite config, built for measuring (scripts/perf/README.md): a production build,
// optionally counting Svelte's component updates, plus a report of what each chunk is made of.
//   PERF_OUT     where the build goes (required: keep it out of the repository)
//   PERF_COUNT=1 count component mounts, effect runs and derived recomputations per component
//   PERF_MINIFY=0 keep names readable for the profiler (slightly different timings)
//   PERF_DEMO_PORT the `npm run dev:demo` server whose /dev-*.json the preview server passes on
import { mergeConfig, type Plugin } from "vite";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import base from "../../vite.config.ts";

const out = process.env.PERF_OUT;
if (!out) throw new Error("PERF_OUT is required");

/**
 * Counters inside Svelte's runtime: every component instance is tagged with its file name at
 * `push`, and every effect run (`update_effect`) and derived recomputation (`update_derived`)
 * is counted under the component that created it. Read back as `globalThis.__perfCounts`.
 */
function countUpdates(): Plugin {
  const hook = `globalThis.__perfCounts ??= { mount: {}, effect: {}, derived: {} };`;
  const bump = (kind: string, ctx: string) =>
    `{ const c = globalThis.__perfCounts; if (c && c.on !== false) { const k = (${ctx})?.__n ?? "(module)"; c.${kind}[k] = (c.${kind}[k] ?? 0) + 1; } }`;
  return {
    name: "perf-count-updates",
    enforce: "post",
    transform(code, id) {
      const file = id.split("?")[0];
      if (file.endsWith("/svelte/src/internal/client/context.js")) {
        const at = "export function push(props, runes = false, fn) {\n\tcomponent_context = {";
        if (!code.includes(at)) throw new Error("perf: Svelte's push() changed");
        return code.replace(/(export function push\(props, runes = false, fn\) \{[\s\S]*?\n\t\};\n)/, `$1\t${hook} if (typeof fn === "string") { component_context.__n = fn; ${bump("mount", "component_context")} }\n`);
      }
      if (file.endsWith("/svelte/src/internal/client/runtime.js")) {
        const at = "export function update_effect(effect) {\n\tvar flags = effect.f;";
        if (!code.includes(at)) throw new Error("perf: Svelte's update_effect() changed");
        return code.replace(at, `${at}\n\t${bump("effect", "effect.ctx")}`);
      }
      if (file.endsWith("/svelte/src/internal/client/reactivity/deriveds.js")) {
        const at = "export function update_derived(derived) {";
        if (!code.includes(at)) throw new Error("perf: Svelte's update_derived() changed");
        return code.replace(at, `${at}\n\t${bump("derived", "derived.ctx")}`);
      }
      if (file.endsWith(".svelte") && !id.includes("?")) {
        // The compiled component calls $.push($$props, runes): pass its name as the third argument.
        const name = basename(file, ".svelte");
        return code.replace(/\$\.push\(\$\$props, (true|false)\)/g, `$.push($$$$props, $1, ${JSON.stringify(name)})`);
      }
      return null;
    },
  };
}

/** What each output chunk is made of, biggest module first: PERF_OUT/../chunks.json. */
function chunkReport(): Plugin {
  return {
    name: "perf-chunk-report",
    generateBundle(_opts, bundle) {
      const chunks = [];
      for (const c of Object.values(bundle)) {
        if (c.type !== "chunk") continue;
        const modules = Object.entries(c.modules)
          .map(([id, m]) => ({ id: id.replace(process.cwd() + "/", ""), bytes: m.renderedLength }))
          .sort((a, b) => b.bytes - a.bytes);
        chunks.push({ file: c.fileName, isEntry: c.isEntry, bytes: c.code.length, modules });
      }
      chunks.sort((a, b) => b.bytes - a.bytes);
      writeFileSync(join(out!, "..", "chunks.json"), JSON.stringify(chunks, null, 1));
    },
  };
}

const demoPort = process.env.PERF_DEMO_PORT ?? "1431";
export default mergeConfig(base, {
  plugins: [...(process.env.PERF_COUNT === "1" ? [countUpdates()] : []), chunkReport()],
  build: { outDir: out, emptyOutDir: true, sourcemap: true, ...(process.env.PERF_MINIFY === "0" ? { minify: false } : {}) },
  preview: { port: Number(process.env.PERF_PREVIEW_PORT ?? 1432), strictPort: true, proxy: { "^/dev-[A-Za-z0-9_.-]+\\.json": `http://localhost:${demoPort}` } },
});
