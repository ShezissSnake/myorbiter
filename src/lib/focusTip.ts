// What a control does, for the keyboard too. Every button, chip and figure carries its explanation
// in `title`, which the browser only shows to a mouse resting on it. Tabbing onto one shows the
// same text in a tip under it, until focus moves on. In a menu (the sidebar's More) a tip under an
// entry would cover the next ones, where the arrow keys go: there it goes beside the menu.

let tip: HTMLDivElement | null = null;

type Box = { left: number; top: number; right: number; bottom: number };
const GAP = 8;

/**
 * Where a menu entry's tip goes: beside the menu, to its right, else to its left, level with the
 * entry and kept inside the window; null when it fits on neither side (no tip then).
 */
export function besideMenu(menu: Box, item: Box, size: { w: number; h: number }, view: { w: number; h: number }): { left: number; top: number } | null {
  const top = Math.max(GAP, Math.min(item.top, view.h - size.h - GAP));
  if (view.w - menu.right - 2 * GAP >= size.w) return { left: menu.right + GAP, top };
  if (menu.left - 2 * GAP >= size.w) return { left: menu.left - GAP - size.w, top };
  return null;
}

function hide() {
  tip?.remove();
  tip = null;
}

function show(el: HTMLElement) {
  const text = el.getAttribute("title")?.trim();
  if (!text) return hide();
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "focus-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  const r = el.getBoundingClientRect();
  const menu = el.closest<HTMLElement>("[role=menu]");
  if (menu) {
    const m = menu.getBoundingClientRect();
    // As wide as the wider side allows (up to the usual 360), then measured and placed.
    const room = Math.min(360, Math.max(window.innerWidth - m.right, m.left) - 2 * GAP);
    tip.style.maxWidth = `${Math.max(0, room)}px`;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const t = tip.getBoundingClientRect();
    const at = room > 0 ? besideMenu(m, r, { w: t.width, h: t.height }, { w: window.innerWidth, h: window.innerHeight }) : null;
    if (!at) return hide();
    tip.style.left = `${at.left}px`;
    tip.style.top = `${at.top}px`;
    return;
  }
  const w = Math.min(360, window.innerWidth - 16);
  tip.style.maxWidth = `${w}px`;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
  // Under the control, or over it when there's no room below.
  const below = r.bottom + 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${below}px`;
  const h = tip.getBoundingClientRect().height;
  if (below + h > window.innerHeight - 8) tip.style.top = `${Math.max(8, r.top - h - 8)}px`;
}

export function installFocusTips(): void {
  document.addEventListener("focusin", (e) => {
    const el = e.target as HTMLElement | null;
    // Only for the keyboard: a click focuses too, and the mouse has the browser's own tooltip.
    if (!el?.matches?.(":focus-visible")) return hide();
    // Text fields: their placeholder and label say enough, and a tip would cover what you type.
    if (el.matches("input:not([type=checkbox]):not([type=radio]), textarea, select")) return hide();
    show(el);
  });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}
