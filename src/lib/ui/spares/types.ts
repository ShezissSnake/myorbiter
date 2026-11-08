// What Sell spares is shown about the plan: per category and per family, how many listings and how
// much platinum, and the review list's lines with the rule that put each one in or out. The page
// fills these from the plan logic (core/bulk.ts: sparesPreview before a plan, planTally after); the
// components only draw them.
import type { SpareFamily, Tally } from "../../core/bulk";
import type { MinByCategory, SpareCategory } from "../../core/sparesRules";

export type { Tally };

export interface CategoryPreview extends Tally {
  /**
   * From the daily medians, before a plan has read the order books (shown with "~"); false once
   * the plan has priced it.
   */
  estimate: boolean;
  /** Spare things left out by the price minimum: said in the fold, so a short count isn't a mystery. */
  under?: number;
  /** By family (Mods and Resources): "ordinary" for mods outside every family, "veiled" for veiled rivens. */
  families?: Partial<Record<SpareFamily, Tally>>;
  /** Something about the category the player should know before ticking it (no imprints read yet). */
  note?: string;
  /** Being worked out again after a change: the numbers shown are the last ones. */
  stale?: boolean;
}
export type SparesPreview = Partial<Record<SpareCategory, CategoryPreview>>;

/** Facts the choices depend on, said beside them. */
export interface SparesFacts {
  /** Kuva and Tenet weapons, and Coda weapons, still to master. */
  lichLeft: { requiem: number; antivirus: number };
  /** The player's ducat rate (Prime parts, Your rates). */
  platPerDucat: number;
  /** The global minimum price, and each category's own (core/sparesRules.ts, minimumFor). */
  minPrice: number;
  minByCategory: MinByCategory;
  /** 1 solo, 4 radshares (Relics' choice): what a crack is worth depends on it. */
  squad: number;
}

/** One line of the plan's review list. */
export interface ReviewRow {
  /** The line's key (core/bulk.ts, actionKey): what Skip this time remembers. */
  key: string;
  /** warframe.market's item id: what Never sell remembers ("" when the item isn't known). */
  id: string;
  name: string;
  image?: string | null;
  rank?: number | null;
  /** A relic's refinement, so two lines for one relic say which is which. */
  variant?: string | null;
  /** Its row on Sell spares; null for a listing outside them. */
  cat: SpareCategory | null;
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
  /** While the plan is applied: being sent, sent, or refused. */
  state?: "now" | "sent" | "refused";
}
