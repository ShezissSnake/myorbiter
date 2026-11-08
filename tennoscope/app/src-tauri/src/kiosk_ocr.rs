//! Read the kiosk's item names off the screen.
//!
//! Same philosophy as the reward-card reader, one important difference: the reward screen is
//! read all-or-nothing because four cards are one squad's choice, while the kiosk is read
//! per-slot. A hover card covers two tiles, a filtered inventory leaves the last row short, and
//! a scroll parks rows half out of view. None of those may take the other chips down with
//! them, so every crop stands on its own and slots that do not clear the match floor simply
//! render nothing.
//!
//! It is not general OCR: every label only has to land on the nearest of the player's own prime
//! parts (`CatalogIndex::reward_entries`), which is what makes a garbled read safe to drop.

use image::{DynamicImage, GenericImageView, GrayImage};
use std::collections::VecDeque;
use std::path::PathBuf;

use warframe_acquisition::RewardCatalogEntry;

use crate::{
    kiosk_geometry::{basket_label_rect, basket_quantity_rect},
    reward_ocr::{best_match, ocr_crop, ocr_crop_block, prepare_crop, title_brightness},
};

/// Below this a slot's read is treated as absent rather than published as a guess; same floor as
/// the reward reader.
pub const MATCH_FLOOR: f32 = 0.6;

/// Most Tesseract processes one read keeps running at once. Each is a whole CPU for ~100 ms, and
/// the game is drawing on the same machine: twelve at a time (the old cap) made the game itself
/// stutter on the kiosk screens. With the reader's memory below, a still screen starts none, so
/// the cap only shapes the first look at a page.
const OCR_WORKERS: usize = 4;

/// How many crops the reader remembers. A settle that walks the whole recovery ladder looks at
/// 9 probes x (24 grid labels + 16 basket rows + 16 quantities), about 500 crops; twice that keeps
/// a visit's pages and their neighbours without letting a long visit grow without bound.
const MEMORY_CAPACITY: usize = 1024;

/// How far a pixel may move between two captures of a still screen and still count as unchanged.
/// Captures are not bit-identical (scaling, dithering and the drifting menu background move
/// pixels by a level or two); text appearing, going or changing moves glyph pixels by a hundred
/// levels or more.
const PIXEL_CHANGE: u8 = 24;

/// How many pixels may move further than [`PIXEL_CHANGE`] for two crops to still read the same: a
/// stray sparkle of the background, never a glyph (one digit of a stack marker at 1080p moves
/// several dozen).
const CHANGED_PIXELS_ALLOWED: u32 = 16;

#[derive(Clone, Debug)]
pub struct GridCell {
    pub col: usize,
    pub row: usize,
    pub name: String,
    pub score: f32,
}

#[derive(Clone, Debug)]
pub struct BasketRow {
    pub index: usize,
    pub name: String,
    pub score: f32,
    pub quantity: u32,
}

/// Distinguishes concurrent readers' scratch crops (same reason as `reward_ocr::SCRATCH`).
static SCRATCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn scratch_file() -> PathBuf {
    let ticket = SCRATCH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tennoscope-kiosk-crop-{}-{ticket}.png",
        std::process::id()
    ))
}

/// A crop as the reader remembers it: its pixels' brightest channel, the grey the label
/// pipeline starts from. Compared on the source pixels rather than on the thresholded crop:
/// the threshold's contrast stretch is per crop, so on an empty basket row (background art only)
/// it turns capture noise into hundreds of flipped pixels, where the source moved by two levels.
#[derive(Clone)]
struct CropKey {
    width: u32,
    height: u32,
    grey: Vec<u8>,
}

impl CropKey {
    fn of(image: &DynamicImage, x: u32, y: u32, width: u32, height: u32) -> Self {
        let grey = image
            .view(x, y, width, height)
            .pixels()
            .map(|(_, _, pixel)| title_brightness(pixel[0], pixel[1], pixel[2]))
            .collect();
        Self {
            width,
            height,
            grey,
        }
    }

    fn matches(&self, other: &Self) -> bool {
        if self.width != other.width || self.height != other.height {
            return false;
        }
        let mut changed = 0_u32;
        for (left, right) in self.grey.iter().zip(&other.grey) {
            if left.abs_diff(*right) > PIXEL_CHANGE {
                changed += 1;
                if changed > CHANGED_PIXELS_ALLOWED {
                    return false;
                }
            }
        }
        true
    }
}

/// What earlier crops read as, newest last, bounded by [`MEMORY_CAPACITY`].
struct CropMemory<T> {
    entries: VecDeque<(CropKey, T)>,
}

impl<T: Clone> CropMemory<T> {
    fn new() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }

    /// Newest first: a still screen's crops match the previous look's, which sit at the back.
    fn recall(&self, key: &CropKey) -> Option<T> {
        self.entries
            .iter()
            .rev()
            .find(|(known, _)| known.matches(key))
            .map(|(_, value)| value.clone())
    }

    fn remember(&mut self, key: CropKey, value: T) {
        if self.entries.len() >= MEMORY_CAPACITY {
            self.entries.pop_front();
        }
        self.entries.push_back((key, value));
    }
}

/// A crop the reader has not seen yet: its slot or row, its rectangle, and the key it will be
/// remembered under.
type FreshCrop = (usize, (u32, u32, u32, u32), CropKey);

/// The kiosk's reader for one visit: it remembers what each crop read as, so the poller's
/// repeated looks at a screen that has not changed cost a few crops' worth of arithmetic instead
/// of a Tesseract process per label. A visit gets a fresh reader, and the memory goes with it.
pub struct KioskReader {
    labels: CropMemory<Option<SlotRead>>,
    quantities: CropMemory<Option<u32>>,
    ocr_runs: u64,
}

impl Default for KioskReader {
    fn default() -> Self {
        Self::new()
    }
}

impl KioskReader {
    pub fn new() -> Self {
        Self {
            labels: CropMemory::new(),
            quantities: CropMemory::new(),
            ocr_runs: 0,
        }
    }

    /// Tesseract processes this reader has started. A second read of an unchanged frame adds none.
    #[cfg(test)]
    pub fn ocr_runs(&self) -> u64 {
        self.ocr_runs
    }

    /// The grid and the basket of one frame, sharing one luma conversion.
    pub fn read(
        &mut self,
        image: &DynamicImage,
        candidates: &[RewardCatalogEntry],
        dy: i32,
    ) -> (Vec<GridCell>, Vec<BasketRow>) {
        let luma = image.to_luma8();
        (
            self.grid_from(&luma, image, candidates, dy),
            self.basket_from(&luma, image, candidates),
        )
    }

    /// Read every grid slot independently; slots below the floor are simply not returned.
    #[cfg(test)]
    pub fn read_grid(
        &mut self,
        image: &DynamicImage,
        candidates: &[RewardCatalogEntry],
        dy: i32,
    ) -> Vec<GridCell> {
        self.grid_from(&image.to_luma8(), image, candidates, dy)
    }

    /// Read every visible basket row independently; rows past the list's end read blank and drop
    /// out.
    #[cfg(test)]
    pub fn read_basket(
        &mut self,
        image: &DynamicImage,
        candidates: &[RewardCatalogEntry],
    ) -> Vec<BasketRow> {
        self.basket_from(&image.to_luma8(), image, candidates)
    }

    fn grid_from(
        &mut self,
        luma: &GrayImage,
        image: &DynamicImage,
        candidates: &[RewardCatalogEntry],
        dy: i32,
    ) -> Vec<GridCell> {
        let (width, height) = image.dimensions();
        let slots: Vec<(usize, usize)> = (0..crate::kiosk_geometry::GRID_ROWS)
            .flat_map(|row| (0..crate::kiosk_geometry::GRID_COLS).map(move |col| (col, row)))
            .collect();
        let rects: Vec<_> = slots
            .iter()
            .map(|&(col, row)| crate::kiosk_geometry::grid_label_rect(width, height, col, row, dy))
            .collect();
        let reads = self.read_labels(luma, image, &rects, candidates);
        slots
            .into_iter()
            .zip(reads)
            .filter_map(|((col, row), read)| {
                read.map(|read| GridCell {
                    col,
                    row,
                    name: read.name,
                    score: read.score,
                })
            })
            .collect()
    }

    fn basket_from(
        &mut self,
        luma: &GrayImage,
        image: &DynamicImage,
        candidates: &[RewardCatalogEntry],
    ) -> Vec<BasketRow> {
        let (width, height) = image.dimensions();
        let rects: Vec<_> = (0..crate::kiosk_geometry::BASKET_ROWS)
            .map(|index| basket_label_rect(width, height, index))
            .collect();
        let recognized: Vec<(usize, SlotRead)> = self
            .read_labels(luma, image, &rects, candidates)
            .into_iter()
            .enumerate()
            .filter_map(|(index, read)| read.map(|read| (index, read)))
            .collect();
        let quantities = self.read_quantities(image, &recognized);
        recognized
            .into_iter()
            .zip(quantities)
            .map(|((index, read), quantity)| BasketRow {
                index,
                quantity,
                name: read.name,
                score: read.score,
            })
            .collect()
    }

    /// Read each rect's label, preserving order: remembered crops answer from memory, the rest go
    /// to Tesseract a few at a time and are remembered, unreadable ones included (Tesseract reads
    /// the same pixels the same way, so a garbled crop stays garbled).
    fn read_labels(
        &mut self,
        luma: &GrayImage,
        image: &DynamicImage,
        rects: &[Option<(u32, u32, u32, u32)>],
        candidates: &[RewardCatalogEntry],
    ) -> Vec<Option<SlotRead>> {
        let (width, height) = image.dimensions();
        let mut reads: Vec<Option<SlotRead>> = vec![None; rects.len()];
        let mut fresh: Vec<FreshCrop> = Vec::new();
        for (index, rect) in rects.iter().enumerate() {
            let Some((x, y, w, h)) = *rect else {
                continue;
            };
            // A window smaller than the 1080p calibration cannot contain these fractions at pixel
            // fidelity; clipping to the frame beats panicking on an out-of-bounds view.
            if x + w > width || y + h > height || w == 0 || h == 0 {
                continue;
            }
            if !band_has_text(luma, x, y, w, h) {
                continue;
            }
            let key = CropKey::of(image, x, y, w, h);
            match self.labels.recall(&key) {
                Some(known) => reads[index] = known,
                None => fresh.push((index, (x, y, w, h), key)),
            }
        }
        self.ocr_runs += fresh.len() as u64;
        let results = in_parallel(&fresh, |(_, (x, y, w, h), _)| {
            read_label(image, *x, *y, *w, *h, candidates)
        });
        for ((index, _, key), read) in fresh.into_iter().zip(results) {
            self.labels.remember(key, read.clone());
            reads[index] = read;
        }
        reads
    }

    /// Quantity OCR is independent per row, remembered like the labels, and bounded by the same
    /// worker cap.
    fn read_quantities(&mut self, image: &DynamicImage, rows: &[(usize, SlotRead)]) -> Vec<u32> {
        let mut quantities = vec![1_u32; rows.len()];
        let mut fresh: Vec<FreshCrop> = Vec::new();
        for (position, (index, _)) in rows.iter().enumerate() {
            let Some((x, y, w, h)) = basket_quantity_rect(image.width(), image.height(), *index)
            else {
                continue;
            };
            if w == 0 || h == 0 || x + w > image.width() || y + h > image.height() {
                continue;
            }
            let key = CropKey::of(image, x, y, w, h);
            match self.quantities.recall(&key) {
                Some(known) => quantities[position] = known.unwrap_or(1),
                None => fresh.push((position, (x, y, w, h), key)),
            }
        }
        self.ocr_runs += fresh.len() as u64;
        let results = in_parallel(&fresh, |(_, (x, y, w, h), _)| {
            read_quantity_crop(image, *x, *y, *w, *h)
        });
        for ((position, _, key), quantity) in fresh.into_iter().zip(results) {
            self.quantities.remember(key, quantity);
            quantities[position] = quantity.unwrap_or(1);
        }
        quantities
    }
}

/// Read every grid slot of one frame with a reader of its own (no memory carried between calls).
#[cfg(test)]
pub fn read_grid(
    image: &DynamicImage,
    candidates: &[RewardCatalogEntry],
    dy: i32,
) -> Vec<GridCell> {
    KioskReader::new().read_grid(image, candidates, dy)
}

/// Read every basket row of one frame with a reader of its own (no memory carried between calls).
#[cfg(test)]
pub fn read_basket(image: &DynamicImage, candidates: &[RewardCatalogEntry]) -> Vec<BasketRow> {
    KioskReader::new().read_basket(image, candidates)
}

/// Run `work` over `items` on at most [`OCR_WORKERS`] threads, preserving order. The threads are
/// scoped to the call, so none outlives a read, and the cap bounds how many run (and how many
/// allocator arenas they claim) at once.
fn in_parallel<T, R>(items: &[T], work: impl Fn(&T) -> R + Sync) -> Vec<R>
where
    T: Sync,
    R: Send,
{
    let workers = std::thread::available_parallelism()
        .map_or(1, std::num::NonZeroUsize::get)
        .min(items.len())
        .min(OCR_WORKERS);
    if workers <= 1 {
        return items.iter().map(&work).collect();
    }
    let work = &work;
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..items.len())
                        .step_by(workers)
                        .map(|index| (index, work(&items[index])))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let mut results: Vec<Option<R>> = std::iter::repeat_with(|| None).take(items.len()).collect();
        for handle in handles {
            for (index, result) in handle.join().expect("kiosk ocr worker") {
                results[index] = Some(result);
            }
        }
        results.into_iter().map(|result| result.expect("every item read")).collect()
    })
}

/// Read the optional `N X` stack marker anywhere inside the bounded basket-label band. The
/// band is read in the full charset, like the name lane: letters stay letters, so unlike
/// the old digit-whitelist lane a name initial can never become a count. Only the
/// game's own marker forms digit+X.
fn read_quantity_crop(
    image: &DynamicImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Option<u32> {
    if width == 0 || height == 0 || x + width > image.width() || y + height > image.height() {
        return None;
    }
    // Raw pixels, not the name lane's threshold pipeline: thresholding eats thin stack
    // digits. Full charset, so letters stay letters and only the game's own marker
    // forms digit+X.
    let crop = scratch_file();
    image.crop_imm(x, y, width, height).save(&crop).ok()?;
    let text = ocr_crop(&crop);
    let _ = std::fs::remove_file(&crop);
    let text = text.ok()?;
    Some(basket_quantity(&text)).filter(|&quantity| quantity > 1)
}

#[derive(Clone, Debug)]
struct SlotRead {
    name: String,
    score: f32,
}

/// Luma range below which a band is background rather than text. The game draws labels as
/// bright glyphs on a dark pane, so a populated band swings hard between the two; an empty
/// slot's band barely varies. One cheap pass over the raw band replaces a whole tesseract
/// spawn for every slot the grid is not showing.
const BLANK_BAND_RANGE: u8 = 40;

/// True when the band holds glyphs worth reading.
fn band_has_text(luma: &GrayImage, x: u32, y: u32, w: u32, h: u32) -> bool {
    let mut min = u8::MAX;
    let mut max = u8::MIN;
    for row in y..y + h {
        // `rows` hands back a borrowed slice of one scanline; skip/take trims to the band.
        let stride = luma.width() as usize;
        let start = row as usize * stride + x as usize;
        for cell in &luma.as_raw()[start..start + w as usize] {
            min = min.min(*cell);
            max = max.max(*cell);
        }
    }
    max.saturating_sub(min) >= BLANK_BAND_RANGE
}

/// One label crop through Tesseract and the closed-set match.
fn read_label(
    image: &DynamicImage,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    candidates: &[RewardCatalogEntry],
) -> Option<SlotRead> {
    let prepared = prepare_crop(image, x, y, width, height);
    let crop = scratch_file();
    prepared.save(&crop).ok()?;
    // Label slots read as one ordered block: the card art above the label is a large bright
    // mass, and sparse-text segmentation lets it eat any glyphs touching it. The basket
    // quantity lane below deliberately stays on `ocr_crop`.
    let text = ocr_crop_block(&crop);
    let _ = std::fs::remove_file(&crop);
    let text = text.ok()?;
    let (name, score) = best_match(&text, candidates)?;
    (score >= MATCH_FLOOR).then_some(SlotRead { name, score })
}

/// Split Warframe's optional basket stack prefix from full-charset band text. The band
/// carries the marker glued to the item name, so the parse looks for digit+X anywhere in
/// the text rather than trusting the first token (the old whitelist lane mangled name
/// initials into counts). Besides `X`, Tesseract's observed `K` confusion is accepted
/// either way. The trailing guard rejects a misread glued to lowercase (`4ksomati...`)
/// while tolerating dropped spaces (`3XBraton`, `2XK`).
fn basket_quantity(text: &str) -> u32 {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            let mut k = j;
            // Tesseract's band text wraps across lines, so the marker gap is any
            // ASCII whitespace, not just spaces.
            while k < bytes.len() && bytes[k].is_ascii_whitespace() {
                k += 1;
            }
            if k < bytes.len() && matches!(bytes[k], b'X' | b'x' | b'K' | b'k') {
                let after = k + 1;
                if after >= bytes.len() || !bytes[after].is_ascii_lowercase() {
                    if let Ok(count) = text[i..j].parse::<u32>() {
                        return count;
                    }
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use warframe_acquisition::RewardCatalogEntry;

    /// The catalog subset visible in the fixture, plus near-miss decoys that a garbled read
    /// could plausibly land on if the closed set were doing less work than it should.
    fn candidates() -> Vec<RewardCatalogEntry> {
        [
            "Afentis Prime Blade",
            "Alternox Prime Stock",
            "Athodai Prime Barrel",
            "Atlas Prime Chassis Blueprint",
            "Caliban Prime Systems Blueprint",
            "Epitaph Prime Receiver",
            "Fulmin Prime Receiver",
            "Hystrix Prime Receiver",
            "Euphona Prime Receiver",
            "Titania Prime Systems Blueprint",
            "Tiberon Prime Barrel",
            "Kompressa Prime Barrel",
            "Tiberon Prime Stock",
            "Titania Prime Chassis Blueprint",
        ]
        .into_iter()
        .map(|name| RewardCatalogEntry {
            name: name.to_owned(),
            ducats: 100,
        })
        .collect()
    }

    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/kiosk/kiosk-open.png"
    );

    const QUANTITY_LIVE_FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/kiosk/kiosk-quantity-game.png"
    );

    #[test]
    fn reads_known_grid_cells_from_the_fixture() {
        let img = image::open(FIXTURE).unwrap();
        let cells = read_grid(&img, &candidates(), 0);
        for (expected, col, row) in [
            ("Titania Prime Systems Blueprint", 0usize, 0usize),
            ("Tiberon Prime Barrel", 0, 1),
            ("Atlas Prime Chassis Blueprint", 0, 2),
        ] {
            let hit = cells
                .iter()
                .find(|c| c.col == col && c.row == row)
                .unwrap_or_else(|| panic!("cell ({col},{row}) missing; got {cells:?}"));
            assert_eq!(hit.name, expected, "cell ({col},{row})");
            assert!(hit.score >= 0.85, "cell ({col},{row}) score {}", hit.score);
        }
    }

    /// A scrolled grid is read where the rows actually are: shifted one full row pitch down,
    /// row 0's band lands on row 1's labels. The 2026-08-23 session that died at dy=-142,
    /// had the reads been phase-corrected, would have read its rows exactly like this.
    #[test]
    fn a_scrolled_grid_is_read_at_the_shifted_bands() {
        let img = image::open(FIXTURE).unwrap();
        let cells = read_grid(&img, &candidates(), 222);
        let hit = cells
            .iter()
            .find(|c| c.col == 0 && c.row == 0)
            .expect("row 0 col 0 read through the shifted band");
        assert_eq!(hit.name, "Tiberon Prime Barrel");
    }

    /// At a -142px phase the pane exposes a fourth card row at the bottom. Reuse a known
    /// fixture label there: the reader must enumerate it, not stop at the three unscrolled rows.
    #[test]
    fn a_scrolled_grid_reads_the_fourth_visible_row() {
        use image::GenericImage;

        let source = image::open(FIXTURE).unwrap();
        let mut frame = source.clone();
        let known_label = source.crop_imm(76, 765, 190, 68);
        frame
            .copy_from(&known_label, 76, 845)
            .expect("known label copied into entering row");

        let cells = read_grid(&frame, &candidates(), -142);
        let hit = cells
            .iter()
            .find(|cell| cell.col == 0 && cell.row == 3)
            .unwrap_or_else(|| panic!("fourth visible row missing; got {cells:?}"));
        assert_eq!(hit.name, "Atlas Prime Chassis Blueprint");
    }

    #[test]
    fn parses_stacked_basket_quantity_prefix() {
        assert_eq!(basket_quantity("2 X Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("2 x Kompressa Prime Barrel"), 2);
        // The production threshold pipeline reads the live separator as K/k; retain the
        // deliberately narrow confusion set rather than accepting any token after a number.
        assert_eq!(basket_quantity("2 K Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("2X Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("2k Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("2XK"), 2);
        assert_eq!(basket_quantity("2 k Kompressa Prime Barrel"), 2);
        // PSM-11 band text wraps mid-marker; the gap accepts any whitespace.
        assert_eq!(basket_quantity("2\nX Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("2\tX Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("2 \n X Kompressa Prime Barrel"), 2);
        assert_eq!(basket_quantity("3XBraton Prime Receiver"), 3);
        // Full-charset text can carry junk before a real marker; the marker is still the
        // marker, and junk alone can no longer fabricate one (no whitelist mangling).
        assert_eq!(basket_quantity("kxk 2XK"), 2);
        assert_eq!(basket_quantity("xkx 2XK"), 2);
        assert_eq!(basket_quantity("kxk xkx 2XK"), 2);
        assert_eq!(basket_quantity("Kompressa Prime Barrel"), 1);
        assert_eq!(basket_quantity("2 Kompressa Prime Barrel"), 1);
        assert_eq!(basket_quantity("2 Z Kompressa Prime Barrel"), 1);
        // A name initial glued to a surviving letter is not a stack, and neither are
        // ducat counts or chip prices.
        assert_eq!(basket_quantity("Aksomati Prime Barrel"), 1);
        assert_eq!(basket_quantity("Afuris Prime Link"), 1);
        assert_eq!(basket_quantity("Nekros Prime Systems Blueprint"), 1);
        assert_eq!(basket_quantity("45"), 1);
        assert_eq!(basket_quantity("100"), 1);
        assert_eq!(basket_quantity("135"), 1);
        assert_eq!(basket_quantity("30p"), 1);
        assert_eq!(basket_quantity("4p"), 1);
    }

    #[test]
    fn reads_stacked_quantity_through_production_basket_geometry() {
        let image = image::open(QUANTITY_LIVE_FIXTURE).unwrap();
        let rows = read_basket(&image, &candidates());
        let stacked = rows
            .iter()
            .find(|row| row.name == "Kompressa Prime Barrel")
            .unwrap_or_else(|| panic!("stacked basket row missing; got {rows:?}"));

        assert_eq!(stacked.index, 2);
        assert_eq!(stacked.quantity, 2);
    }

    #[test]
    fn reads_basket_rows_from_the_fixture() {
        let img = image::open(FIXTURE).unwrap();
        let rows = read_basket(&img, &candidates());
        for (expected, index) in [
            ("Afentis Prime Blade", 0usize),
            ("Hystrix Prime Receiver", 6usize),
        ] {
            let hit = rows
                .iter()
                .find(|r| r.index == index)
                .unwrap_or_else(|| panic!("basket row {index} missing; got {rows:?}"));
            assert_eq!(hit.name, expected);
            assert!(hit.score >= 0.85);
        }
    }

    /// The live game basket has three occupied rows. A widened name crop crosses the pane
    /// boundary and can recognize adjacent grid text as a fourth, orphan-priced basket row.
    /// The chip masks blank the pair column where the overlay draws, but the game's own
    /// "2 X" stack marker is a name prefix far left of it: a masked frame must still read a
    /// real stacked quantity.
    #[test]
    fn masking_the_published_chips_does_not_hide_a_stacked_quantity() {
        let mut image = image::open(QUANTITY_LIVE_FIXTURE).unwrap();
        let view = crate::kiosk_view::KioskView {
            session: 0,
            epoch: 0,
            cells: vec![],
            basket: (0..3)
                .map(|index| crate::kiosk_view::BasketChip {
                    index,
                    name: format!("row {index}"),
                    platinum: Some(10),
                })
                .collect(),
            total_plat: 40,
            scroll_dy: 0,
            mastery_status: crate::kiosk_view::MasteryStatus::Off,
        };
        crate::kiosk_view::mask_published_chips(&mut image, &view, 0);
        let rows = read_basket(&image, &candidates());
        let stacked = rows
            .iter()
            .find(|row| row.name == "Kompressa Prime Barrel")
            .unwrap_or_else(|| panic!("stacked basket row missing post-mask; got {rows:?}"));
        assert_eq!(stacked.index, 2);
        assert_eq!(
            stacked.quantity, 2,
            "the game's own stack marker survives the chip mask: {rows:?}"
        );
    }

    /// Every label the fixture's grid renders in full, one per tile across its three rows.
    const GRID_NAMES: [&str; 18] = [
        "Titania Prime Systems Blueprint",
        "Trumna Prime Barrel",
        "Trumna Prime Receiver",
        "Vadarya Prime Blueprint",
        "Venato Prime Blade",
        "Fragor Prime Handle",
        "Tiberon Prime Barrel",
        "Wisp Prime Chassis Blueprint",
        "Afuris Prime Link",
        "Akbronco Prime Link",
        "Aksomati Prime Barrel",
        "Alternox Prime Barrel",
        "Atlas Prime Chassis Blueprint",
        "Braton Prime Receiver",
        "Bronco Prime Barrel",
        "Burston Prime Barrel",
        "Caliban Prime Blueprint",
        "Cedo Prime Receiver",
    ];

    /// A strip's mask is wider than the price chip's. Painted at both strip widths over a real
    /// frame, it must leave the locator's answer and the grid read exactly as they were.
    #[test]
    fn strip_masks_leave_the_locator_and_the_grid_read_unchanged() {
        let frame = image::open(FIXTURE).unwrap();
        let candidates: Vec<RewardCatalogEntry> = GRID_NAMES
            .iter()
            .map(|name| RewardCatalogEntry {
                name: (*name).to_owned(),
                ducats: 45,
            })
            .collect();
        let profile = |frame: &DynamicImage| {
            let (x, y, w, h) = crate::kiosk_geometry::grid_strip(frame.width(), frame.height());
            crate::kiosk_scroll::row_profiles(frame, x, y, w, h)
        };
        let locate = |strip: &[f32]| {
            let at = crate::kiosk_geometry::label_anchors(strip.len());
            crate::kiosk_scroll::label_offset(strip, at.strip_top, at.first_top, at.pitch, at.band)
        };
        let unmasked_strip = profile(&frame);
        let located = locate(&unmasked_strip).expect("the fixture's labels locate");
        let read = |frame: &DynamicImage| -> Vec<(usize, usize, String, f32)> {
            read_grid(frame, &candidates, located.dy)
                .into_iter()
                .map(|cell| (cell.col, cell.row, cell.name, cell.score))
                .collect()
        };
        let unmasked = read(&frame);

        let view = crate::kiosk_view::KioskView {
            cells: unmasked
                .iter()
                .map(|(col, row, name, _)| crate::kiosk_view::CellChip {
                    col: *col as u32,
                    row: *row as u32,
                    name: name.clone(),
                    platinum: Some(10),
                    // A checkerboard of one- and two-digit badges paints both strip widths.
                    mastery: Some(warframe_domain::KioskMastery {
                        held: if (col + row) % 2 == 0 { 1 } else { 12 },
                        uses: 2,
                    }),
                })
                .collect(),
            scroll_dy: crate::kiosk_scroll::to_design_px(located.dy, unmasked_strip.len()),
            mastery_status: crate::kiosk_view::MasteryStatus::Live,
            ..crate::kiosk_view::KioskView::default()
        };
        let mut masked = frame.clone();
        crate::kiosk_view::mask_published_chips(&mut masked, &view, view.scroll_dy);
        assert!(
            masked.to_rgb8() != frame.to_rgb8(),
            "the strip masks must paint over the frame"
        );

        assert_eq!(
            locate(&profile(&masked)),
            Some(located),
            "the locator must name the same phase and bands"
        );
        assert_eq!(
            read(&masked),
            unmasked,
            "every tile must read the same name at the same score"
        );
    }

    const BASKET16_DEV_FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/kiosk/kiosk-basket-16-dev.png"
    );

    /// The pane fits sixteen rows before the TOTAL row (row 15's baseline is 818 against
    /// TOTAL at 875).
    #[test]
    fn a_sixteen_row_live_basket_reads_through_its_last_row() {
        let image = image::open(BASKET16_DEV_FIXTURE).unwrap();
        let names = [
            "Afuris Prime Link",
            "Atlas Prime Chassis Blueprint",
            "Tiberon Prime Barrel",
            "Vadarya Prime Blueprint",
            "Nekros Prime Systems Blueprint",
            "Panthera Prime Barrel",
            "Titania Prime Systems Blueprint",
            "Trumna Prime Barrel",
            "Trumna Prime Receiver",
            "Wisp Prime Chassis Blueprint",
            "Fragor Prime Handle",
            "Venato Prime Blade",
            "Aksomati Prime Barrel",
            "Alternox Prime Barrel",
            "Akbronco Prime Link",
            "Braton Prime Receiver",
        ];
        let candidates: Vec<RewardCatalogEntry> = names
            .iter()
            .map(|name| RewardCatalogEntry {
                name: (*name).to_owned(),
                ducats: 45,
            })
            .collect();
        let rows = read_basket(&image, &candidates);
        assert_eq!(rows.len(), 16, "all sixteen basket rows read: {rows:?}");
        for (index, name) in names.iter().enumerate() {
            let hit = rows
                .iter()
                .find(|row| row.index == index)
                .unwrap_or_else(|| panic!("basket row {index} missing; got {rows:?}"));
            assert_eq!(&hit.name, name, "basket row {index}");
        }
        for row in &rows {
            let want = if row.index == 15 { 3 } else { 1 };
            assert_eq!(
                row.quantity, want,
                "row {} ({}): no phantom stacks, real marker kept: {rows:?}",
                row.index, row.name
            );
        }
    }

    #[test]
    fn live_basket_does_not_match_adjacent_grid_text_as_a_fourth_row() {
        let image = image::open(QUANTITY_LIVE_FIXTURE).unwrap();
        let rows = read_basket(&image, &candidates());

        assert!(
            rows.iter().all(|row| row.index < 3),
            "basket recognition must stay inside the game basket pane: {rows:?}"
        );
    }

    /// The recorded Sell frame of the per-frame budget: a 6x4 grid (rows 0-2 readable, row 3
    /// below the pane's clip by design, so 18 labels is the most any recorded frame shows) and a
    /// six-row basket.
    const SELL_GRID_FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/kiosk/kiosk-baseline.png"
    );

    fn sell_grid_candidates() -> Vec<RewardCatalogEntry> {
        [
            "Afentis Prime Blade",
            "Alternox Prime Stock",
            "Athodai Prime Barrel",
            "Caliban Prime Systems Blueprint",
            "Epitaph Prime Receiver",
            "Fulmin Prime Receiver",
            "Hystrix Prime Receiver",
            "Kompressa Prime Barrel",
            "Kronen Prime Blade",
            "Styanax Prime Neuroptics Blueprint",
            "Titania Prime Systems Blueprint",
            "Trumna Prime Barrel",
            "Trumna Prime Receiver",
            "Vadarya Prime Blueprint",
            "Venato Prime Blade",
            "Fragor Prime Handle",
            // Near misses a garbled read could land on.
            "Titania Prime Chassis Blueprint",
            "Tiberon Prime Barrel",
            "Atlas Prime Chassis Blueprint",
            "Kronen Prime Handle",
        ]
        .into_iter()
        .map(|name| RewardCatalogEntry {
            name: name.to_owned(),
            ducats: 100,
        })
        .collect()
    }

    /// The same frame with every channel nudged by up to two levels, deterministically: what two
    /// captures of a still screen look like to the reader.
    fn with_capture_noise(frame: &DynamicImage) -> DynamicImage {
        let mut noisy = frame.to_rgb8();
        let mut state = 0x2545_f491_u32;
        for value in noisy.iter_mut() {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let nudge = (state >> 29) as i16 % 5 - 2;
            *value = (i16::from(*value) + nudge).clamp(0, 255) as u8;
        }
        DynamicImage::ImageRgb8(noisy)
    }

    fn named(cells: &[GridCell]) -> Vec<(usize, usize, String)> {
        let mut named: Vec<_> = cells
            .iter()
            .map(|cell| (cell.col, cell.row, cell.name.clone()))
            .collect();
        named.sort();
        named
    }

    /// The per-frame budget of the kiosk's busiest screen, pinned in Tesseract runs rather than
    /// milliseconds (runs are the cost, and they do not depend on the machine): one run per label
    /// and basket row on the first look at a page, and none at all for every later look at the same
    /// page, even when the capture is not bit-identical. Timings print with `--nocapture`.
    #[test]
    fn a_still_sell_grid_costs_one_read_per_label_then_none() {
        let frame = image::open(SELL_GRID_FIXTURE).unwrap();
        let candidates = sell_grid_candidates();
        let mut reader = KioskReader::new();

        let started = std::time::Instant::now();
        let (cells, basket) = reader.read(&frame, &candidates, 0);
        let first = started.elapsed();
        let first_runs = reader.ocr_runs();
        for (expected, col, row) in [
            ("Afentis Prime Blade", 0, 0),
            ("Fulmin Prime Receiver", 5, 0),
            ("Hystrix Prime Receiver", 0, 1),
            ("Styanax Prime Neuroptics Blueprint", 5, 1),
            ("Titania Prime Systems Blueprint", 0, 2),
            ("Fragor Prime Handle", 5, 2),
        ] {
            assert!(
                cells
                    .iter()
                    .any(|cell| cell.name == expected && cell.col == col && cell.row == row),
                "{expected} at ({col},{row}) in {:?}",
                named(&cells)
            );
        }
        assert_eq!(basket.len(), 6, "the six basket rows: {basket:?}");
        // 18 grid labels + 16 basket name bands (the empty rows' art passes the blank-band check)
        // + 6 quantity bands = 40 on this page; blank grid slots cost nothing.
        assert!(
            (24..=40).contains(&first_runs),
            "first look at the page: {first_runs} Tesseract runs"
        );

        let started = std::time::Instant::now();
        let (again, basket_again) = reader.read(&frame, &candidates, 0);
        let repeat = started.elapsed();
        assert_eq!(reader.ocr_runs(), first_runs, "an unchanged frame is never read again");
        assert_eq!(named(&again), named(&cells));
        assert_eq!(basket_again.len(), basket.len());

        let noisy = with_capture_noise(&frame);
        let started = std::time::Instant::now();
        let (recaptured, _) = reader.read(&noisy, &candidates, 0);
        let noisy_repeat = started.elapsed();
        assert_eq!(
            reader.ocr_runs(),
            first_runs,
            "a second capture of the same still screen is not read again either"
        );
        assert_eq!(named(&recaptured), named(&cells));

        eprintln!(
            "kiosk pass on {SELL_GRID_FIXTURE}: first {first:?} ({first_runs} Tesseract runs), \
             repeat {repeat:?}, recaptured {noisy_repeat:?} (0 runs)"
        );
        // Loose on purpose: the runs above are the budget; this only catches a repeat look
        // that went back to doing real work.
        assert!(
            repeat * 4 < first && noisy_repeat * 4 < first,
            "repeat looks must cost a fraction of the first: {first:?} vs {repeat:?}/{noisy_repeat:?}"
        );
    }

    /// The memory answers only for the same label: one reader carried from one page to another
    /// reads the second exactly as a fresh reader would.
    #[test]
    fn a_remembered_page_never_answers_for_another() {
        let open = image::open(FIXTURE).unwrap();
        let sell = image::open(SELL_GRID_FIXTURE).unwrap();
        let mut candidates = candidates();
        candidates.extend(sell_grid_candidates());
        let mut carried = KioskReader::new();
        carried.read(&open, &candidates, 0);
        let (cells, basket) = carried.read(&sell, &candidates, 0);
        let (fresh_cells, fresh_basket) = KioskReader::new().read(&sell, &candidates, 0);
        assert_eq!(named(&cells), named(&fresh_cells));
        let rows = |rows: &[BasketRow]| -> Vec<(usize, String, u32)> {
            rows.iter()
                .map(|row| (row.index, row.name.clone(), row.quantity))
                .collect()
        };
        assert_eq!(rows(&basket), rows(&fresh_basket));
    }
}
