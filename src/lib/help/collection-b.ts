// The Collection section's walk-throughs for Arcanes and Rivens. Every sentence about prices,
// Vosfor and the sell-or-dissolve call is checked against the code that works it out
// (core/vosfor.ts, core/worthSelling.ts, core/views.ts arcaneRows, core/rivens.ts), not the Guide
// alone. The pictures' steps never press anything that writes: the arcane tabs only change the
// view, and the riven finder is only typed into (no Search, no Alert me).

import type { Walkthrough } from "./types";
import { guideOf } from "./guide";

/** The element whose own "?" is `part`'s: a part's head bar or box. */
const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;
const SPARES_TAB = { click: ".pane.shown .modes button[role=tab]:has-text('Sell or dissolve')" };
/** The first cards of the list on show. */
const CARDS = ".pane.shown .cards.swap:not(.off) .grid > article.card";

const ARCANES: Walkthrough = {
  id: "arcanes",
  app: "arcanes",
  title: "Arcanes",
  guide: guideOf("arcanes"),
  pages: [
    {
      title: "Your arcanes at a glance",
      lines: [
        "Up to five arcanes worth most to sell; with none, the dearest you hold.",
        "Maxed: at max rank, or enough copies to fuse one, of every arcane.",
        "Worth selling: copies marked Sell, no more of each than sells in a month.",
        "Vosfor held, and what dissolving those marked Dissolve would add.",
      ],
      shot: {
        open: "arcanes",
        part: ".pane.shown .hero.helped, .pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown .hero.helped section.showcase", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(1)", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(2)", is: "n", n: 3, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(3)", is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Still collecting, or sell or dissolve",
      lines: [
        "Still collecting: not yet maxed. Sell or dissolve: spare copies. All arcanes: every one.",
        "Type to filter by name.",
        "Pick a slot: what the arcane goes on.",
        "More filters: Started or None yet, and the collection at Loid whose packs hold it.",
      ],
      shot: {
        open: "arcanes",
        part: `.pane.shown .modes, ${holder("arcanes.filters")}`,
        marks: [
          { at: ".pane.shown .modes [role=tablist]", is: "n", n: 1, from: "corner" },
          { at: `${holder("arcanes.filters")} > input`, is: "n", n: 2, from: "corner" },
          { at: `${holder("arcanes.filters")} > select`, is: "n", n: 3, from: "corner" },
          { at: `${holder("arcanes.filters")} button.fold`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Each arcane, copy by copy",
      lines: [
        "Copies: unranked copies you hold, fused ones counted at their cost, of what maxing takes.",
        "R0 and max-rank prices; To finish: buying the missing copies or one maxed, whichever's cheaper.",
        "Sort them, or switch to Table for any column.",
        "Click a card for its details: copies by rank, prices, drops and price history.",
      ],
      shot: {
        open: "arcanes",
        part: `${holder("arcanes.filters")}, ${CARDS}:nth-child(-n+3)`,
        marks: [
          { at: `${CARDS}:first-child .coll`, is: "n", n: 1, from: "left" },
          { at: `${CARDS}:first-child .prices`, is: "n", n: 2, from: "left" },
          { at: `${holder("arcanes.filters")} label.sort`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Sell or dissolve each spare",
      lines: [
        "Sell: what they fetch, maxed copies at the max-rank price.",
        "Dissolve: their Vosfor, and its worth through the best pack.",
        "Dissolve if its Vosfor's worth more, it sells too slowly, or a trade's too small.",
        "A loose copy counts as its share of a maxed one, or its price if lower.",
      ],
      shot: {
        open: "arcanes",
        steps: [SPARES_TAB],
        part: `${holder("arcanes.filters")}, ${CARDS}:nth-child(-n+3)`,
        marks: [
          { at: `${CARDS}:first-child .choice > span:nth-child(1)`, is: "n", n: 1, from: "left" },
          { at: `${CARDS}:first-child .choice > span:nth-child(2)`, is: "n", n: 2, from: "right" },
          { at: `${CARDS}:first-child span.verdict`, is: "n", n: 3, from: "bottom" },
        ],
      },
    },
    {
      title: "Loid's packs, and Vosfor's worth",
      lines: [
        "Loid's packs: three arcanes from one collection, 200 Vosfor each.",
        "Value Vosfor by Arcanes I'm collecting, or by Market price (ones trading 5+ a day).",
        "The best pack is outlined: its worth per Vosfor prices every Dissolve.",
        "Your Vosfor, with what's marked Dissolve, and how many packs that buys.",
      ],
      shot: {
        open: "arcanes",
        steps: [SPARES_TAB],
        part: ".pane.shown section.vosfor",
        marks: [
          { at: ".pane.shown section.vosfor header > .register", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.vosfor header .seg-wrap", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.vosfor .pack.best", is: "n", n: 3, from: "corner" },
          { at: ".pane.shown section.vosfor > p:first-of-type", is: "n", n: 4, from: "corner" },
        ],
      },
    },
  ],
  good: { text: "Loid shows the exact Vosfor before you confirm: MyOrbiter counts a ranked copy as the copies it's made of." },
  covers: {
    "arcanes.showcase": 1,
    "arcanes.band": 1,
    "arcanes.filters": 2,
    "arcanes.list": 3,
    "arcanes.sheet": 3,
    "arcane-spares.list": 4,
    "arcane-spares.sheet": 4,
    "arcanes.packs": 5,
  },
};

// Still collecting's "Which packs to open": the same pack figures as Sell or dissolve's (core/vosfor.ts,
// packValues), ranked by how many of the arcanes still to collect each pack can give.
const OPEN = ".pane.shown section.toopen";
const ARCANES_OPEN: Walkthrough = {
  id: "arcanes-open",
  app: "arcanes",
  title: "Arcanes: which packs to open",
  guide: guideOf("arcanes"),
  pages: [
    {
      title: "Which packs to open",
      lines: [
        "First: the pack that can give the most arcanes you're still collecting.",
        "Each pack: how many you still need from it, and those arcanes.",
        "About n of each pack's 3: on average, how many of its arcanes you need.",
        "Packs with nothing you need are named at the foot. Each costs 200 Vosfor.",
      ],
      shot: {
        open: "arcanes",
        part: `${OPEN} > header, ${OPEN} .lead, ${OPEN} .openlist > li:nth-child(-n+2)`,
        marks: [
          { at: `${OPEN} .lead`, is: "n", n: 1, from: "corner" },
          { at: `${OPEN} .openlist > li:first-child .oh .dim`, is: "n", n: 2, from: "right" },
          { at: `${OPEN} .openlist > li:first-child .wanted > span:last-child`, is: "n", n: 3, from: "right" },
        ],
      },
    },
  ],
  good: { text: "Sell or dissolve values the same packs in platinum, for weighing a dissolution." },
  covers: { "arcanes.open": 1 },
};

const RIVENS: Walkthrough = {
  id: "rivens",
  app: "rivens",
  title: "Rivens",
  guide: guideOf("rivens"),
  pages: [
    {
      title: "Your rivens at a glance",
      lines: [
        "Unveiled: the rivens read from your inventory.",
        "Veiled: rivens with their challenge still to do.",
        "Best roll: your riven whose stats rolled highest in their ranges, on average.",
        "Your rivens' going rate adds up last week's in-game median for each one's weapon.",
      ],
      shot: {
        open: "rivens",
        part: ".pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown section.band.helped > .cell:nth-child(1)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(2)", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(3)", is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Your rivens, graded",
      lines: [
        "Each roll graded within its range: S the top, B the middle, F the bottom.",
        "Check prices: the cheapest for the weapon, similar ones' asks, and MyOrbiter's Estimate.",
        "One up on warframe.market shows its buyout; Sell on another starts at the Estimate.",
        "While you cycle one, both rolls show side by side, with which to keep.",
      ],
      shot: {
        // The invented account's two best rolls: the Soma riven it has up for sale, and the Hek one.
        open: "rivens",
        part: ".pane.shown .cards article.riven:nth-child(-n+2)",
        marks: [
          { at: ".pane.shown .cards article.riven:nth-child(1) .grade.big", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .cards article.riven:nth-child(2) footer button[aria-label='Check prices']", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown .cards article.riven:nth-child(1) .selling.on", is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Find a riven",
      lines: [
        "Pick a weapon from the list.",
        "Up to three stats you want, and the curse, if you care which.",
        "Search: rivens for sale, at your Max price or less if set, each with its Estimate.",
        "Alert me: a notification when one is listed at or under your price.",
      ],
      shot: {
        open: "rivens",
        steps: [
          { fill: ".pane.shown section.finder input[aria-label='Weapon']", text: "Soma" },
          { fill: ".pane.shown section.finder .form .plat input", text: "150" },
        ],
        part: ".pane.shown section.finder",
        marks: [
          { at: ".pane.shown section.finder input[aria-label='Weapon']", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.finder select[aria-label='Wanted stat 1']", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.finder .go button.pb", is: "n", n: 3, from: "bottom" },
          { at: ".pane.shown section.finder .go > button.stamp:not(.pb)", is: "n", n: 4, from: "bottom" },
        ],
      },
    },
  ],
  good: { text: "Alert me sends nothing to warframe.market: every 5 minutes MyOrbiter searches for each alert and notifies you." },
  covers: {
    "rivens.band": 1,
    "rivens.showcase": 2,
    "rivens.cycling": 2,
    "rivens.filters": 2,
    "rivens.list": 2,
    "rivens.sheet": 2,
    "rivens.finder": 3,
  },
};

export const COLLECTION_B: Walkthrough[] = [ARCANES, ARCANES_OPEN, RIVENS];
