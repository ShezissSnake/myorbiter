// Types for scripts/issues-digest.mjs, for the tests.
export declare const MAX_BODY: number;
export declare const MAX_COMMENT: number;
export declare const MAX_TITLE: number;
export declare const BLOB_BASE64: number;
export declare const BLOB_HEX: number;
export declare const FLAGS: [name: string, re: RegExp][];
export declare function stripHiddenChars(s: unknown): { text: string; removed: number };
export declare function hostOf(url: string): string | null;
export declare function stripHiddenMarkup(s: string): { text: string; notes: string[] };
export declare function defangLinks(s: string): string;
export declare function collapseBlobs(s: string): { text: string; collapsed: number };
export declare function flagsOf(line: string): string[];
export declare function cleanBody(raw: unknown, max?: number): { text: string; notes: string[]; flagged: number };
export declare function cleanLogin(author: unknown): string;
export declare function issuesOf(data: unknown): Record<string, unknown>[];
export declare function digest(data: unknown, opts?: { maxBody?: number; maxComment?: number }): string;
