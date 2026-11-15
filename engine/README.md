# Cliffword engine

The language-neutral core of Cliffword in plain TypeScript: word scoring, corrections, the
learner model and story sentence selection. It talks to a language model only through the
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
| `src/model/` | The `LanguageModel` contract (`scoreContinuation`, `nextTokens`, `generate`) and a deterministic n-gram mock (`createMockModel`) trained on a small Spanish corpus. |
| `src/lang/types.ts` | The `LanguagePack` contract: segments, analyses, analysis choice in context, features, correction rule kinds (swap, inflect, insert, delete), slang entries and register packs, the shared `Register` type. |
| `src/lang/choose.ts` | One analysis per word in context (`chooseAnalysesInText`): PROPN for capitalized words mid-sentence, else `pack.chooseAnalysis` with the previous word, else the first analysis. Selection, cliff choice and corrections all key words through it. |
| `src/lang/es/` | The Spanish pack: segmenter that keeps clipped forms (`'tá`, `pa'`) whole, normalizer, conjugation and inflection, analyzer (exact, then enclitics, then accent-insensitive; a noun or adjective in its own dictionary form first), homographs in context (`chooseSpanishAnalysis`: la comida, he estado, ella vino), a 1788-lemma frequency lexicon that includes every cognate of the pair pack. `createSpanishPack`. |
| `src/lang/es/rules.ts` | The 14 Spanish correction rules as data: ser/estar, por/para, gender, number (street tolerant), aspect, mood, personal a, articles. |
| `src/lang/es/registers/` | Slang register packs for Puerto Rico, the Dominican Republic, Cuba, Colombia and shared Caribbean clipped forms, with meaning, region, formality and explicit flag. `findSlang`. |
| `src/pair/types.ts` | The `PairPack` contract. |
| `src/pair/en-es/` | English speakers learning Spanish: glosses both ways (every lexicon lemma has one), phrase translations, cognates, false friends, an English lexicon for spotting English inside Spanish replies, correction explanations, interface strings. |
| `src/scoring/` | Word surprise and heat (`scoreWords`), whole-word next-word lists from sub-word tokens (`nextWords`), cliff positions (`cliffPositions`) and answer credit (`scoreCliffAnswer`). |
| `src/corrections/` | Rule-made variants (`generateVariants`) scored against the learner's sentence; the winning rule explains (`judgeSentence`). |
| `src/learner/` | Per-item, per-skill memory model (`LearnerModel`), continuous difficulty settings (`deriveParams`), cliff rungs and tiles (`cliffRungFor`, `showText`), placement (`PlacementTracker`). |
| `src/story/` | Target words (`chooseTargets`), the continuation prompt and output cleaning, candidate selection (`selectSentence`), next-sentence generation (`generateNextSentence`), cliff choice (`pickCliff`). |
| `src/gaps/` | Native-language words inside target-language replies (`findNativeGaps`) and the learner events they imply (`gapEvents`). |
| `src/packs.ts` | `createDefaultSpanishPack()`, `createDefaultPairPack()` and helpers that turn pack data into learner keys. |
| `src/config.ts` | Every `DEFAULT_*` options object in one place, with the source of each value (proof test or judgement). |
| `src/index.ts` | The public API. |
| `test/` | Integration tests (real packs plus the mock model) and the simulated learners. |

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
  than a multi-word cliff earns at most partial credit.
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
- **Story.** `chooseTargets({ learner, now, frequencyKeys, extra })` picks the next new
  words. `generateNextSentence(model, { pack, learner, pair }, { story, targets, params,
  now, seed })` samples candidates, cleans them and selects one. `selectSentence` ranks a
  given candidate list. `pickCliff(positions, { text, pack, learner, now, targets, params })`
  picks where the story stops and which words are hidden.
- **Gaps.** `findNativeGaps(text, pack, pair)` finds runs of native words with Spanish
  candidates; `gapEvents(gaps, pack, now)` turns them into `native_gap` events.
- **Testing.** `createMockModel()` gives a deterministic model for app tests.

All randomness is seeded and all time is passed in (ms since epoch), so every function is
deterministic.

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
2. **Generate and select.** `generateNextSentence` builds a short Spanish prompt (last
   sentences, target words, maximum length, register), samples `n` candidates in one model
   call, cleans each to one sentence, and lets `selectSentence` rank them by distance to the
   known-word band, target words hit, length and unknown words. It rejects echoed prompts,
   English words, repeats and unbalanced quotes. If nothing lands in the band it retries once
   with a simpler prompt. Target words are left out of the band check, because they are the
   new material the band allows.
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

Model calls per step (defaults): generation 1 or 2; cliff positions 1 plus at most 50 per
analysed position (a next-word search of at most 49 calls and one boundary call; pass
`positions` to analyse a few); an answer 1 next-word search plus up to 2 calls; a judgement
1 plus one per variant (at most 16).

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

## Known limits

- No contractions in corrections: inserting "el" after "a" gives "a el", not "al", and
  the personal a is not proposed before "el" ("Veo el niño" gets no "Veo al niño").
- Corrections never restore a missing accent (by design, so ser/estar is not credited for
  an accent fix). Typed text without accents can therefore get a wrong explanation: with
  the mock, "Ella esta cansada." gives a gender hint. Speech recognition writes accents;
  typed input needs an accent-restoration step before `judgeSentence`.
- Clitic placement, voseo, vosotros and negative imperatives are not covered.
- `Analysis` has no field for enclitic pronouns: "dámelo" analyzes as dar and drops me/lo.
- Scripts without spaces (Japanese, Chinese) need a pack-aware token classifier for
  `nextWords` (`opts.classify`); none exists yet.
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
- `test/review-regressions.test.ts`: real-pack regression tests for the review findings
  (alg-*, lng-*): multi-word cliff credit, personal a, homographs in context, slang that is
  also standard, variants per rule category without junk, judge asserts whose fix is not in
  the mock corpus, band reachability after placement, decay floors, cliff spans, lexicon
  coverage, quotes and ordinals, native gaps.
- `test/simulated-learners.test.ts`: brand new, early, intermediate reader with weak
  speaking, advanced and heritage profiles built from priors and study events. Checks that
  the known-word band holds, that selection picks an in-band or the closest sentence, that a
  brand-new learner always has a next step, that new material never runs out at the top,
  and that rungs and tiles follow each skill mix.
