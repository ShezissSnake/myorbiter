// Types for dependency-licences.mjs (plain JavaScript, so a build runs it with Node alone).

export const REPO: string;
export const ALLOWED_FILE: string;
export const NO_TEXT_FILE: string;
export const PROGRAMS: Record<"myorbiter" | "tennoscope", { name: string; cargo: string; pkg: string; out: string; page: { root: string; config: string; lock: "npm" | "pnpm"; install: string } }>;
export const TARGETS: Record<string, string>;

export type Tree = { id: string; with?: string } | { or: Tree[] } | { and: Tree[] };
export function parseExpression(text: unknown): Tree;
export function readAllowed(text: string, name?: string): Set<string>;
export function treeAllowed(tree: Tree, allowed: Set<string>): boolean;
export function licenceAllowed(expression: string | null, allowed: Set<string>, name?: string): { allowed: true } | { allowed: false; why: string };

export function isLicenceText(name: string): boolean;
export function isNotice(name: string): boolean;

export interface Text { file: string; path?: string; sha256: string; licence: boolean }
export interface Package {
  kind: "rust" | "npm";
  name: string;
  version: string;
  licence: string | null;
  licenceForm: string | null;
  source: string;
  texts: Text[];
}
export interface NoTextEntry {
  name: string;
  version: string;
  licence: string;
  used?: string;
  text: { sha256: string; from?: string } | null;
  why?: string;
  upstream?: string;
}
export interface Supplied { name: string; version: string; carry: { from: Package; file: string; sha256: string } | null; entry: NoTextEntry }
export function gate(packages: Package[], allowed: Set<string>, noText: { crates: NoTextEntry[] }, names?: { allowed: string; noText: string }): { failures: string[]; supplied: Supplied[] };
export function renderList(program: "myorbiter" | "tennoscope", target: string, packages: Package[], supplied: Supplied[]): { list: string; files: { name: string; from: Package; file: string; sha256: string }[] };
export function checkList(dir: string, program: string, target: string): string[];

export function readTexts(dir: string, extra?: string[]): Text[];
export function parseCargoTree(text: string): { name: string; version: string; source: string | null; licence: string | null }[];
export function packageDir(id: string): string | null;
export function pnpmResolutions(text: string): Map<string, string>;
export function readRust(program: "myorbiter" | "tennoscope", target: string, repo?: string): Package[];
export const PREPROCESSORS: string[];
export function pageRecorder(root: string, helpers?: { vite: string | null; rolldown: string | null }): {
  plugin: {
    name: string;
    enforce: "pre";
    config(config: { worker?: { plugins?: () => unknown[] } }): void;
    transform(code: string, id: string): null;
    generateBundle(options: unknown, bundle: Record<string, unknown>): void;
  };
  read(path: string, stack: string): void;
  rendered: Map<string, Set<"js" | "css" | "asset" | "file">>;
  unknown: Set<string>;
  unheard(): string[];
};
export function listenToReads(onRead: (path: string, stack: string) => void): () => void;
export function readPage(program: "myorbiter" | "tennoscope", repo?: string): Promise<{ packages: Package[]; failures: string[] }>;
export function main(argv: string[], env?: Record<string, string | undefined>): Promise<number>;
