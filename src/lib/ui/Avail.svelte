<script lang="ts">
  // Vault state as a struck cartouche. Shape and word together, never colour alone.
  let { v }: { v: string } = $props();
  const label: Record<string, string> = { farmable: "Farmable", vaulted: "Vaulted", resurgence: "Resurgence", unknown: "No relic" };
  const tip: Record<string, string> = {
    farmable: "At least one relic that drops it is in the current drop tables",
    vaulted: "Every relic that drops it is vaulted",
    resurgence: "Vaulted, but Varzia has it in Prime Resurgence right now",
    unknown: "Not found in any relic",
  };
</script>

<span class="cart {v}" title={tip[v]}>{label[v] ?? v}</span>

<style>
  .cart {
    display: inline-block; padding: .2rem .55rem .42rem; clip-path: var(--cartouche);
    font-family: var(--face-register); font-size: .6rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
    white-space: nowrap; background: var(--raised); color: var(--platinum-dim);
  }
  /* Most relics are vaulted, so vaulted is the quiet one (a dark plate, gold letters) and the
     states you can act on stand out: farmable now, or in Varzia's Resurgence. */
  .farmable { background: var(--rule-bright); color: var(--platinum); }
  .vaulted { background: color-mix(in srgb, var(--gold) 9%, var(--well)); color: var(--gold); }
  .resurgence { background: var(--verdigris); color: var(--slab); }
  .unknown { color: var(--platinum-deep); }
</style>
