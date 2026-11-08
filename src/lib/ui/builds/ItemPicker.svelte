<script lang="ts">
  // Pick what to build: type a name (yours first), or take one of your recent items. Arrow keys move
  // through the list, Enter takes it, Escape closes it.
  import type { Model } from "../../core/model";
  import { searchItems, type BuildableItem } from "../../core/buildsPage";
  import Thumb from "../Thumb.svelte";
  import Icon from "../Icon.svelte";

  let { model, items, recent = [], onpick, autofocus = false, placeholder = "Find a warframe, weapon, companion…" }: { model: Model; items: BuildableItem[]; recent?: BuildableItem[]; onpick: (unique: string) => void; autofocus?: boolean; placeholder?: string } = $props();

  let q = $state("");
  let open = $state(false);
  let at = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  const id = `pick-${Math.random().toString(36).slice(2, 8)}`;
  // Nothing typed: recent first, then yours.
  const list = $derived.by(() => {
    if (q.trim()) return searchItems(items, q, 30);
    const seen = new Set(recent.map((r) => r.unique));
    return [...recent, ...items.filter((x) => x.owned && !seen.has(x.unique)).slice(0, 30 - recent.length)];
  });
  $effect(() => {
    void q;
    at = 0;
  });
  $effect(() => {
    if (autofocus) input?.focus();
  });
  function take(x: BuildableItem | undefined) {
    if (!x) return;
    onpick(x.unique);
    q = "";
    open = false;
    input?.blur();
  }
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open = true;
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % Math.max(1, list.length);
      queueMicrotask(() => document.getElementById(`${id}-${at}`)?.scrollIntoView({ block: "nearest" }));
    } else if (e.key === "Enter") {
      e.preventDefault();
      take(list[at]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      open = false;
    }
  }
</script>

<div class="picker" class:open>
  <span class="glass" aria-hidden="true"><Icon name="search" size={14} /></span>
  <input
    bind:this={input}
    type="search"
    role="combobox"
    aria-expanded={open && list.length > 0}
    aria-controls="{id}-list"
    aria-activedescendant={open && list.length ? `${id}-${at}` : undefined}
    aria-autocomplete="list"
    aria-label="Find something to build"
    title="Type a name: anything that takes mods. Yours come first; ↑↓ to move, Enter to pick"
    {placeholder}
    bind:value={q}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 120)}
    onkeydown={key}
    oninput={() => (open = true)}
  />
  {#if open && list.length}
    <ul class="list" id="{id}-list" role="listbox" aria-label="Items">
      {#if !q.trim() && recent.length}<li class="head register" role="presentation">Recent</li>{/if}
      {#each list as x, i (x.unique)}
        {#if !q.trim() && i === recent.length && recent.length}<li class="head register" role="presentation">Yours</li>{/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li id="{id}-{i}" role="option" aria-selected={i === at} class:at={i === at} onmousedown={(e) => e.preventDefault()} onclick={() => take(x)} onmousemove={() => (at = i)}>
          <Thumb file={model.imageOf(x.name)} size={26} />
          <span class="nm">{x.name}</span>
          <span class="kd">{x.label}</span>
          {#if x.owned}<span class="own" title="You have it">Yours</span>{/if}
        </li>
      {/each}
    </ul>
  {:else if open && q.trim()}
    <p class="list none dim small">Nothing that takes mods is called “{q.trim()}”.</p>
  {/if}
</div>

<style>
  .picker { position: relative; width: 100%; max-width: 30rem; }
  .glass { position: absolute; left: .6rem; top: 50%; transform: translateY(-50%); color: var(--platinum-deep); pointer-events: none; display: inline-flex; }
  input { width: 100%; padding-left: 2rem; }
  .list { position: absolute; z-index: 20; top: calc(100% + 3px); left: 0; right: 0; max-height: 22rem; overflow: auto; margin: 0; padding: .25rem 0; list-style: none; background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 1rem 2.4rem rgb(0 0 0 / 55%); }
  .list.none { padding: .6rem .8rem; }
  .head { padding: .4rem .7rem .2rem; font-size: .56rem; }
  li[role="option"] { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: .6rem; padding: .3rem .7rem; cursor: pointer; }
  li.at { background: var(--raised); box-shadow: inset 2px 0 0 var(--sec); }
  .nm { color: var(--platinum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kd { font-family: var(--face-register); font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); white-space: nowrap; }
  .own { font-family: var(--face-register); font-size: .67rem; letter-spacing: .1em; text-transform: uppercase; color: var(--sec); }
</style>
