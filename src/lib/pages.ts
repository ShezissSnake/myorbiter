// Every page orbiter has, in sidebar order. The sidebar, the keyboard shortcuts (Ctrl+1…9 follow
// this order) and the Guide read this list; adding a page is one entry here plus its component in
// App.svelte.
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
  | "market"
  | "sales"
  | "stats"
  | "guide";

export interface Page {
  id: PageId;
  label: string;
  /** Section in the sidebar; Home and Guide stand alone. */
  group: "" | "Fissures" | "Collection" | "Trade";
  /** The game's own icon where there is a fitting one, else one of orbiter's line icons. */
  icon: { game: GameIconName } | { line: string };
  hint: string;
}

export const PAGES: Page[] = [
  { id: "home", label: "Home", group: "", icon: { line: "home" }, hint: "Today at a glance: your market, live fissures, what's ready to sell, Baro and Varzia, the easiest mastery next" },
  { id: "mission", label: "In mission", group: "Fissures", icon: { game: "void-tear" }, hint: "The fissure you're in: the squad's relics, and which reward to take" },
  { id: "relics", label: "Relics", group: "Fissures", icon: { game: "relic-axi-intact" }, hint: "Your relics: what's vaulted, what a crack is worth, live fissures" },
  { id: "planner", label: "Planner", group: "Fissures", icon: { game: "void-traces" }, hint: "Which relics to crack to complete sets, and which to make radiant" },
  { id: "foundry", label: "Foundry", group: "Collection", icon: { game: "foundry" }, hint: "Every warframe, weapon and companion with its parts: what you own, what you've mastered, what you can build" },
  { id: "wishlist", label: "Wishlist", group: "Collection", icon: { line: "star" }, hint: "The things you starred, and the quickest way to each missing part: a relic you hold, where to farm one, or what it costs" },
  { id: "inventory", label: "Inventory", group: "Collection", icon: { line: "inventory" }, hint: "Everything you own, with what it's worth" },
  { id: "mastery", label: "Mastery", group: "Collection", icon: { game: "mastery" }, hint: "Everything you haven't mastered, easiest first, and how to get it" },
  { id: "arcanes", label: "Arcanes", group: "Collection", icon: { game: "vosfor" }, hint: "Arcanes by price, how close you are to maxing each, and spares to sell or dissolve for Vosfor" },
  { id: "mods", label: "Mods", group: "Collection", icon: { game: "endo" }, hint: "Spare mod copies to sell, beyond your best one and one to give away" },
  { id: "rivens", label: "Rivens", group: "Collection", icon: { game: "riven" }, hint: "Your rivens graded, what similar ones sell for, and alerts for the ones you want" },
  { id: "sets", label: "Sets", group: "Trade", icon: { line: "sets" }, hint: "Complete prime sets you could sell, and sets almost done" },
  { id: "parts", label: "Prime parts", group: "Trade", icon: { game: "ducats" }, hint: "Every prime part: keep it, sell it, or trade it to Baro for ducats" },
  { id: "market", label: "Orders", group: "Trade", icon: { game: "market" }, hint: "Your warframe.market listings, kept at the cheapest in-game price" },
  { id: "sales", label: "Sales", group: "Trade", icon: { game: "platinum" }, hint: "What you've sold and the platinum it made" },
  { id: "stats", label: "Stats", group: "Trade", icon: { game: "credits" }, hint: "Your platinum, credits, Endo and more over time, and every trade you've made" },
  { id: "guide", label: "Guide", group: "", icon: { line: "guide" }, hint: "What each page is for and how to use it" },
];

export const pageById = Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<PageId, Page>;

/** Pages from before the redesign, as they were saved in settings. */
export function migrateTab(tab: string): PageId {
  if (tab === "ducats") return "parts";
  return (tab in pageById ? tab : "home") as PageId;
}
