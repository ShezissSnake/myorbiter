# The image every job in .gitlab-ci.yml runs in: orbiter's and TennoScope's build tools on Ubuntu
# 22.04, for the Linux AppImage and .deb built natively and the Windows installer cross-compiled
# with cargo-xwin. 22.04 on purpose: what's built here needs nothing newer than its C library (glibc
# 2.35), so the AppImage runs on SteamOS, Debian 12 and any Linux from the last few years. A newer
# base raises that floor for every player, so ci/build.sh refuses a Linux build that asks for more
# than GLIBC_2.35. The `image` job (.gitlab-ci.yml) builds it and pushes it to the project's
# container registry as builder:<BUILDER_TAG>; change BUILDER_TAG there whenever this file changes.
#
# Nothing here is piped from the web into a shell: Node and rustup-init are downloaded as files and
# checked against the SHA-256 pinned below before they run. Bumping a version means a new checksum,
# taken from the project's own SHASUMS file (nodejs.org/dist/<version>/SHASUMS256.txt,
# static.rust-lang.org/rustup/archive/<version>/x86_64-unknown-linux-gnu/rustup-init.sha256).
# PipeWire's source archive is checked the same way, against the SHA-256 the GitHub release workflow
# pinned, and NSIS's against the SHA-256s below.
#
# Hosts the image build reaches: Docker Hub (the base image), Ubuntu's archive,
# gitlab.freedesktop.org (PipeWire's source), downloads.sourceforge.net and the SourceForge mirror
# it redirects to (NSIS), nodejs.org, static.rust-lang.org, crates.io (cargo-xwin, cargo-audit) and
# npm (pnpm). The builds themselves reach crates.io, npm, digi.bib.uni-mannheim.de (Tesseract for
# Windows), github.com (the linuxdeploy tools Tauri's bundler downloads) and, through cargo-xwin,
# Microsoft's servers for the MSVC CRT and Windows SDK, whose licence cargo-xwin accepts on the
# project's behalf.
#
# ubuntu:22.04, pinned by digest: change both together.
FROM ubuntu:22.04@sha256:076e7bf82319619f28dd0aa9c02ab34b055ad37100395b4f49a2ffba04fb5e11

ARG DEBIAN_FRONTEND=noninteractive

# Rust: 1.95 is orbiter's MSRV (src-tauri/Cargo.toml, crates/orbiter-data/Cargo.toml), so the test
# job checks it and the release builds use it. tennoscope/rust-toolchain.toml pins its own, which
# rustup picks up inside tennoscope/; it's installed here so a build never downloads a toolchain.
ARG RUST_VERSION=1.95.0
ARG TENNOSCOPE_RUST_VERSION=1.97.1
ARG RUSTUP_VERSION=1.29.3
ARG RUSTUP_SHA256=b1c8cb14e30889e7e2999e6b69e62d9e9b9ffc0f4df8180564d306d9680e6c55
# Node: the current LTS line. pnpm: the version tennoscope/app/package.json's packageManager names.
ARG NODE_VERSION=26.13.0
ARG NODE_SHA256=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997
ARG PNPM_VERSION=10.33.2
ARG CARGO_XWIN_VERSION=0.23.1
ARG CARGO_AUDIT_VERSION=0.22.2
# PipeWire's client libraries: 22.04's own (0.3.48) predate the bindings TennoScope's screen capture
# compiles against, so the same pinned release the GitHub release workflow built is built here.
ARG PIPEWIRE_VERSION=1.0.0
ARG PIPEWIRE_SHA256=f91ef1d1161b37aae6e21b9671917d97097e2664c83d919ba3a0793d6fbc543d
# NSIS for the Windows installer: 22.04's own is 3.08, older than the Win\RestartManager.nsh Tauri's
# installer includes, and its uninstaller has CVE-2023-37378 (fixed in 3.09). SourceForge publishes
# no checksums: the zip's SHA-256 is of the file that SourceForge and Tauri's own mirror
# (github.com/tauri-apps/binary-releases, nsis-3.13) both served, whose SHA-1 is the one Tauri's
# bundler pins; the source's is of the archive whose files match NSIS's v313 tag
# (github.com/kichik/nsis) apart from line endings and the generated ChangeLog.
ARG NSIS_VERSION=3.13
ARG NSIS_ZIP_SHA256=ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8
ARG NSIS_SRC_SHA256=a8ffe024602d46b6d766f9e1ce30c324ad2a24daeacd3efc2642d436a0c157ac

# Tauri's Linux build dependencies (WebKitGTK 4.1 and the rest), TennoScope's (libclang for bindgen,
# meson and ninja for PipeWire below, Tesseract and patchelf for the copy it carries), the Windows
# cross-compile (SCons and zlib to build NSIS below; LLVM 14's lld-link, llvm-lib and llvm-rc for
# cargo-xwin, which makes its own clang-cl from clang), 7-Zip for the Windows Tesseract installer,
# and jq and curl for the release jobs. LLVM 14 is enough while nothing compiles C++ for Windows:
# the current MSVC STL headers cargo-xwin fetches refuse a Clang that old, so a dependency that
# starts doing so needs a newer LLVM here.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      ca-certificates curl git file xz-utils unzip zstd jq build-essential pkg-config \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
      libssl-dev libclang-dev libgbm-dev libegl-dev libwayland-dev libxcb1-dev libdbus-1-dev \
      libarchive-tools meson ninja-build gettext xdg-utils \
      tesseract-ocr tesseract-ocr-eng patchelf \
      scons zlib1g-dev llvm clang lld p7zip-full \
 && rm -rf /var/lib/apt/lists/*

# PipeWire's client libraries, into /opt/pipewire (outside what dpkg owns, as on the GitHub
# runners): every optional feature off, no session manager, only what the bindings link against.
RUN curl --fail --location --retry 3 --output /tmp/pipewire.tar.gz \
      "https://gitlab.freedesktop.org/pipewire/pipewire/-/archive/${PIPEWIRE_VERSION}/pipewire-${PIPEWIRE_VERSION}.tar.gz" \
 && echo "${PIPEWIRE_SHA256}  /tmp/pipewire.tar.gz" | sha256sum --check --strict \
 && tar --extract --gzip --file /tmp/pipewire.tar.gz --directory /tmp \
 && cd "/tmp/pipewire-${PIPEWIRE_VERSION}" \
 && meson setup build --prefix=/opt/pipewire --libdir=lib --wrap-mode=nodownload \
      -Dauto_features=disabled -Ddbus=disabled \
      -Dflatpak=disabled -Dpipewire-alsa=disabled -Dpipewire-jack=disabled \
      -Dpipewire-v4l2=disabled -Dexamples=disabled -Dtests=disabled -Dman=disabled \
      -Ddocs=disabled '-Dsession-managers=[]' \
 && meson compile -C build \
 && meson install -C build \
 && cd / && rm -rf /tmp/pipewire.tar.gz "/tmp/pipewire-${PIPEWIRE_VERSION}"
ENV PKG_CONFIG_PATH=/opt/pipewire/lib/pkgconfig \
    LD_LIBRARY_PATH=/opt/pipewire/lib

# NSIS in /opt/nsis, the way NSIS's own docs build it on Linux: the release zip (stubs, plugins,
# headers, built by NSIS) with makensis compiled from the same release's source into a new bin/
# beside the zip's Windows Bin/ (it finds Stubs/, Plugins/ and Include/ one folder up). Tauri's
# bundler runs the makensis on PATH (first on it, below) and reads NSIS_PATH. SourceForge redirects
# to a mirror: only over https. The check at the end compiles a script with the header Tauri's
# installer needs, so a makensis that can't find its stubs or headers fails the image build.
RUN curl --fail --location --proto-redir =https --retry 3 --output /tmp/nsis.zip \
      "https://downloads.sourceforge.net/project/nsis/NSIS%203/${NSIS_VERSION}/nsis-${NSIS_VERSION}.zip" \
 && curl --fail --location --proto-redir =https --retry 3 --output /tmp/nsis-src.tar.bz2 \
      "https://downloads.sourceforge.net/project/nsis/NSIS%203/${NSIS_VERSION}/nsis-${NSIS_VERSION}-src.tar.bz2" \
 && echo "${NSIS_ZIP_SHA256}  /tmp/nsis.zip" | sha256sum --check --strict \
 && echo "${NSIS_SRC_SHA256}  /tmp/nsis-src.tar.bz2" | sha256sum --check --strict \
 && unzip -q /tmp/nsis.zip -d /tmp/nsis-zip \
 && mv "/tmp/nsis-zip/nsis-${NSIS_VERSION}" /opt/nsis \
 && tar --extract --bzip2 --file /tmp/nsis-src.tar.bz2 --directory /tmp \
 && cd "/tmp/nsis-${NSIS_VERSION}-src" \
 && scons SKIPSTUBS=all SKIPPLUGINS=all SKIPUTILS=all SKIPMISC=all NSIS_CONFIG_CONST_DATA_PATH=no \
      VERSION="${NSIS_VERSION}" PREFIX=/opt/nsis install-compiler \
 && mkdir -p /opt/nsis/bin \
 && mv /opt/nsis/makensis /opt/nsis/bin/makensis \
 && cd / && rm -rf /tmp/nsis.zip /tmp/nsis-zip /tmp/nsis-src.tar.bz2 "/tmp/nsis-${NSIS_VERSION}-src" \
 && /opt/nsis/bin/makensis -VERSION \
 && printf '%s\n' 'Unicode true' '!include "Win\RestartManager.nsh"' 'OutFile /tmp/nsis-check.exe' \
      'Section' 'SectionEnd' > /tmp/nsis-check.nsi \
 && /opt/nsis/bin/makensis -V2 /tmp/nsis-check.nsi \
 && rm /tmp/nsis-check.nsi /tmp/nsis-check.exe
ENV NSIS_PATH=/opt/nsis

# Node, from nodejs.org's own build.
RUN curl --fail --location --retry 3 --output /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum --check --strict \
 && tar --extract --xz --file /tmp/node.tar.xz --directory /usr/local --strip-components 1 \
      --exclude CHANGELOG.md --exclude LICENSE --exclude README.md \
 && rm /tmp/node.tar.xz \
 && npm install --global "pnpm@${PNPM_VERSION}" \
 && node --version && pnpm --version

# Rust, through rustup, with the Windows MSVC target on both toolchains.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/opt/nsis/bin:/usr/local/cargo/bin:/usr/lib/llvm-14/bin:$PATH
RUN curl --fail --location --retry 3 --output /tmp/rustup-init \
      "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
 && echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum --check --strict \
 && chmod +x /tmp/rustup-init \
 && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
      --target x86_64-pc-windows-msvc \
 && rm /tmp/rustup-init \
 && rustup toolchain install "${TENNOSCOPE_RUST_VERSION}" --profile minimal \
      --target x86_64-pc-windows-msvc --component rustfmt --component clippy \
 && cargo install --locked --version "${CARGO_XWIN_VERSION}" cargo-xwin \
 && cargo install --locked --version "${CARGO_AUDIT_VERSION}" cargo-audit \
 && rm -rf "${CARGO_HOME}/registry" "${CARGO_HOME}/git" \
 && chmod -R a+rwX "${CARGO_HOME}" "${RUSTUP_HOME}" \
 && rustc --version && cargo xwin --version && cargo audit --version

# AppImages (linuxdeploy, its plugins, the packer, TennoScope's) run without FUSE, which a
# container doesn't have. linuxdeploy's own strip predates the newer ELF sections, so it's skipped
# (as scripts/build-local.sh and TennoScope's build do): only a size optimisation.
ENV APPIMAGE_EXTRACT_AND_RUN=1 \
    NO_STRIP=true \
    CARGO_TERM_COLOR=always
