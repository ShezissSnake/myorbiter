<script lang="ts">
  // Report a bug: the player's words, and (unless they untick it) technical details they can read
  // in full first. orbiter sends nothing itself: Open on GitHub opens a new issue with the fields
  // filled in, to check and submit in the browser; Copy report puts it on the clipboard as
  // Markdown. What it builds, cleans and redacts: core/bugReport.ts and core/redact.ts.
  import { tick, untrack } from "svelte";
  import { scrim } from "./scrim";
  import { trap } from "./trap";
  import { opens, reveal, shade, pulse } from "../motion";
  import Icon from "./Icon.svelte";
  import CopyButton from "./CopyButton.svelte";
  import { logTail, openUrl, reportEnv } from "../backend";
  import { BUILD } from "../build";
  import { bugReport, reportChannel } from "../bugReport.svelte";
  import { buildReport, detailsText, issueLink, reportMarkdown, LOG_LINES, MAX, type ReportDetails } from "../core/bugReport";
  import type { RedactOptions } from "../core/redact";

  let {
    page,
    tennoscope,
    fullMode,
    names,
  }: {
    /** The page open behind the dialog, by its name. */
    page: string;
    /** TennoScope's state, in a few words. */
    tennoscope: string;
    /** "on", "off" or "unknown". */
    fullMode: string;
    /** The player's own name and the names orbiter knows, to hide wherever they appear. */
    names: () => RedactOptions;
  } = $props();

  // The draft lives in the store, so closing and reopening keeps what was typed.
  const d = bugReport.draft;
  let area = $state<HTMLTextAreaElement | null>(null);
  let openButton = $state<HTMLButtonElement | null>(null);

  // What the technical details hold: read once each time the dialog opens.
  let env = $state<{ version: string; os: string; arch: string } | null>(null);
  let log = $state<string[] | null>(null);
  let failed = $state(false);
  // The names to hide, read once as the dialog opens (they don't change while it's up).
  const known = untrack(() => names());
  $effect(() => {
    void Promise.all([reportEnv(), logTail(LOG_LINES)]).then(
      ([e, l]) => {
        env = e;
        log = l;
      },
      () => {
        failed = true;
        log = [];
      },
    );
    void tick().then(() => area?.focus());
  });

  const details = $derived.by((): ReportDetails | null => {
    if (!d.include) return null;
    return {
      version: env?.version ?? "…",
      commit: BUILD.commit,
      buildDate: BUILD.date,
      channel: reportChannel(),
      os: env?.os ?? "…",
      arch: env?.arch ?? "",
      page,
      tennoscope,
      fullMode,
      log: log ?? [],
    };
  });
  const report = $derived(buildReport({ what: d.what, steps: d.steps, expected: d.expected }, details, known));
  const link = $derived(issueLink(report));
  const reading = $derived(d.include && log == null);
  const empty = $derived(!report.what);
  const preview = $derived(report.details ? detailsText(report.details) : "");

  let showTech = $state(false);
  /** Open on GitHub was pressed: its label says so for a moment. */
  let opened = $state(false);
  let openedTimer: ReturnType<typeof setTimeout> | null = null;
  function openOnGitHub() {
    if (empty || reading) return;
    void openUrl(link.url);
    opened = true;
    if (openButton) pulse(openButton);
    if (openedTimer) clearTimeout(openedTimer);
    openedTimer = setTimeout(() => (opened = false), 2600);
  }
  const close = () => (bugReport.open = false);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" use:scrim in:shade|global out:shade|global onclick={close}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="bug-title" tabindex="-1" in:opens|global={{ fade: false }} out:opens|global={{ fade: false }} use:trap={{ onescape: close }} onclick={(e) => e.stopPropagation()}>
    <header class="top">
      <span class="glyph" aria-hidden="true"><Icon name="bug" size={18} /></span>
      <div>
        <h2 id="bug-title" class="mark">Report a bug</h2>
        <p class="dim small">Goes to orbiter's issues on GitHub, where anyone can read it.</p>
      </div>
      <button class="close" aria-label="Close" title="Close (Esc). What you typed stays here for next time." onclick={close}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </header>

    <label class="field">
      <span class="register">What happened</span>
      <textarea bind:this={area} bind:value={d.what} rows="4" maxlength={MAX.what} placeholder="What went wrong, and on which page" title="What went wrong, in your own words. Its first line becomes the issue's title."></textarea>
    </label>
    <div class="two">
      <label class="field">
        <span class="register">Steps to reproduce <i>optional</i></span>
        <textarea bind:value={d.steps} rows="3" maxlength={MAX.steps} placeholder={"1. Open Orders\n2. Press Reprice"} title="What to do to make it happen again, if you know"></textarea>
      </label>
      <label class="field">
        <span class="register">What you expected <i>optional</i></span>
        <textarea bind:value={d.expected} rows="3" maxlength={MAX.expected} placeholder="What should have happened" title="What you thought would happen instead"></textarea>
      </label>
    </div>

    <section class="tech" class:off={!d.include}>
      <div class="techrow">
        <label class="check" title="Adds orbiter's version, your system, this page, TennoScope's state, Full mode and the log's last {LOG_LINES} lines, with sign-ins, addresses, ids and players' names hidden. Untick to send only what you wrote.">
          <input type="checkbox" bind:checked={d.include} />
          <span class="box" aria-hidden="true"><Icon name="check" size={10} /></span>
          Include technical details
        </label>
        {#if d.include}
          <button type="button" class="link quiet fold" aria-expanded={showTech} aria-controls="bug-tech" title={showTech ? "Hide the technical details" : "Read exactly what the technical details hold before you send them"} onclick={() => (showTech = !showTech)}>
            {showTech ? "Hide" : "See exactly what's included"}<span class="chev" class:up={showTech} aria-hidden="true">▾</span>
          </button>
        {/if}
      </div>
      {#if d.include && showTech}
        <div class="reveal" transition:reveal>
          <div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <pre id="bug-tech" class="techtext" tabindex="0" title="This is the whole of it: nothing else is added">{reading ? "Reading orbiter's log…" : preview}</pre>
          </div>
        </div>
      {/if}
      <p class="hint">{#if !d.include}Only what you wrote goes in.{:else if failed}orbiter's log couldn't be read; the rest is included.{:else}Sign-ins, e-mail and IP addresses, account ids, your user name in folder paths and every player's name are hidden, here and in what you wrote.{/if}</p>
    </section>

    {#if link.dropped || link.cut}
      <p class="note small" role="status">{#if link.cut}What you wrote is longer than a link can carry: Open on GitHub cuts the end. Copy report has it all, to paste in instead.{:else}To keep the link short enough, Open on GitHub leaves out the {link.dropped} oldest log line{link.dropped === 1 ? "" : "s"}; Copy report has them all.{/if}</p>
    {/if}

    <footer class="row">
      <p class="privacy small"><Icon name="lock" size={11} /> orbiter sends nothing: you check it and press Submit on GitHub.</p>
      <div class="acts">
        <CopyButton text={() => reportMarkdown(report)} label="Copy report" copied="Copied" sizer={["Couldn't copy"]} title="Put the report on the clipboard as Markdown, to paste into an issue yourself, or send it another way if you don't have a GitHub account" />
        <button bind:this={openButton} type="button" class="stamp gold go" class:done={opened} disabled={empty || reading} title={empty ? "Say what happened first" : reading ? "Reading orbiter's log…" : "Open a new issue on GitHub in your browser with all of this filled in. Nothing is posted until you press Submit there."} onclick={openOnGitHub}>
          <span class="lbls">
            <span class:on={!opened}>Open on GitHub<Icon name="external" size={11} /></span>
            <span class:on={opened}>Opened in your browser<Icon name="check" size={11} /></span>
          </span>
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 50; background: rgb(6 7 9 / 72%); display: grid; place-items: center; padding: 1rem; }
  .dialog { clip-path: var(--cut); width: min(46rem, 100%); max-height: calc(100vh - 2rem); overflow: auto; background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 50%), inset 3px 0 0 var(--oxblood); padding: 1.2rem 1.4rem 1.1rem; display: grid; gap: .9rem; outline: none; }
  .top { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: .8rem; }
  .top p { margin: .35rem 0 0; }
  h2 { font-size: 1.7rem; }
  .glyph { display: grid; place-items: center; width: 2.2rem; height: 2.2rem; color: var(--oxblood); border: 1px solid color-mix(in srgb, var(--oxblood) 45%, transparent); background: color-mix(in srgb, var(--oxblood) 8%, var(--well)); clip-path: var(--cut); }
  .close { padding: .5rem; line-height: 0; }
  .field { display: grid; gap: .3rem; min-width: 0; }
  .field i { font-style: normal; color: var(--platinum-deep); letter-spacing: .08em; margin-left: .3rem; }
  textarea { font: inherit; font-size: .86rem; color: var(--platinum); background: var(--well); border: 1px solid var(--rule-control); padding: .5rem .6rem; resize: vertical; text-transform: none; letter-spacing: 0; min-height: 4.6rem; }
  textarea::placeholder { color: var(--platinum-deep); opacity: .8; }
  textarea:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
  :global(html[data-room~="lt760"]) .two { grid-template-columns: 1fr; }

  /* The technical details: a ledger strip, its contents readable in full before sending. */
  .tech { display: grid; gap: .5rem; padding: .7rem .8rem; background: var(--well); border: 1px solid var(--rule); }
  .tech.off { opacity: .85; }
  .techrow { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem; }
  .check { display: inline-flex; align-items: center; gap: .55rem; cursor: pointer; font-size: .88rem; color: var(--platinum); }
  .check input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .box { display: grid; place-items: center; width: 1rem; height: 1rem; border: 1px solid var(--rule-control); background: var(--plate); color: transparent; transition: background var(--snap) var(--out), border-color var(--snap) var(--out), color var(--snap) var(--out); }
  .check input:checked + .box { background: color-mix(in srgb, var(--gold) 22%, var(--plate)); border-color: var(--gold); color: var(--gold); }
  .check input:focus-visible + .box { outline: 1px solid var(--gold); outline-offset: 2px; }
  .check:active .box { transform: translateY(1px); }
  .fold { display: inline-flex; align-items: center; gap: .35rem; font-size: .62rem; }
  .chev { display: inline-block; transition: transform var(--quick) var(--out); }
  .chev.up { transform: rotate(180deg); }
  .techtext { margin: .2rem 0 0; max-height: 15rem; overflow: auto; padding: .6rem .7rem; font-family: var(--face-register); font-size: .7rem; line-height: 1.5; color: var(--platinum-dim); background: var(--slab); border: 1px solid var(--rule); white-space: pre-wrap; overflow-wrap: anywhere; }
  .techtext:focus-visible { outline: 1px solid var(--gold); outline-offset: 1px; }
  .hint { margin: 0; font-size: .74rem; color: var(--platinum-deep); }
  .note { margin: 0; color: var(--platinum-dim); padding: .45rem .7rem; border-left: 2px solid var(--alert); background: var(--well); }

  .row { display: flex; align-items: center; justify-content: space-between; gap: .8rem 1rem; flex-wrap: wrap; padding-top: .3rem; border-top: 1px solid var(--rule); }
  .privacy { margin: 0; display: inline-flex; align-items: center; gap: .4rem; color: var(--platinum-deep); }
  .acts { display: flex; align-items: center; gap: 1rem; margin-left: auto; }
  .go .lbls { display: inline-grid; }
  .go .lbls > span { grid-area: 1 / 1; visibility: hidden; display: inline-flex; align-items: center; justify-content: center; gap: .4rem; white-space: nowrap; }
  .go .lbls > span.on { visibility: visible; }
  /* Opened: green until it settles back, even under the pointer. */
  .stamp.go.done, .stamp.go.done:hover:not(:disabled) { --edge: var(--verdigris); color: var(--verdigris); border-color: var(--verdigris); background: color-mix(in srgb, var(--verdigris) 14%, var(--plate)); }
</style>
