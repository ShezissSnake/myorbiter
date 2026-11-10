// Every kind of notification MyOrbiter sends, in the order the Notifications panel lists them: what
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
  { kind: "sold", group: "Trading", label: "Something sold", hint: "You sold something in a trade in game: what, to whom, for how much; with +rep for the buyer when you give it by hand.", icon: "platinum", to: "sales", pcOnly: true },
  { kind: "setDone", group: "Trading", label: "A set you saved for is complete", hint: "The parts your loose ones were waiting for came in: the whole set is in your inventory, ready to sell (Sets → Sets you can sell).", icon: "foundry", to: "sets", pcOnly: true },
  { kind: "repriced", group: "Trading", label: "Listings repriced", hint: "Apply automatically moved some of your listings to the market price: which, from what, to what.", icon: "market", to: "market", pcOnly: false },
  { kind: "market", group: "Trading", label: "Listing problems", hint: "A listing for more than you now hold, warframe.market refusing a change or not answering, or your sign-in expiring.", consoleHint: "warframe.market refusing a change or not answering, or your sign-in expiring.", icon: "market", to: "market", pcOnly: false },
  { kind: "siteChat", group: "Trading", label: "Messages on warframe.market", hint: "A buyer writes to you on the website's chat rather than whispering in game (read each minute while you're signed in).", icon: "market", to: "market", pcOnly: false },
  { kind: "whispers", group: "Trading", label: "Someone whispers you", hint: "A private chat opens in game: usually a buyer from warframe.market. Their name and reputation.", icon: "market", to: "market", pcOnly: true },
  { kind: "deals", group: "Trading", label: "Cheap parts and arcanes", hint: "Someone lists a part you're missing, or an arcane you're collecting, well under its usual price.", icon: "platinum", to: "home#deals", pcOnly: true },
  { kind: "cycle", group: "Trading", label: "Riven cycles", hint: "You cycled a riven and TennoScope read the new roll before you chose: which to keep, the one it has or the new one.", icon: "riven", to: "rivens", pcOnly: true },
  { kind: "rivens", group: "Trading", label: "Rivens you watch for", hint: "A riven matching one of your riven alerts is listed at or under your price (checked every 5 minutes).", icon: "riven", to: "rivens", pcOnly: false },

  { kind: "invasions", group: "World", label: "Invasions with a part you need", hint: "An invasion rewards a blueprint or part for something you haven't mastered or built, and you don't have enough of it. Says which side to take.", icon: "invasion", to: "home#alerts", pcOnly: true },
  { kind: "alerts", group: "World", label: "Alerts with something to master", hint: "An alert rewards a weapon, warframe or companion you haven't mastered, or a blueprint or part toward one.", icon: "mastery", to: "home#alerts", pcOnly: true },
  { kind: "alertLoot", group: "World", label: "Alerts and invasions with rare rewards", hint: "An alert or invasion rewards an Orokin Catalyst or Reactor (or its blueprint), Forma, an Exilus Adapter or Nitain: things you otherwise buy or grind for. Invasions say which side to take.", icon: "sortie", to: "home#alerts", pcOnly: false },
  { kind: "baro", group: "World", label: "Baro arrives", hint: "Baro Ki'Teer arrives with gear you haven't mastered or mods you don't have: what, and how many ducats you hold.", consoleHint: "Baro Ki'Teer arrives: where, and until when.", icon: "baro", to: "home#baro", pcOnly: false },
  { kind: "varzia", group: "World", label: "Varzia's new rotation", hint: "Prime Resurgence changes and brings primes you haven't mastered or can't build yet.", icon: "varzia", to: "home#varzia", pcOnly: true },
  { kind: "circuit", group: "World", label: "Duviri Circuit picks", hint: "The weekly Circuit offers warframes you haven't mastered, or an Incarnon adapter for a weapon you have.", icon: "mastery", to: "home#today", pcOnly: true },

  { kind: "fissures", group: "Fissures", label: "Fissures you watch for", hint: "A fissure opens that matches one of your fissure alerts (set them on Home, under Fissures now).", icon: "void-tear", to: "home#fissures", pcOnly: false },
  { kind: "wishlist", group: "Fissures", label: "Fissures for your wishlist", hint: "An era that had no fissure open gets one, and you hold relics of it for something on your wishlist.", icon: "void-tear", to: "wishlist", pcOnly: true },
  { kind: "reward", group: "Fissures", label: "Which reward to take", hint: "When the reward screen opens: the card with the best score, and why. Sent even while you're in a fissure.", icon: "void-tear", to: "mission", pcOnly: true },

  { kind: "foundry", group: "Your account", label: "Foundry builds ready", hint: "Something you're building is ready to claim, with the mastery it gives if you haven't mastered it.", icon: "foundry", to: "home#foundry", pcOnly: true },
  { kind: "tennoscope", group: "Your account", label: "TennoScope trouble", hint: "It couldn't be started, or something MyOrbiter asked of it failed.", icon: "dojo", to: "home", pcOnly: true },
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
  /** A sale's buyer, for its +rep button (shown while +rep is still due: App's repShown). */
  rep?: { key: string; partner: string };
  /** What became of its pop-up, once that was settled (see `routeOf`); absent on older entries and while a send is under way. */
  outcome?: NoticeOutcome;
  read: boolean;
}

/** Why a notification's pop-up was held back: all three leave it in Recent only. */
export type HeldWhy = "paused" | "quiet" | "fissure";
/** Which place's switch was off when it would have popped up. */
export type OffWhere = "app" | "desktop";

/**
 * What became of one notification's pop-up. "desktop" means the desktop's notification service took
 * it: what that service then does with it is its own (KDE holds pop-ups back while a fullscreen
 * window is in front, for one), which MyOrbiter can't see.
 */
export type NoticeOutcome =
  | { how: "desktop" }
  | { how: "app" }
  | { how: "held"; why: HeldWhy }
  | { how: "off"; where: OffWhere }
  | { how: "failed"; why: string };

/** How long the Settings test waits before it sends: time to click away from MyOrbiter and try the desktop. */
export const TEST_WAIT_MS = 5000;

/** What a notification's pop-up is decided by. */
export interface PopupFacts {
  /** Notifications are paused (for good or for a while). */
  paused: boolean;
  /** Its kind is on the quiet list ("Recent only"). */
  quietKind: boolean;
  /** "Quiet while I'm in a fissure" is on, a fissure is running, and the kind isn't the reward to take. */
  quietFissure: boolean;
  /** MyOrbiter's window has focus: the player is looking at it. */
  focused: boolean;
  /** "Pop-ups inside MyOrbiter" is on. */
  toasts: boolean;
  /** "Desktop notifications" is on. */
  desktop: boolean;
}

/**
 * Where a notification goes, before anything is sent: held back (paused, then the quiet list, then a
 * fissure), a pop-up inside MyOrbiter while its window has focus, else the desktop's; or nowhere
 * because the switch for that place is off. "desktop" here is the intent: the send may still fail.
 */
export function routeOf(f: PopupFacts): Exclude<NoticeOutcome, { how: "failed" }> {
  if (f.paused) return { how: "held", why: "paused" };
  if (f.quietKind) return { how: "held", why: "quiet" };
  if (f.quietFissure) return { how: "held", why: "fissure" };
  if (f.focused) return f.toasts ? { how: "app" } : { how: "off", where: "app" };
  return f.desktop ? { how: "desktop" } : { how: "off", where: "desktop" };
}

/** The outcome in words, for the entry's small line and the log. */
export function outcomeText(o: NoticeOutcome): string {
  switch (o.how) {
    case "desktop":
      return "Sent to the desktop";
    case "app":
      return "Shown in the app";
    case "held":
      return o.why === "paused" ? "Held: paused" : o.why === "quiet" ? "Held: on the quiet list" : "Held: quiet in a fissure";
    case "off":
      return o.where === "app" ? "Not shown: pop-ups inside MyOrbiter are off" : "Not sent: desktop notifications are off";
    case "failed":
      return `Could not be sent: ${o.why}`;
  }
}

/** An outcome read back from the saved history: anything of another shape is left out. */
export function outcomeOf(x: unknown): NoticeOutcome | undefined {
  if (!x || typeof x !== "object") return undefined;
  const o = x as Record<string, unknown>;
  if (o.how === "desktop" || o.how === "app") return { how: o.how };
  if (o.how === "held" && (o.why === "paused" || o.why === "quiet" || o.why === "fissure")) return { how: "held", why: o.why };
  if (o.how === "off" && (o.where === "app" || o.where === "desktop")) return { how: "off", where: o.where };
  if (o.how === "failed" && typeof o.why === "string") return { how: "failed", why: o.why.slice(0, 300) };
  return undefined;
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
  // Its pop-up was another one's: what became of that doesn't carry over to the text it has now.
  const { outcome: _was, ...rest } = old;
  return [{ ...rest, ...n, read: false }, ...log.filter((x) => x.id !== id)];
}

export function logNotice(log: Notice[], n: Omit<Notice, "id" | "read">): Notice[] {
  const notice: Notice = { ...n, id: `${n.at}-${Math.random().toString(36).slice(2, 8)}`, read: false };
  return [notice, ...log].slice(0, NOTICE_LOG);
}
