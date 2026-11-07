# Sources of the bundled libraries (Windows)

The Windows download carries Tesseract and the DLLs beside it from UB Mannheim's installer
`tesseract-ocr-w64-setup-5.4.0.20240606.exe` (SHA-256
C885FFF6998E0608BA4BB8AB51436E1C6775C2BAFC2559A19B423E18678B60C9, pinned in
`scripts/vendor-windows-tesseract.ps1`). UB Mannheim builds it with MSYS2's MinGW-w64 toolchain,
and the DLLs are MSYS2's builds of these projects.

These are the ones under the GPL or the LGPL (alone or as one of the licences offered), with the
version each was built from. The installer lists no versions: they were read from each DLL's own
version resource, or else from the version or source path the DLL carries, by orbiter, on 3 Nov 2026.
Where neither is in the DLL, it says so. README.md, beside this file, has every DLL's licence.

| DLL | Project | Version | Licence | Source |
|---|---|---|---|---|
| libgcc_s_seh-1.dll, libstdc++-6.dll | GCC runtime libraries | GCC 14.1.0 (MSYS2 build) | GPL-3.0-or-later WITH GCC-exception-3.1 | https://gcc.gnu.org/releases.html, https://packages.msys2.org/base/mingw-w64-gcc |
| libglib-2.0-0.dll, libgio-2.0-0.dll, libgmodule-2.0-0.dll, libgobject-2.0-0.dll | GLib | 2.80.2 | LGPL-2.1-or-later | https://download.gnome.org/sources/glib/2.80/, https://packages.msys2.org/base/mingw-w64-glib2 |
| libpango-1.0-0.dll, libpangocairo-1.0-0.dll, libpangoft2-1.0-0.dll, libpangowin32-1.0-0.dll | Pango | 1.52.2 | LGPL-2.0-or-later | https://download.gnome.org/sources/pango/1.52/, https://packages.msys2.org/base/mingw-w64-pango |
| libcairo-2.dll | cairo | 1.18.0 | LGPL-2.1-only OR MPL-1.1 | https://cairographics.org/releases/, https://packages.msys2.org/base/mingw-w64-cairo |
| libfribidi-0.dll | GNU FriBidi | 1.0.14 | LGPL-2.1-or-later | https://github.com/fribidi/fribidi/releases, https://packages.msys2.org/base/mingw-w64-fribidi |
| libiconv-2.dll | GNU libiconv | 1.17 | LGPL-2.1-or-later | https://ftp.gnu.org/pub/gnu/libiconv/, https://packages.msys2.org/base/mingw-w64-libiconv |
| libintl-8.dll | GNU gettext (libintl) | 0.22.5 | LGPL-2.1-or-later | https://ftp.gnu.org/pub/gnu/gettext/, https://packages.msys2.org/base/mingw-w64-gettext |
| libjbig-0.dll | JBIG-KIT | 2.1 | GPL-2.0-or-later | https://www.cl.cam.ac.uk/~mgk25/jbigkit/, https://packages.msys2.org/base/mingw-w64-jbigkit |
| libfreetype-6.dll | FreeType | 2.13.2 | FTL OR GPL-2.0-or-later | https://download.savannah.gnu.org/releases/freetype/, https://packages.msys2.org/base/mingw-w64-freetype |
| libzstd.dll | Zstandard | 1.5.6 | BSD-3-Clause OR GPL-2.0-only | https://github.com/facebook/zstd/releases, https://packages.msys2.org/base/mingw-w64-zstd |
| libgraphite2.dll | Graphite2 | not recorded in the DLL | LGPL-2.1-or-later OR MPL-2.0 OR GPL-2.0-or-later | https://github.com/silnrsi/graphite/releases, https://packages.msys2.org/base/mingw-w64-graphite2 |
| libdatrie-1.dll | libdatrie | not recorded in the DLL | LGPL-2.1-or-later | https://github.com/tlwg/libdatrie/releases, https://packages.msys2.org/base/mingw-w64-libdatrie |
| libthai-0.dll | libthai | not recorded in the DLL | LGPL-2.1-or-later | https://github.com/tlwg/libthai/releases, https://packages.msys2.org/base/mingw-w64-libthai |

MSYS2 keeps the source of each package it built, recipe and upstream tarball together, at
https://repo.msys2.org/mingw/sources/, and its recipes are at https://github.com/msys2/MINGW-packages.

## Written offer

For three years from the date of this release, the complete corresponding source code of the GPL-
and LGPL-licensed libraries bundled in this build is available on request: open an issue at
https://gitlab.com/sheziss-group/myorbiter or contact the maintainer.

The source of MyOrbiter and TennoScope (both GPL-3.0-only) is attached to every release as
myorbiter-source.tar.gz.
