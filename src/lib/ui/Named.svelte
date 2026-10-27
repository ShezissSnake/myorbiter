<script lang="ts">
  import type { Snippet } from "svelte";
  import Thumb from "./Thumb.svelte";
  import { info } from "../hover.svelte";
  // Artwork, the name struck in capitals, and any tags after it.
  // `hover`: what the hover card describes; the name by default, `false` for none.
  let { file, name, kind, size = 34, tint, hover, children }: { file: string | null | undefined; name: string; kind?: string; size?: number; tint?: string | null; hover?: string | false; children?: Snippet } = $props();
</script>

<span class="named" use:info={hover === false ? null : (hover ?? name)}>
  <Thumb {file} {size} {tint} />
  <span class="txt">
    {#if kind}<span class="register kind">{kind}</span>{/if}
    <span class="line"><span class="name-mark" class:keep={name.length <= 14}>{name}</span>{@render children?.()}</span>
  </span>
</span>

<style>
  .named { display: inline-flex; align-items: center; gap: .75rem; min-width: 0; vertical-align: middle; }
  .txt { display: grid; min-width: 0; }
  .kind { font-size: .6rem; }
  .line { display: inline-flex; align-items: center; flex-wrap: wrap; row-gap: .15rem; }
  .name-mark { white-space: nowrap; }
  /* Page area under 1100 px (App sets the flag, by the room pages actually have). */
  :global(html[data-room~="lt1100"]) .name-mark:not(.keep) { white-space: normal; }
</style>
