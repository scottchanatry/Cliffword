/**
 * Task V measurements: the engine's public functions against Qwen3-1.7B over HTTP.
 * Usage: npx vite-node measure.ts <section> [extra]
 * Sections: judge, street, heat, cliffs, generate, topn, timing. Results go to ../results/<section>.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import {
  LearnerModel,
  PlacementTracker,
  chooseTargets,
  cliffPositions,
  cognateLexemeKeys,
  createDefaultPairPack,
  createDefaultSpanishPack,
  deriveParams,
  estimateVocabulary,
  expandRegions,
  frequencyLexemeKeys,
  generateNextSentence,
  judgeSentence,
  lexemeOf,
  nextWords,
  scoreCliffAnswer,
  scoreWords,
  scoringContext,
  sharedPrefixEnd,
  slangExemption,
  slangIn,
  decideVerdict,
  DEFAULT_JUDGE_OPTIONS,
} from '/home/user/cliffword/engine/src/index';
import type { Judgement, LanguageModel, PriorFn, TokenScore, TokenCandidate, GenerateOptions, Segment } from '/home/user/cliffword/engine/src/index';
import { HttpLanguageModel } from '/home/user/cliffword/engine/src/model/http';
import { TopNBoundedModel } from '/home/user/cliffword/engine/src/model/topN';

const ROOT = '/home/user/cliffword';
const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const section = process.argv[2] ?? 'judge';
const extra = process.argv.slice(3);

interface Pair { id: number; rule: string; correct: string; incorrect: string }
interface Slang { id: number; street: string; neutral: string; region: string; explicit: boolean }
const PAIRS: Pair[] = readFileSync(`${ROOT}/proof/pairs.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SLANG: Slang[] = readFileSync(`${ROOT}/proof/slang.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const RAW = JSON.parse(readFileSync(`${ROOT}/proof/raw_qwen3-1.7b.json`, 'utf8')) as { pairs: { id: number; neutral: { c: number; i: number } }[] };

/** Proof rule tag -> engine explainKey families that count as the same rule. */
const FAMILY: Record<string, string[]> = {
  ser_estar: ['es.ser_estar'],
  por_para: ['es.por_para'],
  gender: ['es.gender'],
  number: ['es.number'],
  preterite_imperfect: ['es.aspect'],
  subjunctive_wish: ['es.mood'],
  personal_a: ['es.personal_a'],
  articles: ['es.article'],
  pronoun_placement: ['es.pronoun_placement', 'es.pronoun_order', 'es.negative_command', 'es.se_lo'],
};

/** Counts calls and time per method, so per-call timings come from real engine runs. */
class TimedModel implements LanguageModel {
  readonly id: string;
  readonly stats: Record<string, { calls: number; ms: number }> = {};
  constructor(readonly inner: LanguageModel) {
    this.id = `timed:${inner.id}`;
  }
  private async t<T>(k: string, f: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await f();
    } finally {
      const s = (this.stats[k] ??= { calls: 0, ms: 0 });
      s.calls++;
      s.ms += performance.now() - t0;
    }
  }
  scoreContinuation(c: string, t: string): Promise<TokenScore[]> {
    return this.t('scoreContinuation', () => this.inner.scoreContinuation(c, t));
  }
  nextTokens(c: string, k: number): Promise<TokenCandidate[]> {
    return this.t(`nextTokens`, () => this.inner.nextTokens(c, k));
  }
  generate(p: string, o: GenerateOptions): Promise<string[]> {
    return this.t('generate', () => this.inner.generate(p, o));
  }
  summary() {
    const out: Record<string, { calls: number; msPerCall: number }> = {};
    for (const [k, v] of Object.entries(this.stats)) out[k] = { calls: v.calls, msPerCall: +(v.ms / v.calls).toFixed(1) };
    return out;
  }
}

const http = new HttpLanguageModel({ baseUrl: process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8765', timeoutMs: 600_000 });
const pack = createDefaultSpanishPack();
const pair = createDefaultPairPack();
const NEUTRAL = scoringContext(pack, '');
const meta = () => ({ when: new Date().toISOString(), load: loadavg().map((x) => +x.toFixed(2)), cores: cpus().length });
const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 1));
const log = (...a: unknown[]) => console.log(`[${section}]`, ...a);

const words = (s: string) => pack.segment(s).filter((x) => x.kind === 'word');

/** Error span in the incorrect sentence's word indices: [from, to) with to >= from (an omission has to = from). */
function errorSpan(incorrect: string, correct: string): { from: number; to: number } {
  const a = words(incorrect).map((w) => w.norm);
  const b = words(correct).map((w) => w.norm);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let ja = a.length;
  let jb = b.length;
  while (ja > i && jb > i && a[ja - 1] === b[jb - 1]) {
    ja--;
    jb--;
  }
  return { from: i, to: ja };
}

/** Summary of one judgement. */
function summarize(j: Judgement, text: string, expectFix?: string) {
  const fix = expectFix ? j.variants.find((v) => v.text === expectFix) : undefined;
  return {
    verdict: j.verdict,
    margin: j.margin,
    best: j.best?.text ?? null,
    bestRule: j.best?.ruleId ?? null,
    bestKey: j.best?.explainKey ?? null,
    wordIndex: j.wordIndex,
    variants: j.variants.length,
    dropped: j.droppedVariants,
    bounded: j.bounded ?? false,
    fixFound: expectFix ? !!fix : undefined,
    fixMargin: fix ? fix.margin : undefined,
    fixRank: fix ? j.variants.indexOf(fix) + 1 : undefined,
    secondKey: j.variants.find((v) => v.explainKey !== j.best?.explainKey)?.explainKey ?? null,
    secondMargin: j.variants.find((v) => v.explainKey !== j.best?.explainKey)?.margin ?? null,
    text,
  };
}

async function runJudge() {
  const model = new TimedModel(http);
  const rows: unknown[] = [];
  const t0 = performance.now();
  for (const p of PAIRS) {
    for (const kind of ['incorrect', 'correct'] as const) {
      const text = p[kind];
      const s = performance.now();
      const j = await judgeSentence(model, pack, NEUTRAL, text);
      const ms = performance.now() - s;
      const raw = RAW.pairs.find((r) => r.id === p.id)!;
      rows.push({ id: p.id, rule: p.rule, kind, ms: +ms.toFixed(0), proofMargin: raw.neutral.c - raw.neutral.i, ...summarize(j, text, kind === 'incorrect' ? p.correct : undefined) });
    }
    if (p.id % 10 === 0) log(`${p.id}/${PAIRS.length} ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  save('judge', { meta: meta(), calls: model.summary(), totalMs: performance.now() - t0, rows });
}

async function runStreet() {
  const model = new TimedModel(http);
  const rows: unknown[] = [];
  for (const s of SLANG) {
    const region = s.region === 'DR' ? 'DO' : s.region;
    const regions = [...expandRegions([region])];
    const slangWords = slangIn(pack, s.street, regions);
    const ctxStreet = scoringContext(pack, '', { register: 'street', regions, words: slangWords });
    const exempt = slangExemption(pack, regions);
    const segs = pack.segment(s.street);
    const slangSegs = segs.filter((x) => x.kind === 'word' && exempt(x));
    const overlapsSlang = (start: number, end: number) => slangSegs.some((x) => start < x.end && x.start < end);
    const t0 = performance.now();
    const jStreet = await judgeSentence(model, pack, ctxStreet, s.street, { register: 'street' });
    const msStreet = performance.now() - t0;
    const jNeutral = await judgeSentence(model, pack, NEUTRAL, s.street);
    const variantsTouchingSlang = jStreet.variants.filter((v) => overlapsSlang(v.start, Math.max(v.end, v.start + 1))).length;
    const neutralTouchingSlang = jNeutral.variants.filter((v) => overlapsSlang(v.start, Math.max(v.end, v.start + 1))).length;
    const heatStreet = await scoreWords(model, pack, ctxStreet, s.street, { exempt });
    const heatStreetRaw = await scoreWords(model, pack, ctxStreet, s.street);
    const heatNeutral = await scoreWords(model, pack, NEUTRAL, s.street);
    const wordRows = heatNeutral.map((w, i) => ({
      word: w.segment.text,
      slang: exempt(w.segment),
      neutralSurprisal: +w.surprisal.toFixed(2),
      neutralHeat: w.heat,
      streetSurprisal: +(heatStreetRaw[i]?.surprisal ?? NaN).toFixed(2),
      streetRawHeat: heatStreetRaw[i]?.heat,
      streetHeat: heatStreet[i]?.heat,
    }));
    rows.push({
      id: s.id,
      region,
      text: s.street,
      slangNamed: slangWords,
      slangSegments: slangSegs.map((x) => x.text),
      street: { ...summarize(jStreet, s.street), ms: +msStreet.toFixed(0), touchingSlang: variantsTouchingSlang, edit: jStreet.best ? `${jStreet.best.original}->${jStreet.best.replacement}` : null },
      neutral: { ...summarize(jNeutral, s.street), touchingSlang: neutralTouchingSlang, edit: jNeutral.best ? `${jNeutral.best.original}->${jNeutral.best.replacement}` : null },
      words: wordRows,
    });
    log(s.id, jStreet.verdict, jStreet.best?.text, jStreet.margin?.toFixed(2), '| neutral', jNeutral.verdict, jNeutral.margin?.toFixed(2));
  }
  save('street', { meta: meta(), calls: model.summary(), rows });
}

async function runHeat() {
  const model = new TimedModel(http);
  const rows: unknown[] = [];
  for (const p of PAIRS) {
    const span = errorSpan(p.incorrect, p.correct);
    for (const kind of ['incorrect', 'correct'] as const) {
      const text = p[kind];
      const s = performance.now();
      const ws = await scoreWords(model, pack, NEUTRAL, text);
      const ms = performance.now() - s;
      rows.push({
        id: p.id,
        rule: p.rule,
        kind,
        ms: +ms.toFixed(0),
        span: kind === 'incorrect' ? span : undefined,
        words: ws.map((w) => ({ w: w.segment.text, s: +w.surprisal.toFixed(2), h: w.heat })),
      });
    }
  }
  save('heat', { meta: meta(), calls: model.summary(), rows });
}

const STORY = 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba cerrado. Entonces vio una nota en la puerta y empezó a leerla en voz alta.';

async function runCliffs() {
  const model = new TimedModel(http);
  const cut = STORY.indexOf(' leerla');
  const before = STORY.slice(0, cut);
  const ctx = scoringContext(pack, before);
  const single = ['leerla', 'leer', 'llorar', 'reír', 'reir', 'gritar', 'sonreír', 'mesa', 'verde', 'puerta', 'lee', 'leyó', 'leía', 'comió', 'xyzzy', 'read'];
  const multi = ['leerla en voz alta', 'leer la nota', 'leerla', 'llorar', 'reír a carcajadas', 'leerla en silencio', 'mesa verde grande', 'lee la nota'];
  const out: Record<string, unknown> = { meta: meta(), context: before };
  const res: unknown[] = [];
  for (const [answers, actual] of [[single, 'leerla'], [multi, 'leerla en voz alta']] as const) {
    for (const a of answers) {
      const t0 = performance.now();
      const r = await scoreCliffAnswer(model, pack, ctx, a, actual);
      const ms = performance.now() - t0;
      res.push({ actual, answer: a, credit: r.credit, reason: r.reason, prob: r.prob, rank: r.rank, scored: r.scored, bounded: r.bounded ?? false, ms: +ms.toFixed(0) });
      log(actual, '|', a, r.credit, r.reason, r.prob.toExponential(2), r.rank, `${ms.toFixed(0)} ms`);
    }
  }
  out.answers = res;
  // Alternatives at the cliff.
  const alts = await nextWords(model, ctx);
  out.alternatives = alts.map((w) => ({ word: w.word, prob: +w.prob.toFixed(4) }));
  log('alternatives', alts.map((w) => `${w.word} ${w.prob.toFixed(3)}`).join(', '));
  // Top-10 device simulation of the single-word answers.
  const top10 = new TopNBoundedModel(http, { n: 10 });
  const dev: unknown[] = [];
  for (const a of single) {
    const r = await scoreCliffAnswer(top10, pack, ctx, a, 'leerla');
    dev.push({ answer: a, credit: r.credit, reason: r.reason, prob: r.prob, bounded: r.bounded ?? false });
  }
  out.top10 = dev;
  // Cliff positions over the third sentence.
  const s3start = STORY.indexOf(' Entonces');
  const s3 = STORY.slice(s3start);
  const ctx3 = scoringContext(pack, STORY.slice(0, s3start));
  const t0 = performance.now();
  const positions = await cliffPositions(model, pack, ctx3, s3);
  const ms = performance.now() - t0;
  out.positions = {
    ms: +ms.toFixed(0),
    perPositionMs: +(ms / positions.length).toFixed(0),
    rows: positions.map((p) => ({
      word: p.segment.text,
      actualProb: +Math.exp(p.actualLogprob).toFixed(4),
      plausible: p.plausibleCount,
      top: p.alternatives.slice(0, 5).map((a) => `${a.word} ${a.prob.toFixed(2)}`),
    })),
  };
  for (const p of positions) log(p.segment.text, Math.exp(p.actualLogprob).toFixed(3), p.plausibleCount, p.alternatives.slice(0, 4).map((a) => `${a.word} ${a.prob.toFixed(2)}`).join(', '));
  out.calls = model.summary();
  save('cliffs', out);
}

async function runGenerate() {
  const model = new TimedModel(http);
  const NOW = Date.UTC(2026, 10, 15, 9, 0, 0);
  const keys = frequencyLexemeKeys(pack);
  const rank = new Map(keys.map((k, i) => [k, i + 1]));
  const cognates = cognateLexemeKeys(pair);
  const brandPrior = PlacementTracker.brandNew(cognates);
  /** Intermediate: knows meaning up to about rank 1200, sound and speaking less. */
  const reach = { meaning: 1200, written: 1200, sound: 700, speaking: 300 } as const;
  const interPrior: PriorFn = (key, skill) => {
    const r = rank.get(lexemeOf(key)) ?? 50_000;
    const n = reach[skill];
    return Math.max(0.002 + (0.97 - 0.002) / (1 + Math.pow(r / n, 6)), brandPrior(key, skill));
  };
  const learners = [
    { name: 'brand new (cognate prior)', learner: new LearnerModel({ prior: brandPrior }), story: [] as string[] },
    { name: 'brand new, story under way', learner: new LearnerModel({ prior: brandPrior }), story: ['Marta llegó tarde al mercado.'] },
    { name: 'intermediate (about 1200 lexemes)', learner: new LearnerModel({ prior: interPrior }), story: STORY.match(/[^.]+\./g)!.map((s) => s.trim()) },
  ];
  const seeds = (extra[0] ?? '1,2,3,4').split(',').map(Number);
  const n = Number(extra[1] ?? 4);
  const rows: unknown[] = [];
  for (const L of learners) {
    const vocab = estimateVocabulary(L.learner, NOW, keys);
    const params = deriveParams({ vocab });
    for (const seed of seeds) {
      const targets = chooseTargets({ learner: L.learner, now: NOW, frequencyKeys: keys, options: { count: 2 } });
      const t0 = performance.now();
      const genBefore = model.stats.generate ? { ...model.stats.generate } : { calls: 0, ms: 0 };
      const r = await generateNextSentence(model, { pack, learner: L.learner, pair }, {
        story: L.story,
        targets: targets.map((t) => t.key),
        params,
        now: NOW,
        seed,
        tuning: { n },
      });
      const ms = performance.now() - t0;
      const rejects: Record<string, number> = {};
      for (const e of r.ranked) for (const c of e.rejected) rejects[c] = (rejects[c] ?? 0) + 1;
      const row = {
        learner: L.name,
        vocab: Math.round(vocab),
        sentenceWords: params.sentenceWords,
        band: params.knownBand,
        targets: targets.map((t) => t.key),
        seed,
        ms: +ms.toFixed(0),
        generateMs: +(model.stats.generate!.ms - genBefore.ms).toFixed(0),
        sentence: r.sentence,
        inBand: r.diagnostics.inBand,
        retried: r.diagnostics.retried,
        candidates: r.ranked.length,
        accepted: r.ranked.filter((e) => e.accepted).length,
        inBandCandidates: r.ranked.filter((e) => e.accepted && e.inBand).length,
        rejects,
        bestShare: r.best ? +r.best.bandShare.toFixed(3) : null,
        targetsHit: r.best?.targetsHit ?? [],
        rounds: r.diagnostics.rounds.map((x) => ({ simple: x.simple, raw: x.raw, cleaned: x.cleaned })),
        ranked: r.ranked.map((e) => ({ text: e.text, accepted: e.accepted, inBand: e.inBand, share: +e.bandShare.toFixed(3), rejected: e.rejected, reasons: e.reasons })),
      };
      rows.push(row);
      log(L.name, seed, `${(ms / 1000).toFixed(1)} s`, r.diagnostics.inBand ? 'IN' : 'out', r.diagnostics.retried ? 'retry' : '', JSON.stringify(rejects), r.sentence);
    }
  }
  save(`generate${extra[2] ?? ''}`, { meta: meta(), calls: model.summary(), rows });
}

/** Records, per scoreContinuation call, whether a token came back bounded. */
class BoundRecorder implements LanguageModel {
  readonly id: string;
  readonly seen = new Map<string, boolean>();
  constructor(readonly inner: LanguageModel) {
    this.id = `rec:${inner.id}`;
  }
  async scoreContinuation(c: string, t: string): Promise<TokenScore[]> {
    const toks = await this.inner.scoreContinuation(c, t);
    this.seen.set(`${c}\u0000${t}`, toks.some((x) => x.upperBound));
    return toks;
  }
  nextTokens(c: string, k: number) {
    return this.inner.nextTokens(c, k);
  }
  generate(p: string, o: GenerateOptions) {
    return this.inner.generate(p, o);
  }
}

async function runTopN() {
  const n = Number(extra[0] ?? 10);
  const perRule = Number(extra[1] ?? 100);
  const timed = new TimedModel(http);
  const device = new TopNBoundedModel(timed, { n });
  const rec = new BoundRecorder(device);
  const picked = PAIRS.filter((p, i, all) => all.filter((q) => q.rule === p.rule).indexOf(p) < perRule);
  const rows: unknown[] = [];
  const t0 = performance.now();
  let done = 0;
  for (const p of picked) {
    for (const kind of ['incorrect', 'correct'] as const) {
      const text = p[kind];
      rec.seen.clear();
      const s = performance.now();
      const j = await judgeSentence(rec, pack, NEUTRAL, text);
      const ms = performance.now() - s;
      // Which side of each variant's margin was bounded: the variant's own rest call is
      // recorded; the original side is whatever remains of ScoredVariant.bounded.
      const segs = pack.segment(text);
      const sides = j.variants.map((v) => {
        const cut = sharedPrefixEnd(segs, v.start);
        const prefixContext = cut === 0 ? NEUTRAL : NEUTRAL + text.slice(0, cut);
        const vb = rec.seen.get(`${prefixContext}\u0000${v.text.slice(cut)}`) ?? false;
        return { variant: vb, original: (v.bounded ?? false) && !vb };
      });
      // Counterfactual policy: cap only when the variant side is bounded.
      const variantPolicy = decideVerdict(
        j.variants.map((v, i) => ({ margin: v.margin, explainKey: v.explainKey, bounded: sides[i]!.variant })),
        DEFAULT_JUDGE_OPTIONS,
      );
      // Counterfactual: no cap at all (what the judge did before Task V).
      const noCap = decideVerdict(j.variants.map((v) => ({ margin: v.margin, explainKey: v.explainKey })), DEFAULT_JUDGE_OPTIONS);
      const bi = j.best ? j.variants.indexOf(j.best) : -1;
      rows.push({
        id: p.id,
        rule: p.rule,
        kind,
        ms: +ms.toFixed(0),
        ...summarize(j, text, kind === 'incorrect' ? p.correct : undefined),
        bestSide: bi >= 0 ? sides[bi] : null,
        variantPolicy,
        noCap,
      });
    }
    done++;
    if (done % 9 === 0) log(`n=${n}: ${done}/${picked.length} pairs, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  save(`topn${n}`, { meta: meta(), n, perRule, calls: timed.summary(), totalMs: performance.now() - t0, rows });
}

async function runTiming() {
  const time = async (f: () => Promise<unknown>, reps: number) => {
    const ts: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      await f();
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    return { median: +ts[Math.floor(ts.length / 2)]!.toFixed(0), min: +ts[0]!.toFixed(0), max: +ts[ts.length - 1]!.toFixed(0), reps };
  };
  let i = 0;
  const out: Record<string, unknown> = { meta: meta() };
  out.score10words = await time(() => http.scoreContinuation(NEUTRAL, `Ayer mi hermano y yo fuimos al mercado ${i++} veces.`), 7);
  out.next20 = await time(() => http.nextTokens(NEUTRAL + `Había una vez un ${i++}`, 20), 7);
  out.next50 = await time(() => http.nextTokens(NEUTRAL + `Había una vez un ${i++}`, 50), 7);
  out.generate1x24 = await time(() => http.generate(NEUTRAL + 'Había una vez', { n: 1, maxTokens: 24, temperature: 0.8, seed: i++ }), 3);
  out.generate4x24 = await time(() => http.generate(NEUTRAL + 'Había una vez', { n: 4, maxTokens: 24, temperature: 0.8, seed: i++ }), 2);
  out.judge = await time(() => judgeSentence(http, pack, NEUTRAL, `Mi hermano es enfermo hoy.`), 3);
  out.scoreWords = await time(() => scoreWords(http, pack, NEUTRAL, `Mi hermano está enfermo hoy.`), 5);
  out.nextWords = await time(() => nextWords(http, NEUTRAL + `Marta empezó a`), 3);
  out.cliffAnswer = await time(() => scoreCliffAnswer(http, pack, NEUTRAL + 'Marta empezó a', 'mesa', 'leer'), 3);
  const top10 = new TopNBoundedModel(http, { n: 10 });
  out.scoreTop10 = await time(() => top10.scoreContinuation(NEUTRAL, `Ayer mi hermano y yo fuimos al mercado ${i++} veces.`), 3);
  out.judgeTop10 = await time(() => judgeSentence(top10, pack, NEUTRAL, `Mi hermano es enfermo hoy.`), 2);
  out.meta2 = meta();
  log(JSON.stringify(out, null, 1));
  save('timing', out);
}

/** Credit floors: natural and wrong answers at several cliffs (labels are a Spanish speaker's judgement). */
async function runCredit() {
  const model = new TimedModel(http);
  const cases: { opening: string; actual: string; natural: string[]; wrong: string[] }[] = [
    { opening: 'En la playa hacía mucho', actual: 'calor', natural: ['calor', 'frío', 'sol', 'viento', 'ruido'], wrong: ['mesa', 'verde', 'comer', 'rápido'] },
    { opening: 'Esta noche vamos a', actual: 'cenar', natural: ['cenar', 'ver', 'comer', 'salir', 'bailar', 'celebrar', 'nadar'], wrong: ['mesa', 'verde', 'casa', 'rojo'] },
    { opening: 'El perro corrió hacia la', actual: 'puerta', natural: ['puerta', 'casa', 'calle', 'playa', 'ventana', 'cocina'], wrong: ['verde', 'comer', 'rápido', 'ayer'] },
    { opening: 'La niña abrió la puerta y', actual: 'salió', natural: ['salió', 'entró', 'vio', 'miró', 'gritó', 'corrió', 'sonrió'], wrong: ['mesa', 'verde', 'rápido', 'casa'] },
    { opening: 'Mi hermano siempre', actual: 'llega', natural: ['llega', 'dice', 'come', 'trabaja', 'juega', 'canta'], wrong: ['mesa', 'verde', 'azul', 'puerta'] },
    {
      opening: 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba cerrado. Entonces vio una nota en la puerta y empezó a',
      actual: 'leerla',
      natural: ['leerla', 'leer', 'llorar', 'reír', 'gritar', 'sonreír', 'buscar', 'pensar'],
      wrong: ['mesa', 'verde', 'puerta', 'rápido'],
    },
  ];
  const rows: unknown[] = [];
  for (const c of cases) {
    const ctx = scoringContext(pack, c.opening);
    for (const [label, answers] of [['natural', c.natural], ['wrong', c.wrong]] as const) {
      for (const a of answers) {
        const r = await scoreCliffAnswer(model, pack, ctx, a, c.actual);
        rows.push({ opening: c.opening.slice(-40), actual: c.actual, label, answer: a, prob: r.prob, credit: r.credit, reason: r.reason, rank: r.rank });
        log(label.padEnd(7), c.opening.slice(-28).padEnd(28), a.padEnd(10), r.prob.toExponential(2), r.credit, r.reason, r.rank ?? '-');
      }
    }
  }
  save('credit', { meta: meta(), calls: model.summary(), rows });
}

const sections: Record<string, () => Promise<void>> = {
  credit: runCredit,
  judge: runJudge,
  street: runStreet,
  heat: runHeat,
  cliffs: runCliffs,
  generate: runGenerate,
  topn: runTopN,
  timing: runTiming,
};
const run = sections[section];
if (!run) throw new Error(`unknown section ${section}`);
const T = performance.now();
await run();
log(`done in ${((performance.now() - T) / 1000).toFixed(1)} s`);
