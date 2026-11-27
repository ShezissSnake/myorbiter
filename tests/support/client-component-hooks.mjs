// Node module hooks for a test that mounts a component, as the page does, on the stand-in DOM of
// dom.ts: `.svelte` files are compiled with Svelte's compiler for the client, their templates built
// node by node (`fragments: "tree"`, no HTML to parse). A test can also hand in a component of its
// own as source text (`register(..., { data: { virtual: { [url]: source } } })`), compiled the same
// way. Stores (`.svelte.ts`) stay with runes-hooks.mjs; register that one too (import "./runes" first).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

/** @type {Record<string, string>} */
let virtual = {};
export function initialize(data) {
  virtual = data?.virtual ?? {};
}

export async function resolve(specifier, context, next) {
  const parent = (context.parentURL ?? "").split("?")[0];
  // A component's `import ... from "svelte"` gets Svelte's client build, as in the app.
  if (specifier === "svelte" && /\.svelte$/.test(parent)) return next(specifier, { ...context, conditions: ["browser", ...context.conditions] });
  if (specifier in virtual) return { url: specifier, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  const path = url.split("?")[0];
  if (!/\.svelte$/.test(path)) return next(url, context);
  const source = virtual[url] ?? (await readFile(fileURLToPath(url), "utf8"));
  const filename = url in virtual ? url.replace(/^\w+:/, "") : fileURLToPath(url);
  const js = compile(source, { generate: "client", fragments: "tree", filename }).js.code;
  return { format: "module", source: js, shortCircuit: true };
}
