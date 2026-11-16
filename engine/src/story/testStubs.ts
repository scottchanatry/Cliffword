/**
 * Test-only stubs for the story and gaps tests: a tiny Spanish LanguagePack (whitespace and
 * punctuation segmentation plus an analysis table), a LearnerView backed by a map, a
 * PairPack for English speakers, and a model wrapper that counts calls. Not exported from
 * the module index; real packs and learner models live in their own modules.
 */
import type { Analysis, Features, LanguagePack, Pos, Segment } from '../lang/types';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../model/types';
import type { PairPack } from '../pair/types';
import type { DifficultyParams, LearnerView, Skill } from '../learner/types';
import { SPANISH_ABBREVIATIONS, SPANISH_STORY_DATA } from '../lang/es/story';

const WORD_RE = /['’]?[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?/uy;
const NUMBER_RE = /\d+(?:[.,]\d+)*/uy;
const SPACE_RE = /\s+/uy;

/** NFC, straight apostrophes, lowercase, trim edge punctuation (keeps clipping apostrophes). */
export function stubNormalize(word: string): string {
  let s = word.normalize('NFC').replace(/[’‘ʼ]/gu, "'").toLowerCase();
  s = s.replace(/^[^\p{L}\p{M}\p{N}']+/u, '').replace(/[^\p{L}\p{M}\p{N}']+$/u, '');
  if (!/[\p{L}\p{N}]/u.test(s)) return '';
  if (s.length >= 3 && s.startsWith("'") && s.endsWith("'") && !s.slice(1, -1).includes("'")) s = s.slice(1, -1);
  return s;
}

/** Whitespace and punctuation segmenter; words keep inner and clipping apostrophes ('tá, pa', don't). */
export function stubSegment(text: string): Segment[] {
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
        out.push({ text: t, norm: kind === 'space' ? '' : stubNormalize(t), start: i, end: i + t.length, kind });
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

const TABLE: Record<string, Analysis[]> = {};

function add(forms: string, lemma: string, pos: Pos, features: Features = {}): void {
  for (const f of forms.split(' ')) (TABLE[f] ??= []).push({ lemma, pos, features });
}

// Determiners, pronouns, prepositions, conjunctions, adverbs.
add('el', 'el', 'DET', { gender: 'm', number: 's' });
add('la', 'el', 'DET', { gender: 'f', number: 's' });
add('los las', 'el', 'DET', { number: 'p' });
add('un una', 'un', 'DET');
add('su sus', 'su', 'DET');
add('mi mis', 'mi', 'DET');
add('esta', 'este', 'DET', { gender: 'f', number: 's' });
add('me', 'me', 'PRON');
add('yo', 'yo', 'PRON');
add('ella', 'ella', 'PRON');
add('eso', 'eso', 'PRON');
add('a', 'a', 'ADP');
add('al', 'al', 'ADP');
add('de del', 'de', 'ADP');
add('en', 'en', 'ADP');
add('con', 'con', 'ADP');
add('por', 'por', 'ADP');
add('para', 'para', 'ADP');
add('y', 'y', 'CONJ');
add('e', 'y', 'CONJ');
add('pero', 'pero', 'CONJ');
add('que', 'que', 'CONJ');
add('no', 'no', 'ADV');
add('ya', 'ya', 'ADV');
add('muy', 'muy', 'ADV');
add('tarde', 'tarde', 'ADV');
add('entonces', 'entonces', 'ADV');
add('hoy', 'hoy', 'ADV');
add('ayer', 'ayer', 'ADV');
add('favor', 'favor', 'NOUN');
// Nouns.
add('mercado', 'mercado', 'NOUN');
add('pan', 'pan', 'NOUN');
add('manzanas', 'manzana', 'NOUN');
add('naranjas', 'naranja', 'NOUN');
add('señor', 'señor', 'NOUN');
add('fruta frutas', 'fruta', 'NOUN');
add('puesto', 'puesto', 'NOUN');
add('nota', 'nota', 'NOUN');
add('puerta', 'puerta', 'NOUN');
add('casa', 'casa', 'NOUN');
add('amiga amigo', 'amigo', 'NOUN');
add('playa', 'playa', 'NOUN');
add('perro', 'perro', 'NOUN');
add('tienda', 'tienda', 'NOUN');
add('ferretería', 'ferretería', 'NOUN');
add('red', 'red', 'NOUN');
add('café', 'café', 'NOUN');
add('corillo', 'corillo', 'NOUN');
add('vaina', 'vaina', 'NOUN');
add('rosa', 'rosa', 'NOUN');
add('rosa', 'Rosa', 'PROPN');
add('marta', 'Marta', 'PROPN');
add('tres', 'tres', 'NUM');
// Verbs.
add('llegó', 'llegar', 'VERB', { person: '3', number: 's', tense: 'pret', mood: 'ind' });
add('compró', 'comprar', 'VERB', { person: '3', number: 's', tense: 'pret', mood: 'ind' });
add('compré', 'comprar', 'VERB', { person: '1', number: 's', tense: 'pret', mood: 'ind' });
add('estaba', 'estar', 'VERB', { person: '3', number: 's', tense: 'impf', mood: 'ind' });
add('está', 'estar', 'VERB', { person: '3', number: 's', tense: 'pres', mood: 'ind' });
add('estoy', 'estar', 'VERB', { person: '1', number: 's', tense: 'pres', mood: 'ind' });
add('vio', 'ver', 'VERB');
add('empezó', 'empezar', 'VERB');
add('leer leerla', 'leer', 'VERB', { form: 'inf' });
add('volvió', 'volver', 'VERB');
add('esperaba', 'esperar', 'VERB');
add('abrió', 'abrir', 'VERB');
add('habló', 'hablar', 'VERB');
add('fui fue vamos', 'ir', 'VERB');
add('bailar', 'bailar', 'VERB', { form: 'inf' });
add('janguear', 'janguear', 'VERB', { form: 'inf' });
add('quiero', 'querer', 'VERB');
add('tengo', 'tener', 'VERB');
add('gusta', 'gustar', 'VERB');
add('hice', 'hacer', 'VERB');
add('mandé', 'mandar', 'VERB');
// Adjectives.
add('cansado cansada', 'cansado', 'ADJ');
add('listo lista', 'listo', 'ADJ');
add('brutal', 'brutal', 'ADJ');
add('cerrado', 'cerrado', 'ADJ');
add('alta', 'alto', 'ADJ');
// Street forms: a slang lexeme is its own lemma (SlangEntry.lemma).
add("'tá", "'tá", 'VERB', { person: '3', number: 's', tense: 'pres', mood: 'ind' });
add("pa'", "pa'", 'ADP');

const RANKS: Record<string, number> = {
  el: 1, de: 2, que: 3, y: 4, a: 5, en: 6, un: 7, yo: 12, con: 14, mi: 20, estar: 15, ir: 25,
  comprar: 400, pan: 700, tienda: 900, perro: 1200, ferretería: 5000,
};

/** All normalized forms the stub pack can analyze. */
export const STUB_FORMS: readonly string[] = Object.keys(TABLE);

/** Small Spanish pack: whitespace/punctuation segmentation and a fixed analysis table. */
export function createStubPack(): LanguagePack {
  return {
    code: 'es',
    segment: stubSegment,
    normalize: stubNormalize,
    analyze: (norm) => TABLE[norm] ?? [],
    inflect: () => undefined,
    frequencyRank: (lemma) => RANKS[lemma],
    rules: [],
    registers: [],
    // The Spanish story data (prompt wording, leak patterns, meta words, labels) and
    // abbreviations, as the real Spanish pack carries them.
    abbreviations: SPANISH_ABBREVIATIONS,
    story: SPANISH_STORY_DATA,
  };
}

/** Per-key knowledge: one number for every skill, or per-skill numbers. */
export type StubKnowledge = Record<string, number | Partial<Record<Skill, number>>>;

/** LearnerView backed by a map; unlisted keys and skills get `fallback`. */
export function stubLearner(known: StubKnowledge, fallback = 0): LearnerView {
  return {
    pKnown(key, skill) {
      const e = known[key];
      if (e === undefined) return fallback;
      if (typeof e === 'number') return e;
      return e[skill] ?? fallback;
    },
    knownKeys: () => Object.keys(known),
  };
}

/** Learner that knows every listed lemma (as es: keys) with probability p for every skill. */
export function learnerKnowing(lemmas: readonly string[], p = 0.97, fallback = 0): LearnerView {
  const known: StubKnowledge = {};
  for (const l of lemmas) known[`es:${l}`] = p;
  return stubLearner(known, fallback);
}

const NATIVE = [
  'the', 'a', 'and', 'i', 'my', 'store', 'hardware', 'bought', 'bread', 'dog', 'home', 'depot',
  'red', 'pan', 'no', 'cafe', 'pa', 'ta', 'check', 'in', 'mail', "don't", 'know', 'sentence',
  'here', 'is', 'went', 'to', 'market', 'marta', 'bike',
];

const TO_TARGET: Record<string, string[]> = {
  store: ['tienda'],
  hardware: ['ferretería'],
  'hardware store': ['ferretería'],
  bread: ['pan'],
  the: ['el', 'la'],
  a: ['un', 'una'],
  dog: ['perro'],
  i: ['yo'],
  my: ['mi'],
  bought: ['comprar'],
  and: ['y'],
  market: ['mercado'],
  went: ['ir'],
  to: ['a'],
  know: ['saber'],
  "don't": ['no'],
};

/** PairPack for English speakers learning Spanish (only what the tests need). */
export function createStubPair(): PairPack {
  return {
    native: 'en',
    target: 'es',
    gloss: () => undefined,
    cognates: new Set<string>(),
    nativeLexicon: new Set(NATIVE),
    toTarget: (w) => [...(TO_TARGET[w.toLowerCase()] ?? [])],
    explanations: {},
    ui: {},
  };
}

/** Difficulty params for an early learner (overridable). */
export function stubParams(over: Partial<DifficultyParams> = {}): DifficultyParams {
  return {
    sentenceWords: { min: 4, max: 8 },
    knownBand: { min: 0.95, max: 0.98 },
    newWordsPerSentence: 0.5,
    speechRate: 1,
    cliffWords: 1,
    tileThreshold: 0.8,
    ...over,
  };
}

/** Wraps a model, counts calls per method and records generate prompts and options. */
export class CountingModel implements LanguageModel {
  readonly id: string;
  scoreCalls = 0;
  nextCalls = 0;
  generateCalls = 0;
  readonly prompts: string[] = [];
  readonly generateOptions: GenerateOptions[] = [];
  constructor(private readonly inner: LanguageModel) {
    this.id = `counting:${inner.id}`;
  }
  get totalCalls(): number {
    return this.scoreCalls + this.nextCalls + this.generateCalls;
  }
  scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    this.scoreCalls++;
    return this.inner.scoreContinuation(context, text);
  }
  nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    this.nextCalls++;
    return this.inner.nextTokens(context, k);
  }
  generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    this.generateCalls++;
    this.prompts.push(prompt);
    this.generateOptions.push(opts);
    return this.inner.generate(prompt, opts);
  }
}

/**
 * A model whose generate() returns scripted outputs: call i returns rounds[i] (the last
 * round repeats), truncated or cycled to n. scoreContinuation returns one token with the
 * scripted log-probability (the natural score of generateNextSentence).
 */
export class ScriptedModel implements LanguageModel {
  readonly id = 'scripted';
  calls = 0;
  scoreCalls = 0;
  readonly prompts: string[] = [];
  /** `logprob(text)` gives the total log-probability scoreContinuation reports for a text (0 by default). */
  constructor(
    private readonly rounds: readonly (readonly string[])[],
    private readonly logprob: (text: string) => number = () => 0,
  ) {}
  async scoreContinuation(_context: string, text: string): Promise<TokenScore[]> {
    this.scoreCalls++;
    return [{ text, start: 0, end: text.length, logprob: this.logprob(text.trim()) }];
  }
  async nextTokens(): Promise<TokenCandidate[]> {
    return [];
  }
  async generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    this.prompts.push(prompt);
    const round = this.rounds[Math.min(this.calls, this.rounds.length - 1)] ?? [];
    this.calls++;
    const out: string[] = [];
    for (let i = 0; i < opts.n && round.length; i++) out.push(round[i % round.length] as string);
    return out;
  }
}
