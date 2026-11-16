# Storage

Everything the app keeps on the device, in SQLite: settings, the learner model (event log and
snapshots), sessions, stories, songs and lyrics, brought texts, minutes spoken, model files and
the share inbox.

```ts
import { openStorage, StorageProvider, useStorage } from '../storage';

// The app never calls openStorage() itself: the service container holds a StorageService
// (src/services/storageService.ts) and AppBootstrap opens it once at startup, then puts the
// storage in <StorageProvider>. Screens call useStorage() (or useAppState()).
const storage = await services.storage.open();
await storage.settings.set('onboarded', true);
const { learner } = await storage.learner.loadLearner({ prior });
await storage.learner.record(learner, events); // apply + log, in step
```

## Layout

| File | What |
|---|---|
| `sql/types.ts` | The `SqlDatabase` contract: `exec`, `run`, `all`, `get`, `transaction`, `close`. Repositories use only this. |
| `sql/serialized.ts` | `createSqlDatabase(driver)`: one queue for every call; transactions hold the queue. |
| `sql/expoSqlite.ts` | expo-sqlite driver (SDK 58 async API: `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`, `withTransactionAsync`). Type-only import of expo-sqlite. |
| `sql/sqljs.ts` | sql.js driver (in memory), for Jest and the web preview. |
| `open.ts` / `open.web.ts` | `openStorage()`: expo-sqlite file `cliffword.db` on iOS/Android; sql.js in memory on web. Metro picks the file by platform. |
| `storage.ts` | `createStorage(db, clock)` (all repositories) and `prepareDatabase(db)` (pragmas, then migrations). |
| `schema.ts` | `MIGRATIONS`, the versioned schema. |
| `migrate.ts` | `migrate(db, migrations)` with `PRAGMA user_version`. |
| `repos/*.ts` | One repository per area (below). |
| `StorageProvider.tsx` | `StorageProvider` and `useStorage()`. `AppBootstrap` (src/bootstrap) puts the opened storage here. |
| `testing/` | Test-only helpers: `openTestStorage()`, `openTestDatabase({ to })`, `createTestClock()`, a fake expo-sqlite connection over sql.js, and the shared driver contract suite. Never imported by app code. |

## Drivers

- **iOS and Android: expo-sqlite** (`~58.0.17`). `openStorage()` opens `cliffword.db` with
  `openDatabaseAsync`, sets `journal_mode = WAL` and `foreign_keys = ON` (per connection,
  outside any transaction), then migrates. If migration fails (for example a database from a
  newer app), the connection is closed and the error is thrown; the data is never deleted.
- **Jest: sql.js** (`sql.js/dist/sql-wasm-inline.js`, SQLite as WebAssembly embedded in one
  JS file). It loads in jest-expo's Node environment in about 25 ms, needs no native build and
  no file lookup, and runs the real SQL of every repository. better-sqlite3 was not used: it is
  a native Node addon (prebuilt download or node-gyp build) and Node-only, so it could not also
  serve the web preview. The expo-sqlite driver is tested over a fake connection backed by
  sql.js (`testing/fakeExpoSqlite.ts`), which follows expo-sqlite 58's `withTransactionAsync`
  step for step. Both drivers pass the same contract suite (`testing/sqlContract.ts`).
- **Web preview: sql.js in memory**, nothing persists across reloads. expo-sqlite's web build
  was not viable for the static preview: it needs `wasm` added to Metro's `assetExts`
  (metro.config.js) and `Cross-Origin-Embedder-Policy` / `Cross-Origin-Opener-Policy` headers,
  which `python -m http.server` and other static hosts do not send. The inline sql.js build
  needs neither: its `node:fs` / `node:crypto` requires are replaced by empty modules in
  Expo's web resolver. Checked: Expo's Metro bundles `openStorage` for web (sql.js included,
  no expo-sqlite) and for iOS and Android (expo-sqlite included, no sql.js); the web bundle ran
  in headless Chromium without cross-origin isolation and stored and read settings, a story,
  and spoken time. sql.js adds about 1 MB to the web bundle only. To get a persistent web
  database later, add the Metro and header changes and switch `open.web.ts` to expo-sqlite.

## Transactions and ordering

`createSqlDatabase` queues every call, so calls run one at a time in call order, and a
transaction holds the queue until it commits or rolls back. Work started elsewhere during a
transaction waits instead of joining it (with a bare expo-sqlite connection it would join, and
be rolled back with it, and a second `withTransactionAsync` would fail). This works on every
platform, unlike `withExclusiveTransactionAsync` (not on web).

- Inside `db.transaction(async (tx) => ...)`, use only `tx`. Calling `db` from inside the task
  waits for the transaction to end, which never happens.
- `tx.transaction(...)` joins the outer transaction (no savepoint).
- A `tx` used after its transaction ended throws.
- Call order is write order: change memory and start the write in the same synchronous step
  (no `await` in between) and every later call sees it. The learner repository relies on this.

## Schema and migrations

`PRAGMA user_version` holds the schema version. `MIGRATIONS` is an array of `{ version, name,
steps }` (static SQL). `migrate` runs each pending migration in its own transaction together
with the version bump, re-checking the version inside the transaction, so it is idempotent
(also when two run at once); a failed step leaves the database at the previous version. A
stored version above the newest migration throws `SchemaTooNewError`. Never edit a shipped
migration; add the next version. Enumerations that may grow (session kinds, song sources,
model file statuses) have no CHECK constraints; repositories validate them.

| v | Tables |
|---|---|
| 1 | `settings` (key, JSON value, updated_at); `learner_events` (append-only: id, at, type, key, JSON payload; indexes on key and at); `learner_snapshots` (id, at, version, json, through_event_id); `sessions` (id, kind, updated_at, version, JSON snapshot, active; one active per kind); `stories` (id, title, created_at); `story_sentences` (story_id, idx, text, json) |
| 2 | `songs` (id, source, external_id, title, artist, artwork_url, added_at; unique source + external_id); `lyrics` (song_id, raw_text, parsed JSON, updated_at; on device only); `spoken_time` (local day YYYY-MM-DD, ms); `model_files` (id, path, bytes, sha256, status, updated_at); `share_inbox` (id, received_at, url, text, handled) |
| 3 | `learner_snapshots.prior` (JSON PriorSpec of the engine; NULL on older rows) |
| 4 | `texts` (id, title, raw_text, created_at, last_opened_at: brought texts, on device only); `songs.genre`, `songs.last_opened_at` |

Times are ms since the epoch. Booleans are 0/1. JSON columns that fail to parse read as a
fallback (null, or the setting's default), never as a crash.

## Repositories

| Repository | Calls |
|---|---|
| `settings` | `get(key)`, `getAll()`, `set(key, value)`, `update(patch)`, `reset(key?)`. Defaults: register `neutral`, regions `['PR','CARIB']`, showExplicit `true`, textMode `auto` (`text`/`tiles` force), nativeLanguage `en`, targetLanguage `es`, onboarded `false`, startLevel `brandNew` (`placement` after "I know some"; picks the learner prior), speechRateBias `0` (clamped to ±0.5), nativeAnswersAllowed `true`. Invalid writes throw `InvalidSettingError`; invalid stored values read as the default. |
| `learner` | `appendEvents(events)`, `record(learner, events)`, `eventsSince(afterId?, limit?)`, `eventsForKey(key)`, `countEvents()`, `saveSnapshot(learner, at, { keep, prior })` (keeps 3 by default; `prior` is the engine's PriorSpec, kept from the newest row when omitted), `latestPrior()`, `latestSnapshot()`, `loadLearner({ prior, params?, evidence? })`. |
| `sessions` | `save({ id?, kind, version, snapshot, active? })` (active by default; deactivates the others of its kind), `get(id)`, `active(kind)`, `list({ kind?, limit? })`, `deactivate(id)`, `remove(id)`. |
| `stories` | `create`, `get`, `list` (newest first), `rename`, `remove` (with sentences), `appendSentence(storyId, text, data)`, `putSentence(storyId, idx, text, data)`, `sentences(storyId)`, `truncate(storyId, fromIdx)`. |
| `songs` | `upsert({ source, externalId?, title, artist?, artworkUrl?, genre? })` (one row per source + external id; manual songs have none; a known genre is kept when a later upsert has none), `get`, `findByExternal`, `list` (newest first), `recent()` (most recently opened or added first), `rename(id, { title?, artist? })`, `markOpened(id, at?)`, `remove` (with lyrics). A song's lyric session is the `sessions` row `lyric:<songId>`. |
| `lyrics` | `put(songId, rawText, parsed)`, `get(songId)`, `remove(songId)`. Never synced or exported. |
| `spokenTime` | `addUtterance(ms, at)` (to the local day of `at`), `today(now)`, `day(key)`, `total()`, `range(from, to)`, `streak(now, minMs?)` (consecutive days ending today, or yesterday while today is still empty). |
| `modelFiles` | `upsert`, `get`, `list`, `setStatus(id, status, { bytes?, sha256?, at? })`, `remove`. Statuses: missing, downloading, verifying, ready, failed. `ExpoModelManager` writes the row of each model it downloads. A `ready` row with the descriptor's size and SHA-256, whose `updated_at` is not before the file's mtime, lets startup skip hashing the file again. |
| `shareInbox` | `add({ url?, text? })` (an identical unhandled item is stored once), `get`, `pending()`, `markHandled(id)`, `purgeHandled(before)`. |
| `texts` | `add({ title, rawText })` (blank text refused), `get`, `list()` (most recently opened or added first), `markOpened(id, at?)`, `remove`. Never synced or exported. Its lyric session is the `sessions` row `text:<textId>`. |

Every method that records a time takes an explicit one or uses the injected `StorageClock`
(`createStorage(db, clock)`), and ids come from the same clock, so tests are deterministic.

## The learner model on disk

Events are logged append-only; each snapshot stores `through_event_id`, the last event it
includes. `loadLearner` restores the newest snapshot that `LearnerModel.restore` accepts
(skipping damaged or unknown-version ones), then replays the events logged after it, in log
order. With no usable snapshot it builds a new model (`params`, `evidence`) and replays the
whole log. Pass the same `prior` the model was built with. The prior function itself is not
stored; a snapshot row can carry the engine's `PriorSpec` that rebuilds it (v3). The story
controller saves one when its session replaces the prior (brand new, placement done), later
checkpoints keep it, and startup reads it with `latestPrior()` (`src/learner/prior.ts`: the
stored spec is used while it fits `settings.startLevel`).

To keep memory and disk in step, use `record(learner, events)` (applies the events in
`applyAll` order and queues their insert in the same synchronous step) and
`saveSnapshot(learner, at)` (takes the snapshot and queues its insert in the same step).
Because the database runs calls in order, a snapshot's `through_event_id` always matches the
events applied to the model it came from, even when calls are not awaited in between. Tests
check that a restored model gives exactly the same `pKnown` for every key and skill as the
live one.

## Dependencies added

`expo-sqlite` and `expo-asset` (expo-sqlite imports it; it was only nested under `expo/`, so
neither Metro nor Jest could resolve it from the app), `sql.js` (web runtime and Jest), and
`@types/sql.js` (dev). `npx expo install` also added `"expo-sqlite"` and `"expo-asset"` to the
app.json plugins; both were removed again because without options those plugins change nothing.
