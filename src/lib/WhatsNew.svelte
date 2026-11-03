<script lang="ts">
  // What changed since you last looked: shown once after an update, closed with "Got it".
  import Sheet from "./ui/Sheet.svelte";
  import { newsSince } from "./whatsNew";
  import NewsItems from "./ui/NewsItems.svelte";

  // go: opens a page from a card or a page named in the text (and closes this).
  let { open = $bindable(), seen, ondone, go = null }: { open: boolean; seen: string; ondone: () => void; go?: ((to: string) => void) | null } = $props();
  const visit = (to: string) => {
    open = false;
    go?.(to);
  };
  // At most the last three batches: someone back after months doesn't need the whole history.
  const news = $derived(newsSince(seen).slice(0, 3));
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  $effect(() => {
    // Closed any way (Esc, outside, the button): seen.
    if (!open) return;
    return () => ondone();
  });
</script>

<Sheet bind:open wide title="What's new" kicker="Since you last opened orbiter">
  {#each news as n, i (n.id)}
    <section>
      {#if i === 0 || news[i - 1].date !== n.date}<h3 class="register">{day(n.date)}</h3>{/if}
      <NewsItems items={n.items} go={go ? visit : null} />
    </section>
  {/each}
  <p class="dim small">The Guide has these too, and what everything does.</p>
  <button class="stamp gold" onclick={() => (open = false)}>Got it</button>
</Sheet>

<style>
  section { display: grid; gap: .4rem; margin-bottom: 1rem; }

</style>
