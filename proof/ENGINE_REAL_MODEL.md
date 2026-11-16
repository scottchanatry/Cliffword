# The engine against the real model

Newest: "Engine round 3: review and summary (2026-11-16)" at the end gives round 3's
before and after in one table, the held-out figures and the review's fixes; the sections
in between keep each step's full measurements.

Date: 2026-11-15. Model: Qwen3-1.7B Q4_K_M, served by `proof/model_server.py` (llama.cpp
through llama-cpp-python, CPU, 4 threads) and reached through the engine's
`HttpLanguageModel`. Machine: the same 4-core cloud container as the proof test. Other
jobs (tests, an app bundler) shared it, with a load average of 2 to 6, so the timings
are upper bounds for this hardware.

Step 1 (`proof/RESULTS.md`) scored minimal pairs by hand-written scripts. This step runs
the **engine's own public functions** (`judgeSentence`, `scoreWords`, `scoreCliffAnswer`,
`cliffPositions`, `nextWords`, `generateNextSentence`) on the same model and data, with
the defaults in `engine/src/config.ts`, and measures what a learner would see.
`engine/test/real-engine.test.ts` encodes the key checks (run it with
`CLIFFWORD_MODEL_URL=http://127.0.0.1:8765 npx vitest run test/real-engine.test.ts`,
about 15 minutes). Run one client at a time: the server answers one request at a time,
and with a second client the next-word search's parallel requests can wait past the
10-second connect timeout of Node's fetch.

## Verdict (plain language)

- **Corrections work as the proof promised wherever the rules can produce the fix.** The
  engine's margins equal the proof's to 1e-14 nats. On the 76 of 93 pairs where a rule
  generates the correct sentence, the engine asserts 79% of the errors with a correct fix
  and flags 92% (the proof's raw numbers: 80% and 95%). Over all 93 pairs it asserts 60
  errors with a correct fix (65%) and flags 70 (75%). The gap is entirely in variant
  generation (12 fixes never generated, 2 beaten by a wrong article insert or delete), not
  in the model or the thresholds.
- **One false assert in 93 correct sentences, and it is a rule bug, not a margin.** The
  article delete rule removes the object pronoun of "La invité a cenar." and asserts
  "Invité a cenar." (+8.7 nats). Two false hints, as in the proof. The 3 / 1 nat
  thresholds stay.
- **Street register never touches slang.** No variant edits a slang word or clipped form
  in the 26 street sentences, and with the exemption no slang word is shaded. Naming the
  slang in the street prefix cuts its mean surprisal from 13.5 to 5.1 nats. But 4 of the
  26 correct street sentences still get an assert on an ordinary word: three article
  deletions and one ser/estar.
- **Heat behaves as the proof measured.** The most surprising word is the error (or the
  next word) in 70% of incorrect sentences, the top two in 90% (proof: 70% and 89%). Heat
  2 or more reaches the error in 45% of them; 3% of correct sentences get a heat-3 word.
  The thresholds [7, 9.5, 12] stay.
- **Cliff credit was too strict; now every natural answer earns credit.** At the old
  partial floor (0.005), 12 of 40 natural answers at six story cliffs got no credit
  ("empezó a reír", "vamos a nadar", "corrió hacia la cocina"). Wrong words sit at 1e-5
  or lower, so the floor is now 1e-4: 40 of 40 natural answers credited, 0 of 23 wrong.
- **Generation is not ready for a brand-new learner.** The prompt asks the model to "use"
  the target words el and de; Qwen3-1.7B answers with fill-in templates ("El y de
  _______.") or a single word, and selection accepts them. For an intermediate learner
  every run lands in the known-word band, but always on the same short sentence.
- **The device needs a native scoring method.** Scoring through llama.rn's top-N lists
  (forced decoding) bounds a large share of tokens; with the new bounded-score rules the
  judge then cannot assert most errors at all, and without them it would assert wrong
  fixes. See "Top-N forced decoding" and the recommendation at the end.

## 1. Corrections on the 93 proof pairs (neutral register)

`judgeSentence(model, pack, scoringContext(pack, ''), sentence)` on every incorrect and
every correct sentence of `proof/pairs.jsonl`, default options (assert at 3 nats, hint at
1, tie margin 1, up to 16 variants; a median of 5 variants were generated, at most 13).

"Right fix" means the winning variant is exactly the proof's correct sentence. "Right
rule" means the winning variant's explanation names the proof's rule family (mood for
subjunctive_wish, aspect for preterite_imperfect, any pronoun-placement key).

| rule | n | asserted | hinted | ok | fix generated | asserted, right fix | flagged, right fix | right rule | false asserts | false hints |
|---|---|---|---|---|---|---|---|---|---|---|
| ser_estar | 10 | 7 | 2 | 1 | 10 | 7 | 9 | 9 | 0 | 1 |
| por_para | 10 | 9 | 0 | 1 | 10 | 8 | 8 | 8 | 0 | 1 |
| gender | 10 | 8 | 2 | 0 | 10 | 8 | 10 | 10 | 0 | 0 |
| number | 10 | 5 | 1 | 4 | 4 | 4 | 4 | 6 | 0 | 0 |
| preterite_imperfect | 10 | 7 | 3 | 0 | 10 | 7 | 10 | 10 | 0 | 0 |
| subjunctive_wish | 10 | 7 | 1 | 2 | 9 | 7 | 8 | 8 | 0 | 0 |
| personal_a | 12 | 7 | 1 | 4 | 9 | 7 | 8 | 8 | 0 | 0 |
| articles | 10 | 4 | 0 | 6 | 3 | 3 | 3 | 4 | 0 | 0 |
| pronoun_placement | 11 | 10 | 1 | 0 | 11 | 6 | 7 | 10 | 1 | 0 |
| **all** | 93 | **64** | 11 | 18 | 76 | **57** | **67** | 73 | **1** | **2** |

Three pronoun-placement asserts chose the other correct placement ("Te quiero ver
mañana." for the proof's "Quiero verte mañana.", "Lo estoy leyendo ahora.", "¿Me puedes
ayudar?"). Counting those, 60 errors are asserted and 70 flagged with a correct fix.

**Compared with the proof's raw numbers.** The proof scored each pair alone: 97%
accuracy, 74 errors (80%) beat by 3 nats, 88 (95%) by 1 nat. The engine's margin for the
correct variant is identical (largest difference 1.4e-14 nats; prefix sharing is exact).

| | errors asserted | errors flagged | false asserts | false hints |
|---|---|---|---|---|
| proof, raw pair margins (only the correct alternative) | 74 (80%) | 88 (95%) | 0 | 1 |
| engine, the 76 pairs whose fix a rule generates | 60 (79%) | 70 (92%) | | |
| engine, all 93 pairs | 60 (65%) correct fix, 4 wrong fix | 70 (75%) | 1 | 2 |

Of the 74 errors the proof caught at 3 nats, the engine misses 14: in 12 no rule
generates the fix, and in 2 another rule's variant wins.

Not generated (the rules have no variant for the correct sentence):

- number (6): subject-verb agreement is not a rule ("Los niños juega" → juegan;
  "Nosotros vive", "Ellos quiere", "Los libros está", "Esas mujeres trabaja", "Me gusta
  las manzanas"). Worse, the number rule then changes the determiner: "Esas mujeres
  trabaja mucho." is asserted as "Esa mujeres trabaja mucho." (+6.4).
- articles (7): no article at a sentence start ("Vida es bella", "Perros son leales",
  "Español es fácil"), no possessive-to-article swap ("Me lavo mis manos", "Me duele mi
  cabeza"), no contraction ("Voy a cine" → al cine; the engine asserts "Voy a un cine"),
  no "a las ocho".
- personal a (3): not across "mucho" ("Quiero mucho a mis abuelos"), not before "nadie",
  no "al" → "el" ("Leo al periódico").
- mood (1): "que estudio" reads estudio as a noun, so no subjunctive variant.

Beaten by another variant: "Tengo que terminar esto por mañana." asserts the article
insert "por la mañana" (+4.5) over the por/para fix "para mañana" (+3.1); "Invité la a
cenar." asserts the article delete "Invité a cenar." (+14.4) over "La invité a cenar."
(+5.7).

The false assert: "La invité a cenar." → "Invité a cenar." (es.article.delete, +8.7).
The false hints: "La fiesta es en mi casa esta noche." → está (+1.3, one of the proof's
wrong-way pairs) and "Trabajo por la mañana." → "por el mañana" (gender, +1.6).

**Decision: keep assert 3, hint 1, tie 1, length adjustment 0.** No threshold would
remove the false assert (+8.7) without losing most true asserts, and it disappears once
the article delete skips pronouns. Length adjustment cannot fix it either (it would move
+8.7 to +7.7). The two false hints are the proof's.

## 2. Street register (26 street sentences)

`judgeSentence(model, pack, context, sentence, { register: 'street' })` where `context =
scoringContext(pack, '', { register: 'street', regions, words: slangIn(pack, sentence,
regions) })` and `regions` is the sentence's region plus the shared Caribbean pack. Heat
with `scoreWords(..., { exempt: slangExemption(pack, regions) })` against the neutral
prefix without exemption.

- **No variant touches a slang word or clipped form** that occurs in the sentence (the
  check matches `slangIn` forms as word runs). Street register skips the street-tolerant
  number rule as designed.
- **Verdicts:** 21 ok, 1 hint, 4 asserts, all on ordinary words:

| sentence | assert | margin | cause |
|---|---|---|---|
| ¿Qué es la que hay, mano? | "¿Qué es que hay, mano?" | +5.4 | article delete; "qué es la que hay" is missing from the PR pack |
| Tengo un chin de hambre. | "Tengo chin de hambre." | +3.2 | article delete of the determiner of the slang noun chin |
| Esa fiesta estuvo bacana. | "Esa fiesta fue bacana." | +5.7 | ser/estar: the model prefers fue (both are fine) |
| Ese man es más bacano que el putas. | "... que putas." | +3.5 | article delete inside the fixed expression "que el putas" |

  The hint: "Me voy pa' casa" → "pa' la casa" (+1.6). In neutral register the same 26
  sentences get 4 asserts and 3 hints, among them "Vamo' a janguear" → "Vamo' janguear"
  (+6.9), a personal-a delete of the "a" of "ir a + infinitive".

- **Slang heat:**

| | mean surprisal of the 40 slang words | slang heat 0 / 1 / 2 / 3 |
|---|---|---|
| neutral prefix, no exemption | 13.5 nats | 8 / 2 / 12 / 18 |
| street prefix naming the slang, no exemption | 5.1 nats | 30 / 4 / 3 / 3 |
| street prefix with `slangExemption` (what the engine does) | 5.1 nats | 40 / 0 / 0 / 0 |

  Naming a word in the prefix helps far more than the proof saw for unnamed words
  (tíguere 36.4 → 3.5, janguear 26.5 → 4.1, Parcero 25.6 → 10.4). Clipped 'tá stays at
  12 to 14 nats even when named, so the exemption is still needed. The other 99 words
  barely change (7.1 → 6.8 nats).

## 3. Heat (word shading) on the 93 pairs

`scoreWords(model, pack, scoringContext(pack, ''), sentence)`. The error position is the
changed span of the incorrect sentence (for an omission, the word where the missing word
belongs); a hit means a word in the span or the word right after it.

| rule | error or next at heat ≥ 2 | at heat ≥ 1 | most surprising word (proof method) | top two | correct sentences with heat ≥ 2 | with heat 3 |
|---|---|---|---|---|---|---|
| ser_estar | 2 / 10 | 6 | 40% | 70% | 1 | 0 |
| por_para | 3 / 10 | 6 | 60% | 80% | 2 | 0 |
| gender | 8 / 10 | 10 | 90% | 100% | 0 | 0 |
| number | 5 / 10 | 9 | 90% | 100% | 1 | 0 |
| preterite_imperfect | 4 / 10 | 7 | 80% | 80% | 0 | 0 |
| subjunctive_wish | 5 / 10 | 9 | 80% | 90% | 1 | 0 |
| personal_a | 2 / 12 | 9 | 25% | 92% | 2 | 1 |
| articles | 5 / 10 | 8 | 70% | 100% | 1 | 0 |
| pronoun_placement | 8 / 11 | 11 | 100% | 100% | 5 | 2 |
| **all** | **42 / 93 (45%)** | 75 (81%) | **70%** | **90%** | **13 (14%)** | **3 (3%)** |

Of the 444 words of the correct sentences, 14% get heat 1 or more, 3% heat 2 or more and
1% heat 3. Of the 102 error words, 60%, 31% and 16%.

Threshold sweep for the heat-2 line (first words get the 2.5-nat allowance):

| heat-2 threshold | correct sentences with a word at or above it | errors hit |
|---|---|---|
| 8.5 | 27 (29%) | 53 (57%) |
| 9 | 17 (18%) | 49 (53%) |
| **9.5 (kept)** | **13 (14%)** | **42 (45%)** |
| 10 | 8 (9%) | 38 (41%) |
| 10.5 | 6 (6%) | 35 (38%) |

**Decision: keep [7, 9.5, 12].** Every step trades false shading for hits at roughly the
same rate, so no value is clearly better, and the brief wants shading soft. Corrections
locate errors from the winning variant, not from heat.

## 4. Cliffs

Story: "Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba
cerrado. Entonces vio una nota en la puerta y empezó a | leerla en voz alta."
`scoreCliffAnswer(model, pack, scoringContext(pack, before), answer, 'leerla')`.

The model's own top words at the cliff: llorar 0.33, correr 0.23, leerla 0.09, leer
0.07, caminar 0.04, pensar 0.03, buscar 0.02, escribir 0.02, reírse 0.01, preocuparse
0.01.

| answer | P(answer) | credit before (floor 0.005) | credit now (floor 1e-4) |
|---|---|---|---|
| leerla (actual) | 0.093 | full, actual | full, actual |
| leer | 0.069 | full, likely | full, likely |
| llorar | 0.33 | full, likely | full, likely |
| reír / reir | 5.6e-4 | **none** | partial, plausible |
| gritar | 1.0e-3 | **none** | partial, plausible |
| sonreír | 1.1e-2 | partial, plausible | partial, plausible |
| lee / leyó / leía | 6e-7 to 3e-9 | partial, form | partial, form |
| mesa / verde / puerta / comió | 2e-9 to 2e-7 | none | none |
| read (English) | 1.5e-6 | none | none |

Multi-word cliff "leerla en voz alta": the actual words get full credit; "leerla en
silencio" and "reír a carcajadas" partial; "leer la nota" only partial because it has
fewer words than the cliff (a deliberate rule); "lee la nota" and "mesa verde grande"
none.

**Credit floor across six cliffs.** To check that reír was not a one-off, 40 natural and
23 wrong single-word answers were scored at six cliffs (labels are a Spanish speaker's
judgement; "vamos a casa" counts as natural).

| partial floor | natural answers credited | wrong answers credited |
|---|---|---|
| 0.005 (before) | 28 / 40 | 0 / 23 |
| 0.001 | 37 / 40 | 0 / 23 |
| 5e-4 | 39 / 40 | 0 / 23 |
| 2e-4 | 40 / 40 | 0 / 23 |
| **1e-4 (now)** | **40 / 40** | **0 / 23** |
| 2e-5 | 40 / 40 | 0 / 23 |
| 1e-5 | 40 / 40 | 1 / 23 |

| cliff | natural answers (probability) | wrong answers |
|---|---|---|
| En la playa hacía mucho | calor 0.65, frío 0.27, viento 0.013, sol 0.012, ruido 0.0046 | 1e-6 to 5e-9 |
| Esta noche vamos a | ver 0.18, cenar 0.094, comer 0.071, celebrar 0.042, salir 0.026, bailar 0.0032, casa 0.0029, nadar 7e-4 | 2e-6 to 3e-10 |
| El perro corrió hacia la | casa 0.56, calle 0.064, puerta 0.063, playa 0.0071, ventana 0.0046, cocina 2.2e-4 | verde 1e-5, others 5e-7 to 1e-8 |
| La niña abrió la puerta y | vio 0.17, entró 0.14, salió 0.020, miró 0.016, gritó 0.012, sonrió 0.0061, corrió 0.0033 | 1e-6 to 4e-8 |
| Mi hermano siempre | dice 0.11, come 0.0055, canta 0.0034, llega 0.0033, juega 0.0024, trabaja 0.0011 | 3e-6 to 3e-10 |
| … empezó a | llorar 0.33, leerla 0.093, leer 0.069, pensar 0.033, buscar 0.017, sonreír 0.011, gritar 0.0010, reír 5.6e-4 | 1e-7 to 2e-9 |

**Decision: `DEFAULT_CREDIT_OPTIONS.partialFloor` 0.005 → 1e-4.** Natural answers go
down to 2.2e-4 and wrong ones up to 1.0e-5 ("hacia la verde", itself grammatical as "the
green one"); word-class errors stay at or below 2.3e-6. 1e-4 is a factor of 2 below the
least likely natural answer and 10 above the most likely wrong one. The full-credit
rules (0.25 of the top word, or 0.05) are unchanged: natural answers ranked 3rd to 10th
(sol, viento, salir, miró) get partial credit, which is a judgement call for learner
logs. `session/cliff.ts` uses this floor for its option distractors, which the lower
value makes safer: at 0.005 a natural word such as "bailar" (0.0032) could have been
offered as a wrong option.

Two further observations for the cliff and session owners:

- reír earns only partial credit because the model expects the pronominal reírse
  (0.014). Crediting an answer that shares a lemma with a likely alternative would fix
  this class of answer.
- Cliff positions in the third sentence (one model call plus a next-word search per word,
  2.7 s per position): "a" after empezó is near certain (0.94, one plausible word),
  "voz" and "alta" too (0.87, 0.98), good for beginners' option and hint rungs; "leerla"
  has six plausible answers, a good free-answer cliff; "nota" (0.004, caja 0.27) and
  "empezó" (0.0005, se 0.65) are poor cliffs. `pickCliff` excludes the first word.

## 5. Next-sentence generation

`generateNextSentence(model, { pack, learner, pair }, { story, targets, params, now, seed,
tuning: { n: 4 } })` with targets from `chooseTargets(..., { count: 2 })` and `params`
from `deriveParams({ vocab: estimateVocabulary(...) })`, seeds 1 to 4. maxTokens follows
the default (2 tokens per word of the length limit plus 8: 26 tokens for a brand-new
learner, 36 for the intermediate one).

| learner | targets | runs in band | retried | accepted / candidates | rejects | chosen sentence | time per call |
|---|---|---|---|---|---|---|---|
| brand new (cognate prior), empty story | el, de | 0 / 4 | 4 / 4 | 32 / 32 | none | "El y de _.", "El y de...", "El y de." | 7 to 12 s |
| brand new, after "Marta llegó tarde al mercado." | el, de | 0 / 4 | 4 / 4 | 12 / 32 | 16 repeats, 4 empty | "El." or "La." | 5 to 7 s (one 38 s under load) |
| intermediate (about 1200 lexemes) | agarrar, aguantar | 4 / 4 | 0 / 4 | 12 / 16 | 3 unbalanced quotes, 1 empty | "¿Qué dijo Marta?" every time | 4 to 8 s |

What goes wrong, all in `story/` (not changed here):

- **The brand-new prompt asks for function words.** chooseTargets gives the commonest
  unknown lemmas, el and de, and the prompt says "Usa estas palabras: el y de." The model
  writes a fill-in template ("El y de _______.") or stops after one word. The retry
  prompt ("Usa la palabra el") gives real sentences ("El gato se comió el ratón.") or,
  with a story, copies its first sentence (rejected as a repeat).
- **Selection accepts junk when nothing can reach the band.** A brand-new learner knows
  only cognates, so every candidate has a known share near 0.002 and every band distance
  is the same; the target bonus (+3 per target) then picks "El y de _." over "El gato se
  comió el ratón." No reject code covers placeholders (`_`), trailing ellipses or
  verbless fragments.
- **Targets are rarely used.** The intermediate runs never used agarrar or aguantar; the
  in-band winner is a three-word question below the length range (6.6 to 13.7 words),
  because the band term outweighs the length penalty.
- **The in-band result is fragile.** With only the first two story sentences in the
  prompt, the same intermediate learner and seed got no in-band candidate, retried, and
  ended on "La niña se agarró al de la caja." (out of band, a broken phrase).
- **Prompt leaks:** none of the leak patterns fired; the templates and numbered lists
  ("(1) (2) (3)") are leaks in spirit that the patterns do not catch.

Recommendations for the story owner: never list function words as targets in the prompt
(name cognates to use instead for a brand-new learner); reject placeholder runs,
ellipsis fragments and candidates without a finite verb; make the length penalty or a
minimum length count when no candidate is in band; consider a few more candidates (n = 6
of 26 tokens costs about 10 s here).

Update 2026-11-16: done in "Story generation at every level (2026-11-16)" at the end of
this document (tagged continuation prompt, rejects with counts, the starter-to-bridge
hand-over for a brand-new learner, prefetch).

## 6. Top-N forced decoding (the llama.rn limitation)

The same 186 judgements through `TopNBoundedModel(model, { n })`, which reports every
token of a scored text against the model's top-N list at its position: a token inside
the list keeps its exact logprob, a token outside gets the N-th candidate's logprob with
`upperBound: true`. That is what stock llama.rn gives by forced decoding (the fallback
in docs/OUTLINE.md, section 1.2). The "no cap" and "variant side only" rows recompute
the verdict from the same scored variants without the new rule, or capping only when
the variant's own rest is bounded.

| scores | errors asserted (right fix) | errors flagged (right fix) | false asserts | false hints | judgements resting on a bound |
|---|---|---|---|---|---|
| exact | 64 (57) | 75 (67) | 1 | 2 | 0 / 186 |
| top-50, no cap (before this step) | 49 (43) | 68 (58) | 1 | 8 | |
| top-50, cap on the variant side only | 30 (28) | 68 (58) | 0 | 9 | |
| **top-50, engine (cap on either side)** | **18 (17)** | 68 (58) | **0** | 9 | 135 / 186 |
| top-10, no cap (before this step) | 39 (35) | 59 (46) | 4 | 14 | |
| top-10, cap on the variant side only | 10 (10) | 59 (46) | 0 | 18 | |
| **top-10, engine (cap on either side)** | **4 (4)** | 59 (46) | **0** | 18 | 169 / 186 |

In plain words:

- **Through top-10 lists almost every judgement rests on a bound** (169 of 186): a rest
  of five or six tokens nearly always holds one word the model did not list. Without
  the new rule the judge would assert 3 more correct sentences, all deletions ("Eran las
  diez" → "Eran diez", "por la noche" → "por noche", "Visitamos a nuestros primos" →
  "Visitamos nuestros primos"), plus 4 wrong fixes on incorrect ones. With it, it asserts
  4 errors, all with the right fix, and leaves the rest as hints.
- **Hints on bounds are unreliable.** 18 of the 93 correct sentences get a hint at top-10
  (2 with exact scores), 11 of them article deletions: a dropped word that is unlikely in
  its context comes back at the 10th candidate's value instead of its real, much lower
  logprob, so the shorter sentence looks better than it is.
- **Capping only the variant side would not help much**: the bound sits in the variant's
  rest in 157 of the 169 cases, so that policy recovers 6 asserts at top-10.
- **Top-50 lists (the outline's fallback) halve the damage but do not remove it.** 135
  of 186 judgements still rest on a bound. Without the cap the judge asserts 49 errors,
  6 of them with a wrong fix, plus the one false assert it also makes with exact
  scores. With the cap it asserts 18 (17 with the right fix) and hints the rest, and 9
  correct sentences get a hint. Capping only the variant side would give 30 asserts (28
  right) and still no false assert at this N; the engine keeps the stricter rule because
  the original-side bound is only valid on raw probabilities (see corrections/judge.ts).
- **Cliff credit stays safe.** Through top-10 lists the wrong answers mesa and verde come
  back as bounds of about 0.012 (exact: 2e-9 and 1e-7), which would have earned partial
  credit; with the new rule they get none. Answers the model lists itself (leerla, leer,
  llorar) keep their exact credit, because next-token lists are exact on any runtime.
- **Cost:** the simulation asks for one list per token (1.6 s per sentence, 3 s per
  judgement here). A device gets the lists from the forced-decoding pass itself, but
  llama.rn's completion API decodes one token per step, about ten times slower than one
  batched decode (docs/OUTLINE.md).

## 7. Timings

Per call, on this shared 4-core machine (median of repeated calls; the engine function
rows come from the full runs above):

| call | time |
|---|---|
| one sentence score (`scoreContinuation`, 10 words, HTTP included) | 100 to 180 ms |
| `nextTokens`, k = 20 or 50 | 80 to 90 ms |
| `generate`, 1 completion of 24 tokens | 1.5 s (about 16 tokens/s) |
| `generate`, 4 completions of 24 tokens | 5.9 s |
| `judgeSentence` (5 variants median, 13 at most) | 0.66 s median, 1.4 s p90 |
| `scoreWords` | 0.12 s (one call) |
| `nextWords` (whole-word list, about 30 calls) | 2.7 s |
| `scoreCliffAnswer` (one next-word search plus up to 2 calls) | 2.7 to 4 s (7 s under heavier load) |
| `cliffPositions`, per analysed position | 2.7 s |
| `generateNextSentence` (n = 4, one or two rounds) | 4 to 12 s |
| `scoreContinuation` through top-10 lists (one list per token) | 1.6 s |
| `judgeSentence` through top-10 lists | 3.7 s |

The slow parts are the next-word searches. `scoreCliffAnswer` recomputes the
alternatives that `cliffPositions` already found for the same cliff (2.7 s per answer);
letting the caller pass them in would make an answer cost one or two scoring calls.

## 8. Changes made in this step

- **Bounded scores** (`TokenScore.upperBound`, a token outside the runtime's top N):
  `judgeSentence` never asserts a margin with a bounded token in either compared region
  (hint at most, `Judgement.bounded` and `ScoredVariant.bounded`); `scoreWords` keeps the
  heat of such a word (a lower bound) and marks `WordScore.bounded`; `cliffPositions`
  marks `CliffPosition.bounded`; `scoreCliffAnswer` never gives likely or plausible
  credit on a bounded probability and marks `CliffResult.bounded`. With exact scores
  nothing changes. Unit tests use `TopNBoundedModel` over the mock.
- **`DEFAULT_CREDIT_OPTIONS.partialFloor` 0.005 → 1e-4** (section 4). Mock-based checks
  in other modules now pass the mock-scale floor 0.005 explicitly (the wrong-answer check
  in `test/integration.test.ts`, the model-only slang credit in
  `src/lyrics/cliffs.test.ts`), because the n-gram mock smooths unseen words to about
  1e-3; their expected values are unchanged.
- Kept: judge 3 / 1 / tie 1 / length 0, heat [7, 9.5, 12], sentence-start allowance 2.5.

## 9. Open issues for other modules

1. `es.article.delete` deletes object pronouns and determiners next to slang: the only
   false assert on the proof's correct sentences ("La invité a cenar."), the wrong fix
   for "Invité la a cenar.", and 3 of the 4 street-register asserts. It should delete
   la, lo, los, las only as determiners (before a noun or adjective), never inside a
   slang phrase, and never the determiner of a slang noun.
2. `es.personal_a.delete` deletes the "a" of "ir a + infinitive" ("Vamo' a janguear" in
   neutral register, +6.9).
3. Missing rules: subject-verb number agreement; article at a sentence start (with the
   capital moved: "Vida" → "La vida"); possessive to article with body parts; a + el = al
   and de + el = del; personal a across an adverb and before nadie/alguien. The number
   rule should not make a determiner disagree with its noun ("Esa mujeres").
4. Spanish analysis: "que estudio" should offer the verb reading for the mood rule.
5. PR register pack: add "qué es la que hay"; DO: treat "un chin" as a phrase.
6. Story generation for brand-new learners (section 5).
7. `scoreCliffAnswer` could accept precomputed alternatives (section 7), and credit an
   answer that shares a lemma with a likely alternative (reír vs reírse). Done
   2026-11-16: see "Answer speed, lemma credit and session robustness".

Update after integration (same day, same server and model): issues 1 and 2 are fixed in
the rule data. `DeleteRule` gained `notBeforePos` and `notBeforeWords`, and the
generator never deletes a word right before a slang word. `es.article.delete` skips a
word before a verb or before que/de/del, and `es.personal_a.delete` skips an "a" before
a verb. Re-measured with `test/real-engine.test.ts`: judge 64/93 asserted (57 with the
right fix), 67 flagged with the right fix, 73 right rule, all unchanged; **0 false
asserts** (was 1) and 2 false hints on the correct sentences; street register **2
asserts** (was 4): "que el putas" (putas is not in the slang packs) and "estuvo bacana"
→ "fue bacana". The rule fixes reachable on the incorrect sentences are unchanged
(76 of 93).

## Device adapter recommendation

**Use the native scoring method (`llamaScoreText`, docs/OUTLINE.md section 1.2) for
the product; keep top-50 forced decoding only as the automatic fallback.** The
measurement settles what the brief left open:

1. **Corrections need exact margins.** Exact scores give 64 asserts (57 with the right
   fix, 60 counting equally correct placements) and 1 false assert, which is a rule bug.
   Through top-N lists the engine, which now refuses to assert on a bound, asserts 4
   errors at N = 10 and 18 at N = 50; without that refusal the lists produce false
   asserts (3 more at N = 10) and wrong fixes (4 at N = 10, 6 at N = 50). A larger N
   does not close the gap, because one unlisted word anywhere in the compared rest is
   enough: 135 of 186 judgements still rest on a bound at N = 50.
2. **The native method is also the faster one.** It scores a text with one batched
   decode (the prompt-processing speed the proof measured, 124 tokens/s on 4 CPU
   cores), where forced decoding decodes token by token.
3. **What the native method must match**, because the engine's numbers depend on it
   (proof/model_server.py does all of it): the start token (`<|im_end|>` for the Qwen3
   GGUFs, which have no BOS); context and text tokenized separately without special
   tokens; a log-softmax over the raw logits in double precision; byte tokens merged
   into whole UTF-8 characters; offsets in UTF-16 code units; at least two tokens per
   decode batch (one-token batches moved logprobs by up to 0.28 nats in this llama.cpp
   build); KV-cache reuse of the shared prefix (judgements, cliffs and next-word searches
   repeat their context). `nextTokens` must return the raw top-k (k up to 50) after a
   context. The outline's self-test (ten proof pairs within 0.15 nats of
   `proof/raw_qwen3-1.7b.json`) catches a mismatch.
4. **When the fallback is active**, use N = 50 (or the largest list the runtime allows),
   not 10: 18 against 4 asserts, 9 against 18 false hints. The engine already caps
   verdicts and credit. The app should show a hint with `Judgement.bounded` very lightly
   or not at all (9 of 93 correct sentences got one at N = 50, 18 at N = 10), read
   `WordScore.bounded` as "at least this surprising", and lean on the options and hint
   rungs for cliffs, whose answers come from exact next-token lists.
5. **Latency to watch on device:** the next-word search (about 30 model calls, 2.7 s
   here) dominates cliffs. Reuse the alternatives that `cliffPositions` found when
   scoring an answer at the same cliff (open issue 7), and keep the native `nextTokens`
   cheap (a partial sort of one logit row).

## Correction coverage and slang data (2026-11-16)

Same model (Qwen3-1.7B Q4_K_M), served by its own `proof/model_server.py` with 2 threads
while another model server and other agents' jobs shared the 4 cores (load average 2 to
10), so timings here are upper bounds. Scripts: `proof/engine-measure/coverage.ts` (runs
`judgeSentence`, and in street register also `scoreWords` with `slangExemption`, on every
set; `--offline` lists variants only) and `summarize.py`; raw results in
`proof/engine-measure/results/coverage-before.json`, `coverage-after.json` and
`coverage-after-street.json` (the tuning runs are `coverage-tune1.json` and
`coverage-tune2.json`). Acceptance tests: `engine/test/real-coverage.test.ts` (held-out
sets) and the updated thresholds in `engine/test/real-engine.test.ts`.

### Overfitting guard

- **Held-out sets written before any change:** `proof/pairs_holdout.jsonl` (83 new minimal
  pairs, 6 to 9 per family: the nine proof families plus subject_verb, contraction and
  body_article) and `proof/slang_holdout.jsonl` (27 correct street sentences: 7 PR, 7 DO,
  7 CU, 6 CO, 4 explicit). Both were measured before and after.
- **Tuned on the 93 proof pairs and the 26 proof street sentences only.**
- **What the held-out sets did influence, stated plainly:** the held-out fix-generated
  counts were looked at once (offline) half-way, and three changes answer held-out
  failures, each with a matching case in the proof sets: a determiner is re-inflected only
  before its noun phrase (held-out false assert "Las compré en el mercado." -> "La compré",
  +7.0, number rule; proof: "La invité a cenar." got "El invité"), no agreement change next
  to a slang word ("una jeepeta" -> "un jeepeta", +5.3 in street register), and ser/estar
  looks through determiners before a slang predicate ("estuvo una chimba"; proof: "es un
  tíguere").
- **So a second, blind held-out set** (`proof/pairs_holdout2.jsonl`, 36 pairs, 3 per
  family; `proof/slang_holdout2.jsonl`, 10 street sentences) was written after the code and
  run once, at the end, with no change after it. Its numbers are the cleanest estimate.

### Results

| set | asserted (exact fix) | flagged with the exact fix | fix generated | right rule | false asserts | false hints |
|---|---|---|---|---|---|---|
| 93 proof pairs (tuning) | 64 (57) -> **74 (70)** | 67 -> **83** | 76 -> **92** | 73 -> **86** | 0 -> **0** | 2 -> **1** |
| 83 held-out pairs | 50 (43) -> **67 (64)** | 46 -> **69** | 51 -> **76** | 48 -> **70** | 1 -> **0** | 3 -> **3** |
| 36 blind held-out pairs (after only) | **32 (31)** | **33** | **36** | **34** | **0** | **0** |

An assert with an equally correct sentence that is not the listed one counts as wrong
above: proof 3 ("Te quiero ver mañana.", "Lo estoy leyendo ahora.", "¿Me puedes
ayudar?"), held-out 1 ("Voy a comprarlo mañana." for "Lo voy a comprarlo mañana."), blind
1 ("Lo quiero comprar."). The asserts with a wrong fix: proof 1 ("Tengo que terminar esto
por mañana." -> "por la mañana", +4.5), held-out 2 ("Visité el médico ayer." ->
"Visitaba el médico ayer.", +6.7, aspect over the personal a at +3.7; "Vi la ayer en el
parque." -> "Vi ayer en el parque.", +7.0, article delete), blind 0.

Per family (before -> after):

| proof family | n | asserted, exact fix | flagged, exact fix | fix generated | right rule | false asserts / hints |
|---|---|---|---|---|---|---|
| ser_estar | 10 | 7 -> 7 | 9 -> 9 | 10 -> 10 | 9 -> 9 | 0/1 -> 0/1 |
| por_para | 10 | 8 -> 8 | 8 -> 8 | 10 -> 10 | 8 -> 8 | 0/1 -> 0/0 |
| gender | 10 | 8 -> 8 | 10 -> 10 | 10 -> 10 | 10 -> 10 | 0/0 -> 0/0 |
| number | 10 | 4 -> 8 | 4 -> 9 | 4 -> 10 | 6 -> 9 | 0/0 -> 0/0 |
| preterite_imperfect | 10 | 7 -> 7 | 10 -> 10 | 10 -> 10 | 10 -> 10 | 0/0 -> 0/0 |
| subjunctive_wish | 10 | 7 -> 7 | 8 -> 9 | 9 -> 10 | 8 -> 9 | 0/0 -> 0/0 |
| personal_a | 12 | 7 -> 10 | 8 -> 11 | 9 -> 12 | 8 -> 11 | 0/0 -> 0/0 |
| articles | 10 | 3 -> 8 | 3 -> 9 | 3 -> 9 | 4 -> 9 | 0/0 -> 0/0 |
| pronoun_placement | 11 | 6 -> 7 | 7 -> 8 | 11 -> 11 | 10 -> 11 | 0/0 -> 0/0 |
| **all** | 93 | **57 -> 70** | **67 -> 83** | **76 -> 92** | **73 -> 86** | **0/2 -> 0/1** |

| held-out family | n | asserted, exact fix | flagged, exact fix | fix generated | right rule | false asserts / hints |
|---|---|---|---|---|---|---|
| ser_estar | 7 | 5 -> 5 | 5 -> 5 | 7 -> 7 | 5 -> 5 | 0/0 -> 0/0 |
| por_para | 6 | 6 -> 6 | 6 -> 6 | 6 -> 6 | 6 -> 6 | 0/0 -> 0/0 |
| gender | 6 | 5 -> 5 | 6 -> 6 | 6 -> 6 | 6 -> 6 | 0/0 -> 0/0 |
| number | 6 | 5 -> 5 | 5 -> 5 | 5 -> 5 | 5 -> 5 | 0/0 -> 0/0 |
| subject_verb | 7 | 0 -> 5 | 0 -> 5 | 0 -> 6 | 0 -> 5 | 0/0 -> 0/0 |
| preterite_imperfect | 6 | 5 -> 5 | 5 -> 5 | 5 -> 5 | 5 -> 5 | 0/0 -> 0/0 |
| subjunctive_wish | 6 | 5 -> 5 | 6 -> 6 | 6 -> 6 | 6 -> 6 | 0/0 -> 0/0 |
| personal_a | 9 | 5 -> 7 | 5 -> 7 | 5 -> 8 | 5 -> 7 | 0/2 -> 0/2 |
| articles | 7 | 2 -> 6 | 2 -> 6 | 3 -> 7 | 2 -> 6 | 0/1 -> 0/1 |
| contraction | 7 | 0 -> 6 | 0 -> 7 | 0 -> 7 | 2 -> 7 | 0/0 -> 0/0 |
| body_article | 7 | 0 -> 4 | 0 -> 4 | 0 -> 4 | 0 -> 4 | 0/0 -> 0/0 |
| pronoun_placement | 9 | 5 -> 5 | 6 -> 7 | 8 -> 9 | 6 -> 8 | 1/0 -> 0/0 |
| **all** | 83 | **43 -> 64** | **46 -> 69** | **51 -> 76** | **48 -> 70** | **1/3 -> 0/3** |

The three held-out false hints (unchanged, all below 3 nats): "Busco las llaves." ->
"Busco llaves." (2.9), "Visité al médico ayer." -> "Visitaba" (2.9), "Mi hermana es
enfermera." -> "es una enfermera" (1.1). The remaining proof false hint is the proof's own
wrong-way pair ("La fiesta es en mi casa" -> "está", 1.3).

**Street register** (street prefix naming the slang, `register: 'street'`; a slang word is
a word of a slang form found as a run of words, or an inflected form of a single-word
entry of the sentence's regions):

| street set | asserts | hints | variants on a slang word | slang words shaded |
|---|---|---|---|---|
| 26 proof sentences (tuning) | 2 -> **0** | 1 -> 1 | 0 -> 0 | 0 -> 0 (40 -> 52 slang words recognized) |
| 27 held-out sentences | 5 -> **0** (1 before the determiner change) | 2 -> 0 | 0 -> 0 | 0 -> 0 |
| 10 blind held-out sentences | **0** | 0 | 0 | 0 |

The held-out street asserts before: four ser/estar before a slang predicate ("estuvo
brutal" -> "fue brutal" +5.3, "estuvo jevi" +3.9, "estuvo bárbara" +3.8, "estuvo una
chimba" +6.8) and one gender change of the determiner of a slang noun ("una jeepeta" ->
"un jeepeta", +5.3). Before the round the generator also proposed changes to the
determiner of other slang nouns ("la guagua" -> "el guagua", "una chimba" -> "un chimba");
it proposes none now. (The before run counted touches with the old word-level exemption,
which also marked the common words of phrase entries; recounted with slang words as above,
no variant edited a slang word before or after.) The proof street asserts before: "estuvo bacana" -> "fue bacana"
(+5.7) and "que el putas" -> "que putas" (+3.5). The one hint left is "Me voy pa' casa" ->
"pa' la casa" (1.6).

**Cost:** fewer variants per judgement, because variants that break an agreement or turn a
pronoun into an article are no longer made: median 5 -> 3 on the proof pairs (mean 5.0 ->
2.9, max 13 -> 11), 5 -> 3 on the held-out pairs; none dropped by the 16-variant cap. Median
judgement time 0.70 s -> 0.42 s on this shared machine.

### What changed

Rules are data in `engine/src/lang/es/rules.ts` (29 rules, was 22); the generator in
`engine/src/corrections/variants.ts` gained only language-neutral rule kinds and fields
(`engine/src/lang/types.ts`):

- **Subject-verb agreement** (`AgreeRule`, new kind `agree`): the verb takes the person
  and number of a noun or subject pronoun right before it, through no, object pronouns and
  adverbs, not after a preposition, a verb or y/o/ni, and not from a noun of time ("Los
  lunes trabajo"); gustar-type verbs agree with the noun after them. Street tolerant like
  number agreement.
- **Agreement that holds is never broken** (`InflectRule.keepAgreement`), and a
  determiner changes only before its noun phrase (`InflectRule.nextPosFor`): "Esas mujeres
  trabaja" no longer becomes "Esa mujeres trabaja", "Las compré" keeps its pronoun.
- **Contractions** (`ContractRule`, new kind `contract`): "a el" -> "al", "de el" -> "del"
  (not before a name); inserts are written contracted ("Voy a cine" -> "al cine", "Veo el
  niño" -> "al niño"); the personal-a delete takes "a" out of "al" (`DeleteRule.fromContractions`:
  "Leo al periódico" -> "el periódico").
- **Articles:** a definite article before a sentence-opening noun with the capital moved
  (`InsertRule.sentenceStart`: "Vida es bella" -> "La vida es bella"), "las" before a
  clock hour after a/desde/hasta/entre, and no article delete before a preposition or
  conjunction ("Invité la a cenar" now asserts "La invité a cenar", +5.7, instead of
  "Invité a cenar", +14.4).
- **Possessive to article with body parts and clothes** (a swap with `beforeLemmas`,
  `afterPos`, `cueWords`, `agreeNext`): "Me lavo mis manos" -> "las manos".
- **Personal a** across an adverb (`InsertRule.afterThroughPos`) and before nadie/alguien.
- **Pronouns:** neuter "lo" is never an article before a noun
  (`MoveRule.homographNotBeforePos`: "Compro lo mañana" -> "Lo compro mañana"); a
  participle after haber hands its pronouns to haber (`MoveRule.viaAuxiliary`: "He lo
  visto", "Ha visto lo" -> "Lo he visto"); a doubled pronoun loses either copy
  (`MoveRule.doubledWithin`: "Lo estoy leyéndolo" -> "Estoy leyéndolo" / "Lo estoy leyendo").
- **Mood:** the Spanish pack reads a noun/verb homograph after que, si, cuando... as the
  verb, so "que estudio" gets "que estudie".
- **Slang:** ser/estar skips a slang predicate through adverbs and determiners
  (`SwapRule.notBeforeSlang`); inflected slang (bacana, panas, bregamos) is protected in
  corrections and exempt from heat through its lemma; heat also exempts entries of other
  packs that list the region (vaina for PR). Register packs: PR "qué es la que hay",
  janguiar, cabrona, bellaquear, chingar, mamabicho; DO "un chin" (phrase), güevo, totito;
  CU cojones, templar, bollo, singao; CO man, putas (as in "el putas"), hijueputa,
  malparido, güevón; shared pela'o, joder, jodío, mierda, culo, puta. Every vulgar entry is
  explicit; none is on the slur list.
- **Explanations** (en-es): `es.verb_agreement`, `es.contraction`, `es.body_article`,
  `es.pronoun_double`.

### Open issues

1. **Lexicon gaps cost held-out fixes:** cortar, cepillar, mudar(se), extrañar, ladrar,
   fascinar, sobrar, apetecer and chaqueta are not in the lexicon, so "Me corté mi pelo",
   "Me cepillo mis dientes", "Los perros ladra", "Extraño mucho mi abuela" get no variant.
   The body-part and gustar lists hold lexicon lemmas only.
2. **A participle used as an adjective** ("Las ventanas están abierta") is a verb form to
   the analyzer, so the number rule does not see it.
3. **Wrong-fix asserts on incorrect sentences:** the article delete before an adverb ("Vi
   la ayer" -> "Vi ayer", +7.0), an aspect variant over the personal a ("Visité el médico"
   -> "Visitaba el médico", +6.7), "por mañana" -> "por la mañana" (+4.5, a meaning
   change). The tie rule does not catch them (margins more than 1 nat apart).
4. **Model-limited pairs** (the fix is generated, the model barely prefers it or not at
   all): "Ellos quiere comer" (0.6), "Deseo que eres" (0.7), "Visitamos nuestros primos"
   (-0.4), "Hoy la sopa es fría" (0.2), "El concierto está a las nueve" (-0.2).
5. "Español es fácil" gets no article: español is read as an adjective at the sentence
   start.
6. `slangExemption` sees one segment at a time, so every word of a phrase entry is exempt
   from heat wherever it appears in that region's street text ("qué es la que hay" exempts
   que, la, es, hay); corrections match phrases as runs. A text-aware exemption would fix
   it.

## Answer speed, lemma credit and session robustness (2026-11-16)

Same model (Qwen3-1.7B Q4_K_M) through its own `proof/model_server.py` (2 threads) while
another model server and other agents' jobs shared the 4 cores (load average 7 to 10).
The time per model call was bimodal: 60 to 130 ms (median 88 ms) when the server had its
cores, 2 to 7 s when it was starved, in about half of the steps. So call counts below are
exact, measured seconds are upper bounds, and "typical" seconds are the calls times the
unstarved median (88 ms per scoring or next-token call; generation not included).
Scripts in `proof/engine-measure/`: `session-calls.ts` + `calls-summary.py` (calls per
session step), `credit-lemma.ts` + `credit-summary.py` (cliff credit), `bench.ts` (the
engine's own hot paths). Raw results: `results/session-calls-{before,after}-{mock,real}.json`,
`results/credit-lemma-{before,after}.json`, `results/bench-{before,after}.json`. "Before"
is the working tree with this round's files restored from commit 20ca71a (other agents'
changes, such as story generation, are in both).

### Verdict (plain language)

- **A cliff answer no longer repeats the next-word search.** `scoreCliffAnswer` takes the
  alternatives `cliffPositions` already found (`CreditOptions.alternatives`, and
  `actualLogprob` for the story's own word), and both sessions pass them. On the real
  model an answer went from about 20 model calls (1.7 to 1.9 s typical) to 2 to 4 (0.2
  to 0.35 s); a one-word answer that is one of the alternatives, or the story's word,
  costs 0, another word 2 (a score and a boundary call), a multi-word answer 4. Results are identical where
  the alternatives are the same: 111 of 111 cliff answers (probability, credit, reason),
  44 of 44 mock session steps and 35 of 35 real-model session steps.
- **Lemma credit is in, but kept to partial credit, because the analysis cannot tell a
  natural pronoun-less form from a wrong one.** "reír" when the model expects "reírse" is
  natural; "levantar" when it expects "levantarse" ("Juan no quería levantar") is wrong.
  Both have the same lemma and features, similar own probabilities (2e-2 and 7e-4) and
  similar alternatives (0.13 and 0.15): any weight that gives reír full credit gives
  levantar full credit too. The default (`lemmaWeight` 0.02, `lemmaFloor` 2e-5) can lift
  an answer to partial and never to full. At the current partial floor (1e-4) it changes
  no credit of the 111 measured answers; it matters if the floor is raised or the model
  underrates a form (at 5e-4 it keeps reír credited).
- **New finding: the 1e-4 floor credits two pronoun-less wrong forms** (partial, by their
  own probability, before and after this round): "fue a su cuarto a acostar" (5.8e-4; the
  correct acostarse has 9.0e-4) and "Juan no quería levantar" (7.3e-4). The model barely
  tells them apart from natural rare answers (reír 5.6e-4 after "empezó a"), so a floor
  cannot either.
- **Sessions are safe to call at any time.** While an async step waits for the model,
  every other call (the sync ones included) is refused with `refused: 'busy'` and changes
  nothing; reads see the state from before the step; a failed step rolls back.
- **The engine's own work per step got cheaper** where it ran on every step: lexicon
  lookups 15x, slang matching 7x, sentence views 13x, a lyric step with an instant model
  7x (bench below). The largest engine cost left in a story step is candidate selection
  in `story/select.ts` (about 2 ms per sentence on desktop Node).

### 1. Model calls per session step

`session-calls.ts` puts a counting wrapper between the session and the model and books
every call under the step being run. Story: an early learner (`learners.ts`), three
model sentences, one answer per kind on copies of the session restored at each cliff
(the model's best other word, a wrong word, a wrong form of the story's word, the story's
word), then the learner turn and a retell round. Lyrics: four lines of a short song in
street register, the same answer kinds, and a sing-back per line.

Real model, before -> after (mean calls per step, min-max; typical seconds at 88 ms per
call; measured seconds in brackets, upper bounds):

| step | calls before | calls after | typical s before | typical s after | measured s before -> after |
|---|---|---|---|---|---|
| story next (generation + cliff selection + options) | 74.7 (40-93), 1 generate | 74.7 (40-93), 1 generate | 6.5 + generation | 6.5 + generation | 281 -> 368 |
| answer: the model's best other word | 20.3 (6-32) | 2.7 (2-4) | 1.79 | 0.23 | 72 -> 1.3 |
| answer: a wrong word (mesa) | 21.7 (8-34) | 4.0 (4-4) | 1.91 | 0.35 | 67 -> 10 |
| answer: a wrong form (casas, unos) | 21.7 (8-34) | 4.0 (4-4) | 1.91 | 0.35 | 26 -> 8.2 |
| answer: the story's words | 19.7 (6-32) | 2.0 (2-2) | 1.73 | 0.18 | 26 -> 3.8 |
| learner turn (judgeSentence + scoreWords) | 10 | 10 | 0.88 | 0.88 | 38 -> 49 |
| retell round | 0 | 0 | 0 | 0 | 0 |
| lyric next (cliff selection) | 48.0 (31-70) | 48.0 (31-70) | 4.2 | 4.2 | 79 -> 201 |
| lyric answer: the model's best other word | 25.0 (19-33) | 0.7 (0-2) | 2.20 | 0.06 | 42 -> 0.01 |
| lyric answer: a wrong word | 36.7 (21-64) | 12.3 (2-31) | 3.23 | 1.09 | 109 -> 44 |
| lyric answer: the lyric's words | 14.0 (0-23) | 0.7 (0-2) | 1.23 | 0.06 | 55 -> 1.3 |
| sing-back (echo) | 0 | 0 | 0 | 0 | 0 |

The three story cliffs of this run were all two words long ("casa grande" twice, "un
país"), so the story's words were scored (2 calls) and a one-word answer was compared
with the first actual word (2 calls); on a one-word cliff the story's word costs 0 calls
(`actualLogprob`) and an answer among the alternatives 0 (the mock run and
`engine/src/session/answerCalls.test.ts`). The 31-call lyric answer is "mesa" at the slang
cliff "corillo": judged again in neutral form at another context, with its own search.
All 35 steps give the same result before and after (`calls-summary.py before-real:after-real`).

Mock model (`createMockModel`), before -> after: answer steps 17 to 19 calls -> 0 to 4
(mean 0 to 3.5); lyric answers 13 to 18 -> 1 to 6; next, turn, retell and echo
unchanged (57, 10, 0, 0). Every one of the 44 steps gives the same result before and
after (`calls-summary.py before-mock:after-mock`).

Notes:
- Cliff selection is unchanged: `next()` is 1 generate call plus about 4 scoring calls
  and 35 to 87 next-token calls (up to 2 batches of 3 positions, each a next-word search).
  It is the step a prefetch on the landing screen hides (`StorySession.prefetch`).
- Retell and echo make no model call. The learner turn is one judgement (1 plus one call
  per variant) and one `scoreWords` call: 10 calls here.
- A slang cliff whose answer earns less than full credit is also judged in neutral form
  (`scoreLyricAnswer` step 4): another context, so it still makes its own next-word
  search (the 17-call mock lyric answer above).

### 2. Lemma credit

`credit-lemma.ts`: the six cliffs of section 4 (40 natural and 23 wrong answers; "vamos a
casa" natural, as there) and a supplementary set written before the lemma-credit code:
six cliffs where the model is likely to expect a pronominal or clitic form, with 26
natural answers, 12 wrong ones (4 of them pronoun-less forms that need their pronoun:
acostar, sentar, divertir, levantar) and 7 wrong inflections of the story's word (which
should keep the partial 'form' credit). The after run computes each cliff's alternatives
once and passes them in; the before engine searches per answer.

| set | before | after (defaults: lemmaWeight 0.02, lemmaFloor 2e-5) |
|---|---|---|
| section 4 natural | 40/40 credited (16 full) | 40/40 (16 full) |
| section 4 wrong | 0/23 | 0/23 |
| section 4 wrong forms (lee, leyó, leía) | 3/3 'form' | 3/3 'form' |
| lemma set natural | 25/26 (12 full) | 25/26 (12 full) |
| lemma set wrong | 2/12 (partial: acostar, levantar) | 2/12 (the same, by their own probability) |
| lemma set wrong forms | 7/7 'form' | 7/7 'form' |

Sweep over the same alternatives (natural credited / wrong credited, lemma set; section 4
never changes at any weight: 40/40 and 0/23 at floor 1e-4):

| lemmaWeight | floor 1e-4 | floor 5e-4 | floor 2e-3 |
|---|---|---|---|
| 0 (off) | 25/26 (12 full), 2/12 (0 full) | 22/26, 2/12 | 19/26, 1/12 (levantar: 'form') |
| **0.02 (default)** | 25/26 (12 full), 2/12 (0 full) | 23/26 (+reír), 2/12 | 19/26, 1/12 (levantar: 'plausible' via levantarse instead of 'form', both partial) |
| 0.1 | 25/26 (13 full: despertarse via despertar), 2/12 (0 full) | 23/26, 2/12 | 20/26, 1/12 |
| 0.5 | 25/26 (14 full), 2/12 (**1 full: levantar**) | 23/26, 2/12 (1 full) | 20/26, 1/12 (1 full) |
| 1 | 25/26 (15 full), 2/12 (**1 full**) | 23/26, 2/12 (1 full) | 20/26, 1/12 (1 full) |

What the numbers say:
- Lemma credit never touches a wrong inflection: lee, leyó, leía, reía, ríe, duerme,
  entramos, bailaron, levanta, dice keep 'form' (features differ from every alternative).
- The rule cannot separate reír (natural) from levantar (wrong): reír at the payaso cliff
  reaches full credit from weight 0.38 (0.38 x 0.133 = fullFloor), levantar from 0.34.
  The analysis also has no enclitics, so a wrong pronoun ("no pudimos verse" for vernos)
  matches ver as vernos does (not measured; follows from the rule). Hence 0.02: 0.02 x P
  stays below fullFloor 0.05 and 0.02 below fullRatio 0.25, so it can only lift to
  partial, and only from an alternative of at least 0.005.
- "sentarnos" (natural, 3.5e-5) gets no credit before or after: below the floor, and no
  form of sentar among the alternatives (ver has 0.96 there).
- `lemmaFloor` 2e-5: the most likely wrong answer of section 4 has 1.0e-5 ("hacia la
  verde"); pronoun-less forms the model rejects sit far lower (sentar 3.1e-7, divertir
  5.5e-7).

### 3. Session robustness

Choice: **refuse, do not queue.** Every public step method of `StorySession` (`next`,
`handleUtterance`, `command`, `pickOption`, `startRegisterTask`, `played`, `tapWord`,
`revealWord`, `setSettings`) and `LyricSession` (`next`, `openLine`, `handleUtterance`,
`command`, `pickOption`, `startEcho`, `played`, `setRegister`, `setSettings`, `markLine`,
`showSong`) called while an async step runs returns at once `{ screen, events: [],
refused: 'busy' }` (`StepRefusal`) with the screen from before the running step, and
changes nothing. A queued call would land on whatever screen the running step ends on (a
tap on a word of the old sentence, a second "next" after a double tap). Overlapping async
steps used to throw; they are refused the same way now. `isBusy` tells the app
beforehand. `snapshot()`, `screen`, `settings`, `prior` and `stageAt()` read the state
from before the running step, so a snapshot taken while busy restores to that state;
`setModel()` during a step is applied when the step ends; a step that throws (a model
error) restores the state from before it, so the app can retry. `prefetch()` already did
nothing while a step ran.

Tests (`engine/src/session/busy.test.ts`, mock model behind a model that holds its calls):
every call during a pending answer and during a pending next() is refused and leaves the
snapshot unchanged; refusals resolve before the running step; the running step ends
exactly as on a twin session without the interleaved calls; a snapshot taken during
next() restores to a session whose next() gives the same step; a failed step leaves the
snapshot as it was and a retry equals the twin; setModel waits. The app's controller
already serializes its calls (`app/src/session/story/createStoryController.ts`), so
nothing changes for it.

### 4. Small fixes

- `parseLyrics`: an LRC time with seconds of 60 or more (`[99:99.99]`, `<01:75>`) is not
  a time: it is removed from the line and gives none (it used to become 100:39.99).
- `estimateDurationMs('')` (and spaces or punctuation only) is 0 ms (was 150 ms).
- `anchorFormOf` is exported from the corrections barrel. `boundedWords` was already
  reachable from `src/index.ts` (`scoring/index.ts` re-exports all of `wordScores.ts`);
  a test now pins both.
- `proof/score.py`: the start-token comment says what the code does: `token_eos()` is
  `<|im_end|>` (151645) for these GGUFs, not `<|endoftext|>`.

### 5. The engine's own speed (mock and instant models, desktop Node)

`bench.ts`, median ms per call, before -> after (Node 22, same loaded machine, back to
back). Hermes on a phone has no JIT and is often 5 to 10 times slower on code like this.
The "instant model" answers at once (every token -2 nats, a fixed next-token list,
generation from a fixed list), so only engine code is timed.

| case | runs on every step | before | after |
|---|---|---|---|
| pack.analyze, 40 sentence words (warm) | yes | 0.224 | 0.015 |
| pack.analyze, first use on a new pack (cold) | no | 9.207 | 8.537 |
| pack.segment, 8 sentences | yes | 0.053 | 0.052 |
| pack.inflect, 40 analyses | yes | 0.611 | 0.530 |
| generateVariants, 8 sentences | learner turn | 3.604 | 2.412 |
| judgeSentence (mock model included), 1 sentence | learner turn | 4.417 | 5.016 |
| scoreWords (mock model included), 1 sentence | learner turn | 0.846 | 0.919 |
| slangIn + scoringContext (street), 1 sentence | yes | 0.101 | 0.013 |
| findSlangMatches, 8 sentences | yes | 1.053 | 0.157 |
| sentenceWords, 8 sentences | yes | 4.418 | 0.350 |
| buildSentenceView, 8 sentences | yes | 0.220 | 0.207 |
| estimateVocabulary (frequency list) | yes | 0.437 | 0.401 |
| chooseTargets | yes | 0.343 | 0.303 |
| parseLyrics, 35 source lines | no | 0.389 | 0.344 |
| StorySession canned: next + answer | yes | 1.447 | 0.818 |
| StorySession mock (mock model included): next + answer | yes | 97.669 | 84.394 |
| instant model: StorySession next (sentence) | yes | 11.612 | 8.560 |
| instant model: StorySession answer | yes | 1.375 | 0.438 |
| instant model: StorySession learner turn | yes | 0.875 | 0.896 |
| instant model: LyricSession next + answer | yes | 37.243 | 5.258 |
| LyricSession mock (mock model included): next + answer | yes | 72.870 | 30.316 |

What changed:
- The Spanish analyzer keeps the analyses of up to `DEFAULT_ANALYZE_OPTIONS.cacheSize`
  (20000) words and returns copies (normalization, the clitic and accent-insensitive
  searches and the duplicate check ran on every lookup; the vocabulary line alone walks
  the 1788-lemma frequency list).
- `slangIn` and `slangExemption` segmented every entry of every register pack on every
  call; the segmented forms are now kept per language pack and register pack.
- `findSlangMatches` rebuilt its index of the register packs on every call (every
  sentence view, selection candidate and answer); it is now built once per pack and
  option set. `sentenceWords`, `registerPairs`, `slangNotes` and the lyric cliffs use it.
- Results are unchanged (`src/lyrics/lookupCache.test.ts`; full suite).

Left (not in this round's files): `story/select.ts` candidate checks (`rejectReasons`,
`detectPromptLeak`, `normalizedWords` segment each candidate several times: about 2 ms of
the 3.5 to 9 ms of a story next() with the instant model), `handoverStage` (0.6 ms, twice
per next()), `generateVariants` (0.3 to 1 ms per sentence; once per learner turn).

### Open issues

1. The partial floor credits pronoun-less forms that need their pronoun (acostar,
   levantar: partial). Neither the floor nor lemma credit can separate them from natural
   ones (reír); a pack list of verbs whose pronoun is optional, or required, in the
   language pack would let lemma credit give full credit to the first and nothing to
   the second.
2. `Analysis` has no field for enclitics, so lemma credit cannot check the pronoun's
   person (verse vs vernos).
3. A multi-word answer still costs 4 calls (the answer and the actual words, each with a
   boundary call); computing the actual words' log-probability at cliff selection (which
   a prefetch hides) would make it 2.
4. Slang answers judged in neutral form still make their own next-word search.
5. `story/select.ts` is the largest engine cost left in a story step (see section 5).

## Story generation at every level (2026-11-16)

Next-sentence generation (`engine/src/story/`, the hand-over and prefetch in
`engine/src/session/`) measured on Qwen3-1.7B Q4_K_M through `proof/model_server.py`
(`--threads 2`, port 8771) on the shared 4-core machine. Other agents ran servers, test
suites and a headless browser at the same time: the load average was 2 to 16 and mostly
8, so the seconds below are upper bounds that move by a factor of three between runs.
The token counts (prompt tokens prefilled, tokens decoded) do not depend on the load and
are the basis of the phone estimate. Scripts in `proof/engine-measure/`: `learners.ts`
(the simulated learners), `prompt-explore.ts` (formats), `generation.ts` (before and
after over a running story), `generation_table.py` (the tables below),
`session-prefetch.ts` (prefetch on the real model). Raw results in
`proof/engine-measure/results/`: `prompt-explore*.json`, `generation-before.json`,
`generation-after-v1.json`, `generation-after.json`, `generation-after-v*-partial.log`,
`session-prefetch-early.json`.

### Verdict (plain language)

- **Zero knowledge always has a next step, and the brand-new learner now gets real
  sentences.** Before: 0 of 4 in band, and the chosen sentences included "El." and "La.".
  Now the learner hears the 8-sentence starter story and then generates on a bridge
  vocabulary (the starter's words, cognates and introduced words count as known): 7 of 8
  steps in band, 4 of 8 using the new word, no placeholder; one step gave no sentence,
  which the session covers with unused canned sentences (never an error screen, never an
  early repeat; unit-tested with a model that writes only junk).
- **The other learners land in the band on their own knowledge in 28 of 32 steps** (early
  7/8, reader 7/8, advanced 6/8, heritage 8/8), against 8 of 16 before when the chosen
  sentence is re-checked with today's rejects.
- **Target words are used**: 23 of 40 steps against 4 of 20 before. The tagged
  continuation prompt ("[word] sentence" lines, ending with the target as the next tag)
  is what did it; asking for the word in an instruction or a header line rarely worked.
- **No junk is chosen**: 0 of 40 chosen sentences fail the new rejects, against 6 of 20
  before ("Ella _.", "El señor de las frutas...", "El romántico del día es el que...").
  Every reject reason is counted per step.
- **But a running story drifts into empty patterns.** Over eight sentences the model
  copies the previous line's frame; repeats are the largest reject count everywhere, 4 of
  40 steps ended without a sentence, and some accepted sentences are fluent and in band
  but empty ("La cosa es la casa.", "El hombre es el único.", "El grupo puede tener un
  concierto."). The early learner's story is the weakest; the reader's drifted from the
  market into first-person job stories. This is the main open issue (section 7).
- **Cost**: about 80 to 230 prompt tokens and 50 to 110 decoded tokens per sentence, plus
  1 to 3 short scoring calls: about 5 to 8 s per generated sentence on a phone-class CPU
  (the proof's 4-desktop-core speeds), close to before. On this shared machine at
  `--threads 2` a step took 27 to 34 s at load 8 and 6 to 10 s at load 2 to 5.
  `StorySession.prefetch` runs the step while the learner is on the landing screen, so
  next() returns at once when nothing changed in between.
- **Language-neutral**: every prompt word, example, region name, leak pattern, meta word,
  label and abbreviation now lives in the pack (`LanguagePack.story`,
  `LanguagePack.abbreviations`); the Japanese toy pack gets no Spanish prompt.

### 1. Prompt formats on the real model

Every format is plain continuation, the way `/generate` and llama.rn completion work.
Candidates were cleaned with the engine's `extractSentence` and judged with its
`evaluateCandidate` ("in band" on the learner's own pKnown). Profiles as in
`learners.ts`; n = 4 or 6 candidates per seed, one or two seeds (12 candidates at most
per cell). The brand-new target was "que" (the first frequent lemma outside the starter's
words), the early one "viejo"; the reader's "conque" and the advanced and heritage
learners' "violento" were the practice and review targets of the old chooseTargets.

| format | brand new | early | reader / advanced / heritage |
|---|---|---|---|
| F0, the instruction prompt this replaces ("Escribe la siguiente oración...", "Siguiente oración:") | 0/4 in band; 2 of 4 empty, the rest long | 1/4 in band, and that one is "Ella _."; 2 of 4 empty | 2/8, 1/8, 3/8 in band; empty answers and "Marta se _ _ _" templates; no target used |
| F2/F4, header + story one sentence per line (+ "Palabra nueva: X") | real sentences, 0 targets; "Marta tiene un teléfono." 2 times in 4 | 2/8 in band, target 2/8 | 4/8, 3/8, 0/8 in band; target 0, 3/8, 0 |
| F6/F7, the next line announced ("Siguiente frase, con la palabra «X»" / "Una frase corta con «X»") | F6: target 4/4, but 0/4 in the length range; F7: target 0/8 | F6: target 2/4, 0/4 in band; F7: target 0/8 | (not run: 10 to 14 s per call, the longest outputs) |
| F9/G2, tagged lines ("[word] sentence"), prompt ends with "[target]" | 5/8 used "que", as "¿Qué?" or "Que es." (a function-word tag) | target 8/8 and 10/12; in band 0/8 and 3/12 | 5/8, 2/8, 6/8 in band; target 0, 0, 4/8 |
| G1, tagged lines + level header + vocabulary line (kept) | 0/12 (target "que") | in band 4/12 (8/12 counting familiar words), target 12/12, in the length range 12/12 | reader 8/12 in band |

What decided it: only the tagged lines made the model use a content-word target reliably
(12 of 12 for "viejo" against 2 of 8 with a "Palabra nueva" line); the vocabulary line
raised the early learner's in-band share (4 of 12 against 3 of 12 without it, 8 of 12
against 3 of 12 counting familiar words) and kept every candidate in the length range; a
function-word target as the tag fails, so the bridge introduces content words; a
sentence-start cue (the character's name, F3) gave the least variety (one sentence 3
times in 4). The second exploration run (`prompt-explore-b.json`) used seeds 1 and 2 with
n = 4, which share three completion seeds, so its distinct counts are low by
construction; the later runs spaced the seeds.

### 2. Before and after: eight sentences in a row per simulated learner

Each learner starts from its own opening (the brand-new learner from the starter story it
has just heard) and generates one sentence after another, the chosen sentence appended to
the story; one target per sentence (`newWordsPerSentence` is below 1.5 at every level
here), the last three targets excluded, as in the session. Seeds 1, 1001, ... per step.
"Before" is the engine of commit 29a1cdb (the instruction prompt, n = 4 as in the last
round) and ran 4 sentences per learner, because a step took 20 to 60 s under load;
"after" ran 8. "In band" is selection's judgement (for the brand-new learner after the
change, on the bridge vocabulary); "on own pKnown" re-checks the chosen sentence on the
learner's own pKnown with today's rejects. "Chosen junk" counts chosen sentences that
today's rejects refuse. The phone estimate converts the tokens with the proof's speed
table for 4 desktop cores (prompt processing 124 tokens/s, generation 15.4 tokens/s;
about 12 prompt tokens per natural-score call).

before (2026-11-16T01:20, load 3.5, 7.1, 8.2):

| learner | runs | in band | on own pKnown | target used | distinct | no sentence | chosen junk | rejects | s / call (mean, max) | calls (gen + score) | tokens (prompt + decode) | phone estimate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| brand new | 4 | 0/4 | 0/4 | 2/4 | 4 | 0 | 2 | repeat 13, empty 5 | 38.5, 57.11 | 2 + 0 | 204 + 111 | 8.9 s |
| early (~300) | 4 | 1/4 | 0/4 | 0/4 | 3 | 1 | 1 | empty 13, repeat 5 | 17.1, 29.01 | 1.75 + 0 | 164 + 70 | 5.9 s |
| reader, weak speaking | 4 | 3/4 | 1/4 | 0/4 | 3 | 1 | 2 | repeat 7, empty 5, prompt_leak 2 | 12.3, 22.76 | 1.25 + 0 | 141 + 104 | 7.9 s |
| advanced | 4 | 4/4 | 4/4 | 0/4 | 4 | 0 | 0 | empty 8, repeat 3 | 7.3, 9.11 | 1 + 0 | 137 + 69 | 5.6 s |
| heritage | 4 | 4/4 | 3/4 | 2/4 | 4 | 0 | 1 | repeat 4, empty 2, prompt_leak 1 | 9.1, 9.51 | 1 + 0 | 113 + 90 | 6.8 s |

- brand new: "El." / "La familia de Marta va a un restaurante." / "Era un momento perfecto." / "La."
- early (~300): "Ella _." / (none) / "Marta compra todo lo que necesita." / "La semana pasada, Marta y su hermano fueron al mercado."
- reader, weak speaking: "El señor de las frutas..." / "El señor de las frutas se puso muy rojo." / "Aunque el señor de las frutas se puso rojo, no se iría de la tienda sin..." / (none)
- advanced: "El señor de las frutas era un hombre de cuarenta años, alto y de ropa negra." / "La niña se acercó a la puerta y empezó a leer la nota." / "El señor de las frutas se puso de pie y se acercó a la niña, mostrando un libro." / "Señor de las frutas se acercó a la niña y le mostró un libro."
- heritage: "El cocinero de la abuela era un hombre muy amable." / "La abuela cocinaba un plato sólido y rico el domingo." / "El romántico del día es el que..." / "¿Habla el romántico del día?"

after (2026-11-16T03:27, load 8.8, 8.1, 8.1):

| learner | runs | in band | on own pKnown | target used | distinct | no sentence | chosen junk | rejects | s / call (mean, max) | calls (gen + score) | tokens (prompt + decode) | phone estimate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| brand new | 8 | 7/8 | 0/8 | 4/8 | 7 | 1 | 0 | repeat 20, unnatural 1, placeholder 1, no_verb 1, unbalanced_quotes 1 | 27.4, 38.26 | 1.25 + 2.25 | 227 + 63 | 6.1 s |
| early (~300) | 8 | 7/8 | 7/8 | 3/8 | 7 | 1 | 0 | repeat 29, too_short 1 | 32.6, 59.53 | 1.5 + 1.63 | 224 + 53 | 5.4 s |
| reader, weak speaking | 8 | 7/8 | 7/8 | 6/8 | 8 | 0 | 0 | repeat 11, too_short 5, no_verb 1 | 34.3, 53.31 | 1.13 + 2.88 | 109 + 95 | 7.3 s |
| advanced | 8 | 6/8 | 6/8 | 3/8 | 6 | 2 | 0 | repeat 24, too_short 5, no_verb 5, unbalanced_quotes 3, empty 3 | 32, 46.34 | 1.38 + 2 | 129 + 108 | 8.2 s |
| heritage | 8 | 8/8 | 8/8 | 7/8 | 8 | 0 | 0 | repeat 17, too_short 1, list 1 | 28.6, 40.63 | 1.13 + 2.25 | 82 + 73 | 5.6 s |

- brand new: "La familia está en el restaurante." / "El grupo está en el restaurante." / "El grupo toca la guitarra." / (none) / "El grupo dice: "¡Música importante!"" / "El grupo tiene un concierto." / "El grupo hace un concierto." / "El grupo puede tener un concierto."
- early (~300): "El viejo está en la casa." / "El hombre está en la casa." / "El hombre es el nacional." / "La cosa es la casa." / "La parte es la casa." / "La vez es la casa." / (none) / "El hombre es el único."
- reader, weak speaking: "Yo, el otro día, ayudé a un hombre a encontrar un trabajo." / "También, en la tienda de ropa, ayudé a un cliente a elegir un vestido." / "También, en un parque, ayudé a un niño a caminar." / "También, en el año 2003, ayudé a un hombre a encontrar un trabajo." / "Puedo ayudarte a encontrar trabajo o a elegir ropa." / "También, en la plaza, ayudé a una señora a encontrar un par de zapatos." / "También, en el año 2012, ayudé a una persona a llegar hasta su casa." / "¿En qué año ayudaste a alguien a encontrar trabajo?"
- advanced: "El señor de las frutas estaba en la puerta, pero no le hacía caso." / "Marta se acercó a la puerta del mercado y se detuvo." / "Marta se detuvo y empezó a leer la nota." / "Se puso de pie y empezó a leer la nota en voz alta." / "El señor de las frutas se acercó lentamente." / (none) / (none) / "Marta, al ver al señor de las frutas, se puso de pie."
- heritage: "El coche del abuelo está en el garaje." / "El gas del abuelo estaba en la cocina." / "La geografía está en la mesa." / "El gimnasio está en el segundo piso." / "El horario del abuelo es a las 10." / "El gas del abuelo está en el cuarto." / "El profesor de geografía es el profesor de ciencias." / "El gimnasio de la escuela es el mismo que el del abuelo."

Over all learners: target use 4 of 20 before, 23 of 40 after; chosen sentences that
today's rejects refuse: 6 of 20 before, 0 of 40 after; steps without a sentence: 2 of 20
before, 4 of 40 after (the session covers those with canned sentences). The seeded
variety term (`varietyJitter`) and the seeded order of the vocabulary line were added
after this run, from the real-model test (section 3, item 5); they reorder only
candidates within a point of each other and change the vocabulary line's order.

### 3. What the intermediate runs showed

The first version of the new pipeline (`generation-after-v1.json`) already put every
learner but the heritage speaker in band in 6 to 8 of 8 steps, but a running story
locked into one pattern: each new line copied the previous one ("El viejo está en la
casa." / "El claro está en el claro." / "El nacional es el de la casa."), every candidate
became a near repeat (35 repeat rejects in 8 early steps), and the safe round, tagged
with the main character at a lower temperature, repeated it again: 2 of 8 early steps
and 3 of 8 heritage steps ended without a sentence. Five more rounds of changes, each
from a failure seen in the logs (`generation-after-v*-partial.log`, stopped once the
failure showed):

1. The safe round takes a fresh known word as its tag and runs hotter (temperature 1).
   It moved the story on, into nonsense the band cannot see: "El tener es la casa.", "El
   más es el que es más.", "El grupo está ver.". Scored after the story, such sentences
   sit at -4.1 to -6.2 nats per token against -1.9 to -2.9 for fluent beginner sentences
   (one fluent outlier at -4.2; per word the two groups overlapped), so the natural score
   is now per token, enters the ranking with weight 1, and rejects a candidate below -4.4
   (unnatural: 6 of 10 degenerate sentences, 0 of 10 fluent ones); the natural pass runs
   before the safe-round decision.
2. Tags of story lines avoid their first two words (the model started every sentence
   with its tag: "El viejo...", "El claro..."); a short sentence that uses one content
   word twice is a repeat ("El viejo es el viejo.", "El único es el único." pass the
   natural floor because the repetition is predictable); a candidate that holds a recent
   sentence whole is a repeat ("Marta dice que el grupo toca la guitarra y el piano.").
3. The safe tag is a noun: a verb or adverb tag gave "El hombre es estar." and "El hombre
   es la vez." (-2.1 to -2.8 nats per token: fluent to the model).
4. With noun tags the early story still ran "El hombre es el nacional." / "El hombre es el
   único." / "El hombre es el día." / "El hombre es el año.": fluent, under the
   near-repeat thresholds, and empty. A candidate that opens with the same three words as
   one of the last two sentences is now a repeat (`sameOpening`). The final run shows the
   cost: more repeat rejects and 2 of 8 advanced steps without a sentence.
5. In the real-model test all three seeds chose the same bridge sentence ("Marta y su
   familia están en el restaurante."): from one story state the model wrote it in 13 of
   15 candidates. The vocabulary line's order now follows the seed (the prompt changes,
   not its content), which made the candidate sets differ, and a seeded jitter below one
   point (`varietyJitter`) orders near ties; two of three seeds still agree.

### 4. Latency

- **Tokens per step** (the tables above): the new prompts are longer for beginners (the
  header and the vocabulary line: 224 to 227 prompt tokens against 164 to 204) and
  shorter for the others (82 to 129 against 113 to 141). Stopping at the first sentence
  end makes a candidate 12.8 decoded tokens on average against 15.8 with the line-end
  stop, so five candidates (plus a safe round of four in 11 of 40 steps) decode 53 to 108
  tokens per step against 69 to 111 for four candidates before.
- **Prefix reuse**: the target and safe rounds differ only in the last line, and
  `/generate` now reuses the KV cache of the shared prefix (llama.rn does the same with
  its prompt cache), so a safe round prefills only its tag. The phone estimate in the
  tables counts every round's prompt in full, so it is an upper bound.
- **Natural score**: 1.6 to 2.9 scoring calls per step on average (about 12 tokens each after the
  story context; 100 to 180 ms each over HTTP when the machine is quiet).
- **Phone estimate**: 5.4 to 8.2 s per generated sentence at 124 tokens/s prompt
  processing and 15.4 tokens/s generation (the proof's 4 desktop cores; a phone at half
  that speed doubles it), against 5.6 to 8.9 s before. The cliff choice that follows in
  the session (cliffPositions: up to three next-word searches of about 50 calls each)
  costs more than generation and is outside this step; prefetch covers both.
- **This machine**: seconds per call are in the tables; they follow the load (6 to 10 s
  per step in the first after run at load 2 to 5, 27 to 34 s in the final one at load 8).

### 5. Zero knowledge, the hand-over and prefetch

- **Hand-over rule** (`session/handover.ts`, `DEFAULT_HANDOVER_OPTIONS`): a zero-knowledge
  learner hears the pair's starter story (all 8 sentences of `EN_ES_STARTER`); then,
  with a model, generation on the bridge until the learner knows `strictFrom` = 150
  frequency-list lexemes at pKnown >= 0.9; then free generation. On the bridge the band
  counts the starter's taught words, every word of its sentences, the pair's cognates and
  the words introduced so far as known (`familiarCredit` 0.98), the vocabulary line lists
  them, and targets are content words outside them. Why a bridge: the learner model gains
  meaning evidence slowly; a simulated learner who picked the right option at every
  starter cliff and read every word, three times through the starter (24 sentences), had
  one lexeme at 0.8 or above and none at 0.9 (ser 0.63, el 0.63, guitarra 0.82), so no
  generated sentence can be in band on its own pKnown for many sessions.
- **Never stalls or loops early**: with a model, a step that yields no usable sentence
  falls back to unused starter sentences, then unused placement-ladder sentences, then
  the starter again (least recently used). `src/session/handover.test.ts` drives a
  brand-new session whose model only writes junk ("El y de _______.", "¿Qué?", "1. Marta
  compró pan."): 24 cliff screens, no error screen, no repeat. Canned mode (no model) now
  plays the 21 unused ladder sentences after the starter before it cycles (it used to
  repeat the 8 starter sentences from the ninth step on).
- **Prefetch** (`StorySession.prefetch(at)`): runs the next step on a copy of the session
  through a recording view of the model; next(at) recomputes everything and replays the
  answers to identical requests. Same story with or without it (deterministic model),
  nothing prefetched in snapshots, fresh requests after learner or model changes, model
  calls serialized (`ModelGate`); unit tests in `src/session/prefetch.test.ts`.
- **Prefetch on the real model** (`session-prefetch.ts`, early learner, three sentences,
  load 2 to 5): a full session step (generation, cliff positions, distractors) cost 8.5,
  16 and 59 s here (55 to 246 model calls); with the prefetch run on the landing screen,
  next() took 0.01 to 0.02 s with no model call, and both sessions showed the same three
  steps.
- **The real-model test** (`test/real-engine.test.ts`, three seeds from one story state,
  load 2 to 5): early learner 3/3 in band, 3/3 on target, 2 distinct sentences;
  intermediate 3/3, 3/3, 3 distinct; brand new on the bridge 3/3, 3/3, 2 distinct ("La
  familia está en el parque." once, "Marta está con su familia en el restaurante."
  twice). From one identical state the model's likeliest sentence often wins for two of
  three seeds even with the seeded vocabulary order and the variety jitter; the test asks
  for "not one sentence for every seed", the old behaviour ("¿Qué dijo Marta?" every
  time). Within a running story no sentence repeats (the repeat reject).


### 6. Changes made in this step

- `LanguagePack.story` (`StoryLanguageData`, `lang/storyData.ts`) and
  `LanguagePack.abbreviations`; the Spanish values in `lang/es/story.ts`. `story/` holds
  no Spanish (`src/story/neutral.test.ts` reads its literals); the old names
  `SPANISH_PROMPT_TEXT`, `REGION_NAMES` and `DEFAULT_ABBREVIATIONS` are aliases of the
  Spanish data. The Japanese toy pack gets a bare tagged prompt, or its own header when
  it has story data (`test/language-neutral.test.ts`).
- The tagged continuation prompt (`buildStoryPrompt`), the target and safe rounds, the
  natural pass, sentence-end stops, n 5 + 4, maxTokens 2 per word + 4.
- Rejects with counts: placeholder, list, heading, bare_quote, meta, foreign, no_verb,
  too_short, unnatural, and wider repeats (near repeats, contained sentences, a repeated
  content word, a copied opening); selection band first, then target, novelty,
  continuity (story names count as names at a sentence start), natural score, variety.
- `chooseTargets`: `accept`, and practice and review in probability buckets (the
  reader's practice target was "conque", the rarest understood word, by a few
  thousandths).
- Hand-over, bridge, prefetch, `ModelGate`, canned mode through the ladder.
- `proof/model_server.py` `/generate` reuses the KV cache of the prompt prefix shared with
  the previous request (identical texts: checked by repeating a request after one with
  the same prefix and after an unrelated one).
- `test/real-engine.test.ts`: the brand-new `it.fails` is an `it` (on the bridge: real,
  in-band sentences over three seeds, the target used at least once, three different
  sentences); early and intermediate learners must get distinct sentences of their level
  over three seeds, in band at least twice, the target used at least once, with no
  placeholder or prompt word.

### 7. Open issues

1. **Pattern lock-in over a running story** (the largest problem). Qwen3-1.7B copies the
   previous line's frame; with the repeat rejects the step then falls back to the safe
   round or to no sentence (4 of 40), and some accepted sentences are fluent, in band and
   empty. Ideas to measure next: show fewer of the model's own lines (the human-written
   opening or starter lines plus the last one or two generated lines), keep the pack's
   example lines in the prompt as fixed anchors, choose early targets among nouns and
   verbs (adjective targets came out as nouns: "El claro", "El nacional"), and a check
   beyond the per-token natural score, which cannot see "La cosa es la casa." (fluent to
   the model).
2. **Continuity** is only a selection bonus for names and recent content words; the
   reader's market story became first-person job help. A scene line (the builder takes
   one) needs a source: the app or the chapter.
3. **Dialogue is cut by the sentence-end stop** inside the quotation ('El viejo dijo: "No
   tienes que hacer nada.' loses its closing quote and is rejected as unbalanced): the
   largest reject in the real-model test's early runs. A stop that ignores ". " inside an
   open quote needs the runtime's stop handling or a longer stop and a client-side cut.
4. **The simulated learners are static** (no learning between steps), so targets recycle
   (the reader's "ayudar" in 6 of 8 steps) and the band does not move as it would in a
   session.
5. **The advanced learner is judged on the 1788-lemma lexicon**: any word outside it counts
   as unknown, so 2 of 8 advanced steps ended with no in-band candidate.
6. **The bridge** rests on the learner model's slow meaning evidence; `strictFrom` (150
   lexemes at 0.9) is a judgement between the measured profiles. Calibrate both from logs.
7. **The app's prefetch hook** (`app/src/session/story/createStoryController.ts`,
   `prefetch()`, called on the landing and no-sé screens) can now call
   `session.prefetch(at)`; not wired here (app scope).
8. Modules outside `story/` call `splitSentences` / `sentenceStartFlags` without the
   pack's abbreviations (now none by default): "Sr. García" splits there. (Fixed in the
   review: every module passes the pack's list.)

## Engine round 3: review and summary (2026-11-16)

The newest section: what round 3 changed, before and after in one place, with the
held-out figures; the review of the three parallel pieces of work (story generation,
correction coverage, answer speed and session robustness); the bugs the review found and
fixed; and the real-model suites run again in full on the result. Model: Qwen3-1.7B
Q4_K_M through `proof/model_server.py` on port 8774 (`--threads 2`); the machine was
quiet for most of the review (load average 0.3 to 3), so its seconds are closer to the
proof's than the sections above.

### Verdict (plain language)

- **Corrections improved on data they were not tuned on.** On 83 held-out pairs written
  before the work, asserts with the exact fix went from 43 to 64, the one false assert is
  gone, and the blind set written after the code (36 pairs, run once) gives 31 of 36 with
  no false assert and no false hint. Street register: no assert and no slang word touched
  or shaded in any of the three street sets. The review run repeated these numbers.
- **Story generation now works at every level**, with the brand-new learner on a bridge
  after the starter story, but a running story still drifts into empty frames ("La cosa
  es la casa."); that is the main open problem. The review removed one false repeat
  reject that cost the advanced learner two of eight steps (section 4 below).
- **Answers are an order of magnitude cheaper** (about 20 model calls to 0 to 4), and
  sessions refuse rather than corrupt state when called during a model wait. The review
  closed two interleavings that were still unsafe around prefetch.
- **The core stays language-neutral**: the review moved the generation stop strings, the
  last language-specific default of the new code, into the Spanish pack, and made the
  heading and list rejects count words through the pack's segmenter.
- **Everything passes**: `npx tsc --noEmit`, `npx vitest run` (70 files, 1742 tests; the
  three real-model suites skip without a server), and with the server: `npm run
  test:real` 20 of 20, `test/real-engine.test.ts` 7 of 7, `test/real-coverage.test.ts` 2
  of 2. The app against the new engine: `npm run typecheck` clean, `npx jest` 97 suites,
  934 tests passed.

### 1. Before and after, all of round 3

"Before" is the engine of commit 29a1cdb (the end of round 2) unless a cell says
otherwise; "after" is the round's result. Sources: the three dated sections above
(`coverage-*.json`, `generation-*.json`, `session-calls-*.json`, `bench-*.json`).

| area | measure | before | after |
|---|---|---|---|
| corrections, 93 proof pairs (the tuning set) | errors asserted with the exact fix | 57 | 70 |
| | flagged with the exact fix | 67 | 83 |
| | fix generated by a rule | 76 | 92 |
| | false asserts / false hints on the 93 correct sentences | 0 / 2 | 0 / 1 |
| **corrections, 83 held-out pairs** (written before the work) | **asserted with the exact fix** | **43** | **64** |
| | flagged with the exact fix | 46 | 69 |
| | fix generated | 51 | 76 |
| | **false asserts** / false hints | **1** / 3 | **0** / 3 |
| **corrections, 36 blind pairs** (written after the code, run once) | asserted with the exact fix | (not run) | **31** |
| | false asserts / false hints | (not run) | 0 / 0 |
| street register: 26 proof / 27 held-out / 10 blind sentences | asserts | 2 / 5 / (not run) | 0 / 0 / 0 |
| | variants on a slang word, slang words shaded | 0, 0 | 0, 0 |
| | variants per judgement (median, max) | 5, 13 | 3, 11 |
| generation, 5 simulated learners over a running story (before 4 steps each, after 8) | in band on the learner's own pKnown (4 learners with knowledge) | 8 / 16 | 28 / 32 |
| | brand-new learner in band | 0 / 4 ("El.", "La." chosen) | 7 / 8 (on the bridge) |
| | target word used | 4 / 20 | 23 / 40 |
| | chosen sentences that today's rejects refuse | 6 / 20 | 0 / 40 |
| | steps without a sentence (a session fills them) | 2 / 20 | 4 / 40; 2 / 40 with the review's fix (section 4) |
| | decoded tokens per candidate; phone estimate per sentence | 15.8; 5.6 to 8.9 s | 12.8; 5.4 to 8.2 s |
| answer speed, real model (before: commit 20ca71a) | model calls per story answer | 20 to 22 (6 to 32) | 2.0 to 4.0 (0 for an alternative or the story's word) |
| | typical seconds per story answer | 1.7 to 1.9 | 0.18 to 0.35 |
| | model calls per lyric answer, best other word | 25.0 | 0.7 |
| sessions | a step called during a running step | throws | refused: 'busy', nothing changes |
| | next() after a prefetch on the landing screen | 9 to 33 s (a full step) | 0.01 to 0.02 s, no model call |
| engine's own work (instant model, desktop Node, median) | StorySession answer / LyricSession next + answer | 1.375 / 37.2 ms | 0.438 / 5.3 ms |

### 2. The review run

All three real-model suites in full on the reviewed tree (before the review's fixes;
logs in `proof/engine-measure/results/review-real-*.log`):

- `npm run test:real`: 20 of 20 in 71 s. Parity with the proof 1.4e-14 nats; 90 of 93
  pairs (96.8%); at 3 nats 74 caught and 0 false, at 1 nat 88 and 1; one score 108 to
  124 ms, `nextTokens` (k = 20) 124 ms, a judgement with 3 variants 689 ms.
- `test/real-engine.test.ts`: 7 of 7 in 311 s. Judge on the 93 pairs: 74 asserted (70
  with the right fix), 83 flagged with the right fix, 86 right rule; 0 false asserts and
  1 false hint (the proof's own wrong-way pair, "La fiesta es en mi casa esta noche.");
  437 ms per judgement. Street: 0 asserts, 0 variants on slang, 65 slang words (mean
  surprisal 11.5 nats neutral, 5.3 with the street prefix), 0 shaded. Heat: the error or
  the next word at heat 2 or more in 42 of 93; a heat-3 word in 3 of 93 correct
  sentences. Generation (three seeds each): early learner 3 of 3 in band and on target, 2
  distinct ("El viejo está en la casa." twice); intermediate 3 of 3, 3 distinct; brand new
  on the bridge 3 of 3, 2 distinct; 5 to 15 s per call. Top-10 forced decoding: 1 assert
  and 17 bounded judgements over 18 sentences, no assert or credit on a bounded token.
- `test/real-coverage.test.ts`: 2 of 2 in 88 s. Held-out pairs: 64 of 83 asserted with
  the exact fix, 0 false asserts, 3 false hints; held-out street: 0 of 27 asserts.
- After the review's fixes, the generation tests again (`review-real-generation-after-fixes.log`):
  2 of 2. The early and intermediate learners got the same sentences; the brand-new
  learner's changed with the natural pass's new order ("Marta está con su familia en el
  parque.", "Marta está en el parque.", "Marta está con su familia en el restaurante.": 3
  of 3 in band and on target, 3 distinct).
- All three suites once more on the final tree, every review fix included
  (`review-final-real-{model,engine,coverage}.log`): 20 of 20 (73 s), 7 of 7 (289 s), 2 of
  2 (83 s), with the same judge, street, heat, top-10 and held-out numbers as above and
  the generation sentences of the previous item.

### 3. Bugs the review found and fixed

Each has a regression test that fails without the fix.

1. **The safe round's in-band candidate could lose to out-of-band candidates.** The
   natural pass counted every candidate already scored in the first round towards
   `naturalTop`; with three accepted (out-of-band) candidates scored in round one, the
   safe round's in-band candidate was never scored, and the final order put scored
   candidates first. Now the pass walks the accepted candidates in rank order (earlier
   scores count where they rank now) and the final order keeps in-band candidates first.
   `src/story/next.test.ts` ("takes the safe-round in-band candidate even when naturalTop
   first-round candidates were scored").
2. **`introducedKeep: 0` kept every introduced word** (`slice(-0)`).
   `src/session/handover.test.ts`.
3. **`setModel()` during a running prefetch let model calls overlap**: the session got a
   new gate while the prefetch kept calling through the old one, which a runtime with one
   context (llama.rn) cannot take. The old gate is now retired (its next call fails, so
   the prefetch ends; a failed prefetch only costs the replay) and the new gate starts
   after the old one's queue. `test/round3-review.test.ts`.
4. **The spoken "siguiente" (and "listo" between chapters) did not wait for a running
   prefetch** and never dropped its answers; next() did. Both now go through the same
   path. `test/round3-review.test.ts`.
5. **Sentence splitting outside `story/` lost the abbreviations**: round 3 made
   `splitSentences` default to none and moved Spanish's list into the pack, but brought
   text, lyric cliffs, gaps, retell, repair, native replies and sentence views still
   called it without the pack's list, so "Vi al Sr. García en la plaza." became two
   sentences of a brought text. Every module passes `LanguagePack.abbreviations` now.
   `test/round3-review.test.ts`.
6. **Language-specific generation stops in the core**: `DEFAULT_NEXT_SENTENCE_TUNING.stop`
   held ". ", "? ", "! ". The runtime cuts the stop string, and only Spanish gets "?" and
   "!" back (from ¿ ¡); an English pack would end every question with "."; a Japanese one
   never reaches ". ". The stops are pack data now (`StoryLanguageData.stop`, Spanish
   unchanged), the core default is a line break. `test/round3-review.test.ts`.
7. **The heading and comma-list rejects split words on spaces**, and the all-capitals test
   took a caseless script for capitals: a Japanese sentence cut at its stop would be a
   heading, one with three 、 a list. Both count words through the pack's segmenter now.
   `test/round3-review.test.ts`.
8. **A session could leave the band when its only in-band candidate had no plausible
   cliff** (P(actual) below `probFloor` at every rated position): it fell through to the
   next, out-of-band candidate. The last in-band candidate the session will try now takes
   its best rated cliff without the floor (no extra model call); the options rung and "no
   sé" keep a hard cliff fair, a sentence outside the band is not. Found by the new
   running-session simulated learners (`test/simulated-learners.test.ts`).
9. **The copied-opening reject threw out sentences that only share their subject** (next
   section).

### 4. The copied-opening reject on the real model

`sameOpening` (added in round 3) rejects a candidate that opens with the same three words
as one of the last two sentences, to stop frames like "El hombre es el nacional." / "El
hombre es el único.". In the round's own run (`generation-after.json`) the advanced
learner lost steps 5 and 6 to it: its story's character is "El señor de las frutas", and
9 of 9 candidates of step 6 ("El señor de las frutas le pidió un vaso de agua.", "... le
puso una fruta en la mano.", ...) were rejected as repeats only because the last-but-one
sentence also began with him. A copied frame shares its verb; a shared subject does not.
`SelectOptions.sameOpeningNeedsVerb` (default true) now requires the shared opening to
reach a word chosen as VERB or AUX. Same engine, model, learners and seeds, with the old
setting (`CLIFFWORD_SELECT='{"sameOpeningNeedsVerb":false}'`) and the new one
(`proof/engine-measure/results/generation-review-opening-{before,after}.json`):

| learner | setting | in band (own pKnown) | target used | distinct | no sentence | repeat rejects | s / call (mean) | tokens (prompt + decode) |
|---|---|---|---|---|---|---|---|---|
| early (~300) | old | 6/8 | 4/8 | 7 | 1 | 24 | 6.4 | 228 + 57 |
| early (~300) | new | 6/8 | 4/8 | 7 | 1 | 24 | 6.6 | 228 + 57 |
| reader, weak speaking | old | 7/8 | 6/8 | 8 | 0 | 11 | 13.3 | 109 + 95 |
| reader, weak speaking | new | **8/8** | 6/8 | 8 | 0 | 4 | 8.5 | 92 + 73 |
| advanced | old | 6/8 | 3/8 | 6 | **2** | 24 | 11.5 | 129 + 108 |
| advanced | new | **8/8** | **8/8** | 8 | **0** | 12 | 11.1 | 108 + 96 |

Load average 2.4 to 3.0 for both runs. The early learner's story is unchanged step for
step (its frames share their verb, as in "El hombre es único." / "El viejo es el hombre.").
The reader's step 3 no longer needs the safe round. The advanced learner keeps its
character and moves on: "El señor de las frutas le dio a Marta un pedazo de fruta." /
"... le dijo: ..." / "Marta se acercó al señor de las frutas y le preguntó: ..." / "...
se dio la vuelta y se fue." / "Marta se quedó mirando el pedazo de fruta que había
recibido." The new story leans on one object ("pedazo de fruta" in six of eight
sentences): the same content lock-in as open issue 1, now visible instead of hidden
behind empty steps. Over the round's five-learner table this takes the steps without a
sentence from 4 of 40 to 2 of 40 (the brand-new and early learners' one each were not
caused by this reject).

### 5. What the review checked and left as it is

- **Public API**: no exported name was removed or renamed (575 exports against 518 at
  29a1cdb, compared with the TypeScript compiler); the app's 98 imported names all exist
  with compatible types (app typecheck clean, 934 app tests pass). Behaviour changes the
  app must follow are listed in the review's report (refused steps instead of throws,
  prefetch not awaited inside its serial queue, the stop default).
- **Overfitting**: the correction rules and their word lists (body parts, gustar-type
  verbs, time nouns, clock hours, contractions) are general Spanish, and the held-out and
  blind sets carry the claim. The generation thresholds (`naturalFloor` -4.4,
  `selfRepeatMaxWords` 8, `sameOpeningWords` 3, `varietyJitter` 1) rest on 10 to 20 logged
  sentences each; they are documented as judgements to calibrate.
- **Spanish in the core**: none found in `story/`, `corrections/` or `session/` beyond the
  stops above; `src/story/neutral.test.ts` and `test/language-neutral.test.ts` check it.
- **Determinism**: no clock or randomness in the engine; the variety jitter and the
  vocabulary order are seeded hashes; the analyzer and slang caches return copies; a
  repeated real-model run with the old setting reproduced the round's own reader and
  advanced sentences word for word (the early learner's differ by the seeded vocabulary
  order added after that run).
- **Interleavings**: busy refusals, read-only views during a step, rollback on a throw
  and deferred `setModel` hold in both sessions (`src/session/busy.test.ts`); a prefetch
  does not make the session busy, so a step during it runs, and its model calls wait
  behind the prefetch's (one at a time).

### 6. Open issues after round 3

1. **A running story drifts into empty frames** ("La cosa es la casa.", "El grupo puede
   tener un concierto."): fluent, in band and saying nothing. Ideas: fewer of the model's
   own lines in the prompt, fixed anchor lines, a scene line from the chapter, noun and
   verb targets early, a semantic check beyond the per-token natural score.
2. **Cross-seed variety**: from one story state two of three seeds often pick the same
   sentence; within a running story no sentence repeats.
3. **Dialogue is cut by the ". " stop inside a quotation** and then rejected as unbalanced.
4. **A prefetch blocks the model for its whole run** (a full step: generation and up to
   about 150 next-word calls): an answer scored while it runs waits behind it. The app
   should start it only on the landing and no-sé screens, as planned, and not await it
   inside its serial queue.
5. **Correction gaps**: lexicon holes (cortar, cepillar, ladrar, extrañar, chaqueta),
   predicative participles, a subject after the verb, wrong-fix asserts on two held-out
   sentences ("Vi la ayer" -> "Vi ayer", "Visité el médico" -> "Visitaba el médico") and
   one proof sentence ("por mañana" -> "por la mañana").
6. **Credit**: the 1e-4 partial floor credits two pronoun-less wrong forms (acostar,
   levantar); a pack list of verbs whose pronoun is required would fix it.
7. **`slangExemption` exempts every word of a phrase entry** wherever it occurs in that
   region's street text.
8. **The bridge and the learner model's evidence weights** (`strictFrom` 150 at 0.9) need
   learner logs; the simulated learners are static within a measurement.
9. **The app does not call `StorySession.prefetch` yet.**
