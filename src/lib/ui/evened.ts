// The sidebar's pictures evened out by eye: each is drawn so its shape (not its file's empty
// margin) fills its box, centred on the shape's own middle, then shrunk a little if it is dense
// (k = √(0.42 / coverage), kept between 0.8 and 1), so a solid coin and a thin glyph read as the
// same size. Measured from the files in public/game/: the shape's bounds and its mean alpha.
// s: the scale; x, y: the shift, in percent of the box. A picture not listed is drawn as it is.
import type { GameIconName } from "./GameIcon.svelte";

const EVEN: Partial<Record<GameIconName, [s: number, x: number, y: number]>> = {
  dojo: [1.164, 0, 2.7],
  "fissure-canister": [1, 0, 0],
  "relic-axi-intact": [1.1, 0.4, 0],
  "planner-slate": [0.8, 0, 0],
  mastered: [1, 0, 0],
  foundry: [1, 0, 0],
  forma: [0.944, 0, 0],
  wishlist: [1, 0, 0],
  locker: [0.918, 0, 0],
  ducats: [1.143, -0.4, 0],
  "prime-plate": [1, 0, 0],
  endo: [0.966, 0, 0],
  vosfor: [1.058, 3.3, -1.2],
  riven: [1, 0, 0.8],
  market: [1.231, 12.5, -11.5],
  duplicates: [0.871, 0.7, 0],
  "browse-lens": [1, 0, 0],
  platinum: [0.898, 0.7, -0.7],
  player: [0.99, 0.8, 0],
  // The sections' crests and the foot.
  "void-tear": [1.255, 0, 0],
  "mastery-mark": [1, 0, 0],
  bundle: [0.975, 0, 0],
  trading: [1, 0, 0],
  "refresh-timer": [1, 0, 0],
  mail: [0.917, 0, 0.7],
  menu: [1, 0, 0],
};

/** The CSS transform that evens a picture out in its box, or null when it needs none. */
export function evenTransform(name: GameIconName): string | null {
  const e = EVEN[name];
  if (!e || (e[0] === 1 && !e[1] && !e[2])) return null;
  const [s, x, y] = e;
  return `translate(${x}%, ${y}%) scale(${s})`;
}
