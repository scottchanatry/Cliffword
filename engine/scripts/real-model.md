# Running the engine against a real model

The engine talks to models only through `LanguageModel` (`src/model/types.ts`). For tests
it normally uses the n-gram mock. This page shows how to run it against the model the app
will ship, Qwen3-1.7B Q4_K_M, through llama.cpp on this machine's CPU.

| Part | File | Role |
|---|---|---|
| Server | `proof/model_server.py` | Loads a GGUF with llama-cpp-python and serves `/score`, `/next`, `/generate` and `/health`. It scores the way `proof/score.py` did. |
| Client | `src/model/http.ts` | `HttpLanguageModel`, a `LanguageModel` over HTTP. It checks every answer against the contract. |
| Device limit | `src/model/topN.ts` | `TopNBoundedModel` wraps any model and reports a token's logprob only if the token is in the top N; otherwise it reports an upper bound. This is what llama.rn forced decoding gives. |
| Contract | `src/model/contract.ts` | `runLanguageModelContract(name, makeModel, { cases })` registers the contract tests for any adapter. |
| Tests | `test/real-model.test.ts` | Contract, parity with the proof, accuracy on the 93 pairs, an end-to-end judgement, timings. |

## 1. Requirements

- Python 3 with `llama-cpp-python` (CPU build; the proof used 0.3.37) and `numpy`. In this
  container they are already in a venv at `/tmp/claude-0/venv`.
- The GGUF file, kept outside the repository: `unsloth/Qwen3-1.7B-GGUF`,
  `Qwen3-1.7B-Q4_K_M.gguf` (1.1 GB). Here it is at `/home/user/models/`.
- About 2.5 GB of RAM for the 1.7B model at `--ctx 2048`: 1.1 GB of weights plus 1.2 GB
  of logits, because llama.cpp keeps a row of 151,936 logits for every context position.
  The 4B model needs about 4 GB. On a small machine, run one server at a time.

## 2. Start the server

```bash
cd proof
/tmp/claude-0/venv/bin/python model_server.py \
  --model /home/user/models/Qwen3-1.7B-Q4_K_M.gguf --port 8765 --threads 4 --ctx 2048 &
# wait for the line "listening on 8765"
curl -s localhost:8765/health
```

`--ctx` is the most tokens one request can use (start token, context and text together).
`--threads` should match the number of physical cores. The server handles one request at
a time.

## 3. Run the tests

```bash
cd engine
npm run test:real                                  # uses http://127.0.0.1:8765
CLIFFWORD_MODEL_URL=http://host:port npm run test:real
CLIFFWORD_REAL_TOPN=10 npm run test:real           # also measure top-10 forced decoding
CLIFFWORD_REAL_TOPN=5,10,40 npm run test:real      # several N values
```

Without `CLIFFWORD_MODEL_URL`, `test/real-model.test.ts` is skipped, so `npx vitest run`
never needs a server. `npm run test:real` sets the variable with POSIX shell syntax. On
Windows, set the variable yourself and run `npx vitest run test/real-model.test.ts`.

Results are printed as lines that start with `[real-model]`.

The tests check:

- **Contract**: `HttpLanguageModel` and `TopNBoundedModel(HttpLanguageModel)` both pass
  the same contract as the mock.
- **Parity**: totals after `Frase en español:\n` match `proof/raw_<model>.json` within
  0.05 nats. The raw file is chosen by the model name that `/health` reports. Parity is
  skipped for a model the proof did not run.
- **Accuracy**: the correct sentence wins in at least 95% of the 93 minimal pairs. The
  test also counts asserts and hints at 3 and 1 nats.
- **End to end**: `judgeSentence` asserts the ser/estar fix in "Mi hermano es enfermo
  hoy.", and `nextWords` puts "calor" first after "En la playa hacía mucho".
- **Timing**: one score, one next-token list and one generation.
- **Top-N** (only with `CLIFFWORD_REAL_TOPN`): accuracy, flag counts and the share of
  bounded tokens when scoring has to go through top-N lists.

Stop the server when you are done: `pkill -f model_server.py`.

## Using the model from code

```ts
import { HttpLanguageModel } from './src/model/http';
import { TopNBoundedModel } from './src/model/topN';
import { createDefaultSpanishPack, judgeSentence, scoringContext } from './src';

const model = new HttpLanguageModel({ baseUrl: 'http://127.0.0.1:8765' });
const pack = createDefaultSpanishPack();
const j = await judgeSentence(model, pack, scoringContext(pack, ''), 'Mi hermano es enfermo hoy.');

// The same call under the llama.rn limit (top-10 lists only):
const device = new TopNBoundedModel(model, { n: 10 });
```

`HttpLanguageModel` and `TopNBoundedModel` are not exported from `src/index.ts`. Import
them from `src/model/`.

## What the server does

- **Scoring** (`/score`) matches `proof/score.py`:
  - The start token is BOS, or `token_eos()` when the model has no BOS. For the Qwen3
    GGUFs that is `<|im_end|>` (id 151645).
  - Context and text are tokenized separately, with no special tokens.
  - The log-softmax is taken over the raw logits. There is no chat template.
  - Byte tokens that end inside a UTF-8 character are merged with the following tokens,
    and their logprobs are summed. So " ñandú" comes back as " ñ", "and", "ú", and the
    token texts concatenate exactly to the text.
  - Offsets are UTF-16 code units, which are JavaScript string indices.
- **Next tokens** (`/next`): the top k of the raw softmax. A token that is only part of a
  UTF-8 character is skipped and does not count towards k.
- **Generation** (`/generate`): completion i is sampled with seed + i, so the same request
  gives the same texts. Sampling uses llama.cpp's default chain, as llama.rn does: top-k
  40, then top-p 0.95, then min-p 0.05, then the temperature. The request can override
  `topK`, `topP` and `minP`. Generation stops at a stop string (which is cut off), at an
  end-of-generation token, or after `maxTokens`.
- **KV cache**: the cache of the longest prefix shared with the previous request is reused,
  for `/generate` prompts too (since 2026-11-16: story generation sends a target round and
  a safe round that differ only in the last line; the texts are identical with or without
  the reuse, checked on Qwen3-1.7B).
  Every evaluation covers at least two tokens. In this llama.cpp build, evaluating one
  token at a time moved single-token logprobs by up to 0.28 nats, and the total of a
  22-token sentence by 0.52 nats. Batches of 2, 3, 4, 5 or 8 tokens gave results
  bit-identical to the proof's single batch.

  A device adapter that scores by forced decoding should also feed the text as one batch,
  not one token at a time.

## Results on this machine (2026-11-15)

Qwen3-1.7B Q4_K_M on 4 CPU cores. Other jobs were sharing the machine. Timings are
from a run at load average 2, with a later run at load average 5 in brackets.

- **Parity**: the largest difference from the proof totals was 1.4e-14 nats, over all 186
  sentences.
- **Accuracy**: 90 of 93 pairs (96.8%), the same as the proof. The 3 wrong-way pairs
  are the proof's.
- **Margins**: at the 3-nat assert margin, 74 errors caught and 0 false flags. At the
  1-nat hint margin, 88 caught and 1 false flag. Both match the proof.
- **Speed**:
  - one sentence score: 108 to 118 ms (230 to 350)
  - one next-token list (k = 20): 71 ms (123)
  - generating 4 completions of 24 tokens: 5.3 s (22.6 s)
  - the whole `judgeSentence` with 5 variants: 1.0 s
  - `nextWords`: 1.8 s
  - the full `npm run test:real`: 57 s
- **Top-N forced decoding** (`CLIFFWORD_REAL_TOPN=10,40`):

  | N | accuracy | bounded tokens | asserts at 3 nats: caught / false | hints at 1 nat: caught / false |
  |---|---|---|---|---|
  | exact | 90/93 (96.8%) | 0% | 74 / 0 | 88 / 1 |
  | 40 | 82/93 (88.2%) | 15.8% | 52 / 0 | 73 / 4 |
  | 10 | 73/93 (78.5%) | 31.9% | 41 / 3 | 59 / 9 |

  With top-10 lists, a third of the tokens get only an upper bound. Accuracy drops by 18
  points, and false asserts appear. Scoring through top-N lists is not good enough for
  corrections, so the device needs a small native method that returns log-probabilities
  for a supplied text (docs/BRIEF.md, "Not done yet").
