<script lang="ts">
  import { imageUrl } from "../backend";
  import type { PartState } from "../core/collection";
  import { info } from "../hover.svelte";
  // One thing an item is built from, as a round chip: gold ring when you have enough, a dashed ring
  // while it's building, dark when you have none. The number is how many you hold; "1/2" when an
  // item takes more than one and you're short.
  let { part, size = 34 }: { part: PartState; size?: number } = $props();
  const enough = $derived(part.have >= part.required);
  const some = $derived(part.have > 0 && !enough);
  const title = $derived(
    `${part.name}: ${part.resource ? `${part.have.toLocaleString("en")} held, ${part.required} needed` : `${part.have} of ${part.required}`}${part.building ? " · building now" : ""}${part.price != null ? ` · ${Math.round(part.price)}p` : ""}`,
  );
  let failed = $state(false);
  $effect(() => {
    part.image;
    failed = false;
  });
  // 8,484,000 credits is "8.5M", not "8484k".
  const count = (n: number) =>
    n >= 10_000_000 ? `${Math.round(n / 1e6)}M` : n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
</script>

<span class="chip" class:enough class:some class:building={part.building && !enough} class:res={part.resource} class:bp={part.blueprint} style:width="{size}px" style:height="{size}px" aria-label={title} use:info={part.name}>
  {#if part.image && !failed}<img src={imageUrl(part.image)} alt="" loading="lazy" decoding="async" onerror={() => (failed = true)} />{:else}<i class="none"></i>{/if}
  {#if part.have > 0 || part.required > 1}<b class="n" class:short={!enough} title={part.required > 1 || part.resource ? `Held: ${part.have.toLocaleString("en")} of ${part.required.toLocaleString("en")} needed` : `Held: ${part.have}`}>{part.resource || part.have >= 1000 ? count(part.have) : part.required > 1 && part.have < part.required ? `${part.have}/${part.required}` : part.have}</b>{/if}
</span>

<style>
  .chip {
    position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none;
    border-radius: 50%; background: radial-gradient(circle at 50% 35%, var(--raised), var(--well));
    box-shadow: inset 0 0 0 1px var(--rule-bright);
  }
  img { width: 74%; height: 74%; object-fit: contain; border-radius: 50%; opacity: .5; filter: grayscale(.7); }
  .enough img, .some img, .building img { opacity: 1; filter: none; }
  /* The main blueprint shows the item itself, washed blue like the game's blueprint art. */
  .bp img { filter: grayscale(1) sepia(1) hue-rotate(175deg) saturate(3) brightness(.75); opacity: .55; }
  .bp.enough img, .bp.some img, .bp.building img { filter: grayscale(1) sepia(1) hue-rotate(175deg) saturate(3.2) brightness(1); opacity: 1; }
  .enough { box-shadow: inset 0 0 0 1.5px var(--gold); }
  .some { box-shadow: inset 0 0 0 1.5px var(--gold-dim); }
  .building { box-shadow: none; outline: 1.5px dashed var(--platinum-dim); outline-offset: -1.5px; }
  .res.enough { box-shadow: inset 0 0 0 1.5px var(--platinum-deep); }
  .none { width: 26%; height: 26%; border: 1px solid var(--rule-control); transform: rotate(45deg); }
  .n {
    position: absolute; right: -5px; bottom: -4px; min-width: 15px; padding: 0 3px; height: 15px;
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--slab); border: 1px solid var(--rule-bright);
    font-family: var(--face-register); font-size: .66rem; font-weight: 600; line-height: 1; color: var(--platinum);
  }
  /* Resource counts run long ("205k"): centred under the chip, so they don't run into the next one. */
  .res .n { right: auto; left: 50%; transform: translateX(-50%); bottom: -7px; }
  .n.short { color: var(--platinum-deep); }
  .enough .n:not(.short) { border-color: var(--gold-dim); color: var(--gold); }
</style>
