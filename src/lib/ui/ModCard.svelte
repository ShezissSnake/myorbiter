<script lang="ts">
  // A mod or arcane drawn the way the game draws it, so it's recognised at a glance: the art in a
  // frame the colour of its rarity (bronze, silver, gold, platinum for Primed, violet for Rivens),
  // its drain and polarity in the corner, its name, what it does at max rank, and a pip per rank
  // (filled up to your best copy). Arcanes get the game's hexagonal frame.
  import { imageUrl } from "../backend";

  let {
    name,
    image,
    rarity = "",
    polarity = null,
    drain = null,
    maxRank = null,
    rank = 0,
    label = "",
    does = "",
    width = 120,
    arcane = false,
  }: {
    name: string;
    image: string | null;
    rarity?: string;
    polarity?: string | null;
    drain?: number | null;
    maxRank?: number | null;
    /** Your best copy's rank: pips filled up to it. */
    rank?: number;
    /** What it goes on: "Trinity", "Rifle", "Warframe". */
    label?: string;
    does?: string;
    width?: number;
    arcane?: boolean;
  } = $props();

  let failed = $state(false);
  $effect(() => {
    void image;
    failed = false;
  });
  const tone = $derived(/legendary|primed/i.test(rarity) ? "legendary" : /riven/i.test(rarity) ? "riven" : /rare/i.test(rarity) ? "rare" : /uncommon/i.test(rarity) ? "uncommon" : "common");
  // The game's own markup in effect text.
  const text = $derived(does.replace(/<[^>]+>/g, "").replace(/\|[A-Z_0-9]+\|/g, "").replace(/\s+/g, " ").trim());
  // Ten pips at most fit: arcanes' 5 and most mods' 3 to 10.
  const pips = $derived(Math.min(10, Math.max(0, maxRank ?? 0)));
</script>

<div class="mc t-{tone}" class:arcane style:--w="{width}px" title="{name}{rarity ? ` · ${rarity}` : ''}{text ? `\n${text}` : ''}">
  <div class="art">
    <span class="in">{#if image && !failed}<img src={imageUrl(image, width > 120)} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />{:else}<i class="none" aria-hidden="true"></i>{/if}</span>
    {#if !arcane && (drain != null || polarity)}
      <span class="drain">{#if drain != null}{drain}{/if}{#if polarity}<img src="/game/pol/{polarity}.png" alt={polarity} />{/if}</span>
    {/if}
  </div>
  <div class="plate">
    <b class="nm">{name}</b>
    {#if text && width >= 110}<span class="fx">{text}</span>{/if}
    {#if pips}<span class="pips" aria-label="Rank {rank} of {maxRank}">{#each Array.from({ length: pips }, (_, i) => i) as i (i)}<i class:on={i < rank}></i>{/each}</span>{/if}
    {#if label}<span class="lb">{label}</span>{/if}
  </div>
</div>

<style>
  .mc {
    --edge: #b98a62;
    --glow: rgb(185 138 98 / 22%);
    width: var(--w); flex: none; display: grid; grid-template-rows: auto 1fr; position: relative;
    background: linear-gradient(180deg, #1b1e24, #0f1114);
    border: 1px solid var(--edge); border-radius: 3px 3px 10px 10px;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 60%), 0 4px 14px var(--glow), inset 0 0 12px var(--glow);
    overflow: hidden; font-family: var(--face-text);
  }
  .t-uncommon { --edge: #cfd6de; --glow: rgb(207 214 222 / 18%); }
  .t-rare { --edge: #e9c76b; --glow: rgb(233 199 107 / 24%); }
  .t-legendary { --edge: #eef0ff; --glow: rgb(185 170 255 / 30%); }
  .t-riven { --edge: #b590ea; --glow: rgb(181 144 234 / 30%); }
  .art { position: relative; height: calc(var(--w) * .72); display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 50% 35%, #262a32, #0e1013 80%); }
  .in { position: absolute; inset: 0; display: grid; place-items: center; }
  .in > img { width: 100%; height: 100%; object-fit: cover; }
  .art::after { content: ""; position: absolute; inset: auto 0 0 0; height: 40%; background: linear-gradient(transparent, #121418); }
  .none { width: 22%; height: 22%; border: 1px solid var(--edge); transform: rotate(45deg); opacity: .5; }
  .drain { position: absolute; top: 3px; right: 3px; z-index: 1; display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px; background: rgb(8 9 11 / 75%); border: 1px solid color-mix(in srgb, var(--edge) 55%, transparent); border-radius: 2px; font-size: calc(var(--w) * .095); font-weight: 700; color: var(--edge); line-height: 1.1; }
  .drain img { width: calc(var(--w) * .1); height: calc(var(--w) * .1); filter: brightness(1.6); }
  .plate { display: grid; justify-items: center; align-content: start; gap: calc(var(--w) * .03); padding: calc(var(--w) * .04) calc(var(--w) * .05) calc(var(--w) * .06); text-align: center; border-top: 1px solid color-mix(in srgb, var(--edge) 70%, transparent); }
  .nm { color: var(--edge); font-family: var(--face-mark); font-weight: 700; font-size: calc(var(--w) * .1); line-height: 1.05; text-transform: uppercase; letter-spacing: .02em; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .fx { color: var(--platinum-dim); font-size: calc(var(--w) * .075); line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .pips { display: flex; gap: calc(var(--w) * .022); justify-content: center; flex-wrap: wrap; margin-top: 1px; }
  .pips i { width: calc(var(--w) * .045); height: calc(var(--w) * .045); transform: rotate(45deg); border: 1px solid color-mix(in srgb, var(--edge) 60%, transparent); }
  .pips i.on { background: var(--edge); border-color: var(--edge); }
  .lb { font-family: var(--face-register); font-size: calc(var(--w) * .062); letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  /* Arcanes: the game's hexagon, art round in the middle. */
  .arcane { border-radius: 0; border: 0; box-shadow: none; background: none; overflow: visible; }
  .arcane .art { height: calc(var(--w) * .82); width: calc(var(--w) * .82); justify-self: center; clip-path: polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%); background: var(--edge); }
  .arcane .art::after { display: none; }
  .arcane .in { inset: 2px; clip-path: inherit; background: radial-gradient(circle, color-mix(in srgb, var(--edge) 22%, #15171b), #0d0f12 75%); }
  .arcane .in > img { width: 78%; height: 78%; object-fit: contain; }
  .arcane .plate { border-top: 0; }
</style>
