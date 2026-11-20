<script lang="ts">
  // The Warframe Wiki's credit, where its data shows (Arcanes' Vosfor figures, Builds' recipes): one
  // wording, core/wikiData.ts's WIKI_CREDIT, as the data's licence file states it. Inline, inside the
  // caller's line; the address opens in the browser, the licence is named.
  import { links, openUrl } from "../links.svelte";
  import { WIKI_CREDIT, WIKI_CREDIT_URL } from "../core/wikiData";
  import Opening from "./Opening.svelte";
</script>

<span class="wiki-credit">Data from {WIKI_CREDIT.contributors} (<button type="button" class="link" title="Open the Warframe Wiki (wiki.warframe.com) in your browser" aria-busy={links.isOpening(WIKI_CREDIT_URL)} onclick={() => openUrl(WIKI_CREDIT_URL)}><Opening url={WIKI_CREDIT_URL}>{WIKI_CREDIT.address}</Opening></button>), {WIKI_CREDIT.host}, under the {WIKI_CREDIT.licence} licence ({WIKI_CREDIT.short}).</span>

<style>
  /* The address in the sentence's own size, so the line reads as one. */
  .wiki-credit .link { font: inherit; letter-spacing: 0; text-transform: none; min-height: 0; }
</style>
