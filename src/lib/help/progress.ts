// The Progress section's walk-throughs: Mastery, Foundry, Builds (finding builds, then pasting or
// editing one) and Wishlist. Every sentence about prices is checked against the code that works it
// out (core/platMastery.ts, core/views.ts, core/collection.ts, core/wishlist.ts,
// core/builds/missing.ts), not the Guide alone. The pictures' steps never press anything that
// writes: no star, no Save, no Buy order, no Find seller; switching Mastery's view, typing in a
// filter or the item picker and opening the paste dialog or the editor only read.
//
// Page order matters where a page keeps its state between pictures: Mastery's Buy with plat view
// stays chosen once clicked (its page is last), and once Builds has an item picked its landing is
// gone (the landing's pages come first; the later ones pick through the item picker, which is there
// either way).

import type { Step, Walkthrough } from "./types";
import { guideOf } from "./guide";

/** The element whose own "?" is `part`'s: a part's head bar or box. */
const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;
/** Mastery's view on screen (the other stays drawn, hidden). */
const SHOWN_VIEW = ".pane.shown .view.swap:not(.off)";
/** Builds: pick a warframe (its MyOrbiter suggestion carries tags), through the picker in the head. */
const PICK: Step[] = [{ fill: ".pane.shown .picker input", text: "Excalibur" }, { press: "Enter" }, { wait: 3000 }];
const BUILD = ".pane.shown ul.builds > li:first-child article.build";
const PASTE = "[role=dialog]:has([data-help='builds.paste'])";
const EDITOR = "[role=dialog]:has([data-help='builds.editor'])";

const MASTERY: Walkthrough = {
  id: "mastery",
  app: "mastery",
  title: "Mastery",
  guide: guideOf("mastery"),
  pages: [
    {
      title: "What's left to master",
      lines: [
        "Each ring: what you've mastered of a category. Click one for only what's left there.",
        "Under them: what to rank up, and the easiest thing to get next.",
        "Your rank; the game doesn't say how far into it you are.",
        "Mastery left: ranking what you own, easy to get, and all you can still get.",
      ],
      shot: {
        open: "mastery",
        part: ".pane.shown .hero.helped, .pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown .hero.helped .rings > button.ring:nth-child(2)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .hero.helped p.next", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(1)", is: "n", n: 3, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(3)", is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Two views, and the filters",
      lines: [
        "Easiest first, or Buy with plat: what platinum gets you, cheapest first.",
        "Filter by name, kind or how you get it, or pick a kind beside it.",
        "Prime, Non-prime, or All.",
        "More filters: how hard (Easy, Moderate, Hard) and Show unavailable, for what you can't get now.",
      ],
      shot: {
        open: "mastery",
        part: `.pane.shown .views, ${holder("mastery.filters")}`,
        marks: [
          { at: ".pane.shown .views [role=tablist]", is: "n", n: 1, from: "corner" },
          { at: `${holder("mastery.filters")} > input`, is: "n", n: 2, from: "corner" },
          { at: `${holder("mastery.filters")} [role=radiogroup][aria-label='Prime']`, is: "n", n: 3, from: "corner" },
          { at: `${holder("mastery.filters")} button.fold`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Easiest first",
      lines: [
        "Sort by effort, mastery, the parts' price and more; or Table.",
        "Each card: how hard it is to get, and how.",
        "Primes: the chance your relics drop every missing part, or what buying them costs.",
        "★ adds it to your Wishlist. Click it for where each missing part drops.",
      ],
      shot: {
        open: "mastery",
        part: `${holder("mastery.list")}, ${SHOWN_VIEW} .cards.swap .grid > article.card:nth-child(-n+3)`,
        marks: [
          { at: `${holder("mastery.list")} select`, is: "n", n: 1, from: "corner" },
          { at: `${SHOWN_VIEW} .cards.swap .grid > article.card:first-child .body`, is: "n", n: 2, from: "corner" },
          { at: `${SHOWN_VIEW} .cards.swap .grid > article.card:first-child footer`, is: "n", n: 3, from: "corner" },
          { at: `${SHOWN_VIEW} .cards.swap .grid > article.card:first-child button.star`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Buy mastery with platinum",
      lines: [
        "Least plat first, or Plat per mastery: the most mastery for your platinum.",
        "What to buy: missing parts, or the set when you hold none and it's cheaper.",
        "Its cost, from players or the in-game Market, and plat per 1,000 mastery.",
        "Buying everything down the list to here: what it costs, and the mastery it gets.",
      ],
      shot: {
        open: "mastery",
        steps: [{ fill: `${holder("mastery.filters")} > input`, text: "" }, { click: ".pane.shown .views button[role=tab]:has-text('Buy with plat')" }, { wait: 1500 }],
        part: `${holder("mastery.plat-order")}, ${SHOWN_VIEW} .pmh, ${SHOWN_VIEW} ol.pm > li:nth-child(-n+3)`,
        marks: [
          { at: `${holder("mastery.plat-order")} [role=radiogroup]`, is: "n", n: 1, from: "corner" },
          { at: `${SHOWN_VIEW} ol.pm > li:nth-child(-n+3) .buys`, is: "n", n: 2, from: "corner" },
          { at: `${SHOWN_VIEW} ol.pm > li:first-child .cost`, is: "n", n: 3, from: "corner" },
          { at: `${SHOWN_VIEW} ol.pm > li:first-child .tot`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
  ],
  good: { text: "Buy order only opens the buy form, for as many as you need; nothing is posted until you press Post buy order." },
  covers: { "mastery.band": 1, "mastery.codex": 1, "mastery.filters": 2, "mastery.list": 3, "mastery.sheet": 3, "mastery.plat-order": 4 },
};

const FOUNDRY: Walkthrough = {
  id: "foundry",
  app: "foundry",
  title: "Foundry",
  guide: guideOf("foundry"),
  pages: [
    {
      title: "Everything you can master",
      lines: [
        "Each ring: what you've mastered of a category. Click one to show only that category.",
        "Under them, by name: what to build, assemble, gild or level next.",
        "Can build now: not mastered, with every part and resource in hand.",
        "Ready to claim: what's done in your foundry, of all that's building.",
      ],
      shot: {
        open: "foundry",
        part: ".pane.shown .hero.helped, .pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown .hero.helped .rings > button.ring:nth-child(2)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .hero.helped p.next", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(3)", is: "n", n: 3, from: "corner" },
          { at: ".pane.shown section.band.helped > .cell:nth-child(4)", is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "What's in your foundry",
      lines: ["What's building, soonest first, with the time left; Ready once you can claim it.", "Click one for its details; a part opens the gear it goes into."],
      shot: {
        open: "foundry",
        part: ".pane.shown .qbox",
        marks: [{ at: ".pane.shown ul.queue > li:first-child", is: "outline" }],
      },
    },
    {
      title: "Filter what's shown",
      lines: ["Type a name or a kind (Kitgun, MOA, Zaw): it looks through every category.", "Show: All, Not mastered, Owned, Can build, and ★ Wishlist once you've starred some."],
      shot: {
        open: "foundry",
        part: holder("foundry.filters"),
        marks: [
          { at: `${holder("foundry.filters")} > input`, is: "n", n: 1, from: "corner" },
          { at: `${holder("foundry.filters")} [role=radiogroup]`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Each card, part by part",
      lines: [
        "Sort by name, closest to done, mastery, set price or MR; or Table.",
        "Each part: gold when you hold it. Resources show only when you're short.",
        "Its state, and its set price for a prime, else its mastery.",
        "The star puts it on your Wishlist. Click a card for drops, stats and prices.",
      ],
      shot: {
        open: "foundry",
        part: `${holder("foundry.list")}, .pane.shown .cards.swap .grid > article.card:nth-child(-n+3)`,
        marks: [
          { at: `${holder("foundry.list")} select`, is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .cards.swap .grid > article.card:first-child .chips", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown .cards.swap .grid > article.card:first-child footer", is: "n", n: 3, from: "corner" },
          { at: ".pane.shown .cards.swap .grid > article.card:first-child button.star", is: "n", n: 4, from: "corner" },
        ],
      },
    },
  ],
  covers: { "foundry.band": 1, "foundry.codex": 1, "foundry.queue": 2, "foundry.filters": 3, "foundry.list": 4 },
};

const BUILDS: Walkthrough = {
  id: "builds",
  app: "builds",
  title: "Builds",
  guide: guideOf("builds"),
  pages: [
    {
      title: "Pick something to build",
      lines: [
        "Find anything that takes mods: a warframe, weapon, companion, archwing… Yours come first.",
        "Your most built: items you saved most builds for; before any, your most invested gear.",
        "Also often built: the next few, by the same count.",
        "New build, at the top right, asks what it's for, then opens an empty build.",
      ],
      shot: {
        open: "builds",
        // The picker opens its list when it takes the focus: closed, so it covers nothing.
        steps: [{ press: "Escape" }],
        part: `.pane.shown .hero.helped, ${holder("builds.most-built")}, .pane.shown .landing > .row:has(ul.cards)`,
        marks: [
          { at: ".pane.shown .hero.helped .picker input", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .landing ul.cards > li:first-child", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown .landing section[aria-label='Also often built']", is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Recent builds, or browse by kind",
      lines: [
        "Each kind: how many things take a build; click one to list them to pick from.",
        "Recent builds: the ones you saved or changed last, each against your inventory.",
        "Click one to open it, in its tier.",
      ],
      shot: {
        open: "builds",
        steps: [{ press: "Escape" }],
        part: ".pane.shown .landing section[aria-label='Browse by kind']",
        marks: [{ at: ".pane.shown .landing section[aria-label='Browse by kind'] ul.kinds > li:first-child button", is: "n", n: 1, from: "corner" }],
      },
    },
    {
      title: "Three tiers, and what to show",
      lines: [
        "New player, Intermediate, Veteran: builds by what they take, and how many are ready.",
        "Paste a build from anywhere, or a Nox's Frame build code.",
        "Hide older than: other people's builds older than this many days. 0 hides none.",
        "Tags: pick some to keep only the builds that carry them all, in every tier.",
      ],
      shot: {
        open: "builds",
        steps: PICK,
        part: `.pane.shown .hero.helped .tiers, ${holder("builds.tier-bar")}, .pane.shown .tagbar`,
        marks: [
          { at: ".pane.shown .hero.helped .tiers > button:first-child", is: "n", n: 1, from: "corner" },
          { at: `${holder("builds.tier-bar")} button.stamp`, is: "n", n: 2, from: "corner" },
          { at: `${holder("builds.tier-bar")} label.age`, is: "n", n: 3, from: "corner" },
          { at: ".pane.shown .tagbar", is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Each build, and what's missing",
      lines: [
        "As in the Arsenal: each mod's drain, the Forma, arcanes and shards.",
        "Its tier and capacity: what the mods drain against what it holds.",
        "What you're missing, and the Endo to rank it. Find seller: the cheapest in game.",
        "★ puts it first in its tier; Edit a copy changes it, saved as yours.",
      ],
      shot: {
        open: "builds",
        steps: PICK,
        // The slot grid, the tier and what's missing; the loadout under them is left out.
        part: `${BUILD} header.hd, ${BUILD} .gridcol, ${BUILD} section.tier, ${BUILD} section.miss`,
        marks: [
          { at: `${BUILD} .gridcol`, is: "n", n: 1, from: "corner" },
          { at: `${BUILD} section.tier`, is: "n", n: 2, from: "corner" },
          { at: `${BUILD} section.miss`, is: "n", n: 3, from: "corner" },
          { at: `${BUILD} header.hd .acts`, is: "n", n: 4, from: "corner" },
        ],
        size: [1280, 1000],
      },
    },
    {
      title: "Builds on other sites",
      lines: [
        "Popular on Overframe: up to 5 of its most voted builds, from MyOrbiter's own copy.",
        "Each opens on overframe.gg in your browser: MyOrbiter shows the list, never the build.",
        "Saved from Overframe: the Overframe links you kept, as links only.",
        "On Nox's Frame: its most voted builds; Open shows one here, with what you're missing.",
      ],
      shot: {
        open: "builds",
        steps: PICK,
        part: ".pane.shown section.ofl",
        marks: [],
      },
    },
  ],
  good: { text: "MyOrbiter never contacts Overframe. Nox's Frame is read only when you open an item or one of its builds; turn it off in Settings, Builds." },
  covers: {
    "builds.arsenal": 1,
    "builds.most-built": 1,
    "builds.also-built": 1,
    "builds.browse-kinds": 2,
    "builds.recent": 2,
    "builds.tier-bar": 3,
    "builds.tags": 3,
    "builds.saved-links": 5,
  },
};

const BUILD_EDIT: Walkthrough = {
  id: "build-edit",
  app: "builds",
  title: "Paste or edit a build",
  guide: guideOf("builds"),
  pages: [
    {
      title: "Paste a build from anywhere",
      lines: [
        "Paste mod and arcane names from anywhere, or a Nox's Frame build code.",
        "Title, author and link are optional; MyOrbiter never reads the link.",
        "What it read; a name it couldn't match comes with suggestions to pick.",
        "Save build keeps it with the item's builds, in the tier it fits.",
      ],
      shot: {
        open: "builds",
        steps: [
          ...PICK,
          { click: ".pane.shown .bar button.stamp:has-text('Paste a build')" },
          { wait: 800 },
          { fill: `${PASTE} textarea`, text: "Aura: Corrosive Projection\nVitality, Steel Fiber, Primed Continuity\nArcanes: Energize, Grace" },
          { wait: 1500 },
        ],
        part: PASTE,
        marks: [
          { at: `${PASTE} textarea`, is: "n", n: 1, from: "corner" },
          { at: `${PASTE} .row3`, is: "n", n: 2, from: "corner" },
          { at: `${PASTE} .found`, is: "n", n: 3, from: "corner" },
          { at: `${PASTE} .row.end button.gold`, is: "n", n: 4, from: "corner" },
        ],
        size: [1280, 1000],
      },
    },
    {
      title: "Make one, or edit a copy",
      lines: [
        "Each slot: a mod or arcane name, and the rank you want; empty means max.",
        "Tags: pick what it's for, or type your own.",
        "The build as it would be, and the tier it lands in.",
        "Save as mine keeps it as your own; names it can't match must be fixed first.",
      ],
      shot: {
        open: "builds",
        steps: [...PICK, { click: `${BUILD} .acts button:has-text('Edit a copy')` }, { wait: 1000 }],
        part: EDITOR,
        marks: [
          { at: `${EDITOR} .slotrow`, is: "n", n: 1, from: "corner" },
          { at: `${EDITOR} .tagpick`, is: "n", n: 2, from: "corner" },
          { at: `${EDITOR} .pv`, is: "n", n: 3, from: "corner" },
          { at: `${EDITOR} .row.end button.gold`, is: "n", n: 4, from: "corner" },
        ],
        size: [1280, 1000],
      },
    },
  ],
  good: { text: "Nothing is kept until you press Save; Cancel or Esc leaves your builds as they were. New build opens the same editor, empty." },
  covers: { "builds.paste": 1, "builds.editor": 2 },
};

const WISHLIST: Walkthrough = {
  id: "wishlist",
  app: "wishlist",
  title: "Wishlist",
  guide: guideOf("wishlist"),
  pages: [
    {
      title: "Star what you're after",
      lines: ["Type a warframe, weapon or companion, pick it from the list, then + or Enter.", "Or star it (☆) on Foundry, on Mastery, or in its details."],
      shot: {
        open: "wishlist",
        part: holder("wishlist.add"),
        marks: [{ at: `${holder("wishlist.add")} > input`, is: "n", n: 1, from: "corner" }],
      },
    },
    {
      title: "Your Codex, and your stars",
      lines: [
        "Each ring: what you've mastered of a category; ★, how many you starred.",
        "Under them: what's ready to build, or closest to it.",
        "The band: what you starred, the parts still missing, and how many eras to crack now.",
        "Click a ring for what you starred in it, or to pick some on Foundry.",
      ],
      shot: {
        open: "wishlist",
        part: ".pane.shown .hero.helped, .pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown .hero.helped .rings > button.ring:nth-child(2)", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .hero.helped p.next", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.band.helped", is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Each missing part's way in",
      lines: [
        "Each thing you star: its missing parts, and the relics you hold for each.",
        "Crack now, above the cards: eras with a fissure open now for those relics.",
        "Else where to farm it, its price, and Buy order to open the buy form.",
        "Gold %: the chance your relics finish it, cracking each once.",
      ],
      shot: {
        open: "wishlist",
        // Crack now shows only while a fissure of a matching era is open.
        part: ".pane.shown section.now, .pane.shown article.wish:not(.ghost)",
        marks: [],
        size: [1280, 1000],
      },
    },
  ],
  good: { text: "Buy order only opens the buy form, for the copies you still need; nothing is posted until you press Post buy order." },
  covers: { "wishlist.add": 1, "wishlist.codex": 2, "wishlist.band": 2, "wishlist.crack-now": 3 },
};

export const PROGRESS: Walkthrough[] = [MASTERY, FOUNDRY, BUILDS, BUILD_EDIT, WISHLIST];
