# Story format: authored series ("experiences")

The Story tab plays **authored series**: six comedy series ("experiences") of 8 episodes each, played in order. Each episode is one short story of 10 to 16 lines, mostly dialogue, with one cliff (a gap the learner fills) per line and one to three questions that characters ask the learner.

Every story carries two layers:

- the **target layer**: the lines in the language being learned, their translations, the cliff words, local names, food and places. This is what a pair rewrites.
- the **language-neutral layer**: the plot beats, what each line does (`intent`), what each gap stands for (`concept`), the syllabus functions taught, the cast's roles and quirks, the kind of place. This stays the same when the series is ported to another language pair.

The contract is TypeScript, in `engine/src/pair/types.ts`. The engine code that reads it is language-neutral: `engine/src/content/` (syllabus, variants, episode selection, validation) and `engine/src/session/` (`StorySession` plays it).

## Files

```
engine/src/content/syllabus.ts         shared functional syllabus (all pairs)
engine/src/pair/<pair>/stories/
  tracks.ts                            the six experiences: <PAIR>_TRACKS
  <series>.ts                          the episodes of one series
  index.ts                             exports <PAIR>_TRACKS and <PAIR>_LIBRARY
engine/src/pair/<pair>/index.ts        create<Pair>PairPack puts them in PairPack.tracks / .library
```

For English speakers learning Spanish, `<pair>` is `en-es` and the exports are `EN_ES_TRACKS` and `EN_ES_LIBRARY`. A track listed in `tracks` with no stories in `library` shows on the picker as **Coming soon** and cannot be started.

## The series: `LibraryTrack`

| Field | Layer | What it is |
|---|---|---|
| `id` | neutral | Stable id: `'<pair>.track.<name>'`, e.g. `'en-es.track.dating'`. |
| `title` | native | Card title in the learner's language: `'Dating in Buenos Aires'`. |
| `tagline` | native | One funny line for the card. |
| `city`, `country` | target | Where this pair's rendering is set. |
| `dialect` | target | `'mx' \| 'ar' \| 'pe' \| 'cr' \| 'pr' \| 'co'` (the Spanish variety; another target language uses its own codes when the type grows). |
| `setting` | neutral | One English line on the **kind** of place: `'A Caribbean capital with an old walled town, beaches and a busy food scene.'` Another pair picks its own city from it. |
| `cast` | mixed | Recurring characters: `{ id, role, quirk, name }`. `id`, `role` and `quirk` are neutral (`'landlady'`, `'the nosy landlady next door'`, `'knows everything before it happens'`); `name` is this pair's local name (`'Doña Mari'`). |
| `choices` | mixed | Optional questions asked before episode 1 (see below). |

### Track choices: `LibraryChoice`

```ts
{ key: 'partner', prompt: 'Who do you match with?', options: [
    { id: 'mateo', label: 'Mateo', gender: 'm' },
    { id: 'valentina', label: 'Valentina', gender: 'f' } ] }
```

The stories of the track then write `{partner:él|ella}` (agrees with the chosen option's gender) and `{partner.name}` (its label). A cast member can be the choice: `{ id: 'partner', role: 'your date', quirk: '...', name: '{partner.name}' }`. Until the learner chooses, the first option is used.

## The episode: `LibraryStory`

| Field | Layer | What it is |
|---|---|---|
| `id` | neutral | Stable id, unique in the library: `'<pair>.<series>.e<episode>'`, e.g. `'en-es.living.e1'`. |
| `track` | neutral | The `LibraryTrack.id`. |
| `episode` | neutral | 1-8. Episodes play in this order. |
| `tier` | neutral | `'beginner' \| 'intermediate' \| 'advanced'`: the same episode is written in up to three versions with the same plot (the engine picks by learner level; see below). |
| `level` | target | Vocabulary level of the wording, 0 (brand new: cognates and taught words) to 5. |
| `title` | target | Title in the target language. |
| `titleNative` | native | Title in the learner's language. |
| `characters` | target | Names in the story (they count as names, not vocabulary). |
| `beats` | neutral | The plot in 4-8 plain-English beats, independent of wording. |
| `functions` | neutral | Syllabus ids the episode teaches (`'greet.hello'`, `'shop.price'`). |
| `sentences` | mixed | The lines, in order (below). |
| `turns` | mixed | Questions characters ask the learner (below). |

### A line: `LibrarySentence`

| Field | Layer | What it is |
|---|---|---|
| `id` | neutral | Stable within the story: `'e1.l03'` (episode 1, line 3). |
| `intent` | neutral | What the line does and means, in plain English, without local color: `'The landlady greets you and nosily asks where you are from'`. Say "a local fried snack", not the dish's name. |
| `function` | neutral | Optional syllabus id the line practises. |
| `speaker` | neutral | A cast `id` (preferred) or a name; omit for narration. The app shows the cast member's local name. |
| `text` | target | The line, natural, with its final punctuation. |
| `translation` | native | The line in the learner's language. |
| `cliff.word` | target | The hidden word(s): an exact run of words of `text`, never its first word. |
| `cliff.accept` | target | Other natural answers, credited in full without a model. |
| `cliff.distractors` | target | Exactly two real words that are wrong in this slot (the options are the answer plus these two). |
| `cliff.hint` | native | The gap word's gloss **as it appears in `translation`** (it is shown in bold there at the hint level): `'name'`. |
| `cliff.concept` | neutral | What the gap stands for: `'your name'`, `'the price'`, `'a color'`, `'a food'`. |

### A question: `LibraryTurn`

| Field | Layer | What it is |
|---|---|---|
| `id` | neutral | `'e1.t01'`. |
| `intent` | neutral | `'The landlady asks what you will cook tonight'`. |
| `function` | neutral | Optional syllabus id the reply practises. |
| `after` | neutral | Index of the line the question follows (0-based). |
| `speaker` | neutral | Cast id or name. |
| `line` | target | The question. |
| `translation` | native | The question in the learner's language. |
| `example` | target | A natural answer (shown after the learner replies or says "no sé"). |

## Gender variants

The learner chooses at onboarding how people address them (as a man or as a woman), and a track may ask a choice. Any text, translation, cliff or turn string may hold:

| Token | Resolves to |
|---|---|
| `{you:a\|b}` | `a` for a learner addressed as a man, `b` as a woman: `¡Bienvenid{you:o\|a}!`, `Estás {you:listo\|lista}.` |
| `{<key>:a\|b}` | `a` or `b` by the gender of the option chosen for track choice `<key>`: `{partner:Él\|Ella} se ríe.` |
| `{<key>.name}` | The chosen option's label: `Cena con {partner.name}.` |

Rules:

- Both resolutions must be natural in the target language **and** in the translation (`translation: 'You look very {you:handsome|pretty}.'`).
- Anything said to or about the learner that agrees in gender must be a variant; nothing gendered about "you" may be left unmarked.
- A cliff word may be a variant (`word: '{you:listo|lista}'`) and so may its hint; the engine resolves everything before it shows, speaks, scores or hides a word.
- Tokens do not nest; alternatives contain no braces or `|`. An empty alternative is fine: `{you:|a}`.
- `you` is reserved; choice keys are letters, digits and `_`.

The resolver is `resolveVariants` / `resolveStory` in `engine/src/content/variants.ts`; `unresolvedTokens` lists strings that still hold braces in some combination.

## The shared syllabus

`engine/src/content/syllabus.ts` lists language-neutral functions (`greet.hello`, `greet.howareyou`, `intro.name`, `courtesy.please`, `shop.price`, `shop.size`, `food.order`, `food.taste`, `plan.time`, `drive.directions`, `health.hurts`, ...), each with an English description, a suggested order and the stage where it usually appears. Stories name functions only by these ids. To add one: re-read the file (other writers add too), append `{ id: 'area.name', description, order, stage }`, never rename or remove an id in use.

## How the engine plays a series

- **Picking**: the learner scrolls the experiences and picks one (`PairPack.tracks`; `StorySession.libraryProgress` gives each card's progress). Switching any time keeps each experience's progress (`StorySession.chooseTrack`). A finished episode can be replayed (`replayEpisode`).
- **Tier**: learner level 0-1 plays the beginner version, 2-3 intermediate, 4-5 advanced; when that tier is not written, the nearest written one (the easier one on a tie).
- **Cliff mode** (by the learner's level, not the episode's):
  - *recall* (0-1): the line is played and shown complete, then shown again with the gap; the learner taps one of three options (the answer and the two distractors) or says or types it. Every word but the gap is shown as text.
  - *hint* (2-3): the translation is shown with `cliff.hint` in bold; the learner says or types the target word. One miss or a "no sé" brings the options.
  - *predict* (4-5): say what comes next; any natural answer counts (the on-device model scores it). "no sé" brings the options, a second one the answer.
- **Feedback** after every answer: the learner's answer, the story's word, up to three other natural answers (`cliff.accept` first, then the model's alternatives when the model is loaded; with `options.library.modelAlternatives` false, as the app runs it, only `cliff.accept`) and the translation. The screen says when the model checked the answer.
- **The story so far**: `StorySession.libraryTranscript` gives the episode in progress up to the line on screen (each earlier line resolved, its gap filled, with the speaker's cast id and name and the translation; the questions asked and the learner's replies). It is rebuilt from the episode and the snapshot, so it survives a restore and starts empty with each episode and replay.
- **Questions**: the model judges the reply (with self-repair); without the model any reply with target-language words is accepted and the example is shown.
- **Level rule** after each episode: up one when at least 80% of its cliffs were answered without options or "no sé", down one under 50%, otherwise unchanged (0-5). After the last episode the track is done and another experience is suggested.

What this means for writing:

- Pick cliff words a learner at that level can produce: concrete, useful words, the line's point (the price, the food, the name), not filler. In recall mode the learner has just heard the word, so the gap may be anywhere after the first word; in predict mode the words after the gap are not heard yet, so the line before the gap must make the answer guessable.
- Put every natural alternative you can think of in `accept`: without the model, only listed answers and the story's word earn full credit.
- Distractors must be real words, clearly wrong in the slot, and not accepted answers.
- `hint` must appear word for word in `translation`.

## Validation

`validateLibrary(pack, { tracks, library })` in `engine/src/content/validate.ts` checks the whole contract and returns a list of problems (`[]` when everything is playable):

- tracks: ids, dialect, cast, setting, choices;
- stories: ids, track, episode 1-8, tier, level, 4-8 beats, syllabus ids, 10-16 lines, line and turn ids (`e<episode>.l<nn>`, `e<episode>.t<nn>`), intents, concepts, two distractors, turn positions, no episode written twice in a tier;
- in **every** combination of address and choices: no braces left, the cliff word found after the first word (with the pack's word segmentation), distractors different from the answer and the accepted answers.

A pair's data test calls it (`expect(validateLibrary(pack, pair)).toEqual([])`); pair-specific checks (vocabulary by level, dialect lists) live next to the pair's stories.

### Writer tooling for English -> Spanish (`proof/stories/`)

- `validate.ts`: `checkSeries(pack, track, stories, words)` runs `validateStory` plus the Spanish checks, in every variant combination: at least 95% of each episode's content words within its level (level 0: a beginner core of verbs, greeting and survival chunks, everyday nouns, colors and sizes, the pair's cognates, the series' food and place words and the chunks taught so far; level 1 adds the 150 most frequent lemmas), line length (level 0: 2-7 words, level 1: 3-9), unknown words, cliff answers within the level (a local answer needs its standard form in `accept`), `hint` a whole word of the translation, real distractors of similar length, a `function` on every line and turn, 1-3 turns, and nothing said to "you" left without a `{you:...}` variant. Names, local dialect words and mixed-in English words are listed by the series (`<SERIES>_WORDS`: `names`, `local`, `english`, `food`, `places`, `cognates`, `known`, and `chunks` per episode) and are not counted.
- `report.ts`: prints that report per episode (`npx vite-node ../proof/stories/report.ts [series]` from `engine/`); add your series to its `SERIES` list.
- `model-check.ts`: judges every line, question and example answer with the real model (both forms of address; street register for slang lines) and lists the model's likely words at each cliff, candidates for `accept` (`engine/scripts/real-model.md` to start the server).
- The series' data test (`engine/src/pair/en-es/stories/<series>.test.ts`) asserts `checkSeries` finds nothing.

## Porting a series to another language pair

Example: Living in San Juan (English speakers learning Spanish) becomes a series for Spanish speakers learning English, or for Chinese speakers learning Japanese.

1. **Keep** every neutral field as it is: track `id` suffix, `setting`, cast `id`/`role`/`quirk`, story `id` scheme, `episode`, `tier`, `beats`, `functions`, line and turn `id`, `intent`, `function`, `speaker`, `after`, `cliff.concept`, and the number and order of lines and turns. The plot, the jokes' structure and the teaching plan stay the same.
2. **Choose the local color** from `setting` and the intents: a city that fits ("a Caribbean capital with an old walled town" could become a coastal city of the new target language), local names for the cast, local food for "a local fried snack", local places.
3. **Rewrite** per line: `text` in the new target language doing what `intent` says, `translation` in the new native language, `cliff.word` chosen to stand for `cliff.concept` (the gap is still "the price", "a food"), `accept`, two `distractors`, `hint` (the gloss inside the new translation); per turn: `line`, `translation`, `example`; per story: `title`, `titleNative`, `characters`, `level` (the vocabulary level of the new wording); per track: `title`, `tagline`, `city`, `country`, `dialect`, cast `name`, choice `prompt` and option `label`s.
4. **Variants**: keep `{you:...}` and choice tokens wherever the new target language agrees in gender (Spanish, French, Portuguese, Italian, Arabic, Hebrew, Russian...). In a language that does not (English, Japanese, Chinese), write one form; the token is simply not needed. The translation side follows the new native language's needs. A target language whose words agree with the speaker also sets `LanguagePack.replyCue` (Spanish: `'Él responde:'` / `'Ella responde:'`), the narration the judge reads before the learner's reply, so the model does not "correct" the learner's own gender.
5. **Words and segmentation**: the engine finds words with the language pack's `segment()` (never spaces), so scripts without spaces (Japanese, Chinese) work; `cliff.word` must be a run of whole segments of `text`.
6. **Validate** with `validateLibrary` and add the pair's own checks (level vocabulary, dialect words).
7. **Wire** `<PAIR>_TRACKS` and `<PAIR>_LIBRARY` into the pair pack factory (`PairPack.tracks`, `PairPack.library`). Nothing in the engine changes.

## A minimal episode

```ts
const e1: LibraryStory = {
  id: 'en-es.living.e1',
  track: 'en-es.track.living',
  episode: 1,
  tier: 'beginner',
  level: 0,
  title: 'La vecina',
  titleNative: 'The neighbor',
  characters: ['Doña Mari'],
  beats: ['You move into a small apartment', 'The neighbor greets you', 'She already knows your name', 'She asks where you are from'],
  functions: ['greet.hello', 'intro.name', 'intro.origin'],
  sentences: [
    {
      id: 'e1.l01',
      intent: 'The neighbor greets you warmly and welcomes you to the building',
      function: 'greet.hello',
      speaker: 'landlady',
      text: '¡Hola! ¡Bienvenid{you:o|a} al edificio!',
      translation: 'Hi! Welcome to the building!',
      cliff: { word: 'edificio', accept: ['barrio'], distractors: ['camión', 'lunes'], hint: 'building', concept: 'a place' },
    },
    // ... 10-16 lines
  ],
  turns: [
    {
      id: 'e1.t01',
      intent: 'The neighbor asks where you are from',
      function: 'intro.origin',
      after: 2,
      speaker: 'landlady',
      line: '¿De dónde eres?',
      translation: 'Where are you from?',
      example: 'Soy de Chicago.',
    },
  ],
};
```
