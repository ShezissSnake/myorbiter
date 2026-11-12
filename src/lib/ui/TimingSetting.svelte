<script lang="ts">
  // Settings › Logs: Record timings (lib/timing.ts) and, on Linux with the NVIDIA driver, the
  // experimental DMA-BUF frames (src-tauri/src/rendering.rs) to compare against shared memory.
  // The report goes on the clipboard and into the log folder; nothing is sent anywhere.
  import { renderingState, saveTimingReport, setDmabufRendering, timingEnv, type RenderingState } from "../backend";
  import { timing } from "../timing";
  import Switch from "./Switch.svelte";

  let { on = $bindable() }: { on: boolean } = $props();

  let said = $state<string | null>(null);
  let failed = $state(false);
  let text = $state("");
  let busy = $state(false);

  async function copy() {
    busy = true;
    try {
      const env = await timingEnv().catch(() => null);
      text = timing.report(env, { window: `${window.innerWidth}×${window.innerHeight}`, scale: Math.round(window.devicePixelRatio * 100) / 100 });
      const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
      const file = await saveTimingReport(text).catch(() => null);
      failed = !copied && !file;
      said = [copied ? "Copied" : "Couldn't copy: it's below to copy by hand", file ? `saved in the log folder as ${file}` : null].filter(Boolean).join(", ") + ".";
    } finally {
      busy = false;
    }
  }

  // The DMA-BUF try: only where it means something (Linux, the NVIDIA driver, MyOrbiter choosing).
  let rs = $state<RenderingState | null>(null);
  let rsError = $state<string | null>(null);
  renderingState().then((s) => (rs = s), () => {});
  const nvidia = $derived(!!rs?.linux && !!rs.now?.nvidia && rs.now.mode !== "yours");
  async function setDmabuf(v: boolean) {
    if (!rs) return;
    const was = rs.dmabuf;
    rs.dmabuf = v;
    try {
      await setDmabufRendering(v);
      rsError = null;
    } catch (e) {
      rs.dmabuf = was;
      rsError = String(e).replace(/^Error: /, "");
    }
  }
</script>

<div class="timing">
  <Switch name="settings.record-timings" bind:on label="Record timings">
    For when MyOrbiter feels slow: it notes how long each click, key and page switch takes to show, how long Settings and an item's card take to open and close, how smoothly lists scroll, slow frames and pauses, and how long the app's own work takes. Numbers only, never an item's or a player's name or a price. A summary goes into the log each minute; nothing is sent anywhere. While it's on, the window keeps drawing frames to time them, a small cost of its own.
  </Switch>
  {#if on}
    <div class="row">
      <button type="button" class="stamp" disabled={busy} title="Put a plain-text timing report on the clipboard and save it in MyOrbiter's log folder, to read or pass on" onclick={copy}>Copy timing report</button>
      {#if said}<span class="hint" class:err={failed} role="status">{said}</span>{/if}
    </div>
    {#if text}
      <details class="report" open={failed}>
        <summary class="hint">The report as copied</summary>
        <textarea readonly rows="12" aria-label="Timing report" value={text}></textarea>
      </details>
    {/if}
  {/if}
  {#if nvidia && rs}
    <Switch name="settings.dmabuf-frames" bind:on={() => rs?.dmabuf ?? false, (v) => setDmabuf(v)} label="DMA-BUF frames (experimental)">
      From the next start, the window gets its frames as DMA-BUF buffers instead of through shared memory, to compare the two with Record timings. On some NVIDIA setups this closes the window at once or leaves it blank: a start that closes within a minute turns it off again by itself, and a window that stays blank needs one start with <code>--no-dmabuf</code>.
    </Switch>
    {#if rs.now?.mode === "dmaBuf"}<p class="hint">This start: DMA-BUF frames.</p>{/if}
    {#if rs.now?.why === "dmaBufFailed"}<p class="hint warn">Turned off by MyOrbiter: the last start, with DMA-BUF frames, closed within a minute. This start is back on shared memory.</p>{/if}
    {#if rsError}<p class="hint err">{rsError}</p>{/if}
  {/if}
</div>

<style>
  .timing { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
  .row { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .hint { margin: 0; font-size: .76rem; color: var(--platinum-deep); }
  .hint.err { color: var(--oxblood); }
  .hint.warn { color: var(--gold); }
  .report summary { cursor: pointer; }
  textarea { width: 100%; margin-top: .4rem; font-family: var(--face-figures); font-size: .7rem; white-space: pre; resize: vertical; }
  code { font-family: var(--face-figures); font-size: .72rem; color: var(--platinum-dim); }
</style>
