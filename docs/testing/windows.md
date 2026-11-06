# What needs a real Windows check

The Windows-only code was read, and the fixes below were made, but none of it can run in a Linux
container (cross-compiling stops at the C parts of `ring` and `rusqlite`). Each line is a check to
do on Windows 10 or 11 with the setup.exe of a release build.

## Changed in this round, never run on Windows

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

## Never checked on Windows from this repository

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
