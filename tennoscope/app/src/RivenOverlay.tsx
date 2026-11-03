import { useEffect, useState } from 'react'
import { getOrbiterRiven, type OrbiterRiven, type RivenRoll } from './backend'

/*
 * A riven being cycled, over the game: the roll it has and the one on offer side by side, each
 * stat graded, and which to keep, as orbiter worked it out. orbiter writes it when a read of the
 * inventory shows a cycle waiting for keep-or-take; the window shows while that's fresh.
 */
export default function RivenOverlay() {
  const [riven, setRiven] = useState<OrbiterRiven | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    let active = true
    const ask = async () => {
      try { const next = await getOrbiterRiven(); if (active) setRiven(next) } catch { if (active) setRiven(null) }
    }
    void ask()
    const timer = setInterval(ask, 500)
    return () => { active = false; clearInterval(timer); document.documentElement.classList.remove('overlay-mode') }
  }, [])

  if (!riven) return <main className="overlay-shell riven-overlay" aria-label="Riven cycle"/>
  const verdict = riven.verdict === 'take' ? 'Take the new roll' : riven.verdict === 'keep' ? 'Keep the one it has' : 'Close call'
  return <main className="overlay-shell riven-overlay" aria-label="Riven cycle">
    <section className={`riven-panel verdict-${riven.verdict}`}>
      <header><span className="riven-weapon">{riven.weapon}</span><strong className="riven-verdict">{verdict}</strong></header>
      <div className="riven-rolls">
        <Roll title="It has" roll={riven.current} chosen={riven.verdict === 'keep'}/>
        <Roll title="On offer" roll={riven.next} chosen={riven.verdict === 'take'}/>
      </div>
      {riven.why ? <p className="riven-why">{riven.why}</p> : null}
    </section>
  </main>
}

function Roll({ title, roll, chosen }: { title: string; roll: RivenRoll; chosen: boolean }) {
  return <article className={chosen ? 'riven-roll chosen' : 'riven-roll'} aria-label={`${title}: ${roll.name}`}>
    <div className="riven-roll-head"><span className="riven-roll-title">{title}</span><span className="riven-grade">{roll.grade}</span></div>
    <div className="riven-name">{roll.name}</div>
    <ul>{roll.stats.map((s, i) => <li key={i} className={s.buff ? '' : 'curse'}><b>{s.display}</b> <span>{s.label}</span> <em>{s.grade}</em></li>)}</ul>
    {roll.price != null ? <div className="riven-price">estimate ~{roll.price.toLocaleString('en')}p</div> : null}
  </article>
}
