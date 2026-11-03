// Node module hooks for the tests: `.svelte.ts` / `.svelte.js` modules (the stores) are compiled
// with Svelte's compiler, TypeScript stripped first, so tests can import them as the app does.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { compileModule } from "svelte/compiler";

export async function load(url, context, next) {
  if (!/\.svelte\.(ts|js)$/.test(url.split("?")[0])) return next(url, context);
  const file = fileURLToPath(url);
  let code = await readFile(file, "utf8");
  if (file.endsWith(".ts")) code = (await transform(code, { loader: "ts", format: "esm", target: "es2022" })).code;
  const js = compileModule(code, { generate: "client", filename: file }).js.code;
  return { format: "module", source: js, shortCircuit: true };
}

// A store's `import { untrack } from "svelte"` gets Svelte's client build, as in the app (Node
// would otherwise pick the server build, whose untrack does nothing), to match the client
// internals the compiled store runs on.
export async function resolve(specifier, context, next) {
  if (specifier === "svelte" && /\.svelte\.(ts|js)$/.test((context.parentURL ?? "").split("?")[0])) return next(specifier, { ...context, conditions: ["browser", ...context.conditions] });
  return next(specifier, context);
}
