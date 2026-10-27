//! Reads back the relic reward screens TennoScope has read, from its own log file.
//!
//! A patched TennoScope reads the cards off every reward screen and logs each reading once, in
//! UTC, with the squad's relics:
//!
//! ```text
//! [2026-10-13][12:12:29][app_lib::reward_recognition][INFO] reward: published cards=["Bronco Prime Blueprint" 0.95, "Forma Blueprint" 1.00] pool=22 relics=["T3VoidProjectionYareliPrimeABronze", "T2VoidProjectionStyanaxPrimeDPlatinum"]
//! ```
//!
//! A screen it couldn't read leaves a `read failed` warning instead: still a screen (and so a
//! fissure round's worth of time), just without its cards. Read-only; the log is TennoScope's.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const PUBLISHED: &str = "][app_lib::reward_recognition][INFO] reward: published cards=[";
const READ_FAILED: &str = "][app_lib::reward_recognition][WARN] [DEBUG-recognition] read failed";
const PROJECTION_PREFIX: &str = "/Lotus/Types/Game/Projections/";
/// TennoScope logs a screen once, but a screen it read again (a second look while it stayed up,
/// or a failed read before the good one) lands within this many seconds of the first.
const SAME_SCREEN_SECS: i64 = 90;

/// One relic reward screen TennoScope saw.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct LoggedScreen {
    /// Unix milliseconds (the log's clock is UTC, to the second).
    pub at: i64,
    /// The cards as read, in screen order; empty when the screen couldn't be read.
    pub cards: Vec<String>,
    /// The squad's relics, as full projection paths (their refinement is the last word).
    pub relics: Vec<String>,
}

/// Every reward screen in TennoScope's logs (the current file and the ones it rotated out),
/// oldest first. Logs that can't be read are skipped: this is history, not something to fail on.
pub fn read_reward_logs(dirs: &[PathBuf]) -> Vec<LoggedScreen> {
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with("tennoscope") && name.ends_with(".log") && !files.contains(&path) {
                files.push(path);
            }
        }
        if !files.is_empty() {
            break;
        }
    }
    let mut screens = Vec::new();
    for file in &files {
        if let Ok(bytes) = fs::read(file) {
            screens.extend(parse_reward_log(&String::from_utf8_lossy(&bytes)));
        }
    }
    screens.sort_by_key(|s| s.at);
    merge_repeats(screens)
}

/// The log folders to look in: `<data dir>/logs`, then the default TennoScope folder's.
pub fn reward_log_dirs(data_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![data_dir.join("logs")];
    if let Some(default) = crate::default_tennoscope_dir().map(|d| d.join("logs")) {
        if !dirs.contains(&default) {
            dirs.push(default);
        }
    }
    dirs
}

/// The screens in one log's text, in file order (repeats not yet merged).
pub fn parse_reward_log(text: &str) -> Vec<LoggedScreen> {
    text.lines().filter_map(parse_line).collect()
}

fn parse_line(line: &str) -> Option<LoggedScreen> {
    let published = line.contains(PUBLISHED);
    if !published && !line.contains(READ_FAILED) {
        return None;
    }
    let at = line_time(line)?;
    if !published {
        return Some(LoggedScreen { at, ..Default::default() });
    }
    let rest = line.split_once(PUBLISHED)?.1;
    let (cards, rest) = rest.split_once("] pool=")?;
    let relics = rest
        .split_once("relics=[")
        .map(|(_, r)| quoted(r.trim_end().trim_end_matches(']')))
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.contains("VoidProjection"))
        .map(|r| if r.starts_with('/') { r } else { format!("{PROJECTION_PREFIX}{r}") })
        .collect();
    Some(LoggedScreen { at, cards: quoted(cards), relics })
}

/// The double-quoted strings in a Rust `{:?}` list, unescaped (`\"` and `\\`).
fn quoted(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut item = String::new();
        let mut closed = false;
        while let Some(c) = chars.next() {
            match c {
                '\\' => {
                    if let Some(next) = chars.next() {
                        item.push(next);
                    }
                }
                '"' => {
                    closed = true;
                    break;
                }
                c => item.push(c),
            }
        }
        if closed && !item.trim().is_empty() {
            out.push(item.trim().to_string());
        }
    }
    out
}

/// `[2026-10-13][12:12:29]…` → Unix milliseconds (UTC).
fn line_time(line: &str) -> Option<i64> {
    let b = line.as_bytes();
    if b.len() < 22 || b[0] != b'[' || b[11] != b']' || b[12] != b'[' || b[21] != b']' {
        return None;
    }
    let num = |s: &str| s.parse::<i64>().ok();
    let (y, mo, d) = (num(line.get(1..5)?)?, num(line.get(6..8)?)?, num(line.get(9..11)?)?);
    let (h, mi, s) = (num(line.get(13..15)?)?, num(line.get(16..18)?)?, num(line.get(19..21)?)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 60 {
        return None;
    }
    Some((days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + s) * 1_000)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// One entry per screen: a reading close after another is the same screen, and the one with
/// cards wins (a failed read followed by a good one, or the same cards logged twice).
fn merge_repeats(screens: Vec<LoggedScreen>) -> Vec<LoggedScreen> {
    let mut out: Vec<LoggedScreen> = Vec::with_capacity(screens.len());
    for s in screens {
        if let Some(last) = out.last_mut() {
            if s.at - last.at < SAME_SCREEN_SECS * 1_000 {
                if last.cards.is_empty() && !s.cards.is_empty() {
                    *last = s;
                }
                continue;
            }
        }
        out.push(s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"[2026-10-13][12:12:29][app_lib::reward_recognition][INFO] reward: published cards=["Bronco Prime Blueprint" 0.95, "Vadarya Prime Barrel" 1.00, "Forma Blueprint" 1.00] pool=22 relics=["T3VoidProjectionYareliPrimeABronze", "T2VoidProjectionStyanaxPrimeDPlatinum"]"#;

    #[test]
    fn reads_a_published_screen() {
        let s = parse_reward_log(GOOD);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].cards, vec!["Bronco Prime Blueprint", "Vadarya Prime Barrel", "Forma Blueprint"]);
        assert_eq!(s[0].relics, vec![
            "/Lotus/Types/Game/Projections/T3VoidProjectionYareliPrimeABronze",
            "/Lotus/Types/Game/Projections/T2VoidProjectionStyanaxPrimeDPlatinum"
        ]);
        // 2026-10-13 12:12:29 UTC
        assert_eq!(s[0].at, 1_791_893_549_000);
    }

    #[test]
    fn a_failed_read_is_a_screen_without_cards() {
        let s = parse_reward_log("[2026-10-18][09:24:19][app_lib::reward_recognition][WARN] [DEBUG-recognition] read failed: a reward card read as blank");
        assert_eq!(s.len(), 1);
        assert!(s[0].cards.is_empty() && s[0].relics.is_empty());
    }

    #[test]
    fn ignores_everything_else() {
        let text = "[2026-10-13][11:58:17][app_core][INFO] health: game process ready\n\
                    [2026-10-13][12:06:58][app_lib::reward_capture][INFO] [DEBUG-capture] rect source x11\n\
                    not a log line at all\n\
                    [2026-13-40][12:12:29][app_lib::reward_recognition][INFO] reward: published cards=[\"X\" 1.00] pool=1 relics=[]";
        assert!(parse_reward_log(text).is_empty());
    }

    #[test]
    fn a_screen_read_twice_is_one_screen() {
        let failed = "[2026-10-13][12:12:20][app_lib::reward_recognition][WARN] [DEBUG-recognition] read failed: x";
        let again = GOOD.replace("12:12:29", "12:12:31");
        let next = GOOD.replace("12:12:29", "12:16:40");
        let screens = merge_repeats(parse_reward_log(&format!("{failed}\n{GOOD}\n{again}\n{next}")));
        assert_eq!(screens.len(), 2);
        assert_eq!(screens[0].cards.len(), 3, "the good read replaces the failed one");
        assert_eq!(screens[1].at - screens[0].at, (4 * 60 + 11) * 1000);
    }

    #[test]
    fn unescapes_names() {
        assert_eq!(quoted(r#""A \"quoted\" name" 1.00, "" 0.5, "B" 0.9"#), vec![r#"A "quoted" name"#, "B"]);
    }

    #[test]
    fn reads_rotated_logs_oldest_first() {
        let dir = std::env::temp_dir().join(format!("orbiter-reward-log-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("tennoscope.log"), GOOD.replace("12:12:29", "13:00:00")).unwrap();
        fs::write(dir.join("tennoscope_2026-10-12.log"), GOOD).unwrap();
        fs::write(dir.join("other.log"), GOOD.replace("12:12:29", "14:00:00")).unwrap();
        let screens = read_reward_logs(&[dir.join("missing"), dir.clone()]);
        fs::remove_dir_all(&dir).ok();
        assert_eq!(screens.len(), 2);
        assert!(screens[0].at < screens[1].at);
    }
}
