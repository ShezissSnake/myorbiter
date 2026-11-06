// When a press takes away the control it was made on (Undo brings back what its slot stood for,
// Keep takes a row off a list), the keyboard focus falls to the top of the page once that control
// is gone, or turned inert while it leaves. `refocus` watches for that for a few frames and puts
// the focus on `to()` instead: the control that came back, or a neighbour, so the next Tab carries
// on from there. Only when the press's control had the focus (a key, or a click where a click
// focuses); a focus moved on meanwhile stays.

/** In the page and not leaving it (Svelte makes what's leaving inert), so it can take the focus. */
export function usable(el: Element | null | undefined): el is HTMLElement {
  return !!el && el.isConnected && !el.closest("[inert]");
}

/** Call before the change is made, with the control pressed. */
export function refocus(from: Element | null, to: () => HTMLElement | null | undefined, frames = 45) {
  if (!from || document.activeElement !== from) return;
  let n = 0;
  const look = () => {
    const at = document.activeElement;
    const fallen = !at || at === document.body || (at === from && !usable(from));
    if (fallen) {
      // What came back may be drawn a frame later: looked for again until it is.
      const el = to();
      if (usable(el)) return void el.focus({ preventScroll: true });
    } else if (at !== from) return;
    if (++n < frames) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** In `root`, the control named `name` (its aria-label or title), else its first control. */
export function named(root: Element | null | undefined, name: string | null): HTMLElement | null {
  if (!usable(root)) return null;
  const els = [...root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => usable(el) && !(el as HTMLButtonElement).disabled);
  return (name && els.find((el) => (el.getAttribute("aria-label") ?? el.getAttribute("title")) === name)) || els[0] || null;
}
