use std::time::{Duration, Instant};

use warframe_acquisition::{RewardCatalogEntry, RewardNeedle, RewardResolution};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RewardChoiceSource {
    Memory,
    Ocr,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardChoiceSet {
    pub names: Vec<String>,
    pub source: RewardChoiceSource,
    pub elapsed: Duration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RewardSourceDiagnostic {
    Ready,
    MemoryFallback,
    Agreement,
    Disagreement,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RewardSourceResult {
    pub choices: RewardChoiceSet,
    pub diagnostic: RewardSourceDiagnostic,
}

pub trait MemoryRewardSource {
    fn baseline(&mut self, candidates: &[RewardNeedle]);
    fn choices(&mut self, expected: usize) -> RewardResolution;
    fn player_records(
        &mut self,
        responders: &[&str],
        local_identity: Option<&str>,
        local_choice: Option<&str>,
    ) -> RewardResolution;
}

/// What a card's text is matched against. The squad's relic pool is what makes a fuzzy read safe,
/// so a fuzzy read may only name a pool reward; the rest of the reward catalogue answers only a
/// near-exact read, which is how a card from a relic our data has no rewards for still gets named.
#[derive(Clone, Copy, Debug)]
pub struct CardCandidates<'a> {
    pub pool: &'a [RewardCatalogEntry],
    pub catalog: &'a [RewardCatalogEntry],
}

pub trait VisualRewardSource {
    /// The cards in screen order, each with the score its read matched at.
    fn choices(
        &mut self,
        candidates: CardCandidates<'_>,
    ) -> Result<Vec<(String, f32)>, &'static str>;
}

pub struct RewardSourceCoordinator {
    validation_mode: bool,
}

impl RewardSourceCoordinator {
    pub const fn new(validation_mode: bool) -> Self {
        Self { validation_mode }
    }

    pub fn baseline(&mut self, memory: &mut dyn MemoryRewardSource, candidates: &[RewardNeedle]) {
        memory.baseline(candidates);
    }

    pub fn player_record_choices(
        &self,
        memory: &mut dyn MemoryRewardSource,
        responders: &[&str],
        local_identity: Option<&str>,
        local_choice: Option<&str>,
    ) -> Option<RewardSourceResult> {
        let started = Instant::now();
        let RewardResolution::Confirmed { choices, .. } =
            memory.player_records(responders, local_identity, local_choice)
        else {
            return None;
        };
        Some(RewardSourceResult {
            choices: RewardChoiceSet {
                names: choices,
                source: RewardChoiceSource::Memory,
                elapsed: started.elapsed(),
            },
            diagnostic: RewardSourceDiagnostic::Ready,
        })
    }

    pub fn choices(
        &self,
        memory: &mut dyn MemoryRewardSource,
        visual: &mut dyn VisualRewardSource,
        expected: usize,
        candidates: CardCandidates<'_>,
    ) -> Option<RewardSourceResult> {
        if expected <= 1 {
            return None;
        }
        let started = Instant::now();
        match memory.choices(expected) {
            RewardResolution::Confirmed { choices, .. } => {
                let diagnostic = if self.validation_mode {
                    match visual.choices(candidates).map(card_names) {
                        Ok(visual_choices) if visual_choices == choices => {
                            RewardSourceDiagnostic::Agreement
                        }
                        _ => RewardSourceDiagnostic::Disagreement,
                    }
                } else {
                    RewardSourceDiagnostic::Ready
                };
                Some(RewardSourceResult {
                    choices: RewardChoiceSet {
                        names: choices,
                        source: RewardChoiceSource::Memory,
                        elapsed: started.elapsed(),
                    },
                    diagnostic,
                })
            }
            RewardResolution::Incomplete
            | RewardResolution::Ambiguous
            | RewardResolution::TimedOut => visual
                .choices(candidates)
                .ok()
                .map(card_names)
                .filter(|names| names.len() == expected)
                .map(|names| RewardSourceResult {
                    choices: RewardChoiceSet {
                        names,
                        source: RewardChoiceSource::Ocr,
                        elapsed: started.elapsed(),
                    },
                    diagnostic: RewardSourceDiagnostic::MemoryFallback,
                }),
        }
    }
}

fn card_names(cards: Vec<(String, f32)>) -> Vec<String> {
    cards.into_iter().map(|(name, _)| name).collect()
}
