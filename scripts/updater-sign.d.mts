// Types for updater-sign.mjs (plain JavaScript, so CI runs it with Node alone).
import type { KeyObject } from "node:crypto";

export const UNTRUSTED_COMMENT: string;
export interface SecretKey {
  keyId: Buffer;
  privateKey: KeyObject;
  publicKey: Buffer;
}
export function scryptParams(opslimit: bigint | number, memlimit: bigint | number): { N: number; r: number; p: number };
export function decodeSecretKey(text: string, password?: string): SecretKey;
export function assertKeyMatches(key: SecretKey, pubkeyText: string): void;
export function signData(data: Buffer | Uint8Array, o: { fileName: string; version: string; key: SecretKey; timestamp?: number }): string;
