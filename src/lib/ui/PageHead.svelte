<script lang="ts">
  import { getContext, type Snippet } from "svelte";
  // Every page's head, one shape everywhere: a fixed height, so the title sits at the same place on
  // every page. Left to right: the section's crest (none outside a section), then the kicker (the
  // section's name), the title, and one line of what the page is, with Details for the rest; one
  // action at the right. Under it the engraved rule; then, when Details is open, the longer text,
  // and the page's signature (hero) and figures (band).
  //
  // `brief` is the one line; `blurb` the whole of it, shown under the rule when Details is open
  // (open by itself while Settings → Show details is on). `lede` replaces the line with markup of
  // the page's own (Home's date and freshness).
  import { view } from "../view.svelte";
  import { fold, reveal } from "../motion";
  import { PANE } from "../statusStrip.svelte";
  import { pageById, type PageId } from "../pages";
  import Icon, { sectionIcon } from "./Icon.svelte";
  import HelpMark from "./HelpMark.svelte";
  // `help`: the parts' ids for the "?" on the band of figures and on the signature (hero), each at
  // its top right corner (neither has a head bar).
  let { title, blurb, brief, band, hero, action, lede, help }: { title: string; blurb?: string; brief?: string; band?: Snippet; hero?: Snippet; action?: Snippet; lede?: Snippet; help?: { band?: string; hero?: string } } = $props();
  const pane = getContext<string | undefined>(PANE);
  const section = pane ? (pageById[pane as PageId]?.group ?? "") : "";
  const line = $derived(brief ?? blurb);
  const more = $derived(!!blurb && blurb !== line);
  // Open by hand, or (until opened or closed by hand) with Show details on.
  let opened = $state<boolean | null>(null);
  const open = $derived(opened ?? view.details);
  const uid = $props.id();
  const id = `more-${uid}`;
</script>

<header class="head">
  {#if section}
    <!-- The crest: two squares turned to diamonds, the inner in the section's colour, and its glyph. -->
    <span class="crest" aria-hidden="true"><i class="outer"></i><i class="inner"></i><Icon name={sectionIcon(section)} size={30} stroke={1.5} /></span>
  {/if}
  <div class="tx">
    <span class="kicker register">{section}</span>
    <!-- tabindex -1: a page switch by keyboard puts the focus here (App.svelte, focusPage). -->
    <h1 class="mark" tabindex="-1">{title}</h1>
    <p class="lede">
      {#if lede}<span class="ln">{@render lede()}</span>{:else if line}<span class="ln" title={blurb}>{line}</span>{/if}
      {#if more}<button type="button" class="link more" aria-expanded={open} aria-controls={id} title={open ? "Hide the longer description" : "The longer description of this page"} onclick={() => (opened = !open)}>Details</button>{/if}
    </p>
  </div>
  {#if action}<div class="act">{@render action()}</div>{/if}
</header>
<div class="engr" aria-hidden="true"></div>
{#if more}
  <div {id} use:fold={open}><div><div class="detail">
    <p class="prose">{blurb}</p>
    <button type="button" class="details" class:on={view.details} aria-pressed={view.details} title={view.details ? "Details are showing on every page: the sentence under each figure, every column. Click to keep just the essentials (the rest stays on hover)" : "Show details on every page: the sentence under each figure and every column. Off, they're on hover"} onclick={() => {
      // Keep this page's text where it is (and the focus on this switch) whichever way it goes.
      opened = open;
      view.set(!view.details);
    }}><span class="box"></span>Details on every page</button>
  </div></div></div>
{/if}
<!-- data-card "hero": What's New's Show me lights a section's signature (page#hero). -->
{#if hero}<div class="hero" class:helped={!!help?.hero} data-card="hero">{@render hero()}{#if help?.hero}<HelpMark part={help.hero} corner />{/if}</div>{/if}
<!-- A band that comes or goes with the page's data (Sales' first or last sale) folds rather than snaps. -->
{#if band}<div class="reveal" transition:reveal><div><section class="band" class:helped={!!help?.band}>{@render band()}{#if help?.band}<HelpMark part={help.band} corner />{/if}</section></div></div>{/if}

<style>
  /* Fixed height: the title's top is at the same y on every page, whatever the line under it says. */
  .head { display: flex; align-items: center; gap: 24px; height: 124px; margin-top: 40px; min-width: 0; }
  .crest { position: relative; flex: none; width: 104px; height: 104px; margin-left: -8px; display: grid; place-items: center; overflow: hidden; color: var(--sec); }
  .crest i { position: absolute; transform: rotate(45deg); }
  .crest .outer { inset: 16px; border: 1px solid var(--rule); }
  /* The crest's glow stays inside its box (the box clips it). */
  .crest .inner { inset: 26px; border: 1px solid color-mix(in srgb, var(--sec) 55%, transparent); background: color-mix(in srgb, var(--sec) 7%, transparent); box-shadow: 0 0 14px color-mix(in srgb, var(--sec) 22%, transparent); }
  .crest :global(svg) { position: relative; }
  .tx { flex: 1; min-width: 0; display: grid; justify-items: start; }
  /* The kicker keeps its line outside a section too, so the title doesn't move up there. */
  .kicker { display: block; height: 16px; line-height: 16px; color: var(--sec); }
  h1 { font-size: 56px; line-height: 1; letter-spacing: -.005em; margin: 10px 0 12px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Focused only to start the page there: no ring on a title you can't press. */
  h1:focus { outline: none; }
  /* One line, never two: the rest is behind Details (and on hover). */
  .lede { display: flex; align-items: baseline; gap: 10px; margin: 0; max-width: min(760px, 100%); min-width: 0; height: 20px; font-size: 14px; line-height: 20px; color: var(--platinum-dim); }
  .ln { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .more { flex: none; min-height: 20px; font-family: var(--face-text); font-size: 14px; letter-spacing: 0; text-transform: none; line-height: 20px; }
  .act { flex: none; align-self: flex-end; display: flex; align-items: center; gap: var(--tight); padding-bottom: 6px; }
  /* The engraved rule: 72 px in the section's colour, then the hairline. */
  .engr { height: 1px; margin: 20px 0 24px; background: linear-gradient(90deg, var(--sec) 0 72px, var(--rule) 72px); }
  .detail { display: grid; gap: var(--tight); justify-items: start; margin: -8px 0 24px; padding: 12px 16px; background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule); box-shadow: var(--plate-light); }
  .detail .prose { max-width: 76ch; }
  .details { display: inline-flex; align-items: center; gap: .45rem; padding: .25rem .55rem; font-size: 11px; color: var(--platinum-deep); }
  .details .box { width: .55rem; height: .55rem; border: 1px solid var(--rule-control); }
  .details.on { color: var(--platinum); }
  .details.on .box { background: var(--platinum); border-color: var(--platinum); }
  .hero { margin: 0 0 var(--step); }
  /* The "?" in the top right corner: the band keeps a column clear for it. */
  .hero.helped, .band.helped { position: relative; }
  /* Room for the corner "?" so it never sits on the figures (the Void Trace count, a card's label). */
  .band.helped, .hero.helped { padding-right: 36px; }
  .band {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    /* A plate, so nothing behind the page shows through the figures; lit from the top. */
    background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule); box-shadow: var(--plate-light);
    margin-bottom: var(--step);
  }
  /* The first figure keeps off the plate's edge, as the others keep off their dividers (Stat). */
  .band > :global(:first-child) { padding-left: 1.2rem; }
  /* Two a row, so four figures make two full rows rather than three and one left alone. */
  :global(html[data-room~="lt760"]) .band:has(> :global(:nth-child(4):last-child)) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* A short window (a laptop, a Steam Deck): the same head, nearer the top. */
  @media (max-height: 860px) {
    .head { margin-top: 16px; }
    .engr { margin: 12px 0 16px; }
  }
  /* A narrow page: the crest goes before the title does. */
  :global(html[data-room~="lt640"]) .crest { display: none; }
</style>
