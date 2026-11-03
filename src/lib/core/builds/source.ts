// Where builds come from, behind one small interface.
//
// Today: text the user pastes (parse.ts), the user's own editor, and orbiter's suggestions. orbiter
// never fetches Overframe or the wiki: their terms forbid automated access. A fetcher can plug in
// here later only with the site's permission on record; registerSource refuses a network source
// without it, and always refuses the hosts in BLOCKED_HOSTS unless that permission names the host.

import type { CatalogItem } from "../types";
import type { Build } from "./types";

export interface SourceContext {
  /** The model's catalogByUnique, to match names. */
  catalog: ReadonlyMap<string, CatalogItem>;
  /** settings.buildsMaxAgeDays (0: no limit): a source may skip older builds itself. */
  maxAgeDays: number;
  now: number;
}

/** A site's written permission for automated access: who granted it, when, and for which host. */
export interface SourcePermission {
  host: string;
  grantedBy: string;
  /** ISO date. */
  on: string;
  note?: string;
}

export interface BuildSource {
  /** "orbiter" for the suggestions; a site's own id for a fetcher. */
  id: string;
  label: string;
  /** True when it reads anything over the network. */
  network: boolean;
  /** Required for a network source. */
  permission?: SourcePermission;
  /** Builds for one item, with `source` set (the url and site for a fetched one). */
  builds(item: CatalogItem, ctx: SourceContext): Promise<Build[]>;
}

/** Sites whose terms forbid automated access: never fetched without their permission on record. */
export const BLOCKED_HOSTS = ["overframe.gg", "warframe.fandom.com", "wiki.warframe.com"];

const sources: BuildSource[] = [];

/** Adds a source (replacing one with the same id). Throws for a network source without permission. */
export function registerSource(s: BuildSource): void {
  if (s.network) {
    if (!s.permission?.grantedBy || !s.permission.on || !s.permission.host) throw new Error(`${s.label}: a network source needs the site's permission on record`);
    for (const host of BLOCKED_HOSTS) {
      if (s.id.includes(host) && s.permission.host !== host) throw new Error(`${s.label}: ${host} forbids automated access without its permission`);
    }
  }
  const i = sources.findIndex((x) => x.id === s.id);
  if (i < 0) sources.push(s);
  else sources[i] = s;
}

export const unregisterSource = (id: string): void => {
  const i = sources.findIndex((x) => x.id === id);
  if (i >= 0) sources.splice(i, 1);
};

/** The sources registered, in order. */
export const buildSources = (): readonly BuildSource[] => sources;

/** Every registered source's builds for an item; a source that fails is skipped (its error returned). */
export async function sourceBuilds(item: CatalogItem, ctx: SourceContext): Promise<{ builds: Build[]; errors: { source: string; error: string }[] }> {
  const out: Build[] = [];
  const errors: { source: string; error: string }[] = [];
  for (const s of sources) {
    try {
      out.push(...(await s.builds(item, ctx)));
    } catch (e) {
      errors.push({ source: s.id, error: String(e) });
    }
  }
  return { builds: out, errors };
}
