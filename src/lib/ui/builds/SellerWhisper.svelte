<script lang="ts">
  // For a mod or arcane you lack: the cheapest seller in game on warframe.market, and the whisper
  // to paste in game chat (Copy whisper, as Home's cheap buys). The order book is read only when
  // you ask (Find seller), with a GET: nothing is posted or changed on warframe.market.
  import { mkt } from "../../marketStore.svelte";
  import { findItem } from "../../core/market";
  import { cheapestSeller, type Seller } from "../../core/buildsPage";
  import CopyButton from "../CopyButton.svelte";
  import P from "../P.svelte";

  let { name, unique = null, ranked = true }: { name: string; unique?: string | null; ranked?: boolean } = $props();

  let st = $state<"idle" | "reading" | "found" | "none" | "unlisted" | "failed">("idle");
  let seller = $state<Seller | null>(null);
  let err = $state("");

  async function find() {
    if (st === "reading") return;
    st = "reading";
    try {
      await mkt.ensureItems();
      const it = findItem(mkt.index, name, unique);
      if (!it) {
        st = "unlisted";
        return;
      }
      const book = await mkt.book(it.slug, 60_000);
      // Unranked: the cheapest copy, ranked up yourself with Endo.
      seller = cheapestSeller(book, it.name, ranked && it.maxRank != null ? 0 : null, mkt.me, it.subtypes?.[0] ?? null);
      st = seller ? "found" : "none";
    } catch (e) {
      err = String(e).replace(/^Error:\s*/, "");
      st = "failed";
    }
  }
</script>

{#if st === "found" && seller}
  <span class="found">
    <span class="who" title="{seller.name}: the cheapest of {seller.sellers} seller{seller.sellers === 1 ? '' : 's'} in game now, unranked">{seller.name}</span>
    <P v={seller.platinum} />
    <CopyButton text={seller.whisper} label="Copy whisper" title="Copy the whisper to {seller.name}, to paste in game chat: {seller.whisper}" />
  </span>
{:else}
  <button type="button" class="link find" class:reading={st === "reading"} aria-busy={st === "reading"} title={st === "failed" ? `warframe.market didn't answer (${err}). Click to try again` : st === "none" ? "Nobody in game sells it right now. Click to look again" : st === "unlisted" ? "warframe.market doesn't trade it" : `Find the cheapest seller in game on warframe.market for ${name}, with a whisper to copy (reads the order book only)`} disabled={st === "unlisted"} onclick={find}>
    <span class="lbls">
      <span class:on={st === "idle"}>Find seller</span>
      <span class:on={st === "reading"}>Looking…</span>
      <span class:on={st === "none"}>No seller in game</span>
      <span class:on={st === "unlisted"}>Not on the market</span>
      <span class:on={st === "failed"}>Couldn't read · retry</span>
    </span>
  </button>
{/if}

<style>
  .found { display: inline-flex; align-items: center; gap: .5rem; }
  .who { font-size: .8rem; color: var(--platinum-dim); max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Every label in one cell, so the link keeps its width as they swap. */
  .lbls { display: inline-grid; }
  .lbls > span { grid-area: 1 / 1; visibility: hidden; white-space: nowrap; }
  .lbls > span.on { visibility: visible; }
  /* Pending: the label dims and a hairline runs under it, on the control itself. */
  .find { position: relative; }
  .find.reading { color: var(--platinum-dim); }
  /* The band runs by transform (app.css, sweep-band); the clip keeps it to the button's width. */
  .find.reading { clip-path: inset(0 0 -3px 0); }
  .find.reading::after { content: ""; position: absolute; left: 0; bottom: -2px; width: 40%; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); animation: sweep-band 900ms linear infinite; }
  @media (prefers-reduced-motion: reduce) { .find.reading::after { animation: none; width: 100%; transform: none; background: var(--gold-dim); } }
</style>
