#!/usr/bin/env bash
# Syntax-check the llama.rn scoreText patch the way both platforms compile it,
# then regenerate the patch-package file and check that it applies.
#
# Inputs (fetched with `npm pack`, nothing from them is executed):
#   LLAMARN  = extracted llama.rn@0.13.0-rc.11 package dir (pristine)
#   RNPKG    = extracted react-native@0.88.1 package dir (for jsi.h, CallInvoker.h)
#   WORK     = dir with orig/cpp and patched/cpp copies of llama.rn's cpp/
#   OUT      = patch file to write (patches/llama.rn+0.13.0-rc.11.patch in the app)
# In the app repo, after `npx patch-package llama.rn` exists, point LLAMARN at a
# pristine copy and WORK/patched at node_modules/llama.rn.
set -euo pipefail
LLAMARN=${LLAMARN:-/tmp/claude-0/pkgs/llamarn/package}
RNPKG=${RNPKG:-/tmp/claude-0/pkgs/react-native/package}
WORK=${WORK:-/tmp/claude-0/pkgs/llamarn-patched}
OUT=${OUT:-$(dirname "$0")/llama.rn+0.13.0-rc.11.patch}
L=$LLAMARN/vendor/llama.cpp
RN=$RNPKG/ReactCommon

SRC_INC=(-I"$L/include" -I"$L/ggml/include" -I"$L/common" -I"$L/src" -I"$L/vendor"
         -I"$L/tools/mtmd" -I"$LLAMARN/vendor/codec.cpp/include")
JSI_INC=(-I"$RN/jsi" -I"$RN/callinvoker" -I"$RN")
# <cstdarg> comes in transitively on Apple/NDK toolchains, not with glibc.
COMMON=(-fsyntax-only -include cstdarg -Wall -Wextra -Wno-unused-parameter -Wno-unused-function)

check() { # name, std, extra flags...
  local name=$1 std=$2; shift 2
  for cxx in g++ clang++; do
    if "$cxx" -std="$std" "${COMMON[@]}" "$@" "${JSI_INC[@]}" "$WORK/patched/cpp/jsi/RNLlamaJSI.cpp" 2> /tmp/scorepatch.err; then
      # only warnings from the patch itself count
      if grep -q "JSIScore.h" /tmp/scorepatch.err; then cat /tmp/scorepatch.err; exit 1; fi
      echo "ok   $name $std $cxx"
    else
      cat /tmp/scorepatch.err; echo "FAIL $name $std $cxx"; exit 1
    fi
  done
}

# 1. Build-from-source headers (Android: rnllamaBuildFromSource=true in rc.11; JNI glue is C++17)
check source c++17 -I"$WORK/patched/cpp" -I"$WORK/patched/cpp/jsi" "${SRC_INC[@]}"
check source c++20 -I"$WORK/patched/cpp" -I"$WORK/patched/cpp/jsi" "${SRC_INC[@]}"

# 2. Prebuilt iOS framework headers (-DRNLLAMA_USE_FRAMEWORK_HEADERS, flat <rnllama/...>)
FW=$(mktemp -d)
mkdir -p "$FW/rnllama/nlohmann"
for d in "$LLAMARN/cpp" "$L/include" "$L/ggml/include" "$L/common" "$L/src" "$L/tools/mtmd" "$LLAMARN/vendor/codec.cpp/include"; do
  for f in "$d"/*.h "$d"/*.hpp; do [ -e "$f" ] && ln -sf "$f" "$FW/rnllama/"; done
done
for sub in jinja parsers; do
  mkdir -p "$FW/rnllama/$sub"
  for f in "$L/common/$sub"/*.h "$L/common/$sub"/*.hpp; do [ -e "$f" ] && ln -sf "$f" "$FW/rnllama/$sub/"; done
done
ln -sf "$L/vendor/nlohmann/json.hpp" "$FW/rnllama/nlohmann/json.hpp"
check framework c++20 -DRNLLAMA_USE_FRAMEWORK_HEADERS -I"$WORK/patched/cpp/jsi" -I"$FW" -I"$L/vendor"
rm -rf "$FW"

# 3. patch-package style diff, then apply it to a pristine copy
cd "$WORK"
git diff --no-index --no-prefix orig/cpp patched/cpp \
  | sed -e 's#orig/cpp/#a/node_modules/llama.rn/cpp/#g; s#patched/cpp/#b/node_modules/llama.rn/cpp/#g' \
        -e 's#^diff --git b/node_modules/llama.rn/cpp/jsi/JSIScore.h#diff --git a/node_modules/llama.rn/cpp/jsi/JSIScore.h#' \
  > "$OUT" || true
T=$(mktemp -d); mkdir -p "$T/node_modules/llama.rn"; cp -r "$LLAMARN/cpp" "$T/node_modules/llama.rn/"
(cd "$T" && git init -q . && git apply --check -p1 "$OUT" && patch -p1 -s < "$OUT")
diff -r "$T/node_modules/llama.rn/cpp" "$WORK/patched/cpp" && echo "ok   patch applies: $OUT"
rm -rf "$T"
