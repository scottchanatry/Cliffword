import { describe, expect, it } from 'vitest';
import type { SpokenCommand } from '../types';
import { SPANISH_COMMANDS } from './commands';
import { createSpanishPack } from './index';

const ALL: readonly SpokenCommand[] = ['again', 'slower', 'dont_know', 'next', 'done', 'meaning'];
const pack = createSpanishPack();

/** Word norms of a phrase, through the pack's own segmenter and normalizer. */
function words(phrase: string): string[] {
  return pack.segment(phrase).filter((s) => s.kind === 'word').map((s) => s.norm);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

describe('SPANISH_COMMANDS', () => {
  it('has every command exactly once', () => {
    expect(SPANISH_COMMANDS.map((c) => c.command).sort()).toEqual([...ALL].sort());
  });

  it('lists the required phrases', () => {
    const of = (c: SpokenCommand) => SPANISH_COMMANDS.find((e) => e.command === c)?.phrases;
    expect(of('again')).toEqual(['otra vez', 'de nuevo', 'repite', 'repítelo', 'otra vez por favor']);
    expect(of('slower')).toEqual(['más despacio', 'despacio', 'más lento', 'más lento por favor']);
    expect(of('dont_know')).toEqual(['no sé', 'no lo sé', 'ni idea', 'no me acuerdo']);
    expect(of('next')).toEqual(['siguiente', 'sigue', 'adelante', 'la próxima']);
    expect(of('done')).toEqual(['listo', 'ya', 'terminé', 'ya terminé']);
    expect(of('meaning')).toEqual(['qué significa', 'qué quiere decir', 'qué es eso']);
  });

  it('writes phrases lowercase, trimmed, single-spaced, without punctuation, already normalized', () => {
    for (const { command, phrases } of SPANISH_COMMANDS) {
      expect(phrases.length, command).toBeGreaterThan(0);
      for (const p of phrases) {
        expect(p, command).toBe(p.normalize('NFC').trim().toLowerCase());
        expect(p, command).toMatch(/^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u);
        expect(words(p).join(' '), p).toBe(p);
      }
    }
  });

  it('gives each phrase to one command only, and no phrase of one command occurs inside another command', () => {
    const owner = new Map<string, SpokenCommand>();
    for (const { command, phrases } of SPANISH_COMMANDS) {
      for (const p of phrases) {
        expect(owner.has(p), p).toBe(false);
        owner.set(p, command);
      }
    }
    for (const [a, ca] of owner) {
      for (const [b, cb] of owner) {
        if (ca === cb) continue;
        expect(containsRun(words(b), words(a)), `"${a}" (${ca}) inside "${b}" (${cb})`).toBe(false);
      }
    }
  });

  it('is the default commands list of the Spanish pack, and can be replaced', () => {
    expect(pack.commands).toBe(SPANISH_COMMANDS);
    const own = [{ command: 'again' as const, phrases: ['otra'] }];
    expect(createSpanishPack({ commands: own }).commands).toBe(own);
  });
});
