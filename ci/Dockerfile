# The image every job in .gitlab-ci.yml runs in: orbiter's and TennoScope's build tools on Ubuntu
# 24.04, for the Linux AppImage and .deb built natively and the Windows installer cross-compiled
# with cargo-xwin. The `image` job (.gitlab-ci.yml) builds it and pushes it to the project's
# container registry as builder:<BUILDER_TAG>; change BUILDER_TAG there whenever this file changes.
#
# Nothing here is piped from the web into a shell: Node and rustup-init are downloaded as files and
# checked against the SHA-256 pinned below before they run. Bumping a version means a new checksum,
# taken from the project's own SHASUMS file (nodejs.org/dist/<version>/SHASUMS256.txt,
# static.rust-lang.org/rustup/archive/<version>/x86_64-unknown-linux-gnu/rustup-init.sha256).
#
# Hosts the image build reaches: Docker Hub (the base image), Ubuntu's archive, nodejs.org,
# static.rust-lang.org, crates.io (cargo-xwin, cargo-audit) and npm (pnpm). The builds themselves
# reach crates.io, npm, digi.bib.uni-mannheim.de (Tesseract for Windows), github.com (the
# linuxdeploy tools Tauri's bundler downloads) and, through cargo-xwin, Microsoft's servers for the
# MSVC CRT and Windows SDK, whose licence cargo-xwin accepts on the project's behalf.
#
# ubuntu:24.04, pinned by digest: change both together.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

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

# Tauri's Linux build dependencies (WebKitGTK 4.1 and the rest), TennoScope's (PipeWire for its
# screen capture, libclang for bindgen, Tesseract and patchelf for the copy it carries), the
# Windows cross-compile (NSIS for the installer; LLVM's clang-cl, lld-link, llvm-lib and llvm-rc for
# cargo-xwin), 7-Zip for the Windows Tesseract installer, and jq and curl for the release jobs.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      ca-certificates curl git file xz-utils unzip zstd jq build-essential pkg-config \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
      libssl-dev libclang-dev libgbm-dev libegl-dev libwayland-dev libxcb1-dev libdbus-1-dev \
      libpipewire-0.3-dev libspa-0.2-dev libarchive-tools meson ninja-build gettext xdg-utils \
      tesseract-ocr tesseract-ocr-eng patchelf \
      nsis llvm clang lld 7zip \
 && rm -rf /var/lib/apt/lists/*

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
    PATH=/usr/local/cargo/bin:/usr/lib/llvm-18/bin:$PATH
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
