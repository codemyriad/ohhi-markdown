# shellcheck shell=sh
# The Android toolchain for `tauri android …`, set for this shell only.
# Source it, don't run it:   . apps/desktop/scripts/android-env.sh
#
# Everything lives in the home directory (docs/mobile-android.md § Toolchain).
# Export any of these before sourcing to override it.

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

# The NDK Tauri builds the Rust library with. Pinned, so a second NDK
# installed later does not silently change the build.
OHHI_NDK_VERSION="${OHHI_NDK_VERSION:-27.2.12479018}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/$OHHI_NDK_VERSION}"

# Gradle wants a full JDK 17 or later (with `javac`; Ubuntu's
# openjdk-21-jre-headless has none). Prefer the one unpacked under
# ~/Android/jdk-21, else the one `java` resolves to.
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -x "$HOME/Android/jdk-21/bin/javac" ]; then
    export JAVA_HOME="$HOME/Android/jdk-21"
  elif command -v java >/dev/null 2>&1; then
    _ohhi_java="$(readlink -f "$(command -v java)")"
    export JAVA_HOME="${_ohhi_java%/bin/java}"
    unset _ohhi_java
  fi
fi
[ -x "${JAVA_HOME:-}/bin/javac" ] || echo "android-env: no javac under JAVA_HOME=${JAVA_HOME:-} (see docs/mobile-android.md, Toolchain)" >&2

case ":$PATH:" in
  *":$ANDROID_HOME/cmdline-tools/latest/bin:"*) ;;
  *) export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH" ;;
esac

for _ohhi_dir in "$ANDROID_HOME/platforms" "$NDK_HOME"; do
  [ -d "$_ohhi_dir" ] || echo "android-env: missing $_ohhi_dir (see docs/mobile-android.md, Toolchain)" >&2
done
unset _ohhi_dir

# Run as a command, it runs the rest of the line inside this environment:
#   sh scripts/android-env.sh pnpm exec tauri android build --debug --apk
if [ "$#" -gt 0 ] && [ "${0##*/}" = "android-env.sh" ]; then
  exec "$@"
fi
