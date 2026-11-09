// A warframe.market request that wasn't sent because warframe.market asked to wait (a 429's
// Retry-After, market.rs): the Rust side says until when as unix milliseconds, and the page shows
// it as the clock does, "warframe.market asked us to wait until 14:05".

/** The Rust side's words for a deferred request, with the time as unix ms (market.rs, MarketError::Deferred). */
const DEFERRED = /warframe\.market asked us to wait until (\d{12,14})\b/;

/** When a deferred request may go again (unix ms), from its error, or null for any other error. */
export function deferredUntil(message: string): number | null {
  const m = DEFERRED.exec(message);
  return m ? Number(m[1]) : null;
}

/** `at` (unix ms) as the clock shows it: "14:05", with seconds when it's under a minute away. */
export function clockTime(at: number, now = Date.now()): string {
  const d = new Date(at);
  return at - now < 60_000 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** An error's text with a deferred request's time put as the clock shows it; any other unchanged. */
export function waitWords(message: string, now = Date.now()): string {
  const until = deferredUntil(message);
  return until == null ? message : message.replace(DEFERRED, `warframe.market asked us to wait until ${clockTime(until, now)}`);
}
