// Saving the settings on every change. A plain `$state.snapshot(settings)` re-reads (and clones)
// everything, every time: with a long sales log, trade log and value history that's ~100k values
// and 100+ ms per change, even for switching pages. Here each long log is serialized by its own
// effect, and the rest by another, so a change re-reads only the part it touched.
import { HEAVY_SETTINGS, joinSettings, lightSettings, saveSettings, type HeavyKey, type Settings } from "./backend";

/** Call while a component initializes (or inside an effect root). `ready` says loading is done. */
export function persistSettings(get: () => Settings, ready: () => boolean, save: (s: () => Settings) => void = saveSettings) {
  const heavy: Partial<Record<HeavyKey, string>> = {};
  /** Each long log read back from its text, until the text changes (joinSettings). */
  const kept = new Map<HeavyKey, { text: string; value: unknown }>();
  let light = "";
  const queue = () => {
    // Put together only when the save happens: once per burst of changes.
    if (ready()) save(() => joinSettings(light, heavy, kept));
  };
  $effect(() => {
    light = JSON.stringify(lightSettings(get()));
    queue();
  });
  for (const [a, b] of HEAVY_SETTINGS) {
    $effect(() => {
      const s = get();
      heavy[`${a}.${b}`] = JSON.stringify((s[a] as unknown as Record<string, unknown>)[b]);
      queue();
    });
  }
}
