# Cliffword: device checklist

Checks that need a real phone. Run them on a TestFlight build on an iPhone and, if you have one,
on an internal-testing build on an Android phone. Sources: `docs/OUTLINE.md` section 8.3 (every
ID there appears here, unchanged) and `app/README.md` "Native code and EAS". Store and release
steps are in `docs/RELEASE.md`.

Rows marked **dev build** need a development build (`eas build --profile development`) and the
console or a file browser; skip them on TestFlight and note "not run". Fill in the last two
columns with pass, fail or n/a, and write what you saw for every fail.

## Before you start

| Record | iPhone | Android |
|---|---|---|
| Phone model and memory (GB) | | |
| OS version | | |
| App version and build (Profile, Settings, About) | | |
| Date and tester | | |

You need: Wi-Fi and the ability to turn on airplane mode; at least 2 GB of free storage; a
stopwatch; the Spotify app; an Apple Account with an Apple Music subscription (and, for M2 and M7,
one without); wired or Bluetooth headphones (AirPods for A5); the made-up song from STORE.md (title
"Luna de Santurce", artist "Rayo K.") to paste.

Where things are: the Profile button is the corner button on the tabs header. Settings is inside
Profile. The model self-test is hidden: in Settings, About, tap the version line 7 times quickly
(less than 1.5 s between taps).

Start from a fresh install (delete the app first if it was installed).

## 1. Install and first launch

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| O1 | First launch | Install and open | Splash in the ground colour, then the onboarding welcome; no permission prompt of any kind at launch | | |
| O2 | Start choice | Tap "I'm brand new" (repeat later with "I know some Spanish") | The choice is kept and the next step opens | | |
| O3 | Model step | Read the model step without tapping anything | It shows the 1.1 GB size and the phone's free space; nothing downloads before you tap Download; "Not now" and continuing during the download both move on | | |
| O4 | Voice step | Open the voice step | Spanish voices are listed; a sample plays in the chosen voice | | |
| O5 | Slang step | Choose regions | The choice shows later in Settings, Slang | | |
| O6 | Resume onboarding | Force-quit on the voice step, reopen | Onboarding opens at the voice step, not the welcome screen | | |
| O7 | Finish | Complete onboarding | The Story tab opens; relaunching goes straight to the tabs | | |

## 2. Model download

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| D3 | Disclosure | Model step or Settings model card before starting | Size (1.1 GB), free space and the mobile-data note are shown before the download starts (Guideline 4.2.3) | | |
| D4 | Progress | Start on Wi-Fi and watch | Percent and "x of 1.1 GB" move steadily; the screen stays awake while downloading and checking | | |
| D5 | Pause and resume | Pause at about 30%, wait, Resume | Continues from where it stopped, not from 0% | | |
| D2 | Background download | Lock the phone or switch apps for 5 minutes mid-download; then force-quit mid-download and reopen | Survives the suspend (progress moved on while away on iOS); after the force-quit it resumes (Android from the partial file) or restarts cleanly (iOS), with no error loop | | |
| D6 | Network loss | Turn on airplane mode mid-download, then off, tap Try again | A plain error message, then the download carries on | | |
| D7 | Verification | Let it finish | "Checking the file…" with a percent, then "Ready. The model is on your phone."; a relaunch shows Ready at once without checking again | | |
| D8 | Low space (optional) | Only if a phone is nearly full | The download refuses to start and the message names the space needed and free | | |
| D1 | Backup exclusion | iOS: Settings, General, iPhone Storage, Cliffword shows about 1.1 GB of Documents & Data; then Settings, your name, iCloud, Manage Account Storage, Backups, this iPhone: Cliffword's backup size. Android: Settings, Google, Backup, app data size | The models folder is excluded: Cliffword's backup is a few MB, not 1.1 GB (README: `isExcludedFromBackup`; Android rules exclude `files/models`) | | |

## 3. Model load, self-test, memory

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| L1 | `RNLlama.install()` on RN 0.88.1 New Architecture | After the download, open the self-test (see "Where things are") | Status reaches "Ready"; Runs on "llama.rn on this phone". The context loads on iOS and Android | | |
| L2 | Self-test numbers | Tap "Run the self-test" | Scoring path "Native method (exact)" (not forced decoding); verdict "Passed: 14 of 14 totals within 0.15 nats"; the correct sentence scored higher in 7 of 7 pairs; no failed calls. Write down the ms per sentence. **Dev build:** byte offsets slice `¿ ¡ á ñ` and an emoji correctly | | |
| L3 | KV reuse (**dev build**) | Score the same text twice, then run a completion, with logs on | The second identical score reports `n_reused = n_context_tokens - 1`; the completion has `timings.cache_n > 0` | | |
| L4 | Speed and memory per tier | Play stories for 15 minutes with a few other apps open; time answers from release to result with a stopwatch. iOS: afterwards look in Settings, Privacy & Security, Analytics & Improvements, Analytics Data for a `JetsamEvent` file from that time. Android: `adb shell dumpsys meminfo app.cliffword` | Judgement under 2 s (iPhone 12 or newer), under 5 s (Android with 8 GB); no jetsam or low-memory kill, including on a 4 GB phone at the low tier; memory near 1.2 GB with one context | | |
| L5 | Background during a model call | Hold and answer, then switch apps at once while it scores; come back after 30 s | No crash; the call finishes or resumes after returning; a model checked while in the background is loaded on return | | |
| L6 | Narrowed Android variants | Install on an armv8.0 phone (no dotprod) and on a dotprod + i8mm phone (for example a Pixel 8). **Dev build** to read `androidLib` | Loads on both; the older phone falls back to the generic `rnllama` | n/a | |
| L7 | EAS Android build time | The build page on expo.dev | Within the plan's limit with arm64-v8a only and the narrowed variants | n/a | |
| L8 | Gemma 3n E2B on llama.rn (**dev build**, information only) | Load the model by hand | Loads and gives sane output; recorded for information only, does not block Qwen3-1.7B | | |
| L9 | Low-memory phone (optional) | Only if an older or 3 GB phone is at hand | The model fails to load with a message and the app keeps working in starter-sentence mode, without crashing | | |

## 4. Story loop

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| T1 | Before the model | Fresh install, "Not now" on the model step, open Story | "The language model is still on its way…" and starter sentences; the loop works | | |
| T2 | Hold to speak | Hold anywhere on the story screen, say an answer, let go | "Listening…" shows while held; the answer is heard and scored | | |
| T3 | Scoring and shading | Give a natural answer, then a wrong one | Natural answers earn credit; unexpected words are shaded; "Understood N of M words" appears; no accent score anywhere | | |
| T4 | Spoken commands | Say each instead of an answer | "otra vez" repeats the sentence; "más despacio" repeats it slower; "no sé" plays the answer and asks you to repeat it; "siguiente" moves on; "listo" finishes | | |
| T5 | Self-repair | Make a clear grammar error (for example "Mi hermano es enfermo hoy") | You are asked to fix it yourself before the correction shows; the correction names the rule | | |
| T6 | Tiles | Tap a tile, then hold one | Tap plays the word; hold shows it as text | | |
| T7 | Type instead | Tap "Type instead" and type an answer | Scored like a spoken answer | | |
| T8 | Placement | Reinstall, choose "I know some Spanish", answer well for a while | Sentences get harder until you stall; no test screen | | |
| T9 | Minutes spoken | Note the Profile number, then speak about 60 s in total across several answers (stopwatch running only while you talk); relaunch | The number rises by about 1 minute (voiced time, not silence) and survives the relaunch | | |

## 5. Retell

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| R1 | Round timing | Start a retell; time each round with a stopwatch | Rounds of 60, 45 and 30 s, each within 1 s of the stopwatch | | |
| R2 | Ending a round | Say "listo" before the time runs out | The round ends and the next one, or the result, opens | | |
| S3 | iOS one-minute limit in a 60 s retell | Talk without stopping for the whole 60 s round | The transcript has no gap or loss after about 60 s; the latched restart joins transcripts with correct times | | n/a |
| S8 | Pauses for retell | Retell with 3 deliberate silences of about 1 s, counted on a stopwatch | Pause counts (silences of 700 ms or more) match the stopwatch within one | | |

## 6. Speech

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| S1 | Recognizer start latency | Record the screen at 60 fps; hold and speak at once | Listening within 300 ms of the 120 ms hold; the first syllable is not cut off | | |
| S2 | On-device recognition per locale | Network recognition off, airplane mode on; answer in Spanish with the phone set to each of es-US, es-MX, es-ES where available. Android 13+: let the app download the offline Spanish model | es-US, es-MX, es-ES status known on iOS and Android; recognition works in airplane mode; a locale without an on-device model gives the "on-device unavailable" message and "Type instead"; the offline download works on Android 13+ | | |
| S4 | iOS profanity masking | With explicit on, sing or say "La calle 'tá brutal, puñeta, qué calor" | Explicit lyric lines come back unmasked, or `*` is treated as a wildcard and the line still gets credit | | n/a |
| S5 | Android levels in continuous mode | Hold and speak loudly, then softly | `volumechange` events arrive: the hold animation follows your voice (else levels from the WAV) | n/a | |
| S6 | TTS voices | Onboarding voice step and Settings voice picker | A Spanish voice is chosen on iOS 18/26 and on Pixel and Samsung engines | | |
| S7 | Word boundaries | Watch the tiles while a sentence plays | `onBoundary` fires for the chosen Spanish voices: the highlight follows the voice word by word | | |
| S9 | English answers to an es-US recognizer | Answer a cliff in English | `nativeReply` finds the English words in the transcript or its alternatives, and the app gives the Spanish phrase to repeat; otherwise the "Answer in English" chip (en-US listen) works | | |
| S10 | Sing-back recording format | Sing a lyric line back. **Dev build:** inspect the saved WAV | The sing-back result shows; iOS writes 16 kHz 16-bit WAV with the recording options; `readAudio` and `readWav` read it on both platforms | | |

## 7. Audio, silent switch, headphones

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| A1 | Silent switch before the first hold | Ring/Silent switch on silent, fresh launch, open Story | The story's voice is audible from the speaker | | n/a |
| A2 | After a hold | Still on silent: hold, answer, let the next sentence play | The voice plays from the loudspeaker at full volume (not the earpiece, not quiet) | | n/a |
| A3 | No early microphone prompt | Fresh install | The microphone prompt appears only at the first hold | | |
| A4 | Recognition after speech | Hold immediately after a sentence finishes playing | Recognition starts and hears you | | |
| A5 | AirPods | Connect AirPods, play a story, hold and answer | The voice stays in full-quality stereo (A2DP) after a hold; recognition works | | |
| A6 | Music before listening | Play a song (Section 8), hold to sing | The song pauses before the microphone opens | | n/a |

## 8. Apple Music (iPhone)

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| M1 | Authorize | Music tab, Apple Music, Connect | The system prompt shows the usage text; after Allow, "Connected · your library plays here" | | n/a |
| M2 | Subscription states | With and without a subscription | With: library songs play. Without: a clear message, and the paste path still works | | n/a |
| M3 | Library and catalog play | Search and sort the library list; play a song | Songs list with artwork where Apple provides it; play, pause and seek work from the song screen | | n/a |
| M4 | `pauseAt` | Time a song's lines ("Time it while you listen"), then play it | The song pauses at each line end within 150 ms (the module targets 100 ms), before the next line's first syllable | | n/a |
| M5 | playAndRecord handover | After the pause, hold and sing the line back | The track stays paused while you sing and resumes from the same spot on a tap or "siguiente" | | n/a |
| M6 | `playbackRate < 1` | Say "más despacio" on a song line | The line replays slower (or the text-to-speech fallback reads it) | | n/a |
| M7 | Library songs without a subscription | Account without Apple Music; play a purchased or synced song | Record whether it plays; the app explains when it cannot | | n/a |
| M8 | MusicKit service still enabled after EAS capability sync | Developer portal, Identifiers, `app.cliffword`, App Services | MusicKit is still checked after the latest build | | n/a |
| M9 | User-started playback only (Guideline 4.5.2) | Watch through a whole song session, background and foreground the app | Music never starts or resumes without a tap or a spoken command; play and pause controls are always visible on the song screen | | n/a |

## 9. Share-in

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| H1 | Share extension delivery (SDK 58 SceneDelegate) | In Spotify, a song, Share, Cliffword (under "More" the first time) | Sharing from Spotify opens `/music/share` with the song to confirm | | n/a |
| H2 | What Spotify sends | Share a song, an album and a playlist, on both platforms. **Dev build:** log the payload | Logged on iOS and Android; parser fixtures updated. On TestFlight: a track fills title and artist or the confirm card asks; an album or playlist is handled without a crash | | |
| H3 | Android SEND | In Spotify on Android, Share, Cliffword | Cliffword opens the Music tab with the shared song | n/a | |
| H4 | Cold and warm, repeats | Share with Cliffword force-quit, then with it in the background; share the same song twice | Each share arrives once; the duplicate is not added twice; an unconfirmed share is still there after a relaunch | | |

## 10. Background and foreground

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| B1 | Return to a story | Leave mid-story for 2 minutes, come back | The story is where you left it; model calls wait rather than fail (see L5) | | |
| B2 | Force-quit mid-session | Force-quit during a story and during a song, reopen | The sessions resume | | |
| B3 | Interruption while listening | Hold to speak, then trigger Siri or receive a call | Listening stops cleanly; the next hold works | | |

## 11. Permissions denied

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| P1 | Permission dialogs | Fresh install; deny the microphone at the first hold | Texts shown; denial leads to "Type instead" | | |
| P2 | Speech recognition denied | Fresh install; allow the microphone, deny speech recognition | A plain message and "Type instead"; nothing crashes | | n/a |
| P3 | Turning access back on | Enable the permission in the phone's Settings, return to the app | Holding to speak works without a relaunch | | |
| P4 | Apple Music denied | Deny at Connect | The Music tab stays usable with pasted lyrics; Settings shows "Open Settings"; a Screen Time restriction shows the restricted message | | n/a |

## 12. Settings and your data

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| X1 | Explicit on by default | Fresh install; paste the made-up song | Explicit lyrics is on in Settings; the song shows "Explicit · on"; the paste preview counts 1 explicit word ("puñeta"); slang notes show explicit words | | |
| X2 | Explicit off | Turn it off; open the song; relaunch | Explicit lines are skipped; "Explicit · off"; the setting survives the relaunch | | |
| X3 | Network recognition | Check the default; then try a language or phone with no on-device model; then, online, turn "On-device recognition only" off | "On-device recognition only" is on by default; without on-device support you get the message and "Type instead"; with the switch off (online) recognition works through the system's speech service | | |
| X4 | Delete lyrics and texts | Settings, "Delete all lyrics and texts", confirm | Pasted lyrics and brought texts are gone; the songs stay, waiting for lyrics; progress and minutes spoken remain | | |
| X5 | Reset progress | Settings, Reset progress, confirm, choose a start | Onboarding's start choice opens; afterwards minutes spoken is 0 and the words are reset; the model, voice and slang settings are kept; no old story or song session resumes | | |
| X6 | Delete the model | Settings, Delete the model, confirm; check iPhone Storage or Android app storage; download again | About 1.1 GB is freed; the app goes back to starter sentences; the new download works | | |
| X7 | Selfie and photo | Settings, Your picture, Change: "Take a selfie" (allow the camera), then "Choose a photo", then Remove photo. **dev build**: after each step list the app's cache folder (`<cache>/ImagePicker/`) and `files/avatar/` (Android: `adb shell run-as app.cliffword ls -R cache files/avatar`) | The selfie, then the photo, shows in the row and beside your answers; after every step `ImagePicker/` is gone or empty and `avatar/` holds at most the one photo in use; after Remove photo both are empty | | |
| X8 | Selfie interrupted by Android | Android, Developer options, "Don't keep activities" on; Settings, Your picture, Take a selfie, take it, confirm the crop | Back in the app (it restarts), the selfie is your picture; turn the option off afterwards | n/a | |
| X9 | Old Android: no selfie | An Android 9 (API 28) emulator or phone; open Your picture | Only "Choose a photo" is offered, and it works; no camera prompt ever appears | n/a | |
| X10 | Simulator: no selfie | **dev build** in the iOS Simulator (`development-simulator` profile); open Your picture | Only "Choose a photo" is offered; nothing crashes. Test the selfie itself on a real iPhone (X7) | | n/a |

## 13. Look and touch

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| G1 | Buttons over the root hold | Tap every button and chip on the story and song screens | Buttons and chips never start listening | | |
| G2 | Fonts | Look at story text, interface text and Music headings | Newsreader, Inter, Anton render by PostScript name on both platforms (no system-font fallback) | | |
| G3 | Larger text | Set the largest text size in the phone's settings | Text grows without overlapping or cut-off controls | | |
| G4 | Screen reader | VoiceOver or TalkBack on the main screens | Every control has a spoken name | | |
| G5 | iPad (optional) | If an iPad is at hand, install the TestFlight build on it | Runs in iPhone compatibility mode without crashing (App Review sometimes uses an iPad) | | n/a |

## 14. Release

| ID | Check | How | Pass when | iPhone | Android |
|---|---|---|---|---|---|
| F1 | App Store upload | Watch email after `eas submit -p ios` | No ITMS-91053 for required-reason APIs (add any reason it names to `ios.privacyManifests`) | | n/a |
| F2 | Version and build | Settings, About | Matches App Store Connect or the Play Console | | |
| F3 | Play pre-launch report | Play Console, Testing, Pre-launch report, after the first upload | No crashes; accessibility warnings noted | n/a | |
| F4 | Camera optional on Play | `aapt2 dump badging` on the build's APK; Play Console, Device catalog | `uses-feature-not-required` for `android.hardware.camera` and `.autofocus`, no `uses-implied-feature` for the camera; phones without an autofocus rear camera are not excluded | n/a | |

## Release blockers

A fail in any of these blocks submission: O1, O3, O7, D3 to D7, D2, D1, L1, L2, L4, T1 to T4, T7,
P1, P2, A1, A2, M1, M3, M4, M5, M9, H1, H3, X1, X2, X4, X5, F1. The rest are recorded and fixed
when practical.
