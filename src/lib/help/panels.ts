// The shared panels' walk-throughs: the Watching column, an item's details sheet, the sidebar's
// foot, the first start's question and What's new. None of them sits in a page's pane, so their
// selectors start at the panel itself (aside.side, the sheet, .rail .foot), not at .pane.shown.
// Every sentence about prices is checked against the code that works them out (ItemDetails.svelte,
// core/market.ts, core/wishlist.ts). The pictures' steps never press anything that writes: no Sync,
// no Sell, no switch, no chip, and neither answer of the first start's question.

import type { Step, Walkthrough } from "./types";
import { guideCard } from "./guide";

// ---------------------------------------------------------------- Watching

/** The column on the right of a wide window (ui/SideWatch.svelte): shown at 1640 px and up, never beside Home. */
const SIDE = "aside.side[aria-label='Watching']";
/** One of its sections, by the part of its "?" (inside its heading or beside it). */
const card = (part: string) => `${SIDE} section:has([data-help="${part}"])`;
const WIDE: [number, number] = [1920, 1080];

const WATCHING: Walkthrough = {
  id: "watching",
  app: "shared",
  title: "Watching",
  guide: "guide",
  pages: [
    {
      title: "A column beside every page",
      lines: [
        "The gear chooses what it shows: Alerts, Fissures, Clocks, Foundry, Bounties, Market.",
        "» folds it away; the « tab on the right edge brings it back.",
        "Beside every page but Home, in a window 1640 pixels wide or more.",
        "Market, off to start: how many listings you show, and today's sales in platinum.",
      ],
      shot: {
        open: "relics",
        size: WIDE,
        // The gear only opens the chooser (its own state, not a setting); no chip is clicked.
        steps: [{ click: `${SIDE} > header button[title^='Choose what this column shows']` }],
        part: `${SIDE} > header, ${SIDE} > .choose`,
        marks: [
          { at: `${SIDE} > header button[title^='Choose what this column shows']`, is: "n", n: 1, from: "corner" },
          { at: `${SIDE} > header button[title^='Fold this column away']`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "What needs you",
      lines: [
        "Fissures your fissure alerts match, and listings for more copies than you hold.",
        "Alerts and invasions paying something you need for gear you haven't mastered.",
        "Or something rare: Forma, an Orokin Catalyst or Reactor, an Exilus Adapter, Nitain.",
        "Each shows where; alerts the time left, invasions the side to fight for.",
      ],
      shot: {
        open: "relics",
        size: WIDE,
        // Live: with nothing to show it says "Nothing that needs you right now."
        part: `${card("watching.alerts")} > .hmark, ${card("watching.alerts")} > p, ${card("watching.alerts")} > ul.cards > li:nth-child(-n+3)`,
        marks: [],
      },
    },
    {
      title: "Open fissures, era by era",
      lines: [
        "What's listed and how many: Fissures, Steel Path, Void Storms, or My alerts.",
        "The funnel chooses, for this column only: kinds, eras, missions, Only my alerts.",
        "By era; each card: mission, where, against whom, time left (red under 10 minutes).",
        "A bell marks one your alerts match; narrowed, × puts every era and mission back.",
      ],
      shot: {
        open: "relics",
        size: WIDE,
        // The funnel only opens the card's choices (its own state, not a setting); no chip is clicked.
        steps: [{ click: `${card("watching.fissures")} > .fzhead button[aria-label^="Choose this column"]` }],
        part: `${card("watching.fissures")} > .fzhead, ${card("watching.fissures")} > .fzpick, ${card("watching.fissures")} > .fzpick + div.eh, ${card("watching.fissures")} > .fzpick + div.eh + ul.cards > li:nth-child(-n+2)`,
        marks: [
          { at: `${card("watching.fissures")} > .fzhead h3`, is: "n", n: 1, from: "corner" },
          { at: `${card("watching.fissures")} > .fzhead button[aria-label^="Choose this column"]`, is: "n", n: 2, from: "corner" },
          { at: `${card("watching.fissures")} > .fzpick + div.eh`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "The open worlds, your Foundry",
      lines: [
        "Clocks: each open world's state now, day or night, warm or cold, and time left.",
        "Foundry: what's building and when it's ready, up to six, with the mastery each gives.",
      ],
      shot: {
        open: "relics",
        size: WIDE,
        // Clocks is left out of the column while the worldstate has no cycles.
        part: `${card("watching.clocks")}, ${card("watching.foundry")}`,
        marks: [
          { at: `${card("watching.clocks")} ul.tiles > li:first-child`, is: "n", n: 1, from: "corner" },
          { at: `${card("watching.foundry")} ul.cards > li:first-child`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "The bounty worth a look",
      lines: [
        "Each place's pick: a bounty with a reward you need, in gold, else the rarest one.",
        "Every bounty → opens Bounties on Home, with all of them and what each pays.",
      ],
      shot: {
        open: "relics",
        size: WIDE,
        // Bounties is left out of the column while the worldstate has none.
        part: card("watching.bounties"),
        marks: [
          { at: `${card("watching.bounties")} ul.cards > li:first-child`, is: "n", n: 1, from: "corner" },
          { at: `${card("watching.bounties")} > button.link`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
  ],
  covers: {
    "watching.market": 1,
    "watching.alerts": 2,
    "watching.fissures": 3,
    "watching.clocks": 4,
    "watching.foundry": 4,
    "watching.bounties": 5,
  },
};

// ---------------------------------------------------------------- An item's details

/** The details sheet (ItemDetails.svelte): the sheet whose own "?" is item-sheet's. */
const ITEM = `.sheet:has(> header > [data-help="item-sheet"])`;
/** One of the sheet's sections, by the part of its "?". */
const sheetPart = (part: string) => `${ITEM} section:has([data-help="${part}"])`;
/** One of the full sidebar's foot buttons, by its name (`data-item`; folded, the same name is on More's item). */
const footButton = (name: string) => `.rail .foot [data-item='${name}']`;
/** Opens an item's sheet through Find anything (the foot's Search): the item itself is the first match for its whole name. */
const openItem = (name: string): Step[] => [
  { click: footButton("Search") },
  { fill: "[role=dialog][aria-label='Find anything'] input", text: name },
  { press: "Enter" },
  { wait: 3000 },
];
// Fulmin Prime: every part in hand, unbuilt, a set on warframe.market with a seller and a buyer.
// Saryn Prime: two parts missing, unbuilt, a warframe (Base stats).
const FULMIN = openItem("Fulmin Prime");
const SARYN = openItem("Saryn Prime");

const ITEM_SHEET: Walkthrough = {
  id: "item-sheet",
  app: "shared",
  title: "An item's details",
  guide: "guide",
  pages: [
    {
      title: "One item, everything about it",
      lines: [
        "Where it stands: Mastered, Owned, not mastered, Building, Can build now, Vaulted.",
        "Sell, when you hold a whole set, opens the sell form for it.",
        "Add to wishlist puts it on Wishlist, with ★ on Foundry.",
        "Builds opens it on Builds; Wiki and warframe.market open its pages in your browser.",
      ],
      shot: {
        open: "home",
        steps: FULMIN,
        part: `${ITEM} > header, ${ITEM} section.hero`,
        marks: [
          { at: `${ITEM} section.hero .tags`, is: "n", n: 1, from: "corner" },
          { at: `${ITEM} section.hero .detail-acts button.list`, is: "n", n: 2, from: "corner" },
          { at: `${ITEM} section.hero .detail-acts button.star`, is: "n", n: 3, from: "corner" },
          { at: `${ITEM} section.hero .detail-acts button[title^='Builds for']`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "What it's worth now",
      lines: [
        "Daily median: a prime's is for the whole set.",
        "Buy now: the cheapest seller in game, and how many sellers are in game.",
        "Sell now: the best buy order from a player online or in game.",
        "Parts sold loose: each part's daily median, added up for one set.",
      ],
      shot: {
        open: "home",
        steps: FULMIN,
        part: `${ITEM} section.market`,
        marks: [
          { at: `${ITEM} section.market > .cell:nth-child(1)`, is: "n", n: 1, from: "corner" },
          { at: `${ITEM} section.market > .cell.sell`, is: "n", n: 2, from: "corner" },
          { at: `${ITEM} section.market > .cell.buy`, is: "n", n: 3, from: "corner" },
          { at: `${ITEM} section.market > .cell:nth-child(4)`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "How to get it",
      lines: [
        "Five pips, filled as far as it's hard to get, and where it comes from.",
        "How to get it, in words.",
        "With parts missing: the chance your relics give them all, cracking each once.",
        "Or what buying the missing parts would cost, at their daily medians.",
      ],
      shot: {
        open: "home",
        steps: SARYN,
        part: `${ITEM} section.how`,
        marks: [
          { at: `${ITEM} section.how .howrow .effort`, is: "n", n: 1, from: "corner" },
          { at: `${ITEM} section.how .howrow p.prose`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "What it's built from",
      lines: [
        "Each part: In hand, Missing, Building now; a resource, how many held and needed.",
        "Where it drops: up to four relics, the ones you hold first, with how many.",
        "Its daily median in platinum, and its ducats.",
        "What building it takes now: parts still to get, and each resource held against needed.",
      ],
      shot: {
        open: "home",
        steps: SARYN,
        part: `${sheetPart("item-sheet.built-from")}, ${ITEM} section.plan > .hmark, ${ITEM} section.plan ul.needs > li:nth-child(-n+2)`,
        marks: [
          { at: `${sheetPart("item-sheet.built-from")} ul.bom > li:first-child .pname`, is: "n", n: 1, from: "corner" },
          { at: `${sheetPart("item-sheet.built-from")} ul.bom > li:first-child .src`, is: "n", n: 2, from: "corner" },
          { at: `${sheetPart("item-sheet.built-from")} ul.bom > li:first-child .pval`, is: "n", n: 3, from: "corner" },
          { at: `${ITEM} section.plan > .hmark`, is: "n", n: 4, from: "corner" },
        ],
        size: [1280, 1080],
      },
    },
    {
      title: "Its stats",
      lines: [
        "A warframe's Base stats: health, shield, armor, energy, sprint speed, and its polarities.",
        "Under them, its passive and its abilities, as the game describes them.",
        "A weapon shows Stats instead: damage, critical, status, fire rate, and each damage type.",
      ],
      shot: {
        open: "home",
        steps: SARYN,
        part: `${sheetPart("item-sheet.base-stats")} > .hmark, ${sheetPart("item-sheet.base-stats")} > .stats`,
        marks: [],
      },
    },
  ],
  covers: {
    "item-sheet": 1,
    "item-sheet.prices": 2,
    "item-sheet.how": 3,
    "item-sheet.built-from": 4,
    "item-sheet.plan": 4,
    "item-sheet.base-stats": 5,
    "item-sheet.stats": 5,
  },
};

// ---------------------------------------------------------------- The sidebar's foot

const FOOT = ".rail .foot";

const RAIL: Walkthrough = {
  id: "rail",
  app: "shared",
  title: "The sidebar",
  guide: "guide",
  pages: [
    {
      title: "How MyOrbiter is doing",
      lines: [
        "Game: whether Warframe is running, and Full mode when TennoScope reads your inventory.",
        "Inventory: when it was last read; during a fissure, Fissure and the mission.",
        "Market: your orders on warframe.market, and repricing when Apply automatically is on.",
        "A filled diamond means fine; a hollow one, not yet, not running or off.",
      ],
      shot: {
        open: "home",
        part: `${FOOT} .state`,
        marks: [
          { at: `${FOOT} .state > .st:nth-child(1)`, is: "n", n: 1, from: "right" },
          { at: `${FOOT} .state > .st:nth-child(2)`, is: "n", n: 2, from: "right" },
          { at: `${FOOT} .state > .st:nth-child(3)`, is: "n", n: 3, from: "right" },
        ],
      },
    },
    {
      title: "Every button, under the status",
      lines: [
        "Sync asks TennoScope for a new read (Ctrl+R); beside it, Up to date or Not synced.",
        "Notifications: what MyOrbiter told you lately; its number is how many are new.",
        "Settings (Ctrl+,); below, Search finds anything by name (Ctrl+K).",
        "Then Help (F1), Report a bug (Shift+F1) and TennoScope, its diamond filled when all is well.",
      ],
      shot: {
        open: "home",
        part: `${FOOT} .tools`,
        marks: [
          { at: `${FOOT} .tools button.sync .lbls.aside`, is: "n", n: 1, from: "top" },
          { at: `${FOOT} .tools button.bell`, is: "n", n: 2, from: "top" },
          { at: footButton("Settings"), is: "n", n: 3, from: "top" },
        ],
      },
    },
    {
      title: "Folded to pictures",
      lines: [
        "The arrow at the top folds the sidebar and unfolds it, from the same spot.",
        "Folded, the foot keeps Sync and Notifications; More holds the other buttons.",
        "Arrow keys move through More's menu; Esc closes it. The shortcuts work without it.",
        "A narrow window folds it by itself until you choose with the arrow.",
      ],
      shot: {
        open: "home",
        size: [1000, 800],
        steps: [{ click: `${FOOT} button.more` }, { wait: 600 }],
        part: `.rail .fold, .rail .foot, .moremenu`,
        marks: [
          { at: ".rail .fold", is: "n", n: 1, from: "right" },
          { at: `${FOOT} button.more`, is: "n", n: 2, from: "right" },
          { at: ".moremenu [data-item='Settings']", is: "n", n: 3, from: "right" },
        ],
      },
    },
  ],
  covers: { "rail.foot": 1 },
};

// ---------------------------------------------------------------- Getting started

// The first start's question (FirstRun.svelte) is pictured as it opens on a first start (the shot's
// `startup: "first-run"`); the second page shows where the choice stays, in the TennoScope panel.
const INVENTORY = `.sheet[aria-label='TennoScope'] section:has([data-help="tennoscope.inventory"])`;

/** The first start's question (FirstRun.svelte). */
const FIRST_Q = "[role=dialog][aria-labelledby='first-run-title']";
/** The first start's setup page (App.svelte), until TennoScope's first read is in. */
const SETUP = "#main .notice:has(ol.steps)";

const FIRST_RUN: Walkthrough = {
  id: "first-run",
  app: "shared",
  title: "Getting started",
  guide: guideCard("fullmode"),
  pages: [
    {
      title: "One question on the first start",
      lines: [
        "Not now: overlay only: TennoScope reads the game's log and reward screen, not your inventory.",
        "Read my inventory (Full mode): your items, mastery and Foundry too, from the running game.",
        "MyOrbiter starts TennoScope only once you answer; Esc answers Not now.",
        "Change it any time in Settings, TennoScope.",
      ],
      shot: {
        open: "home",
        startup: "first-run",
        part: FIRST_Q,
        marks: [
          { at: `${FIRST_Q} footer button:nth-child(1)`, is: "n", n: 1, from: "bottom" },
          { at: `${FIRST_Q} footer button:nth-child(2)`, is: "n", n: 2, from: "bottom" },
        ],
      },
    },
    {
      title: "Or in the TennoScope panel",
      lines: [
        "Inventory: when TennoScope last read it, and the access it has.",
        "Turn Full mode off here, or Read my inventory while it's off.",
        "Then Home's Start here card lists first steps: sign in to warframe.market, set your rates…",
      ],
      shot: {
        open: "home",
        steps: [{ click: footButton("TennoScope") }, { wait: 1500 }],
        part: INVENTORY,
        marks: [
          { at: `${INVENTORY} .kv`, is: "n", n: 1, from: "corner" },
          { at: `${INVENTORY} .full`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      // Pictured with TennoScope's stand-in at the game's sign-in screen (core/standIn.ts).
      title: "Getting set up, step by step",
      lines: [
        "Each step says where it is: Warframe not running, at sign-in, or signed in.",
        "Finish later or Esc: use MyOrbiter without your inventory; automatic actions stay off.",
        "Every wait has a limit; past it, the step says why, with Try again.",
        "The sidebar waits meanwhile; its Game and Inventory lines say the same.",
      ],
      shot: {
        open: "home",
        startup: "first-start",
        standIn: "signin",
        part: SETUP,
        marks: [
          { at: `${SETUP} li.now .stage`, is: "n", n: 1, from: "left" },
          { at: `${SETUP} [data-field="setup.later"]`, is: "n", n: 2, from: "bottom" },
        ],
      },
    },
  ],
  good: {
    warn: true,
    text: "Full mode reads Warframe's memory. Digital Extremes leaves third-party programs at your own risk, so Full mode could put your account at risk: your call.",
  },
  covers: { "first-run": 1, "setup.steps": 3 },
};

// ---------------------------------------------------------------- What's new

// The update screen (WhatsNew.svelte) opens only at start, with news not seen yet; the demo doesn't
// open it. The pictures show the same changes at the end of the Guide.
const NEWS = ".pane.shown section.news";
const DAY = `${NEWS} .newshead + .day`;
const ROWS = `${DAY} + ul.rows`;
const GUIDE: Step[] = [{ click: footButton("Help") }, { wait: 3000 }];

const WHATS_NEW: Walkthrough = {
  id: "whats-new",
  app: "shared",
  title: "What's new",
  guide: guideCard("news"),
  pages: [
    {
      title: "Once, after an update",
      lines: [
        "After an update, What's new opens once, with the changes you haven't seen yet.",
        "Its biggest change leads, with Show me; Take the tour steps through them all.",
        "Got it, Esc or a click outside closes it, and those changes count as seen.",
        "The same changes stay at the end of the Guide, as here.",
      ],
      shot: {
        open: "home",
        steps: GUIDE,
        part: `${NEWS} .newshead, ${DAY}, ${ROWS} > li:nth-child(-n+2)`,
        marks: [{ at: `${NEWS} .newshead`, is: "outline" }],
      },
    },
    {
      title: "Every update, in the Guide",
      lines: [
        "Every update stays at the end of the Guide, newest first; Show me works here too.",
        "Tour steps through that day's changes, each on its page.",
        "A bar at the bottom follows along: → or Enter next, ← back, Esc ends it.",
      ],
      shot: {
        open: "home",
        steps: GUIDE,
        part: `${NEWS} .newshead, ${DAY}, ${ROWS} > li:nth-child(-n+2)`,
        marks: [
          { at: `${ROWS} button.show`, is: "n", n: 1, from: "corner" },
          { at: `${DAY} button.stamp`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
  ],
  covers: { "whats-new": 1 },
};

export const PANELS: Walkthrough[] = [WATCHING, ITEM_SHEET, RAIL, FIRST_RUN, WHATS_NEW];
