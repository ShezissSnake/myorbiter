// What scripts/perf/run.mjs measures. Each scenario gets a fresh page on `tab`: settled (the
// background warm-up of every page done) or, with `early: true`, just after the first page drew.
// It returns its measurements; the page side is window.__perf (probe.js).

const J = JSON.stringify;
/** Opens Settings by its one name in the sidebar's foot (`data-item`): the full sidebar's button, or the item in the folded sidebar's More menu once it is open. */
const OPEN_SETTINGS = `document.querySelector(":is(.rail .foot, .moremenu) [data-item='Settings']").click()`;
/** Clicks the rail button labelled `label`. */
const nav = (label) => `[...document.querySelectorAll('button.nav')].find(b => (b.querySelector('.lbl')?.textContent ?? '').trim() === ${J(label)}).click()`;
const railLabels = `[...document.querySelectorAll('button.nav')].map(b => (b.querySelector('.lbl')?.textContent ?? '').trim()).filter(Boolean)`;
/** Clicks the first button on the shown page whose text starts with `text`. */
const clickText = (text, root = ".pane.shown") =>
  `[...document.querySelectorAll(${J(`${root} button`)})].find(b => b.textContent.trim().startsWith(${J(text)})).click()`;
const PAGES = ["Current fissure", "Relics", "Mastery", "Foundry", "Builds", "Wishlist", "Inventory", "Prime parts", "Sets", "Mods", "Arcanes", "Rivens", "Orders", "Sell spares", "Sales"];

/** A sync (the rail's Sync: browser mode reloads the inventory file) and a market poll landing, on `label`. */
const ticks = (label) => ({
  syncReload: true,
  async run(s) {
    await s.measure(nav(label));
    await s.measure("void 0", { quiet: 1500, max: 4000 });
    const sync = [];
    for (let i = 0; i < 3; i++) {
      // Quiet 1.2 s: the app's catch-up of hidden pages waits for 1 s without input.
      sync.push(await s.measure(`document.querySelector('.rail .foot button.sync').click()`, { quiet: 1200 }));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
    }
    // warframe.market's listings, every 30 s (marketPoll in App.svelte): waits for it.
    const poll = [];
    for (let i = 0; i < 2; i++) poll.push(await s.measure("void 0", { waitFetch: "/dev-market\\.json", quiet: 800 }));
    return { sync, poll };
  },
});

export const SCENARIOS = {
  /** What the page does on its own while nobody touches it (clocks, polls): 10 s on Home. */
  idle: {
    runs: 1,
    async run(s) {
      const labels = await s.eval(railLabels);
      const m = await s.measure("void 0", { quiet: 60000, max: 10000 });
      return { labels, idle: m };
    },
  },

  /** 3 s doing nothing on a page: what repaints by itself (run with --timeline). */
  quiet: {
    runs: 1,
    async run(s) {
      const out = {};
      for (const l of ["Home", "Inventory", "Orders"]) {
        if (l !== "Home") await s.measure(nav(l));
        await s.measure("void 0", { quiet: 1500, max: 4000 });
        out[l] = await s.measure("void 0", { quiet: 60000, max: 3000 });
      }
      return out;
    },
  },

  /**
   * Every rail page, once the app has settled (the background warm-up has opened them all):
   * first visit, then a second visit after Home. probeLayout times style + layout separately.
   */
  nav: {
    async run(s, { probeLayout } = {}) {
      const first = {};
      const second = {};
      for (const l of PAGES) first[l] = await s.measure(nav(l), { probeLayout });
      await s.measure(nav("Home"), { probeLayout });
      for (const l of PAGES) second[l] = await s.measure(nav(l), { probeLayout });
      return { first, second };
    },
  },

  /** The same, with style and layout forced and timed after each DOM change (paint is the rest). */
  navLayout: {
    runs: 1,
    async run(s) {
      return SCENARIOS.nav.run(s, { probeLayout: true });
    },
  },

  /** Truly cold: each page opened right after the app's first draw, before the warm-up reaches it. One fresh app per page. */
  cold: {
    early: true,
    perPage: PAGES,
    async run(s, { page }) {
      return { page, open: await s.measure(nav(page), { quiet: 800 }) };
    },
  },

  tickInventory: ticks("Inventory"),
  tickMods: ticks("Mods"),
  tickOrders: ticks("Orders"),

  /** Orders: typing a three-digit price into a listing's price field, one key at a time; then Check prices. */
  orders: {
    async run(s) {
      await s.measure(nav("Orders"));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
      const listings = await s.eval(`document.querySelectorAll('.pane.shown input[aria-label^="Your price"]').length`);
      const typing = [];
      const field = `document.querySelectorAll('.pane.shown input[aria-label^="Your price"]')[1]`;
      await s.eval(`(${field}).focus(), (${field}).value = ''`);
      for (const ch of "123") {
        typing.push(await s.measure(`{const f=${field}; f.value += ${J(ch)}; f.dispatchEvent(new InputEvent('input', {bubbles: true, data: ${J(ch)}, inputType: 'insertText'}));}`, { quiet: 300 }));
      }
      // Leave the field as it was (Escape cancels an edit in Orders).
      await s.eval(`(${field}).dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`);
      await s.measure("void 0", { quiet: 800, max: 3000 });
      // Check prices: how often the button's animations start, and how often it's redrawn.
      await s.eval(`(() => {
        const bar = document.querySelector('.pane.shown .bar.tools');
        const btn = [...bar.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Check prices'));
        btn.dataset.perfFirst = '1';
        const w = window.__check = { anims: {}, animEvents: 0, replaced: 0, mutations: 0, texts: [] };
        document.addEventListener('animationstart', (e) => {
          if (!e.target.closest || !e.target.closest('.pane.shown .bar.tools')) return;
          const b = e.target.closest('button');
          if (!b || !b.textContent.includes('Check')) return;
          w.animEvents++;
          const k = e.animationName + (e.pseudoElement || '') + ' on ' + (e.target === b ? 'button' : e.target.tagName.toLowerCase() + '.' + e.target.className);
          w.anims[k] = (w.anims[k] ?? 0) + 1;
        }, true);
        new MutationObserver((recs) => {
          for (const r of recs) {
            if (!r.target.closest?.('button') && r.type !== 'childList') continue;
            w.mutations++;
            for (const n of r.removedNodes) if (n.dataset?.perfFirst) w.replaced++;
          }
          const t = [...bar.querySelectorAll('button')].find(b => /Check/.test(b.textContent))?.textContent.trim();
          if (t && w.texts[w.texts.length - 1] !== t) w.texts.push(t);
        }).observe(bar, { subtree: true, childList: true, attributes: true, characterData: true });
      })()`);
      const check = await s.measure(clickText("Check prices", ".pane.shown .bar.tools"), { quiet: 1500, max: 30000 });
      const watched = await s.eval("window.__check");
      return { listings, typing, check, checkButton: watched };
    },
  },

  /** Sell spares: ticking five lines in the plan, one after another. */
  spares: {
    async run(s) {
      await s.measure(nav("Sell spares"));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
      const boxes = await s.eval(`document.querySelectorAll('.pane.shown button.box:not([disabled])').length`);
      const ticks = [];
      for (let i = 0; i < 5; i++) {
        ticks.push(await s.measure(`document.querySelectorAll('.pane.shown button.box:not([disabled])')[${i + 2}].click()`, { quiet: 500 }));
      }
      return { boxes, ticks };
    },
  },

  /** The Settings sheet: opened, closed, opened again. */
  settings: {
    async run(s) {
      const open = OPEN_SETTINGS;
      const close = `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`;
      // Whether the sheet is open after each step, so a click that missed shows as such.
      const isOpen = `!!document.querySelector(".sheet.on[aria-label='Settings']:not([inert])")`;
      const first = await s.measure(open, { quiet: 600 });
      first.open = await s.eval(isOpen);
      const closed = await s.measure(close, { quiet: 600 });
      closed.open = await s.eval(isOpen);
      const second = await s.measure(open, { quiet: 600 });
      second.open = await s.eval(isOpen);
      return { first, closed, second };
    },
  },
};

/** What animates by itself on Home, Inventory and Orders: running animations and what sits at the repainted spots. */
SCENARIOS.animations = {
  runs: 1,
  async run(s) {
    const look = `(() => {
      const desc = (e) => e ? (e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')) : null;
      const path = (e) => { const p = []; for (let x = e; x && p.length < 5; x = x.parentElement) p.push(desc(x)); return p.join(' < '); };
      return {
        running: document.getAnimations().filter(a => a.playState === 'running').map(a => ({ name: a.animationName ?? a.transitionProperty ?? a.constructor.name, iterations: a.effect?.getTiming?.().iterations, duration: a.effect?.getTiming?.().duration, el: path(a.effect?.target), pseudo: a.effect?.pseudoElement ?? null, hidden: !!a.effect?.target?.closest?.('.pane:not(.shown)') })),
        at: [[1400, 340], [1590, 500], [1590, 100]].map(([x, y]) => [x, y, path(document.elementFromPoint(x, y))]),
      };
    })()`;
    const out = {};
    for (const l of ["Home", "Inventory", "Orders"]) {
      if (l !== "Home") await s.measure(nav(l));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
      out[l] = await s.eval(look);
    }
    return out;
  },
};

/**
 * Controls for the idle repaints: 3 s of Timeline with the probe's own frame loop and heartbeat
 * off, what sits under the right-hand strip, and what changes in the DOM on Home by itself.
 */
SCENARIOS.idleControl = {
  runs: 1,
  async run(s) {
    const out = {};
    for (const l of ["Home", "Inventory"]) {
      if (l !== "Home") await s.measure(nav(l));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
      await s.insp.startRecording();
      await s.eval(`window.__churn = {}; window.__churnObs = new MutationObserver(rs => { for (const r of rs) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement; const k = r.type + ' ' + (r.attributeName ?? '') + ' ' + (t ? t.tagName.toLowerCase() + '.' + String(t.className).split(' ').slice(0, 2).join('.') : '?'); window.__churn[k] = (window.__churn[k] ?? 0) + 1; } }); window.__churnObs.observe(document, {subtree: true, childList: true, attributes: true, characterData: true}); 0`);
      await new Promise((r) => setTimeout(r, 3000));
      const timeline = await s.insp.stopRecording();
      const churn = await s.eval(`(window.__churnObs.disconnect(), Object.entries(window.__churn).sort((a, b) => b[1] - a[1]).slice(0, 12))`);
      const under = await s.eval(`(() => { const d = (e) => e ? e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0, 2).join('.') : null; return [100, 500, 900].map(y => [y, document.elementsFromPoint(1590, y).slice(0, 4).map(d).join(' | ')]); })()`);
      const scrollers = await s.eval(`[...document.querySelectorAll('.pane')].filter(p => p.scrollHeight > p.clientHeight || p.querySelector('.page')?.scrollHeight > p.querySelector('.page')?.clientHeight).length`);
      out[l] = { timeline, churn, under, scrollers };
    }
    return out;
  },
};

/** After a page switch has settled: what the app does in the next 4 s (the hidden pages' catch-up). */
SCENARIOS.afterNav = {
  async run(s) {
    const out = {};
    for (const l of ["Inventory", "Orders", "Mods", "Home"]) {
      const open = await s.measure(nav(l));
      const after = await s.measure("void 0", { quiet: 60000, max: 4000 });
      out[l] = { open, after };
    }
    return out;
  },
};

/** Check prices on Orders: transitions and animations on the button, and repaints over it. */
SCENARIOS.checkButton = {
  runs: 1,
  async run(s) {
    await s.measure(nav("Orders"));
    await s.measure("void 0", { quiet: 1500, max: 4000 });
    const rect = await s.eval(`(() => {
      const bar = document.querySelector('.pane.shown .bar.tools');
      const btn = [...bar.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Check prices'));
      const w = window.__btn = { events: {}, classes: [] };
      for (const type of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel', 'animationstart', 'animationiteration', 'animationend']) {
        btn.addEventListener(type, (e) => {
          const k = type + ' ' + (e.propertyName ?? e.animationName) + (e.pseudoElement || '') + ' on ' + (e.target === btn ? 'button' : e.target.tagName.toLowerCase() + '.' + String(e.target.className).split(' ').slice(0, 2).join('.'));
          w.events[k] = (w.events[k] ?? 0) + 1;
        });
      }
      new MutationObserver((rs) => { for (const r of rs) if (r.type === 'attributes') w.classes.push(r.attributeName + '=' + String(r.target.getAttribute(r.attributeName)).slice(0, 60) + ' on ' + r.target.tagName.toLowerCase() + '.' + String(r.target.className).split(' ')[0]); }).observe(btn, { subtree: true, attributes: true });
      const r = btn.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    })()`);
    const check = await s.measure(clickText("Check prices", ".pane.shown .bar.tools"), { quiet: 1500, max: 30000 });
    const btn = await s.eval(`(() => { const w = window.__btn; const c = {}; for (const x of w.classes) c[x] = (c[x] ?? 0) + 1; return { events: w.events, attributeChanges: w.classes.length, distinct: Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 15) }; })()`);
    return { buttonRect: rect, check, button: btn };
  },
};

/** What the rail's Sync does in the browser build: its requests and the button's state. */
SCENARIOS.syncDebug = {
  runs: 1,
  async run(s) {
    const before = await s.eval("window.__perf.fetches.length");
    const btn = await s.eval(`(() => { const b = document.querySelector('.rail .foot button.sync'); return b ? [b.outerHTML.slice(0, 300), b.disabled, b.getAttribute('aria-busy')] : null; })()`);
    await s.eval(`document.querySelector('.rail .foot button.sync').click()`);
    await new Promise((r) => setTimeout(r, 4000));
    const after = await s.eval(`window.__perf.fetches.slice(${before}).map(f => f.url.replace(location.origin, '') + ' ' + Math.round(f.t1 - f.t0))`);
    const label = await s.eval(`document.querySelector('.rail .foot button.sync').textContent.trim().slice(0, 80)`);
    return { btn, after, label };
  },
};

/**
 * The help over a page (ui/HelpDialog.svelte): the click on the page's first "?" to the dialog's
 * paint, the page updating behind it (a Sync), 10 s open, and Esc. `helpFlat` is the help as it
 * ships, the shade alone; `helpBlur` puts a still blur on the page behind (the rule app.css leaves
 * off until this shows it costs little), to compare.
 */
const helpOver = (flat) => ({
  syncReload: true,
  async run(s) {
    if (!flat) await s.eval(`(() => { const st = document.createElement('style'); st.textContent = '.pane.helpblur { filter: blur(3px); }'; document.head.append(st); return 0; })()`);
    const out = {};
    for (const label of ["Orders", "Mastery"]) {
      await s.measure(nav(label));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
      const open = await s.measure(`document.querySelector('.pane.shown [data-help]').click()`, { quiet: 600 });
      const update = await s.measure(`document.querySelector('.rail .foot button.sync').click()`, { quiet: 1200 });
      const held = await s.measure("void 0", { quiet: 60000, max: 10000 });
      const close = await s.measure(`document.querySelector('[role=dialog][aria-modal=true]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`, { quiet: 600 });
      out[label] = { open, update, held, close };
    }
    return out;
  },
});
SCENARIOS.helpBlur = helpOver(false);
SCENARIOS.helpFlat = helpOver(true);

/**
 * Scrolls the shown page's longest list (the page itself or the tallest scrollable box in it) down
 * and back up as a wheel would, 120 px every frame for about `ms` each way; resolves with the
 * list's length in screens (0: nothing on the page scrolls).
 */
const scrollList = (ms) => `new Promise((done) => {
  const pane = document.querySelector('.pane.shown');
  // The page's own scroller first: reading the style of every element on a long page (Inventory
  // with all its cards drawn: tens of thousands) held the page up for 1.4 to 1.9 s before each
  // scroll, which the recorder then counted as a stall at rest.
  const scrolls = (e) => e.scrollHeight > e.clientHeight + 200 && /auto|scroll/.test(getComputedStyle(e).overflowY);
  const tallest = (xs) => xs.filter(scrolls).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  const el = pane ? (tallest([pane, ...pane.querySelectorAll('.page')]) ?? tallest([...pane.querySelectorAll('*')])) : undefined;
  if (!el) return done(0);
  const screens = el.scrollHeight / el.clientHeight;
  const end = performance.now() + ${ms};
  let dir = 120;
  const step = () => {
    el.scrollBy(0, dir);
    if (dir > 0 && (performance.now() > end || el.scrollTop + el.clientHeight >= el.scrollHeight - 1)) dir = -120;
    if (dir < 0 && el.scrollTop <= 0) return setTimeout(() => done(Math.round(screens * 10) / 10), 400);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})`;

/**
 * Scrolls the shown page down `px` a frame until it can go no further and its height has held for
 * 1.5 s (a long list drawn as far as it goes), or `capMs` passed. Each frame it notes whether the
 * screen stood at the end of what was drawn while the list (`count`, its "N items") had more:
 * the strip a player would see there instead of cards. `jump`: as a drag of the scroll bar to the
 * bottom, held: straight to the end, held there until the strip has been out of sight for 10
 * frames, then to the end again. Resolves with the frames, those blank frames (all, and the
 * longest run of them), the jumps, the cards drawn and the list's length.
 */
const toBottom = (px, capMs, jump = false) => `new Promise((done) => {
  const pane = document.querySelector('.pane.shown');
  const page = pane?.querySelector('.page');
  if (!page) return done(null);
  const count = () => Number((pane.querySelector('.tools .end .nowrap')?.textContent ?? '').replace(/[^0-9]/g, '')) || null;
  const drawn = () => pane.querySelector('.cards.swap:not(.off) .grid')?.children.length ?? 0;
  const t0 = performance.now();
  let frames = 0, blank = 0, run = 0, longestRun = 0, stillSince = 0, lastH = -1, jumps = 0, clear = 10;
  const step = () => {
    frames++;
    if (!${jump}) page.scrollBy(0, ${px});
    else if (clear >= 10) { page.scrollTop = page.scrollHeight; jumps++; clear = 0; }
    const atEnd = page.scrollTop + page.clientHeight >= page.scrollHeight - 2;
    const n = count();
    if (atEnd && n != null && drawn() < n) { blank++; run++; longestRun = Math.max(longestRun, run); clear = 0; } else { run = 0; clear++; }
    const t = performance.now();
    if (!atEnd || page.scrollHeight !== lastH) stillSince = t;
    lastH = page.scrollHeight;
    const ms = t - t0;
    if ((atEnd && t - stillSince >= 1500) || ms > ${capMs}) {
      return done({ ms: Math.round(ms), frames, blank, longestRun, jumps, drawn: drawn(), count: count(), screens: Math.round((page.scrollHeight / page.clientHeight) * 10) / 10, reachedEnd: atEnd && ms <= ${capMs} });
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})`;

/** A page expression: whether the page draws a frame within `ms`. */
const FRAME_WITHIN = (ms) => `new Promise((done) => { const t = setTimeout(done, ${ms}, false); requestAnimationFrame(() => (clearTimeout(t), done(true))); })`;
/** A scenario part that ended because the page drew no frame for a minute (at the message's step). */
class Stalled extends Error {}

/**
 * Runs `promise` (page code) in the page and waits for it in pieces: the inspector waits at most
 * 60 s for one answer, and a scaled list takes minutes to scroll to its bottom.
 */
async function long(s, promise) {
  await s.eval(`(window.__long = { r: undefined }, (${promise}).then((v) => (window.__long.r = { v }), (e) => (window.__long.r = { e: String(e) })), 0)`);
  for (;;) {
    const r = await s.evalAsync(`new Promise((done) => { const t0 = performance.now(); const w = () => (window.__long.r ? done(window.__long.r) : performance.now() - t0 > 15000 ? done(null) : setTimeout(w, 250)); w(); })`);
    if (!r) continue;
    if (r.e) throw new Error(r.e);
    return r.v;
  }
}

/**
 * Inventory's list as it stands: the cards drawn, the list's length, and while the page is shown,
 * where it is scrolled to and the first card in sight (its name and how far below the page's top
 * edge it sits). Out of sight only the counts, which read no layout.
 */
const INVENTORY_STATE = `(() => {
  const pane = window.__inventoryPane;
  if (!pane) return null;
  const grid = pane.querySelector('.cards.swap .grid');
  const out = { shown: pane.classList.contains('shown'), drawn: grid ? grid.children.length : 0, count: Number((pane.querySelector('.tools .end .nowrap')?.textContent ?? '').replace(/[^0-9]/g, '')) || null };
  if (!out.shown) return out;
  const page = pane.querySelector('.page');
  const top = page.getBoundingClientRect().top;
  const first = grid && [...grid.children].find((c) => c.getBoundingClientRect().bottom > top + 1);
  return { ...out, scrollTop: Math.round(page.scrollTop), scrollHeight: page.scrollHeight, firstInSight: first ? { name: (first.querySelector('h3')?.textContent ?? '').trim(), offset: Math.round(first.getBoundingClientRect().top - top) } : null };
})()`;

/**
 * What the first speed measurement lacked, one fresh app for each part:
 * - `switch`: Inventory scrolled to the very bottom of its cards, then switches out of it and back
 *   (to Mods, Home and Prime parts), first while at the bottom and again after scrolling back to
 *   the top; with the cards drawn and the place in the list before and after each switch.
 * - `blank`: Inventory flung to the bottom at 480 px a frame; `drag`: the same list with its scroll
 *   bar dragged to the bottom and held there. Both count the frames that stood at the end of the
 *   cards drawn so far.
 * - `folds`: the sidebar folded and unfolded, one of its sections closed and opened, Orders'
 *   automatic panel opened and closed; twice each. The aim for these: no task over 50 ms.
 */
SCENARIOS.listsAndFolds = {
  perPage: ["switch", "blank", "drag", "folds"],
  async run(s, { page }) {
    const settle = () => s.measure("void 0", { quiet: 1500, max: 6000 });
    const cap = Number(process.env.PERF_BOTTOM_MS ?? 240_000);
    if (page === "blank" || page === "drag") {
      await s.measure(nav("Inventory"));
      await settle();
      return { part: page, bottom: await long(s, toBottom(480, cap, page === "drag")) };
    }
    if (page === "switch") {
      // Each step named on the log, and what's measured kept if a step fails (a page that stops
      // answering at the bottom of a scaled list): the results show how far it got.
      const out = { part: page, laps: [] };
      const step = (what) => ((out.step = what), console.error(`listsAndFolds switch: ${what}`));
      // Before each step, a frame: WebKit can stop drawing frames for a while with thousands of
      // cards drawn, and a measurement waits for one with no limit. A wait over a second is kept
      // (`out.stalls`); none for a minute ends the part with that as its result.
      out.stalls = [];
      const framed = async () => {
        const t0 = Date.now();
        for (let i = 0; i < 6; i++) {
          const came = await s.evalAsync(FRAME_WITHIN(10_000));
          const waited = Date.now() - t0;
          if (came) return void (waited > 1000 && out.stalls.push({ step: out.step, waited }));
        }
        out.stalls.push({ step: out.step, waited: Date.now() - t0, ended: true });
        throw new Stalled(out.step);
      };
      // Frames that stop between that wait and the measurement's own first frame: the inspector
      // gives up on the page after a minute. A stall too, with the error kept.
      const measure = async (what, o) => {
        await framed();
        try {
          return await s.measure(what, o);
        } catch (e) {
          if (!/no answer in 60 s/.test(String(e))) throw e;
          out.stalls.push({ step: out.step, waited: 60_000, ended: true, inMeasure: true });
          out.error = String(e.stack ?? e);
          throw new Stalled(out.step);
        }
      };
      const settle = () => measure("void 0", { quiet: 1500, max: 6000 });
      try {
        const state = () => s.eval(INVENTORY_STATE);
        step("open Inventory");
        await s.measure(nav("Inventory"));
        await settle();
        await s.eval(`(window.__inventoryPane = document.querySelector('.pane.shown'), 0)`);
        out.atStart = await state();
        step("to the bottom");
        out.bottom = await long(s, toBottom(120, cap));
        await settle();
        const laps = async (where) => {
          for (const to of ["Mods", "Home", "Prime parts"]) {
            step(`${where}: to ${to}`);
            const before = await state();
            const leave = await measure(nav(to));
            await settle();
            const away = await state();
            step(`${where}: back from ${to}`);
            const back = await measure(nav("Inventory"));
            await settle();
            out.laps.push({ where, to, before, leave, away, back, after: await state() });
          }
        };
        await laps("bottom");
        // Back to the top as a wheel would, 120 px a frame.
        step("back to the top");
        await long(s, `new Promise((done) => { const p = document.querySelector('.pane.shown .page'); const up = () => { p.scrollBy(0, -120); if (p.scrollTop <= 0) return setTimeout(done, 400, 0); requestAnimationFrame(up); }; requestAnimationFrame(up); })`);
        await settle();
        await laps("top");
        step("done");
      } catch (e) {
        if (e instanceof Stalled) out.stalled = e.message;
        else out.error = String(e.stack ?? e);
      }
      return out;
    }
    // folds
    const out = { part: page, sidebar: [], section: [], automatic: [] };
    const railFold = `document.querySelector('.rail button.fold').click()`;
    for (let i = 0; i < 2; i++) {
      const fold = await s.measure(railFold);
      await settle();
      const unfold = await s.measure(railFold);
      await settle();
      out.sidebar.push({ fold, unfold });
    }
    // An open section of the sidebar that isn't the open page's (Home is outside them).
    const sec = await s.eval(`document.querySelector('.rail button.secbar[aria-expanded="true"]:not(.here)')?.dataset.section ?? null`);
    out.sectionName = sec;
    if (sec) {
      const bar = `document.querySelector('.rail button.secbar[data-section="' + CSS.escape(${J(sec)}) + '"]').click()`;
      for (let i = 0; i < 2; i++) {
        const close = await s.measure(bar);
        await settle();
        const open = await s.measure(bar);
        await settle();
        out.section.push({ close, open });
      }
    }
    await s.measure(nav("Orders"));
    await settle();
    const panel = `document.querySelector('.pane.shown button.fold[title^="The automatic settings"]').click()`;
    for (let i = 0; i < 2; i++) {
      const open = await s.measure(panel);
      await settle();
      const close = await s.measure(panel);
      await settle();
      out.automatic.push({ open, close });
    }
    return out;
  },
};

/**
 * Record timings (src/lib/timing.ts) on, and `PERF_TOUR_MS` (5 minutes) of going through every
 * page as a player would: each rail page, Home, a Sync each lap; and each lap the three a player
 * feels most: a long list scrolled (Inventory, Mods, Orders), an item's card opened and closed
 * (Inventory), Settings opened and closed. Then Settings › Logs › Copy timing report, and the
 * report as the app wrote it.
 */
SCENARIOS.tour = {
  runs: 1,
  record: true,
  syncReload: true,
  async run(s) {
    const until = Date.now() + Number(process.env.PERF_TOUR_MS ?? 300_000);
    // Settings: in the full sidebar's foot; folded, in More's menu, opened first (not timed).
    const openSettings = async () => {
      await s.eval(`(() => { if (!document.querySelector(".rail .foot [data-item='Settings']")) document.querySelector('.rail .foot button.more')?.click(); })()`);
      await new Promise((r) => setTimeout(r, 300));
      return s.measure(OPEN_SETTINGS, { quiet: 600 });
    };
    const esc = `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`;
    let laps = 0;
    const scrolled = {};
    const cards = [];
    while (Date.now() < until) {
      for (const l of [...PAGES, "Home"]) {
        await s.measure(nav(l), { quiet: 400, max: 4000 });
        if (Date.now() >= until) break;
      }
      await s.measure(`document.querySelector('.rail .foot button.sync').click()`, { quiet: 1200 });
      for (const l of ["Inventory", "Mods", "Orders"]) {
        await s.measure(nav(l), { quiet: 400, max: 4000 });
        scrolled[l] = await s.evalAsync(scrollList(1500));
      }
      // An item's card, from Inventory's cards: the first few that open one, opened and closed.
      await s.measure(nav("Inventory"), { quiet: 400, max: 4000 });
      for (let i = 0, shown = 0; i < 8 && shown < 3; i++) {
        const opened = await s.measure(`document.querySelectorAll('.pane.shown article.card[role="button"]')[${i}]?.click()`, { quiet: 500 });
        if (!(await s.eval(`!!document.querySelector('.sheet[role=dialog]:not(.keep):not([inert])')`))) continue;
        shown++;
        cards.push(opened);
        await s.measure(esc, { quiet: 500 });
      }
      await openSettings();
      await s.measure(esc, { quiet: 600 });
      laps++;
    }
    await openSettings();
    await s.measure(`[...document.querySelectorAll('.sheet button')].find(b => b.textContent.trim() === 'Copy timing report').click()`, { quiet: 600 });
    await new Promise((r) => setTimeout(r, 1000));
    const report = await s.eval(`document.querySelector('textarea[aria-label="Timing report"]')?.value ?? null`);
    return { laps, scrolled, cards: cards.length, report };
  },
};

/**
 * The first minute after start: a heartbeat from before the app's first script (probe.js,
 * `perf-beat`) to 60 s, so the warm-up's background work shows as gaps. Reported: gaps over 50
 * and over 100 ms, the longest, and the time blocked between 1 s and 15 s (each gap's part over
 * 50 ms, for gaps that begin in that span). Also the page's timer callbacks over 20 ms (a
 * background slice runs in one): the longest, and how many over 50 ms.
 */
SCENARIOS.firstMinute = {
  early: true,
  beat: true,
  async run(s) {
    while ((await s.eval("performance.now()")) < 61000) await new Promise((r) => setTimeout(r, 1000));
    const gaps = await s.eval("window.__perf.earlyGaps()");
    const slices = await s.eval("window.__perf.earlySlices()");
    const span = gaps.filter((g) => g.at >= 1000 && g.at < 15000);
    return {
      gaps,
      slices,
      longestSliceMs: slices.reduce((m, x) => Math.max(m, x.ms), 0),
      slicesOver50: slices.filter((x) => x.ms > 50).length,
      over50: gaps.length,
      over100: gaps.filter((g) => g.ms > 100).length,
      longestMs: gaps.reduce((m, g) => Math.max(m, g.ms), 0),
      blocked1to15Ms: span.reduce((m, g) => m + Math.max(0, g.ms - 50), 0),
    };
  },
};

/**
 * Two minutes at rest, settled, on Home and on Inventory: what runs with nobody touching the app,
 * run on the counting build (PERF_COUNT=1). Effect runs and derived recomputations per component
 * over the two minutes, and which pages were hidden meanwhile.
 */
SCENARIOS.rest = {
  runs: 1,
  perPage: ["Home", "Inventory"],
  async run(s, { page }) {
    if (page !== "Home") await s.measure(nav(page), { quiet: 1000 });
    await s.measure("void 0", { quiet: 1500, max: 4000 });
    const ms = Number(process.env.PERF_REST_MS ?? 120_000);
    const c0 = await s.eval("window.__perf.counts()");
    const m = await s.measure("void 0", { quiet: ms + 60_000, max: ms });
    const c1 = await s.eval("window.__perf.counts()");
    // Every component, not only the top few: effect runs and derived recomputations in the span.
    const diff = (k) => Object.fromEntries(Object.entries(c1?.[k] ?? {}).map(([n, v]) => [n, v - (c0?.[k]?.[n] ?? 0)]).filter(([, v]) => v).sort((p, q) => q[1] - p[1]));
    const hidden = await s.eval(`[...document.querySelectorAll('.pane:not(.shown)')].map(e => (e.querySelector('h1, h2')?.textContent ?? '?').trim().slice(0, 40))`);
    return { page, ms, longestTaskMs: m.longestTaskMs, tasksOver50: m.tasksOver50, requests: m.requests.length, effect: diff("effect"), derived: diff("derived"), mount: diff("mount"), hidden, haveCounts: !!c1 };
  },
};
