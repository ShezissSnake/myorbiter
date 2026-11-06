# Proposals

Changes found while testing that need the maintainer's approval (dependencies, lockfiles,
workflows, the CSP or capabilities, licences, signing), written up with what, why and the diff.
Nothing here has been applied.

## 1. The MSRV no longer builds: `dlopen2_derive 0.4.3` needs edition 2024

**What.** `cargo +1.77.2 check --workspace --tests --locked` fails before compiling anything:

```text
error: failed to download `dlopen2_derive v0.4.3`
Caused by: failed to parse manifest at `…/dlopen2_derive-0.4.3/Cargo.toml`
Caused by: feature `edition2024` is required
```

`Cargo.lock` holds `dlopen2_derive 0.4.3` (through Tauri's `dlopen2`), whose manifest declares
`edition = "2024"`, which Cargo only reads from 1.85 on. So the workspace hasn't built on Rust
1.77.2 (`rust-version` in `src-tauri/Cargo.toml`, and the rule in `CLAUDE.md`) since that
version came in; nothing tests it, because the release builds use the current stable toolchain.

**Why it matters.** The rule "keep code building on 1.77.2" can't currently be checked, so code
that needs a newer compiler would go unnoticed.

**Options** (each a lockfile or toolchain change, so not made here):

1. Pin the dependency back to a release that still declares edition 2021, if Tauri's `dlopen2`
   allows it (which release that is hasn't been checked here: look at each version's
   `Cargo.toml` on crates.io first):

   ```bash
   cargo update -p dlopen2_derive --precise <version>
   ```

   then check the result builds on both toolchains. Dependabot will propose it again, so this
   needs an ignore rule in `.github/dependabot.yml` too.
2. Raise the MSRV to 1.85 (the first Cargo that reads edition 2024): `rust-version = "1.85"` in
   `src-tauri/Cargo.toml` and `crates/orbiter-data/Cargo.toml`, the line in `CLAUDE.md`, and the
   note there about rustfmt. This is the smaller change if nothing needs 1.77.2 any more.
3. Either way, add a CI check that builds on the MSRV, so it can't drift silently again:

   ```diff
   --- a/.github/workflows/audit.yml
   +++ b/.github/workflows/audit.yml
   @@ jobs:
   +  msrv:
   +    name: Builds on the MSRV
   +    runs-on: ubuntu-24.04
   +    steps:
   +      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0
   +        with:
   +          persist-credentials: false
   +      - name: cargo check on rust-version
   +        run: |
   +          v=$(sed -n 's/^rust-version = "\(.*\)"/\1/p' src-tauri/Cargo.toml)
   +          rustup toolchain install "$v" --profile minimal
   +          sudo apt-get update && sudo apt-get install --no-install-recommends -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev
   +          cargo "+$v" check --workspace --tests --locked
   ```

The code written in this round uses only long-stable APIs (`str::is_char_boundary`, `get()` on
slices, `u32::try_from`), so it builds wherever the rest does.

## 2. Audit results (report only; nothing changed)

Run on 2026-11-05 against `main`.

### npm audit

- **orbiter** (`package-lock.json`): 2 low, 0 moderate or worse. Both are one advisory,
  `deepmerge` (mergeObject() allows prototype poisoning of returned objects), reached through
  `@sveltejs/vite-plugin-svelte`, a development dependency: it runs in the build, not in the app,
  and merges the build's own configuration. **Accepted (2026-11-06):** no action; taken whenever
  Dependabot's update of the plugin drops it.
- **TennoScope** (`tennoscope/app`, pnpm): 0.

### cargo audit

- **orbiter** (`Cargo.lock`): 0 vulnerabilities. Warnings, all through Tauri and its Linux stack:
  unmaintained `proc-macro-error 1.0.4`, `rustls-pemfile 2.2.0`, `zbus_names` (3.0.0, 4.3.5),
  `zvariant` (4.2.0, 5.15.1), `zvariant_derive` (4.2.0, 5.15.1); unsound `glib 0.18.5`
  (RUSTSEC-2024-0429, its `VariantStrIter`, which orbiter doesn't call); yanked
  `async-executor 1.14.0`. They go when Tauri moves its own dependencies; the yanked one can be
  bumped on its own with `cargo update -p async-executor` (a lockfile change, so not made here).
- **TennoScope** (`tennoscope/Cargo.lock`): 4 vulnerabilities, all `zip 4.6.1`
  (RUSTSEC-2026-0367, -0368, -0369, -0429: extracting a hostile archive). These are the four
  `audit.yml` already ignores, with its reason: only `tauri-plugin-updater`'s Windows path extracts
  an archive, after its signature checks out, and the TennoScope inside orbiter never runs its
  updater; they go when TennoScope moves to `tauri-plugin-updater` 2.14 (zip 9). Warnings:
  unmaintained `paste`, `proc-macro-error`, the `unic-*` crates, `zbus_names`, `zvariant`,
  `zvariant_derive`; unsound `glib 0.18.5`; yanked `async-executor 1.14.0`, `clipboard-win 5.4.1`.

### Unused code

No `TODO`, `FIXME`, `XXX` or `HACK` is left in orbiter's own code (`src/`, `src-tauri/src/`,
`crates/`, `scripts/`, `tests/`).

**Done (2026-11-06):** the seven exports used nowhere were deleted; of the ten used only by
tests, `ducatRows`, `installedShards` and `helminthAbilities` (app logic the app no longer used)
were deleted with their tests, and `suggestAll`, `suggestVariants`, `FRAME_NAMES` and
`loadoutModNames` (test helpers) moved to `tests/support/builds.ts`. `loadoutItems`,
`suggestionNames` and `recipeItems` stay where they are: they list module-private tables
(`SET_COMPANION`, `KUBROWS`, `FAMILIES`, `MELEE`, the wiki's recipe list) for the tests' catalog
checks, so moving them would mean exporting those tables instead.

Exported from `src/` and used nowhere, not even in its own file, as found:

| File | Export |
| --- | --- |
| `src/lib/core/advice.ts` | `TRACE_COST` |
| `src/lib/core/bulk.ts` | `RULE_OF`, `modSparesUnder` |
| `src/lib/core/redact.ts` | `redactLines` |
| `src/lib/core/relicData.ts` | `relicDataNews` |
| `src/lib/core/sparesRules.ts` | `sellAsWords` |
| `src/lib/core/untrusted.ts` | `hasHidden` |

Used only by the tests, never by the app (each has tests; either the app lost its use for it, or
it's kept for tests on purpose; worth a look before deleting):

| File | Export |
| --- | --- |
| `src/lib/core/advice.ts` | `ducatRows` |
| `src/lib/core/builds/suggest.ts` | `FRAME_NAMES`, `suggestVariants`, `suggestAll`, `loadoutModNames`, `loadoutItems`, `suggestionNames` |
| `src/lib/core/notNeeded.ts` | `installedShards`, `helminthAbilities` |
| `src/lib/core/recipes.ts` | `recipeItems` |

About 200 more exports are used only inside their own file; the `export` could go, at no gain
but a tidier surface, so they're not listed.
