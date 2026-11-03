<script lang="ts">
  // A simple slot editor: type a mod or arcane into each slot (the list offers what fits this item),
  // with its rank (empty: max). Names are matched as the paste reads them, the copy you hold
  // preferred; a name orbiter can't place shows suggestions to pick. Archon shards and the Helminth
  // for warframes.
  import { tick } from "svelte";
  import type { Model } from "../../core/model";
  import type { CatalogItem } from "../../core/types";
  import { heldCount } from "../../core/model";
  import { arcaneFits, matchName, modFits, nameIndex, newBuildId, SHARD_COLOURS, slotLayout, tierOf, type Build, type BuildMod, type BuildShard, type GearKind, type ShardColour, type Unmatched } from "../../core/builds";
  import { opens, shade } from "../../motion";
  import { trap } from "../trap";
  import ModGrid from "./ModGrid.svelte";
  import { parseTags } from "../../core/buildsPage";
  import { KNOWN_TAGS, TAG_FAMILIES } from "./tags";

  let { model, item, kind, build, copy, onsave, onclose }: { model: Model; item: CatalogItem; kind: GearKind; build: Build; copy: boolean; onsave: (b: Build) => void; onclose: () => void } = $props();

  type Role = "aura" | "exilus" | "stance" | "mod" | "arcane";
  interface Slot {
    key: string;
    role: Role;
    label: string;
    text: string;
    path: string | null;
    rank: number | null;
    problem: Unmatched | null;
  }

  // The dialog edits one item's build: what it is is read once, as it opens.
  // svelte-ignore state_referenced_locally
  const layout = slotLayout(kind);
  // svelte-ignore state_referenced_locally
  const idx = nameIndex(model.catalogByUnique);
  const held = (p: string) => heldCount(model, p);
  const nameOf = (m: BuildMod | null | undefined) => (m ? (model.catalogByUnique.get(m.path)?.name ?? model.nameOf(m.path)) : "");
  const slotOf = (key: string, role: Role, label: string, m: BuildMod | null | undefined): Slot => ({ key, role, label, text: nameOf(m), path: m?.path ?? null, rank: m?.rank ?? null, problem: null });

  // svelte-ignore state_referenced_locally
  let slots = $state<Slot[]>([
    ...(layout.aura ? [slotOf("aura", "aura", "Aura", build.aura)] : []),
    ...(layout.stance ? [slotOf("stance", "stance", "Stance", build.stance)] : []),
    ...(layout.exilus ? [slotOf("exilus", "exilus", "Exilus", build.exilus)] : []),
    ...Array.from({ length: layout.mods }, (_, i) => slotOf(`m${i}`, "mod", `Slot ${i + 1}`, build.mods[i])),
    ...Array.from({ length: layout.arcanes }, (_, i) => slotOf(`a${i}`, "arcane", `Arcane ${i + 1}`, build.arcanes[i])),
  ]);
  // svelte-ignore state_referenced_locally
  let shards = $state<{ colour: ShardColour | ""; tauforged: boolean; stat: string }[]>(Array.from({ length: kind === "warframe" ? 5 : 0 }, (_, i) => ({ colour: build.shards[i]?.colour ?? "", tauforged: build.shards[i]?.tauforged ?? false, stat: build.shards[i]?.stat ?? "" })));
  // svelte-ignore state_referenced_locally
  let helminth = $state({ ability: build.helminth?.ability ?? "", replaces: build.helminth?.replaces ?? "" });
  // svelte-ignore state_referenced_locally
  let title = $state(copy ? (build.source === "orbiter" ? `My ${item.name} build` : (build.title ?? "")) : (build.title ?? ""));
  // svelte-ignore state_referenced_locally
  let tags = $state<string[]>([...(build.tags ?? [])]);
  let tagText = $state("");
  const hasTag = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const flipTag = (t: string) => (tags = hasTag(t) ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t]);
  function addTyped() {
    tags = parseTags([...tags, ...parseTags(tagText)].join(","));
    tagText = "";
  }
  /** Tags the build has that aren't offered: shown too, to take off. */
  const offered = Object.values(KNOWN_TAGS).flat().map((t) => t.toLowerCase());
  // svelte-ignore state_referenced_locally
  let note = $state(build.source === "orbiter" ? "" : (build.note ?? ""));

  // What each slot's list offers: the names that fit this item, by kind of slot.
  const names = (() => {
    const out: Record<Role, Set<string>> = { aura: new Set(), exilus: new Set(), stance: new Set(), mod: new Set(), arcane: new Set() };
    for (const list of idx.byName.values()) {
      const c = list.find((x) => !/\/(PvPMods|Beginner|Intermediate|Expert\/.*Beginner)\//.test(x.uniqueName)) ?? list[0];
      if (c.category === "Arcanes") {
        if (layout.arcanes && arcaneFits(c, item, kind).fits !== false) out.arcane.add(c.name);
        continue;
      }
      if (modFits(c, item, kind).fits === false) continue;
      if ((c.compatName ?? "").toUpperCase() === "AURA") out.aura.add(c.name);
      else if (c.type === "Stance Mod") out.stance.add(c.name);
      else {
        out.mod.add(c.name);
        out.exilus.add(c.name);
      }
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()])) as Record<Role, string[]>;
  })();
  const listId = (r: Role) => `be-${r}`;

  function commit(s: Slot) {
    const text = s.text.trim();
    if (!text) {
      s.path = null;
      s.problem = null;
      return;
    }
    const r = matchName(text, idx, item, kind, s.role === "arcane" ? "arcane" : "mod", held);
    if (r.ok) {
      s.path = r.path;
      s.text = r.name;
      s.problem = null;
    } else {
      s.path = null;
      s.problem = r;
    }
  }
  function choose(s: Slot, name: string, path: string) {
    s.text = name;
    s.path = path;
    s.problem = null;
  }
  const maxOf = (s: Slot) => (s.path ? (model.catalogByUnique.get(s.path)?.maxRank ?? 0) : 0);

  const draft = $derived.by((): Build => {
    const mod = (s: Slot | undefined): BuildMod | null => (s?.path ? (s.rank != null && Number.isFinite(s.rank) ? { path: s.path, rank: Math.max(0, Math.min(maxOf(s), Math.round(s.rank))) } : { path: s.path }) : null);
    const by = (k: string) => slots.find((s) => s.key === k);
    const sh: BuildShard[] = shards.filter((x) => x.colour).map((x) => ({ colour: x.colour as ShardColour, tauforged: x.tauforged, ...(x.stat.trim() ? { stat: x.stat.trim() } : {}) }));
    const b: Build = {
      ...build,
      id: copy ? newBuildId() : build.id,
      source: copy ? "mine" : build.source,
      kind,
      aura: mod(by("aura")),
      stance: mod(by("stance")),
      exilus: mod(by("exilus")),
      mods: Array.from({ length: layout.mods }, (_, i) => mod(by(`m${i}`))),
      arcanes: slots.filter((s) => s.role === "arcane").map(mod).filter((x): x is BuildMod => !!x),
      shards: sh,
      helminth: kind === "warframe" && helminth.ability.trim() && helminth.replaces.trim() ? { ability: helminth.ability.trim(), replaces: helminth.replaces.trim() } : null,
      favourite: copy ? false : build.favourite,
      importedAt: copy ? Date.now() : build.importedAt,
    };
    if (copy) {
      delete b.author;
      delete b.votes;
      delete b.updatedAt;
    }
    const tg = parseTags([...tags, ...parseTags(tagText)].join(","));
    if (tg.length) b.tags = tg;
    else delete b.tags;
    if (title.trim()) b.title = title.trim();
    else delete b.title;
    if (note.trim()) b.note = note.trim();
    else delete b.note;
    return b;
  });
  const tier = $derived(tierOf(draft, item, model.catalogByUnique, kind));
  const problems = $derived(slots.filter((s) => s.problem).length);
  // svelte-ignore state_referenced_locally
  const abilities = (item.abilities ?? []).map((a) => a.name);

  let first = $state<HTMLInputElement | null>(null);
  $effect(() => {
    void tick().then(() => first?.focus());
  });
  function save() {
    for (const s of slots) if (s.text.trim() && !s.path) commit(s);
    if (slots.some((s) => s.problem)) return;
    onsave(draft);
  }
  const COLOUR_WORD: Record<ShardColour, string> = { crimson: "Crimson", azure: "Azure", amber: "Amber", violet: "Violet", topaz: "Topaz", emerald: "Emerald" };
</script>

{#each ["aura", "stance", "mod", "arcane"] as const as r (r)}<datalist id={listId(r)}>{#each names[r] as n (n)}<option value={n}></option>{/each}</datalist>{/each}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" in:shade|global out:shade|global onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dialog" role="dialog" aria-modal="true" aria-label="{copy ? 'Edit a copy' : 'Edit the build'} for {item.name}" tabindex="-1" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} use:trap={{ onescape: onclose }} onclick={(e) => e.stopPropagation()}>
    <div class="register head">{copy ? "Edit a copy" : "Edit"} · {item.name}</div>
    <div class="cols">
      <div class="slots">
        <label class="field t"><span class="register">Title</span><input bind:this={first} bind:value={title} placeholder="Optional" title="A name for it" /></label>
        {#each slots as s (s.key)}
          <div class="slotrow" class:bad={!!s.problem}>
            <span class="register lab">{s.label}</span>
            <input class="nm" list={listId(s.role === "exilus" ? "mod" : s.role)} bind:value={s.text} placeholder={s.role === "arcane" ? "Arcane" : s.role === "aura" ? "Aura mod" : s.role === "stance" ? "Stance" : "Mod"} aria-label="{s.label}: {s.role === 'arcane' ? 'arcane' : 'mod'} name" title="Type a name; the list offers what fits {item.name}" onchange={() => commit(s)} onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), commit(s))} />
            <input class="rk" type="number" min="0" max={maxOf(s) || 10} bind:value={s.rank} placeholder="max" aria-label="{s.label}: rank" title="Rank wanted: empty for max{maxOf(s) ? ` (${maxOf(s)})` : ''}" />
            {#if s.problem}
              <span class="prob small">
                {s.problem.reason === "wrong-gear" ? `${s.problem.why ?? "For other gear"}, not ${item.name}.` : s.problem.reason === "no-flawed" ? "No Flawed version." : "Not found."}
                {#each s.problem.suggestions as g (g.path)}<button type="button" class="sug" title="Use {g.name}" onclick={() => choose(s, g.name, g.path)}>{g.name}</button>{/each}
              </span>
            {/if}
          </div>
        {/each}
        {#if shards.length}
          <span class="register sub">Archon shards</span>
          {#each shards as x, i (i)}
            <div class="shardrow">
              <select bind:value={x.colour} aria-label="Shard {i + 1}: colour" title="The shard's colour (none: empty)"><option value="">None</option>{#each SHARD_COLOURS as c (c)}<option value={c}>{COLOUR_WORD[c]}</option>{/each}</select>
              <label class="tau" title="Tauforged: a stronger shard of the same colour"><input type="checkbox" bind:checked={x.tauforged} disabled={!x.colour} /> Tauforged</label>
              <input bind:value={x.stat} placeholder="Stat (optional)" disabled={!x.colour} aria-label="Shard {i + 1}: stat" title="What it's set to: Ability Strength, Health…" />
            </div>
          {/each}
          <span class="register sub">Helminth</span>
          <div class="shardrow">
            <input bind:value={helminth.ability} placeholder="Ability (optional)" aria-label="Helminth ability" title="The ability you subsume onto {item.name}" />
            <select bind:value={helminth.replaces} aria-label="Ability it replaces" title="Which of {item.name}'s abilities it replaces"><option value="">Replaces…</option>{#each abilities as a (a)}<option value={a}>{a}</option>{/each}</select>
          </div>
        {/if}
        <span class="register sub">Tags</span>
        <div class="tagpick" role="group" aria-label="Tags">
          {#each TAG_FAMILIES as f (f)}
            <span class="tf"><span class="register">{f}</span>{#each KNOWN_TAGS[f] as t (t)}<button type="button" class="tagchip" class:on={hasTag(t)} aria-pressed={hasTag(t)} title={hasTag(t) ? `Tagged ${t}: click to take it off` : `Tag it ${t}`} onclick={() => flipTag(t)}>{t}</button>{/each}</span>
          {/each}
          {#if tags.some((t) => !offered.includes(t.toLowerCase()))}<span class="tf"><span class="register">Yours</span>{#each tags.filter((t) => !offered.includes(t.toLowerCase())) as t (t)}<button type="button" class="tagchip on" aria-pressed="true" title="Tagged {t}: click to take it off" onclick={() => flipTag(t)}>{t}</button>{/each}</span>{/if}
          <input class="tagin" bind:value={tagText} placeholder="Other tags, by commas" aria-label="Other tags" title="Any other tag: type it and press Enter (commas between several)" onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addTyped())} onblur={addTyped} />
        </div>
        <label class="field t"><span class="register">Note</span><textarea bind:value={note} rows="2" placeholder="Optional" title="Anything to remember about it"></textarea></label>
      </div>
      <div class="pv"><ModGrid {model} build={draft} {tier} /><p class="dim small">{tier.reasons[0]}</p></div>
    </div>
    <div class="row end">
      {#if problems}<span class="warn small">{problems} name{problems === 1 ? "" : "s"} to fix</span>{/if}
      <button type="button" onclick={onclose} title="Close without saving">Cancel</button>
      <button type="button" class="stamp gold" disabled={problems > 0} title={problems ? "Fix or clear the names orbiter couldn't match first" : copy ? "Save it as your own build" : "Save the changes"} onclick={save}>{copy ? "Save as mine" : "Save"}</button>
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(64rem, 100%); max-height: calc(100vh - 2rem); overflow: auto; background: var(--plate); border: 1px solid var(--rule-bright); padding: 1.2rem 1.4rem 1.1rem; display: grid; gap: .8rem; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%); }
  .head { color: var(--sec); }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 1.2rem; align-items: start; }
  .pv { position: sticky; top: 0; display: grid; gap: .5rem; }
  .slots { display: grid; gap: .35rem; }
  .field { display: grid; gap: .25rem; }
  .field.t { margin-bottom: .3rem; }
  .slotrow { display: grid; grid-template-columns: 4.6rem minmax(0, 1fr) 4.2rem; gap: .2rem .5rem; align-items: center; }
  .lab { font-size: .56rem; }
  .slotrow input { text-transform: none; letter-spacing: 0; font-family: var(--face-text); font-size: .84rem; padding: .3rem .5rem; }
  .slotrow .rk { text-align: right; }
  .slotrow.bad .nm { border-color: var(--oxblood); }
  .prob { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; color: var(--oxblood); }
  .sug { padding: .12rem .4rem; font-size: .56rem; }
  .sub { margin-top: .5rem; }
  .shardrow { display: flex; gap: .5rem; align-items: center; }
  .shardrow input:not([type="checkbox"]) { flex: 1; min-width: 0; text-transform: none; letter-spacing: 0; font-family: var(--face-text); font-size: .84rem; }
  .tau { display: inline-flex; align-items: center; gap: .3rem; font-size: .78rem; color: var(--platinum-dim); white-space: nowrap; }
  .tagpick { display: grid; gap: .3rem; }
  .tf { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem; }
  .tf .register { font-size: .52rem; width: 6.5rem; }
  .tagchip { padding: .12rem .45rem; font-family: var(--face-text); font-size: .74rem; letter-spacing: 0; text-transform: none; color: var(--platinum-dim); }
  .tagchip.on { color: var(--slab); background: var(--sec); border-color: var(--sec); }
  .tagin { text-transform: none; letter-spacing: 0; font-family: var(--face-text); font-size: .82rem; padding: .3rem .5rem; }
  textarea { font: inherit; font-size: .84rem; color: var(--platinum); background: var(--well); border: 1px solid var(--rule-control); padding: .4rem .5rem; resize: vertical; }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--sec); outline-offset: 1px; }
  .row { display: flex; gap: .6rem; align-items: center; }
  .end { justify-content: flex-end; }
  .warn { color: var(--alert); margin-right: auto; }
  :global(html[data-room~="lt1100"]) .cols { grid-template-columns: 1fr; }
  :global(html[data-room~="lt1100"]) .pv { position: static; }
</style>
