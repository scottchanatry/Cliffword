# Music, sharing and store setup: research notes for the build outline

Researcher notes, 2026-11-15. Sources: package tarballs unpacked read-only under
`/tmp/claude-0/pkgs/<name>/package` (`applemusic` = @lomray/react-native-apple-music 1.4.0,
`wwdrew-applemusic` = @wwdrew/expo-apple-music 1.1.3, `beatsphere-applemusic`,
`shareintent` = expo-share-intent 9.0.0, `template-bare` = expo-template-bare-minimum 58.0.34,
`privacy/*` = react-native 0.88.1 and Expo 58 modules, `llamarn` = llama.rn 0.13.0-rc.11),
Apple developer documentation (JSON endpoints under developer.apple.com/tutorials/data/documentation),
App Review Guidelines, App Store Connect age rating reference, Expo docs (app config, EAS iOS
capabilities), the Hugging Face API. "Verified" means I read it in source or official docs today;
"unverified" means it needs a device, an account or a build.

---

## 0. Decisions in one screen

| # | Decision | Why |
|---|---|---|
| D1 | **Write a local Expo module `modules/musickit` (Swift, Expo Modules API, iOS only)**. Do not depend on @lomray/react-native-apple-music. | lomray 1.4.0 is a legacy bridge module (`NativeModules` + `RCTEventEmitter`, runs on RN 0.88 only through the interop layer). Its published package.json has `"postinstall": "patch-package"`, and **installing it without patch-package fails with exit 127** (tested here). Position events come once per second, with no native pause-at-time. It has no library search, and its songs carry no ISRC or explicit flag. The surface we need is about 300 lines of Swift, and lomray's Apache-2.0 code is a good reference. |
| D2 | **Use ApplicationMusicPlayer** (not SystemMusicPlayer). | It plays inside the app without touching the Music app's queue. The app owns pause, seek and resume, which a lyric cliff needs. |
| D3 | **Pause at a lyric cliff natively**: `pauseAt(seconds, leadMs)` arms a 20 Hz main-thread timer in Swift that calls `pause()` and emits `onCliff`. | The JS thread may be busy, for example with llama.rn calls or rendering. MusicKit has no time-boundary observer, so `playbackTime` must be polled. |
| D4 | **Android v1 and web have no Apple Music playback.** The Music tab works with songs added by share-in or typed in, pasted lyrics, text cliffs and sing-back, plus an "Open in Spotify/Apple Music" link. The same "manual mode" serves iOS users who refuse authorization or have no subscription. | MusicKit for Android needs a developer JWT, which Cliffword cannot keep fresh without a backend. Apple's AARs cannot be redistributed and would have to be fed privately into EAS builds. It is a v2 option. |
| D5 | **Spotify: share-in only, with expo-share-intent 9.0.0.** Parse the link and title locally and make no Spotify network calls, including no `spotify.link` resolving or oEmbed. Apple Music links (music.apple.com) are accepted the same way and map straight to a MusicKit catalog song id. | expo-share-intent 9.0.0 declares the peer `expo ^58`. It brings a config plugin, an iOS share extension and an Android `SEND text/*` filter, and reports `{ text, webUrl, meta.title }`. |
| D6 | **Lyrics are pasted by the user and stored only in on-device SQLite.** They are never uploaded, never shared out of the app and never bundled. Store screenshots use the fictional song in the previews ("Luna de Santurce", Rayo K.) or public-domain lyrics. | Copyright: the user's private copy for study. A licensed timed-lyrics provider comes later, keyed by ISRC, which the MusicKit module exposes now. |
| D7 | **Line timing**: (a) untimed lines, where the learner advances; (b) "time it while you listen", where the learner taps at each line start and the times are stored locally; (c) LRC timestamps in pasted text are honoured. Pause targets come from (b) or (c). | MusicKit gives no lyrics or timing to third parties. `Song.hasLyrics` only says whether Apple has them. |
| D8 | **One bundle id for every EAS profile** (suggested `app.cliffword`, which assumes cliffword.app gets registered; otherwise `com.cliffword.app`). The share extension is `app.cliffword.share-extension`, the app group `group.app.cliffword`, and the Android package `app.cliffword`. | MusicKit App Service, the App Group, the extension App ID and the memory entitlements are set up once in the Apple portal. Separate dev ids would triple that work. Bundle ids and package names are permanent once used, so this is the user's call. |
| D9 | **iOS deployment target 17.0** via expo-build-properties. The Expo 58 template default is 16.4. | iOS 16 still runs on 2 GB A11 iPhones (8/X), which cannot hold the 1.1 GB model. iOS 17 starts at A12 (XS/XR). MusicKit library APIs need iOS 16, so they are covered either way. The alternative is `UIRequiredDeviceCapabilities: iphone-ipad-minimum-performance-a12`. |
| D10 | **Store metadata lives in the repo** under `store/` (fastlane-style text files), plus `docs/STORE.md` (the checklist and questionnaire answers). A jest test checks character limits and banned terms. | It is reviewable, testable and portable to `eas metadata` or fastlane later. |
| D11 | **Privacy: "Data Not Collected" on both stores.** This holds only if speech recognition runs on device (`requiresOnDeviceRecognition: true`) and nothing (analytics, crash reporting) is added. | The brief says nothing leaves the device. The model download only fetches a file. |

---

## 1. Apple Music on iOS (MusicKit)

### 1.1 What the platform gives (verified in Apple docs)

- `MusicAuthorization.request()` / `.currentStatus` (iOS 15): `notDetermined | denied | restricted | authorized`.
  The prompt text is `NSAppleMusicUsageDescription` (required; "applies to apps that link against … SDK or later").
- `MusicSubscription.current` (iOS 15): `canPlayCatalogContent`, `canBecomeSubscriber`,
  `hasCloudLibraryEnabled`; errors `permissionDenied | privacyAcknowledgementRequired | unknown`;
  `MusicSubscription.subscriptionUpdates` async sequence for live changes.
- `ApplicationMusicPlayer.shared` (iOS 15) "plays music in a way that doesn't affect the Music app's
  state"; continues in background only if the app has the `audio` background mode (we will not add it).
- `MusicPlayer`: `playbackTime` (seconds of the current entry, **settable to seek**, returns NaN when
  invalid), `state` (`playbackStatus`, `playbackRate: Float { get set }`, repeat/shuffle),
  `queue`, `isPreparedToPlay`, `prepareToPlay()`, `play() async throws`, `pause()`, `stop()`,
  `restartCurrentEntry()`, skip next/previous, begin/end seeking. **No time observer**: poll.
- `MusicLibraryRequest<Song>` (iOS 16): `limit`, `offset`, `filter(text:)`, `filter(matching:equalTo:)`,
  `sort(by:ascending:)`, `includeOnlyDownloadedContent`. `MusicLibrarySearchRequest(term:types:)` (iOS 16).
- `MusicCatalogSearchRequest(term:types:)`, `MusicCatalogResourceRequest<Song>(matching: \.id, equalTo:)`.
- `Song` has `title`, `artistName`, `albumTitle`, `duration`, `contentRating` (explicit), `isrc`,
  `hasLyrics` (catalog has lyrics; **no lyric text API for third parties**), `playParameters`, `artwork`.
- Developer token: generated automatically once the **MusicKit App Service** is enabled on the App ID
  (developer portal → Identifiers → App ID → App Services tab → MusicKit). No entitlement key in the
  .entitlements file. Requires a paid Apple Developer Program membership.

### 1.2 @lomray/react-native-apple-music 1.4.0 (read in full)

API: `Auth.authorize()` (uses legacy `SKCloudServiceController.requestAuthorization`),
`Auth.checkSubscription()` (MusicSubscription.current), `Player.play/pause/togglePlayerState/
skipToNextEntry/skipToPreviousEntry/restartCurrentEntry/seekToTime/getCurrentState/configurePlayer`,
events `onPlaybackStateChange | onCurrentSongChange | onPlaybackTimeUpdate | onPlaybackError`,
`MusicKit.catalogSearch(term, ['songs'|'albums'], {limit, offset})`, `setPlaybackQueue(id, type)`,
`getTracksFromLibrary()` (recently played), `getUserPlaylists`, `getLibrarySongs({limit, offset})`,
`getPlaylistSongs`, `playLibrarySong(id)`, `playLibraryPlaylist`. Hooks `useCurrentSong`,
`useIsPlaying`, `usePlaybackState`. Uses `ApplicationMusicPlayer.shared` (good).

Problems for Cliffword:
1. **Install breaks**: published `package.json` keeps `"postinstall": "patch-package"` while
   patch-package is only a devDependency. `npm install @lomray/react-native-apple-music@1.4.0` in a clean
   project fails: `sh: 1: patch-package: not found`, npm error code 127 (reproduced in this container).
   It would only pass if the app happens to have patch-package installed at the root (unverified).
2. Legacy architecture: `NativeModules.MusicModule` + `RCTEventEmitter` + `RCT_EXTERN_MODULE`; RN 0.88 is
   New Architecture only, so it relies on the TurboModule interop layer (works in principle; unverified
   on 0.88). `new NativeEventEmitter(MusicModule)` runs at import time and throws on iOS when the module is
   missing (Expo Go, tests), so it needs a platform-split import anyway.
3. Time updates every **1.0 s** (`timeUpdateInterval`), `getCurrentState()` spawns a Task and a cached
   catalog lookup per call: too coarse/heavy for pausing at a line end; no native pause-at.
4. No library text search (only paginated list); no `isrc`, `contentRating`, `albumTitle`, `hasLyrics` in
   the song map; `duration` is returned as a **string** although typed `number`; artwork URLs that are not
   http(s) (library items often use a `musicKit://` scheme) become `""`.
5. No Expo config plugin (`NSAppleMusicUsageDescription` must be set by hand). iOS only.
6. Fire-and-forget `play()` (errors arrive later as an event, not as a rejected promise).

Also looked at: **@wwdrew/expo-apple-music 1.1.3** (Expo module, config plugin, iOS/Android/web, built and
tested on SDK 56, single maintainer, last publish 2026-06-08). Very large surface (ratings, favourites,
recommendations, REST clients), library calls take a Music User Token, Android requires Apple's AARs
placed in the repo at prebuild (`androidMusicKitAarDir`, build fails otherwise), still a 1 s time
observer, no pause-at. Its plugin is a useful reference (sets `NSAppleMusicUsageDescription`, forces
iOS 16.4). **@beatsphere/expo-apple-music-kit 0.1.0**: early, ships an AAR, now-playing focus. Neither
fits better than a small local module.

### 1.3 Recommendation: local module `modules/musickit`

Expo Modules API (Swift), autolinked from `modules/` (expo-modules-autolinking default). Files:

```
modules/musickit/
  expo-module.config.json      { "platforms": ["apple"], "apple": { "modules": ["CliffwordMusicKitModule"] } }
  ios/CliffwordMusicKit.podspec  platform :ios 16.4 (or 17.0), swift_version '5.9', dependency 'ExpoModulesCore', frameworks 'MusicKit'
  ios/CliffwordMusicKitModule.swift
  index.ts                     requireOptionalNativeModule('CliffwordMusicKit') + typed wrapper
  NOTICE                       only if code is adapted from lomray (Apache-2.0)
```

Swift sketch (shape, not final code; compile first happens on EAS, so keep it small and Swift 5 mode to
avoid Swift 6 strict-concurrency errors with MusicKit types):

```swift
import ExpoModulesCore
import MusicKit

public final class CliffwordMusicKitModule: Module {
  private var cliffTimer: Timer?        // 20 Hz, main run loop
  private var progressTimer: Timer?     // 4 Hz while playing and observed
  public func definition() -> ModuleDefinition {
    Name("CliffwordMusicKit")
    Events("onState", "onCliff", "onError")
    AsyncFunction("authStatus") { () -> String in Self.js(MusicAuthorization.currentStatus) }
    AsyncFunction("authorize") { () async -> String in Self.js(await MusicAuthorization.request()) }
    AsyncFunction("subscription") { () async throws -> [String: Any] in /* MusicSubscription.current, map errors to codes */ }
    AsyncFunction("searchLibrary") { (term: String, limit: Int) async throws -> [[String: Any]] in /* MusicLibraryRequest<Song> + filter(text:) */ }
    AsyncFunction("listLibrarySongs") { (limit: Int, offset: Int) async throws -> [[String: Any]] in /* sort by libraryAddedDate desc */ }
    AsyncFunction("searchCatalog") { (term: String, limit: Int) async throws -> [[String: Any]] in /* MusicCatalogSearchRequest(types: [Song.self]) */ }
    AsyncFunction("getSong") { (id: String, source: String) async throws -> [String: Any]? in ... }
    AsyncFunction("play") { (id: String, source: String, startAt: Double) async throws in
      // fetch Song (library: MusicLibraryRequest filter id; catalog: MusicCatalogResourceRequest)
      // player.queue = [song]; try await player.prepareToPlay(); if startAt > 0 { player.playbackTime = startAt }; try await player.play()
    }
    AsyncFunction("pause") { ApplicationMusicPlayer.shared.pause() }.runOnQueue(.main)
    AsyncFunction("resume") { () async throws in try await ApplicationMusicPlayer.shared.play() }
    AsyncFunction("seek") { (t: Double) in ApplicationMusicPlayer.shared.playbackTime = t }.runOnQueue(.main)
    Function("position") { () -> Double in let t = ApplicationMusicPlayer.shared.playbackTime; return t.isNaN ? 0 : t }
    AsyncFunction("nowPlaying") { () async -> [String: Any]? in ... }
    AsyncFunction("pauseAt") { (t: Double, leadMs: Double) in self.armCliff(target: t, lead: leadMs / 1000) }.runOnQueue(.main)
    Function("clearPauseAt") { self.disarmCliff() }
    AsyncFunction("setRate") { (r: Double) in ApplicationMusicPlayer.shared.state.playbackRate = Float(r) }.runOnQueue(.main)
    OnStartObserving { /* observe state.objectWillChange + queue.objectWillChange, start progress timer */ }
    OnStopObserving { /* cancel */ }
  }
}
```

Song map returned to JS: `{ id, source: 'library'|'catalog', title, artistName, albumTitle|null,
durationSec|null, isExplicit (contentRating == .explicit), isrc|null, hasCatalogLyrics, artworkUrl|null
(only http/https; else null and the UI shows a placeholder) }`.

`armCliff`: every 50 ms compare `playbackTime >= target - lead`; then `pause()`, send
`onCliff { targetSec, actualSec }`, disarm. Default lead 120 ms (tune on device). Disarm on seek, skip,
queue change, stop.

### 1.4 The JS interface the app codes against (mockable, web-safe)

`app/src/music/types.ts`:

```ts
export type MusicAuthStatus = 'notDetermined' | 'denied' | 'restricted' | 'authorized' | 'unavailable';
// 'unavailable' = Android, web, Expo Go, module missing.

export interface MusicSubscriptionStatus {
  canPlayCatalogContent: boolean;
  canBecomeSubscriber: boolean;
  hasCloudLibraryEnabled: boolean;
  /** MusicSubscription.Error code if the check failed. */
  error?: 'permissionDenied' | 'privacyAcknowledgementRequired' | 'unknown';
}

export type MusicSource = 'library' | 'catalog';
export interface MusicSongRef { id: string; source: MusicSource }
export interface MusicSong extends MusicSongRef {
  title: string;
  artistName: string;
  albumTitle: string | null;
  durationSec: number | null;
  isExplicit: boolean;
  isrc: string | null;          // key for licensed timed lyrics later
  hasCatalogLyrics: boolean;    // Apple has lyrics; we still cannot read them
  artworkUrl: string | null;
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'interrupted' | 'seeking';
export interface NowPlaying { song: MusicSong | null; status: PlaybackStatus; positionSec: number; rate: number }

export interface Page<T> { items: T[]; nextOffset: number | null }
export interface Unsubscribe { remove(): void }

export interface MusicService {
  readonly available: boolean;
  authStatus(): Promise<MusicAuthStatus>;
  authorize(): Promise<MusicAuthStatus>;
  subscription(): Promise<MusicSubscriptionStatus>;
  searchLibrary(term: string, opts?: { limit?: number }): Promise<MusicSong[]>;
  listLibrarySongs(opts?: { limit?: number; offset?: number }): Promise<Page<MusicSong>>;
  searchCatalog(term: string, opts?: { limit?: number }): Promise<MusicSong[]>;
  getSong(ref: MusicSongRef): Promise<MusicSong | null>;
  play(ref: MusicSongRef, opts?: { startAtSec?: number }): Promise<void>; // rejects on failure
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(sec: number): Promise<void>;
  position(): number;                       // synchronous JSI read, seconds
  nowPlaying(): Promise<NowPlaying | null>;
  pauseAt(sec: number, opts?: { leadMs?: number }): Promise<void>;
  clearPauseAt(): void;
  setRate?(rate: number): Promise<void>;    // optional; unverified for catalog streams
  onState(cb: (s: NowPlaying) => void): Unsubscribe;               // on change + 4 Hz while playing
  onCliff(cb: (e: { targetSec: number; actualSec: number }) => void): Unsubscribe;
  onError(cb: (e: { code: string; message: string }) => void): Unsubscribe;
}
```

Implementations:
- `app/src/music/native.ios.ts`: wraps `modules/musickit` (returns null when the module is absent).
- `app/src/music/native.ts` (Android/web): `null`.
- `app/src/music/unavailable.ts`: `available: false`, `authStatus() → 'unavailable'`, everything else rejects with `MusicUnavailableError`.
- `app/src/music/fake.ts`: `createFakeMusicService({ songs, auth, subscription, clock })` with
  `advance(ms)`; honours `pauseAt` crossings, `seek`, `play` errors (explicit restricted, no
  subscription). Used by jest (LyricSession and screen tests) and by the web preview with a
  `requestAnimationFrame` clock and the fictional song.
- `app/src/music/index.ts`: `getMusicService()` picks native, else unavailable; the provider/context
  lets tests inject the fake.

Pure helpers worth their own tests (`app/src/music/cliffClock.ts`): the next pause target from line
timings and the cliff line, lead compensation, "otra vez" = seek(line start − 0.3 s) then resume,
resuming only on a user action.

### 1.5 States the Music tab must handle

| State | UI |
|---|---|
| `unavailable` | Manual mode: share-in/typed songs, paste lyrics, text cliffs, "Open in …" button |
| `notDetermined` | "Connect Apple Music" (calls `authorize`) |
| `denied` / `restricted` | Explain; button to `Linking.openSettings()`; manual mode stays available |
| authorized, `canPlayCatalogContent` | Library + catalog search, playback, timed cliffs |
| authorized, not subscribed | Library songs (purchased or synced files may still play; unverified), catalog results show "Needs Apple Music"; optional subscribe offer later (`canBecomeSubscriber`) |
| `privacyAcknowledgementRequired` | "Open the Music app once to accept Apple's privacy notice" |
| play error on an explicit song | Screen Time may restrict explicit music; show "This song is restricted on this device" |

Bridging: when a Spotify-shared song arrives on an iOS device with Apple Music, offer
`searchCatalog("<title> <artist>")` → "Found in Apple Music, play here?" (local search, no Spotify call).

### 1.6 Requirements and rules

- Apple Developer Program account (user's), MusicKit App Service enabled on the App ID (manual; **EAS
  capability sync does not list MusicKit**). Re-check it is still enabled after the first EAS build
  (EAS disables remote capabilities it manages that are missing from entitlements; MusicKit is not one
  of them, but verify).
- `NSAppleMusicUsageDescription` (Info.plist via `ios.infoPlist`).
- Testing playback needs a **physical device** with an Apple ID that has Apple Music; the Simulator
  does not play Apple Music (well known; unverified here). Development builds on device need device
  registration (`eas device:create`) and an ad hoc profile.
- App Review 4.5.2(i): the user must start Apple Music playback and have standard controls (play,
  pause, skip); the app may not charge for or indirectly monetize Apple Music access; do not
  download/upload/share music files. So: a visible play/pause control and line back/forward on the song
  screen; resume after a cliff only on a user action (tap or spoken "siguiente"/"otra vez"), which the
  design already does ("the music waits for you"). If a paid tier ever gates the Music tab, check 4.5.2
  first. 4.5.2(iii): disclose library access in the purpose string; never share library data.
- Audio session: speech recognition and recording need `.playAndRecord`; ApplicationMusicPlayer plays
  through the app's session. The sing-back flow already pauses music before listening; restore the
  `.playback` category before `resume()`. Test on device (risk).
- Singer pitch: not readable from Apple Music audio (DRM); tile heights show the learner's pitch only.

---

## 2. Android scope for v1

**Decision: no Apple Music on Android in v1.** The Music tab on Android has these parts:
- add a song by sharing a link from Spotify, Apple Music or YouTube Music (or any text), or by typing title and artist;
- paste lyrics (or share selected text from a browser);
- lyric cliffs, sing-back and slang notes on text, with the learner advancing line by line;
- "Open in Spotify" / "Open in Apple Music", which opens the shared https URL with `Linking.openURL`. Https URLs need no `<queries>` entry.

Why not now (MusicKit for Android): the SDK is two proprietary AARs (auth and playback). They sit
behind an Apple Developer login and cannot be redistributed, so EAS builds would need them supplied
privately. The SDK also needs a **developer token (a JWT signed with a MusicKit .p8 key, at most
6 months valid)** shipped in the app or served by a backend, and Cliffword has no backend. The app
would also have to manage the Music User Token itself. A v2 path exists: the @wwdrew plugin shows the
AAR wiring, and a small Kotlin module would do. Controlling other players through Android media
sessions would need notification-listener access, which is a heavy permission under Play policy, so
it is not planned.

Web preview: same as Android, plus the fake player for a demo with the fictional song.

---

## 3. Spotify share-in (and Apple Music links) with expo-share-intent 9.0.0

### 3.1 Package facts (verified in source)

- Peer deps: `expo ^58`, `expo-linking >=58.0.13`, `expo-constants >=58.0.12`. The README table maps
  SDK 58 to 9.0+. The old `xcode` patch-package step is not needed from v6 onward.
- Config plugin (`"plugins": [["expo-share-intent", {...}]]`):
  - iOS: adds a share extension target `ShareExtension` with bundle id `<bundleId>.share-extension`,
    app group `group.<bundleId>` on both targets (`com.apple.security.application-groups`), and
    `AppGroupIdentifier` in Info.plist. It writes the extension's own `PrivacyInfo.xcprivacy`
    (UserDefaults CA92.1) and **pushes `extra.eas.build.experimental.ios.appExtensions`** so EAS
    credentials know the extension. It **throws if `scheme` is missing**. Default activation rule:
    one WebURL plus one WebPage. The extension stores the payload in app-group UserDefaults and opens
    `<scheme>://dataUrl=<scheme>ShareKey?nonce=…#weburl|text`.
  - Android: adds `SEND` with `text/*` to MainActivity (default), `launchMode singleTask`.
- JS: `ShareIntentProvider` / `useShareIntentContext()` → `{ hasShareIntent, shareIntent, resetShareIntent, error }`,
  where `shareIntent = { type: 'text'|'weburl'|'media'|'file'|null, text, webUrl, meta: { title? }, files }`.
  `webUrl` comes from a regex over `text`. The native module is loaded with `requireOptionalNativeModule`,
  and the hook is disabled on web by default, so it is web-safe.
- What arrives:
  - Android: `text` is `EXTRA_TEXT` and `meta.title` is `EXTRA_TITLE`. **`EXTRA_SUBJECT` is not read.**
  - iOS: a URL attachment gives `weburls[0].url` (no title). A text attachment gives `text`. Safari
    pages give the URL plus page `<meta>` through the JS preprocessor.
  - iOS caveat: when several attachments arrive (for example text plus URL), only the handler of the
    **last** attachment writes the payload, so one part is lost. Log a real Spotify share on a device.
    If Spotify sends title text next to the URL, add a small patch (patch-package is already planned
    for llama.rn).
- Spotify links seen in the wild: `https://open.spotify.com/track/<22 chars>?si=…`,
  `https://open.spotify.com/intl-es/track/<id>`, `spotify:track:<id>`, and **`https://spotify.link/<code>`**
  short links, which recent iOS builds use for some share targets. A short link cannot be turned into
  a track id without a network request, so store the URL as the key and ask the user for title and artist.

### 3.2 Config

```ts
['expo-share-intent', {
  iosActivationRules: {
    NSExtensionActivationSupportsWebURLWithMaxCount: 1,
    NSExtensionActivationSupportsWebPageWithMaxCount: 1,
    NSExtensionActivationSupportsText: true,      // selected lyrics text from Safari/Notes
  },
  iosShareExtensionName: 'Cliffword',             // label in the share sheet
  androidIntentFilters: ['text/*'],
}]
```

Expo Router: the share deep link `cliffword://dataUrl=cliffwordShareKey…` would otherwise hit "Unmatched
route". Add `app/+native-intent.tsx`:

```ts
import { getShareExtensionKey } from 'expo-share-intent';
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try { return path.includes(`dataUrl=${getShareExtensionKey()}`) ? '/share' : path; }
  catch { return '/'; }
}
```

Put `<ShareIntentProvider>` at the top of `app/_layout.tsx`. `app/share.tsx` reads the intent, parses it,
shows a confirm card (title and artist editable, prefilled), then the lyrics paste step, and calls
`resetShareIntent()` when done.

EAS: the first iOS build must run **interactively with the user's Apple login**, because registering
App Groups needs Apple cookie auth; the App Store Connect API key alone cannot do it (EAS docs). Keep
one extension target only.

### 3.3 Parser (pure, fully unit-testable): `app/src/share/parseShared.ts`

```ts
export type SharedSong =
  | { kind: 'song'; service: 'spotify' | 'apple-music' | 'youtube-music' | 'unknown';
      trackId: string | null; storefront?: string; url: string /* canonical, tracking params removed */;
      title: string | null; artist: string | null; needsConfirm: true }
  | { kind: 'lyrics'; text: string }              // multi-line text without a music link
  | { kind: 'unsupported'; reason: 'album' | 'playlist' | 'artist' | 'podcast' | 'empty' | 'unknown-link' };

export function parseShared(input: { text?: string | null; webUrl?: string | null; meta?: { title?: string } | null }): SharedSong;
```

Rules:
- Spotify track: `/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})/`.
  Canonical form `https://open.spotify.com/track/<id>`, with `si`, `context` and `utm_*` dropped.
  `spotify:track:<id>` gives the same id.
- `spotify.link/<code>`: kind song, trackId null, url kept as is (it still opens in Spotify).
- Album, playlist, artist, show and episode links: `unsupported` with "Share a single song".
- Apple Music: `music.apple.com/<cc>/album/<slug>/<albumId>?i=<songId>` gives catalog song `songId`;
  `music.apple.com/<cc>/song/<slug>/<songId>` gives `songId`; `storefront = cc`. On iOS with Apple
  Music this goes straight to `play({id, source:'catalog'})`.
- YouTube Music `music.youtube.com/watch?v=<id>`: song, service youtube-music, no playback.
- Title and artist from `meta.title` or the text with the URL removed. Strip "on Spotify", "en Spotify",
  "Listen to", "Escucha". Split on ` · `, ` – `, ` - `, ` by `, ` de ` (Spanish UI). This is a
  heuristic, so the UI always confirms.
- Text with three or more lines and no music URL: `lyrics`, which prefills the paste screen.
- No network calls of any kind: no Spotify Web API, no oEmbed, no short-link resolving.

Tests: one fixture per row above, plus `si` stripping, uppercase or `www.` hosts, a URL inside a
sentence, empty input, and a Spanish share text.

---

## 4. Lyrics: paste, storage, copyright

### 4.1 Paste UX

1. A song card exists, from the library or catalog picker, share-in, or "Add a song" (title, artist).
2. **Paste screen**: a large multiline `TextInput` (the native paste menu needs no permission) and
   expo-clipboard's `ClipboardPasteButton` (iOS 16+ UIPasteControl, no "Allow Paste" prompt; check it
   exists in expo-clipboard 58). Avoid calling `Clipboard.getStringAsync()` on mount, because iOS
   would show the paste-permission alert.
3. **Clean-up preview** (lyrics agent's `parsePastedLyrics`): it removes section headers (`[Coro]`,
   `[Verso 1: X]`, `(x2)` marks the repeat), copy-paste debris from lyric sites ("123 Contributors",
   "Translations", "Embed", "You might also like", a trailing "…Lyrics" title line), and blank-line
   runs. It keeps stanzas and detects **LRC** timestamps (`[mm:ss.xx]`). It shows "24 lines · 3 slang
   notes · explicit words: 2" and lets the user delete lines.
4. **Explicit**: ON by default (brief). If the user turns it off, explicit words (register-pack
   `explicit` flag) are masked on screen, while the stored text stays intact.
5. **Timing (optional)**: "Time it while you listen". The song plays and the learner taps at each line
   start; ±0.25 s nudge per line; times saved locally. Without timing, cliffs run on text and the learner
   advances; with timing (taps or LRC), `pauseAt(lineEnd)` drives "the music waits for you".

### 4.2 Storage (expo-sqlite, on device only)

```sql
CREATE TABLE song (
  id TEXT PRIMARY KEY,               -- 'am:catalog:<id>' | 'am:library:<id>' | 'sp:<trackId>' | 'url:<sha1 of canonical url>' | 'local:<uuid>'
  title TEXT NOT NULL, artist TEXT NOT NULL,
  apple_catalog_id TEXT, apple_library_id TEXT, spotify_track_id TEXT, share_url TEXT,
  isrc TEXT, is_explicit INTEGER NOT NULL DEFAULT 0, region TEXT,   -- region pack hint (PR, DO, CU, CO)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE lyrics (
  song_id TEXT PRIMARY KEY REFERENCES song(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,            -- exactly what the user pasted
  lines_json TEXT NOT NULL,          -- parsed lines (lyrics module output)
  timings_json TEXT,                 -- [{line, startSec}] from taps or LRC
  origin TEXT NOT NULL CHECK (origin IN ('pasted','shared-text','lrc')),
  updated_at INTEGER NOT NULL
);
```

Repository interface `LyricsStore { upsertSong, getSong, listSongs, saveLyrics, getLyrics, saveTimings,
deleteSong, deleteAllLyrics }`, with an in-memory fake for jest and the SQLite implementation in the
app. Settings → "Delete all pasted lyrics".

### 4.3 Copyright notes (for docs/STORE.md and the privacy policy)

- The app ships no lyrics, fetches none, scrapes none and uploads none. The user's pasted text stays
  in the app's private storage for their own study. There is no feature that sends lyric text to
  another person or server: no share button on lyric text and no cloud sync. Lyrics never appear in
  logs; the app has no analytics or crash upload.
- OS backups (iCloud or Google device backup) are under the user's control. Say so in the privacy
  policy. "Never uploaded" means the app itself never sends them.
- Demo, onboarding, tests and store screenshots use only the fictional "Luna de Santurce" by Rayo K.
  and other lyrics written for the app. Avoid "public domain" songs unless the term has been checked
  in every store country: "Cielito lindo" (1882) is public domain in the US, but Mexico's term is
  life + 100 years and its composer died in 1957. No real artist names, song titles or album art in
  store metadata or keywords (App Review 2.3.7 and 5.2).
- Licensed timed lyrics later (Musixmatch, LyricFind, …): needs a contract, attribution and per-display
  reporting. Match by ISRC (MusicKit `Song.isrc`). The Apple Music API lyrics endpoint is not open to
  third-party apps.
- Spotify: no logo, text mention only ("Share a song from Spotify"). No Spotify developer terms apply
  because no Spotify API is used. Apple Music branding: check the Apple Music identity guidelines for
  in-app "playing in Apple Music" attribution (unverified requirement).

---

## 5. Store setup with EAS

### 5.1 app.config.ts (sketch)

```ts
import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Cliffword',
  slug: 'cliffword',
  scheme: 'cliffword',                       // required by expo-share-intent
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',               // revisit when a dark theme exists (the previews are light)
  icon: './assets/icon.png',                 // 1024x1024, no alpha
  ios: {
    bundleIdentifier: 'app.cliffword',
    supportsTablet: false,                   // phone design 390x844; avoids iPad screenshots
    config: { usesNonExemptEncryption: false },   // ITSAppUsesNonExemptEncryption=false: only OS HTTPS
    infoPlist: {
      NSMicrophoneUsageDescription: 'Cliffword listens when you hold to speak or sing. Audio stays on your phone.',
      NSSpeechRecognitionUsageDescription: 'Cliffword turns your speech into text on your phone to check your answers.',
      NSAppleMusicUsageDescription: 'Cliffword plays songs from your Apple Music library and pauses them so you can sing the next line.',
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1', '1C8F.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1', '0A2A.1', '3B52.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1', '85F4.1'] },
      ],
    },
  },
  android: {
    package: 'app.cliffword',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', monochromeImage: './assets/adaptive-icon-mono.png', backgroundColor: '#F3F4F1' },
    permissions: ['android.permission.RECORD_AUDIO'],
    blockedPermissions: [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    allowBackup: true,                       // learner data backs up; keep the model in noBackupFilesDir (see 5.7)
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    ['expo-build-properties', { ios: { deploymentTarget: '17.0' } }],
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#F3F4F1' }],
    ['expo-font', { fonts: [/* Newsreader, Inter, Anton .ttf from @expo-google-fonts/* */] }],
    ['expo-speech-recognition', { microphonePermission: '…same text…', speechRecognitionPermission: '…same text…' }],
    ['expo-audio', { microphonePermission: '…same text…', enableBackgroundPlayback: false, enableBackgroundRecording: false }],
    ['expo-share-intent', { /* 3.2 */ }],
    ['llama.rn', { entitlementsProfile: ['development', 'preview', 'production'] }],
  ],
  extra: { eas: { projectId: 'FILL_FROM_eas_init' } },
};
export default config;
```

Notes on these fields (verified in package sources):
- **expo-audio's plugin defaults to `enableBackgroundPlayback: true`.** That adds `UIBackgroundModes: audio`,
  `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and the last one needs a Play Console
  foreground-service declaration. Turn it off, and block the permissions as a backstop.
- **expo-speech-recognition's plugin** sets both iOS usage strings and `RECORD_AUDIO`, plus a `<queries>`
  entry for `com.google.android.googlequicksearchbox` / `android.speech.RecognitionService`.
- **llama.rn's plugin** adds the `increased-memory-limit` and `extended-virtual-addressing` entitlements
  only for the `production` profile by default. Pass all profiles so development builds test with the
  same memory. EAS capability sync supports both entitlements.
- **Privacy manifest**: the union of the reasons in the shipped manifests is RN 0.88.1 (UserDefaults
  CA92.1; FileTimestamp C617.1; SystemBootTime 35F9.1), expo-file-system 58 (FileTimestamp 0A2A.1,
  3B52.1; DiskSpace E174.1, 85F4.1) and expo-constants/expo-localization (CA92.1). **1C8F.1** covers the
  app reading the share extension's app-group UserDefaults (ExpoShareIntentModule.swift does). llama.rn
  ships no privacy manifest. If App Store Connect emails ITMS-91053 after upload, add the reason it
  names. RN aggregates pod manifests (`privacy_file_aggregation_enabled` in the template Podfile); the
  app.json declaration is the safety net.
- `ITSAppUsesNonExemptEncryption=false`: the app uses only OS HTTPS (model download, MusicKit). Hashing
  the model with SHA-256 is not encryption.
- **Not needed**: `UIBackgroundModes`, location, contacts, photo library, camera, tracking (ATT).

### 5.2 eas.json

```json
{
  "cli": { "version": ">= 27.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "APP_VARIANT": "development" },
      "android": { "buildType": "apk" }
    },
    "development-simulator": {
      "extends": "development",
      "ios": { "simulator": true }
    },
    "preview": {
      "distribution": "internal",
      "env": { "APP_VARIANT": "preview" },
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "env": { "APP_VARIANT": "production" },
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {
      "ios": { "ascAppId": "FILL_AFTER_APP_RECORD_EXISTS" },
      "android": { "track": "internal", "releaseStatus": "draft" }
    }
  }
}
```

eas-cli on npm today is 27.10.0. `expo-dev-client` 58.0.20 goes in dependencies for the development
profile. The simulator profile needs no Apple credentials, but MusicKit playback, the microphone and
llama performance need a device build. **No build starts without the user's approval.**

### 5.3 Icons, splash, placeholders

- `assets/icon.png` 1024×1024 RGB with no alpha (iOS rejects alpha). `adaptive-icon.png` 1024×1024 with
  the mark inside the central 66%, background `#F3F4F1`. `adaptive-icon-mono.png` for Android 13
  themed icons. `splash-icon.png` (transparent mark, about 400 px). Play listing: 512×512 icon and a
  **1024×500 feature graphic** (required).
- Placeholder generator: `scripts/make-placeholder-assets.mjs` using node:zlib to write PNGs (ink
  `#16181D` "C" or a cliff mark with amber `#F08A1D` on ground `#F3F4F1`). A jest test checks
  dimensions, colour type (no alpha for icon.png) and that files exist.
- Store screenshots: iPhone 6.9" (1290×2796 or 1320×2868) is the required set. Android phone shots:
  at least 2, at most 8, 9:16. Build them from the design previews with fictional content.

### 5.4 Age rating (explicit lyrics ON by default)

App Store (new tiers 4+/9+/13+/16+/18+; per App Store Connect reference, values verified today):

| Questionnaire item | Honest answer for Cliffword | Tier it implies |
|---|---|---|
| Profanity or Crude Humor | **Frequent** (explicit slang notes, explicit on by default) | 13+ |
| Sexual Content or Nudity | Infrequent (glosses of sexual slang; no imagery) | 13+ |
| Alcohol, Tobacco, or Drug Use or References | Infrequent (keep drug slang in packs rare; "Frequent" means **18+**) | 13+ |
| Mature or Suggestive Themes | Infrequent (Frequent gives 16+) | 9+ |
| User-Generated Content | No (pasted lyrics are never shown to other users) | 4+ |
| Unrestricted Web Access | No (no in-app browser; links open other apps) | n/a (Yes = 16+) |
| Messaging, Advertising, Gambling, Contests, Violence, Horror, Medical, Health | None / No | 4+ |

**Expected: 13+.** If shipped packs or Apple treat suggestive or drug content as frequent, the rating
becomes 16+ or 18+. Answer from the shipped register packs (count the explicit entries by type before
filling it in). Store description: "Includes explicit slang and lyrics; turn explicit content off in
Settings."

Google Play (IARC): strong language plus sexual and drug references. Expect **PEGI 16 / USK 16** and
ESRB Teen or Mature 17+ depending on answers. In "Target audience" choose 16–17 and 18+ (never under
13, which would bring the Families policy). Ads: no. Data safety: no data collected or shared.

### 5.5 App privacy declarations

- App Store "App Privacy": **Data Not Collected**. This requires on-device speech recognition
  (`requiresOnDeviceRecognition: true`), no analytics or crash SDKs, and no lyrics, recordings or
  learner data leaving the device. MusicKit requests go to Apple under the user's Apple ID; the
  developer receives nothing.
- Google Play Data safety: "No data collected", "No data shared". On Android the recognizer service
  belongs to Google; prefer on-device recognition (`requiresOnDeviceRecognition`, offline Spanish model
  download) so the claim holds. That is the speech agent's job, flagged here.
- Both stores need a **privacy policy URL** even with no collection (Guideline 5.1.1(i)). Draft
  `docs/PRIVACY.md` (what stays on device, the model download host sees the IP like any download,
  pasted lyrics never leave the app, how to delete data) and host it, for example at
  cliffword.app/privacy or on GitHub Pages.
- EU: App Store Connect asks for DSA trader status; Google Play asks for public developer contact
  details.

### 5.6 Store listing files

```
store/
  metadata/ios/en-US/{name.txt, subtitle.txt, keywords.txt, description.txt, promotional_text.txt,
                      release_notes.txt, privacy_url.txt, support_url.txt, marketing_url.txt}
  metadata/android/en-US/{title.txt, short_description.txt, full_description.txt, changelogs/1.txt}
  screenshots/…                      (generated, fictional content only)
  metadata.test.ts                   limits + banned terms
docs/STORE.md                        checklist, questionnaire answers (5.4, 5.5), review notes, account steps
```

Limits to test: iOS name ≤ 30, subtitle ≤ 30, keywords ≤ 100 **bytes** (comma separated, no spaces
after commas), promotional text ≤ 170, description ≤ 4000. Android title ≤ 30, short description ≤ 80,
full description ≤ 4000. Banned terms: "Spotify" in title/subtitle/keywords (allowed in the
description as a text mention), real artist names, "free" in the title, competitor app names.

Drafts:
- iOS name: `Cliffword: Speak Spanish` (24). Subtitle: `Finish the sentence out loud` (28).
- Keywords (96 bytes): `learn spanish,speaking,listening,lyrics,songs,slang,reggaeton,caribbean,puerto rico,conversation`
- Play short description (78): `Stories that stop mid-sentence. Say what comes next. Learn Spanish from songs.`
- Categories: iOS Education (secondary Music); Play Education.
- Review notes (App Store): "No account. On first launch the app asks before downloading its 1.1 GB
  on-device language model (Wi-Fi recommended). The Music tab works without Apple Music by pasting
  lyrics; Apple Music playback needs an Apple ID with a subscription. Explicit slang is on by default
  and can be turned off in Settings."

### 5.7 Large on-demand model download policy

Model: `unsloth/Qwen3-1.7B-GGUF`, file `Qwen3-1.7B-Q4_K_M.gguf`, **1,107,409,472 bytes (1.11 GB,
1.03 GiB)**, SHA-256 `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897`, repo commit
`d7f544eead698dbd1f15126ef60b45a1e1933222`, license Apache-2.0, not gated (HF API, 2026-11-15). The pinned
URL `https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf`
answers 302 to a CDN with `accept-ranges: bytes` and `x-linked-size` / `x-linked-etag` matching, so it
can resume.

Rules:
- App Review **4.2.3(ii)**: "If your app needs to download additional resources in order to function on
  initial launch, disclose the size of the download and prompt users before doing so." The first-run
  screen says "Download the language model (1.1 GB)". Default Wi-Fi only, with a cellular toggle.
  Show progress, keep it resumable, and check free space first (DiskSpace reason E174.1).
- **2.5.2** forbids downloading code that changes functionality. Model weights are data. Never download
  scripts, prompts-as-code or native libraries.
- Google Play Device and Network Abuse policy: no executable code from outside Play. A .gguf file is
  data. AAB base size limits rule out bundling the model.
- Integrity: verify size and SHA-256 after download. On mismatch delete and retry. Keep the pinned
  revision in config (`MODEL_MANIFEST`: url, bytes, sha256, license).
- Location: iOS Application Support with `NSURLIsExcludedFromBackupKey` (iOS Data Storage Guidelines:
  re-downloadable data must not go to iCloud backup). expo-file-system may not expose that flag, so add
  a 5-line native helper (in the llama.rn patch or a tiny local module). Android `noBackupFilesDir` (or
  backup rules excluding the model directory).
- Hosting: before launch, mirror the file to storage the user controls (for example a GitHub Release
  asset, under 2 GB per file, or an R2/S3 bucket), so upstream repo changes cannot break installs. Keep
  HF as a fallback. Both need the user's accounts.
- Licenses screen: Qwen3 Apache-2.0 notice; llama.cpp MIT (via llama.rn).
- v2 options: Apple-hosted Background Assets (App Store hosted asset packs, iOS 26) and Play Asset
  Delivery. Both remove the third-party host but need native work; check size limits then.
- Device floor: iOS 17 (D9). On Play, exclude devices under 4 GB RAM in the Play Console device catalog
  if needed. That is a user action.

### 5.8 What needs the user's own accounts (cannot be done here)

- **Expo**: account, `eas init` (projectId), approval for every EAS build and submit.
- **Apple Developer Program** (paid): register App IDs `app.cliffword` and `app.cliffword.share-extension`.
  Enable the **MusicKit App Service** on the main App ID by hand. App Group `group.app.cliffword` is
  registered by EAS during an **interactive** `eas build` with Apple login. The memory entitlements
  sync through EAS. Certificates and profiles are EAS-managed. Register devices (`eas device:create`)
  for development builds. Create the App Store Connect app record (reserves the name "Cliffword"), an
  App Store Connect API key for `eas submit`, age rating, App Privacy, export compliance, price
  (Free), DSA trader status, TestFlight testers, review notes. A real iPhone with an Apple Music
  subscription is needed to test playback.
- **Google Play Console** (one-time fee): create the app `app.cliffword`, opt into Play App Signing,
  **upload the first AAB by hand** (the API cannot create the first release), add a service-account
  JSON for `eas submit`, fill IARC rating, Data safety, target audience, privacy policy, app access
  notes and ads = no. New personal developer accounts must run a **closed test with at least 12 testers
  for 14 days** before production access.
- Domain (cliffword.app was unregistered on 2026-11-15) for the bundle id convention and the privacy
  policy URL; trademark check.
- Optional later: Apple Developer download of MusicKit for Android AARs (v2); a lyrics-licensing contract.

---

## 6. Build tasks with proving tests (for docs/OUTLINE.md)

| Task | File(s) | Test that proves it done |
|---|---|---|
| Music service contract + fake | `app/src/music/types.ts`, `fake.ts` | jest: fake plays, `advance` moves position, `pauseAt` fires `onCliff` once at target − lead, seek disarms, play rejects without subscription/explicit restriction |
| Platform selection | `app/src/music/index.ts`, `native.ios.ts`, `native.ts`, `unavailable.ts` | jest with `Platform.OS` mocked: android/web → `available:false`, `authStatus()==='unavailable'`; ios with module missing → unavailable |
| Cliff clock helpers | `app/src/music/cliffClock.ts` | jest: targets from timings, LRC-derived timings, "otra vez" seek target, no auto-resume |
| MusicKit native module | `modules/musickit/**` | TS: `index.ts` typed binding unit-tested against a mocked `requireOptionalNativeModule`; Swift: compiles in the first EAS iOS build (user-approved); manual device checklist in `modules/musickit/README.md` (authorize, library search, play, pauseAt accuracy within 150 ms, subscription states) |
| Share parser | `app/src/share/parseShared.ts` | jest fixtures in 3.3 |
| Share routing | `app/app/+native-intent.tsx`, `app/app/share.tsx` | jest: `redirectSystemPath` maps `dataUrl=cliffwordShareKey` to `/share`, passes others; RTL: share screen with mocked `useShareIntentContext` renders prefilled title/artist, saves song, calls `resetShareIntent` |
| Lyrics store | `app/src/lyrics/store.ts` (+ in-memory fake) | jest on the fake + a shared contract test suite run against both implementations where the SQLite one can run (device/web) |
| Paste + timing screens | `app/app/music/paste.tsx`, `app/app/music/time.tsx` | RTL: paste → preview counts lines/slang/explicit, explicit off masks words; timing taps record monotonic starts |
| App config | `app.config.ts` | jest (node): `getConfig()` has bundle id/package, scheme, three usage strings, `usesNonExemptEncryption:false`, privacy reasons above, blocked permissions, expo-audio background off, share-intent plugin, `supportsTablet:false`, deployment target 17.0 |
| EAS profiles | `eas.json` | jest: development has `developmentClient` + internal distribution; production autoIncrement + app-bundle; no secrets or key paths committed |
| Placeholder assets | `scripts/make-placeholder-assets.mjs`, `assets/*` | jest: PNG sizes (1024², 1024×500, 512²), icon.png has no alpha channel |
| Store metadata | `store/metadata/**`, `docs/STORE.md` | jest: length limits (keywords in bytes), banned terms, every locale has every file |
| Privacy policy | `docs/PRIVACY.md` | jest: mentions model host, on-device speech, lyrics never uploaded, deletion steps (string checks) |
| Model download policy | `app/src/model/download.ts` (with the llama adapter agent) | jest with a fake fetcher: prompts with size before starting, Wi-Fi-only default, resumes from offset, rejects on SHA-256 mismatch, checks free space |

---

## 7. Open questions (need a device, an account or a build)

- What Spotify's iOS and Android share actually sends: URL only, URL plus text, `spotify.link` vs
  open.spotify.com, and whether Android puts the title in `EXTRA_SUBJECT` (not read by
  expo-share-intent). Log one share on each platform.
- Whether `ApplicationMusicPlayer` honours `playbackRate < 1` on catalog streams ("más despacio" for songs
  falls back to TTS of the line if not).
- Real pause latency of `pauseAt` on device, and the right lead (start at 120 ms).
- Whether library songs that are purchased or synced play without a subscription through
  ApplicationMusicPlayer.
- Audio session handover between MusicKit playback and expo-speech-recognition/expo-audio recording.
- Whether lomray's interop-layer module would work on RN 0.88 (moot if D1 is accepted).
- Apple Music identity guideline requirements for in-app attribution.
- Final age rating after answering from the shipped packs. Current US state app-store age-assurance
  laws (Texas, Utah, Louisiana) and whether the Declared Age Range API should gate the explicit default.
- Expo SDK 58 share extension plus SceneDelegate deep-link delivery on a real device.
- Whether expo-file-system 58 can set exclude-from-backup without native code.
