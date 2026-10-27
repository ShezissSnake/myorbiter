// Calls `more` while the element is within a screen of coming into view in its scrolling page:
// long lists render a first screenful at once and the rest as you scroll, so pages open instantly.
export function nearEnd(node: HTMLElement, more: () => void) {
  let cb = more;
  let gone = false;
  const root = node.closest<HTMLElement>(".page");
  const io = new IntersectionObserver(
    (entries) => {
      if (gone || !entries.some((e) => e.isIntersecting)) return;
      cb();
      // Still in view after the next batch rendered (a tall window): look again. Observing anew
      // reports the current state once, which loads the next batch if it's still needed.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (gone) return;
          io.unobserve(node);
          io.observe(node);
        }),
      );
    },
    { root, rootMargin: "0px 0px 900px 0px" },
  );
  io.observe(node);
  return {
    update(next: () => void) {
      cb = next;
    },
    destroy() {
      // A list that shrank (a filter) removes this marker between frames: never watch it again,
      // or the observer keeps the removed page section alive.
      gone = true;
      io.disconnect();
    },
  };
}
