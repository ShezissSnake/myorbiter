// The build editor and Paste a build: leaving them (Esc, the shade, Cancel) with something changed
// asks first, in the dialog itself, whether to discard it; with nothing changed they close at once.
// While the question is up, leaving again (its Esc, the shade) keeps editing.

/** What a try to leave does: close now, ask first, or (the question already up) stay and keep editing. */
export function leaving(changed: boolean, asking: boolean): "close" | "ask" | "stay" {
  if (!changed) return "close";
  return asking ? "stay" : "ask";
}
