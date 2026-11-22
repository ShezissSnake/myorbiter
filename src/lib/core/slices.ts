// Background work in short slices where the webview has no idle callback (WebKitGTK): pane.svelte.ts,
// `whenIdle`. Each piece of background work waits for a quiet moment on a timer of its own, and
// several timers falling due together run back to back in one task (WebKit fires every due timer in
// one go), so pages drawn ahead, lists filling in and pages catching up added up to one long stall.
// Here they share a frame's budget: a job starts only while less than `budget` ms have passed since
// the first job of this frame started; the rest go on after the next frame, in order.
//
// A job is never cut: one longer than the budget (a page's first draw) runs whole, and the next
// waits for the frame after it.

/** How long the background work of one frame may run before the rest waits for the next frame (ms). */
export const SLICE_BUDGET_MS = 12;

export interface SliceClock {
  now: () => number;
  /** Calls `f` once the next frame has been drawn (or a little later, where no frame comes). */
  afterFrame: (f: () => void) => void;
  /** Calls `f` in a later task. */
  task: (f: () => void) => void;
}

export class Slices {
  private queue: (() => void)[] = [];
  /** When the first job of this frame started; null: none has yet (no frame is awaited). */
  private start: number | null = null;
  /** A task is queued to run the next job. */
  private queued = false;
  /** A job is running now (one it starts waits for a task of its own). */
  private running = false;
  constructor(
    private clock: SliceClock,
    private budget = SLICE_BUDGET_MS,
  ) {}

  /** Runs `job` now if this frame's budget has room (and nothing waits before it), else later, in order. */
  run(job: () => void) {
    this.queue.push(job);
    if (!this.queued && !this.running) this.next();
  }

  /** Jobs not run yet. */
  get waiting() {
    return this.queue.length;
  }

  private next = () => {
    this.queued = false;
    if (!this.queue.length) return;
    const t = this.clock.now();
    // This frame's budget is spent: the rest once the next frame is drawn (that call is queued).
    if (this.start != null && t - this.start >= this.budget) return;
    if (this.start == null) {
      this.start = t;
      this.clock.afterFrame(() => {
        this.start = null;
        if (!this.queued && !this.running) this.next();
      });
    }
    const job = this.queue.shift()!;
    this.running = true;
    try {
      job();
    } finally {
      this.running = false;
      // A job that was waiting runs in a task of its own, so the drawing this one set off (Svelte's
      // flush, in this task's microtasks) is counted against the budget before it starts. (A job
      // that arrives with nothing waiting runs at once, in its caller's task: `run`.)
      if (this.queue.length) {
        this.queued = true;
        this.clock.task(this.next);
      }
    }
  };
}
