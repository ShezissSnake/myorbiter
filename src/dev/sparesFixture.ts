// Made-up but realistic numbers for the spares panel's preview (spares-preview.html): the sizes of
// a long-played account's spares, not anyone's real inventory or trades.
import { defaultSparesRules, type SparesRules } from "../lib/core/sparesRules";
import type { ReviewRow, SparesFacts, SparesPreview } from "../lib/ui/spares/types";

export function fixtureRules(): SparesRules {
  const r = defaultSparesRules();
  r.relics.on = true;
  r.resources.on = true;
  r.neverSell = [
    { id: "khra", name: "Khra", cat: "mods" },
    { id: "lohk", name: "Lohk", cat: "mods" },
    { id: "primed-continuity", name: "Primed Continuity", cat: "mods" },
    { id: "condition-overload", name: "Condition Overload", cat: "mods" },
    { id: "axi-l4", name: "Axi L4 Relic", cat: "relics" },
  ];
  return r;
}

export const fixtureFacts: SparesFacts = { lichLeft: { requiem: 28, antivirus: 7 }, platPerDucat: 0.1, minPrice: 10, minRelicPrice: 3, squad: 1 };

/** What each category would list under these rules: before a plan, from the daily prices. */
export function fixturePreview(r: SparesRules, planned = false): SparesPreview {
  const estimate = !planned;
  const f = r.mods.families;
  const mods = {
    ordinary: { listings: 3, plat: 35 },
    primed: { listings: 0, plat: 0 },
    galvanized: { listings: 0, plat: 0 },
    augment: { listings: 1, plat: 10 },
    stance: { listings: 1, plat: 10 },
    requiem: { listings: 0, plat: 0 },
    antivirus: { listings: 0, plat: 0 },
  };
  const modOn = (Object.keys(mods) as (keyof typeof mods)[]).filter((k) => k === "ordinary" || f[k].on);
  const res = { gems: { listings: 0, plat: 0 }, fish: { listings: 3, plat: 57 }, ayatan: { listings: 0, plat: 0 }, stars: { listings: 0, plat: 0 }, captura: { listings: 0, plat: 0 }, lenses: { listings: 1, plat: 20 }, other: { listings: 0, plat: 0 }, veiled: { listings: 0, plat: 0 } };
  const resOn = (Object.keys(res) as (keyof typeof res)[]).filter((k) => k === "veiled" || r.resources.families[k]);
  const sum = <K extends string>(t: Record<K, { listings: number; plat: number }>, ks: K[]) => ks.reduce((a, k) => ({ listings: a.listings + t[k].listings, plat: a.plat + t[k].plat }), { listings: 0, plat: 0 });
  const primeBy = { sets: { listings: 1, plat: 25 }, setsFirst: { listings: 42, plat: 827 }, parts: { listings: 44, plat: 846 } }[r.prime.sellAs];
  return {
    prime: { ...primeBy, estimate, under: 149 },
    mods: { ...sum(mods, modOn), estimate, under: 268, families: mods },
    arcanes: { ...(r.arcanes.which === "maxed" ? { listings: 3, plat: 105 } : { listings: 5, plat: 220 }), estimate, under: 61 },
    relics: { listings: 14, plat: 790, estimate },
    gear: { ...(r.gear.sellAs === "sets" ? { listings: 0, plat: 0 } : { listings: 1, plat: 10 }), estimate, under: 17 },
    resources: { ...sum(res, resOn), estimate, under: 33, families: res },
    imprints: { listings: 3, plat: 45, estimate },
  };
}

/** The plan, looked over: what goes up and what's left out, with the rule for each. */
export const fixtureReview: ReviewRow[] = [
  { key: "c1", id: "frost-prime-bp", name: "Frost Prime Blueprint", cat: "prime", type: "create", quantity: 1, platinum: 35, rule: "Spare part", why: "1 held, Frost Prime mastered · cheapest in game" },
  { key: "c2", id: "banshee-prime-chassis", name: "Banshee Prime Chassis Blueprint", cat: "prime", type: "create", quantity: 1, platinum: 30, rule: "Spare part", why: "1 held, Banshee Prime mastered · cheapest in game" },
  { key: "c3", id: "caliban-prime-systems", name: "Caliban Prime Systems Blueprint", cat: "prime", type: "create", quantity: 2, platinum: 13, rule: "Spare part", why: "2 held, Caliban Prime mastered · ducats ~4.5p, it sells for 13p" },
  { key: "c4", id: "lith-z4", name: "Lith Z4 Relic", cat: "relics", type: "create", quantity: 22, platinum: 8, rule: "Beats a crack", why: "Sells for more than an intact crack is worth (about 4.1p)" },
  { key: "c5", id: "virtuos-forge", name: "Virtuos Forge", rank: 5, cat: "arcanes", type: "create", quantity: 1, platinum: 45, rule: "Keep 1 maxed", why: "2 maxed, one kept" },
  { key: "c6", id: "deep-freeze", name: "Deep Freeze", rank: 0, cat: "mods", type: "create", quantity: 1, platinum: 15, rule: "Keep 2", why: "3 copies: your best (R3) and one to give away kept" },
  { key: "c7", id: "xiran", name: "Xiran", cat: "resources", type: "create", quantity: 1, platinum: 17, rule: "Builds don't need it", why: "Nothing you still need to build takes it" },
  { key: "u1", id: "garuda-prime-neuro", name: "Garuda Prime Neuroptics Blueprint", cat: "prime", type: "update", quantity: 1, was: { quantity: 2, platinum: 25 }, platinum: 25, rule: "Held", why: "You hold 1 now" },
  { key: "r1", id: "yareli-prime-set", name: "Yareli Prime Set", cat: "prime", type: "remove", quantity: 0, was: { quantity: 1, platinum: 25 }, platinum: null, rule: "Ducats", why: "Worth more as ducats: 260 ducats are ~26p to you, it sells for 25p" },
  { key: "s1", id: "computer-cop", name: "Computer Cop", rank: 0, cat: "mods", type: "skip", quantity: 10, platinum: 5, rule: "Under 10p", why: "Sells for about 5p, under your 10p minimum" },
  { key: "s2", id: "tear-azurite", name: "Tear Azurite", cat: "resources", type: "skip", quantity: 70, platinum: 2, rule: "Builds need it", why: "180 held, 70 kept for Rahn Prism (20), Balla (10) and 4 more; the rest under 10p" },
  { key: "s3", id: "lith-c13", name: "Lith C13 Relic", cat: "relics", type: "skip", quantity: 3, platinum: 4, rule: "Worth cracking", why: "Goes for about 4p, no more than an intact crack is worth (about 4.6p)" },
  { key: "n1", id: "khra", name: "Khra", rank: 0, cat: "mods", type: "skip", quantity: 4, platinum: 9, rule: "Never sold", why: "On your never-sell list", out: "never" },
];
