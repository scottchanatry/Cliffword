# Cliffword app

The Expo React Native app for Cliffword: Expo SDK 58, React Native 0.88, React 19.3 and
TypeScript 6 in strict mode. It is its own npm project with its own `node_modules` and
`package-lock.json`, and it uses the engine in `../engine` as source code. The product decisions
are in `../docs/BRIEF.md`; the engine API is in `../engine/README.md`.

## Run, test, export

Every command runs inside `app/`.

```bash
npm install            # this project only; never run npm install in ../engine or at the repo root
npm run check          # typecheck, then all tests
npm run typecheck      # tsc --noEmit (the app and the engine files it imports)
npm test               # jest (jest-expo preset, iOS platform)
npm run lint           # expo lint (use --max-warnings 0 before you hand work over)
npm run doctor         # expo-doctor
npm run export:web     # expo export --platform web --output-dir dist-web (also export:ios, export:android)
npm run web            # dev server for the web preview
npm start              # dev server for a development build (expo-dev-client)
npm run icons          # rebuild the placeholder icon, adaptive icon, splash and favicon
npm run patch:llama.rn # regenerate patches/llama.rn+*.patch after editing node_modules/llama.rn
```

The full verification chain used at the end of each stage:

```bash
npm run typecheck && npm test \
  && npx expo export --platform web --output-dir /tmp/claude-0/cw-dist-web \
  && npx expo export --platform ios --output-dir /tmp/claude-0/cw-dist-ios \
  && npx expo export --platform android --output-dir /tmp/claude-0/cw-dist-android \
  && npx expo-doctor
```

To check the config plugins without touching this folder, prebuild a copy and look at the
generated `ios/Cliffword/Info.plist` and `android/app/src/main/AndroidManifest.xml`. Delete the
copy afterwards:

```bash
mkdir /tmp/claude-0/cw-prebuild-check
tar --exclude=./node_modules --exclude=./.expo -cf - . | tar -xf - -C /tmp/claude-0/cw-prebuild-check
ln -s "$PWD/node_modules" /tmp/claude-0/cw-prebuild-check/node_modules
(cd /tmp/claude-0/cw-prebuild-check && CI=1 npx expo prebuild --no-install --clean)
```

Add packages with `npx expo install <pkg>` (add `--dev` for dev dependencies) so versions match
SDK 58. `npx expo install` sometimes adds a plugin entry to `app.json` that does nothing without
options; remove it if so (see "Build and release config"). Native builds go through EAS (see
`eas.json`); this README does not start any.

The web export is a single-page app. To look at it, serve the output folder with a server that
falls back to `index.html` for unknown paths. `python -m http.server` has no fallback, so open
`/` and navigate from there. The web build is a preview only (see "What is faked where").

## Layout

| Path | What |
|---|---|
| `app/` | The expo-router routes; in the repo the router root is `app/app/`. Put only routes here (never tests or helpers). `_layout.tsx` sets up fonts, the splash, the gesture root, `AppProviders`, `AppBootstrap` and the root stack with the onboarding guard. `(tabs)/_layout.tsx` has the Story and Music tabs and the header with the wordmark and the profile corner button. The other routes are `(tabs)/index.tsx` (Story), `(tabs)/music.tsx`, `profile.tsx` (modal), `onboarding.tsx` and `+not-found.tsx`. `+native-intent.tsx` is not a route: it sends the iOS share-extension deep link to the Music tab. |
| `src/providers/AppProviders.tsx` | The providers that need no startup work: services, packs, i18n. Tests render through it. |
| `src/bootstrap/` | Startup. `bootstrap(services)` opens storage, reads the settings and restores the learner. `AppBootstrap` shows the loading and error states around it. |
| `src/appState/` | `AppStateProvider` and the hooks `useAppState()`, `useSettings()` and `useLearner()`. They hold the opened storage, the settings and the learner (`replaceLearner` swaps in a model the story session rebuilt with a new prior). |
| `src/learner/prior.ts` | `learnerPrior(packs, startLevel, stored?)` and `priorSpecFor`: the learner model's prior as the engine's `PriorSpec`, rebuilt at every start (from the spec stored with the learner snapshot once placement has run). |
| `src/session/` | `contract.ts`, the seam between controllers and views; `story/`, the Story tab's controller (see "Story controller"). |
| `src/services/` | The service container (see "Services and adapters"). |
| `src/adapters/` | Device adapters, one folder per capability. Each folder has a documented `types.ts` contract, fakes and web fallbacks; `listeners.ts` is shared. |
| `src/storage/` | SQLite storage: drivers, migrations and repositories. See `src/storage/README.md`. |
| `src/engine/PacksProvider.tsx` | The active pair pack and `usePairPack()`. |
| `src/i18n/` | `t(key, vars)`, `plural(key, count)`, `I18nProvider`, `useI18n`, `tKey`, `languageName`, `clockParts`, and the app catalog `catalog/en.ts`. |
| `src/theme/` | Tokens, font family names, the type scale, and `useAppFonts` (with a `.web.ts` twin). |
| `src/ui/` | The basic components: `Screen`, the `Text` variants, `Button`, `Card`, `Pill`. |
| `src/features/<area>/` | Screen parts for each area: story, music and profile. |
| `src/components/` | Shared components: the profile button and tab icons; `words/` (the word flow, tiles, the cliff gap, gloss chip, heat sentence, understood line) and `voice/` (hold anywhere, the hold area and button, listening rings, command chips). See "Story views". |
| `src/preview/` | `PREVIEW_ENABLED`: the guard of the dev fixture gallery (`app/(dev)/preview/[screen].tsx`). |
| `src/testing/` | Test helpers, never imported by app code. `renderWithProviders(ui, { services? })` renders inside `AppProviders`. `renderWithAppState(ui, { services?, settings? })` also runs the real bootstrap and renders inside `AppStateProvider`. `recordEvents(speechIn)` records a SpeechIn's events. `FakeSpeechRecognitionModule` plays expo-speech-recognition's native module (also behind the jest mock). `FakeCliffwordMusic` plays the cliffword-music module; `fakeShareIntent` drives the expo-share-intent mock (`deliver({ text, webUrl })`). |
| `__tests__/` | App-level tests. `routes/` runs every route through the real router and root layout. `engine.test.ts` checks that the engine runs in Jest. `importGraph.test.ts` checks what each platform's bundle can reach. Module tests sit next to their modules as `*.test.ts(x)`. |
| `public/index.html` | The web page template. It paints the page in the ground color, so neither overscroll nor the first paint flashes white. |
| `scripts/make-icons.js` | Builds the placeholder icon and splash PNGs with Node built-ins only. |
| `patches/` | patch-package patches, applied by `"postinstall": "patch-package"`. llama.rn's adds native text scoring (see "On-device model"). |
| `native-tests/scoring/` | The Linux build and checks of the llama.rn scoring patch against `proof/model_server.py` (results in its README). |
| `__mocks__/` | Jest manual mocks for native packages (llama.rn, expo-speech-recognition, expo-share-intent), used by every test. |
| `modules/cliffword-music/` | Local Expo module, iOS only, autolinked from `./modules`: MusicKit library browsing (`MusicLibraryRequest`), `ApplicationMusicPlayer` playback and a native line-end pause timer (see "Apple Music"). |
| `modules/cliffword-native/` | Local Expo module, autolinked from `./modules`: streaming file SHA-256 with progress (Swift CryptoKit, Kotlin MessageDigest), the iOS backup flag and free space, and a config plugin that keeps `files/models/` out of Android backups (see "Model file"). |

## Startup

```
RootLayout (app/_layout.tsx)
  useAppFonts            web loads the bundled fonts; native embeds them at build time
  AppProviders           services (getAppServices()), packs, i18n
    AppBootstrap         storage.open() -> settings.getAll() -> learner.loadLearner({ prior })
      AppStateProvider   storage (also in StorageProvider), settings, learner, updateSettings
        RootStack        Stack.Protected guards on settings.onboarded
```

- **Loading state.** On iOS and Android the splash stays up until startup has finished. The
  root layout hides it from `AppBootstrap`'s `onSettled`, or after 5 s at the latest. On web
  there is no splash, so the translated loading state shows instead (`boot-loading`, announced
  as a progress bar).
- **Errors.** If storage cannot be opened, the error state offers Try again: the
  `StorageService` forgets a failed open, so a retry reopens it. If the data was written by a
  newer version of the app (`SchemaTooNewError`), the error state asks for an update and offers
  no retry. The data is never deleted.
- **Onboarding guard.** Until `settings.onboarded` is true, `(tabs)` and `profile` are behind
  `Stack.Protected guard={onboarded} redirectTo="/onboarding"`, so every URL leads to
  onboarding. Afterwards onboarding is behind `guard={!onboarded} redirectTo="/"`.
  `+not-found` is open in both states.
- **Onboarding.** "I'm brand new" stores `{ onboarded: true, startLevel: 'brandNew' }`.
  "I know some Spanish" stores `startLevel: 'placement'`. The guard then opens the Story tab
  without calling the router.
- **Learner prior.** A prior is a function, so the app keeps it in the engine's form, a
  `PriorSpec`, and rebuilds it with `buildPrior` at every start (`src/learner/prior.ts`).
  `brandNew` is `PlacementTracker.brandNew(cognates)`: cognates are probably understood and
  everything else is unknown. `placement` starts as a fresh `PlacementTracker` (a
  lower-intermediate learner); when the first story has placed the learner, the story
  controller saves a learner snapshot with `{ kind: 'placement', placement }` (schema v3,
  `learner_snapshots.prior`), and `bootstrap` reads it back with `storage.learner.latestPrior()`.
  The stored spec counts only while it fits `settings.startLevel`. `updateSettings` rebuilds the
  learner, replaying the event log, when `startLevel` changes.
- **Settings.** `useSettings().updateSettings(patch)` writes to storage first and updates the
  state after. Calls run one at a time, in order. An invalid value rejects the call
  (`InvalidSettingError`) and leaves the state unchanged. The Music tab's region pills and
  explicit-lyrics switch, and the profile's values, are stored settings.
- **Learner events.** Record them with `storage.learner.record(learner, events)`. It applies
  each event to the in-memory model and logs it in the same synchronous step, so memory and disk
  stay in step (see `src/storage/README.md`).

## Story controller

`app/(tabs)/index.tsx` renders `<StoryView vm actions />` (`src/features/story`) from
`useStoryController()` (`src/session/story`). The controller (`createStoryController(deps)`)
implements `StoryController` of `src/session/contract.ts` over the engine's `StorySession`; the
engine's screens are the view data.

- **Session.** On mount it restores the active `story` row of `storage.sessions` (the
  `StorySessionSnapshot`, version `STORY_SESSION_FORMAT`; another version is deactivated) or
  creates a session: `brand_new` or `placement` from `settings.startLevel`, `continue` once the
  learner has an earlier story session or a stored placement prior. Session settings come from
  the app settings (`settings.ts`: text mode names, rate bias `1 + speechRateBias`).
- **One queue.** Every call into the session runs in order through one queue; `busy` is true
  while queued async steps run. Actions are checked against the screen when called and again
  when their turn comes; one that does not fit is ignored.
- **Persistence.** After each step, in one transaction: the events through
  `storage.learner.record` (the session runs with `applyEvents: false`, so each event is applied
  once), a learner snapshot with the new `PriorSpec` when the session replaced the prior, the
  session snapshot, and the credited speaking time (`creditedMs` of the voiced time, nothing for
  typed answers) in `spoken_time`. `spokenTodayMs` is read for the engine's `localDay`. A failed
  step writes nothing.
- **Learner.** When the session replaces the learner (brand new, placement done) the hook hands
  the new model to `AppState.replaceLearner`, so every tab uses the same object.
- **Model.** The session gets the `ModelAdapter` while it is `ready` and runs canned otherwise;
  `onStatusChange` switches it from the next sentence.
- **Speech.** Cues play with the pack's word spans; boundaries set `speakingWord`; the options of
  the options rung are read after the sentence (`speakingOption`); the no-sé answer reports
  `played()`. Hold to speak warms (permission), listens in `recognitionLocales(pack, regions)`
  with the screen's words, options and commands as hints, and sends the final transcript with
  its voiced time and word timings. Errors show `speechInErrorKey(code)`.
- **Lifecycle.** App background calls `suspend()` (speech and listening stop, the session and a
  learner checkpoint are stored); unmount suspends and disposes.
- **Prefetch.** The engine has no prefetch API yet; `prefetch()` in the controller is the marked
  hook point (landing and no-sé screens).

## Story views

`StoryView` (`src/features/story/StoryView.tsx`) takes `{ vm: StoryViewModel; actions: StoryActions }`
and renders the engine's `StoryScreen` as it is: one view per kind (`CliffView`, `LandingView`,
`NoSeView`, `NativeReplyView`, `TurnView`/`RepairView`, `UpNextView`, `RetellView`,
`RegisterView`, `PlacementDoneView`, `ErrorView`, `IdleView`; a null screen is `LoadingView`).
Display text from the engine is a `UiText`, resolved with `t(key, params)`.

- **Two looks.** `flowLook(sentence)` (or a forced text mode) picks the Ink look (Main: a
  paragraph of Newsreader words, new words underlined, the ink cliff pill, gloss chips, the "Say
  what comes next" card) when at least half of the words are text, else the Voice look (B1:
  tiles by sentence, oldest lightest, the dashed orange gap, future outlines, the hold area and
  the command chips). `vm.previous` (the chapter's earlier sentences) is drawn above the current
  one.
- **Words.** `WordFlow` draws `ViewWord`s exactly as the engine gives them: lead, text, trail and
  the word's own space (`spaceAfter`); between sentences the engine's `leadAfter` decides. It
  never splits text or adds a space, so a language without spaces stays as written (tested with
  a Japanese sentence). Tile widths come from `durationMs` (`tileWidth`, 0.115 dp per ms).
  Learner sentences (`SaidWord`, no spacing data) are joined with `leadAfter`. The landing's
  answer span is found with the engine's `locateAnswer` on the pack's segmenter.
- **Gestures (RNGH 3).** `HoldAnywhere` is the screen's root long press (120 ms, no movement
  cancel): `holdBegin` on touch-down, `holdStart` when it activates, `holdEnd` on release,
  `holdCancel` when cancelled or released early. Tiles combine a tap (hear) and a 300 ms hold
  (see) that `block` the root gesture, so holding a tile never listens. The screen scrolls in
  RNGH's `ScrollView`, so a scroll takes the touch from the hold. Gesture configs are
  workletized by the Babel plugin: write plain properties (no spreads) in them.
- **Screen readers.** A tile is "Word n" (never the hidden word) with activate (hear) and
  long-press (see) actions; the gap is announced as a gap; the hold area and the hold button are
  buttons whose activate action toggles listening (`useListenToggle`); heat is named, not only
  coloured. Content text is capped at 1.3x Dynamic Type, chrome at 1.2x.
- **Listening.** `ListeningRings` follow `listen.level` on the UI thread (Reanimated 4) and stay
  still with Reduce Motion; the partial transcript replaces the hold title while listening;
  speech-in errors show `t(messageKey)`. "Type instead" opens `TypeAnswerSheet` (`typeAnswer`).
- **State.** `busy` adds a quiet spinner to the header and blocks nothing; canned mode adds a
  note under the header; `meaning` opens `MeaningSheet`; `notice` shows a toast that dismisses
  itself after 6 s.
- **Fixtures and the gallery.** `src/features/story/fixtures.ts` builds one view model per
  screen kind from real `StorySession` steps (canned mode, then the mock model for scoring) on
  the previews' market scene, plus hand-made ones for states that take long to reach.
  `app/(dev)/preview/[screen].tsx` renders one by name (`/preview/main`, `b1`, `b2`, `a2`, `b3`,
  `retell`, `noSe`, `nativeReply`, `turn`, `register`, `placementDone`, `error`, `loading`, ...;
  any other name lists them). It is guarded by `PREVIEW_ENABLED` (`__DEV__`, or
  `EXPO_PUBLIC_PREVIEW=1` at export time); a store build redirects home. To look at the screens
  in a browser: `EXPO_PUBLIC_PREVIEW=1 npx expo export --platform web --output-dir <dir>`, serve
  `<dir>` with an `index.html` fallback, open `/preview/main`.
- **Tests.** `StoryView.test.tsx` renders every fixture (named 44 dp controls) and checks each
  kind's texts and actions, tiles, hold anywhere, rungs, heat, retell lanes; the
  `src/features/story/testing/storyTestKit.tsx` helpers (`mockStoryActions`, `loadFixtures`,
  `renderStory`) are test-only.

## The engine as a dependency (monorepo approach)

The repo has no root package and no workspaces. `engine/` and `app/` are separate npm projects.
The app uses the engine (`@cliffword/engine`, `"main": "src/index.ts"`, plain TypeScript, zero
runtime dependencies) as source code and never builds it. Every tool resolves it to the same
file, `../engine/src/index.ts`:

- **npm.** `"@cliffword/engine": "file:../engine"` makes `node_modules/@cliffword/engine` a
  symlink to `../engine`. For a link, npm installs and prunes nothing inside `../engine`; this
  was checked after `npm install`, `npm ci` and `npx expo install`, which all left the
  timestamps of `../engine/node_modules` and its package files unchanged. That holds while the
  engine has no runtime `dependencies`. If it gets one, npm would install it into
  `../engine/node_modules`.
- **TypeScript** (`tsconfig.json`). It extends `expo/tsconfig.base` and sets `strict`,
  `noUncheckedIndexedAccess` and `noImplicitOverride`, which are the engine's flags too.
  `types: ["jest", "node"]` is needed because TS 6 no longer loads every `@types` package.
  `paths` maps `@cliffword/engine` to `../engine/src/index.ts`, with no `baseUrl`. Only engine
  files reachable from `index.ts` are checked, never engine tests or vitest helpers, so the app
  type-checks without `../engine/node_modules`. The engine runs its own `tsc --noEmit`.
- **Metro** (`metro.config.js`). It keeps Expo's defaults and adds `../engine` to
  `watchFolders`. `resolver.nodeModulesPaths = [app/node_modules]` means a bare import from an
  engine file resolves from the app. The only such imports are the `@babel/runtime` helpers that
  Babel injects. `resolver.blockList` adds `../engine/node_modules`, `../engine/test` and the
  engine's `*.test.ts`. The blockList is load-bearing: Metro only resolves files in its file
  map, so a lookup from an engine file never stops in `../engine/node_modules` and falls through
  to the app's packages. This was checked with a decoy `@babel/runtime` placed in a copy's
  `engine/node_modules`: the bundle took the helpers from `app/node_modules` and the engine from
  the copy's `engine/src`.
- **Babel** (`babel.config.js`). `presets: ['babel-preset-expo']` is a root config, so it also
  applies to `../engine/src`; a `.babelrc` would not. babel-preset-expo adds the worklets plugin
  that Reanimated 4 needs, so there is no separate plugin entry.
- **Jest** (`jest.config.js`). Preset `jest-expo` (iOS). `moduleNameMapper` maps
  `^@cliffword/engine$` to the same file. `modulePaths: ['<rootDir>/node_modules']` is the Jest
  twin of `nodeModulesPaths`. The `\.[jt]sx?$` transform is babel-jest 30, resolved from
  jest-expo. It uses `configFile: app/babel.config.js`, `cwd`/`root` set to the app and
  `babelrc: false`, so engine files are transformed the same way from any directory. Engine
  tests are ignored; vitest runs them. Reanimated 4 runs in Jest through
  `react-native-reanimated/jest/resolver` (its web files) and the Worklets mock in
  `jest.setup.ts`; animated styles are readable from a view's `jestAnimatedStyle.value`.

## Services and adapters

Each native capability sits behind an interface (`src/adapters/<capability>/types.ts`) with a
fake for tests and a web fallback. Components never import an adapter. They call
`useServices()` and get the container that `AppProviders` holds:

```ts
const { model, packs, speechOut, speechIn, storage, clock } = useServices();
const heat = await scoreWords(model, packs.lang, storyText, ' ' + reply);
await speechOut.speak(sentence, { lang: 'es-ES', rate: params.speechRate, words, onWordBoundary });
```

The container is built per platform:

- **App.** `getAppServices()` builds `createServices(currentPlatform())` once.
  `currentPlatform()` reads `Platform.OS`, and anything other than ios or android counts as
  web.
- **Native.** `createNativeServices(platform, overrides?)`.
- **Web.** `createWebServices(overrides?)`.
- **Tests.** `createTestServices(overrides?)` in `src/services/testServices.ts`. It is
  test-only and not exported from `src/services/index.ts`, so the fakes and sql.js stay out of
  the iOS and Android bundles. `__tests__/importGraph.test.ts` guards this, and the exports
  confirm it: the native `.hbc` files contain no sql.js and no test container.
- **Route tests.** They render the real root layout, so they install a container first with
  `setAppServices(createTestServices())` in `beforeEach` and reset it with
  `setAppServices(undefined)` afterwards.
- **Overrides.** Every factory takes `overrides`, which swap single services; the rest are
  built on the override clock. `createTestServices` keeps the concrete fake types, so a test can
  drive them (`services.speechIn.say('…')`, `services.clock.advance(ms)`,
  `await services.storage.open()`).
- **Sharing.** Packs and the trained mock model are immutable and shared between containers.
  Adapter state and storage are not: each test container gets a fresh database.

`services.storage` is a `StorageService` (`src/services/storageService.ts`). `open()` opens and
migrates the database on the first call and returns the same promise after that; a failed open
is retried on the next call. `close()` closes it, and `backend` says where the data lives. Ids
come from the container clock through `storageClockFor(clock)`. They are unique on the device
and, in tests, deterministic (`test-1`, `test-2`, ...).

### What is faked where

| Service | Interface | iOS / Android now | Web preview | Tests (`createTestServices`) | Later stage |
|---|---|---|---|---|---|
| `storage` | `StorageService` (`open`, `close`, `backend`) | **real**: expo-sqlite, file `cliffword.db`, WAL, migrated | sql.js in memory (`open.web.ts`), lost on reload | sql.js in memory, fresh for each container, ids `test-n` | persistent web DB (needs `.wasm` in Metro + COOP/COEP) |
| `model` | `ModelAdapter` (engine `LanguageModel` + `load`, `unload`, `status`, `info`, `onStatusChange`) | **real**: `LlamaModelAdapter` (llama.rn, Qwen3-1.7B), `'unloaded'` until `keepModelLoaded` loads the verified file | `MockModelAdapter` | `MockModelAdapter`; `LlamaModelAdapter` tests use the llama.rn fake | none |
| `modelManager` | `ModelManager` (`status()`, `progress()`, `snapshot()`, `startDownload()`, `cancel()`, `delete()`, `filePath`, `onChange`) | **real**: `ExpoModelManager` (expo-file-system download into the document directory, size and SHA-256 check, `model_files` row) | `FakeModelManager` (ready) | `FakeModelManager` (instant or manual); `ExpoModelManager` tests use `src/testing/fakeExpoFileSystem.ts` | none |
| `speechOut` | `SpeechOut` (`speak` with word boundaries, `stop`, `voices`, `isSpeaking`) | **real**: `ExpoSpeechOut` | `ExpoSpeechOut` (speechSynthesis) | `FakeSpeechOut` | none |
| `speechIn` | `SpeechIn` (sessions, `submitTyped`, events, levels and meter, permission, `availability`, `downloadLanguage`) | **real**: `ExpoSpeechIn` (expo-speech-recognition, on-device; `TypedSpeechIn` if the binary lacks the module) | `BrowserSpeechIn` when the browser has SpeechRecognition, else `TypedSpeechIn` | `FakeSpeechIn`; `ExpoSpeechIn` tests drive `FakeSpeechRecognitionModule` | none |
| `music` | `MusicPlayer` (Apple Music, `pauseAt` for lyric lines) | **real on iOS**: `MusicKitPlayer` (modules/cliffword-music); Android: `UnsupportedMusicPlayer` | `UnsupportedMusicPlayer` | `FakeMusicPlayer`; `MusicKitPlayer` tests use `FakeCliffwordMusic` | none |
| `share` | `ShareInbox` + pure `parseSpotifyShare` | **real**: `ExpoShareInbox` (share_inbox table), fed by `ShareIntentBridge` (expo-share-intent) | `MemoryShareInbox` | `MemoryShareInbox`; the bridge runs on the expo-share-intent mock | none |
| `haptics` | `Haptics` (`play('tap' \| 'selection' \| 'success' \| 'warning' \| 'error')`) | **real**: `ExpoHapticsAdapter` | `ExpoHapticsAdapter` | `FakeHaptics` | none |
| `clock` | `Clock` (`now()`) | `systemClock` | `systemClock` | `FakeClock` | none |
| `packs` | `{ lang, pair }` | en-es, built once | same | same | more pairs |

Also faked or fixed for now:

- **Placeholder buttons.** The cliff card's buttons and the Music source buttons have no
  actions yet.
- **Native fonts.** They are embedded by the expo-font plugin and have only been checked
  against the generated projects, not yet on a device.

Contract rules (each `types.ts` documents the full contract):

- **Model.** Model calls reject with `ModelNotReadyError` unless `status` is `'ready'`. The
  default model file is `DEFAULT_MODEL` (`src/adapters/model/descriptor.ts`): Qwen3-1.7B
  Q4_K_M, 1107409472 bytes, SHA-256 `b139949c…1897`, from a Hugging Face URL pinned to a commit.
  `info.scoring` says how scores are made. `'native'` means exact, from the llama.rn patch.
  `'forced-decoding'` means tokens outside llama.rn's top N are `upperBound`. Show the model's
  state with `modelAvailability(modelManager.snapshot(), model.status)`, for example `'missing'`
  before the download.
- **Model file.** `ExpoModelManager` (`src/adapters/model/ExpoModelManager.ts`, built by
  `createModelManager`) keeps the model in `<documents>/models/` (never the cache, which the OS
  purges); `filePath` is a plain path there. The header of that file has the full behavior:
  - **Start.** `startDownload()` first checks free space: the bytes still to fetch plus 600 MB
    (`FREE_SPACE_MARGIN_BYTES`). Short gives `'error'`, `'insufficient-storage'`, and
    `state.space` for the text. It then runs a `DownloadTask` on the iOS background session
    into `models/<file>.part`, with progress, and keeps the screen awake (expo-keep-awake) while
    downloading and verifying. Mobile data is never blocked; show `MODEL_DOWNLOAD_NOTES`.
  - **Cancel and resume.** `cancel()` pauses and saves `savable()` in
    `models/<file>.download.json`. Android resumes from the partial file's length, also after a
    failure or a kill. iOS resumes only from a pause; otherwise it starts over. A download that
    was running when the app stopped resumes (or restarts) at the next launch.
  - **Verify.** Size, then SHA-256 (`fileHash.ts`: the native module, else
    `File#digest('SHA-256')`, else the TypeScript `Sha256` over file slices). A file that fails
    is deleted and the state says why (`'size-mismatch'`, `'checksum-mismatch'`). A file that
    passes is renamed into place and written to `model_files` as `'ready'` with its size and
    hash.
  - **Startup.** A file whose row is `'ready'` with the descriptor's size and hash, and whose
    mtime is not after the row's `updated_at`, is ready without hashing. Otherwise the state is
    `'verifying'` until it is hashed again.
  - **Delete.** `delete()` removes the file, the partial download and the record, and
    `startDownload()` fetches it again.
  - **Text.** `modelFileMessage(state, descriptor, t)` (`modelFileMessages.ts`) gives the
    status line.
- **SpeechOut.** One utterance at a time: `speak()` stops the current one, whose promise
  resolves `{ completed: false }`. Pass the language pack's word spans as `words`.
- **SpeechIn.** A session emits partials, then at most one final, then exactly one end; a
  failure emits error, then end. `start()` never throws for runtime conditions.
  `submitTyped(text)` ("Type instead") works everywhere and emits a final with
  `source: 'typed'`. Show error text by `code` and status by `availability()` through i18n
  (`speechInErrorKey`, `speechInStatusKey` in `src/adapters/speechIn/messages.ts`). Details of
  the native adapter:
  - **Options.** Hold to speak passes `continuous: true`; `stop()` on release, and a `stop()`
    before the recognizer listens cancels (onEnd only). Pass story, lyric and command words as
    `hints` (iOS contextual strings, Android 13+ biasing). Pick `lang` and `langFallbacks`
    with `recognitionLocales(target, regions, deviceLocales)` (`locales.ts`: PR, DO and CU
    prefer es-US).
  - **On-device.** `onDevice: true` (the default promise) never falls back to a server: without
    on-device support the session fails with `on-device-unavailable`. Pass `onDevice: false`
    only when the learner allowed network recognition (no such setting exists yet). Android 13+
    can fetch a missing language pack (`availability().canDownload`, `downloadLanguage()`);
    Android 12 and older cannot force on-device recognition, so they need the network opt-in.
    iOS checks per-locale on-device support through `patches/expo-speech-recognition+58.0.1.patch`,
    which also makes the module refuse a server fallback when on-device is required.
  - **Timings and minutes spoken.** `FinalTranscript.words` are the engine's `TimedWord`s (ms
    from `start()`); `wordTiming` says whether they are measured (iOS), starts only (Android 14+
    on-device) or estimated from the voiced parts of the input level. Credit minutes spoken
    with `spokenMsOf(transcript)` (voiced time).
  - **Levels.** `onLevel` gives dBFS; `onMeter` gives a smoothed 0..1 for the hold animation, at
    most every 50 ms, ending at 0.
  - **iOS audio session.** Each session sets `playAndRecord`, mode `default`, options
    `defaultToSpeaker` and `allowBluetoothA2DP`, and leaves the session active afterwards, so
    text to speech right after a hold plays from the speaker at full volume (the module's own
    default, mode `measurement`, would make it quiet). Pause Apple Music before listening; the
    music feature switches the category back when it resumes playback. The reasons are in the
    header of `ExpoSpeechIn.ts`.
- **Music.** Call `authorize()` first. `'unsupported'` means there is no Apple Music here (web,
  Android); every other call then rejects with `MusicPlayerError('unsupported')`. See "Apple
  Music" for the iOS adapter and `pauseAt`.
- **Share.** `parseSpotifyShare({ url, text })` reads track links and URIs, `Song - Artist`
  and `"Song" by Artist`. A Spotify link that is not a track gives null. Read `pending()` on
  mount and listen with `onShare` (the device inbox also announces the items it restores at
  start); `clear(id)` once an item is handled. See "Share-in" for the device path.
- **Native-only packages.** llama.rn, expo-speech-recognition, expo-share-intent and the Apple
  Music module must stay out of the web bundle. `Services.ts` imports every factory, so import
  each native adapter through a module that has a `.web.ts` twin (for example
  `createDeviceModel.ts` plus `createDeviceModel.web.ts`, which returns the mock). Metro picks
  the twin for web; Jest (iOS) gets the native file, where jest-expo's mocks apply. Do not add
  native adapters to the `src/adapters/index.ts` barrel. `__tests__/importGraph.test.ts` uses
  the same resolution rules; extend it when you add a native package. expo-speech-recognition
  is required only by `src/adapters/speechIn/createNativeSpeechIn.ts` (twin: `.web.ts`); Jest
  uses the manual mock `__mocks__/expo-speech-recognition.ts`, because the package ships none.
  llama.rn is imported only by `src/adapters/model/createDeviceModel.ts`; Jest uses
  `__mocks__/llama.rn.ts`, the fake in `src/testing/fakeLlamaRn.ts`. The model download
  (`ExpoModelManager`, `fileHash`, expo-file-system's `DownloadTask`, expo-keep-awake and
  `modules/cliffword-native`) is reached only through `src/adapters/model/createModelManager.ts`;
  its twin `createModelManager.web.ts` gives the web a `FakeModelManager` that is ready at once.
  The module's JS (`modules/cliffword-native/index.ts`) is null when the binary lacks it, and in
  Jest, so callers fall back. expo-share-intent is imported only by
  `src/adapters/share/ShareIntentBridge.tsx` (twin: `ShareIntentBridge.web.tsx`, children only);
  Jest uses `__mocks__/expo-share-intent.tsx`. The Apple Music module
  (`modules/cliffword-music`) is imported only by `src/adapters/music/createNativeMusicPlayer.ts`
  (twin: `.web.ts`, `UnsupportedMusicPlayer`); its JS is null on Android, in an older binary and
  in Jest.

### Apple Music (MusicKit, iOS)

`MusicKitPlayer` (`src/adapters/music/MusicKitPlayer.ts`) implements `MusicPlayer` over the
local module `modules/cliffword-music` (Swift, Expo Modules API, iOS 16.4+, Swift 5 language
mode). @lomray/react-native-apple-music 1.4.0 was evaluated and not used: it is a legacy bridge
module (`RCT_EXTERN_MODULE`, only the interop layer under the New Architecture), its own
`postinstall` runs patch-package and fails without it, it sends the position once a second, its
library listing has no search or order, and songs carry no explicit flag.

- **Library.** `librarySongs({ query, order, limit, offset })`: `MusicLibraryRequest<Song>` with
  `filter(text:)`, sorted by date added (default), last played or title. Songs without play
  parameters are left out; artwork URLs that are not http(s) (library items use a private
  scheme) are dropped.
- **Playback.** `play(id)` queues the one library song and plays it; `pause`, `resume`, `seek`
  return the module's snapshot. `positionMs()` extrapolates from the last snapshot; the module
  sends `onPlaybackTime` every 250 ms while playing to re-anchor it, and `onPlaybackState` on
  status or song changes. A stop or pause this player did not ask for within 1.5 s of the end
  reads as `'ended'`.
- **Lyric lines.** `pauseAt(lineEndMs, { leadMs })` arms the module's main-queue timer: it sleeps
  until 300 ms before the target, checks every 10 ms, sleeps exactly the remainder for the last
  step and pauses (tolerance `PAUSE_TOLERANCE_MS`, 100 ms). It resolves `{ outcome: 'paused',
  positionMs }`, or `'cancelled'` with a reason (seek, replace, clear, new song, end, past the
  target). Pause and resume leave it armed. `FakeMusicPlayer` pauses exactly at the target;
  `PausePoller` (`linePause.ts`) is the JavaScript fallback for a binary without the timer.
- **Errors.** Module codes `ERR_MUSIC_NOT_AUTHORIZED`, `ERR_MUSIC_NOT_FOUND`,
  `ERR_MUSIC_NO_SUBSCRIPTION` and `ERR_MUSIC_FAILED` map to `MusicPlayerError` codes.
- **Not checked here.** The Swift is not compiled in this container (no Xcode); the first EAS
  iOS build compiles it. The App ID needs the MusicKit app service in the Apple Developer
  portal, and catalog playback needs an Apple Music subscription.

### Share-in (expo-share-intent)

Sharing a Spotify track link or a `Song - Artist` text from another app opens Cliffword:

1. iOS: the share extension (`CliffwordShare`, bundle id `app.cliffword.share-extension`, App
   Group `group.app.cliffword`) stores the item and opens
   `cliffword://dataUrl=cliffwordShareKey?nonce=…#weburl`; `app/+native-intent.tsx` sends that
   to `/music`. Android: `ACTION_SEND` `text/plain` reaches the single-task main activity.
2. `ShareIntentBridge` (in the root layout, inside `AppProviders`) maps the hook's payload with
   `shareIntentToInput` (link as `url`, text unless it is only that link) and calls
   `services.share.receive()`. `ExpoShareInbox` writes the item to `share_inbox` first, then shows
   it in `pending()` and calls `onShare`. The bridge then clears the native copy
   (`resetShareIntent()`) and opens the Music tab (on Android it waits for the navigator).
3. A repeated delivery (the hook re-reads when the app becomes active, or the same song is shared
   twice) is stored and announced once. Unhandled items come back at the next start
   (`restore()`, called by the bridge). If storage cannot be opened the item stays in memory for
   this run.

### On-device model (llama.rn)

`LlamaModelAdapter` runs Qwen3-1.7B Q4_K_M through llama.rn 0.13.0-rc.11. The full design is in
`src/adapters/model/README.md`.

- **The patch.** `patches/llama.rn+0.13.0-rc.11.patch` (patch-package) adds what llama.rn lacks:
  log-probabilities of a supplied text.
  - `LlamaContext.scoreText(contextText, text)` gives per-token ids, UTF-8 byte ranges and
    logprobs.
  - `LlamaContext.nextTokens(contextText, k)` gives the k most likely next tokens.
  - `isTextScoringAvailable()` says whether the binary has them.

  Native JSI functions do the work, in `cpp/jsi/RNLlamaJSI.cpp` and the new
  `cpp/jsi/CliffwordScore.cpp`. Both platforms compile them from source, and they call only
  symbols the prebuilt libraries export. They follow llama.rn's own pattern: the thread pool, a
  promise resolved on the JS thread, the per-context claim (so they never run beside a
  completion), and llama.rn's prompt-cache bookkeeping. The semantics are `proof/model_server.py`'s.
- **After a llama.rn upgrade.** Port the hunks marked "Cliffword", run `npm run patch:llama.rn`
  (`patch-package llama.rn`, without `package.json` and the downloaded native artifacts), then
  rerun `native-tests/scoring/`.
- **Linux comparison.** The patch's core, built against llama.rn's vendored llama.cpp, was run
  against `model_server.py` on 35 sentences from `pairs.jsonl`, `slang.jsonl` and edge cases.
  Totals, single tokens and the top-10 next-token lists agreed to 0.00000 nats.
- **Flash attention.** llama.rn's default (auto, which turns it on) moved sentence totals by up to
  1.08 nats, so the adapter turns it off.
- **Fallback.** Without the native calls, the adapter scores by forced decoding through llama.rn's
  completion API (`n_probs` 50, raw softmax). A token outside the list gets an upper bound
  (`upperBound: true`), and `info.scoring` is `'forced-decoding'`.

## Interface text (i18n)

- **No English in components.** Every interface string goes through `useI18n().t(key, vars)`.
- **Lookup order.** The pair pack's `pair.ui` (engine, en-es) comes first, then the app catalog
  for the learner's native language (`src/i18n/catalog/<lang>.ts`), then English, then the key
  itself (with a warning in development).
- **Placeholders and plurals.** Placeholders are `{name}`. Plurals are `key.one` / `key.other`,
  read with `plural(key, count)`.
- **Keys kept in data.** Wrap them in `tKey('...')`; the type checks them against the catalog.
- **Durations.** Format them through the `time.clock` pattern with `clockParts(ms)`.
- **Key check.** `src/i18n/keys.test.ts` fails when a `t`, `tKey` or `plural` key is missing.
- **Hard-coded text check.** The same test fails on literal text in JSX children (`Hello`,
  `{'Hello'}`, `{`${n} left`}`, and formatted text such as `0:00`), in text props (`label`,
  `title`, `hint`, `value`, `accessibilityLabel`, ...) and in navigator options (`title`,
  `tabBarLabel`, ...).
- **Content is data.** Content in the target language, such as story text, is not interface
  text.
- **Spoken commands.** `command.*.say` lives in the English catalog for now; another target
  language overrides it in its `pair.ui`.

## Accessibility

- **Touch targets.** Every control is at least 44 dp: `Button` and button `Pill`s have
  `minHeight: 44`, the profile button is 44×44, and the tab bar is 60 dp plus the safe area.
- **Names.** Icon-only controls (the profile button) have a translated `accessibilityLabel`,
  and decorative glyphs are hidden from screen readers.
- **Roles.** Region pills are toggle buttons with `checked` state. The startup loading state is
  a named progress bar. Hold to speak has a translated hint, because it works by long press, and
  an activate action that toggles listening for screen readers. Story tiles are buttons named
  "Word n" (see "Story views").
- **Checked in the route tests.** For the onboarding, Story, Music, profile and not-found
  screens, every button, toggle button and link must have an accessible name and a target of at
  least 44 dp. Tab bar buttons are exempt because they fill the 60 dp bar.

## Fonts

Newsreader (content), Inter (interface) and Anton (Music headings) come from
`@expo-google-fonts`. Each face is its own family, named by its PostScript name
(`Newsreader-Regular`, `Inter-SemiBold`, `Anton-Regular`, ...), so no style sets `fontWeight`.

- **iOS.** The expo-font plugin embeds the files (`UIAppFonts`).
- **Android.** The plugin generates one XML font family per face and registers it in
  `MainApplication` (`ReactFontManager.addCustomFont(..., "Inter-SemiBold", R.font.xml_inter_semi_bold)`).
  This was checked in the prebuild output.
- **Web.** `useAppFonts.web.ts` loads the same bundled files.
- **Test.** `src/theme/fonts.test.ts` checks the PostScript names against `app.json`.

## Look

- **Theme.** Light only in v1: `userInterfaceStyle: "light"`, applied on Android by
  `expo-system-ui`.
- **Tokens.** They come from the brief and the 390x844 previews:
  - ground `#F3F4F1`, ink `#16181D`, muted `#5B616B`, white cards;
  - heat `#FFE9C7` / `#FFC46B` / `#F08A1D`, accent text `#B4530A`;
  - tiles `#DDE0D8` / `#C6CAC1` / `#A6AB9F`, borders `#C9CCC4` / `#E4E6E0`.
- **Radii.** Cards 20, buttons 16, pills 999, tiles 7.
- **Background.** The root background (`backgroundColor`, also through `expo-system-ui`) and
  the web page are the ground color.

## Build and release config

- **`app.json`.**
  - Identity: name Cliffword, slug `cliffword`, owner `greypebs`, scheme `cliffword`, version
    1.0.0, `ios.bundleIdentifier` and `android.package` `app.cliffword`.
  - Display: portrait, light, no tablet.
  - Usage strings: microphone, speech recognition and Apple Music.
  - `ITSAppUsesNonExemptEncryption: false`.
  - Android permissions: `RECORD_AUDIO` plus a `blockedPermissions` list.
  - `extra.eas.projectId`, web output `single`.
  - New Architecture is the SDK default.
- **Plugins.** `expo-router`, `expo-status-bar`, `expo-splash-screen`, `expo-font` (with the
  font files). `expo-dev-client` and `expo-system-ui` are applied automatically by prebuild.
  `expo-sqlite` and `expo-asset` need no plugin entry without options. `expo-speech-recognition`
  takes the same microphone and speech recognition strings as `infoPlist` (the plugin writes its
  own over them; `src/adapters/speechIn/speechConfig.test.ts` keeps them equal) and
  `androidSpeechServicePackages` `com.google.android.googlequicksearchbox` and
  `com.google.android.as` (package visibility for the Google recognizers). `llama.rn` takes these
  options:
  - `forceCxx20` (C++20 for the app target and every pod);
  - `enableOpenCLAndHexagon: false`, so Android loads llama.rn's CPU library variants and no
    OpenCL or Hexagon `uses-native-library` entries are added (the adapter runs Android on the
    CPU);
  - `enableEntitlements` with `entitlementsProfile: "production"`, which adds
    `com.apple.developer.kernel.extended-virtual-addressing` and `increased-memory-limit` to
    production builds.

  `ios.entitlements` sets `com.apple.developer.kernel.increased-memory-limit` for every build,
  because the model needs about 1.2 GB. `./modules/cliffword-native/app.plugin.js` (no options)
  adds Android backup rules that exclude `files/models/`, the downloaded model, from cloud backup
  and device transfer. Without them Auto Backup would include the 1.1 GB file, go over the
  25 MB quota and back up nothing, not even the learner's database.
  `src/adapters/model/cliffwordNativePlugin.test.ts` runs the plugin's mods.
  `expo-share-intent` takes `iosActivationRules` (one web URL, one web page, or text),
  `iosShareExtensionName: "Cliffword Share"` (the share-sheet name; the Xcode target is
  `CliffwordShare`), `iosShareExtensionBundleIdentifier: "app.cliffword.share-extension"`,
  `iosAppGroupIdentifier: "group.app.cliffword"` and `androidIntentFilters: ["text/plain"]` (the
  module reads only `text/plain` as text). The plugin declares the extension for EAS
  (`extra.eas.build.experimental.ios.appExtensions`, with its App Group entitlement) when the
  config is evaluated, so app.json does not repeat it (a second entry for the same target makes
  the plugin fail). The local `modules/cliffword-music` needs no plugin entry.
- **Checked in prebuild output** (SDK 58, `npx expo prebuild --no-install --clean` on a copy):
  - **Info.plist:** the three usage strings, `ITSAppUsesNonExemptEncryption` false, the 8
    fonts in `UIAppFonts`, URL schemes `cliffword`, `app.cliffword` and `exp+cliffword` (dev
    client), `UIUserInterfaceStyle` Light, `RCTRootViewBackgroundColor` = `#F3F4F1`, iPhone
    only.
  - **Entitlements and build settings:**
    - `Cliffword.entitlements` has `increased-memory-limit`, and with
      `EAS_BUILD_PROFILE=production` also `extended-virtual-addressing`;
    - the app target uses `gnu++20`, and the Podfile `post_install` forces C++20 on every pod
      (`LLAMA_RN_CXX20`);
    - there is no OpenCL `uses-native-library` in the AndroidManifest.
  - **AndroidManifest:** `INTERNET`, `RECORD_AUDIO` and `VIBRATE`; every blocked permission
    marked `tools:node="remove"`; schemes `cliffword` and `exp+cliffword`; portrait; `<queries>`
    for `android.speech.RecognitionService` in the two Google recognition packages.
  - **Android resources:** the system UI style `light`, the window background `#F3F4F1`, and
    the 8 fonts registered.
  - **Backup rules:** `android:fullBackupContent="@xml/cliffword_backup_rules"` and
    `android:dataExtractionRules="@xml/cliffword_data_extraction_rules"` on the application,
    and both XML files in `res/xml` excluding `domain="file" path="models/"`.
  - **Local module autolinking** (`npx expo-modules-autolinking resolve --platform apple|android
    --json` in the copy):
    - iOS: pod `CliffwordNative` from `modules/cliffword-native/ios`, Swift module
      `CliffwordNative`, class `CliffwordNativeModule`; the generated `ExpoModulesProvider.swift`
      imports `CliffwordNative` and registers `CliffwordNativeModule.self`.
    - Android: project `cliffword-native` with `app.cliffword.nativemodule.CliffwordNativeModule`.
    - iOS: pod `CliffwordMusic` from `modules/cliffword-music/ios`, class
      `CliffwordMusicModule` (no Android project: the module is Apple-only).
    - CocoaPods is not installed here, so there is no `Podfile.lock`.
  - **Share extension:** target `CliffwordShare` (product `CliffwordShare.appex`, embedded in
    PlugIns with a target dependency), `PRODUCT_BUNDLE_IDENTIFIER` `app.cliffword.share-extension`,
    `ShareExtension-Info.plist` with display name `Cliffword Share`, the three activation rules,
    `com.apple.share-services` and `AppGroupIdentifier` `group.app.cliffword`; both the app's and
    the extension's entitlements list `group.app.cliffword`; `ShareViewController.swift` opens
    the `cliffword` scheme with key `cliffwordShareKey`. The app's Info.plist has
    `AppGroupIdentifier`.
  - **Share intent (Android):** the main activity has `launchMode="singleTask"` and an
    `android.intent.action.SEND` filter for `text/plain` (category `DEFAULT`).
- **`eas.json`.**
  - `appVersionSource: "remote"`: build numbers live on EAS, and Android versionCode is already
    2 there.
  - Profiles: `development` (dev client, internal), `development-simulator`, `preview`
    (internal, Android APK), `preview-simulator`, and `production` (auto-increment, Android app
    bundle).
- **Native folders.** `ios/` and `android/` are generated by prebuild and ignored by git.
