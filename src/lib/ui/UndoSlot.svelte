<script lang="ts">
  // What's left of something you just dismissed or removed, for a few seconds: one collapsed line,
  // "Dismissed · Undo", with a hairline running out until it's gone for good (see undo.svelte.ts).
  import { UNDO_MS } from "../undo.svelte";
  import { arrive } from "../motion";
  // It arrives (fades up) where the thing was. When it runs out, the parent's list closes up:
  // put out:leave and animate:flip (motion.ts) on the list's own item, not on this slot.

  let { label = "Dismissed", what = "", ms = UNDO_MS, onundo }: { label?: string; what?: string; ms?: number; onundo: () => void } = $props();
</script>

<span class="slot" role="status" in:arrive={{ y: 3 }}>
  <span class="word">{label}{#if what}<span class="what">: {what}</span>{/if}</span>
  <button type="button" class="link" title="Undo: bring it back as it was" onclick={onundo}>Undo</button>
  <i style:animation-duration="{ms}ms" aria-hidden="true"></i>
</span>

<style>
  .slot { position: relative; display: inline-flex; align-items: center; gap: .7rem; min-width: 0; max-width: 100%; padding: .2rem .6rem .3rem; border: 1px dashed var(--rule-bright); font-family: var(--face-register); font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); }
  .word { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .what { text-transform: none; letter-spacing: 0; font-family: var(--face-text); font-size: .78rem; }
  .link { flex: none; font-size: .62rem; }
  /* Time left before it's gone: a line that runs out. */
  i { position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--gold-dim); transform-origin: left center; animation: slot-run linear forwards; }
  @keyframes slot-run { from { transform: scaleX(1); } to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) { i { animation: none; } }
</style>
