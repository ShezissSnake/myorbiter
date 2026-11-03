<script lang="ts">
  // The small List button at the end of a row: opens the listing form for that row. A price tag
  // with a plus; with a tick, and in green, once it's already up on warframe.market.
  import type { Model } from "../core/model";
  import Icon from "./Icon.svelte";
  import { mkt, type ListRequest } from "../marketStore.svelte";

  let {
    model,
    name,
    req = {},
    label = "List",
    why = null,
    hint = null,
    labelled = false,
  }: {
    model: Model;
    /** warframe.market's name for it: "Rhino Prime Set", "Lith A1 Relic"… */
    name: string;
    req?: ListRequest;
    label?: string;
    /** When set, the button is disabled and this explains why. */
    why?: string | null;
    /** A line added to the tooltip ("fuse 1 in game first"). */
    hint?: string | null;
    /** On a card: the icon and a word (Sell, or Listed), so it reads without hovering. */
    labelled?: boolean;
  } = $props();

  // Already on warframe.market? Then the button says so (and still opens the form, to add or reprice).
  const listed = $derived.by(() => {
    const it = mkt.index.byName.get(name.toLowerCase());
    if (!it) return null;
    return mkt.orders.find((o) => o.itemId === it.id && (req.rank == null || (o.rank ?? 0) === req.rank) && (req.subtype == null || (o.subtype ?? it.subtypes?.[0]) === req.subtype)) ?? null;
  });
  // Enter and Space press the button, not the row or card it sits in; other keys (Esc for the
  // listing form) go on as usual.
  const key = (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && e.stopPropagation();
  // "List R5", "List set": what the plain icon can't say goes beside it.
  const extra = $derived(label.replace(/^List\s*/i, "") || (labelled ? (listed ? "Listed" : "Sell") : ""));
  const tip = $derived(why ?? (listed ? `Listed: ${listed.quantity} at ${listed.platinum}p${listed.visible ? "" : ", hidden from buyers"}. Click to add more or change the price.` : `${label} on warframe.market: ${req.quantity ?? ""} ${name}`.replace(/\s+/g, " ")) + (hint && !why ? `. ${hint}` : ""));
</script>

<button
  type="button"
  class="ib list"
  class:wide={!!extra}
  class:listed
  disabled={!!why}
  aria-label={listed ? `Listed: ${name}` : `${label}: ${name}`}
  title={tip}
  onclick={(e) => { e.stopPropagation(); mkt.startListing(model, name, req); }}
  onkeydown={key}
><Icon name={listed ? "listed" : "list"} />{#if extra}<span>{extra}</span>{/if}</button>

<style>
  /* Quiet on every row, so values stay the brightest thing; gold once you reach for it. */
  .list { color: var(--platinum-dim); border-color: var(--rule-bright); background: transparent; }
  .list.wide { width: auto; display: inline-flex; gap: .35rem; padding: 0 .55rem 0 .45rem; font-size: .6rem; }
  :global(tr:hover) .list:not(:disabled):not(.listed), :global(.card:hover) .list:not(:disabled):not(.listed) { color: var(--gold); border-color: var(--gold-dim); }
  .list:hover:not(:disabled) { background: var(--gold); border-color: var(--gold); color: var(--slab); }
  .list.listed { color: var(--verdigris); border-color: color-mix(in srgb, var(--verdigris) 50%, transparent); }
  .list.listed:hover:not(:disabled) { background: var(--verdigris); color: var(--slab); }
  .list:disabled { color: var(--platinum-deep); border-color: var(--rule); opacity: .6; }
</style>
