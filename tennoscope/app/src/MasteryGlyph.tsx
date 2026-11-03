/**
 * Whether the item a reward builds is mastered: a filled green seal with a tick when it is, the
 * same seal as an empty grey ring when it is not. Drawn here, not taken from the game, and next
 * to the name so it reads before anything else on the slip.
 */
export function MasteryGlyph({ mastered }: { mastered: boolean }) {
  return <svg className={`mastery-glyph${mastered ? ' on' : ''}`} viewBox="0 0 20 20" role="img" aria-label={mastered ? 'Mastered' : 'Not mastered'}>
    <title>{mastered ? 'Mastered' : 'Not mastered yet'}</title>
    <path className="seal" d="M10 1.5l2.3 1.6 2.8-.2 1 2.6 2.4 1.5-.6 2.8.9 2.7-2.2 1.8-.6 2.8-2.8.4L11.6 18 10 18.6 8.4 18l-1.6-1.5-2.8-.4-.6-2.8-2.2-1.8.9-2.7-.6-2.8L3.9 5.5l1-2.6 2.8.2z"/>
    {mastered && <path className="tick" d="M6.2 10.3l2.6 2.6 5-5.4" />}
  </svg>
}
