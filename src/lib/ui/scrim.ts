// Marks <html> with data-scrim while any dialog's or sheet's shade is open, for what must go behind
// it (the toasts). A `body:has(.scrim)` rule did the same, but a :has() on the body makes the browser
// re-check every table cell in the app whenever anything is added or moved anywhere (a list
// re-sorting), which made those redraws several times slower.
//
// Given a close, a click on the shade closes the dialog, but only when the press began on the shade
// too. A text selection dragged from a field and let go past the dialog's edge ends in a click on
// the shade (the common parent of where the press and the release were), and must not throw away
// what was typed.
//   <div class="scrim" use:scrim={close} …>
let open = 0;
function mark() {
  if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-scrim", open > 0);
}
export function scrim(node: HTMLElement, onclose?: () => void) {
  let close = onclose;
  /** Whether the last press began on the shade itself, not inside the dialog. */
  let pressedOnShade = false;
  const down = (e: Event) => {
    pressedOnShade = e.target === node;
  };
  const click = (e: Event) => {
    const both = pressedOnShade && e.target === node;
    pressedOnShade = false;
    if (both) close?.();
  };
  node.addEventListener("pointerdown", down);
  node.addEventListener("click", click);
  open++;
  mark();
  return {
    update(next?: () => void) {
      close = next;
    },
    destroy() {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("click", click);
      open = Math.max(0, open - 1);
      mark();
    },
  };
}
