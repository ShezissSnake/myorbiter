// Effects like App.svelte's own (no error boundary above them), one of which throws once: for
// tests/effectThrows.test.ts, which checks what still runs after the throw.
export function throwingEffects() {
  const s = $state({ a: 0, b: 0, other: 0, throwOn: -1 });
  const ran = { thrower: [] as number[], after: [] as number[], other: [] as number[], late: [] as number[] };
  const stop = $effect.root(() => {
    // Reads `a`, and throws when `a` reaches `throwOn`.
    $effect(() => {
      const a = s.a;
      ran.thrower.push(a);
      if (a === s.throwOn) throw new Error("an effect failed");
    });
    // Created after the thrower and reading the same value: queued behind it in the same flush.
    $effect(() => {
      ran.after.push(s.a);
    });
    // Reads only `other`, which may change in the same turn as `a`.
    $effect(() => {
      ran.other.push(s.other);
    });
    // Like the save effects App.svelte makes last (persistSettings): reads `b` only.
    $effect(() => {
      ran.late.push(s.b);
    });
  });
  return { s, ran, stop };
}
