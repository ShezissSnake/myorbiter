import type { AccessMode } from './backend'

export interface AccessModeDefinition {
  id: AccessMode
  name: string
  boundary: string
  added: readonly string[]
}

export const ALWAYS_OFF = [
  'Memory writes or injection',
  'Game-file writes',
  'Automated input',
  'Traffic redirection',
  'TennoScope telemetry',
] as const

/** Shown beside Full wherever it can be turned on: what it does and what it risks, plainly. */
export const FULL_ACCESS_WARNING =
  "Full reads Warframe's memory to fetch your inventory. Warframe's EULA forbids unauthorised third-party programs, so using it could put your account at risk. TennoScope only reads, and only sends your login session to Digital Extremes."

export const ACCESS_MODES: readonly AccessModeDefinition[] = [
  {
    id: 'companion',
    name: 'Companion',
    boundary: 'No Warframe reads, tools stay available',
    added: ['Nothing read from Warframe, saved data, prices, and trading stay available'],
  },
  {
    id: 'overlay',
    name: 'Overlay',
    boundary: 'Adds EE.log + visible reward pixels',
    added: ['Warframe process presence', 'EE.log', 'Visible-pixel OCR', 'Click-through overlay'],
  },
  {
    id: 'full',
    name: 'Full',
    boundary: 'Adds read-only memory + inventory',
    added: ['Read-only process memory', 'Inventory acquisition'],
  },
] as const

export function accessMode(id: AccessMode): AccessModeDefinition {
  return ACCESS_MODES.find(mode => mode.id === id)!
}

export function accessLevel(id: AccessMode): number {
  return ACCESS_MODES.findIndex(mode => mode.id === id)
}

export function accessGrantedBetween(from: AccessMode, to: AccessMode): readonly string[] {
  const fromLevel = accessLevel(from)
  return ACCESS_MODES.slice(fromLevel + 1, accessLevel(to) + 1).flatMap(mode => mode.added)
}
