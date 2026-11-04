// What the spares panel is shown about the plan: per category and per family, how many listings
// and how much platinum, and the review list's lines with the rule that put each one in or out.
// The plan logic fills these (marketStore, from bulk.ts); the panel only draws them.
import type { ModFamily, ResourceFamily, SpareCategory } from "../../core/sparesRules";

/** A count and its platinum: what a category, or one family in it, would put up. */
export interface Tally {
  listings: number;
  plat: number;
}

export interface CategoryPreview extends Tally {
  /**
   * From the daily medians, before a plan has read the order books (shown with "~"); false once
   * the plan has priced it.
   */
  estimate: boolean;
  /** Spare things left out by the price minimum: said in the fold, so a short count isn't a mystery. */
  under?: number;
  /** By family (Mods and Resources): "ordinary" for mods outside every family, "veiled" for veiled rivens. */
  families?: Partial<Record<ModFamily | ResourceFamily | "ordinary" | "veiled", Tally>>;
  /** Something about the category the player should know before ticking it (no imprints read yet). */
  note?: string;
}
export type SparesPreview = Partial<Record<SpareCategory, CategoryPreview>>;

/** Facts the choices depend on, said beside them. */
export interface SparesFacts {
  /** Kuva and Tenet weapons, and Coda weapons, still to master. */
  lichLeft: { requiem: number; antivirus: number };
  /** The player's ducat rate (Prime parts, Your rates). */
  platPerDucat: number;
  minPrice: number;
  minRelicPrice: number;
  /** 1 solo, 4 radshares (Relics' choice): what a crack is worth depends on it. */
  squad: number;
}

/** One line of the plan's review list. */
export interface ReviewRow {
  /** The listing's key (item, rank, variant): what Skip this time remembers. */
  key: string;
  /** warframe.market's item id: what Never sell remembers. */
  id: string;
  name: string;
  image?: string | null;
  rank?: number | null;
  cat: SpareCategory;
  type: "create" | "update" | "remove" | "skip";
  quantity: number;
  /** The listing's quantity and price before, for a change. */
  was?: { quantity: number; platinum: number };
  platinum: number | null;
  /** The rule that decided it, in a few words: "Keep 2", "Under 10p", "Never sold". */
  rule: string;
  why: string;
  /** Taken out by the player: for this plan only, or for good. */
  out?: "skipped" | "never";
}
