import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORY_PROMPT_OPTIONS,
  buildContinuationPrompt,
  buildStoryPrompt,
  extractOptionsFor,
  lengthHintFor,
  levelName,
  tagFor,
  cutTrailingNative,
  extractSentence,
  joinList,
  looseSource,
  promptInstructionLines,
  storySentences,
  stripAsides,
  stripLabels,
  stripMarkdown,
  stripWrappingQuotes,
  tidySpacing,
} from './prompt';
import { createStubPack, createStubPair } from './testStubs';
import { SPANISH_PROMPT_TEXT, SPANISH_REGION_NAMES } from '../lang/es/story';
import type { PromptOptions } from './prompt';

/** The Spanish wording of the older prompt, as a Spanish pack supplies it. */
const SP = { text: SPANISH_PROMPT_TEXT, regionNames: SPANISH_REGION_NAMES };
const es = (o: PromptOptions): PromptOptions => ({ ...SP, ...o });
/** Extract options of the Spanish stub pack: the model's labels plus the pack's. */
const ES = extractOptionsFor(createStubPack());

const STORY = [
  'Marta llegó tarde al mercado.',
  'Buscó al señor de las frutas, pero su puesto estaba cerrado.',
  'Entonces vio una nota en la puerta.',
  'Empezó a leerla en voz alta.',
  'La nota decía que el puesto estaba cerrado por la tarde.',
];

describe('buildContinuationPrompt', () => {
  it('includes short Spanish instructions, the targets and the last few sentences', () => {
    const p = buildContinuationPrompt(STORY, es({ targets: ['compró'], maxWords: 8, register: 'neutral' }));
    expect(p).toContain('Escribe la siguiente oración de esta historia.');
    expect(p).toContain('8 palabras como máximo');
    expect(p).toContain('Usa la palabra compró.');
    expect(p).toContain('Habla en español neutro.');
    expect(p).toContain('Historia:\n');
    expect(p).not.toContain('Marta llegó tarde al mercado.');
    expect(p).toContain('Buscó al señor de las frutas');
    expect(p).toContain('La nota decía que el puesto estaba cerrado por la tarde.');
    expect(p.endsWith('Siguiente oración:')).toBe(true);
  });

  it('keeps every instruction to one short line', () => {
    const lines = promptInstructionLines(es({ targets: ['pan', 'leche'], maxWords: 10, register: 'street', region: 'PR' }));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const l of lines) expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it('honors contextSentences', () => {
    const p = buildContinuationPrompt(STORY, es({ targets: [], maxWords: 8, register: 'neutral', contextSentences: 1 }));
    expect(p).toContain('La nota decía');
    expect(p).not.toContain('Empezó a leerla');
  });

  it('asks for a first sentence when the story is empty', () => {
    for (const story of [[], '', '   ']) {
      const p = buildContinuationPrompt(story, es({ targets: [], maxWords: 6, register: 'neutral' }));
      expect(p).toContain(SPANISH_PROMPT_TEXT.taskFirst);
      expect(p).not.toContain('Historia:');
      expect(p.endsWith('Primera oración:')).toBe(true);
    }
  });

  it('lists several targets naturally', () => {
    const p = buildContinuationPrompt(STORY, es({ targets: ['pan', 'leche', 'queso'], maxWords: 8, register: 'neutral' }));
    expect(p).toContain('Usa estas palabras: pan, leche y queso.');
  });

  it('omits the target line when there are no targets', () => {
    const p = buildContinuationPrompt(STORY, es({ targets: ['  '], maxWords: 8, register: 'neutral' }));
    expect(p).not.toContain('Usa la palabra');
    expect(p).not.toContain('Usa estas palabras');
  });

  it('writes the street register with the region name', () => {
    const p = buildContinuationPrompt(STORY, es({ targets: [], maxWords: 8, register: 'street', region: 'PR' }));
    expect(p).toContain("Usa español de la calle de Puerto Rico, como 'tá y pa'.");
    const noRegion = buildContinuationPrompt(STORY, es({ targets: [], maxWords: 8, register: 'street' }));
    expect(noRegion).toContain("Usa español de la calle, como 'tá y pa'.");
    const named = buildContinuationPrompt(STORY, es({ targets: [], maxWords: 8, register: 'street', region: 'Panamá' }));
    expect(named).toContain('calle de Panamá');
  });

  it('simple prompt uses easier wording and only the first target', () => {
    const p = buildContinuationPrompt(STORY, es({ targets: ['pan', 'leche'], maxWords: 8, register: 'neutral', simple: true }));
    expect(p).toContain(SPANISH_PROMPT_TEXT.taskSimple);
    expect(p).toContain(SPANISH_PROMPT_TEXT.veryEasyWords);
    expect(p).toContain('Usa la palabra pan.');
    expect(p).not.toContain('leche');
  });

  it('rounds fractional maxWords and accepts a story given as one text', () => {
    const p = buildContinuationPrompt('Marta llegó tarde. Compró pan.\nVolvió a casa.', es({
      targets: [],
      maxWords: 7.6,
      register: 'neutral',
    }));
    expect(p).toContain('8 palabras como máximo');
    expect(p).toContain('Marta llegó tarde. Compró pan. Volvió a casa.');
  });

  it('accepts wording overrides for other languages', () => {
    const p = buildContinuationPrompt(['Mary went home.'], ({
      targets: ['bread'],
      maxWords: 6,
      register: 'neutral',
      text: {
        task: 'Write the next sentence of this story.',
        length: 'One sentence, at most {max} words.',
        oneTarget: 'Use the word {words}.',
        simpleWords: 'Use simple words.',
        neutral: 'Use standard English.',
        answerOnly: 'Answer with the sentence only.',
        storyLabel: 'Story:',
        nextLabel: 'Next sentence:',
      },
    }));
    expect(p).toContain('Write the next sentence of this story.\nOne sentence, at most 6 words.\nUse the word bread.');
    expect(p.endsWith('Next sentence:')).toBe(true);
  });

  it('promptInstructionLines are exactly the instruction block of the prompt', () => {
    const opts = es({ targets: ['pan'], maxWords: 8, register: 'neutral' as const });
    const p = buildContinuationPrompt(STORY, opts);
    expect(p.startsWith(promptInstructionLines(opts).join('\n'))).toBe(true);
  });

  it('has no wording of its own: without pack text it holds only the story', () => {
    const p = buildContinuationPrompt(STORY, { targets: ['pan'], maxWords: 8, register: 'street', region: 'PR' });
    expect(p).toBe(STORY.slice(-4).join(' '));
    expect(promptInstructionLines({ targets: ['pan'], maxWords: 8, register: 'neutral' })).toEqual([]);
  });
});

describe('extractSentence', () => {
  it('cleans the canonical messy output', () => {
    expect(extractSentence('Oración: "Marta compró pan." (Marta bought bread)', ES)).toBe('Marta compró pan.');
  });

  const cases: [string, string][] = [
    ['Marta compró pan. Luego volvió a casa.', 'Marta compró pan.'],
    ['**Siguiente oración:** Marta compró pan.', 'Marta compró pan.'],
    ['```\nMarta compró pan.\n```', 'Marta compró pan.'],
    ['\n\nOración:\nMarta compró pan.', 'Marta compró pan.'],
    ['"Marta compró pan." Marta bought bread.', 'Marta compró pan.'],
    ['Marta compró pan - Marta bought bread', 'Marta compró pan.'],
    ['Marta compró pan = Marta bought bread', 'Marta compró pan.'],
    ['Marta compró pan / Marta bought bread', 'Marta compró pan.'],
    ['Marta compró pan. Translation: Marta bought bread.', 'Marta compró pan.'],
    ['Marta compró pan (bread) en el mercado.', 'Marta compró pan en el mercado.'],
    ['Marta compró pan [bread].', 'Marta compró pan.'],
    ["'Eso 'tá brutal.'", "Eso 'tá brutal."],
    ["el corillo ya 'tá listo pa' bailar", "El corillo ya 'tá listo pa' bailar."],
    ["'tá listo", "'Tá listo."],
    ['¿ dónde estás', '¿Dónde estás?'],
    ['¡ qué vaina', '¡Qué vaina!'],
    ['  estoy cansado . ella está en la playa .', 'Estoy cansado.'],
    [' . estoy cansado.', 'Estoy cansado.'],
    ['El Sr. García compró pan. Luego se fue.', 'El Sr. García compró pan.'],
    ['Aquí está la siguiente oración: Marta compró pan.', 'Marta compró pan.'],
    ['Here is the next sentence: Marta compró pan.', 'Marta compró pan.'],
    ['Claro, aquí tienes:\nMarta compró pan.', 'Marta compró pan.'],
    ['«Marta compró pan.»', 'Marta compró pan.'],
    ['“Marta compró pan.”', 'Marta compró pan.'],
    ['"Marta compró pan.', 'Marta compró pan.'],
    ['1. Marta compró pan.', 'Marta compró pan.'],
    ['- Marta compró pan.', 'Marta compró pan.'],
    ['> Marta compró pan.', 'Marta compró pan.'],
    ['# Marta compró pan.', 'Marta compró pan.'],
    ['Oración 2: Marta compró pan.', 'Marta compró pan.'],
    ['ORACIÓN: Marta compró pan.', 'Marta compró pan.'],
    ['Oracio\u0301n: Marta compró pan.', 'Marta compró pan.'],
    ['Respuesta: ¿Dónde está Marta?', '¿Dónde está Marta?'],
    ['Marta compró pan,', 'Marta compró pan.'],
    ['Marta compró pan...', 'Marta compró pan...'],
    ['Marta... compró pan.', 'Marta... compró pan.'],
    ['¿Qué hiciste ayer? Nada.', '¿Qué hiciste ayer?'],
    ['Marta compró 3,5 kilos de pan.', 'Marta compró 3,5 kilos de pan.'],
    ['—Hola —dijo Marta.', '—Hola —dijo Marta.'],
    ['ñandú corrió.', 'Ñandú corrió.'],
  ];
  for (const [raw, want] of cases) {
    it(`cleans ${JSON.stringify(raw)}`, () => {
      expect(extractSentence(raw, ES)).toBe(want);
    });
  }

  it('returns an empty string when nothing usable is left', () => {
    for (const raw of ['', '   ', '...', '¿?', '(Marta bought bread)', '```\n```', 'Oración:', '"""']) {
      expect(extractSentence(raw, ES), JSON.stringify(raw)).toBe('');
    }
  });

  it('cuts a trailing English gloss with a native lexicon', () => {
    const { nativeLexicon } = createStubPair();
    const pack = createStubPack();
    const isTargetWord = (w: string) => pack.analyze(pack.normalize(w)).length > 0;
    expect(extractSentence('Marta compró pan Marta bought bread', { nativeLexicon, isTargetWord })).toBe('Marta compró pan.');
    // "pan" is in both lexicons: the target predicate keeps it.
    expect(extractSentence('Marta compró pan bought bread.', { nativeLexicon, isTargetWord })).toBe('Marta compró pan.');
    // Without the predicate a shared word is taken for part of the gloss.
    expect(extractSentence('Marta compró pan bought bread.', { nativeLexicon })).toBe('Marta compró.');
    // A single trailing native word is left for the selector to judge.
    expect(extractSentence('Marta compró bread', { nativeLexicon })).toBe('Marta compró bread.');
    // An all-native sentence is left whole (the selector rejects it).
    expect(extractSentence('I bought bread', { nativeLexicon })).toBe('I bought bread.');
  });

  it('can leave capitalization and final punctuation alone', () => {
    expect(extractSentence('marta compró pan', { capitalize: false, addFinalPunctuation: false })).toBe('marta compró pan');
  });
});

describe('prompt helpers', () => {
  it('joinList', () => {
    expect(joinList([], ', ', ' y ')).toBe('');
    expect(joinList(['a'], ', ', ' y ')).toBe('a');
    expect(joinList(['a', 'b'], ', ', ' y ')).toBe('a y b');
    expect(joinList(['a', 'b', 'c'], ', ', ' y ')).toBe('a, b y c');
  });

  it('storySentences splits entries and collapses whitespace', () => {
    expect(storySentences(['Uno. Dos.', 'Tres\n\ncuatro.'])).toEqual(['Uno.', 'Dos.', 'Tres cuatro.']);
    expect(storySentences('')).toEqual([]);
  });

  it('stripMarkdown', () => {
    expect(stripMarkdown('**Marta** compró `pan`.')).toBe('Marta compró pan.');
    expect(stripMarkdown('```spanish')).toBe('');
    expect(stripMarkdown('* Marta')).toBe('Marta');
  });

  it('stripLabels keeps sentences that merely contain a colon', () => {
    const LB = { labels: ES.labels ?? [], preambleWords: ES.preambleWords ?? [] };
    expect(stripLabels('Marta dijo: hola.', LB)).toBe('Marta dijo: hola.');
    expect(stripLabels('Marta leyó la frase: hola.', LB)).toBe('Marta leyó la frase: hola.');
    expect(stripLabels('La siguiente oración es: Marta llegó.', LB)).toBe('Marta llegó.');
    expect(stripLabels('Sentence: Marta compró pan.')).toBe('Marta compró pan.');
    expect(stripLabels('Historia: Oración: Marta.', LB)).toBe('Marta.');
  });

  it('looseSource matches accented and unaccented forms', () => {
    const re = new RegExp(`^${looseSource('oracion')}$`, 'iu');
    expect(re.test('oración')).toBe(true);
    expect(re.test('ORACION')).toBe(true);
    expect(re.test('oraciones')).toBe(false);
    expect(new RegExp(looseSource('a.b'), 'u').test('axb')).toBe(false);
  });

  it('stripWrappingQuotes keeps clipped forms', () => {
    expect(stripWrappingQuotes("'tá listo pa'")).toBe("'tá listo pa'");
    expect(stripWrappingQuotes("'Marta llegó.'")).toBe('Marta llegó.');
    expect(stripWrappingQuotes('‘Marta llegó’')).toBe('Marta llegó');
    expect(stripWrappingQuotes('"«Marta»"')).toBe('Marta');
  });

  it('stripAsides removes nested brackets', () => {
    expect(stripAsides('Marta (la amiga (de Rosa)) llegó.')).toBe('Marta llegó.');
  });

  it('tidySpacing', () => {
    expect(tidySpacing('¿ qué  hiciste , Marta ?')).toBe('¿qué hiciste, Marta?');
  });

  it('cutTrailingNative needs at least min native words', () => {
    const lex = new Set(['bought', 'bread']);
    expect(cutTrailingNative('Marta compró bread', lex, 2)).toBe('Marta compró bread');
    expect(cutTrailingNative('Marta compró pan - bought bread', lex, 2)).toBe('Marta compró pan');
  });
});

describe('buildStoryPrompt (the continuation prompt)', () => {
  const pack = createStubPack();
  const story = ['Marta llegó tarde al mercado.', { text: 'Compró pan y fruta.', tag: 'pan' }, 'Su amiga la esperaba en la puerta.'];

  it('writes the Spanish header from the pack, the tagged story and the next tag', () => {
    const p = buildStoryPrompt(pack, {
      story, tag: 'comprar', level: 'A1', lengthHint: 'Frases cortas.', names: ['Marta'], scene: 'el mercado',
      vocabulary: ['casa', 'pan'],
    });
    expect(p.prompt).toBe(
      'Cuento en español (nivel A1). Frases cortas.\nPersonajes: Marta.\nLugar: el mercado.\nPalabras: casa, pan.\n\n' +
        '[tarde] Marta llegó tarde al mercado.\n[pan] Compró pan y fruta.\n[esperaba] Su amiga la esperaba en la puerta.\n[comprar]',
    );
    expect(p.prefix + p.suffix).toBe(p.prompt);
    expect(p.suffix).toBe('[comprar]');
    expect(p.vocabularyLine).toBe('Palabras: casa, pan.');
    expect(p.headerLines).toHaveLength(4);
  });

  it('keeps the prefix when only the tag changes, and joins several tags', () => {
    const a = buildStoryPrompt(pack, { story, tag: 'comprar' });
    const b = buildStoryPrompt(pack, { story, tag: ['viejo', 'claro'] });
    expect(a.prefix).toBe(b.prefix);
    expect(b.suffix).toBe('[viejo, claro]');
  });

  it('names the region in street register', () => {
    const p = buildStoryPrompt(pack, { story, tag: 'pan', register: 'street', region: 'PR' });
    expect(p.prompt).toContain("Hablan como en la calle de Puerto Rico, con 'tá y pa'.");
  });

  it('shows the last contextSentences lines, with example lines when the story is short', () => {
    const long = ['Uno llegó.', 'Dos llegó.', 'Tres llegó.', 'Cuatro llegó.', 'Cinco llegó.', 'Seis llegó.'];
    const p = buildStoryPrompt(pack, { story: long, tag: 'pan' });
    expect(p.prompt).not.toContain('Dos llegó.');
    expect(p.prompt).toContain('Tres llegó.');
    const short = buildStoryPrompt(pack, { story: ['Marta llegó.'], tag: 'pan' });
    const examples = pack.story?.examples ?? [];
    expect(short.prompt).toContain(`[${examples[0]?.tag}] ${examples[0]?.text}`);
    expect(short.prompt.indexOf(examples[0]?.text ?? '?')).toBeLessThan(short.prompt.indexOf('Marta llegó.'));
    expect(DEFAULT_STORY_PROMPT_OPTIONS.minLines).toBe(3);
  });

  it('has no words of its own: a pack without story data gets only the tagged lines', () => {
    const bare = { ...pack, story: undefined };
    const p = buildStoryPrompt(bare, { story, tag: 'comprar', level: 'A1', names: ['Marta'], vocabulary: ['casa'], register: 'street', region: 'PR' });
    expect(p.prompt).toBe('[tarde] Marta llegó tarde al mercado.\n[pan] Compró pan y fruta.\n[esperaba] Su amiga la esperaba en la puerta.\n[comprar]');
    expect(p.headerLines).toEqual([]);
  });

  it('tagFor takes the rarest word, never a name', () => {
    expect(tagFor(pack, 'Marta compró pan en el mercado.')).not.toBe('marta');
    expect(tagFor(pack, 'Rosa vio a Pedro.', ['Rosa', 'Pedro'])).toBe('vio');
    expect(tagFor(pack, '')).toBe('');
    // skipLead: a word after the first ones when one qualifies, else the lead word.
    expect(tagFor(pack, 'Marta llegó tarde al mercado.')).toBe('llegó');
    expect(tagFor(pack, 'Marta llegó tarde al mercado.', [], 2)).toBe('tarde');
    expect(tagFor(pack, 'Marta llegó.', [], 2)).toBe('llegó');
  });

  it('levelName and lengthHintFor read the pack tables', () => {
    expect(levelName(pack.story, 300)).toBe('A1');
    expect(levelName(pack.story, 2000)).toBe('B1');
    expect(levelName(undefined, 300)).toBeUndefined();
    expect(lengthHintFor(pack.story, 6)).toBe('Frases muy cortas.');
    expect(lengthHintFor(pack.story, 10)).toBe('Frases cortas.');
    expect(lengthHintFor(pack.story, 20)).toBeUndefined();
  });
});
