// The Fissures section's walk-throughs: Current fissure, Relics and Planner.

import type { Walkthrough } from "./types";
import { guideOf } from "./pending";

const holder = (part: string) => `.pane.shown :has(> [data-help="${part}"])`;

const MISSION: Walkthrough = {
  id: "mission",
  app: "mission",
  title: "Current fissure",
  guide: guideOf("mission"),
  pages: [
    {
      title: "Which reward to take",
      lines: [
        "The one to take glows, marked Take this.",
        "Each card: its plat and ducats, and marks for gear you need and sets it completes.",
        "Copy for squad chat puts the four cards and their prices on your clipboard.",
      ],
      shot: {
        open: "mission",
        part: ".pane.shown section.screen",
        marks: [
          { at: ".pane.shown section.screen article.rc.best", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.screen article.rc:first-child", is: "n", n: 2, from: "corner" },
          { at: ".pane.shown section.screen .screen-foot .cb", is: "n", n: 3, from: "corner" },
        ],
      },
    },
    {
      title: "Everything the relics can drop",
      lines: ["Every reward the squad's relics can drop: how many you hold, its plat and ducats.", "Need marks a part for gear you haven't built yet."],
      shot: {
        open: "mission",
        part: ".pane.shown .pool-head, .pane.shown table.pool:not(.history) thead, .pane.shown table.pool:not(.history) tbody tr:nth-child(-n+3)",
        marks: [{ at: ".pane.shown table.pool:not(.history) tbody tr:first-child", is: "outline" }],
      },
    },
    {
      title: "The squad's relics",
      lines: ["The relics the squad brought, as the mission loads.", "With four, whether they're a 4×4: one relic at one refinement, or which ones are off."],
      shot: {
        open: "mission",
        steps: [{ click: ".pane.shown h2.relhead button" }],
        // The heading and the first two relics: the rest are more of the same.
        part: ".pane.shown h2.relhead, .pane.shown h2.relhead + .reveal section.cards > :nth-child(-n+2)",
        marks: [{ at: ".pane.shown h2.relhead + .reveal section.cards > :first-child", is: "outline" }],
      },
    },
    {
      title: "This session",
      lines: ["The missions so far, and what their rewards come to in platinum and ducats.", "How many went toward gear you haven't built, and your Void Traces against the cap."],
      shot: {
        open: "mission",
        part: `${holder("mission.session")}, .pane.shown p.sum, .pane.shown table.pool.history thead, .pane.shown table.pool.history tbody tr:nth-child(-n+2)`,
        marks: [{ at: ".pane.shown p.sum", is: "outline" }],
      },
    },
  ],
  good: { text: "Each card is scored; how much plat, unmastered gear, ducats and sets count is yours to set in Settings, Fissures." },
  covers: { "mission.screen": 1, "mission.band": 1, "mission.empty": 1, "mission.pool": 2, "mission.relics": 3, "mission.session": 4 },
};

const RELICS: Walkthrough = {
  id: "relics",
  app: "relics",
  title: "Relics",
  guide: guideOf("relics"),
  pages: [
    {
      title: "Your relics, era by era",
      lines: [
        "Each era: relics you hold and how many are radiant. Click one to show only those.",
        "Void Traces against the cap, 100 + 50 a Mastery Rank, and the Radiants they make.",
      ],
      shot: {
        open: "relics",
        part: ".pane.shown .hero.helped, .pane.shown section.band.helped",
        marks: [
          { at: ".pane.shown section.plate button.era:first-child", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown section.plate .meter", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Eras with fissures open",
      lines: ["Click an era to see what you can crack in its fissures right now.", "Each says how many fissures of that era are open."],
      shot: {
        open: "relics",
        part: ".pane.shown .era-head, .pane.shown .era-head + *",
        marks: [{ at: ".pane.shown .era-head + * > :nth-child(2)", is: "outline" }],
      },
    },
    {
      title: "Filter, solo or radshare",
      lines: ["Show: all, vaulted, farmable, or the ones Varzia sells.", "Squad: solo or radshare, one setting shared with the Planner and Home."],
      shot: {
        open: "relics",
        part: holder("relics.filters"),
        marks: [
          { at: `${holder("relics.filters")} [role=radiogroup]:nth-of-type(1)`, is: "n", n: 1, from: "corner" },
          { at: `${holder("relics.filters")} [role=radiogroup][aria-label='Squad']`, is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "What one crack is worth",
      lines: [
        "Intact and Radiant: the average plat one crack brings.",
        "Each reward counts at its price, or its ducats at your rate when that's more.",
        "A relic with an unpriced Prime part shows none.",
      ],
      shot: {
        open: "relics",
        part: ".pane.shown article.card:first-of-type",
        marks: [],
      },
    },
  ],
  covers: { "relics.plate": 1, "relics.band": 1, "relics.eras": 2, "relics.filters": 3, "relics.list": 4, "relics.sheet": 4, "relics.unknown": 4 },
};

const PLANNER: Walkthrough = {
  id: "planner",
  app: "planner",
  title: "Planner",
  guide: guideOf("planner"),
  pages: [
    {
      title: "Complete sets or make radiant",
      lines: ["Sets close to done, the ones a part away, and the relics that help.", "Complete sets, or Make radiant: where your Void Traces gain the most."],
      shot: {
        open: "planner",
        part: ".pane.shown section.band.helped, .pane.shown .modes",
        marks: [
          { at: ".pane.shown section.band.helped", is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .modes", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "Which relics to crack",
      lines: ["Pick how far from done a set may be.", "Sets / crack: a crack's worth toward finishing sets, not the Relics page's plat."],
      shot: {
        open: "planner",
        part: `${holder("planner.filters")}, .pane.shown .view.swap:not(.off) table thead, .pane.shown .view.swap:not(.off) table tbody tr:nth-child(-n+2)`,
        marks: [
          { at: `${holder("planner.filters")} select`, is: "n", n: 1, from: "corner" },
          { at: ".pane.shown .view.swap:not(.off) table thead th:nth-child(5)", is: "n", n: 2, from: "corner" },
        ],
      },
    },
    {
      title: "One part away",
      lines: ["One part from a complete set, and a relic you hold drops it.", "Further down: close, but none of your relics drop the missing part."],
      shot: {
        open: "planner",
        part: `${holder("planner.last")}, ${holder("planner.last")} + *`,
        marks: [{ at: `${holder("planner.last")} + *`, is: "outline" }],
      },
    },
  ],
  covers: { "planner.plate": 1, "planner.band": 1, "planner.modes": 1, "planner.filters": 2, "planner.last": 3, "planner.uncovered": 3 },
};

export const FISSURES: Walkthrough[] = [MISSION, RELICS, PLANNER];
