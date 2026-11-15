import { describe, expect, it } from 'vitest';
import {
  SPANISH_PROMPT_TEXT,
  buildContinuationPrompt,
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

const STORY = [
  'Marta llegó tarde al mercado.',
  'Buscó al señor de las frutas, pero su puesto estaba cerrado.',
  'Entonces vio una nota en la puerta.',
  'Empezó a leerla en voz alta.',
  'La nota decía que el puesto estaba cerrado por la tarde.',
];

describe('buildContinuationPrompt', () => {
  it('includes short Spanish instructions, the targets and the last few sentences', () => {
    const p = buildContinuationPrompt(STORY, { targets: ['compró'], maxWords: 8, register: 'neutral' });
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
    const lines = promptInstructionLines({ targets: ['pan', 'leche'], maxWords: 10, register: 'street', region: 'PR' });
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const l of lines) expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it('honors contextSentences', () => {
    const p = buildContinuationPrompt(STORY, { targets: [], maxWords: 8, register: 'neutral', contextSentences: 1 });
    expect(p).toContain('La nota decía');
    expect(p).not.toContain('Empezó a leerla');
  });

  it('asks for a first sentence when the story is empty', () => {
    for (const story of [[], '', '   ']) {
      const p = buildContinuationPrompt(story, { targets: [], maxWords: 6, register: 'neutral' });
      expect(p).toContain(SPANISH_PROMPT_TEXT.taskFirst);
      expect(p).not.toContain('Historia:');
      expect(p.endsWith('Primera oración:')).toBe(true);
    }
  });

  it('lists several targets naturally', () => {
    const p = buildContinuationPrompt(STORY, { targets: ['pan', 'leche', 'queso'], maxWords: 8, register: 'neutral' });
    expect(p).toContain('Usa estas palabras: pan, leche y queso.');
  });

  it('omits the target line when there are no targets', () => {
    const p = buildContinuationPrompt(STORY, { targets: ['  '], maxWords: 8, register: 'neutral' });
    expect(p).not.toContain('Usa la palabra');
    expect(p).not.toContain('Usa estas palabras');
  });

  it('writes the street register with the region name', () => {
    const p = buildContinuationPrompt(STORY, { targets: [], maxWords: 8, register: 'street', region: 'PR' });
    expect(p).toContain("Usa español de la calle de Puerto Rico, como 'tá y pa'.");
    const noRegion = buildContinuationPrompt(STORY, { targets: [], maxWords: 8, register: 'street' });
    expect(noRegion).toContain("Usa español de la calle, como 'tá y pa'.");
    const named = buildContinuationPrompt(STORY, { targets: [], maxWords: 8, register: 'street', region: 'Panamá' });
    expect(named).toContain('calle de Panamá');
  });

  it('simple prompt uses easier wording and only the first target', () => {
    const p = buildContinuationPrompt(STORY, { targets: ['pan', 'leche'], maxWords: 8, register: 'neutral', simple: true });
    expect(p).toContain(SPANISH_PROMPT_TEXT.taskSimple);
    expect(p).toContain(SPANISH_PROMPT_TEXT.veryEasyWords);
    expect(p).toContain('Usa la palabra pan.');
    expect(p).not.toContain('leche');
  });

  it('rounds fractional maxWords and accepts a story given as one text', () => {
    const p = buildContinuationPrompt('Marta llegó tarde. Compró pan.\nVolvió a casa.', {
      targets: [],
      maxWords: 7.6,
      register: 'neutral',
    });
    expect(p).toContain('8 palabras como máximo');
    expect(p).toContain('Marta llegó tarde. Compró pan. Volvió a casa.');
  });

  it('accepts wording overrides for other languages', () => {
    const p = buildContinuationPrompt(['Mary went home.'], {
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
    });
    expect(p).toContain('Write the next sentence of this story.\nOne sentence, at most 6 words.\nUse the word bread.');
    expect(p.endsWith('Next sentence:')).toBe(true);
  });

  it('promptInstructionLines are exactly the instruction block of the prompt', () => {
    const opts = { targets: ['pan'], maxWords: 8, register: 'neutral' as const };
    const p = buildContinuationPrompt(STORY, opts);
    expect(p.startsWith(promptInstructionLines(opts).join('\n'))).toBe(true);
  });
});

describe('extractSentence', () => {
  it('cleans the canonical messy output', () => {
    expect(extractSentence('Oración: "Marta compró pan." (Marta bought bread)')).toBe('Marta compró pan.');
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
      expect(extractSentence(raw)).toBe(want);
    });
  }

  it('returns an empty string when nothing usable is left', () => {
    for (const raw of ['', '   ', '...', '¿?', '(Marta bought bread)', '```\n```', 'Oración:', '"""']) {
      expect(extractSentence(raw), JSON.stringify(raw)).toBe('');
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
    expect(stripLabels('Marta dijo: hola.')).toBe('Marta dijo: hola.');
    expect(stripLabels('Marta leyó la frase: hola.')).toBe('Marta leyó la frase: hola.');
    expect(stripLabels('La siguiente oración es: Marta llegó.')).toBe('Marta llegó.');
    expect(stripLabels('Sentence: Marta compró pan.')).toBe('Marta compró pan.');
    expect(stripLabels('Historia: Oración: Marta.')).toBe('Marta.');
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
