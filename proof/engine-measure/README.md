# Engine against the real model: measurement scripts

The scripts behind `proof/ENGINE_REAL_MODEL.md`. They run the engine's public functions
against Qwen3-1.7B Q4_K_M served by `proof/model_server.py` (see
`engine/scripts/real-model.md` to start it) and write JSON to `results/`.

- `measure.ts`: judge on the 93 proof pairs, street register, heat, cliff credit, generation,
  timing and the top-N bounded runs. Run with `npx tsx proof/engine-measure/measure.ts` from
  `engine/` with `CLIFFWORD_MODEL_URL=http://127.0.0.1:8765`.
- `analyze.py`: turns `results/*.json` into the tables in `proof/ENGINE_REAL_MODEL.md`.
- `results/`: the raw results of the run reported there (2026-11-15).

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

