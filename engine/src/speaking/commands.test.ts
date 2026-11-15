import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import type { LanguagePack, Segment, SpokenCommand } from '../lang/types';
import { DEFAULT_COMMAND_OPTIONS, matchCommand } from './commands';
import { phraseKeys } from './text';

const pack = createDefaultSpanishPack();

function cmd(t: string, opts = {}): SpokenCommand | null {
  return matchCommand(t, pack, opts)?.command ?? null;
}

describe('matchCommand with the Spanish pack', () => {
  it('matches every listed phrase exactly, with confidence 1', () => {
    for (const entry of pack.commands ?? []) {
      for (const phrase of entry.phrases) {
        const m = matchCommand(phrase, pack);
        expect(m, phrase).not.toBeNull();
        expect(m?.command, phrase).toBe(entry.command);
        expect(m?.matched, phrase).toBe(phrase);
        expect(m?.confidence, phrase).toBe(1);
      }
    }
  });

  it('ignores case, punctuation and missing accents', () => {
    expect(matchCommand('No sé.', pack)).toEqual({ command: 'dont_know', confidence: 1, matched: 'no sé' });
    expect(matchCommand('no se', pack)).toEqual({ command: 'dont_know', confidence: 1, matched: 'no sé' });
    expect(matchCommand('NO SE', pack)?.command).toBe('dont_know');
    expect(matchCommand('mas despacio', pack)).toEqual({ command: 'slower', confidence: 1, matched: 'más despacio' });
    expect(matchCommand('¡Más despacio!', pack)?.command).toBe('slower');
    expect(matchCommand('¿Qué significa?', pack)?.command).toBe('meaning');
    expect(matchCommand('que significa', pack)?.command).toBe('meaning');
    expect(matchCommand('Otra vez...', pack)?.command).toBe('again');
    expect(matchCommand('termine', pack)?.command).toBe('done');
    expect(matchCommand('Siguiente', pack)?.command).toBe('next');
    expect(matchCommand('  listo  ', pack)?.command).toBe('done');
  });

  it('drops fillers around the command, at a small cost each', () => {
    const m = matchCommand('Eh... no sé', pack);
    expect(m?.command).toBe('dont_know');
    expect(m?.matched).toBe('no sé');
    expect(m?.confidence).toBeCloseTo(1 - DEFAULT_COMMAND_OPTIONS.fillerPenalty, 10);
    expect(matchCommand('pues, no sé', pack)?.command).toBe('dont_know');
    expect(matchCommand('mmm, otra vez', pack)?.command).toBe('again');
    const polite = matchCommand('Más despacio, por favor', pack);
    expect(polite?.command).toBe('slower');
    expect(polite?.confidence).toBeCloseTo(0.9, 10); // "por favor" is two filler words
    // A listed phrase with its polite tail costs nothing.
    expect(matchCommand('Otra vez, por favor', pack)).toEqual({ command: 'again', confidence: 1, matched: 'otra vez por favor' });
  });

  it('rejects an utterance buried in more than maxFillerWords fillers', () => {
    expect(cmd('eh, bueno, pues, o sea, no sé')).toBeNull();
    expect(cmd('eh, bueno, pues, no sé')).toBe('dont_know');
  });

  it('accepts a repeated command', () => {
    const m = matchCommand('No sé, no sé.', pack);
    expect(m?.command).toBe('dont_know');
    expect(m?.confidence).toBeCloseTo(1 - DEFAULT_COMMAND_OPTIONS.repeatPenalty, 10);
    expect(cmd('otra vez, otra vez')).toBe('again');
    expect(cmd('despacio, más despacio')).toBe('slower');
  });

  it('only matches when the utterance is essentially the command', () => {
    expect(cmd('no sé si viene')).toBeNull();
    expect(cmd('No sé si...')).toBeNull();
    expect(cmd('La comida está lista y yo estoy listo para comer')).toBeNull();
    expect(cmd('listo para comer')).toBeNull();
    expect(cmd('Ya llegué a casa')).toBeNull();
    expect(cmd('otra vez fui al mercado')).toBeNull();
    expect(cmd('no')).toBeNull();
    expect(cmd('sé')).toBeNull();
    expect(cmd('')).toBeNull();
    expect(cmd('...')).toBeNull();
    // Two different commands at once are not one command.
    expect(cmd('otra vez más despacio')).toBeNull();
  });

  it('allows one character off in one word of a multi-word phrase, never in a one-word phrase', () => {
    const m = matchCommand('otra ves', pack);
    expect(m?.command).toBe('again');
    expect(m?.confidence).toBeCloseTo(1 - DEFAULT_COMMAND_OPTIONS.fuzzyPenalty, 10);
    expect(cmd('más despasio')).toBe('slower');
    // "lista" is an answer, not "listo"; "sigo" is not "sigue".
    expect(cmd('lista')).toBeNull();
    expect(cmd('sigo')).toBeNull();
    // Short words never match loosely ("no ze" stays an answer), and two loose words are too many.
    expect(cmd('no ze')).toBeNull();
    expect(cmd('otro ves')).toBeNull();
    expect(cmd('otra ves', { fuzzy: false })).toBeNull();
  });

  it('takes an argument for "qué significa", before or after it', () => {
    expect(matchCommand('¿Qué significa puesto?', pack)).toEqual({ command: 'meaning', confidence: 1, matched: 'qué significa', argument: 'puesto' });
    expect(matchCommand('qué quiere decir de una', pack)).toEqual({
      command: 'meaning', confidence: 1, matched: 'qué quiere decir', argument: 'de una',
    });
    expect(matchCommand('puesto, ¿qué significa?', pack)?.argument).toBe('puesto');
    // Fillers are not an argument.
    expect(matchCommand('qué significa, eh', pack)).toEqual({ command: 'meaning', confidence: 0.95, matched: 'qué significa' });
    expect(matchCommand('qué significa eh puesto', pack)?.argument).toBe('puesto');
    // Too long an argument is a sentence.
    expect(cmd('qué significa la palabra que dijo ella')).toBeNull();
    // Other commands take no argument.
    expect(cmd('siguiente capítulo')).toBeNull();
  });

  it('treats the expected answer as an answer, not a command', () => {
    expect(cmd('ya')).toBe('done');
    expect(cmd('ya', { answer: 'ya' })).toBeNull();
    expect(cmd('Siguiente.', { answer: 'siguiente' })).toBeNull();
    expect(cmd('eh, siguiente', { answer: 'siguiente' })).toBeNull();
    expect(cmd('no sé', { answer: 'siguiente' })).toBe('dont_know');
  });

  it('uses the fillers given in the options instead of the defaults', () => {
    expect(cmd('eh no sé', { fillers: [] })).toBeNull();
    expect(cmd('vale no sé', { fillers: ['vale'] })).toBe('dont_know');
  });

  it('drops matches below minConfidence', () => {
    expect(cmd('eh, otra ves', { minConfidence: 0.8 })).toBeNull();
    expect(cmd('eh, otra ves', { minConfidence: 0.7 })).toBe('again');
  });

  it('rejects long utterances before any matching', () => {
    expect(cmd('no sé no sé no sé no sé no sé')).toBeNull(); // 10 words > maxWords
  });

  it('returns null for a pack without commands', () => {
    const bare: LanguagePack = { ...pack, commands: undefined };
    expect(matchCommand('no sé', bare)).toBeNull();
  });

  it('keeps its Spanish fillers clear of every command word', () => {
    const fillers = (pack.fillers ?? []).flatMap((f) => phraseKeys(pack, f));
    for (const entry of pack.commands ?? []) {
      for (const phrase of entry.phrases) {
        const keys = phraseKeys(pack, phrase);
        // A filler may occur inside a longer phrase ("por favor"), but no phrase is made only of fillers.
        expect(keys.every((k) => fillers.includes(k)), phrase).toBe(false);
      }
    }
    expect(fillers).not.toContain('ya');
    expect(fillers).not.toContain('si');
    expect(fillers).not.toContain('no');
  });
});

describe('matchCommand is language-neutral', () => {
  // A toy pack for a script without spaces: every character is a word.
  const seg = (text: string): Segment[] => {
    const out: Segment[] = [];
    let i = 0;
    for (const ch of text) {
      const kind = /\p{L}/u.test(ch) ? 'word' : /\s/u.test(ch) ? 'space' : 'punct';
      out.push({ text: ch, norm: kind === 'word' ? ch : kind === 'space' ? '' : ch, start: i, end: i + ch.length, kind });
      i += ch.length;
    }
    return out;
  };
  const toy: LanguagePack = {
    code: 'xx',
    segment: seg,
    normalize: (w) => w,
    analyze: () => [],
    inflect: () => undefined,
    frequencyRank: () => undefined,
    rules: [],
    registers: [],
    commands: [
      { command: 'again', phrases: ['もう一回'] },
      { command: 'dont_know', phrases: ['わからない'] },
    ],
  };

  it('segments through the pack, never on spaces', () => {
    expect(matchCommand('もう一回', toy)).toEqual({ command: 'again', confidence: 1, matched: 'もう一回' });
    expect(matchCommand('わからない。', toy)?.command).toBe('dont_know');
    expect(matchCommand('わからないです', toy)).toBeNull();
    // No default fillers for an unlisted language.
    expect(matchCommand('えー、わからない', toy)).toBeNull();
    expect(matchCommand('えー、わからない', toy, { fillers: ['えー'] })?.command).toBe('dont_know');
  });
});
