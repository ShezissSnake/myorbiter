# Notices for the Tesseract in the Windows build

`scripts/vendor-windows-tesseract.ps1` extracts Tesseract and the DLLs beside it from UB Mannheim's
Windows installer (`tesseract-ocr-w64-setup-5.4.0.20240606.exe`, SHA-256 pinned in the script) and
copies this folder into `licenses/` beside them (`SOURCES.md` included), with Tesseract's own
`LICENSE` and `AUTHORS` from the installer and `DLLS.txt`, the list of the DLLs actually copied.

UB Mannheim builds Tesseract with MSYS2's MinGW-w64 toolchain, and the DLLs are the libraries it
links, as MSYS2 packages them. The installer carries no notices for them, so the table below names
each one's project and licence, as identified for orbiter (not by UB Mannheim). Their source is
upstream's, and as built, in MSYS2's package recipes (https://github.com/msys2/MINGW-packages) and
UB Mannheim's build (https://github.com/UB-Mannheim/tesseract).

- `leptonica-license.txt`: Leptonica's licence, from its repository at tag 1.84.1.
- Tesseract: Apache-2.0, its `LICENSE` (from the installer) beside this file in a build.

| DLL | Project | Licence |
|---|---|---|
| tesseract.exe, libtesseract-5.dll | Tesseract OCR | Apache-2.0 |
| libleptonica-6.dll | Leptonica | BSD-2-Clause (leptonica-license.txt) |
| libLerc.dll | LERC (Esri) | Apache-2.0 |
| libarchive-13.dll | libarchive | BSD-2-Clause |
| libb2-1.dll | libb2 (BLAKE2) | CC0-1.0 |
| libbrotlicommon.dll, libbrotlidec.dll | Brotli | MIT |
| libbz2-1.dll | bzip2 | bzip2-1.0.6 |
| libcairo-2.dll | cairo | LGPL-2.1-only OR MPL-1.1 |
| libcrypto-3-x64.dll | OpenSSL 3 | Apache-2.0 |
| libdatrie-1.dll | libdatrie | LGPL-2.1-or-later |
| libdeflate.dll | libdeflate | MIT |
| libexpat-1.dll | Expat | MIT |
| libffi-8.dll | libffi | MIT |
| libfontconfig-1.dll | Fontconfig | MIT-style (Fontconfig licence) |
| libfreetype-6.dll | FreeType | FTL OR GPL-2.0-or-later |
| libfribidi-0.dll | GNU FriBidi | LGPL-2.1-or-later |
| libgcc_s_seh-1.dll, libstdc++-6.dll | GCC runtime libraries | GPL-3.0-or-later WITH GCC-exception-3.1 |
| libgif-7.dll | giflib | MIT |
| libglib-2.0-0.dll, libgio-2.0-0.dll, libgmodule-2.0-0.dll, libgobject-2.0-0.dll | GLib | LGPL-2.1-or-later |
| libgraphite2.dll | Graphite2 | LGPL-2.1-or-later OR MPL-2.0 OR GPL-2.0-or-later |
| libharfbuzz-0.dll | HarfBuzz | MIT-style (HarfBuzz licence) |
| libiconv-2.dll | GNU libiconv | LGPL-2.1-or-later |
| libicudt75.dll, libicuin75.dll, libicuuc75.dll | ICU 75 | Unicode-3.0 |
| libintl-8.dll | GNU gettext (libintl) | LGPL-2.1-or-later |
| libjbig-0.dll | JBIG-KIT | GPL-2.0-or-later |
| libjpeg-8.dll | libjpeg-turbo | IJG AND BSD-3-Clause AND Zlib |
| liblz4.dll | LZ4 | BSD-2-Clause |
| liblzma-5.dll | XZ Utils (liblzma) | 0BSD |
| libopenjp2-7.dll | OpenJPEG | BSD-2-Clause |
| libpango-1.0-0.dll, libpangocairo-1.0-0.dll, libpangoft2-1.0-0.dll, libpangowin32-1.0-0.dll | Pango | LGPL-2.0-or-later |
| libpcre2-8-0.dll | PCRE2 | BSD-3-Clause WITH PCRE2-exception |
| libpixman-1-0.dll | pixman | MIT |
| libpng16-16.dll | libpng | libpng-2.0 |
| libsharpyuv-0.dll, libwebp-7.dll, libwebpmux-3.dll | libwebp | BSD-3-Clause |
| libthai-0.dll | libthai | LGPL-2.1-or-later |
| libtiff-6.dll | LibTIFF | libtiff |
| libwinpthread-1.dll | mingw-w64 winpthreads | MIT AND BSD-3-Clause |
| libzstd.dll | Zstandard | BSD-3-Clause OR GPL-2.0-only |
| zlib1.dll | zlib | Zlib |

The GPL and LGPL libraries among them (JBIG-KIT, the GCC runtime, GLib, Pango, cairo and the rest)
come with a duty to make their corresponding source available to whoever receives the binaries.
`SOURCES.md`, beside this file in a build, lists them with the version each DLL was built from and
where its source is, and carries orbiter's written offer of that source for three years from the
release.
