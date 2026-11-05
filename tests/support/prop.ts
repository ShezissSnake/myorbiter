// A seeded random generator and a runner for property tests (tests/property*.test.ts): the same
// cases for the same seed everywhere. PROPERTY_SEED=<n> replays one case, PROPERTY_RUNS=<n> runs more.

/** mulberry32: small, fast, and the same numbers for the same seed everywhere. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    bool: (p = 0.5) => next() < p,
    pick: <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)],
  };
}
export type Rng = ReturnType<typeof rng>;

const RUNS = Number(process.env.PROPERTY_RUNS ?? 3000);
const SEED = process.env.PROPERTY_SEED != null ? Number(process.env.PROPERTY_SEED) : null;

/** Runs `body` over RUNS seeds (or the one in PROPERTY_SEED), naming the seed of a failure. */
export function forAll(name: string, body: (r: Rng, seed: number) => void, runs = RUNS) {
  const seeds = SEED != null ? [SEED] : Array.from({ length: runs }, (_, i) => 0x5eed + i * 7919);
  for (const seed of seeds) {
    try {
      body(rng(seed), seed);
    } catch (e) {
      throw new Error(`${name}: failed for PROPERTY_SEED=${seed}\n${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

