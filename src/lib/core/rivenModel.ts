// orbiter's riven price model: what a riven like yours is listed for on warframe.market, worked
// out from its stats and how good each roll is, its weapon's riven kind, cycles, mastery, rank
// and polarity, what the weapon's rivens traded for in game last week and what the cheapest 60
// listed for it ask now. Gradient-boosted trees on the log of the price, trained offline on
// tens of thousands of listings (scripts/riven-model/train.py) and walked here: a middle guess
// and a lower and upper quartile. Asking prices, not sales: warframe.market keeps no record of
// what rivens sold for.

export interface Trees {
  base: number;
  /** Per tree, per node: feature (-1 for a leaf), threshold (<= goes left), left, right, leaf value. */
  trees: { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] }[];
}

export interface RivenModel {
  version: number;
  trained: string;
  listings: number;
  weapons: number;
  features: string[];
  stats: string[];
  negs: string[];
  /** The 95th percentile of each stat's value, by riven kind, buff count and curse: what "a top roll" is. */
  ref: Record<string, number>;
  cap: number;
  mid: Trees;
  lo: Trees;
  hi: Trees;
}

/** One riven as the model takes it: warframe.market's way of writing its stats (see auctionItemFor). */
export interface ModelInput {
  /** warframe.market's riven kind for the weapon: rifle, shotgun, pistol, melee, archgun, kitgun, zaw. */
  rivenType: string;
  attributes: { url_name: string; value: number; positive: boolean }[];
  rerolls: number;
  mr: number;
  rank: number;
  polarity: string;
  /** What the weapon's rivens (cycled or not, like this one) traded for in game last week, and DE's popularity figure. */
  weeklyMedian: number | null;
  weeklyPop: number;
  /** The middle asking price of the cheapest 60 rivens listed for the weapon now. */
  cheap60: number;
}

const TYPES = ["rifle", "shotgun", "pistol", "melee", "archgun", "kitgun", "zaw"];
const POLS = ["madurai", "vazarin", "naramon"];

/** The numbers the trees read, in the model's order (the same as train.py's `features`). */
export function featurize(model: RivenModel, x: ModelInput): number[] {
  const pos = x.attributes.filter((a) => a.positive);
  const neg = x.attributes.find((a) => !a.positive)?.url_name ?? null;
  const cfg = `${x.rivenType}|${pos.length}|${neg ? 1 : 0}`;
  const q = new Map<string, number>();
  for (const a of pos) {
    const ref = model.ref[`${cfg}|${a.url_name}`];
    q.set(a.url_name, ref ? Math.min(model.cap, Math.abs(a.value) / ref) : 0.7);
  }
  const cheap = Math.log(x.cheap60);
  const v: Record<string, number> = {
    wk_med: x.weeklyMedian != null && x.weeklyMedian > 0 ? Math.log(x.weeklyMedian) : cheap,
    wk_pop: Math.log1p(x.weeklyPop),
    cheap60: cheap,
    rerolls: Math.log1p(x.rerolls),
    mr: x.mr,
    maxed: x.rank >= 8 ? 1 : 0,
    npos: pos.length,
    hasneg: neg ? 1 : 0,
    qmean: q.size ? [...q.values()].reduce((a, b) => a + b, 0) / q.size : 0,
  };
  for (const t of TYPES) v[`t_${t}`] = x.rivenType === t ? 1 : 0;
  for (const p of POLS) v[`pol_${p}`] = x.polarity === p ? 1 : 0;
  for (const s of model.stats) v[`q_${s}`] = q.get(s) ?? 0;
  for (const n of model.negs) v[`n_${n}`] = neg === n ? 1 : 0;
  return model.features.map((f) => v[f] ?? 0);
}

export function walk(t: Trees, x: number[]): number {
  let s = t.base;
  for (const tree of t.trees) {
    let i = 0;
    while (tree.f[i] !== -1) i = x[tree.f[i]] <= tree.t[i] ? tree.l[i] : tree.r[i];
    s += tree.v[i];
  }
  return s;
}

export interface Estimate {
  /** The middle guess, and the quartiles: most rivens like it are listed between lo and hi. */
  mid: number;
  lo: number;
  hi: number;
  /** What each stat does to the guess: the guess with it against the guess with that stat at nothing. */
  factors: { slug: string; positive: boolean; ratio: number }[];
}

const round = (p: number) => (p < 20 ? Math.round(p) : p < 200 ? Math.round(p / 5) * 5 : p < 2000 ? Math.round(p / 10) * 10 : Math.round(p / 50) * 50);

export function estimate(model: RivenModel, input: ModelInput): Estimate {
  const x = featurize(model, input);
  const mid = walk(model.mid, x);
  // The quartile models are trained apart: keep them either side of the middle.
  const lo = Math.min(walk(model.lo, x), mid);
  const hi = Math.max(walk(model.hi, x), mid);
  const factors: Estimate["factors"] = [];
  const idx = (f: string) => model.features.indexOf(f);
  for (const a of input.attributes) {
    const i = idx(a.positive ? `q_${a.url_name}` : `n_${a.url_name}`);
    if (i < 0) continue;
    const without = [...x];
    without[i] = 0;
    factors.push({ slug: a.url_name, positive: a.positive, ratio: Math.exp(mid - walk(model.mid, without)) });
  }
  return { mid: round(Math.exp(mid)), lo: round(Math.exp(lo)), hi: round(Math.exp(hi)), factors };
}

/** The middle asking price of the cheapest 60 listed (as orbiter's "any riven for this weapon" search returns them). */
export function cheap60(prices: (number | null)[]): number | null {
  const ps = prices.filter((p): p is number => p != null && p > 0).sort((a, b) => a - b).slice(0, 60);
  if (ps.length < 5) return null;
  const m = ps.length >> 1;
  return ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
}
