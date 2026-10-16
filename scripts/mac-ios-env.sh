# shellcheck shell=bash
# The iOS build environment on a shared Mac, with everything in your home
# (no sudo, no Homebrew installs). Source it before building iOS:
#
#   source scripts/mac-ios-env.sh
#
# What it expects (docs/mobile-builds.md, "Building on a Mac"):
#   ~/.cargo/bin    rustup + stable Rust, targets aarch64-apple-ios{,-sim}
#                   (official installer, --no-modify-path)
#   ~/.local/node   Node 22.12 (the official darwin-arm64 tarball)
#   ~/.local/bin    rush 5.153.0 + pnpm 10.17.0 (npm i -g --prefix ~/.local)
#   ~/.local/xcodegen/xcodegen  XcodeGen 2.46.0, the release zip unpacked as is
#                   (`tauri ios init` runs it). Not a symlink: XcodeGen finds
#                   its SettingPresets next to its own path, and a linked binary
#                   silently generates a project without Xcode's base settings
#                   (no app icon, no Swift version).
#   Xcode           selected with xcode-select (system-wide; not changed here)
#
# From the repo it adds scripts/ios-shims first (a `swift` that makes Tauri's
# Swift build work on Xcode 27) and scripts/ios-stubs last (`pod` and
# `idevicesyslog` stand-ins, so Tauri's tooling never `brew install`s them).
# Homebrew's bin is left off on purpose, so no tool silently uses (or installs
# into) somebody else's Homebrew.

_ohhi_scripts="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
export PATH="$_ohhi_scripts/ios-shims:$HOME/.cargo/bin:$HOME/.local/node/bin:$HOME/.local/bin:$HOME/.local/xcodegen/xcodegen/bin:/usr/bin:/bin:/usr/sbin:/sbin:$_ohhi_scripts/ios-stubs"
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_HOME="$HOME/.rustup"
# Xcode's "Build Rust Code" phase runs `pnpm tauri ios xcode-script`; it
# inherits this PATH from `tauri ios build`.
export LANG="${LANG:-en_US.UTF-8}"

_ohhi_missing=0
for _ohhi_tool in cargo rustup node pnpm rush xcodegen xcodebuild; do
  command -v "$_ohhi_tool" >/dev/null 2>&1 || { echo "mac-ios-env: $_ohhi_tool not found" >&2; _ohhi_missing=1; }
done
if [ "$_ohhi_missing" = 0 ]; then
  for _ohhi_tool in aarch64-apple-ios aarch64-apple-ios-sim; do
    rustup target list --installed | grep -qx "$_ohhi_tool" || echo "mac-ios-env: run rustup target add $_ohhi_tool" >&2
  done
fi
unset _ohhi_scripts _ohhi_missing _ohhi_tool
