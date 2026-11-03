// A choice answers on the frame it's made; what it changes follows a frame later. A control (a
// segmented choice, a row of tabs) draws its new state at once, and hands the value to the page
// once that frame is on screen: a page that redraws a long list doesn't hold up the press itself.

/**
 * Runs `f` once the next frame has been drawn (that frame, then a task). Where frames don't come (a
 * hidden window), a moment later anyway. Returns a cancel.
 */
export function afterPaint(f: () => void): () => void {
  let done = false;
  let t: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (done) return;
    done = true;
    clearTimeout(t);
    f();
  };
  if (typeof requestAnimationFrame !== "function") {
    t = setTimeout(run, 0);
    return () => ((done = true), clearTimeout(t));
  }
  const raf = requestAnimationFrame(() => setTimeout(run, 0));
  // No frame within 100 ms (the window hidden or minimised): don't wait for one.
  t = setTimeout(run, 100);
  return () => {
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(t);
  };
}
