// What a control does, for the keyboard too. Every button, chip and figure carries its explanation
// in `title`, which the browser only shows to a mouse resting on it. Tabbing onto one shows the
// same text in a tip under it, until focus moves on.

let tip: HTMLDivElement | null = null;

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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}
