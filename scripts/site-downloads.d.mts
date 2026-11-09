// Types for site-downloads.mjs (plain JavaScript, so the site builds with Node alone).

export const SLUG: string;
export const REPO: string;
export const HOST: string;
export const API: string;
export const CHANNELS: [key: "stable" | "beta" | "experimental", name: string][];
export function channelManifest(channel: string): string;
export const ROWS: number;
export const FIRST_BUILD: number;
export const FILES: { key: "appimage" | "deb" | "exe"; label: string; re: RegExp }[];

/** A channel's manifest per channel; null (or absent) where its release has none. */
export type Heads = Partial<Record<"stable" | "beta" | "experimental", unknown>>;

export function safeUrl(url: unknown): string | null;
export function checkChannel(channel: string, manifest: unknown): unknown;

export interface Front {
  channel: "stable" | "beta" | "experimental";
  label: string;
  version: string;
  tag: string;
  name: string;
  buttons: { windows: string; linux: string; deck: string };
}
export function frontButtons(heads: Heads): Front;

export interface Row {
  version: string;
  tag: string;
  date: string;
  channel: "Stable" | "Beta" | "Experimental" | null;
  files: Partial<Record<"appimage" | "deb" | "exe", { name: string; url: string }>>;
  sums: string | null;
  notes: string;
}
export function buildRows(releases: unknown, o?: { heads?: Heads }): Row[];
