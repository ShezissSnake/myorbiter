<script lang="ts" module>
  import type { Have } from "../../core/builds";
  /** The mark for what you hold of a slot's mod or arcane, and what it says. */
  export const HAVE_MARK: Record<Have, { mark: string; word: string }> = {
    ok: { mark: "✓", word: "You have it" },
    short: { mark: "!", word: "Not ranked enough, or too few copies" },
    missing: { mark: "✕", word: "You don't have it" },
    unknown: { mark: "?", word: "MyOrbiter can't tell" },
  };
</script>

<script lang="ts">
  // A build as the Arsenal lays it out: the aura, stance and exilus slots on top, the mod slots in
  // rows of four (five for companions), then the arcanes, Archon shards and the Helminth. Each mod
  // shows its art, name, rank pips and drain, the drain green on its own polarity and red on another
  // (as in game), the slot's polarity under the tier's Forma plan, and what you hold of it.
  import type { Model } from "../../core/model";
  import { polarityOf, POLARITY_LABEL, slotLayout, type Build, type BuildMod, type MissingReport, type Polarity, type SlotRef, type TierResult } from "../../core/builds";
  import { imageUrl } from "../../backend";
  import { helminthShow, shardSlots, type ShardShow } from "../../core/buildsPage";

  let {
    model,
    build,
    tier,
    report = null,
    why = null,
    shards: givenShards = null,
    helminth: givenHelminth = null,
  }: {
    model: Model;
    build: Build;
    tier: TierResult;
    report?: MissingReport | null;
    /** Why each slot holds what it holds (MyOrbiter's suggestion), by slot. */
    why?: { aura?: string; exilus?: string; stance?: string; mods: (string | null)[]; arcanes: string[] } | null;
    /** The shard slots, when the card has them from MyOrbiter's suggestion (else the build's own). */
    shards?: (ShardShow | null)[] | null;
    /** The Helminth ability, likewise. */
    helminth?: { ability: string; replaces: string; reason: string | null; owned: boolean | null } | null;
  } = $props();

  const layout = $derived(slotLayout(build.kind));
  const haveOf = (path: string, kind: "mod" | "arcane"): Have | null => report?.lines.find((l) => l.kind === kind && l.path === path)?.have ?? null;
  const lineOf = (path: string, kind: "mod" | "arcane") => report?.lines.find((l) => l.kind === kind && l.path === path) ?? null;

  interface Tile {
    ref: SlotRef;
    label: string;
    mod: BuildMod | null;
    name: string;
    rarity: string;
    image: string | null;
    max: number;
    rank: number;
    modPol: Polarity | null;
    slotPol: Polarity | null;
    drain: number | null;
    forma: boolean;
    have: Have | null;
    held: number | null;
    why: string | null;
  }

  function tile(ref: SlotRef, label: string, mod: BuildMod | null | undefined, why: string | null | undefined): Tile {
    const at = tier.slots.find((s) => s.slot === ref);
    const forma = tier.formaPlan.some((f) => f.slot === ref);
    if (!mod) return { ref, label, mod: null, name: "", rarity: "", image: null, max: 0, rank: 0, modPol: null, slotPol: at?.polarity ?? null, drain: null, forma, have: null, held: null, why: null };
    const c = model.catalogByUnique.get(mod.path);
    const name = c?.name ?? model.nameOf(mod.path);
    const max = c?.maxRank ?? 0;
    const line = lineOf(mod.path, "mod");
    return {
      ref, label, mod, name,
      rarity: c?.rarity ?? "",
      image: model.imageOf(name),
      max,
      rank: Math.max(0, Math.min(max, mod.rank ?? max)),
      modPol: polarityOf(c?.polarity),
      slotPol: at?.polarity ?? null,
      drain: at?.drain ?? null,
      forma,
      have: line?.have ?? null,
      held: line?.heldRank ?? null,
      why: why ?? null,
    };
  }

  const top = $derived([
    ...(layout.aura ? [tile("aura", "Aura", build.aura, why?.aura)] : []),
    ...(layout.stance ? [tile("stance", "Stance", build.stance, why?.stance)] : []),
    ...(layout.exilus ? [tile("exilus", "Exilus", build.exilus, why?.exilus)] : []),
  ]);
  const mods = $derived(Array.from({ length: layout.mods }, (_, i) => tile(i + 1, `Slot ${i + 1}`, build.mods[i], why?.mods[i])));
  const cols = $derived(layout.mods === 10 ? 5 : 4);
  const arcanes = $derived(
    Array.from({ length: Math.max(layout.arcanes, build.arcanes.length) }, (_, i) => {
      const a = build.arcanes[i];
      if (!a) return null;
      const c = model.catalogByUnique.get(a.path);
      const name = c?.name ?? model.nameOf(a.path);
      const max = c?.maxRank && c.maxRank > 0 ? c.maxRank : 5;
      const line = lineOf(a.path, "arcane");
      return { name, rarity: c?.rarity ?? "", image: model.imageOf(name), rank: Math.max(0, Math.min(max, a.rank ?? max)), max, have: haveOf(a.path, "arcane"), held: line?.held ?? null, need: line?.need ?? null, why: why?.arcanes[i] ?? null };
    }),
  );
  const shards = $derived(givenShards ?? shardSlots(build, null));
  const helminth = $derived(givenHelminth ?? helminthShow(build, null));

  const tone = (r: string) => (/legendary|primed/i.test(r) ? "legendary" : /rare/i.test(r) ? "rare" : /uncommon/i.test(r) ? "uncommon" : "common");
  const polImg = (p: Polarity) => `/game/pol/${p === "universal" ? "any" : p}.png`;
  /** The drain's colour, as the game shows it: green on its own polarity, red on another. */
  const fit = (t: Tile) => (!t.slotPol || !t.modPol || t.modPol === "universal" ? "" : t.slotPol === t.modPol || (t.slotPol === "universal" && t.modPol !== "umbra") ? "match" : "clash");
  function tipOf(t: Tile): string {
    if (!t.mod) return `${t.label}: empty${t.slotPol ? ` (${POLARITY_LABEL[t.slotPol]} slot)` : ""}`;
    const bits = [
      `${t.name}${t.rarity ? ` · ${t.rarity}` : ""}`,
      t.max ? `Rank ${t.rank} of ${t.max}` : "",
      t.drain != null ? (t.drain < 0 ? `Adds ${-t.drain} capacity` : `Drains ${t.drain}`) + (t.slotPol ? ` in a ${POLARITY_LABEL[t.slotPol]} slot` : " in a slot without polarity") : "",
      t.forma ? `A Forma goes here (${t.slotPol ? POLARITY_LABEL[t.slotPol] : "for rank"})` : "",
      t.have ? `${HAVE_MARK[t.have].word}${t.have === "short" && t.held != null ? `: yours is rank ${t.held}` : ""}` : "",
      t.why ?? "",
    ];
    return bits.filter(Boolean).join("\n");
  }
  const SHARD_TINT: Record<string, string> = { crimson: "#d0574a", azure: "#6ea8dc", amber: "#e2a94a", violet: "#a78bd4", topaz: "#d98b3a", emerald: "#6fb77a" };
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  function shardTip(s: ShardShow): string {
    const head = `${s.tauforged ? "Tauforged " : ""}${cap(s.colour)} Archon Shard${s.stat ? `: ${s.stat}` : ""}`;
    const held = s.owned === true ? "You hold one (a filled gem)." : s.owned === false ? "You don't hold one yet (an outlined gem)." : "";
    return [head, s.reason && s.reason !== s.stat ? s.reason : "", held, s.fuse ?? ""].filter(Boolean).join("\n");
  }
</script>

{#snippet slot(t: Tile, wide = false)}
  <div class="slot t-{tone(t.rarity)} {t.have ?? ''}" class:empty={!t.mod} class:wide title={tipOf(t)}>
    {#if t.mod}
      <span class="art">{#if t.image}<img src={imageUrl(t.image)} alt="" loading="lazy" decoding="async" />{/if}</span>
      <!-- The drain on its own line in the corner, above the name, as the game's mod card has it. -->
      <span class="body">
        <span class="drain {fit(t)}">{#if t.drain != null}{t.drain < 0 ? `+${-t.drain}` : t.drain}{/if}{#if t.modPol}<img src={polImg(t.modPol)} alt={POLARITY_LABEL[t.modPol]} />{/if}</span>
        <b class="nm">{t.name}</b>
        {#if t.max}<span class="pips" aria-label="Rank {t.rank} of {t.max}">{#each Array.from({ length: Math.min(10, t.max) }, (_, i) => i) as i (i)}<i class:on={i < t.rank}></i>{/each}</span>{/if}
      </span>
      {#if t.have && t.have !== "ok"}<span class="have" aria-label={HAVE_MARK[t.have].word}>{HAVE_MARK[t.have].mark}</span>{/if}
    {:else}
      <span class="hole">{t.label}</span>
    {/if}
    <!-- The slot's own polarity under this tier's plan; ringed where a Forma puts it. -->
    {#if t.slotPol}<span class="spol" class:forma={t.forma}><img src={polImg(t.slotPol)} alt="{POLARITY_LABEL[t.slotPol]} slot" /></span>{:else if t.forma}<span class="spol forma" aria-label="Forma for rank">F</span>{/if}
  </div>
{/snippet}

<div class="grid" style:--cols={cols}>
  {#if top.length}
    <div class="top">
      {#each top as t (t.ref)}<div class="cell"><span class="register cap">{t.label}</span>{@render slot(t, true)}</div>{/each}
    </div>
  {/if}
  {#if mods.length}
    <div class="mods">{#each mods as t (t.ref)}{@render slot(t)}{/each}</div>
  {/if}
  {#if arcanes.length || shards.length || helminth}
    <div class="extras">
      {#if arcanes.length}
        <div class="group">
          <span class="register cap">Arcanes</span>
          <div class="arcs">
            {#each arcanes as a, i (i)}
              {#if a}
                <span class="arc t-{tone(a.rarity)} {a.have ?? ''}" title="{a.name}{a.max ? ` · rank ${a.rank} of ${a.max}` : ''}{a.have ? `\n${HAVE_MARK[a.have].word}${a.need != null && a.held != null && a.have !== 'ok' ? `: ${a.held} of ${a.need} copies` : ''}` : ''}{a.why ? `\n${a.why}` : ''}">
                  <span class="hex">{#if a.image}<img src={imageUrl(a.image)} alt="" loading="lazy" decoding="async" />{/if}</span>
                  <span class="an"><b>{a.name.replace(/^Arcane /, "")}</b><small>R{a.rank}</small></span>
                  {#if a.have && a.have !== "ok"}<span class="have">{HAVE_MARK[a.have].mark}</span>{/if}
                </span>
              {:else}<span class="arc none" title="Arcane slot: empty"><span class="hex"></span><span class="an dim"><small>Empty</small></span></span>{/if}
            {/each}
          </div>
        </div>
      {/if}
      {#if shards.length}
        <div class="group">
          <span class="register cap">Archon shards</span>
          <div class="shards">
            {#each shards as s, i (i)}
              {#if s}<span class="shard" class:tau={s.tauforged} class:missing={s.owned === false} style:--tint={SHARD_TINT[s.colour]} title={shardTip(s)} aria-label={shardTip(s).split("\n")[0]}>{#if s.fuse}<span class="fuse" aria-hidden="true"></span>{/if}</span>
              {:else}<span class="shard none" title="Shard slot: empty"></span>{/if}
            {/each}
          </div>
        </div>
      {/if}
      {#if helminth}
        <div class="group helm" title="Helminth: {helminth.ability} replaces {helminth.replaces}{helminth.reason ? `\n${helminth.reason}` : ''}{helminth.owned === null && helminth.reason ? `\nMyOrbiter can't see your Helminth yet` : ''}">
          <span class="register cap">Helminth</span>
          <span class="hx"><b>{helminth.ability}</b> <span class="dim">for {helminth.replaces}</span></span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The Arsenal's mod screen: a sunk plate, slots as small cut plates in rows. */
  .grid { display: grid; gap: .7rem; padding: .8rem; background: var(--well); border: 1px solid var(--rule); box-shadow: var(--struck); }
  .top { display: flex; justify-content: space-between; gap: .6rem; }
  .top .cell { display: grid; gap: .25rem; width: calc((100% - 1.8rem) / 4); min-width: 9rem; }
  .cap { font-size: .56rem; letter-spacing: .16em; }
  .mods { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: .45rem; }

  .slot {
    --edge: var(--rarity-common);
    position: relative; min-width: 0; height: 3.6rem;
    display: grid; grid-template-columns: 2.3rem minmax(0, 1fr); align-items: center; gap: .45rem;
    padding: .25rem .35rem .25rem .3rem;
    background: linear-gradient(180deg, var(--raised), var(--plate));
    border: 1px solid color-mix(in srgb, var(--edge) 55%, transparent);
    border-top: 2px solid var(--edge);
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%);
  }
  .t-uncommon { --edge: var(--rarity-uncommon); }
  .t-rare { --edge: var(--rarity-rare); }
  .t-legendary { --edge: var(--rarity-legendary); }
  .slot.empty { display: grid; grid-template-columns: 1fr; place-items: center; background: transparent; border: 1px dashed var(--rule-bright); border-top-width: 1px; }
  .hole { font-family: var(--face-register); font-size: .67rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); }
  .art { width: 2.3rem; height: 2.3rem; overflow: hidden; background: radial-gradient(circle at 50% 35%, var(--rule), var(--well) 80%); border: 1px solid color-mix(in srgb, var(--edge) 35%, transparent); }
  .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .body { display: grid; grid-template-rows: auto auto 1fr; gap: .12rem; min-width: 0; align-self: stretch; }
  .nm { font-family: var(--face-mark); font-weight: 700; font-size: .76rem; line-height: 1; letter-spacing: .01em; text-transform: uppercase; color: var(--edge); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .pips { display: flex; align-self: end; gap: 2px; flex-wrap: nowrap; padding: 0 1.1rem .1rem 0; }
  /* Diamonds without an outline (ten fit beside the slot's polarity): unlit ones a faint fill. */
  .pips i { width: 4px; height: 4px; flex: none; transform: rotate(45deg); background: color-mix(in srgb, var(--edge) 22%, transparent); }
  .pips i.on { background: var(--edge); }
  /* The drain in the corner: green on its own polarity, red on another, as in game. */
  .drain { justify-self: end; display: inline-flex; align-items: center; gap: 2px; min-height: .7rem; font-family: var(--face-figures); font-size: .7rem; font-weight: 600; line-height: 1; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
  .drain img { width: .7rem; height: .7rem; filter: brightness(1.5); opacity: .85; }
  .drain.match { color: var(--verdigris); }
  .drain.clash { color: var(--oxblood); }
  /* The slot's own polarity, bottom right; a gold ring where a Forma puts it. */
  .spol { position: absolute; right: .3rem; bottom: .25rem; width: .95rem; height: .95rem; display: grid; place-items: center; font-family: var(--face-register); font-size: .66rem; color: var(--gold); }
  .spol img { width: .72rem; height: .72rem; opacity: .55; }
  .spol.forma { border: 1px solid var(--gold); border-radius: 50%; }
  .spol.forma img { opacity: 1; filter: sepia(1) saturate(3) hue-rotate(5deg) brightness(1.1); }
  .slot.empty .spol { position: static; width: 1.3rem; height: 1.3rem; }
  .slot.empty:has(.spol) .hole { display: none; }
  .slot.empty .spol img { width: 1rem; height: 1rem; opacity: .4; }
  /* What you hold: missing dashed and dimmed with a red mark, short with an amber one. */
  .have { position: absolute; left: .3rem; bottom: .25rem; width: .95rem; height: .95rem; display: grid; place-items: center; font-size: .6rem; font-weight: 700; color: var(--slab); background: var(--oxblood); }
  .slot.missing { border-style: dashed; border-top-style: solid; }
  .slot.missing .art { opacity: .45; }
  .slot.short .have, .arc.short .have { background: var(--alert); }
  .slot.unknown .have, .arc.unknown .have { background: var(--platinum-deep); }

  .extras { display: flex; flex-wrap: wrap; align-items: flex-start; gap: .6rem 1.6rem; padding-top: .55rem; border-top: 1px solid var(--rule); }
  .group { display: grid; gap: .3rem; }
  .arcs { display: flex; flex-wrap: wrap; gap: .5rem; }
  .arc { --edge: var(--rarity-legendary); position: relative; display: inline-flex; align-items: center; gap: .45rem; min-width: 0; }
  .hex { width: 2.2rem; height: 2.2rem; flex: none; clip-path: polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%); background: color-mix(in srgb, var(--edge) 70%, transparent); display: grid; place-items: center; }
  .hex img { width: 86%; height: 86%; object-fit: contain; clip-path: inherit; background: var(--plate); }
  .arc.none .hex { background: var(--rule-bright); }
  .an { display: grid; line-height: 1.1; }
  .an b { font-family: var(--face-mark); font-size: .8rem; text-transform: uppercase; color: var(--platinum); }
  .an small { font-family: var(--face-register); font-size: .72rem; color: var(--platinum-deep); letter-spacing: .08em; }
  .arc .have { left: auto; right: -.4rem; top: -.2rem; bottom: auto; }
  .arc.missing .hex { opacity: .5; }
  .shards { display: flex; gap: .45rem; padding-top: .1rem; }
  /* Archon shards: the game's cut gems, in their colours; a Tauforged one brighter, with a light core. */
  .shard { position: relative; width: 1.25rem; height: 1.55rem; }
  .shard::before { content: ""; position: absolute; inset: 0; background: var(--tint); clip-path: polygon(50% 0, 100% 30%, 100% 70%, 50% 100%, 0 70%, 0 30%); opacity: .85; }
  .shard.tau::before { opacity: 1; filter: saturate(1.3) brightness(1.15); background: radial-gradient(circle at 50% 38%, rgb(255 255 255 / 55%), transparent 38%), var(--tint); }
  .shard.none::before { background: var(--rule-bright); opacity: .6; }
  /* One you don't hold: the gem's outline only, as an empty socket in its colour. */
  .shard.missing::after { content: ""; position: absolute; inset: 2px; background: var(--well); clip-path: polygon(50% 0, 100% 30%, 100% 70%, 50% 100%, 0 70%, 0 30%); }
  /* You hold plain shards of this colour to fuse into it: a gold dot (the tooltip says how). */
  .fuse { position: absolute; left: -.2rem; top: -.15rem; width: .38rem; height: .38rem; border-radius: 50%; background: var(--gold); }
  .hx b { font-family: var(--face-mark); text-transform: uppercase; font-size: .86rem; }
  .hx .dim { font-size: .78rem; }
  :global(html[data-room~="lt640"]) .mods { grid-template-columns: repeat(2, minmax(0, 1fr)); }
</style>
