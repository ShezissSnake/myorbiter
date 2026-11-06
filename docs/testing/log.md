# Testing log

One line per finished item: what was checked, what was found, and the commit. Newest last.
Property tests replay with `PROPERTY_SEED=<n>` and run longer with `PROPERTY_RUNS=<n>`.

| Item | Checked | Found | Commit |
| --- | --- | --- | --- |
| 1. Property tests, money logic | `tests/property.test.ts` (3,000 seeds each): listGuard (never past what the keep rules prove spare, never a never-sell item, never under its ducats, never on an untrusted read, whole copies and prices), inventory trust, modSpares (exact count, installed never spare, best and give-away copies kept), the ducat floor against exact integer arithmetic, the 70% repricing floor. `tests/propertyStores.test.ts` (400 seeds): overlapping sales that succeed or fail in any order, +rep in any case and order, timed repricing against random markets. Mutation check: each of 21 rules removed in turn, and a property failed every time (two properties were strengthened until they did). | A failed partial sale whose listing a later sale had closed on screen didn't come back (5 listed, sell 2, sell 3, the first fails: nothing shown instead of 2). Fixed in `marketStore.svelte.ts`. | a821ccc |
| 2. Settings and migration fuzzing | `tests/settingsFuzz.test.ts`: 1,500 hostile settings files (fields swapped for wrong types, NaN, huge numbers, text, nested junk; old schema-1 files with the first Sell spares switches; truncated files) through `loadSettings`; junk through 15 sanitizers and parsers. Invariants: never throws, automatic repricing, checking and hiding only from a strict `true`, every floor a finite number in range, the ducat rate a number, junk in a keep rule never keeps fewer than the usual rules. Mutation check: each new guard removed in turn fails the test. | Text "true" turned Apply automatically on; text, NaN or huge numbers removed the minimum price, the market-share floor and per-listing floors; junk turned the ducat check off; `every`/`minRelicPrice` took Infinity; an old file with non-object advice made loading throw; one odd riven auction entry made the list fail. All fixed in `backend.ts` and `rivens.ts`. | ed1bf32 |
| 3. Rust parser fuzzing | Seeded fuzz tests in `ee_log.rs` (random line mixes from real trade and mission lines, cut short, LF/CRLF/bare CR, odd Unicode, 600 KB lines, garbled clocks; the same log fed in random-sized chunks), `reward_log.rs`, `market.rs` (random JSON and real shapes with junk fields through every parser) and `noxsframe.rs` (the saved pages mutated; a streamed part with no end around multi-byte characters). Each fix mutation-checked. TennoScope's status report is only read for `at` and `pid` in Rust (the rest is fuzzed on the TypeScript side, item 2); the Overframe list is parsed in TypeScript (item 2). | Three panics on Nox's Frame pages (byte 20,000 cut inside a character, twice; an ld+json tag closed by its own `</script>`), and release builds abort on panic. Closed orders with an overflowing quantity or a zero/negative/absurd price became sales to import. A trade dialog that never closed grew for the whole session. All fixed. Found, not fixed: the workspace no longer builds on Rust 1.77.2 (see proposals). | 600125d |
| 4. Redaction and untrusted text | `tests/redactFuzz.test.ts`: 1,500 bug reports with your name, other players' names (any case, any punctuation around them), e-mails, IPs, JWTs, bearer tokens, webhooks, long ids and home paths planted in random text with hidden characters, through `buildReport`, its Markdown and its issue link; 3,000 name cases through `redact`; random text through `stripHidden`/`cleanLine`/`cleanBlock`; 3,000 crafted URLs (schemes, user info, ports, look-alike hosts, `..` paths) through `openable`. Rust: `applog::redact` with sign-ins after any whitespace and punctuation. | HTML comments survived a bug report (a zero-width character inside `<!--`; one comment rebuilt by removing another); a hidden tag character came back when a zero-width character between its halves was removed; a JWT cut after its second part wasn't redacted; the log redaction let a token through after a tab, a line break, `Authorization:` or `token :`. All fixed, in the app, the issues digest and the log. Links held. | 4bc9aae |
| 5. Time bugs | `tests/timeFuzz.test.ts`: random moments around 2026's clock changes (Los Angeles, London, Lord Howe's half hour), UTC midnight, New Year and Mondays, in 8 time zones (UTC, −11 to +14, +5:45, southern hemisphere): "checked when", Sales' days (bucketing moved to `core/salesDays.ts`), the daily trade limit (00:00 UTC), the weekly reset (Monday 00:00 UTC), Baro/Varzia/fissure countdowns, chores, the 3-hour inventory rule. The full test suite run under each zone too. Fixes mutation-checked. | "Yesterday" was 24 h back, so after a 23-hour day it said "2 days ago"; an unreadable expiry read "under a minute"; a trade timed a moment ahead of now (rounding in the game's log) didn't count toward today's trades. Fixed. Sales' days, the trade reset, the weekly reset, chores and the 3-hour rule held. | a188dd2 |
| 6. Scale | A demo account about 10× its size (`scripts/demo-scale.mjs`: 6,939 inventory rows, every catalog item, mods at every rank) with 100 listings and their books; every page opened in Chromium on the dev server (warm), long tasks recorded; the collection, what can be sold and the Sell spares plan timed in Node; the plan checked against the 100-order cap with and without buy orders (`tests/scale.test.ts`). | Nothing slow: every page under 250 ms (Orders 245 ms, worst main-thread task 175 ms), collection 43 ms, plan under 30 ms; no blank page, no error. The plan stays at or under 100 orders and never lists one thing twice. (A cold dev server's first compile takes 15–20 s; that's Vite, not the app.) | 72e645d |
| 7. Failure paths | Every page (16) opened in Chromium on the dev server, all external hosts blocked (so the worldstate and warframe.market are unreachable throughout), against copies of the demo account with one thing broken each: TennoScope's data missing, cut short, TennoScope not reporting, no EE.log or reward screens, signed out of warframe.market, warframe.market's item list and order books missing, everything missing; and five corrupt settings files (not JSON, wrong types, a list, a string, null). Checked for page errors and blank pages; each case run cold and warm. | No page error and no blank page in any case. Missing or unreadable data shows the setup steps; signed out shows the sign-in panel on Orders; no worldstate says so on Home. Two "blank" pages on the cold run (Wishlist "Loading…", Foundry "Reading your collection…") were the dev server compiling the page on first open, gone on the warm run. Not reachable from a browser: the desktop app's own paths (the TennoScope program missing, EE.log missing on disk), which the Rust tests cover. | (no code change) |
| 9. Docs consistency | README's feature list, sidebar and numbers (fold width, minimums, timers, hidden pages) against `pages.ts`, `sparesRules.ts`, `backend.ts` and the pages' own labels; the Guide's repricing text; What's New against tonight's changes. | README still described Sell spares as a fold on Orders with the old category names, listed three sidebar sections instead of four (Progress and Builds missing), called Browse market "Market", and had no Builds entry; README and the Guide didn't mention the 70% floor; What's New had nothing on this update. All fixed; the numbers checked were right. | 9637946 |
| 10. Report-only audits | `npm audit` (orbiter and TennoScope's app), `cargo audit` on both lockfiles, unused exports across `src/` (scripted, every tracked file searched), leftover TODOs. | Written up in `docs/testing/proposals.md` §2: 2 low npm findings in a build-only dependency; 0 Rust vulnerabilities in orbiter's lockfile, TennoScope's 4 `zip` ones are those `audit.yml` already ignores with its reason; 7 exports used nowhere, 10 used only by tests; no TODOs. Nothing changed. | (report) |
| 8. UI sweep | Every page (16) of the demo account at 800, 1000, 1300 and 1700 px in Chromium: anything past the window's edge or scrolling it sideways, text cut without an ellipsis, interactive controls overlapping, controls without a name or tooltip; Tab through every page at 1300 px checking each stop shows focus; Esc on every kind of dialog (Settings, Report a bug, notifications, TennoScope, Find anything, and the shared focus trap every dialog component uses). Empty states were covered in item 7. | No layout fault at any width (the 1000 px Orders overflow and fissure-card cut-offs found earlier tonight were already fixed). Every icon-only control has a name; every dialog closes on Esc and the panels give focus back to their button. Fixed: Home's rank-up row had no focus outline; the 11 search fields had no tooltip. Not changed: collection cards and text fields with a label but no tooltip (cards show a hover card with their details instead). | 9a02239 |

## Summary

All ten items were done, in order except that 9 and 10 were finished before 8; each one was
committed and pushed with its test runs (`npm test`, `npm run check -- --threshold error`, and
`cargo test` when Rust changed).

**Bugs found and fixed: 16.**

- Money: a failed partial sale whose listing another sale had closed on screen didn't come back
  (1). Settings files: text "true" turned automatic repricing on; text, NaN or huge numbers took
  away the minimum price, the market-share floor and per-listing floors; junk turned off the
  ducat check; an old file could stop settings loading; one odd riven auction broke the list (6,
  as one fix).
- Panics that abort the app: Nox's Frame pages cut at byte 20,000 inside a character (twice) and
  a script tag closed by its own `</script>` (3). Wrong sales from garbage: closed orders with
  overflowing quantities or bad prices (1). An EE.log trade dialog that never closed grew forever
  (1).
- Privacy: HTML comments surviving into a bug report, a hidden tag character rejoining when a
  zero-width one between its halves was removed (app and issues digest), a JWT cut after its
  second part, tokens after a tab, line break, `Authorization:` or `token :` reaching the log (4).
- Time: "yesterday" after a 23-hour day, unreadable countdowns, today's trades a moment ahead of
  the clock (3, as one commit).
- Interface: Home's rank-up row had no focus outline; search fields had no tooltip (as one commit).

**Tests added:** property tests for the money logic and the market store, fuzzing of settings,
redaction and time (TypeScript); fuzzing of EE.log, TennoScope's log, warframe.market's answers,
Nox's Frame pages and the log's redaction (Rust); a scale test at ten times the demo account. 21
money rules, every settings guard and every Rust fix were each removed once to check a test
fails without it.

**Waiting on the maintainer** (`docs/testing/proposals.md`): the workspace no longer builds on the
MSRV, Rust 1.77.2, because the lockfile's `dlopen2_derive` needs edition 2024; two low npm
advisories in a build-only dependency; seven exports used nowhere and ten used only by tests.

## Round 3 (2026-11-06)

| Item | Checked | Found | Commit |
| --- | --- | --- | --- |
| 1. Release build | Run 30 (0.2.30, commit 1af5c2f, Windows on, macOS off): every job; both downloads' signatures checked against `tauri.conf.json`'s key with the app's own check; the manifest with `promote.yml`'s check; checksums against SHA256SUMS; `channel-experimental`'s `latest.json` against the build's. | All passed; the prune job ran. AppImage and setup.exe sent. | (build) |
| 2. WebKitGTK check | The real engine: WebKitGTK 2.52.6 (Ubuntu's `libwebkit2gtk-4.1`, the one Tauri uses on Linux), driven through `WebKitWebDriver` and MiniBrowser under Xvfb, with the proxy removed from its environment. Every page (16) of the demo account at 800, 1000, 1300 and 1700 px: past the window's edge, sideways scrolling, text cut without an ellipsis, overlapping controls, page errors. The reward screen with 1, 2, 3 and 4 cards at every width, and screenshots at 800 and 1700 px. | Nothing to fix. One difference from Chromium: WebKit gives the children of a `content-visibility: hidden` block (Mastery's hidden "Buy with plat" tab) real boxes, which first looked like overlapping controls; checked in WebKit that none of its 289 controls can take focus (by script or by Tab) or receive a click, so it's not visible to the player. The reward screen fits at every width and card count. | (no code change) |
| 3. IPC audit | All 73 commands the page can call (`generate_handler!`), read for input checks, file reach, URL and program reach, and abuse by a compromised page or crafted data (a first read by a helper, each finding then checked in the code); the capability in `src-tauri/capabilities/default.json`. | Fixed: network (UNC) paths on Windows passed the path check (folders, EE.log, and TennoScope's program, which could be started from a share); `discord_post` had no rate limit; `..` as a user name redirected a warframe.market request; `export_file` could write through a planted link and had no size cap; a log line from the page could forge more lines. Proposed (`proposals.md` §3): a file dialog for TennoScope's program (new dependency), narrowing `core:default`, no silent downgrade, a cap on market writes, binding the Discord webhook. | 6c72bd0 |
| 4. Long-run stability | The demo account in Chromium with the page's clock and timers run 30–60× fast: 4 and 8 simulated hours of page switches (all 16 pages in turn), syncs, Check prices and Reprice on Orders, with Apply and Check automatically on every minute; then the same split into polling alone (Home only) and page switches alone. Sampled every 15 simulated minutes after a forced GC: JS heap, DOM nodes, listeners, documents, live timers (counted by the init script), page errors. | No leak. Over the 8-hour run, from hour 3 on: heap 67.0 → 66.9 MB, listeners 1,201 → 1,211, timers 24, documents 4; DOM 55,511 → 55,737 (+45 an hour, the capped activity log and notification lists filling). The early peak (94k nodes, 83 MB in hour 1, the hidden pages drawn in the background) is released by hour 3. No page error. | (no code change) |
| 5. Windows code review | Every `cfg(windows)` path; the update flow on Windows (`updates.rs` `on_before_exit`, `companion::stop`, passive NSIS); file writes and renames (`write_atomic`, the status heartbeat, log rotation, exports); how paths are read (`var_os`/`PathBuf`, `to_str` only on file names). | Fixed: TennoScope wasn't waited for after being asked to stop, so the installer could hit its locked files; a save was lost when Windows refused the rename for a moment (a file held by a scanner). Already right: non-ASCII user names and spaces, the log rotation (Rust opens files with delete sharing). What needs a real Windows check is in `docs/testing/windows.md` (the network-path refusal, the update with TennoScope running, held files, user names with accents, install paths with spaces, SmartScreen, the overlay, notifications). | 2671b56 |
| 6. Release notes | `docs/releases/first-public.md`: what orbiter does and what's new since 0.1.48 (What's New entries 13–18 and the fixes from these rounds that a player would notice), checked against the README and the app's own wording. | Ready to paste as the first Stable's release description. | 07ed497 |
| 7. Go-public checklist | `docs/maintaining.md`, *Going public, step by step*: before the switch, the switch, GitHub settings, moving the signing secrets, a first public build, promoting it to Stable, the first manual install, each with a box, pointing at the existing detail sections. | Written. | 1398328 |

### Round 3 summary

All seven items were done in order, each committed and pushed with `npm test`, `npm run check --
--threshold error` and, when Rust changed, `cargo test`. The MSRV is now Rust 1.95 (found by
building every release target), checked weekly by `.github/workflows/msrv.yml`; seven unused exports
are gone and four test-only helpers moved to `tests/support/builds.ts`.

**Fixed:** a TennoScope program path on a network share is refused (Windows); Discord posts are
capped at 20 a minute; an export never overwrites a file and is capped at 16 MB; a slug starting
with punctuation is refused; control characters from the page are kept out of the log; before an
update installs, orbiter waits for TennoScope to exit; saves retry while another program holds the
file (Windows). No layout bugs in WebKitGTK at 800–1700 px; no leak over 8 simulated hours.

**Waiting on the maintainer:** five IPC hardening items (`docs/testing/proposals.md` §3), the real
Windows checks (`docs/testing/windows.md`), the go-public checklist itself, and the branch
`claude/nice-cannon-hjl3fb`, whose deletion this session couldn't push.

## Loop (2026-11-06 on)

Rounds of four steps: coverage, a code read, a page polish, longer fuzzing. Each file and page is
covered once; the lists below say which.

**Covered so far.** Coverage: `marketStore.svelte.ts` (the listing form). Code reads: none yet.
Pages: none yet.

| Step | Checked | Found | Commit |
| --- | --- | --- | --- |
| 1.1 Coverage | `node --test --experimental-test-coverage` over `src/`: 90% of lines, 89% of branches. Least covered of the money files: `marketStore.svelte.ts` (74% of branches); its listing form's submit had no test. Six tests added (what's spare, bad amounts, adding to a hidden listing, the 100-listing limit, a create that timed out but was made, the newest inventory), each checked to fail with its rule removed. | The form's last check counted copies from the inventory read the form opened with: copies traded away while it was open still counted as spare. Fixed. | e9492c2 |
