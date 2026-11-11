<script lang="ts" module>
  export interface MoreItem {
    label: string;
    /** The line icon before the label; none for TennoScope, which shows its state diamond. */
    icon?: string;
    /** Its shortcut, shown at the right. */
    keys?: string;
    title: string;
    /** TennoScope's state: "ok", "warn", "bad" or "off". */
    tone?: string;
    on?: boolean;
    run: () => void;
  }
</script>

<script lang="ts">
  // The sidebar foot's More: a button, and the menu it opens over what is there, never moving the
  // list. Folded sidebar: to its right, its foot level with the button's. Full sidebar: upward,
  // over the list, as wide as the sidebar. Drawn fixed to the window, so the sidebar's own clipping
  // doesn't cut it. Not modal: the app's shortcuts still work. Arrow keys, Home and End move
  // between the items; Esc closes it and gives the focus back to More; Tab, a click elsewhere or
  // choosing an item closes it.
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import GameIcon from "./GameIcon.svelte";

  let { items, compact }: { items: MoreItem[]; compact: boolean } = $props();
  let open = $state(false);
  let button = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);
  let place = $state("");
  const uid = $props.id();

  function measure() {
    const b = button?.getBoundingClientRect();
    const rail = button?.closest<HTMLElement>(".rail")?.getBoundingClientRect();
    if (!b || !rail) return;
    const fromBottom = window.innerHeight - b.bottom;
    place = compact
      ? `left: ${rail.right}px; bottom: ${fromBottom}px;`
      : `left: ${rail.left + 8}px; width: ${rail.width - 16}px; bottom: ${window.innerHeight - b.top + 4}px;`;
  }
  async function show(focusFirst: boolean) {
    measure();
    open = true;
    await tick();
    if (focusFirst) entries()[0]?.focus();
  }
  function close(refocus: boolean) {
    if (!open) return;
    open = false;
    if (refocus) button?.focus();
  }
  const entries = () => [...(menu?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
  function move(by: number | "first" | "last") {
    const all = entries();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const i = by === "first" ? 0 : by === "last" ? all.length - 1 : (at + by + all.length) % all.length;
    all[i].focus();
  }
  function onMenuKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home") move("first");
    else if (e.key === "End") move("last");
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") return close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  function onButtonKey(e: KeyboardEvent) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      void show(true).then(() => e.key === "ArrowUp" && move("last"));
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  }
  function choose(it: MoreItem) {
    close(false);
    it.run();
  }
  // A click anywhere but the menu or its button closes it; so does the focus going elsewhere (a
  // shortcut opening a dialog) and the window changing size.
  $effect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!menu?.contains(t) && !button?.contains(t)) close(false);
    };
    const resize = () => close(false);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("focusin", away, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("focusin", away, true);
      window.removeEventListener("resize", resize);
    };
  });
  // The sidebar folded or unfolded while open: the menu goes where the new width puts it.
  $effect(() => {
    void compact;
    if (open) requestAnimationFrame(measure);
  });
</script>

<button bind:this={button} type="button" class="tool more" class:on={open} aria-haspopup="menu" aria-expanded={open} aria-controls="more-{uid}" aria-label="More" title="More: search, help, report a bug, settings{items.some((i) => i.tone) ? ', TennoScope' : ''}" onclick={(e) => (open ? close(false) : show(e.detail === 0))} onkeydown={onButtonKey}>
  <span class="ti"><GameIcon name="menu" size={24} even /></span><span class="lbl">More</span><span class="chv"><Icon name="chev-down" size={14} stroke={1.6} /></span>
</button>
{#if open}
  <div bind:this={menu} id="more-{uid}" class="moremenu" class:side={compact} role="menu" aria-label="More" tabindex="-1" style={place} onkeydown={onMenuKey}>
    {#each items as it (it.label)}
      <button type="button" role="menuitem" class="mi" class:on={it.on} data-item={it.label} title={it.title} onclick={() => choose(it)}>
        {#if it.icon}<Icon name={it.icon} size={15} stroke={1.3} />{:else}<i class="tsd tone-{it.tone ?? 'off'}"></i>{/if}
        <span class="ml">{it.label}</span>
        {#if it.keys}<span class="k">{it.keys}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .chv { display: grid; place-items: center; margin-left: auto; color: var(--platinum-dim); transform: rotate(180deg); transition: transform var(--quick) var(--out); }
  .more.on .chv { transform: none; }
  /* Over the page, the list and a toast in the corner (60). Opening a sheet or the help closes it. */
  .moremenu {
    position: fixed; z-index: 61; width: 220px; padding: 4px 0; display: grid;
    background: var(--plate); border: 1px solid var(--rule-bright); box-shadow: 0 14px 34px rgb(0 0 0 / 60%), 0 0 0 1px rgb(0 0 0 / 40%);
    outline: none;
  }
  .mi {
    display: flex; align-items: center; gap: 11px; height: 34px; padding: 0 14px; width: 100%; text-align: left;
    border: 0; background: transparent; color: var(--platinum-dim);
    font-family: var(--face-text); font-size: 14px; font-weight: 400; letter-spacing: 0; text-transform: none;
  }
  .mi:hover:not(:disabled), .mi:focus-visible { background: rgb(255 255 255 / 5%); color: var(--platinum); }
  .mi:focus-visible { outline-offset: -2px; }
  .mi:active:not(:disabled) { transform: none; }
  .mi.on { color: var(--platinum); box-shadow: inset 2px 0 0 var(--platinum); }
  .ml { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .k { flex: none; font-family: var(--face-register); font-size: 11px; letter-spacing: .08em; color: var(--platinum-deep); }
  /* TennoScope's state: a diamond, filled when fine, red when it needs you. */
  .tsd { width: 8px; height: 8px; margin: 0 4px; flex: none; transform: rotate(45deg); box-shadow: inset 0 0 0 1px var(--platinum-dim); }
  .tsd.tone-ok { background: var(--platinum); box-shadow: none; }
  .tsd.tone-warn { box-shadow: inset 0 0 0 1px var(--oxblood); }
  .tsd.tone-bad { background: var(--oxblood); box-shadow: none; }
</style>
