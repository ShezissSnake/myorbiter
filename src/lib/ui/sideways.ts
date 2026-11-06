/** Whether a table `table` px wide runs past a box `room` px wide (a part of a pixel isn't overflow). */
export const widerThan = (table: number, room: number) => table - room >= 1;

/**
 * Tells `set` whether the table inside a box is wider than the box, so the box scrolls sideways
 * only then (Table.svelte). A box that scrolls is the one a sticky header sticks to: one
 * that always scrolled would leave the header behind as the page scrolls. Measured, not by the
 * window's width: a table's width follows its rows, its columns and the room the page has, and the
 * box's own size doesn't change when only the table grows (a row drawn, a column shown), so both are
 * watched.
 */
export function sideways(node: HTMLElement, set: (wide: boolean) => void) {
  const table = node.querySelector("table");
  if (!table || typeof ResizeObserver === "undefined") return;
  let frame = 0;
  let was: boolean | null = null;
  const check = () => {
    frame = 0;
    const wide = widerThan(table.offsetWidth, node.clientWidth);
    if (wide !== was) set((was = wide));
  };
  // A frame later: the scroll bar `set` brings changes the box's height, which reported in the
  // same round would be a ResizeObserver loop. (Observing reports both sizes once to begin with.)
  const ro = new ResizeObserver(() => (frame ||= requestAnimationFrame(check)));
  ro.observe(node);
  ro.observe(table);
  return {
    destroy: () => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
