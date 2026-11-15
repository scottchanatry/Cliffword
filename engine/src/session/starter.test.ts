/**
 * The en-es starter story (PairPack.starter data) checked against the real Spanish pack:
 * every cliff can be located, cliffs of the zero-knowledge scene are cognates, the
 * distractors are other words, and the placement ladder climbs the frequency bands.
 * Also the session module's own rules: no clock, no randomness, no language data, and
 * every interface string named by a key.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { bandOf } from '../learner/placement';
import { EN_ES_STARTER } from '../pair/en-es/starter';
import { looseText } from './common';
import { locateAnswer } from './cliff';
import { sentenceWords } from './view';
import { SESSION_UI_KEYS } from './uiKeys';

// Vite's static glob import (the engine's tsconfig has no Node or Vite client types).
declare global {
  interface ImportMeta {
    glob(pattern: string | string[], opts: { query: string; import: string; eager: true }): Record<string, string>;
  }
}

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();

function cliffWord(text: string, answer: string) {
  const span = locateAnswer(pack, text, answer);
  expect(span, `${text} / ${answer}`).not.toBeNull();
  const w = sentenceWords(pack, text, { register: 'neutral', regions: [] })[span?.wordIndex ?? -1];
  expect(w, text).toBeDefined();
  return w as NonNullable<typeof w>;
}

describe('en-es starter story', () => {
  it('locates every cliff after the first word, with distractors that are other lemmas', () => {
    for (const s of [...EN_ES_STARTER.sentences, ...(EN_ES_STARTER.probes ?? [])]) {
      const w = cliffWord(s.text, s.answer);
      expect(w.index, s.text).toBeGreaterThan(0);
      expect(s.distractors.length, s.text).toBeGreaterThanOrEqual(1);
      expect(s.distractors.length, s.text).toBeLessThanOrEqual(2);
      for (const d of s.distractors) {
        expect(looseText(pack, d), `${s.text}: ${d}`).not.toBe(looseText(pack, s.answer));
        const lemmas = pack.analyze(pack.normalize(d)).map((a) => a.lemma);
        expect(lemmas.length, `${d} is a Spanish word`).toBeGreaterThan(0);
        expect(lemmas, `${s.text}: ${d}`).not.toContain(w.lemma);
      }
      expect(s.translation, s.text).toBeTruthy();
    }
  });

  it('builds the zero-knowledge scene on cognates and the taught function words', () => {
    const taught = new Set(EN_ES_STARTER.taught);
    for (const lemma of taught) expect(pack.frequencyRank(lemma), lemma).toBeDefined();
    for (const s of EN_ES_STARTER.sentences) {
      const w = cliffWord(s.text, s.answer);
      expect(pair.cognates.has(w.lemma ?? ''), `${s.answer} is a cognate`).toBe(true);
      for (const d of s.distractors) {
        const lemma = pack.analyze(pack.normalize(d))[0]?.lemma ?? d;
        expect(pair.cognates.has(lemma), `distractor ${d} is a cognate`).toBe(true);
      }
      // Every word is known to the pack: nothing in the first story is outside the lexicon.
      for (const x of sentenceWords(pack, s.text, { register: 'neutral', regions: [] })) {
        if (x.pos === 'PROPN') continue;
        expect(x.lemma, `${s.text}: ${x.text}`).not.toBeNull();
      }
    }
    // Most content of the scene is cognates or taught words.
    const words = EN_ES_STARTER.sentences.flatMap((s) => sentenceWords(pack, s.text, { register: 'neutral', regions: [] }).filter((x) => x.pos !== 'PROPN'));
    const easy = words.filter((x) => x.lemma !== null && (pair.cognates.has(x.lemma) || taught.has(x.lemma)));
    expect(easy.length / words.length).toBeGreaterThan(0.6);
  });

  it('climbs the frequency bands on the placement ladder', () => {
    const bands = (EN_ES_STARTER.probes ?? []).map((s) => {
      const w = cliffWord(s.text, s.answer);
      const rank = pack.frequencyRank(w.lemma ?? '');
      expect(rank, s.answer).toBeDefined();
      return bandOf(rank as number);
    });
    expect(bands.length).toBeGreaterThanOrEqual(12);
    for (let i = 1; i < bands.length; i++) expect(bands[i] as number).toBeGreaterThanOrEqual(bands[i - 1] as number);
    expect(new Set(bands).size).toBeGreaterThanOrEqual(7);
    expect(Math.min(...bands)).toBeLessThanOrEqual(3);
    expect(Math.max(...bands)).toBeGreaterThanOrEqual(10);
  });

  it('asks questions the learner can answer', () => {
    expect(EN_ES_STARTER.prompts?.length).toBeGreaterThanOrEqual(3);
    for (const p of EN_ES_STARTER.prompts ?? []) expect(p.line).toMatch(/\?$/);
  });
});

/** Engine source files of this module (tests excluded), comments removed. */
const sources = Object.entries(import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true })).map(
  ([path, text]) => ({
    file: path.replace(/^\.\//, ''),
    code: text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
  }),
);

describe('session module rules', () => {
  it('reads no clock and no randomness, and imports no language or pair data', () => {
    expect(sources.map((s) => s.file).sort()).toEqual(['cliff.ts', 'common.ts', 'index.ts', 'lyric.ts', 'story.ts', 'types.ts', 'uiKeys.ts', 'view.ts']);
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/Date\.now|new Date|Math\.random|performance\.now/);
      expect(code, file).not.toMatch(/from '\.\.\/(lang\/es|pair\/en-es|packs)/);
    }
  });

  it('keeps target-language words and native display text out of the code', () => {
    for (const { file, code } of sources) {
      expect(code, file).not.toMatch(/[áéíóúñü¿¡]/i);
      for (const word of ['otra vez', 'no se', 'siguiente', 'listo', 'marta', 'you landed', 'times in 100', 'just as natural', 'asks you']) {
        expect(code.toLowerCase(), `${file}: ${word}`).not.toContain(word);
      }
    }
  });

  it('names every interface string by key; keys of the speaking module exist in the en-es pack', () => {
    const keys = new Set<string>();
    for (const { code } of sources) for (const m of code.matchAll(/key: '([a-z]+\.[A-Za-z.]+)'/g)) keys.add(m[1] as string);
    for (const k of keys) expect(SESSION_UI_KEYS, k).toContain(k);
    for (const k of ['cliff.pickOne', 'cliff.hint', 'cliff.prompt', 'cliff.repeatAloud', 'landing.likely', 'landing.unlikely', 'repair.prompt', 'retell.round', 'stats.understood', 'music.singBack']) {
      expect(pair.ui[k], k).toBeTruthy();
    }
    expect(pair.ui['cliff.hint']).toContain('{sound}');
  });
});
