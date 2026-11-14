// Home's walk-throughs: Home's own cards (Start here, Customise, Needs you, Your orders, Ready to
// list), the world (clocks, fissures and fissure alerts, bounties and events, Worth doing today) and
// what's measured against the collection (Foundry and Wishlist, Cheap buys, mastery, Baro, Varzia).
// Every sentence about listings and prices is checked against the code that works it out
// (tabs/Home.svelte, core/worthSelling.ts, core/spares.ts, core/deals.ts, core/traders.ts). The
// demo's world is a file of its own (demo/dev-worldstate.json), the same on every run; the pictures
// still crop a panel's head and first rows, as a real day's world is longer. The steps only open
// things (the Customise gear, Add alert's menus); no tick, chip, status, dismiss, copy or add is
// pressed.

import type { Walkthrough } from "./types";
import { guideOf } from "./guide";

/** The element whose own "?" is `part`'s: a part's head bar or box. */
const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;
const card = (key: string) => `.pane.shown section[data-card="${key}"]`;

const CARDS: Walkthrough = {
  id: "home",
  app: "home",
  title: "Home",
  guide: guideOf("home"),
  pages: [
    {
      title: "Start here",
      lines: [
        "Five steps that make the rest work, each ticked once done. Click one to go there.",
        "Not now puts the card away; it goes by itself once every step is done.",
      ],
      shot: {
        open: "home",
        part: ".pane.shown section.start",
        marks: [
          { at: ".pane.shown section.start ol > li:nth-child(2) button.link", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.start header button.link", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Choose what Home shows",
      lines: [
        "Each card has a switch: click it to hide that card, or to show it again.",
        "The ⚙ at the right of Home's head opens and closes this.",
        "Show everything, once you've hidden some, brings them all back.",
      ],
      shot: {
        open: "home",
        steps: [{ click: ".pane.shown button[aria-label='Customise Home']" }],
        part: ".pane.shown section.custom",
        marks: [{ at: ".pane.shown section.custom .cards > button.chip:first-child", is: "n", n: 1, from: "corner" }],
      },
    },
    {
      title: "Needs you",
      lines: [
        "Alerts and invasions paying toward gear you haven't mastered, in gold; rare rewards too.",
        "Marks as on the reward screen: need, completes set, wishlist, held; none for resources.",
        "× dismisses one for good, with a few seconds to undo.",
        "Listings for more than you hold, a status problem and Varzia's rotation ending show too.",
      ],
      shot: {
        open: "home",
        part: card("alerts"),
        marks: [
          { at: `${card("alerts")} .aslot:first-child .alert`, is: "n", n: 1, from: "corner" },
          { at: `${card("alerts")} .alert .marks .tag.warn`, is: "n", n: 2, from: "right" },
          { at: `${card("alerts")} button[aria-label='Dismiss']`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Your orders",
      lines: [
        "Seen as: what buyers see; pick Offline, Invisible, Online or Online in game.",
        "The platinum your visible listings ask, price × quantity, and how many.",
        "Listed more than you hold: listings for more copies than your inventory has.",
        "Sold today counts from your local midnight; Trades left from 00:00 UTC.",
      ],
      shot: {
        open: "home",
        part: card("market"),
        marks: [
          { at: `${card("market")} .presence`, is: "n", n: 1, from: "corner" },
          { at: `${card("market")} .figs > div:nth-child(1)`, is: "n", n: 2, from: "corner" },
          { at: `${card("market")} .figs > div:nth-child(2)`, is: "n", n: 3, from: "corner" },
          { at: `${card("market")} .figs > div:nth-child(3)`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Ready to list",
      lines: [
        "If you list your spares: the kinds ticked on Sell spares, at your minimum or over.",
        "Each kind: its copies, and their platinum, counting no more than a month's sales.",
        "Under it: what your minimum leaves out, though worth a trade.",
        "Spares better as ducats or Vosfor, or not worth a trade, aren't counted.",
      ],
      shot: {
        open: "home",
        part: card("ready"),
        marks: [
          { at: `${card("ready")} .big`, is: "n", n: 1, from: "corner" },
          { at: `${card("ready")} ul.kinds`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
  ],
  covers: { "home.start": 1, "home.customise": 2, "home.needs-you": 3, "home.market": 4, "home.ready": 5 },
};

const WORLD: Walkthrough = {
  id: "home-world",
  app: "home",
  title: "The world today",
  guide: guideOf("home"),
  pages: [
    {
      title: "The world's clocks",
      lines: [
        "The open worlds' cycles, the Zariman's faction and Duviri's mood, with time left.",
        "Daily and weekly resets: standing caps, the Archon Hunt and more renew then.",
        "Updated, by the date at the top: when the world was last read, every 5 minutes.",
      ],
      shot: {
        open: "home",
        part: card("world"),
        marks: [
          { at: `${card("world")} > .clock:not(.reset)`, is: "n", n: 1, from: "corner" },
          { at: `${card("world")} > .clock.reset`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Fissures open now, by kind",
      lines: [
        "Normal, Steel Path or Void Storms, and how many of each are open.",
        "Each era: your relic worth most to crack there, and the plat you'd average.",
        "Each fissure: mission, quick ones first, node, enemy and time left.",
        "Recruit copies a squad line for that relic; the + shows your next best.",
      ],
      shot: {
        open: "home",
        // The head, the kinds and the first era's head and first three fissures: the rest are more of the same.
        part: `${card("fissures")} header.ph, ${card("fissures")} .kinds, ${card("fissures")} section.era:first-of-type > header, ${card("fissures")} section.era:first-of-type ul > li:nth-child(-n+3)`,
        marks: [
          { at: `${card("fissures")} .kinds`, is: "n", n: 1, from: "corner" },
          { at: `${card("fissures")} section.era:first-of-type > header`, is: "n", n: 2, from: "corner" },
          { at: `${card("fissures")} section.era:first-of-type ul > li:first-child`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Fissure alerts",
      lines: [
        "Tick any kinds, eras, missions and planets; Void Storms count only when ticked.",
        "Add this alert: you get a notification when a matching fissure opens.",
        "Matches show under your alerts; Only my alerts, above the board, shows just those.",
        "Click an alert to change it; × removes it.",
      ],
      shot: {
        open: "home",
        steps: [{ click: ".pane.shown button.add[data-card='addalert']" }],
        part: `${card("fissures")} .watch`,
        marks: [
          { at: `${card("fissures")} .watch .addrule > .pm:first-child`, is: "n", n: 1, from: "corner" },
          { at: `${card("fissures")} .watch button[aria-label='Add this alert']`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Bounties and events",
      lines: [
        "One line a place: its rarest reward and chance per run, gold when you need it.",
        "Every bounty → opens each place's bounties: levels, rewards and standing.",
        "Below, while one is running: events, where, until when, and what they pay.",
      ],
      shot: {
        open: "home",
        // Events shows only while one runs: with none, the picture is the bounties alone.
        part: `${card("bounties")}, ${card("events")}`,
        marks: [
          { at: `${card("bounties")} ul.bsum > li:first-child`, is: "n", n: 1, from: "corner" },
          { at: `${card("bounties")} button.fold`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Worth doing today",
      lines: [
        "How many you've ticked off, of what's worth doing today and this week.",
        "Each line: a task, and how long until it ends or changes.",
        "Tick it once done: the game doesn't say. It clears itself at that task's reset.",
        "Everything → opens the Sortie's missions, Nightwave's challenges, Darvo's deal and the rest.",
      ],
      shot: {
        open: "home",
        part: `${card("today")} header.ph, ${card("today")} .chorecount, ${card("today")} .tgrid`,
        marks: [
          { at: `${card("today")} .chorecount`, is: "n", n: 1, from: "corner" },
          { at: `${card("today")} .tgrid > .tblock:first-child .th`, is: "n", n: 2, from: "corner" },
          { at: `${card("today")} .th .tick`, is: "n", n: 3, from: "right" },
        ],
      },
    },
  ],
  covers: { "home.world": 1, "home.fissures": 2, "home.bounties": 4, "home.events": 4, "home.today": 5 },
};

const COLLECTION: Walkthrough = {
  id: "home-collection",
  app: "home",
  title: "Gear, buys and traders",
  guide: guideOf("home"),
  pages: [
    {
      title: "Foundry and wishlist",
      lines: [
        "What's building in your Foundry: the time left, or Ready.",
        "Every part in hand: what you can build now, or what's still short to build it.",
        "Your wishlist: what you starred and still need; a relic you hold to crack now.",
        "Star a warframe or weapon in Foundry or Mastery to add it here.",
      ],
      shot: {
        open: "home",
        part: `${card("foundry")}, ${card("wishes")}`,
        marks: [
          { at: `${card("foundry")} ul.fb:first-of-type > li:first-child`, is: "n", n: 1, from: "corner" },
          { at: `${card("foundry")} .register.sub`, is: "n", n: 2, from: "corner" },
          { at: `${holder("home.wishes")} + *`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Cheap buys",
      lines: [
        "Parts missing from sets one or two short, and arcanes you've started collecting.",
        "A seller who's on lists it at 60% of its daily median or less (medians 6p+).",
        "Copy whisper puts a message to the seller on your clipboard, for the game.",
        "Your price alerts (Alert me at this price): any listing at your price or under.",
      ],
      shot: {
        open: "home",
        part: card("deals"),
        marks: [],
      },
    },
    {
      title: "Easiest mastery next",
      lines: [
        "The easiest things you haven't mastered: how hard each is, and how to get it.",
        "The mastery points each gives.",
        "Above them, to rank up: gear you own but haven't taken to max rank yet.",
        "Click one for its details.",
      ],
      shot: {
        open: "home",
        part: `${card("mastery")} header.ph, ${card("mastery")} .levelrow, ${card("mastery")} ul.mr > li:nth-child(-n+3)`,
        marks: [
          { at: `${card("mastery")} ul.mr > li:first-child .effort`, is: "n", n: 1, from: "corner" },
          { at: `${card("mastery")} ul.mr > li:first-child .pts`, is: "n", n: 2, from: "right" },
        ],
      },
    },
    {
      title: "Baro Ki’Teer",
      lines: [
        "When he comes and where; while he's here, when he leaves.",
        "Ducats you hold, and more from spare parts better traded in than sold.",
        "While he's here: what he brings that's new to you, with its ducats and credits.",
        "Best ducats to plat: his stock that sells on warframe.market, by daily median per ducat.",
      ],
      shot: {
        open: "home",
        // His stock shows only while he's here: the head, when, and your ducats are always there.
        part: `${card("baro")} header.ph, ${card("baro")} .when, ${card("baro")} .ducats`,
        marks: [
          { at: `${card("baro")} .when`, is: "n", n: 1, from: "corner" },
          { at: `${card("baro")} .ducats`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Varzia: Prime Resurgence",
      lines: [
        "How many of her primes you need, and when her rotation ends.",
        "Her relics opens them on Relics.",
        "Each prime: whole for Regal Aya, or her relics for the parts you're missing.",
        "Only here: a missing part that drops only from her relics right now.",
      ],
      shot: {
        open: "home",
        part: `${card("varzia")} header.ph, ${card("varzia")} .when, ${card("varzia")} ul.vz > li:nth-child(-n+3)`,
        marks: [
          { at: `${card("varzia")} .when`, is: "n", n: 1, from: "corner" },
          { at: `${holder("home.varzia")} button.link`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
  ],
  covers: { "home.foundry": 1, "home.wishes": 1, "home.deals": 2, "home.mastery": 3, "home.baro": 4, "home.varzia": 5 },
};

export const HOME: Walkthrough[] = [CARDS, WORLD, COLLECTION];
