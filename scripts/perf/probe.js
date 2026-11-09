// In-page timing for scripts/perf/run.mjs, injected before the app's own scripts. Exposes
// window.__perf.measure(code): runs `code` (an action such as a click) and reports, in ms from
// the action: when the handler returned, when the first frame after it was painted, when the
// first frame showing a DOM change was painted, and when the page settled (no DOM change and no
// request in flight for `quiet` ms); the longest gap in a setTimeout(0) heartbeat (a stand-in for
// the longest task: WebKit has no long-task observer); DOM mutations; requests; images loaded;
// and, in a PERF_COUNT=1 build, component mounts, effect runs and derived recomputations.
(() => {
  const P = (window.__perf = { marks: {} });
  const now = () => performance.now();

  // Requests: what's in flight, and when the last one ended.
  const pending = new Set();
  const POLLS = /\/dev-(reward-screens?|mission)\.json/;
  let lastFetch = 0;
  P.fetches = [];
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const rec = { url: String(input?.url ?? input), t0: now(), t1: null };
    P.fetches.push(rec);
    P.onFetch?.(rec);
    // The background polls (reward screen, mission: every 0.8 s) don't hold up "settled".
    const poll = POLLS.test(rec.url);
    if (!poll) pending.add(rec);
    const done = () => { rec.t1 = now(); if (!poll) lastFetch = rec.t1; pending.delete(rec); };
    let p = realFetch.call(this, input, init);
    // The demo's TennoScope says the game is running in Full mode, so Sync asks it for a read
    // that never comes. With `perf-sync=reload` (scenarios' syncReload) it reports the game as
    // not running: Sync then reloads the inventory file, a whole new model, as after a real read.
    if (/\/dev-tennoscope\.json/.test(rec.url) && localStorage.getItem("perf-sync") === "reload") {
      p = p.then(async (res) => {
        const j = await res.json();
        if (j?.report) j.report.game_running = false;
        return new Response(JSON.stringify(j), { status: res.status, headers: { "content-type": "application/json" } });
      });
    }
    p.then(done, done);
    return p;
  };

  // DOM changes.
  const mut = { records: 0, added: 0, removed: 0, attrs: 0, text: 0, imgsAdded: 0, last: 0, first: 0, pane: 0, paneFirst: 0, paneLast: 0 };
  const countImgs = (n) => (n.nodeType === 1 ? (n.tagName === "IMG" ? 1 : n.getElementsByTagName("img").length) : 0);
  // With layoutProbe on, style and layout are forced (and timed) right after each batch of DOM
  // changes, so what the next frame still spends is mostly paint.
  let layoutProbe = false;
  const lay = { n: 0, total: 0, max: 0 };
  new MutationObserver((recs) => {
    const t = now();
    if (layoutProbe) {
      document.documentElement.getBoundingClientRect();
      void document.documentElement.offsetHeight;
      const d = now() - t;
      lay.n++; lay.total += d; lay.max = Math.max(lay.max, d);
    }
    if (!mut.first) mut.first = t;
    if (!P.marks.rail && document.querySelector("button.nav")) { P.marks.rail = t; requestAnimationFrame(() => chan2((x) => (P.marks.railPaint = x))); }
    if (!P.marks.page && document.querySelector(".pane.shown h1, .pane.shown h2")) { P.marks.page = t; requestAnimationFrame(() => chan2((x) => (P.marks.pagePaint = x))); }
    mut.last = t;
    for (const r of recs) {
      mut.records++;
      // Changes on the page in sight (not the rail, a hidden page or a button's own state).
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el?.closest?.(".pane.shown") && !el.closest("button")) {
        if (!mut.paneFirst) mut.paneFirst = t;
        mut.paneLast = t;
        mut.pane++;
      }
      if (r.type === "childList") {
        mut.added += r.addedNodes.length;
        mut.removed += r.removedNodes.length;
        for (const n of r.addedNodes) mut.imgsAdded += countImgs(n);
      } else if (r.type === "attributes") mut.attrs++;
      else mut.text++;
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });

  // Frames: each animation frame's callback time and, through a message posted from it, the time
  // just after that frame was drawn.
  let frames = [];
  let framing = false;
  const chan = new MessageChannel();
  let lastRaf = 0;
  chan.port1.onmessage = () => frames.push({ raf: lastRaf, post: now() });
  const frame = (t) => {
    if (!framing) return;
    lastRaf = now();
    chan.port2.postMessage(0);
    requestAnimationFrame(frame);
  };

  // Heartbeat: gaps between setTimeout(0) callbacks (clamped to ≥4 ms by the browser).
  let beating = false;
  let lastBeat = 0;
  let gaps = [];
  const beat = () => {
    if (!beating) return;
    const t = now();
    if (t - lastBeat > 50) gaps.push({ at: lastBeat, ms: t - lastBeat });
    lastBeat = t;
    setTimeout(beat, 0);
  };

  // Images that finished loading while measuring.
  let imgRes = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.initiatorType === "img" || e.initiatorType === "css") imgRes.push(e.name); }).observe({ type: "resource", buffered: false });
  } catch {}

  const snapCounts = () => {
    const c = globalThis.__perfCounts;
    return c ? { mount: { ...c.mount }, effect: { ...c.effect }, derived: { ...c.derived } } : null;
  };
  const diffCounts = (a, b) => {
    if (!a || !b) return null;
    const out = {};
    for (const k of ["mount", "effect", "derived"]) {
      const d = {};
      let total = 0;
      for (const [n, v] of Object.entries(b[k])) {
        const x = v - (a[k][n] ?? 0);
        if (x) { d[n] = x; total += x; }
      }
      out[k] = { total, top: Object.entries(d).sort((p, q) => q[1] - p[1]).slice(0, 8) };
    }
    return out;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => chan2(r)));
  const chan2 = (r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(now()); c.port2.postMessage(0); };

  P.ready = () => !!document.querySelector("button.nav") && pending.size === 0;

  /** Runs `code` and measures it; see the header. */
  P.measure = async (code, { quiet = 500, max = 15000, probeLayout = false, waitFetch = null, waitMs = 45000 } = {}) => {
    layoutProbe = probeLayout;
    Object.assign(lay, { n: 0, total: 0, max: 0 });
    await nextFrame();
    frames = [];
    gaps = [];
    imgRes = [];
    Object.assign(mut, { records: 0, added: 0, removed: 0, attrs: 0, text: 0, imgsAdded: 0, last: 0, first: 0, pane: 0, paneFirst: 0, paneLast: 0 });
    const fetchesBefore = P.fetches.length;
    let c0 = snapCounts();
    framing = beating = true;
    lastBeat = now();
    requestAnimationFrame(frame);
    setTimeout(beat, 0);
    let t0 = now();
    let error = null;
    let waited = null;
    if (waitFetch) {
      // A store tick that comes by itself (a poll): measured from when its request goes out.
      const re = new RegExp(waitFetch);
      const rec = await new Promise((res) => {
        const tm = setTimeout(() => { P.onFetch = null; res(null); }, waitMs);
        P.onFetch = (r) => { if (re.test(r.url)) { clearTimeout(tm); P.onFetch = null; res(r); } };
      });
      if (!rec) error = `no request matching ${waitFetch} within ${waitMs} ms`;
      else {
        t0 = rec.t0;
        // Counted from the request, not from the wait before it. (A Timeline recording, if any,
        // still covers the wait: its JS samples aren't the tick's alone.)
        c0 = snapCounts();
        while (rec.t1 == null) await sleep(1);
        waited = { url: rec.url, requestMs: Math.round(rec.t1 - rec.t0) };
      }
      Object.assign(mut, { records: 0, added: 0, removed: 0, attrs: 0, text: 0, imgsAdded: 0, last: 0, first: 0, pane: 0, paneFirst: 0, paneLast: 0 });
      frames = frames.filter((f) => f.raf >= t0);
      gaps = gaps.filter((g) => g.at >= t0);
    } else {
      try {
        (0, eval)(code);
      } catch (e) {
        error = String(e);
      }
    }
    const tSync = now();
    for (let i = 0; i < 4; i++) await Promise.resolve();
    const tMicro = now();
    // Settle: no DOM change and nothing in flight for `quiet` ms.
    while (now() - t0 < max) {
      await sleep(50);
      const lastActivity = Math.max(mut.last, lastFetch, tMicro);
      if (pending.size === 0 && now() - lastActivity >= quiet) break;
    }
    framing = beating = false;
    layoutProbe = false;
    const timedOut = now() - t0 >= max;
    const after = (t) => frames.find((f) => f.raf >= t);
    const firstPaint = after(tMicro);
    const firstChange = mut.first ? after(mut.first) : null;
    const settledAt = mut.last ? after(mut.last) : firstPaint;
    const longest = gaps.reduce((m, g) => Math.max(m, g.ms), 0);
    const r = (x) => (x == null ? null : Math.round(x * 10) / 10);
    return {
      error,
      waited,
      timedOut,
      handlerMs: r(tSync - t0),
      microMs: r(tMicro - t0),
      firstPaintMs: r(firstPaint ? firstPaint.post - t0 : null),
      firstChangeMs: r(firstChange ? firstChange.post - t0 : null),
      settledMs: r(settledAt ? settledAt.post - t0 : null),
      lastMutationMs: r(mut.last ? mut.last - t0 : null),
      // The page in sight: the paint after its first and its last change.
      pageFirstMs: r(mut.paneFirst && after(mut.paneFirst) ? after(mut.paneFirst).post - t0 : null),
      pageLastMs: r(mut.paneLast && after(mut.paneLast) ? after(mut.paneLast).post - t0 : null),
      longestTaskMs: r(longest),
      tasksOver50: gaps.length,
      frames: frames.length,
      // Each frame: from its animation-frame callback to just after it was drawn (style, layout,
      // paint, composite, plus whatever task ran in between).
      frameMaxMs: r(frames.reduce((m, f) => Math.max(m, f.post - f.raf), 0)),
      frameSumMs: r(frames.reduce((m, f) => m + (f.post - f.raf), 0)),
      layout: probeLayout ? { forced: lay.n, totalMs: r(lay.total), maxMs: r(lay.max) } : undefined,
      mutations: { ...mut, first: undefined, last: undefined, paneFirst: undefined, paneLast: undefined },
      requests: P.fetches.slice(fetchesBefore).map((f) => `${f.url.replace(location.origin, "")} ${r((f.t1 ?? now()) - f.t0)}ms`),
      imagesLoaded: imgRes.length,
      counts: diffCounts(c0, snapCounts()),
    };
  };

  /** Waits until the page has settled (as in measure) and reports when, from navigation start. */
  P.settle = async ({ quiet = 1000, max = 30000 } = {}) => {
    const t0 = now();
    framing = true;
    frames = [];
    requestAnimationFrame(frame);
    while (now() - t0 < max) {
      await sleep(50);
      if (pending.size === 0 && now() - Math.max(mut.last, lastFetch) >= quiet) break;
    }
    framing = false;
    const f = frames.find((x) => x.raf >= mut.last);
    return { settledMs: Math.round(f ? f.post : now()), lastMutation: Math.round(mut.last), lastFetch: Math.round(lastFetch) };
  };

  P.counts = snapCounts;
  P.sleep = sleep;
  P.nextFrame = nextFrame;
})();
