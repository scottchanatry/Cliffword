/**
 * Living in San Juan: the shared checks of every en-es series (proof/stories/validate.ts:
 * vocabulary by level, line length, hints, distractors, unknown words, address variants)
 * and the engine's contract validation, plus what this series promises: eight beginner
 * episodes in order, levels 0-0-0-0-1-1-1-1, both forms of address resolving to the
 * right Spanish, and the picker showing the other five experiences as coming soon.
 */
import { describe, expect, it } from 'vitest';
import { checkSeries, seriesIssues } from '../../../../../proof/stories/validate';
import { firstPlayableTrack, isComingSoon, storyForEpisode, trackCards } from '../../../content/library';
import { resolveStory, unresolvedTokens, variantContext } from '../../../content/variants';
import { validateLibrary } from '../../../content/validate';
import { createSpanishPack } from '../../../lang/es';
import { EN_ES_LIBRARY, EN_ES_TRACKS } from './index';
import { LIVING_STORIES, LIVING_TRACK, LIVING_WORDS } from './living';

const pack = createSpanishPack();

describe('Living in San Juan', () => {
  it('passes the engine contract validation with every en-es track', () => {
    expect(validateLibrary(pack, { tracks: EN_ES_TRACKS, library: EN_ES_LIBRARY })).toEqual([]);
  });

  it('passes the shared Spanish series checks (vocabulary, lines, cliffs, address)', () => {
    const reports = checkSeries(pack, LIVING_TRACK, LIVING_STORIES, LIVING_WORDS);
    expect(seriesIssues(reports)).toEqual([]);
    for (const r of reports) expect(r.coverage).toBeGreaterThanOrEqual(0.95);
  });

  it('is eight beginner episodes in order: level 0 for 1-4, level 1 for 5-8', () => {
    expect(LIVING_STORIES.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((e) => `en-es.living.e${e}`));
    expect(LIVING_STORIES.map((s) => s.episode)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(LIVING_STORIES.map((s) => s.level)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    for (const s of LIVING_STORIES) {
      expect(s.tier).toBe('beginner');
      expect(s.track).toBe('en-es.track.living');
      expect(s.sentences.length).toBeGreaterThanOrEqual(10);
      expect(s.sentences.length).toBeLessThanOrEqual(16);
      expect(unresolvedTokens(s, LIVING_TRACK)).toEqual([]);
    }
  });

  it('resolves the learner address both ways', () => {
    const e1 = LIVING_STORIES[0]!;
    const m = resolveStory(e1, variantContext(LIVING_TRACK, 'm'));
    const f = resolveStory(e1, variantContext(LIVING_TRACK, 'f'));
    const line = (s: typeof e1, id: string) => s.sentences.find((l) => l.id === id)!;
    expect(line(m, 'e1.l04').text).toBe('Ya lo sé. Estás cansado.');
    expect(line(f, 'e1.l04').text).toBe('Ya lo sé. Estás cansada.');
    expect(line(f, 'e1.l04').cliff.word).toBe('cansada');
    expect(line(m, 'e1.l03').text).toBe('¡Hola! ¡Buenos días, vecino!');
    const e7 = resolveStory(LIVING_STORIES[6]!, variantContext(LIVING_TRACK, 'f'));
    expect(line(e7, 'e7.l05').translation).toBe('She wants chicken, not rooster.');
  });

  it('every line, turn and episode carries the language-neutral layer', () => {
    for (const s of LIVING_STORIES) {
      expect(s.beats.length).toBeGreaterThanOrEqual(4);
      expect(s.functions.length).toBeGreaterThanOrEqual(3);
      for (const l of s.sentences) {
        expect(l.intent).not.toBe('');
        expect(l.function).toBeTruthy();
        expect(l.cliff.concept).not.toBe('');
        expect(l.cliff.hint).toBeTruthy();
      }
      for (const t of s.turns ?? []) {
        expect(t.intent).not.toBe('');
        expect(t.function).toBeTruthy();
      }
    }
    expect(LIVING_TRACK.cast.length).toBeGreaterThanOrEqual(5);
    expect(LIVING_TRACK.setting).not.toMatch(/San Juan|Puerto Rico|Santurce/);
  });

  it('plays first on the picker; the other five experiences are coming soon', () => {
    expect(EN_ES_TRACKS.map((t) => t.title)).toEqual([
      'Living in San Juan',
      'Mystery in Cartagena',
      'Dating in Buenos Aires',
      'Making friends in Mexico City',
      'Food lover in Lima',
      'Travel vlogger in Costa Rica',
    ]);
    expect(firstPlayableTrack(EN_ES_TRACKS, EN_ES_LIBRARY)).toBe('en-es.track.living');
    const cards = trackCards(EN_ES_TRACKS, EN_ES_LIBRARY);
    expect(cards.filter((c) => c.comingSoon).length).toBe(5);
    expect(cards[0]).toMatchObject({ comingSoon: false, episodes: 8 });
    expect(isComingSoon(EN_ES_LIBRARY, 'en-es.track.dating')).toBe(true);
  });

  it('serves the beginner episode to every learner level until other tiers are written', () => {
    for (const level of [0, 1, 2, 3, 4, 5]) {
      expect(storyForEpisode(EN_ES_LIBRARY, 'en-es.track.living', 5, level)?.id).toBe('en-es.living.e5');
    }
  });
});
