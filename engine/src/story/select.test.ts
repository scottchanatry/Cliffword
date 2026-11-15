import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECT_OPTIONS,
  analyzeWords,
  bandDistance,
  chooseAnalysis,
  detectPromptLeak,
  evaluateCandidate,
  hasUnbalancedQuotes,
  isRepeat,
  knownShareOf,
  lengthDistance,
  selectSentence,
} from './select';
import type { SelectContext } from './select';
import { promptInstructionLines } from './prompt';
import { createStubPack, createStubPair, learnerKnowing, stubLearner, stubParams } from './testStubs';

const pack = createStubPack();
const pair = createStubPair();

const KNOWN = [
  'el', 'un', 'su', 'a', 'al', 'de', 'en', 'con', 'y', 'pero', 'que', 'no', 'ya', 'muy', 'tarde', 'hoy',
  'mercado', 'pan', 'manzana', 'naranja', 'fruta', 'puesto', 'nota', 'puerta', 'casa', 'amigo', 'playa',
  'llegar', 'comprar', 'estar', 'ver', 'empezar', 'leer', 'volver', 'esperar', 'abrir', 'hablar', 'ir',
  'bailar', 'cansado', 'listo', 'cerrado', 'señor',
];

function ctx(over: Partial<SelectContext> = {}): SelectContext {
  return {
    pack,
    learner: learnerKnowing(KNOWN, 0.97),
    now: 1_000,
    targets: [],
    params: stubParams(),
    previous: [],
    ...over,
  };
}

describe('selectSentence: band and unknown words', () => {
  it('picks the candidate inside the band over one with too many unknown words', () => {
    const sel = selectSentence(
      ['Marta compró bicicletas, zanahorias y berenjenas.', 'Marta compró manzanas y naranjas.'],
      ctx(),
    );
    expect(sel.best?.text).toBe('Marta compró manzanas y naranjas.');
    expect(sel.best?.inBand).toBe(true);
    expect(sel.best?.knownShare).toBeCloseTo(0.97, 5);
    const worse = sel.ranked.find((e) => e.index === 0);
    expect(worse?.accepted).toBe(true);
    expect(worse?.inBand).toBe(false);
    expect(worse?.unknownNonTargets).toEqual(['es:bicicletas', 'es:zanahorias', 'es:berenjenas']);
    expect(worse?.parts.unknown).toBeCloseTo(-4 * (3 - 0.5), 6);
    expect(worse?.parts.band).toBeLessThan(-50);
    expect(sel.ranked.map((e) => e.index)).toEqual([1, 0]);
  });

  it('excludes PROPN and NUM from knownShare but counts them as words', () => {
    const e = evaluateCandidate('Marta compró 3 manzanas y tres naranjas.', 0, ctx());
    expect(e.wordCount).toBe(7);
    const counted = e.words.filter((w) => w.counted).map((w) => w.norm);
    expect(counted).toEqual(['compró', 'manzanas', 'y', 'naranjas']);
    expect(e.knownShare).toBeCloseTo(0.97, 6);
  });

  it('treats capitalized unknown words away from a sentence start as names', () => {
    const e = evaluateCandidate('Marta habló con Lucía en el mercado.', 0, ctx());
    const lucia = e.words.find((w) => w.norm === 'lucía');
    expect(lucia?.pos).toBe('PROPN');
    expect(lucia?.counted).toBe(false);
    expect(e.unknownNonTargets).toEqual([]);
    expect(e.inBand).toBe(true);
  });

  it('does not treat an unknown capitalized sentence start as a name', () => {
    const e = evaluateCandidate('Bicicletas compró Marta.', 0, ctx());
    const w = e.words[0];
    expect(w?.sentenceStart).toBe(true);
    expect(w?.pos).toBeNull();
    expect(w?.counted).toBe(true);
    expect(e.unknownNonTargets).toEqual(['es:bicicletas']);
  });

  it('prefers a PROPN analysis for a capitalized word mid-sentence', () => {
    const mid = evaluateCandidate('Marta habló con Rosa.', 0, ctx());
    expect(mid.words.find((w) => w.norm === 'rosa')?.pos).toBe('PROPN');
    const start = evaluateCandidate('Rosa es una flor.', 0, ctx());
    expect(start.words[0]?.pos).toBe('NOUN');
  });

  it('maps unknown words to their normalized form and missing accents stay distinct', () => {
    const e = evaluateCandidate('Marta compro pan.', 0, ctx());
    const compro = e.words.find((w) => w.norm === 'compro');
    expect(compro?.key).toBe('es:compro');
    expect(compro?.pos).toBeNull();
    expect(e.unknownNonTargets).toEqual(['es:compro']);
  });

  it('maps street forms through pack.analyze and accepts them', () => {
    const learner = learnerKnowing([...KNOWN, "'tá", "pa'", 'corillo'], 0.97);
    const e = evaluateCandidate("El corillo ya 'tá listo pa' bailar.", 0, ctx({ learner, pair }));
    expect(e.words.map((w) => w.key)).toContain("es:'tá");
    expect(e.words.map((w) => w.key)).toContain("es:pa'");
    expect(e.accepted).toBe(true);
    expect(e.inBand).toBe(true);
    expect(e.nativeWords).toEqual([]);
  });

  it('penalizes length outside sentenceWords', () => {
    const short = evaluateCandidate('Marta llegó.', 0, ctx());
    expect(short.wordCount).toBe(2);
    expect(short.parts.length).toBe(-2);
    const long = evaluateCandidate(
      'Marta llegó tarde al mercado y compró pan y manzanas y naranjas.',
      0,
      ctx(),
    );
    expect(long.wordCount).toBe(12);
    expect(long.parts.length).toBe(-4);
  });

  it('penalizes too-easy sentences less than too-hard ones', () => {
    const learner = learnerKnowing(KNOWN, 1);
    const easy = evaluateCandidate('Marta compró manzanas y naranjas.', 0, ctx({ learner }));
    expect(easy.parts.band).toBeCloseTo(-DEFAULT_SELECT_OPTIONS.aboveBandWeight * 0.02, 6);
    const hardLearner = learnerKnowing(KNOWN, 0.94);
    const hard = evaluateCandidate('Marta compró manzanas y naranjas.', 0, ctx({ learner: hardLearner }));
    expect(hard.parts.band).toBeCloseTo(-DEFAULT_SELECT_OPTIONS.belowBandWeight * 0.01, 6);
  });
});

describe('selectSentence: targets', () => {
  const learner = stubLearner(
    Object.fromEntries([...KNOWN.filter((k) => k !== 'comprar').map((k) => [`es:${k}`, 0.97]), ['es:comprar', 0.2]]),
  );

  it('gives a bonus to a candidate with a target word', () => {
    const sel = selectSentence(['Marta volvió a casa.', 'Marta compró pan.'], ctx({ learner, targets: ['es:comprar'] }));
    expect(sel.best?.text).toBe('Marta compró pan.');
    expect(sel.best?.targetsHit).toEqual(['es:comprar']);
    expect(sel.best?.parts.target).toBe(DEFAULT_SELECT_OPTIONS.targetBonus);
    expect(sel.best?.inBand).toBe(true);
    expect(sel.best?.knownShare).toBeLessThan(0.95);
    expect(sel.best?.bandShare).toBeCloseTo(0.97, 6);
  });

  it('accepts form keys as targets', () => {
    const e = evaluateCandidate('Marta compró pan.', 0, ctx({ learner, targets: ['es:comprar#tense=pret'] }));
    expect(e.targetsHit).toEqual(['es:comprar']);
  });

  it('does not count a target as an unknown non-target word', () => {
    const e = evaluateCandidate('Marta compró pan.', 0, ctx({ learner, targets: ['es:comprar'] }));
    expect(e.unknownNonTargets).toEqual([]);
    const noTarget = evaluateCandidate('Marta compró pan.', 0, ctx({ learner }));
    expect(noTarget.unknownNonTargets).toEqual(['es:comprar']);
  });

  it('can check the band with targets included', () => {
    const sel = selectSentence(
      ['Marta volvió a casa.', 'Marta compró pan.'],
      ctx({ learner, targets: ['es:comprar'], options: { bandExcludesTargets: false } }),
    );
    expect(sel.best?.text).toBe('Marta volvió a casa.');
  });

  it('counts each target lexeme once', () => {
    const e = evaluateCandidate('Marta compró pan y compró fruta.', 0, ctx({ learner, targets: ['es:comprar'] }));
    expect(e.targetsHit).toEqual(['es:comprar']);
    expect(e.parts.target).toBe(DEFAULT_SELECT_OPTIONS.targetBonus);
  });
});

describe('selectSentence: rejections', () => {
  it('rejects empty and punctuation-only candidates', () => {
    for (const text of ['', '   ', '...', '¿?', '«»', '123.']) {
      const e = evaluateCandidate(text, 0, ctx());
      expect(e.rejected, JSON.stringify(text)).toEqual(['empty']);
      expect(e.accepted).toBe(false);
    }
  });

  it('rejects repeats of previous sentences, ignoring case and punctuation', () => {
    const c = ctx({ previous: ['Marta llegó tarde al mercado. Buscó al señor de las frutas.'] });
    expect(evaluateCandidate('marta llegó tarde al mercado', 0, c).rejected).toContain('repeat');
    expect(evaluateCandidate('¡Marta llegó tarde al mercado!', 0, c).rejected).toContain('repeat');
    expect(evaluateCandidate('Buscó al señor de las frutas.', 0, c).rejected).toContain('repeat');
    expect(evaluateCandidate('Marta llegó tarde a casa.', 0, c).rejected).not.toContain('repeat');
  });

  it('rejects near repeats with the same word set', () => {
    expect(isRepeat('Al mercado llegó Marta tarde.', ['Marta llegó tarde al mercado.'], pack, 0.9)).toBe(true);
    expect(isRepeat('Marta llegó tarde al parque.', ['Marta llegó tarde al mercado.'], pack, 0.9)).toBe(false);
    expect(isRepeat('Marta llegó.', [], pack, 0.9)).toBe(false);
  });

  it('rejects prompt leakage: labels and meta words', () => {
    for (const text of [
      'Oración: Marta compró pan.',
      'Siguiente oración: Marta compró pan.',
      'Escribe la siguiente oración.',
      'Respuesta: Marta compró pan.',
      'Usa estas palabras en la historia.',
      'Marta compró pan, máximo 8 palabras.',
      'Here is the next sentence.',
    ]) {
      expect(evaluateCandidate(text, 0, ctx()).rejected, text).toContain('prompt_leak');
    }
    expect(evaluateCandidate('Marta compró pan en el mercado.', 0, ctx()).rejected).toEqual([]);
  });

  it('rejects candidates that echo the prompt instructions', () => {
    const instructions = promptInstructionLines({ targets: ['pan'], maxWords: 8, register: 'neutral' });
    const text = 'Habla en español neutro con Marta.';
    expect(detectPromptLeak(text, pack, [], instructions, 3)).toBe(true);
    expect(detectPromptLeak(text, pack, [], instructions, 4)).toBe(true);
    expect(detectPromptLeak('Marta habla con su amiga.', pack, [], instructions, 4)).toBe(false);
    expect(evaluateCandidate(text, 0, ctx({ instructions })).rejected).toContain('prompt_leak');
  });

  it('rejects English words when a pair pack is given', () => {
    const e = evaluateCandidate('Marta compró bread en el market.', 0, ctx({ pair }));
    expect(e.rejected).toContain('native_words');
    expect(e.nativeWords).toEqual(['bread', 'market']);
    const noPair = evaluateCandidate('Marta compró bread en el market.', 0, ctx());
    expect(noPair.rejected).not.toContain('native_words');
  });

  it('does not treat words that are also Spanish as English', () => {
    const e = evaluateCandidate('No quiero pan con la red.', 0, ctx({ pair }));
    expect(e.nativeWords).toEqual([]);
    expect(e.rejected).not.toContain('native_words');
  });

  it('does not treat a Spanish word missing its accent as English', () => {
    const e = evaluateCandidate('Marta quiero un cafe.', 0, ctx({ pair }));
    expect(e.nativeWords).toEqual([]);
  });

  it('allows a configured number of native words', () => {
    const e = evaluateCandidate('Marta compró bread.', 0, ctx({ pair, options: { maxNativeWords: 1 } }));
    expect(e.rejected).not.toContain('native_words');
  });

  it('rejects unbalanced quotes and brackets', () => {
    for (const text of [
      'Marta dijo "hola.',
      'Marta dijo “hola.',
      'Marta dijo «hola.',
      'Marta (compró pan.',
      '¿Dónde está Marta.',
      '¡Qué vaina.',
    ]) {
      expect(evaluateCandidate(text, 0, ctx()).rejected, text).toContain('unbalanced_quotes');
    }
  });

  it('accepts balanced quotes, apostrophes and informal question marks', () => {
    expect(hasUnbalancedQuotes('Marta dijo "hola".')).toBe(false);
    expect(hasUnbalancedQuotes("Eso 'tá brutal, pa' que sepas.")).toBe(false);
    expect(hasUnbalancedQuotes('Dónde está Marta?')).toBe(false);
    expect(hasUnbalancedQuotes('¿Dónde está?')).toBe(false);
    expect(hasUnbalancedQuotes('Marta (la amiga) llegó.')).toBe(false);
  });

  it('rejects run-on candidates far beyond the maximum length', () => {
    const words = Array.from({ length: 25 }, () => 'pan').join(' ');
    expect(evaluateCandidate(`${words}.`, 0, ctx()).rejected).toContain('too_long');
  });

  it('returns best null when every candidate is rejected, keeping input order', () => {
    const sel = selectSentence(['', 'Oración: hola.', 'Marta dijo "hola.'], ctx());
    expect(sel.best).toBeNull();
    expect(sel.ranked.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(sel.ranked.every((e) => e.reasons.some((r) => r.startsWith('rejected:')))).toBe(true);
  });

  it('ranks accepted candidates before rejected ones', () => {
    const sel = selectSentence(['', 'Marta compró bicicletas, zanahorias y berenjenas.', 'Marta compró pan.'], ctx());
    expect(sel.ranked.map((e) => e.accepted)).toEqual([true, true, false]);
    expect(sel.best?.index).toBe(2);
  });
});

describe('selectSentence: determinism and reasons', () => {
  it('breaks ties by input order', () => {
    const sel = selectSentence(['Marta compró pan.', 'Marta compró pan.'], ctx());
    expect(sel.best?.index).toBe(0);
    expect(sel.ranked.map((e) => e.index)).toEqual([0, 1]);
  });

  it('gives the same result on repeated calls', () => {
    const cands = ['Marta compró pan.', 'Marta llegó tarde al mercado.', 'Marta compró bicicletas.'];
    expect(selectSentence(cands, ctx())).toEqual(selectSentence(cands, ctx()));
  });

  it('explains each candidate', () => {
    const e = evaluateCandidate('Marta compró bicicletas.', 0, ctx({ targets: ['es:leer'] }));
    const text = e.reasons.join('\n');
    expect(text).toMatch(/known share/);
    expect(text).toMatch(/below by/);
    expect(text).toMatch(/no target hit/);
    expect(text).toMatch(/unknown non-targets: es:bicicletas/);
    expect(text).toMatch(/length 3 words/);
  });

  it('handles an empty candidate list', () => {
    expect(selectSentence([], ctx())).toEqual({ best: null, ranked: [] });
  });
});

describe('select helpers', () => {
  it('knownShareOf is 1 when nothing is counted', () => {
    const words = analyzeWords('Marta.', ctx());
    expect(knownShareOf(words)).toBe(1);
  });

  it('bandDistance and lengthDistance', () => {
    expect(bandDistance(0.9, { min: 0.95, max: 0.98 })).toEqual({ below: 0.95 - 0.9, above: 0 });
    expect(bandDistance(0.96, { min: 0.95, max: 0.98 })).toEqual({ below: 0, above: 0 });
    expect(bandDistance(1, { min: 0.95, max: 0.98 }).above).toBeCloseTo(0.02, 9);
    expect(lengthDistance(3, { min: 4, max: 8 })).toBe(1);
    expect(lengthDistance(6, { min: 4, max: 8 })).toBe(0);
    expect(lengthDistance(10, { min: 4, max: 8 })).toBe(2);
  });

  it('chooseAnalysis', () => {
    const a = pack.analyze('rosa');
    expect(chooseAnalysis(a, false)?.pos).toBe('NOUN');
    expect(chooseAnalysis(a, true)?.pos).toBe('PROPN');
    expect(chooseAnalysis(pack.analyze('mercado'), true)?.pos).toBe('NOUN');
    expect(chooseAnalysis([], true)).toBeUndefined();
  });

  it('clamps out-of-range learner probabilities', () => {
    const learner = stubLearner({ 'es:pan': 1.5, 'es:comprar': Number.NaN }, 0.97);
    const words = analyzeWords('Marta compró pan.', ctx({ learner }));
    expect(words.find((w) => w.norm === 'pan')?.pKnown).toBe(1);
    expect(words.find((w) => w.norm === 'compró')?.pKnown).toBe(0);
  });
});
