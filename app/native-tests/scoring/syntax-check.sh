#!/usr/bin/env bash
# Compile-checks (-fsyntax-only) the patched llama.rn JSI sources on Linux, against React Native's
# JSI headers, in the two ways the app builds them (see README.md):
#   android: the include paths of android/src/main/CMakeLists.txt (cmake/rnllama-sources.cmake),
#            C++17 (CMAKE_CXX_STANDARD) and C++20;
#   ios:     the prebuilt framework's headers as <rnllama/...> (RNLLAMA_USE_FRAMEWORK_HEADERS),
#            C++20 (the podspec's -std=c++20).
# Neither the Android NDK nor Apple's SDK is here, so __ANDROID__ / __APPLE__ stay undefined: the
# platform-specific blocks (logging, Metal checks) are not checked, nor is any linking.
# <cstdarg> is force-included because RNLlamaJSI.cpp gets va_start from the platform headers.
#
#   native-tests/scoring/syntax-check.sh [g++|clang++ ...]   (default: both)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/../.." && pwd)"
rn="$app/node_modules/llama.rn"
L="$rn/vendor/llama.cpp"
RN="$app/node_modules/react-native/ReactCommon"
compilers=("$@")
[ ${#compilers[@]} -eq 0 ] && compilers=(g++ clang++)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/fw"
ln -s "$rn/ios/rnllama.xcframework/ios-arm64/rnllama.framework/Headers" "$tmp/fw/rnllama"

android_inc=(-I"$rn/cpp" -I"$rn/cpp/jsi" -I"$L" -I"$L/include" -I"$L/ggml/include" -I"$L/ggml/src"
  -I"$L/common" -I"$L/src" -I"$L/ggml/src/ggml-cpu" -I"$L/tools/mtmd" -I"$L/vendor" -I"$L/vendor/hash"
  -I"$rn/vendor/codec.cpp/include" -I"$rn/vendor/codec.cpp/common" -I"$rn/vendor/codec.cpp/src"
  -I"$RN/jsi" -I"$RN/callinvoker" -I"$RN")
ios_inc=(-DRNLLAMA_USE_FRAMEWORK_HEADERS -I"$tmp/fw" -I"$tmp/fw/rnllama" -I"$L/vendor" -I"$rn/cpp/jsi"
  -I"$RN/jsi" -I"$RN/callinvoker" -I"$RN")
files=("$rn/cpp/jsi/RNLlamaJSI.cpp" "$rn/cpp/jsi/CliffwordScore.cpp")

status=0
for cxx in "${compilers[@]}"; do
  for mode in android-c++17 android-c++20 ios-c++20; do
    case "$mode" in
      android-*) inc=("${android_inc[@]}") ;;
      ios-*) inc=("${ios_inc[@]}") ;;
    esac
    std="${mode##*-}"
    if "$cxx" -fsyntax-only -std="$std" -include cstdarg "${inc[@]}" "${files[@]}" 2>"$tmp/err.txt"; then
      echo "ok    $cxx $mode"
    else
      echo "FAIL  $cxx $mode"
      grep -E "error" "$tmp/err.txt" | head -20
      status=1
    fi
  done
done
exit "$status"
