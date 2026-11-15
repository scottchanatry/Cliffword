# Step 1 proof test: results

Date: 2026-11-15. Machine: cloud container, 4 CPU cores, 15 GB RAM, no GPU.
Runtime: llama-cpp-python 0.3.37 (CPU build from source), 4-bit Q4_K_M GGUF files.

## Verdict (plain language)

**Yes, probability scoring works for standard Spanish on a small model.** With a
short neutral prefix ("Frase en español:"), both models choose the correct sentence
in 97% of 93 minimal pairs (9 rules). **Use Qwen3-1.7B**: same accuracy as the 4B
model, half the size (1.1 GB) and twice the speed (1.9 s to score a ten-word
sentence plus six variants on 4 cores).

**Thresholds for the engine** (difference in total log-probability, natural log,
"nats", always scored after the same fixed prefix):

| variant beats the learner's sentence by | action | 1.7B on this set |
|---|---|---|
| ≥ 3 nats | mark as an error and show the rule | 80% of errors caught, 0 false flags |
| 1 to 3 nats | soft hint ("did you mean…?"), no red mark | catches 95% total, 1 false flag |
| < 1 nat | treat as acceptable | |

The 95%-precision threshold computed by the spec's method is 0 nats for both
models (3 false flags out of 93), but that rests on very few wrong-way pairs, so the
table above adds a safety margin. Weakest rules: ser/estar, por/para and personal a (90 to 92%).

**What failed or needs a workaround:**

1. **Slang.** Street sentences score about 4.5 nats per word worse than neutral
   paraphrases (0 of 26 street versions win). A register prefix only recovers about
   1.2 nats per word, and only for words the prefix names (janguear 27→1, 'tá 19→7);
   unnamed words (tíguere, pela'o, bregar, parcero) stay very surprising. So street
   mode must not use raw probability for slang: words and clipped forms in the
   region pack must be whitelisted (never shaded, never flagged), and the pack's
   words should go into the scoring prefix.
2. **Localization.** The single most surprising word is the error word (or the
   next one) only 66 to 70% of the time; the top two words contain it 84 to 89% of
   the time. Rare names and the first verb attract surprise; omissions (personal a)
   and ser/estar are worst. Subtracting a word's stand-alone surprisal made it
   worse (30%). For corrections, locate the error from the rule-made variant (we
   know which word the rule changed). For shading, shade softly and expect the top
   two words, not one.
3. **No prefix is much worse**: 85 to 86% accuracy and a 3.5 to 5.5 nat threshold.
   The fixed prefix is required.
4. **Next-word lists for slang openings are useless** (top-10 mass 0.12 for
   "Mano, vamo' a janguear con el …"). Cliffs on slang or lyric lines need answers
   supplied by the pack or the lyrics, not by the model.
5. **Gemma 3n E2B did not run.** The unsloth Q4_K_M file loads, but llama.cpp in
   this build returns all-zero logits and empty generations (tried twice with
   different batch and attention settings). Retest with the llama.rn build before
   ruling it out. The 1–2B slot was filled by Qwen3-1.7B instead.

Caveats: 93 pairs and 26 slang pairs, all written for this test; several of the
wrong-way pairs are arguably acceptable Spanish ("La fiesta está en mi casa",
"Español es fácil"), so the true error rate may be lower. Instruct models were
scored as plain text continuation without chat templates.

## Models

| model | file | size | result |
|---|---|---|---|
| Qwen3-4B-Instruct-2507 | unsloth/Qwen3-4B-Instruct-2507-GGUF, Q4_K_M | 2.5 GB | ran |
| Qwen3-1.7B | unsloth/Qwen3-1.7B-GGUF, Q4_K_M | 1.1 GB | ran |
| Gemma 3n E2B it | unsloth/gemma-3n-E2B-it-GGUF, Q4_K_M | 3.0 GB | downloaded, broken output (see above) |

No downloads were gated or blocked.

## Method

- **Sentence score**: total log-probability of the sentence's tokens given a fixed
  context. Context = start token (BOS, or `<|endoftext|>` for Qwen, which has no
  BOS) plus an optional prefix. Three conditions: no prefix; neutral prefix
  `Frase en español:\n`; street prefix (one line naming Puerto Rican street register
  and the words janguear, corillo, vaina, 'tá, pa).
- **Word surprisal**: each token's −log p is added to the word that contains the
  token's first non-space byte (words = runs of letters and apostrophes, so 'tá
  and pa' are words; punctuation is scored but not assigned to a word).
- **Flag threshold**: each pair gives one real error (learner wrote the incorrect
  sentence; the correct variant beats it by d) and one innocent case (learner wrote
  the correct one; the incorrect variant beats it by −d). Precision at threshold t
  = real flags / all flags with margin > t.
- **Localization hit**: the most surprising word in the incorrect sentence lies in
  the changed span or is the word right after it (for an omission, the word where
  the missing word should be).
- **Slang gap**: per pair, (street log-prob ÷ street words) − (neutral log-prob ÷
  neutral words), averaged.
- **Next-word method (for the engine to reuse)**: run the opening (after the
  neutral prefix) and take the 60 most likely tokens that start a new word (leading
  space then a letter). Each is a partial word with probability p. Then, up to 4
  pieces deep, run the model on opening + pieces and split the next-token
  distribution in two: the mass of tokens that end the word (space, punctuation,
  newline, end of text) is added to that word's total (p × end mass); tokens that
  continue the word (start with a letter, apostrophe or non-ASCII byte) extend the
  partial word with probability p × q. Partial words below 0.001 are dropped, at
  most 30 are kept per level, and at the depth limit the remaining mass is credited
  to the partial word. Identical spellings reached by different splits are summed.
  This gives P(word, then a word boundary), so "fr" does not steal credit from
  "frío". Cost: 8 s per opening for 1.7B (about 60 model calls); the engine should
  reuse the KV cache of the opening, which these scripts did not do.

## Files

- `pairs.jsonl`: 93 minimal pairs (ser_estar 10, por_para 10, gender 10, number 10,
  preterite_imperfect 10, subjunctive_wish 10, personal_a 12, articles 10,
  pronoun_placement 11).
- `slang.jsonl`: 26 Caribbean/Colombian street sentences with neutral paraphrases,
  region and explicit flag.
- `score.py`: runs one model, writes `raw_<model>.json`.
- `localize.py`: frequency-baseline localization experiment (adds `loc2`).
- `analyze.py`: builds the tables below from the raw files.

Reproduce: `pip install llama-cpp-python numpy`, download the GGUF files outside the
repo, then `python score.py MODEL.gguf raw_x.json`, `python localize.py MODEL.gguf
raw_x.json`, `python analyze.py raw_*.json`.

## Localization with a frequency baseline (failed idea)

Surprisal minus λ × the word's stand-alone surprisal after the neutral prefix.


**Qwen3-4B**: λ=0.0: 66%, λ=0.5: 45%, λ=1.0: 30%

**Qwen3-1.7B**: λ=0.0: 70%, λ=0.5: 44%, λ=1.0: 27%


# Detailed tables

## Summary

| model | accuracy | t for 95% precision | recall at t | localization | slang gap/word (neutral → street prefix) |
|---|---|---|---|---|---|
| Qwen3-4B-Instruct-2507-Q4_K_M.gguf | 97% | 0.0 | 97% | 66% | -4.44 → -3.20 |
| Qwen3-1.7B-Q4_K_M.gguf | 97% | 0.0 | 97% | 70% | -4.61 → -3.43 |

## Qwen3-4B-Instruct-2507-Q4_K_M.gguf

### Accuracy (correct sentence scores higher)

| rule | n | no prefix | neutral prefix | street prefix | per-token mean (neutral) | localization top-1 | localization top-2 |
|---|---|---|---|---|---|---|---|
| ser_estar | 10 | 90% | 90% | 100% | 90% | 40% | 70% |
| por_para | 10 | 90% | 100% | 100% | 100% | 40% | 70% |
| gender | 10 | 80% | 100% | 100% | 100% | 80% | 100% |
| number | 10 | 100% | 100% | 100% | 100% | 90% | 100% |
| preterite_imperfect | 10 | 90% | 100% | 90% | 80% | 80% | 80% |
| subjunctive_wish | 10 | 100% | 100% | 90% | 100% | 70% | 100% |
| personal_a | 12 | 58% | 92% | 92% | 100% | 33% | 83% |
| articles | 10 | 90% | 90% | 90% | 90% | 60% | 100% |
| pronoun_placement | 11 | 82% | 100% | 100% | 100% | 100% | 100% |
| **ALL** | 93 | 86% | 97% | 96% | 96% | 66% | 89% |

### Margins (log P(correct) − log P(incorrect), nats, neutral prefix)

| min | p10 | p25 | median | p75 | p90 | max | mean |
|---|---|---|---|---|---|---|---|
| -2.65 | 2.20 | 4.11 | 6.29 | 8.96 | 11.39 | 16.10 | 6.56 |

Histogram (2-nat bins, clipped to [−6, 16)):

```
  -6 .. -4    0
  -4 .. -2   # 1
  -2 .. 0    ## 2
   0 .. 2    ###### 6
   2 .. 4    ############## 14
   4 .. 6    ################### 19
   6 .. 8    ################# 17
   8 .. 10   ############### 15
  10 .. 12   ############## 14
  12 .. 14   #### 4
  14 .. 16   # 1
```

| condition | flag threshold t (nats) for ≥95% precision | errors caught at t | true / false flags | at t=0: precision, recall |
|---|---|---|---|---|
| plain | 3.5 | 67% | 62 / 3 | 86%, 86% |
| neutral | 0.0 | 97% | 90 / 3 | 97%, 97% |
| register | 0.0 | 96% | 89 / 4 | 96%, 96% |

Wrong-way pairs (incorrect scored higher), neutral prefix:

- -2.65 [ser_estar] La fiesta es en mi casa esta noche. / *La fiesta está en mi casa esta noche.*
- -1.36 [articles] El español es fácil. / *Español es fácil.*
- -0.96 [personal_a] Escuché a la profesora con atención. / *Escuché la profesora con atención.*

Localization misses (neutral prefix; most surprising word vs the error):

- *Mi hermano es enfermo hoy.*: top = 'hoy' (9.5), error at 'es'
- *Madrid es en España.*: top = 'Madrid' (9.1), error at 'es'
- *La fiesta está en mi casa esta noche.*: top = 'fiesta' (7.3), error at 'está'
- *Mi madre está de Colombia.*: top = 'Colombia' (13.6), error at 'está'
- *El café es muy caliente ahora.*: top = 'ahora' (8.4), error at 'es'
- *¿Dónde son las llaves?*: top = 'llaves' (9.7), error at 'son'
- *Gracias para tu ayuda.*: top = 'Gracias' (7.6), error at 'para'
- *Caminamos para la playa toda la tarde.*: top = 'Caminamos' (11.2), error at 'para'
- *Necesito el informe por el lunes.*: top = 'Necesito' (8.7), error at 'por'
- *Trabajo para la mañana.*: top = 'Trabajo' (11.2), error at 'para'
- *Tengo que terminar esto por mañana.*: top = 'Tengo' (7.4), error at 'por'
- *Lo mandé para correo.*: top = 'mandé' (10.6), error at 'para'
- *Tengo un mano fría.*: top = 'fría' (14.2), error at 'un'
- *Compré una camisa nuevo.*: top = 'Compré' (11.3), error at 'nuevo'
- *Me gusta las manzanas.*: top = 'Me' (6.8), error at 'gusta'
- *Cuando fui niño, vivía en Cuba.*: top = 'Cuba' (8.4), error at 'fui'
- *Ella tuvo el pelo largo cuando la conocí.*: top = 'Ella' (8.3), error at 'tuvo'
- *Mis padres quieren que estudio medicina.*: top = 'Mis' (8.1), error at 'estudio'
- *Prefiero que me llamas por la noche.*: top = 'Prefiero' (9.5), error at 'llamas'
- *Queremos que nos dices la verdad.*: top = 'Queremos' (9.6), error at 'dices'
- *Veo mi madre todos los días.*: top = 'Veo' (10.1), error at 'mi'
- *Conozco tu hermano.*: top = 'Conozco' (12.3), error at 'tu'
- *Busco mi hijo.*: top = 'Busco' (10.6), error at 'mi'
- *Ayudamos los vecinos.*: top = 'Ayudamos' (13.7), error at 'los'
- *Escuché la profesora con atención.*: top = 'Escuché' (11.6), error at 'la'
- *Visitamos nuestros primos en Ponce.*: top = 'Visitamos' (10.5), error at 'nuestros'
- *Compré a un coche nuevo.*: top = 'Compré' (11.3), error at 'a'
- *Leo al periódico cada día.*: top = 'Leo' (10.4), error at 'al'
- *Me lavo mis manos.*: top = 'lavo' (12.4), error at 'mis'
- *Llegamos a ocho.*: top = 'Llegamos' (11.7), error at 'ocho'
- *Hablé con señor García.*: top = 'Hablé' (15.5), error at 'señor'
- *Me duele mi cabeza.*: top = 'Me' (6.8), error at 'mi'

### Slang penalty (street − neutral, mean log-prob per word, nats)

| condition | mean gap per word | median | street wins |
|---|---|---|---|
| plain | -4.35 | -4.20 | 1/26 |
| neutral | -4.44 | -3.79 | 0/26 |
| register | -3.20 | -2.44 | 0/26 |

Most surprising street words (neutral prefix → street prefix, nats):

janguiando 33.5→30.3, pela'o 28.5→26.0, janguear 27.3→0.9, tíguere 23.5→19.2, Bregamos 22.2→27.5, Parcero 20.9→18.6, corillo 18.9→6.9, volá 18.8→22.5, 'toy 18.7→26.4, 'tá 18.6→6.5, vamo' 18.5→10.6, panas 18.5→10.7, Wepa 18.4→17.0, Vamo' 18.4→21.5, to' 18.3→13.3

### Speed (4 CPU cores)

- prompt processing (scoring): 59 tokens/s
- generation: 7.7 tokens/s
- one ten-word sentence + six variants: 3.73 s
- next-word list (beam over sub-word pieces): 14.7 s per opening

### Next-word lists (neutral prefix)

| opening | top ten next words (probability) | top-10 mass |
|---|---|---|
| Ayer fui al mercado y compré … | un 0.27, una 0.18, algunos 0.06, unos 0.05, muchos 0.03, el 0.03, pan 0.03, frutas 0.02, algunas 0.02, unas 0.02 | 0.72 |
| Cuando llegué a casa, mi madre … | me 0.48, estaba 0.21, ya 0.18, se 0.03, no 0.03, había 0.02, y 0.01, tenía 0.01, dijo 0.00, estuvo 0.00 | 0.97 |
| Me gusta mucho … | el 0.37, la 0.14, este 0.10, que 0.08, esta 0.05, tu 0.04, cómo 0.02, lo 0.01, estar 0.01, ese 0.01 | 0.81 |
| El perro corrió hacia la … | casa 0.55, puerta 0.32, ventana 0.01, luz 0.01, izquierda 0.01, caja 0.01, cerca 0.01, cabaña 0.00, derecha 0.00, entrada 0.00 | 0.92 |
| No puedo salir hoy porque … | tengo 0.41, estoy 0.10, me 0.08, mi 0.08, no 0.05, el 0.03, he 0.03, hay 0.03, la 0.02, debo 0.02 | 0.86 |
| Mi hermano siempre … | me 0.17, ha 0.17, se 0.14, dice 0.12, está 0.04, fue 0.03, tiene 0.03, quiere 0.02, es 0.02, tenía 0.02 | 0.75 |
| Quiero que mañana … | a 0.10, me 0.10, por 0.08, se 0.05, te 0.04, en 0.03, no 0.02, sea 0.02, comience 0.02, al 0.01 | 0.46 |
| La niña abrió la puerta y … | se 0.23, entró 0.20, salió 0.16, vio 0.07, dijo 0.04, miró 0.02, la 0.02, corrió 0.02, el 0.01, le 0.01 | 0.78 |
| Esta noche vamos a … | ver 0.25, hacer 0.10, hablar 0.06, celebrar 0.06, tener 0.04, ir 0.02, salir 0.02, cenar 0.01, la 0.01, estar 0.01 | 0.57 |
| En la playa hacía mucho … | calor 0.68, sol 0.31, frío 0.01, fr 0.00 | 1.00 |
| Mano, vamo' a janguear con el … | jefe 0.02, viejo 0.02, equipo 0.02, rey 0.01, otro 0.01, tío 0.01, que 0.01, viento 0.01, dueño 0.01, chico 0.01 | 0.12 |
| Esa vaina 'tá … | en 0.11, muy 0.08, bien 0.05, de 0.03, loca 0.02, llena 0.02, hecha 0.02, más 0.02, mal 0.02, tan 0.02 | 0.38 |
| ¿Qué es la que … | se 0.12, no 0.04, es 0.03, va 0.01, la 0.01, está 0.01, más 0.01, hace 0.01, el 0.01, los 0.00 | 0.24 |
| Tengo que terminar esto para … | que 0.28, el 0.21, mañana 0.11, poder 0.10, la 0.07, esta 0.03, hoy 0.02, las 0.02, después 0.01, dentro 0.01 | 0.86 |
| Había una vez un … | rey 0.23, hombre 0.17, niño 0.11, joven 0.08, príncipe 0.04, viejo 0.04, reino 0.03, chico 0.02, anciano 0.02, pequeño 0.01 | 0.76 |

## Qwen3-1.7B-Q4_K_M.gguf

### Accuracy (correct sentence scores higher)

| rule | n | no prefix | neutral prefix | street prefix | per-token mean (neutral) | localization top-1 | localization top-2 |
|---|---|---|---|---|---|---|---|
| ser_estar | 10 | 90% | 90% | 100% | 90% | 40% | 70% |
| por_para | 10 | 90% | 90% | 100% | 90% | 60% | 70% |
| gender | 10 | 70% | 100% | 100% | 100% | 90% | 100% |
| number | 10 | 90% | 100% | 100% | 100% | 90% | 100% |
| preterite_imperfect | 10 | 80% | 100% | 90% | 70% | 80% | 80% |
| subjunctive_wish | 10 | 100% | 100% | 80% | 90% | 80% | 90% |
| personal_a | 12 | 83% | 92% | 83% | 100% | 25% | 92% |
| articles | 10 | 90% | 100% | 90% | 80% | 70% | 100% |
| pronoun_placement | 11 | 73% | 100% | 100% | 91% | 100% | 100% |
| **ALL** | 93 | 85% | 97% | 94% | 90% | 70% | 89% |

### Margins (log P(correct) − log P(incorrect), nats, neutral prefix)

| min | p10 | p25 | median | p75 | p90 | max | mean |
|---|---|---|---|---|---|---|---|
| -1.34 | 1.78 | 3.39 | 5.61 | 8.59 | 11.19 | 17.52 | 6.18 |

Histogram (2-nat bins, clipped to [−6, 16)):

```
  -6 .. -4    0
  -4 .. -2    0
  -2 .. 0    ### 3
   0 .. 2    ######## 8
   2 .. 4    ##################### 21
   4 .. 6    #################### 20
   6 .. 8    ################ 16
   8 .. 10   ######### 9
  10 .. 12   ######## 8
  12 .. 14   ###### 6
  14 .. 16   ## 2
```

| condition | flag threshold t (nats) for ≥95% precision | errors caught at t | true / false flags | at t=0: precision, recall |
|---|---|---|---|---|
| plain | 5.5 | 44% | 41 / 2 | 85%, 85% |
| neutral | 0.0 | 97% | 90 / 3 | 97%, 97% |
| register | 0.25 | 94% | 87 / 3 | 94%, 94% |

Wrong-way pairs (incorrect scored higher), neutral prefix:

- -1.34 [ser_estar] La fiesta es en mi casa esta noche. / *La fiesta está en mi casa esta noche.*
- -0.87 [por_para] Trabajo por la mañana. / *Trabajo para la mañana.*
- -0.38 [personal_a] Visitamos a nuestros primos en Ponce. / *Visitamos nuestros primos en Ponce.*

Localization misses (neutral prefix; most surprising word vs the error):

- *Mi hermano es enfermo hoy.*: top = 'hoy' (11.5), error at 'es'
- *Madrid es en España.*: top = 'Madrid' (7.8), error at 'es'
- *Somos muy cansados después del viaje.*: top = 'cansados' (8.9), error at 'Somos'
- *La fiesta está en mi casa esta noche.*: top = 'fiesta' (6.2), error at 'está'
- *Mi madre está de Colombia.*: top = 'Colombia' (12.1), error at 'está'
- *El café es muy caliente ahora.*: top = 'café' (6.6), error at 'es'
- *Caminamos para la playa toda la tarde.*: top = 'Caminamos' (14.1), error at 'para'
- *Necesito el informe por el lunes.*: top = 'Necesito' (6.9), error at 'por'
- *Trabajo para la mañana.*: top = 'Trabajo' (9.2), error at 'para'
- *Lo mandé para correo.*: top = 'mandé' (11.2), error at 'para'
- *Compré una camisa nuevo.*: top = 'Compré' (10.9), error at 'nuevo'
- *Me gusta las manzanas.*: top = 'Me' (4.5), error at 'gusta'
- *Cuando fui niño, vivía en Cuba.*: top = 'Cuba' (8.4), error at 'fui'
- *Ella tuvo el pelo largo cuando la conocí.*: top = 'Ella' (9.5), error at 'tuvo'
- *Mis padres quieren que estudio medicina.*: top = 'Mis' (6.7), error at 'estudio'
- *Queremos que nos dices la verdad.*: top = 'Queremos' (9.0), error at 'dices'
- *Veo mi madre todos los días.*: top = 'Veo' (10.0), error at 'mi'
- *Conozco tu hermano.*: top = 'Conozco' (11.3), error at 'tu'
- *Busco mi hijo.*: top = 'Busco' (9.9), error at 'mi'
- *Ayudamos los vecinos.*: top = 'Ayudamos' (16.2), error at 'los'
- *Quiero mucho mis abuelos.*: top = 'mucho' (8.7), error at 'mis'
- *Escuché la profesora con atención.*: top = 'Escuché' (10.6), error at 'la'
- *Visitamos nuestros primos en Ponce.*: top = 'Visitamos' (13.0), error at 'nuestros'
- *Compré a un coche nuevo.*: top = 'Compré' (10.9), error at 'a'
- *Leo al periódico cada día.*: top = 'Leo' (9.3), error at 'al'
- *Voy a cine los sábados.*: top = 'los' (16.2), error at 'a'
- *Hablé con señor García.*: top = 'Hablé' (12.5), error at 'señor'
- *Me duele mi cabeza.*: top = 'duele' (6.0), error at 'mi'

### Slang penalty (street − neutral, mean log-prob per word, nats)

| condition | mean gap per word | median | street wins |
|---|---|---|---|
| plain | -3.90 | -3.33 | 2/26 |
| neutral | -4.61 | -4.46 | 0/26 |
| register | -3.43 | -2.95 | 0/26 |

Most surprising street words (neutral prefix → street prefix, nats):

tíguere 36.4→35.2, janguiando 27.6→20.1, janguear 26.5→3.2, Parcero 25.6→27.1, pela'o 25.4→20.0, Vamo' 23.1→22.4, 'tá 21.8→8.6, vamo' 21.8→14.8, bobería 21.6→19.1, Wepa 21.0→15.8, Bregamos 20.8→22.3, 'tá 20.4→10.1, 'tá 20.3→9.8, 'tá 20.0→8.9, 'toy 19.0→13.8

### Speed (4 CPU cores)

- prompt processing (scoring): 124 tokens/s
- generation: 15.4 tokens/s
- one ten-word sentence + six variants: 1.88 s
- next-word list (beam over sub-word pieces): 8.1 s per opening

### Next-word lists (neutral prefix)

| opening | top ten next words (probability) | top-10 mass |
|---|---|---|
| Ayer fui al mercado y compré … | un 0.59, una 0.09, unos 0.06, algo 0.03, algunos 0.02, dos 0.02, tres 0.02, unas 0.02, algunas 0.01, cinco 0.01 | 0.86 |
| Cuando llegué a casa, mi madre … | me 0.57, ya 0.08, y 0.06, se 0.04, estaba 0.04, no 0.03, dijo 0.02, fue 0.01, lo 0.01, preparó 0.01 | 0.87 |
| Me gusta mucho … | la 0.21, el 0.21, los 0.10, las 0.04, ir 0.03, ver 0.02, hacer 0.02, mi 0.01, comer 0.01, a 0.01 | 0.67 |
| El perro corrió hacia la … | casa 0.58, izquierda 0.07, calle 0.06, puerta 0.06, montaña 0.02, derecha 0.02, ciudad 0.01, tierra 0.01, playa 0.01, habitación 0.01 | 0.85 |
| No puedo salir hoy porque … | tengo 0.16, mi 0.11, no 0.09, me 0.06, el 0.05, necesito 0.04, la 0.03, hay 0.02, está 0.01, estoy 0.01 | 0.58 |
| Mi hermano siempre … | se 0.12, dice 0.11, me 0.10, está 0.08, quiere 0.04, le 0.04, tiene 0.03, es 0.03, ha 0.02, lo 0.01 | 0.57 |
| Quiero que mañana … | me 0.08, a 0.06, por 0.04, sea 0.04, vaya 0.03, se 0.03, hagas 0.02, salga 0.01, al 0.01, mi 0.01 | 0.33 |
| La niña abrió la puerta y … | vio 0.17, se 0.16, entró 0.15, dijo 0.07, al 0.04, salió 0.02, vió 0.02, encontró 0.02, fue 0.02, el 0.02 | 0.68 |
| Esta noche vamos a … | ver 0.19, cenar 0.10, comer 0.09, ir 0.06, hacer 0.05, celebrar 0.04, salir 0.03, la 0.02, visitar 0.02, jugar 0.02 | 0.62 |
| En la playa hacía mucho … | calor 0.65, frío 0.28, viento 0.01, sol 0.01, tiempo 0.01, más 0.01, frio 0.01, ruido 0.00, el 0.00, mucho 0.00 | 0.99 |
| Mano, vamo' a janguear con el … | coche 0.03, vino 0.01, grupo 0.01, equipo 0.01, sol 0.01, gato 0.01, perro 0.01, chico 0.01, agua 0.01, bote 0.01 | 0.12 |
| Esa vaina 'tá … | en 0.05, muy 0.05, de 0.04, más 0.02, a 0.02, mía 0.01, aquí 0.01, bien 0.01, que 0.01, un 0.01 | 0.25 |
| ¿Qué es la que … | se 0.17, es 0.16, la 0.03, el 0.01, sí 0.01, significa 0.01, te 0.01, está 0.01, más 0.01, no 0.01 | 0.41 |
| Tengo que terminar esto para … | no 0.36, que 0.22, poder 0.17, empezar 0.02, el 0.02, ayudar 0.01, la 0.01, evitar 0.01, hacer 0.01, ir 0.01 | 0.84 |
| Había una vez un … | hombre 0.19, rey 0.04, viejo 0.03, personaje 0.03, grupo 0.02, joven 0.02, muchacho 0.02, anciano 0.02, pequeño 0.02, barco 0.02 | 0.40 |
