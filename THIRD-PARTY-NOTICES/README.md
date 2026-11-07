# Third-party notices

MyOrbiter is GPL-3.0-only (`LICENSE`). Every download carries this folder, with the copyright and
licence of what it bundles that isn't MyOrbiter's own:

- `fonts/`: the fonts MyOrbiter's window uses, Archivo Narrow (The Archivo Narrow Project Authors)
  and IBM Plex Sans and IBM Plex Mono (IBM Corp.), all under the SIL Open Font License 1.1, as
  the @fontsource packages ship them.

The Linux and Windows downloads also carry TennoScope, in the `tennoscope/` folder beside this
one, with its own `LICENSE` (GPL-3.0-only), `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, and
`THIRD-PARTY-NOTICES/tesseract/`: the copyright and licence file of Tesseract and of every library
that comes with it (on Linux, one per Ubuntu package it was copied from, listed in `PACKAGES.txt`;
on Windows, Tesseract's and Leptonica's licences and the project and licence of each DLL).

The Linux and Windows downloads also have `SOURCES.md` here, written when they're built: every
library they carry from Ubuntu's packages (Linux) or UB Mannheim's Tesseract installer (Windows),
with its exact version and where its source is, and a written offer: for three years from the date
of the release, the complete corresponding source code of the GPL- and LGPL-licensed libraries
bundled in it is available on request (an issue at https://gitlab.com/sheziss-group/myorbiter, or the
maintainer). On Linux, `linux/` holds the copyright file of each library the AppImage carries
beside MyOrbiter itself (GTK, WebKitGTK and the rest).

MyOrbiter's Rust crates and npm packages are under their own licences (MIT, Apache-2.0 and others
compatible with the GPL): `Cargo.lock` and `package-lock.json` in MyOrbiter's source
(`myorbiter-source.tar.gz`) list them, and each one's licence comes with its source.

Files under other licences that aren't programs (Warframe's artwork, wiki data) are listed in
`NOTICE.md`.
