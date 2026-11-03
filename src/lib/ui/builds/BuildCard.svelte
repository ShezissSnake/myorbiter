<script lang="ts">
  // One build: where it's from, the Arsenal's slot grid, the tier it needs and why (capacity, the
  // Forma plan), and what you're missing of it, each line with what's left to do, the Endo to rank
  // it, where to get it, and for a mod or arcane you lack its price and the cheapest seller's whisper.
  import type { Model } from "../../core/model";
  import { missing, TIER_LABEL, type Build, type MissingLine, type MissingReport } from "../../core/builds";
  import { ageLine, loadoutLines, sourceName, TIER_NAME, TIER_TIP, type Shown } from "../../core/buildsPage";
  import { familyOfTag } from "./tags";
  import { openUrl } from "../../backend";
  import { info } from "../../hover.svelte";
  import { pop, reveal } from "../../motion";
  import ModGrid, { HAVE_MARK } from "./ModGrid.svelte";
  import SellerWhisper from "./SellerWhisper.svelte";
  import P from "../P.svelte";
  import Icon from "../Icon.svelte";
  import GameIcon from "../GameIcon.svelte";

  /** What orbiter's suggestion adds to a build: why each slot, better mods to get, its note, a loadout. */
  export interface Extras {
    why?: { aura?: string; exilus?: string; stance?: string; mods: (string | null)[]; arcanes: string[] } | null;
    upgrades?: { name: string; replaces: string | null; reason: string }[];
    loadout?: unknown;
  }

  let {
    model,
    shown,
    report: given = null,
    extras = null,
    now,
    onfav,
    onedit,
    onsave,
    ondelete,
  }: {
    model: Model;
    shown: Shown;
    /** What you're missing, when the page has it already (else worked out here). */
    report?: MissingReport | null;
    extras?: Extras | null;
    now: number;
    onfav: () => void;
    /** Edit it (a saved one of yours) or a copy of it. */
    onedit: () => void;
    /** Save a copy of a build that isn't saved (a site's, orbiter's). */
    onsave: (() => void) | null;
    ondelete: (() => void) | null;
  } = $props();

  const b = $derived(shown.build);
  const t = $derived(shown.tier);
  const report: MissingReport = $derived(given ?? missing(b, model, { tier: t }));
  const todo = $derived(report.lines.filter((l) => l.have !== "ok"));
  const inHand = $derived(report.lines.filter((l) => l.have === "ok"));
  let handOpen = $state(false);
  const loadout = $derived(loadoutLines(extras?.loadout));
  const site = $derived(typeof b.source === "object" ? b.source : null);
  const title = $derived(b.source === "orbiter" ? `orbiter's suggestion` : (b.title ?? (b.source === "mine" ? "Your build" : site ? `${site.site} build` : "Pasted build")));
  const fav = $derived(!!b.favourite);
  // Capacity: how full, and how far over when it doesn't fit.
  const fill = $derived(t.capacity > 0 ? Math.min(1, Math.max(0, t.drain) / t.capacity) : 0);
  const over = $derived(Math.max(0, t.drain - t.capacity));
  const doubled = $derived(t.catalyst ? t.rank / Math.max(1, t.capacity) : null);

  const ICON: Partial<Record<MissingLine["kind"], string>> = { forma: "foundry", umbraForma: "foundry", catalyst: "foundry", exilus: "foundry", arcaneAdapter: "foundry", shard: "archon-shard" };
  const buyable = (l: MissingLine) => (l.kind === "mod" && l.have === "missing") || (l.kind === "arcane" && (l.have === "missing" || l.have === "short"));
</script>

{#snippet line(l: MissingLine)}
  <li class="ln {l.have}">
    <span class="mk" title={HAVE_MARK[l.have].word}>{HAVE_MARK[l.have].mark}</span>
    <span class="what">
      <span class="nmline">
        {#if l.kind === "mod" || l.kind === "arcane"}<b class="nm" use:info={{ name: l.name, unique: l.path ?? null }}>{l.name}</b>
        {:else}<b class="nm plain">{#if ICON[l.kind]}<GameIcon name={ICON[l.kind] as "foundry"} size={13} />{/if}{l.name}</b>{/if}
        {#if l.kind === "mod" && l.endo}<span class="endo" title="Endo to rank it from what you hold to the build's rank"><GameIcon name="endo" size={12} />{l.endo.toLocaleString("en")}</span>{/if}
      </span>
      <span class="tx">{l.text}{#if l.how && l.have !== "ok"} <span class="how">{l.how}</span>{/if}</span>
    </span>
    {#if buyable(l)}
      <span class="buy">{#if l.price != null}<span title="Daily median on warframe.market, unranked"><P v={Math.round(l.price)} /></span>{/if}<SellerWhisper name={l.name} unique={l.path ?? null} /></span>
    {/if}
  </li>
{/snippet}

<article class="build" class:fav data-place={shown.place} aria-label="{title}{b.author ? ` by ${b.author}` : ''}">
  <header class="hd">
    <div class="who">
      <span class="src" class:orbiter={b.source === "orbiter"} title={b.source === "orbiter" ? "orbiter's own starting point, from the mods you hold: not a player's build" : site ? `From ${site.site}` : b.source === "mine" ? "A build you made" : "A build you pasted"}>{sourceName(b.source)}</span>
      <h3 class="name-mark">{title}</h3>
      <span class="meta">
        {#if b.author}<span>by {b.author}</span>{/if}
        {#if b.votes != null}<span title="Votes on {site?.site ?? 'its site'}">▲ {b.votes.toLocaleString("en")}</span>{/if}
        {#if b.source !== "orbiter" || shown.saved}<span title={b.updatedAt != null ? `Its source last changed it on ${new Date(b.updatedAt).toLocaleDateString()}` : `Added to orbiter on ${new Date(b.importedAt).toLocaleDateString()}`}>{ageLine(b, now)}</span>{/if}
        {#if b.gameUpdate}<span title="The game update it was made for">Update {b.gameUpdate}</span>{/if}
        {#if b.tags?.length}<span class="tags">{#each b.tags as tg (tg)}<span class="tagc" title="{familyOfTag(tg)}: {tg}">{tg}</span>{/each}</span>{/if}
        {#if site}<button type="button" class="link out" title="Open it on {site.site}, in your browser" onclick={() => openUrl(site.url)}>{site.site}<Icon name="external" size={11} /></button>{/if}
      </span>
    </div>
    <div class="acts">
      <button type="button" class="star" class:on={fav} aria-pressed={fav} title={fav ? "A favourite: shown first. Click to unstar" : shown.saved ? "Star it: favourites come first" : "Star it: saves it to your builds, first in its tier"} onclick={onfav}><span class="glyph" aria-hidden="true" use:pop={{ on: fav, of: b.id }}>{fav ? "★" : "☆"}</span></button>
      {#if onsave}<button type="button" title="Save a copy to your builds, to keep it and change it" onclick={onsave}>Save</button>{/if}
      <button type="button" title={shown.saved && b.source !== "orbiter" ? "Change its mods, arcanes, shards and Helminth" : "Change a copy of it: saved as yours"} onclick={onedit}><Icon name="pencil" size={12} /> {shown.saved && b.source !== "orbiter" ? "Edit" : "Edit a copy"}</button>
      {#if ondelete}<button type="button" class="del" title="Delete it from your builds (you get a few seconds to undo)" onclick={ondelete}><Icon name="trash" size={12} /></button>{/if}
    </div>
  </header>

  <div class="body">
    <div class="gridcol">
      <ModGrid {model} build={b} tier={t} {report} why={extras?.why ?? null} />
      {#if b.parts?.length}<p class="parts dim small">With {b.parts.map((p) => model.nameOf(p)).join(", ")}</p>{/if}
    </div>

    <div class="side">
      <section class="tier" aria-label="What it takes">
        <div class="tline" title={TIER_TIP[t.tier]}>
          <span class="tmark t-{t.tier}" aria-hidden="true"><i></i><i></i><i></i></span>
          <b class="name-mark">{TIER_NAME[t.tier]}</b>
          {#if !t.fits}<span class="tag alert" title="Even with the Catalyst and Forma, the mods drain more than the capacity">Doesn't fit</span>{/if}
        </div>
        <span class="register capword">Capacity · {TIER_LABEL[t.tier]}</span>
        <div class="cap" title="Capacity: the mods drain {t.drain} of {t.capacity}{t.catalyst ? ` (rank ${t.rank}, doubled by the ${b.kind === 'warframe' || b.kind === 'companion' || b.kind === 'archwing' || b.kind === 'necramech' ? 'Reactor' : 'Catalyst'}, plus the aura or stance)` : ` (rank ${t.rank}, plus the aura or stance)`}">
          <span class="meter"><span class="fillbar" class:over={over > 0} style:transform="scaleX({fill})"></span>{#if doubled}<span class="half" style:left="{doubled * 100}%"></span>{/if}</span>
          <span class="nums"><b>{t.drain}</b><span class="dim">/{t.capacity}</span>{#if over}<span class="bad small"> {over} over</span>{/if}</span>
        </div>
        <ul class="reasons">{#each t.reasons as r, i (i)}<li>{r}</li>{/each}</ul>
      </section>

      <section class="miss" aria-label="What you're missing">
        <h4 class="register">
          {#if todo.length}What you're missing · <span class="cnt">{todo.length} to get</span>{:else}<span class="good">You have everything it takes</span>{/if}
          {#if report.endo}<span class="endoall" title="Endo to rank every mod as the build wants"><GameIcon name="endo" size={12} />{report.endo.toLocaleString("en")} Endo</span>{/if}
        </h4>
        {#if todo.length}<ul class="lines">{#each todo as l, i (`${l.kind}${l.path ?? l.name}${i}`)}{@render line(l)}{/each}</ul>{/if}
        {#if inHand.length}
          <button type="button" class="link hand" aria-expanded={handOpen} title={handOpen ? "Hide what you have" : "Show what you already have for it"} onclick={() => (handOpen = !handOpen)}><span class="chev" class:open={handOpen} aria-hidden="true">›</span> In hand: {inHand.length}</button>
          {#if handOpen}<div transition:reveal><ul class="lines">{#each inHand as l, i (`${l.kind}${l.path ?? l.name}${i}`)}{@render line(l)}{/each}</ul></div>{/if}
        {/if}
      </section>

      {#if loadout.length}
        <section class="loadout" aria-label="Loadout">
          <h4 class="register">With it</h4>
          <dl>{#each loadout as l (l.label)}<dt>{l.label}</dt><dd>{l.text}</dd>{/each}</dl>
        </section>
      {/if}
      {#if extras?.upgrades?.length}
        <section class="ups" aria-label="Better if you get">
          <h4 class="register">Better if you get</h4>
          <ul>{#each extras.upgrades.slice(0, 5) as u (u.name)}<li title={u.reason}><b>{u.name}</b>{#if u.replaces} <span class="dim">for {u.replaces}</span>{/if}</li>{/each}</ul>
        </section>
      {/if}
      {#if b.note}<p class="note dim small" title={b.note}>{b.note}</p>{/if}
    </div>
  </div>
</article>

<style>
  .build { border: 1px solid var(--rule); background: var(--plate); clip-path: var(--cut); }
  .build.fav { border-color: color-mix(in srgb, var(--gold) 40%, var(--rule)); }
  .hd { display: flex; align-items: flex-start; gap: 1rem; padding: .75rem .9rem .6rem; border-bottom: 1px solid var(--rule); }
  .who { display: grid; gap: .25rem; min-width: 0; flex: 1; }
  .src { justify-self: start; font-family: var(--face-register); font-size: .58rem; letter-spacing: .14em; text-transform: uppercase; color: var(--sec); }
  .src.orbiter { color: var(--platinum-dim); }
  .src.orbiter::before { content: "◆ "; color: var(--sec); }
  .who h3 { margin: 0; font-size: 1.15rem; line-height: 1; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem .9rem; font-size: .78rem; color: var(--platinum-deep); }
  .out { display: inline-flex; align-items: center; gap: .25rem; font-size: .78rem; }
  .acts { display: flex; align-items: center; gap: .35rem; flex: none; }
  .acts button { padding: .32rem .6rem; font-size: .6rem; display: inline-flex; align-items: center; gap: .3rem; }
  .star { min-width: 2rem; justify-content: center; font-size: .95rem !important; color: var(--platinum-dim); }
  .star.on { color: var(--gold); border-color: var(--gold-dim); }
  .glyph { display: inline-block; line-height: 1; }
  .glyph:global([data-pop]) { animation: pop var(--snap) var(--out); }
  .del:hover:not(:disabled) { color: var(--oxblood); border-color: color-mix(in srgb, var(--oxblood) 55%, transparent); }

  .body { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 1rem; padding: .9rem; }
  :global(html[data-room~="lt1100"]) .body { grid-template-columns: 1fr; }
  .gridcol { min-width: 0; }
  .parts { margin: .4rem 0 0; }
  .side { display: grid; align-content: start; gap: .9rem; min-width: 0; }

  .tline { display: flex; align-items: baseline; gap: .55rem; flex-wrap: wrap; }
  .tline .name-mark { font-size: 1.05rem; color: var(--sec); }
  /* The tier as rising bars: one, two, three lit. */
  .tmark { display: inline-flex; align-items: flex-end; gap: 2px; height: .8rem; align-self: center; }
  .tmark i { width: 4px; background: var(--rule-bright); }
  .tmark i:nth-child(1) { height: 40%; }
  .tmark i:nth-child(2) { height: 70%; }
  .tmark i:nth-child(3) { height: 100%; }
  .t-low i:nth-child(1), .t-medium i:nth-child(-n + 2), .t-high i { background: var(--sec); }
  .capword { display: block; margin-top: .55rem; font-size: .56rem; }
  .cap { display: flex; align-items: center; gap: .7rem; margin: .3rem 0 .35rem; }
  .tags { display: inline-flex; flex-wrap: wrap; gap: .25rem; }
  .tagc { padding: .02rem .4rem; border: 1px solid color-mix(in srgb, var(--sec) 40%, var(--rule)); color: var(--platinum-dim); font-size: .72rem; }
  .meter { position: relative; flex: 1; height: 6px; background: var(--well); border: 1px solid var(--rule-bright); overflow: hidden; }
  .fillbar { position: absolute; inset: 0; background: var(--sec); transform-origin: left center; transition: transform var(--quick) var(--out); }
  .fillbar.over { background: var(--oxblood); }
  /* Where the rank alone ends: the Catalyst or Reactor doubles past it. */
  .half { position: absolute; top: -1px; bottom: -1px; width: 1px; background: var(--platinum-dim); }
  .nums { font-family: var(--face-register); font-size: .78rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nums b { color: var(--platinum); }
  .bad { color: var(--oxblood); }
  .reasons { margin: 0; padding-left: 1rem; display: grid; gap: .2rem; font-size: .8rem; color: var(--platinum-dim); line-height: 1.45; }

  .miss h4, .loadout h4, .ups h4 { margin: 0 0 .4rem; display: flex; align-items: center; flex-wrap: wrap; gap: .3rem .8rem; }
  .cnt { color: var(--alert); }
  .good { color: var(--verdigris); }
  .endoall { display: inline-flex; align-items: center; gap: .25rem; color: var(--platinum-dim); letter-spacing: .06em; }
  .lines { list-style: none; margin: 0; padding: 0; display: grid; }
  .ln { display: grid; grid-template-columns: 1.1rem minmax(0, 1fr) auto; gap: .5rem; align-items: start; padding: .4rem 0; border-top: 1px solid var(--rule); }
  .mk { width: 1rem; height: 1rem; display: grid; place-items: center; font-size: .62rem; font-weight: 700; margin-top: .1rem; color: var(--slab); background: var(--platinum-deep); }
  .ok .mk { background: none; color: var(--verdigris); border: 1px solid color-mix(in srgb, var(--verdigris) 50%, transparent); }
  .missing .mk { background: var(--oxblood); }
  .short .mk { background: var(--alert); }
  .what { display: grid; gap: .1rem; min-width: 0; }
  .nmline { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .nm { font-size: .86rem; font-weight: 500; color: var(--platinum); text-align: left; }
  .nm.plain { display: inline-flex; align-items: center; gap: .3rem; font-weight: 500; }
  .endo { display: inline-flex; align-items: center; gap: .2rem; font-family: var(--face-register); font-size: .68rem; color: var(--platinum-dim); }
  .tx { font-size: .78rem; color: var(--platinum-dim); line-height: 1.4; }
  .how { display: block; color: var(--platinum-deep); }
  .buy { display: inline-flex; align-items: center; gap: .6rem; padding-top: .1rem; white-space: nowrap; }
  .hand { display: inline-flex; align-items: center; gap: .35rem; margin-top: .45rem; font-size: .8rem; }
  .chev { display: inline-block; transition: transform var(--quick) var(--out); }
  .chev.open { transform: rotate(90deg); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .25rem .8rem; margin: 0; font-size: .8rem; }
  dt { color: var(--platinum-deep); }
  dd { margin: 0; color: var(--platinum-dim); }
  .ups ul { margin: 0; padding-left: 1rem; font-size: .8rem; display: grid; gap: .15rem; }
  .ups b { font-weight: 500; color: var(--platinum); }
  .note { margin: 0; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; }
</style>
