# Cliffword: store listing and questionnaire answers

What to type into App Store Connect and the Google Play Console for version 1.0.0, with the reasons
behind each answer. The step-by-step order (accounts, credentials, builds, submissions) is in
`docs/RELEASE.md`. The privacy policy to host is `docs/PRIVACY.md`. The device checks to run on a
TestFlight build are in `docs/DEVICE-CHECKLIST.md`.

Facts the answers rest on (checked in the code on 2026-11-16):

- Bundle id and Android package `app.cliffword`; share extension `app.cliffword.share-extension`;
  App Group `group.app.cliffword`; EAS project `@greypebs/cliffword`.
- iPhone only (`supportsTablet: false`), iOS 17.0 or later (`expo-build-properties`
  `ios.deploymentTarget`, decision 1; the SDK 58 default would be 16.4). Android 7.0 (API 24) or
  later, target API 36, arm64-v8a only.
- The language model (Qwen3-1.7B Q4_K_M, 1,107,409,472 bytes, Apache-2.0) is downloaded after
  install from a Hugging Face URL pinned to a commit, checked by size and SHA-256, kept out of
  backups, and run on the phone with llama.cpp (llama.rn).
- Speech recognition is on-device. Settings has an opt-in "network recognition" switch, off by
  default (`allowNetworkRecognition: false`).
- No accounts, analytics, ads, crash reporting or tracking SDKs. All learner data is in the app's
  SQLite database on the phone.
- Apple Music through MusicKit on iOS (library and playback, started by the user). Spotify is
  share-in only. Lyrics and texts are pasted by the user.
- Slang packs: 233 entries in five region packs, 41 flagged explicit (sexual words and
  profanity), and 6 unflagged alcohol or drug words (beer, liquor, drunk, high, drug boss).
  Explicit lyrics and slang are ON by default (`showExplicit: true`).

## Decisions for the owner

Decided on 2026-11-16 (owner's answers; 1, 3, 6 and 7 are the assistant's defaults under the
owner's instruction to finish without further questions).

| # | Decision | Decided | Why it matters |
|---|---|---|---|
| 1 | **Oldest iPhone.** iOS 16.4 would let the iPhone 8, 8 Plus and X (A11, 2 to 3 GB of memory) install the app, but they cannot hold the 1.1 GB model. | Deployment target raised to **iOS 17.0** (A12 and later) | Apple does not accept an update that adds a device capability requirement; raising the iOS version is the route that stays open. |
| 2 | **Explicit default.** Explicit lyrics and slang ON by default. | **ON** (owner) | Sets the age rating answers (below). |
| 3 | **Network recognition.** Opt-in switch for network speech recognition where on-device Spanish is missing. | **Keep, off by default** | See "App Privacy" for how the labels treat it. |
| 4 | **EU trader status** (Digital Services Act). | **Not a trader** (owner). Answer "No" in App Store Connect; the app stays available in EU storefronts and no trader contact details are shown. | Without an answer the app cannot be offered in EU storefronts. |
| 5 | **Android memory floor.** | **Exclude phones with less than 4 GB of RAM** in the Play Console device catalog (owner) | 3 GB phones may be killed while the model is loaded (DEVICE-CHECKLIST L4). |
| 6 | **Generated sentences on Play.** In-app "Report this sentence" action. | **Add it** (opens an email to the contact address with the sentence). Done: a quiet link under every story screen with a sentence | See "AI-generated content" under Google Play. |
| 7 | **Final icon.** | **Replace the placeholder** before screenshots. Done: `app/assets/brand/mark.svg` (word tiles on ink, the dashed amber gap) | The store icon is hard to change after reviews and screenshots exist. |
| 8 | **State age-check laws** (Texas, Utah, Louisiana). | **No age check** (owner) | The owner's call; the age rating is set from the content (below). |

## Hosting and contact (owner)

| Item | Value |
|---|---|
| Privacy policy URL | https://scottchanatry.com/cliffword/privacy/ |
| Support URL | https://scottchanatry.com/cliffword/support/ |
| Marketing URL | https://scottchanatry.com/cliffword/ |
| Contact email | hello@scottchanatry.com |

## In the app and in `app/store/`

- **Privacy policy link inside the app** (Guideline 5.1.1(i): "within the app in an easily
  accessible manner"): Settings, About has "Privacy policy", "Support" and "Contact" rows
  (`app/src/config/links.ts`), and the onboarding welcome screen has a "Privacy policy" footer
  link. The links work once the pages are live.
- **Play graphics:** `app/store/graphics/play-icon-512.png` and `play-feature-graphic.png`
  (`npm run icons`).
- **Screenshots:** `app/store/screenshots/` (`npm run screenshots`; see `app/store/README.md`).
- **Store metadata files** under `app/store/metadata/` (OUTLINE Stage 7) are optional. The text
  below is the source until they exist.

## App Store Connect

### App information

| Field | Value |
|---|---|
| Name | `Cliffword: Speak Spanish` (24 of 30 characters) |
| Subtitle | `Finish the sentence out loud` (28 of 30) |
| Bundle ID | `app.cliffword` |
| SKU | `cliffword-ios` (any unique text; never shown) |
| Primary language | English (U.S.) |
| Primary category | Education |
| Secondary category | Music |
| Content rights | "Does your app contain, show, or access third-party content?" Yes: it plays the user's Apple Music library through MusicKit and shows lyrics and texts the user pastes. It ships no third-party songs or lyrics. The model is Apache-2.0 and the fonts are OFL-1.1, with notices on the in-app licenses screen. |
| Privacy Policy URL | https://scottchanatry.com/cliffword/privacy/ (where `docs/PRIVACY.md` is hosted, see RELEASE.md) |
| Copyright | `2026 Scott Chanatry` (the field takes the year and the owner's name; no URL) |
| Price | Free (tier 0), no in-app purchases |
| Age rating | See "Age rating" |
| Made for Kids | No |

Names, keywords and screenshots contain no real artist names, song titles or album art (Guideline
2.3.7 and 5.2). "Spotify" appears only in the description, as a plain text mention of share-in.

### Version 1.0.0 listing

**Promotional text** (155 of 170 characters; it can be changed without a new build):

```
A story stops mid-sentence. You say what comes next, out loud, and any natural answer counts. It runs on your iPhone: no account, no ads, nothing uploaded.
```

**Keywords** (99 of 100 bytes; commas, no spaces after them; words already in the name and
subtitle are left out because Apple indexes those fields too):

```
learn,language,conversation,listening,vocabulary,lyrics,songs,slang,reggaeton,caribbean,puerto rico
```

**Description** (under 4,000 characters):

```
Cliffword teaches Spanish by getting you to talk.

A short story is read to you and stops mid-sentence, at the cliff. Hold anywhere on the screen and say what comes next. Cliffword scores your answer by how natural it is in Spanish, so every reasonable answer earns credit, not just one expected word.

SPEAK FIRST
- Words start as blank tiles. Tap a tile to hear it, hold it to see it.
- New words show as text until you know them by ear, then they turn into tiles.
- Say "otra vez", "más despacio", "no sé", "siguiente" or "listo" instead of tapping.
- Retell the story in 60, then 45, then 30 seconds. Your pauses are shown. There is no accent score.
- Your headline number is minutes spoken.

ONE PATH FOR EVERY LEVEL
There are no levels to pick and no placement test. The first story gets harder until you stall. Brand new? You start from words that look like English and a few small words. Every story mixes words you know with one or two new ones.

CORRECTIONS THAT EXPLAIN THEMSELVES
When something you say is off, Cliffword compares versions built from grammar rules (ser or estar, por or para, gender, tense) and tells you which rule fits. It asks you to fix it yourself before it shows the answer.

SPANISH FROM SONGS
- Play songs from your Apple Music library. The song pauses at the end of a line and waits for you to sing it back. Apple Music playback needs an Apple Music subscription.
- Share a song from Spotify to Cliffword, or add any song by name, then paste its lyrics.
- Slang notes for Puerto Rico, the Dominican Republic, Cuba and Colombia, with meaning, region and formality. Street Spanish such as 'tá and pa' is never marked as a mistake.
- Bring your own text, such as an article or a transcript, and practise it the same way.

PRIVATE BY DESIGN
- The language model runs on your iPhone. After a one-time 1.1 GB download, stories work offline.
- Speech recognition runs on your iPhone.
- No account, no ads, no analytics, no tracking. Your progress, lyrics and texts stay on your phone.

EXPLICIT CONTENT
Slang notes and lyrics include explicit words, and they are shown by default. Turn off "Explicit lyrics" in Settings to skip explicit lines.

The language model needs about 1.1 GB of storage, plus some free space while it downloads. Works best on iPhone 12 or newer.
```

**Support URL:** https://scottchanatry.com/cliffword/support/ (a page with a contact email; it can be the same site as the
privacy policy). **Marketing URL** (optional): https://scottchanatry.com/cliffword/.

**What's New:** not shown for the first version.

### App Privacy

Answer: **"No, we do not collect data from this app."** The product page then shows "Data Not
Collected".

Why it is true. Apple counts data as collected when it is sent off the device in a way that lets
the developer or the developer's third-party partners keep it longer than it takes to answer the
request in real time.

- Progress, settings, songs, lyrics, brought texts, shared items and transcripts are stored only
  in the app's SQLite database on the phone. No code in the app sends them anywhere.
- The app contains no analytics, crash reporting, advertising, attribution or remote-config SDK,
  and the developer runs no server.
- Speech is recognized on the phone. The microphone is used only while the learner holds the
  screen, and the app keeps no audio.
- The model download fetches a file. It sends no account, identifier or learning data, and the
  developer does not receive the host's request logs.
- MusicKit requests go between the phone and Apple under the user's Apple Account. The
  developer receives nothing from them.
- Spotify share-in reads what the share sheet hands over (a link and a title) and stores it on
  the phone. No Spotify API is called.
- The learner's photo (optional: "Take a selfie" or "Choose a photo" for their picture in the
  story, onboarding and Settings, Your picture) comes from the system camera or the system photo
  picker, is copied into the app's documents folder, is shown only as the learner's picture in the
  app, and is never sent anywhere. It is kept out of iCloud and device backups (the
  cliffword-native module on iOS) and out of Android Auto Backup and device transfer
  (`cliffword_backup_rules`). Apple's definition of collected is sending data off the device, so a
  photo that never leaves the phone is not collected: "Photos or Videos" is not declared, and the
  answer stays "Data Not Collected". The learner deletes it with Remove photo, or by deleting the
  app.

The opt-in network recognition switch. When a learner turns it on and the phone has no on-device
Spanish model, the operating system's speech service (Apple's on iPhone, Google's on Android)
receives the audio. The app hands the audio to the system API. It does not send it to the
developer or to a partner of the developer, and the developer cannot read it. On that basis the
answer stays "Data Not Collected", and PRIVACY.md describes the switch. To take the strict view
instead, either remove the switch (decision 3), or declare "Audio Data" for "App Functionality",
not linked to the user and not used for tracking, together with the matching Play answer.

What would make the label false (each one needs new answers before that update ships):

- adding any analytics, crash-reporting (Sentry, Crashlytics, Bugsnag and the like), advertising
  or attribution SDK;
- any server of the developer's that receives data from the app: accounts, sync, cloud backup, an
  in-app feedback form, remote config tied to a device, usage pings;
- turning network recognition on by default, or making it the only way to speak;
- fetching licensed lyrics, translations or anything else from a server using song ids, text or
  identifiers from the app;
- hosting the model mirror on a server whose access logs the developer keeps and uses;
- sending lyrics, texts or transcripts to any online model or service;
- uploading the learner's photo anywhere (a profile, sync, a share image made on a server), or
  letting it into a backup the developer can read.

Tracking: No. The app does not link data with other companies' data and has no tracking
domains. `NSPrivacyTracking` is false.

### Privacy manifest (already in `app/app.json`)

`ios.privacyManifests` writes `ios/Cliffword/PrivacyInfo.xcprivacy` at prebuild. The SDK 58
template ships no app-level manifest, so this key is the whole file. On EAS, `pod install` then
merges in the pods' own manifests (React Native's `privacy_file_aggregation_enabled`, on by
default). Expo's guide notes that Apple does not always read the manifests of static CocoaPods
dependencies, so the app-level file covers every category the binary uses.

| Category | Reasons | Used by |
|---|---|---|
| UserDefaults | `CA92.1` (the app's own defaults) | React Native core, expo-constants, expo-localization, expo-system-ui |
| UserDefaults | `1C8F.1` (the App Group's defaults) | `ExpoShareIntentModule` reads `UserDefaults(suiteName: "group.app.cliffword")`, which the share extension writes; expo-share-intent ships no manifest for the app side |
| FileTimestamp | `C617.1` (files inside the app container) | expo-sqlite's bundled SQLite (`fstat`, `stat`), the model file's modification time against its database row, `attributesOfItem` for the file size in `modules/cliffword-native`; expo-sqlite and the local module ship no manifest |
| DiskSpace | `E174.1` (check space before writing) | `modules/cliffword-native` `availableBytes()` before the 1.1 GB download, which refuses to start when space is short |
| DiskSpace | `85F4.1` (show space to the user) | the model step and the Settings model card show "{free} free on this phone · the model needs {size}", and the space error names the free space |
| SystemBootTime | `35F9.1` (elapsed time between events) | React Native's timing code and boost (their own manifests declare it too) |

Not added: `0A2A.1` and `C56D.1` (only an SDK that wraps the API may declare them; expo-file-system
declares `0A2A.1` in its own manifest), `3B52.1` (timestamps of files the user picks: the photo
picker hands over one image, and neither the app nor expo-image-picker reads its timestamps; the
picker reads its size with `fileSizeKey`, which is not a required-reason API; and the app has no document
picker), active keyboards (not used). llama.rn ships no manifest. Its iOS framework imports none
of the listed APIs (checked with `llvm-nm -u` on `rnllama.framework`), so it needs none.

The share extension gets its own manifest from the expo-share-intent plugin (UserDefaults
`CA92.1`). It writes App Group defaults, so `1C8F.1` would describe it more exactly. If an upload
email names `CliffwordShare.appex`, that file needs a plugin change, not an app.json change.

Checked by a prebuild of a copy on 2026-11-16: `ios/Cliffword/PrivacyInfo.xcprivacy` holds the
four categories above, tracking false, no domains, no collected data, and it is in the Cliffword
target's Resources phase. Checked again on 2026-11-20 after adding expo-image-picker 58.0.10 (the
learner's selfie or photo): the generated manifest is unchanged. The package ships no
PrivacyInfo.xcprivacy and its iOS sources call none of the listed APIs (no file timestamps,
UserDefaults, disk space or boot time). The prebuild's Info.plist has the plugin's
`NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` and the speech text of
`NSMicrophoneUsageDescription` unchanged. The plugin's `microphonePermission: false` is not used:
it deletes `NSMicrophoneUsageDescription` and blocks `RECORD_AUDIO`, which speech needs, so the
option is left out and the plugin keeps the app's own text. If App Store Connect emails ITMS-91053 after an upload, add the
category and reason it names to `ios.privacyManifests` and rebuild (DEVICE-CHECKLIST F1).

### Age rating

App Store Connect, App Information, Age Ratings. Values from Apple's "Age ratings values and
definitions" (read 2026-11-16). Content answers are None, Infrequent or Frequent; the others
are Yes or No.

| Section | Item | Answer | Rating it implies | Reason |
|---|---|---|---|---|
| In-app controls | Parental Controls | No | 4+ | The explicit switch is a setting anyone can change, not a parental control |
| In-app controls | Age Assurance | No | 4+ | No age check |
| Capabilities | Unrestricted Web Access | No | (Yes = 16+) | No in-app browser; links open other apps |
| Capabilities | User-Generated Content | No | 4+ | Pasted lyrics and texts are seen only by the person who pasted them; nothing is shared |
| Capabilities | Messaging and Chat | No | 4+ | |
| Capabilities | Advertising | No | 4+ | |
| Capabilities | Social Media | No | | |
| Mature themes | Profanity or Crude Humor | **Frequent** | 13+ | Explicit slang (coño, mierda, cabrón, hijueputa and others) shown by default, in slang notes and in lyrics |
| Mature themes | Horror/Fear Themes | None | 4+ | |
| Mature themes | Alcohol, Tobacco, or Drug Use or References | **Infrequent** | 13+ | Six slang words: pola (beer), guaro (liquor), jumo (drunk), jincho (drunk or high), trabado (high), bichote (drug boss). Definitions only, no depiction of use |
| Medical or wellness | Medical or Treatment Information | None | 4+ | |
| Medical or wellness | Health or Wellness Topics | No | 4+ | |
| Sexuality or nudity | Mature or Suggestive Themes | **Infrequent** | 9+ | Reggaeton slang about dancing and flirting (perreo, bellaqueo) |
| Sexuality or nudity | Sexual Content or Nudity | **Infrequent** | 13+ | About 22 slang entries define sexual words ("to have sex", body parts). Text definitions only, no images, no descriptions of acts |
| Sexuality or nudity | Graphic Sexual Content and Nudity | None | | |
| Violence | Cartoon or Fantasy, Realistic, Prolonged Graphic, Guns or Other Weapons | None | 4+ | The packs have no violence; "fajarse" (to get into a fight) is a word gloss |
| Chance-based | Gambling, Simulated Gambling, Contests, Loot Boxes | No / None | 4+ | |

**Expected rating: 13+.** Three answers reach 13+ on their own (profanity, drug references,
sexual content), so the explicit default does not move it below 13+. Turning explicit off by
default would not lower it either, because the content is still in the app.

If Apple asks for a higher rating:

- **16+** if Apple reads Mature or Suggestive Themes as Frequent (likely only if reviewers look
  at reggaeton lyrics as the app's content).
- **18+** if Apple reads Sexual Content or Nudity, or Alcohol and Drug References, as Frequent.
  The app works unchanged at 18+. The cost is reach: accounts under 18 cannot get it, and some
  regions add age checks. "Override to Higher Age Rating" in the same form sets 16+ or 18+
  directly, without changing the answers.
- Ways to keep 13+ if review disagrees: cut the most sexual entries from the shipped packs, or
  make the sexual entries part of the explicit flag (they already are) and ship explicit OFF by
  default. Count the pack entries again before answering after any pack change.

Unverified: US state laws on app-store age checks (Texas, Utah, Louisiana) and whether they
require reading the store's age signal (Apple's Declared Age Range API, Google's Play Age Signals
API), for example to turn explicit content off for minors. Check their current status before
launch.

### Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in `ios.infoPlist`, so App Store Connect does not ask
on each build. Basis, if it ever asks: the app uses only encryption built into iOS (HTTPS through
`URLSession` for the model download, Apple's own MusicKit traffic). The SHA-256 file check is a
hash, not encryption. expo-sqlite's SQLCipher build is not enabled. The app has no proprietary
or non-standard algorithms. No documentation upload and no French declaration are needed.

### App Review information

- Sign-in required: **No** (no accounts, so no demo account).
- Contact: the owner's name, phone and email (only App Review sees them).
- Notes (paste as is; about 2,900 characters of the field's 4,000):

```
Cliffword teaches Spanish by speaking. There is no account and no sign-in.

1. FIRST LAUNCH AND THE 1.1 GB MODEL (Guideline 4.2.3)
- Onboarding has four short steps. The second asks before downloading the on-device language model (Qwen3-1.7B, 1.1 GB, Apache-2.0, from Hugging Face). The size and the phone's free space are shown first, and nothing downloads until you tap Download. The app checks free space before starting.
- You can continue while it downloads, or tap "Not now". Until the model is ready, the Story tab runs on built-in starter sentences, and the Music tab works fully with pasted lyrics. Progress is shown. The download can be paused and resumed and survives the app going to the background. It can also be started later from Settings.
- The file is model weights (data), not code (Guideline 2.5.2). It is checked against a fixed size and SHA-256, runs on the device with llama.cpp, and is excluded from iCloud backup.

2. TESTING WITHOUT AN APPLE MUSIC SUBSCRIPTION
Music tab > Lyrics ("Paste them for any song"). Title: Luna de Santurce. Artist: Rayo K. (a song written for this app). Paste these lines, then tap "Save the song" and open it:

Esta noche salimos a janguear,
el corillo ya 'tá listo pa' janguear.
La luna de Santurce brilla en el mar,
y nadie se quiere ir pa' la casa.
Wepa, que suene el perreo,
mi pana trae los chavos y la guagua.
La calle 'tá brutal, puñeta, qué calor,
bailamos hasta que salga el sol.

Each line stops at a cliff. Hold anywhere and say or sing the next words. "Type instead" works if you prefer not to speak.

3. APPLE MUSIC (Guideline 4.5.2)
Apple Music is optional and asks for access only when you tap Connect. Playback starts only when the user taps Play on a song from their own library, and the song screen has play and pause controls. When a line has timing, the song pauses at the end of the line and resumes only when the user taps or says "siguiente". The app does not download, copy or share music and charges nothing. Catalog playback needs an Apple Music subscription.

4. SPEECH
The microphone is used only while you hold the screen. Recognition runs on the device. If you deny the microphone or speech recognition, "Type instead" works everywhere. Network recognition is an opt-in setting, off by default.

5. SPOTIFY
Share-in only: share a song from the Spotify app to Cliffword and it adds the song's name. The app calls no Spotify API.

6. CONTENT
Slang notes and lyrics include explicit words, shown by default; Settings > Explicit lyrics turns them off. The age rating answers reflect this.

7. PRIVACY
No accounts, analytics, ads or tracking. Progress, lyrics and texts stay on the phone.
The camera and the photo picker are used only when you tap "Take a selfie" or "Choose a photo" for your picture in the story (optional; onboarding and Settings > Your picture). The photo stays on the phone and is never uploaded.
```

### Screenshots

Apple accepts 1 to 10 screenshots per size. Upload the 6.9-inch set. The 6.5-inch set is
required only when the 6.9-inch set is missing; upload it too if you capture on a 6.5-inch
phone, otherwise Apple scales the 6.9-inch set down.

| Display | Portrait pixel sizes Apple accepts | Phones that capture it natively |
|---|---|---|
| 6.9-inch (iPhone with Dynamic Island, large) | 1320 x 2868, 1290 x 2796, 1260 x 2736 | iPhone 16 Pro Max, 15 Pro Max, 14 Pro Max, 15 Plus, 16 Plus |
| 6.5-inch (iPhone with Face ID, large) | 1284 x 2778, 1242 x 2688 | iPhone 14 Plus, 13 Pro Max, 12 Pro Max, 11 Pro Max, 11, XS Max, XR |

The set in `app/store/screenshots/` (six screenshots, the same order on both stores, made-up
content only: the "Luna de Santurce" song by "Rayo K.", the market story; never a real song,
artist or album cover). They are the app's views rendered from the fixture gallery of a web
preview export (`app/store/README.md`), at 1320 x 2868 (6.9-inch), 1284 x 2778 (6.5-inch) and
1080 x 2160 (Play). Retake them on a TestFlight build instead if the review asks for
device captures.

| # | File | Shows | Caption idea |
|---|---|---|---|
| 1 | `1-story-cliff` | A sentence stopped mid-way, blank tiles, the dashed gap, "Hold anywhere and say it" | Finish the sentence out loud |
| 2 | `2-landing` | Where the answer landed on the surprising-to-expected line, "just as natural" | Any natural answer counts |
| 3 | `3-self-repair` | The learner's sentence with unexpected words shaded, "One word surprised me" | Fix it yourself first |
| 4 | `4-music-library` | Apple Music, Spotify share-in and pasted lyrics; songs with their slang (Android: Apple Music "Not available on Android yet") | Learn from songs and slang |
| 5 | `5-lyric-cliff` | A lyric line at its cliff, "SING IT", the music waiting (Android: no player, read and sing) | Sing the next word |
| 6 | `6-profile` | Minutes spoken today, the week, words understood | Count minutes spoken |

Captions are optional. Keep each claim true of the build (Guideline 2.3.3). Use a clean status
bar if the phone allows it. If no phone of either size is at hand, capture on any recent iPhone
and place the shots on a canvas of an accepted size without stretching them.

## Google Play Console

### Store listing

| Field | Value |
|---|---|
| App name | `Cliffword: Speak Spanish` (24 of 30) |
| Short description | `Stories that stop mid-sentence. Say what comes next. Learn Spanish from songs.` (78 of 80) |
| App or game | App |
| Free or paid | Free |
| Category | Education |
| Tags | Language learning (pick the closest tags the console offers) |
| Contact email | hello@scottchanatry.com (required, shown publicly) |
| Website | https://scottchanatry.com/cliffword/support/ (optional) |
| Privacy policy | https://scottchanatry.com/cliffword/privacy/ |

**Full description** (under 4,000 characters; it says what Android does differently: no Apple
Music):

```
Cliffword teaches Spanish by getting you to talk.

A short story is read to you and stops mid-sentence, at the cliff. Hold anywhere on the screen and say what comes next. Cliffword scores your answer by how natural it is in Spanish, so every reasonable answer earns credit, not just one expected word.

SPEAK FIRST
- Words start as blank tiles. Tap a tile to hear it, hold it to see it.
- New words show as text until you know them by ear, then they turn into tiles.
- Say "otra vez", "más despacio", "no sé", "siguiente" or "listo" instead of tapping.
- Retell the story in 60, then 45, then 30 seconds. Your pauses are shown. There is no accent score.
- Your headline number is minutes spoken.

ONE PATH FOR EVERY LEVEL
There are no levels to pick and no placement test. The first story gets harder until you stall. Brand new? You start from words that look like English and a few small words. Every story mixes words you know with one or two new ones.

CORRECTIONS THAT EXPLAIN THEMSELVES
When something you say is off, Cliffword compares versions built from grammar rules (ser or estar, por or para, gender, tense) and tells you which rule fits. It asks you to fix it yourself before it shows the answer.

SPANISH FROM SONGS
- Share a song from Spotify to Cliffword, or add any song by name, then paste its lyrics. Read each line, then sing it back.
- Slang notes for Puerto Rico, the Dominican Republic, Cuba and Colombia, with meaning, region and formality. Street Spanish such as 'tá and pa' is never marked as a mistake.
- Bring your own text, such as an article or a transcript, and practise it the same way.

PRIVATE BY DESIGN
- The language model runs on your phone. After a one-time 1.1 GB download, stories work offline.
- Speech recognition runs on your phone. On Android 13 and later Cliffword can ask the system to download its offline Spanish speech model.
- No account, no ads, no analytics, no tracking. Your progress, lyrics and texts stay on your phone.

EXPLICIT CONTENT
Slang notes and lyrics include explicit words, and they are shown by default. Turn off "Explicit lyrics" in Settings to skip explicit lines.

Needs a 64-bit (arm64) phone and about 1.1 GB of storage for the language model, plus some free space while it downloads.
```

### Graphics

| Asset | Requirement | Status |
|---|---|---|
| App icon | 512 x 512 PNG | `app/store/graphics/play-icon-512.png` (32-bit, from the same mark as `icon.png`) |
| Feature graphic | 1024 x 500, JPEG or 24-bit PNG without alpha | `app/store/graphics/play-feature-graphic.png` |
| Phone screenshots | 2 to 8; PNG or JPEG; 9:16 portrait recommended, at least 1080 x 1920 to be eligible for promotion; the long side at most twice the short side | `app/store/screenshots/android-phone/` (1080 x 2160, ratio 2.0). iPhone shots of 1320 x 2868 are too tall for Play (ratio 2.17). |

### App content declarations

| Declaration | Answer | Reason |
|---|---|---|
| Privacy policy | https://scottchanatry.com/cliffword/privacy/ | |
| App access | All functionality is available without special access | No login. Apple Music is iOS only and not part of the Android app. |
| Ads | No, my app does not contain ads | |
| Advertising ID | No | `com.google.android.gms.permission.AD_ID` is in `blockedPermissions` |
| Content rating | IARC questionnaire, below | |
| Target audience | 16 to 17, and 18 and over | Matches the expected IARC rating. Nothing under 13, so the Families policy does not apply. "Could the store listing unintentionally appeal to children?" No. |
| News app | No | |
| Data safety | below | |
| Government app | No | |
| Financial features | None | |
| Health | None | |
| Foreground service permissions | not asked | No foreground-service permission. The merged manifest has `INTERNET`, `RECORD_AUDIO`, `CAMERA` (the selfie for the learner's picture), `VIBRATE`, `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE` (expo-network, the Wi-Fi check), and androidx.core's signature-only `app.cliffword.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; confirm with `aapt2 dump permissions` on the EAS build before filling this in |
| Account deletion | not asked | No accounts |

### Content rating (IARC)

Category: **Reference, News, or Educational**. The exact questions depend on the category. These
are the answers by topic.

| Topic | Answer |
|---|---|
| Violence, blood, fear or horror | No |
| Sexuality | Yes: sexual references in text (definitions of sexual slang; lyrics the user pastes). No nudity, no sexual images, no depiction of sexual acts |
| Language | Yes: strong profanity and sexual expletives in text (Spanish slang), shown by default |
| Controlled substances | Yes: text references to alcohol and drugs (slang for beer, liquor, being drunk or high, a drug boss). No depiction of use, no encouragement, no sale |
| Crude humor | No |
| Discrimination or hate speech | No (the packs contain no slurs) |
| Gambling, simulated gambling | No |
| Users interact or exchange content | No |
| Shares the user's location | No |
| Digital purchases | No |
| Unrestricted internet access | No |
| Promotes age-restricted products | No |

Expected result: around 16+ (PEGI 16, USK 16) and ESRB Teen or Mature 17+. IARC issues the
ratings as soon as the questionnaire is saved. If they come out higher, set the target audience
to 18 and over only.

### Data safety

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Result | "No data collected" and "No data shared" |

The security-practices and data-deletion questions are skipped when no data is collected. The
reasons and the conditions that would change the answer are the same as for Apple (see "App
Privacy"). Android specifics:

- Speech: `ExpoSpeechIn` runs with on-device recognition required by default. Android 13 and
  later can download the offline Spanish model through the system. Android 12 and older cannot
  force on-device recognition, so there the learner types unless they turn on network
  recognition. With network recognition on, Google's speech service receives the audio; the app
  does not transmit it. The strict reading would declare Audio (voice or sound recordings),
  collected, optional, processed ephemerally, for App functionality.
- Backups: the model folder and the learner's photo folder (`files/avatar/`) are excluded from
  Auto Backup and device transfer (`cliffword_backup_rules`). The learner's database is included
  when the user has device backup on. That backup goes to the user's own Google account and is
  made by Android, not by the app.
- Photos: the learner's optional selfie or photo is processed only on the device (Play's data
  safety form covers data sent off the device), so "Photos" is not declared. On Android 10 and
  later the camera intent needs only `CAMERA` and the system photo picker needs nothing;
  `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO` and the storage permissions stay in
  `blockedPermissions`. On Android 7 to 9 expo-image-picker's camera would also need
  `WRITE_EXTERNAL_STORAGE`, so the app offers only "Choose a photo" there. The camera is
  optional: `android.hardware.camera` and `android.hardware.camera.autofocus` are declared
  `android:required="false"` (cliffword-native plugin), so Play does not hide the app from
  devices without an autofocus rear camera; check the device catalog after the first upload.

### AI-generated content

Google Play's AI-Generated Content policy asks apps that generate content with AI to include an
in-app way to report offensive output to the developer without leaving the app. Its named
examples are chatbots where chatting is the main feature and image or video generation.
Cliffword's model writes short story sentences from a fixed list of words the learner knows and
scores answers. It takes no free prompts and has no chat. That looks outside the named examples,
but the policy does not say so outright. A "Report this sentence" action (decision 6) settles it.
It could open the user's mail app with the sentence filled in, which keeps the privacy answers
unchanged, because the user sends the message from their own mail app.

### Account rules that shape the release

- **Closed test first.** A personal developer account created after 13 November 2023 must run a
  closed test with at least 12 testers who have been opted in continuously for the 14 days before
  you apply for production access. Testers who leave before 14 days do not count. Recruit 15 or
  more for a margin. After the test, apply under Dashboard, "Apply for production". Google
  reviews the application (usually up to 7 days).
- **The first AAB is uploaded by hand.** The Play Developer API, which `eas submit` uses, cannot
  create an app's first release. Upload the first production-profile `.aab` in the Play Console
  yourself. After that, `eas submit -p android` works.
- **Play App Signing.** Accept it with the first upload. Google keeps the app signing key, and the
  keystore EAS generated becomes the upload key.
- **Devices.** The AAB has arm64-v8a code only, so Play offers it only to 64-bit ARM phones.
  Decision 5 covers a RAM floor in the device catalog.

## Before pressing Submit

- [ ] Privacy policy hosted, and its URL in App Store Connect, the Play Console and the app
- [ ] Support URL live with a contact email
- [ ] Screenshots uploaded (6.9-inch and 6.5-inch from `app/store/screenshots/`), Play icon,
      feature graphic, Play screenshots
- [ ] Age rating, App Privacy, export compliance, content rights answered in App Store Connect
- [ ] IARC, Data safety, target audience, ads and app access done in the Play Console
- [ ] `docs/DEVICE-CHECKLIST.md` run on the TestFlight build, with no open blocker
- [ ] No ITMS-91053 email for the uploaded build
- [ ] MusicKit still enabled on `app.cliffword` after the last build (DEVICE-CHECKLIST M8)
- [ ] Decisions 1 and 4 made (both are hard to change after 1.0 is live)
