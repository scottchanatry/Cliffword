import { createTranslator } from './translator';
import { interpolate } from './interpolate';
import { pluralCategory } from './plural';

const catalogs = {
  en: { hello: 'Hello {name}', only: 'English only', 'apples.one': '{count} apple', 'apples.other': '{count} apples' },
  fr: { hello: 'Bonjour {name}' },
};

describe('createTranslator', () => {
  it('reads pair.ui first, then the native catalog, then English', () => {
    const t = createTranslator({ catalogs, native: 'fr', ui: { only: 'From the pair' } }).t;
    expect(t('only')).toBe('From the pair');
    expect(t('hello', { name: 'Ana' })).toBe('Bonjour Ana');
    const noPair = createTranslator({ catalogs, native: 'fr' }).t;
    expect(noPair('only')).toBe('English only');
  });

  it('returns the key and reports it once when nothing has it', () => {
    const onMissing = jest.fn();
    const { t, has } = createTranslator({ catalogs, onMissing });
    expect(t('nope.missing')).toBe('nope.missing');
    expect(onMissing).toHaveBeenCalledWith('nope.missing');
    expect(has('nope.missing')).toBe(false);
    expect(has('hello')).toBe(true);
  });

  it('warns in development for a missing key', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    createTranslator({ catalogs }).t('missing.dev');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing.dev'));
    warn.mockRestore();
  });

  it('picks plural forms and fills {count}', () => {
    const { plural } = createTranslator({ catalogs });
    expect(plural('apples', 1)).toBe('1 apple');
    expect(plural('apples', 0)).toBe('0 apples');
    expect(plural('apples', 5)).toBe('5 apples');
  });

  it('falls back to .other when a category is missing', () => {
    const { plural } = createTranslator({ catalogs: { en: { 'x.other': '{count} x' } } });
    expect(plural('x', 1)).toBe('1 x');
  });

  it('uses the bundled catalogs by default', () => {
    const { t } = createTranslator();
    expect(t('tab.story')).toBe('Story');
    expect(t('onboarding.title', { language: 'Spanish' })).toBe('Learn Spanish by saying what comes next.');
  });
});

describe('interpolate', () => {
  it('fills known placeholders and keeps unknown ones', () => {
    expect(interpolate('{n} of {m}', { n: 3 })).toBe('3 of {m}');
    expect(interpolate('plain')).toBe('plain');
  });
});

describe('pluralCategory', () => {
  it('follows English rules', () => {
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 2)).toBe('other');
  });
});
