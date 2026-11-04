<script lang="ts">
  // Settings › Display (Linux): compatibility rendering, for a window that is blank or flickers.
  // orbiter reads it before the window opens (src-tauri/src/rendering.rs), so it applies at the
  // next start; `--compat-rendering` sets it from a terminal when the window shows nothing at all.
  import { renderingState, setCompatRendering, type RenderingState } from "../backend";
  import Switch from "./Switch.svelte";

  let rs = $state<RenderingState | null>(null);
  let error = $state<string | null>(null);
  renderingState().then((s) => (rs = s), (e) => (error = String(e)));

  const NOW: Record<string, string> = {
    accelerated: "accelerated, on the graphics card",
    sharedMemory: "accelerated, on the graphics card (frames passed through shared memory for the NVIDIA driver)",
    compat: "compatibility rendering",
    yours: "set by your own WebKit variables",
  };
  async function set(on: boolean) {
    if (!rs) return;
    const was = rs.next;
    rs.next = on;
    try {
      await setCompatRendering(on);
      error = null;
    } catch (e) {
      rs.next = was;
      error = String(e).replace(/^Error: /, "");
    }
  }
</script>

{#if rs?.linux}
  <section>
    <h3 class="register">Display</h3>
    <div title="Draws the window without the graphics card: for a window that stays blank, flickers or crashes on this computer. Scrolling and animations are slower with it on. Applies the next time orbiter starts.">
      <Switch bind:on={() => rs?.next ?? false, (v) => set(v)} label="Compatibility rendering (if the window is blank or flickers)">
        Draws the window on the processor instead of the graphics card: slower scrolling and animations, but it shows where the faster way doesn't. Applies the next time orbiter starts.
      </Switch>
    </div>
    {#if rs.now}
      <p class="hint">This start: {NOW[rs.now.mode] ?? rs.now.mode}{rs.next !== (rs.now.mode === "compat") && rs.now.mode !== "yours" ? `. From the next start: ${rs.next ? "compatibility rendering" : "accelerated"}` : ""}.</p>
      {#if rs.now.why === "afterCrash"}<p class="hint warn">Switched on by orbiter: the last start closed within a minute of opening, as it does when the graphics driver can't take the faster way. Turn it off to try again.</p>{/if}
      {#if rs.now.mode === "yours"}<p class="hint">Your own WebKit variables decide this ({rs.now.yours.join(" ")}); the switch counts once they're unset.</p>{/if}
    {/if}
    <p class="hint">Window blank, so Settings can't be reached? Start orbiter once from a terminal with <code>--compat-rendering</code>; it stays on until you turn it off here (or start with <code>--no-compat-rendering</code>).</p>
    {#if error}<p class="hint err">{error}</p>{/if}
  </section>
{/if}

<style>
  section { display: grid; gap: 1rem; padding-bottom: 1.4rem; border-bottom: 1px solid var(--rule); }
  h3 { margin: 0; color: var(--gold); }
  .hint { margin: 0; font-size: .76rem; color: var(--platinum-deep); }
  .hint.err { color: var(--oxblood); }
  .hint.warn { color: var(--gold); }
  code { font-family: var(--face-register); font-size: .72rem; color: var(--platinum-dim); }
</style>
