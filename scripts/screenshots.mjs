// The screenshots in docs/screenshots/ (1440×900) and site/shots/ (1280×800), both at twice those
// pixels, taken from the invented account (`npm run dev:demo`, demo/), never from public/dev-*.json.
//
//   PLAYWRIGHT=<folder of a playwright package> node scripts/screenshots.mjs [--port 1431]
//
// It starts the demo dev server on its own port, checks that the server answering is that one,
// opens each page in Chromium, saves WebP files over the ones in the repository, and stops the
// server. Needs Playwright with its Chromium (`npx playwright install chromium`), which isn't one
// of the project's dependencies: install it in a folder of its own and point PLAYWRIGHT at its
// node_modules/playwright. Needs ImageMagick (`magick`) for the WebP files. The demo's order books
// and price histories are files in demo/; only item pictures come from warframe.market, and
// nothing but GET requests reach it.

import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? process.argv[portArg + 1] : "1431";
if (!/^[0-9]{2,5}$/.test(port ?? "")) throw new Error(`not a port: ${port}`);
if (!process.env.PLAYWRIGHT) {
  console.error("Set PLAYWRIGHT to a playwright package folder (see the top of this file).");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(resolve(process.env.PLAYWRIGHT));
const url = `http://localhost:${port}/`;

// Pages, in the order the app's sidebar has them, and what each needs before its picture.
const SIZES = { docs: { w: 1440, h: 900, out: "docs/screenshots" }, site: { w: 1280, h: 800, out: "site/shots" } };
const SHOTS = [
  { name: "home", nav: "Home" },
  { name: "current-fissure", nav: "Current fissure" },
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
  for (const [kind, { w, h, out }] of Object.entries(SIZES)) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.route(/warframe\.market/, (r) => (r.request().method() === "GET" ? r.continue() : r.abort()));
    p.on("pageerror", (e) => console.error(`${kind}: ${e.message}`));
    // What's New would open over the first page.
    await p.addInitScript(() => {
      try {
        const s = JSON.parse(localStorage.getItem("orbiter-settings") ?? "{}");
        s.newsSeen = "9999";
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
    for (const shot of SHOTS) {
      await nav(shot.nav);
      if (shot.prepare) await shot.prepare(p);
      // The pointer in a corner, so no hover card shows.
      await p.mouse.move(w - 5, h - 5);
      await p.waitForTimeout(400);
      const png = join(work, `${kind}-${shot.name}.png`);
      await p.screenshot({ path: png });
      execFileSync("magick", [png, "-strip", "-quality", "80", "-define", "webp:method=6", join(root, out, `${shot.name}.webp`)]);
      console.log(`${out}/${shot.name}.webp`);
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
