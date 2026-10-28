// What a link asked the page it opens to show: "parts?best=Ducats" opens Prime parts with Best as
// set to Ducats. The page takes it once (takeIntent) and it's gone, so coming back later shows the
// page as you left it.
const pending = $state<{ page: string | null; want: Record<string, string> }>({ page: null, want: {} });

/** Splits "relics?era=Lith#top" into the page, its filters and the spot to scroll to. */
export function parseTarget(to: string): { page: string; want: Record<string, string>; spot: string | null } {
  const [rest, spot] = to.split("#");
  const [page, query] = rest.split("?");
  return { page, want: Object.fromEntries(new URLSearchParams(query ?? "")), spot: spot ?? null };
}

export function setIntent(page: string, want: Record<string, string>) {
  pending.page = Object.keys(want).length ? page : null;
  pending.want = want;
}

/** The filters a link asked this page for, once; null when none. Read it in an effect. */
export function takeIntent(page: string): Record<string, string> | null {
  if (pending.page !== page) return null;
  const want = pending.want;
  pending.page = null;
  return want;
}
