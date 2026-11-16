/**
 * Simulated learners on the real Spanish pack, rules, registers and pair pack.
 *
 * Five profiles from the brief: brand new (cognates only), early (about 300 lexemes),
 * intermediate reader with weak speaking, advanced (about 5000 lexemes) and heritage
 * speaker (strong sound and meaning, weak written form). Each is a LearnerModel built
 * from a prior plus a few days of deterministic study events, then checked against the
 * brief: the known-word band holds, there is always a next step at zero knowledge, new
 * material never runs out at the top, and each skill mix gets the right rungs and tiles.
 *
 * Frequency list. The shipped lexicon has 1788 lemmas; an advanced learner knows more
 * than that. FULL_KEYS appends a synthetic tail of rare lexemes ("es:~rare1789" ...)
 * up to rank 20000 to stand in for the rest of a production frequency list, so
 * vocabulary sizes beyond the shipped list are measurable. Checks that need real words
 * (selection, rungs, tiles) use only the shipped list.
 *
 * Everything is deterministic: fixed times, no randomness.
 */
import { describe, expect, it } from 'vitest';
import {
  LearnerModel,
  PlacementTracker,
  StorySession,
  chooseTargets,
  cliffRungFor,
  cognateLexemeKeys,
  createDefaultPairPack,
  createDefaultSpanishPack,
  createMockModel,
  deriveParams,
  estimateVocabulary,
  frequencyLexemeKeys,
  generateNextSentence,
  lexemeKey,
  lexemeOf,
  selectSentence,
  showText,
  slangLexemeKeys,
} from '../src';
import type { CandidateEvaluation, DifficultyParams, LearnerEvent, PriorFn, RecentStats, Skill } from '../src';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 15, 8, 0, 0);
/** Evaluation time: the morning after three days of study. */
const NOW = T0 + 3 * DAY;

const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const COGNATES = cognateLexemeKeys(pair);
const LIST_KEYS = frequencyLexemeKeys(pack);
const TAIL_END = 20_000;
const FULL_KEYS = [
  ...LIST_KEYS,
  ...Array.from({ length: TAIL_END - LIST_KEYS.length }, (_, i) => `es:~rare${LIST_KEYS.length + i + 1}`),
];
const RANK = new Map(FULL_KEYS.map((k, i) => [k, i + 1]));
/** Lexemes outside the list (slang, unknown words) are rare: the placement module's unknownRank. */
const UNLISTED_RANK = 50_000;
const rankOf = (key: string): number => RANK.get(lexemeOf(key)) ?? UNLISTED_RANK;

/** Per skill, the frequency rank up to which the learner knows words (0 = none). */
type Reach = Record<Skill, number>;

interface Profile {
  name: string;
  reach: Reach;
  /** Approximate number of lexemes known for meaning, as the brief describes the profile. */
  vocabAbout?: number;
}

type ProfileId = 'brandNew' | 'early' | 'reader' | 'advanced' | 'heritage';

const PROFILES: Record<ProfileId, Profile> = {
  brandNew: { name: 'brand new (cognates only)', reach: { meaning: 0, sound: 0, written: 0, speaking: 0 } },
  early: { name: 'early', reach: { meaning: 300, sound: 200, written: 300, speaking: 80 }, vocabAbout: 300 },
  reader: { name: 'intermediate reader, weak speaking', reach: { meaning: 2500, sound: 150, written: 2500, speaking: 30 } },
  advanced: { name: 'advanced', reach: { meaning: 5000, sound: 5000, written: 5000, speaking: 3500 }, vocabAbout: 5000 },
  heritage: { name: 'heritage speaker', reach: { meaning: 3000, sound: 3000, written: 40, speaking: 1500 } },
};

const KNOWN_P = 0.97;
const UNKNOWN_P = 0.002;

/**
 * Prior: per skill, a steep logistic on log rank around the profile's reach (what
 * placement plus a few sessions converge to), floored by the brand-new cognate prior so
 * cognates are probably understood from the start. A reach of 0 means only cognates.
 */
function profilePrior(reach: Reach): PriorFn {
  const cognatePrior = PlacementTracker.brandNew(COGNATES);
  return (key, skill) => {
    const n = reach[skill];
    const p = n <= 0 ? UNKNOWN_P : UNKNOWN_P + (KNOWN_P - UNKNOWN_P) / (1 + Math.pow(rankOf(key) / n, 6));
    return Math.max(p, cognatePrior(key, skill));
  };
}

/** True when the simulated learner really has `skill` for `key` (the ground truth behind the events). */
function truly(profile: Profile, key: string, skill: Skill): boolean {
  if (skill === 'meaning' && COGNATES.includes(lexemeOf(key))) return true;
  return rankOf(key) <= profile.reach[skill];
}

/** Lexeme keys of the words of a sentence, through the real pack (names and numbers skipped). */
function sentenceKeys(text: string): string[] {
  const keys: string[] = [];
  for (const seg of pack.segment(text)) {
    if (seg.kind !== 'word') continue;
    const a = pack.analyze(seg.norm)[0];
    if (!a || a.pos === 'PROPN' || a.pos === 'NUM') continue;
    keys.push(lexemeKey(pack.code, a.lemma));
  }
  return keys;
}

/** Sentences the learners study during the simulated days. */
const STUDY = [
  'Mi madre está en casa.',
  'La gente vive en la ciudad.',
  'Mi hermano trabaja en un banco.',
  'El problema es importante.',
  'Quiero un café con leche.',
  'El perro come pan.',
];

/**
 * What the learner does with each word of a study sentence, as events: a tile is heard
 * (or replayed and revealed when the sound is not known), text is read when the written
 * form is known, the meaning is looked up when unknown, and the last word is a cliff
 * answered at the rung the engine chooses, with credit from the ground truth.
 */
function studyEvents(learner: LearnerModel, profile: Profile, sentence: string, at: number): LearnerEvent[] {
  const params = deriveParams({ vocab: estimateVocabulary(learner, at, LIST_KEYS) });
  const keys = sentenceKeys(sentence);
  const events: LearnerEvent[] = [];
  keys.forEach((key, i) => {
    const t = at + i * 1000;
    if (showText(learner, key, t, params)) {
      if (truly(profile, key, 'written')) events.push({ type: 'read', key, at: t });
    } else if (truly(profile, key, 'sound')) {
      events.push({ type: 'heard', key, at: t });
    } else {
      events.push({ type: 'tap_rehear', key, at: t }, { type: 'hold_reveal', key, at: t + 300 });
    }
    if (!truly(profile, key, 'meaning')) events.push({ type: 'gloss_lookup', key, at: t + 500 });
  });
  const cliffKey = keys[keys.length - 1];
  if (cliffKey) {
    const t = at + keys.length * 1000;
    const rung = cliffRungFor(learner, cliffKey, t);
    const knows = truly(profile, cliffKey, 'speaking') || (rung === 'options' && truly(profile, cliffKey, 'meaning'));
    events.push({ type: 'cliff_answer', key: cliffKey, at: t, credit: knows ? 'full' : 'none', rung });
  }
  return events;
}

/** A learner for a profile: its prior, then three daily study sessions. */
function buildLearner(profile: Profile): LearnerModel {
  const learner = new LearnerModel({ prior: profilePrior(profile.reach) });
  for (let day = 0; day < 3; day++) {
    STUDY.forEach((sentence, i) => {
      for (const e of studyEvents(learner, profile, sentence, T0 + day * DAY + i * 60_000)) learner.apply(e);
    });
  }
  return learner;
}

const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];
const LEARNERS = Object.fromEntries(PROFILE_IDS.map((id) => [id, buildLearner(PROFILES[id])])) as Record<ProfileId, LearnerModel>;

function paramsFor(learner: LearnerModel, recent?: RecentStats): DifficultyParams {
  return deriveParams({ vocab: estimateVocabulary(learner, NOW, FULL_KEYS), recent });
}

/**
 * A fixed pool of candidate next sentences: common to rare vocabulary, cognate-heavy
 * sentences for beginners, a street sentence, and two that must be rejected (an echoed
 * prompt and English words).
 */
const POOL = [
  'Mi madre está en casa.',
  'La gente vive en la ciudad.',
  'Mi hermano trabaja en un banco.',
  'Quiero un café con leche.',
  'El perro come pan.',
  'La economía del país crece despacio.',
  'Los científicos investigan el problema.',
  'El ministro anunció un plan.',
  'El ministro anunció una reforma polémica.',
  'El problema es importante.',
  'La familia es importante.',
  "El corillo ya 'tá listo pa' bailar.",
  'Here is the next sentence: Marta come pan.',
  'Quiero ir a the beach.',
];

function belowBand(e: CandidateEvaluation, params: DifficultyParams): number {
  return Math.max(0, params.knownBand.min - e.bandShare) + Math.max(0, e.bandShare - params.knownBand.max);
}

describe('simulated learners: profiles', () => {
  it('estimates vocabulary in line with each profile', () => {
    const vocab = (id: ProfileId) => estimateVocabulary(LEARNERS[id], NOW, FULL_KEYS);
    /** Lexemes the learner probably knows (above the cognates' 50% prior). */
    const solid = (id: ProfileId) => FULL_KEYS.filter((k) => LEARNERS[id].pKnown(k, 'meaning', NOW) > 0.6).length;
    expect(solid('brandNew')).toBeLessThan(30);
    expect(solid('early')).toBeGreaterThan(250);
    expect(solid('early')).toBeLessThan(350);
    expect(solid('advanced')).toBeGreaterThan(4000);
    expect(solid('advanced')).toBeLessThan(6000);
    // The expected count also holds the cognates' 50% prior mass beyond the solid words
    // (about 445 cognates, all in the frequency list since lng-6: about 225 words).
    expect(vocab('brandNew')).toBeLessThan(300);
    expect(vocab('early')).toBeLessThan(600);
    expect(vocab('advanced')).toBeGreaterThan(4000);
    expect(vocab('advanced')).toBeLessThan(6000);
    expect(vocab('brandNew')).toBeLessThan(vocab('early'));
    expect(vocab('early')).toBeLessThan(vocab('reader'));
    expect(vocab('reader')).toBeLessThan(vocab('heritage'));
    expect(vocab('heritage')).toBeLessThan(vocab('advanced'));
  });

  it('keeps skills apart: the reader reads but does not hear, the heritage speaker hears but does not read', () => {
    const word = lexemeKey('es', 'gente'); // rank 375: inside both reaches for meaning
    const reader = LEARNERS.reader;
    const heritage = LEARNERS.heritage;
    expect(reader.pKnown(word, 'meaning', NOW)).toBeGreaterThan(0.9);
    expect(reader.pKnown(word, 'written', NOW)).toBeGreaterThan(0.9);
    expect(reader.pKnown(word, 'sound', NOW)).toBeLessThan(0.3);
    expect(heritage.pKnown(word, 'meaning', NOW)).toBeGreaterThan(0.9);
    expect(heritage.pKnown(word, 'sound', NOW)).toBeGreaterThan(0.9);
    expect(heritage.pKnown(word, 'written', NOW)).toBeLessThan(0.3);
  });
});

describe('simulated learners: difficulty', () => {
  const recents: Array<RecentStats | undefined> = [
    undefined,
    { successRate: 1, replaysPerSentence: 0, pausesPerMinute: 0 },
    { successRate: 0, replaysPerSentence: 6, pausesPerMinute: 30 },
  ];
  for (const id of PROFILE_IDS) {
    it(`keeps the known-word band within bounds: ${PROFILES[id].name}`, () => {
      for (const recent of recents) {
        const p = paramsFor(LEARNERS[id], recent);
        expect(p.knownBand.min).toBeGreaterThanOrEqual(0.93);
        expect(p.knownBand.max).toBeLessThanOrEqual(0.99);
        expect(p.knownBand.min).toBeLessThanOrEqual(p.knownBand.max);
        if (!recent) {
          expect(p.knownBand.min).toBeCloseTo(0.95, 10);
          expect(p.knownBand.max).toBeCloseTo(0.98, 10);
        }
        expect(p.newWordsPerSentence).toBeGreaterThan(0);
      }
    });
  }

  it('scales sentence length and cliff length with the learner, not with modes', () => {
    const p = (id: ProfileId) => paramsFor(LEARNERS[id]);
    expect(p('brandNew').sentenceWords.max).toBeLessThan(p('early').sentenceWords.max);
    expect(p('early').sentenceWords.max).toBeLessThan(p('advanced').sentenceWords.max);
    expect(p('brandNew').cliffWords).toBeLessThan(p('advanced').cliffWords);
  });
});

describe('simulated learners: sentence selection from a fixed pool', () => {
  for (const id of PROFILE_IDS) {
    it(`picks a sentence inside the band, or the closest one: ${PROFILES[id].name}`, () => {
      const learner = LEARNERS[id];
      const params = paramsFor(learner);
      const targets = chooseTargets({ learner, now: NOW, frequencyKeys: LIST_KEYS, extra: slangLexemeKeys(pack), options: { count: 2 } });
      const sel = selectSentence(POOL, {
        pack,
        learner,
        now: NOW,
        targets: targets.map((t) => t.key),
        params,
        previous: [],
        pair,
      });
      const accepted = sel.ranked.filter((e) => e.accepted);
      const rejected = sel.ranked.filter((e) => !e.accepted).map((e) => e.text);
      expect(rejected).toContain('Here is the next sentence: Marta come pan.');
      expect(rejected).toContain('Quiero ir a the beach.');
      expect(sel.best).not.toBeNull();
      const best = sel.best as CandidateEvaluation;
      if (accepted.some((e) => e.inBand)) {
        expect(best.inBand).toBe(true);
      } else {
        const closest = Math.min(...accepted.map((e) => belowBand(e, params)));
        expect(belowBand(best, params)).toBeCloseTo(closest, 10);
      }
    });
  }

  it('finds in-band sentences for every profile except the brand-new learner', () => {
    for (const id of ['early', 'reader', 'advanced', 'heritage'] as const) {
      const learner = LEARNERS[id];
      const sel = selectSentence(POOL, { pack, learner, now: NOW, targets: [], params: paramsFor(learner), previous: [], pair });
      expect(sel.best?.inBand, id).toBe(true);
    }
  });
});

describe('simulated learners: always a next step at zero knowledge', () => {
  const learner = LEARNERS.brandNew;

  it('offers target words, a selectable sentence and option rungs', () => {
    const params = paramsFor(learner);
    const targets = chooseTargets({ learner, now: NOW, frequencyKeys: LIST_KEYS, options: { count: 2 } });
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.reason === 'new')).toBe(true);
    const sel = selectSentence(POOL, { pack, learner, now: NOW, targets: targets.map((t) => t.key), params, previous: [], pair });
    expect(sel.best).not.toBeNull();
    // Cognate-heavy sentences are the easiest material for a brand-new learner.
    const cognateWords = sel.best?.words.filter((w) => COGNATES.includes(w.key)) ?? [];
    expect(cognateWords.length).toBeGreaterThanOrEqual(2);
    for (const t of targets) expect(cliffRungFor(learner, t.key, NOW)).toBe('options');
    for (const key of COGNATES.slice(0, 50)) expect(cliffRungFor(learner, key, NOW)).toBe('options');
  });

  it('asks the model for candidates once, or twice with the safe round', async () => {
    const params = paramsFor(learner);
    const targets = chooseTargets({ learner, now: NOW, frequencyKeys: LIST_KEYS, options: { count: 1 } });
    const res = await generateNextSentence(
      createMockModel(),
      { pack, learner, pair },
      { story: ['Marta llegó tarde al mercado.'], targets: targets.map((t) => t.key), params, now: NOW, seed: 11 },
    );
    // The n-gram mock writes fragments that may all be rejected (no verb, too short); the
    // session below is what guarantees a next step.
    expect(res.diagnostics.generateCalls).toBeGreaterThanOrEqual(1);
    expect(res.diagnostics.generateCalls).toBeLessThanOrEqual(2);
  });

  it('a session always shows a next sentence: the starter, then generation or unused canned sentences, no early repeat', async () => {
    const s = StorySession.create({ model: createMockModel(), pack, pair, learner: new LearnerModel(), now: NOW, seed: 5, startMode: 'brand_new' });
    const shown: string[] = [];
    let t = NOW;
    for (let i = 0; i < 60 && shown.length < 20; i++) {
      const step = await s.next((t += 1000));
      expect(step.screen.kind).not.toBe('error');
      if (step.screen.kind === 'cliff') shown.push(step.screen.sentence.text);
    }
    expect(shown.length).toBe(20);
    expect(shown.slice(0, 8)).toEqual((pair.starter?.sentences ?? []).map((x) => x.text));
    expect(new Set(shown).size).toBe(shown.length);
  });
});

describe('simulated learners: new material never runs out at the top', () => {
  const learner = LEARNERS.advanced;

  it('finds new targets beyond the advanced learner vocabulary in the frequency list', () => {
    const vocab = estimateVocabulary(learner, NOW, FULL_KEYS);
    const targets = chooseTargets({ learner, now: NOW, frequencyKeys: FULL_KEYS, options: { count: 2 } });
    expect(targets).toHaveLength(2);
    for (const t of targets) {
      expect(t.reason).toBe('new');
      expect(t.pMeaning).toBeLessThan(0.5);
      expect(rankOf(t.key)).toBeGreaterThan(0.8 * vocab);
    }
    const unknownLeft = FULL_KEYS.filter((k) => learner.pKnown(k, 'meaning', NOW) < 0.5).length;
    expect(unknownLeft).toBeGreaterThan(10_000);
  });

  it('still has material when the shipped list is exhausted: slang lexemes, then practice', () => {
    const newInList = LIST_KEYS.filter((k) => learner.pKnown(k, 'meaning', NOW) < 0.5);
    expect(newInList).toEqual([]);
    const slang = slangLexemeKeys(pack);
    const withSlang = chooseTargets({ learner, now: NOW, frequencyKeys: LIST_KEYS, extra: slang, options: { count: 2 } });
    expect(withSlang).toHaveLength(2);
    expect(withSlang.every((t) => t.reason === 'extra' && slang.includes(t.key))).toBe(true);
    const noSlang = chooseTargets({ learner, now: NOW, frequencyKeys: LIST_KEYS, options: { count: 3 } });
    expect(noSlang).toHaveLength(3);
    expect(noSlang.every((t) => t.reason === 'practice' || t.reason === 'review')).toBe(true);
    // Recently used targets are skipped, and the next ones come up.
    const next = chooseTargets({
      learner,
      now: NOW,
      frequencyKeys: LIST_KEYS,
      exclude: noSlang.map((t) => t.key),
      options: { count: 3 },
    });
    expect(next).toHaveLength(3);
    expect(next.some((t) => noSlang.some((u) => u.key === t.key))).toBe(false);
  });
});

describe('simulated learners: skill mix', () => {
  it('gives the weak speaker options or hint rungs despite strong meaning', () => {
    const learner = LEARNERS.reader;
    const strong = LIST_KEYS.slice(49, 2000).filter((k) => learner.pKnown(k, 'meaning', NOW) >= 0.9);
    expect(strong.length).toBeGreaterThan(1000);
    const rungs = new Set(strong.map((k) => cliffRungFor(learner, k, NOW)));
    expect(rungs.has('free')).toBe(false);
    expect(rungs.has('options')).toBe(true);
    // The advanced learner, who speaks, answers the same words more freely.
    const advanced = LEARNERS.advanced;
    const freeShare = strong.filter((k) => cliffRungFor(advanced, k, NOW) === 'free').length / strong.length;
    expect(freeShare).toBeGreaterThan(0.9);
  });

  it('shows the heritage speaker tiles for words known by sound, whatever their reading', () => {
    const learner = LEARNERS.heritage;
    const params = paramsFor(learner);
    const byEar = LIST_KEYS.filter((k) => learner.pKnown(k, 'sound', NOW) >= 0.9);
    expect(byEar.length).toBeGreaterThan(1000);
    for (const k of byEar) expect(showText(learner, k, NOW, params)).toBe(false);
    // Their written form is weak, which does not bring the text back.
    const weakWritten = byEar.filter((k) => learner.pKnown(k, 'written', NOW) < 0.3);
    expect(weakWritten.length).toBeGreaterThan(1000);
    // A word they have never heard is still shown as text.
    expect(showText(learner, 'es:~rare19999', NOW, params)).toBe(true);
    // The reader sees text for the same words, because they do not know them by ear.
    const reader = LEARNERS.reader;
    const readerParams = paramsFor(reader);
    const shownToReader = byEar.slice(200, 1200).filter((k) => showText(reader, k, NOW, readerParams));
    expect(shownToReader.length).toBe(1000);
  });
});
