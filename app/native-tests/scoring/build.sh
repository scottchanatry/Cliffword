#!/usr/bin/env bash
# Builds the Linux test driver for the llama.rn scoring patch (see README.md).
#
#   native-tests/scoring/build.sh [BUILD_DIR]
#
# BUILD_DIR (default: $CLIFFWORD_NATIVE_BUILD or ${TMPDIR:-/tmp}/cliffword-native-tests) gets a
# CPU-only CMake build of node_modules/llama.rn/vendor/llama.cpp and the driver binary
# BUILD_DIR/cliffword-score-driver. Nothing is written inside the repo. JOBS (default 2) sets the
# build parallelism.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/../.." && pwd)"
rn="$app/node_modules/llama.rn"
llama="$rn/vendor/llama.cpp"
build="${1:-${CLIFFWORD_NATIVE_BUILD:-${TMPDIR:-/tmp}/cliffword-native-tests}}"
jobs="${JOBS:-2}"

if [ ! -f "$rn/cpp/jsi/CliffwordScore.cpp" ]; then
  echo "node_modules/llama.rn/cpp/jsi/CliffwordScore.cpp is missing: the patch is not applied (run npm install or npx patch-package)" >&2
  exit 1
fi

mkdir -p "$build"
if [ ! -f "$build/llama/src/libllama.a" ]; then
  cmake -S "$llama" -B "$build/llama" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_TOOLS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_BUILD_COMMON=OFF \
    -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF -DGGML_NATIVE=ON -DGGML_OPENMP=OFF >/dev/null
  cmake --build "$build/llama" --target llama -j"$jobs"
fi

g++ -std=c++20 -O2 -Wall -Wextra \
  -I"$rn/cpp/jsi" -I"$llama/include" -I"$llama/ggml/include" -I"$llama/vendor" \
  "$here/driver.cpp" "$rn/cpp/jsi/CliffwordScore.cpp" \
  "$build/llama/src/libllama.a" "$build/llama/ggml/src/libggml.a" \
  "$build/llama/ggml/src/libggml-cpu.a" "$build/llama/ggml/src/libggml-base.a" \
  -lpthread -ldl -lm -o "$build/cliffword-score-driver"
echo "$build/cliffword-score-driver"
