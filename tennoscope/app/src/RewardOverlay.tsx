import { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getOrbiterPick, getView, type AppView, type OrbiterPick, type OverlayShow } from './backend'
import { orbiterShow, SHOW_ALL } from './orbiterOverlay'
import { RewardCards } from './RewardCards'

export default function RewardOverlay() {
  const [view, setView] = useState<AppView | null>(null)
  const [error, setError] = useState(false)
  const [pick, setPick] = useState<OrbiterPick | null>(null)
  const [show, setShow] = useState<OverlayShow>(SHOW_ALL)
  const generation = useRef(0)

  // orbiter answers within a second or so of the cards being read; ask often while they're up.
  const cardCount = view?.reward.cards.length ?? 0
  useEffect(() => {
    if (!cardCount) { setPick(null); return }
    let active = true
    const ask = async () => {
      try { const next = await getOrbiterPick(); if (active) setPick(next) } catch { if (active) setPick(null) }
      // What orbiter's settings show on the cards; everything when orbiter isn't there to say.
      const shown = await orbiterShow()
      if (active) setShow(shown)
    }
    void ask()
    const timer = setInterval(ask, 500)
    return () => { active = false; clearInterval(timer) }
  }, [cardCount])

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let unlisten: UnlistenFn | undefined
    const refresh = async () => {
      const request = ++generation.current
      try {
        const next = await getView()
        if (active && request === generation.current) { setView(next); setError(false) }
      } catch {
        if (active && request === generation.current) setError(true)
      }
    }
    const poll = async () => {
      await refresh()
      if (active) timer = setTimeout(poll, 1500)
    }
    void listen('reward-updated', () => { void refresh() }).then(stop => {
      if (active) unlisten = stop
      else stop()
    })
    void poll()
    return () => { active = false; generation.current += 1; unlisten?.(); document.documentElement.classList.remove('overlay-mode'); if (timer) clearTimeout(timer) }
  }, [])

  return <main className="overlay-shell" aria-label="Reward overlay">
    {error ? <div className="overlay-empty">Reward data is unavailable.</div>
      : !view ? <div className="overlay-empty">Loading reward choices…</div>
        : view.reward.cards.length
          ? <RewardCards cards={view.reward.cards} bestValueIndex={view.reward.best_value_index} bestDucatIndex={view.reward.best_ducat_index} className="overlay-rewards"
              pick={pick && samePick(pick, view.reward.cards.map(card => card.name)) ? pick : null} show={show}/>
          : <div className="overlay-empty"><strong>No reward choices detected</strong><span>Watching the active Warframe display.</span></div>}
  </main>
}

/** A pick is only shown for the very cards it scored, in the same order. */
function samePick(pick: OrbiterPick, names: string[]): boolean {
  return pick.cards.length === names.length && pick.cards.every((name, i) => name.toLowerCase() === names[i].toLowerCase())
}
