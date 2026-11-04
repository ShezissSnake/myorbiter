<script lang="ts" module>
  export interface MenuChoice {
    id: string;
    label: string;
    /** A few words under the label: what it does. */
    note: string;
  }
</script>

<script lang="ts">
  // One small control on a plan line that opens its choices (Skip this time, Never sell): a menu
  // button, so a row carries one quiet ⋯ instead of two buttons. Keyboard: Enter, Space or ↓ opens
  // on the first choice, ↑ ↓ move, Home and End jump, Esc or Tab closes and the focus goes back.
  import { opens } from "../../motion";

  let { choices, label, onpick, open = $bindable(false) }: { choices: MenuChoice[]; label: string; onpick: (id: string) => void; open?: boolean } = $props();
  let button: HTMLButtonElement | undefined = $state();
  let menu: HTMLElement | undefined = $state();

  const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  function show(at: "first" | "last" = "first") {
    open = true;
    queueMicrotask(() => {
      const xs = items();
      (at === "first" ? xs[0] : xs.at(-1))?.focus();
    });
  }
  function close(refocus = true) {
    open = false;
    if (refocus) button?.focus();
  }
  function onButtonKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show(e.key === "ArrowUp" ? "last" : "first");
    }
  }
  function onMenuKey(e: KeyboardEvent) {
    const xs = items();
    const i = xs.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => xs[(n + xs.length) % xs.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(xs.length - 1);
    else if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") return close(false);
    else return;
    e.preventDefault();
  }
  // A click anywhere else closes it.
  $effect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!menu?.contains(e.target as Node) && !button?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  });
  function pick(id: string) {
    close();
    onpick(id);
  }
</script>

<span class="rowmenu">
  <button bind:this={button} type="button" class="ib quiet more" class:open aria-haspopup="menu" aria-expanded={open} aria-label="{label}: more" title="Leave it out of this plan, or never sell it" onclick={() => (open ? close() : show())} onkeydown={onButtonKey}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25" /><circle cx="8" cy="8" r="1.25" /><circle cx="12.5" cy="8" r="1.25" /></svg>
  </button>
  {#if open}
    <div bind:this={menu} class="menu" role="menu" tabindex="-1" aria-label={label} in:opens out:opens onkeydown={onMenuKey}>
      {#each choices as c (c.id)}
        <button type="button" role="menuitem" tabindex="-1" onclick={() => pick(c.id)}><span class="l">{c.label}</span><span class="nt">{c.note}</span></button>
      {/each}
    </div>
  {/if}
</span>

<style>
  .rowmenu { position: relative; display: inline-flex; }
  .more { --ib: 26px; }
  .more svg { width: 14px; height: 14px; fill: currentColor; }
  .more.open { color: var(--platinum); border-color: var(--rule-control); background: var(--raised); }
  .menu {
    position: absolute; z-index: 20; right: 0; top: calc(100% + 4px); min-width: 15.5rem; transform-origin: top right;
    display: grid; padding: .3rem; text-align: left; background: var(--slab); border: 1px solid var(--rule-control); box-shadow: 0 8px 22px rgb(0 0 0 / 50%);
  }
  .menu button { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: .1rem; padding: .45rem .6rem; }
  .menu button:hover, .menu button:focus-visible { background: var(--raised); box-shadow: inset 2px 0 0 var(--platinum); }
  .menu button:active { transform: translateY(1px); }
  .l { font-family: var(--face-register); font-size: .66rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--platinum); }
  .nt { font-size: .76rem; color: var(--platinum-deep); line-height: 1.4; }
</style>
