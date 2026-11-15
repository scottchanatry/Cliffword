import { describe, expect, it } from 'vitest';
import { createDefaultPairPack, createDefaultSpanishPack } from '../packs';
import { findNativeGaps, gapEvents } from '../gaps/capture';
import { nativeReply } from './native';

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const AT = Date.UTC(2026, 10, 15, 9, 0, 0);

describe('nativeReply', () => {
  it('offers the target phrase for native words inside a Spanish reply', () => {
    const r = nativeReply('Fui al hardware store', pack, pair, { at: AT });
    expect(r.hasNative).toBe(true);
    expect(r.allNative).toBe(false);
    expect(r.phrases).toEqual([
      { native: 'hardware store', start: 7, end: 21, target: 'ferretería', lemma: 'ferretería', fromExpected: false },
    ]);
    expect(r.targetPhrase).toBe('ferretería');
    expect(r.ui).toEqual({ key: 'cliff.repeatAloud' });
    expect(pair.ui['cliff.repeatAloud']).toBeTruthy();
  });

  it('keys its events exactly like gapEvents when nothing is expected', () => {
    for (const text of ['Fui al hardware store', 'Compré bread y milk', 'I went to the store', 'the market']) {
      const r = nativeReply(text, pack, pair, { at: AT });
      expect(r.gaps).toEqual(findNativeGaps(text, pack, pair));
      expect(r.events, text).toEqual(gapEvents(r.gaps, pack, AT));
    }
  });

  it('gives the expected cliff words, in their form, when the native answer means them', () => {
    const r = nativeReply('market', pack, pair, { at: AT, expected: 'mercado' });
    expect(r.allNative).toBe(true);
    expect(r.targetPhrase).toBe('mercado');
    expect(r.phrases[0]).toMatchObject({ target: 'mercado', lemma: 'mercado', fromExpected: true });
    expect(r.events).toEqual([{ type: 'native_gap', key: 'es:mercado', at: AT }]);

    // The whole expected span, punctuation trimmed.
    const span = nativeReply('the market', pack, pair, { at: AT, expected: ' al mercado.' });
    expect(span.targetPhrase).toBe('al mercado');
    expect(span.events).toEqual([{ type: 'native_gap', key: 'es:mercado', at: AT }]);

    // An inflected expected form: the candidate's lemma matches the lemma behind it, and the
    // learner repeats the story's own form ("cansada", not the dictionary "cansado").
    const tired = nativeReply('tired', pack, pair, { at: AT, expected: 'cansada' });
    expect(tired.phrases[0]).toMatchObject({ target: 'cansada', lemma: 'cansado', fromExpected: true });
    const girl = nativeReply('girl', pack, pair, { at: AT, expected: 'la chica' });
    expect(girl.targetPhrase).toBe('la chica');
    expect(girl.events).toEqual([{ type: 'native_gap', key: 'es:chico', at: AT }]);
  });

  it('falls back to the pair pack candidate when the answer means something else', () => {
    const r = nativeReply('market', pack, pair, { at: AT, expected: 'tienda' });
    expect(r.targetPhrase).toBe('mercado');
    expect(r.phrases[0]?.fromExpected).toBe(false);
  });

  it('joins several phrases with the separator given', () => {
    const r = nativeReply('Compré bread y milk', pack, pair, { at: AT });
    expect(r.phrases.map((p) => p.target)).toEqual(['pan', 'leche']);
    expect(r.targetPhrase).toBe('pan leche');
    expect(nativeReply('Compré bread y milk', pack, pair, { at: AT, phraseSeparator: ' / ' }).targetPhrase).toBe('pan / leche');
    expect(r.events.map((e) => e.key)).toEqual(['es:pan', 'es:leche']);
  });

  it('says nothing for an all-Spanish reply', () => {
    expect(nativeReply('Fui al mercado y compré pan.', pack, pair, { at: AT })).toEqual({
      hasNative: false, allNative: false, gaps: [], phrases: [], targetPhrase: null, events: [], ui: null,
    });
    expect(nativeReply('', pack, pair, { at: AT }).hasNative).toBe(false);
  });
});
