<script lang="ts">
  // Rivens sold in a trade in game whose auction is still up on warframe.market and that MyOrbiter
  // didn't close (core/rivenSold.ts): named with their auction, one click to close it, or put
  // away. Shown on Orders and Rivens while the auction is open in the last read of your auctions;
  // once it is closed, wherever, or put away, it isn't shown again.
  import { logLine } from "../backend";
  import { rivens } from "../rivenStore.svelte";
  import { rivenSoldShown, setRivenSold, stillToClose, type RivenSold } from "../core/rivenSold";
  import type { MyAuction } from "../core/rivens";
  import ProgressButton from "./ProgressButton.svelte";

  let { list = $bindable() }: { list: RivenSold[] } = $props();

  const shown = $derived(rivens.mineAt == null && !rivens.mine.length ? [] : rivenSoldShown(list, rivens.mine));
  let busy = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});
  const idOf = (r: RivenSold) => `${r.trade}|${r.riven}`;
  const price = (a: MyAuction) => (a.buyout != null ? `${a.buyout}p` : a.topBid != null ? `top bid ${a.topBid}p` : "no buyout");

  /** The one click: closes the auction only if a read made now still has it open and fitting the riven sold (its rank aside: the player chose). */
  async function closeIt(r: RivenSold, a: MyAuction) {
    const meta = rivens.meta;
    if (!meta || busy) return;
    busy = idOf(r);
    const { [idOf(r)]: _, ...rest } = errors;
    errors = rest;
    try {
      const done = await rivens.closeIfStill(a.id, (l) => stillToClose(meta, l, a.id, r.riven, null));
      if (done === "closed" || done === "gone") {
        list = setRivenSold(list, r, "closed");
        logLine("info", "rivens", `A riven given in trade ${r.trade}: ${done === "closed" ? `its auction ${a.id} closed on a click.` : `its auction ${a.id} was closed already; nothing sent.`}`);
      } else {
        errors = { ...errors, [idOf(r)]: done === "changed" ? "That auction isn't this riven any more (changed on warframe.market since): nothing was sent. Take it down below if it should go." : "MyOrbiter couldn't read your auctions just now, so nothing was sent. Try again in a moment." };
      }
    } catch (e) {
      const why = String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "").slice(0, 300);
      list = setRivenSold(list, r, "failed", why);
      errors = { ...errors, [idOf(r)]: why };
      logLine("warn", "rivens", `A riven given in trade ${r.trade}: closing its auction ${a.id} on a click failed: ${why}`);
    } finally {
      busy = null;
    }
  }
</script>

{#if shown.length}
  <ul class="sold" aria-label="Rivens sold in game, still up on warframe.market">
    {#each shown as { sold: r, auctions } (idOf(r))}
      <li>
        <p>
          <b>{r.riven}</b>{r.rank != null && r.rank > 0 ? ` (rank ${r.rank})` : ""}: sold in game{r.partner ? ` to ${r.partner}` : ""}, {auctions.length > 1 ? `${auctions.length} of your auctions fit it` : `its auction is still up (${price(auctions[0])})`}.
          <span class="dim small">{r.state === "failed" ? `Closing it failed: ${r.why ?? "no answer"}.` : `Not closed by MyOrbiter: ${r.why ?? "it wasn't sure"}.`}</span>
        </p>
        <span class="acts">
          {#if auctions.length === 1}
            <ProgressButton tone="danger" label="Close auction" working="Closing…" state={busy === idOf(r) ? "working" : "idle"} disabled={!rivens.meta || (busy != null && busy !== idOf(r))} title="Close this auction on warframe.market (it stays among your profile's closed auctions). Your auctions are read first; nothing is sent if it's gone or no longer this riven." onclick={() => closeIt(r, auctions[0])} />
          {:else}
            <span class="dim small">Take down the right one below.</span>
          {/if}
          <button type="button" disabled={busy === idOf(r)} title="Leave the auction up and stop showing this" onclick={() => (list = setRivenSold(list, r, "kept"))}>Keep it up</button>
        </span>
        {#if errors[idOf(r)]}<p class="err small" role="status">{errors[idOf(r)]}</p>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .sold { list-style: none; margin: 0 0 .75rem; padding: 0; display: grid; gap: .5rem; }
  .sold li { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem 1rem; padding: .5rem .75rem; border-inline-start: 2px solid var(--gold); background: var(--raised); }
  .sold p { margin: 0; flex: 1 1 22rem; }
  .acts { display: inline-flex; gap: .5rem; align-items: center; }
  .sold .err { flex-basis: 100%; }
</style>
