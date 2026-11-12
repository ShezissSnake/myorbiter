// Stand-ins for TennoScope in the browser's demo (npm run dev:demo), to see and picture each state
// of the first start without a real account or a real TennoScope. Chosen by a key in the demo
// browser's own storage (`orbiter-demo-tennoscope`), which only the help pictures' script and a
// developer set; the desktop app never reads it (backend.ts asks only when not in Tauri).

import type { TennoscopeReport, TennoscopeStatus } from "../backend";

export const STAND_IN_KEY = "orbiter-demo-tennoscope";
/** "1": the demo's update channels as a new channel has them: Stable and Beta empty, Experimental with this build. */
export const EMPTY_CHANNEL_KEY = "orbiter-demo-empty-channel";

export type StandIn =
  /** Starts, and never writes a report. */
  | "silent"
  /** Reports Overlay mode, and turns every request for Full mode down. */
  | "refuses"
  /** Full mode, the game running, at its login screen. */
  | "signin"
  /** Full mode, signed in, reading the inventory (and never done). */
  | "reading"
  /** Read the inventory, and its data folder misses a file MyOrbiter used to need (the friend's case). */
  | "unloaded";

export const STAND_INS: readonly StandIn[] = ["silent", "refuses", "signin", "reading", "unloaded"];

export const isStandIn = (x: unknown): x is StandIn => typeof x === "string" && (STAND_INS as readonly string[]).includes(x);

const health = (state: string, message: string) => ({ state, message, last_success: null }) as TennoscopeReport["health"]["game_reader"];

/** The status the stand-in gives at `now`. */
export function standInStatus(kind: StandIn, now: number): TennoscopeStatus {
  const base: TennoscopeStatus = { binary: "/opt/myorbiter/tennoscope/TennoScope.AppImage", custom: null, bundled: true, supported: true, running: true, started_by_myorbiter: true, report: null, restart: { tries: 0, gave_up: false, retry_in_ms: null } };
  if (kind === "silent") return base;
  const ready = health("ready", "Ready");
  const full = kind !== "refuses";
  const game = kind !== "refuses";
  const reader = kind === "signin" ? health("degraded", "inventory authorization was not found") : kind === "unloaded" ? health("ready", "Inventory synchronized from warframe-memory") : kind === "reading" ? health("ready", "Warframe process connected") : health("idle", "Warframe is not running");
  const report: TennoscopeReport = {
    at: now,
    pid: 4242,
    game_running: game,
    health: { game_reader: reader, log_monitor: ready, capture: ready, catalog: health("ready", "Item data up to date"), market: ready, collection_prices: ready, database: ready, market_account: health("idle", "Not signed in") },
    market: { link: "unlinked", backing: null, presence: { status: null, wanted: null, auto: false } },
    setup: { setup_complete: true, access_mode: full ? "full" : "overlay", desktop_capture_action_available: false },
    last_error: kind === "refuses" ? { at: now - 1000, message: "access mode is already changing" } : null,
    foundry: null,
    foundry_ready: null,
  };
  if (kind === "unloaded") Object.assign(report, { mastery_rank: 22 });
  return { ...base, report };
}

/** What loading the stand-in's data folder fails with: nothing read yet, or the file it misses. */
export function standInLoadError(kind: StandIn): string {
  return kind === "unloaded"
    ? "not found at ~/.local/share/io.github.deftera186.tennoscope/catalog/catalog-generation.json: TennoScope hasn't written it yet"
    : "not found at ~/.local/share/io.github.deftera186.tennoscope/tennoscope.sqlite3: TennoScope hasn't written it yet";
}

/** Whether the game's log says the player signed in, for the stand-in. */
export const standInSignedIn = (kind: StandIn) => kind === "reading" || kind === "unloaded";
