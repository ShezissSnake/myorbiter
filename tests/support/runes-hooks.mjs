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
