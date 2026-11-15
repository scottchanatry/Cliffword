/**
 * The engine package (../engine/src, plain TypeScript) runs inside the app's Jest through
 * the "@cliffword/engine" mapping and the app's Babel config.
 */
import {
  createDefaultPairPack,
  createDefaultSpanishPack,
  createMockModel,
  scoreWords,
} from '@cliffword/engine';

describe('@cliffword/engine inside the app', () => {
  const pack = createDefaultSpanishPack();
  const pair = createDefaultPairPack();
  const model = createMockModel();

  it('builds the en-es packs', () => {
    expect(pack.code).toBe('es');
    expect(pair.native).toBe('en');
    expect(pair.target).toBe('es');
    expect(pair.ui['tab.story']).toBe('Story');
    expect(pair.gloss('mercado')).toContain('market');
  });

  it('scores a sentence word by word with the mock model', async () => {
    const plain = await scoreWords(model, pack, '', 'Marta llegó tarde al mercado.');
    expect(plain.map((w) => w.segment.text)).toEqual(['Marta', 'llegó', 'tarde', 'al', 'mercado']);
    expect(plain.every((w) => Number.isFinite(w.logprob) && w.surprisal >= 0)).toBe(true);

    const odd = await scoreWords(model, pack, '', 'Marta llegó tarde al elefante.');
    expect(odd[4]?.heat).toBeGreaterThan(plain[4]?.heat ?? 0);
  });
});
