// Whether the player has chosen Home's cards: the "Choose Home's cards" step of Start here. A choice
// is any change in the Customise panel, or closing it after a look, so keeping every card is one too;
// hiding cards before the choice was recorded (an empty `homeChosen`) counts as well.

export function homeCardsChosen(s: { homeChosen: boolean; homeHidden: readonly string[] }): boolean {
  return s.homeChosen || s.homeHidden.length > 0;
}
