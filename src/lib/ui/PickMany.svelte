<script lang="ts" generics="T extends string">
  // A menu you can tick several things in: looks like the app's other menus, opens a list of
  // checkboxes. Nothing ticked is `any` ("Any era"). Esc or a click outside closes it.
  import Chip from "./Chip.svelte";

  let {
    value = $bindable(),
    options,
    any,
    noun,
    label,
  }: {
    value: T[];
    options: { v: T; label: string; title?: string }[];
    /** What nothing ticked means: "Any era". */
    any: string;
    /** For the button once more than two are ticked: "3 eras". */
    noun: string;
    /** The menu's name, for screen readers and its tooltip. */
    label: string;
  } = $props();

  let open = $state(false);
  let box = $state<HTMLElement>();
  const name = (v: T) => options.find((o) => o.v === v)?.label ?? v;
  const shown = $derived(!value.length ? any : value.length <= 2 ? value.map(name).join(", ") : `${value.length} ${noun}`);
  const toggle = (v: T) => (value = value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
</script>

<svelte:window
  onpointerdown={(e) => {
    if (open && box && !box.contains(e.target as Node)) open = false;
  }}
  onkeydown={(e) => {
    if (open && e.key === "Escape") {
      open = false;
      e.stopPropagation();
    }
  }}
/>

<span class="pm" bind:this={box}>
  <button type="button" class="pmb" class:set={value.length > 0} aria-haspopup="true" aria-expanded={open} aria-label="{label}: {shown}" title="{label}: tick one or more; none ticked is {any.toLowerCase()}" onclick={() => (open = !open)}>{shown}</button>
  {#if open}
    <div class="pop" role="group" aria-label={label}>
      <button type="button" class="link anyb" class:on={!value.length} onclick={() => (value = [])}>{any}</button>
      {#each options as o (o.v)}
        <Chip on={value.includes(o.v)} label={o.label} title={o.title} onchange={() => toggle(o.v)} />
      {/each}
    </div>
  {/if}
</span>

<style>
  .pm { position: relative; display: inline-block; }
  /* The same face as the app's <select>s (app.css), with its gold chevron. */
  .pmb {
    background: var(--well); border: 1px solid var(--rule-control); padding: .5rem 1.9rem .5rem .7rem;
    font-family: var(--face-register); font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-dim);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23d6ae4a' stroke-width='1.3'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right .7rem center; background-size: .55rem auto;
    max-width: 16rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
  }
  .pmb:hover { border-color: var(--platinum-deep); color: var(--platinum); }
  .pmb.set { color: var(--platinum); }
  .pop {
    position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; min-width: 12rem; max-height: 18rem; overflow-y: auto;
    display: grid; gap: .1rem; padding: .5rem .6rem; background: var(--plate); border: 1px solid var(--rule-control);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
  }
  .pop :global(.chip) { justify-content: flex-start; padding: .3rem .2rem; border: 0; background: none; text-transform: none; letter-spacing: normal; font-family: inherit; font-size: .82rem; color: var(--platinum-dim); white-space: nowrap; }
  .pop :global(.chip:hover) { color: var(--platinum); }
  .pop :global(.chip.on) { color: var(--platinum); }
  .anyb { justify-self: start; margin-bottom: .2rem; }
  .anyb.on { color: var(--platinum-dim); }
</style>
