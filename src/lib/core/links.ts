// The sites MyOrbiter opens in your browser. Every link goes through `openable` first, and the
// desktop app's open_link command (src-tauri/src/link.rs) checks the same sites again and opens
// nothing else, so a link built from data (an item's wiki page, a seller's profile) can never send
// the browser, or the system, somewhere unexpected. Add a site in both places.
import { REPO_URL } from "./updates";

/** The page listing everything MyOrbiter reads and sends (docs/privacy.md), and the words that link
 *  it: the Guide's trust section opens it, and the website (scripts/site.mjs) turns that control
 *  into a link and points its footer at it. */
export const PRIVACY_PAGE = { url: `${REPO_URL}/blob/main/docs/privacy.md`, label: "What MyOrbiter reads and sends" } as const;

/** Each allowed site: its host, and the path its links must start with ("/" for any); a host may be
 *  listed more than once. */
export const LINK_SITES: readonly { host: string; path: string }[] = [
  { host: "warframe.market", path: "/" },
  { host: "wiki.warframe.com", path: "/" },
  // Older catalogs still point items' wiki pages at the Fandom wiki.
  { host: "warframe.fandom.com", path: "/" },
  { host: "overframe.gg", path: "/" },
  { host: "noxsframe.com", path: "/" },
  // MyOrbiter's own project on github.com, its home: its releases, issues, the source on main and
  // security reports, never the old orbiter name, what others host on github.com or what they can
  // upload under the repository's address (files and assets attached to issues). Then its website
  // on GitHub Pages.
  { host: "github.com", path: "/ShezissSnake/myorbiter/releases" },
  { host: "github.com", path: "/ShezissSnake/myorbiter/issues" },
  { host: "github.com", path: "/ShezissSnake/myorbiter/blob/main/" },
  { host: "github.com", path: "/ShezissSnake/myorbiter/security/" },
  { host: "shezisssnake.github.io", path: "/myorbiter/" },
  // The mirror on gitlab.com, which keeps the releases made there: its pages under /-/ (releases,
  // issues, a new issue), not what others can put under the project's address (uploads to issues).
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
  if (!LINK_SITES.some((s) => s.host === host && u.pathname.startsWith(s.path))) return null;
  return u.href;
}
