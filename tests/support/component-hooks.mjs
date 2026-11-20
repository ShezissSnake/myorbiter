// Node module hooks for a test that renders a component on the server (`svelte/server`'s render):
// `.svelte` files are compiled with Svelte's compiler for the server, so the markup a test reads
// is the component's own, in the state the test gives it. Stores (`.svelte.ts`) stay with
// runes-hooks.mjs; register that one too (import "./runes" first).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

export async function load(url, context, next) {
  if (!/\.svelte$/.test(url.split("?")[0])) return next(url, context);
  const file = fileURLToPath(url);
  const source = await readFile(file, "utf8");
  const js = compile(source, { generate: "server", filename: file }).js.code;
  return { format: "module", source: js, shortCircuit: true };
}
