//! `orbiter-dump [tennoscope-dir]` prints the bundle orbiter loads, as JSON. Handy for debugging
//! and for the browser-only dev mode (`npm run dev` reads `public/dev-bundle.json`).
//!
//! `orbiter-dump --ee-log [path]` prints what orbiter reads from Warframe's EE.log instead
//! (the path is found in your Steam libraries when left out).

fn main() {
    let mut args = std::env::args_os().skip(1).peekable();
    if args.peek().is_some_and(|a| a == "--ee-log") {
        args.next();
        let path = args
            .next()
            .map(std::path::PathBuf::from)
            .or_else(orbiter_data::ee_log::find_ee_log)
            .expect("EE.log not found in any Steam library; pass its path");
        let mut follower = orbiter_data::ee_log::LogFollower::default();
        match follower.poll(&path) {
            Ok(state) => println!("{}", serde_json::to_string_pretty(state).expect("serialises")),
            Err(e) => {
                eprintln!("orbiter-dump: {}: {e}", path.display());
                std::process::exit(1);
            }
        }
        return;
    }
    let dir = args
        .next()
        .map(std::path::PathBuf::from)
        .or_else(orbiter_data::default_tennoscope_dir)
        .expect("no data folder given and HOME is not set");
    match orbiter_data::load_bundle(&dir) {
        Ok(bundle) => println!("{}", serde_json::to_string(&bundle).expect("bundle serialises")),
        Err(e) => {
            eprintln!("orbiter-dump: {e}");
            std::process::exit(1);
        }
    }
}
