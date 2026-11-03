// use:trap on a dialog or panel: while it's open, Tab and Shift+Tab stay inside it and Esc closes
// it (onescape); closed, the keyboard goes back to what opened it. Dialogs can open over panels
// (the listing form over an item's details): only the one on top has the keyboard.

const open: HTMLElement[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** What Tab can reach inside `root`, in order: the visible, enabled controls. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

export interface TrapOptions {
  /** Esc: close it. Left out, Esc is the page's to handle. */
  onescape?: () => void;
}

export function trap(node: HTMLElement, options: TrapOptions = {}) {
  let opts = options;
  const active = document.activeElement;
  const opener = active instanceof HTMLElement && active !== document.body && !node.contains(active) ? active : null;
  open.push(node);
  // After the dialog has drawn: the focus goes in, unless the dialog has put it on a field already.
  queueMicrotask(() => {
    if (node.isConnected && !node.contains(document.activeElement)) node.focus();
  });

  function onKey(e: KeyboardEvent) {
    if (open[open.length - 1] !== node) return;
    if (e.key === "Escape" && opts.onescape) {
      e.preventDefault();
      e.stopPropagation();
      opts.onescape();
      return;
    }
    if (e.key !== "Tab") return;
    const target = e.target instanceof Node ? e.target : null;
    const inside = !!target && node.contains(target);
    const els = focusables(node);
    if (!els.length) {
      e.preventDefault();
      node.focus();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    if (!inside) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && (target === first || target === node)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && target === last) {
      e.preventDefault();
      first.focus();
    }
  }
  window.addEventListener("keydown", onKey);

  return {
    update(next: TrapOptions = {}) {
      opts = next;
    },
    destroy() {
      window.removeEventListener("keydown", onKey);
      const i = open.indexOf(node);
      if (i >= 0) open.splice(i, 1);
      // Back where it was, unless something else took the focus meanwhile (another panel opening).
      setTimeout(() => {
        const now = document.activeElement;
        if (opener?.isConnected && (!now || now === document.body || node.contains(now))) opener.focus();
      });
    },
  };
}
