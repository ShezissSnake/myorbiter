// Every page orbiter has, in sidebar order. The sidebar, the keyboard shortcuts (Ctrl+1…9 follow
// this order) and the Guide read this list; adding a page is one entry here plus its component in
// App.svelte. Each section answers one question, so a new page has one place to go:
//   Fissures    What should I crack? The fissure you're in, your relics, what to crack next.
//   Progress    What's left to get? Mastery, the Foundry, your wishlist.
//   Collection  What do I hold, and what do I keep or sell? Everything you own, then by kind.
//   Trade       My activity on warframe.market: listings (and the spares plan), prices, sales, stats.
import type { GameIconName } from "./ui/GameIcon.svelte";

export type PageId =
  | "home"
  | "mission"
  | "relics"
  | "planner"
  | "foundry"
  | "wishlist"
  | "inventory"
  | "mastery"
  | "arcanes"
  | "mods"
  | "rivens"
  | "sets"
  | "parts"
  | "browse"
  | "market"
  | "sales"
  | "stats"
  | "guide";

export interface Page {
  id: PageId;
  label: string;
  /** Section in the sidebar; Home and Guide stand alone. */
  group: "" | "Fissures" | "Progress" | "Collection" | "Trade";
  /** The game's own icon where there is a fitting one, else one of orbiter's line icons. */
  icon: { game: GameIconName } | { line: string };
  hint: string;
  /** The hint on a console, where the page does less. */
  consoleHint?: string;
}

export const PAGES: Page[] = [
  { id: "home", label: "Home", group: "", icon: { line: "home" }, hint: "Today at a glance: your market, live fissures, what's ready to sell, Baro and Varzia, the easiest mastery next", consoleHint: "Today at a glance: your market, the world's clocks, live fissures, Baro and Varzia" },
  { id: "mission", label: "Current fissure", group: "Fissures", icon: { game: "void-tear" }, hint: "The fissure you're in: the squad's relics, and which reward to take" },
  { id: "relics", label: "Relics", group: "Fissures", icon: { game: "relic-axi-intact" }, hint: "Your relics: what's vaulted, what a crack is worth, live fissures" },
  { id: "planner", label: "Planner", group: "Fissures", icon: { game: "void-traces" }, hint: "Which relics to crack to complete sets, and which to make radiant" },
  { id: "mastery", label: "Mastery", group: "Progress", icon: { game: "mastery" }, hint: "Everything you haven't mastered, easiest first, and how to get it" },
  { id: "foundry", label: "Foundry", group: "Progress", icon: { game: "foundry" }, hint: "Every warframe, weapon and companion with its parts: what you own, what you've mastered, what you can build" },
  { id: "wishlist", label: "Wishlist", group: "Progress", icon: { line: "star" }, hint: "The things you starred, and the quickest way to each missing part: a relic you hold, where to farm one, or what it costs" },
  { id: "inventory", label: "Inventory", group: "Collection", icon: { line: "inventory" }, hint: "Everything you own, with what it's worth" },
  { id: "parts", label: "Prime parts", group: "Collection", icon: { game: "ducats" }, hint: "Every prime part: keep it, sell it, or trade it to Baro for ducats" },
  { id: "sets", label: "Sets", group: "Collection", icon: { line: "sets" }, hint: "Complete prime sets you could sell, and sets almost done" },
  { id: "mods", label: "Mods", group: "Collection", icon: { game: "endo" }, hint: "Spare mod copies to sell, beyond your best one and one to give away" },
  { id: "arcanes", label: "Arcanes", group: "Collection", icon: { game: "vosfor" }, hint: "Arcanes by price, how close you are to maxing each, and spares to sell or dissolve for Vosfor" },
  { id: "rivens", label: "Rivens", group: "Collection", icon: { game: "riven" }, hint: "Your rivens graded, what similar ones sell for, and alerts for the ones you want", consoleHint: "Find rivens for sale, each roll graded, and alerts for the ones you want" },
  { id: "market", label: "Orders", group: "Trade", icon: { game: "market" }, hint: "Your warframe.market listings, kept at the cheapest in-game price" },
  { id: "browse", label: "Browse market", group: "Trade", icon: { line: "list" }, hint: "Everything warframe.market trades, yours or not: browse by category, price and how often it sells" },
  { id: "sales", label: "Sales", group: "Trade", icon: { game: "platinum" }, hint: "What you've sold and the platinum it made" },
  { id: "stats", label: "Stats", group: "Trade", icon: { line: "chart" }, hint: "Your platinum, credits, Endo and more over time, and every trade you've made" },
  { id: "guide", label: "Guide", group: "", icon: { line: "guide" }, hint: "What each page is for and how to use it" },
];

export const pageById = Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<PageId, Page>;

/**
 * The pages for a console or phone player (Settings → Platform): only what works without reading
 * the game, which orbiter can only do on a PC: the riven finder under Collection, your listings
 * and sales under Trade; the world's clocks, fissures and Baro on Home.
 */
const CONSOLE: PageId[] = ["home", "market", "sales", "rivens", "guide"];

/** The pages the sidebar shows, in its order: every page on a PC, the short list on a console. */
export function pagesFor(console: boolean): Page[] {
  if (!console) return PAGES;
  return CONSOLE.map((id) => {
    const p = pageById[id];
    const q = p.consoleHint ? { ...p, hint: p.consoleHint } : p;
    return q;
  });
}

/** Pages from before the redesign, as they were saved in settings. */
export function migrateTab(tab: string): PageId {
  if (tab === "ducats") return "parts";
  return (tab in pageById ? tab : "home") as PageId;
}

/**
 * Pages in your order (Settings → Pages): the ones you moved, then the rest as they come. The
 * sidebar's sections follow, each where its first page is. Home stays first.
 */
export function orderPages(pages: Page[], order: string[]): Page[] {
  const at = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  const home = pages.filter((p) => p.id === "home");
  const rest = pages.filter((p) => p.id !== "home");
  // Stable: pages you haven't placed keep their places relative to each other.
  const placed = rest.map((p, i) => ({ p, i })).sort((a, b) => at(a.p.id) - at(b.p.id) || a.i - b.i);
  return [...home, ...placed.map((x) => x.p)];
}

/** The sidebar's sections in the order their pages come. */
export function sectionsOf(pages: Page[]): Exclude<Page["group"], "">[] {
  const out: Exclude<Page["group"], "">[] = [];
  for (const p of pages) if (p.group && !out.includes(p.group)) out.push(p.group);
  return out;
}

/** The pages as the sidebar draws them: Home, then each section's pages in turn (the Guide last). */
export function drawnOrder(pages: Page[]): Page[] {
  const head = pages.filter((p) => p.id === "home");
  const tail = pages.filter((p) => p.id === "guide");
  return [...head, ...sectionsOf(pages).flatMap((g) => pages.filter((p) => p.group === g)), ...tail];
}

/** Sections with their pages, in order: what Settings → Pages lists and moves. */
export function grouped(pages: Page[]): { group: Exclude<Page["group"], "">; pages: Page[] }[] {
  return sectionsOf(pages).map((group) => ({ group, pages: pages.filter((p) => p.group === group) }));
}

const flat = (gs: { pages: Page[] }[]) => gs.flatMap((g) => g.pages.map((p) => p.id as string));

/** Moves a page one place up or down within its section; returns the new order (page ids). */
export function movePage(gs: { group: string; pages: Page[] }[], id: string, step: -1 | 1): string[] {
  const next = gs.map((g) => ({ ...g, pages: [...g.pages] }));
  for (const g of next) {
    const i = g.pages.findIndex((p) => p.id === id);
    const j = i + step;
    if (i < 0) continue;
    if (j >= 0 && j < g.pages.length) [g.pages[i], g.pages[j]] = [g.pages[j], g.pages[i]];
    break;
  }
  return flat(next);
}

/** Moves a whole section one place up or down; returns the new order (page ids). */
export function moveSection(gs: { group: string; pages: Page[] }[], group: string, step: -1 | 1): string[] {
  const next = [...gs];
  const i = next.findIndex((g) => g.group === group);
  const j = i + step;
  if (i >= 0 && j >= 0 && j < next.length) [next[i], next[j]] = [next[j], next[i]];
  return flat(next);
}
