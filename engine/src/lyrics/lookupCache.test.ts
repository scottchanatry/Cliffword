/**
 * The lookup caches behind the per-step hot paths: the Spanish analyzer's per-word cache,
 * the register-form cache of slangIn / slangExemption and the findSlangMatches index.
 * Cached answers must equal uncached ones, never leak a caller's mutation, and follow a
 * pack whose register packs change.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import { createAnalyzer } from '../lang/es/analyze';
import { SPANISH_REGISTERS } from '../lang/es/registers';
import type { LanguagePack, RegisterPack } from '../lang/types';
import { slangExemption, slangIn } from '../scoring/context';
import { findSlangMatches } from './slang';

const pack = createDefaultSpanishPack();
const WORDS = ['casa', 'leerla', 'dámelo', 'estan', 'janguear', 'jangueamos', "'tá", 'pa', 'xyzzy', 'comida', 'vino', ''];

describe('Spanish analyzer cache', () => {
  it('gives the uncached analyses, as fresh copies', () => {
    const cached = createAnalyzer(SPANISH_REGISTERS);
    const plain = createAnalyzer(SPANISH_REGISTERS, { cacheSize: 0 });
    for (let round = 0; round < 2; round++) for (const w of WORDS) expect(cached(w), w).toEqual(plain(w));
    const a = cached('casa');
    (a[0] as { features: Record<string, string> }).features.gender = 'x';
    a.push({ lemma: 'zzz', pos: 'X', features: {} });
    expect(cached('casa')).toEqual(plain('casa'));
  });

  it('starts over when full and stays correct', () => {
    const tiny = createAnalyzer([], { cacheSize: 2 });
    const plain = createAnalyzer([], { cacheSize: 0 });
    for (let round = 0; round < 3; round++) for (const w of WORDS) expect(tiny(w), w).toEqual(plain(w));
  });
});

describe('slang lookups', () => {
  const TEXTS = ["Vamo' a janguear con el corillo, mano.", 'Esa jeva está bien chévere, qué es la que hay.', 'Tengo un chin de hambre.', 'Pa la casa, que ya tá tarde.', 'Hola.'];

  it('repeat calls give the same matches and forms, for every option set', () => {
    for (const text of TEXTS) {
      for (const opts of [{}, { alsoStandard: false }, { regions: ['PR'] }, { regions: ['DO', 'CARIB'], loose: false }, { kinds: ['word' as const] }]) {
        const first = findSlangMatches(pack, text, opts);
        expect(findSlangMatches(pack, text, opts), `${text} ${JSON.stringify(opts)}`).toEqual(first);
      }
      expect(slangIn(pack, text, ['PR'])).toEqual(slangIn(pack, text, ['PR']));
    }
    // Option sets do not share an index.
    const all = findSlangMatches(pack, 'Dale, pon la música.', { alsoStandard: true }).map((m) => m.text);
    const notStandard = findSlangMatches(pack, 'Dale, pon la música.', { alsoStandard: false }).map((m) => m.text);
    expect(all).toContain('Dale');
    expect(notStandard).not.toContain('Dale');
  });

  it('follows a pack whose register packs change', () => {
    const extra: RegisterPack = {
      ...(pack.registers[0] as RegisterPack),
      region: 'TEST',
      entries: [{ ...(pack.registers[0] as RegisterPack).entries[0]!, form: 'zorrocloco', norm: 'zorrocloco', lemma: 'zorrocloco', regions: ['TEST'] }],
    };
    const p2: LanguagePack = { ...pack, registers: [...pack.registers, extra] };
    expect(slangIn(pack, 'Un zorrocloco en la casa.', [])).toEqual([]);
    expect(slangIn(p2, 'Un zorrocloco en la casa.', [])).toEqual(['zorrocloco']);
    expect(findSlangMatches(pack, 'Un zorrocloco.', {}).map((m) => m.text)).toEqual([]);
    expect(findSlangMatches(p2, 'Un zorrocloco.', {}).map((m) => m.text)).toEqual(['zorrocloco']);
    // An entries array replaced in place is segmented again.
    const reg: RegisterPack = { ...extra, entries: [...extra.entries] };
    const p3: LanguagePack = { ...pack, registers: [reg] };
    expect(slangIn(p3, 'Un zorrocloco y un chinchorro.', [])).toEqual(['zorrocloco']);
    reg.entries = [{ ...extra.entries[0]!, form: 'chinchorro', norm: 'chinchorro', lemma: 'chinchorro' }];
    expect(slangIn(p3, 'Un zorrocloco y un chinchorro.', [])).toEqual(['chinchorro']);
    const ex = slangExemption(p3, []);
    expect(ex({ text: 'chinchorro', norm: 'chinchorro', start: 0, end: 10, kind: 'word' })).toBe(true);
  });
});
