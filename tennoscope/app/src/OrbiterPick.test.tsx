import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({ getView: vi.fn(), getOrbiterPick: vi.fn(), getVersionInfo: vi.fn(), updateCheck: vi.fn(), updateDownloadAndInstall: vi.fn() }))
vi.mock('./backend', () => backend)
vi.mock('./overlay', () => ({ hideRewardOverlay: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }))

import { AppRoute } from './Root'
import type { RewardCard } from './backend'

const card = (name: string, rest: Partial<RewardCard> = {}): RewardCard => ({ name, platinum: 10, ducats: 15, owned: 0, confidence: 1, ...rest })
const view = (cards: RewardCard[]) => ({ collection: { items: [], total_entries: 0 }, reward: { cards, best_value_index: null, best_ducat_index: null }, health: {} })

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('orbiter pick on the reward overlay', () => {
  it('scores every card and marks the one to take', async () => {
    backend.getView.mockResolvedValue(view([card('Corinth Prime Barrel', { vaulted: true }), card('Forma Blueprint')]))
    backend.getOrbiterPick.mockResolvedValue({ at: Date.now(), cards: ['Corinth Prime Barrel', 'Forma Blueprint'], scores: [70, 0], best: 0, reasons: [['38p'], []] })
    render(<AppRoute pathname="/overlay" />)
    const best = await screen.findByRole('article', { name: 'Corinth Prime Barrel' })
    expect(await within(best).findByText('Pick · 70')).toBeTruthy()
    expect(best.className).toContain('orbiter-pick')
    // Where it can still be had, once, under the metals.
    expect(within(best).getAllByText('Vaulted')).toHaveLength(1)
    const other = screen.getByRole('article', { name: 'Forma Blueprint' })
    expect(within(other).getByText('0')).toBeTruthy()
    expect(other.className).not.toContain('orbiter-pick')
  })

  it('ignores a pick made for other cards', async () => {
    backend.getView.mockResolvedValue(view([card('Lex Prime Barrel'), card('Forma Blueprint')]))
    backend.getOrbiterPick.mockResolvedValue({ at: Date.now(), cards: ['Corinth Prime Barrel', 'Forma Blueprint'], scores: [70, 0], best: 0, reasons: [] })
    render(<AppRoute pathname="/overlay" />)
    const slip = await screen.findByRole('article', { name: 'Lex Prime Barrel' })
    await new Promise((r) => setTimeout(r, 50))
    expect(within(slip).queryByText(/Pick/)).toBeNull()
    expect(slip.className).not.toContain('orbiter-pick')
  })

  it('works without orbiter running', async () => {
    backend.getView.mockResolvedValue(view([card('Lex Prime Barrel'), card('Forma Blueprint')]))
    backend.getOrbiterPick.mockResolvedValue(null)
    render(<AppRoute pathname="/overlay" />)
    const slip = await screen.findByRole('article', { name: 'Lex Prime Barrel' })
    expect(within(slip).queryByText(/Pick/)).toBeNull()
  })
})
