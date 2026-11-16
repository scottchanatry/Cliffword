# Cliffword engine

The language-neutral core of Cliffword in plain TypeScript: word scoring, corrections, the
learner model, story sentence selection, the speaking side (spoken commands, transcript
alignment, retell, minutes spoken, self-repair), lyrics and brought text, and the session
state machines the app drives. It talks to a language model only through the
`LanguageModel` interface, so everything runs and is tested without a phone. Language
packs (word splitting, word forms, frequency list, correction rules, slang registers) and
pair packs (glosses, cognates, explanations, interface text) are data passed in. See
`docs/BRIEF.md` for the product decisions behind it.

```bash
cd engine
npx tsc --noEmit   # type check (zero errors)
npx vitest run     # all tests, including integration and simulated learners
```

## Layout

| Path | What it does |
|---|---|
| `src/model/` | The `LanguageModel` contract (`scoreContinuation`, `nextTokens`, `generate`; `TokenScore.upperBound` for a top-N runtime), a deterministic n-gram mock (`createMockModel`, Spanish corpus by default, any corpus accepted), `HttpLanguageModel` (`http.ts`, for `proof/model_server.py`), `TopNBoundedModel` (`topN.ts`, what llama.rn forced decoding gives) and `runLanguageModelContract` (`contract.ts`, a test-only helper that imports vitest, so it is not exported from `src/index.ts`). |
| `src/lang/types.ts` | The `LanguagePack` contract: segments, analyses, analysis choice in context, features, correction rule kinds (swap, inflect, insert, delete, move), slang entries and register packs, the shared `Register` type, enclitic pronouns (`attachClitic`, `splitClitics`), spoken commands (`commands`), command fillers (`fillers`) and regular street endings (`streetEndings`). |
| `src/lang/choose.ts` | One analysis per word in context (`chooseAnalysesInText`): PROPN for capitalized words mid-sentence, else `pack.chooseAnalysis` with the previous word, else the first analysis. Selection, cliff choice and corrections all key words through it. |
| `src/lang/es/` | The Spanish pack: segmenter that keeps clipped forms (`'tá`, `pa'`) whole, normalizer, conjugation and inflection, analyzer (exact, then enclitics, then accent-insensitive; a noun or adjective in its own dictionary form first), homographs in context (`chooseSpanishAnalysis`: la comida, he estado, ella vino), a 1788-lemma frequency lexicon that includes every cognate of the pair pack. `clitics.ts`: enclitics attached keeping the host's stress (leyéndolo, dámelo) and split off again. `commands.ts`: spoken commands, fillers and street endings (`SPANISH_COMMANDS`, `SPANISH_FILLERS`, `SPANISH_STREET_ENDINGS`). `story.ts`: story-generation data (`SPANISH_STORY_DATA`: prompt wording, level names, length hints, example lines, region names, leak patterns, meta words, answer labels) and `SPANISH_ABBREVIATIONS`. `createSpanishPack`. |
| `src/lang/es/rules.ts` | The 29 Spanish correction rules as data: ser/estar (not before a slang predicate), por/para, gender and number (never breaking an agreement that holds; number street tolerant), subject-verb agreement (subject before the verb, and gustar-type verbs with the noun after), aspect, mood, personal a (also across an adverb and before nadie/alguien), articles (also at a sentence start and before clock hours), a + el = al and de + el = del, possessive to article with body parts and clothes, and object pronouns (move rules for placement, participles after haber, doubled pronouns, clitic order, le/les to se before lo/la). |
| `src/lang/es/registers/` | Slang register packs for Puerto Rico, the Dominican Republic, Cuba, Colombia and shared Caribbean clipped forms, with meaning, region, formality and explicit flag (common explicit lyric words included). `findSlang`. |
| `src/pair/types.ts` | The `PairPack` contract. |
| `src/pair/en-es/` | English speakers learning Spanish: glosses both ways (every lexicon lemma has one), phrase translations, cognates, false friends, an English lexicon for spotting English inside Spanish replies, correction explanations, interface strings (every key a session screen can carry), and the starter story `EN_ES_STARTER` (zero-knowledge scene, canned mode, placement ladder), which `createDefaultPairPack()` includes. |
| `src/scoring/` | Word surprise and heat (`scoreWords`), whole-word next-word lists from sub-word tokens (`nextWords`), cliff positions (`cliffPositions`) and answer credit (`scoreCliffAnswer`). |
| `src/corrections/` | Rule-made variants (`generateVariants`) scored against the learner's sentence; the winning rule explains (`judgeSentence`). |
| `src/learner/` | Per-item, per-skill memory model (`LearnerModel`), continuous difficulty settings (`deriveParams`), cliff rungs and tiles (`cliffRungFor`, `showText`), placement (`PlacementTracker`). |
| `src/story/` | Target words (`chooseTargets`), the continuation prompt (`buildStoryPrompt`: tagged story lines, wording from `LanguagePack.story`) and output cleaning, candidate rejects and selection (`selectSentence`, `REJECT_CODES`), next-sentence generation (`generateNextSentence`: target round, safe round, natural score), cliff choice (`pickCliff`). No words of any language: `src/story/neutral.test.ts` checks the sources. |
| `src/gaps/` | Native-language words inside target-language replies (`findNativeGaps`) and the learner events they imply (`gapEvents`). |
| `src/speaking/` | Spoken commands (`matchCommand`), expected vs heard words and "Understood N of M" (`alignTranscript`), timed retell (`retellMetrics`, `retellProgress`, `retellCoverage`, `RETELL_LANES`), minutes spoken per local day and streak (`addSpoken`, `spokenStats`), self-repair before a fix (`repairFlow`, `judgeAttempt`, `attemptRepair`, `repairEvents`), "no sé" (`startNoSe`, `advanceNoSe`), native-language answers (`nativeReply`), tile durations (`estimateDurationMs`). |
| `src/lyrics/` | Pasted lyrics and LRC (`parseLyrics`), slang notes (`slangNotes`), neutral/street line pairs (`registerPairs`), lyric and brought-text cliffs (`lyricCliffs`, `broughtTextCliffs`, `scoreLyricAnswer`), surprise maps (`surpriseMap`), sing-back (`echoLine`), and the one word aligner the engine uses (`alignWords`; speaking reuses it). |
| `src/session/` | `StorySession` and `LyricSession`: pure, deterministic state machines over `{ model, pack, pair, learner }` that return plain-data screens and the learner events of each step, with `snapshot()` / `restore()`. A null model is canned mode (starter sentences). `handover.ts`: starter, bridge and free generation stages (`handoverStage`, `bridgeFamiliar`, `DEFAULT_HANDOVER_OPTIONS`). `prefetch.ts`: `ModelGate`, which serializes a session's model calls and replays a prefetch's answers (`StorySession.prefetch`). |
| `src/packs.ts` | `createDefaultSpanishPack()`, `createDefaultPairPack()` and helpers that turn pack data into learner keys. |
| `src/config.ts` | Every `DEFAULT_*` options object in one place, with the source of each value (proof test or judgement). |
| `src/index.ts` | The public API. |
| `test/` | Integration tests (real packs plus the mock model), review regressions, the simulated learners, the language-neutrality test, and the opt-in real-model tests. |
| `scripts/real-model.md` | How to run the engine against Qwen3-1.7B through `proof/model_server.py`. |

The engine never imports a language outside `packs.ts`: the app builds packs there and
passes them to every function.

## Public API

Import from `src/index.ts` (the package `main`).

- **Packs.** `createDefaultSpanishPack({ regions? })` is
  `createSpanishPack({ rules: SPANISH_RULES, registers: SPANISH_REGISTERS })`, or only the
  register packs of the given regions (a Caribbean member region also loads the shared
  Caribbean pack). `createDefaultPairPack()` is the en-es pair pack with slang glosses from
  the same registers. `frequencyLexemeKeys(pack)`, `cognateLexemeKeys(pair)` and
  `slangLexemeKeys(pack)` give learner keys (`"es:tener"`).
- **Scoring.** `scoreWords(model, pack, context, text)` gives a `WordScore` (log-probability,
  surprisal, heat 0 to 3) per word in one model call. `nextWords(model, context)` gives the
  most likely whole next words. `cliffPositions(model, pack, context, sentence)` rates each
  word as a cliff. `scoreCliffAnswer(model, pack, contextBeforeCliff, answer, actual)`
  returns a `CliffResult`: credit `full | partial | none` with reason `actual | likely |
  plausible | form | unlikely`, the scored form and the alternatives. An answer shorter
  than a multi-word cliff earns at most partial credit. Pass `{ alternatives }` (the
  `CliffPosition.alternatives` cliffPositions found at the same cliff; check with
  `alternativesReusable(cliffOpts, creditOpts)`) and, when known, `{ actualLogprob }` to
  skip the next-word search: an answer then costs at most 2 model calls (4 for several
  words) with the same result. Lemma credit (`lemmaWeight`, `lemmaFloor`): an answer that
  is the same inflection of the same lexeme as an alternative (`sameLexemeForm`: reír and
  reírse) is credited at `lemmaWeight` x P(alternative) when that is more (at most
  partial with the defaults); `CliffResult.lemmaMatch` names the alternative.
- **Corrections.** `judgeSentence(model, pack, context, text, { register })` returns a
  `Judgement`: verdict `ok | hint | assert`, the best variant with its edit span and word
  index, the margin, and the `explainKey` to look up in `pair.explanations`. Token
  log-probabilities are clamped to `logprobFloor` before summing.
- **Learner.** `new LearnerModel({ prior })`, `apply(event)`, `pKnown(key, skill, now)`,
  `snapshot()` and `LearnerModel.restore`. `estimateVocabulary(learner, now, keys)` feeds
  `deriveParams({ vocab, recent })`, which returns `DifficultyParams` (sentence length,
  known-word band, new words per sentence, speech rate, cliff length, tile threshold).
  `cliffRungFor` picks options, hint or free per word; `showText` decides text or tile per
  word. `PlacementTracker` runs placement inside the first story and builds a prior;
  `PlacementTracker.brandNew(cognateLexemeKeys(pair))` is the "I'm brand new" prior.
- **Story.** `chooseTargets({ learner, now, frequencyKeys, extra, exclude, accept })` picks
  the next new words. `generateNextSentence(model, { pack, learner, pair }, { story,
  targets, params, now, seed, names?, vocab?, familiar?, vocabulary?, scene?, safeTag? })`
  samples candidates after the continuation prompt, cleans and rejects them, and selects
  one; the result carries `rejectCounts` and diagnostics (rounds, generate and score
  calls, `targetUsed`, the vocabulary line). `buildStoryPrompt(pack, input)` builds the
  prompt (`prefix` + `suffix`); `selectSentence` ranks a given candidate list (strings or
  `{ text, raw, natural }`). `pickCliff(positions, { text, pack, learner, now, targets,
  params })` picks where the story stops and which words are hidden.
- **Gaps.** `findNativeGaps(text, pack, pair)` finds runs of native words with Spanish
  candidates; `gapEvents(gaps, pack, now)` turns them into `native_gap` events.
- **Speaking.** `matchCommand(transcript, pack, { answer })` returns a `CommandMatch`
  (command, confidence, argument for "qué significa X") only when the utterance is
  essentially the command; fillers come from `pack.fillers`. `alignTranscript(expected,
  heard, pack, { register })` gives landed, missed and substituted words and
  `ui: { key: 'stats.understood', params: { n, m } }`; street register accepts clipped
  forms and `pack.streetEndings`. `retellMetrics(words, { laneMs })` gives words per
  minute and pauses; `addSpoken(log, ms, at, tzOffsetMin)` and `spokenStats(log, now,
  tzOffsetMin)` keep the headline metric. `repairFlow` / `attemptRepair` prompt a repair
  before showing a fix (asserts only); `startNoSe` / `advanceNoSe` play the answer and
  align the repeat; `nativeReply` turns native words into the target phrase to repeat.
- **Lyrics and brought text.** `parseLyrics(raw, pack)` gives lines (ids, stanzas,
  sections, repeats, LRC times). `slangNotes(line, pack, pair)` and
  `registerPairs(line, pack)` show slang and its neutral line. `lyricCliffs(model, pack,
  lyrics, { register })` and `broughtTextCliffs(model, pack, text, { register })` rank
  cliffs per line or sentence; `scoreLyricAnswer` adds spelling and street tolerance to
  `scoreCliffAnswer`. `surpriseMap` shades any text; `echoLine(expected, heard, pack, {
  register })` grades a sung-back line.
- **Sessions.** `StorySession.create({ model, pack, pair, learner, now, seed, startMode })`
  then `next(at)`, `handleUtterance(transcript, at, { durationMs, words })`,
  `command`, `pickOption`, `played`, `tapWord`, `revealWord`, `setSettings`,
  `snapshot()` and `StorySession.restore(snapshot, deps)`. `LyricSession.create({ ...,
  source: { kind: 'lyrics', lyrics } | { kind: 'text', text } })` likewise, plus
  `startEcho` and `setRegister`. Every step returns `{ screen, events, speak?, ... }`;
  events are already applied to the session's learner unless `applyEvents: false`.
  Display text is always a `UiText` (`{ key, params }`) to look up in `pair.ui`;
  `SESSION_UI_KEYS` lists every key a screen can carry. One step at a time: while an
  async step waits for the model, every other step call (sync ones included: `tapWord`,
  `revealWord`, `played`, `setSettings`, `markLine`, `setRegister`, `startEcho`,
  `showSong`) is refused, not queued: it returns at once `{ screen, events: [], refused:
  'busy' }` with the screen from before the running step and changes nothing (a queued
  call would land on whatever screen that step ends on). `isBusy` says so beforehand;
  `snapshot()`, `screen` and `settings` read the state from before the running step;
  `setModel()` waits for the step to end; a step that throws leaves the session as it
  was, so the app can retry it. A cliff answer reuses the alternatives cliff selection
  found (no next-word search). `StorySession.prefetch(at)` prepares the next step while the
  learner is on the landing or no-sé screen (next() then replays the model's answers). A
  prefetch does not make the session busy: other steps run during it and their model calls
  wait behind its calls (one at a time); next() and the next / done commands wait for it and
  replay it; `setModel()` stops it. Call it without awaiting it, outside any queue that
  would hold the learner's next action behind it. `stageAt(at)` says whether the next
  sentence comes from the starter, the bridge or free generation; `modelStats` counts model
  calls and replays.
- **Model adapters.** `new HttpLanguageModel({ baseUrl })` for `proof/model_server.py`;
  `new TopNBoundedModel(model, { n })` reports tokens outside the top N as upper bounds
  (`TokenScore.upperBound`), and the engine never lets a bound raise a verdict or credit
  (`Judgement.bounded`, `WordScore.bounded`, `CliffResult.bounded`).
- **Testing.** `createMockModel(corpus?)` gives a deterministic model for app tests.

All randomness is seeded and all time is passed in (ms since epoch), so every function is
deterministic. Every tunable default is re-exported from `src/config.ts`.

## How a story step flows

```ts
import {
  LearnerModel, PlacementTracker, chooseTargets, cliffPositions, cliffRungFor, cognateLexemeKeys,
  createDefaultPairPack, createDefaultSpanishPack, deriveParams, estimateVocabulary, findNativeGaps,
  frequencyLexemeKeys, gapEvents, generateNextSentence, judgeSentence, pickCliff, scoreCliffAnswer,
  scoreWords, showText, slangLexemeKeys,
} from '@cliffword/engine';

// Null checks omitted: next.sentence, next.best and cliff can be null (see the API docs).
const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const learner = new LearnerModel({ prior: PlacementTracker.brandNew(cognateLexemeKeys(pair)) });
const keys = frequencyLexemeKeys(pack);

// 0. Settings for this learner, now.
const params = deriveParams({ vocab: estimateVocabulary(learner, now, keys), recent });

// 1. Generate candidates and select the next sentence.
const targets = chooseTargets({ learner, now, frequencyKeys: keys, extra: slangLexemeKeys(pack) });
const next = await generateNextSentence(model, { pack, learner, pair },
  { story, targets: targets.map((t) => t.key), params, now, seed });
const sentence = ' ' + next.sentence; // leading space: the story context ends in a word

// 2. Pick the cliff, the rung and the tiles.
const positions = await cliffPositions(model, pack, storyText, sentence);
const cliff = pickCliff(positions, { text: sentence, pack, learner, now, targets: next.best.targetsHit, params });
const rung = cliffRungFor(learner, cliff.key, now);             // options | hint | free
const tiles = next.best.words.map((w) => !showText(learner, w.key, now, params));

// 3. Score the learner's answer at the cliff.
const result = await scoreCliffAnswer(model, pack, storyText + sentence.slice(0, cliff.start),
  answer, cliff.words.join(' '));

// 4. Judge a sentence the learner says, shade surprising words, catch native words.
const judgement = await judgeSentence(model, pack, storyText, reply, { register });
const heat = await scoreWords(model, pack, storyText, ' ' + reply); // leading space after a word
const gaps = findNativeGaps(reply, pack, pair);

// 5. Update the learner.
learner.applyAll([
  { type: 'cliff_answer', key: cliff.key, at: now, credit: result.credit, rung },
  ...gapEvents(gaps, pack, now),
  // plus heard / tap_rehear / hold_reveal / read / gloss_lookup from the tiles,
  // spoke_correct / spoke_error from the judgement, cliff_skip for "no sé".
]);
```

In more detail:

1. **Targets and difficulty.** `chooseTargets` walks the frequency list and takes the most
   frequent lexemes the learner does not understand yet. When the list is used up, it takes
   `extra` lexemes (slang, words from texts the learner brought), then words understood but
   not yet produced, then the least-known ones, so there is always material. `deriveParams`
   turns the vocabulary estimate and recent performance into continuous settings; the
   known-word band stays at about 95 to 98% at every level (a share within 1e-9 of an edge
   counts as on it), and cliffs hide at most 4 words.
2. **Generate and select.** `generateNextSentence` builds a continuation prompt (no chat
   template): a header from the pack (`LanguagePack.story`: "Cuento en español (nivel
   A1). Frases cortas.", the characters, a vocabulary line for small vocabularies), then
   the last story sentences one per line after their key word in brackets, ending with
   the target as the next tag (`[viejo]`). It samples `n` candidates in one model call,
   stopping at the first sentence end (the pack's `StoryLanguageData.stop`; a line break
   for a pack without one), cleans each to one sentence, and rejects
   placeholders, lists, headings, bare quotes, prompt leaks, meta talk, native or foreign
   words, verbless fragments, sentences far outside the level's length and near repeats
   (`REJECT_CODES`, counted per reason). `selectSentence` ranks the rest: the known-word
   band first, then target words, novelty, continuity, length and unknown words. If
   nothing lands in the band, a safe round ends the same prompt with a familiar tag (the
   main character); then the best few are scored by the model and the most natural wins
   among them, always after the in-band ones. Target words are left out of the band
   check, because they are the new material the band allows. A zero-knowledge learner
   hears the pair's starter story first and then generates on a bridge vocabulary (see
   "Round 3 at a glance" for the hand-over rule).
3. **Pick the cliff.** `cliffPositions` scores the sentence once and runs the whole-word
   next-word search at each position. `pickCliff` excludes the first word of a sentence,
   names, numbers and implausible words, prefers target words and words the learner
   understands but cannot yet say, and hides `params.cliffWords` words, stopping before a
   name or a number.
4. **Score the answer.** `scoreCliffAnswer` gives full credit for the story's word and for
   any natural alternative (probability relative to the top alternative, or above a floor),
   partial credit for possible-but-unusual words, for the right word in the wrong form and
   for an answer that covers only the first words of a multi-word cliff (compared with the
   same number of actual words). It ignores case, trailing punctuation and missing accents
   ("reir" scores as "reír", from the alternatives or else from the pack's own spelling).
5. **Judge the learner's sentence.** `judgeSentence` generates rule variants (slang words
   are never touched, except that neutral register corrects slang that is also standard
   Spanish, such as guapo or "de una"; street register skips street-tolerant rules), scores
   each against the original with a shared prefix, and asserts a fix only when the margin
   is large: assert
   above `assertMargin`, hint above `hintMargin`, otherwise ok. Two competing explanations
   within `tieMargin` downgrade an assert to a hint. `scoreWords` shades surprising words;
   `findNativeGaps` finds English inside the reply and `pair.toTarget` offers the Spanish to
   repeat.
6. **Update the learner.** Each event maps to evidence per skill through `EVENT_EVIDENCE`;
   meaning, sound, written form and speaking are tracked separately, so a reader who speaks
   little keeps option rungs and a heritage speaker gets tiles. Recall decays towards a
   floor, the baseline times the share of successful evidence, so an item met only with
   success never ends up below its prior.

Model calls per step (defaults): generation 1 or 2 plus up to 3 scoring calls for the
natural score (`naturalTop`); cliff positions 1 plus at most 50 per
analysed position (a next-word search of at most 49 calls and one boundary call; pass
`positions` to analyse a few); an answer 1 next-word search plus up to 2 calls, or with
precomputed `alternatives` (what sessions pass) none for an answer among them and 2 for
another word (4 for several words; a slang cliff whose answer is judged in neutral form
also searches at the neutral context); a judgement 1 plus one per variant (at most 16).
Measured per session step on the mock and on Qwen3-1.7B: `proof/ENGINE_REAL_MODEL.md`,
"Answer speed, lemma credit and session robustness".

## Thresholds from the proof test

`proof/RESULTS.md` measured probability scoring on Qwen3-1.7B and Qwen3-4B (Q4_K_M). The
engine targets **Qwen3-1.7B**: the same 97% minimal-pair accuracy at half the size and
twice the speed. The full table, with the source of each value, is in `src/config.ts`.

| Setting | Value | Why |
|---|---|---|
| Scoring prefix (`LanguagePack.scoringPrefix`) | `Frase en español:\n` | Required: 97% accuracy with it, 85% without. Use `scoringContext()` for every score. |
| `DEFAULT_JUDGE_OPTIONS` assert / hint | 3 / 1 nats | At 3 nats: 80% of errors caught, 0 false flags. With hints at 1 nat: 95% caught, 1 false flag. |
| `DEFAULT_JUDGE_OPTIONS.lengthAdjustPerToken` | 0 | A length bias did not help on 1.7B. Mock-model tests pin 1. |
| `DEFAULT_HEAT_OPTIONS.thresholds` | 7, 9.5, 12 nats | Shades about the top fifth, tenth and 2-3% of correct words. |
| `DEFAULT_HEAT_OPTIONS.sentenceStartAllowance` | 2.5 nats | Sentence-first words run about 2.7 nats higher. |
| Frequency baseline | off | Subtracting stand-alone surprisal made localization worse. |
| `DEFAULT_NEXT_WORD_OPTIONS.minProb` | 1e-3 | The proof method's pruning floor. |
| `DEFAULT_CREDIT_OPTIONS.partialFloor` | 1e-4 | Real model: credits 40 of 40 natural cliff answers, 0 of 23 wrong ones (0.005 missed 12). |

What the proof showed, and how the engine handles it:

- **Locating errors**: the most surprising word is the error only 70% of the time (89% if
  you take the top two). Shading stays soft. Corrections locate the error from the rule
  variant that wins.
- **Slang**: street sentences score about 4.5 nats per word worse than neutral
  paraphrases, and a register prefix recovers only about 1.2 nats per word, for the
  words it names. Street mode therefore:
  - passes `slangExemption(pack, regions)` as `HeatOptions.exempt`, so slang is never
    shaded;
  - scores after `scoringContext(pack, before, { register: 'street', regions, words:
    slangIn(pack, text, regions) })`;
  - relies on corrections already protecting slang words.

  Only the Puerto Rico prefix was measured; the DO, CU, CO and CARIB prefixes share its
  shape.
- **Slang cliffs**: next-word lists are useless after slang openings (top-10 mass 0.12).
  Cliffs on slang or lyric lines must take their answers from the pack or the lyrics.
- **Still judgement calls**:
  - credit floors and margins;
  - partial-credit evidence weights;
  - `maxVariants` (1.9 s for a sentence plus six variants on 4 CPU cores; measure on a
    phone);
  - the memory model, difficulty curves, placement and selection weights.

  Calibrate these from learner logs.

## Running against the real model

`test/real-model.test.ts` (adapter contract, parity with the proof, accuracy, timings) and
`test/real-engine.test.ts` (the engine's own functions on the 93 proof pairs, street
sentences, heat, cliffs, generation, top-10 forced decoding) are skipped unless
`CLIFFWORD_MODEL_URL` is set, so `npx vitest run` never needs a server. Full steps and
measured numbers: `scripts/real-model.md` and `proof/ENGINE_REAL_MODEL.md`.

```bash
cd proof
/tmp/claude-0/venv/bin/python model_server.py \
  --model /home/user/models/Qwen3-1.7B-Q4_K_M.gguf --port 8765 --threads 4 --ctx 2048 &
cd ../engine
npm run test:real                                   # real-model.test.ts
CLIFFWORD_MODEL_URL=http://127.0.0.1:8765 npx vitest run test/real-engine.test.ts
```

The server handles one request at a time; run one real-model suite at a time. On the
real model (2026-11-15): judge 64/93 errors asserted (57 with the exact fix), 0 false
asserts and 2 false hints on the correct sentences, 2 asserts on the 26 street
sentences, none on slang. After the correction coverage round (2026-11-16): 74/93
asserted (70 with the exact fix), 0 false asserts and 1 false hint, 0 street asserts; on
83 held-out pairs written before the round 64 asserted with the exact fix (was 43), 0
false asserts (was 1); `test/real-coverage.test.ts` checks the held-out sets (see "Held-out
sets" below). The review run of 2026-11-16 repeated all three suites with the same
results. Top-N forced decoding loses too much (top-10: 4 asserts), so
the device needs a native method that scores a supplied text; keep top-50 only as a
fallback.

## Contract decisions made during integration

- `LanguagePack.foldAccents?` (optional): the pack decides which marks are accents. Spanish
  removes accents and diaeresis and keeps ñ. Answer comparison uses it, falling back to a
  configurable mark set.
- `LanguagePack.frequencyList?` (optional): the frequency list itself, needed to enumerate
  words (vocabulary estimate, target choice, placement bands).
- `Register = 'neutral' | 'street'` moved to `lang/types.ts`; corrections and story
  re-export it.
- `SlangEntry.pos?` (optional): part of speech when the neutral word cannot supply it; 64
  register entries now carry one, so every single-word slang entry analyzes with a real part
  of speech and slang verbs conjugate (gufeamos).
- `PairPack.falseFriends?` (optional): false-friend warnings keyed by lemma; `toTarget` also
  takes listed phrases ("hardware store" gives ferretería). A `toTarget` candidate may be a
  dictionary form, so `gapEvents` keys events by the pack's lemma (`candidateLemma`: chica
  gives es:chico).
- `CliffResult.scored?`: the form that was actually scored.
- The learner event credit type is `scoring/types` `Credit`.
- Documented in the contracts: a log-probability may be `-Infinity` and engine code clamps
  to a floor; `CliffPosition.actualLogprob` includes the end-of-word mass; an imperative has
  no tense; finite verbs may carry `form: 'fin'`; punctuation segments keep their text as
  `norm`; insert-rule neighbour semantics.
- Scoring restores a missing accent only on a form the pack does not know as written
  (`knownAsWritten`: an analysis must inflect back to the same spelling), because the
  Spanish analyzer also finds "reir" by ignoring accents.

## Contract decisions made after review

- `LanguagePack.chooseAnalysis?(analyses, { prev, sentenceStart })` (optional): the pack
  picks a word's analysis in context. Spanish: the noun after a determiner or numeral,
  the compound-tense participle after haber, a finite verb after a pronoun, a name or
  no/ya, and a finite verb over a bare noun at a sentence start. `lang/choose.ts` applies
  it for selection, cliff choice and corrections; the analyzer itself puts a noun or
  adjective in its own dictionary form first (comida before comer).
- Inflect rules re-inflect only the readings of the chosen analysis (its lemma and part
  of speech), never homographs (casa/casar, para/parar). `InflectRule.cueWords` /
  `cueFor`: the Spanish mood rule changes an indicative only after que, ojalá, cuando,
  aunque, quizá(s), tal (vez) or mientras earlier in the sentence.
- `InsertRule.beforeLemmas`, `throughPos`, `notAfterWords`, `notBeforeWords`,
  `agreementExceptions` (optional): the personal a goes before a name (a capitalized word
  the pack does not know counts, `VariantOptions.capitalizedUnknownAsPropn`) or before a
  person noun through its determiners ("Veo a mi madre"), never before "el"; articles are
  never inserted after al or del, "el"/"un" go before a stressed-a feminine (el agua) and
  "la" does not. Agreement compares only the determiner readings of the inserted word.
- `SlangEntry.alsoStandard?`: the form (every word of a phrase) is also standard Spanish;
  neutral register does not protect it. A slang sense of a standard lemma, or of a lemma
  another pack already defines, has a region-suffixed lemma (`guapo@DO`, `fajarse@CU`), so
  it has its own learner key and gloss.
- `JudgeOptions.logprobFloor` (-100): token log-probabilities are clamped before summing.
- `DEFAULT_PLACEMENT_OPTIONS.maxPrior` is 0.99 (was 0.95, the lower edge of the band), so
  a placed learner's commonest words can fill the known-word band; `bandDistance` treats
  shares within `BAND_EPSILON` of an edge as on it.
- `recallAt(state, now, floor)` and `recallFloor(state, baseline)`: see step 6 above.
- `deriveParams` keeps `cliffWords` at or below the top of `DEFAULT_DIFFICULTY_OPTIONS.cliffWords` (4).
- `cliffSpan(..., stopBefore)`: `pickCliff` stops the hidden span before a name or number.
- The Spanish segmenter reads an apostrophe as a quote mark around clipped forms that are
  also standard words (tan, mano; eso, mucho) when the text closes the quote, and keeps
  ordinal marks with their number (2º). The conjugator produces the -se imperfect
  subjunctive (hablase, fuese) as alternative forms; the analyzer tries the clitic
  reading of words that are also slang (dímelo, dale) and of deme/dele (dé + clitic).

## Contract decisions made in the second integration

- `LanguagePack` gained optional `attachClitic`, `splitClitics`, `commands`, `fillers` and
  `streetEndings`. Fillers and street endings were per-language maps inside
  `speaking/`; they are pack data now (`SPANISH_FILLERS`, `SPANISH_STREET_ENDINGS`), so no
  core module holds Spanish words. `DEFAULT_FILLERS`, `DEFAULT_STREET_SUFFIXES`,
  `defaultFillers` and `defaultStreetSuffixes` are gone; options still override the pack.
- `CorrectionRule` gained `MoveRule` (object pronoun placement, cluster order);
  `SwapRule` gained `beforeWords`, `afterWords`, `fromWords`. `DeleteRule` gained
  `notBeforePos` and `notBeforeWords`, and the generator never deletes a word right
  before a slang word: `es.article.delete` skips la/los/las before a verb (object
  pronouns) and articles before que/de/del; `es.personal_a.delete` skips "a" before a
  verb. On the real model this removed the only false assert on the correct proof
  sentences and halved the street-register asserts (4 to 2) with no loss of fixes.
- `PairPack.starter` (`StarterStory`): canned sentences, taught words, placement probes,
  learner-turn prompts. `createEnEsPairPack({ starter })` defaults it to `EN_ES_STARTER`.
- `TokenScore.upperBound`, `Judgement.bounded`, `ScoredVariant.bounded`,
  `WordScore.bounded`, `CliffPosition.bounded`, `CliffResult.bounded` (see config.ts,
  "Bounded scores"). `DEFAULT_CREDIT_OPTIONS.partialFloor` is 1e-4 (measured).
- Interface keys: the session's "About N times in 100" key is `landing.timesInHundred`
  (pack ids have no digits); `landing.justAsNatural`, `story.asks`, `story.noSentence`,
  `echo.landed` and `lyrics.answer.*` were added to the en-es pack.
- Spaces follow the script: `needsLeadingSpace` returns false after a character of a
  script written without spaces (Han, Hiragana, Katakana, Thai, Lao, Khmer, Myanmar) and
  after CJK punctuation, and sessions (`joinSentences`, `leadAfter`), brought-text
  context (`unitsBefore`), `judgeSentence`'s context join and `nativeReply` use it, so a
  Japanese story context is never joined with spaces.

## Contract decisions made in the correction coverage round

- `CorrectionRule` gained `AgreeRule` (kind `agree`: re-inflect a target with the person
  and number of a controller found next to it; Spanish subject-verb and gustar
  agreement) and `ContractRule` (kind `contract`: join "a el" into "al"; the generator
  also writes inserts contracted and lets a delete with `fromContractions` take a word
  out of a contraction). `KIND_PRIORITY` ranks `contract` with swaps and `agree` with
  inflections.
- `SwapRule` gained `beforeLemmas`, `afterPos`, `cueWords`, `agreeNext` (body-part
  article) and `notBeforeSlang` / `slangThroughPos` (ser/estar before a slang predicate).
  `InflectRule` gained `keepAgreement` (never break an agreement that holds; never change
  a word next to a slang word of those parts of speech) and `nextPosFor` (a determiner
  changes only before its noun phrase, so "Las compré" keeps its pronoun).
  `InsertRule` gained `sentenceStart` and `afterThroughPos`; `DeleteRule` gained
  `fromContractions`; `MoveRule` gained `homographNotBeforePos` (neuter "lo" is never an
  article before a noun), `viaAuxiliary` (a participle after haber hands its pronouns to
  haber) and `doubledWithin` (a pronoun said twice).
- Corrections protect inflected forms of single-word slang entries through the chosen
  lemma, and `slangExemption` exempts them from heat.
- The Spanish pack reads a noun/verb homograph after que, si, cuando, porque, aunque,
  ojalá or mientras as the verb (`VERB_CUE_CONJUNCTIONS`), so "que estudio" gets a mood
  variant.
- New explanation keys in the en-es pack: `es.verb_agreement`, `es.contraction`,
  `es.body_article`, `es.pronoun_double`.

## Contract decisions made for story generation (round 3)

- `LanguagePack.story?` (`StoryLanguageData`, lang/storyData.ts): the continuation
  prompt's wording, level names by vocabulary, length hints, example lines, region
  names, the older instruction wording, leak patterns (regex sources), meta words,
  answer labels, preamble words and `requireVerb`. `LanguagePack.abbreviations?`: no
  sentence end after them. The Spanish values are in lang/es/story.ts; story/ holds none.
  `SPANISH_PROMPT_TEXT`, `REGION_NAMES` and `DEFAULT_ABBREVIATIONS` stay exported as
  aliases of the Spanish data; `DEFAULT_LEAK_PATTERNS` and `DEFAULT_EXTRACT_OPTIONS` now
  hold only the model's own English meta talk, and `extractOptionsFor(pack)` adds the
  pack's labels. `buildContinuationPrompt` without pack wording has no instruction lines.
- `RejectCode` gained placeholder, list, heading, bare_quote, meta, foreign, no_verb,
  too_short and unnatural (a scored candidate below `naturalFloor`, mean log-probability
  per token); repeat also covers a short sentence that repeats a content word of its own
  (`repeatsItself`), a candidate holding a recent sentence whole, and one that opens with
  the same three words as one of the last two sentences (`sameOpening`); `Selection.rejectCounts`; `SelectContext.names` (characters are names at a
  sentence start too) and `familiar` (counted at least `familiarCredit`); selection takes
  `{ text, raw, natural }` candidates; `ScoreParts` gained novelty, continuity, natural;
  the band term carries `outOfBandPenalty` so any in-band candidate comes first; with
  `SelectContext.seed` a seeded jitter below `varietyJitter` (1 point) orders near ties,
  and generation orders the vocabulary line by the seed, so different seeds vary.
  `hardMaxWordsFactor` is 1.6 (was 2.5).
- `generateNextSentence` uses the tagged continuation prompt; `NextSentenceTuning`
  gained retryN, naturalTop and the vocabulary-line settings, and stops at the first
  sentence end; `GenerationRound.tag` and `maxTokens`; diagnostics count generate and
  score calls separately.
- `chooseTargets` takes `accept`; practice and review compare probabilities in 0.05
  buckets (frequency order inside a bucket), so the weakest-speaking word is no longer
  the rarest word of the list by a few thousandths.
- `StorySession`: `prefetch(at)`, `stageAt(at)`, `modelStats`; options `handover` and
  `generation`; `StoryState.introduced`. All model calls of a session go through one
  `ModelGate` (one at a time). Canned mode plays the unused placement-ladder sentences
  after the starter before it cycles. `proof/model_server.py` `/generate` reuses the KV
  cache of the prompt prefix shared with the previous request (identical texts).

## Contract decisions made for answer speed and session robustness (round 3)

- `CreditOptions.alternatives` and `actualLogprob` (precomputed at the cliff),
  `alternativesReusable(cliff, credit)`; `LyricAnswerTarget.alternatives` and
  `actualLogprob` (used for the answer as given, never for the neutral rescoring).
  `StorySession` passes them for model sentences, `LyricSession` for cliffs the model rated
  (`LyricCliffState.rated`, absent in older snapshots, which then search as before).
- Lemma credit: `CreditOptions.lemmaWeight` (0.02) and `lemmaFloor` (2e-5),
  `sameLexemeForm(pack, a, b)`, `CliffResult.lemmaMatch`. Measured in
  `proof/ENGINE_REAL_MODEL.md`: no weight separates a natural pronoun-less form (reír for
  reírse) from a wrong one (levantar for levantarse), so the default weight can lift an
  answer to partial credit and never to full.
- Sessions: `StepRefusal` ('busy'), `StoryStep.refused`, `LyricStep.refused`,
  `StorySession.isBusy`, `LyricSession.isBusy`. Async steps that overlap no longer throw:
  they are refused like the sync calls. A step that throws rolls the session state back.
- `parseLyrics` rejects LRC times whose seconds are 60 or more (`[99:99.99]`, `<01:75>`):
  removed from the line, no time. `estimateDurationMs` gives 0 ms for text with no
  letter or number. `anchorFormOf` is exported from the corrections barrel (and so from
  `src/index.ts`); `boundedWords` already was, through `scoring/wordScores`.
- Lookups behind every step are cached: the Spanish analyzer keeps the analyses of up to
  `DEFAULT_ANALYZE_OPTIONS.cacheSize` (20000) words and returns copies; `slangIn` and
  `slangExemption` segment each register pack's forms once per pack; `findSlangMatches`
  builds its index once per pack and option set.

## Round 3 at a glance

What changed in round 3 (story generation, correction coverage, answer speed and session
robustness) and in its review, by topic. Measurements: `proof/ENGINE_REAL_MODEL.md`, the
three dated 2026-11-16 sections and "Engine round 3: review and summary".

- **Generation prompt data.** Every word the story module writes into a prompt or looks
  for in model output is pack data (`LanguagePack.story`, `StoryLanguageData`): header,
  level names by vocabulary, length hints, example lines, characters, scene and
  vocabulary lines, street line and region names, leak patterns, meta words, answer
  labels, preamble words, `requireVerb`, and the generation `stop` strings (Spanish: ". ",
  "? ", "! " and a line break; the cut "?" and "!" come back from ¿ and ¡; a pack without
  stops stops at a line break). `LanguagePack.abbreviations` lists words after which a
  period does not end a sentence. `story/` holds no words of any language
  (`src/story/neutral.test.ts`), and the Japanese toy pack gets a bare tagged prompt.
- **The prompt.** Plain continuation: the header, then the last story sentences one per
  line after their key word in brackets ("[mercado] Marta llegó tarde al mercado."), and
  the target as the next tag ("[viejo]"). Only this format made Qwen3-1.7B use a
  content-word target reliably (12 of 12 against 2 of 8).
- **Hand-over rule** (`session/handover.ts`, `DEFAULT_HANDOVER_OPTIONS`). A zero-knowledge
  learner (startMode `brand_new`, or no evidence at all) hears the pair's starter story
  (`starterSentences`: all 8 in en-es). Then, with a model, generation runs on the bridge
  while the learner knows fewer than `strictFrom` (150) frequency-list lexemes at
  pKnown(meaning) >= `knownAt` (0.9): the starter's taught words, every word of its
  sentences, the pair's cognates and the words introduced since (`introducedKeep`, 200)
  count as known in the band check (`familiarCredit` 0.98) and fill the vocabulary line,
  and the targets are content words (`bridgeTargetPos`). From 150 known lexemes on,
  generation is free (the band on pKnown alone). Without a model the session stays on
  canned sentences. A step with no usable sentence falls back to unused starter
  sentences, then unused placement-ladder sentences, then the starter again (least
  recently used): never an error screen, never an early repeat.
- **Rejects** (`REJECT_CODES`, counted per step in `rejectCounts`): empty, placeholder,
  list, heading, bare_quote, prompt_leak, meta, native_words, foreign, no_verb,
  too_short, too_long, repeat (the same or a near-same sentence, a recent sentence held
  whole, a short sentence that repeats a content word, a copied opening frame: the same
  first three words as one of the last two sentences, reaching a verb), unbalanced_quotes
  and unnatural (a scored candidate below -4.4 nats per token). Word counts for the
  heading and list checks come from the pack's segmenter.
- **Selection and the natural pass.** Band first (any in-band candidate beats any
  out-of-band one), then targets, novelty, continuity, length, unknown words, the natural
  score and a seeded jitter below one point (`varietyJitter`). The natural pass scores
  accepted candidates in rank order until three pass the floor (at most six calls per
  step); candidates scored in the first round count where they rank after the safe round,
  and the final order keeps in-band candidates first. In a session, the last in-band
  candidate it will try takes its best rated cliff even below the cliff plausibility
  floor rather than leave the band.
- **Prefetch.** `StorySession.prefetch(at)` runs the next step on a copy of the session
  through a recording view of the model (`ModelGate`); the real step recomputes everything
  and replays only answers to identical requests, so the story is the same with or
  without it. Model calls of a session (its steps and its prefetch) run one at a time; a
  model switch retires the old gate and the new one starts after it. Snapshots never hold
  prefetched answers.
- **Busy behaviour.** While an async step waits for the model, every other step call is
  refused at once with `refused: 'busy'`, the screen from before the step and no events;
  reads (`snapshot()`, `screen`, `settings`, `prior`, `stageAt()`) see the state from
  before the step; `setModel()` waits for the step to end; a step that throws leaves the
  session as it was. The same holds for `LyricSession`.
- **Cliff-answer alternatives.** `cliffPositions` already ran the next-word search at the
  cliff, so sessions pass its alternatives (and P(actual) for a one-word cliff) to
  `scoreCliffAnswer` / `scoreLyricAnswer` (`CreditOptions.alternatives`,
  `actualLogprob`; check with `alternativesReusable`): an answer costs 0 to 4 model calls
  instead of about 20, with the same result. Lemma credit (`lemmaWeight` 0.02) can lift a
  pronoun-less form (reír for reírse) to partial credit, never to full.
- **New correction rules** (29 Spanish rules, was 22): subject-verb agreement (subject
  before the verb; gustar-type verbs with the noun after; never breaking an agreement that
  holds), a + el = al and de + el = del both ways, articles at a sentence start and before
  clock hours, possessive to article with body parts and clothes, personal a across an
  adverb and before nadie/alguien, a mood cue after que/si/cuando..., pronoun placement
  after haber and doubled pronouns, ser/estar skipped before a slang predicate; new rule
  kinds `agree` and `contract`. Slang inflections (bacana, panas, bregamos) are protected
  and never shaded.
- **Held-out sets.** Written before the correction work and never tuned on:
  `proof/pairs_holdout.jsonl` (83 pairs, 12 families) and `proof/slang_holdout.jsonl` (27
  street sentences: PR, DO, CU, CO); three changes were prompted by them (each with a
  matching case in the original sets), so a second blind set, `proof/pairs_holdout2.jsonl`
  (36 pairs) and `proof/slang_holdout2.jsonl` (10 sentences), was written after the code
  was done and run once. Held-out: 64 of 83 errors asserted with the exact fix (was 43), 0
  false asserts (was 1); blind: 31 of 36, 0 false asserts, 0 false hints; no street
  assert and no slang touched or shaded in any set. `test/real-coverage.test.ts` checks the
  held-out sets on the real model.

## Contract decisions made in the round-3 review

- `StoryLanguageData.stop` (optional): the pack's generation stop strings.
  `DEFAULT_NEXT_SENTENCE_TUNING.stop` is now a line break (was ". ", "? ", "! " and a line
  break, which the Spanish pack now supplies): a ". " stop is cut by the runtime, and a
  language without an opening question mark (English) or without a space after its
  sentence end (Japanese) would lose or never reach the end mark. `tuning.stop` still
  overrides both.
- `SelectOptions.sameOpeningNeedsVerb` (true) and `sameOpening(..., verbPos?)`: a copied
  opening is a repeat only when the shared opening reaches a verb. In the real-model run
  the old check threw out every sentence of the advanced story that started with its
  five-word character, "El señor de las frutas": two of eight steps without a sentence;
  with the new check the same run has 8 of 8 in band (was 6), the reader 8 of 8 (was 7),
  and the early learner's story is unchanged.
- The natural pass counts already scored candidates where they rank now, and ranks
  in-band candidates first: an out-of-band candidate scored in the first round could beat
  the safe round's in-band one (a candidate scored in round one used up the count).
- `StorySession`: the last in-band candidate takes its best rated cliff below the
  plausibility floor (no extra model call) before an out-of-band one is tried;
  `introducedKeep: 0` keeps no introduced word (it kept all); the next and done commands
  wait for a running prefetch and replay it, as next() does; `setModel()` during a prefetch
  retires the old gate (`ModelGate.retire()`, `ModelGate.idle()`; the constructor takes
  the gate it replaces) so model calls never overlap across the switch.
- Every engine module passes `LanguagePack.abbreviations` to sentence splitting (brought
  text, lyric cliffs, gaps, retell, repair, native replies, sentence views): "Sr. García"
  no longer splits a brought text into two sentences.
- The heading and comma-list rejects count words with the pack's segmenter and the
  all-capitals test applies only to scripts with case: a Japanese sentence cut at its stop
  string is not a heading, and one with several 、 is not a list.

## Known limits

- Corrections never restore a missing accent (by design, so ser/estar is not credited for
  an accent fix). Typed text without accents can therefore get a wrong explanation: with
  the mock, "Ella esta cansada." gives a gender hint. Speech recognition writes accents;
  typed input needs an accent-restoration step before `judgeSentence`.
- Voseo and vosotros are not covered. Pronoun placement misses pronouns past two verbs,
  "dálelo", and a wrong mood with the pronoun already in place ("No lo haz").
  `Analysis` has no field for enclitics; `splitClitics` recovers them ("dámelo" -> da +
  me, lo).
- Subject-verb agreement sees only a subject right before the verb (through no, object
  pronouns and adverbs) or, for gustar-type verbs, the noun right after it: a subject
  after the verb ("Ayer llegó mis padres"), coordinated subjects and a noun of time
  before the verb ("Los lunes trabajo") are left alone. The body-part and gustar lists
  hold lexicon lemmas only (chaqueta, fascinar are not in the lexicon).
- `slangExemption` exempts every word of a phrase entry wherever it occurs ("qué es la
  que hay" exempts que and la in Puerto Rican street text), because the predicate sees one
  segment at a time; corrections match phrases as runs of words. Inflected slang
  (bacana, panas, bregamos) is exempt and protected through its lemma.
- Scripts without spaces (Japanese, Chinese) need a pack-aware token classifier for
  `nextWords` (`opts.classify`); none exists yet, so next-word lists and cliff
  alternatives are whole token runs there. `test/language-neutral.test.ts` runs scoring,
  corrections, commands, alignment and sessions on a toy Japanese pack.
- `splitSentences` / `sentenceStartFlags` called directly without a list know no
  abbreviations (`NO_ABBREVIATIONS`); every engine module passes
  `LanguagePack.abbreviations` (Spanish: `SPANISH_ABBREVIATIONS`).
- The bridge (session/handover.ts) holds the known-word band on the starter's words,
  cognates and introduced words, because the learner model gains meaning evidence slowly
  (eight starter sentences leave the taught words below 0.7). Calibrate `strictFrom` and
  the evidence weights from learner logs.
- Words outside the shipped 1788-lemma lexicon count as unknown at every level, so an
  advanced learner's band holds only on sentences of listed words; a longer frequency
  list fixes it.
- Street scoring names the slang of the whole sentence in the prefix, including the
  hidden cliff words (story and lyric cliffs), which primes the model towards the
  lyric's own slang. Slang answers are credited from the packs, so this mostly affects
  the probabilities shown on the landing line.
- Caribbean -ado to -ao participles (cansao) and dropped final s (ve', ma') are not
  normalized; only listed clipped forms are recognized.
- Words that are both slang and standard Spanish (vaina, brutal) are corrected only in
  neutral register; street register always protects them.
- Analysis choice in context looks only at the previous word. A sentence that opens with
  a bare noun that is also a finite verb form ("Trabajo es importante") reads it as the
  verb, because Spanish drops subject pronouns more often than determiners.
- The shipped frequency lexicon has 1788 lemmas. Learners beyond it are served by slang and
  practice targets until a longer list is added; the simulated learners use a synthetic
  tail to stand in for one.
- `LanguagePack.inflect` takes no part of speech; the Spanish pack picks the paradigm entry
  with the fewest extra features ("poder" with number p gives "poderes").

## Tests

- Module tests next to each module (`src/**/*.test.ts`), using stub packs where the module
  must not depend on the real ones.
- `test/integration.test.ts`: the real Spanish pack, rules, registers and pair pack with the
  mock model. Covers the ser/estar assert, ok sentences, slang protection in street register,
  word scores and next words end to end, gap capture, and one full story step.
- `test/correction-coverage.test.ts`: the rules and slang entries of the correction
  coverage round (agreement, contractions, sentence-start and hour articles, body-part
  articles, personal a, participles and doubled pronouns, slang protection and the new
  entries), with regressions for the fixes the last real-model round never generated.
- `test/review-regressions.test.ts`: real-pack regression tests for the review findings
  (alg-*, lng-*): multi-word cliff credit, personal a, homographs in context, slang that is
  also standard, variants per rule category without junk, judge asserts whose fix is not in
  the mock corpus, band reachability after placement, decay floors, cliff spans, lexicon
  coverage, quotes and ordinals, native gaps; and the second integration review (int-*):
  delete rules that left pronouns and slang alone, wordless utterances, pack fillers,
  interface keys, the starter in the default pair pack, script-aware joins, public
  exports, session determinism and restore under odd input.
- Story generation: `src/story/select.test.ts` (every reject code, the band-first
  ranking, novelty, continuity, familiar words, the natural term), `src/story/prompt.test.ts`
  (the continuation prompt per pack, with and without story data), `src/story/next.test.ts`
  (target and safe rounds, natural scoring, reject counts), `src/story/neutral.test.ts`
  (no Spanish in story/), `src/session/handover.test.ts` (the hand-over rule, the bridge,
  no stall or early repeat with or without a model) and `src/session/prefetch.test.ts`
  (same story with and without prefetch, snapshot / restore, learner and model changes,
  serialized model calls).
- Answer speed and robustness: `src/scoring/cliffReuse.test.ts` (precomputed alternatives
  give the search's results, lemma credit and its guards), `src/session/answerCalls.test.ts`
  (a session answer makes no next-word search), `src/session/busy.test.ts` (every call
  during a pending model call is refused and changes nothing, refusals resolve first, a
  snapshot taken while busy restores to the state before the step, a failed step rolls
  back, setModel waits) and `src/lyrics/lookupCache.test.ts` (the lookup caches equal the
  uncached answers).
- `test/language-neutral.test.ts`: a toy Japanese pack (Intl.Segmenter words, and a
  dictionary segmenter) through scoreWords, generateVariants, judgeSentence,
  matchCommand, alignTranscript and StorySession steps with the mock model; no space is
  ever added between words or sentences.
- `test/real-model.test.ts`, `test/real-engine.test.ts`: opt-in, against
  `proof/model_server.py` (see "Running against the real model").
- `test/simulated-learners.test.ts`: brand new, early, intermediate reader with weak
  speaking, advanced and heritage profiles built from priors and study events. Checks that
  the known-word band holds, that selection picks an in-band or the closest sentence, that a
  brand-new learner always has a next step, that new material never runs out at the top,
  and that rungs and tiles follow each skill mix; and, over a running `StorySession` per
  profile (a graded candidate pool behind the mock), that every generated sentence is in
  band whenever an in-band candidate was offered (on the bridge for the brand-new
  learner), that every step has a next screen and that every generated sentence was asked
  for with targets.
- `test/round3-review.test.ts`: the round-3 review regressions (pack stop strings,
  segmenter-based heading and list rejects, abbreviations in brought text, prefetch with
  the next command and with a model switch, the copied-opening frame).
