<script lang="ts">
  // Notifications that arrive while you're looking at orbiter: bottom right, newest on top, each
  // gone after a few seconds (hovering or focusing it holds it). Click one to open what it's about.
  import { fly, fade } from "svelte/transition";
  import { toasts } from "../toasts.svelte";
  import { noticeKind } from "../notices";
  import GameIcon from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";

  let { open }: { open: (id: string) => void } = $props();
  const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
</script>

<div class="toasts" role="region" aria-label="Notifications" aria-live="polite">
  {#each toasts.list as n (n.id)}
    {@const k = noticeKind[n.kind]}
    <div class="toast" role="status" in:fly={{ x: still ? 0 : 24, duration: still ? 0 : 220 }} out:fade={{ duration: still ? 0 : 160 }}
      onpointerenter={() => toasts.hold(n.id)} onpointerleave={() => toasts.arm(n.id)} onfocusin={() => toasts.hold(n.id)} onfocusout={() => toasts.arm(n.id)}>
      <button class="body" title="Open what it's about" onclick={() => open(n.id)}>
        <span class="ic"><GameIcon name={k?.icon ?? "market"} size={22} /></span>
        <span class="txt"><b>{n.title}</b>{#if n.body}<span>{n.body}</span>{/if}</span>
      </button>
      <button class="x" aria-label="Dismiss" title="Dismiss (it stays under the bell)" onclick={() => toasts.dismiss(n.id)}><Icon name="close" size={11} /></button>
      <i class="timer" class:still aria-hidden="true"></i>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; right: 1rem; bottom: 1rem; z-index: 60; display: grid; gap: .5rem; width: min(24rem, calc(100vw - 2rem)); pointer-events: none; }
  .toast { position: relative; pointer-events: auto; display: grid; grid-template-columns: 1fr auto; overflow: hidden; border: 1px solid var(--rule-bright); background: var(--plate); box-shadow: 0 10px 30px rgb(0 0 0 / 45%), inset 3px 0 0 var(--gold); clip-path: var(--cut); }
  .body { display: grid; grid-template-columns: 1.9rem 1fr; gap: .7rem; padding: .75rem .4rem .8rem .9rem; text-align: left; border: 0; background: transparent; color: var(--platinum-dim); font-family: var(--face-text); font-size: .82rem; letter-spacing: 0; text-transform: none; }
  .body:hover { background: rgb(230 233 238 / 4%); }
  .txt { display: grid; gap: .25rem; min-width: 0; }
  .txt b { color: var(--platinum); font-weight: 600; font-size: .88rem; }
  .txt span { font-weight: 400; white-space: pre-line; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .x { align-self: start; margin: .45rem .45rem 0 0; padding: .3rem; line-height: 0; border-color: transparent; background: transparent; color: var(--platinum-deep); }
  .x:hover { color: var(--platinum); }
  /* How long it has left: a hairline that runs down, and stops while you hover it, as the timer does. */
  .timer { position: absolute; left: 0; right: 0; bottom: 0; display: block; height: 2px; padding: 0; background: var(--gold-dim); transform-origin: left; animation: run 7s linear forwards; pointer-events: none; }
  .toast:hover .timer, .toast:focus-within .timer { animation-play-state: paused; }
  .timer.still { display: none; }
  @keyframes run { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
