// Every kind of notification orbiter sends, in the order the Notifications panel lists them: what
// it's for, the page it opens, and whether it needs the game read on a PC. The switches in the
// panel, the history and the pop-ups all go by this list.
import type { GameIconName } from "./ui/GameIcon.svelte";
import type { NotifySettings } from "./backend";

export type NoticeKind = keyof NotifySettings;

export type NoticeGroup = "Trading" | "World" | "Fissures" | "Your account";

export interface NoticeKindInfo {
  kind: NoticeKind;
  group: NoticeGroup;
  label: string;
  /** When it fires, in a sentence. */
  hint: string;
  /** The same on a console, where it differs. */
  consoleHint?: string;
  icon: GameIconName;
  /** The page a click opens, and on Home the card ("home#baro"). */
  to: string;
  /** Needs your inventory or the game log, which only a PC has. */
  pcOnly: boolean;
}

export const NOTICE_KINDS: NoticeKindInfo[] = [
  { kind: "sold", group: "Trading", label: "Something sold", hint: "A trade in game sold one of your listings: orbiter marked it sold on warframe.market and logged the platinum.", icon: "platinum", to: "sales", pcOnly: true },
  { kind: "setDone", group: "Trading", label: "A set you saved for is complete", hint: "The parts your loose ones were waiting for came in: the whole set is in your inventory, ready to sell (Sets → Sets you can sell).", icon: "foundry", to: "sets", pcOnly: true },
  { kind: "repriced", group: "Trading", label: "Listings repriced", hint: "Apply automatically moved some of your listings to the cheapest price in game: which, from what, to what.", icon: "market", to: "market", pcOnly: false },
  { kind: "market", group: "Trading", label: "Listing problems", hint: "A listing for more than you now hold, warframe.market refusing a change or not answering, or your sign-in expiring.", consoleHint: "warframe.market refusing a change or not answering, or your sign-in expiring.", icon: "market", to: "market", pcOnly: false },
  { kind: "siteChat", group: "Trading", label: "Messages on warframe.market", hint: "A buyer writes to you on the website's chat rather than whispering in game (read each minute while you're signed in).", icon: "market", to: "market", pcOnly: false },
  { kind: "whispers", group: "Trading", label: "Someone whispers you", hint: "A private chat opens in game: usually a buyer from warframe.market. Their name and reputation.", icon: "market", to: "market", pcOnly: true },
  { kind: "deals", group: "Trading", label: "Cheap parts and arcanes", hint: "Someone lists a part you're missing, or an arcane you're collecting, well under its usual price.", icon: "platinum", to: "home#deals", pcOnly: true },
  { kind: "cycle", group: "Trading", label: "Riven cycles", hint: "You cycled a riven and TennoScope read the new roll before you chose: which to keep, the one it has or the new one.", icon: "riven", to: "rivens", pcOnly: true },
  { kind: "rivens", group: "Trading", label: "Rivens you watch for", hint: "A riven matching one of your riven alerts is listed at or under your price (checked every 5 minutes).", icon: "riven", to: "rivens", pcOnly: false },

  { kind: "invasions", group: "World", label: "Invasions with a part you need", hint: "An invasion rewards a blueprint or part for something you haven't mastered or built, and you don't have enough of it. Says which side to take.", icon: "invasion", to: "home#alerts", pcOnly: true },
  { kind: "alerts", group: "World", label: "Alerts with something to master", hint: "An alert rewards a weapon, warframe or companion you haven't mastered, or a blueprint or part toward one.", icon: "mastery", to: "home#alerts", pcOnly: true },
  { kind: "alertLoot", group: "World", label: "Alerts with rare rewards", hint: "An alert rewards an Orokin Catalyst or Reactor, Forma, an Exilus Adapter or Nitain: things you otherwise buy or grind for.", icon: "sortie", to: "home#alerts", pcOnly: false },
  { kind: "baro", group: "World", label: "Baro arrives", hint: "Baro Ki'Teer arrives with gear you haven't mastered or mods you don't have: what, and how many ducats you hold.", consoleHint: "Baro Ki'Teer arrives: where, and until when.", icon: "baro", to: "home#baro", pcOnly: false },
  { kind: "varzia", group: "World", label: "Varzia's new rotation", hint: "Prime Resurgence changes and brings primes you haven't mastered or can't build yet.", icon: "varzia", to: "home#varzia", pcOnly: true },
  { kind: "circuit", group: "World", label: "Duviri Circuit picks", hint: "The weekly Circuit offers warframes you haven't mastered, or an Incarnon adapter for a weapon you have.", icon: "mastery", to: "home#today", pcOnly: true },

  { kind: "fissures", group: "Fissures", label: "Fissures you watch for", hint: "A fissure opens that matches one of your fissure alerts (set them on Home, under Fissures now).", icon: "void-tear", to: "home#fissures", pcOnly: false },
  { kind: "wishlist", group: "Fissures", label: "Fissures for your wishlist", hint: "An era that had no fissure open gets one, and you hold relics of it for something on your wishlist.", icon: "void-tear", to: "wishlist", pcOnly: true },
  { kind: "reward", group: "Fissures", label: "Which reward to take", hint: "When the reward screen opens: the card with the best score, and why. Sent even while you're in a fissure.", icon: "void-tear", to: "mission", pcOnly: true },

  { kind: "foundry", group: "Your account", label: "Foundry builds ready", hint: "Something you're building is ready to claim, with the mastery it gives if you haven't mastered it.", icon: "foundry", to: "home#foundry", pcOnly: true },
  { kind: "tennoscope", group: "Your account", label: "TennoScope trouble", hint: "It couldn't be started, or something orbiter asked of it failed.", icon: "dojo", to: "home", pcOnly: true },
];

export const noticeKind = Object.fromEntries(NOTICE_KINDS.map((k) => [k.kind, k])) as Record<NoticeKind, NoticeKindInfo>;

/** The kinds that apply where you play: on a console, only the ones that don't need the game read. */
export const kindsFor = (console: boolean) => NOTICE_KINDS.filter((k) => !console || !k.pcOnly);

/** What each group is about, on a PC and on a console. */
export const GROUP_NOTE: Record<NoticeGroup, { pc: string; console: string }> = {
  Trading: { pc: "Sales, your listings, buyers and bargains.", console: "Your listings, buyers and rivens." },
  World: { pc: "Chances at mastery you're missing and rare rewards, from the world as it is right now.", console: "Rare rewards and Baro, from the world as it is right now." },
  Fissures: { pc: "Fissures, relics and the reward screen.", console: "Fissures you watch for." },
  "Your account": { pc: "Your Foundry, and TennoScope reading your account.", console: "" },
};

/** "home#baro" → { page: "home", card: "baro" }. */
export function splitTarget(to: string): { page: string; card: string | null } {
  const [page, card] = to.split("#");
  return { page, card: card ?? null };
}

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
/**
 * The history with notice `id` changed to say `n` and moved to the top, unread: a notification that
 * grows while something runs (a repricing pass). Logged as new if it's no longer in the history.
 */
export function growNotice(log: Notice[], id: string | null, n: Omit<Notice, "id" | "read">): Notice[] {
  const old = id ? log.find((x) => x.id === id) : undefined;
  if (!old) return logNotice(log, n);
  return [{ ...old, ...n, read: false }, ...log.filter((x) => x.id !== id)];
}

export function logNotice(log: Notice[], n: Omit<Notice, "id" | "read">): Notice[] {
  const notice: Notice = { ...n, id: `${n.at}-${Math.random().toString(36).slice(2, 8)}`, read: false };
  return [notice, ...log].slice(0, NOTICE_LOG);
}
