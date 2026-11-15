/**
 * Test-only stubs for the scoring tests: a tiny Spanish LanguagePack and model wrappers.
 * Not exported from the module index; real packs live in their own modules.
 */
import type { Analysis, LanguagePack, Segment } from '../lang/types';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../model/types';

const WORD_RE = /['’]?[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*['’]?/uy;
const NUMBER_RE = /\d+(?:[.,]\d+)*/uy;
const SPACE_RE = /\s+/uy;

/** Lowercase and trim edge punctuation, keeping accents and apostrophes. */
export function stubNormalize(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{M}\p{N}'’]+/u, '')
    .replace(/[^\p{L}\p{M}\p{N}'’]+$/u, '');
}

/** Whitespace and punctuation segmenter (words keep apostrophes like 'tá and pa'). */
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

const V = (lemma: string, features: Analysis['features'] = {}): Analysis => ({ lemma, pos: 'VERB', features });

const ANALYSES: Record<string, Analysis[]> = {
  leer: [V('leer', { form: 'inf' })],
  leerla: [V('leer', { form: 'inf' })],
  lee: [V('leer', { person: '3', number: 's', tense: 'pres', mood: 'ind' })],
  leo: [V('leer', { person: '1', number: 's', tense: 'pres', mood: 'ind' })],
  leyó: [V('leer', { person: '3', number: 's', tense: 'pret', mood: 'ind' })],
  leía: [V('leer', { person: '3', number: 's', tense: 'impf', mood: 'ind' })],
  llorar: [V('llorar', { form: 'inf' })],
  lloró: [V('llorar', { person: '3', number: 's', tense: 'pret', mood: 'ind' })],
  reír: [V('reír', { form: 'inf' })],
  estoy: [V('estar', { person: '1', number: 's', tense: 'pres', mood: 'ind' })],
  está: [V('estar', { person: '3', number: 's', tense: 'pres', mood: 'ind' })],
  esta: [{ lemma: 'este', pos: 'DET', features: { gender: 'f', number: 's' } }],
  cansado: [{ lemma: 'cansado', pos: 'ADJ', features: { gender: 'm', number: 's' } }],
  cansada: [{ lemma: 'cansado', pos: 'ADJ', features: { gender: 'f', number: 's' } }],
  muy: [{ lemma: 'muy', pos: 'ADV', features: {} }],
  la: [{ lemma: 'el', pos: 'DET', features: { gender: 'f', number: 's' } }],
  el: [{ lemma: 'el', pos: 'DET', features: { gender: 'm', number: 's' } }],
  nota: [{ lemma: 'nota', pos: 'NOUN', features: { gender: 'f', number: 's' } }],
  notas: [{ lemma: 'nota', pos: 'NOUN', features: { gender: 'f', number: 'p' } }],
  mi: [{ lemma: 'mi', pos: 'DET', features: { number: 's' } }],
  marta: [{ lemma: 'Marta', pos: 'PROPN', features: {} }],
  rosa: [
    { lemma: 'rosa', pos: 'NOUN', features: { gender: 'f', number: 's' } },
    { lemma: 'Rosa', pos: 'PROPN', features: {} },
  ],
  "'tá": [V('estar', { person: '3', number: 's', tense: 'pres', mood: 'ind' })],
  "pa'": [{ lemma: 'para', pos: 'ADP', features: {} }],
};

const RANKS: Record<string, number> = {
  el: 1, estar: 15, muy: 40, leer: 400, nota: 900, cansado: 2000, llorar: 3000, reír: 2500,
};

/** Small Spanish pack with a handful of analyses and frequency ranks. */
export function createStubPack(): LanguagePack {
  return {
    code: 'es',
    segment: stubSegment,
    normalize: stubNormalize,
    analyze: (norm) => ANALYSES[norm] ?? [],
    inflect: () => undefined,
    frequencyRank: (lemma) => RANKS[lemma],
    rules: [],
    registers: [],
  };
}

/** Wraps a model and counts calls per method. */
export class CountingModel implements LanguageModel {
  readonly id: string;
  scoreCalls = 0;
  nextCalls = 0;
  generateCalls = 0;
  readonly nextContexts: string[] = [];
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
    this.nextContexts.push(context);
    return this.inner.nextTokens(context, k);
  }
  generate(prompt: string, opts: GenerateOptions): Promise<string[]> {
    this.generateCalls++;
    return this.inner.generate(prompt, opts);
  }
}

/**
 * A scripted model: nextTokens answers from a table keyed by exact context (unknown
 * contexts return `fallback`); scoreContinuation returns the scripted tokens or one
 * token per character with logprob -1.
 */
export class TableModel implements LanguageModel {
  readonly id = 'table';
  constructor(
    private readonly next: Record<string, Array<[string, number]>>,
    private readonly fallback: Array<[string, number]> = [['.', 1]],
    private readonly scores: Record<string, TokenScore[]> = {},
  ) {}
  async scoreContinuation(context: string, text: string): Promise<TokenScore[]> {
    const scripted = this.scores[`${context}|${text}`];
    if (scripted) return scripted;
    return Array.from(text).map((ch, i) => ({ text: ch, start: i, end: i + 1, logprob: -1 }));
  }
  async nextTokens(context: string, k: number): Promise<TokenCandidate[]> {
    const rows = this.next[context] ?? this.fallback;
    return rows
      .map(([text, p]) => ({ text, logprob: p > 0 ? Math.log(p) : -Infinity }))
      .sort((a, b) => b.logprob - a.logprob)
      .slice(0, k);
  }
  async generate(): Promise<string[]> {
    return [];
  }
}
