# Cliffword: build outline

Step 3 of the plan in `docs/BRIEF.md`: architecture, interfaces, and a file-by-file task list
where each task has a test that proves it done. Date: 2026-11-15. Revised the same day after
review: engine names now match the speaking and lyrics modules that landed, and the plan builds
on the app code already in `app/` (section 2.5) instead of beside it.

Inputs: `docs/BRIEF.md`, `proof/RESULTS.md`, `engine/README.md`, `engine/src/index.ts` plus
`engine/src/speaking/` and `engine/src/lyrics/` as they stand today, the app code already in
`app/` (about 100 files under `app/src`: adapters with fakes, storage, services, boot sequence,
i18n, theme, primitives), the ten design previews, and three research notes written for this
outline (device model and speech; music, share-in and store setup; app architecture and
testing). The previews, the notes and the llama.rn patch files exist only in the session
scratchpad today; Stage 0 commits them. Package versions were checked on npm on 2026-11-15.
"Verified" means it was checked in this container (package sources read, a probe run, or a host
compile). "Device" means it can only be settled on a phone.

## 1. Summary

Cliffword is two packages: the engine (plain TypeScript; scoring, corrections, learner, story,
gaps, speaking and lyrics are in the tree, and the session module is still being written) and an
Expo SDK 58 app that wraps the engine in services, controllers and screens. The app scaffold, the
device adapters with their fakes, SQLite storage, the service container and the boot sequence
already exist and pass their tests; this outline extends them. The app reaches every native
capability (language model, speech out, speech in, audio session, Apple Music, share-in, SQLite,
files) through a small TypeScript contract with a device implementation, a web-preview
implementation and a test fake. So all app logic, storage, screens and flows are tested here in
jest and in a web build with Playwright screenshots, and only native compilation and on-device
behaviour wait for an EAS build, which needs the user's approval and accounts. The model is
Qwen3-1.7B Q4_K_M, downloaded on first run (1.1 GB, pinned revision, SHA-256 checked) and run
through llama.rn 0.13.0-rc.11 plus one small native patch that adds exact scoring of a supplied
text. The build runs in nine stages. Stage 0 commits inputs that exist only in the scratchpad.
Stages 1 to 7 each end with tests that pass in this container. Stage 8 is device builds and
store submission and needs the user.

### 1.1 Decisions

1. **Stack (Expo SDK 58).** expo 58.0.25, expo-router 58.0.31, react-native 0.88.1 (New
   Architecture only), react 19.3.0, TypeScript ~6.0.3, react-native-web 0.21.4,
   expo-dev-client 58.0.20 (all already in `app/package.json`). Install every Expo-managed
   package with `npx expo install` so the SDK-pinned version is used.
2. **Model.** Qwen3-1.7B Q4_K_M from `unsloth/Qwen3-1.7B-GGUF`, pinned to commit
   `d7f544eead698dbd1f15126ef60b45a1e1933222`, 1,107,409,472 bytes, SHA-256
   `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897`, Apache-2.0 (already in
   `app/src/adapters/model/descriptor.ts`). Downloaded after the user agrees (size shown, Wi-Fi
   only by default), resumable, hash-checked, excluded from backup. Never bundled. Mirror it on
   storage the user controls before launch.
3. **Scoring context.** Start token `<|im_end|>` (id 151645), then the prefix
   `Frase en español:\n` (`LanguagePack.scoringPrefix`). Never `llama_vocab_bos()`: this GGUF has
   no BOS id and llama.cpp falls back to token 11, a comma. The proof thresholds (assert 3 nats,
   hint 1 nat) hold only with this exact start token and prefix, and only for Spanish: the model
   spec lists the target languages it was calibrated for (`calibratedFor: ['es']`), and an
   uncalibrated target never gets an asserted correction (section 2.3 B).
4. **Device adapter.** llama.rn **0.13.0-rc.11, pinned exactly**, plus
   `patches/llama.rn+0.13.0-rc.11.patch` (patch-package) that adds one JSI host function,
   `llamaScoreText`. Forced decoding is the fallback. Section 1.2 gives the reasons.
5. **Speech out.** expo-speech 58.0.4 (installed; `ExpoSpeechOut` exists). Always pass a voice
   id from `voices()` (on Android, `language: 'es-MX'` fails inside expo-speech and it speaks in
   the device locale) and the word spans from `pack.segment()`. `onWordBoundary` lights tiles
   and measures word durations.
6. **Speech in.** expo-speech-recognition **58.0.1, pinned exactly** (third-party, not in the
   SDK list). `continuous: true` started on touch and stopped on release, interim results,
   on-device recognition required by default, levels every 50 ms for the waveform and our own
   voice activity detection. Sing-back recordings are persisted as 16 kHz 16-bit PCM WAV.
7. **Minutes spoken** (the headline metric) = `creditedMs(min(voicedMs(levels), holdMs))` from
   the engine (`speaking/spokenTime.ts`: 0 under 300 ms, capped at 120 s), and 0 when the
   recognizer returned no word. Typed answers and tapped options never count. Stored per local
   day (`localDay(at, tzOffsetMin)`) in the existing `spoken_time` table; the headline and the
   streak come from `spokenStats`.
8. **Apple Music.** A local Expo module `app/modules/musickit` (Swift, iOS only, about 300
   lines) over `ApplicationMusicPlayer`, with a native `pauseAt` timer, behind the existing
   `MusicPlayer` contract. Not @lomray/react-native-apple-music 1.4.0 (legacy bridge module; its
   install fails without patch-package; one-second position events; no ISRC or explicit flag).
   Android and web have no Apple Music playback in v1, although MusicKit for Android exists
   (section 1.3, question 8): the Music tab works from shared or typed songs and pasted lyrics
   ("manual mode"), which also serves iOS users without authorization or a subscription.
9. **Spotify.** Share-in only, with expo-share-intent 9.0.0. Links are parsed locally; the app
   makes no Spotify network calls at all, and a test spies on `fetch` and `XMLHttpRequest`
   during the share flow to prove it.
10. **Lyrics** are pasted by the user and stored only in on-device SQLite. Never uploaded,
    shared or bundled. Screenshots and demos use the fictional "Luna de Santurce" by Rayo K.
11. **Storage.** The existing layer stays (`app/src/storage`, see its README): expo-sqlite
    ~58.0.17 on the device (file `cliffword.db`), sql.js 1.16 in memory for jest and the web
    preview, both behind `SqlDatabase` (`sql/types.ts`) with one serialized queue
    (`sql/serialized.ts`) so a transaction holds every other call back. Migrations are
    `{ version, name, steps }` entries checked against `PRAGMA user_version`, append-only. No
    node:sqlite and no expo-sqlite on web (it would need `wasm` in Metro's `assetExts` and
    COOP/COEP headers that static hosts do not send; sql.js needs neither, checked in headless
    Chromium).
12. **State.** The existing service container `Services` (adapters, storage handle, packs,
    clock) in one React context, the existing `AppState` (opened storage, settings, the live
    learner model) after boot, and a 20-line `Store<T>` read with `useSyncExternalStore` for
    controller output. No zustand, redux or react-query.
13. **Files and download.** expo-file-system ~58.0.13 (`DownloadTask` with background session,
    `savable()`/`fromSavable()`, `Paths.availableDiskSpace`, `File#digest('SHA-256')`, and
    `File#bytes()` to read a sing-back recording), expo-network ~58.0.5 for the cellular check,
    expo-device for the memory tier. A small local module `app/modules/cliffword-device` sets the
    iOS exclude-from-backup flag (expo-file-system has no API for it) and checks per-locale
    on-device recognition on iOS.
14. **Gestures and drawing.** react-native-gesture-handler **~3.3.0** (installed; the SDK 58
    version, npm's latest 3.5.0 does not match SDK 58 native code), react-native-reanimated
    4.7.1, react-native-worklets 0.13.0, react-native-svg 15.16.0, expo-haptics ~58.0.8
    (installed). Charts are pure layout functions drawn with Views and SVG; no chart library.
15. **Testing.** Engine: vitest (unchanged). App: jest-expo 58.0.14 with
    @testing-library/react-native 14.1.0 (its `render`, `fireEvent` and `userEvent` are async:
    always `await`), plus a second jest project with the `jest-expo/web` preset for
    `*.web.test.ts(x)`. Web preview: `expo export --platform web` plus Playwright at 390x844.
    Native config: `expo prebuild --no-install --clean` in a temporary copy, `expo-doctor`,
    `expo export --platform ios|android`.
16. **Identity and store.** Bundle id and package `app.cliffword`, scheme `cliffword`, share
    extension `app.cliffword.share-extension`, App Group `group.app.cliffword`. iOS deployment
    target 17.0 (expo-build-properties ~58.0.12), iPhone only, portrait, light theme only
    (expo-system-ui ~58.0.7 so Android honours it). `app.json` already links an EAS project
    (owner and projectId), so the project is tied to the user's Expo account; every `eas`
    command (init, credentials, device:create, build, submit) needs the user's approval.
    Privacy: "Data Not Collected" on both stores, which holds only with on-device recognition and
    no analytics or crash SDK. Age rating expected 13+ (16+ or 18+ if the shipped slang packs are
    judged frequent).
17. **Pairs.** One registry, `app/src/services/pairs.ts`. Pair ids are strings (`'en-es'`); each
    entry builds its packs and carries the little language data the engine has no field for yet
    (speech locales, lyric section words, share-text phrases, word separator). App code outside
    that entry never names Spanish or English, never splits text on spaces, and a stub
    `zh-ja` pair renders the story and chrome in a test.
18. **Not used:** npm workspaces (section 1.3), node:sqlite, react-native-tts,
    @lomray/react-native-apple-music, @wwdrew/expo-apple-music, react-native-spotify-remote and
    any `@spotify/*` package, zustand, chart libraries, expo-audio (not needed in v1; if added
    later, set `enableBackgroundPlayback: false`), the engine's n-gram mock in any device build.

### 1.2 Device adapter decision

The engine needs `LanguageModel.scoreContinuation(context, text)`: the log-probability of every
token of a supplied text. llama.rn 0.13.0-rc.11 has no such call; `completion()` reports top-N
probabilities only for tokens it generates.

**First choice: a native scoring method, `llamaScoreText`, added by a patch-package patch.**

- One batched `llama_decode` with logits for every text position, a double-precision
  log-softmax, byte-level tokens merged into whole UTF-8 characters, and offsets returned in
  UTF-16 code units (JavaScript string indices). It reuses the KV cache prefix of sequence 0 and
  then updates llama.rn's own prompt mirror, so a following `completion()` with the same prefix
  reuses it too.
- It gives **exact** log-probabilities. The engine's thresholds were measured with exact
  log-probabilities; an upper bound shifts every margin.
- It is about **10x faster** than token-by-token forced decoding (one decode instead of one per
  token). A judgement (sentence plus up to 16 variants) is about 1 to 1.5 s on an iPhone with
  Metal and 2 to 4 s on Android CPU, estimated.
- **One patch serves iOS and Android.** It adds a header-only `cpp/jsi/JSIScore.h` and one
  registration in `cpp/jsi/RNLlamaJSI.cpp`. That shared C++ glue is compiled from source on both
  platforms even when iOS links the prebuilt `rnllama.xcframework` (the podspec compiles
  `cpp/jsi/**`; Android always builds `cpp/jsi` from source), so no podspec or CMake change is
  needed.
- Verified here, by hand, from the scratchpad copies: it compiles with g++ and clang++ in C++17
  and C++20, in source mode and in iOS framework-header mode; the patch applies to a pristine
  package; every `llama_*` and `common_*` symbol it calls (including
  `common_tokenize`/`common_token_to_piece` with a vocab) is exported by the prebuilt
  xcframework (`llvm-nm -gU`); the framework's headers are byte-identical to the package's, so
  the struct it reads has the same layout. `npm run llama:check` (Stage 3) repeats every one of
  these checks from committed files only: it downloads the v0.13.0-rc.11 iOS xcframework from
  GitHub releases, checks its SHA-256 against `install/native-artifacts.json`, compiles against
  the framework's own `Headers`, and runs `llvm-nm`. It never writes to `patches/`.
- `nextTokens(context, k)` uses the same call with `next_top_k: k + 8`, dropping candidates that
  are part of a UTF-8 character.
- `global.llamaScoreText` gets a TypeScript declaration next to the binding
  (`src/adapters/model/llamaGlobals.d.ts`), since llama.rn's `jsi.d.ts` declares only its own
  globals.
- Not verified: linking in a real Xcode or Gradle build, numbers on a device, KV reuse on a
  device. A hidden self-test screen checks these on the first dev build (Stage 8): ten proof
  pairs within 0.15 nats of `proof/raw_qwen3-1.7b.json`, offsets that slice correctly for
  `¿ ¡ á ñ` and an emoji, `n_reused` on a second call, `timings.cache_n > 0` on a following
  completion, and " calor" first after "En la playa hacía mucho".

**Fallback: forced decoding through stock llama.rn.** `completion()` with a GBNF grammar that
allows exactly the text, `temperature: 0`, `n_probs: 50`, `post_sampling_probs: false`. A token
inside the top-50 list gets its exact log-probability; a token outside it gets the 50th
candidate's value with `upperBound: true`, which the engine already supports
(`TokenScore.upperBound`; `TopNBoundedModel` simulates it). The adapter picks this path by
itself when `global.llamaScoreText` is missing, for example after a llama.rn upgrade breaks the
patch, and the self-test screen shows which path is active. Its limits: about 10x slower,
greedy decoding under a grammar usually but not always follows the canonical tokenization, and
byte-split characters arrive as U+FFFD and can break offset mapping.

**Why not only the fallback:** it would make every score slower and some scores bounds rather
than values, with no gain in safety: the patch is small, version-pinned, compile-checked here,
and the fallback stays in the same adapter behind the same interface.

### 1.3 Where this outline departs from the request, the brief or a research note

- **No npm workspaces.** The request named "npm workspaces: engine/, app/". This outline keeps
  the layout already in the tree and verified end to end: two independent packages, the app
  depending on `"@cliffword/engine": "file:../engine"`, plus a scripts-only root
  `package.json`. Reasons: workspaces hoist packages, which breaks the literal
  `./node_modules/@expo-google-fonts/...` font paths in `app/app.json` and moves where
  patch-package must patch llama.rn; a peer-range mismatch can install a second React under
  `app/node_modules` ("Invalid hook call"); and the engine has zero runtime dependencies, so
  there is nothing to share. jest, tsc, `expo export` (iOS, Android, web), `expo-doctor` and
  `expo prebuild` all pass with `file:`. If workspaces are wanted later: root
  `{"private": true, "workspaces": ["engine", "app"]}`, delete both lockfiles, set the engine
  dependency to `"*"`, remove the manual `watchFolders`/`nodeModulesPaths` in Metro, resolve
  font paths with `require.resolve` in `app.config.ts`, and move `patches/` to the root.
- **Built on the existing app code, not on the research note's layout.** The app-architecture
  note proposed `src/speech`, `src/music`, `src/share`, `src/settings`, node:sqlite in jest and
  expo-sqlite (wasm, COOP/COEP) on web. The tree already has `src/adapters/<capability>/`, the
  `Services` container, sql.js for jest and web, and green tests. This outline keeps them and
  maps every earlier name onto them (section 2.5); nothing is built twice.
- **react-native-gesture-handler ~3.3.0**, not the npm-latest 3.5.0 listed in the request: SDK
  58's `bundledNativeModules.json` pins 3.3.x and the native code must match.
- **SHA-256, not MD5**, for the model check: `File#digest('SHA-256')` exists in
  expo-file-system 58.0.13 (verified). The device note assumed MD5 only.
- **Inputs not yet in the repo.** The ten design previews (`scratchpad/design/project/*.dc.html`
  plus `canvas.json`), the three research notes, the llama.rn patch, `JSIScore.h` and the patch
  check script exist only in the session scratchpad, which a reboot or cleanup clears. Stage 0
  commits them before anything else; every later row points at the repo copies.
- **B4 echo:** singer pitch cannot be read from Apple Music audio (DRM). The singer row has
  uniform tile heights; only the learner's row shows pitch, from the learner's own recording.
- **Apple Music on Android:** the brief names Apple Music without a platform limit, and MusicKit
  for Android exists. v1 ships manual mode only on Android (paste and share-in); the Apple Music
  row on Android says it is not available. Question 8 asks whether to add it later.
- **llama.rn patch in Stage 3, not Stage 7:** the adapter's real path depends on it, and
  installing llama.rn early lets `expo prebuild` and `expo-doctor` check it from Stage 3 on.
- **Engine session module pending:** the controllers are written against the engine primitives
  that exist today (section 3.12), and switch to `StorySession`/`LyricSession` when they land.

## 2. Architecture

### 2.1 Layers

```
UI            app/app/** (expo-router routes), src/features/**, src/components/**, src/ui,
              src/theme, src/i18n. Reads Store<T> values through hooks; calls controller intents.
                 |
Controllers   src/session/**: StorySessionController, LyricSessionController,
              BroughtTextController, RetellController, ListeningMachine, events table.
              Each owns one session, persists after every step.
                 |
App state     src/services (Services container, Store, pairs registry), src/appState and
and domain    src/bootstrap (storage, settings, learner after boot), src/storage (repos),
              src/learner (priors), src/music (song ids, library, lyrics version), src/layout.
                 |
Adapters      src/adapters/{clock,haptics,model,speechIn,speechOut,audio,music,share,device}:
              a types.ts contract, fakes, a web fallback and one native file per package.
                 |
Native        llama.rn + patch, expo-speech, expo-speech-recognition, expo-sqlite,
packages      expo-file-system, expo-network, expo-device, expo-localization, expo-share-intent,
              expo-haptics, expo-clipboard, app/modules/musickit (Swift),
              app/modules/cliffword-device (Swift + Kotlin).
                 |
Engine        engine/src: scoring, corrections, learner, story, gaps, speaking, lyrics, and
              (pending) session. Language pack: lang/es. Pair pack: pair/en-es.
```

| Layer | Owns | Never does |
|---|---|---|
| Engine core | Scoring, corrections, learner model, sentence selection, cliffs, gaps, command matching, transcript alignment, retell metrics, minutes-spoken log, repair and no-sé flows, native-language replies, lyric parsing, slang notes, register pairs, lyric and brought-text cliffs, echo; (pending) session state machines with snapshot/restore | Import React, React Native, Expo or app code; read the clock or randomness itself (both are passed in) |
| Language pack (`lang/es`) | Word splitting, word forms, frequency list, correction rules, slang registers, scoring prefix, spoken commands; (requested, E3) speech locales and lyric section words | Hold interface text in the native language |
| Pair pack (`pair/en-es`) | Glosses both ways, cognates, false friends, explanations, interface strings that name or quote the target language, the starter story with its placement ladder | Know about devices |
| Controllers | Turn a gesture, utterance or tap into engine calls; run model calls at the right priority; map actions to learner events (`events.ts`); write events and the session snapshot in one transaction; drive speech and audio | Render; hold display strings (screens carry `UiText` and pack data only) |
| App state and domain | Storage, settings, learner persistence and priors, pairs, song ids and summaries, layout maths | Import a screen |
| Adapters | One contract per capability; one file per native package that maps its API to the contract; fakes and web fallbacks next to it | Contain logic that a test needs (that goes into pure functions next to them) |
| UI | Routes, screens switching on `screen.kind`, components, theme, `t()` / `tUi()` | Import a native capability package (rule 1) or the engine's model code |

Rules that tests enforce:

1. Only these files import a native capability package (paths under `app/`):
   `src/adapters/model/llamaBinding.ts` (llama.rn); `src/adapters/model/expoModelFiles.ts`
   (expo-file-system, expo-network, cliffword-device); `src/adapters/speechIn/ExpoSpeechIn.ts`
   (expo-speech-recognition, cliffword-device, and expo-file-system for `readAudio`);
   `src/adapters/audio/expoAudioSession.ts` (expo-speech-recognition);
   `src/adapters/speechOut/ExpoSpeechOut.ts` (expo-speech; exists);
   `src/adapters/haptics/ExpoHapticsAdapter.ts` (expo-haptics; exists); `src/storage/open.ts`
   (expo-sqlite; exists; `sql/expoSqlite.ts` imports types only); `src/storage/open.web.ts` and
   `src/storage/sql/sqljs.ts` (sql.js; exist; never in a native bundle);
   `src/adapters/music/MusicKitPlayer.ios.ts` (musickit module);
   `src/adapters/share/ShareIntentBridge.tsx` and `app/+native-intent.tsx` (expo-share-intent);
   `src/adapters/device/deviceInfo.ts` (expo-device, expo-localization);
   `src/features/music/PasteInput.tsx` (expo-clipboard). UI libraries (expo-router, gesture
   handler, reanimated, svg, safe area, splash screen, status bar) are free to use in UI code.
   Checked by `__tests__/config/importRules.test.ts`, whose allowlist is this list.
2. No file under `app/app/` or `src/` (outside tests) imports `src/testing/**`,
   `src/storage/testing/**`, `src/services/testServices.ts` or `node:*`. Metro's blockList has
   `app/src/**/testing/**` (app sources only, so a package's own `testing/` folder is not
   blocked), `src/services/testServices.ts`, `*.test.ts(x)` and
   `engine/src/model/contract.ts`. `__tests__/importGraph.test.ts` (exists) checks what each
   platform's bundle can reach.
3. From Stage 3 on, `src/services/nativeServices.ts` and the native adapter module it imports
   (`src/services/nativeAdapters.ts`) never import `MockModelAdapter`, `createMockModel`,
   `FakeModelManager`, any `Fake*` class or the preview runtime. Before the model is loaded the
   device story runs in canned mode (section 2.3 A), never on the mock.
4. Display text from the engine arrives as `UiText { key, params }` (`engine/src/lyrics/text.ts`)
   and is resolved with `tUi()`; lookup order is `pair.ui`, then the app catalog for the native
   language, then English, then the key. Correction explanations are always
   `pair.explanations[explainKey]`, never model output.
5. Everything the learner does becomes engine `LearnerEvent`s through one pure table,
   `src/session/events.ts`, written in the same SQLite transaction (`Storage.transaction`) as
   the session snapshot. Typed answers and tapped options never produce speaking evidence or
   speaking time.
6. App code never splits or joins target-language text on whitespace (brief: "never assume
   spaces separate words"). Words come from `pack.segment()` segments with source offsets.
   `WordFlow`, echo tiles, slang underlines, typed answers, transcripts, recognizer hints and
   `SpeechOut` word spans all use those segments, and the text between two segments (possibly
   empty) is rendered exactly as in the source (`separatorAfter`). Where the engine needs a
   joiner (`nativeReply`'s `phraseSeparator`), it comes from the pair entry (`wordSeparator`).
   Checked by `__tests__/config/noSpaceSplit.test.ts` and the stub no-space pack in the word
   flow, echo and other-pair tests.
7. No accent or pronunciation score anywhere (brief): no catalog or `pair.ui` value and no
   screen type field matches `/accent|pronunciation|score %/i`. Checked by
   `__tests__/i18n/noAccentScore.test.ts`.

### 2.2 Repository layout

```
cliffword/
  package.json                 scripts only (ci, check, preview:shots); no "workspaces"
  .nvmrc                       22
  scripts/ci.sh                everything CI runs, runnable here
  docs/
    BRIEF.md  OUTLINE.md  STORE.md  PRIVACY.md  DEVICE-CHECKLIST.md
    design-previews/           the ten .dc.html previews, canvas.json, README.md (Stage 0)
    research/                  app-architecture.md, device-speech.md, music-share-store.md (Stage 0)
  proof/                       step 1 (unchanged)
  engine/                      @cliffword/engine: "main": "src/index.ts", vitest, own lockfile
  app/                         Expo 58 app, jest-expo, own lockfile
    package.json app.json app.config.ts eas.json tsconfig.json
    babel.config.js metro.config.js jest.config.js jest.setup.ts
    app/                       expo-router routes only (no other code)
    src/
      adapters/                (exists) one folder per capability: types.ts, fakes, web fallback,
                               one native file. clock/ haptics/ model/ speechIn/ speechOut/
                               music/ share/ exist; audio/ device/ are new
      services/                (exists) Services container, per-platform factories, pairs
                               registry, Store<T>
      appState/ bootstrap/     (exist) boot sequence; storage, settings and learner after boot
      storage/                 (exists) SqlDatabase, sql.js and expo-sqlite drivers, schema,
                               migrate, repos/, testing/ (jest only)
      learner/                 (exists) prior.ts: PriorSpec and buildPrior
      session/                 controllers, listening machine, events table, utterance, spoken time
      music/                   song ids, library merge, lyrics parser version, song summary
      layout/                  pure layout functions (tile width, word flow, landing line, lanes, echo)
      components/              shared domain components (words/, voice/)
      features/                screen components (story/, retell/, music/, text/, profile/, onboarding/)
      ui/  theme/  i18n/       (exist) primitives, tokens, translator
      preview/                 fixtures and web test hooks for the preview build
      testing/                 (exists) jest-only helpers (blocked from bundles)
    __tests__/                 config, docs, engine API, i18n, storage, session, route and flow tests
    e2e/                       Playwright scripts for the web preview (.cjs)
    modules/musickit/          local Expo module (iOS)
    modules/cliffword-device/  local Expo module (iOS + Android)
    native/llama-score/        JSIScore.h, the source of truth the patch is made from (Stage 0)
    plugins/                   config plugins (llama gradle properties, backup rules)
    patches/                   llama.rn+0.13.0-rc.11.patch (Stage 0)
    scripts/                   make-icons.js (exists), check-llamarn-patch.sh (Stage 0),
                               prebuild-check.sh, make-proof-fixture.cjs
    store/metadata/            App Store and Play listing text (fastlane layout)
```

### 2.3 Data flow of the main loops

Engine names below are real exports of `engine/src` (section 3.0). Names from `speaking/` and
`lyrics/` are imported from `@cliffword/engine` once E7 exports them.

**A. Story cliff loop** (screens Main, B1, B2)

1. `StorySessionController.next()` asks the story steps (`src/session/story/steps.ts`, a
   composition of engine calls until the engine `StorySession` lands) for the next step: targets
   (`chooseTargets`), settings (`deriveParams`), the next sentence (`generateNextSentence`, run
   at *prefetch* priority while the learner is still on the previous screen), two or three rated
   positions (`cliffPositions`), the cliff (`pickCliff`), the rung (`cliffRungFor`) and text or
   tile per word (`showText`, unless `settings.textMode` forces `'text'` or `'tiles'`).
2. The controller publishes a `cliff` screen: `FlowWord`s built from `pack.segment()` (each with
   its offsets and `separatorAfter`), tile widths from `estimateDurations(text, pack,
   speechRate, { msPerSyllable })` (the voice's measured value once calibrated), the cliff span
   and rung, a subtitle from the cliff length, a gloss chip for a new word, chapter meta, and a
   speech cue.
3. `SpeechOut.speak` reads the sentence up to the cliff with the chosen voice, at
   `params.speechRate × settings.speechRateScale × platform factor`, with word spans from the
   segments; `onWordBoundary` lights the current tile and feeds the voice's measured
   `msPerSyllable`. On the options rung each option is then spoken in turn and its chip lights;
   on the hint rung the hint (the first syllable) is spoken and shown. Tap a tile: hear the word
   (`tap_rehear`). Hold a tile: see it (`hold_reveal`).
4. The learner holds anywhere. On touch-down `speechIn.prepare()` warms the recognizer; after
   120 ms listening starts (`ListeningMachine`) with hints made of the command phrases
   (`pack.commands`), the cliff words, the options, and the native glosses of the cliff words.
   Interim transcripts go to `matchCommand(transcript, pack, { answer: expected })`, so a cliff
   whose answer is "ya" or "siguiente" is still an answer. A command acts at once and stops
   listening: `again` replays; `slower` multiplies `speechRateScale` by 0.8 (floor 0.5),
   persists it and replays; `dont_know` opens the no-sé flow; `next` moves to the prefetched
   sentence; `done` ends the hold or the step; `meaning` shows the gloss of the cliff answer (or
   of the line) and logs `gloss_lookup`.
5. On release, `collectUtterance` turns the `SpeechIn` events into an `Utterance` (transcript,
   alternatives, timed words, levels, hold times). Spoken time = words > 0 ?
   `creditedMs(min(voicedMs(levels), holdMs))` : 0, added to the day
   (`localDay(at, device.tzOffsetMin(at))`) and to the chapter. The engine scores the answer at
   *interactive* priority: `scoreCliffAnswer` on story lines, `scoreLyricAnswer` when the line
   holds slang (answers from the pack, not the model). `nativeReply(text, pack, pair, { at,
   expected, phraseSeparator })` runs on the transcript and on each alternative.
6. The controller publishes `landing` (the answer on the surprising-to-expected line, "About N
   times in 100", "X is just as natural"), `nativeReply` (say it in the target language, then
   repeat) or `noSe` (`startNoSe`: hear the answer, then repeat it aloud). The events of the step
   (`events.ts`) and the session snapshot are written in one transaction.
7. On `landing` the learner may hold and say the whole line (B2). That utterance is aligned with
   `alignTranscript(line, transcript, pack, { register, regions })` and the screen gains
   "Understood N of M words" (`understood`); the same happens for the repeat on `noSe` and
   `nativeReply`. Its time counts as speaking time.
8. *Siguiente* shows the prefetched next sentence.

**Canned mode, placement and the zero-knowledge path.** Until the model is loaded (absent,
downloading, paused, declined, or verified but not loaded) the story runs in **canned mode** on
`pair.starter` (engine data: `sentences`, `taught`, `probes`, `prompts`): option cliffs whose
answers are checked by listed answer, `accept` list and form match, with no model. "I'm brand new"
(`PlacementTracker.brandNew(cognateLexemeKeys(pair))`) plays the starter scene, whose words are
cognates plus the taught function words, each new word with a gloss chip. "Start the first story"
is placement: starter sentences interleaved with probes chosen by `tracker.nextBand()`. Each
probe answer calls `tracker.record(key, rank, success)`: correct answers raise the band, misses
stall it. Once the model is loaded, probes come from generated sentences whose cliff word is in
the next band (falling back to `starter.probes`). When `tracker.isDone()`, a `placementDone`
screen shows the vocabulary estimate, the learner is rebuilt with prior `{ kind: 'placement',
placement: tracker.snapshot() }` and a snapshot row carrying that prior is written, and the
placement session is closed. There is no test screen. When the starter runs out before the model
is loaded, the learner gets an `upNext` screen with real next steps (hear the scene again with
gaps, retell the scene, or try the Music tab in manual mode) and a `ModelPreparingBanner` with
progress, or a "Download the model" action if the download was declined or space was short.
That screen is never `error`. The first step after the model loads runs on the model.

**B. Learner sentence and self-repair** (screen A2)

1. A story character asks the learner something (the engine session's prompt when it lands;
   `pair.starter.prompts` until then).
2. The learner answers aloud. `attemptRepair(state, model, pack, text, at, { judge: { register,
   regions }, flow: { register, regions } })` judges it (`judgeAttempt` builds the scoring
   context with the street prefix naming the slang found, then `judgeSentence` with the
   register) and steps `repairFlow`. `scoreWords` gives the heat (street register: slang gets
   heat 0 through `slangExemption`).
3. The phase decides the screen. `ok`: no repair screen. `hinted` (a 1 to 3 nat margin): light
   heat on the word and what was expected (`repair.expected`), no fix wording and no
   explanation. `prompt_repair` (an assert, 3 nats or more): heat on the word and "One word
   surprised me. Say it again." (`repair.prompt`), no fix yet. `repaired`: the story moves on.
   `show_answer` (still asserted after one more try, or "Show me the answer" or *no sé*, which
   send `give_up`): the fix (`repair.fix`) and `pair.explanations[explainKey]`; the learner
   repeats it, and the repeat shows `understood`.
4. Events come from `repairEvents(state, pack, { register, regions })` (`spoke_error` on the
   blamed word, `spoke_correct` on the others).
5. When the model is not calibrated for the target (`!spec.calibratedFor.includes(pack.code)`),
   the controller passes `repairOn: []`, so every flag is a hint: soft shading and the expected
   sentence, never an asserted fix.

**C. Timed retell** (screen B3)

1. After a scene the session offers "Up next: retell" and the app opens `/retell` (full-screen
   modal; cannot be swiped away while running). The starter scene can be retold too.
2. `RetellController` runs `RETELL_LANES` (60, 45, 30 s); the header is `retellRoundUi(round)`
   and the countdown `laneRemainingMs(laneMs, elapsed)`. A hold starts a round; then the
   microphone stays on (latched) until the lane ends or the learner says *listo*, so the learner
   does not keep a finger down for a minute. A tap stops it.
3. On iOS, if the recognition task ends early (about the one-minute limit), the adapter restarts
   it at once and joins the transcripts, offsetting word times by the audio start timestamps.
   Android gives word start times only; the adapter sets each end to the next word's start (the
   last word ends at the end of its voiced run) and marks it estimated.
4. After each round `retellMetrics(words, { laneMs, laneStartMs })` gives words, words a minute
   and pauses (silences of at least 700 ms, the engine default); `retellProgress(rounds)` gives
   "71 → 84 words a minute" and "5 → 1 pauses". Rounds are stored in `retell_rounds`; speaking
   time goes through the same counting rule (an utterance is credited at most 120 s).

**D. Lyric cliff and sing-back** (screens A3, C1, B4, C2)

1. Pasted lyrics are parsed with `parseLyrics(raw, pack, { sectionWords })` (section words from
   the pair entry) and stored with the parser version (`src/music/lyricsVersion.ts`); the song
   page builds the lyric session with the pack, regions, register and explicit setting, shows
   slang notes (`songSlangNotes`, and `slangNotes(line, …)` for underlines) and the register
   toggle.
2. Timed mode (Apple Music authorized and the song has line times from taps or LRC):
   `MusicPlayer.play`, then `pauseAt(lineEndMs)`. The Swift timer pauses at the line and emits
   `onCliff`. `AudioCoordinator.forMic()` waits until playback is paused, then the learner holds
   and sings. Manual mode (Android, web, or no Apple Music): the learner advances line by line
   and TTS can read the line.
3. Cliffs come from `lyricCliffs(model, pack, lyrics, { register, regions })` and answers are
   scored with `scoreLyricAnswer(model, pack, cliff, answer, { register, regions })`: the
   lyric's own words and their neutral paraphrase earn credit from the lyrics and the pack, not
   from the model (the proof showed next-word lists are useless on slang lines).
4. The result shows. Playback resumes **only on a user action** (tap, *siguiente* or *otra
   vez*): `AudioCoordinator.forPlayback()` then `MusicPlayer.resume()` (App Review 4.5.2, and
   auto-resume after an interruption is unreliable). *Otra vez* seeks to `againSeekTarget`;
   *más despacio* calls `setRate` where it works, else TTS reads the line slowly.
5. Echo (B4): the track stays stopped and the subtitle says so; the learner sings the line back.
   The recognizer persists the audio as 16 kHz 16-bit WAV, `speechIn.readAudio(uri)` returns
   the bytes (and deletes the file), `readWav` and `pitchTrack` give a pitch per word from the
   learner's own voice, and `echoLine(expected, transcript, pack, { register, regions })` marks
   each tile landed, missed or substituted ("6 of 7 landed", `echo.landed`). Tapping a hollow
   tile plays that word slowly (`tap_rehear`); holding a slang tile shows its note
   ("corillo · your crew · Puerto Rico", `hold_reveal`).
6. Two registers (C2): `registerPairs(line, pack, regions)` gives the neutral and street lines
   and the swaps. A friend's line is the prompt ("Your friend texts ¿Vienes esta noche?"); the
   learner picks "Say it street" or "Say it neutral" and answers aloud. The answer is judged in
   the chosen register (`judgeAttempt(model, pack, text, { register, regions })`) and aligned
   with the chosen line (`alignTranscript(…, { register: 'street', regions })`, so clipped forms
   count as the same words).

**E. Spotify share-in**

1. In Spotify the learner shares a song. iOS opens the Cliffword share extension; Android sends
   `ACTION_SEND text/*`. expo-share-intent stores the payload and opens
   `cliffword://dataUrl=cliffwordShareKey...`.
2. `app/+native-intent.tsx` redirects that path to `/music/share`. `ShareIntentBridge`
   (`ShareIntentProvider` plus a bridge) hands the payload to the existing `ShareInbox`
   (`MemoryShareInbox.receive`), which also writes it to the existing `share_inbox` table.
3. `parseShared` (the existing `parseSpotifyShare`, generalized) turns it into a song (Spotify
   track id, `spotify.link` short link kept as a URL, Apple Music catalog id), lyrics text, or
   "share a single song". Share-text phrases ("on Spotify", " de ") come from the pair entry. No
   network calls.
4. The confirm card shows title and artist (editable; parsing is a heuristic). On save:
   `songs.upsert`, then the paste-lyrics step, then `share.clear(id)` (which calls
   `resetShareIntent()` on the device). On iOS with Apple Music authorized the app offers a
   catalog search for "title artist" to play it here.

**F. Model download and load**

1. Onboarding's model step calls `ModelManager.plan()`: free space must exceed size + 600 MB; the
   network type decides whether cellular consent is needed. The screen states the size (1.1 GB)
   and asks before starting (App Review 4.2.3(ii)). "Not now" and "not enough space" both lead
   on: the story runs in canned mode and the Music tab in manual mode, and Settings offers the
   download later.
2. `startDownload({ allowCellular })` creates a background `DownloadTask` into
   `models/<file>.part`. Progress goes to the manager's state. Pause saves
   `DownloadTask.savable()` in `model_files.pause_state`; a switch to cellular pauses unless
   allowed. On relaunch `recover()` resumes from the saved state or the partial file, or
   restarts.
3. When complete: size check, `File#digest('SHA-256')` check, rename `.part` to `.gguf`, exclude
   the folder from backup. On a mismatch: delete, retry once, then show an error.
4. `ModelRuntime.ensureLoaded()` picks the memory tier from `expo-device` total memory, loads
   `LlamaModelAdapter` (`initLlama`), tokenizes `<|im_end|>` to get the start token, and checks
   for `global.llamaScoreText`. Status becomes `loaded { nativeScoring, gpu }`.
5. The story session leaves canned mode at the next sentence. On app background: no new model
   calls, `stopCompletion()`, await the in-flight call (no Metal work in background). On a memory
   warning: release the context and reload lazily.

**G. Brought text** (Levels: advanced learners bring articles and transcripts)

1. The Story tab's "Bring a text" entry opens `/text/paste`; the text is saved in the `texts`
   table (on the device only) and `/text/[textId]` opens it.
2. `BroughtTextController` splits it with `splitTextUnits(pack, text)`, shades surprising words
   for reading with `surpriseMap(model, pack, text, register, { regions })`, and picks
   multi-word and idiom cliffs with `broughtTextCliffs(model, pack, text, { register, regions
   })`; the cliff length follows `params.cliffWords`.
3. TTS reads up to the cliff at `params.speechRate` (about 1, native speed, for an advanced
   learner); answers are scored with `scoreLyricAnswer(model, pack, cliff, answer, { register,
   regions })` and shown on the same landing screen as the story. Events and the session
   snapshot are written in one transaction.
4. Brought text needs the model: before it is loaded, the text is saved and the screen says it
   opens once the model is ready.

### 2.4 Native boundaries and how each is faked

| Boundary | Package | App contract | Device implementation | Jest | Web preview |
|---|---|---|---|---|---|
| Language model | llama.rn 0.13.0-rc.11 + patch | `ModelAdapter` (exists) under `ModelRuntime` | `LlamaModelAdapter` over `llamaBinding` | `MockModelAdapter` (exists), `fakeBinding` (src/testing), `TopNBoundedModel` | `createPreviewModelRuntime()`: `MockModelAdapter` + `FakeModelManager('ready')`, both in `src/adapters/model` (not `src/testing`), status `loaded` |
| Model file | expo-file-system, expo-network, cliffword-device | `ModelManager` (exists, extended) over `ModelFilesPort`, `NetworkPort` | `createModelManager` + `expoModelFiles` | `FakeModelManager` (exists) for screens; `createModelManager` + `MemoryFiles` + fake network + `FakeClock` for the state machine | `FakeModelManager` already `ready` |
| Speech out | expo-speech 58.0.4 | `SpeechOut` (exists) | `ExpoSpeechOut` (exists) | `FakeSpeechOut` (exists: records calls, reports word timings on the fake clock) | `ExpoSpeechOut` (browser voices) |
| Speech in | expo-speech-recognition 58.0.1 | `SpeechIn` (exists, extended) | `ExpoSpeechIn` | `FakeSpeechIn` (exists: scripted transcripts and levels; gains alternatives and an audio fixture) | `BrowserSpeechIn` or `TypedSpeechIn` (exist); in preview mode `FakeSpeechIn` fed by `window.__cliffword.say()` |
| Audio session | expo-speech-recognition (`setCategoryIOS`, `setAudioSessionActiveIOS`) + `MusicPlayer` | `AudioCoordinator` over `AudioSessionPort` | `expoAudioSession` | fake port recording calls | no-op port |
| Apple Music | `app/modules/musickit` | `MusicPlayer` (exists, extended) | `MusicKitPlayer.ios.ts` | `FakeMusicPlayer` (exists, extended with `pauseAt`) | `UnsupportedMusicPlayer` (exists); in preview mode `FakeMusicPlayer` with the fictional song |
| Share-in | expo-share-intent 9.0.0 | `ShareInbox` (exists) | `ShareIntentBridge` → `MemoryShareInbox.receive` + `share_inbox` rows | `MemoryShareInbox` (exists) | same, plus a dev "simulate share" button |
| SQLite | expo-sqlite ~58.0.17 | `SqlDatabase` (exists) | `sql/expoSqlite.ts` through `open.ts`, file `cliffword.db` | sql.js in memory (`storage/testing/openTestStorage.ts`); the expo driver over `storage/testing/fakeExpoSqlite.ts`; both pass `storage/testing/sqlContract.ts` | sql.js in memory (`open.web.ts`) |
| Device info, lifecycle | expo-device, expo-localization, react-native `AppState` | `DeviceInfo`, `Lifecycle` | `src/adapters/device/deviceInfo.ts`, `lifecycle.ts` | fixed values, fake emitter | fixed values, page visibility |
| Haptics | expo-haptics | `Haptics` (exists: `play(kind)`) | `ExpoHapticsAdapter` (exists) | `FakeHaptics` (exists) | `ExpoHapticsAdapter` (no-op on web) |
| Clock | none | `Clock` (exists; gains `setTimeout`) | `systemClock` | `FakeClock` (exists; `advance` runs due timers) | `systemClock` |
| Backup flag, on-device check | `app/modules/cliffword-device` | inside `ModelFilesPort`, `SpeechIn.availability` | Swift / Kotlin | absent module: no-op | absent module: no-op |

`src/services/nativeServices.ts` is imported on every platform (`Services.ts` imports both
factories), so it reaches native-only adapters through `src/services/nativeAdapters.ts`, which
has a `nativeAdapters.web.ts` twin that throws if called. `__tests__/importGraph.test.ts` checks
that no native package reaches the web bundle and no sql.js reaches a native one.

### 2.5 Existing app code

About 100 files were written under `app/src` alongside this outline; tsc, jest (37 suites, 244
tests) and expo-doctor (20/20) were reported green on that tree on 2026-11-15. The plan builds on
them. Each merge is an edit to an existing file in the stage that needs it, so the suite stays
green after every stage.

| Existing path | Decision | Reason and change |
|---|---|---|
| `src/adapters/listeners.ts`, `index.ts` | keep | Shared `Listeners<T>` and barrel |
| `src/adapters/clock/*` | extend (Stage 1) | `Clock` gains `setTimeout(fn, ms): () => void`; `FakeClock.advance` runs due timers in order (the 120 ms hold, retell lanes, `pauseAt` in fakes) |
| `src/adapters/haptics/*` | keep | `play('tap')` when listening starts, `play('selection')` when it stops (replaces the earlier draft's `start`/`stop`) |
| `src/adapters/model/types.ts` | extend (Stage 3) | `ModelAdapter` stays the per-backend adapter; `ModelManager` gains `plan`, `pause`, `resume`, `recover`, status `'paused'` and `startDownload({ allowCellular })` |
| `src/adapters/model/descriptor.ts` | extend (Stage 3) | `ModelDescriptor` grows into `ModelSpec` (revision, mirrors, license, start text, `calibratedFor`) |
| `src/adapters/model/MockModelAdapter.ts`, `FakeModelManager.ts` | keep, extend | Preview and tests only; banned from `nativeServices.ts` from Stage 3 (rule 3) |
| `src/adapters/music/types.ts` | extend (Stage 3) | `pauseAt`, `clearPauseAt`, `onCliff`, `onError`, `searchCatalog`, `getSong`, `setRate?`, `play(id, { startAtMs })`; `Song` gains `isrc`, `genre`, `source`. The doc comment's @lomray adapter becomes the local musickit module (decision 8) |
| `src/adapters/music/FakeMusicPlayer.ts`, `UnsupportedMusicPlayer.ts` | extend, keep | Fake gains `pauseAt`/`onCliff`; Unsupported is the Android and web player |
| `src/adapters/share/types.ts`, `MemoryShareInbox.ts` | keep | `pending()`/`clear(id)`/`onShare` is the inbox; the bridge calls `receive` |
| `src/adapters/share/parseSpotifyShare.ts` | rename (Stage 3) to `parseShared.ts` | Generalized to Apple Music, YouTube Music and lyrics text; phrase data from the pair entry; its tests move with it |
| `src/adapters/speechIn/types.ts` | extend (Stage 3) | `FinalTranscript` gains `alternatives`, `levels`, `audioUri`, `locale`, `onDevice`; `ListenOptions` gains `persistAudio`, `latched`; `SpeechIn` gains `prepare`, `availability`, `downloadOnDevice?`, `readAudio?` |
| `src/adapters/speechIn/{BrowserSpeechIn,TypedSpeechIn,FakeSpeechIn,SpeechInBase,levels,createBrowserSpeechIn,browserTypes}.ts` | keep, extend | Fake gains scripted levels, alternatives and audio |
| `src/adapters/speechOut/*` | keep, extend | `voices.ts` gains `chooseVoice`; new `rate.ts`; `wordSpans.ts`'s Unicode-pattern fallback is for chrome only (rule 6) |
| `src/services/types.ts` (`Services`) | keep the name | The earlier draft's `AppServices` is this type. Gains `runtime`, `audio`, `device`, `lifecycle`, `pairs` |
| `src/services/Services.ts`, `appServices.ts`, `ServicesProvider.tsx`, `index.ts` | keep | `createServices`, `currentPlatform`, `getAppServices`/`setAppServices`, `useServices` are the earlier draft's registry |
| `src/services/nativeServices.ts` | extend (Stage 3) | Real adapters through `nativeAdapters.ts` (+ `.web.ts` twin) |
| `src/services/webServices.ts` | extend (Stage 3) | Preview mode (`EXPO_PUBLIC_CLIFFWORD_ENV=preview`): preview runtime, `FakeMusicPlayer` with the fictional song, `FakeSpeechIn` fed by the page |
| `src/services/testServices.ts` | keep, extend per stage | The earlier draft's `createTestServices` |
| `src/services/defaults.ts` | shrink (Stage 1) | `defaultPacks()` moves to `pairs.ts`; `sharedMockModel()` stays |
| `src/services/storageService.ts` | keep | Lazy `open()` with retry |
| `src/engine/PacksProvider.tsx` | delete (Stage 1) | Packs come from `services.packs`, built by `pairs.ts` |
| `src/storage/**` | keep the whole layer | sql.js for jest and web, expo-sqlite on device, serialized queue, `{ version, name, steps }` migrations, repos. Stage 2 appends migration v3, adds `Storage.transaction`, three repos and repo methods (section 3.8) |
| `src/storage/day.ts` | replace (Stage 2) | Day keys come from the engine's `localDay(at, tzOffsetMin)` |
| `src/storage/testing/**` | keep | Jest only; added to rule 2 and the Metro blockList |
| `src/storage/repos/settings.ts` | extend (Stage 2) | New keys (section 3.9); `speechRateBias` becomes `speechRateScale` (nothing has shipped, so the old key is simply ignored) |
| `src/storage/repos/spokenTime.ts` | extend (Stage 2) | Stores already-credited ms per day and activity; `today`/`streak` are dropped for the engine's `spokenStats` |
| `src/bootstrap/*`, `src/appState/*` | keep, extend | Boot rebuilds the prior from the snapshot's `PriorSpec` (v3) and calls `modelManager.recover()` |
| `src/learner/prior.ts` | extend (Stage 2) | `PriorSpec` and `buildPrior` |
| `src/i18n/**` | keep, extend | Add `tUi.ts`, `pseudo.ts`, `engineKeys.ts` |
| `src/theme/**`, `src/ui/**` | keep | Add `contrast.ts` |
| `src/testing/renderWithProviders.tsx`, `recordSpeechInEvents.ts` | keep | `renderWithProviders` is the earlier draft's `renderWithServices` |
| `src/features/story/StoryPassage.tsx`, `StoryPassage.test.tsx`, `sample.ts` | delete (Stage 4) | Replaced by the word components |
| `src/features/story/CliffCard.tsx`, `src/components/CliffGap.tsx` | extend; move `CliffGap` to `components/words/` (Stage 4) | |
| `src/features/music/{RegionPills,SourceRow}.tsx`, `src/features/profile/SettingsRow.tsx` | keep | |
| `src/features/profile/useProfileStats.ts` | extend (Stage 6) | Headline from `spokenStats` |
| `app/app/_layout.tsx` | extend | Keeps `AppBootstrap` and the `Stack.Protected` guards; gains `ShareIntentBridge` and lifecycle wiring |
| `app/app/onboarding.tsx`, `profile.tsx`, `(tabs)/music.tsx` | replace | Become stacks (Stages 5 and 6) |
| `__tests__/importGraph.test.ts`, `engine.test.ts`, `routes/routes.test.tsx` | keep, extend | |
| `metro.config.js` | extend (Stage 1) | blockList adds `app/src/**/testing/**`, `testServices.ts`, `*.test.ts(x)`, `engine/src/model/contract.ts`. No `wasm` asset ext and no COOP/COEP middleware |
| `jest.config.js` | extend (Stage 1) | `^@cliffword/engine/(.*)$` mapping; a second project with `jest-expo/web` |
| `package.json`, `app.json`, `eas.json` | extend | expo-haptics, expo-speech, expo-sqlite and sql.js are already installed |

Not created (files of the earlier draft that the existing code replaces): `src/storage/driver.ts`,
`expoDriver.ts`, `schema/v1.ts`, `migrations.ts`; `src/testing/nodeSqlite.ts`,
`expoSqliteOnNode.ts`, `driverContract.ts` (use `storage/testing/sqlContract.ts`);
`src/services/clock.ts`, `ids.ts` (ids come from `StorageClock.newId`), `registry.ts`,
`device.ts`, `preview.ts`, `createServices.native.ts`/`.web.ts`; `src/speech/*`;
`src/music/{types,fake,unavailable,native.ios,index}.ts`; `src/share/*`; `src/settings/*`;
`src/learner/LearnerStore.ts`; the `.nvmrc` 22.13 requirement and the ExperimentalWarning flag
(they existed only for node:sqlite).

## 3. Interfaces

All signatures below are TypeScript. App contracts are the existing files named in each heading,
with the additions this outline needs marked `// new`. Engine names are real exports of
`engine/src` as it stands today; only `engine/src/session` is still pending.

### 3.0 Engine names the app uses

**Exported from `engine/src/index.ts` today** (`import { … } from '@cliffword/engine'`):

| Area | Names |
|---|---|
| Model contract | `LanguageModel`, `TokenScore` (with `upperBound?`), `TokenCandidate`, `GenerateOptions`, `totalLogprob` |
| Language pack | `LanguagePack` (`code`, `segment`, `normalize`, `foldAccents?`, `analyze`, `frequencyList?`, `rules`, `registers`, `scoringPrefix?`, `commands?`, `splitClitics?`), `Segment`, `RegisterPack` (`scoringPrefix?` = the street prefix line), `SlangEntry`, `Register`, `SpokenCommand` (`'again' \| 'slower' \| 'dont_know' \| 'next' \| 'done' \| 'meaning'`), `SpokenCommandEntry`, `createSpanishPack`, `SPANISH_RULES`, `SPANISH_REGISTERS`, `REGION_CODES`, `REGION_NAMES`, `expandRegions`, `findSlang`, `registerFor` |
| Pair pack | `PairPack` (`gloss`, `cognates`, `nativeLexicon`, `toTarget`, `falseFriends?`, `explanations`, `ui`, `starter?`), `StarterStory`, `StarterSentence`, `StarterPrompt`, `createEnEsPairPack`, `FALSE_FRIENDS`, `falseFriend` |
| Packs | `createDefaultSpanishPack({ regions })`, `createDefaultPairPack({ regions })`, `frequencyLexemeKeys`, `cognateLexemeKeys`, `slangLexemeKeys`, `spanishRegistersFor` |
| Learner | `LearnerModel` (`apply`, `applyAll`, `pKnown`, `snapshot`, `LearnerModel.restore`), `LearnerEvent`, `LearnerSnapshot`, `LearnerView`, `PriorFn`, `Skill`, `CliffRung`, `DifficultyParams` (`sentenceWords`, `knownBand`, `newWordsPerSentence`, `speechRate`, `cliffWords`, `tileThreshold`), `deriveParams`, `estimateVocabulary`, `cliffRungFor`, `showText`, `EVENT_EVIDENCE`, `evidenceFor`, `lexemeKey`, `formKey`, `lexemeOf`, `PlacementTracker` (`record(key, rank, success)`, `nextBand`, `isDone`, `estimate`, `prior`, `snapshot`, `restore`, `brandNew`), `PlacementSnapshot`, `rankOfFromPack` |
| Scoring | `scoreWords`, `WordScore`, `Heat`, `nextWords`, `NextWord`, `cliffPositions`, `CliffPosition`, `scoreCliffAnswer`, `CliffResult`, `Credit`, `CreditReason`, `scoringContext`, `scoringPrefix`, `slangIn`, `slangExemption` |
| Corrections | `judgeSentence`, `Judgement`, `Verdict`, `ScoredVariant` |
| Story | `chooseTargets`, `generateNextSentence`, `NextSentenceResult`, `selectSentence`, `pickCliff`, `CliffPick`, `splitSentences` |
| Gaps | `findNativeGaps`, `NativeGap`, `gapEvents` |
| Test and preview only | `createMockModel`, `MockLanguageModel` |

**In the tree, exported from their own barrels but not yet from the index** (E7 adds
`export * from './speaking'` and `export * from './lyrics'`; checked here: the three barrels
together have no name collision, and `UiText` is exported once, from `lyrics/text.ts`):

| Module | Name and signature | App use |
|---|---|---|
| speaking | `matchCommand(transcript, pack, opts?: Partial<CommandOptions>): CommandMatch \| null`; `CommandMatch = { command: SpokenCommand; confidence: number; matched: string; argument?: string }`; pass `opts.answer` = the expected words | Interim and final transcripts in every listening screen |
| speaking | `alignTranscript(expected, heard: string, pack, opts?: { register, regions, uiKey }): Alignment`; `Alignment = { words: AlignedWord[]; extra; understood; total; share; ui }`, `AlignedWord.outcome` is `'landed' \| 'missed' \| 'substituted'`, `ui` is `stats.understood` `{ n, m }` | "Understood N of M words" on landing, no sé, native reply, repair repeat, C2 result |
| speaking | `RETELL_LANES` (60000, 45000, 30000); `retellMetrics(words: TimedWord[], opts?: { laneMs, laneStartMs, pauseMs })` (lane length is an option, pauses default to 700 ms); `retellProgress(rounds)`; `retellRoundUi(round)`; `laneRemainingMs(laneMs, elapsedMs)`; `retellCoverage`; `TimedWord = { text; startMs; endMs }` | B3 |
| speaking | `creditedMs(utteranceMs)`; `addSpoken(log, ms, at, tzOffsetMin)`; `spokenStats(log, now, tzOffsetMin)` (`today`, `todayMs`, `totalMs`, `streakDays`, `days`); `localDay(at, tzOffsetMin)`; `spokenTodayUi(todayMs)`; `restoreSpokenLog`; `minutesAndSeconds` | Minutes spoken, headers, profile |
| speaking | `estimateDurations(text, pack, speechRate, { msPerSyllable }): WordDuration[]`; `estimateDurationMs(word, pack, speechRate, opts)` | Tile widths before voice timings exist |
| speaking | `startRepair()`; `repairFlow(state, input, pack, opts)`; `attemptRepair(state, model, pack, text, at, { judge, flow })`; `judgeAttempt(model, pack, text, { register, regions, before })`; `repairEvents(state, pack, opts)`; `RepairState` (`phase`: `awaiting_attempt`, `prompt_repair`, `ok`, `hinted`, `repaired`, `show_answer`; `highlight`; `expected`; `explainKey`; `ui`); `DEFAULT_REPAIR_OPTIONS.repairOn = ['assert']` | A2 |
| speaking | `startNoSe({ answer, key, at })`; `advanceNoSe(state, input, pack, { register, regions })`; `NoSeState` (`step`, `last: Alignment`, `landed`, `events`, `ui`) | No sé on every rung and on lyric cliffs |
| speaking | `nativeReply(transcript, pack, pair, { at, expected?, phraseSeparator? }): NativeReply` (`hasNative`, `allNative`, `phrases`, `targetPhrase`, `events`, `ui`) | Native-language answers |
| lyrics | `parseLyrics(raw, pack, opts?: Partial<ParseLyricsOptions>): Lyrics` (pass `sectionWords`); `DEFAULT_PARSE_LYRICS_OPTIONS`; `Lyrics`, `LyricLine`, `lyricLine` | Paste preview, stored parse |
| lyrics | `slangNotes(line, pack, pair, { regions, showExplicit })`; `songSlangNotes(lyrics, pack, pair, opts): SongSlangNote[]`; `findSlangMatches`; `SlangNote` | A3 notes, slang underlines, C3 slang amount |
| lyrics | `registerPairs(line, pack, regions): RegisterPair` (`street`, `neutral`, `substitutions`); `registerEquivalents(pack, regions, kinds?)` | C2 |
| lyrics | `lyricCliffs(model, pack, lyrics, { register, regions })` and `broughtTextCliffs(model, pack, text, { register, regions })` → `UnitCliffs[]` of `TextCliff` (`wordIndex`, `wordCount`, `answer`, `accepted`, `context`, `before`, `key`, `keys`, `slang`); `scoreLyricAnswer(model, pack, cliff, answer, { register, regions }): LyricAnswerResult` | C1, brought text |
| lyrics | `surpriseMap(model, pack, text \| lyrics, register, { regions }): SurpriseUnit[]` | Reading a brought text |
| lyrics | `echoLine(expected, heard, pack, { register, regions }): EchoResult` (`words` with `status` `landed \| missed \| substituted` and `slang`, `landed`, `total`, `label` = `echo.landed`) | B4 |
| lyrics | `splitTextUnits(pack, text)`, `lyricUnits`, `TextUnit`, `UiText`, `looseKey`, `normalizeQuotes` | Brought text; text normalization |
| model | `HttpLanguageModel`, `checkTokenScores` (`src/model/http.ts`), `TopNBoundedModel`, `boundedCount` (`src/model/topN.ts`) | Tests and `test:real` only (E6); `runLanguageModelContract` (`src/model/contract.ts`) imports vitest, so the app never imports it |

**Pending engine:** `StorySession` (`dispatch(action)`, `screen`, `snapshot()`,
`StorySession.restore(snapshot, deps)`, `STORY_SESSION_FORMAT`) and `LyricSession`
(`LYRIC_SESSION_FORMAT`) in `engine/src/session`. Until they land, `src/session/story/steps.ts`
and `src/session/lyric/steps.ts` compose the exported primitives above behind the same small
interface (section 3.12); when they land, those two files become adapters and the controllers do
not change.

`__tests__/engine/engineApi.test.ts` imports every value name in this section from
`'@cliffword/engine'` (the model row from its deep path until E6) and checks each is defined,
functions with `typeof`; the type names go through a type-only import that `tsc` checks. A
rename or a missing export fails CI. Until E7 lands, the speaking
and lyrics rows are imported from `@cliffword/engine/src/speaking` and `/src/lyrics` through the
deep-import mapping (Stage 1) and the test lists them as "pending export".

**Engine changes the app asks for** (coordinate with the engine owners; none blocks Stages 1 to
3; each has an app-side fallback so no stage waits):

- E1. Session API: let the caller pass the model per operation, or expose generation of the next
  sentence as its own call, so the controller can run it at prefetch priority and scoring at
  interactive priority. A null model means canned mode. Fallback: `story/steps.ts` calls
  `generateNextSentence` with the prefetch model and scoring with the interactive one.
- E2. `PairPack.starter`: the type and the en-es data have landed (`StarterStory`,
  `pair/en-es/starter.ts` with sentences, taught words, probes and prompts). Remaining:
  `createEnEsPairPack` sets `starter`, and an engine test checks that every starter sentence's
  known share under `PlacementTracker.brandNew(cognates)` is within the known-word band, that
  each taught function word has a gloss, and that every cliff has listed answers and one or two
  distractors. Fallback: app tests use a test pair pack that carries a starter; the app never
  holds sentences itself.
- E3. `LanguagePack.speech?: { recognitionLocales: string[]; ttsLocales: string[];
  regionLocales?: Record<string, string> }` and `LanguagePack.sectionWords?` (the brief puts
  voices in the language pack). Until they exist, the pair entry in `app/src/services/pairs.ts`
  holds the same data.
- E4. Snapshots carry a `format` number; screens carry display text only as `UiText`.
- E5. TypeScript ~6.0.3 in the engine (it already typechecks with 6.0.3), and keep vitest-only
  harnesses (`src/model/contract.ts`) out of anything `src/index.ts` imports.
- E6. Export `HttpLanguageModel` and `TopNBoundedModel` from the index (tests and the self-test
  use them). Until then the jest `moduleNameMapper` and tsconfig `paths` map
  `@cliffword/engine/*` to `../engine/*`.
- E7. Export `./speaking` and `./lyrics` from `engine/src/index.ts`, keeping one `UiText` (from
  `lyrics/text.ts`).
- E8. `LYRICS_PARSER_VERSION` in `lyrics/parse.ts`. Until it exists,
  `app/src/music/lyricsVersion.ts` derives a version from a SHA-256 of a stable serialization of
  `DEFAULT_PARSE_LYRICS_OPTIONS` (RegExps written as source and flags) plus the pair entry's
  section words; it cannot see a parser code change with unchanged options, which is why E8 is
  asked for.
- E9. `cliff_answer.mode: 'spoken' | 'typed' | 'tapped'` with its own `EVENT_EVIDENCE` rows
  (typed: meaning and written, no speaking; tapped: sound and meaning recognition, no speaking).
  Until then `events.ts` maps typed and tapped answers to the interim events in section 3.12.
- E10. `pair.ui` keys `command.<id>.say` and `command.<id>.gloss` for all six `SpokenCommand`
  ids, including `meaning` (today: combined strings such as `command.otraVez`, and no meaning
  key). Until then chips show the first phrase of `pack.commands` and the app catalog's
  `command.<id>.gloss`.
- E11. The engine exports `UI_KEYS`: every `UiText` key it can emit, with its params; and
  `pair/en-es/ui.ts` gains the keys it emits but lacks (`echo.landed`,
  `lyrics.answer.{spelling,neutralForStreet,streetForNeutral,streetVariant,judgedNeutral}`).
  Until then `app/src/i18n/engineKeys.ts` lists them (copied from the module comments) and the
  app catalog supplies the missing English values.
- E12. `PairPack.registerPrompts?`: target-language lines a friend says, for C2 and the story's
  register step. Until then the prompt comes from `pair.starter.prompts`.

Stage 4 uses E1, E2 and E7 when present and the fallbacks otherwise; Stage 5 uses E8 and E12 the
same way.

### 3.1 Model: `app/src/adapters/model/types.ts`, `descriptor.ts` (exist)

```ts
import type { LanguageModel, TokenCandidate, TokenScore } from '@cliffword/engine';

// exists: ModelAdapter extends LanguageModel { status; info; lastError; load(path, opts); unload(); onStatusChange }
// exists: ModelDescriptor { id; url; fileName; bytes; sha256 }  (QWEN3_1_7B_Q4_K_M, DEFAULT_MODEL)

export interface ModelSpec extends ModelDescriptor {   // new
  /** Calibration tables are keyed by id + revision: 'qwen3-1.7b-q4_k_m@d7f544e'. */
  revision: string;           // 'd7f544eead698dbd1f15126ef60b45a1e1933222'
  /** Owned mirror first once it exists; `url` stays the pinned Hugging Face URL as the last resort. */
  mirrors: readonly string[];
  license: string;            // 'Apache-2.0'
  startText: string;          // '<|im_end|>': tokenized once at load; must be one token (151645)
  /** Target language codes whose correction thresholds were measured on this model. */
  calibratedFor: readonly string[];   // ['es']
}
export function isCalibratedFor(spec: ModelSpec, targetCode: string): boolean;

export type MemoryTier = 'standard' | 'low';   // low: total memory < 5 GiB

export interface ContextParams {
  nCtx: 2048 | 1024;
  nBatch: 512;
  nUbatch: 512 | 256;
  kv: 'f16' | 'q8_0';
  gpuLayers: 99 | 0;                    // iOS 99, Android 0 (CPU only in v1)
  flashAttn: 'auto' | 'on' | 'off';     // iOS auto (on with q8_0 KV), Android off
  noExtraBufts: boolean;                // true on iOS when Metal is unavailable (q4_K repack SIGILL)
}
export function contextParamsFor(tier: MemoryTier, platform: 'ios' | 'android', gpu: boolean): ContextParams;

/** What the adapter needs from llama.rn; llamaBinding.ts is the only real implementation. */
export interface LlamaBinding {
  init(path: string, p: ContextParams, onProgress?: (pct: number) => void): Promise<LlamaContextHandle>;
}
export interface LlamaContextHandle {
  readonly id: number;
  readonly gpu: boolean;
  tokenize(text: string): Promise<number[]>;
  completion(p: CompletionParams): Promise<CompletionResult>;
  stopCompletion(): Promise<void>;
  release(): Promise<void>;
  /** global.llamaScoreText bound to this context; undefined without the patch. */
  scoreText?: (context: string, text: string, opts: ScoreTextOptions) => Promise<NativeScore>;
}
export interface ScoreTextOptions {
  start_token: number; parse_special_context?: false; top_k?: number; next_top_k?: number;
  max_outputs_per_decode?: number; reuse_cache?: boolean;
}
export interface NativeScore {
  tokens: { text: string; start: number; end: number; logprob: number; n_tokens: number }[];
  next?: { id: number; text: string; logprob: number; partial?: boolean }[];
  n_context_tokens: number; n_text_tokens: number; n_reused: number; n_evaluated: number; t_ms: number;
}

/** The device ModelAdapter (info.backend 'llama.rn'); load(path) runs initLlama. */
export interface LlamaModelAdapter extends ModelAdapter {
  readonly spec: ModelSpec;
  readonly nativeScoring: boolean;   // true when the patch's llamaScoreText is present
  readonly gpu: boolean;
  /** Stops an in-flight generate (prefetch cancellation, app background). */
  stop(): Promise<void>;
  /** Last call's counters, for the self-test screen. */
  lastStats(): { nReused: number; nEvaluated: number; ms: number } | null;
}
export function createLlamaModelAdapter(binding: LlamaBinding, spec: ModelSpec, params: () => ContextParams): LlamaModelAdapter;

// Pure helpers (src/adapters/model/nativeScore.ts, forcedDecoding.ts)
export function tokenScoresFromNative(text: string, r: NativeScore): TokenScore[];       // validates join === text
export function candidatesFromNative(r: NativeScore, k: number): TokenCandidate[];        // drops partial UTF-8
export function gbnfLiteral(text: string): string;
export function tokenScoresFromForcedDecoding(
  text: string, steps: { content: string; probs: { tok_str: string; prob: number }[] }[],
): TokenScore[];                                                                         // upperBound when outside the list

// src/adapters/model/llamaGlobals.d.ts
declare global {
  var llamaScoreText: ((contextId: number, context: string, text: string, opts: ScoreTextOptions) => Promise<NativeScore>) | undefined;
}
```

Adapter behaviour: every call goes through one promise chain (llama.rn rejects overlapping calls
with "Context is busy"). `scoreContinuation` = `scoreText(context, text, { start_token })`, or
forced decoding with the literal `<|im_end|>` in front of the prompt when the patch is missing.
`nextTokens` = `scoreText(context, '', { next_top_k: k + 8 })`, or `completion` with
`n_predict: 1, n_probs: k + 8, post_sampling_probs: false, temperature: 0`. `generate` = `n`
sequential `completion` calls on the raw prompt (no chat template, no thinking) with
`seed + i`, `top_k 40, top_p 0.95, min_p 0.05, n_probs 0`; prefix reuse makes the prompt cost
once. Text entering the engine (transcripts, pasted lyrics, shared text, brought text) is
normalized to NFC.

### 3.2 Model runtime and download: `app/src/adapters/model/ModelRuntime.ts`, `ModelManager.ts`

```ts
import type { LanguageModel } from '@cliffword/engine';
import type { Store } from '../../services/store';

// exists: ModelFileStatus 'absent' | 'downloading' | 'verifying' | 'ready' | 'error'  -> gains 'paused'
// exists: ModelManager { descriptor; filePath; status(); progress(); snapshot(); startDownload(); cancel(); delete(); onChange() }
export interface ModelManager {                    // additions
  plan(): Promise<DownloadPlan>;                                       // new
  startDownload(opts?: { allowCellular?: boolean }): Promise<ModelFileStatus>;   // gains opts
  pause(): Promise<void>;                                              // new
  resume(): Promise<void>;                                             // new
  /** At launch: model_files row + partial file -> resume, keep, or restart. */
  recover(): Promise<void>;                                            // new
}
export interface ModelFileState { /* exists: status, progress, error */ pauseReason?: 'user' | 'cellular' | 'offline' | 'interrupted' }

export interface DownloadPlan {
  bytes: number;
  freeBytes: number;
  enoughSpace: boolean;                    // freeBytes >= bytes + 600 MB
  network: 'wifi' | 'cellular' | 'none' | 'unknown';
  needsCellularConsent: boolean;
}
export function createModelManager(deps: {
  spec: ModelSpec; files: ModelFilesPort; network: NetworkPort; repo: ModelFileRepo; clock: Clock;
}): ModelManager;

export type RuntimeError =
  | 'no-space' | 'network' | 'size-mismatch' | 'hash-mismatch' | 'load-failed'
  | 'not-single-start-token' | 'unsupported-device';

/** File and load state in one union, for screens. */
export type RuntimeStatus =
  | { kind: 'absent'; declined: boolean }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'paused'; received: number; total: number; reason: 'user' | 'cellular' | 'offline' | 'interrupted' }
  | { kind: 'verifying' }
  | { kind: 'ready' }                                    // verified on disk, not loaded
  | { kind: 'loading'; pct: number }
  | { kind: 'loaded'; nativeScoring: boolean; gpu: boolean }
  | { kind: 'error'; error: RuntimeError; detail?: string };

export type Priority = 'interactive' | 'prefetch';

export interface ModelRuntime {
  readonly status: Store<RuntimeStatus>;
  readonly spec: ModelSpec;
  ensureLoaded(): Promise<void>;
  /** A LanguageModel whose calls run through the priority queue; null until loaded. */
  model(priority: Priority): LanguageModel | null;
  /** Cancel queued prefetch work and stop a running generate. */
  cancelPrefetch(): void;
  /** App background: refuse new calls, stop generation, await the in-flight call. */
  suspend(): Promise<void>;
  resume(): void;
  /** Memory warning or model deleted: release the context; the next call reloads lazily. */
  unload(): Promise<void>;
}
export function createModelRuntime(deps: {
  manager: ModelManager; adapter: ModelAdapter; device: DeviceInfo; lifecycle: Lifecycle;
}): ModelRuntime;
/** Web preview: MockModelAdapter + FakeModelManager('ready'), status loaded { nativeScoring: false, gpu: false }. */
export function createPreviewModelRuntime(): ModelRuntime;          // src/adapters/model/previewModelRuntime.ts

// Ports (src/adapters/model/ports.ts): expoModelFiles.ts implements them, memoryFiles.ts fakes them.
export interface DownloadPauseState { url: string; fileUri: string; resumeData: string | null }
export interface DownloadHandle {
  done: Promise<'complete' | 'paused'>;
  pause(): Promise<DownloadPauseState>;
  cancel(): Promise<void>;
}
export interface ModelFilesPort {
  modelsDir(): string;
  exists(path: string): boolean;
  size(path: string): number | null;
  remove(path: string): void;
  move(from: string, to: string): void;
  sha256(path: string): Promise<string>;
  freeBytes(): number;
  excludeFromBackup(dir: string): Promise<boolean>;
  download(url: string, dest: string, onProgress: (written: number, total: number) => void): DownloadHandle;
  resume(saved: DownloadPauseState, onProgress: (written: number, total: number) => void): DownloadHandle;
}
export interface NetworkPort {
  current(): Promise<'wifi' | 'cellular' | 'none' | 'unknown'>;
  onChange(cb: (type: 'wifi' | 'cellular' | 'none' | 'unknown') => void): () => void;
}
```

The priority queue (`src/adapters/model/priorityQueue.ts`) runs one job at a time; queued
interactive jobs go before queued prefetch jobs; when an interactive job arrives during a
running prefetch job, it calls that job's `onCancel` (the adapter's `stop()`).

### 3.3 Speech out: `app/src/adapters/speechOut/types.ts` (exists)

```ts
// exists: SpeechOut { speak(text, opts?: SpeakOptions): Promise<SpeakResult>; stop(); voices(lang?); isSpeaking }
// exists: SpeakOptions { lang?; rate?; pitch?; voice?; words?: readonly WordSpan[]; onWordBoundary? }
// exists: Voice { id; name; lang; quality: 'default' | 'enhanced' }   -> gains local?: boolean (Android '-network' voices are false)

// new pure helpers (voices.ts, rate.ts)
export function chooseVoice(voices: readonly Voice[], prefs: { locales: readonly string[]; offlineOnly: boolean }): Voice | null;
export function effectiveRate(engineRate: number, learnerScale: number, platform: 'ios' | 'android' | 'web'): number;
export function slower(scale: number): number;      // x 0.8, floor 0.5
```

Target-language text is always spoken with `voice` set (from `chooseVoice` over the pair entry's
TTS locales, or `settings.voiceId`) and `words` set to spans from `pack.segment()`; the
Unicode-pattern fallback in `wordSpans.ts` is for chrome text only (rule 6).

### 3.4 Speech in: `app/src/adapters/speechIn/types.ts` (exists)

```ts
// exists: SpeechIn { kind; capabilities; isListening; permissionStatus(); requestPermission(); start(opts);
//                    stop(); abort(); submitTyped(text); onPartial; onFinal; onLevel; onError; onEnd }
export interface ListenOptions {
  lang: string; onDevice: boolean; interim: boolean; continuous?: boolean;   // exist
  hints?: readonly string[];       // exists: becomes contextualStrings on the device
  persistAudio?: boolean;          // new: sing-back WAV
  latched?: boolean;               // new: retell; restarts a task that ends early (iOS about 1 min) and joins transcripts
}
export interface TranscriptWord {
  text: string; startMs: number; endMs: number; confidence?: number;        // exist
  estimatedEnd?: boolean;          // new: Android gives starts only; end = next start (last word: end of its voiced run)
}
export interface FinalTranscript {
  text: string; words?: TranscriptWord[]; durationMs: number; source: 'speech' | 'typed'; confidence?: number;  // exist
  alternatives: string[];          // new: searched by nativeReply too
  levels: { t: number; db: number }[];   // new: every onLevel sample, t relative to audio start
  audioUri: string | null;         // new: WAV when persistAudio was set
  locale: string;                  // new
  onDevice: boolean;               // new
}
export interface SpeechIn {        // additions
  /** Touch-down: warm the recognizer so listening starts fast. */
  prepare?(): void;
  availability(locale: string): Promise<{ recognizer: boolean; onDevice: boolean | 'unknown'; needsDownload: boolean }>;
  /** Android 13+: trigger the offline model download for a locale. */
  downloadOnDevice?(locale: string): Promise<'started' | 'unsupported'>;
  /** Bytes of a persisted recording; deletes the file afterwards. Device: expo-file-system `new File(uri).bytes()`. */
  readAudio?(uri: string): Promise<Uint8Array>;
}

// src/session/utterance.ts: one hold, assembled from SpeechIn events and the clock
export interface Utterance {
  holdStartMs: number; holdEndMs: number;
  transcript: string;              // NFC
  alternatives: string[];
  words: TranscriptWord[];
  levels: FinalTranscript['levels'];
  source: 'speech' | 'typed';
  locale: string;
  audioUri: string | null;
}
export function collectUtterance(speechIn: SpeechIn, clock: Clock): { finish(): Promise<Utterance>; cancel(): void };

// Pure helpers (src/adapters/speechIn/vad.ts, wav.ts, pitch.ts)
export function voicedMs(levels: FinalTranscript['levels']): number;    // dBFS; floor = p20 of first 300 ms; hangover 250 ms; min run 120 ms
export function silentRuns(levels: FinalTranscript['levels'], minMs: number): { startMs: number; endMs: number }[];
export function readWav(bytes: Uint8Array): { sampleRate: number; samples: Float32Array };   // PCM16, float32, WAVE_FORMAT_EXTENSIBLE
export function pitchTrack(samples: Float32Array, sampleRate: number): (number | null)[];      // YIN, 10 ms hop, 70-1000 Hz lags
export function pitchPerWord(track: (number | null)[], words: TranscriptWord[]): (number | null)[];
```

The device adapter starts recognition with `recordingOptions: { persist: true,
outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' }` when `persistAudio` is set (iOS
otherwise writes 32-bit float WAV at 44.1 or 48 kHz; Android already writes 16 kHz). `readWav`
still accepts float32 and extensible files, so a device that ignores the options does not break
sing-back.

### 3.5 Audio coordinator: `app/src/adapters/audio/AudioCoordinator.ts` (new)

```ts
export type AudioMode = 'idle' | 'story' | 'musicPlayback' | 'mic';

export interface AudioSessionPort {          // expoAudioSession.ts; iOS only, no-op elsewhere
  setCategory(c: { category: 'playAndRecord' | 'playback'; options: string[]; mode: 'default' }): Promise<void>;
  setActive(active: boolean, notifyOthers: boolean): Promise<void>;
}

export interface AudioCoordinator {
  readonly mode: Store<AudioMode>;
  /** Story focus: playAndRecord + defaultToSpeaker + allowBluetoothA2DP, mode default. */
  enterStory(): Promise<void>;
  /** Leaving Story: deactivate with notifyOthersOnDeactivation so other apps may resume. */
  leaveStory(): Promise<void>;
  /** Before TTS or the mic during a song: pause the track and wait until it reports paused. */
  forMic(): Promise<void>;
  /** After a lyric cliff: restore the playback category. Never resumes the track itself. */
  forPlayback(): Promise<void>;
  onInterruption(cb: () => void): () => void;
}
```

### 3.6 Music player: `app/src/adapters/music/types.ts` (exists)

```ts
// exists (ms units): MusicPlayer { available; authorize(); authorizationStatus(); subscriptionStatus();
//   librarySongs(query?); play(songId); pause(); resume(); seek(ms); positionMs(); nowPlaying(); state(); onStateChange() }
// exists: MusicAuthorization 'authorized' | 'denied' | 'notDetermined' | 'restricted' | 'unsupported'
// exists: Song { id; title; artist; album?; durationMs; artworkUrl?; explicit? }
export interface Song {                       // additions
  source: 'library' | 'catalog';
  isrc?: string;                              // key for licensed timed lyrics later
  genre?: string;                             // genreNames[0]; shown on the song header (A3)
  hasCatalogLyrics?: boolean;
}
export interface MusicPlayer {                // additions
  searchCatalog(term: string, opts?: { limit?: number }): Promise<Song[]>;
  getSong(id: string): Promise<Song | null>;
  play(songId: string, opts?: { startAtMs?: number }): Promise<void>;       // rejects on failure
  /** Native timer pauses at ms - leadMs (default 120) and emits onCliff. */
  pauseAt(ms: number, opts?: { leadMs?: number }): Promise<void>;
  clearPauseAt(): void;
  setRate?(rate: number): Promise<void>;                                    // unverified on catalog streams
  onCliff(listener: (e: { targetMs: number; actualMs: number }) => void): Unsubscribe;
  onError(listener: (e: { code: MusicPlayerErrorCode; message: string }) => void): Unsubscribe;
}

// src/adapters/music/cliffClock.ts (pure)
export function pauseTargetFor(timings: readonly { line: number; startMs: number }[], cliffLine: number, durationMs: number | null): number | null;
export function againSeekTarget(lineStartMs: number): number;              // line start - 300 ms, >= 0
export function lrcTimings(lyrics: Lyrics): { line: number; startMs: number }[] | null;
```

`src/adapters/music/index.ts` exports `getMusicPlayer()`: `MusicKitPlayer` on iOS when the
native module is present, else `UnsupportedMusicPlayer` (`available: false`, authorization
`'unsupported'`, everything else rejects with `MusicPlayerError('unsupported')`).

### 3.7 Share inbox: `app/src/adapters/share/types.ts` (exists)

```ts
// exists: SharedItem { id; url?; text?; receivedAt }
// exists: ShareInbox { pending(); clear(id); onShare(listener) }; MemoryShareInbox adds receive(item)

export type SharedSong =
  | { kind: 'song'; service: 'spotify' | 'apple-music' | 'youtube-music' | 'unknown';
      trackId: string | null; storefront?: string; url: string;
      title: string | null; artist: string | null; needsConfirm: true }
  | { kind: 'lyrics'; text: string }
  | { kind: 'unsupported'; reason: 'album' | 'playlist' | 'artist' | 'podcast' | 'empty' | 'unknown-link' };

/** parseShared.ts (renamed from parseSpotifyShare.ts). No network. Phrases come from the pair entry. */
export function parseShared(item: Pick<SharedItem, 'url' | 'text'>, phrases: SharePhrases): SharedSong;
export interface SharePhrases { titleArtistSeparators: readonly string[]; serviceSuffixes: readonly string[] }
```

On the device `ShareIntentBridge` calls `receive` and the native inbox writes each item to the
existing `share_inbox` table, so a share that arrives before boot finishes is not lost;
`clear(id)` marks it handled and calls `resetShareIntent()`.

### 3.8 Storage: `app/src/storage` (exists)

```ts
// exists: SqlDatabase { exec(sql); run(sql, params); all(sql, params); get(sql, params); transaction(fn); close() }
// exists: Storage { db; settings; learner; sessions; stories; songs; lyrics; spokenTime; modelFiles; shareInbox; close() }
export interface Storage {                           // additions
  readonly retell: RetellRepo;
  readonly voices: VoiceRepo;
  readonly texts: TextRepo;
  /** Every repository bound to one transaction (createStorage(tx, clock)); commits or rolls back together. */
  transaction<T>(fn: (s: Storage) => Promise<T>): Promise<T>;
}

// Additions to existing repositories (section 4.1 has the columns)
// learner:    saveSnapshot(learner, at, { keep, prior: PriorSpec }); latestSnapshot() -> { ..., prior: PriorSpec | null };
//             loadLearner({ priorFor: (spec: PriorSpec | null) => PriorFn })
// stories:    create({ title, pair, register, regions }); addChapter(storyId, number, title, at);
//             chapterMeta(storyId) -> { number, title, spokenMs } | null; addChapterSpokenMs(storyId, number, ms)
// sessions:   save({ ..., refId? }); active(kind, refId?)   (one active session per kind and ref)
// songs:      upsert({ ..., isrc?, isExplicit, region?, genre?, shareUrl? }); touch(id, at); list() recent first
// lyrics:     put(songId, raw, parsed, { parserVersion, origin, timings }); saveTimings(songId, timings, at); deleteAll()
// spokenTime: addUtterance(creditedMs, at, tzOffsetMin, activity)   (ms is already credited by the caller)
//             log(): SpokenTimeLog (for spokenStats); byActivity(fromDay, toDay)
//             today()/streak() are removed: spokenStats is the only counting rule
// modelFiles: url, revision, downloadedBytes, pauseState, error; status gains 'paused'

export type SpokenActivity = 'cliff' | 'repair' | 'retell' | 'echo' | 'lyric' | 'repeat' | 'register' | 'practice';
export interface RetellRepo {
  add(r: { storyId: string; chapter: number | null; round: 1 | 2 | 3; laneMs: number; words: number; spokenMs: number; wpm: number; pauses: number; at: number }): Promise<void>;
  lastForChapter(storyId: string, chapter: number): Promise<{ round: number; wpm: number; pauses: number }[]>;
}
export interface VoiceRepo {
  calibration(voiceId: string): Promise<{ msPerSyllable: number; samples: number } | null>;
  addSample(voiceId: string, msPerSyllable: number, at: number): Promise<void>;     // running mean
}
export interface TextRepo {
  add(t: { title: string; rawText: string; at: number }): Promise<string>;          // id
  get(id: string): Promise<{ id: string; title: string; rawText: string; createdAt: number; lastOpenedAt: number | null } | null>;
  list(opts?: { limit?: number }): Promise<{ id: string; title: string; createdAt: number }[]>;
  touch(id: string, at: number): Promise<void>;
  remove(id: string): Promise<void>;
}
```

### 3.9 Settings: `app/src/storage/repos/settings.ts` (exists)

```ts
export interface AppSettings {
  register: Register;                       // exists: 'neutral'
  regions: readonly string[];               // exists: ['PR', 'CARIB']
  showExplicit: boolean;                    // exists: true (brief: explicit lyrics ON by default)
  textMode: 'auto' | 'text' | 'tiles';      // exists: 'auto' = per-word fading; 'text' / 'tiles' force every word
  nativeLanguage: string;                   // exists: 'en'
  targetLanguage: string;                   // exists: 'es'; pair id = `${nativeLanguage}-${targetLanguage}`
  onboarded: boolean;                       // exists: the root guard
  startLevel: 'brandNew' | 'placement';     // exists: onboarding choice
  nativeAnswersAllowed: boolean;            // exists: true
  speechRateScale: number;                  // new, replaces speechRateBias: 1; 'más despacio' x0.8, floor 0.5, max 1.25
  onboardingStep: 'welcome' | 'model' | 'voice' | 'slang' | 'done';   // new: resume point
  voiceId: string | null;                   // new
  recognitionLocale: string | null;         // new
  allowNetworkRecognition: boolean;         // new: false keeps "Data Not Collected" true
  allowCellularDownload: boolean;           // new: false
  modelDeclined: boolean;                   // new: the learner chose "Not now" for the download
}
// exists: DEFAULT_SETTINGS, get/getAll/set/update/reset, InvalidSettingError; invalid stored values read as the default
```

Settings are read and changed through the existing `AppState` (`useSettings()`,
`updateSettings(patch)`); controllers get `settings()` and `updateSettings` from it.

### 3.10 Learner: `app/src/learner/prior.ts` (exists), `app/src/storage/repos/learner.ts` (exists)

```ts
export type PriorSpec =
  | { kind: 'brandNew' }                                     // PlacementTracker.brandNew(cognateLexemeKeys(pair))
  | { kind: 'placementStart' }                               // exists as learnerPrior(packs, 'placement')
  | { kind: 'placement'; placement: PlacementSnapshot };     // PlacementTracker.restore(p).prior(rankOfFromPack(pack), cognateKeys)
export function buildPrior(spec: PriorSpec, packs: PriorPacks): PriorFn;
export function priorSpecFor(startLevel: AppSettings['startLevel']): PriorSpec;   // used when a snapshot row has no prior
```

The live `LearnerModel` stays in `AppState` (exists). Controllers apply events with
`storage.learner.record(learner, events)` inside `storage.transaction` (rule 5), and
`src/session/checkpoint.ts` writes a snapshot every 200 events, on app background and on session
close, keeping 3. When placement finishes the controller rebuilds the model with
`LearnerModel.restore(learner.snapshot(), { prior: buildPrior(spec, packs) })`, hands it to
`AppState`, and saves a snapshot with that `prior`.

### 3.11 Services container: `app/src/services/types.ts` (exists), `store.ts`, `pairs.ts` (new)

```ts
// exists: Services { platform; clock; model; modelManager; speechOut; speechIn; music; share; haptics; storage; packs }
export interface Services {                 // additions
  readonly runtime: ModelRuntime;           // priority queue and lifecycle over model + modelManager
  readonly audio: AudioCoordinator;
  readonly device: DeviceInfo;
  readonly lifecycle: Lifecycle;
  readonly pairs: PairRegistry;
}
// services.packs (exists) stays the default pair's packs (EN_ES), because the container is built
// before settings are read. AppState gains packs = pairs.packs(`${nativeLanguage}-${targetLanguage}`),
// rebuilt when those settings change; boot, priors and controllers read packs from AppState.

// exists: Clock { now() }  -> gains setTimeout(fn: () => void, ms: number): () => void
export interface DeviceInfo {
  platform: 'ios' | 'android' | 'web'; totalMemoryBytes: number | null; locales: string[]; appVersion: string;
  /** Local time minus UTC in minutes at `at` (ISO sign), for engine localDay. */
  tzOffsetMin(at: number): number;
}
export interface Lifecycle { onChange(cb: (s: 'active' | 'background' | 'inactive') => void): () => void; onMemoryWarning(cb: () => void): () => void }

export class Store<T> {
  constructor(value: T);
  get(): T;
  set(next: T): void;                       // notifies only when !Object.is(next, current)
  subscribe(listener: () => void): () => void;
}
export function useStore<T>(s: Store<T>): T;                       // useSyncExternalStore
export function useStoreSelector<T, U>(s: Store<T>, pick: (v: T) => U): U;

// pairs.ts: every pair the app can run. Only the en-es entry names Spanish or English.
export type PairId = string;                // 'en-es'
export interface PairEntry {
  id: PairId; native: string; target: string;
  buildPacks(regions?: readonly string[]): ServicePacks;          // engine factories for this pair
  speech: { recognitionLocales: string[]; ttsLocales: string[]; regionLocales?: Record<string, string> };  // until E3
  nativeLocale: string;                     // 'en-US': the "Answer in English" listen
  sectionWords: readonly string[];          // lyric section labels for parseLyrics (until E3)
  sharePhrases: SharePhrases;               // share-text separators and suffixes for parseShared
  wordSeparator: string;                    // ' ' for es, '' for ja/zh: nativeReply phraseSeparator
}
export interface PairRegistry {
  get(id: PairId): PairEntry;               // throws for an unknown id
  ids(): PairId[];
  register(entry: PairEntry): void;         // tests add stub pairs
  packs(id: PairId, regions?: readonly string[]): ServicePacks;   // memoized
}
export const EN_ES: PairEntry;
```

Factories (exist): `createServices(platform, overrides)`, `createNativeServices`,
`createWebServices`, `createTestServices(overrides)` (jest only); `getAppServices()` /
`setAppServices()` for the root layout and route tests; `ServicesProvider` and `useServices()`.
`src/appState/AppStateProvider.tsx` (exists) gains `packs` and `pair: PairEntry` for the
settings' pair; `bootstrap()` builds the prior from `pairs.packs(pairId)` instead of
`services.packs`.

### 3.12 Session controllers and the screens they publish: `app/src/session/*`

Screens are plain, JSON-serializable data: pack text, numbers and `UiText`, never a display
string in the native language. When the engine `StorySession`/`LyricSession` land, their screens
replace the steps' output and the controllers translate if they differ.

```ts
import type { AlignedWord, CliffRung, Credit, CreditReason, EchoStatus, Heat, NativePhrase, NoSeState,
  RegisterPair, RepairHighlight, RepairPhase, SpokenCommand, UiText, Verdict } from '@cliffword/engine';

export interface StoryMeta { chapter: number; title: string; spokenMs: number; todayMs: number }   // todayMs: spokenTodayUi in A2/B3 headers

/** One word of a line, from pack.segment(). Nothing here assumes spaces between words. */
export interface FlowWord {
  key: string;                                 // learner key: lexemeKey, or formKey for an inflected form
  text: string;                                // the segment's text only
  start: number; end: number;                  // offsets in the line
  separatorAfter: string;                      // source text up to the next word: ' ', ', ', '' (no-space languages)
  display: 'text' | 'tile' | 'gap' | 'future';
  age?: 'new' | 'mid' | 'old';                 // tile shade by line age
  isNew?: boolean;                             // dotted accent underline
  durationMs: number;                          // tile width
  heat?: Heat;
}
export interface Understood { n: number; m: number; words: AlignedWord[] }   // alignTranscript(...).understood / .total / .words

export type AnswerMode = 'spoken' | 'typed' | 'tapped';

export type StoryScreen =
  | { kind: 'loading'; reason: 'restoring' | 'generating' | 'model' }
  | { kind: 'cliff'; meta: StoryMeta; words: FlowWord[]; canned: boolean;
      cliff: { wordIndex: number; length: number; rung: CliffRung; options?: string[]; hint?: string; reading?: number };
      subtitle: { min: number; max: number };  // from cliff.length: "One to three words, out loud"
      gloss?: { word: string; gloss: string }; speak: string; placement?: { band: number } }
  | { kind: 'landing'; meta: StoryMeta; answer: string; mode: AnswerMode; credit: Credit; reason: CreditReason;
      candidates: { text: string; p: number }[]; headline: UiText; note: UiText; words: FlowWord[];
      understood?: Understood }               // after "say the whole line"
  | { kind: 'repair'; meta: StoryMeta; prompt: { speaker: string; line: string }; said: FlowWord[];
      phase: RepairPhase; highlight: RepairHighlight | null;
      expected?: string;                       // hinted, show_answer
      fix?: { text: string; explainKey: string };   // show_answer only; the view renders pair.explanations[explainKey]
      understood?: Understood }                // the repeat after show_answer
  | { kind: 'noSe'; meta: StoryMeta; answer: string; step: NoSeState['step']; words: FlowWord[]; understood?: Understood }
  | { kind: 'nativeReply'; meta: StoryMeta; heard: string; target: string; phrases: NativePhrase[]; understood?: Understood }
  | { kind: 'upNext'; meta: StoryMeta; next: 'retell' | 'chapter' | 'register' | 'starterDone';
      actions: ('review' | 'retell' | 'music' | 'download')[] }
  | { kind: 'placementDone'; meta: StoryMeta; vocabulary: number }
  | { kind: 'error'; message: UiText };

export type ListeningState =
  | { kind: 'idle' } | { kind: 'warming' } | { kind: 'listening'; partial: string; level: number }
  | { kind: 'finishing' } | { kind: 'error'; code: SpeechInErrorCode };

export interface StoryController {
  readonly screen: Store<StoryScreen>;
  readonly listening: Store<ListeningState>;
  start(): Promise<void>;                      // restore open session or begin (canned or model)
  holdBegin(): void;                           // touch-down: warm recognizer
  holdStart(): void;                           // after 120 ms: listen
  holdEnd(): Promise<void>;                    // release: finish and route the utterance
  holdCancel(): void;
  answerInNative(): Promise<void>;             // "Answer in English": one listen with the pair's nativeLocale
  typeAnswer(text: string): Promise<void>;     // mode 'typed'
  pickOption(index: number): Promise<void>;    // mode 'tapped'
  command(c: SpokenCommand): Promise<void>;    // also from CommandChips
  tapWord(index: number): void;                // hear it; tap_rehear
  revealWord(index: number): void;             // see it; hold_reveal
  openGloss(): void;                           // gloss chip; gloss_lookup
  showAnswer(): Promise<void>;                 // repair: give_up
  review(): Promise<void>; openRetell(): void; // upNext actions
  setTextMode(m: AppSettings['textMode']): Promise<void>;
  dispose(): void;
}
```

Every `SpokenCommand` works on every listening screen; the story controller maps them so:

| Command | cliff (any rung) | landing | repair | noSe | nativeReply | upNext |
|---|---|---|---|---|---|---|
| `again` (otra vez) | replay to the cliff | replay the line | replay the prompt | `advanceNoSe(replay)` | replay the target | replay last line |
| `slower` (más despacio) | `speechRateScale` x0.8, persist, replay | same | same | `replay, slower` | same | same |
| `dont_know` (no sé) | `startNoSe` (options, hint and free rungs alike) | none | `give_up` → `show_answer` | replay the answer | replay the target | none |
| `next` (siguiente) | skip: show the answer, then the prefetched sentence | prefetched next sentence | next step | `advanceNoSe(skip)` | next sentence | first action |
| `done` (listo) | ends the hold (answer so far) | next | ends the attempt | ends the repeat | ends the repeat | first action |
| `meaning` (¿qué significa?) | gloss of the cliff answer, `gloss_lookup` | gloss of the line (`pair.gloss` per word) | gloss of the prompt | gloss of the answer | gloss of the target | none |

Repair phases map to the screen like this (engine `DEFAULT_REPAIR_OPTIONS`: assert prompts a
repair, hint only shades):

| `RepairState.phase` | Heat on `highlight` | Text | Explanation |
|---|---|---|---|
| `ok` | none | no repair screen; the story continues | none |
| `hinted` (margin 1 to 3 nats) | `hintHeat` 1 (#FFE9C7) | `repair.expected` with `expected` | none, and no fix wording |
| `prompt_repair` (assert, 3 nats or more) | `assertHeat` 2 (#FFC46B) | `repair.prompt` ("One word surprised me. Say it again.") | none yet |
| `repaired` | none | story continues; `spoke_correct` | none |
| `show_answer` | 2 | `repair.fix` with the expected sentence | `pair.explanations[explainKey]` |

`src/session/events.ts` is the only place gestures and answers become learner events:

```ts
export type SessionAction =
  | { type: 'moved_on'; words: FlowWord[]; spoken: boolean }   // a sentence finished
  | { type: 'tap_word'; word: FlowWord } | { type: 'hold_word'; word: FlowWord }
  | { type: 'gloss'; key: string }
  | { type: 'answer'; mode: AnswerMode; key: string; credit: Credit; rung: CliffRung }
  | { type: 'no_se'; state: NoSeState }
  | { type: 'native'; reply: NativeReply }
  | { type: 'repair_done'; events: LearnerEvent[] };
export function eventsFor(action: SessionAction, now: number): LearnerEvent[];
```

| Action | Events |
|---|---|
| A sentence played by TTS, word shown as a tile, not tapped or held, moved on | `heard` per tile word |
| Word shown as text, moved on | `read` per text word |
| Tap a tile | `tap_rehear` |
| Hold a tile | `hold_reveal` |
| Gloss chip, `meaning` command | `gloss_lookup` |
| Spoken cliff answer | `cliff_answer { credit, rung }` (after E9: `mode: 'spoken'`) |
| Typed answer | until E9: `read` for the answer key when credited, nothing otherwise; after E9: `cliff_answer { mode: 'typed' }` |
| Tapped option | until E9: `heard` when right, `tap_rehear` when wrong; after E9: `cliff_answer { mode: 'tapped' }` |
| No sé | `cliff_skip`, then `spoke_correct` when the repeat lands (`NoSeState.events`) |
| Native words inside a reply | `native_gap` (`NativeReply.events`) |
| Repair finished | `repairEvents(state)`: `spoke_error` on the blamed word, `spoke_correct` on the others |
| Any of the above on an inflected word | key `formKey(pack.code, lemma, features)` (the learner model backs off to the lexeme) |

Only `source: 'speech'` utterances add speaking time; typed and tapped answers add none.

```ts
export type LyricScreen =
  | { kind: 'read'; song: SongView; lines: { words: FlowWord[]; slang: { start: number; end: number }[] }[];
      notes: SlangNoteView[]; register: Register; playback: 'apple-music' | 'manual'; player: PlaybackStatus }
  | { kind: 'cliff'; song: SongView; lineIndex: number; total: number; previous: string; before: FlowWord[];
      gapLength: number; options?: string[]; waiting: boolean; positionMs: number | null }
  | { kind: 'result'; song: SongView; lineIndex: number; answer: string; mode: AnswerMode; credit: Credit;
      expected: string; equivalence?: UiText; understood?: Understood }
  | { kind: 'echo'; song: SongView; lineIndex: number; tiles: EchoTile[]; landed: number; total: number;
      label: UiText; player: PlaybackStatus }  // subtitle from the real player state ("stopped")
  | { kind: 'registers'; pairs: RegisterPair[]; region: string;
      prompt: { from: UiText; line: string };  // "Your friend texts" + "¿Vienes esta noche?"
      target: Register | null;                 // "Say it street" / "Say it neutral"
      result?: { register: Register; understood: Understood; verdict: Verdict; hintNeutral?: string } };
export interface EchoTile {
  text: string; start: number; end: number; separatorAfter: string;
  status: EchoStatus | null;                   // null before the learner sings
  slang: boolean; note?: SlangNoteView;        // hold shows the note
  pitch: number | null;                        // learner row only; the singer row has uniform heights
}
export interface SlangNoteView { form: string; meaning: string; region: string; formality: string; explicit: boolean }
export interface SongView { id: string; title: string; artist: string; genre: string | null; region: string | null }

export interface LyricController {
  readonly screen: Store<LyricScreen>;
  readonly listening: Store<ListeningState>;
  open(songId: string, mode: 'read' | 'cliff' | 'echo' | 'registers'): Promise<void>;
  play(): Promise<void>; pause(): Promise<void>;          // user-initiated only
  holdBegin(): void; holdStart(): void; holdEnd(): Promise<void>; holdCancel(): void;
  command(c: SpokenCommand): Promise<void>;
  showOptions(): void; pickOption(i: number): Promise<void>;
  next(): Promise<void>; again(): Promise<void>;          // the only paths that resume playback
  setRegister(r: Register): Promise<void>;
  chooseRegister(r: Register): void;                      // C2: the register the next answer is judged in
  hearTile(i: number): Promise<void>;                     // slow TTS (slower(rate)); tap_rehear
  revealTile(i: number): void;                            // shows the slang note; hold_reveal
  dispose(): void;
}
```

Lyric commands: `again` seeks to `againSeekTarget(lineStart)` (or TTS replays the line in manual
mode); `slower` calls `setRate(0.75)` where available, else TTS reads the line at `slower(rate)`;
`next` goes to the next line and is the only command that resumes playback; `dont_know` runs the
no-sé flow on the lyric cliff (hear the line's words, repeat them); `done` ends the hold;
`meaning` shows the slang note or gloss of the hidden words.

```ts
export type TextScreen =                       // brought text, BroughtTextController
  | { kind: 'loading' }
  | { kind: 'waitingForModel'; status: RuntimeStatus }
  | { kind: 'read'; units: { words: FlowWord[] }[] }       // heat from surpriseMap
  | { kind: 'cliff'; unitIndex: number; words: FlowWord[]; cliff: { wordIndex: number; length: number }; speak: string }
  | { kind: 'landing'; answer: string; mode: AnswerMode; credit: Credit; expected: string; understood?: Understood };

export interface RetellController {
  readonly round: Store<{ index: 0 | 1 | 2; laneMs: number; remainingMs: number; live: boolean; header: UiText }>;   // retellRoundUi
  readonly lanes: Store<{ laneMs: number; words: TimedWord[]; pauses: RetellPause[] }[]>;
  readonly stats: Store<RetellProgress | null>;                                                                   // retellProgress
  begin(): Promise<void>; holdStart(): void; stop(): Promise<void>; finish(): Promise<void>;
}
```

The story steps (`src/session/story/steps.ts`) are the seam to the engine session:

```ts
export interface StorySteps {
  next(ctx: StepContext): Promise<StepResult>;            // canned (pair.starter) or model, placement probes
  scoreAnswer(ctx: StepContext, answer: string, mode: AnswerMode): Promise<AnswerResult>;
  snapshot(): unknown; restore(s: unknown): void;         // stored in sessions.snapshot with a format number
}
```

### 3.13 Interface text: `app/src/i18n` (exists)

```ts
export type TranslationKey = CatalogKey | (string & {});   // exists
export interface Translator {                               // exists
  readonly native: string;
  t(key: TranslationKey, vars?: Record<string, string | number>): string;   // {name} placeholders
  plural(key: string, count: number, vars?: Record<string, string | number>): string; // key.one / key.other via Intl.PluralRules
  has(key: string): boolean;
}
export function createTranslator(o: TranslatorOptions): Translator;          // exists
export function useI18n(): Translator;                                       // exists
export function tUi(t: Translator['t'], text: UiText): string;               // new: engine UiText -> string
export const ENGINE_UI_KEYS: readonly { key: string; params: readonly string[] }[];   // new, engineKeys.ts, until E11
```

Lookup order: `pair.ui[key]`, then `catalogs[native][key]`, then `catalogs.en[key]`, then the key
(with a development warning). The app catalog holds chrome; `PairPack.ui` holds strings that name
or quote the target language (command phrases and glosses, region names, "You landed where a
Spanish speaker would"). A new pair adds an engine pair pack and a `pairs.ts` entry, and an app
catalog only for a new native language.

Command chips use one key scheme (E10): `command.<id>.say` (the phrase, target language, from
`pair.ui`) and `command.<id>.gloss` (the native gloss) for `again`, `slower`, `dont_know`,
`next`, `done` and `meaning`. Until E10, `say` is the first phrase of the pack's
`SpokenCommandEntry` and `gloss` comes from the app catalog.

The CliffCard subtitle is `cliff.anyAnswer` ("Any natural answer scores.") plus the app catalog's
plural key `cliff.wordRange` with `{min}` and `{max}` from `screen.subtitle` ("One to three
words, out loud."; `.one` for a one-word cliff).

### 3.14 Theme tokens: `app/src/theme` (exists)

```ts
export const colors: {
  ground: '#F3F4F1'; ink: '#16181D'; muted: '#5B616B'; mutedStrong: string; chipText: string;
  card: '#FFFFFF'; onInk: string; onInkDot: string; accentText: '#B4530A'; accentTextPressed: string;
  live: '#FF8A3D'; heat1: '#FFE9C7'; heat2: '#FFC46B'; heat3: '#F08A1D';
  tileNew: '#DDE0D8'; tileMid: '#C6CAC1'; tileOld: '#A6AB9F'; dot: string;
  border: string; borderSoft: string; borderDashed: string; track: string;
};
export type ColorName = keyof typeof colors;
export const heatColors: readonly [string | null, string, string, string];   // index = engine Heat
export const spacing: { xxs: 2; xs: 4; sm: 8; md: 12; lg: 16; xl: 20; xxl: 24; xxxl: 28 };
export const layout: { screenPaddingX: 24; screenPaddingTop: 28; designWidth: 390; designHeight: 844; minTouch: 44; primaryHeight: 56; /* … */ };
export const radii: { tile: 7; chip: 10; control: 12; panel: 14; button: 16; list: 18; card: 20; holdArea: 28; pill: 999 };
export const fontFamilies: Record<FontRole, FontFamilyName>;       // one family per face
export const typography: Record<TypographyVariant, TextStyle>;      // content: story, prompt, headline, display…;
                                                                    // interface: body, hint, caption, eyebrow, button…;
                                                                    // music (Anton): musicTitle, musicLine, musicButton…
export function contrastRatio(fg: string, bg: string): number;      // new in Stage 1 (contrast.ts)
```

Typography: Newsreader for content, Inter for interface, Anton (uppercase) for Music headings.
Fonts are embedded by the expo-font plugin with one family per face, so code never sets
`fontWeight`. Light only in v1; components read token names only, so a dark palette can come
later through a provider with the same keys. Heat index 0 has no shading. Contrast (computed):
muted on ground 5.65:1, accent on white 5.02:1, ink on heat3 7.07:1; heat chips keep ink text,
never white.

## 4. SQLite schema

One database file, `cliffword.db`, in the app's private storage (the web preview and jest use
sql.js in memory, fresh on each load). `prepareDatabase` runs `PRAGMA journal_mode = WAL` (file
databases) and `PRAGMA foreign_keys = ON` on open, outside any transaction, then migrates.
Booleans are stored as 0/1; JSON is stored as TEXT; times are ms since the epoch. Enumerations
that may grow have no CHECK constraints; repositories validate them (existing rule).

### 4.1 Schema: v1 and v2 exist, v3 is appended (`app/src/storage/schema.ts`)

| v | Name | Tables (exist) |
|---|---|---|
| 1 | `core` | `settings` (key, JSON value, updated_at); `learner_events` (append-only: id, at, type, key, JSON payload; indexes on key and at); `learner_snapshots` (id, at, version, json, through_event_id); `sessions` (id, kind, updated_at, version, JSON snapshot, active; one active per kind); `stories` (id, title, created_at); `story_sentences` (story_id, idx, text, json) |
| 2 | `music-and-device` | `songs` (id, source, external_id, title, artist, artwork_url, added_at; unique source + external_id); `lyrics` (song_id, raw_text, parsed, updated_at); `spoken_time` (local day, ms); `model_files` (id, path, bytes, sha256, status, updated_at); `share_inbox` (id, received_at, url, text, handled) |

Nothing has shipped, so v1 and v2 could still be rewritten; appending v3 instead keeps the
existing repository tests valid and exercises the upgrade path the first store build will need.

```sql
-- v3 'story-speaking-music' (Stage 2). Runs in one transaction with PRAGMA user_version = 3;
-- the runner re-checks the version inside the transaction, so the ALTERs never run twice.

-- The learner prior is a function, so the snapshot row records how to rebuild it.
ALTER TABLE learner_snapshots ADD COLUMN prior TEXT;            -- JSON PriorSpec; NULL on older rows (settings.startLevel decides)

-- Stories: pair and register; chapters with their spoken time ("spoken 4:12").
ALTER TABLE stories ADD COLUMN pair TEXT NOT NULL DEFAULT 'en-es';
ALTER TABLE stories ADD COLUMN register TEXT NOT NULL DEFAULT 'neutral';
ALTER TABLE stories ADD COLUMN regions TEXT NOT NULL DEFAULT '[]';   -- JSON array of region codes
ALTER TABLE stories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS chapters (
  story_id   TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  number     INTEGER NOT NULL,
  title      TEXT,
  spoken_ms  INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, number)
);
ALTER TABLE story_sentences ADD COLUMN chapter INTEGER NOT NULL DEFAULT 1;

-- Sessions: one active session per kind and reference (a lyric session per song).
ALTER TABLE sessions ADD COLUMN ref_id TEXT;                    -- story id, song id or text id
DROP INDEX IF EXISTS sessions_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active_ref ON sessions (kind, IFNULL(ref_id, '')) WHERE active = 1;

-- Songs: what C3 and A3 show, and the key for licensed timed lyrics later.
ALTER TABLE songs ADD COLUMN share_url TEXT;
ALTER TABLE songs ADD COLUMN isrc TEXT;
ALTER TABLE songs ADD COLUMN is_explicit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE songs ADD COLUMN region TEXT;                       -- PR / DO / CU / CO hint from slang in the lyrics
ALTER TABLE songs ADD COLUMN genre TEXT;                        -- Apple Music genreNames[0]
ALTER TABLE songs ADD COLUMN last_opened_at INTEGER;
CREATE INDEX IF NOT EXISTS songs_isrc ON songs (isrc) WHERE isrc IS NOT NULL;
CREATE INDEX IF NOT EXISTS songs_recent ON songs (last_opened_at DESC, added_at DESC);

-- Lyrics: parser version, line timings from taps or LRC, and where the text came from.
ALTER TABLE lyrics ADD COLUMN parser_version TEXT NOT NULL DEFAULT '';   -- E8 number as text, or lyricsVersion() hash
ALTER TABLE lyrics ADD COLUMN timings TEXT;                     -- JSON [{line, startMs}]
ALTER TABLE lyrics ADD COLUMN origin TEXT NOT NULL DEFAULT 'pasted';     -- pasted | shared-text | lrc

-- Brought text (articles, transcripts): on this device only.
CREATE TABLE IF NOT EXISTS texts (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  raw_text       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_opened_at INTEGER
);

-- Where the minutes came from. spoken_time (v2) stays the one total the headline reads.
CREATE TABLE IF NOT EXISTS spoken_activity (
  day        TEXT NOT NULL,                 -- engine localDay(at, tzOffsetMin), 'YYYY-MM-DD'
  activity   TEXT NOT NULL,                 -- cliff | repair | retell | echo | lyric | repeat | register | practice
  ms         INTEGER NOT NULL DEFAULT 0,
  utterances INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, activity)
);

-- Retell rounds (B3 stats and the profile).
CREATE TABLE IF NOT EXISTS retell_rounds (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id  TEXT NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  chapter   INTEGER,
  round     INTEGER NOT NULL,               -- 1, 2, 3
  lane_ms   INTEGER NOT NULL,               -- 60000 / 45000 / 30000
  words     INTEGER NOT NULL,
  spoken_ms INTEGER NOT NULL,
  wpm       REAL NOT NULL,
  pauses    INTEGER NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS retell_rounds_chapter ON retell_rounds (story_id, chapter, at);

-- Measured speaking speed per TTS voice, for tile widths.
CREATE TABLE IF NOT EXISTS voice_calibration (
  voice_id        TEXT PRIMARY KEY NOT NULL,
  ms_per_syllable REAL NOT NULL,
  samples         INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- Model file: download source and resumable state.
ALTER TABLE model_files ADD COLUMN url TEXT;
ALTER TABLE model_files ADD COLUMN revision TEXT;
ALTER TABLE model_files ADD COLUMN downloaded_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_files ADD COLUMN pause_state TEXT;            -- JSON DownloadPauseState (DownloadTask.savable())
ALTER TABLE model_files ADD COLUMN error TEXT;
```

### 4.2 Settings keys

One row per key in `settings`, with `DEFAULT_SETTINGS` applied when a key is missing or invalid:
`register` 'neutral', `regions` ['PR', 'CARIB'], `showExplicit` **true**, `textMode` 'auto',
`nativeLanguage` 'en', `targetLanguage` 'es', `onboarded` false, `startLevel` 'brandNew',
`nativeAnswersAllowed` true, `speechRateScale` 1, `onboardingStep` 'welcome', `voiceId` null,
`recognitionLocale` null, `allowNetworkRecognition` false, `allowCellularDownload` false,
`modelDeclined` false. A stored `speechRateBias` row from development builds is ignored.

### 4.3 Migrations (`app/src/storage/migrate.ts`, exists)

- `MIGRATIONS: readonly Migration[]` of `{ version, name, steps }`; `migrate(db, migrations)`
  reads `PRAGMA user_version`, refuses a database newer than the app (`SchemaTooNewError`), and
  runs each pending migration in its own transaction together with the version bump, re-checking
  the version inside the transaction, so a failed step leaves the previous version intact.
- Append-only. From Stage 2, `src/storage/migrate.test.ts` pins the SHA-256 of
  `JSON.stringify(steps)` for v1, v2 and v3, so editing a migration fails CI; a change is a new
  version. Never delete the database to recover from a failed migration.
- Lyrics are re-parsed lazily when `parser_version` differs from the current version
  (`LYRICS_PARSER_VERSION` once E8 lands, `lyricsVersion()` until then). Session snapshots with an
  unknown `version` are deactivated (the story resumes from its stored sentences), not crashed on.

### 4.4 Learner persistence

- Boot (exists, extended): `storage.learner.loadLearner({ priorFor })` restores the newest
  snapshot `LearnerModel.restore` accepts, with the prior rebuilt from its row's `prior`
  (`buildPrior(spec, packs)`; `priorSpecFor(settings.startLevel)` when the row has none), then
  replays the events logged after `through_event_id`, in log order. Deterministic: time comes
  from the events.
- Write: the controller opens one `storage.transaction(async (tx) => …)`, calls
  `tx.learner.record(learner, events)` and `tx.sessions.save(...)` inside it, plus the spoken time
  and chapter rows of the step.
- Checkpoint every 200 events, on app background and on session close; keep the last 3 (the
  repo's default).
- Placement: the placement session keeps `PlacementTracker.snapshot()` in its session snapshot;
  when it finishes, a learner snapshot is written with `prior = { kind: 'placement', placement }`
  and the session is deactivated.

## 5. Screens

### 5.1 Route map (`app/app/`, expo-router 58)

```
_layout.tsx                 Root Stack (exists, extended). Fonts, GestureHandlerRootView,
                            AppProviders (services, i18n), AppBootstrap (splash until storage,
                            settings and learner are ready), ShareIntentBridge, lifecycle wiring.
                            Stack.Protected guard={onboarded} / guard={!onboarded} (exists).
+native-intent.tsx          Share-extension deep link -> /music/share.
+not-found.tsx              (exists)
onboarding/
  _layout.tsx               Stack, no header, no back gesture on the first screen
  index.tsx                 Welcome: "Start the first story" (placement) | "I'm brand new"
  model.tsx                 1.1 GB disclosure, space check, Wi-Fi only switch, progress,
                            pause/resume, "Continue while it downloads", "Not now"
  voice.tsx                 Mic + speech permission, on-device check, voice pick and sample,
                            "más despacio" demo, hold practice with the six commands
  slang.tsx                 Register (neutral / street), regions (PR DO CU CO), explicit (ON)
(tabs)/
  _layout.tsx               Tabs (Story, Music); header with wordmark and ProfileButton (exists)
  index.tsx                 Story: ONE route; renders StoryScreen by screen.kind; "Bring a text"
                            entry in the header menu and on upNext
  music/
    _layout.tsx             Stack inside the Music tab
    index.tsx               C3 Your music
    [songId].tsx            Song page; ?mode=read (A3) | cliff (C1) | echo (B4)
    registers.tsx           C2 Two registers (?songId= optional)
    paste.tsx               Paste lyrics + clean-up preview (modal); ?songId=
    time.tsx                "Time it while you listen" (tap at each line start); ?songId=
    share.tsx               Confirm a shared song, then paste
text/
  paste.tsx                 Paste an article or transcript (modal)
  [textId].tsx              Read with surprise shading; multi-word cliffs (BroughtTextController)
retell.tsx                  B3; presentation fullScreenModal; gestureEnabled false while running
profile/
  _layout.tsx               Stack, presented as a modal from the corner button
  index.tsx                 Minutes spoken (headline), week, words understood, skill mix
  settings.tsx              Text mode, register, regions, explicit, speech speed, voice,
                            model (status, delete, download again), Apple Music, network
                            recognition (off), delete all lyrics and texts, reset progress, about
  licenses.tsx              Qwen3 Apache-2.0, llama.cpp MIT (via llama.rn), fonts OFL
  selftest.tsx              Hidden model self-test (tap the version 7 times)
(dev)/
  _layout.tsx               Stack.Protected guard={__DEV__ || preview env}
  preview/[screen].tsx      Fixture gallery for screenshots: main b1 b2 a2 b3 a3 c1 b4 c2 c3,
                            text, onboarding-*, profile, settings
```

Replaced scaffold files: `app/onboarding.tsx`, `app/profile.tsx` and `app/(tabs)/music.tsx`
become the directories above.

### 5.2 Screen, data source, components, preview

| Route | Preview | Data source | Components |
|---|---|---|---|
| `(tabs)/index`, kind `cliff`, mostly text | Main | `StoryController.screen` | `StoryHeader` (`MetaLine` with chapter spoken time, `TextModePill`), `WordFlow` (`TextWord`, `NewWordUnderline`, `CliffGap`), `GlossChip`, `CliffCard` (title, subtitle from `screen.subtitle`, `HoldButton`, ghost actions Type instead / Hear it again / Skip), `OptionsRung` (each option spoken and lit in turn; say it or tap it) or `HintRung` (hint spoken and shown) by rung, "Answer in English" chip |
| `(tabs)/index`, kind `cliff`, mostly tiles | B1 | same | `WordFlow` with `WordTile` (tap = hear, hold = see; age shades), live `CliffGap`, `FutureTile`, `TileHint`, `HoldArea` (dashed, rings, "Hold anywhere and say it"), `CommandChips` (Otra vez, Más despacio, No sé) |
| `(tabs)/index`, kind `landing` | B2 | same | `AnswerEcho`, `LandingHeadline`, `LandingLine` (candidates on a surprising → expected axis, answer as an ink pill), `LandingNote` ("About {n} times in 100"), `HoldArea` ("Hold anywhere, say the whole line"), `UnderstoodLine` (after that hold), `CommandChips` (Otra vez, ¿Qué significa?, Siguiente) |
| `(tabs)/index`, kind `repair` | A2 | same | `StoryHeader` ("Spoken today 5:03" from `spokenTodayUi(meta.todayMs)`), `SpeakerPrompt`, `YouSaid` + `HeatSentence` + `HeatLegend`, `RepairCard` (by phase: hinted shows "Expected: …" only; prompt_repair shows "One word surprised me" and Say it again / Show me the answer; show_answer shows the fix and `pair.explanations[explainKey]`), `UnderstoodLine` for the repeat, `UpNextCard` |
| `(tabs)/index`, kinds `noSe`, `nativeReply` | none | same | `NoSeView`, `NativeReplyView`, each with `UnderstoodLine` after the repeat |
| `(tabs)/index`, kinds `upNext`, `placementDone`, `loading`, `error` | none | same | `UpNextCard` (retell, next chapter, register step, or after the starter: review / retell / Music / download), `PlacementDoneView`, `ModelPreparingBanner`, `ErrorView` |
| `retell` | B3 | `RetellController` | `RoundHeader` (`retellRoundUi`, "Spoken today"), `RetellPrompt`, `Countdown`, `RetellLanes` (60/45/30 widths, word tiles, pause holes, live lane), `RetellStats` (`retellProgress`), hint "Say listo when you finish" |
| `music/[songId]?mode=read` | A3 | `LyricController.screen` (`read`) | `SongHeader` (artist · genre · region), `LyricLine` (slang underlines at segment offsets), `SlangNoteList`, `RegisterToggle`, `NowPlayingBar` (real player state) or `ManualModeNote`, primary "Sing the next word" |
| `music/[songId]?mode=cliff` | C1 | `cliff`, `result` | `MusicTitle` (Anton), previous line, `LyricLine` with gap, `ExplicitPill`, `SingItButton`, `OptionsSheet` ("Stuck? Show three options"), waiting line ("0:19 · the music waits for you"), `CommandChips` |
| `music/[songId]?mode=echo` | B4 | `echo` | `EchoTiles` (singer row uniform height, slang underlined, hold shows the note; learner row heights from own pitch; hollow = missed, tap plays it slowly), landed count (`echo.landed`), `HoldArea` ("Hold anywhere and sing it again"), `CommandChips` (Más despacio, Otra vez, Siguiente); subtitle from the player state ("stopped", never "playing" while stopped) |
| `music/registers` | C2 | `registers` | `RegisterPairCard` x2, `SwapList`, `RegisterPrompt` ("Your friend texts" + the line), "Say it street" / "Say it neutral" (`chooseRegister`), `HoldArea`, `RegisterResult` (understood, verdict, pointer to the neutral pair on a hint), footnote |
| `music/index` | C3 | `songs.list` + `MusicPlayer` library + auth status | `SourceRow` x3 (Apple Music "Manage" → Settings Apple Music section / Spotify "Show me" → `SpotifyHowToSheet` / Lyrics "Paste"), `ConnectAppleMusicCard` (on Android: "Apple Music is not available on Android yet"), `LibraryList` (monogram, title, artist · region · slang amount from `songSummary`), `RegionPills`, `ExplicitRow` |
| `music/paste` | none | `parseLyrics` | `PasteInput` (TextInput + `ClipboardPasteButton` where `Clipboard.isPasteButtonAvailable`, else a plain Paste button with `getStringAsync`), `PastePreview` (lines, slang notes, explicit count; delete lines) |
| `music/time` | none | `MusicPlayer.positionMs()` | `TapTimer` (tap per line, ±0.25 s nudge) |
| `music/share` | none | `ShareInbox` + `parseShared` | `SharedSongCard` (editable title, artist), unsupported notice, Apple Music match offer |
| `text/paste`, `text/[textId]` | text | `texts` repo, `BroughtTextController` | `PasteInput`, `WordFlow` with heat, `CliffCard`, landing views from the story |
| `onboarding/*` | none | `AppState` settings, `ModelManager`, `SpeechIn`, `SpeechOut` | `StartChoice`, `DownloadCard`, `PermissionCard`, `VoicePicker`, `HoldPractice`, `CommandPractice`, `RegisterChoice`, `RegionPills`, `ExplicitRow` |
| `profile/index` | none | `spokenStats` over `storage.spokenTime.log()`, learner, `retell` repo | `MinutesHeadline` (first heading), `WeekBars`, `VocabCard`, `SkillMix` |
| `profile/settings` | none | `AppState` settings, `ModelRuntime`, `MusicPlayer` | `SettingsRow` (exists), `SegmentedControl`, `RateStepper`, `VoicePicker`, `ModelCard`, `DangerRow` |

The previews have no tab bar; the app adds one, so screenshot comparison is side by side, not
pixel-exact.

### 5.3 Onboarding flow

1. **Welcome** (`/onboarding`): title, body, "Start the first story" (placement) or "I'm brand
   new". Sets `startLevel` (`placement` or `brandNew`).
2. **Model** (`/onboarding/model`): shows "Download the language model (1.1 GB)", free space, and
   a Wi-Fi only switch (on). On cellular without consent it waits for Wi-Fi. "Continue while it
   downloads" moves on at once; the download keeps going. "Not now" sets `modelDeclined` and
   moves on. If space is short it says how much is needed and also moves on. In every case the
   app stays usable: the story runs in canned mode and the Music tab in manual mode.
3. **Voice** (`/onboarding/voice`): asks for microphone and speech permission (with the reasons
   from the usage strings); checks on-device recognition for the pair entry's recognition
   locales (Android 13+: offers the offline model download); picks the best voice and plays a
   sample; practises "hold anywhere" and the six commands (otra vez, más despacio, no sé,
   siguiente, listo, ¿qué significa?). "Type instead" is offered if the mic is refused.
4. **Slang** (`/onboarding/slang`): neutral or street, regions (Puerto Rico preselected),
   explicit lyrics ON by default with a one-line note.
5. **Done**: `onboardingStep = 'done'`, `onboarded = true`; the guard moves to `/`. The story
   starts in canned mode if the model is not loaded yet (brand new: the starter scene;
   placement: starter plus probes) and switches to the model at the next sentence.

Re-entry: `onboardingStep` is stored after each screen, so a killed app resumes where it stopped.

### 5.4 Components (by folder)

- `src/ui/` (exists): `Text` (`ContentText`, `InterfaceText`, `MusicHeading`), `Button`, `Card`,
  `Pill`, `Screen`.
- `src/components/words/`: `WordFlow` (a wrapping row of word Views built from `FlowWord`s; it
  renders each word's `separatorAfter` exactly as in the source, which may be empty, and never
  inserts a space of its own), `TextWord`, `WordTile`, `HeatWord`, `NewWordUnderline`
  (react-native-svg dotted line), `CliffGap` (moved from `src/components/`), `FutureTile`,
  `GlossChip`, `UnderstoodLine` ("Understood {n} of {m} words" via `tUi`, missed words hollow).
- `src/components/voice/`: `HoldAnywhere` (root `GestureDetector`, shares the root gesture through
  context so tiles can `block` it), `HoldArea`, `HoldButton`, `ListeningRings` (Reanimated, off
  with reduce motion), `CommandChips` (key scheme of section 3.13).
- `src/features/story/`: `StoryScreen`, `StoryHeader`, `MetaLine`, `TextModePill`, `CliffCard`
  (exists, extended), `OptionsRung`, `HintRung`, `AnswerInNativeChip`, `TypeAnswerSheet`,
  `AnswerEcho`, `LandingHeadline`, `LandingLine`, `LandingNote`, `SpeakerPrompt`, `YouSaid`,
  `HeatSentence`, `HeatLegend`, `RepairCard`, `AnswerReveal`, `UpNextCard`, `NoSeView`,
  `NativeReplyView`, `PlacementDoneView`, `ModelPreparingBanner`, `ErrorView`.
- `src/features/retell/`: `RetellScreen`, `RoundHeader`, `RetellPrompt`, `Countdown`,
  `RetellLanes`, `RetellStats`.
- `src/features/music/`: `SourceRow` and `RegionPills` (exist), `ExplicitRow`,
  `ConnectAppleMusicCard`, `SpotifyHowToSheet`, `LibraryList`, `SongHeader`, `LyricLine`,
  `SlangNoteList`, `RegisterToggle`, `NowPlayingBar`, `ManualModeNote`, `MusicTitle`,
  `ExplicitPill`, `SingItButton`, `OptionsSheet`, `EchoTiles`, `RegisterPairCard`, `SwapList`,
  `RegisterPrompt`, `RegisterResult`, `PasteInput`, `PastePreview`, `TapTimer`,
  `SharedSongCard`.
- `src/features/text/`: `TextPasteScreen`, `TextReader`.
- `src/features/profile/`: `SettingsRow` (exists), `MinutesHeadline`, `WeekBars`, `VocabCard`,
  `SkillMix`, `SegmentedControl`, `RateStepper`, `VoicePicker`, `ModelCard`, `DangerRow`.
- `src/features/onboarding/`: `StartChoice`, `DownloadCard`, `PermissionCard`, `HoldPractice`,
  `CommandPractice`, `RegisterChoice`.

### 5.5 Gestures and accessibility

- Hold anywhere: `useLongPressGesture({ minDuration: 120, maxDistance: 10000,
  shouldCancelWhenOutside: false, runOnJS: true })`; `onBegin` warms the recognizer,
  `onActivate` starts listening, `onFinalize(e)` aborts if `e.canceled`, else stops.
- Tiles: `useExclusiveGestures(tileHold, tileTap)`, each with `block: rootHold`, so holding a
  tile reveals it instead of speaking. Buttons and Pressables take the touch first (check on a
  device).
- A tile's accessibility label is "word {n}", never the word. `HoldArea` has
  `accessibilityRole="button"` and an `activate` action that toggles listening (VoiceOver users
  cannot hold anywhere); "Type instead" is always present.
- Haptics: `play('tap')` when listening starts, `play('selection')` when it stops.
- Dynamic Type: `maxFontSizeMultiplier` about 1.3 on content, 1.2 on dense chrome.

## 6. Build stages (step 4)

| Stage | Goal | Ends with |
|---|---|---|
| 0. Secure inputs | Commit the design previews, research notes, llama.rn patch, `JSIScore.h` and the patch check script from the scratchpad, before anything else | `designPreviews`, `research` and static `llamaPatch` tests pass |
| 1. Root, harness, contracts | Scripts-only root package, CI script, Metro/jest/tsconfig edits (test-code blocklist, deep engine mapping, web jest project), clock timers, `Store<T>`, pairs registry (replaces `PacksProvider`), `tUi`, engine key list, contrast check, import, no-space and no-accent-score rules, engine API test, web screenshot harness | tsc, jest, web export + Playwright gates for `/`, `/music`, `/profile`, expo-doctor |
| 2. Storage extension | Migration v3, `Storage.transaction`, three new repositories and the additions to the existing ones, new settings keys, `PriorSpec` on snapshots, minutes spoken through the engine's rule, pinned migration hashes | Storage suites green on sql.js and the fake expo-sqlite connection; hashes pinned |
| 3. Adapters | llama.rn + patch, model adapter (native and fallback), priority queue, model runtime, download manager, preview runtime, self-test logic; speech in additions and `ExpoSpeechIn`; speech out helpers; audio coordinator; music player additions + musickit module; share bridge + `parseShared`; cliffword-device module; device info and lifecycle; `app.config.ts` and config plugins; `nativeAdapters.ts` | Unit suites green; `llama:check`; `expo export` iOS and Android; `prebuild:check`; autolinking lists both local modules; optional real-model self-test |
| 4. Story tab | Events table, utterance, spoken time, listening machine, story steps (canned, placement, model), story and retell controllers, brought text, layout functions, word and voice components, story screens, retell and text routes, fixture gallery, story flows | Component, controller, levels, placement and flow tests; screenshots of Main, B1, B2, A2, B3 and the text fixture pass the gates |
| 5. Music tab | Lyric controller (cliff, echo, registers), song ids, library, song summary, lyrics version, Music stack routes, paste and timing, share route and native intent, music components | Music flow tests (paste → cliff → echo; registers; share-in with no network; Apple Music states); screenshots of A3, C1, B4, C2, C3 |
| 6. Onboarding, profile, settings | Onboarding stack (both starts, declined download), profile and settings, licenses, self-test screen, pseudo-locale sweep, other-pair flow | Guard, onboarding, profile and other-pair flows; pseudo-locale test; screenshots of onboarding and profile |
| 7. Store setup and release checks | Privacy manifest, `eas.json`, store metadata, `STORE.md`, `PRIVACY.md`, `DEVICE-CHECKLIST.md`, store assets, reference renders and contact sheet, web smoke test, final prebuild check | Everything in section 8 passes here |
| 8. Device builds (user approval) | EAS development builds on a real iPhone and Android phone, self-test, device checklist, then preview and production builds and store submission | `docs/DEVICE-CHECKLIST.md` rows pass on devices; cannot run here |

**Order.** Stage 0 comes first, as one commit. Stages 1 to 3 need nothing from the engine beyond
what is in the tree. Stage 4 uses E1, E2 and E7 when they have landed and the fallbacks of
section 3.0 otherwise, so it does not wait; Stage 5 does the same with E8 and E12. Only the
guard, profile, settings, licenses and self-test parts of Stage 6 can move ahead of Stages 4 and
5 (onboarding's "done" step then lands on the existing placeholder story); the onboarding flow
needs Stage 4's canned mode and the profile flow reads retell rows. Stage 7 needs Stages 4 and 5:
its smoke test drives the story and the Music tab, and `routes.json` lists their fixtures.

**Gates.** An app stage ends when app tsc passes (it typechecks every engine file reachable from
`engine/src/index.ts`), app jest passes (including `engineApi.test.ts`), and the stage's own
commands in section 8.1 pass. The full engine check (engine tsc + vitest) runs at engine
checkpoints, not as an app gate: other agents edit the engine concurrently, and during review on
2026-11-15 engine tsc was briefly red on `test/real-engine.test.ts` (TS2345, `Set<string>` vs
`readonly string[]`) while vitest passed 1480/1480; it was green again later that day. Each
stage's commit message records the engine commit it was verified against
(`git log -1 --format=%H -- engine`).

### 6.1 Packages added per stage

Install with `npx expo install <name>` (it picks the SDK 58 version) unless the table says exact.

| Stage | Package | Version | Note |
|---|---|---|---|
| installed | expo-haptics, expo-speech, expo-sqlite, sql.js, react-native-gesture-handler, react-native-reanimated, react-native-worklets | ~58.0.8, ~58.0.4, ~58.0.17, ^1.16.0, ~3.3.0, 4.7.1, 0.13.0 | already in `app/package.json` |
| 1 | expo-system-ui | ~58.0.7 | Android honours `userInterfaceStyle: light` |
| 3 | llama.rn | **0.13.0-rc.11 exact** | the patch is version-specific |
| 3 | patch-package (dev) | ^8 | `"postinstall": "patch-package"` |
| 3 | expo-file-system | ~58.0.13 | `DownloadTask`, `digest('SHA-256')`, `File#bytes()` |
| 3 | expo-network | ~58.0.5 | cellular check |
| 3 | expo-device | SDK 58 | total memory for the tier |
| 3 | expo-localization | ~58.0.5 | device locales and time zone for `DeviceInfo` |
| 3 | expo-speech-recognition | **58.0.1 exact** | third-party, not in the SDK list |
| 3 | expo-share-intent | **9.0.0 exact** | peer `expo ^58`; needs `scheme`; peers expo-constants >= 58.0.12 and expo-linking >= 58.0.13 (installed ~58.0.16 and ~58.0.17) |
| 3 | expo-build-properties | ~58.0.12 | iOS deployment target 17.0 |
| 4 | react-native-svg | 15.16.0 | dotted underline, charts |
| 5 | expo-clipboard | ~58.0.4 | `ClipboardPasteButton` only where `Clipboard.isPasteButtonAvailable` (not Android or web); else a plain Paste button with `getStringAsync` |
| none | Playwright | 1.63.0, global | in `/opt/node22/lib/node_modules`, browsers in `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (chromium-1243); scripts are `.cjs` and run with `NODE_PATH=$(npm root -g)` (Node's ESM resolver ignores `NODE_PATH`, so `.mjs` scripts cannot find it); not an app dependency |

`RNLLAMA_SKIP_POSTINSTALL=1` is exported by `scripts/ci.sh` and by the root `ci` script for every
local and CI install, so installs never download the iOS xcframework or the Android jniLibs (the
jniLibs are unused anyway: rc.11's `android/gradle.properties` sets
`rnllamaBuildFromSource=true`). It is never set in `eas.json`: EAS must download the
xcframework.

## 7. File-by-file task list

Paths are relative to the repository root. "(exists)" marks files that stay; "(edit)" marks
changes to existing files. Every test path is relative to `app/` unless it starts with `engine/`
or the root. Component tests are `*.test.tsx` next to the component.

### Stage 0: secure inputs (one commit, before Stage 1)

Source paths are in the session scratchpad (`$SCRATCH`). Nothing in later stages may depend on a
path under `/tmp`.

| Path | Contents | Test that proves it done |
|---|---|---|
| `docs/design-previews/{Main,A2-Ink-Repair,A3-Ink-Song,B1-Voice-Cliff,B2-Voice-Landing,B3-Voice-Retell,B4-Voice-Echo,C1-Tarima-Lyric,C2-Tarima-Register,C3-Tarima-Music}.dc.html`, `canvas.json` | Copied from `$SCRATCH/design/project/` | `__tests__/docs/designPreviews.test.ts`: all ten and `canvas.json` exist; each has a `<title>` |
| `docs/design-previews/README.md` | What each preview shows; `support.js` is missing and is stubbed by the reference-shot server; the previews load Inter and Newsreader from Google Fonts; the B4 singer-pitch note | same test: the README names all ten files |
| `docs/research/{app-architecture,device-speech,music-share-store}.md` | Copied from `$SCRATCH/outline/`, each with a first line pointing to section 1.3 for the decisions this outline overrode | `__tests__/docs/research.test.ts`: the three files exist and carry that line |
| `app/native/llama-score/JSIScore.h` | Copied from `$SCRATCH/outline/JSIScore.h`; the source of truth the patch is regenerated from after a llama.rn upgrade | `__tests__/native/llamaPatch.test.ts` (static part): the patch's `cpp/jsi/JSIScore.h` hunk equals this file |
| `app/patches/llama.rn+0.13.0-rc.11.patch` | Copied from `$SCRATCH/outline/` (harmless until Stage 3: nothing reads `patches/` before patch-package and llama.rn are installed together) | same test: the file exists and touches only `cpp/jsi/JSIScore.h` and `cpp/jsi/RNLlamaJSI.cpp` |
| `app/scripts/check-llamarn-patch.sh` | Copied from `$SCRATCH/outline/` and made self-contained and check-only: `npm pack llama.rn@0.13.0-rc.11` into a `mktemp -d` as `orig/`, copy to `patched/`, `patch -p1` with the committed patch, then the compiles and checks of Stage 3. It never writes to `patches/` and reads nothing under `/tmp/claude-0` | `bash -n`; `grep -L /tmp/claude-0` on the script; run in Stage 3 |

### Stage 1: root, harness, contracts

| Path | Contents | Test that proves it done |
|---|---|---|
| `package.json` (root, new) | `private`; scripts `ci` (`RNLLAMA_SKIP_POSTINSTALL=1 npm --prefix engine ci && RNLLAMA_SKIP_POSTINSTALL=1 npm --prefix app ci`), `check` (app `check`), `check:engine` (engine `check`), `preview:shots`; no `workspaces` | `npm run check` at the root exits 0 |
| `.nvmrc` (new) | `22` | `scripts/ci.sh` stops with a clear message on Node < 22 |
| `scripts/ci.sh` (new) | Exports `RNLLAMA_SKIP_POSTINSTALL=1`; Node check; Playwright check (`require.resolve('playwright')` from `$(npm root -g)` and a `chromium-*` folder in `$PLAYWRIGHT_BROWSERS_PATH`, else a clear message and exit 1); app `npm ci`, `tsc`, jest, `expo export` (ios, android, web), `expo-doctor`, `preview:build`, `preview:shots`; `--engine` adds the engine `npm ci` + `npm run check`; later stages append `llama:check`, `prebuild:check`, `preview:smoke` | Runs to exit 0 in this container |
| `.github/workflows/ci.yml` (new, optional) | Runs `scripts/ci.sh` on Node 22 | Needs the user's GitHub remote; the script itself is the check |
| `app/package.json` (edit) | Scripts `check` (tsc + jest), `preview:build` (`EXPO_PUBLIC_CLIFFWORD_ENV=preview expo export --platform web --output-dir dist-web`), `preview:shots` (`node e2e/shots.cjs`); add expo-system-ui | `__tests__/config/packageJson.test.ts`: every `expo-*` dependency is on 58.x except an exemption map `{ 'expo-share-intent': '9.0.0' }`; exact pins are asserted only for packages present (llama.rn 0.13.0-rc.11 and expo-speech-recognition 58.0.1 from Stage 3); expo-share-intent's peers satisfied when present; RNGH ~3.3; reanimated 4.7.1; none of zustand, react-native-tts, @lomray/react-native-apple-music, @wwdrew/expo-apple-music, victory-native, @shopify/react-native-skia, react-native-spotify-remote, `@spotify/*`, or an analytics or crash SDK (`@sentry/*`, `@react-native-firebase/*`, `expo-insights`, `@segment/*`) |
| `app/tsconfig.json` (edit) | Exclude `e2e/out`; `paths` adds `"@cliffword/engine/*": ["../engine/*"]` | `npx tsc --noEmit` passes; `__tests__/importGraph.test.ts` (exists) also checks that the graph from `engine/src/index.ts` reaches no file importing `vitest` or `node:*` |
| `app/metro.config.js` (edit) | blockList adds `app/src/**/testing/**`, `src/services/testServices.ts`, `*.test.ts(x)` and `engine/src/model/contract.ts`. No `wasm` asset ext, no COOP/COEP middleware | `__tests__/config/metro.test.ts`: the blockList matches `src/testing/x.ts`, `src/storage/testing/x.ts` and the other three, and not `engine/src/index.ts`, `src/services/index.ts` or a `node_modules/**/testing/**` file |
| `app/jest.config.js` (edit) | `moduleNameMapper` adds `'^@cliffword/engine/(.*)$': '<rootDir>/../engine/$1'`; `projects`: the existing iOS project (now ignoring `*.web.test.*`), plus a `jest-expo/web` project limited to `**/*.web.test.ts(x)` | `src/storage/open.web.test.ts` (new, web project): opens sql.js storage and migrates; `src/theme/useAppFonts.web.test.ts` (new) |
| `app/babel.config.js` (exists) | `babel-preset-expo` only; it strips the engine's TypeScript and adds the worklets plugin for Reanimated 4 | `__tests__/engine.test.ts` (exists) imports the engine through jest; `expo export` bundles it |
| `app/eslint.config.js` (exists, edit) | `eslint-config-expo/flat`; ignore `e2e/out`, `dist-*`; `no-restricted-imports` mirrors rule 1 of section 2.1 for editors | `npx expo lint` exits 0 |
| `app/app.json` (exists) | Static config: name, slug, owner, scheme, icons, iOS usage strings, Android permissions and blocked permissions, splash, embedded fonts by literal `./node_modules/...` paths, EAS projectId | `__tests__/config/appConfig.test.ts` (from Stage 3) reads it through `getConfig` |
| `app/jest.setup.ts` (edit) | RNGH `jestSetup`; `require('react-native-reanimated').setUpTests()` | `src/testing/gesture.test.tsx`: a `GestureDetector` with `useLongPressGesture` fires `onActivate` and `onFinalize` through `createGestureController` |
| `app/src/adapters/clock/{types,systemClock,FakeClock}.ts` (edit) | `Clock.setTimeout`; `FakeClock.advance(ms)` runs due timers in time order | `src/adapters/clock/FakeClock.test.ts`: timers fire in order; cancel works; a timer set inside a timer fires in the same `advance` when due |
| `app/src/services/store.ts` | `Store<T>`, `useStore`, `useStoreSelector` | `src/services/store.test.ts`: one notification per change; `Object.is`-equal values ignored; unsubscribe works; `renderHook` re-renders on `set` |
| `app/src/services/pairs.ts` | `PairEntry`, `PairRegistry`, `EN_ES`: packs from `createDefaultSpanishPack`/`createDefaultPairPack`; recognition [es-US, es-MX, es-ES], TTS [es-US, es-MX, es-419, es-ES] with CO → es-CO first; `nativeLocale` en-US; section words; share phrases; `wordSeparator` ' ' | `src/services/pairs.test.ts`: same packs object for the same (id, regions); an unknown id throws; registers a stub `zh-ja` pair (a segmenter that splits '私は学生です' into 私/は/学生/です with no spaces, a tiny lexicon, `wordSeparator` '') and a stub `es-en` pair; both build, and the stub pack segments '私は学生です' into four segments whose offsets leave no gap |
| `app/src/services/{types,defaults,nativeServices,webServices,testServices}.ts` (edit) | `pairs` member; `packs` = `pairs.packs(activePair)`; `defaults.ts` keeps `sharedMockModel` only | `src/services/Services.test.ts` (exists) still passes; `createTestServices({ pairs })` override works |
| `app/src/engine/PacksProvider.tsx` (delete), `app/src/providers/AppProviders.tsx` (edit) | `I18nProvider` fed from `services.packs.pair.ui` | `__tests__/routes/routes.test.tsx` (exists) still passes |
| `app/src/i18n/tUi.ts` | `tUi(t, uiText)` | `src/i18n/tUi.test.ts`: key and params resolve, `pair.ui` first, a missing key returns the key |
| `app/src/i18n/engineKeys.ts`, `app/src/i18n/catalog/en.ts` (edit) | `ENGINE_UI_KEYS` until E11 (`stats.understood`, `stats.spokenToday`, `retell.round`, `repair.prompt`, `repair.expected`, `repair.fix`, `cliff.repeatAloud`, `echo.landed`, `lyrics.answer.*`, `slang.formality.*`, `slang.explicit`, `slang.region`, `region.*`); English values for the keys `pair.ui` lacks (`echo.landed`, `lyrics.answer.*`), `command.<id>.gloss` for all six commands, `cliff.wordRange` | `__tests__/i18n/engineKeys.test.ts`: every entry (the engine's `UI_KEYS` once E11 lands) resolves through `tUi` via `pair.ui` or `catalogs.en`, with matching `{placeholders}` |
| `app/src/theme/contrast.ts` | `contrastRatio(fg, bg)` (WCAG 2) | `src/theme/contrast.test.ts`: muted on ground ≥ 4.5; accent on white and on ground ≥ 4.5; ink on heat1, heat2, heat3 ≥ 7 |
| `app/__tests__/config/importRules.test.ts` | Scans `app/app/**` and `app/src/**` (non-test files): native capability packages only in the files of rule 1; rule 2; rule 3 from Stage 3 | itself; it passes on the existing tree on day one (`ExpoHapticsAdapter`, `ExpoSpeechOut`, `open.ts`, `open.web.ts`, `sql/sqljs.ts` are on the list) and grows as stages add files |
| `app/__tests__/config/noSpaceSplit.test.ts` | Scans `src/**` and `app/app/**` outside tests for `.split(' ')`, `.split(/\s+/)`, `.split(/ +/)` and `.join(' ')`; an allowlist of chrome-only files (each with a reason) | itself |
| `app/__tests__/i18n/noAccentScore.test.ts` | No value in the app catalogs or `pair.ui`, and no field name in `src/session/**/types.ts`, matches `/accent\|pronunciation\|score %/i` | itself |
| `app/__tests__/engine/engineApi.test.ts` | Every name of section 3.0 imported and checked defined (functions with `typeof`) | itself |
| `app/e2e/serve.cjs` | Static server for `dist-web` with SPA fallback | `node --test e2e/serve.test.cjs`: a deep route returns `index.html` |
| `app/e2e/shots.cjs`, `app/e2e/routes.json` | Playwright (`require('playwright')`) at 390x844, DPR 2. Per route: wait for `document.fonts.ready`, save `e2e/out/<name>.app.png`. Gates: no page errors; Newsreader, Inter and Anton loaded; no horizontal overflow; listed test ids fully inside the viewport; tab labels not clipped | `npm run preview:shots` exits 0 for `/`, `/music`, `/profile` |

### Stage 2: storage extension

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/src/storage/schema.ts` (edit) | Append v3 (section 4.1) | `src/storage/migrate.test.ts` (exists, extended): 0 → 3 on an empty database; 2 → 3 on a v2 database with rows (rows survive, defaults filled); every v3 table and index in `sqlite_master`; a failing v3 step rolls back to 2; the SHA-256 of each migration's steps equals its pinned value |
| `app/src/storage/storage.ts` (edit) | `Storage.transaction`; `retell`, `voices`, `texts` repositories | `src/storage/storage.test.ts` (new): writes in `learner`, `sessions` and `spokenTime` inside one transaction commit together and roll back together on a throw; a call on the outer database during the transaction waits for it |
| `app/src/storage/repos/learner.ts` (edit) | `prior` column; `loadLearner({ priorFor })` | `repos/learner.test.ts` (exists, extended): a snapshot saved with `{ kind: 'placement' }` restores with that prior; a row without a prior falls back to `priorSpecFor`; restored `pKnown` equals the live model's for every key and skill |
| `app/src/storage/repos/stories.ts` (edit) | Pair, register, regions; chapters; chapter spoken ms | `repos/stories.test.ts`: chapter spoken ms sums; chapters cascade on story delete |
| `app/src/storage/repos/sessions.ts` (edit) | `refId`; one active session per kind and ref | `repos/sessions.test.ts`: lyric sessions for two songs are both active; a second one for the same song deactivates the first |
| `app/src/storage/repos/songs.ts` (edit) | New columns, `touch`, recent-first list | `repos/songs.test.ts`: `isExplicit` round-trips as a boolean; genre, region and ISRC round-trip; remove cascades to lyrics |
| `app/src/storage/repos/lyrics.ts` (edit) | Parser version, origin, timings, `deleteAll` | `repos/lyrics.test.ts` |
| `app/src/storage/repos/spokenTime.ts` (edit) | `addUtterance(creditedMs, at, tzOffsetMin, activity)` writes `spoken_time` and `spoken_activity` in one call; `log()`; `byActivity`; `today`/`streak` removed | `repos/spokenTime.test.ts`: two adds on one day sum; a tz offset of -300 puts 03:00 UTC on the previous local day; `log()` fed to `spokenStats` gives today, total and streak |
| `app/src/storage/repos/modelFiles.ts` (edit) | New columns; status `'paused'` | `repos/modelFiles.test.ts` |
| `app/src/storage/repos/{retell,voices,texts}.ts` (new) | Section 3.8 | tests next to each: round trips; voice running mean; text touch and remove |
| `app/src/storage/repos/settings.ts` (edit) | New keys (section 3.9); `speechRateScale` replaces `speechRateBias` | `repos/settings.test.ts` (exists, extended): defaults; `speechRateScale` clamped to 0.5–1.25; invalid values fall back; a stored `speechRateBias` row is ignored |
| `app/src/storage/day.ts` (delete) | Day keys come from the engine's `localDay` | suite passes without it |
| `app/src/learner/prior.ts` (edit) | `PriorSpec`, `buildPrior`, `priorSpecFor` | `src/learner/prior.test.ts` (exists, extended): brandNew gives cognates a high prior and other words the default; a placement spec round-trips through `PlacementTracker.snapshot()`/`restore()` |
| `app/src/bootstrap/bootstrap.ts`, `app/src/appState/AppStateProvider.tsx` (edit) | `loadLearner({ priorFor })` with packs from `pairs.packs(pairId)` of the settings; `AppState` gains `packs` and `pair` | `src/bootstrap/bootstrap.test.ts` (exists, extended): a stored placement prior is used at boot; settings naming a registered stub pair boot with that pair's packs. `AppStateProvider.test.tsx` (exists, extended): changing `targetLanguage` swaps `packs` |

### Stage 3: adapters

**Model**

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/package.json` (edit) | `"llama.rn": "0.13.0-rc.11"`, `patch-package`, `"postinstall": "patch-package"`; scripts `llama:check`, `prebuild:check`, `test:real`; the Stage 3 packages of table 6.1 | `__tests__/native/llamaPatch.test.ts` (install part, active once llama.rn is a dependency, so the Stage 0 run stays green): installed llama.rn version equals the patch's; `JSIScore.h` exists under `node_modules/llama.rn/cpp/jsi/`; `RNLlamaJSI.cpp` contains the registration; packageJson test (exact pins now present) |
| `app/scripts/check-llamarn-patch.sh` (from Stage 0) | Check-only. In a `mktemp -d`: `npm pack llama.rn@0.13.0-rc.11` → `orig/`, copy → `patched/`, `patch -p1 --dry-run` then apply the committed patch; syntax-check the patched `RNLlamaJSI.cpp` with g++ and clang++ (C++17 and C++20) in source mode; download `llama-rn-ios-xcframework.tar.gz` for v0.13.0-rc.11 from GitHub releases, verify SHA-256 `97685348d61e87dd07882b09b3c6516b1268883a9e153a68f0f7cb47938e7a9b` (from `install/native-artifacts.json`), compile in framework mode against its `ios-arm64/rnllama.framework/Headers`, and run `llvm-nm -gU` to assert every `llama_*`/`common_*` symbol `JSIScore.h` references is defined | `npm run llama:check` exits 0; `git status --porcelain app/patches` is empty afterwards |
| `app/src/adapters/model/types.ts`, `descriptor.ts` (edit) | Sections 3.1 and 3.2: `ModelSpec`, `isCalibratedFor`, the `ModelManager` additions, `RuntimeStatus` | `src/adapters/model/descriptor.test.ts`: bytes; 64-hex SHA-256; the URL and every mirror hold the pinned revision; start text; `calibratedFor` is `['es']`; `FALLBACK_CANDIDATE` (Qwen3-0.6B Q4_K_M, 396,705,472 B, `calibratedFor: []`) is never offered |
| `app/src/adapters/model/contextParams.ts` | `memoryTier(totalBytes)`, `contextParamsFor` | `contextParams.test.ts`: 4 GB → 1024 / 256 / q8_0 (flash 'on' on iOS); 8 GB → 2048 / 512 / f16; Android → 0 GPU layers, flash off; iOS without GPU → `noExtraBufts` |
| `app/src/adapters/model/nativeScore.ts` | `tokenScoresFromNative`, `candidatesFromNative` | `nativeScore.test.ts`: maps fields; throws when pieces do not rebuild the text or offsets are not contiguous; drops `partial` candidates and returns k |
| `app/src/adapters/model/forcedDecoding.ts` | `gbnfLiteral`, `tokenScoresFromForcedDecoding`, `isWholeText`, `sanitizeSpecial` | `forcedDecoding.test.ts`: escapes quotes, backslash, newline; exact value when listed, 50th value with `upperBound` when not; `byte: \xC3` + `\xA1` merge into "á" with correct offsets; EOS steps dropped; `<\|` in a context is broken up |
| `app/src/adapters/model/LlamaModelAdapter.ts` | `createLlamaModelAdapter` over a `LlamaBinding`; implements `ModelAdapter` (`info.backend 'llama.rn'`) | `LlamaModelAdapter.test.ts` with `fakeBinding` over `createMockModel()`: native path equals the mock for 20 calls; start token from tokenizing `<\|im_end\|>` (throws if not one token); fallback used without `scoreText` and marks upper bounds; calls never overlap in the binding (the fake throws "Context is busy" if they do); `generate` makes n sequential calls with seed + i |
| `app/src/adapters/model/llamaBinding.ts`, `llamaGlobals.d.ts` | The only llama.rn import: `initLlama` with section 3.1 params, `tokenize`, `completion`, `stopCompletion`, `release`, `global.llamaScoreText` bound to the context id; the global's declaration | importRules test; `tsc` against llama.rn's types; behaviour on device (Stage 8, rows L1–L4) |
| `app/src/testing/fakeBinding.ts` | `LlamaBinding` over any `LanguageModel`, with busy detection and a `scoreText` switch (jest only) | adapter test |
| `app/src/adapters/model/priorityQueue.ts` | Two-level queue with cancellation | `priorityQueue.test.ts`: interactive goes before queued prefetch; a running prefetch job gets `onCancel`; FIFO within a level; a rejected job does not stall the queue |
| `app/src/adapters/model/ModelRuntime.ts` | `createModelRuntime({ manager, adapter, device, lifecycle })` | `ModelRuntime.test.ts` with `MockModelAdapter` and `FakeModelManager`: ready → loading → loaded; `model()` null before load; background → generation stopped, in-flight call awaited, new calls rejected until resume; memory warning → unload, next call reloads; load failure → `error`; iOS without GPU → reload with `noExtraBufts`; `declined` reflects `settings.modelDeclined` |
| `app/src/adapters/model/previewModelRuntime.ts` | `createPreviewModelRuntime()` over `MockModelAdapter` + `FakeModelManager('ready')` (outside `src/testing`, so the web preview may import it) | `previewModelRuntime.test.ts`: status `loaded { nativeScoring: false, gpu: false }`; `model('interactive')` scores; importRules asserts `nativeServices.ts` and `nativeAdapters.ts` never import it |
| `app/src/adapters/model/ports.ts` | `ModelFilesPort`, `NetworkPort`, `DownloadHandle`, `DownloadPauseState` | `tsc` |
| `app/src/adapters/model/ModelManager.ts` | `createModelManager` (flow F) | `ModelManager.test.ts` with `MemoryFiles`, fake network, `FakeClock`, test storage: plan (space, consent); cellular without consent refused; progress in state; pause stores `pause_state`; recover after a simulated kill resumes; size mismatch → delete, one retry, then `error`; hash mismatch → `error`; success → renamed, `excludeFromBackup` called, `ready`; a switch to cellular pauses |
| `app/src/adapters/model/FakeModelManager.ts` (edit) | `plan`, `pause`, `resume`, `recover`, `'paused'`; scripted plans (no space, cellular) | `FakeModelManager.test.ts` (exists, extended) |
| `app/src/adapters/model/expoModelFiles.ts` | expo-file-system (`Directory`, `File`, `DownloadTask` with `sessionType: 'background'`, `digest('SHA-256')`, `Paths.availableDiskSpace`), expo-network, cliffword-device | `expoModelFiles.test.ts` with the three modules mocked: calls and arguments |
| `app/src/adapters/model/memoryFiles.ts` | In-memory `ModelFilesPort` and `NetworkPort`; downloads advance on the clock | ModelManager tests; own test of progress ticks |
| `app/scripts/make-proof-fixture.cjs`, `app/src/adapters/model/proofFixture.ts` | Ten proof pairs with sentence totals from `proof/raw_qwen3-1.7b.json` | `proofFixture.test.ts`: totals equal sums recomputed from the raw file |
| `app/src/adapters/model/selfTest.ts` | `runSelfTest(model, stats)`: pairs within 0.15 nats; offsets for `¿Qué? ¡Sí! está niño 🎵`; `n_reused` on a repeat; " calor" first after "En la playa hacía mucho" | `selfTest.test.ts`: report shape and pass/fail with the mock and with a perturbed model; optional `npm run test:real` (below) |

`test:real` (optional, not a gate): `python3 -m venv "$SCRATCH/venv-real" && "$SCRATCH/venv-real/bin/pip"
install llama-cpp-python numpy`; download the pinned GGUF
(`https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf`,
1,107,409,472 bytes, SHA-256 `b139949c…1897`, checked against the Hugging Face API) into the
scratchpad; run `proof/model_server.py --model <path> --port 8765`; then the self-test runs
against `HttpLanguageModel` (imported by deep path until E6). The script documents these steps;
the only existing venv with llama-cpp-python is under `/tmp` and is not relied on.

**Speech and audio**

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/src/adapters/speechIn/types.ts` (edit) | Section 3.4 additions | `tsc` |
| `app/src/adapters/speechIn/vad.ts` | `voicedMs`, `silentRuns` over dBFS levels | `vad.test.ts` with synthetic levels: floor from the first 300 ms; 250 ms hangover joins runs; runs under 120 ms dropped; 400 ms silences found |
| `app/src/adapters/speechIn/wav.ts` | `readWav`: format 1 (16-bit PCM), format 3 (float32) and `WAVE_FORMAT_EXTENSIBLE` | `wav.test.ts`: synthetic round trips for all three; mono and stereo; a non-WAV file rejected |
| `app/src/adapters/speechIn/pitch.ts` | `pitchTrack` (YIN, 10 ms hop, lags for 70–1000 Hz), `pitchPerWord` | `pitch.test.ts`: 220 Hz sine → 220 ± 3 Hz at 16 kHz and 48 kHz; silence → null; per-word medians |
| `app/src/adapters/speechIn/FakeSpeechIn.ts` (edit) | Scripted alternatives, levels, word timings and an audio fixture; `readAudio` returns fixture bytes | `FakeSpeechIn.test.ts` (exists, extended) |
| `app/src/adapters/speechIn/ExpoSpeechIn.ts` | `ExpoSpeechRecognitionModule.start` with `lang`, `interimResults: true`, `continuous: true`, `requiresOnDeviceRecognition`, `addsPunctuation: false`, `maxAlternatives: 3`, `contextualStrings` (from `hints`), `iosTaskHint: 'dictation'`, `iosCategory` (playAndRecord; defaultToSpeaker, allowBluetoothA2DP; mode default), `volumeChangeEventOptions` 50 ms, `androidIntentOptions.EXTRA_MASK_OFFENSIVE_WORDS: false`, `recordingOptions: { persist, outputSampleRate: 16000, outputEncoding: 'pcmFormatInt16' }` when `persistAudio`; latched mode restarts an early-ended task; Android word ends estimated; `readAudio(uri)` = `new File(uri).bytes()` then delete | `ExpoSpeechIn.test.ts` with the module and expo-file-system mocked: exact options; final transcript with alternatives and levels; `abort()`; latched restart joins transcripts with offset times; on-device unavailable gives `language-not-supported` with no silent network fallback; `readAudio` reads then deletes |
| `app/src/adapters/speechOut/voices.ts` (edit), `rate.ts` (new) | `chooseVoice`; `effectiveRate`, `slower`, per-platform factors | `voices.test.ts`: locale order; enhanced over default; local over network; offline-only drops network voices; stable on ties. `rate.test.ts`: 0.8 steps, floor 0.5 |
| `app/src/adapters/speechOut/voiceTiming.ts` | `msPerSyllableFrom(boundaries, text, pack)` (syllables from `estimateDurations`' counter) | `voiceTiming.test.ts`: mean of boundary gaps; outliers dropped |
| `app/src/adapters/audio/AudioCoordinator.ts` | Section 3.5 | `AudioCoordinator.test.ts` with a fake port and `FakeMusicPlayer`: `forMic` resolves only after the state is `paused`; never resumes; `forPlayback` sets the playback category; `enterStory` sets the exact Story category; an interruption goes to `idle` and calls back |
| `app/src/adapters/audio/expoAudioSession.ts` | `setCategoryIOS`, `setAudioSessionActiveIOS` from expo-speech-recognition; no-op off iOS | `expoAudioSession.test.ts` |

**Music**

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/src/adapters/music/types.ts` (edit) | Section 3.6 additions | `tsc` |
| `app/src/adapters/music/FakeMusicPlayer.ts` (edit) | `pauseAt` with `onCliff`, `searchCatalog`, `getSong`, `setRate`, `play(id, { startAtMs })` | `FakeMusicPlayer.test.ts` (exists, extended): play moves position; `pauseAt` fires `onCliff` once at target − lead; seek disarms; play rejects without a subscription and for a restricted explicit song |
| `app/src/adapters/music/cliffClock.ts` | `pauseTargetFor`, `againSeekTarget`, `lrcTimings` | `cliffClock.test.ts`: targets from tap timings and LRC; last line uses the duration; seek clamps at 0 |
| `app/src/adapters/music/MusicKitPlayer.ios.ts`, `index.ts` (edit) | `MusicPlayer` over the musickit module; `getMusicPlayer()` | `index.test.ts` with `Platform.OS` mocked: Android and web → `UnsupportedMusicPlayer`; iOS without the module → unsupported; iOS with a mocked module → `MusicKitPlayer` |
| `app/modules/musickit/expo-module.config.json` | `{ "platforms": ["apple"], "apple": { "modules": ["CliffwordMusicKitModule"] } }` | `__tests__/native/autolinking.test.ts`: `npx expo-modules-autolinking resolve --platform ios --json` lists `CliffwordMusicKit` with its podspec |
| `app/modules/musickit/ios/CliffwordMusicKit.podspec` | iOS 17.0, Swift 5 language mode, `ExpoModulesCore`, framework `MusicKit` | autolinking test |
| `app/modules/musickit/ios/CliffwordMusicKitModule.swift` | `Name("CliffwordMusicKit")`; events `onState`, `onCliff`, `onError`; authStatus, authorize, subscription, listLibrarySongs, searchLibrary, searchCatalog, getSong, play, pause, resume, seek, position, nowPlaying, pauseAt (20 Hz main-run-loop timer), clearPauseAt, setRate; song map of section 3.6 including `isrc` and `genreNames[0]` | Cannot compile here; first compile in the Stage 8 EAS build; device rows M1–M8 |
| `app/modules/musickit/index.ts` | `requireOptionalNativeModule('CliffwordMusicKit')` and a typed wrapper | `modules/musickit/index.test.ts`: absent → null; mocked module → calls mapped, durations coerced to ms numbers, non-http artwork → undefined |
| `app/modules/musickit/README.md` | Device checklist for the module (authorize, library search, play, `pauseAt` within 150 ms, subscription states, explicit restriction, audio-session handover) | `__tests__/docs/storeDocs.test.ts` (Stage 7) checks the rows exist |

**Share-in, device, config, factories**

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/src/adapters/share/parseShared.ts` (renamed from `parseSpotifyShare.ts`) | Pure parser, no network; phrases from the pair entry | `parseShared.test.ts` (the existing parseSpotifyShare cases plus): `open.spotify.com/track/<22>?si=…` (si dropped); `intl-es/` path; `spotify:track:`; `spotify.link/<code>` kept as a URL; album, playlist, artist, episode → unsupported; Apple Music `album/…?i=` and `song/…` ids with storefront; YouTube Music; title/artist split on the entry's separators (` · `, ` – `, ` - `, ` by `, ` de `); "on Spotify"/"en Spotify" stripped; uppercase and `www.` hosts; a URL inside a sentence; empty input; 3+ lines without a link → lyrics; a stub pair with other phrases parses its own share text |
| `app/src/adapters/share/ShareIntentBridge.tsx` | `ShareIntentProvider` around a bridge that hands `useShareIntentContext()` payloads to `inbox.receive` (which writes `share_inbox`); clearing calls `resetShareIntent()` | `ShareIntentBridge.test.tsx` with expo-share-intent mocked |
| `app/modules/cliffword-device/expo-module.config.json` | Apple and Android modules | autolinking test lists it on both platforms |
| `app/modules/cliffword-device/ios/CliffwordDevice.podspec`, `ios/CliffwordDeviceModule.swift` | `excludeFromBackup(uri) -> Bool` (`URLResourceValues.isExcludedFromBackup`), `supportsOnDeviceRecognition(locale) -> Bool` | Compiles in Stage 8; device rows D1, S2 |
| `app/modules/cliffword-device/android/build.gradle`, `android/src/main/java/app/cliffword/device/CliffwordDeviceModule.kt` | `excludeFromBackup` returns true (backup rules cover it); `supportsOnDeviceRecognition` returns null | prebuild check; compiles in Stage 8 |
| `app/modules/cliffword-device/index.ts` | Typed wrapper; absent module → no-op returning false or null | `modules/cliffword-device/index.test.ts` |
| `app/src/adapters/device/deviceInfo.ts`, `lifecycle.ts` | expo-device, expo-localization (`tzOffsetMin` from the calendar time zone) and `AppState` wrappers | small tests with jest-expo mocks; `tzOffsetMin` matches `-new Date(at).getTimezoneOffset()` |
| `app/app.config.ts` | Starts from `app.json`; adds plugins `expo-router`, `expo-sqlite`, `['expo-build-properties', { ios: { deploymentTarget: '17.0' } }]`, splash and fonts (from app.json), `['expo-speech-recognition', { microphonePermission, speechRecognitionPermission, androidSpeechServicePackages: ['com.google.android.googlequicksearchbox', 'com.google.android.as'] }]`, `['expo-share-intent', { iosActivationRules: { NSExtensionActivationSupportsWebURLWithMaxCount: 1, NSExtensionActivationSupportsWebPageWithMaxCount: 1, NSExtensionActivationSupportsText: true }, iosShareExtensionName: 'Cliffword', androidIntentFilters: ['text/*'] }]`, `['llama.rn', { enableEntitlements: true, entitlementsProfile: ['development', 'preview', 'production'], forceCxx20: true, enableOpenCLAndHexagon: false }]`, `./plugins/withLlamaGradleProps`, `./plugins/withModelBackupRules` | `__tests__/config/appConfig.test.ts` (`@jest-environment node`; sets `process.env.EAS_BUILD_PROFILE = 'development'` before `getConfig(appRoot)` and restores it after, since the llama.rn plugin adds its entitlements only for listed EAS profiles or `NODE_ENV=production`): bundle id and package `app.cliffword`; scheme; three iOS usage strings; every plugin with the options above; deployment target 17.0; `supportsTablet: false`; light style; `RECORD_AUDIO` and the blocked permissions; `com.apple.developer.kernel.increased-memory-limit` and `extended-virtual-addressing` in `ios.entitlements` |
| `app/plugins/withLlamaGradleProps.js` | `rnllamaVariants=rnllama,rnllama_v8,rnllama_v8_2_dotprod,rnllama_v8_2_dotprod_i8mm` (the generic `rnllama` stays: `RNLlama.java` always loads it) and `reactNativeArchitectures=arm64-v8a` for every phone profile (development, preview, production); `APP_VARIANT=emulator` adds `rnllama_x86_64` and `x86_64` | `__tests__/config/plugins.test.ts`: the mod on a fake properties list per `APP_VARIANT`; prebuild check greps `android/gradle.properties` |
| `app/plugins/withModelBackupRules.js` | `res/xml/backup_rules.xml` and `data_extraction_rules.xml` excluding `files/models/`; sets `android:fullBackupContent` and `android:dataExtractionRules` | plugins test; prebuild check greps the manifest and the XML |
| `app/scripts/prebuild-check.sh` | Copies `app/` to a temp dir (node_modules symlinked); runs `EAS_BUILD_PROFILE=development npx expo prebuild --no-install --platform all --clean`, then greps: iOS usage strings; entitlements with increased-memory-limit and extended-virtual-addressing; share extension target and App Group `group.app.cliffword`; deployment target 17.0; fonts; Android `RECORD_AUDIO`, no `FOREGROUND_SERVICE*`, the SEND `text/*` filter, backup rules, gradle properties; no "Install expo-system-ui" warning. A second run without `EAS_BUILD_PROFILE` asserts the two entitlements are absent | `npm run prebuild:check` exits 0 |
| `app/src/services/nativeAdapters.ts`, `nativeAdapters.web.ts` | Native: `llamaBinding` + `createLlamaModelAdapter`, `createModelManager` + `expoModelFiles`, `ExpoSpeechIn`, `expoAudioSession`, `getMusicPlayer()`, device info, lifecycle, the share inbox. Web twin: throws | `nativeAdapters.test.ts` with every native package mocked; importGraph test: no native package in the web bundle |
| `app/src/services/nativeServices.ts` (edit) | Real runtime, manager, speech in, audio, music, device, lifecycle through `nativeAdapters.ts`; no mock (rule 3) | `nativeServices.test.ts` with native packages mocked: resolves with `platform` ios/android; importRules rule 3 |
| `app/src/services/webServices.ts` (edit) | Preview mode (`EXPO_PUBLIC_CLIFFWORD_ENV=preview`): `createPreviewModelRuntime()`, `FakeMusicPlayer` with "Luna de Santurce", `FakeSpeechIn` fed by `window.__cliffword`; otherwise the existing browser pieces | `webServices.test.ts`: preview mode → runtime loaded, music available; plain web → `UnsupportedMusicPlayer` |
| `app/src/services/testServices.ts` (edit) | Every new member faked (`runtime` over the mock, fake audio port, fixed device info, fake lifecycle) | `Services.test.ts`: every `Services` member present; loading test services never requires `llama.rn`, `expo-speech-recognition` or the musickit module |

### Stage 4: Story tab (uses E1, E2, E7 when landed; fallbacks otherwise)

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/src/session/types.ts` | Screen and controller types of section 3.12 | `tsc`; `noAccentScore.test.ts` reads it |
| `app/src/session/events.ts` | `eventsFor(action, now)`: the table of section 3.12 | `src/session/events.test.ts`: TTS-played tiles not tapped → `heard`; text words → `read`; tap → `tap_rehear`; hold → `hold_reveal`; gloss chip and `meaning` → `gloss_lookup`; spoken answer → `cliff_answer` with credit and rung; no sé → `cliff_skip` then `spoke_correct`; English inside a reply → `native_gap`; repair → `spoke_correct`/`spoke_error`; an inflected answer ("tiene") → a `formKey` key; typed and tapped answers → the interim events, never `cliff_answer` (until E9) |
| `app/src/session/utterance.ts` | `collectUtterance(speechIn, clock)` | `utterance.test.ts`: partials then final; alternatives, levels and words carried; error in the middle; empty result; typed source |
| `app/src/session/spoken.ts` | `countSpoken(u)`: `source === 'speech' && words > 0 ? creditedMs(min(voicedMs(u.levels), holdEnd − holdStart)) : 0`; writes `spokenTime.addUtterance(ms, at, device.tzOffsetMin(at), activity)` and the chapter's spoken ms | `src/session/spoken.test.ts`: no words → 0; typed → 0; 250 ms voiced → 0 (engine floor 300 ms); voiced time capped by the hold; a 3-minute latched hold → 120000; day keys at tz offsets -300 and +120 around midnight |
| `app/src/session/ListeningMachine.ts` | idle → warming → listening → finishing; interim `matchCommand(partial, pack, { answer: expected })`; outcome `command`, `answer`, `empty` or `error` | `ListeningMachine.test.ts`: begin warms; cancel aborts; each of the six commands ends listening early with that command; "ya" when the expected answer is "ya" is an answer, not `done`; empty → `error.didNotHear`; permission denied → typing offered; latched mode ignores the 120 ms hold |
| `app/src/session/checkpoint.ts` | Snapshot every 200 events, on background and on session close; keep 3 | `checkpoint.test.ts` |
| `app/src/session/story/cannedStory.ts` | Plays `pair.starter` (sentences, taught words with gloss chips, probes, prompts) without a model; answers credited by listed answer, `accept` list and form match (`pack.analyze` lemma) | `cannedStory.test.ts` with the en-es starter (or a test pack's starter until E2 wiring): every sentence yields an options cliff with two or three options; "parque" and "restaurante" both credited where listed; the first sentence word is never the cliff |
| `app/src/session/story/placement.ts` | `PlacementTracker` driven by probes: `nextBand()` picks a starter probe (no model) or a generated sentence whose cliff word is in that band (model); `record(key, rank, success)` per answer | covered by `placement.test.ts` |
| `app/src/session/story/steps.ts` | `StorySteps` (section 3.12) over the engine primitives: canned, placement and model modes; `generateNextSentence` with `runtime.model('prefetch')`, scoring with `runtime.model('interactive')`; becomes an adapter over `StorySession` when it lands | `steps.test.ts`: mode follows the runtime status; snapshot/restore round-trips with a format number |
| `app/src/session/StorySessionController.ts` | Section 3.12; one `storage.transaction` per step for events, snapshot, spoken time and chapter rows; prefetch and interactive priorities; canned mode, placement, starter-done path; voice choice and rate; options read aloud; hint spoken | `__tests__/session/storyController.test.ts` (test services, mock model, `FakeSpeechIn`, `FakeSpeechOut`), cases listed below |
| `app/src/session/RetellController.ts` | `RETELL_LANES`; latched listening; `retellMetrics(words, { laneMs, laneStartMs })`; `retellProgress`; `retellRoundUi`; `laneRemainingMs`; `retell_rounds` rows | `__tests__/session/retellController.test.ts` (`FakeClock`, scripted utterances): round transitions; "listo" ends a round; the lane timer stops listening; pauses counted at 700 ms; Android-style words with estimated ends; stats "71 → 84" from `retellProgress`; restart join; spoken time credited at most 120 s |
| `app/src/session/BroughtTextController.ts` | Flow G: `splitTextUnits`, `surpriseMap`, `broughtTextCliffs`, `scoreLyricAnswer`; TTS at `params.speechRate`; `waitingForModel` before load | `__tests__/session/broughtTextController.test.ts`: a pasted article and an advanced learner snapshot give cliffs whose spans exceed one word (an idiom from the register packs kept whole); TTS speaks at `speechRate` 1 for that learner; surprise heat appears on the read screen; events and the snapshot are written in one transaction; no model → `waitingForModel` |
| `app/src/testing/marginModel.ts` | A `LanguageModel` wrapper over the mock that forces the judgement margin of the next sentence (jest only) | used by the repair cases |
| `app/src/layout/tileWidth.ts` | `tileWidth(durationMs, rate)`, minimum 44 | `tileWidth.test.ts` |
| `app/src/layout/landing.ts` | `layoutLanding(candidates, answer, width)`: x by log p, collision nudging | `landing.test.ts`: order; inside bounds; no overlaps; answer pill present; "About n in 100" rounding |
| `app/src/layout/lanes.ts` | `layoutLanes(rounds, width)`: widths 60:45:30, word tiles, holes from `RetellPause` | `lanes.test.ts` |
| `app/src/layout/wordFlow.ts` | `flowWords(text, pack, opts)`: `FlowWord`s from `pack.segment()` with offsets, `separatorAfter` (punctuation and spaces attached as in the source), tile age by line, durations from `estimateDurations` | `wordFlow.test.ts`: Spanish sentence with "¿", "," and "." keeps every character in order; stub no-space pack: '私は学生です' gives four words, every `separatorAfter` '', and joining text + separators rebuilds the input exactly |
| `app/src/components/words/{WordFlow,TextWord,WordTile,HeatWord,NewWordUnderline,CliffGap,FutureTile,GlossChip,UnderstoodLine}.tsx` | Section 5.4 (`CliffGap` moved from `src/components/`) | One test each: heat color by `Heat`; tile label "word {n}" never contains the word; tap → `onHear` and hold → `onReveal` through `fireGestureHandler`; a tile hold blocks the root hold; underline drawn with SVG; `WordFlow` with the stub no-space pack renders no space character between tiles and its underline ranges match segment offsets; `UnderstoodLine` renders "Understood 6 of 7 words" through `tUi` |
| `app/src/components/voice/{HoldAnywhere,HoldArea,HoldButton,ListeningRings,CommandChips}.tsx` | Section 5.4 | One test each: hold begin/activate/finalize call the controller; canceled → abort; `HoldArea` `activate` action toggles listening; rings static with reduce motion; chips show `command.<id>.say` and `.gloss` (fallback: pack phrase and catalog gloss) for the commands given and call `command(id)` |
| `app/src/features/story/*.tsx` (section 5.4 list) | Story views | One test each: texts from `t()`/`tUi()`; `CliffCard` subtitle "One to three words" for a three-word cliff and "One word" for one (from `screen.subtitle`); `OptionsRung` lights the option being read and a tap calls `pickOption`; `HintRung` shows the hint; `RepairCard` for `hinted` (expected only, no fix, no explanation), `prompt_repair` (prompt, no fix) and `show_answer` (fix and the exact `pair.explanations[explainKey]` text); landing note value; `StoryHeader` shows "spoken 4:12" (chapter) on cliff screens and "Spoken today" on repair |
| `app/src/features/retell/*.tsx` | Retell views | One test each: countdown format; lane widths from `layoutLanes`; stats "71 → 84" |
| `app/src/features/text/*.tsx` | Paste and reader views | One test each |
| `app/src/features/story/StoryScreen.tsx` | Switch on `screen.kind` | `StoryScreen.test.tsx`: every kind renders its view |
| `app/app/(tabs)/index.tsx` (rewrite) | Controller from services and `AppState`; `enterStory` on focus, `leaveStory` on blur; "Bring a text" entry | `__tests__/flows/story.test.tsx` |
| `app/app/retell.tsx` | `RetellScreen`; no swipe-down while a round runs | `__tests__/flows/story.test.tsx` |
| `app/app/text/paste.tsx`, `app/app/text/[textId].tsx` | Brought text routes | `__tests__/flows/text.test.tsx` |
| `app/src/preview/fixtures/story.ts`, `text.ts` | Fixture screens main, b1, b2, a2, b3 (the Marta / el mercado text of the previews) and a brought-text fixture | gallery test |
| `app/app/(dev)/_layout.tsx`, `app/app/(dev)/preview/[screen].tsx` | Fixture gallery | `__tests__/routes/previewGallery.test.tsx`: each fixture renders; the group is unreachable on a device build outside `__DEV__` |
| `app/src/preview/hooks.web.ts` | `window.__cliffword = { say, advance, seed }`, preview only | `src/preview/hooks.web.test.ts` (web jest project) |
| `app/e2e/routes.json` (edit) | Add `/preview/main`, `b1`, `b2`, `a2`, `b3`, `text` with the test ids that must be in view (HoldArea, CommandChips, CliffCard) | `npm run preview:shots` |
| `app/__tests__/flows/story.test.tsx` | `renderRouter` flow: onboarded → `/` → cliff → hold (gesture controller) + scripted utterance → landing → hold and say the whole line → "Understood N of M" → Siguiente → next cliff; repair to "Show me the answer"; no sé; open, run and finish a retell | itself |
| `app/__tests__/flows/text.test.tsx` | Paste an article → reader with shading → cliff → scripted answer → landing | itself |
| Deleted: `app/src/features/story/StoryPassage.tsx`, `StoryPassage.test.tsx`, `sample.ts` | Replaced by the components above | suite passes without them |
| `app/package.json` (edit) | react-native-svg | packageJson test |

`__tests__/session/storyController.test.ts` cases (test services, mock model unless noted):

1. Start with the model loaded → `cliff` whose `FlowWord`s rebuild the sentence exactly and whose
   subtitle follows the cliff length.
2. A scripted spoken answer → `landing`; the rows written are `cliff_answer { credit, rung }`
   for the cliff word, `heard` for tiles and `read` for text words, one `spoken_time` and one
   `spoken_activity` row, and the chapter's spoken ms, all inside one transaction.
3. A rebuilt controller restores the same screen.
4. Every command on the cliff screen, per the table in section 3.12: `again` replays (a new speak
   call); `slower` sets `speechRateScale` to 0.8, persists it and replays slower; `dont_know` →
   `noSe` on the options, hint and free rungs alike; `next` → the prefetched sentence with no new
   generate call; `done` ends the hold with the answer so far; `meaning` shows the gloss and
   writes `gloss_lookup`. One case each for the landing, repair, noSe and nativeReply rows.
5. On `landing`, a scripted repeat of the whole line with one word missing → `understood`
   `{ n: 6, m: 7 }` and "Understood 6 of 7 words".
6. `noSe`: the repeat yields `understood` counts, `cliff_skip` and `spoke_correct` rows and a
   `repeat` speaking-activity row.
7. An utterance with locale `en-US`, or with English only among its alternatives →
   `nativeReply` with the Spanish target phrase; the repeat is aligned (`understood`);
   `native_gap` row. `answerInNative()` starts one listen with `en-US`.
8. A typed answer → `landing` with `mode: 'typed'`, no `cliff_answer` speaking evidence and no
   spoken-time row; a tapped option → `mode: 'tapped'`, likewise.
9. Options rung: the fake speech out records one speak call per option, in order; saying
   "leerla" selects option 2 as a spoken answer.
10. Hint rung: the hint text is spoken and shown.
11. Repair with `marginModel`: 3.5 nats (assert) → `prompt_repair` (heat 2, no `fix`); a second
    miss → `show_answer` with `fix` and `explainKey`, and the rendered explanation equals
    `pair.explanations[explainKey]`; 1.5 nats (hint) → `hinted` (heat 1, `expected`, no `fix`);
    0.5 nats → no repair screen.
12. Street register: settings `register: 'street'`, `regions: ['PR']`; "El corillo ya 'tá listo
    pa' janguear" gets heat 0 on 'tá, pa' and janguear and verdict ok; with `register:
    'neutral'` the same sentence is shaded or hinted. A cliff on a slang line credits both "pa'"
    and "para".
13. A model spec with `calibratedFor: []` turns the 3.5 nat case into `hinted`, never a fix.
14. An answer cancels the running prefetch.
15. Canned mode without a model; model mode at the next sentence after load.
16. Model status `downloading` after the last starter sentence → `upNext` `starterDone` with
    review, retell and music actions (download when declined), never `error`; once loaded, the
    next step runs on the model.
17. An error mid-step writes no partial events.
18. An advanced learner (street-register slang known) gets an `upNext` `register` step after a
    scene; it opens the two-registers task with a story line, scored as in the C2 cases of the
    lyric controller.
19. Each action writes exactly the rows of the events table (tap, hold, gloss, spoken, typed,
    tapped, no sé, native, repair), checked row by row.

`__tests__/session/placement.test.ts`: "Start the first story" with scripted correct answers
raises the targeted frequency band, and scripted misses stall it, both in canned mode (starter
probes) and with the model loaded (generated probes); `isDone()` gives `placementDone` with a
vocabulary estimate; a learner snapshot row is written with prior `{ kind: 'placement' }`; the
placement session is deactivated; no screen of the flow is a test screen.

`__tests__/session/levels.test.ts`: five learners built from engine priors and events (brand
new, early, intermediate reader with weak speaking, advanced, heritage) run through
`StorySessionController` with the mock model. Brand new: mostly `display: 'text'`, options rung,
speak rate below 1, a one-word cliff. Advanced: mostly tiles, free rung, rate about 1,
`cliff.length > 1`. Reader with weak speaking: text shown, options or hint rungs. Heritage:
tiles and the free rung. After sound evidence (`heard` events) a word changes from text to tile
on the next sentence. `textMode: 'text'` or `'tiles'` forces every word. The CliffCard subtitle
follows `cliff.length`.

### Stage 5: Music tab (uses E8, E12 when landed; fallbacks otherwise)

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/src/music/songIds.ts` | `externalIdFor(...)`: canonical ids per source (Apple catalog and library ids, Spotify track id, `url:<fnv1a64>` for other links, none for manual songs) | `songIds.test.ts`: stable ids; the canonical Spotify URL and `spotify:track:` give the same id |
| `app/src/music/library.ts` | Stored songs merged with Apple Music library pages; dedupe by ISRC and catalog id | `library.test.ts` |
| `app/src/music/lyricsVersion.ts` | `lyricsVersion()`: `LYRICS_PARSER_VERSION` when exported (E8; read through a namespace import so the file compiles before it exists), else a SHA-256 of a stable serialization of `DEFAULT_PARSE_LYRICS_OPTIONS` (RegExps as source and flags) plus the pair's section words | `lyricsVersion.test.ts`: stable across calls; changes when an option or a section word changes; RegExps serialize to their source |
| `app/src/music/songSummary.ts` | `slangLevel(lyrics, pack, pair, regions)`: `songSlangNotes` occurrences per word, thresholds for lots / some / little; `regionHint(notes)` | `songSummary.test.ts` with lots, some and little fixtures (the three C3 rows) |
| `app/src/session/lyric/steps.ts` | Lyric steps over `parseLyrics`, `lyricCliffs`, `scoreLyricAnswer`, `echoLine`, `songSlangNotes`, `slangNotes`, `registerPairs`, `registerEquivalents`, `judgeAttempt`, `alignTranscript`, `startNoSe`/`advanceNoSe`; becomes an adapter over `LyricSession` when it lands | `steps.test.ts` |
| `app/src/session/LyricSessionController.ts` | Section 3.12; timed vs manual; `AudioCoordinator`; echo pitch through `readAudio`; tile tap and hold; C2 register task | `__tests__/session/lyricController.test.ts`, cases below |
| `app/src/layout/echo.ts` | `layoutEcho(tiles, pitches)`: singer row uniform; learner heights from own pitch; missed tiles hollow; separators from the segments | `echo.test.ts`: uniform singer heights; learner heights ordered by pitch; stub no-space pack lines up tiles with segment offsets |
| `app/app/(tabs)/music/_layout.tsx`, `index.tsx`, `[songId].tsx`, `registers.tsx`, `paste.tsx`, `time.tsx`, `share.tsx` | Section 5.1 | `__tests__/flows/music.test.tsx` |
| `app/app/+native-intent.tsx` | `redirectSystemPath({ path })`: `dataUrl=<getShareExtensionKey()>` → `/music/share`; others unchanged; errors → `/` | `__tests__/routes/nativeIntent.test.ts` |
| `app/src/features/music/*.tsx` (section 5.4 list) | Music views | One test each: Anton titles uppercase; `ExplicitPill` reads the setting; `SlangNoteList` hides explicit entries only when explicit is off; `RegisterToggle` bound; `EchoTiles`: singer row uniform, learner heights from the pitch fixture, tap a hollow tile calls `hearTile`, hold a slang tile shows "corillo · your crew · Puerto Rico"; `ConnectAppleMusicCard` per auth state and the Android "not available" text; `SpotifyHowToSheet` opens from "Show me" and lists its steps from `t()`; "Manage" opens Settings at the Apple Music section; `SongHeader` shows genre and region; `PasteInput` renders `ClipboardPasteButton` only when `isPasteButtonAvailable`, else a Paste button that calls `getStringAsync` |
| `app/src/preview/fixtures/music.ts` | a3, c1, c2, c3, b4 with "Luna de Santurce" by Rayo K. | gallery test |
| `app/e2e/routes.json` (edit) | Music fixtures | `npm run preview:shots` |
| `app/__tests__/flows/music.test.tsx` | Paste → preview counts (lines, slang, explicit) → save → read → cliff (manual) → sing (scripted) → result → echo; registers: "Say it street" + the street line → ok; share: push a payload → redirect → confirm → song saved → paste, with `global.fetch` and `XMLHttpRequest` spied and never called; Apple Music: unavailable, notDetermined → authorize, denied → open settings, authorized → library list; with `Platform.OS = 'android'` the Music tab offers paste and share only and the Apple Music row says it is not available | itself |
| Deleted: `app/app/(tabs)/music.tsx` | Replaced by the Music stack | routes test updated |
| `app/package.json` (edit) | expo-clipboard | packageJson test |

`__tests__/session/lyricController.test.ts` cases (fake music player, `FakeClock`):

1. Timed: play → `pauseAt` → `onCliff` → `forMic` before listening → result → playback resumes
   only after `next()`.
2. Manual mode advances by line; TTS reads the line.
3. Commands: `again` seeks to `againSeekTarget(lineStart)`; `slower` calls `setRate`, or speaks
   the line through TTS at a slower rate when `setRate` is missing; `next` goes to the next line
   and is the only command that resumes playback; `dont_know` on a lyric cliff plays the hidden
   words and asks for a repeat; `meaning` shows the slang note or gloss; `done` ends the hold.
4. Echo: landed count and per-tile pitch from WAV fixtures (16-bit PCM and float32); `hearTile`
   on a hollow tile → a speak call at `slower(rate)` and a `tap_rehear` row; `revealTile` on a
   slang tile → the note with its region and a `hold_reveal` row; the subtitle says the track is
   stopped.
5. Street register (`register: 'street'`, `regions: ['PR']`): echo counts "está" for "'tá" as
   landed and `understood` aligns clipped forms; with `register: 'neutral'` the same words are
   substituted. A cliff on a slang line credits "pa'" and "para" (`scoreLyricAnswer`).
6. Registers (C2): `chooseRegister('street')` and "El corillo ya 'tá listo pa' janguear" →
   verdict ok with no shading; the same answer after `chooseRegister('neutral')` → a hint that
   points to the neutral pair.
7. Explicit off masks words on screen and leaves the stored text intact.

### Stage 6: onboarding, profile, settings

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/app/_layout.tsx` (edit) | Keeps fonts, `AppProviders`, `AppBootstrap` and the guards; adds `ShareIntentBridge` and lifecycle wiring (`runtime.suspend/resume`, checkpoint on background), and `modelManager.recover()` after boot | `__tests__/routes/guard.test.tsx`: not onboarded → `/onboarding`; onboarded → `/`; `/onboarding` when onboarded → `/` |
| `app/app/onboarding/_layout.tsx`, `index.tsx`, `model.tsx`, `voice.tsx`, `slang.tsx` | Section 5.3 | `__tests__/flows/onboarding.test.tsx` |
| `app/src/features/onboarding/flow.ts` | `nextStep(settings, modelPlan)` | `flow.test.ts` |
| `app/src/features/onboarding/*.tsx` | Onboarding views | One test each (download card states: plan, cellular consent, progress, paused, not enough space, declined, error; `CommandPractice` lists six commands) |
| `app/app/profile/_layout.tsx`, `index.tsx`, `settings.tsx`, `licenses.tsx`, `selftest.tsx` | Section 5.1 | `__tests__/flows/profile.test.tsx` |
| `app/src/features/profile/stats.ts` | `formatSpoken(ms)` ("4:12", via `minutesAndSeconds`), `weekBars(stats.days, today)`, `skillMix(learner, keys, now)` | `stats.test.ts` |
| `app/src/features/profile/useProfileStats.ts` (edit) | Headline = `spokenStats(storage.spokenTime.log(), now, tzOffsetMin).totalMs` | `useProfileStats.test.ts` |
| `app/src/features/profile/*.tsx` | Profile and settings views | One test each |
| `app/src/licenses.ts` | Qwen3 Apache-2.0 notice, llama.cpp MIT (via llama.rn), SIL OFL for Newsreader, Inter and Anton | `src/licenses.test.ts` |
| `app/src/i18n/catalog/en.ts` (edit; every stage) | A key for every new string | `src/i18n/keys.test.ts` (exists): every `t('…')` literal exists; placeholder sets match across catalogs |
| `app/src/i18n/pseudo.ts`, `app/__tests__/i18n/pseudoLocale.test.tsx` | A catalog wrapping every value in `[!! … !!]`, applied to the app catalog and to `pair.ui` | Renders every gallery fixture, including fixtures whose screens carry engine `UiText` (understood, echo label, retell round, repair prompt); every visible text node carries the marker except nodes marked as story content |
| `app/__tests__/flows/otherPair.test.tsx` | Registers the stub `zh-ja` pair and a stub `es` app catalog, sets native and target languages, renders a story fixture and the chrome | No Spanish string appears; no space is inserted between words (`separatorAfter` '' rendered as is); an uncalibrated target never shows an asserted fix |
| `app/src/preview/fixtures/onboarding.ts`, `profile.ts` | Fixtures | gallery test; shots |
| `app/__tests__/flows/onboarding.test.tsx` | (a) Fresh install → welcome → "I'm brand new" → model (size from the spec; start with fake files) → voice (permission granted; a voice sample spoken; six commands practised) → slang (explicit on) → `/` in canned mode on the starter scene. (b) "Start the first story" → … → `/` with a placement session open and probes in the story. (c) Model step with not enough space, and with "Not now" → onboarding completes and the story is usable in canned mode; Settings offers the download. (d) A remount resumes at the stored step | itself |
| `app/__tests__/flows/profile.test.tsx` | Minutes headline equals `spokenStats(...).totalMs` and is the first heading; settings persist across a remount; "Delete all pasted lyrics" empties `lyrics`; "Reset progress" clears learner rows after confirm; deleting the model → status `absent`; the self-test screen shows native or fallback | itself |
| Deleted: `app/app/onboarding.tsx`, `app/app/profile.tsx` | Replaced by the stacks | suite passes |

### Stage 7: store setup and release checks

| Path | Contents | Test that proves it done |
|---|---|---|
| `app/app.config.ts` (edit) | `ios.privacyManifests`: no tracking, no collected data; UserDefaults CA92.1 + 1C8F.1; FileTimestamp C617.1 + 0A2A.1 + 3B52.1; SystemBootTime 35F9.1; DiskSpace E174.1 + 85F4.1. `ios.config.usesNonExemptEncryption: false` (moved out of `infoPlist`); Android `allowBackup: true` | appConfig test: exact reason sets; prebuild check greps `PrivacyInfo.xcprivacy` |
| `app/eas.json` (edit) | `cli >= 27.0.0`, `appVersionSource: remote`; development (devClient, internal, Android apk, `APP_VARIANT=development`), development-simulator, development-emulator (`APP_VARIANT=emulator`, x86_64), preview (internal, apk), production (autoIncrement, app-bundle); submit production (iOS `ascAppId` placeholder; Android internal track, draft) | `__tests__/config/easJson.test.ts`: profiles as listed; no secrets, key paths or Apple ids committed; no profile sets `RNLLAMA_SKIP_POSTINSTALL` |
| `app/store/metadata/ios/en-US/{name,subtitle,keywords,description,promotional_text,release_notes,privacy_url,support_url,marketing_url}.txt` | Drafts: "Cliffword: Speak Spanish", "Finish the sentence out loud", the 96-byte keyword list | `__tests__/store/metadata.test.ts`: name and subtitle ≤ 30; keywords ≤ 100 bytes, no space after commas; promotional text ≤ 170; description ≤ 4000; banned terms (Spotify in name, subtitle or keywords; real artist names; "free" in the name; competitor names; "accent score"); every locale has every file |
| `app/store/metadata/android/en-US/{title,short_description,full_description}.txt`, `changelogs/1.txt` | Play drafts | same test: title ≤ 30, short ≤ 80, full ≤ 4000 |
| `docs/STORE.md` | Checklist, age-rating answers (from counted pack entries), App Privacy and Data safety answers, review notes, account steps, screenshot sizes | `__tests__/docs/storeDocs.test.ts`: required headings; the review note mentions the 1.1 GB download, that the app works before it finishes, and the explicit default |
| `docs/PRIVACY.md` | What stays on the phone; the model host sees the IP like any download; on-device speech; lyrics and brought texts never leave the app; OS backups are under the user's control; how to delete data | same test: required statements present |
| `docs/DEVICE-CHECKLIST.md` | Every device-only check of section 8.3 with pass criteria | same test: one row per ID in section 8.3 |
| `app/scripts/make-icons.js` (edit) | Also the Play 512x512 icon and the 1024x500 feature graphic | `__tests__/assets/assets.test.ts`: PNG sizes from IHDR; `icon.png` has no alpha channel |
| `app/package.json` (edit) | Scripts `preview:refs`, `preview:smoke` | packageJson test |
| `app/e2e/serve.cjs` (edit) | Also serves `docs/design-previews/` at `/design/` with a stub `/design/support.js` (defines the `x-dc` element and `DCLogic` as no-ops; the preview content is static HTML inside `<x-dc>`) | `serve.test.cjs`: `/design/Main.dc.html` and `/design/support.js` return 200 |
| `app/e2e/refshots.cjs` | Renders the ten previews over http from `serve.cjs` (Playwright's `page.route` does not intercept `file://`) at 390x844; routes `fonts.googleapis.com` and `fonts.gstatic.com` requests to the font files in `node_modules/@expo-google-fonts/*`, so no network is needed | `npm run preview:refs` writes ten `*.ref.png` with no failed requests |
| `app/e2e/contact-sheet.cjs` | `e2e/out/index.html`: each app shot next to its reference | the page lists ten pairs |
| `app/e2e/smoke.cjs` | Preview build: onboarding (model already ready) → story → mouse hold 200 ms + `__cliffword.say()` → landing → Music → paste → cliff → sing | `npm run preview:smoke` exits 0 |
| `app/e2e/routes.json` (edit) | Every fixture plus onboarding, profile, settings | the shot gates pass for every route |

### Stage 8: device builds (needs the user's approval and accounts)

No new files except fixes. `app.json` already links an EAS project (owner and projectId), so
the app is tied to the user's Expo account; nothing below runs without the user's approval, one
command at a time. Tasks, in order:

1. User: Apple Developer Program, App IDs `app.cliffword` and `app.cliffword.share-extension`,
   MusicKit App Service enabled by hand, device registration (`eas device:create`, with
   approval), and confirmation that the linked Expo project is the one to use.
2. With approval: `eas build --profile development --platform ios` (first run interactive, with
   the user's Apple login, so EAS can register the App Group) and
   `eas build --profile development --platform android`. `eas credentials` and `eas init` also
   need approval.
3. On the first dev build, before anything else: row L1 (`RNLlama.install()` on RN 0.88.1), then
   the self-test screen (L2, L3), then the rest of `docs/DEVICE-CHECKLIST.md`.
4. Fix what fails; rebuild. Then preview builds for testers; then production builds and
   `eas submit` (App Store Connect record and API key; Play Console app, first AAB uploaded by
   hand, service account, 14-day closed test with 12 testers for a new personal account).

## 8. Verification plan

### 8.1 Commands per stage (all run in this container)

Every stage runs the commands of the stages before it. `scripts/ci.sh` exports
`RNLLAMA_SKIP_POSTINSTALL=1` and checks that Playwright resolves before running anything.

```bash
# Stage 0
cd app && npx jest __tests__/docs __tests__/native/llamaPatch.test.ts && bash -n scripts/check-llamarn-patch.sh

# Stage 1
node -v                                                   # 22.x
export RNLLAMA_SKIP_POSTINSTALL=1
npm --prefix app ci
cd app
npx tsc --noEmit                                          # also typechecks the engine files reachable from its index
npm test                                                  # jest-expo, both projects (ios + web), from app/
node --test e2e/serve.test.cjs
npm run preview:build                                     # EXPO_PUBLIC_CLIFFWORD_ENV=preview expo export --platform web --output-dir dist-web
NODE_PATH=$(npm root -g) npm run preview:shots            # Playwright gates, e2e/out/*.app.png
npx expo-doctor
cd .. && npm run check                                    # root scripts

# Stage 2
cd app && npx tsc --noEmit && npm test -- src/storage src/learner src/bootstrap

# Stage 3
RNLLAMA_SKIP_POSTINSTALL=1 npm ci                         # patch-package applies the llama.rn patch
npm run llama:check                                       # npm pack + patch + host compiles + xcframework sha256 + llvm-nm; writes nothing to patches/
npm test
npx expo export --platform ios --output-dir "$SCRATCH/cw-ios"           # Hermes bundle
npx expo export --platform android --output-dir "$SCRATCH/cw-android"
npm run prebuild:check                                    # EAS_BUILD_PROFILE=development expo prebuild in a temp copy + greps; second run without it
npx expo-doctor
# optional, real model: see "test:real" in Stage 3 (venv and the 1.1 GB download go in the scratchpad)

# Stages 4 to 6
npx tsc --noEmit && npm test
npm run preview:build && NODE_PATH=$(npm root -g) npm run preview:shots
npx expo export --platform ios --output-dir "$SCRATCH/cw-ios"
npx expo export --platform android --output-dir "$SCRATCH/cw-android"

# Stage 7
npm run prebuild:check && npx expo-doctor
NODE_PATH=$(npm root -g) npm run preview:refs
NODE_PATH=$(npm root -g) node e2e/contact-sheet.cjs
NODE_PATH=$(npm root -g) npm run preview:smoke
cd .. && bash scripts/ci.sh                               # the whole app chain, exit 0

# Engine checkpoints (not an app gate; record the engine commit each stage was verified against)
npm --prefix engine ci && npm --prefix engine run check   # engine tsc + vitest

# Stage 8 (not run without the user's approval, one command at a time)
eas build --profile development --platform ios
eas build --profile development --platform android
```

`expo prebuild` always runs in a temporary copy; `ios/` and `android/` are never committed.

### 8.2 What cannot be verified here

No Xcode and no Android SDK in this container, so:

- Native compilation and linking: the llama.rn patch inside a real Xcode or Gradle build (only
  host-compiler and symbol checks here), the two local Swift modules, the Kotlin module.
- Anything at run time on a phone: llama.rn speed, memory, Metal and CPU behaviour; the self-test
  numbers; speech recognition quality and on-device availability; TTS voices; MusicKit
  authorization, subscription and playback; the share extension and the Android SEND intent;
  background downloads; permission dialogs; gestures on touch hardware; font rendering.
- Store steps: App Store Connect and Play Console records, questionnaires, review.

All of these need an EAS build (user approval) and the user's accounts and devices.

### 8.3 Device checklist (becomes `docs/DEVICE-CHECKLIST.md`)

| ID | Check | Pass when |
|---|---|---|
| L1 | `RNLlama.install()` on RN 0.88.1 New Architecture | The context loads on iOS and Android |
| L2 | Self-test numbers | Ten proof pairs within 0.15 nats of `proof/raw_qwen3-1.7b.json`; offsets slice `¿ ¡ á ñ` and an emoji |
| L3 | KV reuse | Second identical score reports `n_reused = n_context_tokens - 1`; a following completion has `timings.cache_n > 0` |
| L4 | Speed and memory per tier (`ctx.bench`) | Judgement under 2 s (iPhone 12+), under 5 s (Android 8 GB); no jetsam or LMK kill on a 4 GB device at the low tier |
| L5 | Background during a model call | No crash; calls resume after returning |
| L6 | Narrowed Android variants | Loads on an armv8.0 phone and on a dotprod + i8mm phone |
| L7 | EAS Android build time | Within the plan's limit with arm64-v8a only and the narrowed variants |
| L8 | Gemma 3n E2B on llama.rn (brief, step 1 outcome) | Loads and gives sane output; recorded for information only, does not block Qwen3-1.7B |
| S1 | Recognizer start latency | Listening within 300 ms of the 120 ms hold |
| S2 | On-device recognition per locale | es-US, es-MX, es-ES status known on iOS and Android; offline download works on Android 13+ |
| S3 | iOS one-minute limit in a 60 s retell | Latched restart joins transcripts with correct times |
| S4 | iOS profanity masking | Explicit lyric lines come back unmasked, or `*` is treated as a wildcard |
| S5 | Android levels in continuous mode | `volumechange` events arrive; else levels from the WAV |
| S6 | TTS voices | A Spanish voice is chosen on iOS 18/26 and on Pixel and Samsung engines |
| S7 | Word boundaries | `onBoundary` fires for the chosen Spanish voices |
| S8 | Pauses for retell | Pause counts (silences of 700 ms or more) match a stopwatch within one |
| S9 | English answers to an es-US recognizer | `nativeReply` finds the English words in the transcript or its alternatives on iOS and Android; otherwise the "Answer in English" chip (en-US listen) works |
| S10 | Sing-back recording format | iOS writes 16 kHz 16-bit WAV with the recording options; `readAudio` and `readWav` read it on both platforms |
| M1–M8 | MusicKit (module README) | Authorize; subscription states; library and catalog play; `pauseAt` within 150 ms; playAndRecord handover keeps the track paused and resumable; `playbackRate < 1` (or TTS fallback); library songs without a subscription; MusicKit service still enabled after EAS capability sync |
| H1 | Share extension delivery (SDK 58 SceneDelegate) | Sharing from Spotify opens `/music/share` |
| H2 | What Spotify sends | Logged on iOS and Android; parser fixtures updated |
| D1 | Backup exclusion | The models folder has `isExcludedFromBackup`; Android rules exclude `files/models` |
| D2 | Background download | Survives suspend; resumes after the app is killed |
| G1 | Buttons over the root hold | Buttons and chips never start listening |
| G2 | Fonts | Newsreader, Inter, Anton render by PostScript name on both platforms |
| P1 | Permission dialogs | Texts shown; denial leads to "Type instead" |
| F1 | App Store upload | No ITMS-91053 for required-reason APIs (add any reason it names) |

## 9. Risks and open questions

### 9.1 Risks

| Risk | Impact | Mitigation | Checked |
|---|---|---|---|
| llama.rn rc.11's iOS install path was typed against RN ≤ 0.82; on RN 0.88.1 `RNLlama.install()` may resolve false | No model at all on iOS | Check first on the first dev build; patch the install path or pin a newer llama.rn and regenerate the scoring patch from `native/llama-score/JSIScore.h` | L1 |
| The patch reads and writes llama.rn internal fields (`completion->embd`, `n_past`) | An upgrade could corrupt memory silently on iOS (prebuilt binary + source glue) | Exact version pin; `llama:check` (with the xcframework symbol check) and the self-test after every upgrade; the forced-decoding fallback | Stage 3, L2 |
| `llamaScoreText` has never executed | Wrong numbers or crashes | Self-test against the proof data; fallback path selectable | L2, L3 |
| Wrong start token | Every score shifts; thresholds no longer hold | Start token derived by tokenizing `<\|im_end\|>`; unit test; self-test | Stage 3, L2 |
| Thresholds measured for Spanish only | False asserted corrections in another target language | `ModelSpec.calibratedFor`; an uncalibrated target only gets hints; test | Stage 4, Stage 6 |
| Memory on 4 GB phones (about 1.8–2.0 GiB at n_ctx 2048) | Jetsam or LMK kills | Memory tiers; increased-memory-limit entitlement in every profile; reload after a kill | L4 |
| iOS phones before A14 run on CPU; q4_K repack SIGILL | Crash on older phones | `noExtraBufts` when GPU is off; iPhone 12 as the supported floor | L4 |
| Generation and scoring prompts share no prefix | Each switch re-evaluates the story (about 0.5 s iPhone, 2–4 s Android) | Group work per step; prefetch generation while the learner reads; later put the story first in both prompts | L4 |
| `cliffPositions` with full next-word search costs about 50 calls per position | Slow cliffs | Analyse 2–3 positions; precompute during TTS | L4 |
| Android EAS build compiles llama.cpp per ABI and variant (`rnllamaBuildFromSource=true` is forced) | Builds may time out | `rnllamaVariants` narrowed; `reactNativeArchitectures=arm64-v8a` for every phone profile; x86_64 only in the emulator profile; larger EAS resource class if needed | L6, L7 |
| iOS recognition tasks stop after about a minute | 60 s retell cut | Latched mode restarts and joins | S3 |
| iOS persists recordings as 32-bit float WAV at 44.1/48 kHz by default | Sing-back pitch fails only on devices | 16 kHz Int16 recording options; `readWav` also reads float32 and extensible; YIN lags limited to 70–1000 Hz | Stage 3, S10 |
| Android on-device recognition needs a downloaded model; network fallback sends audio to Google or Apple | Privacy label false | On-device required by default; network only by opt-in with disclosure | S2 |
| An English answer to an es-* recognizer comes back as garbled Spanish | Native-language answers missed | Search alternatives; native glosses in the hints; "Answer in English" chip | S9 |
| iOS 18+ may lack good compact Spanish voices; no Caribbean accent anywhere | Robotic voice | Voice picker, Enhanced voice tip, per-region preference | S6 |
| Android word timings are start-only (API 34+) | Pauses less exact | Ends estimated from the next start and the voiced runs; same VAD on both platforms | S8 |
| ApplicationMusicPlayer vs the app's playAndRecord session is undocumented | Track interrupted or not resumable | Pause, wait, then mic; explicit resume on a user action only | M5 |
| Swift modules cannot be compiled here | Errors appear only on EAS | Keep modules small, Swift 5 mode, proven MusicKit calls | Stage 8 |
| expo-share-intent writes only the last iOS attachment; Android ignores `EXTRA_SUBJECT`; Spotify often shares `spotify.link` short links | Title or id missing | The confirm card always asks; patch-package fix if logs show loss | H2 |
| App Review 4.5.2 (Apple Music), 4.2.3(ii) (download disclosure), 2.1 (reviewers on slow networks) | Rejection | User-started playback and standard controls; size shown before download; review notes; canned mode and the Music tab work before the download finishes | Stage 7, review |
| Age rating may land at 16+ or 18+ with explicit ON by default; state age-assurance laws unverified | Wider rating, legal exposure | Count pack entries before answering; settings switch; revisit the default with the user | Stage 7 |
| "Data Not Collected" breaks if any analytics or crash SDK is added | Label false | packageJson test bans those packages; PRIVACY.md | Stage 7 |
| Hugging Face URL, CDN or rate limits change | Installs fail | Mirror on storage the user controls; pinned revision and SHA-256 | Before launch |
| No backup-exclusion API in expo-file-system | 1.1 GB in iCloud backups (storage guideline) | cliffword-device module; Android backup rules | D1 |
| Gesture arbitration only simulated | Accidental listening | Tiles block the root hold; buttons take touches first | G1 |
| Inputs only in the scratchpad (previews, notes, patch, check script) | Lost on reboot; Stage 3 patch work redone | Stage 0 commits them first | Stage 0 |
| Engine modules change while the app is built (session pending; E1–E12 open) | Controller rework; red engine checks unrelated to the app | Controllers depend on `steps.ts` seams; `engineApi.test.ts` catches renames; app gates do not run the engine's own tsc | Stages 4–5 |
| Two layers of the same thing (outline vs existing code) | Duplicated storage, services or adapters | Section 2.5 maps every earlier name onto the existing files; importRules lists real paths | Stages 1–3 |
| Qwen3-0.6B fallback uncalibrated | Unreliable corrections on small phones | Not offered until `proof/score.py` runs on it and a threshold table exists for its id | Later |

### 9.2 Open questions for the user

1. **Workspaces.** Accept the `file:` layout with a scripts-only root (recommended), or switch to
   npm workspaces with the changes listed in 1.3?
2. **Identity.** Register `cliffword.app` and keep `app.cliffword`, or use `com.cliffword.app`?
   Bundle ids, package names and the App Group are permanent once used. Trademark check.
3. **Model hosting.** Which storage to mirror the GGUF on (GitHub Release asset, R2 or S3)?
4. **Accounts.** Apple Developer Program, Google Play Console, confirmation that the Expo project
   already linked in `app.json` is the one to use, and approval for each EAS build and submit.
5. **Explicit default.** Keep explicit lyrics ON by default (brief) given the expected 13+ to 18+
   rating and unverified US state age-assurance laws?
6. **Network recognition.** Allow an opt-in network fallback where on-device Spanish recognition
   is missing (needs a disclosure and changes the privacy answers), or offer typing only?
7. **Small phones.** Calibrate Qwen3-0.6B (about 10 minutes with `proof/score.py`) for devices
   under 4 GB, or exclude them in the Play device catalog?
8. **Apple Music on Android.** Manual mode only in v1 (this outline), or add MusicKit for
   Android later?

### 9.3 Open questions that need a device

`RNLlama.install()` on RN 0.88.1; `llamaScoreText` numbers and speed; real tokens per second and
peak memory per tier; ggml-metal and app backgrounding; Spanish voices per OS and OEM; on-device
recognition per locale and the iOS one-minute limit; English answers to a Spanish recognizer;
Android levels in continuous mode; iOS profanity masking; the sing-back recording format;
MusicKit with playAndRecord; `playbackRate < 1` on catalog streams; library songs without a
subscription; `pauseAt` latency; what Spotify shares; share-extension delivery on SDK 58;
background download of 1.1 GB on iOS; narrowed Android variants; Gemma 3n E2B on llama.rn;
Apple Music identity rules for in-app attribution; whether App Store Connect raises ITMS-91053
for llama.rn.
