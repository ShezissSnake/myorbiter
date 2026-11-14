// The Collection section's walk-throughs: Inventory, Prime parts, Sets and Mods. Every sentence
// about prices, spares, ducats and what a button opens is checked against the code that works it
// out (core/spares.ts, core/worthSelling.ts, core/advice.ts, core/views.ts and the pages
// themselves), not the Guide alone. The pictures' steps only open a card's details or switch the
// Sets view; a list button opens the sell form and is never pressed here.

import type { Walkthrough } from "./types";
import { guideOf } from "./guide";

/** The element whose own "?" is `part`'s: a part's head bar or box. */
const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;
/** The list's cards (Browse, cards layout: a fresh window has no layout remembered). */
const CARDS = ".pane.shown .cards.swap .grid > article.card";
const FIRST = `${CARDS}:first-child`;
/** The band of figures under a page's head, and its cells (the first ones always show). */
const BAND = ".pane.shown section.band.helped";
const cell = (n: number) => `${BAND} > .cell:nth-child(${n})`;
const LEAD = ".pane.shown .hero.helped li.piece.lead";

const INVENTORY: Walkthrough = {
  id: "inventory",
  app: "inventory",
  title: "Inventory",
  guide: guideOf("inventory"),
  pages: [
    {
      title: "What your inventory is worth",
      lines: [
        "Spare value: copies beyond what you keep, at the daily median, capped at a month's sales.",
        "Spare copies: every copy beyond what you keep, of how many items.",
        "Sell daily: items you have spares of that trade at least once a day.",
        "The filters below narrow all three: they add up the rows shown.",
      ],
      shot: {
        open: "inventory",
        part: BAND,
        marks: [
          { at: cell(1), is: "n", n: 1, from: "corner" },
          { at: cell(2), is: "n", n: 2, from: "corner" },
          { at: cell(3), is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Your most valuable spares",
      lines: [
        "Up to five items, by their share of Spare value; pick a kind to change them.",
        "Nothing spare: the dearest things you hold, at the daily median.",
        "Click one for its details.",
      ],
      shot: {
        open: "inventory",
        part: ".pane.shown .hero.helped",
        marks: [{ at: LEAD, is: "outline" }],
      },
    },
    {
      title: "Narrow the list",
      lines: [
        "Type a name, or pick one kind: prime parts, relics, mods, arcanes and more.",
        "Spare only: just what you hold beyond what you keep.",
        "More filters: Tradable, Sold/day ≥ and Each ≥ a price.",
        "Gear to sell for credits: gear you can't trade and no longer need.",
      ],
      shot: {
        open: "inventory",
        part: holder("inventory.filters"),
        marks: [
          { at: `${holder("inventory.filters")} > select.kinds`, is: "n", n: 1, from: "corner" },
          { at: `${holder("inventory.filters")} > button.chip`, is: "n", n: 2, from: "corner" },
          { at: `${holder("inventory.filters")} button.fold`, is: "n", n: 3, from: "corner" },
          { at: `${holder("inventory.filters")} > button.letgo`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Each item, card by card",
      lines: [
        "Sort: it starts on Spare sells for, highest first.",
        "×: how many you hold, and how many of them are spare.",
        "Each: one copy at the daily median. Spares: the spare copies' share of Spare value.",
        "Sell opens the sell form for the spare copies; a padlock: every copy is kept.",
      ],
      shot: {
        open: "inventory",
        part: `${holder("inventory.filters")}, ${CARDS}:nth-child(-n+3)`,
        marks: [
          { at: `${holder("inventory.filters")} select`, is: "n", n: 1, from: "corner" },
          { at: `${FIRST} .have`, is: "n", n: 2, from: "corner" },
          { at: `${FIRST} .vals`, is: "n", n: 3, from: "corner" },
          { at: `${FIRST} footer button.list`, is: "n", n: 4, from: "bottom" },
        ],
      },
    },
    {
      title: "An item's details",
      lines: [
        "How many you hold, its price, how many you keep and why, and its price history.",
        "Relics: a crack's worth and the odds. Prime parts: the relics that drop them.",
        "Sell, Wiki and warframe.market, as on an item's own page. Gear opens its own page instead.",
      ],
      shot: {
        open: "inventory",
        steps: [{ click: FIRST }, { wait: 2500 }],
        part: ".sheet[role=dialog]:has([data-help='inventory.sheet'])",
        marks: [],
      },
    },
  ],
  good: { text: "Prime parts, Mods and Arcanes show Worth selling instead: narrower, it leaves out what's better as ducats or Vosfor and what isn't worth a trade." },
  covers: { "inventory.band": 1, "inventory.showcase": 2, "inventory.filters": 3, "inventory.list": 4, "inventory.sheet": 5 },
};

const PARTS: Walkthrough = {
  id: "parts",
  app: "parts",
  title: "Prime parts",
  guide: guideOf("parts"),
  pages: [
    {
      title: "What your spare parts are worth",
      lines: [
        "Up to five parts worth most in Worth selling, each on the item it builds.",
        "Worth selling: loose spares best sold for plat, daily median, capped at a month's sales.",
        "Spares for ducats: what your spares best traded to Baro would bring.",
        "Ducats held, and when Baro Ki'Teer comes or leaves.",
      ],
      shot: {
        open: "parts",
        part: `.pane.shown .hero.helped, ${BAND}`,
        marks: [
          { at: LEAD, is: "n", n: 1, from: "corner" },
          { at: cell(1), is: "n", n: 2, from: "corner" },
          { at: cell(2), is: "n", n: 3, from: "corner" },
          { at: cell(3), is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Narrow the list",
      lines: [
        "Best as: Sell, Set, Ducats, Save or Keep, each part's best use.",
        "More filters starts on parts of mastered items; switch Item, or Relics: vaulted or farmable.",
        "Spare only (with Not mastered or All) leaves out copies kept to build or saved.",
      ],
      shot: {
        open: "parts",
        part: holder("parts.filters"),
        marks: [
          { at: `${holder("parts.filters")} [role=radiogroup][aria-label='Best as']`, is: "n", n: 1, from: "corner" },
          { at: `${holder("parts.filters")} button.fold`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Each part's best use",
      lines: [
        "Best as: Keep, Save for set, Sell as set, Sell, or Ducats.",
        "Its price, the daily median, and the ducats Baro gives for one.",
        "Sell opens the sell form for your spare copies; Sell set, for its complete sets.",
        "Your rates: what a ducat is worth to you, the smallest sale worth a trade.",
      ],
      shot: {
        open: "parts",
        part: `${holder("parts.filters")}, ${CARDS}:nth-child(-n+3)`,
        marks: [
          { at: `${CARDS}:has(button.list) .verdict`, is: "n", n: 1, from: "corner" },
          { at: `${CARDS}:has(button.list) .vline`, is: "n", n: 2, from: "corner" },
          { at: `${CARDS}:has(button.list) footer button.list`, is: "n", n: 3, from: "bottom" },
          { at: `${holder("parts.filters")} .end button.fold`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "One part's details",
      lines: [
        "Price is the daily median; Got (30d): copies you got in 30 days, trades left out.",
        "Sell (or Sell set); Or list … loose: the sell form for copies outside whole sets.",
        "Under the figures: why copies are kept, its price history and the relics that drop it.",
      ],
      shot: {
        open: "parts",
        steps: [{ click: FIRST }, { wait: 2500 }],
        part: ".sheet[role=dialog]:has([data-help='parts.sheet'])",
        marks: [
          { at: ".sheet[role=dialog]:has([data-help='parts.sheet']) .figs", is: "n", n: 1, from: "corner" },
          { at: ".sheet[role=dialog]:has([data-help='parts.sheet']) .actions", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Ducats for less",
      lines: [
        "Per plat: ducats each platinum buys at the daily median; gold at your rate or better.",
        "Buy order opens the buy form for five; sellers whisper you once it's posted.",
        "Parts that sell at least daily, most ducats per platinum first, twelve at most.",
      ],
      shot: {
        open: "parts",
        part: ".pane.shown #ducat-buys header, .pane.shown #ducat-buys table.dt thead, .pane.shown #ducat-buys table.dt tbody tr:nth-child(-n+3)",
        marks: [
          { at: ".pane.shown #ducat-buys table.dt thead th:nth-child(4)", is: "n", n: 1, from: "bottom" },
          { at: ".pane.shown #ducat-buys table.dt tbody tr:first-child button.link", is: "n", n: 2, from: "right" },
        ],
      },
    },
  ],
  good: {
    text: "Best as Ducats: ducats are worth as much at your rate, a trade brings under your smallest sale worth a trade, it sells slowly and ducats come close, or no price.",
  },
  covers: { "parts.band": 1, "parts.showcase": 1, "parts.filters": 2, "parts.list": 3, "parts.sheet": 4, "parts.ducats-for-less": 5 },
};

const SETS: Walkthrough = {
  id: "sets",
  app: "sets",
  title: "Sets",
  guide: guideOf("sets"),
  pages: [
    {
      title: "Sets worth selling",
      lines: [
        "Up to five sets worth most: how many you can sell × the set price.",
        "Sets to sell: complete sets you can sell, and how many are kept back to build.",
        "At set price: those sets at warframe.market's daily median.",
        "The figures follow the view below: Almost complete and Saving up have their own.",
      ],
      shot: {
        open: "sets",
        part: `.pane.shown .hero.helped, ${BAND}`,
        marks: [
          { at: LEAD, is: "n", n: 1, from: "corner" },
          { at: cell(1), is: "n", n: 2, from: "corner" },
          { at: cell(2), is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Three views of your sets",
      lines: [
        "Sets you can sell: complete sets, and what each sells for.",
        "Almost complete: one or two parts short, what they cost, and what finishing earns.",
        "Saving up: sets your loose parts wait for, worth more whole.",
        "Keep one to build: holds back sets of what you haven't built or mastered yet.",
      ],
      shot: {
        open: "sets",
        part: `.pane.shown .modes, ${holder("sets.filters")}`,
        marks: [
          { at: ".pane.shown .modes button[role=tab]:nth-of-type(1)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .modes button[role=tab]:nth-of-type(2)", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown .modes button[role=tab]:nth-of-type(3)", is: "n", n: 3, from: "corner" },
          { at: `${holder("sets.filters")} > button.chip`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Each set, card by card",
      lines: [
        "A set's price: warframe.market's daily median.",
        "How many to sell, and how many are kept to build.",
        "Sell opens the sell form for the sets you can sell.",
        "Click a card for the set's own details: what it's built from, and its prices.",
      ],
      shot: {
        open: "sets",
        part: `${holder("sets.filters")}, ${CARDS}:nth-child(-n+3)`,
        marks: [
          { at: `${FIRST} .line.sp`, is: "n", n: 1, from: "corner" },
          { at: `${FIRST} .line.sp + .line`, is: "n", n: 2, from: "corner" },
          { at: `${FIRST} footer button.list`, is: "n", n: 3, from: "bottom" },
        ],
      },
    },
    {
      title: "Saving up for sets",
      lines: [
        "Sets saved for: the sets your loose parts wait for.",
        "More as sets: over their parts sold one by one, or for ducats where that's more.",
        "Only sets worth at least 5p, and a tenth, more than their loose parts.",
        "Missing parts must come from your relics, relics still dropping, Varzia, or recent drops.",
      ],
      shot: {
        open: "sets",
        // Switching the view is the last step any Sets picture takes: the page keeps it.
        steps: [{ click: ".pane.shown .modes button[role=tab]:has-text('Saving up')" }],
        part: `${BAND}, .pane.shown .modes, ${CARDS}:nth-child(-n+2)`,
        marks: [
          { at: cell(1), is: "n", n: 1, from: "corner" },
          { at: cell(2), is: "n", n: 2, from: "corner" },
        ],
      },
    },
  ],
  good: { text: "Saving up follows Sell spares' Save prime parts for sets: turned off there, no loose parts wait for a set." },
  covers: { "sets.band": 1, "sets.showcase": 1, "sets.filters": 2, "sets.list": 3, "sets.sheet": 3 },
};

const MODS: Walkthrough = {
  id: "mods",
  app: "mods",
  title: "Mods",
  guide: guideOf("mods"),
  pages: [
    {
      title: "Your spare mods",
      lines: [
        "Up to five mods worth most in Worth selling.",
        "Spare copies, beyond your best and one to give away; days of trades to sell them.",
        "Worth selling: spares of mods sold daily, at their rank's median, a month's sales at most.",
        "Left out: spares under Not worth a trade, judged on up to six copies a trade.",
      ],
      shot: {
        open: "mods",
        part: `.pane.shown .hero.helped, ${BAND}`,
        marks: [
          { at: LEAD, is: "n", n: 1, from: "corner" },
          { at: cell(1), is: "n", n: 2, from: "corner" },
          { at: cell(2), is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Narrow the list",
      lines: [
        "Pick a rarity, or type a name.",
        "Spare only, on to start: just mods with copies beyond what you keep.",
        "More filters: Tradable and Sold daily, both on to start.",
        "Below the list, Show them brings back the mods those two hide.",
      ],
      shot: {
        open: "mods",
        part: holder("mods.filters"),
        marks: [
          { at: `${holder("mods.filters")} > select`, is: "n", n: 1, from: "corner" },
          { at: `${holder("mods.filters")} > button.chip`, is: "n", n: 2, from: "corner" },
          { at: `${holder("mods.filters")} button.fold`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Each mod, card by card",
      lines: [
        "×: copies you hold, and how many are spare.",
        "Each: an unranked copy's daily median. Spares: the spare copies, capped at a month's sales.",
        "Sell opens the sell form for your spare copies of the lowest rank.",
        "“under 5p a trade”: under your smallest sale worth a trade; left out of Worth selling.",
      ],
      shot: {
        open: "mods",
        part: `${holder("mods.filters")}, ${CARDS}:nth-child(-n+3)`,
        marks: [
          { at: `${FIRST} .have`, is: "n", n: 1, from: "corner" },
          { at: `${FIRST} .prices`, is: "n", n: 2, from: "corner" },
          { at: `${FIRST} footer button.list`, is: "n", n: 3, from: "bottom" },
        ],
      },
    },
    {
      title: "One mod's details",
      lines: [
        "Unranked and Maxed: what a copy sells for, at the daily median.",
        "Your copies by rank, the Endo to max your best, and where it drops.",
        "How many are spare; Sell spares opens the sell form for the lowest-ranked ones.",
      ],
      shot: {
        open: "mods",
        steps: [{ click: FIRST }, { wait: 2500 }],
        part: ".sheet[role=dialog]:has([data-help='mods.sheet'])",
        marks: [],
      },
    },
  ],
  good: {
    text: "Your best copy and one to give away are always kept; installed copies never count as spare. Requiem and Antivirus mods keep five while their Kuva, Tenet or Coda weapons are left.",
  },
  covers: { "mods.band": 1, "mods.showcase": 1, "mods.filters": 2, "mods.list": 3, "mods.sheet": 4 },
};

export const COLLECTION: Walkthrough[] = [INVENTORY, PARTS, SETS, MODS];
