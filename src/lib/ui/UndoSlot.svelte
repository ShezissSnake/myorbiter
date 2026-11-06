<script lang="ts">
  // What's left of something you just dismissed or removed, for a few seconds: one collapsed line,
  // "Dismissed · Undo", with a hairline running out until it's gone for good (see undo.svelte.ts).
  import { UNDO_MS } from "../undo.svelte";
  import { arrive } from "../motion";
  import { named, refocus, usable } from "./refocus";
  // It arrives (fades up) where the thing was. When it runs out, the parent's list closes up:
  // put out:leave and animate:flip (motion.ts) on the list's own item, not on this slot.

  let { label = "Dismissed", what = "", ms = UNDO_MS, onundo }: { label?: string; what?: string; ms?: number; onundo: () => void } = $props();
  // The button that made this slot (Dismiss, the star, Remove) goes with what it was on, once its
  // leaving motion ends, and the keyboard focus would fall to the page: it goes to Undo instead, so
  // the next Tab carries on from here. Watched for a few frames; a focus moved on meanwhile stays.
  let undoButton: HTMLButtonElement | undefined = $state();
  /** The name (aria-label or title) of the button that made this slot, to find it again on Undo. */
  let madeBy: string | null = null;
  $effect(() => {
    const start = document.activeElement;
    if (!undoButton || !start || start === document.body) return;
    madeBy = start.getAttribute("aria-label") ?? start.getAttribute("title");
    let frames = 0;
    let id = 0;
    const look = () => {
      const at = document.activeElement;
      if (!at || at === document.body) return void undoButton?.focus({ preventScroll: true });
      if (at === start && ++frames < 45) id = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(id);
  });
  // And back: Undo goes as what it stood for comes back, and the focus goes to the button that made
  // the slot, drawn again where it was (the first of what stays around the slot, the list's own
  // item), else to that item's first control.
  function undo() {
    const around: Element[] = [];
    for (let el = undoButton?.parentElement?.parentElement; el && el !== document.body; el = el.parentElement) around.push(el);
    refocus(undoButton ?? null, () => named(around.find(usable), madeBy));
    onundo();
  }
</script>

<span class="slot" role="status" in:arrive={{ y: 3 }}>
  <span class="word">{label}{#if what}<span class="what">: {what}</span>{/if}</span>
  <button type="button" class="link" title="Undo: bring it back as it was" onclick={undo} bind:this={undoButton}>Undo</button>
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
