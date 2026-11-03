<script lang="ts">
  // Puts a line on the clipboard (a whisper, a trade-chat or recruiting line) and says so: "Copied"
  // with a tick for a moment. When the clipboard refuses, it says "Couldn't copy" and opens the
  // line in a small read-only field under the button, already selected, to copy by hand. Every
  // label sits in one grid cell, so the button keeps its width as they swap.
  import Icon from "./Icon.svelte";

  let {
    text,
    label,
    copied = "Copied",
    title,
    look = "link",
    sizer = [],
    oncopied,
    class: cls = "",
  }: {
    /** The line, or a function giving it at the moment of the click (each press the next line). */
    text: string | (() => string);
    label: string;
    /** Said for a moment after copying. */
    copied?: string;
    title: string;
    /** link: a gold text link; chip: a small struck button (the fissure board's). */
    look?: "link" | "chip";
    /** Other labels it may show, so its width is set from the start. */
    sizer?: string[];
    /** After a copy that worked (the trade-chat line moves on to the next). */
    oncopied?: () => void;
    class?: string;
  } = $props();

  let st = $state<"idle" | "done" | "failed">("idle");
  /** The line the clipboard refused, to copy by hand. */
  let line = $state("");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let field = $state<HTMLInputElement | null>(null);

  async function copy() {
    const t = typeof text === "function" ? text() : text;
    if (timer) clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(t);
      st = "done";
      oncopied?.();
      timer = setTimeout(() => (st = "idle"), 2000);
    } catch {
      line = t;
      st = "failed";
      // Long enough to copy it by hand; leaving the field closes it sooner.
      timer = setTimeout(() => (st = "idle"), 20_000);
      queueMicrotask(() => {
        field?.focus();
        field?.select();
      });
    }
  }
  function key(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    st = "idle";
  }
</script>

<span class="cb {cls}">
  <button type="button" class="{look === 'link' ? 'link' : 'chip'} {st}" title={st === "failed" ? "The clipboard refused: copy the line from the field below by hand" : title} onclick={copy}>
    <span class="lbls">
      <span class:on={st === "idle"}>{label}</span>
      <span class:on={st === "done"}>{copied}<Icon name="check" size={look === "chip" ? 9 : 11} /></span>
      <!-- A chip is small: "Failed", the field under it says the rest. -->
      <span class:on={st === "failed"}>{look === "chip" ? "Failed" : "Couldn't copy"}</span>
      {#each sizer as s, i (i)}<span>{s}</span>{/each}
    </span>
  </button>
  {#if st === "failed"}
    <input class="byhand" readonly value={line} aria-label="The line to copy by hand" title="Copy it with Ctrl+C" bind:this={field} onfocus={(e) => e.currentTarget.select()} onkeydown={key} onblur={() => (st = "idle")} />
  {/if}
</span>

<style>
  .cb { position: relative; display: inline-flex; flex: none; }
  .lbls { display: inline-grid; }
  .lbls > span { grid-area: 1 / 1; visibility: hidden; display: inline-flex; align-items: center; gap: .35rem; white-space: nowrap; }
  .lbls > span.on { visibility: visible; }
  .link.done, .chip.done { color: var(--verdigris); }
  .link.failed, .chip.failed { color: var(--oxblood); }
  /* The fissure board's Recruit: a small struck button. */
  /* Filled faintly and struck, so it reads as a button to press, not a field to type in. */
  .chip { font-family: var(--face-register); font-size: .54rem; letter-spacing: .1em; text-transform: uppercase; color: var(--gold); border: 1px solid var(--gold-dim); background: color-mix(in srgb, var(--gold) 12%, transparent); box-shadow: inset 0 -1px 0 rgb(0 0 0 / 45%); padding: .12rem .45rem; cursor: pointer; height: auto; }
  .chip .lbls > span { justify-content: center; }
  .chip:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); background: color-mix(in srgb, var(--gold) 20%, transparent); }
  .chip.done { border-color: var(--verdigris); }
  .chip.failed { border-color: var(--oxblood); }
  /* The clipboard refused: the line under the button, selected, over whatever is below. */
  .byhand { position: absolute; z-index: 6; top: calc(100% + 4px); right: 0; width: min(30rem, 80vw); font-size: .78rem; padding: .35rem .5rem; border-color: var(--oxblood); box-shadow: 0 .6rem 1.4rem rgb(0 0 0 / 45%); text-transform: none; letter-spacing: 0; }
</style>
