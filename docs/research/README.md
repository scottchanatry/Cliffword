# Research notes behind docs/OUTLINE.md

Written while drafting the build outline (2026-11-15). docs/OUTLINE.md section 1.3 records
where the outline overrode these notes; the outline wins where they differ. Paths under
`/tmp/claude-0/...` in these notes point to the session scratchpad of the session that
wrote them and no longer exist; the files they name are copied here.

| File | What |
|---|---|
| `app-architecture.md` | App layout, routing, storage, testing, web preview |
| `device-speech.md` | llama.rn and the scoring patch, model download, speech in and out, audio session |
| `music-share-store.md` | Apple Music (MusicKit), Spotify share-in, lyrics, store listing, privacy, age rating |
| `llama-score/JSIScore.h` | Reference implementation of the `llamaScoreText` JSI host function |
| `llama-score/llama.rn+0.13.0-rc.11.patch` | Reference patch-package patch adding it to llama.rn (the app's own patch lives in `app/patches/`) |
| `llama-score/check-llamarn-patch.sh` | Compile and symbol checks used on the reference patch |
