/**
 * The engine's own functions against the real model: the acceptance checks of
 * proof/ENGINE_REAL_MODEL.md. Skipped unless CLIFFWORD_MODEL_URL is set, so
 * `npx vitest run` never needs a server. Start proof/model_server.py with Qwen3-1.7B
 * Q4_K_M (engine/scripts/real-model.md), then:
 *
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8765 npx vitest run test/real-engine.test.ts
 *
 * test/real-model.test.ts checks the model and the adapter (contract, parity with the
 * proof, raw pair accuracy); this file checks what the engine does with them:
 * - judgeSentence on the 93 incorrect and 93 correct proof sentences (neutral register):
 *   no false assert except the known rule-made one, most errors asserted with the right
 *   fix and rule;
 * - judgeSentence in street register on the 26 street sentences: no variant ever touches
 *   a slang word or clipped form, and at most the known asserts on ordinary words;
 * - scoreWords: slang words never shaded in street mode; heat finds most errors and
 *   rarely shades a correct sentence strongly;
 * - scoreCliffAnswer at a story cliff: every natural answer earns credit, wrong answers
 *   do not;
 * - generateNextSentence: early and intermediate learners get in-band sentences without
 *   placeholders or prompt words over three seeds, using their targets at least once and
 *   not one sentence for every seed; a brand-new learner on the bridge (after the starter
 *   story) gets real in-band sentences too;
 * - TopNBoundedModel (the llama.rn limit): no assert and no cliff credit ever rests on a
 *   bounded token.
 *
 * Thresholds sit a little below what the measurement of 2026-11-15 gave (see the doc), so
 * a pass means the engine still behaves as measured, not that it is perfect. Results are
 * printed with a "[real-engine]" prefix.
 */
import { describe, expect, it } from 'vitest';
import raw17 from '../../proof/raw_qwen3-1.7b.json';
import {
  LearnerModel,
  PlacementTracker,
  bridgeFamiliar,
  chooseTargets,
  cognateLexemeKeys,
  createDefaultPairPack,
  createDefaultSpanishPack,
  deriveParams,
  estimateVocabulary,
  expandRegions,
  frequencyLexemeKeys,
  generateNextSentence,
  judgeSentence,
  lexemeOf,
  scoreCliffAnswer,
  scoreWords,
  scoringContext,
  slangExemption,
  slangIn,
} from '../src';
import type { Judgement, LanguageModel, PriorFn, Skill } from '../src';
import { HttpLanguageModel } from '../src/model/http';
import { TopNBoundedModel } from '../src/model/topN';

interface ProofPair {
  id: number;
  rule: string;
  correct: string;
  incorrect: string;
}
interface ProofSlang {
  id: number;
  street: string;
  region: string;
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const BASE_URL = env.CLIFFWORD_MODEL_URL;
const now = (): number => (globalThis as unknown as { performance: { now(): number } }).performance.now();
const out = (globalThis as unknown as { console: { log(...args: unknown[]): void } }).console;
const log = (...args: unknown[]): void => out.log('[real-engine]', ...args);

const PAIRS: ProofPair[] = (raw17 as { pairs: ProofPair[] }).pairs;
const SLANG: ProofSlang[] = (raw17 as unknown as { slang: ProofSlang[] }).slang;

/**
 * Proof rule tag -> the engine explanation keys that name the same rule. The proof's
 * "number" tag includes subject-verb agreement, and "articles" includes contractions and
 * the body-part article.
 */
const FAMILY: Record<string, readonly string[]> = {
  ser_estar: ['es.ser_estar'],
  por_para: ['es.por_para'],
  gender: ['es.gender'],
  number: ['es.number', 'es.verb_agreement'],
  preterite_imperfect: ['es.aspect'],
  subjunctive_wish: ['es.mood'],
  personal_a: ['es.personal_a'],
  articles: ['es.article', 'es.contraction', 'es.body_article'],
  pronoun_placement: ['es.pronoun_placement', 'es.pronoun_order', 'es.negative_command', 'es.se_lo', 'es.pronoun_double'],
};

/**
 * Acceptance thresholds, each a little below the 2026-11-15 measurement
 * (proof/ENGINE_REAL_MODEL.md) so that load or a llama.cpp rebuild does not flip them.
 */
const ACCEPT = {
  /**
   * Correct proof sentences asserted as errors. Measured 1 at first, not a margin problem:
   * the article delete rule removed the object pronoun of "La invité a cenar." (+8.7 nats
   * for "Invité a cenar."). es.article.delete now skips a word before a verb
   * (DeleteRule.notBeforePos); re-measured 0 on 2026-11-15 (integration run).
   */
  maxFalseAsserts: 0,
  /**
   * Correct proof sentences given a hint: measured 2 at first (the proof's raw margins
   * gave 1 at 1 nat), 1 after the correction coverage round (2026-11-16).
   */
  maxFalseHints: 3,
  /**
   * Incorrect sentences asserted with exactly the correct sentence as the fix: measured 57
   * of 93 at first, 70 after the correction coverage round (agreement, contractions,
   * articles, body parts, personal a, pronouns; 2026-11-16).
   */
  minAssertedRightFix: 66,
  /** Incorrect sentences flagged (assert or hint) with exactly the correct sentence: measured 67, then 83 of 93. */
  minFlaggedRightFix: 79,
  /** Flagged incorrect sentences whose explanation names the proof's rule: measured 73, then 86 of 93. */
  minRightFamily: 82,
  /** Incorrect sentences whose error word (or the next) reaches heat 2: measured 42 of 93. */
  minHeatHits: 38,
  /** Correct sentences with any word at heat 3: measured 3 of 93. */
  maxCorrectHeat3: 6,
  /**
   * Asserts on the 26 street sentences in street register (all correct street Spanish).
   * Measured 4 at first, none on a slang word: three article deletes ("la que hay", "un
   * chin", "que el putas") and one ser/estar ("estuvo bacana" -> "fue bacana"). With the
   * delete rules' next-word conditions (no delete before a slang word, before que/de, or
   * before a verb) re-measured 2: "que el putas" (putas is not in the slang packs) and the
   * ser/estar one. After the correction coverage round (putas and man in the CO pack,
   * ser/estar skipped before a slang predicate): 0 (2026-11-16).
   */
  maxStreetAsserts: 0,
} as const;

/** Rules whose variants caused the measured false asserts (open issues in the doc). */
const KNOWN_FALSE_ASSERT_RULES: readonly string[] = ['es.article.delete'];
const KNOWN_STREET_ASSERT_RULES: readonly string[] = ['es.article.delete', 'es.ser_estar'];

/** Per-test timeout: 186 judgements at about 1 s each, with room for a busy machine. */
const LONG_MS = 1_200_000;

/** Word indices of the edit in `incorrect` relative to `correct`: [from, to), to = from for an omission. */
function errorSpan(pack: ReturnType<typeof createDefaultSpanishPack>, incorrect: string, correct: string): { from: number; to: number } {
  const words = (s: string) => pack.segment(s).filter((x) => x.kind === 'word').map((x) => x.norm);
  const a = words(incorrect);
  const b = words(correct);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let ja = a.length;
  let jb = b.length;
  while (ja > i && jb > i && a[ja - 1] === b[jb - 1]) {
    ja--;
    jb--;
  }
  return { from: i, to: ja };
}

/**
 * Word segments of `text` that belong to a slang form of the regions as it occurs in the
 * text (slangIn), matched as runs of words: the words corrections must never edit. A
 * word that is only part of some phrase entry elsewhere ("a") does not count.
 */
function slangSegments(pack: ReturnType<typeof createDefaultSpanishPack>, text: string, regions: readonly string[]) {
  const segs = pack.segment(text).filter((x) => x.kind === 'word');
  const out = new Set<(typeof segs)[number]>();
  for (const form of slangIn(pack, text, regions)) {
    const fw = pack.segment(form).filter((x) => x.kind === 'word').map((x) => x.norm);
    for (let i = 0; i + fw.length <= segs.length; i++) {
      if (fw.every((w, k) => segs[i + k]?.norm === w)) for (let k = 0; k < fw.length; k++) out.add(segs[i + k]!);
    }
  }
  return [...out];
}

describe.skipIf(!BASE_URL)('the engine on the real model', () => {
  const model: LanguageModel = new HttpLanguageModel({ baseUrl: BASE_URL ?? 'http://127.0.0.1:8765', timeoutMs: 600_000 });
  const pack = createDefaultSpanishPack();
  const pair = createDefaultPairPack();
  const neutral = scoringContext(pack, '');

  it('judgeSentence on the 93 proof pairs: no false assert from a margin, most errors asserted with the right fix', async () => {
    const t0 = now();
    let asserted = 0;
    let assertedRight = 0;
    let flaggedRight = 0;
    let rightFamily = 0;
    let falseAsserts = 0;
    let falseHints = 0;
    const falseAssertRules: string[] = [];
    const misses: string[] = [];
    for (const p of PAIRS) {
      const wrong: Judgement = await judgeSentence(model, pack, neutral, p.incorrect);
      const right: Judgement = await judgeSentence(model, pack, neutral, p.correct);
      if (wrong.verdict === 'assert') asserted++;
      if (wrong.verdict === 'assert' && wrong.best?.text === p.correct) assertedRight++;
      if (wrong.verdict !== 'ok' && wrong.best?.text === p.correct) flaggedRight++;
      else misses.push(`[${p.rule}] *${p.incorrect}* -> ${wrong.verdict} ${wrong.best?.text ?? '-'} (${wrong.margin?.toFixed(2) ?? '-'})`);
      if (wrong.verdict !== 'ok' && (FAMILY[p.rule] ?? []).includes(wrong.explainKey ?? '')) rightFamily++;
      if (right.verdict === 'assert') {
        falseAsserts++;
        falseAssertRules.push(right.best?.ruleId ?? '');
      }
      if (right.verdict === 'hint') falseHints++;
      if (right.verdict !== 'ok') log(`  flagged correct: ${p.correct} -> ${right.verdict} ${right.best?.text} (${right.margin?.toFixed(2)})`);
      // Exact scores: nothing is ever bounded.
      expect(wrong.bounded ?? false).toBe(false);
    }
    const ms = now() - t0;
    log(
      `judge: ${asserted}/93 asserted (${assertedRight} with the right fix), ${flaggedRight}/93 flagged with the right fix, ` +
        `${rightFamily}/93 right rule; correct sentences: ${falseAsserts} false asserts, ${falseHints} false hints; ` +
        `${(ms / 186).toFixed(0)} ms per judgement`,
    );
    for (const m of misses) log(`  not flagged with the fix: ${m}`);
    expect(falseAsserts).toBeLessThanOrEqual(ACCEPT.maxFalseAsserts);
    for (const r of falseAssertRules) expect(KNOWN_FALSE_ASSERT_RULES, r).toContain(r);
    expect(falseHints).toBeLessThanOrEqual(ACCEPT.maxFalseHints);
    expect(assertedRight).toBeGreaterThanOrEqual(ACCEPT.minAssertedRightFix);
    expect(flaggedRight).toBeGreaterThanOrEqual(ACCEPT.minFlaggedRightFix);
    expect(rightFamily).toBeGreaterThanOrEqual(ACCEPT.minRightFamily);
  }, LONG_MS);

  it('street register: no variant edits slang, no slang shaded, few asserts and none on slang', async () => {
    let asserts = 0;
    let touching = 0;
    let shadedSlang = 0;
    let slangWords = 0;
    let neutralSum = 0;
    let streetSum = 0;
    for (const s of SLANG) {
      const regions = [...(expandRegions([s.region === 'DR' ? 'DO' : s.region]) ?? [])];
      const context = scoringContext(pack, '', { register: 'street', regions, words: slangIn(pack, s.street, regions) });
      const exempt = slangExemption(pack, regions);
      const slang = slangSegments(pack, s.street, regions);
      const j = await judgeSentence(model, pack, context, s.street, { register: 'street' });
      if (j.verdict === 'assert') {
        asserts++;
        log(`  street assert: ${s.street} -> ${j.best?.text} (${j.best?.ruleId}, ${j.margin?.toFixed(2)})`);
        expect(KNOWN_STREET_ASSERT_RULES, s.street).toContain(j.best?.ruleId ?? '');
      }
      // An insert touches the word it goes before; an edit touches the words it spans.
      for (const v of j.variants) if (slang.some((x) => v.start < x.end && x.start < Math.max(v.end, v.start + 1))) touching++;
      const street = await scoreWords(model, pack, context, s.street, { exempt });
      const plain = await scoreWords(model, pack, neutral, s.street);
      street.forEach((w, i) => {
        if (!exempt(w.segment)) return;
        slangWords++;
        if (w.heat > 0) shadedSlang++;
        streetSum += w.surprisal;
        neutralSum += plain[i]?.surprisal ?? 0;
      });
    }
    log(
      `street: ${asserts} asserts, ${touching} variants touching slang, ${slangWords} slang words ` +
        `(mean surprisal ${(neutralSum / slangWords).toFixed(1)} neutral -> ${(streetSum / slangWords).toFixed(1)} street prefix), ${shadedSlang} shaded`,
    );
    expect(asserts).toBeLessThanOrEqual(ACCEPT.maxStreetAsserts);
    expect(touching).toBe(0);
    expect(shadedSlang).toBe(0);
    expect(slangWords).toBeGreaterThan(20);
    // The street prefix names the slang it finds, so slang is less surprising after it.
    expect(streetSum).toBeLessThan(neutralSum);
  }, LONG_MS);

  it('scoreWords: heat reaches most error words and rarely shades a correct sentence strongly', async () => {
    let hits = 0;
    let correctHeat3 = 0;
    for (const p of PAIRS) {
      const span = errorSpan(pack, p.incorrect, p.correct);
      const near = new Set<number>();
      for (let i = span.from; i <= Math.max(span.to, span.from + 1); i++) near.add(i);
      const wrong = await scoreWords(model, pack, neutral, p.incorrect);
      if (wrong.some((w) => w.heat >= 2 && near.has(w.wordIndex))) hits++;
      const right = await scoreWords(model, pack, neutral, p.correct);
      if (right.some((w) => w.heat >= 3)) correctHeat3++;
    }
    log(`heat: error word or next at heat >= 2 in ${hits}/93; correct sentences with a heat-3 word: ${correctHeat3}/93`);
    expect(hits).toBeGreaterThanOrEqual(ACCEPT.minHeatHits);
    expect(correctHeat3).toBeLessThanOrEqual(ACCEPT.maxCorrectHeat3);
  }, LONG_MS);

  it('scoreCliffAnswer at a story cliff: natural answers earn credit, wrong answers do not', async () => {
    const story = 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba cerrado. Entonces vio una nota en la puerta y empezó a';
    const context = scoringContext(pack, story);
    const score = (answer: string) => scoreCliffAnswer(model, pack, context, answer, 'leerla');
    const t0 = now();
    // The model's own top words here: llorar 0.33, correr 0.23, leerla 0.09, leer 0.07.
    for (const a of ['leerla', 'leer', 'llorar']) expect((await score(a)).credit, a).toBe('full');
    // Natural but unexpected (reír 5.6e-4, gritar 1.0e-3): partial credit since the
    // partial floor is 1e-4 (it was 0.005, which gave them none).
    for (const a of ['reír', 'reir', 'gritar']) expect(await score(a), a).toMatchObject({ credit: 'partial', reason: 'plausible' });
    // Wrong words sit at 1e-7 to 1e-9.
    for (const a of ['mesa', 'verde', 'puerta', 'xyzzy']) expect((await score(a)).credit, a).toBe('none');
    for (const a of ['lee', 'leyó']) expect(await score(a), a).toMatchObject({ credit: 'partial', reason: 'form' });
    log(`cliff answers: ${((now() - t0) / 12).toFixed(0)} ms per answer`);
  }, LONG_MS);

  const at = Date.UTC(2026, 10, 15, 9, 0, 0);
  const keys = frequencyLexemeKeys(pack);
  const rank = new Map(keys.map((k, i) => [k, i + 1]));
  const cognates = PlacementTracker.brandNew(cognateLexemeKeys(pair));
  /** Knows each skill up to a frequency rank (a steep logistic, as in the simulated learners), cognates at least as the brand-new prior. */
  const reaching = (reach: Record<Skill, number>): LearnerModel => {
    const prior: PriorFn = (key, skill) =>
      Math.max(reach[skill] <= 0 ? 0.002 : 0.002 + 0.968 / (1 + Math.pow((rank.get(lexemeOf(key)) ?? 50_000) / reach[skill], 6)), cognates(key, skill));
    return new LearnerModel({ prior });
  };
  const story = [
    'Marta llegó tarde al mercado.',
    'Buscó al señor de las frutas, pero su puesto estaba cerrado.',
    'Entonces vio una nota en la puerta y empezó a leerla en voz alta.',
  ];
  const starterStory = (pair.starter?.sentences ?? []).map((x) => x.text);
  const CONTENT = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);
  /**
   * One next sentence the way the session asks for it: one target (two from
   * newWordsPerSentence 1.5), the default tuning, the main character named. With
   * `bridge`, the brand-new learner's bridge (session/handover.ts): the starter's words,
   * cognates and introduced words count as known, and the target is a content word.
   */
  const generate = async (learner: LearnerModel, storySoFar: string[], seed: number, bridge = false) => {
    const vocab = estimateVocabulary(learner, at, keys);
    const params = deriveParams({ vocab });
    const familiar = bridge ? bridgeFamiliar(pack, pair) : [];
    const targets = chooseTargets({
      learner, now: at, frequencyKeys: keys, exclude: familiar,
      ...(bridge ? { accept: (k: string) => CONTENT.has(pack.analyze(pack.normalize(k.slice(3)))[0]?.pos ?? '') } : {}),
      options: { count: params.newWordsPerSentence >= 1.5 ? 2 : 1 },
    });
    const t0 = now();
    const r = await generateNextSentence(model, { pack, learner, pair }, {
      story: storySoFar, targets: targets.map((t) => t.key), params, now: at, seed, vocab, names: ['Marta'], ...(bridge ? { familiar } : {}),
    });
    log(`generate (seed ${seed}): "${r.sentence}" for ${targets.map((t) => t.key).join(', ')}; in band ${r.diagnostics.inBand}, target ${r.diagnostics.targetUsed}, retried ${r.diagnostics.retried}, rejects ${JSON.stringify(r.rejectCounts)}, ${(now() - t0).toFixed(0)} ms`);
    return { r, params };
  };
  const SEEDS = [1, 1001, 2001];
  const JUNK = /\n|_|\.\.|…|\[|\]|<|>|Cuento|Personajes|Palabras|Historia|Siguiente|oración/u;

  // Measured on 2026-11-16 (proof/ENGINE_REAL_MODEL.md, "Story generation at every level").
  // Each profile: three seeds over the same story. In band at least twice, no placeholder
  // or prompt words, a real sentence of the level's length, the target used at least
  // once, and not the same sentence for every seed.
  it('generateNextSentence: early and intermediate learners get varied in-band sentences that use their targets', async () => {
    // Each learner continues a story of its level (an early learner's story is written in
    // its words; the market story has words beyond rank 300 in every sentence).
    const profiles: [string, LearnerModel, string[]][] = [
      ['early', reaching({ meaning: 300, written: 300, sound: 200, speaking: 80 }), ['Marta vive en una casa pequeña.', 'Hoy ella va al mercado con su hermano.']],
      ['intermediate', reaching({ meaning: 1200, written: 1200, sound: 700, speaking: 300 }), story],
    ];
    for (const [name, learner, storySoFar] of profiles) {
      const runs = [];
      for (const seed of SEEDS) runs.push(await generate(learner, storySoFar, seed));
      const sentences = runs.map((x) => x.r.sentence);
      for (const { r, params } of runs) {
        expect(r.sentence, name).not.toBeNull();
        expect(r.best?.rejected ?? ['none'], name).toEqual([]);
        expect(r.sentence ?? '', name).not.toMatch(JUNK);
        expect(r.best?.wordCount ?? 0, name).toBeGreaterThanOrEqual(Math.floor(params.sentenceWords.min * 0.6));
      }
      expect(runs.filter((x) => x.r.diagnostics.inBand).length, `${name} in band`).toBeGreaterThanOrEqual(2);
      expect(runs.filter((x) => x.r.diagnostics.targetUsed).length, `${name} targets`).toBeGreaterThanOrEqual(1);
      // From one story state Qwen3-1.7B's likeliest sentence often wins for two of three
      // seeds (measured 2026-11-16: 2 distinct of 3 for the early learner, 3 of 3 for the
      // intermediate one); never all three (the old prompt gave one sentence every time).
      // Within a running story no sentence repeats: the repeat reject forbids it.
      expect(new Set(sentences).size, `${name} distinct`).toBeGreaterThanOrEqual(2);
    }
  }, LONG_MS);

  // Was it.fails until 2026-11-16: chooseTargets gave el and de, the prompt asked the
  // model to "use" them, Qwen3-1.7B wrote "El y de _______." and selection accepted it.
  // Now the brand-new learner generates on the bridge (after the starter story): content
  // targets as the next line's tag, the starter's words and cognates as the known words.
  it('generateNextSentence: a brand-new learner on the bridge gets real, in-band sentences', async () => {
    const learner = new LearnerModel({ prior: PlacementTracker.brandNew(cognateLexemeKeys(pair)) });
    const runs = [];
    for (const seed of SEEDS) runs.push(await generate(learner, starterStory, seed, true));
    for (const { r, params } of runs) {
      expect(r.sentence).not.toBeNull();
      const words = pack.segment(r.sentence ?? '').filter((x) => x.kind === 'word').length;
      expect(words).toBeGreaterThanOrEqual(Math.floor(params.sentenceWords.min * 0.6));
      expect(r.sentence ?? '').not.toMatch(JUNK);
      expect(r.best?.rejected ?? ['none']).toEqual([]);
    }
    expect(runs.filter((x) => x.r.diagnostics.inBand).length).toBeGreaterThanOrEqual(2);
    expect(runs.filter((x) => x.r.diagnostics.targetUsed).length).toBeGreaterThanOrEqual(1);
    // Not one sentence for every seed (measured: 2 distinct of 3; see above).
    expect(new Set(runs.map((x) => x.r.sentence)).size).toBeGreaterThanOrEqual(2);
  }, LONG_MS);

  it('top-10 forced decoding (llama.rn limit): no assert or credit rests on a bounded token', async () => {
    const device = new TopNBoundedModel(model, { n: 10 });
    // The first pair of each rule: 18 judgements, about 4 s each through top-10 lists.
    const sample = PAIRS.filter((p, i, all) => all.findIndex((q) => q.rule === p.rule) === i);
    let asserts = 0;
    let bounded = 0;
    for (const p of sample) {
      for (const text of [p.incorrect, p.correct]) {
        const j = await judgeSentence(device, pack, neutral, text);
        if (j.bounded) bounded++;
        if (j.verdict === 'assert') {
          asserts++;
          expect(j.best?.bounded ?? false, text).toBe(false);
        }
        if (text === p.correct) expect(j.verdict, text).not.toBe('assert');
      }
    }
    log(`top-10: ${asserts} asserts and ${bounded} bounded judgements over ${2 * sample.length} sentences`);
    expect(bounded).toBeGreaterThan(0);
    // Cliff credit: through top-10 lists the wrong answers mesa and verde come back as
    // bounds of about 0.012, above the partial floor; the bound must not earn credit.
    // Answers among the model's own alternatives keep their exact credit.
    const story = 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba cerrado. Entonces vio una nota en la puerta y empezó a';
    const context = scoringContext(pack, story);
    for (const a of ['mesa', 'verde']) {
      const r = await scoreCliffAnswer(device, pack, context, a, 'leerla');
      expect(r.bounded, a).toBe(true);
      expect(r.credit, a).toBe('none');
    }
    const natural = await scoreCliffAnswer(device, pack, context, 'llorar', 'leerla');
    expect(natural).toMatchObject({ credit: 'full', reason: 'likely' });
    expect(natural.bounded).toBeUndefined();
  }, LONG_MS);
});
