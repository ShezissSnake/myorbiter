// The clipping sweep: opens every view of the demo (`npm run dev:demo`, demo/: the invented
// account, never public/dev-*.json) at the window sizes MyOrbiter is used at, and flags every
// element cut off by a box that doesn't scroll, or pushed past the window, and every text that
// runs out of its own box without an ellipsis. Then, at 1280×800, it walks every one of those
// views with the keyboard: Tab until focus comes back round (at most 400 presses), and flags each
// element focus lands on that is hidden (its own visibility, or inside something hidden) or that
// has no accessible name (an icon-only button or link with no label, title or text). In every
// view it also checks the help: each part (a head bar, a tool or filter row, a table, a band of
// figures, a labelled section; PART_HEADS and PART_BODIES below) carries a "?" (ui/HelpMark.svelte)
// or sits under a head that does, each "?" names a part the help list knows, and the page it opens
// is written (has its picture); a part whose page isn't is listed as pending. With the help
// open on Orders and Sell spares it checks the dialog at every size too. In every view it also
// checks each picture's shape: one drawn more than 2 % wider or narrower than its own shape fails
// (findStretched); a last view, Current fissure's reward cards with the demo's Forma Blueprint and
// every item picture swapped for a wide one, makes sure a picture well is tried with a picture
// that isn't square. It also checks every tag drawn (`.tag`) for words, and for 4.5:1 between them
// and their fill (findTags). At 1280×800 it sorts Orders by each column, both ways, and checks
// that no part of the table is left with a transform or an animation (sortCheck), and that the
// rows read the same at rest with reduced motion on. Exits 1 when it finds any of these.
//
//   npm run sweep [-- --port 1432] [-- --out <folder>] [-- --only 1280x800] [-- --coverage]
//
// --coverage: only the help check, at 1280×800 and 1920×1080 (where the Watching column shows).
//
// Headless Chromium, so it runs without a display server. It uses Playwright's Chromium if it's
// installed (`npx playwright install chromium` puts it in Playwright's own cache) and stops with
// that hint if not: it never downloads anything itself. MyOrbiter itself draws with WebKitGTK on
// Linux and WebView2 on Windows; text widths differ a little between engines, which is why the
// layouts this checks are meant to hold with room to spare. With --out, one contact sheet per
// window size (every view, flagged elements outlined in red) is saved there as PNG; needs
// ImageMagick (`magick`). Every request to warframe.market is stopped: the sweep sends none. The
// world state is the demo's own (demo/dev-worldstate.json): a request to a world-state service is
// stopped and counted, and fails the sweep (scripts/no-world-state.mjs).

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requestsLine, stopWorldState, worldStateAsked } from "./no-world-state.mjs";
import { deflateSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const port = arg("--port") ?? "1432";
if (!/^[0-9]{2,5}$/.test(port)) throw new Error(`not a port: ${port}`);
const out = arg("--out") ? resolve(arg("--out")) : null;
const coverageOnly = process.argv.includes("--coverage");
const url = `http://localhost:${port}/`;

/** The app's minimum window (src-tauri/tauri.conf.json), the Steam Deck, a common laptop, 1080p, 1440p. */
const SIZES = [
  { w: 900, h: 560 },
  { w: 1280, h: 800 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
].filter((s) => (!arg("--only") || arg("--only") === `${s.w}x${s.h}`) && (!coverageOnly || s.w === 1280 || s.w === 1920));

/**
 * Clipping that is meant to be there, by a selector the clipped element or its clipping box
 * matches, and why. Anything else the sweep finds is a layout bug.
 */
const DELIBERATE = [
  { selector: ".art img", why: "card art cropped to its frame (object-fit: cover)" },
];

/**
 * Runs in the page: what's clipped or overflowing now. An element counts when it's drawn (not
 * display: none, visibility: hidden, or a 1 px screen-reader box), and is checked against each
 * ancestor that clips it (overflow other than visible, up to its containing block for a positioned
 * one) and against the window.
 */
function findClipping(deliberate) {
  const found = [];
  const seen = new Set();
  const describe = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((c) => !c.startsWith("svelte-")).slice(0, 3).join(".") : "";
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent ?? "").trim();
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${label ? ` "${label.replace(/\s+/g, " ").slice(0, 60)}"` : ""}`;
  };
  const isDeliberate = (...els) => {
    for (const d of deliberate) for (const el of els) if (el && el.closest(d.selector)) return d.why;
    return null;
  };
  const report = (kind, el, by, detail) => {
    const why = isDeliberate(el, by);
    const key = `${kind}|${describe(el)}|${by ? describe(by) : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, element: describe(el), by: by ? describe(by) : null, detail, deliberate: why });
    if (!why) el.setAttribute("data-sweep", "");
  };
  const W = innerWidth;
  const H = innerHeight;
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("svg, .skip, [inert]")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility !== "visible" || cs.display === "contents") continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    // Hidden by an ancestor's opacity or a closed fold: not drawn.
    if (el.closest("[aria-hidden='true']") && !el.matches("button, a, input, select")) continue;
    // Each ancestor that clips this element: its containing blocks' chain. A positioned box
    // escapes the static ancestors between it and the box it's placed in; a fixed one, all of them.
    const mode = (st) => (st.position === "fixed" ? "fixed" : st.position === "absolute" ? "abs" : "flow");
    let at = mode(cs);
    const scrolls = { x: false, y: false };
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      if (at === "fixed") break;
      const as = getComputedStyle(a);
      const places = as.position !== "static" || as.transform !== "none" || as.filter !== "none" || as.contain.includes("paint");
      if (at === "abs" && !places) continue;
      at = mode(as);
      const ox = as.overflowX;
      const oy = as.overflowY;
      if (ox === "visible" && oy === "visible") continue;
      const b = a.getBoundingClientRect();
      if (b.width <= 1 || b.height <= 1) break; // a closed fold: nothing in it is drawn
      // The box's inside edges, without its borders and scrollbars.
      const left = b.left + a.clientLeft;
      const top = b.top + a.clientTop;
      const right = left + a.clientWidth;
      const bottom = top + a.clientHeight;
      const outX = r.left < left - 1 || r.right > right + 1;
      // An inline box's font area is taller than its line: a few pixels over isn't a cut glyph.
      const slackY = cs.display === "inline" ? 4 : 1;
      const outY = r.top < top - slackY || r.bottom > bottom + slackY;
      if (outX) {
        if (ox === "auto" || ox === "scroll") scrolls.x = true;
        else if (!scrolls.x) report("cut off", el, a, `x ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(left)}..${Math.round(right)}`);
      }
      if (outY) {
        if (oy === "auto" || oy === "scroll") scrolls.y = true;
        else if (!scrolls.y) report("cut off", el, a, `y ${Math.round(r.top)}..${Math.round(r.bottom)} in ${Math.round(top)}..${Math.round(bottom)}`);
      }
      // Further out than a box that scrolls: it's reached by scrolling, not clipped.
      if (scrolls.x && scrolls.y) break;
    }
    // Past the window, where nothing scrolls to it.
    if (cs.position !== "fixed" && !scrolls.x && (r.right > W + 1 || r.left < -1)) report("past the window", el, null, `x ${Math.round(r.left)}..${Math.round(r.right)} of ${W}`);
    if (cs.position === "fixed" && (r.right > W + 1 || r.bottom > H + 1 || r.left < -1 || r.top < -1)) report("past the window", el, null, `fixed at ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)} of ${W}×${H}`);
    // Its own text running out of it: clipped without an ellipsis, or drawn over what's beside it.
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (ownText && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.display !== "inline") {
      if (cs.overflowX === "visible") report("text runs out", el, null, `${el.scrollWidth} px of text in ${el.clientWidth}`);
      else if (cs.textOverflow !== "ellipsis" && cs.overflowX !== "auto" && cs.overflowX !== "scroll") report("text cut", el, null, `${el.scrollWidth} px of text in ${el.clientWidth}, no ellipsis`);
    }
  }
  return found;
}

/** How far a picture's drawn shape may be from its own (width over height) before it counts as stretched. */
const SHAPE_SLACK = 0.02;
/** The least contrast a tag's words may have against their fill (the design rules' 4.5:1). */
const TAG_CONTRAST = 4.5;

/**
 * Runs in the page: every tag drawn now (`.tag`, the small labelled bars on cards and rows) that has
 * no words, or whose words are under `minRatio`:1 against what is behind them (its own fill, or the
 * first fill behind it, laid over its parents'). A tag once drew gold words on its own gold fill.
 */
function findTags(minRatio) {
  const bad = [];
  let checked = 0;
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  // Any CSS colour (rgb, color-mix, color(srgb ...)) as [r, g, b, a], by painting it.
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, under) => top.slice(0, 3).map((c, i) => c * top[3] + under[i] * (1 - top[3]));
  const lum = (c) => {
    const [r, g, b] = c.map((x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const el of document.querySelectorAll(".tag")) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility !== "visible" || r.width < 1 || r.height < 1) continue;
    checked++;
    const words = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const where = `${typeof el.className === "string" ? el.className.replace(/svelte-\w+/g, "").trim().replace(/\s+/g, ".") : "tag"} "${words.slice(0, 40)}"`;
    if (!words && !el.querySelector("svg, img")) {
      bad.push(`${where}: no words`);
      el.setAttribute("data-sweep", "");
      continue;
    }
    // What is behind the words: fills from the tag outward, until one is opaque.
    const fills = [];
    for (let n = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) fills.push(c);
      if (c[3] >= 1) break;
    }
    let back = [11, 13, 16];
    for (const c of fills.reverse()) back = over(c, back);
    const fg = rgba(cs.color);
    const text = fg[3] < 1 ? over(fg, back) : fg.slice(0, 3);
    const [hi, lo] = [lum(text), lum(back)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < minRatio) {
      bad.push(`${where}: words ${ratio.toFixed(2)}:1 on their fill`);
      el.setAttribute("data-sweep", "");
    }
  }
  return { checked, bad };
}

/**
 * Runs in the page: every picture drawn now at a shape other than its own. A picture is an
 * `<img>` that has loaded, or a background or mask picture (`url(…)`) on an element or its
 * ::before or ::after. An `<img>` keeps its shape unless its object-fit is `fill` (the default),
 * which stretches it to its box; a background keeps it unless its size names both a width and a
 * height. SVG drawings are left out: they are the page's own marks, drawn to the box they're given.
 * Async: a background picture's own size is read by loading it again (from the cache).
 */
async function findStretched(slack) {
  const found = [];
  let checked = 0;
  const describe = (el, pseudo) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("svelte-")).slice(0, 3).join(".") : "";
    const label = el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("title") || "";
    // Where it is: the nearest ancestor that names itself (a card's label, a dialog's).
    const named = el.parentElement?.closest("[aria-label]");
    const where = named ? ` in "${named.getAttribute("aria-label").replace(/\s+/g, " ").slice(0, 50)}"` : "";
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${pseudo ?? ""}${label ? ` "${label.replace(/\s+/g, " ").slice(0, 50)}"` : ""}${where}`;
  };
  const isSvg = (src) => /^data:image\/svg|\.svg(\?|#|$)/i.test(src);
  const fileOf = (src) => (src.startsWith("data:") ? "inline picture" : decodeURIComponent(src.split(/[?#]/)[0].split("/").pop()));
  const drawn = (el, cs) => {
    if (cs.display === "none" || cs.visibility !== "visible") return null;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? r : null;
  };
  const report = (el, pseudo, src, own, w, h) => {
    checked++;
    const off = (w / h) / (own.w / own.h) - 1;
    if (Math.abs(off) <= slack) return;
    found.push({ picture: `${describe(el, pseudo)} (${fileOf(src)})`, own: `${own.w}×${own.h}`, drawn: `${w.toFixed(1)}×${h.toFixed(1)}`, off: `${off > 0 ? "+" : ""}${(off * 100).toFixed(1)}%` });
    el.setAttribute("data-sweep", "");
  };
  for (const img of document.querySelectorAll("img")) {
    if (!img.complete || !img.naturalWidth || !img.naturalHeight || isSvg(img.currentSrc || img.src)) continue;
    const cs = getComputedStyle(img);
    const r = drawn(img, cs);
    if (!r) continue;
    const own = { w: img.naturalWidth, h: img.naturalHeight };
    // Its content box: what the picture is fitted into.
    const px = (v) => parseFloat(v) || 0;
    const w = r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(cs.paddingLeft) - px(cs.paddingRight);
    const h = r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(cs.paddingTop) - px(cs.paddingBottom);
    if (w <= 1 || h <= 1) continue;
    // contain, scale-down and none keep the picture's own shape; cover crops it but keeps it too.
    if (cs.objectFit === "fill") report(img, null, img.currentSrc || img.src, own, w, h);
    else report(img, null, img.currentSrc || img.src, own, own.w, own.h);
  }
  // Background and mask pictures, each layer with its own size.
  const sizes = new Map();
  const ownSize = (src) => {
    if (!sizes.has(src))
      sizes.set(src, new Promise((done) => {
        const im = new Image();
        im.onload = () => done(im.naturalWidth && im.naturalHeight ? { w: im.naturalWidth, h: im.naturalHeight } : null);
        im.onerror = () => done(null);
        im.src = src;
      }));
    return sizes.get(src);
  };
  const layers = (v) => v.split(/,(?![^(]*\))/).map((s) => s.trim());
  for (const el of document.body.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && (cs.content === "none" || cs.content === "normal")) continue;
      for (const [image, size] of [[cs.backgroundImage, cs.backgroundSize], [cs.maskImage || cs.webkitMaskImage, cs.maskSize || cs.webkitMaskSize]]) {
        if (!image || !image.includes("url(")) continue;
        const r = pseudo ? null : drawn(el, cs);
        if (!pseudo && !r) continue;
        const sz = layers(size ?? "auto");
        for (const [i, layer] of layers(image).entries()) {
          const m = /^url\("?(.*?)"?\)$/.exec(layer);
          if (!m || isSvg(m[1])) continue;
          const s = (sz[i % sz.length] ?? "auto").split(/\s+/);
          // cover, contain, one length (the height follows) or either side auto: its own shape.
          if (s.length < 2 || s.includes("auto")) continue;
          const own = await ownSize(m[1]);
          if (!own) continue;
          // Percentages are of the box the picture is placed in (the padding box, near enough).
          const box = pseudo ? { width: parseFloat(cs.width) || 0, height: parseFloat(cs.height) || 0 } : r;
          const len = (v, of) => (v.endsWith("%") ? (parseFloat(v) / 100) * of : parseFloat(v));
          const w = len(s[0], box.width);
          const h = len(s[1], box.height);
          if (w > 1 && h > 1) report(el, pseudo, m[1], own, w, h);
        }
      }
    }
  }
  return { found, checked };
}

/**
 * The shapes a part takes, for the help check. A head (a list plate's head bar, a section heading
 * on a page or in a panel, a tool or filter row) must hold its own "?"; a body (a table, the band
 * of figures under a title, a labelled section, anything marked data-part) is covered by a "?"
 * inside it or in the head just above it.
 */
const PART_HEADS = [".plate-head", ".page h2.register", ".page h3.register.lead", ".page .bar", ".page .tools", ".sheet section > h3.register", "aside.side section > h3.register", ".sheet section > .hmark > h3.register", "aside.side section > .hmark > h3.register"];
const PART_BODIES = ["table", ".band", "section[aria-label]", "[data-part]"];
/** Groups inside a part that its own "?" covers: they repeat, and aren't parts of their own. */
const PART_OF = [{ selector: ".dayblock", why: "the notifications' day groups: one list, under the panel's own \"?\"" }];

/** Runs in the page: the parts drawn now without a "?", the "?"s whose walk-through is a placeholder, and any naming no part. */
function coverage({ heads, bodies, inside }) {
  const drawn = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility === "visible" && cs.display !== "none" && !el.closest("[inert], [hidden], [aria-hidden='true'], .zone") && !(inside && el.closest(inside));
  };
  const describe = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("svelte-")).slice(0, 2).join(".") : "";
    const label = el.getAttribute("aria-label") || (el.textContent ?? "").trim();
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${label ? ` "${label.replace(/\s+/g, " ").slice(0, 40)}"` : ""}`;
  };
  const head = heads.join(", ");
  const marked = (el) => !!el?.querySelector?.("[data-help]");
  const isHead = (el) => !!el?.matches?.(head);
  // A head carries its "?", or its row does, at the right end (a heading beside the row's buttons).
  const headOk = (el) => marked(el) || !!el.parentElement?.querySelector(":scope > [data-help]");
  // The head an element is or starts with: itself, its first child (a heading row), or that
  // child's first child (a heading in its row with the "?" beside it, .hmark, inside a wider row).
  const headOf = (el) => [el, el?.firstElementChild, el?.firstElementChild?.firstElementChild].find(isHead) ?? null;
  // A body sits under a head with a "?": the head just before it, or the first child of a box it
  // is in (a section and its heading), a few levels up at most.
  const underHead = (el) => {
    for (let n = el, i = 0; n && i < 5 && !n.matches(".pane, .page-inner, .sheet, aside.side, [role=dialog]"); n = n.parentElement, i++) {
      // A heading row (a heading with a note or the "?" beside it) counts as the head it starts with.
      for (let s = n.previousElementSibling, j = 0; s && j < 3; s = s.previousElementSibling, j++) {
        const h = headOf(s);
        if (h) return headOk(h);
      }
      const first = n.parentElement?.firstElementChild;
      const fh = first && first !== n ? headOf(first) : null;
      if (fh && headOk(fh)) return true;
      if (n !== el && n.matches("[data-part]") && marked(n)) return true;
      // A "?" in the corner of a box covers what the box holds (the band's figures, the signature strip).
      if (n.parentElement?.querySelector(":scope > [data-help].corner")) return true;
    }
    return false;
  };
  // With a dialog or panel open, only what is in it can be reached: the one on top is checked, and
  // it is a part itself. Otherwise the whole window, the sidebar's foot included.
  const modals = [...document.querySelectorAll("[aria-modal='true']")].filter((m) => drawn(m) && !m.closest(".zone"));
  const root = modals.length ? modals[modals.length - 1] : document;
  const missing = [];
  if (root !== document && !marked(root)) missing.push(`the open ${describe(root).slice(0, 60)} has no "?"`);
  if (root === document) for (const el of document.querySelectorAll(".rail .foot")) if (drawn(el) && !marked(el)) missing.push("the sidebar's foot");
  for (const el of root.querySelectorAll(head)) if (drawn(el) && !headOk(el)) missing.push(describe(el));
  for (const el of root.querySelectorAll(bodies.join(", "))) {
    if (!drawn(el) || el.closest("td") || el.matches(head)) continue;
    if (marked(el) || underHead(el)) continue;
    missing.push(describe(el));
  }
  const marks = [...root.querySelectorAll("[data-help]")].filter(drawn);
  return {
    missing,
    pending: marks.filter((m) => m.hasAttribute("data-pending")).map((m) => m.dataset.help),
    unknown: marks.filter((m) => m.hasAttribute("data-unknown")).map((m) => m.dataset.help),
    count: marks.length,
  };
}

/**
 * The reward screen the wide-picture view shows: the demo's own first screen with a Forma
 * Blueprint on it (demo/dev-reward-screens.json), whose item art is the widest-looking on a card.
 */
const FORMA_SCREEN = JSON.parse(readFileSync(join(root, "demo/dev-reward-screens.json"), "utf8")).find((s) => s.cards?.includes("Forma Blueprint"));
if (!FORMA_SCREEN) throw new Error("demo/dev-reward-screens.json has no screen with a Forma Blueprint: the wide-picture view needs one");

/**
 * A wide stand-in picture (2:1, two round discs, so a stretch shows at a glance), served in the
 * wide-picture view for every item picture: WFCD's art is square, and a square picture can't show
 * a well that squeezes it. Made here as a PNG, so the sweep needs no picture files of its own.
 */
function widePicture(w = 320, h = 160) {
  const row = w * 4 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const disc = Math.hypot(x - w / 4, y - h / 2) < h * 0.38 ? [127, 209, 224] : Math.hypot(x - (3 * w) / 4, y - h / 2) < h * 0.38 ? [214, 174, 74] : null;
      raw.set(disc ? [...disc, 255] : [40, 46, 54, 255], y * row + 1 + x * 4);
    }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const WIDE_PICTURE = widePicture();

const answers = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
// The demo server (vite.config.ts) tags each demo file with its size and time in demo/.
async function isDemo() {
  const st = statSync(join(root, "demo/dev-market.json"));
  const res = await fetch(new URL("dev-market.json", url)).catch(() => null);
  return res?.headers.get("etag") === `"${st.size}-${Math.round(st.mtimeMs)}"`;
}

let server;
let browser;
let work;
const cleanUp = () => {
  server?.kill();
  if (work) rmSync(work, { recursive: true, force: true });
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanUp();
    void (browser?.close() ?? Promise.resolve()).finally(() => process.exit(130));
  });
}

const pause = (p, ms) => p.waitForTimeout(ms);

/** A page at one window size, the demo loaded, What's New and the Full mode question answered unless asked to show them. */
async function open(size, { firstRun = false, noInventory = false, widePictures = false, reducedMotion = "no-preference" } = {}) {
  const p = await browser.newPage({ viewport: { width: size.w, height: size.h }, reducedMotion });
  await p.route(/warframe\.market/, (r) => r.abort());
  await stopWorldState(p);
  // No inventory read yet: TennoScope's setup steps.
  if (noInventory) await p.route(/\/dev-bundle\.json/, (r) => r.fulfill({ status: 404, body: "" }));
  // The reward screen with the Forma Blueprint, at the time the demo server gives it, and every
  // item picture wide.
  if (widePictures) {
    await p.route(/\/dev-reward-screen\.json/, async (r) => {
      try {
        const res = await r.fetch();
        await r.fulfill({ response: res, json: { ...(await res.json()), cards: FORMA_SCREEN.cards } });
      } catch {} // the page closed while it was asked
    });
    await p.route(/\/WFCD\/warframe-items\/[^/]+\/data\/img\//, (r) => r.fulfill({ contentType: "image/png", body: WIDE_PICTURE }));
  }
  p.on("pageerror", (e) => console.error(`  page error: ${e.message}`));
  await p.addInitScript((first) => {
    try {
      const s = JSON.parse(localStorage.getItem("orbiter-settings") ?? "{}");
      s.newsSeen = "9999";
      // Every page in the sidebar, the three it leaves out to start with (Planner, Browse market,
      // Stats) too, so each is checked.
      s.pagesHidden = [];
      s.simplified = 2;
      // Settings that exist count as asked unless they say otherwise (backend.ts).
      s.fullModeAsked = !first;
      localStorage.setItem("orbiter-settings", JSON.stringify(s));
    } catch {}
  }, firstRun);
  await p.goto(url);
  await pause(p, 6000);
  // Notifications come and go, and would be flagged or cover a view.
  await p.addStyleTag({ content: ".toasts { display: none !important; } [data-sweep] { outline: 2px solid #f00 !important; outline-offset: -1px; }" });
  if (!firstRun) {
    const notNow = p.getByRole("button", { name: /not now/i }).first();
    if (await notNow.count()) {
      await notNow.click();
      await pause(p, 600);
    }
  }
  return p;
}

/**
 * Runs in the page after each Tab: the element focus is on now, whether it was already visited
 * this walk (the walk ends there), and why it can't be seen once focused: its own visibility, or
 * an ancestor that is hidden (the hidden attribute, aria-hidden, opacity 0, or a box a pixel or
 * less across that clips what's in it, as a closed fold does). Its own opacity isn't counted: a
 * checkbox or radio drawn by the page keeps the real one at opacity 0, under its own drawing.
 */
function focusNow() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { none: true };
  const seen = (window.__sweepFocus ??= []);
  const again = seen.includes(el);
  if (!again) seen.push(el);
  const named = (e) => {
    const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("svelte-")).slice(0, 3).join(".") : "";
    return `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${cls ? `.${cls}` : ""}`;
  };
  // Where it is: the nearest two ancestors that have a class or an id.
  const where = [];
  for (let a = el.parentElement; a && a !== document.body && where.length < 2; a = a.parentElement) if (a.id || (typeof a.className === "string" && a.className.trim())) where.push(named(a));
  const place = where.length ? ` in ${where.reverse().join(" > ")}` : "";
  const hidden = [];
  const cs = getComputedStyle(el);
  if (cs.visibility !== "visible") hidden.push(`visibility: ${cs.visibility}`);
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const as = getComputedStyle(a);
    if (a.hidden) hidden.push(`inside hidden ${named(a)}`);
    else if (a.getAttribute("aria-hidden") === "true") hidden.push(`inside aria-hidden ${named(a)}`);
    else if (Number(as.opacity) === 0) hidden.push(`inside opacity 0 ${named(a)}`);
    else if (as.overflowX !== "visible" || as.overflowY !== "visible") {
      const b = a.getBoundingClientRect();
      if (b.width <= 1 || b.height <= 1) hidden.push(`inside closed ${named(a)}`);
    }
  }
  return { again, tag: named(el), place, hidden };
}

const findings = [];
/** Pictures drawn out of their own shape, and how many pictures were looked at. */
const stretched = [];
let picturesChecked = 0;
/** Tags drawn with no words, or words unreadable on their fill, and how many tags were looked at. */
const tagFindings = [];
let tagsChecked = 0;
/** The window sizes where the wide-picture view didn't get the Forma Blueprint's card drawn with its picture. */
const wideMissed = [];
const helpMissing = [];
const helpUnknown = [];
const helpPending = new Map();
let helpMarks = 0;
/** Switches drawn without a name of their own (ui/Switch.svelte's `name`), or with one another switch has. */
const switchFindings = new Map();
let switchesSeen = 0;
const keyFindings = [];
const keyNotes = [];
/** How many elements focus landed on in each view, so a walk that reached nothing shows. */
const keyStops = [];
const shots = [];
async function helpCheck(p, size, view) {
  const c = await p.evaluate(coverage, { heads: PART_HEADS, bodies: PART_BODIES, inside: PART_OF.map((x) => x.selector).join(", ") });
  for (const element of c.missing) helpMissing.push({ size: `${size.w}×${size.h}`, view, element });
  for (const part of c.unknown) helpUnknown.push({ size: `${size.w}×${size.h}`, view, part });
  for (const part of c.pending) helpPending.set(part, helpPending.get(part) ?? view);
  helpMarks += c.count;
  // Every switch on screen by a name of its own: the help's pictures find it by that name.
  const sw = await p.evaluate(() => {
    const drawn = [...document.querySelectorAll("input[role=switch]")].filter((i) => i.closest("label")?.getClientRects().length);
    const names = drawn.map((i) => i.closest("[data-switch]")?.getAttribute("data-switch") ?? "");
    const what = (i) => i.closest("label")?.querySelector(".label")?.textContent?.trim() ?? "a switch";
    return {
      count: drawn.length,
      bad: drawn.flatMap((i, k) => (!names[k] ? [`${what(i)}: no name`] : names.indexOf(names[k]) !== k ? [`${what(i)}: "${names[k]}" is another switch's name too`] : [])),
    };
  });
  switchesSeen += sw.count;
  for (const b of sw.bad) if (!switchFindings.has(b)) switchFindings.set(b, view);
}

async function check(p, size, view) {
  await p.mouse.move(size.w - 5, size.h - 5);
  await pause(p, 500);
  await helpCheck(p, size, view);
  if (coverageOnly) return;
  const found = await p.evaluate(findClipping, DELIBERATE.map(({ selector, why }) => ({ selector, why })));
  for (const f of found) findings.push({ size: `${size.w}×${size.h}`, view, ...f });
  const shapes = await p.evaluate(findStretched, SHAPE_SLACK);
  for (const f of shapes.found) stretched.push({ size: `${size.w}×${size.h}`, view, ...f });
  picturesChecked += shapes.checked;
  const tags = await p.evaluate(findTags, TAG_CONTRAST);
  for (const f of tags.bad) tagFindings.push({ size: `${size.w}×${size.h}`, view, f });
  tagsChecked += tags.checked;
  if (work) {
    const png = join(work, `${size.w}x${size.h}-${String(shots.length).padStart(3, "0")}.png`);
    await p.screenshot({ path: png });
    shots.push({ size, view, png });
  }
  await p.evaluate(() => document.querySelectorAll("[data-sweep]").forEach((e) => e.removeAttribute("data-sweep")));
}

/** The keyboard walk's window size, and the most Tab presses one view gets. */
const KEYS_SIZE = { w: 1280, h: 800 };
const KEYS_CAP = 400;

/**
 * Tab through one view until focus comes back to an element already visited (or KEYS_CAP presses),
 * and note each element that is hidden or has no accessible name. The name is Chromium's own
 * (its accessibility tree, through the DevTools protocol), as a screen reader would get it.
 */
async function tabThrough(p, size, view) {
  await p.mouse.move(size.w - 5, size.h - 5);
  await p.evaluate(() => (window.__sweepFocus = []));
  const cdp = await p.context().newCDPSession(p);
  const nameNow = async () => {
    const { result } = await cdp.send("Runtime.evaluate", { expression: "document.activeElement", objectGroup: "sweep-keys" });
    if (!result.objectId) return "";
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { objectId: result.objectId, fetchRelatives: false });
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "sweep-keys" });
    return (nodes[0]?.name?.value ?? "").trim();
  };
  let visited = 0;
  let cycled = false;
  for (let presses = 0; presses < KEYS_CAP; presses++) {
    await p.keyboard.press("Tab");
    let at = await p.evaluate(focusNow);
    if (at.none) continue;
    if (at.again) {
      cycled = true;
      break;
    }
    visited++;
    // A control shown on focus may still be fading in: look again before calling it hidden.
    if (at.hidden.length) {
      await pause(p, 400);
      at = await p.evaluate(focusNow);
    }
    const name = await nameNow();
    const why = [...at.hidden];
    if (!name) why.push("no accessible name");
    const element = `${at.tag}${name ? ` "${name.replace(/\s+/g, " ").slice(0, 50)}"` : ""}${at.place}`;
    for (const reason of why) keyFindings.push({ size: `${size.w}×${size.h}`, view, element, reason });
  }
  keyStops.push(`${view} ${visited}${cycled ? "" : "+"}`);
  if (!cycled) keyNotes.push(`${view}: focus didn't come back round in ${KEYS_CAP} presses (${visited} elements)`);
  await p.evaluate(() => {
    document.activeElement?.blur?.();
    delete window.__sweepFocus;
  });
  await cdp.detach();
}

/**
 * Runs in the page: each part of a table on the shown page (the table, a body, a row, a cell) that
 * has a transform or a running animation now. The app's engines (WebKitGTK, WebView2) may leave a
 * cell's text undrawn once a transform on its row or body ends (motion.ts), so none may have one.
 * It reads once the page has drawn two more frames, so what it reads is the page as it is then, not
 * as it was in the frame before the click on a page that is slow to draw.
 *
 * A CSS transition of a colour alone (COLOUR_ONLY: a header's text or fill when it becomes the
 * sorted one, or when it is no longer pressed) is not counted: it repaints the cell in its place
 * and moves nothing, so there is no transform to end. Under reduced motion every transition lasts
 * .01 ms (app.css), so each colour change on a cell is a transition that ends with the next frame
 * drawn; on a busy machine that frame can come after a read. Anything else (a transition of any
 * other property, a CSS or script animation, a transform) is counted, however short.
 */
function movingTableParts(colourOnly) {
  return new Promise((done) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const paint = new Set(colourOnly);
        const found = [];
        for (const el of document.querySelectorAll(".pane.shown :is(table, thead, tbody, tfoot, tr, td, th)")) {
          const transform = getComputedStyle(el).transform;
          const anims = el.getAnimations().filter((a) => !(a.transitionProperty && paint.has(a.transitionProperty)));
          if ((transform && transform !== "none") || anims.length) {
            const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("svelte-")).slice(0, 2).join(".") : "";
            const what = anims.map((a) => `${a.transitionProperty ? `a transition of ${a.transitionProperty}` : a.animationName ? `the animation ${a.animationName}` : "a script animation"} ${a.playState} at ${Math.round(Number(a.currentTime ?? 0))} of ${Math.round(Number(a.effect?.getComputedTiming().endTime ?? 0))} ms`).join(", ");
            found.push(`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${transform && transform !== "none" ? ` transform ${transform}` : ""}${anims.length ? ` (${what})` : ""}`);
          }
        }
        done(found);
      }),
    ),
  );
}
/** What a colour-only transition may change: paint, never the box or its place. */
const COLOUR_ONLY = ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color", "caret-color", "fill", "stroke"];

/**
 * Runs in the page: where Orders' table sits and its size, measured from the top of the pane's
 * content (so scrolling doesn't change it), or null while the page isn't at rest: a font loading, a
 * picture in the table's view still loading, or a table part moving (movingTableParts' rule).
 */
function ordersLayout(colourOnly) {
  const pane = document.querySelector(".pane.shown");
  const table = pane?.querySelector("table.orders");
  if (!table || document.fonts.status !== "loaded") return null;
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  if ([...table.querySelectorAll("img")].some((i) => !i.complete && inView(i))) return null;
  const paint = new Set(colourOnly);
  for (const el of table.querySelectorAll(":scope, thead, tbody, tfoot, tr, td, th")) {
    const t = getComputedStyle(el).transform;
    if ((t && t !== "none") || el.getAnimations().some((a) => !(a.transitionProperty && paint.has(a.transitionProperty)))) return null;
  }
  const r = table.getBoundingClientRect();
  return `${r.top - pane.firstElementChild.getBoundingClientRect().top} ${r.width}×${r.height}`;
}

/**
 * Waits until both pages are at rest (ordersLayout) with Orders laid out the same on each, three
 * reads in a row 200 ms apart, for at most 30 s. The two pages show the same demo and reduced motion
 * changes no layout, so they differ only while one is still settling: a line above the table that
 * the app fills in once the page is idle (Sell spares' summary) moves the table by a fraction of a
 * pixel, and every row is then drawn a little differently. Returns null when they are at rest, or
 * what each page showed when they didn't come to rest (the caller reports it: never a pass).
 */
async function notAtRest(pages) {
  let last = null;
  let same = 0;
  let seen = [];
  for (const until = Date.now() + 30000; Date.now() < until; ) {
    seen = await Promise.all(pages.map((p) => p.evaluate(ordersLayout, COLOUR_ONLY)));
    const now = seen.every((l) => l !== null && l === seen[0]) ? seen[0] : null;
    same = now === null ? 0 : now === last ? same + 1 : 1;
    last = now;
    if (same >= 3) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return seen.map((l) => l ?? "not at rest").join(" against ");
}

/** Table parts found moving after a sort on Orders, and how many sorts were tried. */
const sortFindings = [];
let sortsTried = 0;
/**
 * Orders, sorted by each column in turn, both ways, with the pointer off the table: no part of the
 * table may move (a transform or an animation) just after the click or once the list's close-up
 * time (240 ms) has passed, and with reduced motion on the rows read the same at rest as with it
 * off. Each page is its own browser context, so the sort chosen here isn't kept for other views.
 * The first sort waits for both pages to be at rest (notAtRest), and so do the pictures after
 * each sort; pictures that differ are taken once more, at rest again. The fault they look for
 * (cells left undrawn until the pointer passes over them, motion.ts) stays until then, and the
 * pointer is kept off the table, so the second pair can't hide it.
 */
async function sortCheck(size) {
  const pages = [];
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const p = await open(size, { reducedMotion });
    await p.locator("button.nav", { hasText: "Orders" }).first().click();
    await pause(p, 2500);
    pages.push(p);
  }
  const [moving, calm] = pages;
  const heads = await moving.locator(".pane.shown table.orders th.sortable").count();
  if (!heads || (await moving.locator(".pane.shown table.orders tbody tr.order").count()) < 2) {
    sortFindings.push("Orders: no listings to sort, not checked");
  }
  const restless = heads ? await notAtRest(pages) : null;
  if (restless) {
    sortFindings.push(`Orders didn't come to rest in 30 s before the first sort (${restless}), not checked`);
    for (const p of pages) await p.close();
    return;
  }
  const picture = (p) => p.locator(".pane.shown table.orders").screenshot();
  for (let h = 0; h < heads; h++) {
    for (let k = 0; k < 2; k++) {
      const views = [];
      for (const p of pages) {
        const th = p.locator(".pane.shown table.orders th.sortable").nth(h);
        const name = ((await th.textContent()) ?? "").replace(/[▴▾]/g, "").trim();
        await th.click();
        await p.mouse.move(size.w - 5, size.h - 5);
        const when = `${name}, click ${k + 1}${p === calm ? ", reduced motion" : ""}`;
        await pause(p, 40);
        for (const f of await p.evaluate(movingTableParts, COLOUR_ONLY)) sortFindings.push(`${when}, just after: ${f}`);
        await pause(p, 300);
        for (const f of await p.evaluate(movingTableParts, COLOUR_ONLY)) sortFindings.push(`${when}, after 340 ms: ${f}`);
        views.push({ when, order: await p.locator(".pane.shown table.orders tbody tr.order .c-item").allTextContents() });
      }
      sortsTried++;
      const [a, b] = views;
      if (a.order.join("|") !== b.order.join("|")) {
        sortFindings.push(`${a.when}: the rows come in another order with reduced motion on`);
        continue;
      }
      for (let read = 1; read <= 2; read++) {
        const restless = await notAtRest(pages);
        if (restless) {
          sortFindings.push(`${a.when}: Orders didn't come to rest in 30 s after the sort (${restless})`);
          break;
        }
        const [pa, pb] = [await picture(moving), await picture(calm)];
        if (pa.equals(pb)) break;
        if (read === 2) sortFindings.push(`${a.when}: the table at rest isn't drawn the same with reduced motion on`);
      }
    }
  }
  for (const p of pages) await p.close();
}


/** Presses one of the sidebar foot's buttons by its name (`data-item`): in the full sidebar it shows
 *  in the foot; folded, it is in More's menu, opened first. */
async function footItem(p, name) {
  const cell = p.locator(`.rail .foot [data-item='${name}']`);
  if (!(await cell.count())) {
    await p.locator(".rail .foot button.more").click();
    await pause(p, 300);
  }
  await p.locator(`:is(.rail .foot, .moremenu) [data-item='${name}']`).first().click();
}

/** Every view of the demo at one size, `look` called on each. Settings is one view per section
 *  (scrolled into view), or one view when `settingsOnce` (the keyboard walk: its Tab order is the
 *  same whichever section is in view). */
async function walk(size, look, { settingsOnce = false, widePictures = true } = {}) {
  const p = await open(size);
  const labels = await p.locator("button.nav").evaluateAll((els) => els.map((e) => e.querySelector(".lbl")?.textContent?.trim() ?? ""));
  for (const label of labels.filter(Boolean)) {
    await p.locator("button.nav", { hasText: label }).first().click();
    await pause(p, 2500);
    await look(p, size, label);
  }
  // The folded sidebar's More menu, open (drawn over the page: nothing in it may be cut off). The
  // full sidebar shows every button in its foot and has no More.
  const more = p.locator(".rail .foot button.more");
  if (await more.count()) {
    await more.click();
    await pause(p, 400);
    await look(p, size, "More menu");
    await p.keyboard.press("Escape");
    await pause(p, 300);
  }
  // Settings, each section scrolled into view.
  await footItem(p, "Settings");
  await pause(p, 1200);
  if (settingsOnce) await look(p, size, "Settings");
  else {
    const sections = await p.locator(".sheet .body > *").count();
    for (let i = 0; i < sections; i++) {
      const s = p.locator(".sheet .body > *").nth(i);
      await s.evaluate((e) => e.scrollIntoView({ block: "start" }));
      await pause(p, 300);
      const name = (await s.locator("h3").first().textContent({ timeout: 1000 }).catch(() => null))?.trim() || (await s.getAttribute("id"))?.replace(/^settings-/, "") || `part ${i + 1}`;
      await look(p, size, `Settings: ${name}`);
    }
  }
  await p.keyboard.press("Escape");
  await pause(p, 600);
  // Notifications.
  await p.locator("button[data-card='notices']").click();
  await pause(p, 1200);
  await look(p, size, "Notifications");
  await p.keyboard.press("Escape");
  await pause(p, 600);
  // The listing form, from Inventory's first list button.
  await p.locator("button.nav", { hasText: "Inventory" }).first().click();
  await pause(p, 2500);
  // The first list button whose form has fields: an item warframe.market doesn't trade opens a
  // dialog with only Close in it, which says nothing about the form's controls.
  const lists = p.locator("main button.list");
  let formShown = false;
  for (let i = 0, n = Math.min(await lists.count(), 12); i < n && !formShown; i++) {
    // Shown on hover: pressed as a keyboard user would.
    await lists.nth(i).evaluate((b) => b.click());
    await pause(p, 1500);
    if (await p.locator("[role=dialog] input").count()) {
      formShown = true;
      await look(p, size, "Listing form");
    }
    await p.keyboard.press("Escape");
    await pause(p, 400);
  }
  if (!formShown) console.error("  no list button on Inventory opened a listing form: not checked");
  // An item's sheet, from Inventory's first card that has one.
  const cards = p.locator(".pane.shown article.card[role='button']");
  let sheetShown = false;
  for (let i = 0, n = Math.min(await cards.count(), 12); i < n && !sheetShown; i++) {
    await cards.nth(i).click();
    await pause(p, 1500);
    if (await p.locator(".sheet[role=dialog]").count()) {
      sheetShown = true;
      await look(p, size, "Item sheet");
    }
    await p.keyboard.press("Escape");
    await pause(p, 400);
  }
  if (!sheetShown) console.error("  no card on Inventory opened an item sheet: not checked");
  // The buy order form, from Browse market's first Buy order (the order book isn't read: every
  // request to warframe.market is stopped, so the form says so and leaves the price to you).
  await p.locator("button.nav", { hasText: "Browse market" }).first().click();
  await pause(p, 2500);
  const buy = p.locator(".pane.shown button", { hasText: /^Buy order$/ }).first();
  if (await buy.count()) {
    await buy.evaluate((b) => b.click());
    await pause(p, 1500);
    await look(p, size, "Buy dialog");
    await p.keyboard.press("Escape");
    await pause(p, 400);
  } else console.error("  no Buy order button on Browse market: the buy form not checked");
  // The help itself, open over Orders and Sell spares: its first "?" on each.
  for (const label of ["Orders", "Sell spares"]) {
    await p.locator("button.nav", { hasText: label }).first().click();
    await pause(p, 2500);
    const mark = p.locator(".pane.shown [data-help]").first();
    if (!(await mark.count())) {
      console.error(`  no "?" on ${label}: the help not checked there`);
      continue;
    }
    await mark.evaluate((b) => b.click());
    await pause(p, 800);
    await look(p, size, `Help over ${label}`);
    await p.keyboard.press("Escape");
    await pause(p, 400);
  }
  await p.close();
  // The first-run question, and TennoScope's setup steps before anything is read.
  const first = await open(size, { firstRun: true });
  await look(first, size, "First run");
  await first.close();
  const setup = await open(size, { noInventory: true });
  await look(setup, size, "TennoScope setup");
  await setup.close();
  // Current fissure's reward cards with wide pictures (the Forma Blueprint's among them): a
  // picture well that squeezes or stretches its picture shows here first.
  if (widePictures) {
    const wide = await open(size, { widePictures: true });
    await wide.locator("button.nav", { hasText: "Current fissure" }).first().click();
    await pause(wide, 2500);
    // The cards in view and their pictures loaded (they load lazily).
    await wide.locator(".rc").first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await wide.waitForFunction(() => [...document.querySelectorAll(".rc .art img")].every((i) => i.complete), null, { timeout: 15000 }).catch(() => {});
    const reached = await wide.evaluate(() => {
      const card = [...document.querySelectorAll(".rc")].find((c) => /: Forma Blueprint(,|$)/.test(c.getAttribute("aria-label") ?? ""));
      const img = card?.querySelector(".art img");
      return !!img && img.complete && img.naturalWidth > img.naturalHeight;
    });
    if (!reached) wideMissed.push(`${size.w}×${size.h}`);
    await look(wide, size, "Current fissure, wide pictures");
    await wide.close();
  }
}

try {
  const { chromium } = await import("playwright");
  if (await answers()) throw new Error(`something already answers at ${url}: stop it or pick another --port`);
  server = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--port", port, "--strictPort"], {
    cwd: root,
    env: { ...process.env, MYORBITER_DEMO: "1" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  let ended = false;
  server.on("exit", () => (ended = true));
  for (let i = 0; !(await answers()); i++) {
    if (ended) throw new Error("the demo dev server stopped before it answered");
    if (i >= 120) throw new Error(`the demo dev server didn't answer at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (ended || !(await isDemo())) throw new Error(`the server at ${url} isn't the demo one`);
  try {
    browser = await chromium.launch();
  } catch (e) {
    throw new Error(`Playwright's Chromium didn't start (${String(e).split("\n")[0]}). Install it with: npx playwright install chromium`);
  }
  if (out) work = mkdtempSync(join(tmpdir(), "myorbiter-sweep-"));
  for (const size of SIZES) {
    console.log(`${size.w}×${size.h}`);
    await walk(size, check, { widePictures: !coverageOnly });
  }
  // The keyboard, on its own walk so the clipping checks above see the views as before.
  const keys = !coverageOnly && SIZES.some((s) => s.w === KEYS_SIZE.w && s.h === KEYS_SIZE.h);
  if (keys) {
    console.log(`keyboard, ${KEYS_SIZE.w}×${KEYS_SIZE.h}`);
    await walk(KEYS_SIZE, tabThrough, { settingsOnce: true, widePictures: false });
  }
  // Orders sorted by each column: no table part left moving (motion.ts), the same at rest with reduced motion.
  if (keys) {
    console.log(`sorting Orders, ${KEYS_SIZE.w}×${KEYS_SIZE.h}`);
    await sortCheck(KEYS_SIZE);
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const size of SIZES) {
      const mine = shots.filter((s) => s.size === size);
      if (!mine.length) continue;
      const sheet = join(out, `sweep-${size.w}x${size.h}.png`);
      const tiles = mine.flatMap((s) => ["-label", s.view, s.png]);
      execFileSync("magick", ["montage", "-background", "#222", "-fill", "#ddd", "-pointsize", "18", ...tiles, "-tile", "4x", "-geometry", `${Math.round(size.w / 3)}x${Math.round(size.h / 3)}+6+6`, sheet]);
      console.log(sheet);
    }
  }
  const bugs = findings.filter((f) => !f.deliberate);
  const meant = findings.filter((f) => f.deliberate);
  for (const f of bugs) console.log(`CLIPPED ${f.size} ${f.view}: ${f.kind}: ${f.element}${f.by ? ` by ${f.by}` : ""} (${f.detail})`);
  for (const f of meant) console.log(`deliberate ${f.size} ${f.view}: ${f.element} (${f.deliberate})`);
  console.log(`${bugs.length} clipped, ${meant.length} deliberate, ${shots.length || "no"} views saved`);
  // Pictures out of their own shape.
  if (!coverageOnly) {
    for (const f of stretched) console.log(`STRETCHED ${f.size} ${f.view}: ${f.picture}: its own shape ${f.own}, drawn ${f.drawn} (${f.off})`);
    for (const s of wideMissed) console.log(`NOT REACHED ${s}: the reward cards' Forma Blueprint wasn't drawn with a wide picture, so the wells weren't checked with one`);
    console.log(`${stretched.length} pictures out of shape, ${picturesChecked} pictures checked`);
    for (const t of tagFindings) console.log(`TAG ${t.size} ${t.view}: ${t.f}`);
    console.log(`${tagFindings.length} tags without words or unreadable, ${tagsChecked} tags checked`);
  }
  if (keys) {
    for (const f of keyFindings) console.log(`KEYBOARD ${f.size} ${f.view}: ${f.element}: ${f.reason}`);
    for (const n of keyNotes) console.log(`keyboard note: ${n}`);
    console.log(`keyboard stops: ${keyStops.join(", ")}`);
    const unique = new Set(keyFindings.map((f) => `${f.element}|${f.reason}`)).size;
    console.log(`${keyFindings.length} keyboard findings (${unique} distinct element and reason)`);
  }
  // The help: every part with its "?", every "?" naming a part the list knows.
  const missingSeen = new Set();
  for (const f of helpMissing) {
    const k = `${f.view}|${f.element}`;
    if (missingSeen.has(k)) continue;
    missingSeen.add(k);
    console.log(`NO HELP ${f.size} ${f.view}: ${f.element}`);
  }
  for (const f of helpUnknown) console.log(`UNKNOWN HELP ${f.size} ${f.view}: "${f.part}" is in no walk-through`);
  for (const [part, view] of [...helpPending].sort()) console.log(`PENDING HELP ${view}: "${part}" opens a page that isn't written`);
  console.log(`${missingSeen.size} parts without a "?", ${helpUnknown.length} unknown, ${helpPending.size} pending, ${helpMarks} "?" seen`);
  if (keys) {
    for (const f of sortFindings) console.log(`SORT ${f}`);
    console.log(`${sortFindings.length} sort findings, ${sortsTried} sorts on Orders tried both ways of motion`);
  }
  for (const [b, view] of switchFindings) console.log(`SWITCH ${view}: ${b}`);
  console.log(`${switchFindings.size} switches without a name of their own, ${switchesSeen} seen`);
  console.log(requestsLine());
  if (worldStateAsked.count || sortFindings.length || switchFindings.size || bugs.length || stretched.length || tagFindings.length || wideMissed.length || keyFindings.length || missingSeen.size || helpUnknown.length || helpPending.size) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
} finally {
  await browser?.close();
  cleanUp();
}
