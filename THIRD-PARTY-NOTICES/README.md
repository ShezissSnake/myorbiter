# Third-party notices

orbiter is GPL-3.0-only (`LICENSE`). Every download carries this folder, with the copyright and
licence of what it bundles that isn't orbiter's own:

- `fonts/`: the fonts orbiter's window uses, Archivo Narrow (The Archivo Narrow Project Authors)
  and IBM Plex Sans and IBM Plex Mono (IBM Corp.), all under the SIL Open Font License 1.1, as
  the @fontsource packages ship them.

The Linux and Windows downloads also carry TennoScope, in the `tennoscope/` folder beside this
one, with its own `LICENSE` (GPL-3.0-only), `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, and
`THIRD-PARTY-NOTICES/tesseract/`: the copyright and licence file of Tesseract and of every library
that comes with it (on Linux, one per Ubuntu package it was copied from, listed in `PACKAGES.txt`;
on Windows, Tesseract's and Leptonica's licences and the project and licence of each DLL).

orbiter's Rust crates and npm packages are under their own licences (MIT, Apache-2.0 and others
compatible with the GPL): `Cargo.lock` and `package-lock.json` in orbiter's source
(`orbiter-source.tar.gz`) list them, and each one's licence comes with its source.

Files under other licences that aren't programs (Warframe's artwork, wiki data) are listed in
`NOTICE.md`.
