# App architecture and testing: research notes

Date: 2026-11-15. Role: researcher (app architecture and testing). Scope: repository layout,
navigation, state, SQLite, interface text, theming, gestures and components, testing.
Sibling notes in this folder: `device-speech.md` (llama.rn, speech in and out, minutes spoken)
and `music-share-store.md` (MusicKit, share-in, lyrics storage, EAS and store). These notes follow
their decisions and point out the few places where they disagree.

State of the tree when checked: `app/` is untracked and was being scaffolded by another agent
while this research ran. It already has expo-router routes in `app/app/`, theme tokens, fonts
embedded by the expo-font plugin, an i18n translator, `PacksProvider`, `metro.config.js`,
`babel.config.js` and `jest.config.js`, and it depends on `"@cliffword/engine": "file:../engine"`.
`engine/src/speaking`, `lyrics` and `session` did not exist yet. `model/http.ts`, `topN.ts`,
`contract.ts` and `lang/es/commands.ts` did. The design previews are not in the repo: they are only in
`scratchpad/design/project/*.dc.html` and they reference a missing `./support.js`.

---

## 0. What was verified here (commands, results)

Every probe ran in scratch copies. Nothing was written to `app/` or `engine/`.

| # | Check | Result |
|---|---|---|
| V1 | jest-expo 58.0.14 + @testing-library/react-native 14.1.0, test importing `@cliffword/engine` through the `file:` symlink, running `scoreWords` with `createMockModel()` and `new LearnerModel()` | Passes in 3 s. babel-preset-expo strips the engine TS. Files outside `app/` are transformed because jest-expo passes the preset programmatically with `root = cwd`, so jest must run with `cwd = app/` |
| V2 | jest-expo also turns tsconfig `paths` into `moduleNameMapper` automatically (`withTypescriptMapping`), relative to `rootDir` | Seen in the probe. The app's explicit `moduleNameMapper` for `@cliffword/engine` is redundant but harmless |
| V3 | RNTL 14 API | `render`, `renderHook`, `fireEvent.*` and `userEvent.press/longPress` all return Promises: always `await`. Peer `test-renderer ^1.0.0` (not react-test-renderer). expo-router 58 `renderRouter()` is async too |
| V4 | `node:sqlite` (`DatabaseSync`) inside the jest-expo React Native test environment, Node 22.23.4 | Works with `:memory:`: `PRAGMA user_version`, `BEGIN`/`ROLLBACK`, `INSERT … ON CONFLICT DO UPDATE`, `json_extract`. It prints an ExperimentalWarning. **Binding a boolean throws** ("Provided value cannot be bound") |
| V5 | RNGH 3.3.0 hook gestures in jest (`useLongPressGesture`, `useTapGesture`, `useExclusiveGestures`, `GestureDetector`, setup `react-native-gesture-handler/jestSetup`) | `createGestureController(getByGestureTestId('hold'))` with `.begin()/.activate()/.end()` fires onActivate and onFinalize. `fireGestureHandler(getByGestureTestId('tile-tap'))` fires a tap and a hold separately. `onFinalize(event)` reports cancellation as `event.canceled`; there is no second argument |
| V6 | `npx expo export --platform android` / `--platform ios` | Hermes `.hbc` bundles on Linux in about 28 s each (1727 and 1764 modules) |
| V7 | `npx expo export --platform web` | About 27 s. The engine is in the bundle (the string "Frase en español" is found). Routes are split into chunks (`profile-*.js`) |
| V8 | Playwright (global install) serving the export statically at 390x844, DPR 2 | Screenshots of `/`, `/music` and `/profile` have no page errors, and Newsreader and Inter load. Observation: **the tab bar labels are clipped at the bottom** of the 844 px viewport |
| V9 | expo-sqlite 58.0.17 **web** build (wa-sqlite worker; `'wasm'` added to `assetExts`), route opening `openDatabaseAsync(':memory:')`, using `withTransactionAsync`, an upsert and `PRAGMA user_version` | Works in headless Chromium from the static export, with and without COOP/COEP headers. The wasm asset is 641 KB. Real browsers need the headers (SharedArrayBuffer), so send them anyway |
| V10 | Design previews `*.dc.html` opened from file:// in Chromium with `support.js` stubbed by `page.route` | They render at 390x844 with Google Fonts (Inter, Newsreader, Anton), so reference screenshots can be generated |
| V11 | `npx expo prebuild --no-install --platform all --clean` | Generates `ios/` and `android/` on Linux, which validates the config plugins. Warning: **"userInterfaceStyle: Install expo-system-ui in your project to enable this feature."** |
| V12 | `npx expo-doctor@latest` | 20/20 checks passed |
| V13 | App `tsc --noEmit` (TS 6.0.3) with **engine/node_modules absent** (the state of CI or EAS) | **Fails**: `../engine/src/model/contract.ts(23,49): Cannot find module 'vitest'`. The app tsconfig includes `../engine/src/**/*.ts`, and contract.ts (a test harness, not a .test.ts file) imports vitest |
| V14 | Engine typecheck with the app's TypeScript 6.0.3 | 0 errors (the engine has 5.9.3 installed) |
| V15 | `createDefaultSpanishPack()` + `createDefaultPairPack()` cost | 0 to 1 ms (lazy), with 1788 frequency lemmas, 445 cognates and 59 ui keys. An empty learner snapshot is 404 B. No need to defer pack construction |
| V16 | SDK 58 `bundledNativeModules.json` (what `npx expo install` picks) | RNGH **~3.3.0** (npm latest 3.5.0 is *not* SDK-compatible), reanimated 4.7.1, worklets 0.13.0, react-native-svg 15.16.0, expo-sqlite ~58.0.17, expo-system-ui ~58.0.7, expo-haptics ~58.0.8, expo-file-system ~58.0.13, expo-localization ~58.0.5, react 19.3.0. expo-speech-recognition is not listed (third-party), so pin it exactly |
| V17 | expo-file-system 58.0.13 `File#digest(algorithm)` | `'MD5' | 'SHA-1' | 'SHA-256' | …`, returning lowercase hex. **SHA-256 can be checked natively**; `device-speech.md` D3 assumed MD5 only. `DownloadTask` has `pauseAsync/resumeAsync/savable()/fromSavable()` and `Paths.availableDiskSpace` |
| V18 | Hugging Face `unsloth/Qwen3-1.7B-GGUF` | Revision `d7f544eead698dbd1f15126ef60b45a1e1933222`, `Qwen3-1.7B-Q4_K_M.gguf` 1,107,409,472 B, sha256 `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897` (matches the sibling notes) |

Probe files (scratch): `scratchpad/jestprobe/` (jest probes), `scratchpad/mono/` (mirror plus
exports), `scratchpad/tools/shot.js` (static server plus app screenshots), `tools/refshot.js`
(design-preview reference screenshots) and `tools/text.js` (expo-sqlite web probe).

---

## 1. Repository layout

### 1.1 Recommendation: two independent packages linked by `file:` (what is in the tree), not npm workspaces

```
cliffword/
  package.json          # NEW, scripts only, no "workspaces": ci/test/typecheck for both
  engine/               # @cliffword/engine, "main": "src/index.ts", vitest, own package-lock
  app/                  # Expo 58, "@cliffword/engine": "file:../engine", jest-expo, own package-lock
    app/                # expo-router routes (keep non-route code out)
    src/                # components, features, services, storage, i18n, theme
    __tests__/          # route and screen tests (never under app/app)
    e2e/                # Playwright scripts for the web preview
    patches/            # patch-package (llama.rn JSI patch from device-speech.md)
    modules/musickit/   # local Expo module (music-share-store.md D1)
  docs/  proof/
```

Root `package.json` (scripts only):

```json
{
  "private": true,
  "scripts": {
    "ci": "npm --prefix engine ci && npm --prefix app ci",
    "check": "npm --prefix engine run check && npm --prefix app run check",
    "preview:shots": "npm --prefix app run preview:shots"
  }
}
```

Why not npm workspaces (the brief allows either; this is a judgement call):

- **Hoisting breaks literal paths.** `app.json` embeds fonts as
  `./node_modules/@expo-google-fonts/...`, and with workspaces those packages move to
  `/node_modules`. The same goes for config plugins that read files and for `patches/` (patch-package must then run at
  the root, against the hoisted `llama.rn`). It can be fixed with `app.config.ts` + `require.resolve`, but that is
  churn for no gain.
- **Duplicate React risk.** With workspaces, a peer-range mismatch (test-renderer, RNTL, a
  plugin) can install a second `react` under `app/node_modules`, which causes "Invalid hook call". With `file:`
  every app dependency resolves inside `app/node_modules`.
- **The engine has zero runtime dependencies** (only `vitest` and `typescript` for development), so
  there is nothing to share.
- What workspaces would buy (one lockfile, `getDefaultConfig` auto-detecting `watchFolders`)
  is small. The `file:` setup is already verified end to end (V1, V6 to V12).

If workspaces are chosen later: put `{"private":true,"workspaces":["engine","app"]}` at the root,
delete both package-locks, set `"@cliffword/engine": "*"`, and delete the manual
`watchFolders`/`nodeModulesPaths` (Expo 58's `getDefaultConfig` reads the workspace globs and
sets watchFolders = root node_modules + each workspace, and nodeModulesPaths = app + root
node_modules; checked in `@expo/metro-config/build/getWatchFolders.js` and
`getModulesPaths.js`). Then switch font paths to `require.resolve` in `app.config.ts` and move
`patches/` to the root.

### 1.2 Metro (the config in the tree is right)

`app/metro.config.js`:

- `getDefaultConfig(__dirname)` keeps the Expo defaults;
- `watchFolders += ../engine` (required: Metro only serves files inside watchFolders, and the
  `file:` symlink's real path is `../engine`);
- `resolver.nodeModulesPaths = [app/node_modules]`, so bare imports emitted into engine files
  (`@babel/runtime/...`) resolve from the app;
- `blockList` hides `../engine/node_modules`, `../engine/test` and `*.test.ts`;
- **add** `config.resolver.assetExts.push('wasm')` when expo-sqlite's web build is used (V9),
  plus COOP/COEP headers on the dev server (`config.server.enhanceMiddleware`) and in the
  preview static server.

Recommended addition: blockList `../engine/src/model/contract.ts`. It imports vitest and must
never be bundled. It is not exported from `engine/src/index.ts` today, so this is a safety net only.

### 1.3 Jest (app) and vitest (engine)

- Keep **vitest for the engine** (`engine/`: `npm run check`).
- App: preset `jest-expo` (iOS platform by default), `setupFiles: ['react-native-gesture-handler/jestSetup', …]`.
  The `jest.config.js` in the tree (explicit babel-jest 30 path, `configFile: babel.config.js`,
  `transformIgnorePatterns` for expo, react-native, @expo-google-fonts and llama.rn) works.
  Run jest **from `app/`** (V1).
- `testPathIgnorePatterns` must keep `../engine/` so that jest never runs vitest files.
- Add `"test": "NODE_OPTIONS=--disable-warning=ExperimentalWarning jest"` to silence the
  node:sqlite warning (Node ≥ 22.13 needed for unflagged `node:sqlite`; CI uses Node 22, and 22.23
  is installed here).
- Reanimated 4 in jest: call `require('react-native-reanimated').setUpTests()` in setup (it is exported
  by 4.7.1), or `jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))`.

### 1.4 TypeScript

- App tsconfig in the tree: `extends expo/tsconfig.base`, `paths: {"@cliffword/engine":
  ["../engine/src/index.ts"]}`, `include` app files and `../engine/src/**/*.ts`.
- **Fix V13**: add `"../engine/src/model/contract.ts"` to `exclude`, or (cleaner, an engine
  change) move the harness to `engine/test/contract.ts` or name it `contract.testkit.ts` and exclude
  `../engine/**/*.testkit.ts`. Otherwise the app typecheck needs `engine/node_modules` installed.
- Align TypeScript: the app is on ~6.0.3 and the engine on ^5.6.3 (5.9.3 installed). The engine already passes
  under 6.0.3 (V14), so bump the engine to `~6.0.3` and both packages typecheck the engine identically.

---

## 2. Navigation and screens (expo-router 58)

### 2.1 Route tree

```
app/app/
  _layout.tsx               Root Stack. Providers (Services, I18n, GestureHandlerRootView,
                            SafeArea). Guards with Stack.Protected (exists in 58: guard prop).
  +native-intent.tsx        Maps share-intent deep links to /music/share (expo-share-intent).
  +not-found.tsx
  onboarding/
    _layout.tsx             Stack, headerShown false, gestureEnabled false on first screen
    index.tsx               Start: "Start the first story" (placement) | "I'm brand new"
    language.tsx            Native language (skipped while only one catalog/pair exists;
                            default from expo-localization getLocales()[0].languageCode)
    slang.tsx               Register (neutral/street), regions (PR/DO/CU/CO pills),
                            explicit lyrics (default ON, brief)
    voice.tsx               Mic + speech permission, on-device check, "type instead" path
    model.tsx               1.1 GB download: disk space, Wi-Fi note, progress, pause/resume;
                            "Continue while it downloads" (device-speech.md D10 canned mode)
  (tabs)/
    _layout.tsx             Tabs (Story, Music) + corner ProfileButton in a shared header
    index.tsx               Story tab: ONE route, renders the StorySession screen by kind
    music/
      _layout.tsx           Stack inside the Music tab
      index.tsx             C3 Your music
      [songId].tsx          Song page: mode = read (A3) | cliff (C1) | echo (B4), ?mode=
      registers.tsx         C2 Two registers (also reachable from a song)
      paste.tsx             Paste lyrics (presentation: 'modal' / formSheet)
      share.tsx             Confirm a shared Spotify / Apple Music link (title, artist, paste)
  retell.tsx                B3, presentation 'fullScreenModal', gestureEnabled false while running
  profile/
    _layout.tsx             Stack, presented as modal from root (corner button)
    index.tsx               Profile: minutes spoken (headline), week, vocabulary estimate,
                            skill mix (meaning / sound / speaking)
    settings.tsx            Text mode, register, regions, explicit, speech rate, model
                            (status/delete/redownload), Apple Music, delete lyrics, reset
  (dev)/preview/[screen].tsx  Fixture gallery for Playwright; guarded by
                            Stack.Protected guard={__DEV__ || EXPO_PUBLIC_CLIFFWORD_ENV==='preview'}
```

Root layout guard:

```tsx
<Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
  <Stack.Protected guard={onboarded}>
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
    <Stack.Screen name="retell" options={{ presentation: 'fullScreenModal' }} />
  </Stack.Protected>
  <Stack.Protected guard={!onboarded}>
    <Stack.Screen name="onboarding" />
  </Stack.Protected>
</Stack>
```

`onboarded` comes from the settings store (SQLite), loaded before the splash hides.

Rules:

- **Story is one route.** The StorySession (engine) is a state machine that returns plain-data
  screens (`cliff`, `landing`, `repair`, `noSe`, `placementDone`, `loading`…). The route renders
  `<StoryScreen screen={…}/>` and switches on `screen.kind`. Routes per state would fight
  the back stack and session restore.
- Text shown and text hidden are **not separate screens**. Main and B1 are the two ends of one
  per-word rendering (`showText` per word). The "Show text / Hide text" pill forces all text shown or all hidden.
- Retell is a route because it is a timed mode with its own exit and must not be swiped away.
- Tab bar: `Tabs` from `expo-router` with a custom `tabBar` (Inter 13, ink/muted), or the
  headless `expo-router/ui` (`Tabs`, `TabList`, `TabTrigger`, `TabSlot`) for full control. Fix the
  label clipping seen at 390x844 on web (V8): give the bar an explicit height that includes the bottom safe-area
  inset.
- Share intent: `+native-intent.tsx` `redirectSystemPath()` sends the share-extension URL to
  `/music/share`. Wrap the root in `ShareIntentProvider`; on web and in tests use a fake
  `ShareInbox` (section 3).

### 2.2 Design preview to route and component map

| Preview | Route | Screen data | Components |
|---|---|---|---|
| Main (Ink · Cliff) | `(tabs)/index` | `cliff`, most words text | `StoryHeader` (wordmark, ProfileButton, `TextModePill`), `MetaLine` (CHAPTER · TITLE · SPOKEN m:ss), `StoryFlow` (text words, `NewWordUnderline` dotted accent, `CliffGap` ink pill with dots), `GlossChip` (heat1, "puesto · stall · new for you"), `CliffCard` (title, hint, `HoldButton` primary "Hold to speak", ghost actions Type instead / Hear it again / Skip) |
| A2 (Ink · Repair) | `(tabs)/index` | `repair` | `SpeakerPrompt` ("MARTA ASKS YOU" + Newsreader line), `YouSaid` + `HeatSentence` (per-word heat 0-3) + `HeatLegend` (expected→surprising), `RepairCard` ("One word surprised me", Say it again, Show me the answer), `UpNextCard` → `/retell` |
| A3 (Ink · Song) | `music/[songId]?mode=read` | `LyricScreen` read | `SongHeader` (eyebrow source, title, artist · genre · region), `LyricLine` (slang underlines, gap), `SlangNoteList`, `RegisterToggle` ("TEACH ME TO SPEAK": Neutral / Caribbean street), `NowPlayingBar` ("0:42 · playing in Apple Music"), primary "Sing the next word" |
| B1 (Voice · Gap) | `(tabs)/index` | `cliff`, most words tiles | `StoryFlow` with `WordTile` (tap = hear, hold = reveal, age shading tileNew/Mid/Old), `CliffGap` live (dashed #FF8A3D, dots), `FutureTile` (dashed hollow), `TileHint`, `HoldArea` (dashed card, live rings, "Hold anywhere and say it"), `CommandChips` ("OR JUST SAY": Otra vez / Más despacio / No sé with glosses) |
| B2 (Voice · Landing) | `(tabs)/index` | `landing` | `AnswerEcho` ("leerla en voz alta"), `LandingHeadline` (landing.* keys), `LandingLine` (candidates on a surprising→expected axis, the learner's word as an ink pill), `LandingNote` ("About {n} times in 100…"), `HoldArea` ("say the whole line"), `CommandChips` (Otra vez, ¿Qué significa?, Siguiente) |
| B3 (Voice · Retell) | `retell` | `RetellScreen` | `RoundHeader` ("Retell · round 2 of 3", spoken), `RetellPrompt`, `Countdown` (display 52), `RetellLanes` (3 lanes 60/45/30 s, word tiles, pause holes, current lane live), `RetellStats` ("71 → 84 words a minute", "5 → 1 pauses"), hint "Say listo when you finish" |
| B4 (Voice · Echo) | `music/[songId]?mode=echo` | `LyricScreen` echo | `EchoTiles` (singer row: uniform heights because singer pitch cannot be read, slang tiles underlined; learner row: heights from the learner's own pitch, hollow tile = missed), "6 of 7 landed", `HoldArea` ("Hold anywhere and sing it again"), `CommandChips` |
| C1 (Music · Lyric cliff) | `music/[songId]?mode=cliff` | `LyricScreen` cliff | Anton: `MusicTitle`, previous line (musicLinePrev), current line with gap (musicLine), `ExplicitPill`, big "SING IT" (musicButton), "Stuck? Show three options" (options rung), "0:19 · the music waits for you" |
| C2 (Music · Two registers) | `music/registers` | register pair | `RegisterPairCard` ×2 (NEUTRAL · WORKS ANYWHERE / STREET · PUERTO RICO, WITH FRIENDS), `SwapList` (amigos → corillo …), `FriendTexts` prompt, "SAY IT STREET" + "Say it neutral", footnote |
| C3 (Music · Your music) | `music/index` | library | `SourceRow` ×3 (Apple Music / Spotify / Lyrics with action), `LibraryList` (initials avatar, title, artist · region · slang amount), `RegionPills`, `ExplicitRow` |
| none | `onboarding/*`, `profile/*` | settings / stats | Built from the same tokens and components (Card, Pill, Button, Text) |

There are no tab bars in the previews. The app adds a bottom bar, so comparisons are visual (side by
side), not pixel-exact (section 8.4).

---

## 3. State: services in context plus plain classes (no zustand)

Recommendation: **a small service container (plain TS classes), one `ServicesProvider`
React context, and a 20-line `Store<T>` read with React 19's `useSyncExternalStore`.** No zustand,
redux or react-query. The reasons:

- The engine's objects are mutable class instances (`LearnerModel`) and async orchestrators
  (StorySession, LyricSession). They should not live in React state or in an immutable
  store. React only needs (a) the current screen data (plain objects the sessions return)
  and (b) a few statuses (model, settings, playback).
- Every native capability sits behind an interface with a fake, chosen once in a factory per
  environment (device, web preview, jest). This is what makes the screens testable.
- There are no dependencies to keep compatible with React 19.3 / RN 0.88.

```ts
// src/services/store.ts
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get = (): T => this.value;
  set(next: T) { if (!Object.is(next, this.value)) { this.value = next; this.listeners.forEach((l) => l()); } }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
}
export function useStore<T>(s: Store<T>): T { return useSyncExternalStore(s.subscribe, s.get, s.get); }
```

```ts
// src/services/types.ts  (interfaces only; native, web and fake implementations elsewhere)
export interface Clock { now(): number }                     // ms since epoch, injectable
export interface AppServices {
  clock: Clock;
  ids: () => string;                                         // uuid; seeded in tests
  storage: Storage;                                          // repositories (section 4)
  settings: SettingsStore;                                   // Store<Settings> + typed setters
  packs: PackRegistry;                                       // pair id + regions → { pack, pair }
  learner: LearnerStore;                                     // LearnerModel + event log + snapshots
  model: ModelRuntime;                                       // status Store, ensureLoaded(): LanguageModel
  modelFiles: ModelFiles;                                    // download/verify/delete (expo-file-system)
  speechIn: SpeechIn;                                        // expo-speech-recognition | scripted fake
  speechOut: SpeechOut;                                      // expo-speech | silent/timed fake
  audio: AudioCoordinator;                                   // device-speech.md D9
  music: MusicService;                                       // music-share-store.md 1.4
  share: ShareInbox;                                         // expo-share-intent | fake
}
```

- **Environments**: `createDeviceServices()` (`src/services/device.ts`, which imports llama.rn,
  expo-speech, expo-speech-recognition, the musickit module and expo-sqlite),
  `createPreviewServices()` (web preview: `createMockModel()` or canned mode, scripted
  speech, fake music, expo-sqlite `:memory:`) and `createTestServices(overrides)` (jest:
  mock model, fake speech queue, NodeSqliteDriver, fixed clock). Pick the environment with a platform file
  (`services/index.native.ts` → device, `index.web.ts` → preview) plus
  `process.env.EXPO_PUBLIC_CLIFFWORD_ENV` (inlined at build time). Tests never import the device
  file.
- **Injection for route tests**: the root layout reads services from `getServices()` in
  `src/services/registry.ts`. Tests call `registerServices(createTestServices(...))` in
  `beforeEach` and then `await renderRouter('app', { initialUrl: '/' })`. No `jest.mock` of app
  modules is needed.
- **Sessions**: `StorySessionController` (plain class) wraps the engine's StorySession. It
  exposes `screen: Store<StoryScreenData>` and intent methods (`answer(utterance)`,
  `command(cmd)`, `tapWord(i)`, `revealWord(i)`, `typeAnswer(text)`, `next()`). After each step
  it writes learner events and the session snapshot in one transaction. It is restored from
  `sessions.snapshot` on launch. `LyricSessionController` does the same for songs.
- **Model calls**: one llama context accepts one operation at a time ("Context is busy",
  device-speech.md 1.6). `ModelRuntime` hands out a `LanguageModel` that serializes calls through a
  two-level priority queue: *interactive* (answer scoring, judgement) before *prefetch*
  (generating the next sentence while the learner thinks). Prefetch work is cancelled with
  `stopCompletion()` when an interactive call arrives or the screen unmounts. Model status:
  `absent → downloading(p) → verifying → ready → loading(p) → loaded | error(reason)`.
- **Packs**: `PackRegistry.get(pairId, regions)` memoizes `createDefaultSpanishPack({regions})` and
  `createDefaultPairPack({regions})` by `pairId + regions.join()`. Construction is under 1 ms (V15).

---

## 4. SQLite (expo-sqlite 58, async API)

### 4.1 One driver interface, three implementations

Repositories never touch expo-sqlite directly:

```ts
// src/storage/driver.ts
export type SqlValue = string | number | null | Uint8Array;   // no booleans (V4): store 0/1
export interface SqlDriver {
  exec(sql: string): Promise<void>;                            // trusted static SQL only
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;
}
```

- **Positional `?` parameters only.** expo-sqlite named parameters need `$`-prefixed keys,
  while node:sqlite accepts bare keys. Positional parameters behave the same on both.
- `ExpoSqliteDriver(db: SQLiteDatabase)` (iOS, Android, **and web**): `execAsync`, `runAsync`,
  `getAllAsync`, `getFirstAsync`, `withTransactionAsync`. `withTransactionAsync` lets queries
  issued elsewhere join the open transaction, and `withExclusiveTransactionAsync` is not
  available on web. So the driver serializes everything through one internal promise queue,
  and a transaction holds the queue. On open: `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`
  outside any transaction. Device file: `openDatabaseAsync('cliffword.db')`. Web preview:
  `openDatabaseAsync(':memory:')`, which starts fresh on every load for deterministic screenshots (V9).
- `NodeSqliteDriver` (jest only, `__tests__/support/nodeSqlite.ts`): `new DatabaseSync(':memory:')`,
  with sync calls wrapped in promises, `run()` mapping `lastInsertRowid` to `lastInsertRowId`, rows spread out of the
  null prototype, and `transaction` doing `BEGIN`, then `COMMIT` or `ROLLBACK`. It needs no dependencies (V4). Never import it
  from `src/`, because Metro cannot resolve `node:sqlite`. Fallback if CI ever runs Node < 22.13: `sql.js` 1.16.0
  (wasm) behind the same interface.
- Do not use expo-sqlite's own jest path: its `SQLiteModule.node.ts` is an empty stub (every
  query returns nothing), and jest-expo does not mock it.

### 4.2 Migrations (`PRAGMA user_version`)

```ts
// src/storage/migrations.ts
export const MIGRATIONS: readonly string[] = [/* v1 */ SCHEMA_V1 /*, v2 … */];
export async function migrate(db: SqlDriver): Promise<number> {
  const from = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (from > MIGRATIONS.length) throw new Error(`database v${from} is newer than app v${MIGRATIONS.length}`);
  for (let v = from; v < MIGRATIONS.length; v++) {
    await db.transaction(async (tx) => {               // schema step and version bump commit together
      await tx.exec(MIGRATIONS[v]!);
      await tx.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return MIGRATIONS.length;
}
```

Never delete a database to recover from a failed migration. Migrations are append-only. Changing a
shipped migration is a test failure: a hash of each entry is pinned in
`migrations.test.ts`.

### 4.3 Schema v1

```sql
-- Settings: typed in code (schema with defaults and validators); stored as JSON text.
CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;

-- Learner events: append-only. The whole LearnerEvent is in `event`; columns are for queries.
CREATE TABLE learner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT NOT NULL,                       -- 'en-es'
  at INTEGER NOT NULL,                      -- event.at (ms)
  type TEXT NOT NULL,                       -- event.type
  key TEXT NOT NULL,                        -- learner key, e.g. 'es:tener'
  event TEXT NOT NULL,                      -- JSON LearnerEvent (credit, rung …)
  session_id TEXT                           -- which session produced it (nullable)
);
CREATE INDEX learner_events_pair_id ON learner_events(pair, id);
CREATE INDEX learner_events_key ON learner_events(key);

-- Learner snapshots: checkpoints of LearnerModel.snapshot(); replay events after last_event_id.
CREATE TABLE learner_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_event_id INTEGER NOT NULL,
  prior TEXT NOT NULL,                      -- JSON PriorSpec (below): the prior is a function, not in the snapshot
  snapshot TEXT NOT NULL                    -- JSON LearnerSnapshot (version 1)
);
CREATE INDEX learner_snapshots_pair ON learner_snapshots(pair, id);

-- Stories, chapters, sentences (the story text the learner has heard).
CREATE TABLE stories (
  id TEXT PRIMARY KEY NOT NULL, pair TEXT NOT NULL, title TEXT,
  register TEXT NOT NULL DEFAULT 'neutral' CHECK (register IN ('neutral','street')),
  regions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, title TEXT,
  spoken_ms INTEGER NOT NULL DEFAULT 0,     -- "spoken 4:12" in the header
  started_at INTEGER NOT NULL,
  UNIQUE (story_id, number)
);
CREATE TABLE sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  targets TEXT NOT NULL DEFAULT '[]',       -- learner keys introduced here
  cliff TEXT,                               -- JSON CliffPick summary or NULL
  created_at INTEGER NOT NULL,
  UNIQUE (chapter_id, idx)
);

-- Session snapshots (engine session snapshot()/restore()).
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('story','lyric','retell','placement')),
  ref_id TEXT,                              -- story id or song id
  format INTEGER NOT NULL,                  -- snapshot format version from the engine
  snapshot TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX sessions_open ON sessions(kind, closed_at);

-- Songs and lyrics (aligned with music-share-store.md 4.2: TEXT ids by source).
CREATE TABLE songs (
  id TEXT PRIMARY KEY NOT NULL,             -- 'am:catalog:<id>' | 'am:library:<id>' | 'sp:<trackId>' | 'local:<uuid>'
  source TEXT NOT NULL CHECK (source IN ('apple_music','spotify_share','manual')),
  apple_catalog_id TEXT, apple_library_id TEXT, spotify_track_id TEXT, share_url TEXT, isrc TEXT,
  title TEXT NOT NULL, artist TEXT NOT NULL,
  is_explicit INTEGER NOT NULL DEFAULT 0,
  region TEXT,                              -- PR/DO/CU/CO hint from slang found in the lyrics
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_opened_at INTEGER
);
CREATE TABLE lyrics (
  song_id TEXT PRIMARY KEY NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,                   -- exactly as pasted
  parsed TEXT NOT NULL,                     -- JSON from engine lyrics parser
  parser_version INTEGER NOT NULL,          -- re-parse lazily when the engine's version changes
  timings TEXT,                             -- JSON [{line, startSec}] from taps or LRC
  origin TEXT NOT NULL CHECK (origin IN ('pasted','shared-text','lrc')),
  updated_at INTEGER NOT NULL
);

-- Minutes spoken per local day (the headline metric), per activity.
CREATE TABLE speaking_log (
  day TEXT NOT NULL,                        -- local 'YYYY-MM-DD' at the time of speaking
  activity TEXT NOT NULL CHECK (activity IN ('cliff','repair','retell','echo','lyric','repeat')),
  voiced_ms INTEGER NOT NULL DEFAULT 0,
  utterances INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, activity)
) WITHOUT ROWID;
-- add: INSERT INTO speaking_log(day,activity,voiced_ms,utterances) VALUES (?,?,?,1)
--      ON CONFLICT(day,activity) DO UPDATE SET voiced_ms = voiced_ms + excluded.voiced_ms,
--                                              utterances = utterances + 1;

-- Model files and download state.
CREATE TABLE model_files (
  id TEXT PRIMARY KEY NOT NULL,             -- 'qwen3-1.7b-q4_k_m'
  url TEXT NOT NULL, revision TEXT NOT NULL,
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
  path TEXT,                                -- local file URI when present
  status TEXT NOT NULL CHECK (status IN ('absent','downloading','paused','verifying','ready','failed')),
  downloaded_bytes INTEGER NOT NULL DEFAULT 0,
  pause_state TEXT,                         -- JSON DownloadPauseState (DownloadTask.savable())
  error TEXT,
  updated_at INTEGER NOT NULL
);
```

Settings keys (typed schema `SETTINGS` with defaults): `pair` ('en-es'), `native` ('en'),
`onboarding` ({ done:false, start: 'placement'|'brandNew'|null }), `register` ('neutral'),
`regions` (['PR']), `explicit` (**true**, per the brief), `textMode` ('auto'|'shown'|'hidden'),
`speechRateScale` (1), `modelId` ('qwen3-1.7b-q4_k_m'). Booleans are stored as JSON true/false inside the
TEXT value, so there is no bind problem.

### 4.4 Learner persistence (event log plus checkpoints)

```ts
export type PriorSpec =
  | { kind: 'default' }
  | { kind: 'brandNew' }                                   // PlacementTracker.brandNew(cognateLexemeKeys(pair))
  | { kind: 'placement'; placement: PlacementSnapshot };   // PlacementTracker.restore(p).prior(rankOf, cognateKeys)
```

- Boot: load the latest snapshot for the pair, rebuild the `PriorFn` from `prior` with the current
  packs (`rankOf` from `frequencyLexemeKeys(pack)`), call `LearnerModel.restore(snapshot, { prior })`,
  then replay `learner_events WHERE pair=? AND id > last_event_id ORDER BY id` with `applyAll`.
  This is deterministic because time comes from the events.
- Write: `LearnerStore.apply(events)` = `model.applyAll(events)` plus `INSERT`s, in the same
  `transaction` as the session snapshot.
- Checkpoint every 200 events, when the app goes to the background (AppState) and when a session closes. Keep
  the last 3 snapshots per pair.
- Placement: the placement session stores `PlacementTracker.snapshot()` in its session snapshot.
  When it finishes, write a learner snapshot whose `prior` is `{kind:'placement', …}`.

### 4.5 Repositories

`src/storage/repos/*.ts`, each a set of functions taking `SqlDriver`: `settingsRepo`,
`learnerRepo` (appendEvents, latestSnapshot, eventsAfter, saveSnapshot, pruneSnapshots),
`storyRepo` (createStory, addChapter, appendSentence, addSpokenMs, chapterMeta), `sessionRepo`
(save, loadOpen, close), `songRepo` / `lyricsRepo` (music-share-store.md `LyricsStore`),
`speakingRepo` (add, today, range for the week chart), `modelFileRepo`. The `Storage` facade
bundles them with one driver.

Tests (jest + NodeSqliteDriver): migrate 0→N on an empty database; each step N-1→N on a fixture
with rows; a newer database version is refused; event append and replay rebuild
`snapshot()` byte-equal to a model built in memory; the speaking-log upsert sums;
`ON DELETE CASCADE` works (it needs `PRAGMA foreign_keys = ON` in the driver open); settings defaults
apply when keys are missing.

---

## 5. Interface text

What is in the tree is right. `src/i18n/translator.ts` looks up a key in this order:
**`pair.ui[key]` → `catalogs[native][key]` → `catalogs.en[key]` → the key itself** (with a warning in development).
Placeholders are `{name}` (`interpolate`), and plurals use `key.one/.other` read with `Intl.PluralRules`
(`plural(key, count)` also fills `{count}`). Hermes has `Intl.PluralRules`; `languageNames.ts` covers
the missing `Intl.DisplayNames`.

- Split of responsibility:
  - **App catalog per native language** (`app/src/i18n/catalog/<native>.ts`) holds all interface
    chrome that does not depend on the target language (Settings, Continue, Type instead,
    Hear it again, Show me the answer…).
  - **`PairPack.ui`** (engine, `pair/<native>-<target>/ui.ts`) holds strings that name or quote the
    target language: "You landed where a Spanish speaker would", "You can answer in
    English", spoken command phrases with their glosses ("otra vez — again"), slang labels and region names.
    A pair can reword any app key.
- API: `const { t, plural } = useI18n(); t('stats.understood', { n, m })`. Keep a `CatalogKey`
  type (`keyof typeof en`) so `t()` keys typecheck, and accept `string` for pair-only keys.
- Adding a pair (for example English for Spanish speakers, `es-en`): the engine adds a language pack (`lang/en`),
  rules, registers, `pair/es-en/` with `ui.ts` and a factory in `packs.ts`. The app adds
  `catalog/es.ts` (only if Spanish is a new native language), registers the pair in
  `PackRegistry`, and adds speech locales for the target language (see the gap below). Nothing else
  changes.
- Tests: (1) every `t('…')` literal in `src/` and `app/` exists in `en` or in some `pair.ui`
  (a jest test that scans the source); (2) for every key in two catalogs, the placeholder sets are equal;
  (3) `en` has no empty strings; (4) pseudo-locale render (`[!! … !!]` wrapper) of each screen
  fixture to catch hard-coded text (a jest test asserting no visible text node lacks the marker).
- Gap: `LanguagePack` has no speech locale or voice data (the brief lists "voices" in the language
  pack). Add `LanguagePack.speech?: { recognitionLocales: string[]; ttsLocales: string[];
  regionLocales?: Record<string, string> }` (es: es-US, es-MX, es-ES; PR→es-US, CO→es-CO), or an app map keyed by
  `pack.code`. Note device-speech.md D6: select the TTS voice by identifier on Android.

---

## 6. Theming

- Tokens are in `app/src/theme/tokens.ts` (in the tree, taken from the brief and previews): ground #F3F4F1,
  ink #16181D, muted #5B616B, card #FFFFFF, heat #FFE9C7/#FFC46B/#F08A1D, accentText #B4530A,
  live #FF8A3D (B1 gap and rings), tile ages #DDE0D8/#C6CAC1/#A6AB9F, borders, radii (tile 7,
  card 20, hold area 28, pill 999), spacing (24 side, 28 top). Typography variants come from the previews
  (content: Newsreader; interface: Inter; music: Anton, uppercase).
- Fonts: embedded at build time with the expo-font config plugin (`app.json` `ios.fonts`,
  `android.fonts` with one family per face, named by PostScript name). No runtime loading on native;
  web uses `useFonts` with the @expo-google-fonts/* 0.4.x files. Never set `fontWeight` (the faces are separate families).
- **Light only for v1.** `userInterfaceStyle: "light"` is already set. **Install `expo-system-ui`
  (~58.0.7)**: without it Android ignores the setting (V11 warning) and system dark mode can
  tint system UI. Reasons: the brief and previews define only light tokens; the amber heat
  ramp and tile greys would need new contrast work on a dark ground; a derived dark palette
  would be unreviewed design. Components read semantic token names only, so a dark palette
  can come later through a `ThemeProvider` with the same keys.
- Accessibility: allow Dynamic Type with `maxFontSizeMultiplier` around 1.3 on content text and 1.2 on dense
  chrome. WCAG contrast (computed): muted #5B616B on ground 5.65:1 and on white 6.24:1; accent
  #B4530A on white 5.02:1 and on ground 4.55:1 (AA for body text, only just on ground); ink on heat2 11.3:1
  and on heat3 7.07:1. Heat shading therefore keeps ink text. Never put white text on a heat color.

---

## 7. Gestures and components

### 7.1 Hold anywhere to speak (RNGH 3.3 hook API, verified in jest, V5)

```tsx
const hold = useLongPressGesture({
  minDuration: 120,            // a short tap is not a hold
  maxDistance: 10_000,         // the finger may drift while speaking
  shouldCancelWhenOutside: false,
  runOnJS: true,               // speech APIs are JS; no worklets
  testID: 'hold-anywhere',
  onBegin: () => speech.prepare(),                 // touch down: warm the recognizer and duck music
  onActivate: () => controller.startListening(),   // after minDuration: start, live UI
  onFinalize: (e) => (e.canceled ? controller.abortListening() : controller.stopListening()),
});
// Screen root: <GestureDetector gesture={hold}><View style={{flex:1}}>…</View></GestureDetector>
```

- Tiles have their own gestures, which block the root hold, so holding a tile reveals it
  instead of speaking: `useExclusiveGestures(tileHold, tileTap)` with
  `tileHold = useLongPressGesture({ minDuration: 350, block: rootHold, … })` and
  `tileTap = useTapGesture({ block: rootHold, … })` (gesture configs accept `block`,
  `requireToFail` and `simultaneousWith`). Pass `rootHold` down through a small context.
- Explicit controls (Type instead, commands, toggles) are buttons. The root hold does not start
  on them, because RNGH buttons and `Pressable` take the touch first. Verify this on a device.
- Speech start latency: start the recognizer in `onBegin` and keep it running only if the gesture
  activates; otherwise abort it (device-speech.md D7: `continuous: true`, `stop()` on release).
- Accessibility alternative: the HoldArea also has `accessibilityRole="button"` and
  `accessibilityActions=[{name:'activate'}]`, which toggles listening on and off (VoiceOver users
  cannot hold anywhere), and "Type instead" is always present.
- Haptics: `expo-haptics` (~58.0.8) gives a light impact when listening starts and a soft one when it stops.
- Rings: Reanimated 4 shared values driven by the recognizer's `volumechange` (50 ms).
  Nothing animates when `AccessibilityInfo.isReduceMotionEnabled()` is true.

### 7.2 Word tiles

`WordTile { word, durationMs, age: 'new'|'mid'|'old', state: 'tile'|'revealed'|'text'|'gap'|'future' }`.
The width is a pure function `tileWidth(durationMs, speechRate)` (the engine's speaking module gives the
duration estimates) with a minimum touch size of 44. Tap calls `speechOut.speakWord(word, { rate })` and logs a
`tap_rehear` event. Hold shows the text in place (ink tile, white text, as in the "puesto" tile) and a gloss
chip, and logs `hold_reveal`. The tile's accessibility label is "word {n}". It must **not** contain the word.

### 7.3 Text flow (Ink) and heat shading

Render a sentence as a `flexDirection:'row', flexWrap:'wrap'` row of word Views (not nested
`Text`). Nested Text cannot have rounded backgrounds or padding, which the heat chips, gap pill and tiles need.
Mixed text and tiles in one line is exactly what per-word fading requires.

- `HeatWord`: background `heatColors[score.heat]` (0 = none), radius 6, horizontal padding 2.
- `NewWordUnderline`: a dotted accent underline drawn with **react-native-svg** (15.16.0, SDK
  version), because `textDecorationStyle: 'dotted'` is iOS-only and a single-side dotted
  `borderBottom` renders badly on iOS.
- Keep punctuation attached to the preceding word View so line breaks never strand a comma.

### 7.4 Charts without a chart library

Every chart is a pure layout function (unit-tested) plus absolutely positioned Views or SVG. There
is no victory or skia dependency.

- `layoutLanding(candidates: {text, p}[], answer, width)` → x positions on the
  surprising→expected axis (x proportional to log p between the minimum and maximum shown, with collision
  nudging), labels and the answer pill. The "About {n} times in 100" note uses `Math.round(p*100)`.
- `layoutLane(words: {startMs,endMs}[], laneMs, width)` → tiles and holes (a pause is a gap of
  at least X ms, X from the engine's retell metrics). Lane widths are 60:45:30 of full width. The current lane is
  live, and a countdown shows the remaining time.
- `layoutEcho(lineTiles, learnerPitch?)`: the singer row has uniform height; the learner row gets
  heights from the learner's own pitch (YIN over the persisted utterance audio, a pure TS function
  tested with synthetic sines; device-speech.md covers getting the audio). A missed tile is
  hollow.

### 7.5 Music widgets

`RegisterToggle` is a two-segment control bound to `settings.register`, with a per-song override
in the lyric session. `SlangNoteList` is a FlatList of `{form, meaning, region, formality, explicit}`
from `findSlang` and pair glosses: the first line is the form · meaning, the second the region · formality, and there is an
Explicit badge. It hides explicit entries only when the explicit setting is off (default on). `RegionPills`
is a multi-select. `ExplicitPill` / `ExplicitRow` read the `explicit` setting.

---

## 8. Testing strategy

### 8.1 Layers

| Layer | Tool | What |
|---|---|---|
| Engine | vitest (unchanged) | Algorithms, packs, simulated learners, model contract |
| App pure logic | jest (`testEnvironment` from the preset; pure TS) | i18n, settings schema, layout functions (landing, lanes, echo, tile width), share parser, PriorSpec rebuild, model download state machine with a fake file system, command routing, the Store class |
| Storage | jest + NodeSqliteDriver | Migrations, repositories, learner replay, speaking log, cascades (section 4.5) |
| Components | jest-expo + RNTL 14 (`await render`) | Each design component from fixture props: the expected text from `t()`, heat colors by style, tile accessibility labels without the word, gestures through RNGH jest-utils (V5), `CommandChips` calling the controller |
| Screens and flows | `renderRouter('app', { initialUrl })` (async) with `registerServices(createTestServices())` | Onboarding guard (not onboarded → /onboarding; brand new → story starts with cognates), story step with the mock model (cliff → answer by a fake utterance → landing → next), "no sé" flow, repair flow, retell with a fake clock, Music: paste lyrics → lyric cliff → echo, settings persistence across a remount (same NodeSqliteDriver) |
| Web preview | `expo export --platform web` + Playwright | Screenshots of every design state at 390x844 next to the design previews, plus an e2e smoke test (hold with mouse down/up, scripted transcript) |
| Native config | `expo prebuild --no-install --clean` in a temporary copy, `expo-doctor`, `expo export --platform ios/android` | Plugins apply (fonts, permissions, share extension, llama.rn plugin, musickit module), JS bundles for Hermes |

Fakes, all implementing the service interfaces:

- `FakeSpeechIn`: a queue of scripted `Utterance`s `{transcript, segments[{text,startMs,endMs}], durationMs}`, delivered on
  `stop()`, with partial and volume events on a timer and a configurable permission state.
- `FakeSpeechOut`: records `speak()` calls and resolves after `text.length * 60 / rate` ms of fake
  time, firing `onWord` boundaries.
- `MockModel`: `createMockModel()` from the engine. `TopNBoundedModel(createMockModel())` exercises the
  upper-bound paths.
- `FakeModelRuntime`: status transitions on command (absent, downloading 0→1, ready, loaded,
  error).
- `FakeMusicService`: authorization states, a library of fixture songs, playback position driven by
  the fake clock, a `pauseAt` cliff event.
- `FakeShareInbox`: a push-able shared item (Spotify URL with text).
- `MemoryFiles`: an expo-file-system subset (`exists`, `size`, `digest`, a download task with progress).
- `FixedClock` / `ManualClock` and seeded `ids`.

Native packages imported only by `services/device.ts` (llama.rn, expo-speech-recognition,
the musickit module) never load in jest. Where a component must import a native module directly
(expo-haptics, expo-localization), use jest-expo's built-in mocks. llama.rn ships `jest/mock.js`
if it is ever needed.

### 8.2 Web build for screenshots

- `EXPO_PUBLIC_CLIFFWORD_ENV=preview npx expo export --platform web --output-dir dist-web`
  (`web.output: "single"`, as in the tree). On web the services are the preview services: the mock model (or the canned
  first story), scripted speech, fake music, and expo-sqlite `:memory:` through the same `ExpoSqliteDriver` (V9).
  Add `'wasm'` to `assetExts`.
- The preview environment exposes test hooks only when `EXPO_PUBLIC_CLIFFWORD_ENV==='preview'`:
  `window.__cliffword = { say(transcript, segments?), clock: { advance(ms) }, seed(name) }`.
  Playwright drives them with `page.evaluate`. Holding uses `page.mouse.down()`, a wait of 200 ms, then
  `page.mouse.up()` on the HoldArea; RNGH web uses pointer events.
- The fixture gallery `/(dev)/preview/[screen]` renders each design state from fixture data
  (`main`, `a2`, `a3`, `b1`, `b2`, `b3`, `b4`, `c1`, `c2`, `c3`), so screenshots are deterministic
  and independent of the model.
- `app/e2e/shots.mjs` (Node, `require('playwright')`; Chromium is installed globally, so run it with
  `NODE_PATH=$(npm root -g)`): serve `dist-web` with SPA fallback and the COOP
  `same-origin` / COEP `credentialless` headers, use a 390x844 viewport at DPR 2, wait for `document.fonts.ready`,
  screenshot every fixture route, and also screenshot `docs/design-previews/*.dc.html` with `support.js`
  stubbed (`page.route('**/support.js', …)`). Write `e2e/out/<name>.app.png`,
  `<name>.ref.png` and a side-by-side contact sheet `index.html`. Pixel diffs are not a gate,
  because the app adds a tab bar. Gate on: no page errors, fonts loaded, key element boxes inside the
  viewport (for example the HoldArea and CommandChips fully visible, no horizontal overflow, tab labels not
  clipped).
- Copy the previews into the repo at `docs/design-previews/` (the brief points to the artifact URL).
  Stub `support.js` in tests rather than committing it.

### 8.3 CI commands (all runnable in this container)

```bash
npm --prefix engine ci && npm --prefix engine run check            # tsc + vitest
npm --prefix app ci
cd app
npx tsc --noEmit                                                     # after the contract.ts exclude (V13)
NODE_OPTIONS=--disable-warning=ExperimentalWarning npx jest --ci
npx expo-doctor
npx expo export --platform ios     --output-dir /tmp/out-ios          # Hermes bundle
npx expo export --platform android --output-dir /tmp/out-android
EXPO_PUBLIC_CLIFFWORD_ENV=preview npx expo export --platform web --output-dir dist-web
NODE_PATH=$(npm root -g) node e2e/shots.mjs dist-web e2e/out
# config plugins: in a temp copy, never committed (ios/ and android/ are gitignored)
npx expo prebuild --no-install --platform all --clean
npx expo lint                                                        # once eslint-config-expo is set up
```

### 8.4 What can and cannot be verified here

Can be verified: everything in section 0. That covers TypeScript, engine and app tests, Hermes bundles for both platforms, the web
app with screenshots, config plugin application (prebuild output can be grepped: Info.plist usage
strings, AndroidManifest permissions, the share extension target, fonts copied), expo-doctor, the
llama.rn patch compiling with host compilers (device-speech.md D1), and the real model through
`engine/src/model/http.ts` plus `proof/model_server.py` (accuracy, not phone speed).

Cannot be verified here: building and running an iOS or Android binary (no Xcode or Android SDK; EAS needs the
user's approval); llama.rn speed, memory and Metal/CPU behaviour on a phone; whether the
JSI patch links in a real Xcode or Gradle build; speech recognition quality for Spanish, on-device
availability, segment timing; TTS voice availability; MusicKit authorization, subscription and
playback; the iOS share extension and the Android SEND intent; background download behaviour;
gestures on real touch hardware (only simulated here); permission dialogs; font rendering on devices;
store review.

---

## 9. Concrete decisions (summary)

1. Keep `file:../engine` with two installs. Add a scripts-only root package.json. Do not use workspaces
   (hoisting breaks `./node_modules/...` font paths and patch-package location, and risks a duplicate React).
2. Metro: the current config, plus `'wasm'` in assetExts, COOP/COEP dev headers, and blockList for engine
   `contract.ts`.
3. Exclude `../engine/src/model/contract.ts` from the app tsconfig (or move it to `engine/test/`).
   Bump the engine to TypeScript ~6.0.3.
4. Jest: jest-expo 58.0.14 + RNTL 14.1.0 (async API), RNGH jestSetup plus jest-utils, reanimated
   `setUpTests()`. Engine stays on vitest.
5. Routes: root Stack with `Stack.Protected` (onboarded / not), `(tabs)` (Story one route,
   Music Stack), `profile` modal, `retell` fullScreenModal, onboarding stack (start, language,
   slang, voice, model), `+native-intent.tsx` for share-in, and a guarded `(dev)/preview/[screen]`.
6. State: a service container of plain classes, `ServicesProvider`, `Store<T>` +
   `useSyncExternalStore`. No zustand. Session controllers own engine sessions. A priority queue
   serializes llama calls.
7. Storage: a `SqlDriver` interface. `ExpoSqliteDriver` (native and web) and `NodeSqliteDriver` (jest,
   `node:sqlite`, no dependency). Positional params only, no booleans. Migrations with `PRAGMA
   user_version`, one transaction per step. Learner state is an append-only event log plus snapshot
   checkpoints with a serializable `PriorSpec`.
8. i18n: keep the translator in the tree (pair.ui → native catalog → en → key). The source-scanning
   key test and the placeholder-parity test. A new pair adds an engine pair pack, and a catalog only for a new native language.
9. Theme: light only, and **add expo-system-ui ~58.0.7**. Embedded fonts.
10. Gestures: RNGH **~3.3.0** (SDK version, not 3.5.0) hook API. Charts are pure layout functions + Views and SVG
    (react-native-svg 15.16.0). expo-haptics for hold feedback.
11. Testing: the 6-layer pyramid above. The web preview is the full app with preview services. Playwright
    screenshots sit next to reference renders of the `.dc.html` previews.
12. Model file: verify with `File#digest('SHA-256')` against `b139949c…1897` (V17, V18). MD5 is not
    needed.
