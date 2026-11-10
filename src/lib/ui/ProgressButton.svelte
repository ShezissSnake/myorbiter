<script lang="ts">
  // A button that answers: while its work runs it fills up behind its label (or sweeps, when the
  // work can't say how far along it is), then says it's done or why it failed. Working isn't
  // disabled: the button keeps its colour and ignores more clicks (aria-busy), so "working" never
  // looks like "can't press", and a double click can't start the work twice.
  //
  // Every label it can show sits in one grid cell, so the button never changes width as they swap.
  // Three looks: a stamp or plain button (text), a square icon button (icon: the icon spins or a
  // hairline fills along its foot), and a text link (link: a hairline under the words).
  import type { HTMLButtonAttributes } from "svelte/elements";
  import type { Job, JobState } from "../job.svelte";
  import Icon from "./Icon.svelte";

  let {
    job = null,
    busy = false,
    state: forced = null,
    progress = undefined,
    label,
    working = null,
    doneLabel = null,
    failLabel = null,
    error = null,
    sizer = [],
    variant = "text",
    stamp = true,
    tone = "",
    icon = null,
    spin = false,
    busyIcon = null,
    size = 14,
    status = false,
    title = undefined,
    disabled = false,
    onclick,
    onstop = null,
    class: cls = "",
    ...rest
  }: {
    /** The work this button shows. Without one, `state` (or `busy`) says what to show. */
    job?: Job | null;
    /** Working for a reason other than a click (a timed pass): shown as working too. */
    busy?: boolean;
    state?: JobState | null;
    /** 0 to 1, or null for a sweep; overrides the job's own. */
    progress?: number | null;
    /** What it does: the label while idle. */
    label: string;
    /** While working ("Checking 12/40"). Defaults to the job's phase, then the label with "…". */
    working?: string | null;
    /** Once done ("All match"). Defaults to the job's word, then "Done". */
    doneLabel?: string | null;
    /** On failure, a word or two. Defaults to the job's short word, then "Failed". */
    failLabel?: string | null;
    /** The full reason, when there's no job to carry it. */
    error?: string | null;
    /** Other labels it may show, so the width is set by the longest from the start. */
    sizer?: string[];
    variant?: "text" | "icon" | "link";
    stamp?: boolean;
    /** Text: "gold" for a gold stamp, "danger". Icon: IconButton's tones. */
    tone?: string;
    /** Text: an icon before the label. Icon: the icon. */
    icon?: string | null;
    /** The icon turns while working (a refresh). */
    spin?: boolean;
    /** Icon variant: shown (turning, with spin) in place of the icon while working: an import's arrow becomes a refresh. */
    busyIcon?: string | null;
    size?: number;
    /** A line under the button: what it's doing, or why it failed. */
    status?: boolean;
    title?: string;
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    /** Clicking while it works stops it (Price check all), instead of being ignored. */
    onstop?: (() => void) | null;
    class?: string;
  } & Omit<HTMLButtonAttributes, "title" | "onclick" | "disabled" | "class"> = $props();

  const st = $derived<JobState>(forced ?? (job?.working || busy ? "working" : (job?.state ?? "idle")));
  // How far along, while it works. Once the work has said how far it is, it keeps that figure until
  // it ends: a run whose own count is cleared a moment before it reports done (Orders' price pass)
  // would otherwise start the sweep again for that moment. The fill moves by steps (`.step`), so a
  // run of many small ones doesn't restart a transition on every one.
  const said = $derived(progress !== undefined ? progress : (job?.progress ?? null));
  let held = $state<number | null>(null);
  // An effect, not part of `p`: it runs whether or not the button is looking at `p`, so each run begins empty.
  $effect.pre(() => {
    if (st !== "working") held = null;
    else if (said != null) held = said;
  });
  const p = $derived(said ?? (st === "working" ? held : null));
  const workWord = $derived(working ?? job?.phase ?? `${label}…`);
  const doneWord = $derived(doneLabel ?? job?.note ?? "Done");
  const failWord = $derived(failLabel ?? job?.short ?? "Failed");
  const reason = $derived(error ?? job?.error ?? null);
  const now = $derived(st === "working" ? workWord : st === "done" ? doneWord : st === "failed" ? failWord : label);
  const tip = $derived(
    st === "failed" && reason
      ? `${failWord}: ${reason}${title ? `\n\n${title}` : ""}`
      : st === "working" && onstop
        ? `${workWord}. Click to stop.`
        : (title ?? label),
  );
  // Disabled only while idle: done and failed stay readable (in their colour) even when there's
  // nothing to press again.
  const off = $derived(disabled && st === "idle");
  const inert = $derived(st === "working" ? !onstop : disabled);

  function click(e: MouseEvent) {
    if (st === "working") {
      e.preventDefault();
      onstop?.();
      return;
    }
    if (disabled) return;
    onclick?.(e);
  }

  // Ctrl+R while it's already working: the button flashes, so the key isn't silently ignored.
  let flashing = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  export function flash() {
    flashing = false;
    if (flashTimer) clearTimeout(flashTimer);
    requestAnimationFrame(() => {
      flashing = true;
      flashTimer = setTimeout(() => (flashing = false), 700);
    });
  }
</script>

{#snippet button()}
  <button
    type="button"
    class="pb {variant} {st} {cls} {variant === 'icon' ? `ib ${tone}` : variant === 'link' ? `link ${tone}` : tone}"
    class:stamp={variant === "text" && stamp}
    class:flash={flashing}
    aria-busy={st === "working"}
    aria-disabled={inert || undefined}
    aria-label={variant === "icon" ? now : undefined}
    disabled={off}
    title={tip}
    onclick={click}
    {...rest}
  >
    {#if variant !== "link"}<span class="fill" class:sweep={st === "working" && p == null} class:step={st === "working" && p != null} class:on={st === "working"} style:transform={st === "working" && p != null ? `scaleX(${p})` : st === "working" ? null : "scaleX(1)"} aria-hidden="true"></span>{/if}
    {#if variant === "icon"}
      <span class="mark">
        {#if st === "done"}<Icon name="check" {size} />
        {:else if st === "failed"}<b class="bang">!</b>
        {:else}<span class:turn={spin && st === "working"}><Icon name={(st === "working" && busyIcon) || icon || "refresh"} {size} /></span>{/if}
      </span>
    {:else}
      {#if icon}
        <span class="mark lead">
          {#if st === "done"}<Icon name="check" size={12} />
          {:else if st === "failed"}<b class="bang">!</b>
          {:else}<span class:turn={spin && st === "working"}><Icon name={icon} size={12} /></span>{/if}
        </span>
      {/if}
      <span class="lbls">
        <span class:on={st === "idle"}>{label}</span>
        <span class:on={st === "working"}>{workWord}</span>
        <span class:on={st === "done"}>{#if !icon}<Icon name="check" size={11} />{/if}{doneWord}</span>
        <span class:on={st === "failed"}>{#if !icon}<b class="bang">!</b>{/if}{failWord}</span>
        {#each sizer as s, i (i)}<span>{s}</span>{/each}
      </span>
      {#if variant === "link"}<i class="hair" class:sweep={st === "working" && p == null} class:step={st === "working" && p != null} class:on={st === "working"} style:transform={st === "working" && p != null ? `scaleX(${p})` : null} aria-hidden="true"></i>{/if}
    {/if}
  </button>
{/snippet}

{#if status}
  <span class="pbw">
    {@render button()}
    <span class="pbs small" class:bad={st === "failed"} role="status" aria-live="polite">{st === "failed" && reason ? reason : st === "working" && variant === "icon" ? workWord : ""}</span>
  </span>
{:else}
  {@render button()}
{/if}

<style>
  .pb { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: .5rem; overflow: hidden; font-variant-numeric: tabular-nums; }
  .pb.ib { display: inline-grid; place-items: center; }
  /* The labels, stacked: only the current one is seen, the widest sets the width. */
  .lbls { position: relative; z-index: 1; display: inline-grid; contain: paint; }
  .lbls > span { grid-area: 1 / 1; visibility: hidden; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; white-space: nowrap; }
  .lbls > span.on { visibility: visible; }
  .mark { position: relative; z-index: 1; display: inline-grid; place-items: center; line-height: 0; }
  .mark > span { display: inline-grid; place-items: center; }
  .bang { display: inline-grid; place-items: center; width: 1.05em; height: 1.05em; border: 1px solid currentColor; font-family: var(--face-register); font-size: .74rem; font-weight: 700; line-height: 1; }

  /* The fill: grows from the left behind the label, clipped by the button's own cut shape. */
  .fill { position: absolute; inset: 0; transform-origin: left center; transform: scaleX(0); background: rgb(241 243 246 / 13%); opacity: 0; pointer-events: none; transition: transform var(--settle) var(--out), opacity var(--settle); }
  /* One layer for the whole working state: the step set on each listing doesn't make WebKit give the fill a layer and take it away again, redrawing the stamp and its border each time. */
  .fill.on { opacity: 1; will-change: transform; }
  /* Working, with a figure: each step is set, not slid to, so the next one doesn't restart a transition. */
  .fill.step { transition: opacity var(--settle); }
  .gold > .fill, .ib.gold > .fill { background: rgb(214 174 74 / 22%); }
  /* No total yet: a band sweeps across instead. */
  .fill.sweep, .hair.sweep { transform: none; background: none; overflow: hidden; }
  .fill.sweep::before, .hair.sweep::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, rgb(241 243 246 / 16%), transparent); animation: sweep-band 1.2s ease-in-out infinite; }
  .gold > .fill.sweep::before { background: linear-gradient(90deg, transparent, rgb(214 174 74 / 28%), transparent); }
  /* An icon button fills along its foot instead, so the icon stays clear. */
  .ib > .fill { inset: auto 0 0 0; height: 2px; background: var(--gold); }
  .ib > .fill.sweep { background: none; }
  .ib > .fill.sweep::before { width: 50%; background: linear-gradient(90deg, transparent, var(--gold), transparent); }
  /* A link: a hairline under the words. */
  .hair { position: absolute; left: 0; right: 0; bottom: 2px; height: 1px; background: currentColor; transform-origin: left center; transform: scaleX(0); opacity: 0; transition: transform var(--settle) var(--out), opacity var(--settle); }
  .hair.on { opacity: .8; }
  .hair.step { transition: opacity var(--settle); }
  .hair.sweep::before { background: linear-gradient(90deg, transparent, currentColor, transparent); }
  .link.pb { overflow: visible; }

  .turn { animation: pb-turn 1s linear infinite; }
  @keyframes pb-turn { to { transform: rotate(360deg); } }

  /* Working: the button keeps its colour, and hovering doesn't invert it (there's nothing to press). */
  .pb.stamp[aria-busy="true"]:hover, .pb.stamp[aria-busy="true"]:active { background: var(--raised); --edge: var(--rule-control); border-color: var(--rule-control); color: var(--platinum); transform: none; }
  .pb.stamp.gold[aria-busy="true"]:hover, .pb.stamp.gold[aria-busy="true"]:active { --edge: var(--gold-dim); border-color: var(--gold-dim); color: var(--gold); }
  .pb.text:not(.stamp)[aria-busy="true"]:hover { color: var(--platinum-dim); border-color: var(--rule-bright); }
  .pb[aria-busy="true"] { cursor: progress; }
  .pb[aria-busy="true"]:active { transform: none; }
  .pb[aria-disabled="true"]:not([aria-busy="true"]) { cursor: default; }
  /* Stoppable work: hovering says a click does something. */
  .pb[aria-busy="true"]:not([aria-disabled]) { cursor: pointer; }

  /* Done: a verdigris edge and a tick. Failed: an oxblood edge and "!". */
  .pb.done, .pb.done.stamp, .pb.stamp.gold.done { --edge: var(--verdigris); border-color: var(--verdigris); color: var(--verdigris); }
  .pb.failed, .pb.failed.stamp, .pb.stamp.gold.failed { --edge: var(--oxblood); border-color: var(--oxblood); color: var(--oxblood); }
  /* Done and failed are a message: hovering brightens the edge but doesn't invert the button. */
  .pb.stamp.done:hover:not(:disabled), .pb.stamp.failed:hover:not(:disabled) { background: var(--raised); }
  .pb.stamp.done:hover:not(:disabled) { color: var(--verdigris); --edge: var(--verdigris); border-color: var(--verdigris); }
  .pb.stamp.failed:hover:not(:disabled) { color: var(--oxblood); --edge: var(--oxblood); border-color: var(--oxblood); }
  .pb.ib.done:hover:not(:disabled) { background: transparent; color: var(--verdigris); }
  .pb.ib.failed:hover:not(:disabled) { background: transparent; color: var(--oxblood); }
  .pb.link.done { border: 0; }
  .pb.link.failed { border: 0; }
  .pb.ib.quiet.done, .pb.ib.quiet.failed { border-color: transparent; }

  .flash { animation: pb-flash calc(var(--settle) * 3) ease-out; }
  @keyframes pb-flash { 0%, 40% { box-shadow: inset 0 0 0 1px var(--gold), var(--struck); } 100% { box-shadow: var(--struck); } }

  .pbw { display: inline-grid; gap: .25rem; justify-items: start; min-width: 0; }
  .pbs { min-height: 0; color: var(--platinum-deep); font-size: .74rem; line-height: 1.35; max-width: 32ch; }
  .pbs:empty { display: none; }
  .pbs.bad { color: var(--oxblood); }

  @media (prefers-reduced-motion: reduce) {
    /* No sweep or turning: a still half-tone fill says "working" instead. */
    .fill.sweep, .hair.sweep { background: rgb(241 243 246 / 9%); }
    .fill.sweep::before, .hair.sweep::before { display: none; }
    .gold > .fill.sweep { background: rgb(214 174 74 / 14%); }
    .ib > .fill.sweep { background: var(--gold-dim); }
    .turn { animation: none; }
    .fill, .fill.step { transition: none; }
  }
</style>
