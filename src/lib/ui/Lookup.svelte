<script lang="ts">
  // Ctrl+K: find anything by name from any page. Gear opens its details; a prime part its item's
  // details; a relic, mod or arcane opens its page searched for it. The best matches first: names
  // that start with what you typed, then names with a word that does, then the rest.
  import { tick } from "svelte";
  import type { Model } from "../core/model";
  import { details } from "../details.svelte";
  import { setIntent } from "../intent.svelte";
  import Thumb from "./Thumb.svelte";
  import GameIcon, { eraIcon, kindIcon } from "./GameIcon.svelte";
  import { MASTERY_CATEGORIES, masteryCategory } from "../core/views";

  let { open = $bindable(false), model, go }: { open: boolean; model: Model; go: (tab: string) => void } = $props();

  interface Hit {
    key: string;
    name: string;
    kind: string;
    image: string | null;
    era?: string;
    act: () => void;
  }

  let query = $state("");
  let at = $state(0);
  let field = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (open) {
      query = "";
      at = 0;
      void tick().then(() => field?.focus());
    }
  });

  const page = (tab: string, want: Record<string, string>) => () => {
    setIntent(tab, want);
    go(tab);
  };

  // Everything findable, built once per inventory read.
  const all = $derived.by((): Hit[] => {
    const out: Hit[] = [];
    for (const item of model.catalogByUnique.values()) {
      if (!item.masterable || !(item.category in MASTERY_CATEGORIES)) continue;
      out.push({ key: item.uniqueName, name: item.name, kind: masteryCategory(item) ?? "Item", image: model.imageOf(item.name), act: () => details.open(item.uniqueName) });
    }
    for (const [name, parts] of model.partByName) {
      const p = parts[0];
      if (!p) continue;
      out.push({ key: `part|${name}`, name, kind: `Part of ${p.parentName}`, image: model.imageOf(name), act: () => details.open(p.parentUnique) });
    }
    for (const base of model.relicGroups.keys()) out.push({ key: `relic|${base}`, name: `${base} Relic`, kind: "Relic", image: null, era: base.split(" ")[0], act: page("relics", { q: base }) });
    const seen = new Set<string>();
    for (const rows of model.inventoryByBase.values()) {
      for (const r of rows) {
        if ((r.category !== "mod" && r.category !== "arcane") || seen.has(r.name)) continue;
        seen.add(r.name);
        const tab = r.category === "mod" ? "mods" : "arcanes";
        out.push({ key: `${tab}|${r.name}`, name: r.name, kind: r.category === "mod" ? "Mod you hold" : "Arcane you hold", image: model.imageOf(r.name), act: page(tab, { q: r.name }) });
      }
    }
    return out;
  });

  const hits = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rank = (n: string) => {
      const l = n.toLowerCase();
      if (l.startsWith(q)) return 0;
      if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
      return l.includes(q) ? 2 : 3;
    };
    return all
      .map((h) => ({ h, r: rank(h.name) }))
      .filter((x) => x.r < 3)
      .sort((a, b) => a.r - b.r || a.h.name.length - b.h.name.length || a.h.name.localeCompare(b.h.name))
      .slice(0, 12)
      .map((x) => x.h);
  });
  $effect(() => {
    hits;
    at = 0;
  });

  function pick(h: Hit | undefined) {
    if (!h) return;
    open = false;
    h.act();
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      open = false;
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) at = (at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[at]);
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={() => (open = false)}>
    <div class="dialog" role="dialog" tabindex="-1" aria-modal="true" aria-label="Find anything" onclick={(e) => e.stopPropagation()}>
      <input bind:this={field} type="search" placeholder="Find an item, part, relic, mod or arcane…" bind:value={query} onkeydown={key} aria-controls="lookup-hits" aria-activedescendant={hits[at] ? `lk-${at}` : undefined} />
      {#if hits.length}
        <ul id="lookup-hits" role="listbox" aria-label="Matches">
          {#each hits as h, i (h.key)}
            <li id="lk-{i}" role="option" aria-selected={i === at}>
              <button class:on={i === at} onmouseenter={() => (at = i)} onclick={() => pick(h)}>
                {#if h.era}<GameIcon name={eraIcon(h.era)} size={24} />{:else}<Thumb file={h.image} size={24} />{/if}
                <span class="n">{h.name}</span>
                <span class="k">{#if kindIcon(h.kind, h.name)}<GameIcon name={kindIcon(h.kind, h.name)!} size={12} />{/if}{h.kind}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if query.trim()}
        <p class="dim small">Nothing by that name. Anything warframe.market trades is on Browse market.</p>
      {:else}
        <p class="dim small">Gear opens its details, a prime part its item's, a relic, mod or arcane its page. ↑↓ to pick, Enter to open, Esc to close.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 60; background: rgb(6 7 9 / 66%); display: grid; justify-items: center; align-items: start; padding: 12vh 1rem 1rem; }
  .dialog { clip-path: var(--cut); width: min(36rem, 100%); background: var(--plate); border: 1px solid var(--rule-bright); padding: .9rem; display: grid; gap: .6rem; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%); }
  input { width: 100%; font-size: 1rem; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; max-height: 60vh; overflow: auto; }
  button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: .65rem; padding: .4rem .55rem; cursor: pointer; }
  button.on { background: color-mix(in srgb, var(--gold) 12%, var(--well)); box-shadow: inset 2px 0 0 var(--gold); }
  .n { flex: 1; min-width: 0; color: var(--platinum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .k { display: inline-flex; align-items: center; gap: .3rem; font-size: .74rem; color: var(--platinum-deep); white-space: nowrap; }
  p { margin: .2rem .3rem; }
</style>
