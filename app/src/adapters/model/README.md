# The model adapter

`ModelAdapter` (`types.ts`) is the engine's `LanguageModel` plus a lifecycle. There are three
implementations:

- **`LlamaModelAdapter`**: Qwen3-1.7B Q4_K_M on the device, through llama.rn. iOS and Android use
  it, built by `createDeviceModel.ts`.
- **`MockModelAdapter`**: the engine's n-gram mock. Web and tests use it, and so does
  `createDeviceModel.web.ts`.
- **The HTTP model**: the engine's `HttpLanguageModel` over `proof/model_server.py`, used only by
  the engine's real-model tests.

## Files

| File | What |
|---|---|
| `LlamaModelAdapter.ts` | The adapter: load settings, the call queue, scoring, generation. |
| `byteTokens.ts` | Native byte ranges to `TokenScore`s with UTF-16 offsets; split characters are merged. |
| `forcedDecoding.ts` | The fallback scorer, which uses llama.rn's completion API. |
| `llamaRuntime.ts` | The part of llama.rn the adapter uses, as structural types. The adapter never imports llama.rn. |
| `createDeviceModel.ts` / `.web.ts` | The only importer of llama.rn, and its web twin, which returns the mock. |
| `keepModelLoaded.ts` | Loads the model when `ModelManager` has the file verified and unloads it when the file goes. `modelAvailability()` tells the UI the state, `'missing'` included. |
| `../../testing/fakeLlamaRn.ts`, `../../../__mocks__/llama.rn.ts` | A llama.rn fake over the engine's mock, used by every Jest test. |

## Load settings (Qwen3-1.7B on a phone)

`initLlama` gets these settings. `initParams()` returns them, and a test pins them.

| Setting | Value | Why |
|---|---|---|
| `n_ctx` | 2048 | A story passage plus a sentence fits. The KV cache is about 230 MB (f16). |
| `n_batch`, `n_ubatch` | 512 | A whole scoring request is one decode. |
| `n_parallel` | 1 | One sequence, so it gets the whole window. llama.rn splits the KV cache between sequences. |
| `n_gpu_layers` | iOS 99 (all 28 layers on Metal), Android 0 | llama.rn falls back to the CPU where Metal is missing (simulator). Android stays on the CPU, and `app.json` turns off llama.rn's OpenCL/Hexagon library variant. |
| `n_threads` | Android 4, iOS llama.rn's default | Android: llama.rn pins the threads to the 4 fastest cores. iOS: the GPU does the work. |
| `use_mlock` / `use_mmap` | false / true | The file is mapped, not locked. |
| `no_extra_bufts` | iOS true, Android false | iOS: no CPU weight repacking. With every layer on Metal it changes nothing. Where Metal is missing (simulator), it keeps llama.cpp off its repacked q4_K CPU kernels, which `docs/OUTLINE.md` 3.1 reports crash (SIGILL) with the prebuilt framework. |
| `flash_attn_type` | `'off'` | With it on, llama.cpp's CPU backend moved sentence scores by up to 1.08 nats from the proof's numbers (`native-tests/scoring/README.md`). With it off they are identical. |

The app needs about 1.2 GB. iOS gets `com.apple.developer.kernel.increased-memory-limit` in every
build from `app.json` (`ios.entitlements`). llama.rn's config plugin adds it, plus
`extended-virtual-addressing`, for the `production` EAS profile.

## Scoring: the native method (the llama.rn patch)

llama.rn 0.13.0-rc.11 reports top-N probabilities only for tokens it generates. It has no call
that scores a supplied text (`docs/BRIEF.md`, "Not done yet"). `patches/llama.rn+0.13.0-rc.11.patch`
adds two calls. patch-package applies the patch from `"postinstall": "patch-package"` in
`package.json`.

- **`LlamaContext.scoreText(contextText, text)`** returns
  `{ tokens: [{ id, byte_start, byte_end, logprob }], prefix_tokens, reused_tokens, evaluated_tokens }`.
  It scores one sequence: the start token, then the context tokens, then the text tokens. The
  start token is BOS when the model adds one, else the end-of-text token, `<|im_end|>` (151645)
  for Qwen3. The context and the text are tokenized separately, with no special tokens and no
  BOS. Every text position gets logits, and the log-softmax over the raw logits is computed in
  double. Byte offsets index the UTF-8 of `text`. This is exactly `proof/model_server.py`.
- **`LlamaContext.nextTokens(contextText, k)`** returns the k most likely next tokens after the
  start token plus the context (raw softmax) as `{ id, text, logprob }`. Control tokens and pieces
  that are only part of a character are skipped and do not count towards k.
- **`isTextScoringAvailable()`** is false in a binary built without the patch.

What the patch changes:

- **`cpp/jsi/CliffwordScore.{h,cpp}`** (new): the computation. It uses llama.cpp's C API only, so
  it builds and is tested on Linux (`native-tests/scoring/`).
  - It evaluates in chunks of `min(n_batch, n_ubatch)` and never leaves a one-token last chunk.
  - It keeps the KV cache of the longest clean prefix shared with its previous evaluation. So
    scoring six variants after one story context evaluates the context once, and the numbers are
    the same as from a fresh evaluation.
- **`cpp/jsi/RNLlamaJSI.cpp`**: the JSI functions `llamaCliffwordScoreText` and
  `llamaCliffwordNextTokens`. They follow llama.rn's pattern:
  - `createPromiseTask`: the thread pool, the promise resolved on the JS thread, task tracking
    for `release`;
  - `getContextOrThrow`;
  - a `ContextClaim` for the whole call, the same exclusive flag that completion, embedding and
    decide take. A call that overlaps another fails with "Context is busy". It never runs
    alongside a completion.

  They share seq 0 with llama.rn's completion, keeping its prompt cache (`completion->embd` and
  `n_past`) correct:
  - a call reuses its own previous evaluation only while `embd`/`n_past` still hold exactly what
    it left there;
  - otherwise it first calls `clearCache(false)`, which clears the memory and resets `embd`,
    `n_past` and the state checkpoints;
  - afterwards it records its tokens in `embd`/`n_past`, so the next completion keeps the shared
    prefix or drops it;
  - after a failure it clears the cache.

  Parallel mode is refused.
- **`android/src/main/CMakeLists.txt`**: compiles `CliffwordScore.cpp` into the JNI library. iOS
  compiles `cpp/jsi/**` from source already.
- **`src/`** (index, jsi, types) and **`lib/`** (commonjs, module, typescript): the optional
  bindings, the two methods and the types. Their absence never breaks llama.rn's own API: missing
  bindings do not throw, and the methods reject.

The patch only calls symbols that llama.rn's prebuilt libraries export.
`native-tests/scoring/check-symbols.sh` checks that.

### After a llama.rn upgrade

1. Install the new version with `npx expo install llama.rn@<version>`. If the old patch no longer
   applies, patch-package says so at postinstall.
2. Port the changes into `node_modules/llama.rn`. The new files are copied; the hunks in
   `RNLlamaJSI.cpp`, `CMakeLists.txt`, `src/` and `lib/` are re-applied by hand. Every hunk is
   marked "Cliffword".
3. Run `npm run patch:llama.rn`. It runs `patch-package llama.rn` with an `--exclude` for
   `package.json` and the downloaded native artifacts (`ios/rnllama.xcframework`,
   `android/src/main/jniLibs`), which must never go into the patch. Delete the old patch file.
4. Run the checks in `native-tests/scoring/README.md`: `build.sh`, `compare.py`,
   `check-symbols.sh` and `syntax-check.sh`.
5. Run `npm run typecheck && npm test`, then an EAS build.

## Scoring: the forced-decoding fallback

The adapter uses the native method when the context has `scoreText`/`nextTokens` and
`isTextScoringAvailable()` is true. Otherwise it uses `forcedDecoding.ts`, for example on a dev
client built before the patch. `info.scoring` says which path is active: `'native'` or
`'forced-decoding'`.

How the fallback scores:

- **`scoreContinuation`**: the adapter tokenizes the text with llama.rn and groups the tokens at
  character boundaries (with `detokenize`). For each group it runs a one-token completion of
  `startText + context + text so far` with `n_probs` 50, `post_sampling_probs: false` (raw
  softmax), greedy, and `ignore_eos`.
  - A token in the list gets its exact logprob.
  - A token outside the list gets the smallest listed logprob with `upperBound: true`, the rule of
    the engine's `TopNBoundedModel`.
  - A character split into byte tokens keeps its first token's value as an upper bound.
- **`nextTokens`**: one completion with `n_probs` k + 16. Pieces that are part of a character and
  control tokens are skipped.
- **Numbers**: they can differ a little from the native ones. Each token is evaluated as a
  one-token batch, and the prompt string is tokenized as a whole.

## Generation

Generation is a plain continuation of the start token plus the prompt. There is no chat template,
as in the engine's mock and `model_server.py`.

- **Sampler**: llama.cpp's defaults, written out so that a GGUF's own `general.sampling.*` values
  cannot change them: top-k 40, top-p 0.95, min-p 0.05, then temperature. Penalties, DRY, XTC and
  mirostat are off.
- **Seeds**: completion i uses seed + i, and the n completions run one after another.
- **Text**: llama.rn returns only the generated text. It is cut before the first stop string, and
  Qwen3 `<think>` blocks are stripped as a precaution.

## Calls, unload, errors

- **Queue.** Calls run one at a time, in order.
- **Not ready.** A call rejects with `ModelNotReadyError` unless the status is `'ready'`.
- **unload() or a new load()** takes effect at once:
  - the status changes;
  - queued calls reject;
  - a running completion is stopped (`stopCompletion`);
  - fallback scoring stops between steps;
  - a running call's result is dropped (it rejects with `ModelNotReadyError`);
  - the context is released once that call settles.
- **Overtaken load.** A `load()` overtaken by `unload()` rejects with `ModelLoadCancelledError`
  and releases what it loaded.
- **Failed load.** The status becomes `'error'` and `lastError` says why. `keepModelLoaded` does
  not retry on its own; `retry()` loads again, and so does the next verified file.

## Tests

- `byteTokens.test.ts`: the offset conversion with accents, ñ, emoji and leading spaces, merging
  of split UTF-8 tokens, and errors. It also runs real Qwen3 output of the native core
  (`__fixtures__/qwen3-native-scores.json`, written by `native-tests/scoring/compare.py`) against
  `model_server.py`'s answers and the engine's `checkTokenScores`.
- `LlamaModelAdapter.test.ts`, against the llama.rn fake:
  - the load settings, the lifecycle and the `ModelNotReadyError` contract;
  - native scoring and the fallback, compared with `TopNBoundedModel`, with its upper bounds;
  - generation, serialization, and unload during a call;
  - the engine's `runLanguageModelContract`, for both scoring paths. The vitest suite runs in Jest
    through a small shim.
- `keepModelLoaded.test.ts` and `createDeviceModel.test.ts`: the auto-loader, the availability
  states, the web twin, and `createNativeServices` loading the model once the file is verified.
