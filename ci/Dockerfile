# The image every job in .gitlab-ci.yml runs in: orbiter's and TennoScope's build tools on Ubuntu
# 22.04, for the Linux AppImage and .deb built natively and the Windows installer cross-compiled
# with cargo-xwin. 22.04 on purpose: what's built here needs nothing newer than its C library (glibc
# 2.35), so the AppImage runs on SteamOS, Debian 12 and any Linux from the last few years. A newer
# base raises that floor for every player: check the built AppImage still asks for no more than
# GLIBC_2.35 before moving it. The `image` job (.gitlab-ci.yml) builds it and pushes it to the
# project's container registry as builder:<BUILDER_TAG>; change BUILDER_TAG there whenever this file
# changes.
#
# Nothing here is piped from the web into a shell: Node and rustup-init are downloaded as files and
# checked against the SHA-256 pinned below before they run. Bumping a version means a new checksum,
# taken from the project's own SHASUMS file (nodejs.org/dist/<version>/SHASUMS256.txt,
# static.rust-lang.org/rustup/archive/<version>/x86_64-unknown-linux-gnu/rustup-init.sha256).
# PipeWire's source archive is checked the same way, against the SHA-256 the GitHub release workflow
# pinned.
#
# Hosts the image build reaches: Docker Hub (the base image), Ubuntu's archive,
# gitlab.freedesktop.org (PipeWire's source), nodejs.org, static.rust-lang.org, crates.io
# (cargo-xwin, cargo-audit) and npm (pnpm). The builds themselves reach crates.io, npm,
# digi.bib.uni-mannheim.de (Tesseract for Windows), github.com (the linuxdeploy tools Tauri's
# bundler downloads) and, through cargo-xwin, Microsoft's servers for the MSVC CRT and Windows SDK,
# whose licence cargo-xwin accepts on the project's behalf.
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

# Tauri's Linux build dependencies (WebKitGTK 4.1 and the rest), TennoScope's (libclang for
# bindgen, meson and ninja for PipeWire below, Tesseract and patchelf for the copy it carries), the
# Windows cross-compile (NSIS for the installer; LLVM 14's clang-cl, lld-link, llvm-lib and llvm-rc
# for cargo-xwin), 7-Zip for the Windows Tesseract installer, and jq and curl for the release jobs.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      ca-certificates curl git file xz-utils unzip zstd jq build-essential pkg-config \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
      libssl-dev libclang-dev libgbm-dev libegl-dev libwayland-dev libxcb1-dev libdbus-1-dev \
      libarchive-tools meson ninja-build gettext xdg-utils \
      tesseract-ocr tesseract-ocr-eng patchelf \
      nsis llvm clang lld p7zip-full \
 && rm -rf /var/lib/apt/lists/*

# PipeWire's client libraries, into /opt/pipewire (outside what dpkg owns, as on the GitHub
# runners): every optional feature off, no session manager, only what the bindings link against.
RUN curl --fail --location --retry 3 --output /tmp/pipewire.tar.gz \
      "https://gitlab.freedesktop.org/pipewire/pipewire/-/archive/${PIPEWIRE_VERSION}/pipewire-${PIPEWIRE_VERSION}.tar.gz" \
 && echo "${PIPEWIRE_SHA256}  /tmp/pipewire.tar.gz" | sha256sum --check --strict \
 && tar --extract --gzip --file /tmp/pipewire.tar.gz --directory /tmp \
 && cd "/tmp/pipewire-${PIPEWIRE_VERSION}" \
 && meson setup build --prefix=/opt/pipewire --libdir=lib -Dauto_features=disabled -Ddbus=disabled \
      -Dflatpak=disabled -Dpipewire-alsa=disabled -Dpipewire-jack=disabled \
      -Dpipewire-v4l2=disabled -Dexamples=disabled -Dtests=disabled -Dman=disabled \
      -Ddocs=disabled '-Dsession-managers=[]' \
 && meson compile -C build \
 && meson install -C build \
 && cd / && rm -rf /tmp/pipewire.tar.gz "/tmp/pipewire-${PIPEWIRE_VERSION}"
ENV PKG_CONFIG_PATH=/opt/pipewire/lib/pkgconfig \
    LD_LIBRARY_PATH=/opt/pipewire/lib

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
    PATH=/usr/local/cargo/bin:/usr/lib/llvm-14/bin:$PATH
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
