/**
 * The feedback's "also natural" answers: the model's next-word search only sees the words
 * before the gap, so it proposes words that continue the sentence rather than fill the
 * gap. The lists below are what Qwen3-1.7B proposed for Living in San Juan episode 1
 * (proof/stories/model-check.ts); only words of the story word's class may be shown.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import type { NextWord } from '../scoring/types';
import { alternativeFits, feedbackAlternatives } from './library';

const pack = createDefaultSpanishPack();
const words = (list: string): NextWord[] => list.split(' ').map((w, i) => ({ word: w, prob: 0.3 - i * 0.01 }) as NextWord);
const alts = (expected: string, model: string, accept: string[] = []) =>
  feedbackAlternatives(pack, { expected, answer: expected, accept, model: words(model), floor: 0.01, max: 3 });

describe('feedbackAlternatives', () => {
  it('drops articles, prepositions and conjunctions proposed for a content word', () => {
    expect(alts('hambre', 'tu el mi un su la')).toEqual([]); // 'Pancho tiene ___.'
    expect(alts('favor', 'su el la eso que')).toEqual([]); // 'por ___.'
    expect(alts('cuatro', 'mismas herramientas raíces condiciones')).toEqual([]); // 'Son las ___.'
    expect(alts('cansada', 'aquí en aqui buscando de esperando')).toEqual(['buscando', 'esperando']); // 'Estás ___.'
  });

  it('keeps words of the same class, after the listed answers', () => {
    expect(alts('casa', 'casa cuarto cama habitación bolsillo', ['cuarto', 'cama'])).toEqual(['cuarto', 'cama', 'habitación']);
    expect(alts('bebé', 'hermano mejor perro amigo')).toEqual(['hermano', 'perro', 'amigo']);
    expect(alts('inglés', 'francés español inglés alemán')).toEqual(['francés', 'español', 'alemán']);
    expect(alts('Dónde', 'Y No Pero Puedes Qué A')).toEqual(['No']);
  });

  it('gives a closed-class story word no model alternative, and an unknown one only open-class or unknown words', () => {
    expect(alternativeFits(pack, 'todo', 'que')).toBe(false);
    expect(alternativeFits(pack, 'todo', 'eso')).toBe(false);
    // 'gallo' is not in the pack's lexicon: nouns and unknown words stay, 'que' goes.
    expect(alts('gallo', 'perro gato chico que')).toEqual(['perro', 'gato', 'chico']);
    expect(alternativeFits(pack, 'gallo', 'gallina')).toBe(true);
  });

  it('never drops the listed answers', () => {
    expect(alts('hambre', 'tu el', ['sueño', 'en'])).toEqual(['sueño', 'en']);
  });
});
