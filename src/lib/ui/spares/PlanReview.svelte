<script lang="ts" module>
  import type { SpareCategory } from "../../core/sparesRules";
  /** The category a rule belongs to, short, before the rule's own words: "Mods · Keep 2". */
  export const CATEGORY_SHORT: Record<SpareCategory, string> = { prime: "Prime", mods: "Mods", arcanes: "Arcanes", relics: "Relics", gear: "Gear", resources: "Resources", imprints: "Imprints" };
</script>

<script lang="ts">
  // The plan, looked over: what goes up and what's left out, each line with the rule that decided
  // it ("Mods · Keep 2", "Under 10p", "Never sold") and why in words. Each line to list has one
  // quiet ⋯ (RowMenu): Skip this time, or Never sell. Never sell collapses the line to an Undo for
  // a few seconds (UndoSlot), then it moves to Left out.
  import Named from "../Named.svelte";
  import P from "../P.svelte";
  import UndoSlot from "../UndoSlot.svelte";
  import RowMenu, { type MenuChoice } from "./RowMenu.svelte";
  import { flip, leave } from "../../motion";
  import type { ReviewRow } from "./types";

  let {
    rows,
    holding = {},
    onpick,
    onundo,
    image = () => null,
    menuOpen = $bindable(null),
    scroll = true,
  }: {
    rows: ReviewRow[];
    /** Lines whose Never sell is waiting out its Undo (UndoSlots.held), by key. */
    holding?: Record<string, true>;
    onpick: (row: ReviewRow, choice: "skip" | "never" | "back" | "sellAgain") => void;
    onundo: (row: ReviewRow) => void;
    image?: (name: string) => string | null;
    /** Which line's menu is open, by key (one at a time). */
    menuOpen?: string | null;
    /** Inside Orders' fold: the list scrolls in its own box. On a page of its own, the page scrolls. */
    scroll?: boolean;
  } = $props();

  const WORD: Record<ReviewRow["type"], string> = { create: "New", update: "Change", remove: "Remove", skip: "Out" };
  const going = $derived(rows.filter((r) => r.type !== "skip" && !r.out));
  const left = $derived(rows.filter((r) => r.type === "skip" || r.out));
  const choicesFor = (r: ReviewRow): MenuChoice[] =>
    r.out === "skipped"
      ? [{ id: "back", label: "Put it back", note: "In this plan again, as it was" }]
      : r.out === "never"
        ? [{ id: "sellAgain", label: "Sell again", note: "Off the never-sell list: in the next plan when it's spare" }]
        : [
            { id: "skip", label: "Skip this time", note: "Left out of this plan only; back next time" },
            { id: "never", label: "Never sell", note: "Left out of every plan until you sell it again" },
          ];
  const ruleOf = (r: ReviewRow) => (r.out === "never" ? "Never sold" : r.out === "skipped" ? "Skipped this time" : r.rule);
  const catOf = (r: ReviewRow) => (r.out ? null : CATEGORY_SHORT[r.cat]);
</script>

{#snippet line(r: ReviewRow)}
  {#if holding[r.key]}
    <td colspan="6" class="held"><UndoSlot label="Never sold" what={r.name} onundo={() => onundo(r)} /></td>
  {:else}
    <td><span class="what">{r.out ? "Out" : WORD[r.type]}</span></td>
    <td class="item"><Named file={r.image ?? image(r.name)} name={r.name} size={24}>{#if r.rank != null}<span class="tag">R{r.rank}</span>{/if}</Named><span class="why">{r.why}</span></td>
    <td class="rule"><span class="rl" class:mine={!!r.out}>{#if catOf(r)}<span class="c">{catOf(r)}</span>{/if}{ruleOf(r)}</span></td>
    <td class="right num">
      {#if r.type === "update" && r.was && r.was.quantity !== r.quantity}<span class="dim">{r.was.quantity} →</span> {/if}{#if r.type === "remove" && r.was}<s class="dim">{r.was.quantity}</s>{:else if r.type !== "skip"}{r.quantity}{:else}<span class="dim">{r.quantity}</span>{/if}
    </td>
    <td class="right num">{#if r.type === "remove" && r.was}<s class="dim"><P v={r.was.platinum} dim /></s>{:else}<P v={r.platinum} dim={r.type === "skip" || !!r.out} />{/if}</td>
    <td class="act">{#if r.type !== "remove" && !(r.type === "skip" && !r.out)}<RowMenu label={r.name} choices={choicesFor(r)} bind:open={() => menuOpen === r.key, (v) => (menuOpen = v ? r.key : menuOpen === r.key ? null : menuOpen)} onpick={(c) => onpick(r, c as "skip" | "never" | "back" | "sellAgain")} />{/if}</td>
  {/if}
{/snippet}

<div class="review" class:scroll>
  <table class="plan">
    <thead><tr><th><span class="sr">Change</span></th><th>Item, and why</th><th title="The rule that decided it: its category, then the rule">Rule</th><th class="right">Qty</th><th class="right">Price</th><th><span class="sr">More</span></th></tr></thead>
    <tbody>
      {#each going as r (r.key)}<tr class={r.type} out:leave animate:flip>{@render line(r)}</tr>{/each}
    </tbody>
    {#if left.length}
      <tbody class="leftout">
        <tr class="sub"><th colspan="6"><span class="register">Left out · {left.length}</span><span class="dim small">Each with the rule that kept it</span></th></tr>
        {#each left as r (r.key)}<tr class="skip" class:mine={!!r.out} out:leave animate:flip>{@render line(r)}</tr>{/each}
      </tbody>
    {/if}
  </table>
</div>

<style>
  .review { position: relative; border-bottom: 1px solid var(--rule); }
  .review.scroll { max-height: 60vh; overflow: auto; }
  .plan { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .plan th { text-align: left; font-family: var(--face-register); font-weight: 500; font-size: .6rem; letter-spacing: .14em; text-transform: uppercase; color: var(--platinum-deep); padding: .4rem .6rem; border-bottom: 1px solid var(--rule); }
  thead th { position: sticky; top: 0; background: var(--plate); z-index: 2; }
  .plan td { padding: .38rem .6rem; border-bottom: 1px solid var(--rule); font-size: .84rem; vertical-align: middle; }
  .plan th:first-child, .plan td:first-child { padding-left: 0; width: 1%; }
  .plan .right { text-align: right; white-space: nowrap; }
  .plan .act { width: 1%; padding-right: 0; text-align: right; }
  .what { font-family: var(--face-register); font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; padding: .15rem .4rem; border: 1px solid var(--rule-bright); white-space: nowrap; color: var(--platinum-deep); }
  tr.create .what { color: var(--verdigris); border-color: var(--verdigris); }
  tr.update .what { color: var(--gold); border-color: var(--gold-dim); }
  tr.remove .what { color: var(--oxblood); border-color: var(--oxblood); }
  tr.skip :global(.name-mark) { color: var(--platinum-dim); }
  /* The rule: category in small caps, then the rule's words; the player's own (skipped, never) marked. */
  .rule { white-space: nowrap; }
  .rl { display: inline-flex; align-items: baseline; gap: .45rem; font-family: var(--face-register); font-size: .62rem; letter-spacing: .08em; text-transform: uppercase; color: var(--platinum-dim); }
  .rl .c { color: var(--platinum-deep); }
  .rl .c::after { content: "·"; margin-left: .45rem; color: var(--rule-control); }
  .rl.mine { color: var(--platinum); padding: .1rem .35rem; border: 1px dashed var(--rule-control); }
  /* Why, under the name: the table keeps to five narrow columns at 1000 px. */
  .item .why { display: block; margin: .1rem 0 0 calc(24px + .75rem); color: var(--platinum-deep); font-size: .76rem; line-height: 1.4; }
  .held { padding: .35rem 0; }
  tr.sub th { position: static; padding-top: 1rem; border-bottom-color: var(--rule-bright); text-transform: none; letter-spacing: 0; }
  tr.sub .register { margin-right: .8rem; }
  tr.sub .small { font-family: var(--face-text); font-size: .76rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
