/**
 * Language neutrality: the core runs on a language written without spaces.
 *
 * A tiny toy Japanese pack (Japanese for Chinese speakers, a pair the brief names) goes
 * through scoreWords, generateVariants, judgeSentence, matchCommand, alignTranscript and
 * StorySession steps with the deterministic mock model trained on a few Japanese
 * sentences. Words come from Intl.Segmenter('ja', { granularity: 'word' }) when the
 * runtime has it, and from a longest-match dictionary segmenter otherwise (both runs when
 * both exist). Nothing here is Spanish, and nothing may assume that spaces separate words:
 * the checks are that segments cover the text, that no variant or join inserts a space,
 * and that offsets index the original text.
 */
import { describe, expect, it } from 'vitest';
import {
  LearnerModel,
  StorySession,
  alignTranscript,
  createMockModel,
  generateVariants,
  validateLibrary,
  joinSentences,
  judgeSentence,
  matchCommand,
  needsLeadingSpace,
  scoreWords,
  splitTextUnits,
  unitsBefore,
} from '../src';
import type {
  Analysis,
  LanguageModel,
  CorrectionRule,
  LanguagePack,
  LibraryStory,
  LibraryTrack,
  PairPack,
  Pos,
  Segment,
  SegmentKind,
  StarterStory,
  StoryScreen,
  StoryStep,
} from '../src';
import { UI_STRINGS } from '../src/pair/en-es/ui';

const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);

/** lemma, part of speech, surface forms (the first is the dictionary form). Frequency order. */
const LEXICON: ReadonlyArray<readonly [string, Pos, readonly string[]]> = [
  ['私', 'PRON', ['私']],
  ['は', 'ADP', ['は']],
  ['が', 'ADP', ['が']],
  ['を', 'ADP', ['を']],
  ['に', 'ADP', ['に']],
  ['です', 'AUX', ['です']],
  ['ます', 'AUX', ['ます']],
  ['か', 'ADP', ['か']],
  ['猫', 'NOUN', ['猫']],
  ['犬', 'NOUN', ['犬']],
  ['本', 'NOUN', ['本']],
  ['学校', 'NOUN', ['学校']],
  ['先生', 'NOUN', ['先生']],
  ['東京', 'PROPN', ['東京']],
  ['好き', 'ADJ', ['好き']],
  ['行く', 'VERB', ['行き']],
  ['読む', 'VERB', ['読み']],
  ['もう一度', 'ADV', ['もう一度']],
  ['ゆっくり', 'ADV', ['ゆっくり']],
  ['次', 'NOUN', ['次']],
  ['えーと', 'INTJ', ['えーと']],
];

const FORMS = new Map<string, Analysis[]>();
for (const [lemma, pos, forms] of LEXICON) for (const f of forms) (FORMS.get(f) ?? FORMS.set(f, []).get(f))?.push({ lemma, pos, features: {} });
const FREQUENCY = LEXICON.map(([lemma]) => lemma);
const RANK = new Map(FREQUENCY.map((l, i) => [l, i + 1]));

const SPACE_RE = /^\s+$/u;
const NUMBER_RE = /^[0-9０-９]+$/u;
const WORD_CHAR_RE = /[\p{L}\p{M}]/u;

function normalize(word: string): string {
  return word.normalize('NFKC').toLowerCase();
}

function seg(text: string, start: number, wordLike: boolean): Segment {
  let kind: SegmentKind;
  if (SPACE_RE.test(text)) kind = 'space';
  else if (NUMBER_RE.test(text)) kind = 'number';
  else if (wordLike && WORD_CHAR_RE.test(text)) kind = 'word';
  else kind = 'punct';
  const norm = kind === 'space' ? '' : kind === 'word' ? normalize(text) : text.normalize('NFC');
  return { text, norm, start, end: start + text.length, kind };
}

/** Intl.Segmenter word segmentation (ICU dictionary for Japanese). */
function intlSegmenter(): ((text: string) => Segment[]) | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  const s = new Intl.Segmenter('ja', { granularity: 'word' });
  return (text) => [...s.segment(text)].map((x) => seg(x.segment, x.index, x.isWordLike === true));
}

/** Longest match over the toy lexicon; any other letter is a one-character word. */
function dictionarySegmenter(text: string): Segment[] {
  const forms = [...FORMS.keys()].sort((a, b) => b.length - a.length);
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = String.fromCodePoint(text.codePointAt(i) as number);
    if (SPACE_RE.test(ch)) {
      let j = i;
      while (j < text.length && SPACE_RE.test(text[j] as string)) j++;
      out.push(seg(text.slice(i, j), i, false));
      i = j;
      continue;
    }
    if (NUMBER_RE.test(ch)) {
      let j = i;
      while (j < text.length && NUMBER_RE.test(text[j] as string)) j++;
      out.push(seg(text.slice(i, j), i, false));
      i = j;
      continue;
    }
    const f = forms.find((form) => text.startsWith(form, i));
    const piece = f ?? ch;
    out.push(seg(piece, i, WORD_CHAR_RE.test(piece)));
    i += piece.length;
  }
  return out;
}

/** Particle swap は <-> が and に <-> を: data, like every rule. */
const RULES: readonly CorrectionRule[] = [
  { id: 'ja.particle.wa_ga', kind: 'swap', explainKey: 'ja.wa_ga', groups: [['は', 'が']] },
  { id: 'ja.particle.ni_wo', kind: 'swap', explainKey: 'ja.ni_wo', groups: [['に', 'を']] },
];

function toyPack(segment: (text: string) => Segment[]): LanguagePack {
  return {
    code: 'ja',
    segment,
    normalize,
    analyze: (norm) => FORMS.get(norm) ?? [],
    inflect: (lemma) => LEXICON.find(([l]) => l === lemma)?.[2][0],
    frequencyRank: (lemma) => RANK.get(lemma),
    frequencyList: FREQUENCY,
    rules: RULES,
    registers: [],
    scoringPrefix: '日本語の文:\n',
    commands: [
      { command: 'again', phrases: ['もう一度'] },
      { command: 'slower', phrases: ['ゆっくり'] },
      { command: 'dont_know', phrases: ['わかりません'] },
      { command: 'next', phrases: ['次'] },
      { command: 'done', phrases: ['終わり'] },
      { command: 'meaning', phrases: ['意味は何'] },
    ],
    fillers: ['えーと', 'あの'],
  };
}

const STARTER: StarterStory = {
  id: 'zh-ja.starter.toy',
  title: '猫',
  character: '先生',
  taught: ['私', 'は', 'が', 'です'],
  sentences: [
    { text: '私は猫が好きです。', answer: '猫', distractors: ['本', '学校'] },
    { text: '私は犬が好きです。', answer: '犬', distractors: ['本', '東京'] },
    { text: '先生は学校に行きます。', answer: '学校', distractors: ['猫', '犬'] },
  ],
};

const PAIR: PairPack = {
  native: 'zh',
  target: 'ja',
  gloss: (lemma) => ({ 猫: '猫', 犬: '狗', 本: '书', 学校: '学校', 先生: '老师', 好き: '喜欢', 行く: '去', 読む: '读' } as Record<string, string>)[lemma],
  cognates: new Set(['学校', '先生']),
  nativeLexicon: new Set(['狗', '喜欢', '书']),
  toTarget: (w) => ({ 狗: ['犬'], 书: ['本'], 喜欢: ['好き'] } as Record<string, string[]>)[w] ?? [],
  explanations: { 'ja.wa_ga': 'は marks the topic; が marks the subject.', 'ja.ni_wo': 'に marks where you go; を marks the object.' },
  // Display text is looked up by key; the toy pair reuses the en-es strings for every key.
  ui: UI_STRINGS,
  starter: STARTER,
};

const CORPUS: readonly string[] = [
  '私は猫が好きです。',
  '私は犬が好きです。',
  '私は本を読みます。',
  '先生は学校に行きます。',
  '私は東京に行きます。',
  '猫は本が好きです。',
  '先生は猫が好きです。',
  '私は学校に行きます。',
];

const segmenters: Array<[string, (text: string) => Segment[]]> = [['dictionary', dictionarySegmenter]];
const intl = intlSegmenter();
if (intl) segmenters.unshift(['Intl.Segmenter', intl]);

function wordTexts(pack: LanguagePack, text: string): string[] {
  return pack.segment(text).filter((s) => s.kind === 'word').map((s) => s.text);
}

function screenOf<K extends StoryScreen['kind']>(step: StoryStep, kind: K): Extract<StoryScreen, { kind: K }> {
  expect(step.screen.kind).toBe(kind);
  return step.screen as Extract<StoryScreen, { kind: K }>;
}

describe.each(segmenters)('a language without spaces (%s)', (_name, segment) => {
  const pack = toyPack(segment);
  const model = createMockModel(CORPUS);

  it('segments the fixture sentences into words that cover the text, with no spaces anywhere', () => {
    for (const s of CORPUS) {
      const segs = pack.segment(s);
      expect(segs.map((x) => x.text).join('')).toBe(s);
      expect(segs.some((x) => x.kind === 'space')).toBe(false);
      for (const x of segs) expect(s.slice(x.start, x.end)).toBe(x.text);
    }
    expect(wordTexts(pack, '私は猫が好きです。')).toEqual(['私', 'は', '猫', 'が', '好き', 'です']);
  });

  it('scoreWords gives one score per word, at the offsets of the scored text, splitting tokens that span words', async () => {
    const text = '私は猫が好きです。';
    const scores = await scoreWords(model, pack, pack.scoringPrefix ?? '', text);
    expect(scores.map((w) => w.segment.text)).toEqual(wordTexts(pack, text));
    for (const w of scores) {
      expect(text.slice(w.segment.start, w.segment.end)).toBe(w.segment.text);
      expect(Number.isFinite(w.logprob)).toBe(true);
      expect(w.logprob).toBeLessThanOrEqual(0);
      expect([0, 1, 2, 3]).toContain(w.heat);
    }
    // The mock tokenizes a run of letters as at most two tokens ("私は猫が" + "好きです"),
    // so tokens span several words: each word gets the share of its characters.
    const tokens0 = await model.scoreContinuation(pack.scoringPrefix ?? '', text);
    const first = tokens0[0];
    expect(first?.text).toBe('私は猫が');
    for (const w of scores.slice(0, 4)) expect(w.logprob).toBeCloseTo((first?.logprob ?? 0) / 4, 9);
    const tokens = await model.scoreContinuation(pack.scoringPrefix ?? '', text);
    const wordTokenMass = tokens.filter((t) => /[\p{L}]/u.test(t.text)).reduce((a, t) => a + t.logprob, 0);
    expect(scores.reduce((a, w) => a + w.logprob, 0)).toBeCloseTo(wordTokenMass, 9);
  });

  it('generateVariants swaps particles in place without inserting spaces', () => {
    const text = '私が猫が好きです。';
    const variants = generateVariants(pack, text);
    const texts = variants.map((v) => v.text);
    expect(texts).toContain('私は猫が好きです。');
    expect(texts).toContain('私が猫は好きです。');
    for (const v of variants) {
      expect(v.text).not.toMatch(/\s/u);
      expect(v.text.length).toBe(text.length);
      expect(v.explainKey).toBe('ja.wa_ga');
    }
    expect(generateVariants(pack, '私は東京を行きます。').map((v) => v.text)).toContain('私は東京に行きます。');
  });

  it('judgeSentence runs on the toy pack and names a rule from its data', async () => {
    const j = await judgeSentence(model, pack, pack.scoringPrefix ?? '', '私は東京を行きます。', { assertMargin: 1, hintMargin: 0.5 });
    expect(['ok', 'hint', 'assert']).toContain(j.verdict);
    expect(j.variants.length).toBeGreaterThan(0);
    for (const v of j.variants) expect(v.text).not.toMatch(/\s/u);
    const best = j.variants[0];
    expect(best?.text).toBe('私は東京に行きます。');
    expect(best?.explainKey).toBe('ja.ni_wo');
  });

  it('matchCommand matches whole commands through the segmenter, with fillers and punctuation', () => {
    expect(matchCommand('もう一度', pack)?.command).toBe('again');
    expect(matchCommand('えーと、もう一度！', pack)?.command).toBe('again');
    expect(matchCommand('ゆっくり。', pack)?.command).toBe('slower');
    expect(matchCommand('わかりません', pack)?.command).toBe('dont_know');
    expect(matchCommand('意味は何 猫', pack)).toMatchObject({ command: 'meaning', argument: '猫' });
    expect(matchCommand('私は猫が好きです', pack)).toBeNull();
    expect(matchCommand('', pack)).toBeNull();
    expect(matchCommand('。。。', pack)).toBeNull();
    expect(matchCommand('🙂', pack)).toBeNull();
  });

  it('alignTranscript counts words, not spaces: a recognizer that adds spaces still lands every word', () => {
    const expected = '私は猫が好きです。';
    const same = alignTranscript(expected, '私 は 猫 が 好き です', pack);
    expect(same).toMatchObject({ understood: 6, total: 6 });
    const sub = alignTranscript(expected, '私は犬が好きです', pack);
    expect(sub.understood).toBe(5);
    const w = sub.words.find((x) => x.text === '猫');
    expect(w?.outcome).toBe('substituted');
    expect(w?.heard).toBe('犬');
    expect(sub.ui).toEqual({ key: 'stats.understood', params: { n: 5, m: 6 } });
    expect(alignTranscript(expected, '', pack)).toMatchObject({ understood: 0, total: 6 });
  });

  it('joins contexts and sentences without a space: judge, brought text, sessions', async () => {
    expect(needsLeadingSpace('私は猫が好きです。')).toBe(false);
    expect(joinSentences(['私は猫が好きです。', '私は東京に行きます。'])).toBe('私は猫が好きです。私は東京に行きます。');
    const units = splitTextUnits(pack, '私は猫が好きです。先生は学校に行きます。私は本を読みます。');
    expect(units.map((u) => u.text)).toEqual(['私は猫が好きです。', '先生は学校に行きます。', '私は本を読みます。']);
    expect(unitsBefore(units, 2, 2)).toBe('私は猫が好きです。先生は学校に行きます。');

    const scored: string[] = [];
    const recording: LanguageModel = {
      id: 'recording',
      scoreContinuation: (c, t) => {
        scored.push(c + t);
        return model.scoreContinuation(c, t);
      },
      nextTokens: (c, k) => model.nextTokens(c, k),
      generate: (p, o) => model.generate(p, o),
    };
    await judgeSentence(recording, pack, `${pack.scoringPrefix ?? ''}私は猫が好きです。`, '私は東京を行きます。');
    const learner = new LearnerModel();
    for (const [lemma] of LEXICON) learner.apply({ type: 'heard', key: `ja:${lemma}`, at: T0 - 60_000 });
    const s = StorySession.create({ model: recording, pack, pair: PAIR, learner, now: T0, seed: 11 });
    let t = T0;
    for (let i = 0; i < 3; i++) {
      const step = await s.next((t += 1000));
      if (step.screen.kind === 'cliff') await s.handleUtterance('猫', (t += 1000));
    }
    expect(scored.length).toBeGreaterThan(3);
    for (const x of scored) expect(x, x).not.toMatch(/[。、]\s|\s[。、]/u);
  });

  it('StorySession: a canned step and a model step, with words from the segmenter and no added spaces', async () => {
    // Canned (no model): the toy starter.
    const canned = StorySession.create({ model: null, pack, pair: PAIR, learner: new LearnerModel(), now: T0, seed: 7, startMode: 'brand_new' });
    const c = screenOf(await canned.next(T0 + 1000), 'cliff');
    expect(c.sentence.text).toBe('私は猫が好きです。');
    expect(c.sentence.words.map((x) => x.text)).toEqual(wordTexts(pack, c.sentence.text));
    expect(c.sentence.words.every((x) => x.spaceAfter === false)).toBe(true);
    expect(c.sentence.words[c.cliff.wordIndex]?.text).toBe('猫');
    const landed = screenOf(await canned.handleUtterance('猫', T0 + 2000), 'landing');
    expect(landed.outcome.credit).toBe('full');

    // Model path: a learner who knows the toy words, so the session generates.
    const learner = new LearnerModel();
    for (const [lemma] of LEXICON) {
      learner.apply({ type: 'heard', key: `ja:${lemma}`, at: T0 - 60_000 });
      learner.apply({ type: 'read', key: `ja:${lemma}`, at: T0 - 50_000 });
    }
    const s = StorySession.create({ model, pack, pair: PAIR, learner, now: T0, seed: 3 });
    const step = await s.next(T0 + 1000);
    const cliff = screenOf(step, 'cliff');
    expect(cliff.meta).toMatchObject({ mode: 'story', canned: false });
    const words = cliff.sentence.words;
    expect(words.map((x) => x.text)).toEqual(wordTexts(pack, cliff.sentence.text));
    expect(cliff.sentence.text).not.toMatch(/\s/u);
    expect(cliff.cliff.wordIndex).toBeGreaterThan(0);
    expect(step.speak?.text ?? '').not.toMatch(/^\s|\s\S*$/u);
    const answer = words.slice(cliff.cliff.wordIndex, cliff.cliff.wordIndex + cliff.cliff.length).map((x) => x.text).join('');
    expect(cliff.sentence.text).toContain(answer);
    const after = await s.handleUtterance(answer, T0 + 2000);
    const outcome = screenOf(after, 'landing').outcome;
    expect(outcome.credit).toBe('full');
    expect(outcome.expected).toBe(answer);
    expect(outcome.scoredBy).toBe('model');
    // Plain data all the way through.
    expect(JSON.parse(JSON.stringify(s.snapshot()))).toEqual(s.snapshot());
  });

  it('plays a library episode ported from another pair: the neutral layer kept, the lines re-rendered', async () => {
    // Episode 1 of the en-es test series, ported: same ids, intents, concepts, speakers and
    // functions; Japanese lines, Chinese translations, a local name.
    const track: LibraryTrack = {
      id: 'zh-ja.track.market',
      title: '市场日',
      tagline: '卖水果的人什么都知道。',
      city: '東京',
      country: '日本',
      dialect: 'mx',
      cast: [{ id: 'vendor', role: 'the fruit seller at the market', quirk: 'gives everyone a nickname', name: '先生' }],
      setting: 'A small-town open-air market on a hot morning.',
    };
    const story: LibraryStory = {
      id: 'zh-ja.lib.market.e1',
      track: track.id,
      episode: 1,
      tier: 'beginner',
      level: 0,
      title: '先生',
      titleNative: '老师',
      characters: ['先生'],
      beats: ['You arrive at the market', 'The seller introduces herself', 'She says what she likes', 'She says where she goes'],
      functions: ['greet.hello', 'intro.name'],
      sentences: [
        { id: 'e1.l01', intent: 'The seller greets you and says who she is', function: 'intro.name', speaker: 'vendor', text: '私は先生です。', translation: '我是老师。', cliff: { word: '先生', distractors: ['猫', '本'], hint: '老师', concept: 'a person' } },
        { id: 'e1.l02', intent: 'She says what she likes', speaker: 'vendor', text: '私は猫が好きです。', translation: '我喜欢猫。', cliff: { word: '猫', distractors: ['学校', '東京'], hint: '猫', concept: 'an animal' } },
        { id: 'e1.l03', intent: 'She says where she goes', speaker: 'vendor', text: '私は東京に行きます。', translation: '我去东京。', cliff: { word: '東京', distractors: ['本', '犬'], hint: '东京', concept: 'a place' } },
      ],
    };
    expect(validateLibrary(pack, { tracks: [track], library: [story] }, { minLines: 3, minBeats: 4 })).toEqual([]);
    const s = StorySession.create({ model: null, pack, pair: { ...PAIR, tracks: [track], library: [story] }, learner: new LearnerModel(), now: T0, seed: 5 });
    const first = await s.next(T0 + 1000);
    const c = screenOf(first, 'cliff');
    expect(c).toMatchObject({ mode: 'recall', phase: 'playing', speaker: '先生', translation: '我是老师。' });
    expect(c.sentence.words.every((x) => x.spaceAfter === false)).toBe(true);
    const gap = s.played(T0 + 1500);
    expect(gap.speak?.text).toBe('私は…です。');
    expect(gap.speak?.text).not.toMatch(/\s/u);
    const g = screenOf(gap, 'cliff');
    const right = g.cliff.options?.find((o) => o.text === '先生');
    const landed = screenOf(await s.pickOption(right?.index ?? -1, T0 + 2000), 'landing');
    expect(landed).toMatchObject({ expected: '先生', translation: '我是老师。', outcome: { credit: 'full' } });
    let t = T0 + 3000;
    let step = await s.next(t);
    for (let i = 0; i < 10 && step.screen.kind !== 'episodeDone'; i++) {
      if (step.screen.kind === 'cliff') await s.handleUtterance(s.snapshot().state.current?.cliff.answer ?? '', (t += 1000));
      step = await s.next((t += 1000));
    }
    expect(screenOf(step, 'episodeDone')).toMatchObject({ episode: 1, title: '先生', cliffs: 3, unaided: 2, levelAfter: 0 });
    expect(screenOf(await s.next((t += 1000)), 'trackDone').track).toBe(track.id);
  });

  it('gets no Spanish generation prompt: a bare tagged continuation, or the wording of its own story data', async () => {
    const prompts: string[] = [];
    const recording: LanguageModel = {
      id: 'recording',
      scoreContinuation: (c, t) => model.scoreContinuation(c, t),
      nextTokens: (c, k) => model.nextTokens(c, k),
      generate: (p, o) => {
        prompts.push(p);
        return model.generate(p, o);
      },
    };
    const learner = new LearnerModel();
    for (const [lemma] of LEXICON) learner.apply({ type: 'read', key: `ja:${lemma}`, at: T0 - 60_000 });
    const s = StorySession.create({ model: recording, pack, pair: PAIR, learner, now: T0, seed: 9 });
    await s.next(T0 + 1000);
    expect(prompts.length).toBeGreaterThan(0);
    const SPANISH = /Cuento|español|Personajes|Palabras|Frases|Escribe|oración|Historia|nivel/u;
    for (const p of prompts) {
      expect(p).not.toMatch(SPANISH);
      // Only tagged story lines: "[word] sentence" lines and the next tag, no header, no spaces added.
      const lines = p.split('\n');
      for (const line of lines) expect(line).toMatch(/^\[[^\]]+\]/u);
    }
    // With story data of its own, the header is the pack's wording.
    const withData: LanguagePack = {
      ...pack,
      story: {
        prompt: { header: '日本語の物語{level}。', level: '（{name}）', lengthHint: '', characters: '人物：{names}。', scene: '', vocabulary: '単語：{words}。', listSeparator: '、', street: '', streetRegion: '' },
        levels: [{ upTo: 1e9, name: 'N5' }],
      },
    };
    const own: string[] = [];
    const s2 = StorySession.create({
      model: { ...recording, generate: (p, o) => (own.push(p), model.generate(p, o)) },
      pack: withData, pair: PAIR, learner, now: T0, seed: 9,
    });
    await s2.next(T0 + 1000);
    expect(own[0]?.startsWith('日本語の物語（N5）。\n人物：先生。')).toBe(true);
    expect(own[0]).not.toMatch(SPANISH);
  });
});
