// use:trap on a dialog or panel: while it's open, Tab and Shift+Tab stay inside it and Esc closes
// it (onescape); closed, the keyboard goes back to what opened it. Dialogs can open over panels
// (the listing form over an item's details): only the one on top has the keyboard.

const open: HTMLElement[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/**
 * Whether Tab can land on `el`: it has a box, isn't `visibility: hidden` (a page kept in the DOM
 * after it was left has boxes but no focus), and isn't inside something hidden or inert. The
 * computed visibility is inherited, so a hidden ancestor hides its children too, unless one of
 * them has put `visibility: visible` back, and that one can be focused.
 */
export function reachable(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden], [inert]");
}

/** What Tab can reach inside `root`, in order: the visible, enabled controls. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable);
}

export interface TrapOptions {
  /** Esc: close it. Left out, Esc is the page's to handle. */
  onescape?: () => void;
  /**
   * Whether the trap holds the keyboard. Always on unless false: a panel kept in the DOM while it's
   * closed turns it off, and each time it turns on the focus goes in and, when it turns off again,
   * back to what had it before.
   */
  active?: boolean;
  /** False: closing leaves the focus alone, for a dialog that puts it back itself (the help). */
  restore?: boolean;
}

export function trap(node: HTMLElement, options: TrapOptions = {}) {
  let opts = options;
  let on = false;
  let opener: HTMLElement | null = null;

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

  function engage() {
    on = true;
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body && !node.contains(active) ? active : null;
    open.push(node);
    // After the dialog has drawn: the focus goes in, unless the dialog has put it on a field already.
    queueMicrotask(() => {
      if (on && node.isConnected && !node.contains(document.activeElement)) node.focus();
    });
    window.addEventListener("keydown", onKey);
  }

  function release() {
    on = false;
    window.removeEventListener("keydown", onKey);
    const i = open.indexOf(node);
    if (i >= 0) open.splice(i, 1);
    const from = opts.restore === false ? null : opener;
    opener = null;
    // Back where it was, unless something else took the focus meanwhile (another panel opening).
    setTimeout(() => {
      const now = document.activeElement;
      if (from?.isConnected && (!now || now === document.body || node.contains(now))) from.focus();
    });
  }

  if (opts.active !== false) engage();

  return {
    update(next: TrapOptions = {}) {
      opts = next;
      const want = next.active !== false;
      if (want && !on) engage();
      else if (!want && on) release();
    },
    destroy() {
      if (on) release();
    },
  };
}
