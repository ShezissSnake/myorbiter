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
