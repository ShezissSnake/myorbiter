#!/usr/bin/env node
// Writes the catalogue files the browser dev mode reads, and that tests/sparesPlan.test.ts and
// tests/buildsRiven.test.ts need:
//
//   public/dev-market-items.json   warframe.market's item list         (market.rs `items`)
//   public/dev-rivens.json         its riven weapons and attributes     (market.rs `riven_meta`)
//   public/dev-recipe-data.json    Foundry recipes and resource names   (recipes.rs `recipe_data`)
//
// Same sources, same trimming and same shape as the Rust side, so the app and the browser read
// one thing. Reads only (GET), from the two hosts the app already uses: api.warframe.market, paced
// like market.rs (400 ms apart, 1.5 s for 90 s after a "too many requests", at most two retries),
// and raw.githubusercontent.com (warframe-public-export-plus). Nothing is signed in or written
// anywhere but public/, which .gitignore keeps out of the repository.
//
//   npm run dev-data
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const V2 = "https://api.warframe.market/v2";
const EXPORT = "https://raw.githubusercontent.com/calamity-inc/warframe-public-export-plus/senpai";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
// As user_agent() in src-tauri/src/lib.rs: the requests name MyOrbiter honestly.
const USER_AGENT = `MyOrbiter/${version} (+https://gitlab.com/sheziss-group/myorbiter)`;

const MIN_GAP = 400;
const SLOW_GAP = 1500;
const SLOW_FOR = 90_000;
let lastCall = 0;
let slowUntil = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitTurn() {
  const gap = Date.now() < slowUntil ? SLOW_GAP : MIN_GAP;
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

/** A warframe.market read, as market.rs get_json: paced, and a "too many requests" retried twice. */
async function market(path) {
  for (let tries = 1; ; tries++) {
    await waitTurn();
    const res = await fetch(`${V2}${path}`, { headers: { "User-Agent": USER_AGENT, Language: "en" }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 429 && tries <= 2) {
      slowUntil = Date.now() + SLOW_FOR;
      const hint = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
      await sleep(Number.isFinite(hint) ? Math.min(hint, 10) * 1000 : 3000 * tries);
      continue;
    }
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return res.json();
  }
}

async function github(file) {
  const res = await fetch(`${EXPORT}/${file}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`GET ${file}: ${res.status}`);
  return res.json();
}

/** market.rs thumb_name: the image cache's name ("wfm." and the file), only plain names, else null. */
function thumbName(v) {
  const f = typeof v === "string" && v.startsWith("items/images/en/thumbs/") ? v.slice("items/images/en/thumbs/".length) : "";
  return f && /^[A-Za-z0-9\-_.()]+$/.test(f) ? `wfm.${f}` : null;
}

const items = (list) =>
  list.map((i) => ({
    id: i.id, slug: i.slug, gameRef: i.gameRef, name: i.i18n?.en?.name, maxRank: i.maxRank,
    subtypes: i.subtypes, tags: i.tags, thumb: thumbName(i.i18n?.en?.thumb),
  }));

const rivenWeapons = (list) =>
  list.map((x) => ({ slug: x.slug, gameRef: x.gameRef, name: x.i18n?.en?.name, group: x.group, rivenType: x.rivenType }));

const rivenAttributes = (list) =>
  list.map((x) => ({
    slug: x.slug, gameRef: x.gameRef, name: x.i18n?.en?.name, unit: x.unit,
    positiveOnly: x.positiveOnly, negativeOnly: x.negativeOnly, exclusiveTo: x.exclusiveTo,
  }));

/** recipes.rs kind: star-chart resources are "chart", everything else "world". */
const kind = (p) => (p.startsWith("/Lotus/Types/Items/MiscItems/") || p.startsWith("/Lotus/Types/Items/Research/") ? "chart" : "world");

/** recipes.rs compact: { checkedAt, recipes: { result: { c, i: [[path, count]] } }, names: { path: { n, img, r, k } } }. */
function compact(recipes, resources, dict) {
  const out = {};
  const used = new Set();
  for (const r of Object.values(recipes)) {
    if (typeof r.resultType !== "string") continue;
    const ingredients = [];
    for (const i of r.ingredients ?? []) {
      if (typeof i.ItemType !== "string") continue;
      used.add(i.ItemType);
      ingredients.push([i.ItemType, Number.isInteger(i.ItemCount) && i.ItemCount >= 0 ? i.ItemCount : 1]);
    }
    if (!ingredients.length) continue;
    // Several blueprints can make the same thing: the first is kept.
    out[r.resultType] ??= { c: Number.isInteger(r.buildPrice) && r.buildPrice >= 0 ? r.buildPrice : 0, i: ingredients };
  }
  const names = {};
  for (const path of [...used].sort()) {
    const res = resources[path];
    const name = res && typeof res.name === "string" ? dict[res.name] : undefined;
    if (typeof name !== "string") continue;
    const img = typeof res.icon === "string" ? res.icon.split("/").pop() : "";
    names[path] = { n: name, img, r: typeof res.rarity === "string" ? res.rarity : "", k: kind(path) };
  }
  return { checkedAt: Math.floor(Date.now() / 1000), recipes: out, names };
}

function write(file, value) {
  const path = new URL(`../public/${file}`, import.meta.url);
  const tmp = new URL(`../public/.${file}.tmp`, import.meta.url);
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

const data = (v, what) => {
  if (!Array.isArray(v?.data) || !v.data.length) throw new Error(`${what}: warframe.market answered, but not with a list`);
  return v.data;
};

console.log("warframe.market items…");
write("dev-market-items.json", items(data(await market("/items"), "items")));
console.log("warframe.market riven weapons and attributes…");
const weapons = rivenWeapons(data(await market("/riven/weapons"), "riven weapons"));
const attributes = rivenAttributes(data(await market("/riven/attributes"), "riven attributes"));
write("dev-rivens.json", { weapons, attributes });
console.log("Foundry recipes (warframe-public-export-plus)…");
const recipeData = compact(await github("ExportRecipes.json"), await github("ExportResources.json"), await github("dict.en.json"));
if (Object.keys(recipeData.recipes).length <= 100) throw new Error("the recipes came back nearly empty");
write("dev-recipe-data.json", recipeData);
console.log("wrote public/dev-market-items.json, public/dev-rivens.json, public/dev-recipe-data.json");
