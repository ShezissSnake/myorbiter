<script lang="ts">
  // Full mode's warning, word for word (FULL_MODE_WARNING), with the page it ends on as a control
  // that opens it, as the Guide's trust section does: the warning names the page, and this is where
  // a player reads it before choosing. Only the page's name is the control, plain text inside an
  // inline button (no "Opening…" swap, whose grid would break the sentence), so the text shown,
  // read aloud and quoted in the docs stays the same. Drawn inside the first start's question and
  // beside the Full mode switch and button: opening the page answers nothing and flips nothing.
  import { FULL_MODE_WARNING } from "./FullMode.svelte";
  import { PRIVACY_PAGE } from "./core/links";
  import { links, openUrl } from "./links.svelte";

  // `disabled`: the first start's question, in its first moment, when a click meant for the page
  // behind would land on it.
  let { disabled = false }: { disabled?: boolean } = $props();

  // Read at render, not as this module loads: FullMode.svelte imports this component.
  const at = FULL_MODE_WARNING.indexOf(PRIVACY_PAGE.label);
  const before = FULL_MODE_WARNING.slice(0, at);
  const after = FULL_MODE_WARNING.slice(at + PRIVACY_PAGE.label.length);

  function open(e: MouseEvent) {
    // The click is the link's alone: nothing around it (the question, the switch's row) acts on it.
    e.preventDefault();
    e.stopPropagation();
    void openUrl(PRIVACY_PAGE.url);
  }
</script>

{before}<button type="button" class="link pagename" {disabled} title="Open the page in your browser" aria-busy={links.isOpening(PRIVACY_PAGE.url)} onclick={open}>{PRIVACY_PAGE.label}</button>{after}

<style>
  /* In the sentence: its words as the sentence has them (size, case, spacing), underlined, on the
     sentence's own line height (a link inside a sentence, so not the 24 px of a .link on its own);
     still clickable where the switch's row takes no pointer (TennoScope not running). */
  .pagename { display: inline; font: inherit; letter-spacing: inherit; text-transform: none; min-height: 0; color: var(--platinum); text-align: start; pointer-events: auto; }
</style>
