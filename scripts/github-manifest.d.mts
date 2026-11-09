// Types for github-manifest.mjs (plain JavaScript, so the Release workflow runs it with Node alone).
import type { Manifest } from "./updater-manifest.mjs";

export function releaseFolder(repo: string, version: string): string;
export function buildGithubManifest(o: { dir: string; version: string; repo: string; commit?: string | null; notes?: string; pubkey: string; date?: Date }): Manifest;
export function checkGithubManifest(manifest: unknown, o: { version?: string | null; require?: string[]; repo: string }): string[];
