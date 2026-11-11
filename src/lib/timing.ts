// Record timings (Settings › Logs; off unless switched on): where the app is slow on the player's
// own machine, with their own account, the game running or not. It reuses scripts/perf/probe.js's
// ways of measuring in WebKit, which has no long-task observer:
//
// - an action (a click or a key that changes what is shown, a page switch): ms from the event to
//   the next painted frame (a requestAnimationFrame, then a posted message, which runs just after
//   that frame is drawn), and to the paint after the last DOM change (settled: no change for
//   QUIET ms, at most CAP ms). Only the page's id and the kind of control are kept;
// - frames: the time between animation frames while the window is visible and focused, those over
//   50 ms and over 100 ms counted per minute, during an action and at rest apart;
// - stalls: a timer every BEAT ms that came more than 100 ms late, with the store tick that was
//   running (a sync, a market poll, the mission poll, the overlay's files);
// - backend commands: count, median and longest round trip, by command name;
// - start-up: process start to first paint, and to the first page settled.
//
// Never an item's, a player's or a file's name, a price or a balance: no text, label, title, value or
// id of any element is read, only its tag and role; keys are kept as a kind ("typing", "Enter").
// Nothing leaves the machine: a one-minute summary goes to the app's log, and the report to the
// clipboard and the log folder when the player asks for it. Off, every hook returns at once.
//
// The recorder times its own callbacks (`self` in the report), so its cost is in the report too.

/** A minute's summary line for the log (backend's logLine), set by the app. */
type Logger = (line: string) => void;

export interface TimingContext {
  /** The page shown (its id: "orders", "mastery"). */
  page: () => string;
  /** Sizes only: inventory entries, listings, pages mounted. */
  sizes: () => Record<string, number | null>;
  /** Whether the game runs, as TennoScope last said (null: unknown). */
  gameRunning: () => boolean | null;
  log: Logger;
}

/** What the backend says about where the report is taken (timing.rs); null in a browser. */
export interface TimingEnv {
  version: string;
  os: string;
  arch: string;
  engine: string | null;
  frames: string;
  gpu: string | null;
  processStart: number | null;
  runStart: number | null;
}

const QUIET = 300;
const CAP = 3000;
/** No DOM change this long after a click: it changed nothing shown, and isn't kept. */
const NO_CHANGE = 1000;
const BEAT = 25;
const STALL = 100;
/** A timer this late is a suspend or a throttled hidden window, not a stall. */
const ASLEEP = 30_000;
/** A gap between frames this long is a window that wasn't drawn (covered, minimised), not a frame. */
const NOT_DRAWN = 2000;
const ACTIONS_KEPT = 500;
const SLOWEST_KEPT = 20;
const STALLS_KEPT = 300;
const SAMPLES_KEPT = 200;

export interface Action {
  /** ms since the recorder was switched on. */
  at: number;
  /** "click", "key: typing", "page switch". */
  how: string;
  /** The page shown when it started, and after (a switch). */
  page: string;
  to: string | null;
  /** The kind of control and where it is: "button in sidebar". */
  control: string;
  paint: number;
  settled: number;
  capped: boolean;
  /** The longest stall while it ran (0: none over STALL). */
  stall: number;
  ticks: string[];
}
interface Stall {
  at: number;
  ms: number;
  ticks: string[];
  focused: boolean;
  inAction: boolean;
}
interface Minute {
  frames: number;
  actionOver50: number;
  actionOver100: number;
  restOver50: number;
  restOver100: number;
  notDrawn: number;
}
class Samples {
  n = 0;
  fails = 0;
  max = 0;
  ring: number[] = [];
  add(ms: number) {
    this.n++;
    if (ms > this.max) this.max = ms;
    if (this.ring.length < SAMPLES_KEPT) this.ring.push(ms);
    else this.ring[this.n % SAMPLES_KEPT] = ms;
  }
  median() {
    return median(this.ring);
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const now = () => performance.now();
const r = (x: number) => Math.round(x);

/** The kind of a control, from its tag and role only. */
const ROLES = new Set(["button", "switch", "checkbox", "radio", "tab", "menuitem", "option", "link", "slider", "combobox", "row", "gridcell", "treeitem"]);
const INPUTS: Record<string, string> = { checkbox: "checkbox", radio: "radio", range: "slider", number: "number field", search: "search field", text: "text field", "": "text field" };
/** Panels whose title is a fixed word, never an item's name. */
const PANELS = new Set(["Settings", "Notifications", "TennoScope"]);
export function controlOf(target: EventTarget | null): string {
  const el = target instanceof Element ? target : null;
  const c = el?.closest("button, a, input, select, textarea, summary, [role], [tabindex]") ?? null;
  let kind = "page";
  if (c) {
    const role = c.getAttribute("role");
    const tag = c.tagName.toLowerCase();
    if (role && ROLES.has(role)) kind = role;
    else if (tag === "button" || tag === "summary") kind = tag === "summary" ? "fold" : "button";
    else if (tag === "a") kind = "link";
    else if (tag === "select") kind = "list";
    else if (tag === "textarea") kind = "text field";
    else if (tag === "input") kind = INPUTS[(c.getAttribute("type") ?? "").toLowerCase()] ?? "field";
    else kind = "control";
  }
  const at = el ?? c;
  let where = "";
  if (at?.closest(".rail")) where = "sidebar";
  else if (at) {
    const sheet = at.closest(".sheet");
    if (sheet) {
      const t = sheet.getAttribute("aria-label") ?? "";
      where = PANELS.has(t) ? `${t} panel` : "panel";
    } else if (at.closest("[role=dialog], dialog")) where = "dialog";
    else if (at.closest("thead")) where = "table header";
    else if (at.closest("tr, [role=row]")) where = "table row";
  }
  return where ? `${kind} in ${where}` : kind;
}

/** A key as a kind: never the character typed (a digit in a price field is the price). */
export function keyKind(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): string {
  if (e.ctrlKey || e.metaKey || e.altKey) return "shortcut";
  const k = e.key;
  if (k === "Enter" || k === "Escape" || k === "Tab") return k;
  if (k === " ") return "Space";
  if (k.startsWith("Arrow") || k === "PageUp" || k === "PageDown" || k === "Home" || k === "End") return "navigation";
  if (k === "Backspace" || k === "Delete") return "erase";
  if (/^F\d{1,2}$/.test(k)) return k;
  if (k.length === 1) return "typing";
  return "other";
}

export class Recorder {
  on = false;
  private ctx: TimingContext | null = null;
  private since = 0;
  private sinceWall = 0;
  private fromStart = false;
  // Start-up marks (performance.now()), kept even while off: three numbers.
  private firstFrame: number | null = null;
  private modelShown: number | null = null;
  private startPage = "";
  private startSettled: number | null = null;
  private startCapped = false;

  private actions: Action[] = [];
  private slowest: Action[] = [];
  private byKind = new Map<string, Samples & { paints: number[] }>();
  private stalls: Stall[] = [];
  private stallCount = 0;
  private minutes = new Map<number, Minute>();
  private commands = new Map<string, Samples>();
  private own = new Map<string, Samples>();
  private selfMax = 0;
  private selfTotal = 0;
  private ticks = new Map<string, number>();
  /** Ticks that ended lately, for a stall noticed after its tick was over: [name, start, end]. */
  private ended: [string, number, number][] = [];

  // The action being timed, if one is.
  private open: { t0: number; how: string; page: string; control: string; paint: number | null; firstChange: number | null; lastChange: number; ticks: Set<string>; stall: number; pageEvent: boolean } | null = null;
  private observer: MutationObserver | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private beatTimer: ReturnType<typeof setTimeout> | undefined;
  private lastBeat = 0;
  private raf = 0;
  private lastFrame = 0;
  private minuteTimer: ReturnType<typeof setInterval> | undefined;
  private lastSummary = { actions: 0, stalls: 0, frames: { a50: 0, a100: 0, r50: 0, r100: 0 } };
  private startWatch: { quietSince: number; t0: number } | null = null;

  /** At start, before anything else draws: marks the first frame (one callback, recorder on or off). */
  noteStart() {
    if (typeof requestAnimationFrame !== "function" || this.firstFrame != null) return;
    requestAnimationFrame(() => postAfter(() => (this.firstFrame ??= now())));
  }

  /** The first page's data is in and drawn: start-up's last stage is that page settling. */
  noteModelShown(page: string) {
    if (this.modelShown != null) return;
    this.modelShown = now();
    this.startPage = page;
    if (this.on) this.watchStart();
  }

  /** Switched on (Settings, or at start with the setting saved on). */
  enable(ctx: TimingContext) {
    this.ctx = ctx;
    if (this.on || typeof window === "undefined") return;
    this.on = true;
    this.since = now();
    this.sinceWall = Date.now();
    this.fromStart = this.modelShown == null;
    this.reset();
    window.addEventListener("click", this.onClick, { capture: true, passive: true });
    window.addEventListener("keydown", this.onKey, { capture: true, passive: true });
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("focus", this.onVisible);
    this.lastBeat = now();
    this.beatTimer = setTimeout(this.beat, BEAT);
    this.startFrames();
    this.minuteTimer = setInterval(this.summary, 60_000);
    if (this.modelShown != null && this.startSettled == null && this.fromStart) this.watchStart();
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    window.removeEventListener("click", this.onClick, { capture: true });
    window.removeEventListener("keydown", this.onKey, { capture: true });
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("focus", this.onVisible);
    clearTimeout(this.beatTimer);
    clearTimeout(this.settleTimer);
    clearInterval(this.minuteTimer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.observer?.disconnect();
    this.observer = null;
    this.open = null;
    this.startWatch = null;
  }

  private reset() {
    this.actions = [];
    this.slowest = [];
    this.byKind.clear();
    this.stalls = [];
    this.stallCount = 0;
    this.minutes.clear();
    this.commands.clear();
    this.own.clear();
    this.selfMax = this.selfTotal = 0;
    this.lastSummary = { actions: 0, stalls: 0, frames: { a50: 0, a100: 0, r50: 0, r100: 0 } };
  }

  /** Times the recorder's own work. */
  private self<T>(f: () => T): T {
    const t = now();
    try {
      return f();
    } finally {
      const d = now() - t;
      this.selfTotal += d;
      if (d > this.selfMax) this.selfMax = d;
    }
  }

  /**
   * A store tick (a sync, a market poll, the mission poll, the overlay's files): named while it
   * runs, so a stall can say what was running. Off, it only calls `f`.
   */
  tick<T>(name: string, f: () => T): T {
    if (!this.on) return f();
    const t0 = now();
    this.ticks.set(name, (this.ticks.get(name) ?? 0) + 1);
    if (this.open) this.open.ticks.add(name);
    const end = () => {
      const n = (this.ticks.get(name) ?? 1) - 1;
      if (n <= 0) this.ticks.delete(name);
      else this.ticks.set(name, n);
      this.ended.push([name, t0, now()]);
      if (this.ended.length > 50) this.ended.splice(0, this.ended.length - 50);
    };
    let out: T;
    try {
      out = f();
    } catch (e) {
      end();
      throw e;
    }
    if (out instanceof Promise) return out.finally(end) as T;
    end();
    return out;
  }

  /** A backend command's round trip (backend.ts's invoke). */
  command(name: string, ms: number, ok: boolean, own: boolean) {
    if (!this.on) return;
    this.self(() => {
      const map = own ? this.own : this.commands;
      let s = map.get(name);
      if (!s) map.set(name, (s = new Samples()));
      s.add(ms);
      if (!ok) s.fails++;
    });
  }

  /** The page shown changed: a switch with no click before it (a link, a shortcut, a notice) is an action of its own. */
  pageChanged() {
    if (!this.on || !this.ctx) return;
    this.self(() => {
      if (this.open) this.open.pageEvent = true;
      else this.begin(now(), "page switch", "page", this.ctx!.page());
    });
  }

  private onClick = (e: MouseEvent) => this.self(() => this.begin(now(), "click", controlOf(e.target)));
  private onKey = (e: KeyboardEvent) => {
    // A modifier on its own changes nothing.
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    this.self(() => this.begin(now(), `key: ${keyKind(e)}`, controlOf(e.target)));
  };
  private onVisible = () => this.self(() => {
    this.lastBeat = now();
    this.lastFrame = 0;
    this.startFrames();
  });

  private begin(t0: number, how: string, control: string, page?: string) {
    if (!this.ctx) return;
    if (this.open) this.finish(t0, true);
    const page0 = page ?? this.ctx.page();
    const a = (this.open = { t0, how, page: page0, control, paint: null as number | null, firstChange: null as number | null, lastChange: 0, ticks: new Set(this.ticks.keys()), stall: 0, pageEvent: how === "page switch" });
    // The next frame after the handlers ran.
    requestAnimationFrame(() => postAfter(() => {
      if (this.open === a && a.paint == null) a.paint = now();
    }));
    this.observe();
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(this.settle, 100);
  }

  /** DOM changes, only while an action or the start-up is being timed: when, not what. */
  private observe() {
    if (this.observer) return;
    this.observer = new MutationObserver((recs) => this.self(() => {
      // A batch wholly inside a hidden page (the background warm-up, a hidden page catching up)
      // isn't what's shown. Only its first and last records are looked at: a sync brings 1500.
      if (hidden(recs[0]) && hidden(recs[recs.length - 1])) return;
      const t = now();
      if (this.open) {
        this.open.firstChange ??= t;
        this.open.lastChange = t;
      }
      if (this.startWatch) this.startWatch.quietSince = t;
    }));
    this.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  private unobserve() {
    if (this.open || this.startWatch) return;
    this.observer?.disconnect();
    this.observer = null;
  }

  private settle = () => this.self(() => {
    const a = this.open;
    if (!a) return;
    const t = now();
    const changed = a.firstChange != null || (this.ctx && this.ctx.page() !== a.page);
    if (!changed && t - a.t0 >= NO_CHANGE) {
      this.open = null;
      this.unobserve();
      return;
    }
    if (changed && a.paint != null && t - Math.max(a.lastChange, a.t0) >= QUIET) return this.finish(t, false);
    if (t - a.t0 >= CAP) return this.finish(t, false, true);
    this.settleTimer = setTimeout(this.settle, 100);
  });

  /** Ends the open action: settled at the paint after its last change (now, if cut short by another). */
  private finish(t: number, cut: boolean, capped = false) {
    const a = this.open;
    if (!a || !this.ctx) return;
    this.open = null;
    clearTimeout(this.settleTimer);
    const to = this.ctx.page();
    const changed = a.firstChange != null || to !== a.page;
    this.unobserve();
    if (!changed) return;
    const store = (settledAt: number) => {
      const switched = to !== a.page;
      const rec: Action = {
        at: a.t0 - this.since,
        how: switched && a.how !== "page switch" ? `page switch (${a.how})` : a.how,
        page: a.page,
        to: switched ? to : null,
        control: a.control,
        paint: (a.paint ?? settledAt) - a.t0,
        settled: settledAt - a.t0,
        capped: capped || cut,
        stall: a.stall,
        ticks: [...a.ticks],
      };
      this.self(() => this.keep(rec));
    };
    if (cut || capped || typeof requestAnimationFrame !== "function") store(t);
    else requestAnimationFrame(() => postAfter(() => store(now())));
  }

  private keep(a: Action) {
    this.actions.push(a);
    if (this.actions.length > ACTIONS_KEPT) this.actions.splice(0, this.actions.length - ACTIONS_KEPT);
    this.slowest.push(a);
    this.slowest.sort((x, y) => y.settled - x.settled);
    if (this.slowest.length > SLOWEST_KEPT) this.slowest.length = SLOWEST_KEPT;
    const key = actionKey(a);
    let s = this.byKind.get(key);
    if (!s) this.byKind.set(key, (s = Object.assign(new Samples(), { paints: [] as number[] })));
    s.add(a.settled);
    if (s.paints.length < SAMPLES_KEPT) s.paints.push(a.paint);
    else s.paints[s.n % SAMPLES_KEPT] = a.paint;
  }

  /** The first page after start: settled once nothing on it changed for a second (at most 20 s). */
  private watchStart() {
    if (this.startWatch || this.startSettled != null) return;
    const t0 = this.modelShown ?? now();
    this.startWatch = { quietSince: now(), t0 };
    this.observe();
    const check = () => this.self(() => {
      const w = this.startWatch;
      if (!w || !this.on) return;
      const t = now();
      if (t - w.quietSince >= 1000 || t - w.t0 >= 20_000) {
        this.startCapped = t - w.t0 >= 20_000;
        const last = w.quietSince;
        this.startWatch = null;
        this.unobserve();
        // The paint after the last change.
        if (this.startCapped) this.startSettled = t;
        else requestAnimationFrame(() => postAfter(() => (this.startSettled = Math.max(last, now()))));
        return;
      }
      setTimeout(check, 200);
    });
    setTimeout(check, 200);
  }

  private visible() {
    return document.visibilityState === "visible";
  }
  private focused() {
    return this.visible() && document.hasFocus();
  }

  /** The heartbeat: a timer every BEAT ms; one that comes more than STALL ms late was held up. */
  private beat = () => {
    if (!this.on) return;
    this.self(() => {
      const t = now();
      const late = t - this.lastBeat - BEAT;
      if (late > STALL && late < ASLEEP && this.visible()) {
        const from = this.lastBeat;
        const names = new Set(this.ticks.keys());
        for (const [n, s, e] of this.ended) if (e >= from && s <= t) names.add(n);
        if (this.open) this.open.stall = Math.max(this.open.stall, late);
        this.stallCount++;
        const st: Stall = { at: from - this.since, ms: late, ticks: [...names], focused: this.focused(), inAction: !!this.open };
        this.stalls.push(st);
        if (this.stalls.length > STALLS_KEPT) {
          // Keep the longest.
          this.stalls.sort((x, y) => y.ms - x.ms);
          this.stalls.length = STALLS_KEPT;
        }
      }
      this.lastBeat = t;
      this.beatTimer = setTimeout(this.beat, BEAT);
    });
  };

  /** Frames, while the window is visible and focused (a covered window gets no frames on Wayland). */
  private startFrames() {
    if (!this.on || this.raf || typeof requestAnimationFrame !== "function") return;
    this.lastFrame = 0;
    this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (ts: number) => {
    this.raf = 0;
    if (!this.on) return;
    this.self(() => {
      if (!this.focused()) {
        // Paused until the window is shown or focused again (onVisible starts it).
        this.lastFrame = 0;
        if (this.visible()) this.raf = requestAnimationFrame(this.frame);
        return;
      }
      if (this.lastFrame) {
        const d = ts - this.lastFrame;
        const m = this.minute(now());
        if (d >= NOT_DRAWN) m.notDrawn++;
        else {
          m.frames++;
          const act = !!this.open;
          if (d > 50) act ? m.actionOver50++ : m.restOver50++;
          if (d > 100) act ? m.actionOver100++ : m.restOver100++;
        }
      }
      this.lastFrame = ts;
      this.raf = requestAnimationFrame(this.frame);
    });
  };
  private minute(t: number): Minute {
    const i = Math.floor((t - this.since) / 60_000);
    let m = this.minutes.get(i);
    if (!m) {
      this.minutes.set(i, (m = { frames: 0, actionOver50: 0, actionOver100: 0, restOver50: 0, restOver100: 0, notDrawn: 0 }));
      // At most ten hours of minutes.
      if (this.minutes.size > 600) this.minutes.delete(Math.min(...this.minutes.keys()));
    }
    return m;
  }

  /** Each minute, one line in the log: what changed since the last. */
  private summary = () => this.self(() => {
    if (!this.on || !this.ctx) return;
    const f = this.frameTotals();
    const last = this.lastSummary;
    const acts = this.actions.slice(Math.max(0, this.actions.length - (this.actionCount - last.actions)));
    const worst = acts.reduce<Action | null>((w, a) => (!w || a.settled > w.settled ? a : w), null);
    const newStalls = this.stallCount - last.stalls;
    const recent = this.stalls.filter((s) => s.at >= now() - this.since - 60_000);
    const longest = recent.reduce<Stall | null>((w, s) => (!w || s.ms > w.ms ? s : w), null);
    const cmds = [...this.commands.entries()].sort((a, b) => b[1].max - a[1].max).slice(0, 3).map(([n, s]) => `${n} ${r(s.max)}`).join(", ");
    const parts = [
      `actions ${acts.length}${acts.length ? ` (paint median ${r(median(acts.map((a) => a.paint)))} ms, settled median ${r(median(acts.map((a) => a.settled)))} ms${worst ? `, slowest ${actionKey(worst)} ${r(worst.settled)} ms` : ""})` : ""}`,
      `frames over 50/100 ms: in actions ${f.a50 - last.frames.a50}/${f.a100 - last.frames.a100}, at rest ${f.r50 - last.frames.r50}/${f.r100 - last.frames.r100}`,
      `stalls ${newStalls}${longest ? ` (longest ${r(longest.ms)} ms${longest.ticks.length ? ` during ${longest.ticks.join(" + ")}` : ""})` : ""}`,
      cmds ? `slowest commands so far ${cmds} ms` : "",
      `recorder's longest callback ${this.selfMax.toFixed(1)} ms`,
    ].filter(Boolean);
    this.lastSummary = { actions: this.actionCount, stalls: this.stallCount, frames: f };
    this.ctx.log(`timings, last minute: ${parts.join("; ")}`);
  });
  private get actionCount() {
    let n = 0;
    for (const s of this.byKind.values()) n += s.n;
    return n;
  }
  private frameTotals() {
    const f = { a50: 0, a100: 0, r50: 0, r100: 0, frames: 0, notDrawn: 0 };
    for (const m of this.minutes.values()) {
      f.a50 += m.actionOver50;
      f.a100 += m.actionOver100;
      f.r50 += m.restOver50;
      f.r100 += m.restOver100;
      f.frames += m.frames;
      f.notDrawn += m.notDrawn;
    }
    return f;
  }

  /** The plain-text report: numbers, the system, sizes. Never a name, a price or a path. */
  report(env: TimingEnv | null, extra: { window: string; scale: number }): string {
    return this.self(() => buildReport(this, env, extra));
  }

  /** What the report is built from (for buildReport and the tests). */
  data() {
    const ctx = this.ctx;
    return {
      on: this.on,
      sinceWall: this.sinceWall,
      lasted: this.on ? now() - this.since : 0,
      fromStart: this.fromStart,
      start: {
        firstFrame: this.firstFrame,
        modelShown: this.modelShown,
        settled: this.startSettled,
        capped: this.startCapped,
        page: this.startPage,
      },
      actions: this.actions,
      actionCount: this.actionCount,
      slowest: this.slowest,
      byKind: [...this.byKind.entries()].map(([k, s]) => ({ key: k, n: s.n, paint: median(s.paints), settled: s.median(), max: s.max })),
      stalls: this.stalls,
      stallCount: this.stallCount,
      minutes: [...this.minutes.entries()].sort((a, b) => a[0] - b[0]),
      frames: this.frameTotals(),
      commands: [...this.commands.entries()].map(([n, s]) => ({ name: n, n: s.n, fails: s.fails, median: s.median(), max: s.max })),
      own: [...this.own.entries()].map(([n, s]) => ({ name: n, n: s.n, median: s.median(), max: s.max })),
      self: { max: this.selfMax, total: this.selfTotal },
      sizes: ctx?.sizes() ?? {},
      gameRunning: ctx?.gameRunning() ?? null,
    };
  }
}

/** Posts a message from inside an animation frame: it runs just after that frame was drawn. */
function postAfter(f: () => void) {
  const c = new MessageChannel();
  c.port1.onmessage = () => f();
  c.port2.postMessage(0);
}

function hidden(rec: MutationRecord | undefined): boolean {
  const n = rec?.target;
  const el = n instanceof Element ? n : (n?.parentElement ?? null);
  const pane = el?.closest(".pane");
  return !!pane && !pane.classList.contains("shown");
}

const actionKey = (a: Action) => (a.to ? `${a.page} → ${a.to} · ${a.control}` : `${a.page} · ${a.how} · ${a.control}`);

const pad = (s: string | number, n: number) => String(s).padStart(n);
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function buildReport(rec: Recorder, env: TimingEnv | null, extra: { window: string; scale: number }): string {
  const d = rec.data();
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  line("MyOrbiter timing report");
  line(`Recorded from ${utc(d.sinceWall)} for ${clock(d.lasted)} (min:s)${d.fromStart ? ", on since the app started" : ", switched on after the app started"}.`);
  line(`Version ${env?.version ?? "browser build"} · ${env?.os ?? "unknown system"} ${env?.arch ?? ""} · ${env?.engine ?? engineFromAgent()}`.replace(/\s+·/g, " ·"));
  line(`Frames handed over: ${env?.frames ?? "the browser's own"} · graphics: ${env?.gpu ?? "unknown"}`);
  line(`Window ${extra.window} at scale ${extra.scale} · game running: ${d.gameRunning == null ? "unknown" : d.gameRunning ? "yes" : "no"}`);
  const sizes = Object.entries(d.sizes).map(([k, v]) => `${v ?? "?"} ${k}`).join(", ");
  if (sizes) line(`Sizes: ${sizes}`);
  line();

  line("Start-up (ms)");
  const st = d.start;
  const origin = performance.timeOrigin;
  const proc = env?.processStart ?? env?.runStart ?? null;
  const fromProc = (t: number | null) => (t == null || proc == null || !origin ? null : r(origin + t - proc));
  if (proc == null) line("  process start: not known here (the desktop app gives it)");
  const ff = fromProc(st.firstFrame);
  line(`  first paint: ${ff ?? "–"} from process start${st.firstFrame != null ? ` (${r(st.firstFrame)} after the page began loading)` : ""}`);
  if (st.modelShown != null) line(`  data in and drawn on ${st.page || "the first page"}: ${fromProc(st.modelShown) ?? "–"} from process start (${r(st.modelShown)} after the page began loading)`);
  if (st.settled != null) line(`  ${st.page || "first page"} settled${st.capped ? " (still changing at 20 s)" : ""}: ${fromProc(st.settled) ?? "–"} from process start (${r(st.settled)} after the page began loading)`);
  else line(`  first page settled: ${d.fromStart ? "not yet" : "not recorded (switched on after start; on at the next start, it is)"}`);
  line();

  line(`Slowest ${Math.min(10, d.slowest.length)} actions (of ${d.actionCount}): ms to the next paint / to settled`);
  if (!d.slowest.length) line("  none yet");
  d.slowest.slice(0, 10).forEach((a, i) => {
    const what = a.to ? `${a.page} → ${a.to}, ${a.how}, ${a.control}` : `${a.page}: ${a.how}, ${a.control}`;
    line(`  ${pad(i + 1, 2)}. ${pad(r(a.paint), 5)} / ${pad(r(a.settled), 5)}${a.capped ? "+" : " "} ${what}${a.stall ? ` · stall ${r(a.stall)}` : ""}${a.ticks.length ? ` · during ${a.ticks.join(" + ")}` : ""} · at ${clock(a.at)}`);
  });
  line("  (+: still changing when cut off, at 3 s or by the next action)");
  line();

  line("Actions by kind: count, median paint, median settled, longest settled (ms)");
  const kinds = [...d.byKind].sort((a, b) => b.max - a.max).slice(0, 40);
  for (const k of kinds) line(`  ${pad(k.n, 4)} ${pad(r(k.paint), 5)} ${pad(r(k.settled), 6)} ${pad(r(k.max), 6)}  ${k.key}`);
  if (d.byKind.length > kinds.length) line(`  … ${d.byKind.length - kinds.length} more kinds`);
  line();

  const f = d.frames;
  line("Frames over 50 ms / over 100 ms (window visible and focused)");
  line(`  in actions: ${f.a50} / ${f.a100} · at rest: ${f.r50} / ${f.r100} · of ${f.frames} frames${f.notDrawn ? ` · ${f.notDrawn} gaps over 2 s not counted (window not drawn)` : ""}`);
  line("  minute  frames  action>50 action>100  rest>50 rest>100");
  const mins = d.minutes.slice(-60);
  if (d.minutes.length > mins.length) line(`  (the last 60 of ${d.minutes.length} minutes)`);
  for (const [i, m] of mins) line(`  ${pad(i + 1, 6)} ${pad(m.frames, 7)} ${pad(m.actionOver50, 10)} ${pad(m.actionOver100, 10)} ${pad(m.restOver50, 8)} ${pad(m.restOver100, 8)}`);
  line();

  line(`Stalls over ${STALL} ms on the main thread: ${d.stallCount}${d.stallCount ? `, longest ${r(Math.max(...d.stalls.map((s) => s.ms)))} ms` : ""}`);
  const byTick = new Map<string, { n: number; ms: number }>();
  for (const s of d.stalls) {
    const k = s.ticks.length ? s.ticks.join(" + ") : "no store tick";
    const e = byTick.get(k) ?? { n: 0, ms: 0 };
    e.n++;
    e.ms = Math.max(e.ms, s.ms);
    byTick.set(k, e);
  }
  for (const [k, e] of [...byTick].sort((a, b) => b[1].n - a[1].n)) line(`  ${pad(e.n, 4)} × during ${k} (longest ${r(e.ms)} ms)`);
  const top = [...d.stalls].sort((a, b) => b.ms - a.ms).slice(0, 20);
  if (top.length) line("  longest:");
  for (const s of top) line(`  ${pad(r(s.ms), 6)} ms at ${clock(s.at)}${s.ticks.length ? ` during ${s.ticks.join(" + ")}` : ""}${s.inAction ? " · in an action" : ""}${s.focused ? "" : " · window not focused"}`);
  line();

  line("Backend commands: count, failed, median, longest round trip (ms)");
  const cmds = [...d.commands].sort((a, b) => b.max - a.max);
  if (!cmds.length) line(env ? "  none yet" : "  none: only the desktop app has them");
  for (const c of cmds) line(`  ${pad(c.n, 6)} ${pad(c.fails, 4)} ${pad(c.median.toFixed(1), 7)} ${pad(r(c.max), 6)}  ${c.name}`);
  line();

  line("The recorder itself");
  line(`  longest callback ${d.self.max.toFixed(2)} ms, ${r(d.self.total)} ms in all over ${clock(d.lasted)}`);
  for (const c of d.own) line(`  ${c.name}: ${c.n} × (median ${c.median.toFixed(1)}, longest ${r(c.max)} ms)`);
  return out.join("\n") + "\n";
}

/** In a browser: the engine as its user agent names it (the desktop app asks WebKitGTK itself). */
function engineFromAgent(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const m = /(Edg|Chrome|Firefox|Version)\/([\d.]+)/.exec(ua);
  const wk = /AppleWebKit\/([\d.]+)/.exec(ua);
  return m ? `${m[1] === "Version" ? "WebKit" : m[1]} ${m[2]}` : wk ? `AppleWebKit ${wk[1]}` : "unknown engine";
}


export const timing = new Recorder();
