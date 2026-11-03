// Nox's Frame for the app: one source, made and registered once (the Builds page's first mount),
// so the builds core's sourceBuilds includes the builds already opened. Reads go through
// backend.ts's noxFetcher (the Rust side: spaced 3 s apart, kept a week).
//
// Development only: window.__nox(fetcher) swaps the fetcher for a fake (the browser dev build has
// no Rust side; what the fake leaves out stays real), window.__nox(null) puts the real one back.
import { makeNox, registerSource, type Nox, type NoxFetcher } from "./core/builds";
import { noxFetcher } from "./backend";

let fetcher: NoxFetcher = noxFetcher;
/** Reads through whichever fetcher is current, so a swap reaches the source already registered. */
const via: NoxFetcher = {
  list: (item, refresh) => fetcher.list(item, refresh),
  build: (path, opts) => fetcher.build(path, opts),
  decode: (code) => fetcher.decode(code),
};

let made: Nox | null = null;
let isOn: () => boolean = () => false;

/** The Nox's Frame source, registered on the first call. `enabled` reads settings.buildsFromNox (the latest call's is kept). */
export function useNox(enabled: () => boolean): Nox {
  isOn = enabled;
  if (!made) {
    made = makeNox(via, () => isOn());
    registerSource(made.source);
  }
  return made;
}

/** A pasted build code's JSON (no network). */
export const noxDecode = (code: string): Promise<unknown> => via.decode(code);

if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __nox: (f: Partial<NoxFetcher> | null) => void }).__nox = (f) => {
    fetcher = f ? { ...noxFetcher, ...f } : noxFetcher;
  };
}
