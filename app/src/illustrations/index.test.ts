import fs from 'fs';
import path from 'path';

import { CAST, CAST_IDS, COVER_IDS, COVERS, SCENE_IDS, SCENES, VOCAB, VOCAB_BY_WORD, VOCAB_IDS, vocabIdForWord, vocabImageForWord } from './index';

const ROOT = path.join(__dirname, '../../assets/illustrations');

describe('illustrations', () => {
  const groups = [
    ['covers', COVER_IDS, COVERS],
    ['cast', CAST_IDS, CAST],
    ['scenes', SCENE_IDS, SCENES],
    ['vocab', VOCAB_IDS, VOCAB],
  ] as const;

  it.each(groups)('%s: every id has its source and its 1x, @2x and @3x PNGs', (group, ids, map) => {
    expect(Object.keys(map).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(map[id as keyof typeof map]).toBeTruthy();
      for (const file of [`src/${group}/${id}.svg`, `${group}/${id}.png`, `${group}/${id}@2x.png`, `${group}/${id}@3x.png`]) {
        expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
      }
    }
  });

  it('maps words to vocab ids that exist, and every picture has a word', () => {
    const ids = new Set<string>(VOCAB_IDS);
    for (const [word, id] of Object.entries(VOCAB_BY_WORD)) {
      expect(word).toBe(word.toLocaleLowerCase('es'));
      expect(ids.has(id)).toBe(true);
    }
    expect(new Set(Object.values(VOCAB_BY_WORD)).size).toBe(VOCAB_IDS.length);
  });

  it('finds a picture for a word as it appears in a sentence', () => {
    expect(vocabIdForWord('¡Las chancletas!')).toBe('chancletas');
    expect(vocabIdForWord('un coco frío')).toBe('coco-frio');
    expect(vocabIdForWord('Coco Frio')).toBe('coco-frio');
    expect(vocabIdForWord('el semaforo')).toBe('semaforo');
    expect(vocabIdForWord('Teléfono.')).toBe('telefono');
    expect(vocabIdForWord('chavos')).toBe('dinero');
    expect(vocabIdForWord('nube')).toBeUndefined();
    expect(vocabImageForWord('mofongo')).toBe(VOCAB.mofongo);
  });
});
