// The Stats page's walk-through. Every sentence about platinum is checked against the code that
// works it out (tabs/Stats.svelte's byType and kindOf, ui/RelicRuns.svelte with core/relicRuns.ts
// and core/views.ts rewardPlat), not the Guide alone. The pictures' steps press nothing: no +rep,
// no export.

import type { Walkthrough } from "./types";
import { guideOf } from "./guide";

/** The element whose own "?" is `part`'s: a part's head bar or box. */
const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;

const STATS_WT: Walkthrough = {
  id: "stats",
  app: "stats",
  title: "Stats",
  guide: guideOf("stats"),
  pages: [
    {
      title: "Your account at a glance",
      lines: [
        "Inventory value and Quick-sale value at the last read, and the change from the read before.",
        "Revenue: sales in the trade log, plus ones on Sales no trade covers; Spent: purchases.",
        "30 days, 90 days or All: the span of everything but the tape.",
        "Below: charts of platinum, credits, Endo and more, from inventory reads.",
      ],
      shot: {
        open: "stats",
        part: `.pane.shown .hero.helped, .pane.shown section.band.helped, ${holder("stats.span")}`,
        marks: [
          { at: ".pane.shown .hero.helped .tape", is: "n", n: 1, from: "right" },
          { at: ".pane.shown section.band.helped", is: "n", n: 2, from: "right" },
          { at: `${holder("stats.span")} .seg`, is: "n", n: 3, from: "right" },
        ],
      },
    },
    {
      title: "What your relic runs come to",
      lines: [
        "Per hour: cards you took, else your relic's reward or the average card, over session time.",
        "Best card every time: had you taken each screen's most valuable card.",
        "One row per session; click one for its screens, card by card.",
        "Each card counts at its price, or its ducats at your rate if more.",
      ],
      shot: {
        open: "stats",
        part: ".pane.shown section.runs .hh, .pane.shown section.runs .figs, .pane.shown section.runs table thead, .pane.shown section.runs table tbody tr.session:nth-child(-n+2)",
        marks: [
          { at: ".pane.shown section.runs .figs > .cell:nth-child(1)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.runs .figs > .cell:nth-child(4)", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.runs table tbody tr.session:first-child", is: "n", n: 3, from: "left" },
        ],
      },
    },
    {
      title: "Parts you got",
      lines: [
        "Prime parts and other gear parts that turned up between two inventory reads.",
        "From relics, missions or anything else; what a trade brought in is left out.",
        "Each with how many, and their worth at today's prices.",
      ],
      shot: {
        open: "stats",
        part: ".pane.shown section.got",
        marks: [],
      },
    },
    {
      title: "Profit by type",
      lines: [
        "Revenue: each type's sales, from the trade log and from Sales no trade covers.",
        "Spent: what you paid in platinum for items, from the trade log.",
        "Profit: revenue minus spent.",
        "A trade's platinum is shared out by copies; Swaps count in neither.",
      ],
      shot: {
        open: "stats",
        part: ".pane.shown section.types",
        marks: [
          { at: ".pane.shown section.types thead th:nth-child(2)", is: "n", n: 1, from: "top" },
          { at: ".pane.shown section.types thead th:nth-child(3)", is: "n", n: 2, from: "top" },
          { at: ".pane.shown section.types thead th:nth-child(4)", is: "n", n: 3, from: "top" },
        ],
      },
    },
    {
      title: "Every trade you've made",
      lines: [
        "All, Sales, Purchases or Swaps: items for platinum, platinum for items, or anything else.",
        "Each trade read from Warframe's log when the trade window closes: who, when, what for what.",
        "The sheet icon saves every trade as a CSV in your Downloads folder.",
        "+rep gives the player a review on warframe.market, with your message.",
      ],
      shot: {
        open: "stats",
        part: ".pane.shown section.history .hh, .pane.shown section.history > ul > li:nth-child(-n+3)",
        marks: [
          { at: ".pane.shown section.history .hh .seg", is: "n", n: 1, from: "top" },
          { at: ".pane.shown section.history > ul > li:first-child .who", is: "n", n: 2, from: "left" },
          { at: ".pane.shown section.history .hh button.pb", is: "n", n: 3, from: "top" },
        ],
      },
    },
  ],
  covers: {
    "stats.ticker": 1,
    "stats.band": 1,
    "stats.span": 1,
    "stats.relic-runs": 2,
    "stats.parts-you-got": 3,
    "stats.profit-by-type": 4,
    "stats.trade-history": 5,
  },
};

export const STATS: Walkthrough[] = [STATS_WT];
