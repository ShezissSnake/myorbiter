// The sites MyOrbiter opens in your browser. Every link goes through `openable` first, and the
// desktop app's opener permission (src-tauri/capabilities/default.json) allows the same sites and
// nothing else, so a link built from data (an item's wiki page, a seller's profile) can never send
// the browser, or the system, somewhere unexpected. Add a site in both places.

/** Each allowed site: its host, and the path its links must start with ("/" for any). */
export const LINK_SITES: readonly { host: string; path: string }[] = [
  { host: "warframe.market", path: "/" },
  { host: "wiki.warframe.com", path: "/" },
  // Older catalogs still point items' wiki pages at the Fandom wiki.
  { host: "warframe.fandom.com", path: "/" },
  { host: "overframe.gg", path: "/" },
  { host: "noxsframe.com", path: "/" },
  // MyOrbiter's own project on gitlab.com: its pages under /-/ (releases, issues, a new issue), not
  // what others can put under the project's address (uploads to issues). Its old address on GitHub
  // is gone, and anyone could take the name, so it isn't allowed.
  { host: "gitlab.com", path: "/sheziss-group/myorbiter/-/" },
];

/** The URL, normalised, if MyOrbiter may open it: https, an allowed site, no user name or password. */
export function openable(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  const site = LINK_SITES.find((s) => s.host === host);
  if (!site || !u.pathname.startsWith(site.path)) return null;
  return u.href;
}
