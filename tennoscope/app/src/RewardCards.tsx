import type { MasteryMark, OrbiterPick, OverlayShow, RewardCard, SetPart, VaultState } from './backend'
import { SHOW_ALL } from './orbiterOverlay'
import { MasteryGlyph } from './MasteryGlyph'
import { MetalMark } from './MetalMark'
import { SetRow } from './SetRow'

/** Mastered, not mastered, or nothing to say: Forma and the like build nothing to master, and a
 * mark the evidence cannot support draws no seal rather than a guess. */
function masteredOf(mark: MasteryMark | undefined): boolean | null {
  if (!mark || mark.state === 'unknown') return null
  return mark.state === 'mastered'
}

/** The few words the seal can't say: a part still wanted by something else (Lex parts for an
 * Aklex, whose set the row then shows), and a built item still to level. */
function ledgerWord(mark: MasteryMark | undefined, completes: boolean): string | null {
  if (completes || !mark) return null
  switch (mark.state) {
    case 'unmastered': return mark.subject ? `For ${mark.subject}` : null
    case 'built': return `Built\u00a0· R${mark.rank}/${mark.max_rank}`
    case 'in_foundry': return 'In foundry'
    default: return null
  }
}

/** orbiter's word when it has one (it knows Prime Resurgence); otherwise the relic tables'. Only
 * for rewards that are Prime parts, which are the ones a vault can close. */
function vaultOf(card: RewardCard, fromOrbiter: VaultState | null | undefined): VaultState | null {
  if (fromOrbiter) return fromOrbiter
  if (card.vaulted) return 'vaulted'
  return card.set || card.mastery ? 'farmable' : null
}

const VAULT_WORD: Record<VaultState, string> = { vaulted: 'Vaulted', resurgence: 'Resurgence', farmable: 'Farmable' }
const VAULT_TITLE: Record<VaultState, string> = {
  vaulted: 'Every relic that drops it is vaulted: no new copies until it returns',
  resurgence: 'Vaulted, but back in Prime Resurgence (Varzia) right now',
  farmable: 'Relics that drop it are still in the drop tables',
}

/** The set row's slots: the reward's own set when TennoScope sent it, else the unmastered mark's. */
function setOf(card: RewardCard): { parts: SetPart[]; completes: boolean } | null {
  if (card.set) return card.set
  const mark = card.mastery
  return mark?.state === 'unmastered' ? { parts: mark.parts, completes: mark.completes } : null
}

/**
 * Platinum and ducats are two different answers to "which one do I take", and the player picks
 * between them for reasons this program cannot see, so both are shown at the same weight. Under
 * them, always in the same order: whether the item is mastered (the seal by the name), where the
 * reward can still be had, and the set it belongs to, with the slot this reward fills underlined
 * and the whole slip double-ruled when it finishes a set, a first one or an extra to sell.
 *
 * A reading we do not trust is never crowned on either metal. A price we do not have is struck as
 * a dash: untradeable items (Forma among them) have no listing and never will.
 */
export function RewardCards({
  cards,
  bestValueIndex,
  bestDucatIndex,
  ownershipVerified = true,
  className = 'reward-grid',
  pick = null,
  show = SHOW_ALL,
}: {
  cards: RewardCard[]
  bestValueIndex: number | null
  bestDucatIndex: number | null
  ownershipVerified?: boolean
  className?: string
  /** orbiter's score for each card, the one to take, and where each can still be had. */
  pick?: OrbiterPick | null
  /** What orbiter's settings show; everything without orbiter. */
  show?: OverlayShow
}) {
  return <div className={className}>{cards.slice(0, 4).map((card, index) => {
    const uncertain = card.confidence < 0.8
    const topPlat = !uncertain && bestValueIndex === index
    const topDucat = !uncertain && bestDucatIndex === index
    const score = show.pick ? pick?.scores[index] : undefined
    const picked = show.pick && pick?.best === index
    const mastered = show.mastered ? masteredOf(card.mastery) : null
    const vault = show.vault ? vaultOf(card, pick?.vault?.[index]) : null
    // A read we are unsure of may name the wrong item, so it claims no set.
    const set = show.set && !uncertain ? setOf(card) : null
    const completes = !!set?.completes
    const mark = card.mastery
    // A part an unmastered, unbuilt item still lacks rules the slip; one that finishes a set
    // double-rules it. Never on a read we are unsure of.
    const missing = !uncertain && mark?.state === 'unmastered' && mark.missing
    const word = ledgerWord(mark, completes)
    const unknown = show.mastered && mark?.state === 'unknown'
    const metals = show.plat || show.ducats
    return <article
      key={`${card.name}-${index}`}
      className={['slip', topPlat ? 'top-plat' : '', topDucat ? 'top-ducat' : '', completes ? 'ruled-double' : missing ? 'ruled' : '', picked ? 'orbiter-pick' : '', metals ? '' : 'no-metals'].filter(Boolean).join(' ')}
      aria-label={card.name}
    >
      <span className="slip-lot">Choice {index + 1}</span>
      <h2 className="slip-name">
        {score != null && <span className="slip-corner">
          <span className={`orbiter-score${picked ? ' picked' : ''}`} title={pick?.reasons[index]?.join(' · ') || 'Score from orbiter'}>
            {picked ? 'Pick · ' : ''}{score}
          </span>
        </span>}
        {mastered != null && <MasteryGlyph mastered={mastered}/>}
        {card.name}
      </h2>

      {metals && <div className={`metals${show.plat && show.ducats ? '' : ' single'}`}>
        {show.plat && <span className="metal plat">
          {card.platinum > 0
            ? <span className="metal-figure">{card.platinum}</span>
            : <span className="metal-figure market-pending"><span aria-hidden="true">—</span><span className="sr-only">No platinum price</span></span>}
          <span className="metal-label"><MetalMark metal="plat"/>plat</span>
          {topPlat && <span className="metal-hallmark">Top plat</span>}
        </span>}
        {show.ducats && <span className="metal ducat">
          <span className="metal-figure">{card.ducats}</span>
          <span className="metal-label"><MetalMark metal="ducat"/>ducats</span>
          {topDucat && <span className="metal-hallmark">Top ducats</span>}
        </span>}
      </div>}

      {set || vault || word || unknown
        ? <div className="ledger" data-tone={completes || missing ? 'loud' : 'quiet'}>
            {uncertain && <span className="hallmark doubt">Uncertain · {Math.round(card.confidence * 100)}%</span>}
            {/* The words stack in one column so the set row keeps the rest of the width. */}
            <span className="ledger-words">
              {vault && <span className={`hallmark vault-${vault}`} title={VAULT_TITLE[vault]}>{VAULT_WORD[vault]}</span>}
              {completes
                ? <span className="ledger-word inverted" title="Taking it finishes a whole set: one to build, or an extra one to sell">Completes set</span>
                : word && <span className="ledger-word">{word}</span>}
              {unknown && <span className="ledger-word"><span aria-hidden="true">—</span><span className="sr-only">Mastery unknown</span></span>}
            </span>
            {set && <SetRow parts={set.parts}/>}
          </div>
        : <div className="marks">
            {ownershipVerified
              ? card.owned > 0
                ? <span className="hallmark owned">Owned ×{card.owned}</span>
                : <span className="hallmark absent">Not owned</span>
              : <span className="hallmark doubt">Unverifiable</span>}
            {uncertain && <span className="hallmark doubt">Uncertain · {Math.round(card.confidence * 100)}%</span>}
          </div>}
    </article>
  })}</div>
}
