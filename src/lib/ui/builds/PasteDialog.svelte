<script lang="ts">
  // Paste a build: text copied from a build page, a message or chat. orbiter reads the mod and
  // arcane names in it (and ranks, shards, Helminth, Forma, the Catalyst), shows what it matched and
  // what it couldn't, with suggestions to pick for those, and the build as it would be. Save keeps it.
  import { tick } from "svelte";
  import type { Model } from "../../core/model";
  import type { CatalogItem } from "../../core/types";
  import { heldCount } from "../../core/model";
  import { parsePaste, tierOf, type Build, type GearKind, type PasteResult } from "../../core/builds";
  import { parseTags, placeIn } from "../../core/buildsPage";
  import { opens, shade } from "../../motion";
  import { trap } from "../trap";
  import ModGrid from "./ModGrid.svelte";

  let { model, item, kind, onsave, onclose }: { model: Model; item: CatalogItem; kind: GearKind; onsave: (b: Build) => void; onclose: () => void } = $props();

  let text = $state("");
  let link = $state("");
  let title = $state("");
  let author = $state("");
  let tagText = $state("");
  /** Names picked for the ones orbiter couldn't match: the unmatched text → the path picked. */
  let picks = $state<{ text: string; path: string; arcane: boolean }[]>([]);
  let read = $state.raw<PasteResult | null>(null);
  let error = $state("");
  let area = $state<HTMLTextAreaElement | null>(null);

  // Read as you type, a moment after you stop (a whole page pasted reads at once).
  let timer: ReturnType<typeof setTimeout> | null = null;
  function readSoon(now = false) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(readIt, now ? 0 : 220);
  }
  function readIt() {
    error = "";
    if (!text.trim()) {
      read = null;
      return;
    }
    try {
      read = parsePaste(text, item, model.catalogByUnique, { kind, held: (p) => heldCount(model, p) });
      picks = picks.filter((p) => read!.unmatched.some((u) => u.text === p.text));
    } catch (e) {
      error = String(e).replace(/^Error:\s*/, "");
      read = null;
    }
  }
  $effect(() => {
    void tick().then(() => area?.focus());
  });

  const siteOf = (url: string): { url: string; site: string } | null => {
    try {
      const u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) return null;
      const host = u.hostname.replace(/^www\./, "");
      const site = host === "noxsframe.com" ? "Nox's Frame" : host === "overframe.gg" ? "Overframe" : host;
      return { url: u.toString(), site };
    } catch {
      return null;
    }
  };
  const linkOk = $derived(!link.trim() || !!siteOf(link));
  const draft = $derived.by((): Build | null => {
    if (!read) return null;
    let b = read.build;
    for (const p of picks) b = placeIn(b, p.path, p.arcane);
    const src = link.trim() ? siteOf(link) : null;
    const tags = parseTags(tagText);
    return { ...b, ...(title.trim() ? { title: title.trim() } : {}), ...(author.trim() ? { author: author.trim() } : {}), ...(tags.length ? { tags } : {}), source: src ?? "pasted" };
  });
  const tier = $derived(draft ? tierOf(draft, item, model.catalogByUnique, kind) : null);
  const left = $derived(read ? read.unmatched.filter((u) => !picks.some((p) => p.text === u.text)) : []);
  const found = $derived(draft ? [draft.aura, draft.exilus, draft.stance, ...draft.mods, ...draft.arcanes].filter(Boolean).length : 0);

  function pick(textOf: string, path: string) {
    const c = model.catalogByUnique.get(path);
    picks = [...picks.filter((p) => p.text !== textOf), { text: textOf, path, arcane: c?.category === "Arcanes" }];
  }
  function save() {
    if (!draft || !found || !linkOk) return;
    onsave({ ...draft, importedAt: Date.now() });
  }
  const ROLE: Record<string, string> = { aura: "Aura", exilus: "Exilus", stance: "Stance", mod: "Mod", arcane: "Arcane" };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" in:shade|global out:shade|global onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Paste a build for {item.name}" tabindex="-1" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} use:trap={{ onescape: onclose }} onclick={(e) => e.stopPropagation()}>
    <div class="register head">Paste a build · {item.name}</div>
    <label class="field">
      <span class="register">The build</span>
      <textarea bind:this={area} bind:value={text} rows="7" placeholder={"Paste it here: a build page copied whole, or a list like\nAura: Corrosive Projection\nVitality, Steel Fiber R8, Primed Continuity…\nArcanes: Energize, Grace"} title="Copy a build page (Ctrl+A, Ctrl+C) or any list of mod and arcane names, and paste it here" oninput={() => readSoon()} onpaste={() => readSoon(true)}></textarea>
    </label>
    <div class="row3">
      <label class="field"><span class="register">Title</span><input bind:value={title} placeholder="Optional" title="A name for it, as you'd like to find it again" /></label>
      <label class="field"><span class="register">Author</span><input bind:value={author} placeholder="Optional" title="Who made it" /></label>
      <label class="field"><span class="register">Link</span><input bind:value={link} class:bad={!linkOk} placeholder="https://… (optional)" title="Where it came from, to open it again later (orbiter never reads it)" /></label>
    </div>
    <label class="field"><span class="register">Tags</span><input bind:value={tagText} placeholder="Optional: Steel Path, Support, Shield gating…" title="What it's for, by commas: a role (DPS, Support, Tank), where (Star chart, Steel Path, Level cap), how it survives (Overguard, Shield gating)… The Builds page can show only builds with the tags you pick" /></label>
    {#if error}<p class="err small">{error}</p>{/if}

    {#if read && draft && tier}
      <div class="preview">
        <div class="found">
          <span class="register">Read {found} name{found === 1 ? "" : "s"}</span>
          <ul class="chips">
            {#each read.matched as m, i (i)}
              <li class="chip" title="{m.text} → {m.name}{m.via === 'alias' ? ' (read as the catalog spells it)' : ''}{m.note ? `: ${m.note}` : ''}"><span class="role">{ROLE[m.as]}</span>{m.name}{#if m.rank != null}<span class="rk">R{m.rank}</span>{/if}{#if m.via !== "exact" || m.note}<span class="alias">*</span>{/if}</li>
            {/each}
            {#each picks as p (p.text)}
              <li class="chip picked" title="You picked {model.nameOf(p.path)} for “{p.text}”"><span class="role">Picked</span>{model.nameOf(p.path)}<button type="button" class="x" title="Undo this pick" onclick={() => (picks = picks.filter((x) => x.text !== p.text))}>×</button></li>
            {/each}
          </ul>
        </div>
        {#if left.length}
          <div class="unmatched">
            <span class="register warn">Couldn't match {left.length}</span>
            <ul>
              {#each left as u (u.text)}
                <li>
                  <span class="txt">“{u.text}”</span>
                  <span class="dim small">{u.reason === "wrong-gear" ? `${u.why ?? "for other gear"}, not ${item.name}` : u.reason === "no-flawed" ? "has no Flawed version" : "no mod or arcane by that name"}</span>
                  {#if u.suggestions.length}<span class="sugs">{#each u.suggestions as s (s.path)}<button type="button" class="sug" title="Put {s.name} in the build for “{u.text}”" onclick={() => pick(u.text, s.path)}>{s.name}</button>{/each}</span>{/if}
                </li>
              {/each}
            </ul>
            <p class="dim small">Pick a suggestion, or leave it out: Save keeps the rest.</p>
          </div>
        {/if}
        {#if read.leftOut.length || read.notes.length}
          <ul class="notes dim small">
            {#each read.leftOut as l, i (i)}<li>Left out {l.name}: {l.why}.</li>{/each}
            {#each read.notes as n, i (i)}<li>{n}</li>{/each}
          </ul>
        {/if}
        <ModGrid {model} build={draft} {tier} />
      </div>
    {:else if !text.trim()}
      <p class="dim small">orbiter reads it here, on your computer: it never opens the page it came from.</p>
    {/if}

    <div class="row end">
      <button type="button" onclick={onclose} title="Close without saving">Cancel</button>
      <button type="button" class="stamp gold" disabled={!draft || !found || !linkOk} title={!draft || !found ? "Paste a build first: orbiter needs at least one mod or arcane it knows" : !linkOk ? "The link isn't a web address" : `Save it to ${item.name}'s builds`} onclick={save}>Save build</button>
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(52rem, 100%); max-height: calc(100vh - 2rem); overflow: auto; background: var(--plate); border: 1px solid var(--rule-bright); padding: 1.2rem 1.4rem 1.1rem; display: grid; gap: .8rem; box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%); }
  .head { color: var(--sec); }
  .field { display: grid; gap: .3rem; min-width: 0; }
  textarea { font: inherit; font-size: .84rem; color: var(--platinum); background: var(--well); border: 1px solid var(--rule-control); padding: .5rem .6rem; resize: vertical; min-height: 7rem; text-transform: none; letter-spacing: 0; }
  textarea:focus-visible, input:focus-visible { outline: 2px solid var(--sec); outline-offset: 1px; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1.4fr; gap: .7rem; }
  input.bad { border-color: var(--oxblood); }
  .preview { display: grid; gap: .7rem; padding-top: .6rem; border-top: 1px solid var(--rule); }
  .chips { list-style: none; margin: .35rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: .3rem; }
  .chip { display: inline-flex; align-items: center; gap: .35rem; padding: .18rem .45rem; border: 1px solid var(--rule-bright); background: var(--raised); font-size: .8rem; }
  .chip.picked { border-color: color-mix(in srgb, var(--sec) 50%, transparent); }
  .role { font-family: var(--face-register); font-size: .54rem; letter-spacing: .12em; text-transform: uppercase; color: var(--sec); }
  .rk { font-family: var(--face-register); font-size: .62rem; color: var(--platinum-deep); }
  .alias { color: var(--platinum-deep); }
  .x { all: unset; cursor: pointer; color: var(--platinum-deep); padding: 0 .1rem; }
  .x:hover { color: var(--platinum); }
  .x:focus-visible { outline: 2px solid var(--sec); }
  .unmatched ul { list-style: none; margin: .3rem 0 .3rem; padding: 0; display: grid; gap: .35rem; }
  .unmatched li { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .7rem; }
  .warn { color: var(--alert); }
  .txt { color: var(--platinum); }
  .sugs { display: inline-flex; flex-wrap: wrap; gap: .3rem; }
  .sug { padding: .15rem .45rem; font-size: .58rem; }
  .notes { margin: 0; padding-left: 1rem; }
  .err { color: var(--oxblood); margin: 0; }
  .row { display: flex; gap: .6rem; align-items: center; }
  .end { justify-content: flex-end; }
  :global(html[data-room~="lt760"]) .row3 { grid-template-columns: 1fr; }
</style>
