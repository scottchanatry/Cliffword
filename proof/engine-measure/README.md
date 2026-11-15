# Engine against the real model: measurement scripts

The scripts behind `proof/ENGINE_REAL_MODEL.md`. They run the engine's public functions
against Qwen3-1.7B Q4_K_M served by `proof/model_server.py` (see
`engine/scripts/real-model.md` to start it) and write JSON to `results/`.

- `measure.ts`: judge on the 93 proof pairs, street register, heat, cliff credit, generation,
  timing and the top-N bounded runs. Run with `npx tsx proof/engine-measure/measure.ts` from
  `engine/` with `CLIFFWORD_MODEL_URL=http://127.0.0.1:8765`.
- `analyze.py`: turns `results/*.json` into the tables in `proof/ENGINE_REAL_MODEL.md`.
- `results/`: the raw results of the run reported there (2026-11-15).
