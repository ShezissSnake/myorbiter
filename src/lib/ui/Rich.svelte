<script lang="ts">
  // Text the way the wiki writes it (core/richText.ts): a page's name is a link to it with its
  // sidebar icon, the game's currencies and resources carry their own icon.
  import { richPieces } from "../core/richText";
  import { PAGES, pageById, type PageId } from "../pages";
  import GameIcon, { type GameIconName } from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";

  // go: opens a page; without it, page names get their icon but aren't links.
  let { text, go = null }: { text: string; go?: ((page: string) => void) | null } = $props();
  const LABELS = PAGES.filter((p) => p.id !== "guide").map((p) => ({ label: p.label, id: p.id }));
  const pieces = $derived(richPieces(text, LABELS));
</script>

{#each pieces as p, i (i)}{#if p.kind === "text"}{p.text}{:else if p.kind === "icon"}<span class="rw"><GameIcon name={p.icon as GameIconName} size={14} />{p.text}</span>{:else}{@const pg = pageById[p.page as PageId]}{#if go}<button type="button" class="rp" title="Open {pg.label}" onclick={() => go?.(p.page)}><span class="pi" aria-hidden="true">{#if "game" in pg.icon}<GameIcon name={pg.icon.game} size={13} />{:else}<Icon name={pg.icon.line} size={12} />{/if}</span>{p.text}</button>{:else}<span class="rw"><span class="pi" aria-hidden="true">{#if "game" in pg.icon}<GameIcon name={pg.icon.game} size={13} />{:else}<Icon name={pg.icon.line} size={12} />{/if}</span>{p.text}</span>{/if}{/if}{/each}

<style>
  /* An icon word: the icon sits on the text's line, no wider gap than a space. */
  .rw { display: inline-flex; align-items: baseline; gap: .2rem; white-space: nowrap; }
  .rw :global(.gi), .rp :global(.gi), .rw :global(.mk), .rp :global(.mk) { align-self: center; }
  /* A page link: the page's icon and its name, underlined like a link, in platinum. */
  .rp { all: unset; display: inline-flex; align-items: baseline; gap: .22rem; white-space: nowrap; cursor: pointer; color: var(--platinum); text-decoration: underline; text-decoration-color: var(--gold-dim); text-underline-offset: .18em; }
  .rp:hover { text-decoration-color: var(--gold); }
  .rp:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  .pi { display: inline-grid; place-items: center; align-self: center; color: var(--platinum-deep); }
</style>
