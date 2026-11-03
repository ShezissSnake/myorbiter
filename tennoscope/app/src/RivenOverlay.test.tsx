import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({ getOrbiterRiven: vi.fn() }))
vi.mock('./backend', () => backend)

import { AppRoute } from './Root'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const roll = (name: string, grade: string) => ({ name, grade, stats: [{ label: 'Multishot', display: '+120.4%', grade: 'A', buff: true }, { label: 'Zoom', display: '-40.1%', grade: 'B', buff: false }] })

describe("orbiter's riven cycle over the game", () => {
  it('shows both rolls and outlines the one to keep', async () => {
    backend.getOrbiterRiven.mockResolvedValue({ key: 'r1|4', at: Date.now(), until: Date.now() + 20000, weapon: 'Rubico Prime', verdict: 'take', why: 'Multishot and crit beat damage on a crit rifle.', current: roll('Crita-acridon', 'C'), next: { ...roll('Visi-critatis', 'A-'), price: 300 } })
    render(<AppRoute pathname="/riven" />)
    expect(await screen.findByText('Take the new roll')).toBeTruthy()
    const offer = screen.getByRole('article', { name: 'On offer: Visi-critatis' })
    expect(offer.className).toContain('chosen')
    expect(within(offer).getByText('estimate ~300p')).toBeTruthy()
    expect(screen.getByRole('article', { name: 'It has: Crita-acridon' }).className).not.toContain('chosen')
    expect(screen.getByText('Multishot and crit beat damage on a crit rifle.')).toBeTruthy()
  })

  it('shows nothing when orbiter has no cycle to show', async () => {
    backend.getOrbiterRiven.mockResolvedValue(null)
    render(<AppRoute pathname="/riven" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('article')).toBeNull()
  })
})
