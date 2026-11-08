// The clipping sweep: opens every view of the demo (`npm run dev:demo`, demo/: the invented
// account, never public/dev-*.json) at the window sizes MyOrbiter is used at, and flags every
// element cut off by a box that doesn't scroll, or pushed past the window, and every text that
// runs out of its own box without an ellipsis. Exits 1 when it finds one.
//
//   npm run sweep [-- --port 1432] [-- --out <folder>] [-- --only 1280x800]
//
// Headless Chromium, so it runs without a display server. It uses Playwright's Chromium if it's
// installed (`npx playwright install chromium` puts it in Playwright's own cache) and stops with
// that hint if not: it never downloads anything itself. MyOrbiter itself draws with WebKitGTK on
// Linux and WebView2 on Windows; text widths differ a little between engines, which is why the
// layouts this checks are meant to hold with room to spare. With --out, one contact sheet per
// window size (every view, flagged elements outlined in red) is saved there as PNG; needs
// ImageMagick (`magick`). Nothing but GET requests would reach warframe.market.

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const port = arg("--port") ?? "1432";
if (!/^[0-9]{2,5}$/.test(port)) throw new Error(`not a port: ${port}`);
const out = arg("--out") ? resolve(arg("--out")) : null;
const url = `http://localhost:${port}/`;

/** The app's minimum window (src-tauri/tauri.conf.json), the Steam Deck, a common laptop, 1080p. */
const SIZES = [
  { w: 900, h: 560 },
  { w: 1280, h: 800 },
  { w: 1366, h: 768 },
  { w: 1920, h: 1080 },
].filter((s) => !arg("--only") || arg("--only") === `${s.w}x${s.h}`);

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
    process.exit(130);
  });
}

const pause = (p, ms) => p.waitForTimeout(ms);

/** A page at one window size, the demo loaded, What's New and the Full mode question answered unless asked to show them. */
async function open(size, { firstRun = false, noInventory = false } = {}) {
  const p = await browser.newPage({ viewport: { width: size.w, height: size.h } });
  await p.route(/warframe\.market/, (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
  // No inventory read yet: TennoScope's setup steps.
  if (noInventory) await p.route(/\/dev-bundle\.json/, (r) => r.fulfill({ status: 404, body: "" }));
  p.on("pageerror", (e) => console.error(`  page error: ${e.message}`));
  await p.addInitScript((first) => {
    try {
      const s = JSON.parse(localStorage.getItem("orbiter-settings") ?? "{}");
      s.newsSeen = "9999";
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

const findings = [];
const shots = [];
async function check(p, size, view) {
  await p.mouse.move(size.w - 5, size.h - 5);
  await pause(p, 500);
  const found = await p.evaluate(findClipping, DELIBERATE.map(({ selector, why }) => ({ selector, why })));
  for (const f of found) findings.push({ size: `${size.w}×${size.h}`, view, ...f });
  if (work) {
    const png = join(work, `${size.w}x${size.h}-${String(shots.length).padStart(3, "0")}.png`);
    await p.screenshot({ path: png });
    shots.push({ size, view, png });
  }
  await p.evaluate(() => document.querySelectorAll("[data-sweep]").forEach((e) => e.removeAttribute("data-sweep")));
}

async function sweep(size) {
  const p = await open(size);
  const labels = await p.locator("button.nav").evaluateAll((els) => els.map((e) => e.querySelector(".lbl")?.textContent?.trim() ?? ""));
  for (const label of labels.filter(Boolean)) {
    await p.locator("button.nav", { hasText: label }).first().click();
    await pause(p, 2500);
    await check(p, size, label);
  }
  // Settings, each section scrolled into view.
  await p.locator("button[aria-label='Settings']").click();
  await pause(p, 1200);
  const sections = await p.locator(".sheet .body > *").count();
  for (let i = 0; i < sections; i++) {
    const s = p.locator(".sheet .body > *").nth(i);
    await s.evaluate((e) => e.scrollIntoView({ block: "start" }));
    await pause(p, 300);
    const name = (await s.locator("h3").first().textContent({ timeout: 1000 }).catch(() => null))?.trim() || (await s.getAttribute("id"))?.replace(/^settings-/, "") || `part ${i + 1}`;
    await check(p, size, `Settings: ${name}`);
  }
  await p.keyboard.press("Escape");
  await pause(p, 600);
  // Notifications.
  await p.locator("button[data-card='notices']").click();
  await pause(p, 1200);
  await check(p, size, "Notifications");
  await p.keyboard.press("Escape");
  await pause(p, 600);
  // The listing form, from Inventory's first list button.
  await p.locator("button.nav", { hasText: "Inventory" }).first().click();
  await pause(p, 2500);
  const list = p.locator("main button.list").first();
  if (await list.count()) {
    // Shown on hover: pressed as a keyboard user would.
    await list.evaluate((b) => b.click());
    await pause(p, 1500);
    await check(p, size, "Listing form");
    await p.keyboard.press("Escape");
  } else console.error("  no list button on Inventory: listing form not checked");
  await p.close();
  // The first-run question, and TennoScope's setup steps before anything is read.
  const first = await open(size, { firstRun: true });
  await check(first, size, "First run");
  await first.close();
  const setup = await open(size, { noInventory: true });
  await check(setup, size, "TennoScope setup");
  await setup.close();
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
    await sweep(size);
  }
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const size of SIZES) {
      const mine = shots.filter((s) => s.size === size);
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
  if (bugs.length) process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
} finally {
  await browser?.close();
  cleanUp();
}
