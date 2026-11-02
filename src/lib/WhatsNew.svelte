<script lang="ts">
  // What changed since you last looked: shown once after an update, closed with "Got it".
  import Sheet from "./ui/Sheet.svelte";
  import { newsSince } from "./whatsNew";

  let { open = $bindable(), seen, ondone }: { open: boolean; seen: string; ondone: () => void } = $props();
  // At most the last three batches: someone back after months doesn't need the whole history.
  const news = $derived(newsSince(seen).slice(0, 3));
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  $effect(() => {
    // Closed any way (Esc, outside, the button): seen.
    if (!open) return;
    return () => ondone();
  });
</script>

<Sheet bind:open title="What's new" kicker="Since you last opened orbiter">
  {#each news as n (n.date)}
    <section>
      <h3 class="register">{day(n.date)}</h3>
      <ul>{#each n.items as item (item)}<li>{item}</li>{/each}</ul>
    </section>
  {/each}
  <p class="dim small">The Guide has these too, and what everything does.</p>
  <button class="stamp gold" onclick={() => (open = false)}>Got it</button>
</Sheet>

<style>
  section { display: grid; gap: .4rem; margin-bottom: 1rem; }
  ul { margin: 0; padding-left: 1.1rem; display: grid; gap: .45rem; line-height: 1.45; }
</style>
