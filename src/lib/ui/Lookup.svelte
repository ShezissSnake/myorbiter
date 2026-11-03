<script lang="ts">
  // Ctrl+K: find anything by name from any page. Gear opens its details; a prime part its item's
  // details; a relic, mod or arcane opens its page searched for it; anything else warframe.market
  // trades opens Browse market searched for it. The best matches first: names
  // that start with what you typed, then names with a word that does, then the rest.
  import { tick } from "svelte";
  import { splitRelicName, type Model } from "../core/model";
  import { details } from "../details.svelte";
  import { setIntent } from "../intent.svelte";
  import Thumb from "./Thumb.svelte";
  import GameIcon, { eraIcon, kindIcon } from "./GameIcon.svelte";
  import { MASTERY_CATEGORIES, masteryCategory } from "../core/views";
  import { trap } from "./trap";
  import { opens, shade } from "../motion";
  import { mkt } from "../marketStore.svelte";
  import { typed } from "../typed.svelte";

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
  /** The matches follow the box a moment later while you type (typed.svelte.ts); Enter uses the box as it is. */
  const typedQuery = $derived.by(typed(() => query, (v) => !v.trim()));
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
    // Relics you hold: Relics lists only those (one you don't hold is in its rewards' details).
    const held = new Set<string>();
    for (const rows of model.inventoryByBase.values()) for (const r of rows) if (r.category === "relic" && r.quantity > 0) { const b = splitRelicName(r.name)?.base; if (b) held.add(b); }
    for (const base of model.relicGroups.keys()) if (held.has(base)) out.push({ key: `relic|${base}`, name: `${base} Relic`, kind: "Relic you hold", image: null, era: base.split(" ")[0], act: page("relics", { q: base }) });
    const seen = new Set<string>();
    for (const rows of model.inventoryByBase.values()) {
      for (const r of rows) {
        if ((r.category !== "mod" && r.category !== "arcane") || seen.has(r.name)) continue;
        seen.add(r.name);
        const tab = r.category === "mod" ? "mods" : "arcanes";
        out.push({ key: `${tab}|${r.name}`, name: r.name, kind: r.category === "mod" ? "Mod you hold" : "Arcane you hold", image: model.imageOf(r.name), act: page(tab, { q: r.name }) });
      }
    }
    // Everything else warframe.market trades (cosmetics, Captura, mods you don't hold…), from the
    // item list the app already loads: Browse market, searched for it. Names found above stay theirs.
    const named = new Set(out.map((h) => h.name.toLowerCase()));
    for (const it of mkt.items) {
      if (named.has(it.name.toLowerCase())) continue;
      out.push({ key: `browse|${it.slug}`, name: it.name, kind: "On warframe.market", image: model.imageOf(it.name) ?? it.thumb ?? null, act: page("browse", { q: it.name }) });
    }
    return out;
  });

  const hits = $derived(hitsFor(typedQuery));
  function hitsFor(text: string): Hit[] {
    const q = text.trim().toLowerCase();
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
  }
  $effect(() => {
    hits;
    at = 0;
  });

  function pick(h: Hit | undefined) {
    if (!h) return;
    open = false;
    h.act();
  }
  // Esc anywhere in it closes it, Tab stays inside, and closed the focus goes back (use:trap).
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) at = (at + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Typed and Enter before the list caught up: the best match for what's in the box.
      pick(typedQuery === query ? hits[at] : hitsFor(query)[0]);
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" in:shade|global out:shade|global onclick={() => (open = false)}>
    <div class="dialog" role="dialog" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} tabindex="-1" aria-modal="true" aria-label="Find anything" use:trap={{ onescape: () => (open = false) }} onclick={(e) => e.stopPropagation()}>
      <input bind:this={field} type="search" placeholder="Find an item, part, relic, mod or arcane…" bind:value={query} onkeydown={key} aria-controls="lookup-hits" aria-activedescendant={hits[at] ? `lk-${at}` : undefined} />
      {#if hits.length}
        <ul id="lookup-hits" role="listbox" aria-label="Matches">
          {#each hits as h, i (h.key)}
            <li id="lk-{i}" role="option" aria-selected={i === at}>
              <button class:on={i === at} onmouseenter={() => (at = i)} onfocus={() => (at = i)} onclick={() => pick(h)}>
                {#if h.era}<GameIcon name={eraIcon(h.era)} size={24} />{:else}<Thumb file={h.image} size={24} />{/if}
                <span class="n">{h.name}</span>
                <span class="k">{#if kindIcon(h.kind, h.name)}<GameIcon name={kindIcon(h.kind, h.name)!} size={12} />{/if}{h.kind}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if typedQuery.trim()}
        <p class="dim small">{mkt.items.length ? "Nothing by that name." : "Nothing by that name. warframe.market's item list hasn't loaded yet: anything it trades is on Browse market."}</p>
      {:else}
        <p class="dim small">Gear opens its details, a prime part its item's, a relic, mod or arcane its page, anything else on warframe.market Browse market. ↑↓ to pick, Enter to open, Esc to close.</p>
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
  /* all: unset took the focus ring away: Tab onto a match shows where you are. */
  button:focus-visible { outline: 1px solid var(--select); outline-offset: -1px; }
  .n { flex: 1; min-width: 0; color: var(--platinum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .k { display: inline-flex; align-items: center; gap: .3rem; font-size: .74rem; color: var(--platinum-deep); white-space: nowrap; }
  p { margin: .2rem .3rem; }
</style>
