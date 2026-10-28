// Every kind of notification orbiter sends, in the order the Notifications panel lists them: what
// it's for, the page it opens, and whether it needs the game read on a PC. The switches in the
// panel, the history and the pop-ups all go by this list.
import type { GameIconName } from "./ui/GameIcon.svelte";
import type { NotifySettings } from "./backend";

export type NoticeKind = keyof NotifySettings;

export interface NoticeKindInfo {
  kind: NoticeKind;
  group: "Trading" | "Mastery" | "Fissures" | "orbiter";
  label: string;
  /** When it fires, in a sentence. */
  hint: string;
  icon: GameIconName;
  /** The page a click opens. */
  to: string;
  /** Needs your inventory or the game log, which only a PC has. */
  pcOnly: boolean;
}

export const NOTICE_KINDS: NoticeKindInfo[] = [
  { kind: "market", group: "Trading", label: "Your listings", hint: "Auto-match repriced listings, something sold, a listing for more than you now hold, or something went wrong on warframe.market.", icon: "market", to: "market", pcOnly: false },
  { kind: "siteChat", group: "Trading", label: "Messages on warframe.market", hint: "A buyer writes to you on the website's chat rather than whispering in game (read each minute while you're signed in).", icon: "market", to: "market", pcOnly: false },
  { kind: "whispers", group: "Trading", label: "Someone whispers you", hint: "A private chat opens in game: usually a buyer from warframe.market. Their name and reputation.", icon: "market", to: "market", pcOnly: true },
  { kind: "deals", group: "Trading", label: "Cheap parts and arcanes", hint: "Someone lists a part you're missing, or an arcane you're collecting, well under its usual price.", icon: "platinum", to: "home", pcOnly: true },
  { kind: "rivens", group: "Trading", label: "Rivens you watch for", hint: "A riven matching one of your riven alerts is listed at or under your price (checked every 15 minutes).", icon: "riven", to: "rivens", pcOnly: false },

  { kind: "invasions", group: "Mastery", label: "Invasions with a part you need", hint: "An invasion rewards a blueprint or part for something you haven't mastered or built, and you don't have enough of it. Says which side to take.", icon: "invasion", to: "home", pcOnly: true },
  { kind: "alerts", group: "Mastery", label: "Alerts with something to master", hint: "An alert rewards a weapon, warframe or companion you haven't mastered, or a blueprint or part toward one.", icon: "mastery", to: "home", pcOnly: true },
  { kind: "alertLoot", group: "Mastery", label: "Alerts with rare rewards", hint: "An alert rewards an Orokin Catalyst or Reactor, Forma, an Exilus Adapter or Nitain: things you otherwise buy or grind for.", icon: "sortie", to: "home", pcOnly: false },
  { kind: "baro", group: "Mastery", label: "Baro brings something new", hint: "Baro Ki'Teer arrives with gear you haven't mastered or mods you don't have, and how many ducats you hold.", icon: "baro", to: "home", pcOnly: true },
  { kind: "varzia", group: "Mastery", label: "Varzia's new rotation", hint: "Prime Resurgence changes and brings primes you haven't mastered or can't build yet.", icon: "varzia", to: "home", pcOnly: true },
  { kind: "circuit", group: "Mastery", label: "Duviri Circuit picks", hint: "The weekly Circuit offers warframes you haven't mastered, or an Incarnon adapter for a weapon you have.", icon: "mastery", to: "home", pcOnly: true },
  { kind: "foundry", group: "Mastery", label: "Foundry builds ready", hint: "Something you're building is ready to claim, with the mastery it gives if you haven't mastered it.", icon: "foundry", to: "foundry", pcOnly: true },

  { kind: "fissures", group: "Fissures", label: "Fissures you watch for", hint: "A fissure opens that matches one of your fissure alerts (set them on Home, under Fissures now).", icon: "void-tear", to: "home", pcOnly: false },
  { kind: "wishlist", group: "Fissures", label: "Fissures for your wishlist", hint: "An era that had no fissure open gets one, and you hold relics of it for something on your wishlist.", icon: "void-tear", to: "wishlist", pcOnly: true },
  { kind: "reward", group: "Fissures", label: "Which reward to take", hint: "When the reward screen opens: the card with the best score, and why.", icon: "void-tear", to: "mission", pcOnly: true },

  { kind: "tennoscope", group: "orbiter", label: "TennoScope trouble", hint: "It couldn't be started, or something orbiter asked of it failed.", icon: "dojo", to: "home", pcOnly: true },
];

export const noticeKind = Object.fromEntries(NOTICE_KINDS.map((k) => [k.kind, k])) as Record<NoticeKind, NoticeKindInfo>;

/** The kinds that apply where you play: on a console, only the ones that don't need the game read. */
export const kindsFor = (console: boolean) => NOTICE_KINDS.filter((k) => !console || !k.pcOnly);

/** One notification, as kept in the history. */
export interface Notice {
  id: string;
  at: number;
  kind: NoticeKind;
  title: string;
  body: string;
  /** The page it opens, when not the kind's own. */
  to?: string;
  read: boolean;
}

/** How long the history is. */
export const NOTICE_LOG = 100;

/** Adds a notice to the front of the history, keeping it to NOTICE_LOG. */
export function logNotice(log: Notice[], n: Omit<Notice, "id" | "read">): Notice[] {
  const notice: Notice = { ...n, id: `${n.at}-${Math.random().toString(36).slice(2, 8)}`, read: false };
  return [notice, ...log].slice(0, NOTICE_LOG);
}
