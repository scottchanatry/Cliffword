# Cliffword

Learn Spanish by finishing the sentence out loud. A story stops mid-sentence (the cliff), you say
what comes next, and a small language model running on your phone (Qwen3-1.7B) scores how
natural your answer is. Your own sentences are shaded where they surprise a Spanish speaker, and
corrections come from rule-made variants compared by the model. The headline number is minutes
spoken. Songs work the same way: paste lyrics, finish the line, sing it back, learn the slang.

Everything runs on the device: no account, no server, no analytics.

## Repository

| Path | What |
|---|---|
| `docs/BRIEF.md` | Product decisions. Start here. |
| `docs/OUTLINE.md` | Architecture, interfaces, schema, screens and the staged build plan |
| `proof/` | Step 1 proof test (`RESULTS.md`) and the engine measured on the real model (`ENGINE_REAL_MODEL.md`) |
| `engine/` | The language-neutral core in plain TypeScript: scoring, corrections, learner model, story generation, speaking, lyrics and the session state machines. See `engine/README.md`. |
| `app/` | The Expo (SDK 58) React Native app for iOS and Android. See `app/README.md`. |
| `docs/STORE.md`, `docs/PRIVACY.md`, `docs/RELEASE.md`, `docs/DEVICE-CHECKLIST.md` | App Store and Google Play listings, privacy policy, release steps, on-device test checklist |
| `docs/site/` | The pages published at https://scottchanatry.com/cliffword/ (privacy, support) |

## Run the tests

```bash
cd engine && npm ci && npx tsc --noEmit && npx vitest run
cd app && npm ci && npm run typecheck && npx jest && npm run lint
```

The engine's real-model suites need the model server (`engine/scripts/real-model.md`).

## Preview and build

- Web preview (stand-in model): `cd app && npx expo export --platform web` and serve the output,
  or `npm run web`.
- Phone builds go through EAS (project `@greypebs/cliffword`): `cd app && npx eas-cli build -p
  android --profile preview` (APK) or `--profile production` (Play bundle);
  `-p ios --profile preview-simulator`. iPhone device and App Store builds need the Apple
  Developer account steps in `docs/RELEASE.md`.
