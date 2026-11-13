// Every state a card or row tag can be in shows its words, readable on its fill. A tag once drew as a
// bare gold bar: the Mastery page's own `.warn { color: var(--gold) }` (for a note) out-ranked the
// global `.tag.warn` (dark words on a gold fill), so the words came out gold on gold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildTag, type BuildTier, type TagForm } from "../src/lib/core/buildPlan";

const root = new URL("..", import.meta.url).pathname;
const css = readFileSync(join(root, "src/app.css"), "utf8");

/** The variables of :root. */
const vars = new Map<string, string>();
for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());
const resolve = (v: string): string => {
  const m = v.match(/^var\((--[\w-]+)\)$/);
  return m ? resolve(vars.get(m[1]) ?? "") : v;
};
const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number];
};
const lum = ([r, g, b]: [number, number, number]) => {
  const c = [r, g, b].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** A `.tag` rule's own colour and fill, as app.css writes them (the plain tag's fill is `--raised`). */
function toneColours(tone: string): { color: string; background: string } {
  const own = css.match(new RegExp(`^\\.tag${tone ? `\\.${tone}` : ""}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(own, `.tag${tone ? "." + tone : ""} has a rule in app.css`);
  const body = own[1];
  const color = body.match(/(?:^|[;\s])color:\s*([^;]+);/)?.[1].trim();
  const background = body.match(/background:\s*([^;]+);/)?.[1].trim();
  const base = css.match(/^\.tag\s*\{([^}]*)\}/m)![1];
  return {
    color: resolve(color ?? base.match(/(?:^|[;\s])color:\s*([^;]+);/)![1].trim()),
    background: resolve(background && !background.startsWith("color-mix") ? background : base.match(/background:\s*([^;]+);/)![1].trim()),
  };
}

test("every build state's tag has words and a tone app.css draws readably (4.5:1)", () => {
  const tiers: BuildTier[] = ["now", "farm", "hard", "parts"];
  const forms: TagForm[] = ["card", "row", "sheet"];
  const shorts = [[], ["Orokin Cell"], ["Narmer Isoplast", "Anomaly Shard"], ["A", "B", "C"]];
  for (const tier of tiers) for (const form of forms) for (const short of shorts) {
    const t = buildTag(tier, short, form);
    assert.match(t.label, /\S{2,}/, `${tier}/${form}/${short.length}: empty label`);
    assert.ok(["ok", "warn", "bad", ""].includes(t.tone));
  }
  // Each tone, measured as app.css draws it.
  for (const tone of ["", "ok", "warn", "bad", "good", "mastery", "alert"]) {
    const { color, background } = toneColours(tone);
    assert.match(color, /^#/, `.tag.${tone} colour: ${color}`);
    const ratio = contrast(color, background);
    assert.ok(ratio >= 4.5, `.tag${tone ? "." + tone : ""}: ${color} on ${background} is ${ratio.toFixed(2)}:1`);
  }
});

test("the card's own wording: the gold farm tag says it", () => {
  assert.equal(buildTag("farm").label, "Parts ready · farm");
  assert.equal(buildTag("farm").tone, "warn");
  assert.equal(buildTag("hard").label, "Parts ready · rare resources");
  assert.equal(buildTag("now").label, "Can build now");
  assert.equal(buildTag("farm", ["Orokin Cell", "Morphics"], "row").label, "Parts ready · farm Orokin Cell +1");
  assert.equal(buildTag("hard", [], "row").label, "Parts ready · rare resources", "a row with nothing named still has words");
});

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? svelteFiles(p) : p.endsWith(".svelte") ? [p] : [];
  });
}

test("no component's own style gives a tone word a colour or fill that beats the global tag's", () => {
  const tones = ["ok", "warn", "bad", "good", "mastery", "alert"];
  const hits: string[] = [];
  for (const file of svelteFiles(join(root, "src"))) {
    const src = readFileSync(file, "utf8");
    const style = src.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1];
    if (!style) continue;
    const markup = src.slice(0, src.indexOf("<style"));
    for (const tone of tones) {
      // The file draws a tag in this tone: `class="tag ok"`, or `class="tag" class:ok={…}`.
      const draws = new RegExp(`class="tag[^"]*\\b${tone}\\b|class="tag[^"]*"[^>]*class:${tone}\\b|class="tag \\{`).test(markup);
      if (!draws) continue;
      for (const rule of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = rule[1].split(",").map((s) => s.trim());
        for (const sel of sels) {
          // A bare `.tone` as the last part of a selector that isn't about a tag.
          if (!new RegExp(`(^|[\\s>+~])\\.${tone}$`).test(sel) || /:global|\\.tag/.test(sel)) continue;
          if (/(^|[;\s])(color|background)\s*:/.test(rule[2])) hits.push(`${file.slice(root.length)}: ${sel} { ${rule[2].trim()} }`);
        }
      }
    }
  }
  assert.deepEqual(hits, [], "a scoped rule for a bare tone word hits the tag drawn in that tone (give the rule another name or write it `.tag.tone`)");
});
