#!/usr/bin/env bash
# Builds orbiter and installs it for your user, so it's in your app menu (KDE, GNOME, or a
# launcher like wofi/rofi/fuzzel on Hyprland) with its icon, and the window shows that icon in
# the taskbar or dock. Nothing outside your home folder is touched.
#
#   scripts/install-desktop.sh            build, then install
#   scripts/install-desktop.sh --no-build install the last build again
#   scripts/install-desktop.sh --uninstall
#
# On Wayland the compositor finds a window's icon through the launcher entry whose name matches
# the window's app id. orbiter's window app id is "orbiter", so the entry is orbiter.desktop.
set -euo pipefail

cd "$(dirname "$0")/.."
data="${XDG_DATA_HOME:-$HOME/.local/share}"
bin="$HOME/.local/bin/orbiter"
entry="$data/applications/orbiter.desktop"
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

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$bin" "$entry" "$icons/scalable/apps/orbiter.svg"
  for size in 32 64 128 256 512; do rm -f "$icons/${size}x${size}/apps/orbiter.png"; done
  refresh
  echo "orbiter removed from your app menu. Its settings stay in ~/.config/dev.orbiter.app."
  exit 0
fi

if [[ "${1:-}" != "--no-build" ]]; then
  npm install --no-audit --no-fund
  npm run tauri build -- --no-bundle
fi
[[ -x target/release/orbiter ]] || { echo "No build at target/release/orbiter: run without --no-build." >&2; exit 1; }

install -Dm755 target/release/orbiter "$bin"
install -Dm644 src-tauri/icons/icon.svg "$icons/scalable/apps/orbiter.svg"
install -Dm644 src-tauri/icons/32x32.png "$icons/32x32/apps/orbiter.png"
install -Dm644 src-tauri/icons/64x64.png "$icons/64x64/apps/orbiter.png"
install -Dm644 src-tauri/icons/128x128.png "$icons/128x128/apps/orbiter.png"
install -Dm644 src-tauri/icons/128x128@2x.png "$icons/256x256/apps/orbiter.png"
install -Dm644 src-tauri/icons/icon.png "$icons/512x512/apps/orbiter.png"

mkdir -p "$(dirname "$entry")"
cat > "$entry" <<DESKTOP
[Desktop Entry]
Type=Application
Name=orbiter
GenericName=Warframe companion
Comment=What to sell, crack and master in Warframe, from TennoScope's data
Exec=$bin
Icon=orbiter
Terminal=false
Categories=Game;
Keywords=warframe;relics;prime;platinum;ducats;market;
StartupWMClass=orbiter
StartupNotify=true
DESKTOP

refresh
echo "Installed: $bin"
echo "orbiter is in your app menu now. Start it from there (or run: $bin)."
