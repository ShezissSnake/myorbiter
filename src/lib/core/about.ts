// Settings' About: that MyOrbiter is unofficial, whose the game's material is, and its licence, in
// the repository's own words (each copied word for word from the file named, its markdown's bold
// and code marks left out: tests/about.test.ts finds each in its file), and the three notice files,
// opened on main through the list of sites (core/links.ts allows the repository's files there).
// Nothing here is a sentence of MyOrbiter's own about a licence: change the file, then this.
import { REPO_URL } from "./updates";

/** README.md, "Unofficial.": its bold lead and the two sentences after it. */
export const ABOUT_UNOFFICIAL = {
  lead: "Unofficial.",
  text: "MyOrbiter is a fan-made tool, not affiliated with or endorsed by Digital Extremes. Warframe and its artwork are © and ™ Digital Extremes Ltd.",
} as const;

/** NOTICE.md's first lines: the copyright line and the licence's name. */
export const ABOUT_LICENCE = {
  name: "MyOrbiter",
  text: "© 2026 Sheziss. Licensed under the GNU General Public License v3.0 only (GPL-3.0-only); the full text is in LICENSE.",
} as const;

/** NOTICE.md's paragraph after them, whole: the licence's terms, and that there is no warranty. */
export const ABOUT_WARRANTY =
  "MyOrbiter is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, version 3. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.";

/** The notice files, on main, by their own names; every install carries them too (tauri.conf.json's resources). */
export const ABOUT_FILES: readonly { label: string; what: string; url: string }[] = [
  { label: "LICENSE", what: "(the GNU General Public License's full text)", url: `${REPO_URL}/blob/main/LICENSE` },
  { label: "NOTICE.md", what: "(MyOrbiter's notice, and the files under other licences)", url: `${REPO_URL}/blob/main/NOTICE.md` },
  { label: "THIRD-PARTY-NOTICES/README.md", what: "(the third-party notices every download carries)", url: `${REPO_URL}/blob/main/THIRD-PARTY-NOTICES/README.md` },
];
