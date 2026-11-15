// TennoScope's report, checked once where it comes in (tennoscopeStore.svelte.ts), before any page
// reads it. The Rust side passes any report with a time and a live process (companion.rs); a
// TennoScope of another version may write another shape. The sidebar's status, the setup steps
// and the TennoScope panel read `setup`, `health` and `game_running` without a check, so a report
// without them is taken as no report ("runs but doesn't answer"), and a health component it
// doesn't name, or names in another shape, reads as not known.

import type { Health, HealthState, TennoscopeReport, TennoscopeStatus } from "../backend";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

/** The components the TennoScope panel lists, and the rest the report carries. */
const HEALTH_KEYS = ["game_reader", "log_monitor", "capture", "catalog", "market", "collection_prices", "database", "market_account"] as const;
const STATES: HealthState[] = ["ready", "idle", "degraded", "failed"];
const MODES = ["companion", "overlay", "full"] as const;

function healthOf(x: unknown): Health {
  if (isObj(x) && STATES.includes(x.state as HealthState) && typeof x.message === "string") return { state: x.state as HealthState, message: x.message, last_success: typeof x.last_success === "string" ? x.last_success : null };
  return { state: "unknown", message: "This TennoScope doesn't report it", last_success: null };
}

/** The report as the page may read it, or null when it lacks what the page reads. */
export function reportOf(raw: unknown): TennoscopeReport | null {
  if (!isObj(raw) || typeof raw.game_running !== "boolean" || !isObj(raw.setup) || !isObj(raw.health)) return null;
  const setup = raw.setup;
  const h = raw.health;
  const e = raw.last_error;
  return {
    ...(raw as unknown as TennoscopeReport),
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
  return { ...raw, report: raw.report == null ? null : reportOf(raw.report) };
}
