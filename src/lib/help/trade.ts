// The Trade section's walk-throughs: Orders, Sell spares, Sales, Browse market and the buy and sell
// forms. Every sentence about listings and prices is checked against the code that does it
// (core/drift.ts, core/approved.ts, core/listGuard.ts, core/bulk.ts, marketStore.svelte.ts), not
// the Guide alone. The pictures' steps never press anything that writes (Reprice, Apply, Sold,
// Remove, a dialog's send button); Check prices and Plan the changes only read.

import type { Walkthrough } from "./types";
import { guideOf } from "./guide";
import { AUTO_FLOOR_SHARE } from "../core/approved";

/** The element whose own "?" is `part`'s: a part's head bar or box. */
const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;
const CHECK = { click: ".pane.shown .bar.tools button:has-text('Check prices')" };
const PLAN = { click: ".pane.shown .planbtn" };

const ORDERS: Walkthrough = {
  id: "orders",
  app: "market",
  title: "Orders",
  guide: guideOf("market"),
  pages: [
    {
      title: "The day at a glance",
      lines: [
        "Listings: yours, hidden too, of warframe.market's 100, less your buy orders.",
        "Undercut: shown listings with a cheaper seller online or in game, at the last check.",
        "Trades left today: as many as your Mastery Rank, reset at 00:00 UTC.",
        "Your status: what buyers see. Invisible hides your listings; Offline shows you as offline.",
      ],
      shot: {
        open: "market",
        part: ".pane.shown section.tiles, .pane.shown section.status",
        marks: [
          { at: ".pane.shown section.tiles > .tile:nth-child(1) .register", is: "n", n: 1, from: "right" },
          { at: ".pane.shown section.tiles > .tile:nth-child(3) .register", is: "n", n: 2, from: "right" },
          { at: ".pane.shown section.tiles > .tile:nth-child(4) .register", is: "n", n: 3, from: "right" },
          { at: ".pane.shown section.status .presence .row", is: "n", n: 4, from: "top" },
        ],
      },
    },
    {
      title: "List something new",
      lines: [
        "Type something you hold (on a console, anything) and pick it: the sell form opens.",
        "Or the list icon on a card or row in Inventory, Sets, Mods, Relics and more.",
      ],
      shot: {
        open: "market",
        part: ".pane.shown section.newlisting",
        marks: [
          { at: ".pane.shown section.newlisting input", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.newlisting .hint", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Check prices, then Reprice",
      lines: [
        "Check prices reads the order books and shows what each shown, auto-priced listing would change to.",
        "Reprice sends the changes shown, and never lower than shown.",
        "This line opens the automatic settings: checking and changing prices, the floor, after a trade.",
      ],
      shot: {
        open: "market",
        steps: [CHECK, { wait: 15000 }],
        part: ".pane.shown .bar.tools",
        marks: [
          { at: ".pane.shown .bar.tools .grp > button:nth-child(1)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .bar.tools .grp > button:nth-child(2)", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown .bar.tools button.fold", is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Each listing, row by row",
      lines: [
        "Will set: what Reprice would change the price to, tagged when not the market price.",
        "Auto-price off leaves that listing's price as you set it.",
        "Shown off hides the listing from buyers.",
        "Sold marks one copy sold and logs the sale, with a few seconds to undo.",
      ],
      shot: {
        open: "market",
        steps: [CHECK, { wait: 15000 }],
        // One tbody per listing: the head and the first three.
        part: ".pane.shown table.orders thead, .pane.shown table.orders tbody:nth-of-type(-n+3) > tr.order",
        marks: [
          { at: ".pane.shown table.orders thead th.willset", is: "n", n: 1, from: "top" },
          { at: ".pane.shown table.orders thead th:nth-child(8)", is: "n", n: 2, from: "top" },
          { at: ".pane.shown table.orders thead th:nth-child(9)", is: "n", n: 3, from: "top" },
          { at: ".pane.shown table.orders tbody:first-of-type > tr.order td.c-acts button", is: "n", n: 4, from: "top" },
        ],
      },
    },
    {
      title: "Whispers, and what happened",
      lines: [
        "Whispered you: who whispered you this game session, read from the game's log.",
        "Invite copies /invite and their name, to paste in game.",
        "Below your listings: buy orders, riven auctions, and Activity, saying what was sent or held back.",
      ],
      shot: {
        open: "market",
        part: ".pane.shown section.whispers",
        marks: [{ at: ".pane.shown section.whispers .wh", is: "outline" }],
      },
    },
  ],
  good: {
    warn: true,
    text: `Apply automatically is off unless you turn it on. Unattended, it never goes under ${Math.round(AUTO_FLOOR_SHARE * 100)}% of the price you last set or approved in MyOrbiter.`,
  },
  covers: {
    "orders.tiles": 1,
    "orders.status": 1,
    "orders.sign-in": 1,
    "orders.unreachable": 1,
    "orders.new-listing": 2,
    "orders.reprice": 3,
    "orders.listings": 4,
    "orders.whispers": 5,
    "orders.buy-orders": 5,
    "orders.auctions": 5,
    "orders.activity": 5,
  },
};

const SPARES: Walkthrough = {
  id: "spares",
  app: "spares",
  title: "Sell spares",
  guide: guideOf("spares"),
  pages: [
    {
      title: "Tick what to sell",
      lines: [
        "One row per kind: its box says whether it's sold.",
        "Its line says how, in words.",
        "Its figures: what it would list, ~ at the daily prices.",
        "The top line adds up the ticked kinds.",
      ],
      shot: {
        open: "spares",
        part: ".pane.shown .spares-plan header.top, .pane.shown #cat-prime, .pane.shown #cat-mods, .pane.shown #cat-arcanes",
        marks: [
          { at: ".pane.shown #cat-mods button.box", is: "n", n: 1, from: "left" },
          { at: ".pane.shown #cat-mods .sum", is: "n", n: 2, from: "left" },
          { at: ".pane.shown #cat-mods .fig", is: "n", n: 3, from: "left" },
          { at: ".pane.shown .spares-plan header.top .totals", is: "n", n: 4, from: "left" },
        ],
      },
    },
    {
      title: "Open a kind to choose how",
      lines: [
        "Click a row for its options: how many to keep, which copies go.",
        "At its foot, what it always keeps or never lists, whatever the options say.",
        "Back to the usual rules resets every row and tick; minimums, switches and never-sell stay.",
      ],
      shot: {
        open: "spares",
        steps: [{ click: ".pane.shown #cat-mods button.rowbtn" }],
        part: ".pane.shown #cat-mods",
        marks: [{ at: ".pane.shown #cat-mods .body", is: "outline" }],
      },
    },
    {
      title: "Minimum prices",
      lines: [
        "Never under: the minimum for everything, the same one as on Orders.",
        "A kind's own box replaces it for that kind; relics start at 3p.",
        "MyOrbiter lists nothing under its minimum: a spare that sells for less is left out.",
        "Reprice raises a shown listing under its minimum up to it, unless Auto-price is off.",
      ],
      shot: {
        open: "spares",
        part: ".pane.shown .minimums .mins",
        marks: [
          { at: ".pane.shown .minimums .mins .all input", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .minimums .mins label.cat:nth-of-type(4) input", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Plan, look it over, apply",
      lines: [
        "Plan the changes prices everything and lists what it would do; nothing is sent yet.",
        "Each line names its row and the rule that decided it.",
        "⋯ on a new or changed line: Skip this time, or Never sell.",
        "Apply the plan sends it, removals first; new copies are checked against a recent inventory read.",
      ],
      shot: {
        open: "spares",
        steps: [PLAN, { wait: 15000 }],
        part: ".pane.shown section.planned .summary, .pane.shown table.plan thead, .pane.shown table.plan tbody:first-of-type > tr:nth-child(-n+2)",
        marks: [
          { at: ".pane.shown section.planned .summary > span:first-child", is: "n", n: 1, from: "top" },
          { at: ".pane.shown table.plan tbody tr:first-child td.rule .rl", is: "n", n: 2, from: "left" },
          { at: ".pane.shown table.plan tbody tr:first-child button.more", is: "n", n: 3, from: "right" },
          { at: ".pane.shown section.planned .summary button.primary", is: "n", n: 4, from: "left" },
        ],
      },
    },
  ],
  good: { text: "A plan over 10 minutes old is priced again when you press Apply: look it over and apply again." },
  covers: { "spares.kinds": 1, "spares.minimums": 3, "spares.plan-button": 4, "spares.plan": 4 },
};

const SALES: Walkthrough = {
  id: "sales",
  app: "sales",
  title: "Sales",
  guide: guideOf("sales"),
  pages: [
    {
      title: "What your sales made",
      lines: [
        "The tape: today, the last 7 days and your best sale.",
        "Under it: the last 30 days against the daily median, and everything logged.",
      ],
      shot: {
        open: "sales",
        part: ".pane.shown .hero.helped, .pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown .hero.helped .tape", is: "n", n: 1, from: "right" },
          { at: ".pane.shown section.band.helped", is: "n", n: 2, from: "right" },
        ],
      },
    },
    {
      title: "Platinum per day, best sellers",
      lines: [
        "Platinum per day over 7 or 30 days; All widens Best sellers only.",
        "Best sellers: what made the most. Sells often marks what's worth listing more of.",
      ],
      shot: {
        open: "sales",
        part: ".pane.shown section:has(> .head > [data-help='sales.chart']), .pane.shown section:has(> .head > [data-help='sales.best'])",
        marks: [
          { at: `${holder("sales.chart")}`, is: "n", n: 1, from: "top" },
          { at: `${holder("sales.best")}`, is: "n", n: 2, from: "top" },
        ],
      },
    },
    {
      title: "The sale log",
      lines: [
        "Signed in, with Mark sales sold from the game on, an in-game platinum sale logs itself.",
        "Import brings in sales you marked sold on warframe.market's site or app.",
        "Add a sale by hand: item, how many, the price each.",
      ],
      shot: {
        open: "sales",
        part: ".pane.shown .loghead",
        marks: [
          { at: ".pane.shown .loghead h2", is: "n", n: 1, from: "corner" },
          // The Import button, not its row: the row starts where the heading does.
          { at: ".pane.shown .loghead .import button.pb.text", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown .loghead form.addsale", is: "n", n: 3, from: "corner" },
        ],
      },
    },
  ],
  covers: { "sales.ticker": 1, "sales.band": 1, "sales.chart": 2, "sales.best": 2, "sales.log": 3, "sales.add": 3, "sales.empty": 3 },
};

const BROWSE: Walkthrough = {
  id: "browse",
  app: "browse",
  title: "Browse market",
  guide: guideOf("browse"),
  pages: [
    {
      title: "Find something on the market",
      lines: [
        "The tape: how many items show, how many sell daily, how many you hold.",
        "Type to filter by name.",
        "Pick a kind: prime parts, sets, relics, mods, arcanes and more.",
        "Sold weekly hides what sells under once a week, or on fewer than 5 days.",
      ],
      shot: {
        open: "browse",
        part: `.pane.shown .hero.helped, ${holder("browse.filters")}`,
        marks: [
          { at: ".pane.shown .hero.helped .tape", is: "n", n: 1, from: "right" },
          { at: `${holder("browse.filters")} > input`, is: "n", n: 2, from: "corner" },
          { at: `${holder("browse.filters")} > select`, is: "n", n: 3, from: "corner" },
          { at: `${holder("browse.filters")} > button.chip`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Sort, then cards or a list",
      lines: ["Sort by price, sold a day, ducats or what you have, either way.", "Cards or Table: the same items, as you like them."],
      shot: {
        open: "browse",
        part: holder("browse.filters"),
        marks: [
          { at: `${holder("browse.filters")} select`, is: "n", n: 1, from: "bottom" },
          { at: `${holder("browse.filters")} [role=radiogroup], ${holder("browse.filters")} .layout`, is: "n", n: 2, from: "bottom" },
        ],
      },
    },
    {
      title: "An item's details",
      lines: ["Click an item for how often it sells, and its price history if it sold lately.", "Buy order opens the buy form: the best buyer and cheapest seller, read live."],
      shot: {
        open: "browse",
        steps: [{ fill: ".pane.shown .bar input", text: "Arcane Grace" }, { click: ".pane.shown article.card[role='button']" }, { wait: 2500 }],
        part: ".sheet[role=dialog]",
        marks: [],
      },
    },
  ],
  covers: { "browse.ticker": 1, "browse.filters": 1, "browse.list": 2, "browse.sheet": 3 },
};

const BUY: Walkthrough = {
  id: "buy",
  app: "browse",
  title: "Post a buy order",
  guide: guideOf("browse"),
  pages: [
    {
      title: "Post a buy order",
      lines: [
        "Price each: one over the best buyer, else 80% of 30-day median; under the cheapest seller.",
        "Best buyer, cheapest seller you can trade with, and the 30-day sold price.",
        "Alert me at this price posts nothing: Cheap buys says when it's listed that low.",
        "Post buy order puts it on warframe.market; sellers whisper you in game.",
      ],
      shot: {
        open: "browse",
        steps: [{ fill: ".pane.shown .bar input", text: "Arcane Grace" }, { click: ".pane.shown article.card button:has-text('Buy order')" }, { wait: 3000 }],
        part: "[role=dialog]:has([data-help='buy'])",
        marks: [
          { at: "[role=dialog]:has([data-help='buy']) .fields label:nth-child(3)", is: "n", n: 1, from: "right" },
          { at: "[role=dialog]:has([data-help='buy']) .facts", is: "n", n: 2, from: "left" },
          { at: "[role=dialog]:has([data-help='buy']) .row.end button.pb:not(.gold)", is: "n", n: 3, from: "bottom" },
          { at: "[role=dialog]:has([data-help='buy']) .row.end button.gold", is: "n", n: 4, from: "bottom" },
        ],
      },
    },
  ],
  good: { text: "Your buy orders are listed on Orders, to take down." },
  covers: { buy: 1 },
};

const SELL: Walkthrough = {
  id: "sell",
  app: "market",
  title: "Sell on warframe.market",
  guide: guideOf("market"),
  pages: [
    {
      title: "Selling on warframe.market",
      lines: [
        "Price each: the cheapest seller in game, raised to your minimum and floors; else blank.",
        "Sellers' asks in game, the daily median, and how many you can spare.",
        "Listed already? Add to it, not a second; a hidden one stays hidden.",
        "Sending checks again: not under its minimum, not over what your inventory says is spare.",
      ],
      shot: {
        open: "market",
        steps: [{ fill: ".pane.shown section.newlisting input", text: "Blood Rush" }, { press: "Enter" }, { wait: 3000 }],
        part: "[role=dialog]:has([data-help='sell'])",
        marks: [
          { at: "[role=dialog]:has([data-help='sell']) .fields label:last-child", is: "n", n: 1, from: "right" },
          { at: "[role=dialog]:has([data-help='sell']) .facts", is: "n", n: 2, from: "left" },
          { at: "[role=dialog]:has([data-help='sell']) label.merge", is: "n", n: 3, from: "left" },
          { at: "[role=dialog]:has([data-help='sell']) .row.end button.gold", is: "n", n: 4, from: "bottom" },
        ],
      },
    },
  ],
  good: { warn: true, text: "Something on your never-sell list (Sell spares) isn't listed from here either." },
  covers: { sell: 1 },
};

// Orders' automatic panel (the fold under Check prices and Reprice), opened. Every sentence is
// checked against core/schedule.ts, core/drift.ts, core/approved.ts and the pass in
// marketStore.svelte.ts; the steps open the fold and press nothing in it.
const AUTO = ".pane.shown .autopanel";
const autoGroup = (h: string) => `${AUTO} section[aria-labelledby='${h}']`;
// Opens the panel, or clicks its first heading (nothing) when an earlier page left it open: the pane stays mounted.
const OPEN_AUTO = { click: ".pane.shown .bar.tools :is(button.fold[aria-expanded='false'], #auto-check-h)" };

const ORDERS_AUTO: Walkthrough = {
  id: "orders-automatic",
  app: "market",
  title: "Orders: automatic",
  guide: guideOf("market"),
  pages: [
    {
      title: "Checking and changing prices",
      lines: [
        "Check automatically only reads prices, every minute to once a week.",
        "Apply automatically sends past a 2p and 5% gap, or up to a floor.",
        `Never under ${Math.round(AUTO_FLOOR_SHARE * 100)}% of your set or approved price, nor your floors; never more than halved.`,
        "Per listing: hourly at most, six a day. A missed check runs once after restart.",
      ],
      shot: {
        open: "market",
        steps: [OPEN_AUTO, { wait: 800 }],
        part: `${autoGroup("auto-check-h")}, ${autoGroup("auto-apply-h")}`,
        marks: [
          { at: `${autoGroup("auto-check-h")} button.chip`, is: "n", n: 1, from: "corner" },
          { at: `${autoGroup("auto-apply-h")} button.chip`, is: "n", n: 2, from: "right" },
          { at: `${autoGroup("auto-apply-h")} button.link`, is: "n", n: 3, from: "right" },
          { at: `${autoGroup("auto-check-h")} select`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "After a trade, and whispers",
      lines: [
        "Mark sales sold: a trade in game marks its listing sold, and logs it.",
        "Give +rep by itself: each partner gets +rep once, posted as you.",
        "Hide last copies: a whisper hides listings you have one copy of, for a while.",
        "Each is off unless you turn it on; Settings, Trades has the same switches.",
      ],
      shot: {
        open: "market",
        steps: [OPEN_AUTO, { wait: 800 }],
        part: `${autoGroup("auto-trade-h")}, ${autoGroup("auto-whisper-h")}`,
        marks: [
          { at: `${autoGroup("auto-trade-h")} .pair > div:nth-child(1) button.chip`, is: "n", n: 1, from: "right" },
          { at: `${autoGroup("auto-trade-h")} .pair > div:nth-child(2) button.chip`, is: "n", n: 2, from: "right" },
          { at: `${autoGroup("auto-whisper-h")} button.chip`, is: "n", n: 3, from: "right" },
        ],
      },
    },
  ],
  good: {
    warn: true,
    text: "warframe.market calls automation like this a grey area and may limit apps that do it.",
  },
  covers: { "orders.automatic": 1 },
};

export const TRADE: Walkthrough[] = [ORDERS, ORDERS_AUTO, SPARES, SALES, BROWSE, BUY, SELL];
