// The price you last set or approved for a listing, and how far an automatic repricing pass may
// take it from there. You set or approve a price by listing it (the listing form; a Sell spares
// plan you apply, for the lines whose price it changes or makes), by editing it on Orders, or by
// pressing Reprice; a pass on the timer never does. Unattended, a listing is never lowered under
// AUTO_FLOOR_SHARE of that price: it stops there and MyOrbiter says so, for you to decide. The line
// only ever stops a price going down; a raise is never held back by it.
//
// An approved price belongs to one listing, told from the next by warframe.market's own order id
// (`approvedFor`), and to the account and platform whose listing it is. When that listing is gone
// from a read of its own account's listings that succeeded (sold out, deleted, or made again under
// a new id), its approval ends, and a new listing's own price is its approved price, whoever made
// it, unless a per-key price from before holds it (below). A failed read ends nothing, a hidden
// listing is still there, a listing read again under the same id on its own account and platform
// gets back what it had, after a restart too (`approvedGone`), and a read under another account or
// platform ends and moves nothing of this one's: not its approvals, not the per-key prices they
// hold.
//
// `approved` stays as older builds saved and read it, one price per listing key; this build keeps
// it as each key's price for a step back. A price there that no approval of this build agrees with
// was saved before listings were told apart (or by an older build after a step back): it goes to
// every listing up for that key, higher or lower than the listing's own price, and stays for an
// older build whether one is up or not, until a price set or approved here for a listing of that
// key replaces it.

/** The share of your last approved price an unattended pass may lower a listing to. */
export const AUTO_FLOOR_SHARE = 0.7;
/** An unattended pass keeps at least this share of the price it starts from: more than halving waits for Reprice. */
export const AUTO_LEAST_KEPT = 0.5;

/** Whether a move from `current` to `target` takes off more than an unattended pass may (it waits for Reprice). */
export const cutTooFar = (target: number, current: number) => target < current * AUTO_LEAST_KEPT;

const percent = (share: number) => `${Math.round(share * 100)}%`;
/** "never more than halves a price", or the same for another share. */
const cutWords = AUTO_LEAST_KEPT === 0.5 ? "never more than halves a price" : `never takes more than ${percent(1 - AUTO_LEAST_KEPT)} off a price`;

/**
 * What automatic repricing never does, in words: Settings, Orders and the Guide show this one
 * sentence (tests/autoLimits.test.ts holds it to the code). The 70% and the raise are
 * `unattendedMove`; the halving is `cutTooFar`; the floors and the raise to them, at once, are
 * `planFor` and the pass in marketStore. "A listing's own floor" is Orders' Floor column (with a
 * relic's crack value and a prime's ducats), never Orders' Floor share of the market price, which
 * the dead band may leave a listing a little under.
 */
const limits = (how: string) =>
  `On its own it never lowers a price under ${percent(AUTO_FLOOR_SHARE)} of the one you last set or approved for that listing in MyOrbiter (${how}; a price changed on warframe.market's website doesn't move it): it stops there and says so, and that mark never holds back a raise. ` +
  "The approval belongs to the listing: once it is sold out, removed or made again, it ends, and a new listing starts from its own price, whoever made it, unless an earlier version saved one for that item, which holds every listing of it until you price one again. " +
  `It ${cutWords} (that waits for you to press Reprice), never goes under a listing's own floor (the one in its row, a relic's crack value, a prime part's ducats) or your minimum price, and raises a listing that sits under one of them to at least that at once`;
export const AUTO_LIMITS = limits("listing it, typing it, pressing Reprice, or a Sell spares line that changes it");
/** The same for a console, where there is no Sell spares. */
export const AUTO_LIMITS_CONSOLE = limits("listing it, typing it or pressing Reprice");

/** The least an unattended pass may set: 70% of `approved`, rounded up to a whole platinum. */
export const autoFloor = (approved: number) => Math.ceil(approved * AUTO_FLOOR_SHARE - 1e-9);

export type Unattended =
  /** Go ahead at `target`. */
  | { go: true; target: number; atFloor: boolean }
  /** Leave it: the listing is already at (or under) the floor, and the market is lower still. */
  | { go: false; floor: number };

/**
 * What an unattended pass may do with a listing at `current` that the market would take to
 * `target`, given the price you last approved. A raise (or no move) always goes as planned: the
 * floor only ever stops a price going down. Above the floor it goes as planned; under it, down to
 * the floor and no further (`atFloor`), or not at all once it's there.
 */
export function unattendedMove(target: number, current: number, approved: number): Unattended {
  const floor = autoFloor(approved);
  if (target >= floor || target >= current) return { go: true, target, atFloor: false };
  if (current <= floor) return { go: false, floor };
  return { go: true, target: floor, atFloor: true };
}

/** Saved approvals, kept only where they're whole positive prices (a damaged settings file). */
export function approvedOf(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => typeof k === "string" && Number.isInteger(v) && (v as number) >= 1)) as Record<string, number>;
}

/** Per listing (warframe.market's order id): its key, its approved price, whose listing it is, and whether the price came from a per-key approval saved before listings were told apart. */
export type ApprovedFor = Record<string, Approval>;
export interface Approval {
  key: string;
  platinum: number;
  /** The account and platform whose listing it is (`whoseRead`); missing on one recorded while neither was known. */
  by?: string;
  /** Its price came from a per-key approval saved before listings were told apart (or by an older build): that key stays one. */
  legacy?: true;
}
/** Settings that carry `approvedFor` and `approvedGone` (saved beside `approved`; older builds keep them as they find them). */
export type WithApprovedFor = { approved: Record<string, number>; approvedFor?: unknown; approvedGone?: unknown };

/**
 * Approvals of listings a read of their own account and platform no longer had, by order id, with
 * whose they were and when they went: a listing read again under the same id, on the same account
 * and platform, gets its approval back, after a restart too (a read warframe.market answered short
 * ends nothing for good). Kept for the latest GONE_KEPT of each account and platform.
 */
export type ApprovedGone = Record<string, Approval & { by: string; at: number }>;
export const GONE_KEPT = 500;
/** Saved ended approvals, kept only where whole: a key, a whole positive price, whose, and when. One without whose is never given back. */
export function approvedGoneOf(raw: unknown): ApprovedGone {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ApprovedGone = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as { key?: unknown; platinum?: unknown; by?: unknown; legacy?: unknown; at?: unknown } | null;
    if (!id || !e || typeof e !== "object" || typeof e.key !== "string" || !Number.isInteger(e.platinum) || (e.platinum as number) < 1 || typeof e.by !== "string" || typeof e.at !== "number" || !Number.isFinite(e.at)) continue;
    out[id] = { key: e.key, platinum: e.platinum as number, by: e.by, at: e.at, ...(e.legacy === true ? { legacy: true as const } : {}) };
  }
  return out;
}
/**
 * The saved ended approvals after a read of `whose` listings: every other account's as they were,
 * and `whose` own as `ended` holds them now (a new one dated `now`), the latest GONE_KEPT.
 */
export function goneAfter(saved: Readonly<ApprovedGone>, ended: ReadonlyMap<string, Approval>, whose: string, now: number): ApprovedGone {
  const out: ApprovedGone = {};
  for (const [id, e] of Object.entries(saved)) if (e.by !== whose) out[id] = e;
  const mine = [...ended]
    .map(([id, e]): [string, ApprovedGone[string]] => [id, { key: e.key, platinum: e.platinum, by: whose, at: saved[id]?.by === whose ? saved[id].at : now, ...(e.legacy ? { legacy: true as const } : {}) }])
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, GONE_KEPT);
  for (const [id, e] of mine) out[id] = e;
  return out;
}
/** `whose` own saved ended approvals, as the read's `ended`. */
export function goneOf(saved: Readonly<ApprovedGone>, whose: string): Map<string, Approval> {
  return new Map(Object.entries(saved).filter(([, e]) => e.by === whose).map(([id, e]) => [id, { key: e.key, platinum: e.platinum, by: e.by, ...(e.legacy ? { legacy: true as const } : {}) }]));
}

/** Whose listings a read is: the signed-in account and the platform it was read on. */
export const whoseRead = (accountId: string, platform: string) => `${accountId}|${platform}`;

/** Saved approvals per listing, kept only where each has a key and a whole positive price (a damaged settings file). */
export function approvedForOf(raw: unknown): ApprovedFor {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ApprovedFor = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as { key?: unknown; platinum?: unknown; by?: unknown; legacy?: unknown } | null;
    if (!id || !e || typeof e !== "object" || typeof e.key !== "string" || !Number.isInteger(e.platinum) || (e.platinum as number) < 1) continue;
    out[id] = { key: e.key, platinum: e.platinum as number, ...(typeof e.by === "string" ? { by: e.by } : {}), ...(e.legacy === true ? { legacy: true as const } : {}) };
  }
  return out;
}

/** One of your listings as a read of them found it. */
export interface UpListing {
  id: string;
  itemId: string;
  platinum: number;
  /** Its approval key; null when its item isn't in warframe.market's item list (its key can't be told). */
  key: string | null;
  /** A filled sculpture: the key it had before a filled one was a listing of its own. */
  starless?: string | null;
}

/** The item a listing key is for. */
const itemOfKey = (key: string) => key.slice(0, key.indexOf("|"));

/**
 * The approvals after a read of `whose` listings that succeeded (`up`: every sell listing it
 * found, hidden ones included).
 *
 * - Another account's or platform's approvals are left as they are, and so is every per-key price
 *   one of them agrees with: a read never ends or moves what isn't its own.
 * - Each listing keeps its own approval. A per-key price no approval of this build agrees with was
 *   saved before listings were told apart (or by an older build after a step back): every listing
 *   up for that key takes it (a filled sculpture takes its item's old key's), marked `legacy`, and
 *   the key keeps it for an older build, listing or not.
 * - A listing with none takes back what it had when `ended` has it (gone from an earlier read of
 *   its own account and platform, saved: `approvedGone`), and its key's price with it; else its
 *   own price: new, whoever made it. One MyOrbiter made (`made`: its key and
 *   the price it was listed at, since the read before) takes that price as its own approval, the
 *   key's saved price set to it as the listing was made.
 * - A listing of `whose` gone from the read ends its approval (into `ended`); its key's price goes
 *   too when it was that approval's and nothing else holds it, so the next listing starts from its
 *   own price. One recorded while the account wasn't known ends only when read again and gone.
 * - Nothing of an item whose key can't be told ends or moves.
 */
export function settleApprovals(approved: Readonly<Record<string, number>>, owned: Readonly<ApprovedFor>, up: readonly UpListing[], ended: Map<string, Approval>, whose: string, made: Map<string, number> = new Map()): { approved: Record<string, number>; owned: ApprovedFor } {
  const unknown = new Set(up.filter((l) => l.key == null).map((l) => l.itemId));
  const theirs = (e: Approval) => e.by != null && e.by !== whose;
  // A key's saved price that an approval of this build agrees with (any account's) is this
  // build's; any other is a per-key one from before.
  const agreed = new Set(Object.values(owned).filter((e) => !e.legacy && approved[e.key] === e.platinum).map((e) => e.key));
  const unowned = (key: string | null | undefined): key is string => key != null && approved[key] != null && !agreed.has(key);
  const next: ApprovedFor = {};
  for (const [id, e] of Object.entries(owned)) if (theirs(e)) next[id] = e;
  const seen = new Set<string>();
  // Approvals given back by this read, the highest per key: the key's price comes back with them.
  const restored = new Map<string, number>();
  for (const l of up) {
    seen.add(l.id);
    const had = owned[l.id];
    if (l.key == null) {
      if (had) next[l.id] = had;
      continue;
    }
    const back = ended.get(l.id);
    // Seen again under another key: that one is not coming back.
    if (back && back.key !== l.key) ended.delete(l.id);
    // Made in MyOrbiter at this price since the read before: approved at it, as listed.
    if (!had && !(back && back.key === l.key) && made.get(l.key) === l.platinum) {
      made.delete(l.key);
      next[l.id] = { key: l.key, platinum: l.platinum, by: whose };
      ended.delete(l.id);
      continue;
    }
    const own: Approval | null = unowned(l.key)
      ? { key: l.key, platinum: approved[l.key], legacy: true }
      : had
        ? had
        : back && back.key === l.key
          ? back
          : unowned(l.starless)
            ? { key: l.key, platinum: approved[l.starless], legacy: true }
            : null;
    next[l.id] = { key: l.key, platinum: own?.platinum ?? l.platinum, by: whose, ...(own?.legacy ? { legacy: true as const } : {}) };
    if (own && own === back) restored.set(l.key, Math.max(back.platinum, restored.get(l.key) ?? 0));
    ended.delete(l.id);
  }
  const endedNow: Approval[] = [];
  for (const [id, e] of Object.entries(owned)) {
    if (seen.has(id) || theirs(e)) continue;
    // An item whose key can't be told, or an approval recorded while the account wasn't known: kept.
    if (unknown.has(itemOfKey(e.key)) || e.by == null) next[id] = e;
    else {
      ended.set(id, e);
      endedNow.push(e);
    }
  }
  // Each key's price as older builds read it. Kept as it is when it is a per-key one from before,
  // or another account's (or one recorded unknown) agrees with it; else the one it had when a
  // listing of this read still has it, or the first one's, raised to an approval given back here
  // (the price it had before the read that ended it); else, when the approval it was ended here
  // and nothing else holds it, it goes.
  const keyed: Record<string, number> = { ...approved };
  const heldElsewhere = (k: string) => Object.values(next).some((e) => e.by !== whose && !e.legacy && e.key === k && approved[k] === e.platinum);
  const mine = new Map<string, Approval[]>();
  for (const e of Object.values(next)) if (e.by === whose) mine.set(e.key, [...(mine.get(e.key) ?? []), e]);
  for (const [k, list] of mine) {
    if (unowned(k) || heldElsewhere(k)) continue;
    const kept = list.some((e) => e.platinum === approved[k]) ? approved[k] : list[0].platinum;
    keyed[k] = Math.max(kept, restored.get(k) ?? 0);
  }
  for (const e of endedNow) if (!e.legacy && !mine.has(e.key) && approved[e.key] === e.platinum && !heldElsewhere(e.key)) delete keyed[e.key];
  return { approved: keyed, owned: next };
}

/** Two flat records with the same entries, in any order. */
export function sameEntries(a: Readonly<Record<string, unknown>> | undefined, b: Readonly<Record<string, unknown>> | undefined): boolean {
  const x = Object.entries(a ?? {});
  if (x.length !== Object.keys(b ?? {}).length) return false;
  return x.every(([k, v]) => JSON.stringify(v) === JSON.stringify((b ?? {})[k]));
}
