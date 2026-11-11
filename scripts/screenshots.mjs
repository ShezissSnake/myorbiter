// The screenshots in docs/screenshots/ (1440×900, at twice those pixels) and site/shots/ (1280×800:
// the picture on the page at those pixels, and the large one the site opens on a click at twice
// them, in site/shots/large/), taken from the invented account (`npm run dev:demo`, demo/), never
// from public/dev-*.json.
//
//   npm run screenshots [-- --port 1431] [-- --only site|docs|help] [-- --id <walk-through>] [-- --check]
//
// `--only help` takes the help's pictures instead (scripts/help-shots.mjs: public/help/ and
// src/lib/help/pictures.json), all of them or one walk-through's with --id. It runs under tsx (the
// npm script does), since the help list is TypeScript. With --check it takes no pictures and only
// lists the help's selectors that match nothing.
//
// It installs Playwright's Chromium if it isn't there yet (`playwright install chromium`, into
// Playwright's own cache folder: `npm install` never downloads a browser), starts the demo dev
// server on its own port, checks that the server answering is that one, opens each page in
// Chromium, saves WebP files over the ones in the repository, and stops the server. Needs
// ImageMagick (`magick`) for the WebP files. The demo's order books and price histories are files
// in demo/; the worldstate is read live (demo/README.md), so Home and Current fissure change from
// run to run. Nothing but GET requests would reach warframe.market.

import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? process.argv[portArg + 1] : "1431";
if (!/^[0-9]{2,5}$/.test(port ?? "")) throw new Error(`not a port: ${port}`);
const playwright = dirname(createRequire(import.meta.url).resolve("playwright"));
const { chromium } = await import("playwright");
const url = `http://localhost:${port}/`;

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > 0 ? process.argv[onlyArg + 1] : null;
if (only !== null && only !== "site" && only !== "docs" && only !== "help") throw new Error(`--only takes site, docs or help, not ${only}`);
const idArg = process.argv.indexOf("--id");
const helpId = idArg > 0 ? process.argv[idArg + 1] : null;

// Pages, in the order the app's sidebar has them, and what each needs before its picture.
const SHOTS = [
  { name: "home", nav: "Home" },
  { name: "current-fissure", nav: "Current fissure" },
  { name: "relics", nav: "Relics" },
  { name: "mastery", nav: "Mastery" },
  { name: "foundry", nav: "Foundry" },
  {
    name: "builds",
    nav: "Builds",
    async prepare(p) {
      const find = p.locator("input[placeholder^='Find a warframe']:visible").first();
      await find.click();
      await find.fill("Saryn Prime");
      await p.waitForTimeout(1200);
      await p.keyboard.press("Enter");
      await p.waitForTimeout(3000);
    },
  },
  { name: "inventory", nav: "Inventory" },
  {
    name: "orders",
    nav: "Orders",
    async prepare(p) {
      await p.getByRole("button", { name: /^check prices/i }).first().click();
      await p.waitForTimeout(20000);
    },
  },
  {
    name: "sell-spares",
    nav: "Sell spares",
    async prepare(p) {
      await p.locator(".planbtn").first().click();
      await p.waitForTimeout(20000);
    },
  },
];
// Which pages each set takes: the README's six, and the site's tour (src/lib/pages.ts' sections)
// with Home. `large`: a second file at twice the pixels, under large/.
const SIZES = {
  docs: { w: 1440, h: 900, out: "docs/screenshots", pages: ["home", "current-fissure", "foundry", "builds", "orders", "sell-spares"] },
  site: { w: 1280, h: 800, out: "site/shots", large: true, pages: ["home", "current-fissure", "relics", "mastery", "builds", "inventory", "orders", "sell-spares"] },
};

const answers = async () => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};

// The demo server (vite.config.ts) tags each demo file with its size and time in demo/; a server
// that answers from public/ doesn't.
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

try {
  // The one step that downloads a browser; quick when it's there already.
  execFileSync(process.execPath, [join(playwright, "cli.js"), "install", "chromium"], { stdio: "inherit" });
  if (await answers()) throw new Error(`something already answers at ${url}: stop it or pick another --port`);
  server = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "--port", port, "--strictPort"], {
    cwd: root,
    env: { ...process.env, MYORBITER_DEMO: "1" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  let ended = false;
  server.on("exit", () => (ended = true));
  server.on("error", (e) => {
    ended = true;
    console.error(e.message);
  });
  for (let i = 0; !(await answers()); i++) {
    if (ended) throw new Error("the demo dev server stopped before it answered");
    if (i >= 120) throw new Error(`the demo dev server didn't answer at ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (ended || !(await isDemo())) throw new Error(`the server at ${url} isn't the demo one`);

  work = mkdtempSync(join(tmpdir(), "myorbiter-shots-"));
  browser = await chromium.launch();
  if (only === "help") {
    const { takeHelp } = await import("./help-shots.mjs");
    await takeHelp(browser, url, root, work, helpId, process.argv.includes("--check"));
  }
  for (const [kind, { w, h, out, pages, large }] of Object.entries(SIZES)) {
    if (only && kind !== only) continue;
    if (large) mkdirSync(join(root, out, "large"), { recursive: true });
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.route(/warframe\.market/, (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
    p.on("pageerror", (e) => console.error(`${kind}: ${e.message}`));
    // What's New, and on a first start the Full mode question, would open over the first page.
    await p.addInitScript(() => {
      try {
        const s = JSON.parse(localStorage.getItem("orbiter-settings") ?? "{}");
        s.newsSeen = "9999";
        s.fullModeAsked = true;
        localStorage.setItem("orbiter-settings", JSON.stringify(s));
      } catch {}
    });
    await p.goto(url);
    await p.waitForTimeout(8000);
    // Notifications come and go, and would cover part of a page.
    await p.addStyleTag({ content: ".toasts { display: none !important; }" });
    const nav = async (label) => {
      await p.locator("button.nav", { hasText: label }).first().click();
      await p.waitForTimeout(2500);
    };
    await nav("Home");
    const notNow = p.getByRole("button", { name: /not now/i }).first();
    if (await notNow.count()) {
      await notNow.click();
      await p.waitForTimeout(800);
    }
    for (const shot of SHOTS.filter((s) => pages.includes(s.name))) {
      await nav(shot.nav);
      if (shot.prepare) await shot.prepare(p);
      // The pointer in a corner, so no hover card shows.
      await p.mouse.move(w - 5, h - 5);
      await p.waitForTimeout(400);
      const png = join(work, `${kind}-${shot.name}.png`);
      await p.screenshot({ path: png });
      const webp = (file, ...resize) => {
        execFileSync("magick", [png, ...resize, "-strip", "-quality", "80", "-define", "webp:method=6", join(root, out, file)]);
        console.log(`${out}/${file}`);
      };
      if (large) {
        // The page's picture at the window's own pixels, the large one at twice them.
        webp(`${shot.name}.webp`, "-resize", `${w}x${h}`);
        webp(`large/${shot.name}.webp`);
      } else {
        webp(`${shot.name}.webp`);
      }
    }
    await p.close();
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  cleanUp();
}
