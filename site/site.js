// MyOrbiter's site, the landing page's one script: the tour's sections as tabs, the screenshot
// viewer, the visitor's platform first among the downloads, and the licence block opened when its
// link is followed. Plain script, no library. It works on this page only: it sends nothing,
// requests nothing (a large screenshot loads from the site when it is opened), keeps nothing.
// Without it the page still reads top to bottom: every section in turn, every screenshot a link to
// its large file, every download listed (site/README.md). scripts/site.mjs --check holds it to
// that: no address, no request, no storage, no markup built from text.
"use strict";

// Loaded in the head: until the page is wired, show only the first section, so it doesn't unfold
// and fold again (site.css, .js:not(.ready)).
document.documentElement.classList.add("js");

/** Motion answers an action only, short, opacity only, and not at all under reduced motion. */
function fadeIn(el) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !el.animate) return;
  el.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
}

/** Every screenshot by its file: the page's name, a caption, the text for who can't see it, and
 *  its two files. In page order: Home, then each section's pages. */
const shots = new Map();
function remember(el, small, alt) {
  const file = el.dataset.shot || el.dataset.pick;
  if (!file || shots.has(file)) return;
  shots.set(file, { file, name: el.dataset.name, caption: el.dataset.caption, alt, small, large: el.href });
}

function tour() {
  const list = document.querySelector(".tabs");
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
  if (panels.some((p) => !p)) return;
  for (const [i, panel] of panels.entries()) {
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tabs[i].id);
    const well = panel.querySelector("a.shot");
    const img = well.querySelector("img");
    const cap = panel.querySelector("figcaption");
    // A chip that names a page with a screenshot becomes a button that shows it here.
    for (const a of panel.querySelectorAll("a.chip[data-pick]")) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.pick = a.dataset.pick;
      b.setAttribute("aria-pressed", String(a.hasAttribute("aria-current")));
      b.append(...a.childNodes);
      a.replaceWith(b);
      b.addEventListener("click", () => {
        const s = shots.get(b.dataset.pick);
        for (const c of panel.querySelectorAll("button.chip")) c.setAttribute("aria-pressed", String(c === b));
        if (well.dataset.shot === s.file) return;
        well.href = s.large;
        well.dataset.shot = s.file;
        img.alt = s.alt;
        img.setAttribute("src", s.small);
        cap.querySelector("b").textContent = s.name;
        cap.querySelector("span").textContent = s.caption;
        fadeIn(img);
      });
    }
  }
  function select(i, focus, quiet) {
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(j === i));
      t.tabIndex = j === i ? 0 : -1;
      panels[j].hidden = j !== i;
    });
    if (focus) tabs[i].focus();
    if (!quiet) fadeIn(panels[i]);
  }
  tabs.forEach((t, i) => t.addEventListener("click", () => select(i, false, false)));
  // Arrow keys move along the tabs (and wrap), Home and End to the first and last.
  list.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const n = tabs.length;
    const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select(to, true, false);
  });
  list.hidden = false;
  // A link to a section (#sec-trade) opens its tab, on arrival and when followed later.
  const linked = () => panels.findIndex((p) => `#${p.id}` === location.hash);
  select(Math.max(linked(), 0), false, true);
  addEventListener("hashchange", () => { if (linked() >= 0) select(linked(), false, false); });
}

/** The viewer: a screenshot large, with its caption, previous and next (and the arrow keys), Esc
 *  and Close (a plain button: no form, which the content security policy's form-action 'none'
 *  would judge). The large file is asked for only here, when it is opened. */
function viewer() {
  const dlg = document.getElementById("viewer");
  if (!dlg || typeof dlg.showModal !== "function") return;
  const img = dlg.querySelector("img");
  const name = dlg.querySelector("figcaption b");
  const cap = dlg.querySelector("figcaption .cap");
  const count = dlg.querySelector("figcaption .count");
  const list = () => [...shots.values()];
  let at = 0;
  let opener = null;
  function show(i) {
    const all = list();
    at = (i + all.length) % all.length;
    const s = all[at];
    name.textContent = s.name;
    cap.textContent = s.caption;
    count.textContent = `${at + 1} / ${all.length}`;
    img.alt = s.alt;
    // The small picture (already here) while the large one loads, then the large one.
    img.setAttribute("src", s.small);
    const big = new Image();
    big.addEventListener("load", () => { if (dlg.open && list()[at] === s) img.setAttribute("src", s.large); });
    big.setAttribute("src", s.large);
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.shot");
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    opener = a;
    show(list().findIndex((s) => s.file === a.dataset.shot));
    dlg.showModal();
  });
  dlg.querySelector(".close").addEventListener("click", () => dlg.close());
  dlg.querySelector(".prev").addEventListener("click", () => { show(at - 1); fadeIn(img); });
  dlg.querySelector(".next").addEventListener("click", () => { show(at + 1); fadeIn(img); });
  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    show(at + (e.key === "ArrowRight" ? 1 : -1));
    fadeIn(img);
  });
  // A click outside the viewer's plate (on the dimmed page) closes it, as Esc does.
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
  dlg.addEventListener("close", () => {
    img.removeAttribute("src");
    opener?.focus();
  });
}

/** The visitor's platform, from the browser's own user agent, read here and sent nowhere. Phones,
 *  tablets, Chromebooks, Macs, ARM and BSD get no guess: the list stays as it is. A Steam Deck's
 *  desktop browser says only Linux, and gets the same AppImage under Linux's name. */
function platform() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|CrOS|Macintosh|aarch64|\barmv?\d|BSD/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return "windows";
  if (/Steam ?Deck|SteamOS/i.test(ua)) return "deck";
  if (/Linux/i.test(ua)) return "linux";
  return null;
}
function downloads() {
  const key = platform();
  const li = key && document.querySelector(`.dl[data-platform="${key}"]`);
  if (!li) return;
  const link = li.querySelector("a");
  li.parentElement.prepend(li);
  li.classList.add("mine");
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = "Your platform";
  link.append(tag);
  // The head's button: this platform's file, and under it which build and the other platforms.
  const get = document.querySelector(".hero .get");
  const label = get?.querySelector("span");
  if (!get || !label) return;
  const build = label.textContent.replace(/^Download\s*/, "");
  get.href = link.href;
  label.textContent = `Download for ${li.dataset.name}`;
  const line = document.querySelector(".hero .for");
  if (!line) return;
  const file = li.querySelector(".file")?.textContent ?? "";
  line.textContent = `${[build, file].filter(Boolean).join(" · ")} · `;
  const others = document.createElement("a");
  others.href = "#download";
  others.textContent = "Other platforms";
  line.append(others);
  line.hidden = false;
}

/** "Licence and sources" is folded; a link to it opens it. */
function licence() {
  const box = document.getElementById("licence");
  if (!box) return;
  const follow = () => { if (location.hash === "#licence") box.open = true; };
  follow();
  addEventListener("hashchange", follow);
  // Followed again while the address already ends in #licence: no hashchange, so open it here too.
  document.addEventListener("click", (e) => { if (e.target.closest?.('a[href$="#licence"]')) box.open = true; });
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    // Home's, then every page's with a screenshot in the tour, in the order they are listed.
    const hero = document.querySelector(".hero a.shot");
    if (hero) remember(hero, hero.querySelector("img").getAttribute("src"), hero.querySelector("img").alt);
    for (const a of document.querySelectorAll("a.chip[data-pick]")) remember(a, a.dataset.small, a.dataset.alt);
    tour();
    viewer();
    downloads();
    licence();
  } finally {
    document.documentElement.classList.add("ready");
  }
});
