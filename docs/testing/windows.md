# What needs a real Windows check

The Windows-only code was read, and the fixes below were made, but none of it can run in a Linux
container (cross-compiling stops at the C parts of `ring` and `rusqlite`). Each line is a check to
do on Windows 10 or 11 with the setup.exe of a release build.

## Checked from Linux, by reading the code and compiling for Windows (2026-11-06)

What can be settled without a Windows machine. Each line says how it was checked.

- [x] **orbiter compiles for Windows on its MSRV, Rust 1.95**: `cargo +1.95 check --locked
      --target x86_64-pc-windows-gnu` in `src-tauri/` (with `crates/orbiter-data`, and
      `sysinfo` 0.39.6 as on `main`) finishes with no error. It only type-checks: the release
      build is MSVC (`windows-latest`, current stable), and nothing is linked or run. Its five
      warnings are `rendering.rs`'s Linux-only helpers (`WEBKIT_VARS`, `vars_for`, `decide`,
      `flag_in`, `Mode`'s variants) that aren't behind `cfg(target_os = "linux")`: dead code on
      Windows, harmless. Run again once the `sysinfo` 0.40 update is merged.
- [x] **TennoScope's app compiles for Windows on 1.95** too (`cargo +1.95 check --locked --target
      x86_64-pc-windows-gnu -p tennoscope` in `tennoscope/`). Its workspace still says
      `rust-version = "1.85"`, which `sysinfo` no longer builds with on Windows; only orbiter's
      crates are held to their MSRV in CI (`msrv.yml`).
- [x] **Where files go**:
      - TennoScope's folder: `%APPDATA%\io.github.deftera186.tennoscope`
        (`orbiter_data::default_tennoscope_dir`).
      - Warframe's log: `%LOCALAPPDATA%\Warframe\EE.log` (`ee_log.rs`).
      - TennoScope's and orbiter's logs: `%LOCALAPPDATA%\<id>\logs`, as Tauri keeps them
        (`reward_log.rs`, `applog.rs`).
      - Settings and caches: Tauri's `app_config_dir`, `%APPDATA%\dev.orbiter.app`.
      - CSV exports: the Downloads folder (`download_dir`), or the home folder without one.

      All come from the platform's folders, not from HOME, and none is built with `/`.
- [x] **Network paths are refused** wherever the page sends a path (`local_path`, `lib.rs`): it
      takes only a drive letter (`C:\…`, `\\?\C:\…`), so `\\host\share` and
      `\\?\UNC\…` are refused. A network share mapped to a drive letter (`Z:\`) still
      passes: it's a drive the player mapped. The tests are `#[cfg(windows)]`, so they run only
      on Windows.
- [x] **The installer** (`tauri.windows.conf.json`):
      - NSIS, for the current user (`installMode: currentUser`, no administrator), English only,
        no language selector.
      - WebView2 is fetched by its bootstrapper, silently, if it's missing. Windows 11 and
        updated Windows 10 have it already, so a first install on an old Windows 10 needs the
        internet.
      - The updater runs the new setup.exe `passive` (`tauri.conf.json`, `plugins.updater`): a
        progress window, no questions.
      - The setup.exe isn't code-signed, so SmartScreen warns the first time (README).
- [ ] `sysinfo`, `companion.rs` and `windows_proc.rs` (TennoScope started, found and stopped on
      Windows) weren't read for this: the `sysinfo` 0.40 pull request changes them. Read them
      once it's merged.

Everything below needs a Windows machine.

## Changed in this round, never run on Windows (needs a Windows machine)

- [ ] **Network paths are refused** (`local_path`, src-tauri/src/lib.rs): Settings → TennoScope's
      folder set to `\\localhost\c$\Users\<you>\AppData\Roaming\io.github.deftera186.tennoscope`
      says "give a folder on this computer"; the same folder as `C:\Users\…` works. Same for
      Warframe's EE.log and TennoScope's program. `cargo test` on Windows also runs
      `local_path_tests` (they are `#[cfg(windows)]`).
- [ ] **An update with TennoScope running** (companion.rs `stop` now waits up to 3 s for TennoScope
      to be gone): with TennoScope started by orbiter, *Update and restart* to a newer build; the
      passive installer runs to the end without a "can't write tennoscope.exe" (Retry/Abort) box,
      and orbiter comes back on the new version with TennoScope started again.
- [ ] **Saves while something holds the file** (`rename_replacing`, lib.rs): open
      `%APPDATA%\dev.orbiter.app\settings.json` in a program that locks it (or let Defender scan it)
      and change a setting; the change is saved once the lock goes, and orbiter.log has no failed
      save.

## Never checked on Windows from this repository (needs a Windows machine)

- [ ] **A user name with spaces and accents** (`C:\Users\José María\…`): first start finds
      TennoScope's folder and Warframe's EE.log; Settings → Logs opens both log folders; a CSV
      export lands in Downloads; Report a bug shows `C:\Users\[user]\…`, never the name.
- [ ] **orbiter installed under a path with spaces** (the installer's default is per user,
      `%LOCALAPPDATA%\orbiter`; also try a custom folder with a space): the bundled TennoScope
      starts, and its Tesseract reads a reward screen.
- [ ] **Passive install over a running orbiter**: the installer closes orbiter itself, keeps the
      settings, and the Start menu entry still opens it.
- [ ] **TennoScope started by hand first** (not by orbiter): orbiter leaves it running, and an
      update still installs (the TennoScope inside orbiter is the only one whose files it replaces).
- [ ] **SmartScreen**: the first run of the unsigned setup.exe shows *More info → Run anyway*, as
      the README says.
- [ ] **The reward overlay over the game** in borderless and windowed mode (TennoScope's Windows
      layer call), and with a second monitor.
- [ ] **Notifications**: a desktop notification appears with orbiter's name and icon, and a click
      on it brings orbiter up on the page it's about.
- [ ] **File locking during a sync**: Sync while Warframe writes EE.log; the trade log and the
      Current fissure page keep reading (orbiter opens EE.log read-only and shared).
