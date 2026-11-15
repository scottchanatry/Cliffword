import { describe, expect, it } from 'vitest';
import type { Segment } from '../lang/types';
import type { CliffPosition } from '../scoring/types';
import { totalLogprob } from '../model/types';
import { createMockModel } from '../model/mock';
import { DEFAULT_CLIFF_PICK_OPTIONS, cliffSpan, pickCliff, rankCliffPositions } from './cliffPick';
import type { CliffPickContext } from './cliffPick';
import { sentenceEndFlags } from './text';
import { createStubPack, learnerKnowing, stubLearner, stubParams } from './testStubs';

const pack = createStubPack();
const KNOWN = ['empezar', 'a', 'leer', 'el', 'nota', 'comprar', 'pan', 'en', 'mercado', 'ella', 'hablar', 'con', 'casa', 'llegar', 'tarde', 'manzana', 'tres'];

/** Positions for every word of `text`, with P(actual) from `probs` (default 0.5). */
function positionsFor(text: string, probs: readonly number[] = []): CliffPosition[] {
  const words = pack.segment(text).filter((s) => s.kind === 'word');
  return words.map((segment, wordIndex) => ({
    wordIndex,
    segment,
    actualLogprob: Math.log(probs[wordIndex] ?? 0.5),
    alternatives: [],
    plausibleCount: 1,
  }));
}

function ctx(text: string, over: Partial<CliffPickContext> = {}): CliffPickContext {
  return {
    text,
    pack,
    learner: learnerKnowing(KNOWN, 0.5),
    now: 0,
    targets: [],
    params: stubParams(),
    ...over,
  };
}

describe('pickCliff exclusions', () => {
  it('never cliffs on the first word, even when it is the best target', () => {
    const text = 'Ella compró pan en el mercado.';
    const pos = positionsFor(text, [0.99, 0.1, 0.1, 0.1, 0.1, 0.1]);
    const pick = pickCliff(pos, ctx(text, { targets: ['es:ella'] }));
    expect(pick).not.toBeNull();
    expect(pick?.wordIndex).not.toBe(0);
    expect(pickCliff(pos.slice(0, 1), ctx(text, { targets: ['es:ella'] }))).toBeNull();
    expect(rankCliffPositions(pos.slice(0, 1), ctx(text))[0]?.excluded).toEqual(['first_word']);
  });

  it('never cliffs on the first word of a later sentence', () => {
    const text = 'Marta llegó tarde. Compró pan en el mercado.';
    const pos = positionsFor(text);
    const r = rankCliffPositions(pos, ctx(text, { targets: ['es:comprar'] }));
    expect(r.find((c) => c.position.segment.text === 'Compró')?.excluded).toEqual(['sentence_start']);
    const pick = pickCliff(pos, ctx(text, { targets: ['es:comprar'] }));
    expect(pick).not.toBeNull();
    expect(pick?.words[0]).not.toBe('Compró');
  });

  it('never cliffs on proper nouns, known or unknown', () => {
    const text = 'Ella habló con Rosa y Lucía en casa.';
    const pos = positionsFor(text);
    const r = rankCliffPositions(pos, ctx(text, { targets: ['es:Rosa', 'es:lucía'] }));
    expect(r.find((c) => c.position.segment.text === 'Rosa')?.excluded).toContain('proper_noun');
    expect(r.find((c) => c.position.segment.text === 'Lucía')?.excluded).toContain('proper_noun');
    const pick = pickCliff(pos, ctx(text, { targets: ['es:Rosa', 'es:lucía'] }));
    expect(pick).not.toBeNull();
    expect(['Rosa', 'Lucía']).not.toContain(pick?.words[0]);
  });

  it('never cliffs on numbers, as words or as digits', () => {
    const text = 'Marta compró tres manzanas y 3 naranjas.';
    const segs = pack.segment(text);
    const digit = segs.find((s) => s.kind === 'number') as Segment;
    const pos: CliffPosition[] = [
      ...positionsFor(text),
      { wordIndex: 99, segment: digit, actualLogprob: Math.log(0.9), alternatives: [], plausibleCount: 1 },
    ];
    const r = rankCliffPositions(pos, ctx(text, { targets: ['es:tres'] }));
    expect(r.find((c) => c.position.segment.text === 'tres')?.excluded).toEqual(['number']);
    expect(r.find((c) => c.position.segment.text === '3')?.excluded).toEqual(['number']);
    const pick = pickCliff(pos, ctx(text, { targets: ['es:tres'] }));
    expect(pick).not.toBeNull();
    expect(pick?.words[0]).not.toBe('tres');
  });

  it('never cliffs on punctuation', () => {
    const text = 'Ella compró pan.';
    const dot = pack.segment(text).find((s) => s.text === '.') as Segment;
    const pos: CliffPosition[] = [{ wordIndex: 3, segment: dot, actualLogprob: 0, alternatives: [], plausibleCount: 1 }];
    expect(rankCliffPositions(pos, ctx(text))[0]?.excluded).toContain('punctuation');
    expect(pickCliff(pos, ctx(text))).toBeNull();
  });

  it('requires the actual word to be plausible', () => {
    const text = 'Ella compró pan en el mercado.';
    const pos = positionsFor(text, [0.5, 0.01, 0.019, 0.5, 0.5, 0.5]);
    const r = rankCliffPositions(pos, ctx(text, { targets: ['es:comprar', 'es:pan'] }));
    expect(r[1]?.excluded).toEqual(['implausible']);
    expect(r[2]?.excluded).toEqual(['implausible']);
    const pick = pickCliff(pos, ctx(text, { targets: ['es:comprar', 'es:pan'] }));
    expect(pick).not.toBeNull();
    expect(['compró', 'pan']).not.toContain(pick?.words[0]);
    const lenient = pickCliff(pos, ctx(text, { targets: ['es:pan'], options: { probFloor: 0.015 } }));
    expect(lenient?.words[0]).toBe('pan');
  });

  it('skips positions that are not in the text', () => {
    const text = 'Ella compró pan.';
    const other = positionsFor('Marta vio una nota en la puerta.');
    const r = rankCliffPositions(other.slice(4, 6), ctx(text));
    expect(r.every((c) => c.excluded.includes('not_in_text'))).toBe(true);
    expect(pickCliff(other.slice(4, 6), ctx(text))).toBeNull();
  });

  it('returns null for no positions and for empty or punctuation-only text', () => {
    expect(pickCliff([], ctx('Ella compró pan.'))).toBeNull();
    expect(pickCliff([], ctx(''))).toBeNull();
    expect(pickCliff(positionsFor('...'), ctx('...'))).toBeNull();
  });
});

describe('pickCliff preferences', () => {
  it('prefers a target being practiced', () => {
    const text = 'Ella compró pan en el mercado.';
    const pos = positionsFor(text);
    expect(pickCliff(pos, ctx(text, { targets: ['es:pan'] }))?.words).toEqual(['pan']);
    expect(pickCliff(pos, ctx(text, { targets: ['es:mercado'] }))?.words).toEqual(['mercado']);
  });

  it('accepts form keys as targets', () => {
    const text = 'Ella compró pan en el mercado.';
    expect(pickCliff(positionsFor(text), ctx(text, { targets: ['es:comprar#tense=pret'] }))?.key).toBe('es:comprar');
  });

  it('prefers words known for meaning but not yet for speaking', () => {
    const text = 'Ella compró pan en el mercado.';
    const learner = stubLearner(
      {
        'es:pan': { meaning: 0.9, speaking: 0.1 },
        'es:mercado': { meaning: 0.9, speaking: 0.95 },
        'es:comprar': { meaning: 0.1, speaking: 0 },
      },
      0,
    );
    const pick = pickCliff(positionsFor(text), ctx(text, { learner, options: { contextWeight: 0 } }));
    expect(pick?.words).toEqual(['pan']);
  });

  it('breaks ties by higher probability, then by the later word', () => {
    const text = 'Ella compró pan en el mercado.';
    const flat = { learner: stubLearner({}, 0), options: { contextWeight: 0, probWeight: 0 } };
    const probs = [0.5, 0.3, 0.6, 0.3, 0.3, 0.3];
    expect(pickCliff(positionsFor(text, probs), ctx(text, flat))?.words).toEqual(['pan']);
    expect(pickCliff(positionsFor(text, [0.5, 0.3, 0.3, 0.3, 0.3, 0.3]), ctx(text, flat))?.words).toEqual(['mercado']);
  });

  it('explains its judgement', () => {
    const text = 'Ella compró pan.';
    const r = rankCliffPositions(positionsFor(text), ctx(text, { targets: ['es:pan'] }));
    const pan = r.find((c) => c.position.segment.text === 'pan');
    expect(pan?.eligible).toBe(true);
    expect(pan?.score).toBeGreaterThan(DEFAULT_CLIFF_PICK_OPTIONS.targetBonus);
    expect(pan?.reasons.join('\n')).toMatch(/target es:pan/);
    expect(pan?.reasons.join('\n')).toMatch(/P\(actual\) 0.5/);
  });

  it('handles street forms with apostrophes', () => {
    const text = "El corillo ya 'tá listo pa' bailar.";
    const pick = pickCliff(positionsFor(text), ctx(text, { targets: ["es:'tá"] }));
    expect(pick?.words).toEqual(["'tá"]);
    expect(pick?.key).toBe("es:'tá");
    const pa = pickCliff(positionsFor(text), ctx(text, { targets: ["es:pa'"] }));
    expect(pa?.words).toEqual(["pa'"]);
  });
});

describe('pickCliff length', () => {
  const text = 'Marta empezó a leer la nota. Luego volvió a casa.';

  it('hides params.cliffWords words from the cliff', () => {
    const pick = pickCliff(positionsFor(text), ctx(text, { targets: ['es:leer'], params: stubParams({ cliffWords: 3 }) }));
    expect(pick?.wordIndex).toBe(3);
    expect(pick?.words).toEqual(['leer', 'la', 'nota']);
    expect(text.slice(pick?.start, pick?.end)).toBe('leer la nota');
    expect(pick?.segments.map((s) => s.text)).toEqual(['leer', 'la', 'nota']);
  });

  it('cuts the cliff at the end of the sentence', () => {
    const pick = pickCliff(positionsFor(text), ctx(text, { targets: ['es:nota'], params: stubParams({ cliffWords: 4 }) }));
    expect(pick?.words).toEqual(['nota']);
    expect(pick?.end).toBe(text.indexOf('nota') + 4);
  });

  it('rounds fractional cliff lengths and hides at least one word', () => {
    const two = pickCliff(positionsFor(text), ctx(text, { targets: ['es:leer'], params: stubParams({ cliffWords: 1.6 }) }));
    expect(two?.words).toEqual(['leer', 'la']);
    const one = pickCliff(positionsFor(text), ctx(text, { targets: ['es:leer'], params: stubParams({ cliffWords: 0 }) }));
    expect(one?.words).toEqual(['leer']);
  });

  it('stops the hidden span before a number or a name (alg-6)', () => {
    const t = 'Marta compró 3 manzanas.';
    const pick = pickCliff(positionsFor(t), ctx(t, { targets: ['es:comprar'], params: stubParams({ cliffWords: 2 }) }));
    expect(pick?.words).toEqual(['compró']);
    const u = 'Ella habló con Rosa y Lucía en casa.';
    const pu = positionsFor(u);
    const withName = pickCliff([pu[2] as CliffPosition], ctx(u, { params: stubParams({ cliffWords: 3 }) }));
    expect(withName?.words).toEqual(['con']);
    const later = pickCliff([pu[4] as CliffPosition], ctx(u, { params: stubParams({ cliffWords: 2 }) }));
    expect(later?.words).toEqual(['y']);
    const free = pickCliff([pu[6] as CliffPosition], ctx(u, { params: stubParams({ cliffWords: 2 }) }));
    expect(free?.words).toEqual(['en', 'casa']);
  });

  it('cliffSpan counts digits as words unless told to stop before them', () => {
    const segs = pack.segment('Marta compró 3 manzanas.');
    const ends = sentenceEndFlags(segs);
    const i = segs.findIndex((s) => s.text === 'compró');
    expect(cliffSpan(i, 2, segs, ends).map((s) => s.text)).toEqual(['compró', '3']);
    expect(cliffSpan(i, 2, segs, ends, (j) => segs[j]?.kind === 'number').map((s) => s.text)).toEqual(['compró']);
  });

  it('cliffSpan stops at sentence ends', () => {
    const segs = pack.segment('Ella compró pan. Luego volvió.');
    const ends = sentenceEndFlags(segs);
    const i = segs.findIndex((s) => s.text === 'pan');
    expect(cliffSpan(i, 5, segs, ends).map((s) => s.text)).toEqual(['pan']);
  });

  it('does not treat the period of an abbreviation as a sentence end', () => {
    const t = 'Ella vio al Sr. García en el mercado.';
    const pos = positionsFor(t);
    const r = rankCliffPositions(pos, ctx(t));
    expect(r.find((c) => c.position.segment.text === 'García')?.excluded).toEqual(['proper_noun']);
    expect(r.find((c) => c.position.segment.text === 'García')?.excluded).not.toContain('sentence_start');
  });
});

describe('pickCliff with mock model probabilities', () => {
  async function scoredPositions(text: string): Promise<CliffPosition[]> {
    const model = createMockModel();
    const words = pack.segment(text).filter((s) => s.kind === 'word');
    const out: CliffPosition[] = [];
    for (const [wordIndex, segment] of words.entries()) {
      const ctxEnd = text.slice(0, segment.start).trimEnd().length;
      const tokens = await model.scoreContinuation(text.slice(0, ctxEnd), text.slice(ctxEnd, segment.end));
      out.push({ wordIndex, segment, actualLogprob: totalLogprob(tokens), alternatives: [], plausibleCount: 1 });
    }
    return out;
  }

  it('picks a plausible, eligible word deterministically', async () => {
    const text = 'Marta empezó a leer la nota.';
    const pos = await scoredPositions(text);
    const c = ctx(text, { targets: ['es:leer'] });
    const a = pickCliff(pos, c);
    const b = pickCliff(await scoredPositions(text), c);
    expect(a).toEqual(b);
    expect(a?.words).toEqual(['leer']);
    expect(Math.exp(pos[3]?.actualLogprob ?? -Infinity)).toBeGreaterThan(DEFAULT_CLIFF_PICK_OPTIONS.probFloor);
  });
});
