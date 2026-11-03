// Where builds come from, behind one small interface.
//
// Text the user pastes (parse.ts), the user's own editor, orbiter's suggestions, and Nox's Frame
// (noxsframe.ts). orbiter never fetches Overframe or the wiki: their terms forbid automated access.
// registerSource refuses a network source without a record of why it may read: the site's written
// permission, or (for the hosts in TERMS_HOSTS only) its terms as checked by hand. The hosts in
// BLOCKED_HOSTS need written permission naming the host.

import type { CatalogItem } from "../types";
import type { Build } from "./types";

export interface SourceContext {
  /** The model's catalogByUnique, to match names. */
  catalog: ReadonlyMap<string, CatalogItem>;
  /** settings.buildsMaxAgeDays (0: no limit): a source may skip older builds itself. */
  maxAgeDays: number;
  now: number;
}

/**
 * Why a network source may read a site. "granted": the site's written permission (who, when, for
 * which host). "terms": the site's own terms, read by hand on `checked`, allow reading its public
 * pages on demand; only for the hosts in TERMS_HOSTS, never for BLOCKED_HOSTS.
 */
export type SourcePermission =
  | { kind?: "granted"; host: string; grantedBy: string; /** ISO date. */ on: string; note?: string }
  | { kind: "terms"; host: string; /** What the terms allow and what orbiter does about it. */ note: string; /** ISO date. */ checked: string };

/**
 * Sites whose terms were read and allow reading public pages on demand, a few at a time:
 * noxsframe.com (Nov 2026: "automated mass requests" are what's forbidden; robots.txt allows the
 * build pages). Adding a host here is a decision, made after reading its terms.
 */
export const TERMS_HOSTS = ["noxsframe.com"];

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
    const p = s.permission;
    if (!p?.host) throw new Error(`${s.label}: a network source needs the site's permission on record`);
    if (p.kind === "terms") {
      if (!TERMS_HOSTS.includes(p.host) || BLOCKED_HOSTS.includes(p.host) || !p.note || !/^\d{4}-\d{2}-\d{2}$/.test(p.checked ?? "")) throw new Error(`${s.label}: ${p.host}'s terms aren't on record as allowing it; it needs the site's permission on record`);
      if (!s.id.includes(p.host)) throw new Error(`${s.label}: the terms on record are ${p.host}'s, not this source's`);
    } else if (!p.grantedBy || !p.on) throw new Error(`${s.label}: a network source needs the site's permission on record`);
    for (const host of BLOCKED_HOSTS) {
      if (s.id.includes(host) && (p.kind === "terms" || p.host !== host)) throw new Error(`${s.label}: ${host} forbids automated access without its permission`);
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
