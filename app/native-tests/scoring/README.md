# Linux proof of the llama.rn scoring patch

`patches/llama.rn+0.13.0-rc.11.patch` adds two native calls to llama.rn (see
`src/adapters/model/README.md`). Their computation lives in
`node_modules/llama.rn/cpp/jsi/CliffwordScore.{h,cpp}`, which uses only llama.cpp's C API. This
folder builds that file on Linux against the llama.cpp that llama.rn vendors, and checks it
against `proof/model_server.py`, the reference the engine was tuned with. Nothing here is part of
the app bundle, and build output never goes into the repo.

| File | What |
|---|---|
| `driver.cpp` | Loads a GGUF and answers JSON lines on stdin: `score`, `next`, `reset`, `info`. It uses the app's settings: n_ctx 2048, n_batch and n_ubatch 512, one sequence. Flash attention is a CLI argument, off by default. |
| `build.sh [BUILD_DIR]` | Builds `node_modules/llama.rn/vendor/llama.cpp` with CMake (CPU only, `JOBS`, default 2) and the driver into BUILD_DIR. The default BUILD_DIR is `$CLIFFWORD_NATIVE_BUILD`, else `${TMPDIR:-/tmp}/cliffword-native-tests`. |
| `compare.py` | Runs the driver against the server and prints the tables below. With `--fixture-out` it also writes the Jest fixture `src/adapters/model/__fixtures__/qwen3-native-scores.json`. Uses the standard library only. |
| `check-symbols.sh` | Checks that every symbol the patch calls is exported by llama.rn's prebuilt Android `.so` files and its iOS xcframework. |
| `syntax-check.sh` | Runs `-fsyntax-only` on the patched JSI sources against React Native's JSI headers, with g++ and clang++, in the Android and iOS header layouts. |

## Rerun

```bash
cd app
native-tests/scoring/build.sh /tmp/cw-native            # about 10 min the first time (-j2)
# in another shell, from the repo root (llama-cpp-python 0.3.37, CPU):
python proof/model_server.py --model /path/to/Qwen3-1.7B-Q4_K_M.gguf --port 8799
python3 native-tests/scoring/compare.py --driver /tmp/cw-native/cliffword-score-driver \
  --model /path/to/Qwen3-1.7B-Q4_K_M.gguf          # add --flash-attn auto to see llama.rn's default
native-tests/scoring/check-symbols.sh
native-tests/scoring/syntax-check.sh
```

`compare.py` exits 0 only when every check passes. Each check is described below.

## Cases

- 20 sentences from `proof/pairs.jsonl`: every fifth pair, correct and incorrect.
- 8 sentences from `proof/slang.jsonl`: street and neutral.
- 7 cases of our own:
  - a continuation that starts with a space (`" mercado"`);
  - `ñ`, accents, `¿` and `¡`;
  - an emoji;
  - `ü` and an ellipsis;
  - an empty context;
  - characters that Qwen3 splits into byte tokens (`ō`, `東京`).

That makes 35 sentences. The context is `"Frase en español:\n"` plus the start of the sentence. The
next-token lists use 8 contexts with k = 10, the empty context among them.

## Results (2026-11-15, Qwen3-1.7B-Q4_K_M, 4-core x86-64 with AVX-512)

With flash attention off, as in model_server.py (llama-cpp-python's default) and as the app's
adapter sets it:

| Check | Result |
|---|---|
| Start token | `[151645]` (`<|im_end|>`) on both sides |
| Token segmentation after merging split characters | identical in all 35 sentences, offsets included |
| Sentence totals | largest difference 0.00000 nats (the tolerance is 0.05) |
| Single tokens | largest difference 0.00000 nats |
| Fresh evaluation compared with a reused context prefix | identical (difference 0) |
| Next-token lists | same tokens in the same order in all 8 contexts; largest logprob difference 0.00000 |

With flash attention on (`--flash-attn auto`, llama.cpp's and llama.rn's default, which turns it
on for the CPU backend):

- sentence totals differed by up to **1.08 nats** and single tokens by up to 1.48 nats;
- 34 of 35 sentences missed the 0.05 tolerance;
- the top-10 orders changed in 7 of 8 contexts.

The engine's correction thresholds (assert at 3 nats, hint from 1 to 3 nats) were measured with
flash attention off, so the adapter turns it off (`flash_attn_type: 'off'`). The two builds agree
because the vendored llama.cpp (b12292) and llama-cpp-python 0.3.37 compute the same graph with the
same CPU kernels here (REPACK, AVX-512, llamafile). On a phone, Metal (iOS) and ARM NEON (Android)
use other kernels, so device numbers will differ slightly.

## What was checked, and what only a device build can check

- **Compiled and run on Linux.** `CliffwordScore.cpp`, built against the vendored llama.cpp. It
  produced every number above.
- **Symbols.** All 16 llama.cpp C functions the core calls, and the two rn-llama members the glue
  calls (`llama_rn_context::clearCache(bool)` and `canGenerateText() const`), are exported by:
  - all 9 Android libraries (`arm64-v8a`: 7, `x86_64`: 2);
  - both iOS framework slices (device and simulator).
- **Syntax.** `RNLlamaJSI.cpp` (patched) and `CliffwordScore.cpp` pass `-fsyntax-only` against
  `react-native/ReactCommon` (jsi, callinvoker), with g++ 13 and clang 18, in three
  configurations:
  - the Android include paths at C++17 and at C++20;
  - the iOS framework layout (`<rnllama/...>`, `RNLLAMA_USE_FRAMEWORK_HEADERS`) at C++20.

  The unpatched file passes the same check.
- **TypeScript.** The patched `src/` passes `tsc --strict`, the patched `lib/typescript/*.d.ts`
  type-check, and the patched `lib/commonjs` and `lib/module` pass `node --check`.
- **Patch.** It applies with `patch-package` to a fresh `npm install` of llama.rn@0.13.0-rc.11,
  and the patched tree equals `node_modules/llama.rn` (`cpp/`, `src/`, `lib/`).
- **Not checked here.** These need an EAS build or a device:
  - the `__ANDROID__` and `__APPLE__` blocks, compiled with the NDK and Xcode;
  - linking the JSI library against the prebuilt libraries;
  - installing the JSI functions at runtime;
  - the KV-cache handover between scoring and llama.rn's completion on a real context;
  - Metal and NEON numbers;
  - memory use and speed on a phone.
