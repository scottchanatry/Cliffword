import { describe, expect, it } from 'vitest';
import { bestMatch, feminine, inflect, paradigm, pluralize } from './inflect';

describe('pluralize', () => {
  it.each([
    ['casa', 'casas'], ['libro', 'libros'], ['café', 'cafés'], ['mamá', 'mamás'], ['rubí', 'rubíes'],
    ['menú', 'menús'], ['papel', 'papeles'], ['mujer', 'mujeres'], ['ciudad', 'ciudades'], ['reloj', 'relojes'],
    ['luz', 'luces'], ['vez', 'veces'], ['lápiz', 'lápices'], ['rey', 'reyes'], ['ley', 'leyes'],
    ['joven', 'jóvenes'], ['examen', 'exámenes'], ['imagen', 'imágenes'], ['origen', 'orígenes'],
    ['canción', 'canciones'], ['inglés', 'ingleses'], ['autobús', 'autobuses'], ['país', 'países'],
    ['mes', 'meses'], ['dios', 'dioses'], ['lunes', 'lunes'], ['crisis', 'crisis'], ['cumpleaños', 'cumpleaños'],
    ['carácter', 'caracteres'], ['régimen', 'regímenes'], ['club', 'clubes'], ['robot', 'robots'],
  ])('%s -> %s', (sg, pl) => {
    expect(pluralize(sg)).toBe(pl);
  });
  it('leaves empty input alone', () => {
    expect(pluralize('')).toBe('');
  });
});

describe('feminine', () => {
  it.each([
    ['amigo', 'amiga'], ['profesor', 'profesora'], ['alemán', 'alemana'], ['inglés', 'inglesa'],
    ['francés', 'francesa'], ['dormilón', 'dormilona'], ['grande', 'grande'], ['artista', 'artista'],
    ['feliz', 'feliz'], ['mejor', 'mejor'], ['cortés', 'cortés'], ['actor', 'actriz'], ['jefe', 'jefa'],
    ['español', 'española'], ['estudiante', 'estudiante'], ['joven', 'joven'], ['marrón', 'marrón'],
  ])('%s -> %s', (m, f) => {
    expect(feminine(m)).toBe(f);
  });
});

describe('inflect nouns', () => {
  it('number for fixed-gender nouns', () => {
    expect(inflect('casa', { number: 'p' })).toBe('casas');
    expect(inflect('casa', { gender: 'f', number: 'p' })).toBe('casas');
    expect(inflect('problema', { number: 'p' })).toBe('problemas');
    expect(inflect('mano', { number: 'p' })).toBe('manos');
    expect(inflect('canción', { number: 'p' })).toBe('canciones');
  });
  it('a fixed-gender noun cannot change gender', () => {
    expect(inflect('casa', { gender: 'm' })).toBeUndefined();
  });
  it('common-gender nouns', () => {
    expect(inflect('niño', { gender: 'f', number: 's' })).toBe('niña');
    expect(inflect('amigo', { gender: 'f', number: 'p' })).toBe('amigas');
    expect(inflect('profesor', { gender: 'f', number: 'p' })).toBe('profesoras');
    expect(inflect('estudiante', { gender: 'f', number: 'p' })).toBe('estudiantes');
    expect(inflect('joven', { gender: 'f', number: 'p' })).toBe('jóvenes');
  });
  it('noun beats verb when only number is asked (poder)', () => {
    expect(inflect('poder', { number: 'p' })).toBe('poderes');
    expect(inflect('poder', { mood: 'ind', tense: 'pres', person: '1', number: 'p' })).toBe('podemos');
  });
});

describe('inflect adjectives', () => {
  it('-o/-a', () => {
    expect(inflect('cansado', { gender: 'f', number: 'p' })).toBe('cansadas');
    expect(inflect('bueno', { gender: 'f', number: 's' })).toBe('buena');
    expect(inflect('rojo', { gender: 'm', number: 'p' })).toBe('rojos');
  });
  it('-e, -ista and consonant adjectives keep gender', () => {
    expect(inflect('grande', { gender: 'f', number: 'p' })).toBe('grandes');
    expect(inflect('feliz', { gender: 'f', number: 'p' })).toBe('felices');
    expect(inflect('azul', { gender: 'f', number: 'p' })).toBe('azules');
    expect(inflect('joven', { gender: 'm', number: 'p' })).toBe('jóvenes');
  });
  it('nationality and stress changes', () => {
    expect(inflect('inglés', { gender: 'f', number: 'p' })).toBe('inglesas');
    expect(inflect('inglés', { gender: 'm', number: 'p' })).toBe('ingleses');
    expect(inflect('alemán', { gender: 'f', number: 's' })).toBe('alemana');
    expect(inflect('español', { gender: 'f', number: 'p' })).toBe('españolas');
  });
  it('apocopated forms are analysis-only', () => {
    expect(inflect('bueno', { gender: 'm', number: 's' })).toBe('bueno');
    expect(paradigm('bueno', 'ADJ').some((e) => e.form === 'buen' && e.alt)).toBe(true);
  });
});

describe('inflect determiners', () => {
  it.each([
    ['el', 'm', 's', 'el'], ['el', 'f', 's', 'la'], ['el', 'm', 'p', 'los'], ['el', 'f', 'p', 'las'],
    ['un', 'f', 's', 'una'], ['un', 'm', 'p', 'unos'], ['un', 'f', 'p', 'unas'],
    ['este', 'f', 's', 'esta'], ['este', 'm', 'p', 'estos'], ['ese', 'f', 'p', 'esas'],
    ['aquel', 'f', 's', 'aquella'], ['aquel', 'm', 'p', 'aquellos'], ['mi', 'f', 'p', 'mis'],
    ['tu', 'm', 'p', 'tus'], ['su', 'f', 's', 'su'], ['nuestro', 'f', 'p', 'nuestras'],
    ['vuestro', 'f', 's', 'vuestra'], ['mucho', 'f', 'p', 'muchas'], ['alguno', 'm', 's', 'algún'],
    ['ninguno', 'f', 's', 'ninguna'], ['todo', 'f', 'p', 'todas'], ['otro', 'f', 's', 'otra'],
  ])('%s %s.%s = %s', (lemma, gender, number, expected) => {
    expect(inflect(lemma, { gender, number })).toBe(expected);
  });
  it('plural-only determiners', () => {
    expect(inflect('varios', { gender: 'f', number: 'p' })).toBe('varias');
    expect(inflect('varios', { gender: 'm', number: 's' })).toBeUndefined();
  });
});

describe('inflect pronouns', () => {
  it('subject pronouns inflect across the paradigm', () => {
    expect(inflect('yo', { person: '1', number: 's' })).toBe('yo');
    expect(inflect('yo', { person: '3', number: 'p', gender: 'f' })).toBe('ellas');
    expect(inflect('él', { gender: 'f' })).toBe('ella');
    expect(inflect('ella', { number: 'p' })).toBe('ellas');
    expect(inflect('nosotros', { gender: 'f' })).toBe('nosotras');
    expect(inflect('tú', { number: 'p' })).toBe('vosotros');
    expect(inflect('yo', { person: '4' })).toBeUndefined();
  });
  it('usted and object pronouns', () => {
    expect(inflect('usted', { number: 'p' })).toBe('ustedes');
    expect(inflect('lo', { gender: 'f', number: 'p' })).toBe('las');
    expect(inflect('le', { number: 'p' })).toBe('les');
    expect(inflect('quien', { number: 'p' })).toBe('quienes');
    expect(inflect('me', { person: '1', number: 's' })).toBe('me');
    expect(inflect('me', { person: '2' })).toBeUndefined();
  });
});

describe('inflect verbs', () => {
  it('uses the conjugator', () => {
    expect(inflect('tener', { form: 'fin', mood: 'ind', tense: 'pret', person: '3', number: 'p' })).toBe('tuvieron');
    expect(inflect('ir', { mood: 'sub', tense: 'pres', person: '3', number: 's' })).toBe('vaya');
    expect(inflect('decir', { mood: 'imp', person: '2', number: 's' })).toBe('di');
    expect(inflect('comer', { form: 'ger' })).toBe('comiendo');
    expect(inflect('abrir', { form: 'part', gender: 'f', number: 's' })).toBe('abierta');
    expect(inflect('hablar', {})).toBe('hablar');
    expect(inflect('haber', { tense: 'pres', person: '3', number: 's' })).toBe('ha');
  });
  it('conjugates infinitives that are not in the lexicon', () => {
    expect(inflect('bloguear', { mood: 'ind', tense: 'pret', person: '1', number: 's' })).toBe('blogueé');
    expect(inflect('bloguear', { form: 'ger' })).toBe('blogueando');
  });
  it('rejects impossible combinations', () => {
    expect(inflect('tener', { mood: 'sub', tense: 'fut', person: '1', number: 's' })).toBeUndefined();
    expect(inflect('tener', { mood: 'imp', person: '1', number: 'p' })).toBeUndefined();
  });
});

describe('inflect edge cases', () => {
  it('uninflected words accept only empty features', () => {
    expect(inflect('muy', {})).toBe('muy');
    expect(inflect('muy', { number: 'p' })).toBeUndefined();
    expect(inflect('de', {})).toBe('de');
  });
  it('unknown lemmas: number only, else undefined', () => {
    expect(inflect('zorbo', { number: 'p' })).toBe('zorbos');
    expect(inflect('zorbo', { number: 's' })).toBe('zorbo');
    expect(inflect('zorbo', { gender: 'f' })).toBeUndefined();
    expect(inflect('', { gender: 'f' })).toBeUndefined();
  });
  it('ignores empty feature values', () => {
    expect(inflect('casa', { number: 'p', gender: '' })).toBe('casas');
  });
  it('bestMatch prefers the entry with the fewest extra features', () => {
    const entries = paradigm('mucho', 'DET');
    expect(bestMatch(entries, { gender: 'f' })?.entry.form).toBe('mucha');
    expect(bestMatch(entries, { person: '1' })).toBeUndefined();
  });
});
