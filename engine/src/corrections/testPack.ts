/**
 * Test-only Spanish LanguagePack for the corrections tests. Not exported from the
 * module index; the real Spanish pack lives in lang/es and is owned elsewhere.
 *
 * One lexicon table drives both analyze (form -> analyses) and inflect (lemma +
 * features -> form), so the two always agree.
 */
import type {
  Analysis,
  CorrectionRule,
  Features,
  LanguagePack,
  Pos,
  RegisterPack,
  Segment,
  SlangEntry,
} from '../lang/types';

const WORD_RE = /['’]?[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?/uy;
const NUMBER_RE = /\d+(?:[.,]\d+)*/uy;
const SPACE_RE = /\s+/uy;

/** Lowercase and trim edge punctuation, keeping accents and apostrophes. */
export function testNormalize(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{M}\p{N}'’]+/u, '')
    .replace(/[^\p{L}\p{M}\p{N}'’]+$/u, '');
}

/** Whitespace and punctuation segmenter; words keep apostrophes ('tá, pa'). */
export function testSegment(text: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const [re, kind] of [
      [SPACE_RE, 'space'],
      [WORD_RE, 'word'],
      [NUMBER_RE, 'number'],
    ] as const) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m) {
        const t = m[0];
        out.push({ text: t, norm: kind === 'space' ? '' : testNormalize(t), start: i, end: i + t.length, kind });
        i += t.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = String.fromCodePoint(text.codePointAt(i) as number);
    out.push({ text: ch, norm: ch, start: i, end: i + ch.length, kind: 'punct' });
    i += ch.length;
  }
  return out;
}

interface Entry {
  form: string;
  lemma: string;
  pos: Pos;
  features: Features;
}

const E = (form: string, lemma: string, pos: Pos, features: Features = {}): Entry => ({ form, lemma, pos, features });

/** Finite verb entry: person+number like "1s", tense, mood. */
function fin(form: string, lemma: string, pn: string, tense: string, mood = 'ind', pos: Pos = 'VERB'): Entry {
  return E(form, lemma, pos, { person: pn.charAt(0), number: pn.charAt(1), tense, mood, form: 'fin' });
}

/** Four forms of a gendered adjective or determiner: m.s, f.s, m.p, f.p. */
function four(lemma: string, pos: Pos, ms: string, fs: string, mp: string, fp: string): Entry[] {
  return [
    E(ms, lemma, pos, { gender: 'm', number: 's' }),
    E(fs, lemma, pos, { gender: 'f', number: 's' }),
    E(mp, lemma, pos, { gender: 'm', number: 'p' }),
    E(fp, lemma, pos, { gender: 'f', number: 'p' }),
  ];
}

function noun(lemma: string, gender: string, sg: string, pl: string): Entry[] {
  return [E(sg, lemma, 'NOUN', { gender, number: 's' }), E(pl, lemma, 'NOUN', { gender, number: 'p' })];
}

export const TEST_LEXICON: readonly Entry[] = [
  // estar
  fin('estoy', 'estar', '1s', 'pres'), fin('estás', 'estar', '2s', 'pres'), fin('está', 'estar', '3s', 'pres'),
  fin('estamos', 'estar', '1p', 'pres'), fin('están', 'estar', '3p', 'pres'),
  fin('estaba', 'estar', '1s', 'impf'), fin('estaba', 'estar', '3s', 'impf'),
  fin('estuve', 'estar', '1s', 'pret'), fin('estuvo', 'estar', '3s', 'pret'),
  fin('esté', 'estar', '1s', 'pres', 'sub'), fin('esté', 'estar', '3s', 'pres', 'sub'),
  fin('estés', 'estar', '2s', 'pres', 'sub'),
  // ser
  fin('soy', 'ser', '1s', 'pres'), fin('eres', 'ser', '2s', 'pres'), fin('es', 'ser', '3s', 'pres'),
  fin('somos', 'ser', '1p', 'pres'), fin('son', 'ser', '3p', 'pres'),
  fin('era', 'ser', '1s', 'impf'), fin('era', 'ser', '3s', 'impf'),
  fin('fui', 'ser', '1s', 'pret'), fin('fue', 'ser', '3s', 'pret'),
  fin('sea', 'ser', '1s', 'pres', 'sub'), fin('sea', 'ser', '3s', 'pres', 'sub'),
  // ir (shares the preterite with ser)
  fin('voy', 'ir', '1s', 'pres'), fin('vamos', 'ir', '1p', 'pres'), fin('fui', 'ir', '1s', 'pret'),
  fin('fuimos', 'ir', '1p', 'pret'), fin('iba', 'ir', '1s', 'impf'), fin('íbamos', 'ir', '1p', 'impf'),
  // ver, llamar, visitar
  fin('veo', 'ver', '1s', 'pres'), fin('vi', 'ver', '1s', 'pret'), fin('veía', 'ver', '1s', 'impf'),
  fin('vea', 'ver', '1s', 'pres', 'sub'),
  fin('llamo', 'llamar', '1s', 'pres'), fin('llamé', 'llamar', '1s', 'pret'), fin('llamaba', 'llamar', '1s', 'impf'),
  fin('llame', 'llamar', '1s', 'pres', 'sub'),
  fin('visito', 'visitar', '1s', 'pres'),
  // comer, vivir
  fin('comí', 'comer', '1s', 'pret'), fin('comía', 'comer', '1s', 'impf'), fin('como', 'comer', '1s', 'pres'),
  fin('coma', 'comer', '1s', 'pres', 'sub'),
  fin('vivía', 'vivir', '1s', 'impf'), fin('vivía', 'vivir', '3s', 'impf'), fin('viví', 'vivir', '1s', 'pret'),
  fin('vivió', 'vivir', '3s', 'pret'), fin('viviera', 'vivir', '1s', 'impf', 'sub'), fin('viviera', 'vivir', '3s', 'impf', 'sub'),
  // querer, venir, llover, compro
  fin('quiero', 'querer', '1s', 'pres'), fin('quiera', 'querer', '1s', 'pres', 'sub'),
  fin('vienes', 'venir', '2s', 'pres'), fin('vengas', 'venir', '2s', 'pres', 'sub'),
  fin('llueve', 'llover', '3s', 'pres'), fin('llueva', 'llover', '3s', 'pres', 'sub'),
  fin('compro', 'comprar', '1s', 'pres'),
  E('bailar', 'bailar', 'VERB', { form: 'inf' }),
  // adjectives
  ...four('cansado', 'ADJ', 'cansado', 'cansada', 'cansados', 'cansadas'),
  ...four('contento', 'ADJ', 'contento', 'contenta', 'contentos', 'contentas'),
  ...four('listo', 'ADJ', 'listo', 'lista', 'listos', 'listas'),
  ...four('blanco', 'ADJ', 'blanco', 'blanca', 'blancos', 'blancas'),
  ...four('nuevo', 'ADJ', 'nuevo', 'nueva', 'nuevos', 'nuevas'),
  ...four('bueno', 'ADJ', 'bueno', 'buena', 'buenos', 'buenas'),
  ...four('bonito', 'ADJ', 'bonito', 'bonita', 'bonitos', 'bonitas'),
  E('grande', 'grande', 'ADJ', { number: 's' }), E('grandes', 'grande', 'ADJ', { number: 'p' }),
  E('brutal', 'brutal', 'ADJ', { number: 's' }),
  // determiners
  ...four('el', 'DET', 'el', 'la', 'los', 'las'),
  ...four('un', 'DET', 'un', 'una', 'unos', 'unas'),
  ...four('este', 'DET', 'este', 'esta', 'estos', 'estas'),
  E('mi', 'mi', 'DET', { number: 's' }), E('mis', 'mi', 'DET', { number: 'p' }),
  // nouns
  ...noun('casa', 'f', 'casa', 'casas'), ...noun('mesa', 'f', 'mesa', 'mesas'),
  ...noun('libro', 'm', 'libro', 'libros'), ...noun('coche', 'm', 'coche', 'coches'),
  ...noun('comida', 'f', 'comida', 'comidas'), ...noun('mercado', 'm', 'mercado', 'mercados'),
  ...noun('playa', 'f', 'playa', 'playas'), ...noun('madre', 'f', 'madre', 'madres'),
  ...noun('amigo', 'm', 'amigo', 'amigos'), ...noun('niño', 'm', 'niño', 'niños'),
  ...noun('gente', 'f', 'gente', 'gentes'), ...noun('pan', 'm', 'pan', 'panes'),
  ...noun('fruta', 'f', 'fruta', 'frutas'), ...noun('vaina', 'f', 'vaina', 'vainas'),
  ...noun('corillo', 'm', 'corillo', 'corillos'), ...noun('rosa', 'f', 'rosa', 'rosas'),
  E('gracias', 'gracias', 'NOUN', { gender: 'f', number: 'p' }),
  // proper nouns
  E('marta', 'Marta', 'PROPN'), E('ana', 'Ana', 'PROPN'), E('rosa', 'Rosa', 'PROPN'),
  // function words
  E('por', 'por', 'ADP'), E('para', 'para', 'ADP'), E('a', 'a', 'ADP'), E('en', 'en', 'ADP'),
  E('de', 'de', 'ADP'), E('con', 'con', 'ADP'),
  E('muy', 'muy', 'ADV'), E('hoy', 'hoy', 'ADV'), E('ya', 'ya', 'ADV'), E('ayer', 'ayer', 'ADV'),
  E('más', 'más', 'ADV'), E('qué', 'qué', 'PRON'), E('ella', 'ella', 'PRON'), E('eso', 'eso', 'PRON'),
  E('que', 'que', 'CONJ'), E('y', 'y', 'CONJ'), E('ojalá', 'ojalá', 'INTJ'),
  // street forms (also analyzed, so only slang protection keeps them unedited)
  fin("'tá", 'estar', '3s', 'pres'), E("pa'", 'para', 'ADP'),
  E('janguear', 'janguear', 'VERB', { form: 'inf' }),
];

function sameFeatures(a: Features, b: Features): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Features>;
  for (const k of keys) if ((a[k] ?? '') !== (b[k] ?? '')) return false;
  return true;
}

function slang(form: string, neutral: string, kind: SlangEntry['kind'] = 'word'): SlangEntry {
  return {
    form,
    norm: testNormalize(form),
    neutral,
    lemma: testNormalize(form),
    gloss: { en: neutral },
    regions: ['PR'],
    formality: 'street',
    explicit: false,
    kind,
  };
}

/** A small Puerto Rico register pack: clipped forms, slang words and one phrase. */
export const TEST_REGISTERS: readonly RegisterPack[] = [
  {
    id: 'es-PR',
    region: 'PR',
    entries: [
      slang("'tá", 'está', 'clipped'),
      slang("pa'", 'para', 'clipped'),
      slang('janguear', 'salir'),
      slang('corillo', 'grupo de amigos'),
      slang('vaina', 'cosa'),
      slang('brutal', 'excelente'),
      slang('de una', 'enseguida', 'phrase'),
    ],
  },
];

export interface TestPackOptions {
  rules?: readonly CorrectionRule[];
  registers?: readonly RegisterPack[];
  /** Extra analyses keyed by norm, consulted before the lexicon. */
  extra?: Record<string, Analysis[]>;
}

/** Build the test pack. Defaults: no rules, the PR register pack. */
export function createTestPack(opts: TestPackOptions = {}): LanguagePack {
  const byForm = new Map<string, Analysis[]>();
  for (const e of TEST_LEXICON) {
    const list = byForm.get(e.form) ?? [];
    list.push({ lemma: e.lemma, pos: e.pos, features: e.features });
    byForm.set(e.form, list);
  }
  return {
    code: 'es',
    segment: testSegment,
    normalize: testNormalize,
    analyze: (norm) => opts.extra?.[norm] ?? byForm.get(norm) ?? [],
    inflect: (lemma, features) =>
      TEST_LEXICON.find((e) => e.lemma === lemma && sameFeatures(e.features, features))?.form,
    frequencyRank: () => undefined,
    rules: opts.rules ?? [],
    registers: opts.registers ?? TEST_REGISTERS,
  };
}
