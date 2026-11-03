//! A layered window (click-through on Windows makes the overlay one: `WS_EX_LAYERED`) isn't drawn
//! at all until its layer attributes are set, which tao never does.

use windows::Win32::Foundation::{COLORREF, HWND};
use windows::Win32::UI::WindowsAndMessaging::{LWA_ALPHA, SetLayeredWindowAttributes};

/// Sets a layered window's layer to full opacity, so what it draws shows. `hwnd` is a live
/// top-level window handle (Tauri's `WebviewWindow::hwnd`). True when Windows took it.
pub fn make_layered_visible(hwnd: *mut core::ffi::c_void) -> bool {
    // SAFETY: the handle comes from a live window, and the call only sets its layer opacity;
    // Windows rejects a stale or non-layered handle with an error rather than misbehaving.
    unsafe { SetLayeredWindowAttributes(HWND(hwnd), COLORREF(0), 255, LWA_ALPHA).is_ok() }
}
