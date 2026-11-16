# Engine against the real model: measurement scripts

The scripts behind `proof/ENGINE_REAL_MODEL.md`. They run the engine's public functions
against Qwen3-1.7B Q4_K_M served by `proof/model_server.py` (see
`engine/scripts/real-model.md` to start it) and write JSON to `results/`.

- `measure.ts`: judge on the 93 proof pairs, street register, heat, cliff credit, generation,
  timing and the top-N bounded runs. Run with `npx tsx proof/engine-measure/measure.ts` from
  `engine/` with `CLIFFWORD_MODEL_URL=http://127.0.0.1:8765`.
- `analyze.py`: turns `results/*.json` into the tables in `proof/ENGINE_REAL_MODEL.md`.
- `coverage.ts`: correction coverage on the proof pairs and street sentences and on the
  held-out sets (`proof/pairs_holdout.jsonl`, `proof/slang_holdout.jsonl`, and the blind
  `proof/pairs_holdout2.jsonl`, `proof/slang_holdout2.jsonl`): verdicts, exact-fix rate,
  fix generated, right rule, false asserts and hints, street asserts, variants on slang
  words and slang words shaded. From `engine/`:
  `CLIFFWORD_MODEL_URL=http://127.0.0.1:8765 npx vite-node ../proof/engine-measure/coverage.ts -- <label> [sets] [--offline]`.
  Writes `results/coverage-<label>.json`.
- `summarize.py`: prints the tables of one or more `coverage-<label>.json` files
  (`python3 summarize.py before after`), as in the "Correction coverage and slang data"
  section of `proof/ENGINE_REAL_MODEL.md`.
- `results/`: the raw results of the runs reported there (2026-11-15; coverage-*.json
  2026-11-16).

Story generation at every level (2026-11-16, see the dated section of
`proof/ENGINE_REAL_MODEL.md`). Run from `engine/` with
`CLIFFWORD_MODEL_URL=http://127.0.0.1:<port>`:

- `learners.ts`: the simulated learners (brand new, early, intermediate reader with weak
  speaking, advanced, heritage speaker) and their story openings.
- `prompt-explore.ts`: prompt formats compared on the real model
  (`npx vite-node ../proof/engine-measure/prompt-explore.ts <formats> <seeds> <n> <profiles> <label>`);
  results in `results/prompt-explore*.json`.
- `generation.ts`: eight next sentences in a row per simulated learner, before (the
  engine of an earlier commit, extracted with `git archive <commit> engine/src | tar -x -C <dir>`
  and named by `CLIFFWORD_ENGINE_BEFORE=<dir>/engine/src`) and after
  (`npx vite-node ../proof/engine-measure/generation.ts <before|after> <profiles> <steps> <seedBase> <label>`);
  results in `results/generation-*.json`.
- `session-prefetch.ts`: `StorySession.prefetch` on the real model, next() with and
  without a prefetch; results in `results/session-prefetch-*.json`.


Answer speed, lemma credit and session robustness (2026-11-16, see the dated section of
`proof/ENGINE_REAL_MODEL.md`). Run from `engine/`; "before" runs import the engine named
by `CLIFFWORD_ENGINE_BEFORE` (the working tree with this round's files restored from
commit 20ca71a):

- `session-calls.ts`: a counting wrapper between a StorySession / LyricSession and the
  model books every call and its time under the step being run (next, answer per kind,
  learner turn, retell, lyric next and answer, echo), on the mock or the real model;
  every step's result is hashed so before and after runs compare step by step
  (`npx vite-node ../proof/engine-measure/session-calls.ts -- <before|after> <mock|real> [sentences] [label]`);
  results in `results/session-calls-*.json`.
- `credit-lemma.ts`: scoreCliffAnswer on the six cliff sets of section 4 and a
  supplementary lemma-credit set (pronominal and clitic forms, natural and wrong),
  with a sweep of lemmaWeight and partialFloor over the same alternatives
  (`npx vite-node ../proof/engine-measure/credit-lemma.ts -- <before|after> [label]`);
  results in `results/credit-lemma-*.json`; `credit-summary.py before after` prints the
  tables and checks that the after engine with lemma credit off equals the before one.
- `bench.ts`: micro-benchmark of the engine's own hot paths with the mock model and an
  instant model (lexicon lookups, variants, scoreWords, slang matching, sentence views,
  learner-wide work, parseLyrics, whole session steps)
  (`npx vite-node ../proof/engine-measure/bench.ts -- <before|after> [label] [rounds]`);
  results in `results/bench-*.json`.

Engine round 3 review (2026-11-16, see "Engine round 3: review and summary" in
`proof/ENGINE_REAL_MODEL.md`). Run from `engine/` with
`CLIFFWORD_MODEL_URL=http://127.0.0.1:<port>`:

- The three real-model suites in full: `npm run test:real`,
  `npx vitest run test/real-engine.test.ts`, `npx vitest run test/real-coverage.test.ts`;
  logs in `results/review-real-model.log`, `results/review-real-engine.log`,
  `results/review-real-coverage.log`, and the generation tests again after the review's
  fixes in `results/review-real-generation-after-fixes.log`.
- `generation.ts` takes `CLIFFWORD_SELECT` (JSON selection options) for "after" runs, so
  one setting is measured against another on the same engine and seeds:
  `CLIFFWORD_SELECT='{"sameOpeningNeedsVerb":false}' npx vite-node ../proof/engine-measure/generation.ts after early,reader,advanced 8 1 review-opening-before`
  and the same without the variable and with the label `review-opening-after`; results in
  `results/generation-review-opening-*.json`, tables with
  `python3 generation_table.py review-opening-before review-opening-after`.
