// Walk-throughs not written yet: one page that says so and links to the Guide. Each lists the parts
// whose "?" opens it; the coverage check (npm run sweep) names them as pending.

import type { Walkthrough } from "./types";
import type { PageId } from "../pages";

const pending = (id: string, app: PageId | "shared", title: string, guide: string, parts: string[]): Walkthrough => ({
  id,
  app,
  title,
  guide,
  pending: true,
  pages: [{ title: "Not written yet", lines: ["A short walk-through of this part is on its way.", "Until then, the Guide describes it."] }],
  covers: Object.fromEntries(parts.map((p) => [p, 1])),
});

/** The Guide's entry for an app page (Guide.svelte marks each with data-card="guide-<page>"). */
export const guideOf = (page: PageId) => `guide?open=${page}#guide-${page}`;

/** The settings panel's walk-through goes to the Guide's own Settings entry. */
const SETTINGS_GUIDE = "guide";

export const PENDING: Walkthrough[] = [
  pending("home", "home", "Home", guideOf("home"), ["home.start", "home.customise", "home.needs-you", "home.world", "home.market", "home.ready", "home.fissures", "home.bounties", "home.events", "home.today", "home.foundry", "home.wishes", "home.deals", "home.mastery", "home.baro", "home.varzia"]),
  pending("mastery", "mastery", "Mastery", guideOf("mastery"), ["mastery.band", "mastery.codex", "mastery.filters", "mastery.plat-order", "mastery.list", "mastery.sheet"]),
  pending("foundry", "foundry", "Foundry", guideOf("foundry"), ["foundry.band", "foundry.codex", "foundry.queue", "foundry.filters", "foundry.list"]),
  pending("builds", "builds", "Builds", guideOf("builds"), ["builds.paste", "builds.editor", "builds.arsenal", "builds.tier-bar", "builds.tags", "builds.saved-links", "builds.most-built", "builds.also-built", "builds.recent", "builds.browse-kinds"]),
  pending("wishlist", "wishlist", "Wishlist", guideOf("wishlist"), ["wishlist.band", "wishlist.codex", "wishlist.add", "wishlist.crack-now"]),
  pending("inventory", "inventory", "Inventory", guideOf("inventory"), ["inventory.band", "inventory.showcase", "inventory.filters", "inventory.list", "inventory.sheet"]),
  pending("parts", "parts", "Prime parts", guideOf("parts"), ["parts.band", "parts.showcase", "parts.filters", "parts.ducats-for-less", "parts.list", "parts.sheet"]),
  pending("sets", "sets", "Sets", guideOf("sets"), ["sets.band", "sets.showcase", "sets.filters", "sets.list", "sets.sheet"]),
  pending("mods", "mods", "Mods", guideOf("mods"), ["mods.band", "mods.showcase", "mods.filters", "mods.list", "mods.sheet"]),
  pending("arcanes", "arcanes", "Arcanes", guideOf("arcanes"), ["arcanes.band", "arcanes.showcase", "arcanes.packs", "arcanes.filters", "arcanes.list", "arcanes.sheet", "arcane-spares.list", "arcane-spares.sheet"]),
  pending("rivens", "rivens", "Rivens", guideOf("rivens"), ["rivens.band", "rivens.showcase", "rivens.cycling", "rivens.filters", "rivens.finder", "rivens.list", "rivens.sheet"]),
  pending("stats", "stats", "Stats", guideOf("stats"), ["stats.band", "stats.ticker", "stats.span", "stats.relic-runs", "stats.parts-you-got", "stats.profit-by-type", "stats.trade-history"]),
  pending("settings", "shared", "Settings", SETTINGS_GUIDE, ["settings", "settings.platform", "settings.pages", "settings.tennoscope", "settings.where-things-are", "settings.fissures", "settings.overlays", "settings.trades", "settings.selling", "settings.builds", "settings.notifications", "settings.updates", "settings.logs", "settings.report-bug"]),
  pending("notices", "shared", "Notifications", SETTINGS_GUIDE, ["notices", "notices.how", "notices.kinds"]),
  pending("tennoscope", "shared", "TennoScope", SETTINGS_GUIDE, ["tennoscope", "tennoscope.unpatched", "tennoscope.screen-capture", "tennoscope.reward-overlay", "tennoscope.inventory", "tennoscope.health"]),
  pending("watching", "shared", "Watching", SETTINGS_GUIDE, ["watching.alerts", "watching.fissures", "watching.clocks", "watching.foundry", "watching.bounties", "watching.market"]),
  pending("item-sheet", "shared", "An item's details", SETTINGS_GUIDE, ["item-sheet", "item-sheet.how", "item-sheet.built-from", "item-sheet.plan", "item-sheet.base-stats", "item-sheet.stats", "item-sheet.prices"]),
  pending("rail", "shared", "The sidebar", SETTINGS_GUIDE, ["rail.foot"]),
  pending("first-run", "shared", "Getting started", SETTINGS_GUIDE, ["first-run"]),
  pending("whats-new", "shared", "What's new", SETTINGS_GUIDE, ["whats-new"]),
];
