<script lang="ts">
  // One build: where it's from, the Arsenal's slot grid, the tier it needs and why (capacity, the
  // Forma plan), and what you're missing of it, each line with what's left to do, the Endo to rank
  // it, where to get it, and for a mod or arcane you lack its price and the cheapest seller's whisper.
  // orbiter's suggestion also shows its variants, the shards and Helminth in the grid, and "With it":
  // the element, companion or primer, support weapons, arcane swaps, Focus and mod sets around a
  // warframe, or a weapon's ideal riven.
  import type { Model } from "../../core/model";
  import { missing, type Build, type MissingLine, type MissingReport } from "../../core/builds";
  import type { Loadout, LoadoutPick, WeaponRiven } from "../../core/builds/suggest";
  import { ageLine, BASIS_WORD, helminthShow, rivenShort, shardSlots, sourceName, withItLines, TIER_NAME, TIER_TIP, type Shown, type WithItLine } from "../../core/buildsPage";
  import { familyOfTag } from "./tags";
  import { openUrl } from "../../backend";
  import { info } from "../../hover.svelte";
  import { pop, reveal } from "../../motion";
  import ModGrid, { HAVE_MARK } from "./ModGrid.svelte";
  import SellerWhisper from "./SellerWhisper.svelte";
  import P from "../P.svelte";
  import Icon from "../Icon.svelte";
  import GameIcon, { type GameIconName } from "../GameIcon.svelte";
  import Thumb from "../Thumb.svelte";

  /** What orbiter's suggestion adds to a build: why each slot, better mods to get, a loadout, the ideal riven, its variants. */
  export interface Extras {
    why?: { aura?: string; exilus?: string; stance?: string; mods: (string | null)[]; arcanes: string[] } | null;
    upgrades?: { name: string; replaces: string | null; reason: string }[];
    loadout?: Loadout | null;
    riven?: WeaponRiven | null;
    /** The suggestion's variants (Star Chart, Steel Path nuke…) and the one shown. */
    variants?: { id: string; label: string; tags: string[] }[];
    variant?: string;
    onvariant?: (id: string) => void;
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
  // The tier's reasons: what puts it in the tier (a line per mod or item, the first few shown), then capacity and Forma.
  const LEAD_SHOWN = 3;
  let whyOpen = $state(false);
  const leadN = $derived(Math.max(1, t.limits.length));
  const lead = $derived(t.reasons.slice(0, leadN));
  const after = $derived(t.reasons.slice(leadN));
  const lo = $derived(extras?.loadout ?? null);
  const withIt = $derived(withItLines(lo, b.arcanes.map((a) => a.path)));
  const shards = $derived(shardSlots(b, lo));
  const helminth = $derived(helminthShow(b, lo));
  const riven = $derived(extras?.riven ?? null);
  const melee = $derived(b.kind === "melee" || b.kind === "archmelee");
  const variants = $derived(extras?.variants ?? []);
  // "Default" (gear without variants: companions, archwings, Necramechs) says nothing as a title.
  const variantLabel = $derived.by(() => {
    const l = variants.find((v) => v.id === extras?.variant)?.label ?? variants[0]?.label ?? null;
    return l === "Default" && variants.length < 2 ? null : l;
  });
  const site = $derived(typeof b.source === "object" ? b.source : null);
  // orbiter's suggestion: the source line says whose it is; the title says which variant.
  const title = $derived(b.source === "orbiter" && !shown.saved ? (variantLabel ?? "Suggested build") : b.source === "orbiter" ? (b.title?.replace(/^orbiter's suggestion \((.*)\)$/, "$1") ?? "orbiter's suggestion") : (b.title ?? (b.source === "mine" ? "Your build" : site ? `${site.site} build` : "Pasted build")));
  const fav = $derived(!!b.favourite);
  // Capacity: how full, and how far over when it doesn't fit.
  const fill = $derived(t.capacity > 0 ? Math.min(1, Math.max(0, t.drain) / t.capacity) : 0);
  const over = $derived(Math.max(0, t.drain - t.capacity));
  const doubled = $derived(t.catalyst ? t.rank / Math.max(1, t.capacity) : null);

  const ICON: Partial<Record<MissingLine["kind"], string>> = { forma: "foundry", umbraForma: "foundry", catalyst: "foundry", exilus: "foundry", arcaneAdapter: "foundry", shard: "archon-shard" };
  const LINE_ICON: Partial<Record<WithItLine["key"], GameIconName>> = { companion: "companions", primer: "companions", support: "secondary", focus: "amp" };
  const LINE_GLYPH: Partial<Record<WithItLine["key"], string>> = { arcanes: "arcanes", set: "sets" };
  const SHARD_TINT: Record<string, string> = { crimson: "#d0574a", azure: "#6ea8dc", amber: "#e2a94a", violet: "#a78bd4", topaz: "#d98b3a", emerald: "#6fb77a" };
  const hosts = (src: string) => [...new Set(src.split(/\s*;\s*/).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }).filter(Boolean))].join(", ");
  const HELD_WORD = (o: boolean | null) => (o === true ? "You hold it." : o === false ? "You don't hold it." : "orbiter can't see this yet.");
  const pickTip = (p: LoadoutPick) => `${p.name}${p.on ? ` (on ${p.on})` : ""}\n${p.reason}\n${HELD_WORD(p.owned)}${p.source ? `\nRead on ${hosts(p.source)}` : ""}`;
  const marketBacked = $derived(!!riven && riven.ideal.positives.some((x) => x.basis !== "rule"));
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
      {#if variants.length > 1 && extras?.onvariant}
        <div class="vars" data-card="variants" role="radiogroup" aria-label="orbiter's variants">
          <span class="register">Variant</span>
          {#each variants as v (v.id)}
            {@const on = (extras.variant ?? variants[0].id) === v.id}
            <button type="button" role="radio" class="var" class:on aria-checked={on} title={on ? `Showing the ${v.label} variant (${v.tags.join(", ")})` : `Show orbiter's ${v.label} variant instead (${v.tags.join(", ")})`} onclick={() => extras.onvariant?.(v.id)}>{v.label}</button>
          {/each}
        </div>
      {/if}
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
      <ModGrid {model} build={b} tier={t} {report} why={extras?.why ?? null} {shards} {helminth} />
      {#if b.parts?.length}<p class="parts dim small">With {b.parts.map((p) => model.nameOf(p)).join(", ")}</p>{/if}
    </div>

    <div class="side">
      <section class="tier" aria-label="What it takes">
        <div class="tline" title={TIER_TIP[t.tier]}>
          <span class="tmark t-{t.tier}" aria-hidden="true"><i></i><i></i><i></i></span>
          <b class="name-mark">{TIER_NAME[t.tier]}</b>
          {#if !t.fits}<span class="tag alert" title="Even with the Catalyst and Forma, the mods drain more than the capacity">Doesn't fit</span>{/if}
        </div>
        <span class="register capword">Capacity</span>
        <div class="cap" title="Capacity: the mods drain {t.drain} of {t.capacity}{t.catalyst ? ` (rank ${t.rank}, doubled by the ${b.kind === 'warframe' || b.kind === 'companion' || b.kind === 'archwing' || b.kind === 'necramech' ? 'Reactor' : 'Catalyst'}, plus the aura or stance)` : ` (rank ${t.rank}, plus the aura or stance)`}">
          <span class="meter"><span class="fillbar" class:over={over > 0} style:transform="scaleX({fill})"></span>{#if doubled}<span class="half" style:left="{doubled * 100}%"></span>{/if}</span>
          <span class="nums"><b>{t.drain}</b><span class="dim">/{t.capacity}</span>{#if over}<span class="bad small"> {over} over</span>{/if}</span>
        </div>
        <ul class="reasons">
          {#each after as r, i (i)}<li class="sum">{r}</li>{/each}
          {#each lead.slice(0, LEAD_SHOWN) as r, i (i)}<li>{r}</li>{/each}
          {#if lead.length > LEAD_SHOWN}
            {#if whyOpen}<div class="more" transition:reveal>{#each lead.slice(LEAD_SHOWN) as r, i (i)}<li>{r}</li>{/each}</div>{/if}
            <li class="fold"><button type="button" class="link" aria-expanded={whyOpen} title={whyOpen ? "Show fewer" : "Every mod and item that puts it in this tier"} onclick={() => (whyOpen = !whyOpen)}><span class="chev" class:open={whyOpen} aria-hidden="true">›</span> {whyOpen ? "Fewer" : `${lead.length - LEAD_SHOWN} more`}</button></li>
          {/if}
        </ul>
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

      {#if withIt.length || riven}
        <section class="withit" data-card="withit" aria-label="With it">
          <h4 class="register">With it</h4>
          <ul class="wl">
            {#if riven}
              {@const ideal = riven.ideal}
              <li class="wrow riv">
                <span class="wlab"><GameIcon name="riven" size={14} />Ideal riven</span>
                <span class="wbody">
                  <span class="rvline">
                    {#each ideal.positives as x, i (x.slug)}{#if i}<span class="sep" aria-hidden="true">·</span>{/if}<b class="rs" class:mkt={x.basis !== "rule"} title="{x.stat}: {x.why}\n{BASIS_WORD[x.basis][0].toUpperCase() + BASIS_WORD[x.basis].slice(1)}">{rivenShort(x, melee)}</b>{/each}
                    {#if ideal.negatives.length}<span class="harm" title="Negatives that cost this weapon little:\n{ideal.negatives.map((n) => `−${n.stat}: ${n.why}`).join('\n')}">harmless: {ideal.negatives.slice(0, 3).map((n) => `−${rivenShort(n, melee)}`).join(" · ")}</span>{/if}
                  </span>
                  <span class="rvsrc">
                    <span title={ideal.label}>orbiter's rule{#if marketBacked} <span class="mkey">· <i></i>what players pay most for on warframe.market ({ideal.basedOn.auctions} listed)</span>{:else if ideal.basedOn.auctions}, too few listings read to say what players pay most for on warframe.market{:else}; nothing read from warframe.market for it yet (the Rivens page reads it){/if}</span>
                    <span title="{ideal.disposition.note}\n{ideal.disposition.source}">Dispositions are flat since Hotfix 44.1.3</span>
                  </span>
                  {#if riven.yours?.length}
                    <span class="yours"><span class="register">Yours</span>
                      {#each riven.yours.slice(0, 3) as y (y.riven.id)}
                        <span class="yr" class:good={y.fit.wanted === y.fit.of && y.fit.negative !== "hurts"} title="Your {y.riven.weapon} {y.riven.name} ({y.riven.grade}): {y.fit.text}"><span class="yn">{y.riven.name}</span> <span class="yf">{y.fit.wanted}/{y.fit.of}{y.fit.curse ? ` · −${y.fit.curse} ${y.fit.negative === "harmless" ? "harmless" : y.fit.negative === "hurts" ? "hurts" : "mild"}` : ""}</span></span>
                      {/each}
                    </span>
                  {/if}
                </span>
              </li>
            {/if}
            {#each withIt as l (l.key + l.label)}
              <li class="wrow" title={l.title ?? null}>
                <span class="wlab">
                  {#if l.key === "element"}<span class="gem" style:--tint={l.colour ? SHARD_TINT[l.colour] : "var(--platinum-deep)"} aria-hidden="true"></span>
                  {:else if LINE_ICON[l.key]}<GameIcon name={LINE_ICON[l.key]!} size={14} />
                  {:else if LINE_GLYPH[l.key]}<Icon name={LINE_GLYPH[l.key]!} size={13} />{/if}{l.label}
                </span>
                <span class="wbody">
                  {#each l.picks as p, i (p.name + i)}
                    <span class="pk" class:no={p.owned === false} title={pickTip(p)}>
                      <Thumb file={model.imageOf(p.name)} size={18} of={p.name} />
                      <span class="pn">{p.name}</span>
                      {#if p.owned === true}<span class="om ok" aria-label="You hold it">✓</span>{:else if p.owned === false}<span class="om no" aria-label="You don't hold it">✕</span>{/if}
                    </span>
                  {/each}
                  {#if l.text}<span class="wt">{l.text}</span>{/if}
                </span>
              </li>
            {/each}
          </ul>
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
  .reasons .sum { color: var(--platinum); }
  .reasons .more { display: grid; gap: .2rem; }
  .reasons .fold { list-style: none; margin-left: -1rem; }
  .reasons .fold .link { display: inline-flex; align-items: center; gap: .35rem; font-size: .78rem; }

  .miss h4, .withit h4, .ups h4 { margin: 0 0 .4rem; display: flex; align-items: center; flex-wrap: wrap; gap: .3rem .8rem; }
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
  /* Variants: small plates under the title, the one shown lit in the section's colour. */
  .vars { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; margin-top: .2rem; }
  .vars .register { font-size: .54rem; margin-right: .2rem; }
  .var { padding: .16rem .55rem; font-family: var(--face-text); font-size: .76rem; letter-spacing: 0; text-transform: none; color: var(--platinum-dim); }
  .var.on { color: var(--slab); background: var(--sec); border-color: var(--sec); }
  .var:focus-visible { outline: 2px solid var(--sec); outline-offset: 2px; }

  /* With it: one line each, a label on the left, the picks as small chips with what you hold. */
  .wl { list-style: none; margin: 0; padding: 0; display: grid; }
  .wrow { display: grid; grid-template-columns: 7.2rem minmax(0, 1fr); gap: .6rem; align-items: start; padding: .32rem 0; border-top: 1px solid var(--rule); }
  .wlab { display: inline-flex; align-items: center; gap: .35rem; padding-top: .18rem; font-family: var(--face-register); font-size: .58rem; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum-deep); }
  .wbody { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .35rem; min-width: 0; font-size: .8rem; color: var(--platinum-dim); }
  .gem { width: .7rem; height: .85rem; flex: none; background: var(--tint); clip-path: polygon(50% 0, 100% 30%, 100% 70%, 50% 100%, 0 70%, 0 30%); }
  .pk { display: inline-flex; align-items: center; gap: .3rem; max-width: 100%; padding: .08rem .4rem .08rem .1rem; background: var(--well); border: 1px solid var(--rule); }
  .pk.no { border-style: dashed; }
  .pk.no :global(.thumb) { opacity: .5; }
  .pn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--platinum); font-size: .78rem; }
  .om { font-size: .62rem; font-weight: 700; }
  .om.ok { color: var(--verdigris); }
  .om.no { color: var(--oxblood); }
  .wt { font-size: .76rem; color: var(--platinum-deep); }
  /* The ideal riven: its three stats as players write them, a gold underline where the market agrees. */
  .riv .wbody { display: grid; gap: .2rem; }
  .rvline { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .4rem; }
  .rs { font-family: var(--face-mark); font-size: 1rem; font-weight: 700; letter-spacing: .02em; color: var(--platinum); }
  .rs.mkt { box-shadow: inset 0 -2px 0 var(--gold-dim); }
  .sep { color: var(--platinum-deep); }
  .harm { margin-left: .4rem; font-size: .78rem; color: var(--platinum-dim); }
  .rvsrc { display: flex; flex-wrap: wrap; gap: .1rem .9rem; font-size: .72rem; color: var(--platinum-deep); }
  .mkey i { display: inline-block; width: .8rem; height: 2px; margin: 0 .25rem .2rem 0; vertical-align: middle; background: var(--gold-dim); }
  .yours { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem; margin-top: .1rem; }
  .yours .register { font-size: .54rem; margin-right: .1rem; }
  .yr { padding: .06rem .45rem; border: 1px solid var(--rule); background: var(--well); font-size: .76rem; }
  .yr .yn { color: var(--platinum); }
  .yr .yf { color: var(--platinum-deep); font-variant-numeric: tabular-nums; }
  .yr.good { border-color: color-mix(in srgb, var(--verdigris) 45%, var(--rule)); }
  :global(html[data-room~="lt760"]) .wrow { grid-template-columns: 1fr; gap: .2rem; }
  .ups ul { margin: 0; padding-left: 1rem; font-size: .8rem; display: grid; gap: .15rem; }
  .ups b { font-weight: 500; color: var(--platinum); }
  .note { margin: 0; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.5; }
</style>
