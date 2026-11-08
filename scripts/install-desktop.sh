#!/usr/bin/env bash
# Builds MyOrbiter and installs it for your user, so it's in your app menu (KDE, GNOME, or a
# launcher like wofi/rofi/fuzzel on Hyprland) with its icon, and the window shows that icon in
# the taskbar or dock. Nothing outside your home folder is touched.
#
#   scripts/install-desktop.sh            build, then install
#   scripts/install-desktop.sh --no-build install the last build again
#   scripts/install-desktop.sh --uninstall
#
# On Wayland the compositor finds a window's icon through the launcher entry whose name matches
# the window's app id. MyOrbiter's window app id is "myorbiter", so the entry is myorbiter.desktop.
set -euo pipefail

cd "$(dirname "$0")/.."
data="${XDG_DATA_HOME:-$HOME/.local/share}"
bin="$HOME/.local/bin/myorbiter"
entry="$data/applications/myorbiter.desktop"
icons="$data/icons/hicolor"

refresh() {
  command -v update-desktop-database >/dev/null && update-desktop-database -q "$data/applications" || true
  # Only refresh an icon cache that's already there: a new one would hide icons other apps add later.
  [[ -f "$icons/icon-theme.cache" ]] && command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$icons" || true
  # KDE reads its own cache of launcher entries.
  for k in kbuildsycoca6 kbuildsycoca5; do
    if command -v "$k" >/dev/null; then "$k" >/dev/null 2>&1 || true; break; fi
  done
  return 0
}

# Before the rename to MyOrbiter this script installed "orbiter": its program, launcher entry and
# icons go too (after an install and on --uninstall), so the two can't run side by side. Only when the
# launcher entry is the one this script wrote, so another program called orbiter is left alone.
# Its settings (~/.config/dev.orbiter.app) stay: MyOrbiter copies them on its first start.
remove_old() {
  local old_bin="$HOME/.local/bin/orbiter" old_entry="$data/applications/orbiter.desktop"
  [[ -f "$old_entry" ]] && grep -qxF "Exec=$old_bin" "$old_entry" || return 0
  rm -f "$old_bin" "$old_entry" "$icons/scalable/apps/orbiter.svg"
  for size in 32 64 128 256 512; do rm -f "$icons/${size}x${size}/apps/orbiter.png"; done
  echo "Removed orbiter, MyOrbiter's name before the rename. Its settings stay in ~/.config/dev.orbiter.app."
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$bin" "$entry" "$icons/scalable/apps/myorbiter.svg"
  for size in 32 64 128 256 512; do rm -f "$icons/${size}x${size}/apps/myorbiter.png"; done
  remove_old
  refresh
  echo "MyOrbiter removed from your app menu. Its settings stay in ~/.config/io.gitlab.sheziss-group.myorbiter."
  exit 0
fi

if [[ "${1:-}" != "--no-build" ]]; then
  npm install --no-audit --no-fund
  npm run tauri build -- --no-bundle
fi
[[ -x target/release/myorbiter ]] || { echo "No build at target/release/myorbiter: run without --no-build." >&2; exit 1; }

install -Dm755 target/release/myorbiter "$bin"
install -Dm644 src-tauri/icons/icon.svg "$icons/scalable/apps/myorbiter.svg"
install -Dm644 src-tauri/icons/32x32.png "$icons/32x32/apps/myorbiter.png"
install -Dm644 src-tauri/icons/64x64.png "$icons/64x64/apps/myorbiter.png"
install -Dm644 src-tauri/icons/128x128.png "$icons/128x128/apps/myorbiter.png"
install -Dm644 src-tauri/icons/128x128@2x.png "$icons/256x256/apps/myorbiter.png"
install -Dm644 src-tauri/icons/icon.png "$icons/512x512/apps/myorbiter.png"

mkdir -p "$(dirname "$entry")"
cat > "$entry" <<DESKTOP
[Desktop Entry]
Type=Application
Name=MyOrbiter
GenericName=Warframe companion
Comment=What to sell, crack and master in Warframe, from TennoScope's data
Exec=$bin
Icon=myorbiter
Terminal=false
Categories=Game;
Keywords=warframe;relics;prime;platinum;ducats;market;
StartupWMClass=myorbiter
StartupNotify=true
DESKTOP

# Only once MyOrbiter is in place, so a failed install doesn't leave neither.
remove_old
refresh
echo "Installed: $bin"
echo "MyOrbiter is in your app menu now. Start it from there (or run: $bin)."

# This build carries no TennoScope: it starts the one you build from tennoscope/ in this folder
# (tennoscope/ORBITER.md), once Settings → TennoScope points at it. A TennoScope older than the
# one MyOrbiter is made for can't open data a newer one has upgraded (it stops as it starts), so say
# when that build is missing or older than the last change to tennoscope/.
ts_bin="$PWD/tennoscope/target/release/tennoscope"
changed=$(git log -1 --format=%ct -- tennoscope 2>/dev/null || true)
if [[ ! -x "$ts_bin" ]] || [[ -n "$changed" && $(stat -c %Y "$ts_bin") -lt $changed ]]; then
  cat <<NOTE

TennoScope in $PWD/tennoscope isn't built, or is older than its source.
Build it (tennoscope/ORBITER.md, "Build it on your PC"):
  cd $PWD/tennoscope; $PWD/scripts/vendor-linux-tesseract.sh app/src-tauri/vendor/tesseract
  cd app; pnpm install --frozen-lockfile; pnpm tauri build --no-bundle
and point MyOrbiter's Settings → TennoScope at $ts_bin
NOTE
fi
