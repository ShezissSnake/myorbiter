import { invoke } from '@tauri-apps/api/core'
import type { OverlayShow } from './backend'

/** Everything shows until orbiter's settings say otherwise, and whenever orbiter can't be asked. */
export const SHOW_ALL: OverlayShow = { mastered: true, vault: true, set: true, plat: true, ducats: true, pick: true }

/** What orbiter's settings show on the reward cards; everything without orbiter. */
export async function orbiterShow(): Promise<OverlayShow> {
  try {
    const prefs = await invoke<{ show?: Partial<OverlayShow> } | null>('orbiter_overlay')
    return { ...SHOW_ALL, ...(prefs?.show ?? {}) }
  } catch {
    return SHOW_ALL
  }
}
