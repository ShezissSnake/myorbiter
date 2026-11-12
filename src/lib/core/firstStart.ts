// The first start's steps (App.svelte's "Getting set up"), worked out from every sign MyOrbiter has:
// what TennoScope reports, what MyOrbiter reads in the game's own log, and what it picked up from
// TennoScope's data. Each step that waits on something says what it waits for, has a time limit,
// and ends in a plain state with a reason and a way on; none waits for ever, and every one can be
// left with Finish later. Nothing here touches the app: App.svelte feeds it the signs and a clock,
// so tests can run it against a TennoScope that never answers.

/** What TennoScope reports, as far as the steps go by it (backend.ts `TennoscopeReport`). */
export interface ReportSigns {
  game_running: boolean;
  setup: { access_mode: "companion" | "overlay" | "full" | null };
  health: { game_reader?: { state: string; message: string }; catalog?: { state: string; message: string } };
  last_error: { at: number; message: string } | null;
  /** Null until this run of TennoScope read the inventory. */
  mastery_rank?: number | null;
}

export interface Signs {
  now: number;
  /** TennoScope's status: null before the first look. */
  status: { supported: boolean; running: boolean; binary: string | null; report: ReportSigns | null } | null;
  /** Why the last start or request failed, as the store has it (ts.error). */
  tsError: string | null;
  /** When the wait for the current step began (ms): the first start, or the last Try again. */
  since: number;
  /** When TennoScope was first seen running since `since`. */
  runningSince: number | null;
  /** Full or Overlay asked for since `since`, and when. */
  asked: { mode: "full" | "overlay"; at: number } | null;
  /** When the game was first seen running since `since` (TennoScope's report or the game's log). */
  gameSince: number | null;
  /** When the player was first seen signed in since `since`. */
  signedInSince: number | null;
  /** MyOrbiter's own reading of the game's log: found, and whether it says the player signed in. */
  log: { found: boolean; signedIn: boolean } | null;
  /** The last pick-up of TennoScope's data: its error (if it failed), and what it took in. */
  pickup: { error: string | null; entries: number; observedAt: number | null };
  /** Linux's Yama ptrace_scope, when known. */
  ptraceScope: number | null;
}

/** How long each wait on TennoScope may take before it's said to have failed, and why. */
export const LIMITS = {
  /** From asking it to start to seeing it run. */
  start: 30_000,
  /** From seeing it run to its first report (it writes one every 3 s once up). */
  report: 45_000,
  /** From asking for Full (or Overlay) to its report saying so. */
  access: 30_000,
  /** From the game seen running to the player seen signed in: the player's own step, so longer. */
  signIn: 5 * 60_000,
  /** From signed in to the inventory picked up (TennoScope reads within seconds of the sign-in). */
  read: 90_000,
} as const;

export type Step = "start" | "access" | "game" | "inventory" | "done";
export type Action = "retry" | "full" | "overlay" | "settings" | "later";

export interface StepState {
  step: Step;
  /** Short: where it stands ("Warframe is running, waiting for you to sign in"). */
  stage: string;
  /** What MyOrbiter is waiting for, if it is. */
  waitingFor: string | null;
  /** Past the wait's limit, or failed: `reason` says why. */
  stuck: boolean;
  reason: string | null;
  /** What the player can do. */
  todo: string;
  /** The ways on, besides Finish later (always there). */
  actions: Action[];
  /** The wait's limit and when it began, for a countdown; null when nothing is waited on. */
  limit: { since: number; ms: number } | null;
}

/** Whether TennoScope's data, as last picked up, holds an inventory. */
const picked = (s: Signs) => s.pickup.entries > 0 || s.pickup.observedAt != null;

/** The game reader's state, when it reports trouble. */
function readerTrouble(r: ReportSigns): { failed: boolean; message: string } | null {
  const g = r.health.game_reader;
  if (!g || (g.state !== "failed" && g.state !== "degraded")) return null;
  return { failed: g.state === "failed", message: g.message };
}

/** TennoScope couldn't find the player's session in the game: the game is at its login screen. */
const atLogin = (m: string) => /authorization was not found|authorization.*unconfirmed/i.test(m);
const refused = (m: string) => /permission denied|not permitted|access is denied/i.test(m);

/** Signed in, by any sign: the game's log, a read TennoScope did, or an inventory picked up. */
export function signedIn(s: Signs): boolean {
  const r = s.status?.report;
  if (!gameRunning(s)) return false;
  if (s.log?.signedIn) return true;
  if (picked(s)) return true;
  if (r?.mastery_rank != null) return true;
  return !!r?.health.game_reader && r.health.game_reader.state === "ready" && /synchroni[sz]ed/i.test(r.health.game_reader.message);
}

/**
 * The game is running: as TennoScope sees it when it reports (it watches the processes, so it
 * also sees the game close), else by the game's log saying the player signed in this session.
 */
export function gameRunning(s: Signs): boolean {
  const r = s.status?.report;
  return r ? r.game_running : !!s.log?.signedIn;
}

const waited = (s: Signs, from: number | null, ms: number) => (from ?? s.since) + ms <= s.now;

/** Where the first start stands. */
export function firstStart(s: Signs): StepState {
  const later: Action[] = [];
  if (picked(s)) return { step: "done", stage: "Your inventory is in", waitingFor: null, stuck: false, reason: null, todo: "", actions: later, limit: null };
  const st = s.status;

  // 1. TennoScope runs.
  if (!st) return { step: "start", stage: "Looking for TennoScope", waitingFor: "TennoScope's state", stuck: waited(s, s.since, LIMITS.start), reason: waited(s, s.since, LIMITS.start) ? "MyOrbiter's own side didn't answer" : null, todo: "Try again, or finish later.", actions: ["retry"], limit: { since: s.since, ms: LIMITS.start } };
  if (!st.running && !st.binary) return { step: "start", stage: "TennoScope wasn't found", waitingFor: null, stuck: true, reason: "MyOrbiter couldn't find TennoScope's program", todo: "Choose it in Settings, TennoScope, Program, or finish later and use MyOrbiter without your inventory.", actions: ["settings"], limit: null };
  if (!st.running) {
    const stuck = waited(s, s.since, LIMITS.start) || !!s.tsError;
    return { step: "start", stage: stuck ? "TennoScope didn't start" : "Starting TennoScope", waitingFor: "TennoScope to start", stuck, reason: stuck ? (s.tsError ?? `it still wasn't running after ${LIMITS.start / 1000} s`) : null, todo: "Try again; if it keeps failing, its log (Settings, Logs) says why.", actions: ["retry", "settings"], limit: { since: s.since, ms: LIMITS.start } };
  }
  const r = st.report;
  if (!r) {
    const stuck = waited(s, s.runningSince, LIMITS.report);
    return { step: "start", stage: stuck ? "TennoScope runs but doesn't answer" : "TennoScope is starting", waitingFor: "TennoScope's first report", stuck, reason: stuck ? `no report from it in ${LIMITS.report / 1000} s: it may be a TennoScope that doesn't talk to MyOrbiter (one started by hand), or still starting` : null, todo: "Try again; close a TennoScope you started yourself and MyOrbiter starts its own.", actions: ["retry"], limit: { since: s.runningSince ?? s.since, ms: LIMITS.report } };
  }

  // 2. Full mode: the inventory is only ever read in it.
  const mode = r.setup.access_mode;
  if (mode !== "full") {
    if (s.asked?.mode === "full") {
      const stuck = waited(s, s.asked.at, LIMITS.access);
      const why = r.last_error && r.last_error.at >= s.asked.at - 1000 ? r.last_error.message : null;
      return { step: "access", stage: stuck || why ? "Full mode didn't turn on" : "Turning Full mode on", waitingFor: "TennoScope to switch to Full mode", stuck: stuck || !!why, reason: why ?? (stuck ? `TennoScope still reports ${mode ?? "no mode"} ${LIMITS.access / 1000} s after it was asked` : null), todo: "Try again, or choose it in Settings, TennoScope.", actions: ["retry", "overlay"], limit: { since: s.asked.at, ms: LIMITS.access } };
    }
    return { step: "access", stage: mode ? `Full mode is off (${mode === "overlay" ? "Overlay" : "Companion"})` : "Full mode isn't chosen", waitingFor: null, stuck: false, reason: null, todo: "Your inventory is only read in Full mode. Turn it on to see your collection, or carry on without it: the reward overlay, your listings, sales, fissures and the clocks all work without.", actions: ["full", "overlay"], limit: null };
  }

  // 3. The game, and the player signed in.
  const trouble = readerTrouble(r);
  if (!gameRunning(s)) {
    const stuck = waited(s, s.since, LIMITS.signIn);
    return { step: "game", stage: "Warframe isn't running", waitingFor: "Warframe to start", stuck, reason: stuck ? `neither TennoScope nor the game's log has seen Warframe in ${LIMITS.signIn / 60_000} minutes${s.log && !s.log.found ? " (MyOrbiter hasn't found the game's log either)" : ""}` : null, todo: "Start Warframe and sign in; this page turns into your collection by itself.", actions: [], limit: { since: s.since, ms: LIMITS.signIn } };
  }
  if (!signedIn(s)) {
    const login = !!trouble && atLogin(trouble.message);
    const stuck = waited(s, s.gameSince, LIMITS.signIn);
    return { step: "game", stage: "Warframe is running, waiting for you to sign in", waitingFor: "you to sign in", stuck, reason: stuck ? (login ? "TennoScope found no signed-in session in the game" : `the game hasn't said you signed in after ${LIMITS.signIn / 60_000} minutes`) : null, todo: "Sign in to Warframe. Already in? Try again, and MyOrbiter asks TennoScope to read now.", actions: ["retry"], limit: { since: s.gameSince ?? s.since, ms: LIMITS.signIn } };
  }

  // 4. The inventory read, and MyOrbiter picking it up.
  // From when the player was first seen signed in (App.svelte notes it as this step comes up).
  const from = s.signedInSince ?? s.now;
  const read = r.mastery_rank != null || (r.health.game_reader?.state === "ready" && /synchroni[sz]ed/i.test(r.health.game_reader.message));
  const base = { step: "inventory" as const, limit: { since: from ?? s.since, ms: LIMITS.read } };
  if (trouble && refused(trouble.message)) return { ...base, stage: "Signed in, but the system won't let TennoScope read the game", waitingFor: null, stuck: true, reason: trouble.message, todo: s.ptraceScope ? "This system only lets a program read another one's memory if it started it. To allow it until you restart, run in a terminal: sudo sysctl kernel.yama.ptrace_scope=0. Then Try again." : "Check that TennoScope runs as the same user as the game, then Try again.", actions: ["retry"] };
  if (read && s.pickup.error) return { ...base, stage: waited(s, from, LIMITS.read) ? "Signed in, read by TennoScope, but MyOrbiter couldn't load it" : "Signed in, read by TennoScope: loading it", waitingFor: "MyOrbiter to load what TennoScope read", stuck: waited(s, from, LIMITS.read), reason: s.pickup.error, todo: "Try again; if it stays, Report a bug: MyOrbiter's log says what was missing.", actions: ["retry"] };
  const stuck = waited(s, from, LIMITS.read) || (!!trouble && trouble.failed);
  const why = trouble ? `TennoScope: ${trouble.message}` : r.health.catalog?.state === "failed" ? `TennoScope has no item data: ${r.health.catalog.message}` : read ? "TennoScope read it, but MyOrbiter found nothing to load" : "TennoScope hasn't read it, and doesn't say why";
  return { ...base, stage: stuck ? "Signed in, but no inventory yet" : "Signed in: reading your inventory", waitingFor: "TennoScope to read your inventory", stuck, reason: stuck ? why : null, todo: stuck ? "Try again, and MyOrbiter asks TennoScope to read now." : "TennoScope reads it in a moment; this page turns into your collection by itself.", actions: ["retry"] };
}

/** One line for MyOrbiter's log when the state changes: no names, no paths (the log writes ~ anyway). */
export function logLine(x: StepState): string {
  return `first start: ${x.stage}${x.stuck && x.reason ? `; ${x.reason}` : x.waitingFor ? `; waiting for ${x.waitingFor}` : ""}`;
}

/** The sidebar's Game line, from the same signs: which stage the game is at. */
export function gameLine(s: Signs): { value: string; title: string; ok: boolean } {
  const r = s.status?.report;
  if (!gameRunning(s)) return r ? { value: "Not running", title: "TennoScope doesn't see Warframe running", ok: false } : { value: s.log?.found ? "Log found" : "No game log", title: s.log?.found ? "Watching Warframe's log" : "No game log found", ok: !!s.log?.found };
  const full = r?.setup.access_mode === "full";
  if (!signedIn(s)) return { value: "At sign-in", title: "Warframe is running, and hasn't said you signed in yet", ok: false };
  return { value: `Signed in${full ? " · Full mode" : ""}`, title: `Warframe is running and you're signed in${full ? ", and TennoScope may read your inventory (Full mode)" : ""}`, ok: true };
}

/** The sidebar's Inventory line when nothing is loaded: which side it's waiting on, or why not. */
export function inventoryLine(s: Signs): { value: string; title: string } {
  const r = s.status?.report;
  if (!s.status?.running) return { value: "TennoScope off", title: "TennoScope isn't running, so nothing reads your inventory" };
  if (!r) return { value: "No report", title: "TennoScope runs but hasn't reported yet" };
  if (r.setup.access_mode !== "full") return { value: "Full mode off", title: "Your inventory is only read in Full mode (Settings, TennoScope)" };
  const t = readerTrouble(r);
  const read = r.mastery_rank != null || (r.health.game_reader?.state === "ready" && /synchroni[sz]ed/i.test(r.health.game_reader.message));
  if (read && s.pickup.error) return { value: "Not loaded", title: `TennoScope read it, but MyOrbiter couldn't load it: ${s.pickup.error}` };
  if (t) return { value: t.failed ? "Read failed" : "Not read yet", title: `TennoScope: ${t.message}` };
  if (!gameRunning(s)) return { value: "Waiting for game", title: "TennoScope reads it once Warframe is running and you're signed in" };
  return { value: "Reading…", title: "TennoScope reads it in a moment" };
}
