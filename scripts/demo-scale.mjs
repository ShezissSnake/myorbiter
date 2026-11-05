// A scaled-up copy of the demo account (demo/), for timing and correctness at size: every catalog
// item held (mods at every rank), quantities 5 to 15 times the demo's, and listings up to
// warframe.market's cap of 100, each with an order book. Invented like the demo, deterministic.
//
//   node scripts/demo-scale.mjs <out folder>
//   ORBITER_DEMO=1 ORBITER_DEMO_DIR=<out folder> npx vite     (the app on it, in a browser)
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The scaled account, as the demo's files are: `{ name: content }`. */
export function scaleDemo(read, listings = 100) {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const bundle = read("dev-bundle.json");
  const have = new Set(bundle.inventory.map((r) => r.item_id));
  const kinds = { Mods: "mod", Arcanes: "arcane", Relics: "relic", Warframes: "warframe", Primary: "weapon", Secondary: "weapon", Melee: "weapon", Resources: "resource", Pets: "companion", Sentinels: "companion" };
  const inventory = bundle.inventory.map((r) => (r.quantity > 0 ? { ...r, quantity: r.quantity * int(5, 15) } : { ...r }));
  for (const c of bundle.catalog) {
    if (have.has(c.uniqueName)) continue;
    const kind = kinds[c.category] ?? "misc";
    const ranks = kind === "mod" && c.maxRank ? Array.from({ length: c.maxRank + 1 }, (_, i) => i) : [null];
    for (const rank of ranks) inventory.push({ item_id: rank ? `${c.uniqueName}#${rank}` : c.uniqueName, name: c.name, category: kind, quantity: int(1, 40), mastered: !!c.masterable && rand() < 0.5, image_name: c.imageName ?? null, rank: rank || null, max_rank: rank ? c.maxRank : null });
  }
  for (const c of bundle.catalog) {
    for (const comp of c.components ?? []) {
      if (!comp.ducats || have.has(comp.uniqueName)) continue;
      have.add(comp.uniqueName);
      inventory.push({ item_id: comp.uniqueName, name: `${c.name} ${comp.name}`, category: "prime_part", quantity: int(1, 25), mastered: false, image_name: null, rank: null, max_rank: null });
    }
  }
  const items = read("dev-market-items.json");
  const market = read("dev-market.json");
  const books = read("dev-books.json");
  const orders = [...market.orders];
  const used = new Set(orders.map((o) => o.itemId));
  for (const it of items) {
    if (orders.length >= listings) break;
    if (used.has(it.id)) continue;
    const platinum = int(5, 200);
    const rank = it.maxRank != null ? 0 : null;
    const subtype = it.subtypes?.[0] ?? null;
    orders.push({ id: `o${String(orders.length).padStart(23, "0")}`, itemId: it.id, type: "sell", platinum, quantity: int(1, 5), rank, subtype, visible: true, updatedAt: "2026-11-04T10:00:00Z" });
    books[it.slug] ??= [{ id: `b${it.slug}`.slice(0, 24), type: "sell", platinum: Math.max(1, platinum - int(-5, 10)), quantity: 1, rank, subtype, visible: true, user: { id: "u1", ingameName: "Tenno_Alpha", status: "ingame", platform: "pc", crossplay: true } }];
  }
  return { "dev-bundle.json": { ...bundle, inventory }, "dev-market.json": { ...market, orders }, "dev-books.json": books };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: node scripts/demo-scale.mjs <out folder>");
  const demo = join(import.meta.dirname, "..", "demo");
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(demo)) if (f.endsWith(".json")) copyFileSync(join(demo, f), join(out, f));
  const files = scaleDemo((f) => JSON.parse(readFileSync(join(demo, f), "utf8")));
  for (const [f, v] of Object.entries(files)) writeFileSync(join(out, f), JSON.stringify(v));
  console.log(`scaled demo in ${out}: ${files["dev-bundle.json"].inventory.length} inventory rows, ${files["dev-market.json"].orders.length} listings`);
}
