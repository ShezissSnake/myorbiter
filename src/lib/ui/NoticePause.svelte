<script lang="ts">
  // The pause for all notifications: off, an hour, until 8 tomorrow morning, or until turned off.
  // One setting (notifyOptions), shown in Settings, Notifications and under the bell alike.
  import type { Settings } from "../backend";

  let { settings = $bindable(), now }: { settings: Settings; now: number } = $props();

  const pausedFor = $derived(settings.notifyOptions.pausedUntil != null && settings.notifyOptions.pausedUntil > now);
  const pauseChoice = $derived(settings.notifyOptions.paused ? "on" : pausedFor ? (settings.notifyOptions.pausedHow ?? "hour") : "off");
  function pause(how: "off" | "hour" | "tomorrow" | "on") {
    const o = settings.notifyOptions;
    if (how === "off") {
      o.paused = false;
      o.pausedUntil = null;
    } else if (how === "on") {
      o.paused = true;
      o.pausedUntil = null;
    } else {
      o.paused = false;
      o.pausedHow = how;
      const d = new Date();
      if (how === "hour") o.pausedUntil = Date.now() + 3_600_000;
      else {
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        o.pausedUntil = +d;
      }
    }
  }
  const hhmm = (t: number) => new Date(t).toLocaleString(undefined, { weekday: new Date(t).toDateString() === new Date().toDateString() ? undefined : "short", hour: "2-digit", minute: "2-digit" });
</script>

<div class="pause">
  <span class="register">Pause</span>
  <div class="pausebtns" role="radiogroup" aria-label="Pause notifications">
    <button role="radio" aria-checked={pauseChoice === "off"} class:on={pauseChoice === "off"} title="Notifications pop up as they come" onclick={() => pause("off")}>Off</button>
    <button role="radio" aria-checked={pauseChoice === "hour"} class:on={pauseChoice === "hour"} title="Nothing pops up for an hour; they still go in Recent" onclick={() => pause("hour")}>1 hour</button>
    <button role="radio" aria-checked={pauseChoice === "tomorrow"} class:on={pauseChoice === "tomorrow"} title="Nothing pops up until 8 tomorrow morning; they still go in Recent" onclick={() => pause("tomorrow")}>Until tomorrow</button>
    <button role="radio" aria-checked={pauseChoice === "on"} class:on={pauseChoice === "on"} title="Nothing pops up until you set this back to Off; they still go in Recent" onclick={() => pause("on")}>Until I turn it off</button>
  </div>
  <span class="dim small">{pauseChoice === "hour" || pauseChoice === "tomorrow" ? `Paused until ${hhmm(settings.notifyOptions.pausedUntil!)}. ` : pauseChoice === "on" ? "Paused. " : ""}While paused, notifications still go in Recent, under the envelope, so you can catch up.</span>
</div>

<style>
  .pause { display: grid; gap: .45rem; }
  .pausebtns { display: flex; flex-wrap: wrap; gap: 0; }
  .pausebtns button { margin-left: -1px; padding: .35rem .7rem; font-size: 11px; transition: border-color var(--quick); }
  .pausebtns button.on { color: var(--slab); background: var(--platinum); border-color: var(--platinum); }
</style>
