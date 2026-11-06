# What needs a real Windows check

orbiter's Windows-only code can be read and type-checked from Linux, but not run. Each unticked
line below is a check to do on Windows 10 or 11 with the setup.exe of a release build.

## Settled from Linux

- [x] **orbiter type-checks for Windows on its MSRV:** `cargo +1.95 check --workspace --locked
      --target x86_64-pc-windows-gnu` finishes with no error (with `sysinfo` 0.40). Its five
      warnings are `rendering.rs`'s Linux-only helpers (`WEBKIT_VARS`, `vars_for`, `decide`,
      `flag_in`, `Mode`'s variants), dead code on Windows. It only type-checks: the release build is
      MSVC on `windows-latest` with current stable, and nothing is linked or run. The MSVC target
      itself can't be checked from Linux: `ring`'s build script needs the MSVC compiler.
- [x] **Where files go**, all from the platform's folders, none built with `/`:
      - TennoScope's folder: `%APPDATA%\io.github.deftera186.tennoscope`
        (`orbiter_data::default_tennoscope_dir`);
      - Warframe's log: `%LOCALAPPDATA%\Warframe\EE.log` (`ee_log.rs`);
      - TennoScope's and orbiter's logs: `%LOCALAPPDATA%\<id>\logs` (`reward_log.rs`, `applog.rs`);
      - settings and caches: `%APPDATA%\dev.orbiter.app` (Tauri's `app_config_dir`);
      - CSV exports: the Downloads folder, or the home folder without one.
- [x] **Network paths are refused** wherever a path comes from the page or the file dialog
      (`local_path` in `lib.rs`): only a drive letter (`C:\…`, `\\?\C:\…`) passes, so
      `\\host\share` and `\\?\UNC\…` are refused. A share mapped to a drive letter (`Z:\`) still
      passes: it's a drive the player mapped. The tests (`local_path_tests`) are `#[cfg(windows)]`.
- [x] **The installer** (`tauri.windows.conf.json`): NSIS, for the current user (no
      administrator), English only. WebView2 is fetched silently by its bootstrapper if missing.
      The updater runs the new setup.exe `passive` (a progress window, no questions). The setup.exe
      isn't code-signed, so SmartScreen warns the first time.

## To check on Windows

- [ ] **It starts with the narrowed permissions** (`src-tauri/capabilities/default.json`: of
      Tauri's core, only listening for events): first start, every page opens, Settings saves.
- [ ] **The three native dialogs** open from Rust and work: Settings → TennoScope → *Choose…*
      (TennoScope's program), a step back to an older build (it names both builds; needs a real
      older build), and a new Discord webhook address.
- [ ] **A network path is refused:** TennoScope's folder set to
      `\\localhost\c$\Users\<you>\AppData\Roaming\io.github.deftera186.tennoscope` says "give a
      folder on this computer"; the same folder as `C:\Users\…` works. The same for Warframe's
      EE.log, and for a TennoScope program picked on a network location in *Choose…*.
      `cargo test` on Windows also runs `local_path_tests`.
- [ ] **An update with TennoScope running** (`companion.rs` `stop` waits up to 3 s for TennoScope
      to exit): *Update and restart* to a newer build; the passive installer runs to the end
      without a "can't write tennoscope.exe" box, and orbiter comes back on the new version with
      TennoScope started again.
- [ ] **TennoScope started by hand first** (not by orbiter): orbiter leaves it running, and an
      update still installs (the TennoScope inside orbiter is the only one whose files it replaces).
- [ ] **Passive install over a running orbiter:** the installer closes orbiter itself, keeps the
      settings, and the Start menu entry still opens it.
- [ ] **Saves while something holds the file** (`rename_replacing` in `lib.rs`): open
      `%APPDATA%\dev.orbiter.app\settings.json` in a program that locks it (or let Defender scan it)
      and change a setting; the change is saved once the lock goes, and orbiter.log has no failed
      save.
- [ ] **A user name with spaces and accents** (`C:\Users\José María\…`): the first start finds
      TennoScope's folder and Warframe's EE.log; Settings → Logs opens both log folders; a CSV
      export lands in Downloads; Report a bug shows `C:\Users\[user]\…`, never the name.
- [ ] **orbiter installed under a path with spaces** (the default is `%LOCALAPPDATA%\orbiter`;
      also try a custom folder with a space): the bundled TennoScope starts, and its Tesseract reads
      a reward screen.
- [ ] **SmartScreen:** the first run of the unsigned setup.exe shows *More info → Run anyway*.
- [ ] **The reward overlay over the game** in borderless and windowed mode, and with a second
      monitor.
- [ ] **Notifications:** a desktop notification appears with orbiter's name and icon, and a click
      on it brings orbiter up on the page it's about.
- [ ] **File locking during a sync:** Sync while Warframe writes EE.log; the trade log and Current
      fissure keep reading (orbiter opens EE.log read-only and shared).

## To read

- [ ] `companion.rs` and TennoScope's
      `tennoscope/crates/warframe-acquisition/src/windows_proc.rs` (starting, finding and stopping
      TennoScope on Windows) as they are with `sysinfo` 0.40.
