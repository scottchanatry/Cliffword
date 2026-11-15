# The engine against the real model

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
   answer that shares a lemma with a likely alternative (reír vs reírse).

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
