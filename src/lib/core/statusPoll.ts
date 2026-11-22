// The warframe.market status poll (App, every 3 s): a read of MyOrbiter's own connection
// (presence.rs), local, no request to the site. Signed out, with nothing held or settling, the
// answer can't change, so the poll waits.

export interface StatusPollState {
  /** Signed in to warframe.market (marketStore's `linked`). */
  linked: boolean;
  /** A choice clicked and not confirmed yet (marketStore's `statusAsked`). */
  asked: unknown;
  /** The last status read; null: none read yet (or cleared by a sign-out). */
  status: { wanted: unknown; committed: unknown; connected: boolean; error: string | null } | null;
}

/**
 * Whether the status poll reads now: always while signed in; signed out, until a read shows the
 * connection fully let go (nothing wanted, confirmed, connected or failed) and nothing asked.
 */
export function statusPollDue(s: StatusPollState): boolean {
  if (s.linked || s.asked != null || !s.status) return true;
  const st = s.status;
  return st.wanted != null || st.committed != null || st.connected || !!st.error;
}
