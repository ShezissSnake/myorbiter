// One piece of work a button started, as the button shows it: idle, working (how far along, when
// that's known), done (a short word for a moment), or failed (why). A button that is working keeps
// its look and ignores more clicks, so a double click can't start the work twice.

export type JobState = "idle" | "working" | "done" | "failed";

/**
 * A failure with a short word for the button ("2 failed") apart from the full reason, which goes
 * in the tooltip and the line under the button.
 */
export class JobError extends Error {
  constructor(
    public short: string,
    reason: string,
  ) {
    super(reason);
  }
}

/** How long "done" shows before the button goes back to its label. */
export const DONE_MS = 1800;
/** A failure stays longer: there's a reason to read. */
export const FAIL_MS = 8000;

export class Job {
  state = $state<JobState>("idle");
  /** Steps done of the steps there are; total null while it can't say. */
  done = $state(0);
  total = $state<number | null>(null);
  /** How far along as a share (0 to 1), for work measured in time rather than steps. Wins over done/total. */
  fraction = $state<number | null>(null);
  /** What it's doing now, in words ("Waiting for the new read"). */
  phase = $state<string | null>(null);
  /** The short word once done ("All match", "5 repriced"). */
  note = $state<string | null>(null);
  /** Why it failed, in full; `short` is the button's word for it. */
  error = $state<string | null>(null);
  short = $state<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private doneMs = DONE_MS,
    private failMs = FAIL_MS,
  ) {}

  get working() {
    return this.state === "working";
  }
  /** 0 to 1 while that's known; null for an indeterminate sweep. */
  get progress(): number | null {
    if (this.fraction != null) return clamp(this.fraction);
    return this.total ? clamp(this.done / this.total) : null;
  }

  step(done: number, total: number | null = this.total) {
    this.done = done;
    this.total = total;
  }

  /**
   * Runs `f` unless this job is already working (then nothing happens and it returns false).
   * What `f` returns is the done word; what it throws, the failure. True when it finished.
   * `null` from `f` means nothing ran (the store refused: busy, signed out): back to the label,
   * not a "Done" for work that never happened.
   */
  async run(f: (job: Job) => Promise<string | null | void>): Promise<boolean> {
    if (this.state === "working") return false;
    this.clearTimer();
    this.state = "working";
    this.done = 0;
    this.total = null;
    this.fraction = null;
    this.phase = null;
    this.note = null;
    this.error = null;
    this.short = null;
    try {
      const note = await f(this);
      if (note === null) {
        this.reset();
        return false;
      }
      this.finish(note ?? null);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  /** Done, from outside `run` (work the job only watches). */
  finish(note: string | null = null) {
    this.clearTimer();
    this.note = note;
    this.phase = null;
    this.state = "done";
    this.timer = setTimeout(() => this.reset(), this.doneMs);
  }

  fail(e: unknown) {
    this.clearTimer();
    this.error = clean(e);
    this.short = e instanceof JobError ? e.short : null;
    this.phase = null;
    this.state = "failed";
    this.timer = setTimeout(() => this.reset(), this.failMs);
  }

  /** Back to the button's label (a new run does this too). */
  reset() {
    this.clearTimer();
    this.state = "idle";
    this.fraction = null;
    this.phase = null;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** One job per key (a row's id), made the first time it's asked for. */
export class Jobs {
  private map = new Map<string, Job>();
  constructor(
    private doneMs = DONE_MS,
    private failMs = FAIL_MS,
  ) {}
  get(key: string): Job {
    let j = this.map.get(key);
    if (!j) {
      j = new Job(this.doneMs, this.failMs);
      this.map.set(key, j);
    }
    return j;
  }
  /** That key's job is working (false when it never ran). */
  busy(key: string): boolean {
    return this.map.get(key)?.working ?? false;
  }
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");
