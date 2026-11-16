# Cliffword: release steps

The steps that take Cliffword from this repo to the App Store and Google Play, in the order to
run them. What to type into the store forms is in `docs/STORE.md`; the checks to run on a phone
are in `docs/DEVICE-CHECKLIST.md`.

Who runs each step:

- **Owner**: needs your identity, your Apple or Google sign-in (with two-factor codes), a
  payment, a portal toggle or a phone in your hand. Only you can do these.
- **Assistant**: the cloud session can run it once the credentials it needs are stored on EAS
  (see "What the assistant can run").
- **Either**: plain commands with no secrets; whoever is at a terminal.

Fixed identifiers (permanent once used; decided in `app/app.json`):

| What | Value |
|---|---|
| EAS project | `@greypebs/cliffword` (projectId `13fc6e30-3463-4c2f-9efe-cebdd3356ed7`) |
| iOS bundle id, Android package | `app.cliffword` |
| Share extension bundle id | `app.cliffword.share-extension` |
| App Group | `group.app.cliffword` |
| Version | `1.0.0` (build numbers are kept on EAS: `appVersionSource: "remote"`, `autoIncrement` in the production profile) |

EAS builds from git, so every build uses what is committed. Commit and push before building.

## 0. Before anything permanent (Owner)

1. Read the decisions table in `docs/STORE.md`. Decide 1 (oldest iPhone) and 4 (EU trader
   status) before 1.0: they are hard to change afterwards.
2. **Trademark search for "Cliffword".** On 2026-11-15 no app-store collisions were found, and
   cliffword.com and cliffword.app were unregistered; trademarks were not checked. Search the
   USPTO trademark search (tmsearch.uspto.gov), EUIPO's TMview (tmdn.org/tmview) and WIPO's Global
   Brand Database for "Cliffword" and close spellings, especially in classes 9 (software) and 41
   (education). Search both stores again. If you want the domain, register it now (`.app` domains
   need HTTPS, which GitHub Pages provides).

## Apple

### 1. Apple Developer Program enrollment (Owner)

1. Use an Apple Account with two-factor authentication on.
2. Enroll as an individual at developer.apple.com/programs/enroll, or in the Apple Developer app
   on an iPhone (often faster, with ID verification in the app). The fee is yearly.
3. As an individual, your legal name is shown as the seller on the App Store.
4. Wait for the confirmation email (often a day or two; sometimes longer if Apple asks for
   documents). Then accept the agreements under Account, Agreements. A free app needs only the
   Apple Developer Program License Agreement, not the Paid Apps agreement.

### 2. Expo login and the repo on your computer (Owner)

On a Mac, Windows or Linux computer with Node.js 22 (LTS) and git:

```bash
npx eas-cli@latest login            # sign in as greypebs
npx eas-cli@latest whoami           # prints greypebs
git clone https://github.com/scottchanatry/cliffword.git
cd cliffword/app
npm ci                              # EAS reads app.json, whose plugins live in node_modules
```

`npm ci` applies the two patches and downloads llama.rn's native files; give it a few minutes.

### 3. iOS signing credentials (Owner, interactive)

```bash
npx eas-cli@latest credentials -p ios
```

1. Choose the `production` build profile.
2. Choose "Build Credentials", then the option to set up all the credentials needed to build the
   project (the menu wording changes between eas-cli versions).
3. Sign in with your Apple Account when asked, enter the two-factor code, and pick your team.
4. EAS then:
   - registers the App IDs `app.cliffword` and `app.cliffword.share-extension` (the extension
     target comes from the expo-share-intent plugin);
   - turns on the capabilities found in the entitlements: App Groups on both App IDs (it
     registers `group.app.cliffword`), Increased Memory Limit, and Extended Virtual Addressing;
   - creates an Apple Distribution certificate;
   - creates an App Store provisioning profile for each of the two targets.
5. EAS stores the certificate and profiles on its servers. Nothing goes into the repo.

Check in the Apple Developer portal (developer.apple.com/account, Certificates, Identifiers &
Profiles):

- Identifiers lists `app.cliffword` and `app.cliffword.share-extension`; both have App Groups
  with `group.app.cliffword` checked.
- Identifiers, App Groups lists `group.app.cliffword`.
- Profiles lists two App Store profiles.

If App Groups or the group is missing, the first interactive `eas build` in step 7 syncs them (say
yes when it asks to log in to your Apple account).

### 4. MusicKit App Service (Owner, in the portal)

EAS capability sync does not manage MusicKit, so turn it on by hand:

1. Certificates, Identifiers & Profiles, Identifiers, `app.cliffword`.
2. Open the **App Services** tab (next to Capabilities), check **MusicKit**, and save.
3. Nothing else changes: MusicKit is not an entitlement, so the profiles stay valid. Apple creates
   the MusicKit developer token for the app automatically.

Check again after each build that changes capabilities (DEVICE-CHECKLIST M8).

### 5. The app record in App Store Connect (Owner)

1. appstoreconnect.apple.com, Apps, "+", New App.
2. Platform iOS; Name `Cliffword: Speak Spanish` (names are unique across the store; this reserves
   it); Primary Language English (U.S.); Bundle ID `app.cliffword`; SKU `cliffword-ios`; User
   Access Full Access.
3. Open App Information and note the **Apple ID** number under General Information. EAS calls it
   `ascAppId`. It is not a secret. Give it to the assistant, who adds it to
   `submit.production.ios.ascAppId` in `app/eas.json`, so later submissions can run without
   prompts.

### 6. App Store Connect API key for EAS Submit (Owner)

1. App Store Connect, Users and Access, Integrations, App Store Connect API, Team Keys. The first
   time, request access (the account holder accepts the terms).
2. Generate API Key: name `EAS Submit`, access **App Manager**. Download the `.p8` file (Apple
   lets you download it only once) and note the **Key ID** and the **Issuer ID**.
3. Store it on EAS:

   ```bash
   npx eas-cli@latest credentials -p ios
   ```

   Choose `production`, then "App Store Connect: Manage your API Key", then set up the project to
   use an API key for EAS Submit, and give the `.p8` path, the Key ID and the Issuer ID.
4. Keep the `.p8` somewhere safe offline. Never commit it or paste it into a chat.

### 7. Build and submit (Owner the first time; then Assistant)

```bash
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --latest
```

- Run the first build on your computer, interactively, and answer yes to logging in to Apple. EAS
  checks the certificate, profiles and capabilities. The build runs on EAS's servers. The first
  build is the first time the Swift modules, the share extension and the llama.rn patch are
  compiled for iOS (README, "What an EAS build must confirm"), so read its log if it fails.
- `submit` uploads the build to App Store Connect. Processing takes from a few minutes to about an
  hour, and Apple emails you when it is done.
- If Apple emails an **ITMS-91053** notice ("Missing API declaration"), add the category and reason
  it names to `ios.privacyManifests` in `app/app.json`, then build and submit again
  (DEVICE-CHECKLIST F1).

`build` and `submit` can be one command: `npx eas-cli@latest build -p ios --profile production
--auto-submit`.

### 8. TestFlight on your iPhone (Owner)

1. App Store Connect, the app, TestFlight. The build shows "Ready to Submit" or "Testing" once
   processed. `ITSAppUsesNonExemptEncryption` is false, so there is no export compliance question.
2. Internal Testing: create a group (for example "Owner"), add yourself (the account holder is
   already a user), and add the build to the group. Internal builds need no Beta App Review.
3. On the iPhone, install **TestFlight** from the App Store, sign in with the same Apple Account,
   open the invitation (email or the TestFlight app) and tap Install.
4. Run `docs/DEVICE-CHECKLIST.md`. Fix, rebuild, resubmit, retest.
5. Optional, for other testers: External Testing groups need Beta App Review for the first build;
   fill in the Test Information page (what to test, a feedback email, the review notes from
   STORE.md).

A production build installs only through TestFlight or the App Store. For a build you can install
straight from a link, register the iPhone with `npx eas-cli@latest device:create` and build the
`preview` or `development` profile (ad hoc).

### 9. Submit for review (Owner)

In App Store Connect, fill in everything from `docs/STORE.md`: App Information (name, subtitle,
categories, content rights, age rating, privacy policy URL), Pricing and Availability (free;
countries; EU trader status), App Privacy, and the 1.0.0 version page (screenshots, promotional
text, description, keywords, support and marketing URLs, copyright, App Review information and
notes, manual or automatic release). Select the tested build, Add for Review, Submit.

## Google Play

### 10. Developer account (Owner)

1. play.google.com/console/signup, **personal** account. One-time registration fee.
2. Verify your identity (government ID) and, as asked for personal accounts, your phone through
   the Play Console app. Give a contact email; it is shown on the store listing.
3. A personal account created after 13 November 2023 must run the closed test in step 15 before it
   can publish to production.

### 11. Create the app (Owner)

Play Console, Create app: name `Cliffword: Speak Spanish`, default language English (United
States), App, Free; accept the declarations. Then work through the Dashboard's "Set up your app"
list with the answers in `docs/STORE.md` (privacy policy, app access, ads, content rating, target
audience, news, data safety, government, financial features, health, store listing).

### 12. First Android build and the first AAB, by hand (Owner)

```bash
npx eas-cli@latest build -p android --profile production
```

1. Run it on your computer the first time. EAS asks to generate an Android keystore; say yes. It
   stays on EAS. (EAS already holds versionCode 2 for this project, so the next build is 3.)
2. When the build finishes, download the `.aab` from the build page on expo.dev (or the link the
   command prints).
3. Play Console, Testing, **Internal testing**, Create new release. Accept **Play App Signing**
   (Google keeps the signing key; the EAS keystore becomes the upload key). Upload the `.aab`,
   add release notes, Save, Review release, Start rollout to Internal testing.
4. Add yourself as an internal tester, open the opt-in link on an Android phone, install, and run
   the Android rows of `docs/DEVICE-CHECKLIST.md`.

The upload has to be manual this one time: Google's API, which `eas submit` uses, cannot create an
app's first release.

### 13. Service account for EAS Submit (Owner)

1. Google Cloud Console: create a project (or reuse one), enable the **Google Play Android
   Developer API**, then IAM & Admin, Service Accounts, create one (no roles needed), and under
   Keys add a **JSON** key. Download it. Expo's guide "Creating a Google Service Account Key for
   Play Store submissions" shows each screen.
2. Play Console, Users and permissions, Invite new users: the service account's email. Under App
   permissions add Cliffword with permission to release to testing tracks (and to production when
   you get there), and invite.
3. Store it on EAS:

   ```bash
   npx eas-cli@latest credentials -p android
   ```

   Choose `production`, then Google Service Account, then upload the key for submissions.
4. Keep the JSON file safe offline. Never commit it or paste it into a chat.

### 14. Later Android builds (Either; Assistant once set up)

```bash
npx eas-cli@latest build -p android --profile production
npx eas-cli@latest submit -p android --latest
```

`submit` sends to the internal track by default. To send straight to the closed test, the
assistant sets `submit.production.android.track` to `alpha` in `app/eas.json`. You can also
promote a release from internal to closed testing in the Play Console.

### 15. Closed test: 12 testers, 14 days (Owner)

1. Play Console, Testing, Closed testing, the default track (Alpha), Testers: create an email list
   with at least 12 Google accounts (15 to 20 gives a margin). Choose countries.
2. Create a release on the track (promote the internal one, or submit with `track: alpha`) and send
   it for review. Closed-testing releases are reviewed by Google.
3. Send testers the opt-in link. Each tester must accept on the web and install from Play with an
   arm64 Android phone. They must stay opted in for **14 days in a row**; anyone who leaves early
   does not count.
4. Collect feedback during the test (the production application asks about it).
5. After 14 days, Dashboard, **Apply for production**, and answer the questions. Google usually
   replies within about a week.
6. Then create the production release (Production, Create new release, or `submit` with
   `track: production`) and roll it out.

## Privacy policy and URLs (Owner)

The pages live on your site, scottchanatry.com. Ready-to-upload HTML is in `docs/site/cliffword/`
(made from `docs/PRIVACY.md`; regenerate with `python3 docs/site/build.py` after editing the policy).

| Upload this file | To this URL |
|---|---|
| `docs/site/cliffword/index.html` | https://scottchanatry.com/cliffword/ (marketing) |
| `docs/site/cliffword/privacy/index.html` | https://scottchanatry.com/cliffword/privacy/ |
| `docs/site/cliffword/support/index.html` | https://scottchanatry.com/cliffword/support/ |

1. Done on 2026-11-16: the pages are in the `scottchanatry/scottchanatry.com` repo under
   `cliffword/` and live (Porkbun publishes every push to `main`). To update them, rebuild and
   copy `docs/site/cliffword/` into that repo's `cliffword/` folder and push.
2. Enter the URLs and hello@scottchanatry.com in App Store Connect (App Information: Privacy
   Policy URL; version page: Support URL, Marketing URL) and in the Play Console (App content:
   Privacy policy; Store settings: website and email).
3. The app links to the privacy URL from Settings, About (Guideline 5.1.1(i)).
4. Whenever the policy changes, update `docs/PRIVACY.md`, its effective date, rebuild the pages and
   upload them again.

## Mirror the model file (Owner creates the storage; Assistant can do the rest)

Today the app downloads
`https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf`
(1,107,409,472 bytes, SHA-256 `b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897`).
Because the URL is pinned to a commit, the bytes behind it cannot change, and the app rejects any
file whose size or hash differs. It still depends on a repo and a host you do not control: if the
repo owner deletes the file or the repo, or Hugging Face changes its URLs, rate limits or access
rules, every new install fails at the first download. A copy on storage you control protects
against that.

1. Pick a host that serves large files with byte ranges (the Android download resumes with a
   `Range` request):
   - a **GitHub Release** asset (files up to 2 GiB; the 1.1 GB file fits);
   - a **Cloudflare R2** bucket with a public domain (no fees for downloads);
   - an S3 bucket (download fees per GB add up at 1.1 GB per install).
2. Download the file from the pinned URL and check it: `sha256sum Qwen3-1.7B-Q4_K_M.gguf` must print
   the hash above.
3. Upload it, together with the Qwen3 Apache-2.0 `LICENSE` (Apache-2.0 asks redistributors to pass
   the license on).
4. Check the copy: `curl -sI <mirror-url>` shows `Content-Length: 1107409472` and
   `Accept-Ranges: bytes`, and `curl -s -r 0-99 <mirror-url> | wc -c` prints 100.
5. The app change (the assistant's): put the mirror URL in `src/adapters/model/descriptor.ts`,
   keep Hugging Face as a fallback if the download code supports one, keep the size and hash
   checks, and ship it in a build.
6. Keep server access logs off, or do not use them to identify anyone, so PRIVACY.md and the
   "Data Not Collected" labels stay true.

## What the assistant can run, and what it needs

| Task | Needs |
|---|---|
| `eas build -p ios --profile production --non-interactive` | An Expo access token in the cloud environment (expo.dev, Account settings, Access tokens; give it to the environment as a secret, never in chat), and iOS credentials already on EAS (steps 3 and 7). A change of capabilities needs an interactive run on your computer again. |
| `eas submit -p ios --latest --non-interactive` | The API key on EAS (step 6) and `ascAppId` in `eas.json` (step 5) |
| `eas build -p android --profile production --non-interactive` | The keystore on EAS (step 12) |
| `eas submit -p android --latest --non-interactive` | The service account key on EAS (step 13), after the manual first upload |
| `eas build:list`, reading build logs, fixing what fails, committing | The Expo token |
| `eas.json` edits (`ascAppId`, Android `track`), store text, the privacy page files, the in-app privacy link, the model URL change | Nothing beyond the repo |
| Uploading the model mirror | Write access to the chosen storage, given as an environment secret |

Only the owner can: enroll in either program and pay; sign in to Apple or Google with two-factor
codes; turn on MusicKit; create the store records; fill in and submit the store forms; upload the
first AAB; install TestFlight builds and run the device checklist; recruit closed testers; decide
the open questions in STORE.md; do the trademark search.

## Release order at a glance

1. Decisions, trademark search, domain (Owner)
2. Apple enrollment (Owner); Play account (Owner), in parallel because both take days
3. `eas login`, `npm ci` (Owner)
4. `eas credentials -p ios` (Owner)
5. MusicKit App Service (Owner)
6. App Store Connect record and API key (Owner); `ascAppId` into `eas.json` (Assistant)
7. iOS build and submit (Owner first, then Assistant)
8. TestFlight install and device checklist (Owner)
9. Android build, first AAB by hand, internal test (Owner); service account (Owner)
10. Closed test, 14 days (Owner), while iOS goes through review
11. Privacy policy hosted, URLs filled, in-app link added (Owner and Assistant)
12. Model mirror (Owner and Assistant)
13. A final build of both platforms with 11 and 12 in it, checked on the phones (Either, then
    Owner)
14. App Store review; Play production application, then production release (Owner)
