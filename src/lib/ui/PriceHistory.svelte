<script lang="ts">
  // An item's last 90 days on warframe.market: what it sold for each day, how many sold, and
  // whether this week runs dearer or cheaper than the month before. Read when it's first shown.
  import { findItem } from "../core/market";
  import { daysFor, trend, trendWords, type Day } from "../core/priceTrend";
  import { mkt } from "../marketStore.svelte";
  import TimeChart from "./TimeChart.svelte";

  let { name, unique = null, rank = null, subtype = null, height = 150 }: { name: string; unique?: string | null; rank?: number | null; subtype?: string | null; height?: number } = $props();

  let days = $state<Day[] | null>(null);
  let failed = $state(false);
  $effect(() => {
    const want = `${name}|${unique}|${rank}|${subtype}`;
    days = null;
    failed = false;
    void (async () => {
      try {
        await mkt.ensureItems();
        const it = findItem(mkt.index, name, unique);
        if (!it) {
          if (current === want) days = [];
          return;
        }
        const points = await mkt.history(it.slug);
        // Ranked items: the rank asked for; unranked ones ignore it.
        const r = it.maxRank != null ? (rank ?? 0) : null;
        if (current === want) days = daysFor(points, r, subtype);
      } catch {
        if (current === want) failed = true;
      }
    })();
  });
  const current = $derived(`${name}|${unique}|${rank}|${subtype}`);
  const t = $derived(days?.length ? trend(days) : null);
  const words = $derived(t ? trendWords(t) : null);
  const GOLD = "#b5892e";
  /** Cheap things to a tenth of a platinum, so 1.6p and 1.2p don't both read as 2p and 1p. */
  const p = (v: number) => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
</script>

{#if failed}
  <p class="dim small">warframe.market didn't answer for its price history.</p>
{:else if days == null}
  <p class="dim small">Reading its price history…</p>
{:else if days.length}
  <div class="ph">
    <TimeChart title="Sold for, last 90 days" at={days.map((d) => d.at)} series={[{ label: "Median", color: GOLD, values: days.map((d) => d.median) }]} {height} empty="No trades in 90 days." />
    <p class="small">
      {#if words}<b class:up={(t?.change ?? 0) >= 0.05} class:down={(t?.change ?? 0) <= -0.05}>{words}</b>{" · "}{/if}<span class="dim">about {t && t.perDay >= 10 ? Math.round(t.perDay) : Math.round((t?.perDay ?? 0) * 10) / 10} sold a day{t?.week != null ? ` · ${p(t.week)}p this week` : ""}{t?.month != null ? `, ${p(t.month)}p the month before` : ""}</span>
    </p>
  </div>
{:else}
  <p class="dim small">Nobody has sold one on warframe.market in 90 days.</p>
{/if}

<style>
  .ph { display: grid; gap: .3rem; }
  .ph p { margin: 0; }
  b { font-weight: 600; color: var(--platinum); }
  .up { color: var(--verdigris); }
  .down { color: var(--oxblood); }
</style>
