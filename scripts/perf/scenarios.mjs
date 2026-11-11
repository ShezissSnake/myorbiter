// What scripts/perf/run.mjs measures. Each scenario gets a fresh page on `tab`: settled (the
// background warm-up of every page done) or, with `early: true`, just after the first page drew.
// It returns its measurements; the page side is window.__perf (probe.js).

const J = JSON.stringify;
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
      sync.push(await s.measure(`document.querySelector('.syncrow button.sync').click()`, { quiet: 1200 }));
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
      const listings = await s.eval(`document.querySelectorAll('.pane.shown input[aria-label="Your price"]').length`);
      const typing = [];
      const field = `document.querySelectorAll('.pane.shown input[aria-label="Your price"]')[1]`;
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
      const open = `document.querySelector('.foot button[aria-label="Settings"]').click()`;
      const close = `document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`;
      const first = await s.measure(open, { quiet: 600 });
      const closed = await s.measure(close, { quiet: 600 });
      const second = await s.measure(open, { quiet: 600 });
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
    const btn = await s.eval(`(() => { const b = document.querySelector('.syncrow button.sync'); return b ? [b.outerHTML.slice(0, 300), b.disabled, b.getAttribute('aria-busy')] : null; })()`);
    await s.eval(`document.querySelector('.syncrow button.sync').click()`);
    await new Promise((r) => setTimeout(r, 4000));
    const after = await s.eval(`window.__perf.fetches.slice(${before}).map(f => f.url.replace(location.origin, '') + ' ' + Math.round(f.t1 - f.t0))`);
    const label = await s.eval(`document.querySelector('.syncrow button.sync').textContent.trim().slice(0, 80)`);
    return { btn, after, label };
  },
};

/**
 * The help over a page (ui/HelpDialog.svelte): the click on the page's first "?" to the dialog's
 * paint, the page updating behind it (a Sync), 10 s open, and Esc. `helpBlur` keeps the still
 * blur on the page behind; `helpFlat` turns it off, the shade alone, to compare.
 */
const helpOver = (flat) => ({
  syncReload: true,
  async run(s) {
    if (flat) await s.eval(`(() => { const st = document.createElement('style'); st.textContent = '.pane.helpblur { filter: none !important; }'; document.head.append(st); return 0; })()`);
    const out = {};
    for (const label of ["Orders", "Mastery"]) {
      await s.measure(nav(label));
      await s.measure("void 0", { quiet: 1500, max: 4000 });
      const open = await s.measure(`document.querySelector('.pane.shown [data-help]').click()`, { quiet: 600 });
      const update = await s.measure(`document.querySelector('.syncrow button.sync').click()`, { quiet: 1200 });
      const held = await s.measure("void 0", { quiet: 60000, max: 10000 });
      const close = await s.measure(`document.querySelector('[role=dialog][aria-modal=true]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))`, { quiet: 600 });
      out[label] = { open, update, held, close };
    }
    return out;
  },
});
SCENARIOS.helpBlur = helpOver(false);
SCENARIOS.helpFlat = helpOver(true);
