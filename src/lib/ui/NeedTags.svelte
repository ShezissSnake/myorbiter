<script lang="ts">
  // Whether you need a reward, as tags: need · the item (filled gold, so a needed reward stands out),
  // completes set or set · one short, wishlist, held · n. The same words on the reward screen
  // (Current fissure) and Home's alerts and invasions; each tag's tooltip says why in a sentence.
  import { markWords, type RewardMarks } from "../core/rewardNeed";

  /** `held`: false where the count already shows beside it (the reward screen's Held column). */
  let { marks, held = true }: { marks: RewardMarks; held?: boolean } = $props();
  const words = $derived(markWords(held ? marks : { ...marks, held: 0 }));
</script>

{#each words as w (w.text)}<span class="tag" class:warn={w.tone === "warn"} class:good={w.tone === "good"} title={w.why}>{w.text}</span>{/each}
