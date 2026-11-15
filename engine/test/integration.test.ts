/**
 * Integration tests: the real Spanish pack with its correction rules and slang
 * registers, the real English-Spanish pair pack, and the deterministic mock model, all
 * through the public API (src/index.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  LearnerModel,
  SPANISH_EXPLAIN_KEYS,
  SPANISH_REGISTERS,
  SPANISH_RULES,
  candidateLemma,
  chooseTargets,
  cliffPositions,
  cliffRungFor,
  createDefaultPairPack,
  createDefaultSpanishPack,
  createMockModel,
  deriveParams,
  estimateVocabulary,
  findNativeGaps,
  findSlang,
  frequencyLexemeKeys,
  gapEvents,
  generateNextSentence,
  generateVariants,
  judgeSentence,
  lexemeKey,
  nextWords,
  nextWordsDetailed,
  pickCliff,
  scoreCliffAnswer,
  scoreWords,
  slangLexemeKeys,
  spanishRegistersFor,
} from '../src';
import type { LearnerEvent, Segment } from '../src';
import * as config from '../src/config';

const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const model = createMockModel();

const STREET = "El corillo ya 'tá listo pa' bailar.";

/** Word segments of a text that are slang entries in the pack's registers (exact match). */
function slangSegments(text: string): Segment[] {
  return pack
    .segment(text)
    .filter((s) => s.kind === 'word' && findSlang(s.norm, undefined, { loose: false, packs: pack.registers }).length > 0);
}

describe('packs', () => {
  it('builds the default Spanish pack with every rule and register', () => {
    expect(pack.code).toBe('es');
    expect(pack.rules).toBe(SPANISH_RULES);
    expect(pack.registers).toBe(SPANISH_REGISTERS);
    expect(pack.frequencyList?.length).toBeGreaterThan(1600);
    expect(pack.frequencyRank(pack.frequencyList?.[0] as string)).toBe(1);
    expect(pack.foldAccents?.('reír pingüino niño')).toBe('reir pinguino niño');
  });

  it('builds the en-es pair pack with an explanation for every rule', () => {
    expect(pair.native).toBe('en');
    expect(pair.target).toBe('es');
    for (const key of SPANISH_EXPLAIN_KEYS) expect(pair.explanations[key], key).toBeTruthy();
    for (const rule of pack.rules) expect(pair.explanations[rule.explainKey], rule.id).toBeTruthy();
    expect(pair.falseFriends?.['embarazada']).toMatch(/pregnant/);
  });

  it('selects register packs by region (members also get the shared Caribbean pack)', () => {
    const pr = createDefaultSpanishPack({ regions: ['PR'] });
    expect(pr.registers.map((r) => r.region)).toEqual(['CARIB', 'PR']);
    expect(spanishRegistersFor([])).toEqual([]);
    expect(pr.analyze('asere')).toEqual([]); // Cuban, not loaded
    expect(pack.analyze('asere').length).toBeGreaterThan(0);
  });

  it('gives every single-word slang entry a part of speech through the analyzer', () => {
    for (const reg of pack.registers) {
      for (const e of reg.entries) {
        if (e.kind === 'phrase' || e.norm.includes(' ')) continue;
        const a = pack.analyze(e.norm).find((x) => x.lemma === e.lemma);
        expect(a, e.form).toBeDefined();
        expect(a?.pos, e.form).not.toBe('X');
      }
    }
  });

  it('glosses the most frequent lemmas', () => {
    const top = (pack.frequencyList ?? []).slice(0, 500);
    expect(top).toHaveLength(500);
    const missing = top.filter((lemma) => !pair.gloss(lemma));
    expect(missing).toEqual([]);
  });

  it('re-exports every tunable default from config', () => {
    for (const name of [
      'DEFAULT_HEAT_OPTIONS',
      'DEFAULT_NEXT_WORD_OPTIONS',
      'DEFAULT_CLIFF_OPTIONS',
      'DEFAULT_CREDIT_OPTIONS',
      'DEFAULT_VARIANT_OPTIONS',
      'DEFAULT_JUDGE_OPTIONS',
      'DEFAULT_LEARNER_PARAMS',
      'DEFAULT_DIFFICULTY_OPTIONS',
      'DEFAULT_RUNG_OPTIONS',
      'DEFAULT_PLACEMENT_OPTIONS',
      'DEFAULT_SELECT_OPTIONS',
      'DEFAULT_NEXT_SENTENCE_TUNING',
      'DEFAULT_CLIFF_PICK_OPTIONS',
      'DEFAULT_TARGET_OPTIONS',
      'DEFAULT_GAP_OPTIONS',
      'DEFAULT_EXTRACT_OPTIONS',
      'DEFAULT_ANALYZE_OPTIONS',
      'DEFAULT_FIND_SLANG_OPTIONS',
      'DEFAULT_EN_ES_OPTIONS',
    ]) {
      expect((config as Record<string, unknown>)[name], name).toBeDefined();
    }
  });
});

describe('corrections with the real pack', () => {
  it('"Soy cansado." is not ok and suggests estoy, explained by ser/estar', async () => {
    const j = await judgeSentence(model, pack, '', 'Soy cansado.');
    expect(j.verdict).not.toBe('ok');
    expect(j.best?.text).toBe('Estoy cansado.');
    expect(j.best?.replacement).toBe('Estoy');
    expect(j.explainKey).toBe('es.ser_estar');
    expect(j.wordIndex).toBe(0);
    expect(pair.explanations[j.explainKey as string]).toBeTruthy();
  });

  it('"Estoy cansado." is ok', async () => {
    const j = await judgeSentence(model, pack, '', 'Estoy cansado.');
    expect(j.verdict).toBe('ok');
    expect(j.explainKey).toBeNull();
    expect(j.variants.length).toBeGreaterThan(0);
    expect(j.variants.every((v) => v.margin < config.DEFAULT_JUDGE_OPTIONS.hintMargin)).toBe(true);
  });

  it('asserts other classic errors with the right explanation', async () => {
    const cases: Array<[string, string]> = [
      ['Gracias para la comida.', 'es.por_para'],
      ['La casa blanco es bonita.', 'es.gender'],
    ];
    for (const [text, key] of cases) {
      const j = await judgeSentence(model, pack, '', text);
      expect(j.verdict, text).not.toBe('ok');
      expect(j.explainKey, text).toBe(key);
    }
  });

  it('never touches slang words in a street sentence in street register', async () => {
    const slang = slangSegments(STREET);
    expect(slang.map((s) => s.text)).toEqual(['corillo', "'tá", "pa'"]);
    const variants = generateVariants(pack, STREET, { register: 'street' });
    for (const v of variants) {
      for (const s of slang) {
        const overlaps = v.start < s.end && s.start < v.end;
        const insertsBefore = v.start === v.end && v.start === s.start;
        expect(overlaps || insertsBefore, `${v.ruleId}: ${v.text}`).toBe(false);
        expect(v.text, v.ruleId).toContain(s.text);
      }
      // Number agreement is street tolerant: no number variants in street register.
      expect(v.explainKey).not.toBe('es.number');
    }
    const j = await judgeSentence(model, pack, '', STREET, { register: 'street' });
    expect(j.verdict).toBe('ok');
    for (const v of j.variants) for (const s of slang) expect(v.start < s.end && s.start < v.end).toBe(false);
  });

  it('protects slang in neutral register too, while number rules come back', () => {
    const variants = generateVariants(pack, STREET, { register: 'neutral' });
    expect(variants.some((v) => v.explainKey === 'es.number')).toBe(true);
    for (const v of variants) for (const s of slangSegments(STREET)) expect(v.text).toContain(s.text);
  });
});

describe('scoring with the real pack', () => {
  it('scoreWords aligns model tokens to the pack segments, clipped forms included', async () => {
    const plain = await scoreWords(model, pack, '', 'Marta llegó tarde al mercado.');
    expect(plain.map((w) => w.segment.text)).toEqual(['Marta', 'llegó', 'tarde', 'al', 'mercado']);
    expect(plain.map((w) => w.wordIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(plain.every((w) => w.heat === 0 && Number.isFinite(w.logprob))).toBe(true);

    const odd = await scoreWords(model, pack, '', 'Marta llegó tarde al elefante.');
    expect(odd[4]?.heat).toBe(3);
    expect(odd.slice(0, 4).every((w) => w.heat === 0)).toBe(true);

    const street = await scoreWords(model, pack, '', STREET);
    expect(street.map((w) => w.segment.text)).toEqual(['El', 'corillo', 'ya', "'tá", 'listo', "pa'", 'bailar']);
    expect(street.every((w) => w.heat === 0)).toBe(true);
  });

  it('nextWords merges sub-word pieces into whole words, normalized by the pack', async () => {
    const res = await nextWordsDetailed(model, 'Marta empezó a', { normalize: pack.normalize });
    const words = res.words.map((w) => w.norm);
    expect(words).toEqual(expect.arrayContaining(['leer', 'llorar', 'reír']));
    expect(res.modelCalls).toBeLessThanOrEqual(config.DEFAULT_NEXT_WORD_OPTIONS.maxModelCalls);
    const probs = res.words.map((w) => w.prob);
    expect([...probs].sort((a, b) => b - a)).toEqual(probs);
    // Long words are two mock tokens ("llor" + "ar"), merged back into one word.
    const plain = await nextWords(model, 'Marta empezó a', { normalize: pack.normalize });
    expect(plain.find((w) => w.norm === 'llorar')?.word).toBe('llorar');
  });

  it('credits every natural answer at a cliff, restoring missing accents', async () => {
    const ctx = 'Marta empezó a';
    const actual = await scoreCliffAnswer(model, pack, ctx, 'leer', 'leer');
    expect([actual.credit, actual.reason]).toEqual(['full', 'actual']);
    const other = await scoreCliffAnswer(model, pack, ctx, 'llorar', 'leer');
    expect([other.credit, other.reason]).toEqual(['full', 'likely']);
    const accentless = await scoreCliffAnswer(model, pack, ctx, 'reir', 'leer');
    expect(accentless.credit).toBe('full');
    expect(accentless.scored).toBe('reír');
    const form = await scoreCliffAnswer(model, pack, ctx, 'leyó', 'leer');
    expect([form.credit, form.reason]).toEqual(['partial', 'form']);
    const wrong = await scoreCliffAnswer(model, pack, ctx, 'mesa', 'leer');
    expect(wrong.credit).toBe('none');
  });
});

describe('gap capture with the real packs', () => {
  it('finds one gap in "Fui al hardware store" and keys the event by the Spanish lexeme', () => {
    const gaps = findNativeGaps('Fui al hardware store', pack, pair);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.text).toBe('hardware store');
    expect(gaps[0]?.candidates[0]).toBe('ferretería');
    expect(gaps[0]?.candidates).toContain('tienda');
    expect(gapEvents(gaps, pack, T0)).toEqual([{ type: 'native_gap', key: 'es:ferretería', at: T0 }]);
  });

  it('maps a pair-pack form to the pack lemma for the learner key', () => {
    const gaps = findNativeGaps('Vi a la girl en la playa.', pack, pair);
    expect(gaps.map((g) => g.text)).toEqual(['girl']);
    expect(gaps[0]?.candidates[0]).toBe('chica');
    expect(candidateLemma('chica', pack)).toBe('chico');
    expect(gapEvents(gaps, pack, T0)[0]?.key).toBe('es:chico');
  });

  it('never flags Spanish or street Spanish as native words', () => {
    expect(findNativeGaps(STREET, pack, pair)).toEqual([]);
    expect(findNativeGaps('No tengo pan, pero tengo café.', pack, pair)).toEqual([]);
  });
});

describe('one story step end to end', () => {
  it('generates, selects, picks a cliff, scores the answer, judges the reply and updates the learner', async () => {
    const learner = new LearnerModel();
    const known = ['marta', 'llegar', 'tarde', 'al', 'mercado', 'empezar', 'a', 'leer', 'el', 'nota', 'estar', 'cansado'];
    for (const lemma of known) learner.apply({ type: 'marked_known', key: lexemeKey('es', lemma), at: T0 - 3_600_000 });
    const now = T0;
    const params = deriveParams({ vocab: estimateVocabulary(learner, now, frequencyLexemeKeys(pack)) });
    const targets = chooseTargets({ learner, now, frequencyKeys: frequencyLexemeKeys(pack), extra: slangLexemeKeys(pack) });
    expect(targets).toHaveLength(1);

    // 1. Generate candidates and select the next sentence.
    const story = ['Marta llegó tarde al mercado.'];
    const next = await generateNextSentence(model, { pack, learner, pair }, { story, targets: targets.map((t) => t.key), params, now, seed: 3 });
    expect(next.sentence).not.toBeNull();

    // 2. Pick the cliff on a fixed sentence (deterministic for the assertions below).
    const sentence = ' Marta empezó a leer la nota.';
    const context = story.join(' ');
    const positions = await cliffPositions(model, pack, context, sentence);
    expect(positions).toHaveLength(6);
    const cliff = pickCliff(positions, { text: sentence, pack, learner, now, targets: ['es:leer'], params });
    expect(cliff).not.toBeNull();
    expect(cliff?.key).toBe('es:leer');
    const rung = cliffRungFor(learner, cliff?.key as string, now);
    expect(['options', 'hint', 'free']).toContain(rung);

    // 3. Score the learner's answer at the cliff.
    const before = context + sentence.slice(0, cliff?.start);
    const result = await scoreCliffAnswer(model, pack, before, 'llorar', cliff?.words.join(' ') as string);
    expect(result.credit).toBe('full');

    // 4. Judge a sentence the learner says.
    const judgement = await judgeSentence(model, pack, context, 'Soy cansado.');
    expect(judgement.verdict).not.toBe('ok');

    // 5. Update the learner from what happened.
    const events: LearnerEvent[] = [
      { type: 'cliff_answer', key: cliff?.key as string, at: now + 1000, credit: result.credit, rung },
      { type: 'spoke_error', key: 'es:ser', at: now + 2000 },
      ...gapEvents(findNativeGaps('Fui al hardware store', pack, pair), pack, now + 3000),
    ];
    const speakingBefore = learner.pKnown('es:leer', 'speaking', now);
    expect(learner.applyAll(events)).toBe(3);
    expect(learner.pKnown('es:leer', 'speaking', now + 5000)).toBeGreaterThan(speakingBefore);
    expect(learner.pKnown('es:ferretería', 'speaking', now + 5000)).toBeLessThan(0.05);
  });
});
