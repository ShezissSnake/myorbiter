<script lang="ts">
  // The help, over the page: a walk-through of a few pages, each a marked picture of a piece of the
  // screen and a few words. It sits centred over the content area (the sidebar stays as it is),
  // taking most of it (up to 960 by 640, a margin all round; a small area it fills), with the area
  // darkened behind it by a flat shade (the page behind is marked .helpblur, for a still blur that
  // app.css leaves off until it's measured).
  // Browsed with the arrows, the dots or the arrow keys; Esc, Close or a click on the shade closes it
  // and the keyboard goes back to the "?" that opened it. Opens over --settle, opacity and transform
  // only; the shade only fades. A picture is loaded only while its page is shown.
  import { help } from "../help/help.svelte";
  import { pictureFile } from "../help/index";
  import PICTURES from "../help/pictures.json";
  import { pageById, type PageId } from "../pages";
  import { trap } from "./trap";
  import { scrim } from "./scrim";
  import { moving, ms, out, SETTLE } from "../motion";
  import Icon from "./Icon.svelte";
  import type { TransitionConfig } from "svelte/transition";

  let { go }: { go: (target: string) => void } = $props();

  const pics = PICTURES as Record<string, { hash: string; w: number; h: number; bytes: number }>;
  const wt = $derived(help.wt);
  const page = $derived(wt ? wt.pages[help.at] : null);
  const app = $derived(wt && wt.app !== "shared" ? pageById[wt.app as PageId] : null);
  const section = $derived(app?.group || undefined);
  const kicker = $derived(app ? (app.group ? `${app.group} · ${app.label}` : app.label) : "MyOrbiter");
  const file = $derived(wt && page?.shot ? pictureFile(wt, help.at) : null);
  const pic = $derived(file ? (pics[file] ?? null) : null);
  /** Numbered marks: the first lines are keyed to them, line 1 to mark 1; any lines after are plain. */
  const numbered = $derived(page?.shot?.marks.filter((m) => m.is === "n").length ?? 0);
  const keyed = $derived(numbered > 0);

  // The content area: #main's box, followed while the help is open (the sidebar folding, the
  // Watching column coming or going, the window resized).
  let area = $state({ x: 0, y: 0, w: 0, h: 0 });
  $effect(() => {
    if (!wt) return;
    const main = document.getElementById("main");
    if (!main) return;
    const measure = () => {
      const r = main.getBoundingClientRect();
      area = { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  });
  /** A small area: the help fills it rather than leaving a margin. */
  const fill = $derived(area.w < 720 || area.h < 520);
  /**
   * Picture beside the words on a wide box, under them on a narrow one. A picture over three times
   * as wide as it is tall (a tool row, a strip of figures) goes above the words on a wide box too:
   * beside them it would shrink to half its size.
   */
  const strip = $derived(!!pic && pic.w > pic.h * 3);
  const beside = $derived(area.w >= 900 && !strip);

  // The page behind marked while the help is open: one class on the page shown, on and off in one
  // step (motion.md rule 4: a blur on it would never animate). app.css gives it no style for now.
  $effect(() => {
    if (!wt) return;
    const pane = document.querySelector<HTMLElement>("#main .pane.shown");
    pane?.classList.add("helpblur");
    return () => pane?.classList.remove("helpblur");
  });

  /** The box arrives from a few px lower and fades in, over --settle; leaves in 100 ms. */
  function settle(_node: Element, { dir }: { dir: "in" | "out" }): TransitionConfig {
    const duration = moving(ms(dir === "in" ? SETTLE : 100));
    if (!duration) return { duration: 0 };
    return { duration, easing: out, css: (t, u) => `opacity:${t};transform:translateY(${(u * 8).toFixed(2)}px) scale(${(0.985 + 0.015 * t).toFixed(4)})` };
  }
  function fade(_node: Element, { dir }: { dir: "in" | "out" }): TransitionConfig {
    const duration = moving(ms(dir === "in" ? SETTLE : 100));
    if (!duration) return { duration: 0 };
    return { duration, easing: out, css: (t) => `opacity:${t}` };
  }

  function onkey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (help.key(e.key)) e.preventDefault();
  }
  function toGuide() {
    if (!wt) return;
    const to = wt.guide;
    help.close(false);
    go(to);
  }
  const uid = $props.id();
</script>

{#if wt && page}
  <div class="zone" data-section={section} style:left="{area.x}px" style:top="{area.y}px" style:width="{area.w}px" style:height="{area.h}px">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="shade" use:scrim onclick={() => help.close()} in:fade|global={{ dir: "in" }} out:fade|global={{ dir: "out" }}></div>
    <div class="box" class:fill class:beside role="dialog" aria-modal="true" aria-labelledby="help-title-{uid}" tabindex="-1" onkeydown={onkey} use:trap={{ onescape: () => help.close(), restore: false }} in:settle|global={{ dir: "in" }} out:settle|global={{ dir: "out" }}>
      <header>
        <div class="titles">
          <span class="register kicker">{kicker}</span>
          <h2 class="mark" id="help-title-{uid}">{wt.title}</h2>
        </div>
        <button type="button" class="ib close" aria-label="Close the help" title="Close (Esc)" onclick={() => help.close()}><Icon name="close" size={12} stroke={1.5} /></button>
      </header>
      <div class="body" class:nopic={!page.shot} class:strip>
        {#if page.shot}
          <figure class="picwell">
            {#if pic && file}
              {#key file}<img src="/help/{file}" width={pic.w} height={pic.h} alt={`${page.title}: the part of the page this is about${keyed ? ", with the numbered places marked" : ", marked"}`} decoding="async" />{/key}
            {:else}
              <span class="nopicture register">Picture not taken yet</span>
            {/if}
          </figure>
        {/if}
        <div class="words" aria-live="polite">
          <h3 class="name-mark">{page.title}</h3>
          {#if keyed}
            <ol class="keyed">{#each page.lines.slice(0, numbered) as line, i (i)}<li><span class="num" aria-hidden="true">{i + 1}</span><span>{line}</span></li>{/each}</ol>
            {#each page.lines.slice(numbered) as line, i (i)}<p>{line}</p>{/each}
          {:else}
            {#each page.lines as line, i (i)}<p>{line}</p>{/each}
          {/if}
          {#if help.last && wt.good}
            <p class="good" class:warn={wt.good.warn}>{#if wt.good.warn}<i class="dia" aria-hidden="true"></i><span class="register">Watch out</span>{:else}<span class="register">Good to know</span>{/if}<span class="gt">{wt.good.text}</span></p>
          {/if}
          {#if help.last}<button type="button" class="link guide" onclick={toGuide}>More in the Guide</button>{/if}
        </div>
      </div>
      <footer>
        <button type="button" class="ib step" aria-label="Previous page" title="Previous (←)" disabled={help.at === 0} onclick={() => help.prev()}><span class="flip"><Icon name="arrow-right" size={14} stroke={1.5} /></span></button>
        <div class="dots">
          {#if help.count > 1}
            {#each wt.pages as p, i (i)}<button type="button" class="dot" class:on={i === help.at} aria-label={`Page ${i + 1}: ${p.title}`} aria-current={i === help.at ? "step" : undefined} onclick={() => help.go(i)}><i></i></button>{/each}
          {/if}
          <span class="of register">{help.at + 1} of {help.count}</span>
        </div>
        <button type="button" class="ib step" aria-label="Next page" title="Next (→)" disabled={help.last} onclick={() => help.next()}><Icon name="arrow-right" size={14} stroke={1.5} /></button>
      </footer>
    </div>
  </div>
{/if}

<style>
  /* Over the content area only: the sidebar keeps its place and stays sharp. */
  .zone { position: fixed; z-index: 70; display: grid; place-items: center; pointer-events: none; }
  /* A flat shade: no gradient, no backdrop filter. */
  .shade { position: absolute; inset: 0; background: rgb(6 7 9 / 70%); pointer-events: auto; }
  .box {
    position: relative; pointer-events: auto; outline: none;
    width: min(960px, calc(100% - 48px)); height: min(640px, calc(100% - 48px));
    display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
    background: var(--plate-sheen), var(--plate); border: 1px solid var(--rule-bright); clip-path: var(--cut);
    box-shadow: var(--plate-light);
  }
  .box.fill { width: 100%; height: 100%; clip-path: none; border: 0; }
  header { display: flex; align-items: flex-start; gap: 16px; padding: 16px 16px 12px 24px; border-bottom: 1px solid var(--rule); }
  .titles { flex: 1; min-width: 0; display: grid; gap: 6px; }
  .kicker { color: var(--sec); }
  h2 { font-size: 28px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .close { --ib: 32px; }
  .body { min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 16px; padding: 16px 24px; overflow: auto; }
  .beside .body { grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(0, 1fr) minmax(240px, 300px); gap: 24px; }
  /* A strip is short whatever the box: its well is as tall as it, and the words follow. */
  .body.strip { grid-template-rows: auto auto; align-content: start; }
  .body.strip figure { min-height: 0; }
  .body.nopic { grid-template-rows: auto; grid-template-columns: minmax(0, 1fr); align-content: start; }
  /* A flex box, so the picture's max-height resolves against the well's height and never runs past it. */
  figure { margin: 0; min-height: 160px; display: flex; align-items: center; justify-content: center; padding: 12px; overflow: hidden; }
  /* Fitted, never stretched: app.css's .picwell img. */
  img { display: block; min-width: 0; min-height: 0; width: auto; height: auto; }
  .nopicture { color: var(--platinum-deep); }
  .words { display: grid; align-content: start; gap: 10px; min-width: 0; }
  h3 { margin: 0; font-size: 20px; }
  .words p { margin: 0; color: var(--platinum-dim); line-height: 1.5; }
  .keyed { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .keyed li { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 10px; align-items: start; color: var(--platinum-dim); line-height: 1.5; }
  /* The number as the picture draws it: white on the slab, in a diamond's square. */
  .num { display: grid; place-items: center; width: 22px; height: 22px; margin-top: -1px; background: var(--slab); border: 1.5px solid var(--platinum); color: var(--platinum); font-family: var(--face-mark); font-weight: 700; font-size: 13px; line-height: 1; }
  .good { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; padding: 10px 12px; background: var(--well); box-shadow: var(--sunk); }
  .good .register { color: var(--platinum-deep); }
  .good .gt { flex-basis: 100%; color: var(--platinum); }
  .good.warn .register { color: var(--oxblood); }
  .dia { display: inline-block; width: 8px; height: 8px; background: var(--oxblood); transform: rotate(45deg); align-self: center; }
  .guide { justify-self: start; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 16px; border-top: 1px solid var(--rule); }
  .step { --ib: 32px; }
  .flip { display: grid; transform: scaleX(-1); }
  .dots { display: flex; align-items: center; gap: 4px; }
  .dot { width: 24px; height: 24px; padding: 0; border: 0; background: none; display: grid; place-items: center; }
  .dot i { width: 8px; height: 8px; border: 1px solid var(--rule-control); transform: rotate(45deg); }
  .dot.on i { background: var(--sec); border-color: var(--sec); }
  .dot:hover i { border-color: var(--platinum); }
  .of { margin-left: 8px; color: var(--platinum-dim); font-variant-numeric: tabular-nums; }
</style>
