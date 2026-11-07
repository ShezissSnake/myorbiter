// Types for updater-manifest.mjs (plain JavaScript, so CI runs it with Node alone).
import type { KeyObject } from "node:crypto";

export const PLATFORMS: Record<string, RegExp>;
export const LINES_MAX: number;
export const LINE_MAX: number;
export const NOTES_MAX: number;

export function formatNotes(subjects: string[]): string;

export function parsePubkey(text: string): { keyId: Buffer; key: KeyObject };
export function parseSignature(text: string): { prehashed: boolean; keyId: Buffer; sig: Buffer; trusted: string; global: Buffer };
export function signedVersion(trusted: string): string | null;
export function verifySignature(data: Buffer | Uint8Array, signatureText: string, pubkeyText: string, version: string | null): string;
export function pubkeyFromConfig(path: string): string;

export function findAssets(names: string[]): Record<string, { file: string; sig: string }>;
export function rfc3339(d: Date | number | string): string;

export interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  commit?: string;
  platforms: Record<string, { signature: string; url: string }>;
}
export function checkBase(base: string, version: string | null): string;
export function buildManifest(o: { dir: string; version: string; base: string; commit?: string | null; notes?: string; pubkey: string; date?: Date }): Manifest;
export function checkManifest(manifest: unknown, o?: { version?: string | null; require?: string[]; base?: string | null }): string[];
