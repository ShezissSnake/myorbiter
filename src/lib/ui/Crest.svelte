<script lang="ts">
  // A section's crest: two squares turned to diamonds, the inner in the section's colour with a
  // faint fill and glow, and inside it the game's own glyph for the section, drawn flat in the
  // section's colour. The same mark in the page head (PageHead, 104 px) and on the section's bar in
  // the sidebar (32 px), so the bar and the page keep one mark. Takes its colour from `--sec`.
  import { SECTION_GLYPH, type Page } from "../pages";
  import { evenTransform } from "./evened";

  let { section, size }: { section: Exclude<Page["group"], "">; size: number } = $props();
  const glyph = $derived(SECTION_GLYPH[section]);
  // At bar size the frames sit closer in and the glyph is drawn larger than strict scale, so it
  // still reads at 32 px.
  const big = $derived(size >= 64);
  const look = $derived(`-webkit-mask-image: url(/game/${glyph}.png); mask-image: url(/game/${glyph}.png);${evenTransform(glyph) ? ` transform: ${evenTransform(glyph)};` : ""}`);
</script>

<span class="crest" class:big style:--size="{size}px" aria-hidden="true">
  <i class="outer"></i><i class="inner"></i>
  <span class="glyph"><span class="g" style={look}></span></span>
</span>

<style>
  .crest {
    --o: .125; --i: .22; --g: .47; --edge: var(--rule-bright); --glow: 8px;
    position: relative; flex: none; width: var(--size); height: var(--size); display: grid; place-items: center; color: var(--sec);
  }
  .crest.big { --o: .154; --i: .25; --g: .36; --edge: var(--rule); --glow: 14px; }
  .crest i { position: absolute; transform: rotate(45deg); }
  .outer { inset: calc(var(--size) * var(--o)); border: 1px solid var(--edge); }
  .inner {
    inset: calc(var(--size) * var(--i)); border: 1px solid color-mix(in srgb, var(--sec) 58%, transparent);
    background: color-mix(in srgb, var(--sec) 8%, transparent); box-shadow: 0 0 var(--glow) color-mix(in srgb, var(--sec) 24%, transparent);
  }
  .glyph { position: relative; width: calc(var(--size) * var(--g)); height: calc(var(--size) * var(--g)); }
  /* The game's glyph as a stencil, filled with the section's colour. */
  .g {
    position: absolute; inset: 0; display: block; background: var(--sec);
    -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
    -webkit-mask-position: center; mask-position: center;
  }
</style>
