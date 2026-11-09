//! Opening a link in the browser (`openUrl` in src/lib/backend.ts).
//!
//! The AppImage starts MyOrbiter with its own libraries first on `LD_LIBRARY_PATH`, and its GIO and
//! GTK modules, schemas and data on their paths (`folder.rs` says more). Through the opener plugin,
//! `xdg-open` and `kde-open` passed all of that to the browser they started. A browser built against
//! the system's libraries then stopped as it loaded (Chromium: `undefined symbol:
//! BrotliDecoderAttachDictionary`), even with a window of it already open, while `kde-open` had
//! already answered that the link was open. One that loads (Firefox) finds the AppImage's GTK
//! first, with its theme and modules, and passes all of it on to every program it starts. On Linux
//! a link now opens as a log folder does: `xdg-open`, then `gio open`, then `kde-open`, without the
//! AppImage's entries and in a process group of their own (`folder::first_opener`). The answer is
//! still the opener's, not the browser's. On the other systems the opener plugin opens it.
//!
//! The page checks a link before it asks (`openable` in src/lib/core/links.ts), and the same check is
//! made here before anything runs: the page has no opener permission of its own
//! (src-tauri/capabilities/default.json), so this is the one way a link opens.

/// The sites MyOrbiter opens: each one's host, and the path its links must start with ("/" for
/// any). The same as `LINK_SITES` in src/lib/core/links.ts; a test ties the two. MyOrbiter's own
/// project is there on github.com (its home: releases, issues, the source), on its GitHub Pages
/// site, and on gitlab.com (the mirror, which keeps the releases made there).
pub(crate) const SITES: &[(&str, &str)] = &[
    ("warframe.market", "/"),
    ("wiki.warframe.com", "/"),
    ("warframe.fandom.com", "/"),
    ("overframe.gg", "/"),
    ("noxsframe.com", "/"),
    ("github.com", "/ShezissSnake/myorbiter/"),
    ("shezisssnake.github.io", "/myorbiter/"),
    ("gitlab.com", "/sheziss-group/myorbiter/-/"),
];

/// The link, normalised, if MyOrbiter may open it: https, an allowed site, no user name, password or
/// port. As `openable` in links.ts: both parse as the URL standard does, so a host is compared in
/// lower case and a default port (443) is no port.
fn openable(url: &str) -> Option<tauri::Url> {
    let u: tauri::Url = url.parse().ok()?;
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() || u.port().is_some() {
        return None;
    }
    let host = u.host_str()?;
    let (_, path) = SITES.iter().find(|(h, _)| *h == host)?;
    u.path().starts_with(path).then_some(u)
}

/// Opens `url` in the browser, if it's a link to one of MyOrbiter's sites; why not, in a sentence.
/// On Linux it waits for the opener's answer (`folder::ANSWER_WITHIN`), so it runs on a blocking
/// thread.
pub fn open(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let Some(url) = openable(url) else {
        // As the page's own log lines (`log_line`): control characters become spaces, so what the
        // page sent can't write lines that look like MyOrbiter's own.
        let shown: String = url.chars().take(200).map(|c| if c.is_control() { ' ' } else { c }).collect();
        log::warn!(target: "myorbiter::app", "refused to open a link outside MyOrbiter's sites: {shown}");
        return Err("MyOrbiter opens links to its own sites only".into());
    };
    #[cfg(target_os = "linux")]
    {
        // Never through the opener plugin here: its launchers keep the AppImage's environment.
        let _ = app;
        crate::folder::first_opener(crate::folder::OPENERS, url.as_str().as_ref(), crate::folder::ANSWER_WITHIN).map_err(|failed| match failed {
            Some(why) => format!("Couldn't open the link ({why})"),
            None => "Couldn't open the link: no xdg-open, gio or kde-open on this system".into(),
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| {
            log::warn!(target: "myorbiter::app", "couldn't open {url}: {e}");
            format!("Couldn't open the link: {e}")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The same links tests/links.test.ts gives `openable` in links.ts, with the same answers.
    #[test]
    fn links_to_the_sites_myorbiter_uses_open() {
        for url in [
            "https://warframe.market/items/serration",
            "https://warframe.market/profile/Seller1",
            "https://wiki.warframe.com/w/Mesa_Prime",
            "https://warframe.fandom.com/wiki/Mesa_Prime",
            "https://overframe.gg/build/1234/",
            "https://noxsframe.com/",
            "https://gitlab.com/sheziss-group/myorbiter/-/releases",
            "https://gitlab.com/sheziss-group/myorbiter/-/work_items/new?issuable_template=Bug%20report",
            "https://github.com/ShezissSnake/myorbiter/releases/tag/build-120",
            "https://github.com/ShezissSnake/myorbiter/blob/main/docs/privacy.md",
            "https://github.com/ShezissSnake/myorbiter/issues/new?template=bug_report.yml",
            "https://shezisssnake.github.io/myorbiter/",
        ] {
            assert_eq!(openable(url).as_ref().map(tauri::Url::as_str), Some(url), "{url}");
        }
        // Opened as normalised, so what was checked is what opens.
        assert_eq!(openable("https://WARFRAME.MARKET/items/x").unwrap().as_str(), "https://warframe.market/items/x");
        assert_eq!(openable("https://warframe.market:443/items/x").unwrap().as_str(), "https://warframe.market/items/x");
    }

    #[test]
    fn anything_else_is_refused() {
        for url in [
            "http://warframe.market/items/serration",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://warframe.market.example.com/",
            "https://evil.example/warframe.market/",
            "https://user:pass@warframe.market/",
            "https://warframe.market:8443/",
            "https://github.com/someone-else/repo",
            "https://github.com/ShezissSnake",
            "https://gitlab.com/sheziss-group",
            "https://gitlab.com/sheziss-group/other-project/-/issues",
            "https://gitlab.com/sheziss-group/myorbiter",
            "https://gitlab.com/sheziss-group/myorbiter/uploads/0123456789abcdef/picture.png",
            "https://github.com/ShezissSnake/orbiter/releases",
            "https://github.com/ShezissSnake/myorbiter",
            "https://github.com/ShezissSnake/myorbiter-other/releases",
            "https://github.com/ShezissSnake/myorbiter/../other/releases",
            "https://github.com/user-attachments/assets/0123",
            "https://shezisssnake.github.io/",
            "https://shezisssnake.github.io/other/",
            "https://someone.github.io/myorbiter/",
            "https://raw.githubusercontent.com/ShezissSnake/myorbiter/main/README.md",
            "https://gitlab.com/someone-else/orbiter/-/issues",
            "smb://warframe.market/share",
            "not a url",
            "",
            // Tricks that read like an allowed site.
            "https://warframe.market@evil.example/",
            "https:\\\\evil.example\\warframe.market",
            "https://evil.example\\@warframe.market/",
            "https://gitlab.com/sheziss-group/myorbiter/-/../../other-project/-/issues",
            "https://gitlab.com/sheziss-group/myorbiter/%2e%2e/other",
            "https://w\u{0430}rframe.market/",
            "https://warframe.market./items/x",
            "https://overframe.gg:443@evil.example/",
            "HTTPS://evil.example/",
            "https://evil.example/?u=https://warframe.market/",
            " javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "-https://warframe.market/",
        ] {
            assert!(openable(url).is_none(), "{url} refused");
        }
    }

    /// One list of sites, here and in the page's `LINK_SITES`; and no opener permission for the page,
    /// so a link can't open past this check.
    #[test]
    fn the_page_and_the_app_allow_the_same_sites() {
        let mut ours: Vec<String> = SITES.iter().map(|(h, p)| format!("https://{h}{p}*")).collect();
        ours.sort();

        let links = include_str!("../../src/lib/core/links.ts");
        let list = links.split("LINK_SITES").nth(1).unwrap().split("];").next().unwrap();
        let mut page: Vec<String> = list
            .lines()
            .filter_map(|l| {
                let host = l.split("host: \"").nth(1)?.split('"').next()?;
                let path = l.split("path: \"").nth(1)?.split('"').next()?;
                Some(format!("https://{host}{path}*"))
            })
            .collect();
        page.sort();
        assert_eq!(page, ours, "LINK_SITES in src/lib/core/links.ts");

        let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let opener = cap["permissions"].as_array().unwrap().iter().filter(|p| p.as_str().or(p["identifier"].as_str()).is_some_and(|id| id.starts_with("opener:"))).count();
        assert_eq!(opener, 0, "no opener permission in capabilities/default.json");
    }

    /// An allowed link goes to the opener as one argument, in the shape the browser is to open.
    #[cfg(target_os = "linux")]
    #[test]
    fn the_opener_gets_the_link_as_checked() {
        let url = openable("https://WARFRAME.MARKET/items/x").unwrap();
        let check = ["-c", r#"[ "$0" = https://warframe.market/items/x ]"#];
        let w = std::time::Duration::from_secs(4);
        assert_eq!(crate::folder::first_opener(&[("sh", &check)], url.as_str().as_ref(), w), Ok(()));
        assert_eq!(crate::folder::first_opener(&[("myorbiter-no-such-opener", &[])], url.as_str().as_ref(), w), Err(None));
    }
}
