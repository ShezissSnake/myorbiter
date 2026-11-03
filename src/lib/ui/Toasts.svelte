<script lang="ts">
  // Notifications that arrive while you're looking at orbiter: bottom left by the sidebar, newest on top, each
  // gone after a few seconds (hovering or focusing it holds it). Click one to open what it's about.
  import { fly } from "svelte/transition";
  import { calm, leave, ms, out, SETTLE } from "../motion";
  import { toasts } from "../toasts.svelte";
  import { noticeKind } from "../notices";
  import GameIcon from "./GameIcon.svelte";
  import Icon from "./Icon.svelte";
  import type { Snippet } from "svelte";
  import type { Notice } from "../notices";

  // left: just past the sidebar, so they come out of the bell's side and don't cover the panels
  // that open on the right.
  // acts: a notification's own controls under its text (a sale's +rep), from App.
  // all: opens the bell's list, for the "N more" line a burst folds into (toasts.svelte.ts).
  let { open, all, left = "1rem", acts }: { open: (id: string) => void; all?: () => void; left?: string; acts?: Snippet<[Notice]> } = $props();
</script>

<div class="toasts" style:left role="region" aria-label="Notifications" aria-live="polite">
  {#each toasts.list as n (n.id)}
    {@const k = noticeKind[n.kind]}
    <div class="toast" role="status" in:fly={{ x: -24, duration: ms(SETTLE), easing: out }} out:leave
      onpointerenter={() => toasts.hold(n.id)} onpointerleave={() => toasts.arm(n.id)} onfocusin={() => toasts.hold(n.id)} onfocusout={() => toasts.arm(n.id)}>
      <button class="body" title="Open what it's about" onclick={() => open(n.id)}>
        <span class="ic"><GameIcon name={k?.icon ?? "market"} size={22} /></span>
        <span class="txt"><b>{n.title}</b>{#if n.body}<span>{n.body}</span>{/if}</span>
      </button>
      <button class="x" aria-label="Dismiss" title="Dismiss (it stays under the bell)" onclick={() => toasts.dismiss(n.id)}><Icon name="close" size={11} /></button>
      {#if acts}<div class="nacts">{@render acts(n)}</div>{/if}
      <i class="timer" class:still={calm.current} aria-hidden="true"></i>
    </div>
  {/each}
  {#if toasts.more}
    <div class="toast more" role="status" in:fly={{ x: -24, duration: ms(SETTLE), easing: out }} out:leave>
      <button class="body" title="Open the notifications under the bell" onclick={() => { toasts.dropMore(); all?.(); }}>
        <span class="ic"><Icon name="bell" size={14} /></span>
        <span class="txt"><b>{toasts.more} more {toasts.more === 1 ? "notification" : "notifications"}</b></span>
      </button>
      <button class="x" aria-label="Dismiss" title="Dismiss (they stay under the bell)" onclick={() => toasts.dropMore()}><Icon name="close" size={11} /></button>
    </div>
  {/if}
</div>

<style>
  .toasts { position: fixed; bottom: 1rem; z-index: 60; display: grid; gap: .5rem; width: min(24rem, calc(100vw - 2rem)); pointer-events: none; }
  /* A side panel open: they go behind its shade, so they never cover the panel's controls (the bell keeps them). */
  :global(html[data-scrim]) .toasts { z-index: 39; }
  .toast { position: relative; pointer-events: auto; display: grid; grid-template-columns: 1fr auto; overflow: hidden; border: 1px solid var(--rule-bright); background: var(--plate); box-shadow: 0 10px 30px rgb(0 0 0 / 55%), inset 3px 0 0 var(--gold); clip-path: var(--cut); }
  .body { display: grid; grid-template-columns: 1.9rem 1fr; gap: .7rem; padding: .75rem .4rem .8rem .9rem; text-align: left; border: 0; background: transparent; color: var(--platinum-dim); font-family: var(--face-text); font-size: .82rem; letter-spacing: 0; text-transform: none; }
  .body:hover { background: rgb(230 233 238 / 4%); }
  .txt { display: grid; gap: .25rem; min-width: 0; }
  .txt b { color: var(--platinum); font-weight: 600; font-size: .88rem; }
  .txt span { font-weight: 400; white-space: pre-line; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  /* Under the text, in line with it; gone when the notification has none. */
  .nacts { grid-column: 1 / -1; display: flex; align-items: center; gap: .9rem; padding: 0 .9rem .75rem 3.5rem; margin-top: -.35rem; font-size: .8rem; }
  .nacts:not(:has(*)) { display: none; }
  .x { align-self: start; margin: .45rem .45rem 0 0; padding: .3rem; line-height: 0; border-color: transparent; background: transparent; color: var(--platinum-deep); }
  .x:hover { color: var(--platinum); }
  /* How long it has left: a hairline that runs down, and stops while you hover it, as the timer does. */
  .timer { position: absolute; left: 0; right: 0; bottom: 0; display: block; height: 2px; padding: 0; background: var(--gold-dim); transform-origin: left; animation: run 7s linear forwards; pointer-events: none; }
  .toast:hover .timer, .toast:focus-within .timer { animation-play-state: paused; }
  .timer.still { display: none; }
  /* The rest of a burst: one slim line under the others. */
  .more .body { padding-top: .45rem; padding-bottom: .5rem; align-items: center; }
  .more .ic { display: grid; place-items: center; color: var(--platinum-deep); }
  .more .txt b { font-size: .8rem; font-weight: 500; color: var(--platinum-dim); }
  .more .x { align-self: center; margin-top: 0; }
  @keyframes run { from { transform: scaleX(1); } to { transform: scaleX(0); } }
</style>
