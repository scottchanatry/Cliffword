/**
 * The content module: the shared syllabus, gender variants, episode and tier selection,
 * the level rule, and library validation (on the test library and on broken copies).
 */
import { describe, expect, it } from 'vitest';
import { createDefaultSpanishPack } from '../packs';
import type { LibraryStory } from '../pair/types';
import {
  DEFAULT_LEVEL_RULE,
  cliffModeForLevel,
  episodesOfTrack,
  firstPlayableTrack,
  hintSpan,
  isComingSoon,
  levelAfterEpisode,
  nextEpisodeOf,
  speakerName,
  storyForEpisode,
  tierForLevel,
  trackCards,
} from './library';
import { SYLLABUS, SYLLABUS_IDS, isSyllabusId, syllabusInOrder } from './syllabus';
import { TEST_LIBRARY, TEST_LIBRARY_VALIDATION, TEST_TRACKS } from './testLibrary';
import { validateLibrary, validateStory, validateTracks } from './validate';
import { allVariantContexts, resolveStory, resolveVariants, unresolvedTokens, variantContext, variantKeys } from './variants';

const pack = createDefaultSpanishPack();
const date = TEST_TRACKS[1];
const leo = { id: 'leo', label: 'Leo', gender: 'm' as const };
const ana = { id: 'ana', label: 'Ana', gender: 'f' as const };

describe('syllabus', () => {
  it('has unique, well-formed ids with English descriptions and orders', () => {
    expect(new Set(SYLLABUS.map((e) => e.id)).size).toBe(SYLLABUS.length);
    for (const e of SYLLABUS) {
      expect(e.id).toMatch(/^[a-z]+\.[a-z][A-Za-z]*$/);
      expect(e.description.length).toBeGreaterThan(8);
      expect(e.description).not.toMatch(/[áéíóúñü¿¡]/i);
      expect(Number.isFinite(e.order)).toBe(true);
    }
    for (const id of ['greet.hello', 'greet.howareyou', 'intro.name', 'courtesy.please', 'shop.price', 'shop.size', 'food.order', 'food.taste', 'plan.time', 'drive.directions', 'health.hurts']) {
      expect(isSyllabusId(id), id).toBe(true);
    }
    expect(SYLLABUS_IDS.has('nope.nope')).toBe(false);
    const order = syllabusInOrder();
    expect(order.indexOf('greet.hello')).toBeLessThan(order.indexOf('health.hurts'));
  });
});

describe('gender variants', () => {
  it('resolves {you:a|b} both ways, inside a word too', () => {
    expect(resolveVariants('¡Bienvenid{you:o|a}!', { you: 'm', choices: {} })).toBe('¡Bienvenido!');
    expect(resolveVariants('¡Bienvenid{you:o|a}!', { you: 'f', choices: {} })).toBe('¡Bienvenida!');
    expect(resolveVariants('Estás {you:listo|lista}.', { you: 'f', choices: {} })).toBe('Estás lista.');
    expect(resolveVariants('{you:|a}x', { you: 'm', choices: {} })).toBe('x');
  });

  it('resolves a choice by its gender and its label', () => {
    const withAna = { you: 'm' as const, choices: { partner: ana } };
    const withLeo = { you: 'f' as const, choices: { partner: leo } };
    expect(resolveVariants('{partner:Él|Ella} es {partner.name}.', withAna)).toBe('Ella es Ana.');
    expect(resolveVariants('{partner:Él|Ella} es {partner.name}.', withLeo)).toBe('Él es Leo.');
    expect(resolveVariants('{partner.name} y {you:él|ella}', withLeo)).toBe('Leo y ella');
  });

  it('leaves unknown keys and malformed tokens as written', () => {
    const ctx = { you: 'm' as const, choices: {} };
    expect(resolveVariants('{partner.name} {boss:a|b} {you:a} {you:a|b|c}', ctx)).toBe('{partner.name} {boss:a|b} {you:a} {you:a|b|c}');
    expect(variantKeys('{you:a|b} {partner.name} {partner:x|y}')).toEqual(['you', 'partner']);
  });

  it('defaults a missing choice to the first option, and lists every context', () => {
    expect(variantContext(date, 'f').choices.partner).toEqual(leo);
    expect(variantContext(date, 'm', { partner: 'ana' }).choices.partner).toEqual(ana);
    expect(variantContext(date, 'm', { partner: 'nobody' }).choices.partner).toEqual(leo);
    expect(allVariantContexts(TEST_TRACKS[0])).toHaveLength(2);
    expect(allVariantContexts(date)).toHaveLength(4);
  });

  it('resolves every string of a story and never leaves braces in the test library', () => {
    const e1 = TEST_LIBRARY.find((s) => s.id === 'test.date.e1') as LibraryStory;
    const r = resolveStory(e1, variantContext(date, 'f', { partner: 'ana' }));
    expect(r.sentences[0]?.text).toBe('Hoy tienes una cita con Ana.');
    expect(r.sentences[1]?.cliff.word).toBe('guapa');
    expect(r.sentences[1]?.cliff.hint).toBe('pretty');
    expect(r.sentences[1]?.translation).toBe('Hi! You look very pretty.');
    expect(r.characters).toContain('Ana');
    expect(e1.sentences[0]?.text).toContain('{partner.name}'); // the source is unchanged
    for (const s of TEST_LIBRARY) expect(unresolvedTokens(s, TEST_TRACKS.find((t) => t.id === s.track)), s.id).toEqual([]);
    const broken = { ...e1, sentences: [{ ...(e1.sentences[0] as LibraryStory['sentences'][number]), text: 'Hola {boss.name} {you:x}.' }] };
    expect(unresolvedTokens(broken, date).map((u) => u.path)).toEqual(['sentences.0.text']);
  });
});

describe('episodes, tiers, modes and the level rule', () => {
  it('maps levels to tiers and cliff modes', () => {
    expect([0, 1, 2, 3, 4, 5].map(tierForLevel)).toEqual(['beginner', 'beginner', 'intermediate', 'intermediate', 'advanced', 'advanced']);
    expect([0, 1, 2, 3, 4, 5].map(cliffModeForLevel)).toEqual(['recall', 'recall', 'hint', 'hint', 'predict', 'predict']);
    expect(tierForLevel(-3)).toBe('beginner');
    expect(cliffModeForLevel(99)).toBe('predict');
  });

  it('moves the level up at 80% unaided, down under 50%, within 0-5', () => {
    expect(DEFAULT_LEVEL_RULE).toEqual({ upAt: 0.8, downBelow: 0.5 });
    expect(levelAfterEpisode(2, 10, 8)).toBe(3);
    expect(levelAfterEpisode(2, 10, 7)).toBe(2);
    expect(levelAfterEpisode(2, 10, 5)).toBe(2);
    expect(levelAfterEpisode(2, 10, 4)).toBe(1);
    expect(levelAfterEpisode(0, 10, 0)).toBe(0);
    expect(levelAfterEpisode(5, 10, 10)).toBe(5);
    expect(levelAfterEpisode(3, 0, 0)).toBe(3);
  });

  it('plays episodes in order and picks the nearest written tier', () => {
    expect(episodesOfTrack(TEST_LIBRARY, 'test.track.market')).toEqual([1, 2, 3]);
    expect(nextEpisodeOf(TEST_LIBRARY, 'test.track.market', 0)).toBe(1);
    expect(nextEpisodeOf(TEST_LIBRARY, 'test.track.market', 3)).toBeNull();
    expect(isComingSoon(TEST_LIBRARY, 'test.track.soon')).toBe(true);
    expect(firstPlayableTrack(TEST_TRACKS, TEST_LIBRARY)).toBe('test.track.market');
    // Only the beginner tier is written: every level falls back to it.
    for (const level of [0, 2, 5]) expect(storyForEpisode(TEST_LIBRARY, 'test.track.market', 2, level)?.id).toBe('test.market.e2');
    const base = TEST_LIBRARY.find((s) => s.id === 'test.market.e1') as LibraryStory;
    const lib = [base, { ...base, id: 'adv', tier: 'advanced' as const }, { ...base, id: 'mid', tier: 'intermediate' as const }];
    expect(storyForEpisode(lib, 'test.track.market', 1, 4)?.id).toBe('adv');
    expect(storyForEpisode(lib, 'test.track.market', 1, 2)?.id).toBe('mid');
    // Wanted intermediate, beginner and advanced written: the easier one.
    expect(storyForEpisode([base, { ...base, id: 'adv', tier: 'advanced' as const }], 'test.track.market', 1, 3)?.id).toBe(base.id);
    expect(storyForEpisode(TEST_LIBRARY, 'test.track.market', 9, 0)).toBeNull();
  });

  it('builds picker cards with coming-soon tracks', () => {
    const cards = trackCards(TEST_TRACKS, TEST_LIBRARY);
    expect(cards.map((c) => [c.id, c.comingSoon, c.episodes, c.hasChoices])).toEqual([
      ['test.track.market', false, 3, false],
      ['test.track.date', false, 3, true],
      ['test.track.soon', true, 0, false],
    ]);
  });

  it('names speakers by cast id, and finds the bold hint in a translation', () => {
    expect(speakerName(TEST_TRACKS[0], 'vendor')).toBe('Rosa');
    expect(speakerName(TEST_TRACKS[0], 'Somebody')).toBe('Somebody');
    expect(speakerName(TEST_TRACKS[0], undefined)).toBeNull();
    expect(hintSpan('Rosa has very good fruit.', 'fruit')).toEqual({ start
: 19, end: 24 });
    expect(hintSpan('The art of a cart.', 'art')).toEqual({ start: 4, end: 7 });
    expect(hintSpan('Carts only.', 'art')).toEqual({ start: 1, end: 4 });
    expect(hintSpan('Nothing here.', 'fruit')).toBeNull();
  });
});

describe('library validation', () => {
  it('accepts the test library', () => {
    expect(validateLibrary(pack, { tracks: TEST_TRACKS, library: TEST_LIBRARY }, TEST_LIBRARY_VALIDATION)).toEqual([]);
  });

  it('reports broken tracks', () => {
    const bad = [{ ...TEST_TRACKS[1], id: 'x', dialect: 'zz', cast: [{ id: 'a', role: '', quirk: 'q', name: 'n' }], choices: [{ key: 'you', prompt: '', options: [leo] }] }];
    const messages = validateTracks(bad as unknown as typeof TEST_TRACKS).map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(['unknown dialect zz', 'cast a: role is empty', "choice key \"you\" is invalid, 'you' or duplicate", 'choice you: fewer than two options']));
  });

  it('reports broken stories: structure, neutral layer, syllabus ids, variants and cliffs', () => {
    const base = TEST_LIBRARY.find((s) => s.id === 'test.date.e1') as LibraryStory;
    const line = base.sentences[0] as LibraryStory['sentences'][number];
    const broken: LibraryStory = {
      ...base,
      episode: 12,
      beats: ['one'],
      functions: ['made.up'],
      sentences: [
        { ...line, id: 'bad', intent: '', function: 'nope.nope', cliff: { ...line.cliff, concept: '', distractors: ['cita', 'mesa'] } },
        { ...line, id: 'e12.l02', text: 'Hola {boss:a|b}.', cliff: { ...line.cliff, word: 'Hola' } },
      ],
      turns: [{ ...(base.turns?.[0] as NonNullable<LibraryStory['turns']>[number]), after: 7 }],
    };
    const messages = validateStory(pack, broken, date, TEST_LIBRARY_VALIDATION).map((i) => `${i.where}: ${i.message}`);
    const expectContains = (part: string) => expect(messages.some((m) => m.includes(part)), `${part}\n${messages.join('\n')}`).toBe(true);
    expectContains('episode 12 is not 1-8');
    expectContains('1 beats');
    expectContains('unknown syllabus id made.up');
    expectContains('2 lines');
    expectContains('bad: intent is empty');
    expectContains('bad: unknown syllabus id nope.nope');
    expectContains('bad: cliff.concept is empty');
    expectContains('line id should look like');
    expectContains('distractor "cita" is the answer');
    expectContains('unknown variant key "boss"');
    expectContains('unresolved braces');
    expectContains('cliff word "Hola" is not in the line after its first word');
    expectContains('after 7 is not a line index');
    expect(validateLibrary(pack, { tracks: TEST_TRACKS, library: [base, base] }, TEST_LIBRARY_VALIDATION).map((i) => i.message)).toEqual(
      expect.arrayContaining(['duplicate story id', 'episode 1 (beginner) of test.track.date is written twice']),
    );
  });
});
