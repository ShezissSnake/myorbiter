# Proposals

Changes found while testing that needed approval (dependencies, lockfiles, workflows, the CSP or
capabilities, licences, signing), each with what, why and the change. All three below are settled;
what's still open is said in each.

## 1. The MSRV

Settled: the MSRV is Rust 1.95, the lowest the lockfile builds with for every release target (on
Linux `muda` needs 1.90; on Windows `sysinfo` needs 1.95). `rust-version` says 1.95 in
`src-tauri/Cargo.toml`, `crates/myorbiter-data/Cargo.toml` and `tennoscope/Cargo.toml`, and
the pipeline's `test` job (`.gitlab-ci.yml`) checks MyOrbiter's crates on it (Linux only; the Windows
check is in `windows.md`).

## 2. Audit results

- **npm audit** (`package-lock.json`): 2 low, both the `deepmerge` advisory, reached only through
  `@sveltejs/vite-plugin-svelte`, a development dependency that runs in the build, not in the app.
  Accepted; it goes when the plugin's update drops it. TennoScope's app: 0.
- **cargo audit**, MyOrbiter (`Cargo.lock`): no vulnerabilities. The warnings all come through Tauri
  and its Linux stack (unmaintained `proc-macro-error`, `rustls-pemfile`, `zbus_names`, `zvariant`,
  `zvariant_derive`; unsound `glib 0.18.5`, whose `VariantStrIter` MyOrbiter doesn't call; yanked
  `async-executor 1.14.0`) and go when Tauri moves its own dependencies. The yanked one could be
  bumped on its own with `cargo update -p async-executor` (a lockfile change, so it waits for
  approval).
- **cargo audit**, TennoScope (`tennoscope/Cargo.lock`): no vulnerabilities. The four `zip 4.6.1`
  advisories (RUSTSEC-2026-0367, -0368, -0369, -0429) went with `tauri-plugin-updater` 2.14 and
  `zip 9.3.0`, so the audit (now in the pipeline's `test` job) needs no ignores for them (GitHub
  pull request #38 removed them from the old workflow).
- **Unused code:** no `TODO`, `FIXME`, `XXX` or `HACK` in MyOrbiter's own code. Exports used nowhere
  were removed. Helpers used only by tests are in `tests/support/`, except `loadoutItems`,
  `suggestionNames` and `recipeItems`, which stay in `src/` because they list module-private
  tables.

## 3. IPC: what the page can ask the Rust side to do (2026-11-06)

All 74 commands in `generate_handler!` (`src-tauri/src/lib.rs`) were read for input checks, file
reach, URL and program reach, and what a compromised page or a crafted data file could make them
do. Most hold: market calls go to warframe.market only, with ids and slugs checked; Nox's Frame
is fetched by checked segment only, spaced and capped; caches and saved files have fixed names;
TennoScope is asked only four fixed things; the updater needs a signature.

**Fixed in Rust (no approval needed):**

- On Windows, a path the page sends (TennoScope's folder, EE.log, TennoScope's program) must start
  with a drive letter: a network path (`\\host\share\…`) made Windows connect to that host, and
  hand it the user's sign-in, just to look, and the program path could start a program from a
  share. (`local_path` in `lib.rs`, used by `checked_path` and `companion::check_custom`.)
- `discord_post` posts at most 20 times a minute.
- `user_slug` needs a name to start with a letter or digit: "." and ".." turned the profile URL
  into another warframe.market path.
- `export_file` always creates a new file (never through a link already there) and refuses more
  than 16 MiB.
- `log_line` turns control characters into spaces, so the page can't write lines that look like
  MyOrbiter's own into the log (which goes into bug reports).

**Done.** One line each, in the order of the list below:

1. Done: Settings' Choose opens a native file dialog from Rust (`tennoscope_choose_program`); the
   page can only open it or have MyOrbiter find TennoScope again, and the old `tennoscope.path` in
   the page's settings is no longer taken over.
2. Done: `core:default` is replaced by `core:event:allow-listen` and `core:event:allow-unlisten`;
   one start checked on Linux, starts on Windows and macOS still to check.
3. Done: installing an older build also needs a yes in a native dialog that names both builds.
4. Done: warframe.market changes are capped at 120 in any minute in `market.rs` (a change past it
   waits); a plan of 100 at the usual 400 ms spacing stays under it.
5. Done: `discord_post` sends only to an address confirmed in a native dialog the first time the
   page posts to it, kept in MyOrbiter's config folder (`discord-webhook`), not in the settings;
   after one no, nothing new is asked about until MyOrbiter restarts.

The dialogs open from Rust (`tauri-plugin-dialog`, Cargo only), so the page has no dialog
permission and no `@tauri-apps/plugin-dialog`.

**The proposals as written** (each needed a dependency, the capability, or the release flow):

1. **TennoScope's program chosen in a file dialog, not typed** (`tennoscope_set_path`). The page
   can still name any file called `tennoscope`/`tennoscope.exe`/`TennoScope….AppImage` on a local
   drive (Downloads, say) and start it. The real fix is that only a native file dialog sets it:
   `tauri-plugin-dialog` (a new dependency) and `dialog:allow-open` in
   `src-tauri/capabilities/default.json`; `tennoscope_set_path` would then take no path from the
   page at all. A smaller step without the plugin: refuse paths under the Downloads and temp folders
   in `check_custom` (it would also refuse a TennoScope someone keeps in Downloads on purpose).
2. **Narrow `core:default`** in `src-tauri/capabilities/default.json` to the core permissions the
   page uses (window, event, app version, path resolution as needed). `core:default` also lets the
   page create windows and webviews and read paths such as the home folder. It needs a list of what
   `@tauri-apps/api` calls the page makes, then a trial run.
3. **No silent downgrade** (`updates_install` with `older: true`): a page can install and restart
   into an older signed build with no click. A floor compiled into each build (refuse versions
   below the release it shipped from minus N), or a native confirmation for a step back, closes
   it; both touch the release and channel flow.
4. **A cap on warframe.market writes from the page** (for example 60 a minute across create,
   update, close, delete, auctions and +rep), so a page gone wrong can't rewrite every listing at
   once. Rust only, but it changes how Sell spares' Apply and the repricer pace themselves (a plan
   of 100 changes would take two minutes), so it's a product decision.
5. **The Discord webhook bound to settings**: `discord_post` could refuse any address but the one in
   settings.json. It only narrows the leak (a compromised page can save a new address first); a
   confirmation outside the page when the address changes would close it, which needs the dialog
   plugin too.
