// The shared panels' walk-throughs: Settings (in three: the panel itself, TennoScope and the game,
// trades), Notifications and TennoScope. The panels slide over the right side of the window
// (ui/Sheet.svelte), outside every page, so their selectors start from the panel (its aria-label)
// rather than `.pane.shown`. Every sentence about repricing is checked against the code that does it
// (core/drift.ts, core/approved.ts, core/market.ts, marketStore.svelte.ts), not the panel's text
// alone. The pictures' steps never press a switch, Check now, a test notification, Report a bug or
// anything TennoScope runs; they only open the panels, switch Notifications to Choose, and pick
// Stable in the demo's empty channels (core/standIn.ts) for the picture of a channel with no build.

import type { Walkthrough } from "./types";
import { guideCard } from "./guide";
import { AUTO_FLOOR_SHARE } from "../core/approved";

/** Every picture here at one size: the panels run the window's full height, and a taller window keeps a section whole. */
const SIZE: [number, number] = [1280, 1080];

const S = `.sheet[aria-label="Settings"]`;
/** A Settings section, by its "?". */
const sec = (part: string) => `${S} section:has([data-help="${part}"])`;
const TRADES = `${S} #settings-trades`;
/** A switch or a field, by its own name (ui/Switch.svelte's `name`, a field's `data-field`), never by where it sits. */
const sw = (name: string) => `[data-switch="${name}"]`;
const field = (name: string) => `[data-field="${name}"]`;
const UPDATES = `${S} #settings-updates`;
const LOGS = `${S} #settings-logs`;
const REPORT = `${S} #settings-report`;

const N = `.sheet[aria-label="Notifications"]`;
const BELL = { click: ".rail .foot button.bell" };
const CHOOSE = { click: `${N} .top button[role=radio]:has-text('Choose')` };
/** The first group of kinds under Choose. */
const GROUP = `${N} section.how + section.grp`;

const T = `.sheet[aria-label="TennoScope"]`;
/** TennoScope's panel opens from its button in the full sidebar's foot. */
const TSBTN = { click: ".rail .foot [data-item='TennoScope']" };
const tsSec = (part: string) => `${T} section:has([data-help="${part}"])`;

const SETTINGS_MAIN: Walkthrough = {
  id: "settings",
  app: "shared",
  title: "Settings",
  guide: "guide",
  pages: [
    {
      title: "Where you play",
      lines: [
        "Where you play: the warframe.market MyOrbiter reads and lists on; signing in sets it.",
        "Prices count other platforms' sellers when you both have cross-play on; Switch only its own.",
        "On a console MyOrbiter can't read your game: everything built on your inventory is PC only.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${S} > header, ${sec("settings.platform")}`,
        marks: [{ at: `${sec("settings.platform")} ${field("settings.platform")} select`, is: "n", n: 1, from: "corner" }],
      },
    },
    {
      title: "Your pages, in your order",
      lines: [
        "Open on: the page MyOrbiter starts on, or the one you left it on.",
        "Show details: the sentence under every figure and every table column.",
        "Untick a page to take it out of the sidebar; links to it still work.",
        "The arrows move a page, or its whole section; Ctrl+1…9 follow this order.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        // The head, the two settings, the hint and the first section of pages: the rest are more of the same.
        part: `${sec("settings.pages")} > :is(.hmark, h3, ${field("settings.start-page")}, ${sw("settings.details")}, p.hint), ${sec("settings.pages")} > p.hint + div.sec`,
        marks: [
          { at: `${sec("settings.pages")} ${field("settings.start-page")} select`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.pages")} ${sw("settings.details")}`, is: "n", n: 2, from: "corner" },
          { at: `${sec("settings.pages")} > p.hint + div.sec li:first-child button.chip`, is: "n", n: 3, from: "corner" },
          { at: `${sec("settings.pages")} > p.hint + div.sec li:first-child button.mv.down`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Builds and notifications",
      lines: [
        "Read builds from Nox's Frame: an item's top-voted builds, read when you open its builds.",
        "Open notifications: the envelope's panel, a switch for each kind and a pause.",
        "Nothing is read in the background; each page is kept a week, read 3 seconds apart.",
        "Nox's Frame off: Builds lists none; its link still opens the site.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${sec("settings.builds")}, ${sec("settings.notifications")}`,
        marks: [
          { at: `${sec("settings.builds")} ${sw("settings.builds-from-nox")}`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.notifications")} button.stamp`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Updates, on your channel",
      lines: [
        "Channel: Stable is tested, Beta the next Stable early, Experimental every change and may break.",
        "Check now looks at once; MyOrbiter also looks at start and every 6 hours.",
        "An empty channel says so, and offers the nearest one with a build.",
        "Release notes opens this build's page. Nothing installs or switches without your click.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        // Pictured with the demo's channels as a new channel has them (core/standIn.ts): Stable
        // and Beta empty, Experimental with this build.
        emptyChannel: true,
        steps: [{ click: `${UPDATES} > .seg-wrap .seg button[role=radio]:has-text('Stable')` }, { wait: 2500 }],
        // From the channel down: the line above it says only what a development build can't do.
        part: `${UPDATES} > .seg-wrap, ${UPDATES} > .seg-wrap + p.hint, ${UPDATES} > div.row, ${UPDATES} ${field("settings.updates-empty")}`,
        marks: [
          { at: `${UPDATES} > .seg-wrap .seg`, is: "n", n: 1, from: "corner" },
          { at: `${UPDATES} > div.row button.pb`, is: "n", n: 2, from: "corner" },
          { at: `${UPDATES} ${field("settings.updates-switch")}`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Logs, and reporting a bug",
      lines: [
        "MyOrbiter's log: what it did and what went wrong, never your warframe.market sign-in.",
        "TennoScope keeps its own; send both when you report a problem.",
        "Report a bug: say what happened; Open on GitHub copies it and opens the issue form.",
        "Or Copy report, to send it another way.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${LOGS}, ${REPORT}`,
        marks: [
          { at: `${LOGS} .row > .pbw:first-child button.pb`, is: "n", n: 1, from: "corner" },
          { at: `${LOGS} .row > .pbw:nth-child(2) button.pb`, is: "n", n: 2, from: "corner" },
          { at: `${REPORT} button.stamp`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
  ],
  good: { text: "MyOrbiter never sends a report itself: nothing is posted until you press Submit new issue on GitHub." },
  covers: {
    settings: 1,
    "settings.platform": 1,
    "settings.pages": 2,
    "settings.builds": 3,
    "settings.notifications": 3,
    "settings.updates": 4,
    "settings.logs": 5,
    "settings.report-bug": 5,
  },
};

const SETTINGS_GAME: Walkthrough = {
  id: "settings-game",
  app: "shared",
  title: "Settings: TennoScope and the game",
  guide: "guide",
  pages: [
    {
      title: "Starting TennoScope",
      lines: [
        "Start TennoScope with MyOrbiter: in the background, closed again when you close MyOrbiter.",
        "Read my inventory (Full mode): reads Warframe's memory, at your own risk; off to start.",
        "Program: MyOrbiter finds it, or Choose picks one in your system's file picker.",
        "Choose only a TennoScope you built or downloaded yourself: it runs at each start.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: sec("settings.tennoscope"),
        marks: [
          { at: `${sec("settings.tennoscope")} ${sw("settings.tennoscope-launch")}`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.tennoscope")} ${sw("settings.full-mode")}`, is: "n", n: 2, from: "corner" },
          { at: `${sec("settings.tennoscope")} > div.field`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Where things are",
      lines: [
        "TennoScope's data folder: read only; empty uses TennoScope's default.",
        "Warframe's EE.log: read only, never written; empty finds it by itself.",
        "A changed path waits for Apply and reload: everything reloads with it.",
        "Every other setting saves as you change it.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: sec("settings.where-things-are"),
        marks: [
          { at: `${sec("settings.where-things-are")} ${field("settings.data-dir")} input`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.where-things-are")} ${field("settings.ee-log")} input`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "How the pick is scored",
      lines: [
        "Show Current fissure when the reward screen opens: MyOrbiter switches there by itself.",
        "Each slider: how much that counts in the score; 0 leaves it out.",
        "Forma blueprint: no market price, so it counts as this much plat; 2X counts double.",
        "The usual: plat 8, unmastered 4, ducats 2, completes a set 1; Forma 3p.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: sec("settings.fissures"),
        marks: [
          { at: `${sec("settings.fissures")} ${sw("settings.jump-to-pick")}`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.fissures")} .sliders > label.slider:first-child`, is: "n", n: 2, from: "corner" },
          { at: `${sec("settings.fissures")} .sliders > label.forma`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "What draws over the game",
      lines: [
        "Fissure reward screen: under each card, its worth and whether to take it.",
        "The chips pick what cards show: mastered, vaulted, set parts, plat, ducats, MyOrbiter's pick.",
        "Cycling a riven: both rolls graded side by side, and which to keep.",
        "Baro's Ducat Kiosk: each Prime part's plat, or how many more you need.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: sec("settings.overlays"),
        marks: [
          { at: `${sec("settings.overlays")} ${sw("settings.overlay-reward")}`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.overlays")} > .shows`, is: "n", n: 2, from: "corner" },
          { at: `${sec("settings.overlays")} ${sw("settings.overlay-riven")}`, is: "n", n: 3, from: "corner" },
          { at: `${sec("settings.overlays")} ${sw("settings.overlay-kiosk")}`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
  ],
  covers: { "settings.tennoscope": 1, "settings.where-things-are": 2, "settings.fissures": 3, "settings.overlays": 4 },
};

const SETTINGS_TRADES: Walkthrough = {
  id: "settings-trades",
  app: "shared",
  title: "Settings: trades",
  guide: "guide",
  pages: [
    {
      title: "After a trade",
      lines: [
        "+rep message: what goes with +rep on a trade partner's warframe.market profile.",
        "Give +rep by itself (off to start): each trade partner gets it once, posted as you.",
        "Mark sales sold from the game (off to start): marks the listing sold, logs the sale.",
        "With +rep by itself off, a +rep button shows after a trade instead.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${TRADES} ${field("settings.rep-text")}, ${TRADES} ${sw("settings.auto-rep")}, ${TRADES} ${sw("settings.auto-trades")}`,
        marks: [
          { at: `${TRADES} ${field("settings.rep-text")} input`, is: "n", n: 1, from: "corner" },
          { at: `${TRADES} ${sw("settings.auto-rep")}`, is: "n", n: 2, from: "corner" },
          { at: `${TRADES} ${sw("settings.auto-trades")}`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Last copies, and selling rules",
      lines: [
        "Hide last copies (off to start): any whisper hides each listing you have one copy of.",
        "Selling rules live on Sell spares: sets, veiled rivens, minimum prices.",
        "Back after 10 minutes (or your time) if a newer inventory read has it.",
        "A later whisper doesn't lengthen the wait; showing or hiding one ends its wait.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${TRADES} ${sw("settings.hide-last-copies")}, ${sec("settings.selling")}`,
        marks: [
          { at: `${TRADES} ${sw("settings.hide-last-copies")}`, is: "n", n: 1, from: "corner" },
          { at: `${sec("settings.selling")} button.link`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Checking prices on a timer",
      lines: [
        "Check my prices on a timer (off to start): reads them, sends nothing.",
        "How often is set on Orders: every minute up to once a week.",
        "The same switch as Check automatically on Orders.",
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${TRADES} > :is(.hmark, h3), ${TRADES} ${sw("settings.auto-check")}`,
        marks: [{ at: `${TRADES} ${sw("settings.auto-check")} .track`, is: "arrow", from: "left" }],
      },
    },
    {
      title: "Automatic repricing",
      lines: [
        "Change my prices by itself (off to start): also sends them; Apply automatically on Orders.",
        "It follows the second-cheapest seller online or in game, past a 2p and 5% gap.",
        "Once an hour at most, six a day per listing.",
        `Never under ${Math.round(AUTO_FLOOR_SHARE * 100)}% of the price you set or approved, nor your floors.`,
      ],
      shot: {
        open: "settings",
        size: SIZE,
        part: `${TRADES} ${sw("settings.auto-reprice")}`,
        marks: [{ at: `${TRADES} ${sw("settings.auto-reprice")} .track`, is: "arrow", from: "left" }],
      },
    },
  ],
  good: {
    warn: true,
    text: `Unattended, a price never goes under ${Math.round(AUTO_FLOOR_SHARE * 100)}% of the one you last set or approved in MyOrbiter, nor under your floors, and is never more than halved.`,
  },
  covers: { "settings.trades": 3, "settings.selling": 2 },
};

const NOTICES: Walkthrough = {
  id: "notices",
  app: "shared",
  title: "Notifications",
  guide: "guide",
  pages: [
    {
      title: "What MyOrbiter told you",
      lines: [
        "Recent: what MyOrbiter told you, newest first; click one to open what it's about.",
        "Choose: which kinds it tells you about, and a pause for all of them.",
        "The number on the envelope is how many are new.",
        "Once you've had Recent open, closing the panel marks them all read.",
      ],
      shot: {
        open: "home",
        size: SIZE,
        steps: [BELL, { wait: 1500 }],
        // The head and the view switch, then the first few entries (or the line saying there are none yet).
        part: `${N} > header, ${N} .top, ${N} p.empty, ${N} .days > .dayblock:first-child > h3, ${N} .days > .dayblock:first-child li:nth-child(-n+3)`,
        marks: [
          { at: `${N} .top .seg > button:nth-child(1)`, is: "n", n: 1, from: "corner" },
          { at: `${N} .top .seg > button:nth-child(2)`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "When they pop up",
      lines: [
        "Pause: nothing pops up for an hour, until 8 tomorrow, or until you turn it off.",
        "Pop-ups inside MyOrbiter: shown by the sidebar while you're looking at MyOrbiter.",
        "Desktop notifications: while MyOrbiter is behind other windows, or you're in the game.",
        "Quiet while I'm in a fissure: only which reward to take pops up then.",
      ],
      shot: {
        open: "home",
        size: SIZE,
        steps: [BELL, { wait: 1500 }, CHOOSE],
        part: `${N} section.how > .pause, ${N} section.how ${sw("notices.toasts")}, ${N} section.how ${sw("notices.desktop")}, ${N} section.how ${sw("notices.quiet-in-fissure")}`,
        marks: [
          { at: `${N} section.how .pausebtns`, is: "n", n: 1, from: "corner" },
          { at: `${N} section.how ${sw("notices.toasts")}`, is: "n", n: 2, from: "corner" },
          { at: `${N} section.how ${sw("notices.desktop")}`, is: "n", n: 3, from: "corner" },
          { at: `${N} section.how ${sw("notices.quiet-in-fissure")}`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
    {
      title: "Try it, or add Discord",
      lines: [
        "Send a test notification: one goes in 5 seconds, and it says what became of it.",
        "Discord: paste a channel's webhook address; the kinds you pick go there too, unless paused.",
        "Click away during the countdown to try your desktop's notification.",
        "MyOrbiter asks once, in its own window, before sending to a new address.",
      ],
      shot: {
        open: "home",
        size: SIZE,
        steps: [BELL, { wait: 1500 }, CHOOSE],
        part: `${N} section.how > .testrow, ${N} section.how > .discord`,
        marks: [
          { at: `${N} section.how .testrow button.stamp`, is: "n", n: 1, from: "corner" },
          { at: `${N} section.how .discord input`, is: "n", n: 2, from: "bottom" },
        ],
      },
    },
    {
      title: "Choose which kinds you get",
      lines: [
        "Kinds come in groups: Trading, World, Fissures, Your account.",
        "A switch for each kind: off, it's dropped, not even kept in Recent.",
        "Recent only: kept in Recent without popping up.",
        "All off or All on: a whole group at once.",
      ],
      shot: {
        open: "home",
        size: SIZE,
        steps: [BELL, { wait: 1500 }, CHOOSE],
        // The first group's head and its first three kinds; the marks are on its first, Something sold.
        part: `${GROUP} > header, ${GROUP} > div.kind:nth-of-type(-n+3)`,
        marks: [
          { at: `${GROUP} > header h3`, is: "n", n: 1, from: "corner" },
          { at: `${GROUP} ${sw("notices.kind.sold")}`, is: "n", n: 2, from: "corner" },
          { at: `${GROUP} > div.kind:has(> ${sw("notices.kind.sold")}) > .chip`, is: "n", n: 3, from: "corner" },
          { at: `${GROUP} > header button.link`, is: "n", n: 4, from: "corner" },
        ],
      },
    },
  ],
  good: { text: "Paused, quiet or Recent only, a notification still goes in Recent, so you can catch up." },
  covers: { notices: 1, "notices.how": 2, "notices.kinds": 4 },
};

const TENNOSCOPE: Walkthrough = {
  id: "tennoscope",
  app: "shared",
  title: "TennoScope",
  guide: guideCard("fullmode"),
  pages: [
    {
      title: "TennoScope beside MyOrbiter",
      lines: [
        "Whether it runs; one MyOrbiter started closes with MyOrbiter, one you started is left.",
        "Allow screen capture: your desktop asks once which screen TennoScope may read.",
        "Reward overlay: shows on a fissure's reward screen with two or more cards.",
        "An unpatched TennoScope can't talk to MyOrbiter: build MyOrbiter's own, then point Settings at it.",
      ],
      shot: {
        open: "home",
        size: SIZE,
        steps: [TSBTN, { wait: 2000 }],
        part: `${T} > header, ${T} section.state, ${tsSec("tennoscope.screen-capture")}, ${tsSec("tennoscope.reward-overlay")}`,
        marks: [
          { at: `${T} section.state .line`, is: "n", n: 1, from: "corner" },
          { at: `${tsSec("tennoscope.screen-capture")} button.pb`, is: "n", n: 2, from: "corner" },
          { at: `${tsSec("tennoscope.reward-overlay")} h3`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Inventory and health",
      lines: [
        "Last read: when TennoScope last read your inventory. Access: Full, Overlay or Companion.",
        "Sync inventory now: works with Full mode while Warframe is running.",
        "Health: each part TennoScope runs, from OK to Not working, with what it says.",
        "Full mode reads Warframe's memory for your inventory: your call, at your own risk.",
      ],
      shot: {
        open: "home",
        size: SIZE,
        steps: [TSBTN, { wait: 2000 }],
        part: `${tsSec("tennoscope.inventory")}, ${tsSec("tennoscope.health")}`,
        marks: [
          { at: `${tsSec("tennoscope.inventory")} .kv`, is: "n", n: 1, from: "corner" },
          { at: `${tsSec("tennoscope.inventory")} .row button.pb`, is: "n", n: 2, from: "corner" },
          { at: `${tsSec("tennoscope.health")} ul.health`, is: "n", n: 3, from: "corner" },
        ],
      },
    },
  ],
  covers: {
    tennoscope: 1,
    "tennoscope.unpatched": 1,
    "tennoscope.screen-capture": 1,
    "tennoscope.reward-overlay": 1,
    "tennoscope.inventory": 2,
    "tennoscope.health": 2,
  },
};

export const SETTINGS: Walkthrough[] = [SETTINGS_MAIN, SETTINGS_GAME, SETTINGS_TRADES, NOTICES, TENNOSCOPE];
