import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { attachClitic, splitClitics } from './clitics';
import { createSpanishPack } from './index';

describe('attachClitic', () => {
  it('keeps the host stress with a written accent where needed', () => {
    expect(attachClitic('leyendo', 'lo')).toBe('leyéndolo');
    expect(attachClitic('haz', 'lo')).toBe('hazlo');
    expect(attachClitic('ver', 'te')).toBe('verte');
    expect(attachClitic('ayudar', 'me')).toBe('ayudarme');
    expect(attachClitic('haga', 'lo')).toBe('hágalo');
    expect(attachClitic('oír', 'lo')).toBe('oírlo');
    expect(attachClitic('reír', 'se')).toBe('reírse');
    expect(attachClitic('leer', 'lo')).toBe('leerlo');
  });

  it('attaches clusters one clitic at a time', () => {
    expect(attachClitic(attachClitic('da', 'me'), 'lo')).toBe('dámelo');
    expect(attachClitic(attachClitic('di', 'me'), 'lo')).toBe('dímelo');
    expect(attachClitic(attachClitic('dar', 'te'), 'lo')).toBe('dártelo');
    expect(attachClitic(attachClitic('decir', 'te'), 'lo')).toBe('decírtelo');
    expect(attachClitic(attachClitic('dando', 'se'), 'lo')).toBe('dándoselo');
  });

  it('drops a written accent the clitic makes unnecessary (dé + me -> deme)', () => {
    expect(attachClitic('dé', 'me')).toBe('deme');
    expect(attachClitic('está', 'te')).toBe('estate');
  });

  it('drops the s of a nosotros command before nos and se, and the d of a vosotros command before os', () => {
    expect(attachClitic('vamos', 'nos')).toBe('vámonos');
    expect(attachClitic(attachClitic('digamos', 'se'), 'lo')).toBe('digámoselo');
    expect(attachClitic('hagamos', 'lo')).toBe('hagámoslo');
    expect(attachClitic('sentad', 'os')).toBe('sentaos');
    expect(attachClitic('id', 'os')).toBe('idos');
  });

  it('returns the other part unchanged when one is empty', () => {
    expect(attachClitic('', 'lo')).toBe('lo');
    expect(attachClitic('haz', '')).toBe('haz');
  });
});

describe('splitClitics', () => {
  it('splits clitics off commands, infinitives and gerunds', () => {
    expect(splitClitics('dámelo')).toEqual({ host: 'da', clitics: ['me', 'lo'] });
    expect(splitClitics('hazlo')).toEqual({ host: 'haz', clitics: ['lo'] });
    expect(splitClitics('leyéndolo')).toEqual({ host: 'leyendo', clitics: ['lo'] });
    expect(splitClitics('verte')).toEqual({ host: 'ver', clitics: ['te'] });
    expect(splitClitics('hágalo')).toEqual({ host: 'haga', clitics: ['lo'] });
    expect(splitClitics('dile')).toEqual({ host: 'di', clitics: ['le'] });
  });

  it('restores what a command drops or changes before a clitic', () => {
    expect(splitClitics('vámonos')).toEqual({ host: 'vamos', clitics: ['nos'] });
    expect(splitClitics('deme')).toEqual({ host: 'dé', clitics: ['me'] });
  });

  it('accepts finite hosts too, so a wrongly attached pronoun can come off', () => {
    expect(splitClitics('compróla')).toEqual({ host: 'compró', clitics: ['la'] });
    expect(splitClitics('llamóme')).toEqual({ host: 'llamó', clitics: ['me'] });
  });

  it('never splits a word that is a form of its own, or one with no verb inside', () => {
    expect(splitClitics('vale')).toBeUndefined();
    expect(splitClitics('fuese')).toBeUndefined();
    expect(splitClitics('viste')).toBeUndefined();
    expect(splitClitics('casa')).toBeUndefined();
    expect(splitClitics('hola')).toBeUndefined();
    expect(splitClitics('')).toBeUndefined();
  });

  it('inverts attachClitic on the hosts the analyzer accepts', () => {
    const cases: Array<[string, string[]]> = [
      ['leyendo', ['lo']], ['haz', ['lo']], ['da', ['me', 'lo']], ['decir', ['te', 'lo']], ['ayudar', ['me']],
      ['pon', ['te']], ['comiendo', ['se', 'lo']], ['vamos', ['nos']],
    ];
    for (const [host, clitics] of cases) {
      const word = clitics.reduce(attachClitic, host);
      expect(analyze(word).some((a) => a.pos === 'VERB'), word).toBe(true);
      expect(splitClitics(word), word).toEqual({ host, clitics });
    }
  });
});

describe('Spanish pack wiring', () => {
  it('exposes attachClitic and splitClitics on the pack', () => {
    const pack = createSpanishPack();
    expect(pack.attachClitic?.('leyendo', 'lo')).toBe('leyéndolo');
    expect(pack.splitClitics?.('dámelo')).toEqual({ host: 'da', clitics: ['me', 'lo'] });
  });
});
