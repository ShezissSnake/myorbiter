<script lang="ts">
  // A square button that is just an icon. Its label is both the tooltip and what a screen reader
  // reads, so the action is never only a picture.
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";

  let {
    icon,
    label,
    title,
    tone = "",
    size = 14,
    class: cls = "",
    ...rest
  }: {
    icon: string;
    /** What it does, in a few words: "Remove", "Sold one". */
    label: string;
    /** A longer tooltip, when the label alone doesn't say enough. */
    title?: string;
    /** gold (the main action), good (done), danger (red once you reach for it), quiet (no frame until hovered). */
    tone?: "" | "gold" | "good" | "danger" | "quiet" | "danger quiet" | "gold quiet";
    size?: number;
  } & Omit<HTMLButtonAttributes, "title"> = $props();
</script>

<button type="button" class="ib {tone} {cls}" aria-label={label} title={title ?? label} {...rest}><Icon name={icon} {size} /></button>
