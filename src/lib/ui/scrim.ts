// Marks <html> with data-scrim while any dialog's or sheet's shade is open, for what must go behind
// it (the toasts). A `body:has(.scrim)` rule did the same, but a :has() on the body makes the browser
// re-check every table cell in the app whenever anything is added or moved anywhere (a list
// re-sorting), which made those redraws several times slower.
//   <div class="scrim" use:scrim …>
let open = 0;
function mark() {
  if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-scrim", open > 0);
}
export function scrim(_node: HTMLElement) {
  open++;
  mark();
  return {
    destroy() {
      open = Math.max(0, open - 1);
      mark();
    },
  };
}
