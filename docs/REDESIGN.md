# The experiences redesign

What changed in the Story flow after build 7, why, what the on-device model does now, and what
is switched off for later. This redesign overrides `docs/BRIEF.md` where the two differ. The story
format, and how to port a series to another language pair, is in `docs/STORY-FORMAT.md`.

## Why

The owner tested build 7 on an iPhone. The feedback, in his words:

- "Not close. Not clear how to even use. The stories don't make sense." The canned mode
  played unrelated placement-test sentences as if they were a story.
- "How is the user supposed to guess the story?" A beginner cannot predict a missing word in a
  sentence they have never heard.
- "I downloaded the language model and the experience seemed unchanged." Beginners only tapped
  options, and tapping never used the model.
- On content: "We need more interesting stories ... relevant to beginners", "all stories should
  be very funny and original", and the learner should first scroll through experiences and
  choose one.

## What changed

### Stories are authored "experiences"

- The Story tab plays authored comedy series instead of generated sentences. The full design
  is six series of 8 episodes each, played in order. An episode is one story of 10 to 16
  lines, mostly dialogue, with one gap ("cliff") per line and one to three questions that
  characters ask the learner.
- **This build has one series written: Living in San Juan** (8 beginner episodes: a nosy
  neighbor who already knows everything, her rooster Pancho who crows at 4 a.m. and steals
  bread and sandals, the corner store, the bakery, a clothes shop, a traffic jam, the beach,
  mofongo, the pharmacy and a surprise 80th birthday party). Episodes 1-4 use level-0
  vocabulary and episodes 5-8 level 1.
- The picker shows all six experiences: Living in San Juan, Mystery in Cartagena, Dating in
  Buenos Aires, Making friends in Mexico City, Food lover in Lima and Travel vlogger in Costa
  Rica. The five without episodes are "Coming soon" cards that cannot be started. Each
  experience keeps its own progress, and the learner can switch at any time.
- The data lives in `engine/src/pair/en-es/stories/` (`tracks.ts` for the six experiences,
  `living.ts` for the San Juan episodes). The en-es pair pack carries them, and the app plays
  them as they are; there is no app-side fixture.

### Written to be ported to other language pairs

The owner asked for stories that can easily be changed for other language pairs later. So
every story carries a language-neutral layer next to the Spanish:

- **Episode:** `beats`, the plot in 4 to 8 plain-English beats, and `functions`, the syllabus
  ids it teaches.
- **Line and question:** a stable `id` (`e1.l03`), an `intent` saying what the line does in
  plain English ("Your neighbor, wide awake at four in the morning, cheerfully says hello and
  good morning"), its syllabus `function`, and for each gap a `concept` saying what the gap
  stands for ("the time", "a food").
- **Series:** a cast with English roles and quirks, plus a local name kept separate, and a
  `setting` that names the kind of place rather than the city.
- **Shared:** a functional syllabus (`engine/src/content/syllabus.ts`) that every pair uses.

To port a series, keep the structure, beats, intents, concepts and cast. Then rewrite only the
target-language lines, the translations and the local color (names, foods, places). For
example, Living in San Juan could become a Japanese series for Chinese speakers in an old
neighborhood of a seaside city. The engine and the app read every title, name and line from
the pack, so a new pair needs no code changes.

Lines that agree with the learner are written once with variants: `{you:cansado|cansada}`
follows how the learner asked to be addressed, and `{partner:él|ella}` and `{partner.name}`
follow a series choice (Dating's "Who do you match with?"). The engine resolves them before
anything is shown, spoken or scored.

### How a gap is asked depends on the learner's level

| Level | Mode | What the learner does |
|---|---|---|
| 0-1 | recall | The line plays and shows complete, then again with the word hidden. The learner taps one of three options, or says or types the word. |
| 2-3 | hint | The English shows with the missing word in bold. The learner says or types the Spanish. Options come after one miss or "no sé". |
| 4-5 | predict | The learner says what comes next, and any natural answer counts. "No sé" brings options, then the answer. |

After every answer, the feedback shows the learner's answer, the story's word, up to three
other natural answers and the line's English.

### First launch, and the level after that

There is no placement test. The learner:

1. Picks an experience from scrollable cards.
2. Answers "How much Spanish do you know?" (Brand new = 0, A little = 2, Comfortable = 4).
3. Answers "How should people address you?" (as a man, as a woman).
4. Makes the experience's own choice, if it has one (none for San Juan).
5. Allows the microphone, or chooses to type.

After each episode, the level goes up one when at least 80% of the gaps were answered
without options or "no sé", and down one under 50%; otherwise it stays (always within 0-5).
The end-of-episode screen shows how many answers were right and how many were given without
the options. A learner who tapped every word right is told to say or type the words to move
up a level.

## What the on-device model does now

The model is Qwen3-1.7B, on the phone. It no longer writes the story.

- **It scores said and typed answers by naturalness** in hint and predict mode, and for words
  said in recall mode. Any natural answer counts, not only the story's word.
- **It judges the learner's replies to characters' questions.** Natural replies get "Nice
  answer!". Otherwise the learner is prompted to fix their own sentence (self-repair), and then
  gets the correction and why. The judge reads the reply right after the character's question
  and a short cue for who answers ("Él responde:" or "Ella responde:", from the learner's
  address). Without them, it "corrected" a woman's "Estoy cansada, gracias." to "cansado",
  and a man's "cansado" to "cansada".
- **It suggests other natural answers** for the feedback. Only words of the same kind as the
  story's word are shown (a noun for a noun, an adjective for an adjective), because the
  model's next-word search sees only the words before the gap and otherwise proposes articles
  and prepositions.
- **The screen says when the model checked an answer:** "Checked by the language model on your
  phone", or "Checked by matching. The language model is still downloading."
- The model downloads by itself on Wi-Fi.
- Model generation of story sentences is off by default. The code stays in the engine behind
  `options.source: 'generated'`.

## Hidden or removed for later

| What | State in this build | Where |
|---|---|---|
| Music tab, brought text | Hidden (`MUSIC_ENABLED = false`); code kept | `app/src/config/features.ts` |
| Spotify share-in | Removed: the expo-share-intent plugin and its iOS share extension are out of `app.json`; the package is excluded from native linking | `app/app.json`, `app/package.json` |
| Apple Music | Not requested: no usage string; `cliffword-music` excluded from native linking | `app/app.json`, `app/package.json` |
| Retell, register tasks, lyrics | Still in the engine, off in the Story flow | `options.library.retell`, `startRegisterTask` |
| Generated stories, starter, placement | Still in the engine, behind an option | `options.source: 'generated'` |
| Intermediate and advanced tiers | Not written; learners at levels 2-5 get the beginner episode (nearest tier) | `storyForEpisode` |
| The other five series | Cast, setting and tagline written; no episodes | `engine/src/pair/en-es/stories/tracks.ts` |
| Experience choices (Dating's partner) | The mechanism works and is tested, but no written series uses it yet | onboarding `choices` step |

## Review pass

An integration review read all eight San Juan episodes as a comedy editor and as a Spanish
teacher, then played them through the engine and the web build.

**Story fixes in the data:**

- Episode 2: the baker asked "¿Cuánto es?" himself. He now says "Son dos dólares, please".
- Episode 2: the rooster-for-chicken mix-up is now set up. A new line, "Tú quieres pollo, pero
  dices gallo.", comes right after the learner orders. Before, the learner said "pollo" and the
  grocer reacted to "gallo". Episode 7 now repeats the line as a callback.
- Episode 3: "Tú: talla mediana. Ella: talla grande." became "Tú quieres mediana. Migdalia
  trae grande.". It was not clear who "Ella" was.
- Episode 6: "Yo miro las cosas" became the natural "Yo cuido las cosas".
- Episode 7: the pharmacist said the party was "mañana", on a Tuesday, but the party is on
  Saturday (episodes 2 and 3). It is now "El sábado".
- Two example answers that the real model flagged although they are correct Spanish were
  replaced. Episode 3's "No, es muy pequeña..." got an "está" hint, and is now "No, no me
  gusta. ¿Tienes talla mediana?". Episode 7's "Sí, está muy rico..." got an "es muy rico"
  hint, and is now "Sí, me gusta mucho. Pero estoy llena." (or "lleno").
- Two English translations were tightened.

**Engine and app fixes:**

- Feedback alternatives are filtered by word class (`alternativeFits`). The real model had
  offered "tu, el, mi" for "Pancho tiene ___." and "la, a, en" in the web preview.
- A turn reply is judged after the character's question and a cue for who answers
  (`LanguagePack.replyCue`, set by the Spanish pack).
- A natural reply says "Nice answer!" on the repair screen. Before, only "You could say: …"
  appeared, which read as a correction.
- The end-of-episode screen counts right answers (taps included) apart from answers without
  the options. In the walk, a brand-new learner got all 15 right (8 tapped, 7 typed) and read
  "You got 7 of 15 on your own. That one was tricky." It now says "You got 15 of 15 right.",
  "7 of them on your own", and how to move up a level.
- The gap keeps the punctuation after it ("Son las ___. ¡Quiquiriquí!"). The period used to
  disappear.
- Expo packages were moved to the SDK's current patch versions, so that `expo-doctor` passes.

**Checks:**

- `engine/src/pair/en-es/stories/living.play.test.ts` plays every episode through
  `StorySession`. It runs canned and with the mock model, as a man and as a woman, in all
  three modes, and finds no stall and no variant braces.
- A Playwright walk of the web build at 390x844 covered onboarding, all of episode 1, the
  turns, the end of the episode and the episode list.
- The real model (Qwen3-1.7B on this machine's CPU) played all eight episodes as a man and as
  a woman. Every gap was answered with the story's word and every question with its example
  answer. All 123 gaps got full credit in recall, hint and predict, and all 22 replies were
  judged natural for each address. (The man's run used the earlier episode 7 example; the new
  one was judged natural on its own.)

## To confirm on a phone

These need a new EAS build:

- `expo-network` is a new native module.
- expo-share-intent and `cliffword-music` are excluded from native linking.
- The Expo patch upgrades.

Speech also needs a real phone: the gapped line's timing and the microphone's auto-stop
thresholds. On the web preview there are no voices, and the mock model's alternatives are
nonsense. Nando's English words ("Hi! Hello!") are read by the Spanish voice.
