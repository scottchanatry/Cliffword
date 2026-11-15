#!/usr/bin/env bash
# Checks that every library symbol the scoring patch calls is exported by llama.rn's prebuilt
# native libraries (Android jniLibs/*.so and the iOS xcframework), so the patched JSI glue links
# without building llama.cpp from source. See README.md.
#
#   native-tests/scoring/check-symbols.sh
#
# Needs g++, nm and llvm-nm (for the Mach-O framework). Prints one line per symbol and library
# and exits 1 if any is missing. The glue's own calls into rn-llama (clearCache,
# canGenerateText) are listed by hand below, as they are member functions of llama_rn_context.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rn="$(cd "$here/../.." && pwd)/node_modules/llama.rn"
llama="$rn/vendor/llama.cpp"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

g++ -std=c++17 -O1 -c -I"$llama/include" -I"$llama/ggml/include" "$rn/cpp/jsi/CliffwordScore.cpp" -o "$tmp/score.o"
mapfile -t c_syms < <(nm -u "$tmp/score.o" | awk '{print $2}' | grep '^llama_' | sort -u)
cpp_syms=(
  "rnllama::llama_rn_context::clearCache(bool)"
  "rnllama::llama_rn_context::canGenerateText() const"
)

libs=("$rn"/android/src/main/jniLibs/*/librnllama*.so)
ios_libs=("$rn"/ios/rnllama.xcframework/ios-arm64/rnllama.framework/rnllama
          "$rn"/ios/rnllama.xcframework/ios-arm64_x86_64-simulator/rnllama.framework/rnllama)

missing=0
check() {  # check LIB SYMBOL DEMANGLED_LIST_FILE
  if grep -qxF "$2" "$3"; then
    echo "ok       $2  ($(basename "$(dirname "$1")")/$(basename "$1"))"
  else
    echo "MISSING  $2  ($1)"
    missing=1
  fi
}

for lib in "${libs[@]}"; do
  nm -D --defined-only "$lib" | awk '{print $3}' > "$tmp/raw.txt"
  nm -DC --defined-only "$lib" | cut -d' ' -f3- > "$tmp/dem.txt"
  for s in "${c_syms[@]}"; do check "$lib" "$s" "$tmp/raw.txt"; done
  for s in "${cpp_syms[@]}"; do check "$lib" "$s" "$tmp/dem.txt"; done
done
for lib in "${ios_libs[@]}"; do
  # Mach-O: C symbols carry a leading underscore; check both archs of a fat binary.
  llvm-nm -gU --defined-only "$lib" 2>/dev/null | awk '{print $3}' | sed 's/^_//' | sort -u > "$tmp/raw.txt"
  llvm-nm -gUC --defined-only "$lib" 2>/dev/null | cut -d' ' -f3- | sort -u > "$tmp/dem.txt"
  for s in "${c_syms[@]}"; do check "$lib" "$s" "$tmp/raw.txt"; done
  for s in "${cpp_syms[@]}"; do check "$lib" "$s" "$tmp/dem.txt"; done
done

echo "symbols checked: ${#c_syms[@]} C (${c_syms[*]}) + ${#cpp_syms[@]} C++ in ${#libs[@]} Android and ${#ios_libs[@]} iOS binaries"
exit "$missing"
