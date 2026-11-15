# Device model and speech: research notes

Researcher notes for the Cliffword build outline: llama.rn on device, the native scoring
patch, model delivery, speech out, speech in, minutes spoken, and audio-session interplay.
Date 2026-11-15. Everything below was read from package sources fetched with `npm pack`
into `/tmp/claude-0/pkgs/<name>/` (no package code was run), plus a few web lookups (listed at
the end). Items marked **(verified)** were checked here; **(device)** means it can only be
settled on a phone.

Files next to these notes:

- `llama.rn+0.13.0-rc.11.patch`: the patch-package file adding `llamaScoreText` (437 lines).
- `JSIScore.h`: the new header from that patch, for reading.
- `check-llamarn-patch.sh`: compiles the patched JSI file six ways and checks the patch applies.

---

## 0. Decisions in one place

| # | Decision | Why |
|---|---|---|
| D1 | **llama.rn 0.13.0-rc.11 + a patch-package patch that adds one JSI host function, `llamaScoreText`** (one batched decode, logits for every text position, log-softmax, UTF-8-safe merging, UTF-16 offsets). Forced decoding is kept only as a fallback. | Only way to get exact per-token log-probs of a supplied text; about 10x faster than token-by-token forced decoding; the engine's thresholds were measured with exact log-probs. **(verified)** It compiles (g++ and clang++, C++17 and C++20, build-from-source and iOS framework header modes), the patch applies cleanly, every symbol it calls is exported by the prebuilt `rnllama.xcframework`, and the framework's headers are byte-identical to the package's (struct layout matches). |
| D2 | Start token = **`<|im_end|>` (id 151645)**, passed as `start_token`, never `llama_vocab_bos()`. | The unsloth Qwen3 GGUF has no `bos_token_id`; llama.cpp then returns its gpt2 default **11 = ","**. `proof/score.py` used `token_eos()` = 151645 (its comment says `<|endoftext|>`, but that is wrong; `proof/model_server.py` notes the same). The thresholds in `proof/RESULTS.md` hold only after this exact start token. **(verified from GGUF header and llama-vocab.cpp)** |
| D3 | Model **Qwen3-1.7B Q4_K_M**, pinned to HF commit `d7f544eead698dbd1f15126ef60b45a1e1933222`, 1,107,409,472 bytes, SHA-256 `b139949c…1897`, MD5 `dc4836c71a28a136d2a5b782b8465b6f`; downloaded on first run into an app-support folder excluded from backup. | Proof verdict. MD5 is what `expo-file-system` can check (`File.info({ md5: true })`); computed here. **(verified)** |
| D4 | Context params: `n_ctx 2048, n_batch 512, n_ubatch 512 (256 on 4 GB devices), n_parallel 1, n_gpu_layers 99 on iOS / 0 on Android, flash_attn_type 'auto' iOS / 'off' Android, use_mmap true, use_mlock false, ctx_shift false, KV f16 (q8_0 on 4 GB devices)`. | KV = 112 KiB/token for Qwen3-1.7B (28 layers x 8 KV heads x 128 x 2 x f16). Android OpenCL only accelerates Q4_0/Q6_K, so Q4_K_M runs on CPU. |
| D5 | iOS: prebuilt framework (no `RNLLAMA_BUILD_FROM_SOURCE`); Android: build from source (rc.11 forces it) narrowed with the `rnllamaVariants` gradle property; app plugin `['llama.rn', { enableEntitlements: true, entitlementsProfile: ['production','preview'], forceCxx20: true, enableOpenCLAndHexagon: false }]`. | The patch touches only JSI glue, which both platforms always compile from source. |
| D6 | Speech out: **expo-speech 58.0.4**, always selecting a voice by `identifier` (never by `language` on Android), `onBoundary` for tile highlight and timing. | It has rate, voice list, per-word boundary callbacks on both platforms, offline voices. Android's `language: 'es-MX'` silently falls back to the device locale (bug below). |
| D7 | Speech in: **expo-speech-recognition 58.0.1**, `continuous: true` hold-to-speak (start on press, `stop()` on release), `interimResults: true`, on-device when available, `volumeChangeEventOptions` at 50 ms for the waveform and VAD. | It covers on-device, Spanish, interim results, word segments, levels, permissions and the iOS audio session in one module. |
| D8 | Minutes spoken = **voiced time from our own level-based VAD inside each hold, counted only when the recognizer returns at least one word**, capped by hold time. Pauses for retell from iOS word segments (start+duration), on Android from VAD (Android segments carry start times only). | Recognizer timings differ by platform; levels exist on both. |
| D9 | One **AudioCoordinator** owns the audio session: pause Apple Music before any mic or TTS use at a cliff, never record while the track plays, resume explicitly. | MusicKit, TTS and the recognizer all touch `AVAudioSession`; auto-resume cannot be relied on. |
| D10 | Before the model is ready: onboarding, placement-free "I'm brand new" path, voice and mic setup run with a **canned mode** (pack-supplied first story sentences and option cliffs scored by string match), not the n-gram mock; Story unlocks fully when the model loads. | 1.1 GB download takes minutes; the n-gram mock is test-only and would teach wrong Spanish. |

---

## 1. llama.rn 0.13.0-rc.11 in Expo SDK 58

### 1.1 What ships and how it builds (verified from package sources)

- `postinstall` runs `install/download-native-artifacts.js`: it downloads
  `llama-rn-ios-xcframework.tar.gz` (349 MB) and `llama-rn-android-jni-libs.tar.gz` from the
  GitHub release `v0.13.0-rc.11` and checks SHA-256 against `install/native-artifacts.json`
  (iOS `97685348…7a9b`, verified by downloading it here). `RNLLAMA_SKIP_POSTINSTALL=1`
  skips it. EAS builders need github.com reachable during `npm ci`.
- **iOS** (`llama-rn.podspec`): by default links the prebuilt `ios/rnllama.xcframework` and
  compiles only `ios/*.{h,m,mm}` and `cpp/jsi/**/*.{h,cpp}` from source with
  `-DRNLLAMA_USE_FRAMEWORK_HEADERS` (headers come from the framework as `<rnllama/...>`).
  `RNLLAMA_BUILD_FROM_SOURCE=1` compiles everything. Metal on unless `RNLLAMA_DISABLE_METAL=1`
  (`-DGGML_USE_METAL -DGGML_METAL_EMBED_LIBRARY=1`). Accelerate/BLAS on.
  The framework binary's `MinimumOSVersion` is **15.0** (podspec says 13.0). Expo 58's
  template targets **iOS 16.4**, so no conflict.
- **Android** (`android/build.gradle`, `src/main/CMakeLists.txt`): rc.11's own
  `android/gradle.properties` sets `rnllamaBuildFromSource=true` ("force from-source build
  until we ship new prebuilts"), so the whole vendored llama.cpp (tag b12292) is compiled per
  CPU variant: `rnllama` (generic) plus `v8`, `v8_2`, `v8_2_dotprod`, `v8_2_i8mm`,
  `v8_2_dotprod_i8mm`, `v8_2_dotprod_i8mm_hexagon_opencl` for arm64, and `x86_64`. The cmake
  comment says about 4 min per variant on 4 cores, so 30 min+ of native compile per build.
  The JNI glue (`RNLlamaJSI.cpp`, `cpp/jsi/*.cpp`) is always compiled, as **C++17**
  (`CMAKE_CXX_STANDARD 17`). Only 64-bit ABIs (armeabi-v7a and x86 are filtered out).
  Runtime picks a variant from `/proc/cpuinfo` features (`RNLlama.java`), then also
  `System.loadLibrary("rnllama")`, so the generic `rnllama` variant must always be built.
  - Narrow variants: set gradle property
    `rnllamaVariants=rnllama,rnllama_v8,rnllama_v8_2_dotprod,rnllama_v8_2_dotprod_i8mm,rnllama_x86_64`
    in the app's `android/gradle.properties` via a 10-line config plugin
    (`withGradleProperties`). Drop `x86_64` from store builds with
    `reactNativeArchitectures=arm64-v8a` (keep it for emulator dev builds). **(device: check
    the loader still finds a library on an armv8.0 phone and on a dotprod+i8mm phone.)**
  - RN 0.88 defaults (verified in `react-native/gradle/libs.versions.toml`): minSdk 24,
    targetSdk 36, compileSdk 37, NDK 27.1.12297006. llama.rn accepts NDK major >= 24.
- **New Architecture**: required since llama.rn 0.10 (README). JS calls `RNLlama.install()`
  (TurboModule `NativeRNLlama`, codegen `RNLlamaSpec`), which installs JSI host functions
  (`global.llamaInitContext`, `llamaCompletion`, `llamaTokenize`, …) from shared C++
  `cpp/jsi/RNLlamaJSI.cpp`. iOS `install` reaches the runtime through
  `RCTBridge.currentBridge` / bridge proxy `runtime` + `jsCallInvoker`. llama.rn's dev deps
  stop at RN 0.82 typings; **RN 0.88.1 compatibility of that bridge-proxy path is unverified
  (device / first dev build)**.
- `src/index.ts` copies a fixed list of globals (`jsiBindingKeys`) into a private table and
  deletes them from `global`. A new global the list does not name (our `llamaScoreText`)
  stays on `global`, so the app can call it without patching any TypeScript.

### 1.2 Config plugin (app.json)

`app.plugin.js` → `withLlamaRN` options (defaults in brackets):

- `enableEntitlements` [true] + `entitlementsProfile` ['production']: adds
  `com.apple.developer.kernel.increased-memory-limit` and
  `com.apple.developer.kernel.extended-virtual-addressing` **only when** `EAS_BUILD_PROFILE`
  matches or `NODE_ENV=production`. Pass `['production','preview','development']` so dev
  builds get the same memory limit. Both are standard capabilities (no Apple request form);
  EAS-managed credentials sync capabilities on build.
- `forceCxx20` [true]: sets gnu++20 on the Xcode project and every Pod (Podfile post_install).
- `enableOpenCLAndHexagon` [true]: adds `<uses-native-library android:name="libOpenCL.so"|"libcdsprpc.so" android:required="false"/>`.
  Set false if the hexagon_opencl variant is not built.

```json
["llama.rn", { "enableEntitlements": true, "entitlementsProfile": ["production", "preview", "development"],
               "forceCxx20": true, "enableOpenCLAndHexagon": false }]
```

ProGuard (if minify is turned on): `-keep class com.rnllama.** { *; }`.
Jest: `jest.mock('llama.rn', () => require('llama.rn/jest/mock'))` exists; the app's own tests
should inject `createMockModel()` instead and never touch llama.rn.

### 1.3 GPU and CPU

- **iOS Metal**: used when the device supports `MTLGPUFamilyApple7` (+ Metal3 on iOS 16+),
  i.e. **A14 and later (iPhone 12+)**; never in the Simulator (`getMetalAvailability`). The
  context result reports `gpu`, `reasonNoGPU`, `devices`. Use `n_gpu_layers: 99`.
  README warns: on Apple CPUs without Metal, `n_gpu_layers: 0` can hit a **SIGILL in the q4_K
  repack kernel**; if `gpu` comes back false on iOS, re-init with `no_extra_bufts: true`
  (disables weight repacking). Make iPhone 12 the supported minimum and treat older phones as
  "best effort".
- **Android**: default CPU (NEON, dotprod, i8mm variants). OpenCL exists only in the
  hexagon_opencl variant, only on Adreno 700+, and llama.cpp's OpenCL backend only accelerates
  **Q4_0 / Q6_K**, so it does not help Q4_K_M. Hexagon HTP NPU is experimental and opt-in
  (`devices: ['HTP0']`, Snapdragon 8 Gen 1+). **Vulkan is excluded** from the npm package
  (`!vendor/llama.cpp/ggml/src/ggml-vulkan`). Decision: CPU only on Android for v1.
- Threads: Android default is 4 threads (2 on 4-core SoCs) pinned to the highest-frequency
  cores (`set_best_cores`, strict). iOS default `num_math_cores / 2`; with full Metal offload
  CPU threads matter little. Leave defaults; expose `n_threads` in a debug setting.
- Expect (estimates, measure with `ctx.bench(pp, tg, pl, nr)` on a dev build): iPhone 15
  class Metal: prompt 300–600 tok/s, generation 25–40 tok/s; Snapdragon 8 Gen 2 CPU: prompt
  80–150 tok/s, generation 12–20 tok/s. The container measured 124 / 15 tok/s on 4 x86 cores.

### 1.4 Memory, n_ctx

Qwen3-1.7B (verified from HF `config.json` and the GGUF header): 28 layers, 16 heads, 8 KV
heads, head dim 128, vocab 151,936, trained context 40,960, no sliding window.

| item | size |
|---|---|
| weights (Q4_K_M file, mmap'd) | 1.03 GiB |
| KV cache f16, per token | 114,688 B = 112 KiB |
| KV at n_ctx 1024 / 2048 / 4096 | 112 / 224 / 448 MiB (q8_0: about 0.53x; quantized V needs flash attention) |
| logits row (one output token) | 151,936 x 4 B = 0.58 MiB; patch caps outputs per decode at 64 = 37 MiB |
| compute buffers | roughly 150–350 MiB depending on n_ubatch (estimate) |
| app + JS + audio | 250–400 MiB |

Total at n_ctx 2048: about 1.8–2.0 GiB. Fine on 6 GB+ phones; marginal on 4 GB phones
(iPhone 12/13 mini, many Android mid-range): there use n_ctx 1024, n_ubatch 256, KV q8_0 (with
`flash_attn_type: 'on'` on iOS) and the increased-memory-limit entitlement. Pick the tier from
`expo-device` `totalMemory`.

`n_ctx` must be set: llama.cpp's default 0 means the trained 40,960 (4.4 GiB of KV).
Story scoring needs prefix + recent story (150–400 tokens) + sentence; generation prompts
are about 100 tokens of instructions plus the story; lyrics and brought text can be longer.
2048 leaves headroom. The engine should cap context near 1,500 tokens and trim in large
steps (e.g. drop to 800 when over 1,500), because every trim changes the prefix and loses KV
reuse.

`n_parallel`: common's default is 1 (the TS doc's "default 8" applies only if a value < 1 is
passed). Pass `n_parallel: 1` explicitly so sequence 0 owns the whole KV
(`n_ctx_seq = n_ctx / n_seq_max` when `kv_unified` is false).

### 1.5 Prefix reuse (prompt cache)

- `completion()` keeps a mirror of what sequence 0 holds (`completion->embd`), finds the
  common prefix with the new prompt's tokens, calls `llama_memory_seq_rm(mem, 0, n_common, -1)`
  and evaluates only the tail (`rn-completion.cpp loadPrompt`). Pure-attention models
  (Qwen3) need no state checkpoints. So repeated calls with the same story prefix cost only the
  new tokens.
- The patch's `llamaScoreText` uses the same mirror: it reuses the cached prefix, and after it
  finishes it sets `completion->embd` to what it left in the KV, so the next completion (or
  score) with the same prefix reuses it too.
- Consequence for the engine: **scoring contexts and generation prompts do not share a
  prefix** (`"Frase en español:\n" + story` vs Spanish instructions + story), so every switch
  between generating and scoring re-evaluates the story (about 0.5 s on iPhone Metal, 2–4 s on
  Android CPU for 300 tokens). Group work per story step: all generation, then all scoring.
  Possible later change: put the story first in both, e.g. generation prompt =
  scoring prefix + story + instructions + label.
- `saveSession/loadSession` (state files) exist but are not needed for v1.
- Parallel mode (`ctx.parallel.*`, slots) could sample the n candidates in one batched decode,
  but it owns the sequences: `llamaScoreText` and `decide` refuse to run while it is enabled.
  Leave it off in v1; candidates are sampled one after another with prefix reuse.

### 1.6 Concurrency, background, lifecycle

- One op at a time per context: every JSI op takes a `ContextClaim`; an overlapping op
  rejects with **"Context is busy"**. The adapter must queue its calls (promise chain).
- Ops run on llama.rn's worker thread pool and resolve on the JS thread; the UI stays
  responsive, but a long completion blocks other model calls. Keep generation `maxTokens`
  small (one sentence, about 40 tokens).
- **iOS background**: GPU work from a backgrounded app is not permitted (Metal command buffers
  fail). On `AppState` → `inactive/background`: stop accepting model calls, call
  `ctx.stopCompletion()`, await the in-flight op (scores are short; there is no abort for
  them). On return, resume. On a memory warning (`AppState` `memoryWarning`), `release()` the
  context and reload lazily (mmap reload of a warm file takes 1–3 s). **(device: verify ggml-metal
  in b12292 does not abort if a command buffer fails while backgrounding)**
- Android: background is fine, but the process can be killed; reload on resume.
- Load: `initLlama(params, onProgress)`; progress 0–100. First load after download reads
  1.1 GB from flash (seconds). Do it on app start in the background after the download
  completes; show "Preparing your teacher" only if the user reaches a model-dependent screen.

---

## 2. The device adapter (implements the engine's `LanguageModel`)

Engine contract (current `engine/src/model/types.ts`): `scoreContinuation(context, text):
TokenScore[]` (texts concatenate exactly to `text`; offsets are JS string indices; optional
`upperBound`), `nextTokens(context, k): TokenCandidate[]`, `generate(prompt, {n, maxTokens,
temperature, stop, seed}): string[]` (completion i uses seed + i).

### 2.1 Class sketch (exact llama.rn calls)

```ts
// app/src/model/LlamaDeviceModel.ts
import { Platform } from 'react-native';
import { initLlama, type LlamaContext } from 'llama.rn';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '@cliffword/engine';

type NativeAlt = { id: number; text: string; logprob: number; partial?: boolean; bytes?: number[] };
type NativeScore = {
  tokens: { text: string; start: number; end: number; logprob: number; n_tokens: number; top?: NativeAlt[] }[];
  next?: NativeAlt[];
  n_context_tokens: number; n_text_tokens: number; n_reused: number; n_evaluated: number; t_ms: number;
};
declare global {
  // installed by patches/llama.rn+0.13.0-rc.11.patch; undefined without it
  var llamaScoreText: undefined | ((ctxId: number, context: string, text: string, opts?: {
    start_token?: number; parse_special_context?: boolean; top_k?: number; next_top_k?: number;
    max_outputs_per_decode?: number; reuse_cache?: boolean;
  }) => Promise<NativeScore>);
}

export interface DeviceModelSpec {
  id: string;           // 'qwen3-1.7b-q4_k_m@d7f544e' (calibration tables are keyed by this)
  path: string;         // file URI of the GGUF
  startText: string;    // '<|im_end|>'
  nCtx: number;         // 2048 (1024 on 4 GB devices)
  nUbatch: number;      // 512 (256 on 4 GB devices)
  kvType: 'f16' | 'q8_0';
  topNFallback: number; // 50, for forced decoding without the patch
}

export class LlamaDeviceModel implements LanguageModel {
  readonly id: string;
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly ctx: LlamaContext,
    private readonly spec: DeviceModelSpec,
    private readonly startToken: number,
    readonly nativeScoring: boolean,
  ) { this.id = spec.id; }

  static async load(spec: DeviceModelSpec, onProgress?: (pct: number) => void) {
    const ios = Platform.OS === 'ios';
    const ctx = await initLlama({
      model: spec.path,
      n_ctx: spec.nCtx, n_batch: 512, n_ubatch: spec.nUbatch, n_parallel: 1,
      n_gpu_layers: ios ? 99 : 0,
      flash_attn_type: ios ? (spec.kvType === 'q8_0' ? 'on' : 'auto') : 'off',
      cache_type_k: spec.kvType, cache_type_v: spec.kvType,
      use_mmap: true, use_mlock: false, ctx_shift: false,
    }, onProgress);
    // iOS without Metal: re-init with no_extra_bufts: true (q4_K repack SIGILL, README)
    const start = await ctx.tokenize(spec.startText);           // llamaTokenize, parse_special = true
    if (start.tokens.length !== 1) throw new Error(`${spec.startText} is not a single token`);
    return new LlamaDeviceModel(ctx, spec, start.tokens[0]!, typeof global.llamaScoreText === 'function');
  }

  /** llama.rn rejects overlapping ops ("Context is busy"): run them one by one. */
  private run<T>(op: () => Promise<T>): Promise<T> {
    const p = this.chain.then(op, op);
    this.chain = p.catch(() => undefined);
    return p;
  }

  scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    if (text === '') return Promise.resolve([]);
    return this.run(async () => {
      if (!this.nativeScoring) return this.scoreByForcedDecoding(context, text);
      const r = await global.llamaScoreText!(this.ctx.id, context, text, { start_token: this.startToken });
      return r.tokens.map(({ text, start, end, logprob }) => ({ text, start, end, logprob }));
    });
  }

  nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    return this.run(async () => {
      if (this.nativeScoring) {
        const r = await global.llamaScoreText!(this.ctx.id, context, '', { start_token: this.startToken, next_top_k: k + 8 });
        return (r.next ?? []).filter((a) => !a.partial && a.text !== '').slice(0, k)
          .map((a) => ({ text: a.text, logprob: a.logprob }));
      }
      const res = await this.ctx.completion({
        prompt: this.spec.startText + sanitize(context), n_predict: 1,
        n_probs: k + 8, post_sampling_probs: false, temperature: 0,
      });
      const probs = res.completion_probabilities?.[0]?.probs ?? [];
      return probs.filter((p) => isWholeText(p.tok_str)).slice(0, k)
        .map((p) => ({ text: p.tok_str, logprob: Math.log(p.prob) }));
    });
  }

  generate(prompt: string, o: GenerateOptions): Promise<string[]> {
    return this.run(async () => {
      const base = o.seed ?? Math.floor(Math.random() * 2 ** 31);
      const out: string[] = [];
      for (let i = 0; i < o.n; i++) {
        const r = await this.ctx.completion({
          prompt,                       // raw text, no messages: no chat template, no thinking
          n_predict: o.maxTokens, temperature: o.temperature, seed: base + i,
          stop: o.stop ?? [], top_k: 40, top_p: 0.95, min_p: 0.05,
          penalty_repeat: 1.0, n_probs: 0,
        });
        out.push(r.text);               // excludes prompt and stop string
      }
      return out;
    });
  }

  release() { return this.run(() => this.ctx.release()); }
  // scoreByForcedDecoding: section 2.4
}

const sanitize = (s: string) => s.replace(/<\|/g, '<​|');  // completion parses special tokens
const isWholeText = (s: string) =>
  s !== '' && s !== '<UNKNOWN>' && !s.startsWith('byte: \\x') && !s.includes('�') && !/^<\|.*\|>$/.test(s);
```

Notes:

- `nextTokens` with the patch is a raw softmax over the full vocabulary (exactly what the proof
  used), reusing the KV prefix; candidates that are part of a UTF-8 character come back as
  `partial` with bytes and are dropped (small mass loss; Qwen has whole tokens for common
  Spanish accented letters). Ask for `k + 8` so `k` remain after filtering.
- `generate`: same seed and same backend reproduce; Metal vs CPU results differ, which is fine.
  Seeds count up per candidate as the engine contract asks. The `seed` field is
  llama.rn's `seed` (default -1 = random).
- Text normalisation: the native call requires that the token pieces rebuild the text byte for
  byte. llama.cpp's Qwen2 pre-tokenizer does not normalise, so this holds for any valid UTF-8;
  still, normalise every text entering the engine to NFC at its boundaries (ASR transcripts,
  pasted lyrics, share-in text) so the same word always tokenizes the same.
- Cost per engine operation with the patch: a judgement (1 + up to 16 variants) = 17 calls, each
  decoding about 1 + 12 tokens after the cached context: about 1–1.5 s on iPhone Metal, 2–4 s on
  Android CPU. `cliffPositions` with full next-word search is about 50 calls per analysed
  position: pass `positions` to analyse 2–3 candidate positions and precompute while TTS plays.
  Phase-2 optimisation: a `llamaScoreTexts(ctxId, context, texts[])` that decodes the context
  once and scores all variants in one batch via `llama_memory_seq_cp` into sequences 1..n
  (needs `n_parallel >= 17`, `kv_unified: true`).

### 2.2 The native patch: `llamaScoreText`

**Files changed** (both under `node_modules/llama.rn/cpp/jsi/`):

1. **New `JSIScore.h`** (header-only, about 370 lines). Header-only on purpose: iOS compiles
   `cpp/jsi/**` by glob, but Android's `CMakeLists.txt` lists the JNI sources explicitly
   (`JNI_SOURCE_FILES`); a new `.cpp` would need a CMake edit too.
2. **`RNLlamaJSI.cpp`**: `#include "JSIScore.h"` and one host-function registration after
   `llamaDetokenize`, in the same translation unit as `ContextClaim`, `getContextOrThrow`,
   `createPromiseTask`, `toJson/fromJson`, `getPropertyAs*`.

Because `cpp/jsi/RNLlamaJSI.cpp` is in both platforms' always-from-source glue (iOS podspec
`cpp/jsi/**`; Android `JNI_SOURCE_FILES`), and both platform entry points only call the shared
`rnllama_jsi::installJSIBindings` (iOS `RNLlama.mm` `install`; Android
`android/src/main/RNLlamaJSI.cpp` `Java_com_rnllama_RNLlamaModule_installJSIBindings`),
**one patch serves iOS and Android**; neither entry point needs a change.

**JS signature**

```
llamaScoreText(contextId, context, text, opts?) -> Promise<{
  tokens: [{ text, start, end, logprob, n_tokens, top? }],   // whole-character groups
  next?:  [{ id, text, logprob, partial?, bytes? }],         // if next_top_k > 0
  n_context_tokens, n_text_tokens, n_reused, n_evaluated, t_ms }>
opts: { start_token = -1, parse_special_context = false, top_k = 0, next_top_k = 0,
        max_outputs_per_decode = 64, reuse_cache = true }
```

**C++ outline** (`rnllama_jsi::scoreText`, runs on the worker thread under `ContextClaim`):

1. Guards: context loaded; throw if parallel mode is on (slots own the sequences) or the context
   is in embedding mode.
2. Tokenize separately: `all = [start_token] + common_tokenize(vocab, context, false,
   parse_special_context)`; `ttoks = common_tokenize(vocab, text, false, false)` (the text is
   never parsed for special tokens). Throw if `N > llama_n_ctx`.
3. Pieces: `common_token_to_piece(vocab, id, false)` per text token; their concatenation must
   equal `text` (one extra leading space from SentencePiece vocabularies is stripped);
   otherwise throw "normalize to NFC".
4. KV reuse on sequence 0: `frontier = llama_memory_seq_pos_max(mem, 0) + 1`; `common` = shared
   prefix of `completion->embd` and `all`, capped by the frontier (the last sampled token of a
   completion is in `embd` but not decoded); `n_past = min(common, n_ctx_tok - 1)` because the
   logits of the last context token are needed. Clear `completion->embd` first (a failure then
   makes the completion re-evaluate). `n_past == 0` → `llama_memory_clear(mem, false)`, else
   `llama_memory_seq_rm(mem, 0, n_past, -1)` (on failure clear). Recurrent, hybrid and SWA models
   (`llama_model_is_recurrent/is_hybrid`, `llama_model_n_swa > 0` without `swa_full`) never
   reuse and are cleared afterwards.
5. Decode `[n_past, N)` with `llama_batch_init(n_batch, 0, 1)` and the inline
   `rnllama::llama_batch_add(&batch, tok, pos, {0}, wantLogits)`; logits wanted where the next
   token is a text token (`p + 1 >= n_ctx_tok && p + 1 < N`) and at `N-1` if `next_top_k`. A batch
   closes at `n_batch` tokens or `max_outputs_per_decode` outputs (bounds the n_vocab x 4 B
   logits buffer). `llama_decode`; per output row `llama_get_logits_ith(ctx, batchIndex)` (index
   in the batch, not the output index), `lse = logsumexp(row)` in double,
   `logprob = row[next] - lse`; optional top-k by `partial_sort`.
6. Success: `completion->embd = all; completion->n_past = N`, so the completion's own
   prefix logic reuses this KV.
7. Merge byte-level tokens into groups that start and end on UTF-8 character boundaries
   (a group ends when the next byte is not `10xxxxxx`), summing log-probs; offsets converted
   from bytes to **UTF-16 code units** (astral characters count 2), so `text.slice(start, end)`
   in JS returns the group. Unit-tested here on `" está ¿qué? 🎵"` split mid-character
   (groups `" est"|"á"|" ¿"|"qué"|"?"|" 🎵"`, offsets 0,4,5,7,10,11,14 match JS slicing).
8. Candidates (`top`, `next`) whose piece is not well-formed UTF-8 are returned as
   `{ text: '', partial: true, bytes: [...] }` (a JSI string must be valid UTF-8).

**Why it links on iOS with the prebuilt framework (verified)**: `rn-llama.h` says the glue may
use ggml *types* but must not bind ggml *symbols* (they are unexported, see
`ios/unexported-symbols.txt`, so a second ggml-based framework such as whisper.rn cannot
collide). The patch calls only `llama_*` and `common_*`. `llvm-nm -gU` on
`rnllama.xcframework/ios-arm64/rnllama.framework/rnllama` exports all 16 llama symbols used
(`llama_batch_init/free, llama_decode, llama_get_logits_ith, llama_memory_clear/seq_rm/
seq_pos_max, llama_get_memory, llama_model_get_vocab, llama_vocab_n_tokens, llama_vocab_bos,
llama_n_batch, llama_n_ctx, llama_model_is_recurrent/is_hybrid, llama_model_n_swa`) and both
`common_tokenize(const llama_vocab*, …)` and `common_token_to_piece(const llama_vocab*, int,
bool)`; `ggml_init` is not exported, as designed. The framework's `rn-completion.h`,
`rn-llama.h`, `llama.h`, `common.h` are byte-identical to the package's, so reading
`completion->embd` uses the right struct layout. No `RNLLAMA_BUILD_FROM_SOURCE` needed.

**The start-token trap (verified)**: unsloth `Qwen3-1.7B-Q4_K_M.gguf` metadata:
`tokenizer.ggml.model = gpt2`, `pre = qwen2`, `add_bos_token = False`, `eos_token_id = 151645`
(`<|im_end|>`), **no `bos_token_id`**. llama.cpp then keeps the gpt2 default
`special_bos_id = 11`, which is `","` in Qwen's vocabulary. A `prepend BOS` default would have
scored every sentence after a comma. Hence `start_token` is explicit and the adapter derives it
by tokenizing `'<|im_end|>'` once. The fallback path writes the literal `<|im_end|>` at the
start of the completion prompt (completion parses special tokens).

**patch-package workflow**

```bash
npm i -D patch-package
# package.json: "scripts": { "postinstall": "patch-package" }
# put the file at patches/llama.rn+0.13.0-rc.11.patch (the one next to these notes), or
# edit node_modules/llama.rn/cpp/jsi/* and run: npx patch-package llama.rn
npm ci        # applies the patch; llama.rn's own postinstall still downloads the artifacts
```

- Pin `"llama.rn": "0.13.0-rc.11"` exactly (no caret): the patch is version-specific and an
  RC can change `RNLlamaJSI.cpp`. When upgrading, re-run the check script and regenerate.
- EAS runs `npm ci` → postinstall → patch applied before prebuild/pods/gradle.
- Optional upstream: offer `llamaScoreText` as a PR to mybigday/llama.rn; then drop the patch.

**Compile check in this container (no Xcode, no NDK)** — what `check-llamarn-patch.sh` runs:

```bash
P=/tmp/claude-0/pkgs/llamarn/package          # npm pack llama.rn@0.13.0-rc.11
RN=/tmp/claude-0/pkgs/react-native/package/ReactCommon   # npm pack react-native@0.88.1
L=$P/vendor/llama.cpp
# build-from-source headers (Android JNI glue is C++17; also try c++20)
clang++ -std=c++17 -fsyntax-only -include cstdarg -Wall -Wextra \
  -I<patched>/cpp -I<patched>/cpp/jsi -I$L/include -I$L/ggml/include -I$L/common -I$L/src \
  -I$L/vendor -I$L/tools/mtmd -I$P/vendor/codec.cpp/include \
  -I$RN/jsi -I$RN/callinvoker -I$RN  <patched>/cpp/jsi/RNLlamaJSI.cpp
# iOS prebuilt mode: -DRNLLAMA_USE_FRAMEWORK_HEADERS with a temp dir rnllama/ of symlinks to all
# headers of cpp/, include/, ggml/include, common/ (+ common/jinja, common/parsers), src/,
# tools/mtmd, codec.cpp/include, and rnllama/nlohmann/json.hpp; plus -I$L/vendor
```

`-include cstdarg` only works around glibc (Apple/NDK headers bring `va_start` in
transitively); the unpatched file needs it too. Results: all six combinations (g++/clang++ x
source c++17/c++20 + framework c++20) compile with no warnings from the patch; `git apply
--check` and `patch -p1` both succeed on a pristine copy.

What this does not prove: link on a real toolchain and numerical behaviour. **Acceptance test
on the first dev build** (a hidden "Model self-test" screen):

1. Score 10 pairs from `proof/pairs.jsonl` after `start_token` + `"Frase en español:\n"`;
   compare totals with `proof/raw_qwen3-1.7b.json` (tolerance 0.15 nats per sentence;
   Metal/NEON kernels differ slightly from x86).
2. `tokens.map(t => t.text).join('') === text` and offsets slice correctly for a sentence with
   ¿ ¡ á ñ and an emoji.
3. Call score twice with the same context: second call reports `n_reused = n_context_tokens - 1`.
4. Run a completion after a score with the same prefix: its `timings.cache_n` > 0.
5. `nextTokens` after "En la playa hacía mucho" lists " calor" first with p near 0.65.

A host-side numeric test before any device build is possible (compile `cpp/` + vendored
llama.cpp for Linux CPU and call `scoreText` on the GGUF), but that means building and running
llama.rn's C++; leave it to the build step and the user's approval.

### 2.3 Without the patch: forced decoding fallback

Keep it behind the same adapter (`nativeScoring === false`), for a build where the patch is
missing (e.g. a llama.rn upgrade broke it):

```ts
private async scoreByForcedDecoding(context: string, text: string): Promise<TokenScore[]> {
  const nTok = (await this.ctx.tokenize(text)).tokens.length;
  const res = await this.ctx.completion({
    prompt: this.spec.startText + sanitize(context),
    grammar: `root ::= ${gbnfLiteral(text)}`,      // exactly this text, then EOS
    n_predict: nTok + 4, temperature: 0,
    n_probs: this.spec.topNFallback,               // 50
    post_sampling_probs: false,                    // raw softmax over the whole vocabulary
  });
  // res.completion_probabilities[i] = { content, probs: [{ tok_id, tok_str, prob }] }:
  //  logprob = ln(prob of the entry whose tok_str === content) -> exact
  //  else   = ln(smallest prob in the list), upperBound: true
  // Offsets: walk the content pieces over `text`; "byte: \xNN" counts one byte; merge steps
  // until a UTF-8 character boundary; drop steps after the text ends (EOS).
}
const gbnfLiteral = (s: string) => '"' + [...s].map((c) =>
  c === '"' ? '\\"' : c === '\\' ? '\\\\' : c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : c).join('') + '"';
```

Limits: one decode per token (about 10x slower than the batched call); greedy decoding under a
grammar usually follows the canonical tokenization but is not guaranteed to; the chosen token's
id is not reported, only its string, and ill-formed pieces arrive sanitised (U+FFFD), which can
break offset mapping for byte-split characters; tokens outside the top N get only an upper
bound, which the engine supports (`TokenScore.upperBound`, `TopNBoundedModel` simulates it for
measuring the cost).

---

## 3. Model delivery

### 3.1 Store rules (sources at the end)

- **App Store**: cellular download cap 200 MB for the app binary (user can allow larger since
  iOS 13); max uncompressed app 4 GB. A 1.1 GB model in the bundle would make the app a
  Wi-Fi-only, slow install and duplicates the file on every update. Do not bundle.
- **Google Play**: limits by compressed download size: base module 500 MB; asset pack 1.5 GB
  each; install-time total 4 GB; fast-follow/on-demand total 30 GB. Play Asset Delivery could
  host the GGUF as an on-demand pack, but that needs a native PAD module and differs from iOS.
  Use one HTTP download path on both platforms; PAD is an option later.
- iOS 26 has Apple-hosted Background Assets; the deployment target is 16.4, so not for v1.
- App Review 2.5.2 (no downloaded executable code): a model file is data, the norm for
  on-device-AI apps; say in review notes that a language model data file is downloaded once.

### 3.2 Download

Source: `https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf`
(verified: 302 to a signed CDN URL, `accept-ranges: bytes`, `x-linked-size: 1107409472`,
`x-linked-etag` = the SHA-256; repo is Apache-2.0, not gated). Pinning the commit keeps the
file and hash stable. Recommended: also mirror the file on a bucket you control (R2/S3) and try
it first or second; HF URLs and rate limits can change.

| model | size (bytes) | SHA-256 | MD5 (computed here) |
|---|---|---|---|
| Qwen3-1.7B-Q4_K_M (main) | 1,107,409,472 | `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897` | `dc4836c71a28a136d2a5b782b8465b6f` |
| Qwen3-0.6B-Q4_K_M (fallback candidate, repo commit `50968a4468ef4233ed78cd7c3de230dd1d61a56b`) | 396,705,472 | `ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a` | `45349ac9dec6a388775cbd720be5f8df` |
| Qwen3-1.7B-Q3_K_M (smaller 1.7B) | 939,539,008 | `8070f21b…9170` | not computed |
| Qwen3-1.7B-UD-IQ3_XXS | 765,174,336 | `7727d3c0…0e86` | not computed |

`expo-file-system` 58.0.13 (verified from its types):

```ts
import { DownloadTask, File, Directory, Paths } from 'expo-file-system';
const dir = new Directory(Paths.document, 'models');   // iOS Documents: set excluded-from-backup (below)
dir.create({ idempotent: true, intermediates: true });
const dest = new File(dir, 'Qwen3-1.7B-Q4_K_M.gguf.part');
const task = new DownloadTask(URL, dest, {
  sessionType: 'background',                 // iOS URLSession continues while suspended (default)
  onProgress: ({ bytesWritten, totalBytes }) => setProgress(bytesWritten / totalBytes),
});
const file = await task.downloadAsync();      // null if paused
// pause: await task.pauseAsync(); persist task.savable() (url, fileUri, resumeData) in SQLite
// resume later (even after relaunch): DownloadTask.fromSavable(saved, { onProgress }).resumeAsync()
const info = file.info({ md5: true });        // size + md5 check before renaming to .gguf
```

- Before starting: `Paths.availableDiskSpace` must exceed size + 600 MB margin; show the size.
- Wi-Fi prompt: `expo-network` `getNetworkStateAsync()` → `type === NetworkStateType.CELLULAR`
  → ask "Download 1.1 GB over mobile data?" (iOS cannot detect Low Data Mode through it). Listen
  with `addNetworkStateListener` and pause on a switch to cellular unless the user agreed.
- The JS `DownloadTask` object is not restored after the app is killed (the iOS background
  session may finish on its own); on launch, check the `.part` file size and the saved
  pause state; if unusable, restart with resume data or from zero.
- Verify size then MD5 (hashing 1.1 GB natively takes seconds); on mismatch delete and retry
  once, then show an error. Rename `.part` → `.gguf` only after it passes.
- **Backup exclusion**: `expo-file-system` 58 has no API for it (verified: no
  `isExcludedFromBackup` anywhere in its iOS sources). iOS backs up Documents and Application
  Support (not Caches); Apple's storage guidelines require large re-downloadable data to be
  excluded or put in Caches. Caches can be purged under storage pressure (a 1.1 GB re-download
  at a bad moment). So: a small **local Expo module** (`modules/cliffword-device`, Swift
  `URLResourceValues.isExcludedFromBackup = true` on the models directory; Kotlin side a no-op).
  Android: Auto Backup stops backing up an app whose data exceeds 25 MB, so exclude
  `files/models/` with `android:fullBackupContent` and `android:dataExtractionRules` XML via a
  config plugin (keeps the small SQLite learner data backed up).
  The same local module can later hold a per-locale on-device speech check (section 5) and
  iOS `AVSpeechSynthesizer.write` rendering (section 4).

### 3.3 Smaller fallback model

- For devices under about 4 GB RAM, or users who refuse 1.1 GB: **Qwen3-0.6B Q4_K_M (397 MB)**.
  It has **not** been measured by the proof; run `proof/score.py` on it in the container
  before shipping (cheap: about 10 minutes) and keep a separate threshold table keyed by
  model id. Expect lower accuracy on ser/estar and por/para; probably usable for word heat and
  next-word lists, weaker for asserting corrections (set `assertMargin` from its own data or
  limit it to hints).
- Second option: Qwen3-1.7B Q3_K_M (940 MB) saves little; not worth a separate calibration.

### 3.4 Before the model is ready

The download takes 2–10 minutes on Wi-Fi. Order of first run:

1. Welcome, pick language pair, "I'm brand new" or "I know some" → starts the download at once
   (with the cellular check).
2. While downloading: microphone and speech permissions, voice check (pick and hear the Spanish
   voice, "más despacio" demo), hold-to-speak practice with spoken commands (otra vez, más
   despacio, no sé, siguiente, listo) — none of this needs the model.
3. A short **canned first story** shipped in the pair pack (5–8 cognate-heavy sentences, cliffs
   with option rungs, answers checked by string and form match against the pack's listed
   answers). This also starts placement signals. No model probabilities, no corrections.
4. When the model is verified and loaded, the session switches to model-driven scoring and
   generation at the next sentence. The Music tab's lyric cliffs on pasted lyrics also work
   without the model in "listed answer" mode (the proof shows model next-word lists are useless
   on slang lines anyway).

Do not use the engine's n-gram mock in production; it exists for tests.

---

## 4. Speech out (expo-speech 58.0.4)

API (verified from `build/Speech.d.ts`, iOS `SpeechModule.swift`, Android `SpeechModule.kt`):
`speak(text, { language, voice, rate, pitch, volume, useApplicationAudioSession (iOS),
onStart, onDone, onStopped, onError, onBoundary })`, `getAvailableVoicesAsync() → { identifier,
name, quality: 'Default'|'Enhanced', language }[]`, `stop()`, `pause()/resume()` (iOS only),
`isSpeakingAsync()`, `maxSpeechInputLength`.

- **Rate**: iOS sets `utterance.rate = rate x AVSpeechUtteranceDefaultSpeechRate (0.5)`, so
  `rate` 1.0 = default, valid about 0–2. Android `TextToSpeech.setSpeechRate(rate)`, 1.0 normal.
  "más despacio" → multiply the learner's rate by 0.8 per command, floor 0.5; the engine's
  `deriveParams` speech rate feeds the default. Rates are not perceptually identical across
  platforms; keep a per-platform factor table.
- **Word boundaries**: iOS `willSpeakRangeOfSpeechString` and Android
  `UtteranceProgressListener.onRangeStart` (API 26+, engine-dependent; Google TTS supports it)
  both arrive as `onBoundary({ charIndex, charLength })`. Use them to light the current tile and
  to **measure real word durations** (time between boundary events) per voice and rate; store a
  chars-per-second (or syllables-per-second) estimate and size tiles from it next time. First
  time, size tiles by a syllable heuristic. Android offers no pause/resume: "otra vez" = stop +
  speak again from the sentence start (or from the current word by slicing text).
- **Android language bug**: `speakOut` builds `Locale.Builder().setLanguage(options.language)`;
  `"es-MX"` is not a valid language subtag, throws `IllformedLocaleException`, and the code falls
  back to `Locale.getDefault()` (usually English). **Always pass `voice: identifier`** chosen from
  `getAvailableVoicesAsync()` (`setVoice` runs after the language and wins); pass `language: 'es'`
  only as a base.
- **Voices**: iOS has local voices only (compact ones preinstalled per language; Enhanced/Premium
  downloadable in Settings › Accessibility › Spoken Content). expo-speech labels premium (iOS 16+)
  as 'Default' because it only checks `.enhanced`. Reported on iOS 18 devices: the compact
  Mónica (es-ES) and Paulina (es-MX) voices may be missing, leaving `com.apple.eloquence.es-*`
  voices of lower quality (device: list voices on iOS 18/26 phones). No Apple es-US or es-PR
  voice is documented. Android Google TTS: es-ES and es-US voices, names ending `-local`
  (offline) or `-network` (needs network; `isNetworkConnectionRequired` is not exposed, so use
  the name suffix); Samsung TTS has its own set. Caribbean accents are not offered anywhere.
  Selection: prefer [es-US, es-MX, es-419, es-ES] in that order (configurable per region pack),
  prefer Enhanced, prefer `-local`; let the learner choose in settings and play a sample. An
  onboarding card can explain how to download a better iOS voice (no public deep link to that
  Settings page).
- **Offline**: yes for iOS voices and Android local voices.
- **Audio session**: `useApplicationAudioSession` defaults to true (AVSpeechSynthesizer's
  default): TTS plays in the app's session with whatever category the AudioCoordinator set. Keep
  it true so TTS and recognition do not fight over sessions (section 7).
- **Alternatives**: `react-native-tts` 4.1.1 (last publish 2024-06, old-architecture bridge
  module; same callbacks as expo-speech) offers nothing critical more — do not add it. What
  neither offers: rendering speech to audio with word markers before playback (exact tile
  durations, replay at another rate without re-synthesis, the B4 echo reference). If needed in
  phase 2, add it to the local module: iOS `AVSpeechSynthesizer.write(_:toBufferCallback:
  toMarkerCallback:)` (iOS 17+; markers carry byte-sample offsets per word), Android
  `TextToSpeech.synthesizeToFile` + `onRangeStart` frame offsets; play with expo-audio.

---

## 5. Speech in (expo-speech-recognition 58.0.1)

API (verified from `src/ExpoSpeechRecognitionModule.types.ts`, iOS `ExpoSpeechRecognizer.swift`,
Android `ExpoSpeechService.kt`, `app.plugin.js`):

```ts
ExpoSpeechRecognitionModule.start({
  lang: 'es-US',                       // then es-MX, es-ES (see locales)
  interimResults: true,
  continuous: true,                    // hold-to-speak: stop() on release; no 3-s auto-stop
  requiresOnDeviceRecognition: onDevice,
  addsPunctuation: false,
  maxAlternatives: 3,
  contextualStrings: [...commands, ...targetWords, ...lineWords],   // biasing (Android 13+, iOS)
  iosTaskHint: 'dictation',
  iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'], mode: 'default' },
  volumeChangeEventOptions: { enabled: true, intervalMillis: 50 },
  androidIntentOptions: { EXTRA_MASK_OFFENSIVE_WORDS: false },       // explicit lyrics are on by default
  recordingOptions: { persist: needAudio },                           // WAV for pitch / Android pauses
});
// events (useSpeechRecognitionEvent): start, audiostart {timestamp}, speechstart, volumechange {value},
// result {isFinal, results:[{transcript, confidence, segments:[{startTimeMillis,endTimeMillis,segment,confidence}]}]},
// speechend, audioend {timestamp, uri}, end, nomatch, error {error, message, code}
```

- **On-device**: iOS `request.requiresOnDeviceRecognition` when the recognizer supports it (iOS
  13+; the dictation language must be downloaded). Android: with the flag the module uses
  `SpeechRecognizer.createOnDeviceSpeechRecognizer` (only on API 33+ in this module) and
  `EXTRA_PREFER_OFFLINE`; the language model must be installed:
  `getSupportedLocales({ androidRecognitionServicePackage: 'com.google.android.as' }).installedLocales`,
  else `androidTriggerOfflineModelDownload({ locale: 'es-US' })` (Android 13: opens a dialog;
  14+: downloads or schedules). On iOS the module reports `installedLocales` = all supported
  locales, so it cannot tell which Spanish locales work offline: try on-device first and fall
  back on `language-not-supported` / `service-not-allowed`, or add a per-locale
  `SFSpeechRecognizer(locale:).supportsOnDeviceRecognition` check to the local module.
  Policy: on-device by default; network recognition (Apple/Google servers) only with a one-time
  disclosure, since the app promises on-device speech.
- **Spanish locales**: Apple lists Spanish for US, Mexico and Spain (on-device coverage is
  narrower than server; device check). Google on-device has es-ES and es-US (others vary).
  Use es-US for Caribbean learners' targets; fall back es-MX, es-ES.
- **Continuous**: iOS non-continuous stops after 3 s without results (iOS ≤ 17) or at the first
  final-like result (iOS 18+), which would cut retells at pauses; so use `continuous: true` and
  end with `stop()` on release (final result arrives after stop, typically within a second).
  Android continuous needs Android 13+ (it streams the module's own `AudioRecord` with
  `EXTRA_SEGMENTED_SESSION`); on 12 and lower the module stretches the silence extras to 600 s.
- **Interim results**: iOS partials with confidence 0; Android partials if the service honours
  `EXTRA_PARTIAL_RESULTS`.
- **Word timestamps (segments)**: iOS: every `SFTranscriptionSegment` → `startTimeMillis =
  timestamp`, `endTimeMillis = timestamp + duration` (real word spans, relative to audio start).
  Android: only on API 34+ with the on-device Google service, only on final results, only for
  the first alternative, and only **start** times (`endTimeMillis` = next word start − 1 ms; the
  last word has zero length). So pauses from segments are reliable on iOS only.
- **Audio levels**: iOS: a tap computes RMS power in dB, normalises −60…0 dB to the module's
  −2…10 scale, every `intervalMillis` (default 100). Android: `onRmsChanged(rmsdB)` from the
  recognition service (roughly −2…10). Below 0 = inaudible. Good enough for the hold-to-speak
  waveform. (device: check that Android still delivers RMS in continuous mode, where the app
  supplies the audio via `EXTRA_AUDIO_SOURCE`; if not, compute levels from the persisted WAV or
  from the waveform side.)
- **iOS time limit**: Apple documents that recognition tasks longer than about one minute are
  stopped; reports conflict on whether on-device tasks are exempt. The 60-second retell is right
  at that edge: run retells as one task with on-device recognition, and if a task ends early,
  restart immediately and join transcripts (segment times restart at 0 per task; offset them by
  the `audiostart` timestamps). iOS 26's SpeechAnalyzer removes the limit but the module does not
  use it (verified: no SpeechAnalyzer in its sources). Rate limit: 1,000 requests/hour/device.
- **Profanity**: Android masks offensive words by default (`EXTRA_MASK_OFFENSIVE_WORDS` true;
  set false, API 33+). iOS `SFSpeechRecognizer` has no documented switch; it may mask some
  words with asterisks (device check with explicit lyric lines); the command/alignment code
  should treat `*`-masked tokens as wildcards.
- **Permissions** (config plugin): iOS `NSMicrophoneUsageDescription`,
  `NSSpeechRecognitionUsageDescription`; Android `RECORD_AUDIO` and a `<queries>` entry for
  `com.google.android.googlequicksearchbox` + `android.speech.RecognitionService` (add
  `com.google.android.as` to `androidSpeechServicePackages` for on-device). The README says
  on-device iOS recognition needs only the mic permission; request both on iOS anyway (cheap,
  avoids a failure if network fallback is used). Strings (translatable, in the pair pack):
  "Cliffword listens while you hold the screen, so you can answer the story out loud." /
  "Speech is turned into text on your phone to check your Spanish."
- **While Apple Music plays**: starting recognition activates `playAndRecord` without
  `mixWithOthers`, which interrupts other non-mixable audio; and the mic would hear the song.
  Always pause the track first (section 7). The module never deactivates the session itself.

### 5.1 Commands, retell, alignment inputs

- Spoken commands ("otra vez", "más despacio", "no sé", "siguiente", "listo"): put them in
  `contextualStrings`; match on interim results so the app reacts before release (the
  engine's command matcher decides). Keep "hold anywhere to speak" as the only way to open the
  mic (no always-on listening).
- "Understood N of M words": align the final transcript (all alternatives) against the
  expected text in the engine; the device supplies transcript + alternatives + segments.

---

## 6. Minutes spoken, pauses, words per minute

The device layer reports one record per hold:

```ts
type Utterance = {
  holdStartMs: number; holdEndMs: number;          // touch down/up (Date.now())
  audioStartMs?: number; audioEndMs?: number;      // audiostart/audioend timestamps
  levels: { t: number; v: number }[];              // volumechange, t relative to audioStart
  transcript: string; alternatives: string[];
  segments?: { start: number; end: number; text: string }[];  // iOS: real spans; Android 14+: starts only
  locale: string; onDevice: boolean;
};
```

Voiced time (VAD on levels, same code on both platforms): frame voiced if `v > max(0.5,
noiseFloor + 2)` where `noiseFloor` = 20th percentile of the first 300 ms; join voiced runs
separated by < 250 ms (hangover); drop runs < 120 ms. `voicedMs = Σ runs`.

- **Minutes spoken** += `min(voicedMs, holdEndMs − holdStartMs)` only if the transcript has at
  least one word (target or native language, since native-language replies are part of the
  method). Holds with no recognised words count 0 (noise, coughs, music bleed). This is
  conservative and identical on both platforms. Store per day in SQLite; the headline metric
  sums it.
- **Pauses (retell lanes 60/45/30)**: iOS: gaps between consecutive segment spans ≥ 400 ms,
  cross-checked against VAD silence. Android: silent runs ≥ 400 ms from the VAD (segment start
  times only help place word labels).
- **WPM**: recognised words / (voicedMs / 60000) for fluency; also words per elapsed lane time
  for the retell target.
- Sing-back (B4): learner pitch needs audio samples; the recognizer does not stream them, but
  `recordingOptions.persist` writes a WAV (iOS; Android 13+). Compute a pitch track (YIN) in JS
  from the file after the line (expo-file-system `FileHandle.readBytes`), or later in the local
  module for live display. Singer pitch from Apple Music audio is impossible (brief).

---

## 7. Audio session interplay (iOS; Android notes at the end)

Actors: MusicKit `ApplicationMusicPlayer` (via `@lomray/react-native-apple-music` 1.4.0, which
also offers `Player.configurePlayer(mixWithOthers)`, which sets `.playback` with
`[.mixWithOthers, .duckOthers]` or plain `.playback` and activates the session), AVSpeechSynthesizer (expo-speech, in the
app session), the recognizer (expo-speech-recognition, sets `playAndRecord` on every start,
default mode `measurement`), and expo-audio if used for effects or rendered speech.

One **AudioCoordinator** in JS owns all of it:

- **Story tab session**: set the category once when the Story screen gains focus:
  `playAndRecord`, options `defaultToSpeaker` + `allowBluetoothA2DP` (good output to
  headphones; built-in mic), mode `default` (not `measurement`, which lowers speaker output and
  disables processing). Pass the same `iosCategory` to every recognition `start()` so starting
  the mic causes no category change or route glitch. Add `allowBluetooth` (HFP) only if the
  user picks "use my headset mic" (HFP drops output to call quality). If another app's music is
  playing when Story starts, offer "mix" (`mixWithOthers` + `duckOthers`) or "pause it"; when
  leaving Story call `setAudioSessionActiveIOS(false, { notifyOthersOnDeactivation: true })` so
  the other app may resume.
- **Music tab, lyric cliff** (track paused at the line):
  1. `Player.pause()` and wait for state `paused` (playback-state event; the library emits
     playback time only once per second, so poll `Player.getCurrentState()` for a precise stop
     point if lines are timed later).
  2. TTS prompt if any (speech in the app session).
  3. Hold-to-speak recognition (category `playAndRecord`).
  4. On release: score, show result.
  5. Restore `.playback` (`Player.configurePlayer(false)`) and `Player.play()` explicitly.
     Never rely on interruption-ended auto-resume.
  Do not record while the track plays: activating `playAndRecord` may interrupt
  ApplicationMusicPlayer (forum reports that application music players trigger session
  interruptions; behaviour with MusicKit's player on iOS 18/26 is a device check), and the mic
  would pick up the song.
- **Sing the line back (B4)**: same sequence: pause, sing, resume. Singing along with the track
  playing would need headphones and gives poor recognition; leave it out of v1.
- **Ducking instead of pausing**: only for short UI sounds over music (`duckOthers` via
  expo-audio `interruptionMode: 'duckOthers'`). Ducking ApplicationMusicPlayer from the same
  app is not a documented pattern; device check before using.
- **Interruptions** (calls, Siri, alarms): the recognizer emits error `interrupted`; TTS stops;
  the coordinator returns to an idle state and asks the learner to tap to continue.
- **Background**: no background audio mode is needed (Music playback continues in the system
  player if the app uses `.playback`; Story pauses when backgrounded). Do not add
  `UIBackgroundModes: audio` unless music must keep playing in background with the lyric screen
  closed (Apple Music handles that itself).
- **Android**: there is no Apple Music playback in this stack (the MusicKit library is iOS-only);
  the Android Music tab is share-in + pasted lyrics. Android audio focus: expo-speech does not set
  AudioAttributes or request focus; the recognition service usually requests transient focus
  (other apps pause or duck). Device check on a Pixel and a Samsung.

---

## 8. Risks

- RN 0.88.1 + llama.rn rc.11: the iOS `install` path (`RCTBridge.currentBridge`,
  bridge-proxy `runtime`/`jsCallInvoker`) and codegen were typed against RN ≤ 0.82; if the
  bridge proxy changed in 0.88, `RNLlama.install()` resolves false and nothing loads. First dev
  build must check this before anything else.
- The patch reads and writes `llama_rn_context_completion::embd` and `n_past` (internal
  fields). Safe for rc.11 (headers identical in framework and package); any upgrade must re-run
  the check script and the self-test, because a struct change would corrupt memory silently on
  iOS (prebuilt binary + source glue).
- Do not enable speculative decoding/MTP or parallel mode on the scoring context: the patch
  refuses parallel mode and assumes no shared draft KV.
- Android build time: from-source llama.cpp for every variant (rc.11 forces it) can push EAS
  builds past 45–60 minutes; narrow `rnllamaVariants` and ABIs; use a larger EAS resource
  class if needed.
- 4 GB devices: jetsam/LMK kills during load or long contexts; needs the memory tier settings
  and a graceful "model unloaded, reloading" path.
- iOS Metal requires A14+ (iPhone 12). Older devices run CPU and may hit the q4_K repack SIGILL
  unless `no_extra_bufts: true`.
- Generation and scoring prompts share no prefix: each switch re-evaluates the story context
  (seconds on Android). Group work per step; consider reordering prompts.
- `cliffPositions` with full next-word search is about 50 model calls per position: seconds
  per position even with the patch; analyse few positions, precompute during TTS.
- iOS recognition one-minute limit vs 60 s retell; segment times restart per task.
- iOS 18+ may lack good compact Spanish voices; Eloquence fallback sounds robotic.
- Android TTS `language` bug: passing a regional tag speaks English unless `voice` is set.
- Android word timings are starts only (API 34+, on-device Google service only).
- Android on-device recognition needs a downloaded model; network fallback sends audio to
  Google (privacy disclosure).
- ApplicationMusicPlayer vs the app's `playAndRecord` session is undocumented; explicit
  pause/resume is the only safe path.
- Hugging Face URL/CDN changes or rate limits: mirror the file; the pinned commit plus hash
  protects integrity.
- No API in expo-file-system for backup exclusion: a local native module is required (small).
- Qwen3-0.6B fallback is uncalibrated until the proof runs on it.

## 9. Unknowns (cannot be verified in this container)

- Whether `RNLlama.install()` works on RN 0.88.1 New Architecture (needs a dev build).
- Runtime correctness of `llamaScoreText` on device (numbers vs proof, KV reuse, Metal); it
  compiles and links symbol-wise, nothing has executed it.
- Speeds and memory on real phones (bench on a dev build).
- Whether ggml-metal survives an app backgrounding mid-op.
- Which iOS 18/26 Spanish TTS voices exist on device; Android voice lists per OEM engine.
- Which Spanish locales support on-device recognition on iOS; whether on-device tasks escape the
  one-minute limit; whether iOS masks profanity.
- Whether Android delivers RMS levels in continuous (EXTRA_AUDIO_SOURCE) mode.
- MusicKit ApplicationMusicPlayer behaviour when the app activates `playAndRecord`.
- EAS Android build duration with from-source llama.rn.

## 10. Sources

Package sources read (npm pack, extracted under `/tmp/claude-0/pkgs/`): llama.rn 0.13.0-rc.11
(`cpp/jsi/*`, `cpp/rn-*.h|cpp`, `vendor/llama.cpp/include/llama.h`, `common/common.h`,
`src/llama-vocab.cpp`, `src/llama-context.cpp`, `llama-rn.podspec`, `android/*`,
`src/expo-plugin/withLlamaRN.ts`, `src/index.ts`, `src/types.ts`, README), its iOS release
artifact (`llvm-nm`, headers, Info.plist), react-native 0.88.1 (`ReactCommon/jsi`,
`gradle/libs.versions.toml`), expo-template-bare-minimum 58.0.34 (Podfile), expo-speech 58.0.4,
expo-speech-recognition 58.0.1, expo-file-system 58.0.13, expo-network 58.0.5, expo-audio
58.0.12, @lomray/react-native-apple-music 1.4.0, react-native-tts 4.1.1; Hugging Face API and
GGUF header for unsloth/Qwen3-1.7B-GGUF and Qwen3-0.6B-GGUF; Qwen/Qwen3-1.7B config.json.

Web:
- Apple, SFSpeechRecognizer: https://developer.apple.com/documentation/speech/sfspeechrecognizer
- Apple forums, on-device and the one-minute limit: https://developer.apple.com/forums/thread/725849
- Apple QA1951, request limits: https://developer.apple.com/library/content/qa/qa1951/_index.html
- SpeechAnalyzer (iOS 26) overview: https://antongubarenko.substack.com/p/ios-26-speechanalyzer-guide
- WWDC19 session 256 (on-device recognition, languages): https://developer.apple.com/videos/play/wwdc2019/256
- Apple forums, supportsOnDeviceRecognition and model download: https://developer.apple.com/forums/thread/731230
- Apple forums, iOS 18 Spanish voices missing on device: https://developer.apple.com/forums/thread/764438
- AVSpeechSynthesisVoice: https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice
- App size and cellular limit guide: https://newly.app/guides/ios-app-size-limit-cellular
- App thinning and size limits: https://newly.app/guides/app-thinning-and-size-limits
- Google Play size limits: https://support.google.com/googleplay/android-developer/answer/9859372
- Play Asset Delivery: https://developer.android.com/guide/playcore/asset-delivery
- Open Radar, applicationMusicPlayer triggers AVAudioSession interruption: https://openradar.appspot.com/28431676
- Apple, handling audio interruptions: https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions
