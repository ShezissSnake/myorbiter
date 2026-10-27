<script lang="ts">
  // The two currencies, with the game's own icons: platinum and Orokin ducats.
  import GameIcon from "./GameIcon.svelte";
  let { kind = "plat", size = 13 }: { kind?: "plat" | "ducat"; size?: number } = $props();
</script>

<GameIcon name={kind === "plat" ? "platinum" : "ducats"} size={Math.round(size * 1.15)} title={kind === "plat" ? "platinum" : "ducats"} />
