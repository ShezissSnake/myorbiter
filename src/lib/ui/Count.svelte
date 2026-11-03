<script lang="ts">
  // A number that rolls to its new value (QUICK, one animation frame loop that stops itself) in
  // tabular figures, so a filter or a span changing a total reads as a change, not a jump. On
  // mount, under reduced motion, in a hidden window or for a non-number, it just shows the value.
  //   <Count value={items.length} />   <Count value={plat} format={(n) => `${Math.round(n)}p`} />
  import { untrack } from "svelte";
  import { calm, out, QUICK } from "../motion";

  let { value, format = (n: number) => Math.round(n).toLocaleString("en"), duration = QUICK }: { value: number; format?: (n: number) => string; duration?: number } = $props();

  let shown = $state(untrack(() => value));
  $effect(() => {
    const to = value;
    const from = untrack(() => shown);
    if (calm.current || from === to || !Number.isFinite(from) || !Number.isFinite(to) || document.hidden || duration <= 0) {
      shown = to;
      return;
    }
    // Timed from the first frame's own clock: a frame's timestamp can trail performance.now()
    // (and stays behind for good when the page's animations are slowed, in devtools), which
    // would hold the figure short of its value.
    let t0 = -1;
    let raf = requestAnimationFrame(function step(now) {
      if (t0 < 0) t0 = now;
      const t = Math.min(1, (now - t0) / duration);
      shown = t >= 1 ? to : from + (to - from) * out(t);
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  });
</script>

<span class="count">{format(shown)}</span>

<style>
  .count { font-variant-numeric: tabular-nums; }
</style>
