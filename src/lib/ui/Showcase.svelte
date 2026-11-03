<script lang="ts" module>
  import type { GameIconName } from "./GameIcon.svelte";
  /** One piece on display. */
  export interface Exhibit {
    key: string;
    name: string;
    /** The line under the name: how many are spare, the part, the riven's weapon. */
    sub?: string;
    /** What its spares are worth (what it's worth, with none spare); null: no price yet. */
    value: number | null;
    /** On hover: what the piece and its figure are. */
    title: string;
    open: () => void;
    image: string | null;
    /** How it's drawn: its picture, a mod card, an arcane's sigil, an unveiled riven's card. */
    look: "art" | "mod" | "arcane" | "riven";
    fallback?: GameIconName | null;
    /** A small picture in the corner: the part, on the item it builds. */
    badge?: string | null;
    card?: { rarity?: string; polarity?: string | null; drain?: number | null; maxRank?: number | null; rank?: number; label?: string; does?: string };
    /** Rivens: the roll's grade. */
    grade?: string | null;
  }
</script>

<script lang="ts">
  // The Collection pages' signature: the page opens on its most valuable spares, large, as the
  // Arsenal shows gear. The first stands forward, the rest beside it, each on a thin light in the
  // section's colour. Click one for its details. (core/showcase.ts picks them.)
  import Art from "./Art.svelte";
  import ModCard from "./ModCard.svelte";
  import P from "./P.svelte";
  import Thumb from "./Thumb.svelte";

  let { items, caption, note = "", empty = "" }: { items: Exhibit[]; caption: string; note?: string; empty?: string } = $props();
  const gradeTone = (g: string) => (g === "S" ? "s" : /^A/.test(g) ? "a" : /^[CF]/.test(g) ? "c" : "b");
</script>

<section class="showcase" aria-label={caption}>
  <header class="cap">
    <span class="register">{caption}</span>
    {#if note}<span class="note">{note}</span>{/if}
  </header>
  {#if items.length}
    <ol class="stage">
      {#each items as x, i (x.key)}
        {@const lead = i === 0}
        <li class="piece" class:lead data-place={i + 1}>
          <button type="button" class="hit" title={x.title} aria-label="{x.name}: details" onclick={x.open}>
            <span class="gear">
              {#if x.look === "art"}
                <Art file={x.image} size={lead ? 168 : 112} fallback={x.fallback ?? null} />
                {#if x.badge}<span class="badge"><Thumb file={x.badge} size={lead ? 40 : 30} /></span>{/if}
              {:else}
                <ModCard name={x.name} image={x.image} arcane={x.look === "arcane"} rarity={x.look === "riven" ? "Riven" : (x.card?.rarity ?? "")} polarity={x.card?.polarity ?? null} drain={x.card?.drain ?? null} maxRank={x.card?.maxRank ?? null} rank={x.card?.rank ?? 0} label={x.card?.label ?? ""} does={lead ? (x.card?.does ?? "") : ""} width={x.look === "arcane" ? (lead ? 156 : 112) : lead ? 142 : 116} />
              {/if}
            </span>
            <span class="light" aria-hidden="true"></span>
            <span class="plaque">
              <b class="nm mark">{x.name}</b>
              {#if x.sub}<span class="sub">{x.sub}</span>{/if}
              <span class="val">
                {#if x.grade}<b class="grade g-{gradeTone(x.grade)}">{x.grade}</b>{/if}
                <P v={x.value} />
              </span>
            </span>
          </button>
        </li>
      {/each}
      <!-- The places left over stay on the floor, unlit, so the pieces keep their size and line up. -->
      {#each Array.from({ length: Math.max(0, 5 - items.length) }, (_, i) => items.length + i + 1) as place (place)}
        <li class="piece open" data-place={place} aria-hidden="true"><span class="light"></span></li>
      {/each}
    </ol>
  {:else}
    <p class="empty">{empty}</p>
  {/if}
</section>

<style>
  /* The stage: darker than the slab, cut at two corners, the pieces standing on one floor. */
  .showcase {
    position: relative; margin-top: .2rem;
    background: #060708; clip-path: var(--cut);
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    padding: .7rem clamp(.8rem, 2vw, 1.6rem) 0;
  }
  .cap { display: flex; align-items: baseline; gap: .9rem; flex-wrap: wrap; }
  .cap .register { color: var(--sec); }
  .note { font-size: .74rem; color: var(--platinum-deep); }
  .stage {
    list-style: none; margin: 0; padding: .4rem 0 0;
    display: grid; grid-template-columns: minmax(0, 1.45fr) repeat(4, minmax(0, 1fr)); align-items: end; gap: 0 clamp(.4rem, 1.5vw, 1.4rem);
    /* The floor: one faint line the lights sit on. */
    background: linear-gradient(var(--sec-dim), var(--sec-dim)) 0 calc(100% - 4.35rem) / 100% 1px no-repeat;
  }
  .piece { min-width: 0; }
  .open { display: grid; justify-items: center; padding-bottom: 4.35rem; }
  .open .light { background: var(--rule-bright); box-shadow: none; }
  .hit {
    display: grid; justify-items: center; width: 100%; padding: .2rem .3rem 0; border: 0; background: none; color: inherit;
    font: inherit; text-transform: none; letter-spacing: normal; cursor: pointer; clip-path: none;
  }
  .hit:hover, .hit:active { background: none; }
  .hit:focus-visible { outline: 2px solid var(--sec); outline-offset: 2px; }
  .gear { position: relative; display: grid; place-items: end center; min-height: 112px; }
  .lead .gear { min-height: 168px; }
  /* Its own light, not the Art's gold pool: steel blue from below. */
  .gear :global(.art) { background: radial-gradient(ellipse 58% 16% at 50% 100%, color-mix(in srgb, var(--sec) 22%, transparent), transparent 72%); }
  /* An arcane's name is on the plaque under it: its sigil shows just the rank. */
  .gear :global(.arcane .nm) { display: none; }
  .badge { position: absolute; right: -.2rem; bottom: .3rem; }
  .badge :global(.thumb) { background: var(--slab); }
  /* The thin light the piece stands on. */
  .light {
    display: block; width: 74%; height: 2px; margin-top: .45rem;
    background: var(--sec-dim);
    box-shadow: 0 0 10px 1px color-mix(in srgb, var(--sec) 35%, transparent);
    transition: background-color .18s, box-shadow .18s;
  }
  .lead .light { width: 82%; }
  .hit:hover .light, .hit:focus-visible .light { background: var(--sec); box-shadow: 0 0 14px 2px color-mix(in srgb, var(--sec) 55%, transparent); }
  .plaque { display: grid; justify-items: center; gap: .12rem; width: 100%; height: 4.35rem; align-content: start; padding-top: .45rem; text-align: center; }
  .nm {
    max-width: 100%; font-size: .95rem; line-height: 1.1; color: var(--platinum-dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: uppercase;
  }
  .lead .nm { font-size: 1.2rem; color: var(--platinum); }
  .hit:hover .nm { color: var(--platinum); }
  .sub { max-width: 100%; font-family: var(--face-register); font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--platinum-deep); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .val { display: inline-flex; align-items: center; gap: .45rem; }
  .lead .val :global(b) { font-size: 1.15rem; }
  .grade { font-family: var(--face-mark); font-weight: 700; font-size: 1rem; color: var(--platinum-dim); }
  .lead .grade { font-size: 1.3rem; }
  .g-s { color: var(--gold); }
  .g-a { color: var(--verdigris); }
  .g-c { color: var(--oxblood); }
  .empty { margin: 0; padding: 1.4rem 0 1.6rem; color: var(--platinum-dim); font-size: .86rem; }

  /* Less room: four pieces, then three. */
  :global(html[data-room~="lt900"]) .stage { grid-template-columns: minmax(0, 1.45fr) repeat(3, minmax(0, 1fr)); }
  :global(html[data-room~="lt900"]) .piece[data-place="5"] { display: none; }
  :global(html[data-room~="lt760"]) .stage { grid-template-columns: minmax(0, 1.45fr) repeat(2, minmax(0, 1fr)); }
  :global(html[data-room~="lt760"]) .piece[data-place="4"] { display: none; }
  /* Very little room: a slim strip, each piece small beside its name. */
  :global(html[data-room~="lt640"]) .stage { grid-template-columns: repeat(3, minmax(0, 1fr)); background: none; }
  :global(html[data-room~="lt640"]) .hit { grid-template-columns: auto minmax(0, 1fr); justify-items: start; align-items: center; gap: 0 .5rem; padding-bottom: .5rem; }
  :global(html[data-room~="lt640"]) .gear { min-height: 0; }
  :global(html[data-room~="lt640"]) .gear :global(.art) { width: 44px !important; height: 44px !important; }
  :global(html[data-room~="lt640"]) .gear :global(.mc) { --w: 44px !important; }
  :global(html[data-room~="lt640"]) .gear :global(.mc .plate) { display: none; }
  :global(html[data-room~="lt640"]) .badge, :global(html[data-room~="lt640"]) .light, :global(html[data-room~="lt640"]) .open { display: none; }
  :global(html[data-room~="lt640"]) .plaque { height: auto; justify-items: start; text-align: left; padding: 0; }
  :global(html[data-room~="lt640"]) .lead .nm { font-size: .95rem; }
  @media (prefers-reduced-motion: reduce) {
    .light { transition: none; }
  }
</style>
