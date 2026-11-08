<script lang="ts">
  // The first start's one question, asked before TennoScope starts at all: may it read the game's
  // memory (Full mode), or only the reward screen (Overlay)? Full mode's warning is the same words
  // as beside every other switch that turns it on. There's no closing it without an answer (no Esc,
  // no click outside): either answer is a click, and either is changed later in Settings,
  // TennoScope.
  import { scrim } from "./ui/scrim";
  import { trap } from "./ui/trap";
  import { opens, shade } from "./motion";
  import { FULL_MODE_WARNING } from "./FullMode.svelte";
  import type { TennoscopeAccess } from "./backend";

  let { onanswer }: { onanswer: (access: TennoscopeAccess) => void } = $props();
  // It opens by itself during start-up: a click meant for the page behind doesn't answer it.
  let ready = $state(false);
  $effect(() => {
    const t = setTimeout(() => (ready = true), 600);
    return () => clearTimeout(t);
  });
</script>

<div class="scrim" use:scrim in:shade|global out:shade|global>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="first-run-title" aria-describedby="first-run-what first-run-warning" tabindex="-1" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} use:trap>
    <header>
      <span class="register kicker">First start</span>
      <h2 class="mark" id="first-run-title">Should TennoScope read your inventory?</h2>
    </header>
    <p class="prose" id="first-run-what">
      MyOrbiter runs TennoScope beside it. Without Full mode, TennoScope reads the game's log and the reward
      screen (Overlay mode), and MyOrbiter shows everything that doesn't need your inventory. With Full mode,
      it also reads your items, mastery and Foundry from the running game.
    </p>
    <p class="warn" id="first-run-warning">{FULL_MODE_WARNING}</p>
    <p class="dim small">Nothing starts until you choose. You can change it any time in Settings, TennoScope.</p>
    <footer>
      <button class="stamp" disabled={!ready} onclick={() => onanswer("--access=overlay")}>Not now: overlay only</button>
      <button class="stamp" disabled={!ready} onclick={() => onanswer("--access=full")}>Read my inventory (Full mode)</button>
    </footer>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(40rem, 100%); max-height: calc(100vh - 2rem); overflow: auto; background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%), inset 3px 0 0 var(--gold-dim); padding: 1.3rem 1.5rem 1.1rem; display: grid; gap: .9rem; outline: none; }
  header { display: grid; gap: .3rem; }
  .kicker { color: var(--gold); }
  h2 { font-size: 1.7rem; margin: 0; }
  p { margin: 0; }
  .warn { color: var(--platinum-deep); line-height: 1.5; border-left: 2px solid var(--gold-dim); padding-left: .7rem; }
  .dim { color: var(--platinum-deep); }
  .small { font-size: .8rem; }
  footer { display: flex; flex-wrap: wrap; gap: .7rem; justify-content: flex-end; padding-top: .3rem; }
</style>
