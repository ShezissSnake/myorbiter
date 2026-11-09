<script lang="ts">
  // Gear you no longer need and can't trade (core/notNeeded.ts): what can go, and what's kept
  // back and why. Keep takes one off the list for good; Undo puts it back.
  import type { Model } from "../core/model";
  import type { CanGo, KeptBack } from "../core/notNeeded";
  import { info } from "../hover.svelte";
  import Thumb from "./Thumb.svelte";
  import { arrive, flip, leave, ms, out as easeOut, QUICK, reveal } from "../motion";
  import { refocus, usable } from "./refocus";

  // `out`: the list worked out once by the page (it shows the count too); `incarnons`: whether
  // TennoScope passed each copy's Incarnon, so the lead says what's checked.
  let { model, out, incarnons, keep = $bindable() }: { model: Model; out: { go: CanGo[]; kept: KeptBack[] }; incarnons: boolean; keep: string[] } = $props();
  let showKept = $state(false);

  // The list runs down each column, then the next: after a Keep, a row moving up within its column
  // slides (flip), and one wrapping to the foot of the column before fades in where it lands,
  // rather than flying diagonally across the text between.
  function closeUp(node: Element, rects: { from: DOMRect; to: DOMRect }) {
    if (Math.abs(rects.from.left - rects.to.left) < 1) return flip(node, rects);
    return { duration: ms(QUICK), easing: easeOut, css: (t: number) => `opacity:${t}` };
  }

  // A row's button goes with its row, and the keyboard focus would fall to the top of the page:
  // Keep hands it to the next row's Keep (else the one before, else the kept-back toggle), Undo to
  // the Keep of the row it puts back (else the next Undo, or the one before).
  let box = $state<HTMLElement | null>(null);
  const button = (li: Element | null | undefined) => li?.querySelector<HTMLElement>("button") ?? null;
  function around(e: Event) {
    const li = (e.currentTarget as HTMLElement).closest("li");
    return [button(li?.nextElementSibling), button(li?.previousElementSibling)];
  }
  function keepIt(e: Event, unique: string) {
    const [next, before] = around(e);
    refocus(e.currentTarget as HTMLElement, () => [next, before, box?.querySelector<HTMLElement>("button.kb")].find(usable));
    keep = [...keep, unique];
  }
  function putBack(e: Event, unique: string) {
    const [next, before] = around(e);
    refocus(e.currentTarget as HTMLElement, () => [button(box?.querySelector(`.go li[data-unique="${CSS.escape(unique)}"]`)), next, before].find(usable));
    keep = keep.filter((u) => u !== unique);
  }
</script>

<section class="nn" aria-label="Not needed anymore" bind:this={box}>
  <p class="lead dim small">
    Built gear can't be traded: sell these for credits in game (Arsenal or Inventory → Sell){out.go.some((g) => g.frame) ? ", or feed a warframe to the Helminth" : ""}. Kept back: what you haven't mastered, what a recipe you haven't mastered takes{incarnons ? ", one with its Incarnon installed when the better one has none" : ""}, and versions that aren't straight upgrades of each other (a Prime and a Vandal).
  </p>
  {#if out.go.length}
    <ul class="go">
      <!-- Keep: it leaves and the rest close up; Undo (under Kept back) brings it back in. -->
      {#each out.go as g (g.unique)}
        <li in:arrive out:leave animate:closeUp data-unique={g.unique}>
          <Thumb file={model.imageOf(g.name)} size={34} />
          <div class="t">
            <span class="nm"><b class="mark" use:info={g.name}>{g.name}</b>{#if g.of > 1}<span class="dim small">{g.copies} of your {g.of}</span>{/if}</span>
            <span class="small">{g.why}</span>
            {#each g.notes as n (n)}<span class="dim small">{n}</span>{/each}
            {#if g.check}<span class="check small">{g.check}</span>{/if}
          </div>
          <button class="link" title="Keep it: it leaves this list (Kept back has Undo)" onclick={(e) => keepIt(e, g.unique)}>Keep</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="dim">Nothing to let go: everything you hold is the best version you have of it, or still needed.</p>
  {/if}
  {#if out.kept.length}
    <button class="link kb" aria-expanded={showKept} onclick={() => (showKept = !showKept)}>{showKept ? "Hide" : "Show"} what's kept back ({out.kept.length}) <span class="chev" aria-hidden="true">▾</span></button>
    {#if showKept}
      <div class="reveal" transition:reveal><ul class="kept">
        {#each out.kept as k (k.unique)}
          <li in:arrive out:leave animate:flip><b use:info={k.name}>{k.name}</b><span class="dim small">{k.why}</span>{#if k.yours}<button class="link" title="Put it back on the list" onclick={(e) => putBack(e, k.unique)}>Undo</button>{/if}</li>
        {/each}
      </ul></div>
    {/if}
  {/if}
</section>

<style>
  .nn { display: grid; gap: .7rem; margin: 0 0 1rem; padding: .9rem 1.1rem; border: 1px solid var(--rule); background: var(--plate); justify-items: start; }
  .lead { margin: 0; max-width: 90ch; }
  /* Down each column, then the next: a Keep closes the gap upward, rather than every row after it
     changing column. */
  .go { list-style: none; margin: 0; padding: 0; columns: 22rem; column-gap: 1.6rem; width: 100%; }
  .go li { display: flex; gap: .7rem; align-items: flex-start; min-width: 0; break-inside: avoid; padding-bottom: .8rem; }
  .t { display: grid; gap: .15rem; flex: 1; min-width: 0; }
  .nm { display: flex; flex-wrap: wrap; align-items: baseline; gap: .1rem .6rem; }
  .check { color: var(--gold); }
  .reveal { width: 100%; }
  .kept { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
  .kept li { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .7rem; font-size: .85rem; }
</style>
