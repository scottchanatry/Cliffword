# Cliffword: project brief

Decisions made so far. Read this before doing any work in this repo.

## Product

- Language app on an on-device open model, free to run. First pair: Spanish for
  English speakers. It must extend to other pairs (English for Spanish speakers,
  Japanese for Chinese speakers).
- Core mechanic: surprise both ways.
  1. The story stops mid-sentence (the cliff). The learner says what comes next.
     Score = model probability of their answer; every natural answer earns credit.
  2. The learner's own sentences are scored word by word; unexpected words are shaded.
  3. Corrections: rule-made variants (ser/estar, por/para, gender, tense) are compared
     by model probability. The winning rule supplies the explanation. The model only
     scores; it never explains.
- Story sentences are generated one at a time from words the learner knows plus one
  or two new ones (generate several candidates, keep the best fit).
- Learner model: per word and form, with meaning, sound and written form tracked
  separately. Signals: tap to rehear, hold to reveal, misses, native-language words
  inside replies.
- Speaking first: text hidden by default (words are blank tiles sized by duration;
  tap = hear, hold = see). Hold anywhere to speak. Spoken commands: otra vez, más
  despacio, no sé, siguiente, listo. Prompt to self-repair before showing a fix.
  Timed retell at 60/45/30 seconds with pauses shown. "Understood N of M words",
  no accent score. Headline metric: minutes spoken.
- Two tabs: Story and Music. Profile and settings behind a corner button.
- Music: Apple Music via MusicKit (library and playback). Spotify is share-in only
  (its API caps new apps at 5 users). Lyrics are pasted by the user; licensed timed
  lyrics later. Lyric cliff, sing the line back, slang notes.
- Slang: region packs (Puerto Rico, Dominican Republic, Cuba, Colombia) with meaning,
  region, formality and explicit flag. Street mode must not mark slang or clipped
  forms ('tá, pa') as errors. Neutral and street are taught side by side.
  Explicit lyrics are ON by default.
- Look: ground #F3F4F1, ink #16181D, muted #5B616B, white cards, amber heat
  #FFE9C7 / #FFC46B / #F08A1D, accent text #B4530A. Fonts: Newsreader (content),
  Inter (interface), Anton (Music headings).
  Previews: https://claude.ai/artifact/Pqmgv8g8QLxFYWZghxjX28

## Architecture

- Three layers: core engine (language-neutral); language pack (word splitting, word
  forms, frequency list, correction rules, voices); pair pack (glosses, interface
  text, starting assumptions such as cognates).
- Rules are data, not code. Never assume spaces separate words. All interface text
  is translatable. One multilingual model serves every pair.
- Stack: Expo React Native; llama.rn with a small multilingual model (Gemma 3n or
  Qwen3 class); on-device speech in and out; SQLite.
- The engine core is plain TypeScript behind a model interface, testable without a
  phone.

## Plan

| Step | What | Output |
|---|---|---|
| 1. Proof test | Run a small open model in the cloud container and measure whether probability scoring works for Spanish, slang included | `proof/RESULTS.md` |
| 2. Engine core | The four hard parts as plain tested code: word scoring, corrections, learner model, sentence selection. Thresholds come from step 1 | `engine/` |
| 3. Build outline | Architecture, interfaces, and a file-by-file task list where each task has a test that proves it done | `docs/OUTLINE.md` |
| 4. Build | Screens, data tables, speech, music, store setup, in stages that each end with passing tests | the app |

## Step 1: proof test spec

Goal: decide whether a small model's probabilities are good enough to drive the app,
which model to use, and what thresholds the engine should apply. Do not build any
app code in this step.

1. Install a CPU build of llama.cpp bindings and download small multilingual
   instruct models in GGUF form from Hugging Face. Test one model around 4B
   parameters and one around 1 to 2B. If a download is gated or blocked, use what is
   reachable and say so in the results. Do not commit model files.
2. Write `proof/pairs.jsonl`: at least 80 Spanish minimal pairs, each with a correct
   sentence, an incorrect sentence that differs by one choice, and a rule tag.
   Cover ser/estar, por/para, gender agreement, number agreement,
   preterite/imperfect, subjunctive after wishes, personal a, articles, and object
   pronoun placement.
3. Write `proof/slang.jsonl`: at least 20 sentences that are correct Caribbean street
   Spanish (clipped forms such as 'tá and pa', and words such as janguear, corillo,
   vaina), each paired with a neutral paraphrase.
4. For each model, score each full sentence by total log-probability and report:
   - accuracy: share of pairs where the correct sentence scores higher, overall and
     per rule;
   - margins: the distribution of score differences, and the margin above which at
     least 95% of flagged pairs are true errors;
   - localization: in each incorrect sentence, whether the most surprising word is
     the error word or the word right after it;
   - slang penalty: average score gap per word between street and neutral versions,
     with and without a short register-setting prefix;
   - speed: tokens per second on this machine, and the time to score one ten-word
     sentence plus six variants.
5. Next-word scoring: for 15 sentence openings, list the ten most likely next words
   with probabilities, combining sub-word pieces into whole words. Describe the
   method, because the engine will reuse it.
6. Write `proof/RESULTS.md` with the tables and a short plain-language verdict: does
   this work, which model, which thresholds, what failed. Commit the scripts, data
   and results.

## Not done yet

- The proof test above.
- Singer pitch cannot be read from Apple Music audio; pitch can only be shown for
  the learner's own voice.
- Name: no app-store collisions were found for Cliffword, and cliffword.com and
  cliffword.app were unregistered on 2026-11-15. Trademarks are unchecked.
