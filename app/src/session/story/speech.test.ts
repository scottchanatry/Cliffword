import type { LanguagePack, Segment, StoryScreen } from '@cliffword/engine';
import { defaultPacks } from '../../services/defaults';
import { cueForScreen, hintsFor, planCue, wordSpansOf } from './speech';

const es = defaultPacks().lang;

/**
 * A toy pack for a script written without spaces: every character of a fixed word list is a
 * word segment boundary, "。" is punctuation. Nothing here may split on spaces.
 */
const WORDS = ['私', 'は', '学生', 'です', '先生', 'が'];
const noSpace: Pick<LanguagePack, 'segment' | 'commands'> = {
  commands: [{ command: 'again', phrases: ['もう一度'] }],
  segment(text: string): Segment[] {
    const out: Segment[] = [];
    let i = 0;
    while (i < text.length) {
      const w = WORDS.find((x) => text.startsWith(x, i));
      const piece = w ?? text[i] ?? '';
      const kind = w ? 'word' : piece === '。' ? 'punct' : piece.trim() === '' ? 'space' : 'word';
      out.push({ text: piece, norm: piece, start: i, end: i + piece.length, kind });
      i += piece.length;
    }
    return out;
  },
};

describe('word spans from the pack', () => {
  it('takes words and numbers from the segmenter, punctuation and spaces left out', () => {
    expect(wordSpansOf(es, '¿Qué hay, Marta? 2 cafés.').map((s) => s.text)).toEqual(['Qué', 'hay', 'Marta', '2', 'cafés']);
  });

  it('never needs spaces: a script without them still gives one span per word', () => {
    expect(wordSpansOf(noSpace, '私は学生です。').map((s) => [s.text, s.start, s.end])).toEqual([
      ['私', 0, 1],
      ['は', 1, 2],
      ['学生', 2, 4],
      ['です', 4, 6],
    ]);
  });
});

describe('planCue', () => {
  it('maps each spoken word of the sentence up to the cliff to its tile', () => {
    const plan = planCue(es, 'Marta es una', 'Marta es una artista.');
    expect(plan.spans.map((s) => s.text)).toEqual(['Marta', 'es', 'una']);
    expect(plan.viewIndex).toEqual([0, 1, 2]);
  });

  it('maps an answer inside the sentence from the cliff word, even when the word also comes earlier', () => {
    const plan = planCue(es, 'la nota', 'Marta lee la nota y la nota dice adiós.', 5);
    expect(plan.viewIndex).toEqual([5, 6]);
    expect(plan.spans[0]).toEqual({ text: 'la', start: 0, end: 2 });
  });

  it('works without spaces', () => {
    const plan = planCue(noSpace, '学生です', '私は学生です。', 2);
    expect(plan.spans).toEqual([
      { text: '学生', start: 0, end: 2 },
      { text: 'です', start: 2, end: 4 },
    ]);
    expect(plan.viewIndex).toEqual([2, 3]);
  });

  it('lights nothing for text that is not part of the sentence on screen', () => {
    const plan = planCue(es, '¿Y tú? ¿Qué hiciste ayer?', null);
    expect(plan.spans.map((s) => s.text)).toEqual(['Y', 'tú', 'Qué', 'hiciste', 'ayer']);
    expect(plan.viewIndex.every((i) => i === null)).toBe(true);
  });
});

describe('cueForScreen and hints', () => {
  const meta = { chapter: 1, title: '', sentence: 1, spokenMs: 0, mode: 'story', canned: true } as const;
  const word = (index: number, text: string, display: 'text' | 'tile' | 'gap' | 'future') => ({
    index,
    text,
    lead: '',
    trail: '',
    spaceAfter: true,
    key: `es:${text}`,
    display,
    durationMs: 300,
    isNew: false,
    slang: false,
    explicit: false,
  });
  const cliff: StoryScreen = {
    kind: 'cliff',
    meta,
    sentence: {
      text: 'Marta llegó tarde al mercado.',
      words: [word(0, 'Marta', 'text'), word(1, 'llegó', 'tile'), word(2, 'tarde', 'text'), word(3, 'al', 'text'), word(4, 'mercado', 'gap')],
      speechRate: 0.8,
      durationMs: 1500,
      glosses: [],
      slang: false,
    },
    cliff: { wordIndex: 4, length: 1, rung: 'options', options: [{ index: 0, text: 'mercado' }, { index: 1, text: 'azul' }], ui: { key: 'cliff.pickOne' }, nativeAllowed: true },
  };

  it('replays the sentence up to the cliff at its rate, and the prompt of a learner turn', () => {
    expect(cueForScreen(es, cliff)).toEqual({ text: 'Marta llegó tarde al', rate: 0.8, what: 'sentence' });
    expect(cueForScreen(es, { kind: 'turn', meta, prompt: { speaker: 'Marta', line: '¿Y tú?' }, ui: { key: 'story.asks' } })).toMatchObject({ text: '¿Y tú?', what: 'prompt' });
    expect(cueForScreen(es, { kind: 'upNext', meta, next: 'retell', advanced: [] })).toBeNull();
  });

  it('hints the visible words, the options and the spoken commands', () => {
    const hints = hintsFor(es, cliff);
    expect(hints).toEqual(expect.arrayContaining(['Marta', 'llegó', 'mercado', 'azul', 'otra vez', 'siguiente']));
    expect(new Set(hints).size).toBe(hints.length);
    expect(hintsFor(noSpace, null)).toEqual(['もう一度']);
  });
});
