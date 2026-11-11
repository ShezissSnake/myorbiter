// The help's pictures (src/lib/help/, the "?" on every part): each page of a walk-through that has
// a `shot` is taken from the invented account, cropped to its part with a little room round it,
// marked as the page says (white numbered diamonds or arrows with straight or 45° leaders, or an
// outline in the section's colour with the rest dimmed), and written to public/help/ as WebP, with
// src/lib/help/pictures.json recording each one's definition hash, size and bytes. A selector that
// matches nothing stops the run. Run through scripts/screenshots.mjs:
//
//   npm run screenshots -- --only help [--id orders]
//
// Pictures are taken at twice the window's pixels and kept at most MAX_W pixels wide, at the
// highest WebP quality that keeps them under MAX_BYTES.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pictures } from "../src/lib/help/index.ts";
import { pageById } from "../src/lib/pages.ts";

const MAX_W = 1200;
const MAX_BYTES = 60 * 1024;
const PAD = 16;

/** Takes the pictures (all, or one walk-through's with `id`) and rewrites the manifest. */
export async function takeHelp(browser, url, root, work, id = null) {
  const out = join(root, "public/help");
  const manifestFile = join(root, "src/lib/help/pictures.json");
  mkdirSync(out, { recursive: true });
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
  const all = pictures();
  const todo = all.filter((x) => !id || x.wt.id === id);
  if (id && !todo.length) throw new Error(`no walk-through ${id} with pictures`);

  // One window per size, reused while the size stays the same.
  let p = null;
  let size = "";
  for (const x of todo) {
    const [w, h] = x.shot.size ?? [1280, 800];
    if (`${w}x${h}` !== size) {
      await p?.close();
      p = await openApp(browser, url, w, h);
      size = `${w}x${h}`;
    }
    const where = `${x.wt.id}, page ${x.i + 1}`;
    await reach(p, x.shot, where);
    const clip = await mark(p, x.shot, where);
    const png = join(work, `${x.file}.png`);
    await p.screenshot({ path: png, clip });
    await p.evaluate(() => document.getElementById("help-shot-marks")?.remove());
    const file = join(out, x.file);
    const bytes = toWebp(png, file);
    // The size it is shown at, in CSS pixels: the file holds twice as many (fewer past MAX_W).
    manifest[x.file] = { hash: x.hash, w: Math.round(clip.width), h: Math.round(clip.height), bytes };
    console.log(`public/help/${x.file}  ${Math.round(bytes / 1024)} KB`);
  }
  await p?.close();

  // Pictures no page has any more go, from the folder and the manifest.
  const wanted = new Set(all.map((x) => x.file));
  for (const f of readdirSync(out)) if (f.endsWith(".webp") && !wanted.has(f)) rmSync(join(out, f));
  for (const f of Object.keys(manifest)) if (!wanted.has(f)) delete manifest[f];
  const sorted = Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]]));
  writeFileSync(manifestFile, `${JSON.stringify(sorted, null, 2)}\n`);
  const total = Object.values(sorted).reduce((n, m) => n + m.bytes, 0);
  console.log(`${Object.keys(sorted).length} pictures, ${Math.round(total / 1024)} KB in all`);
}

async function openApp(browser, url, w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.route(/warframe\.market/, (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  p.on("pageerror", (e) => console.error(`help: ${e.message}`));
  // Every page in the sidebar (Planner and Browse market are hidden to start), What's New and the
  // Full mode question seen, calm motion so nothing is caught half-way.
  await p.addInitScript(() => {
    try {
      const s = JSON.parse(localStorage.getItem("orbiter-settings") ?? "{}");
      s.newsSeen = "9999";
      s.fullModeAsked = true;
      s.pagesHidden = [];
      s.simplified = 2;
      // The demo account has sold nothing yet, so Sales would show only its empty state: a few
      // invented sales over the last weeks, kept in this throwaway browser only.
      s.market = s.market ?? {};
      if (!Array.isArray(s.market.sales) || !s.market.sales.length) {
        const day = 86_400_000;
        const now = Date.now();
        const sold = [
          ["Paris Prime Set", null, 1, 26, 24, 1],
          ["Arcane Energize", 5, 1, 142, 139, 2],
          ["Blood Rush", 0, 2, 9, 10, 3],
          ["Primed Continuity", 10, 1, 250, 262, 5],
          ["Boltor Prime Set", null, 1, 95, 98, 6],
          ["Condition Overload", 0, 1, 18, 17, 8],
          ["Arcane Grace", 0, 3, 34, 36, 9],
          ["Galvanized Chamber", 0, 1, 14, 12, 12],
          ["Paris Prime Set", null, 1, 24, 25, 15],
          ["Organ Shatter", 0, 2, 4, 3, 18],
          ["Molt Augmented", 0, 1, 23, 24, 22],
          ["Primary Merciless", 5, 1, 104, 110, 26],
        ];
        s.market.sales = sold.map(([item, rank, quantity, platinum, median, ago]) => ({ at: now - ago * day - 3_600_000 * (ago % 7), item, rank, quantity, platinum, median }));
      }
      localStorage.setItem("orbiter-settings", JSON.stringify(s));
    } catch {}
  });
  await p.emulateMedia({ reducedMotion: "reduce" });
  // The first load compiles the app: slow on a busy machine.
  await p.goto(url, { timeout: 180_000 });
  await p.waitForTimeout(8000);
  await p.addStyleTag({ content: ".toasts { display: none !important; }" });
  const notNow = p.getByRole("button", { name: /not now/i }).first();
  if (await notNow.count()) {
    await notNow.click();
    await p.waitForTimeout(800);
  }
  return p;
}

/** Opens the shot's page fresh (closing whatever is open) and runs its steps. */
async function reach(p, shot, where) {
  for (let i = 0; i < 3 && (await p.locator("[aria-modal='true']").count()); i++) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
  }
  if (shot.open === "settings") {
    await p.locator(".rail .foot button[title^='Settings']").first().click();
  } else {
    const label = pageById[shot.open]?.label;
    if (!label) throw new Error(`${where}: no page ${shot.open}`);
    // Through Home, so the page opens as a visit does (scrolled to the top, folds shut).
    await p.locator("button.nav[title^='Home:']").first().click();
    await p.waitForTimeout(600);
    await p.locator(`button.nav[title^='${label}:']`).first().click();
    // Each page's code loads on its first visit: wait for it to draw.
    await p.waitForSelector("#main .pane.shown .page-inner", { timeout: 120_000 });
  }
  await p.waitForTimeout(2500);
  for (const step of shot.steps ?? []) {
    if ("click" in step) {
      const el = p.locator(step.click).first();
      await el.waitFor({ timeout: 30_000 }).catch(() => {});
      if (!(await el.count())) throw new Error(`${where}: nothing to click at ${step.click}`);
      await el.click();
      await p.waitForTimeout(900);
    } else if ("fill" in step) {
      const el = p.locator(step.fill).first();
      await el.waitFor({ timeout: 30_000 }).catch(() => {});
      if (!(await el.count())) throw new Error(`${where}: nothing to type into at ${step.fill}`);
      await el.fill(step.text);
      await p.waitForTimeout(900);
    } else if ("press" in step) {
      await p.keyboard.press(step.press);
      await p.waitForTimeout(600);
    } else if ("wait" in step) {
      await p.waitForTimeout(step.wait);
    }
  }
  await p.mouse.move(2, 2);
  await p.waitForTimeout(400);
}

/** Draws the marks over the window and returns the piece to crop, in CSS pixels. */
async function mark(p, shot, where) {
  // The part and the marks are plain CSS, found the way the page finds them (:has(> …) included).
  const found = (sel) => p.evaluate((q) => !!document.querySelector(q), sel);
  // A page can draw a moment after it opens (its figures worked out first).
  await p.waitForFunction((q) => !!document.querySelector(q), shot.part, { timeout: 30_000 }).catch(() => {});
  if (!(await found(shot.part))) throw new Error(`${where}: no part at ${shot.part}`);
  await p.evaluate((q) => document.querySelector(q).scrollIntoView({ block: "center", inline: "nearest" }), shot.part);
  await p.waitForTimeout(500);
  for (const m of shot.marks) {
    await p.waitForFunction((q) => !!document.querySelector(q), m.at, { timeout: 15_000 }).catch(() => {});
    if (!(await found(m.at))) throw new Error(`${where}: no mark target at ${m.at}`);
  }
  const res = await p.evaluate(
    ({ part, marks, pad }) => {
      const NS = "http://www.w3.org/2000/svg";
      const vw = innerWidth;
      const vh = innerHeight;
      const box = (el) => el.getBoundingClientRect();
      // Every match of the part's selector, taken together (a table's head and its first rows).
      const parts = [...document.querySelectorAll(part)];
      const partEl = parts[0];
      const rs = parts.map(box);
      const pr = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
      const sec = getComputedStyle(partEl).getPropertyValue("--sec").trim() || "#c9a24a";
      const svg = document.createElementNS(NS, "svg");
      svg.id = "help-shot-marks";
      svg.setAttribute("width", String(vw));
      svg.setAttribute("height", String(vh));
      svg.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      const add = (tag, attrs, parent = svg) => {
        const el = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        parent.appendChild(el);
        return el;
      };
      let x0 = pr.left;
      let y0 = pr.top;
      let x1 = pr.right;
      let y1 = pr.bottom;
      const grow = (l, t, r, b) => {
        x0 = Math.min(x0, l);
        y0 = Math.min(y0, t);
        x1 = Math.max(x1, r);
        y1 = Math.max(y1, b);
      };
      const outlines = [];
      const late = [];
      for (const m of marks) {
        const r = box(document.querySelector(m.at));
        if (m.is === "outline") {
          outlines.push(r);
          continue;
        }
        const from = m.from ?? "left";
        const side = from === "corner" ? "left" : from;
        // The point marked, on the element's edge facing the marker, and the marker 22 px out
        // from it (straight across, or up at 45° for an arrow).
        const edge = { left: [r.left, r.top + r.height / 2], right: [r.right, r.top + r.height / 2], top: [r.left + r.width / 2, r.top], bottom: [r.left + r.width / 2, r.bottom] }[side];
        const dir = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[side];
        if (m.is === "n" && from === "corner") {
          // A badge on the element's top-left corner, where there's no room for a leader.
          // Mostly outside, up and to the left, so it doesn't cover the element's own label.
          const cx = r.left - 4;
          const cy = r.top - 6;
          late.push(() => {
            add("rect", { x: cx - 11, y: cy - 11, width: 22, height: 22, fill: "#101215", stroke: "#fff", "stroke-width": 1.5 });
            const t = add("text", { x: cx, y: cy + 0.5, fill: "#fff", "font-size": 13, "font-weight": 700, "font-family": getComputedStyle(document.body).fontFamily, "text-anchor": "middle", "dominant-baseline": "central" });
            t.textContent = String(m.n ?? "");
          });
          grow(cx - 14, cy - 14, cx + 14, cy + 14);
        } else if (m.is === "n") {
          const gap = 20;
          const cx = edge[0] + dir[0] * (gap + 11);
          const cy = edge[1] + dir[1] * (gap + 11);
          late.push(() => {
            add("line", { x1: edge[0] + dir[0] * 3, y1: edge[1] + dir[1] * 3, x2: cx - dir[0] * 11, y2: cy - dir[1] * 11, stroke: "#fff", "stroke-width": 1.5 });
            add("rect", { x: cx - 11, y: cy - 11, width: 22, height: 22, fill: "#101215", stroke: "#fff", "stroke-width": 1.5 });
            const t = add("text", { x: cx, y: cy + 0.5, fill: "#fff", "font-size": 13, "font-weight": 700, "font-family": getComputedStyle(document.body).fontFamily, "text-anchor": "middle", "dominant-baseline": "central" });
            t.textContent = String(m.n ?? "");
          });
          grow(cx - 14, cy - 14, cx + 14, cy + 14);
        } else {
          // An arrow: a 45° leader from below or above the element's side, its head on the edge.
          const [ox, oy] = { left: [-1, 1], right: [1, 1], top: [-1, -1], bottom: [-1, 1] }[side];
          const tx = edge[0] + dir[0] * 3;
          const ty = edge[1] + dir[1] * 3;
          const sx = tx + ox * 26;
          const sy = ty + oy * 26;
          late.push(() => {
            add("line", { x1: sx, y1: sy, x2: tx, y2: ty, stroke: "#fff", "stroke-width": 2 });
            const a = Math.atan2(ty - sy, tx - sx);
            const hx = (k) => tx - 9 * Math.cos(a + k);
            const hy = (k) => ty - 9 * Math.sin(a + k);
            add("path", { d: `M${tx} ${ty}L${hx(0.5)} ${hy(0.5)}L${hx(-0.5)} ${hy(-0.5)}Z`, fill: "#fff" });
          });
          grow(Math.min(sx, tx) - 6, Math.min(sy, ty) - 6, Math.max(sx, tx) + 6, Math.max(sy, ty) + 6);
        }
      }
      const clip = {
        x: Math.max(0, Math.floor(x0 - pad)),
        y: Math.max(0, Math.floor(y0 - pad)),
      };
      clip.width = Math.min(vw, Math.ceil(x1 + pad)) - clip.x;
      clip.height = Math.min(vh, Math.ceil(y1 + pad)) - clip.y;
      if (outlines.length) {
        // The rest of the piece dimmed, the outlined ones clear, each edged in the section colour.
        const holes = outlines.map((r) => `M${r.left - 4} ${r.top - 4}h${r.width + 8}v${r.height + 8}h${-(r.width + 8)}Z`).join("");
        add("path", { d: `M0 0H${vw}V${vh}H0Z${holes}`, fill: "rgba(6,7,9,0.62)", "fill-rule": "evenodd" });
        for (const r of outlines) add("rect", { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8, fill: "none", stroke: sec, "stroke-width": 2 });
      }
      for (const f of late) f();
      document.body.appendChild(svg);
      return { clip, offscreen: pr.bottom > vh + 1 || pr.top < -1 };
    },
    { part: shot.part, marks: shot.marks, pad: PAD },
  );
  if (res.offscreen) console.warn(`${where}: the part runs past the window; give the shot a taller size`);
  return res.clip;
}

/** The PNG as WebP, at most MAX_W wide, at the best quality under MAX_BYTES. Returns its bytes. */
function toWebp(png, file) {
  for (const q of [82, 74, 66, 58, 50, 42]) {
    execFileSync("magick", [png, "-resize", `${MAX_W}x>`, "-strip", "-quality", String(q), "-define", "webp:method=6", file]);
    const bytes = statSync(file).size;
    if (bytes <= MAX_BYTES) return bytes;
  }
  throw new Error(`${file}: over ${MAX_BYTES / 1024} KB even at quality 42; crop it smaller`);
}
