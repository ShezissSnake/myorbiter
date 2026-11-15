// TennoScope's report, checked once where it comes in (tennoscopeStore.svelte.ts), before any page
// reads it. The Rust side passes any report with a time and a live process (companion.rs); a
// TennoScope of another version may write another shape. The sidebar's status, the setup steps
// and the TennoScope panel read `setup`, `health` and `game_running` without a check, so a report
// without them is taken as no report ("runs but doesn't answer"), and a health component it
// doesn't name, or names in another shape, reads as not known.
//
// The account's facts (foundry, mastery rank, wallet, rivens, imprints, gear, the Helminth's list)
// are written into the saved game by App.svelte and go on into the collection's build. Each is
// passed on only in the shape the page reads it in, as TennoScope writes it (its `bridge_status`);
// one in another shape is left out whole, as a TennoScope that hasn't read the inventory yet
// leaves it out, so what was saved from the last good read stays. A list is never passed with
// some of its rows dropped: a riven missing from the list loses its saved history, and a modular
// build missing from the gear list would count as not built. Imprints are the one list taken as
// it comes, whatever its rows: their readers skip a row that isn't one, and nothing saved hangs
// on a row. Keys no page reads (`snapshot`) aren't passed. A field left out is named in the app's
// log, by its key only, once a run (`noteLeftOut`).

import { logLine, type GameState, type Health, type HealthState, type TennoscopeReport, type TennoscopeStatus } from "../backend";
import { recordRivens } from "./rivens";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const fine = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** A count: a whole number, 0 or more (a riven's cycles index the Kuva costs). */
const count = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
/** A time a date can hold (ms): the Foundry, Home, Mastery and the side panel format it as one. */
const when = (x: unknown) => fine(x) && Math.abs(x) <= 8.64e15;
const str = (x: unknown): x is string => typeof x === "string";
/** A list whose every row is `ok`. */
const every = (x: unknown, ok: (row: unknown) => boolean): x is unknown[] => Array.isArray(x) && x.every(ok);
/** A row of a fixed length, each place checked by its own test. */
const tuple = (x: unknown, ...ok: ((v: unknown) => boolean)[]) => Array.isArray(x) && x.length === ok.length && ok.every((f, i) => f(x[i]));
/** An optional key: absent, or in its shape. `orNull`: null passes too (the page reads it with `??`). */
const opt = (x: Obj, k: string, ok: (v: unknown) => boolean, orNull = false) => !(k in x) || x[k] === undefined || (orNull && x[k] === null) || ok(x[k]);

/** The components the TennoScope panel lists, and the rest the report carries. */
const HEALTH_KEYS = ["game_reader", "log_monitor", "capture", "catalog", "market", "collection_prices", "database", "market_account"] as const;
const STATES: HealthState[] = ["ready", "idle", "degraded", "failed"];
const MODES = ["companion", "overlay", "full"] as const;
const PRESENCE = ["online", "ingame", "invisible"];

function healthOf(x: unknown): Health {
  if (isObj(x) && STATES.includes(x.state as HealthState) && typeof x.message === "string") return { state: x.state as HealthState, message: x.message, last_success: typeof x.last_success === "string" ? x.last_success : null };
  return { state: "unknown", message: "This TennoScope doesn't report it", last_success: null };
}

/** A riven stat as the game stores it (`parseRiven`, `rivenName` read both). */
const rivenStat = (s: unknown) => isObj(s) && str(s.Tag) && fine(s.Value);
/** A riven's fingerprint: the game's own object, open to keys of its own; those the page reads in their shape. */
const fingerprint = (fp: unknown) =>
  isObj(fp) &&
  opt(fp, "buffs", (v) => every(v, rivenStat), true) &&
  opt(fp, "curses", (v) => every(v, rivenStat), true) &&
  ["lvl", "lvlReq"].every((k) => opt(fp, k, fine, true)) &&
  opt(fp, "rerolls", count, true) &&
  ["compat", "pol"].every((k) => opt(fp, k, str, true));
/**
 * A riven's id keys its saved history (`recordRivens`, `hist[raw.id]`): an id every object already
 * has as a key ("constructor", "__proto__") would read the object's own member there, not a list.
 */
const rivenId = (id: unknown) => str(id) && !(id in Object.prototype);
const riven = (r: unknown) => isObj(r) && str(r.type) && rivenId(r.id) && fingerprint(r.fp) && opt(r, "pending", fingerprint, true);

/** A copy of gear as TennoScope writes it (`GearCopy`): its optional parts only when it has them. */
const gearCopy = (g: unknown) =>
  isObj(g) &&
  str(g.type) &&
  fine(g.f) &&
  fine(g.p) &&
  opt(g, "s", str) &&
  opt(g, "m", (v) => every(v, str)) &&
  opt(g, "x", fine) &&
  opt(g, "pol", (v) => every(v, (row) => tuple(row, fine, str))) &&
  opt(g, "shards", (v) => every(v, (row) => tuple(row, fine, (c) => c === null || str(c), str))) &&
  opt(g, "ab", (v) => every(v, (row) => tuple(row, fine, str, fine)));

const presence = (p: unknown) => p === null || PRESENCE.includes(p as string);
const market = (m: unknown) => isObj(m) && ["unlinked", "linked", "needs_relink"].includes(m.link as string) && (m.backing === null || m.backing === "keyring" || m.backing === "database") && isObj(m.presence) && presence(m.presence.status) && presence(m.presence.wanted) && typeof m.presence.auto === "boolean";

/**
 * The fields the page may read beyond the status, each with its shape. Null is TennoScope's own
 * "not read this run" for each of them and passes; anything else not in the shape is left out.
 */
const FIELDS: Record<string, (v: unknown) => boolean> = {
  pid: fine,
  market,
  foundry: (v) => v === null || (isObj(v) && Object.values(v).every(fine)),
  foundry_ready: (v) => v === null || every(v, (row) => tuple(row, str, when)),
  mastery_rank: (v) => v === null || fine(v),
  platinum: (v) => v === null || fine(v),
  credits: (v) => v === null || fine(v),
  endo: (v) => v === null || fine(v),
  rivens: (v) => v === null || every(v, riven),
  // The inventory's own rows, any list as it comes: the readers skip a row that isn't an object
  // (core/imprints.ts), and the saved game's loader keeps only those (backend.ts).
  imprints: (v) => v === null || Array.isArray(v),
  gear: (v) => v === null || every(v, gearCopy),
  consumed_suits: (v) => v === null || every(v, str),
};

/** Calls `log` with each key the first time it comes, and never again. */
export function onceEach(log: (key: string) => void): (key: string) => void {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    log(key);
  };
}

/** A field left out, in the app's log: its key only, never its value, once a run. */
export const noteLeftOut = onceEach((key) => logLine("warn", "tennoscope", `report: "${key}" left out, not in the shape MyOrbiter reads`));

/**
 * The report as the page may read it, or null when it lacks what the page reads. `note` hears the
 * key of each field left out.
 */
export function reportOf(raw: unknown, note: (key: string) => void = () => {}): TennoscopeReport | null {
  if (!isObj(raw) || !fine(raw.at) || typeof raw.game_running !== "boolean" || !isObj(raw.setup) || !isObj(raw.health)) return null;
  const setup = raw.setup;
  const h = raw.health;
  const e = raw.last_error;
  const out: Obj = { at: raw.at };
  for (const [k, ok] of Object.entries(FIELDS)) {
    if (!(k in raw)) continue;
    if (ok(raw[k])) out[k] = raw[k];
    else note(k);
  }
  return {
    ...(out as unknown as TennoscopeReport),
    game_running: raw.game_running,
    setup: {
      setup_complete: setup.setup_complete === true,
      access_mode: MODES.find((m) => m === setup.access_mode) ?? null,
      desktop_capture_action_available: setup.desktop_capture_action_available === true,
    },
    health: Object.fromEntries(HEALTH_KEYS.map((k) => [k, healthOf(h[k])])) as TennoscopeReport["health"],
    last_error: isObj(e) && typeof e.at === "number" && typeof e.message === "string" ? { at: e.at, message: e.message } : null,
  };
}

/** A status check, its report checked. */
export function statusOf(raw: TennoscopeStatus | null): TennoscopeStatus | null {
  if (!raw) return raw;
  return { ...raw, report: raw.report == null ? null : reportOf(raw.report, noteLeftOut) };
}

/**
 * The account's facts from a checked report, written into the saved game (App.svelte's account
 * effect; saved with the settings so they outlive a TennoScope restart). A fact the report leaves
 * out, or gives as null, keeps what was saved. Each is set only when it changed, so the settings
 * aren't saved again for a report that brings nothing new.
 */
export function takeAccountFacts(g: GameState, r: TennoscopeReport) {
  if (r.foundry_ready && JSON.stringify(r.foundry_ready) !== JSON.stringify(g.foundryReady)) g.foundryReady = r.foundry_ready;
  if (r.mastery_rank != null && r.mastery_rank !== g.masteryRank) g.masteryRank = r.mastery_rank;
  if (r.platinum != null && r.platinum !== g.platinum) g.platinum = r.platinum;
  if (r.credits != null && r.credits !== g.credits) g.credits = r.credits;
  if (r.endo != null && r.endo !== g.endo) g.endo = r.endo;
  if (r.rivens && JSON.stringify(r.rivens) !== JSON.stringify(g.rivens)) g.rivens = r.rivens;
  if (r.imprints && JSON.stringify(r.imprints) !== JSON.stringify(g.imprints)) g.imprints = r.imprints;
  if (r.gear && JSON.stringify(r.gear) !== JSON.stringify(g.gear)) g.gear = r.gear;
  if (r.consumed_suits && JSON.stringify(r.consumed_suits) !== JSON.stringify(g.consumedSuits)) g.consumedSuits = r.consumed_suits;
  if (r.rivens) {
    const hist = recordRivens(g.rivenHistory ?? {}, r.rivens);
    if (hist) g.rivenHistory = hist;
  }
}
