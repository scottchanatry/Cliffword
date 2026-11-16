/**
 * Model calls and seconds per session step type, on the mock model or the real one.
 *
 * Usage, from engine/ (the real model needs proof/model_server.py listening):
 *   npx vite-node ../proof/engine-measure/session-calls.ts -- <before|after> <mock|real> [sentences] [label]
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8773 npx vite-node ../proof/engine-measure/session-calls.ts -- after real 3
 * "before" imports the engine from CLIFFWORD_ENGINE_BEFORE (a directory holding an older
 * engine/src, e.g. `git archive HEAD engine/src | tar -x -C <dir>`, then <dir>/engine/src).
 *
 * A counting wrapper sits between the session and the model and books every call
 * (scoreContinuation, nextTokens, generate) and its time under the step being run:
 * - next: StorySession.next() to a new sentence (generation, cliff positions, distractors);
 * - answer:<kind>: one cliff answer per kind on copies of the session restored at the
 *   cliff (the story's word, the model's best other word, a wrong word, a wrong form);
 * - turn: the learner's sentence on the learner-turn screen (judgeSentence + scoreWords);
 * - retell: one retell round (no model expected);
 * - lyric next / lyric answer:<kind> / echo: the same for a LyricSession on a short song.
 * Every step's result is kept as a hash, so a before and an after run can be compared
 * step by step (results must be identical where the alternatives are the same).
 * Results: results/session-calls-<label>.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { cpus, loadavg } from 'node:os';
import * as NOW_ENGINE from '../../engine/src/index';
import type { GenerateOptions, LanguageModel, TokenCandidate, TokenScore } from '../../engine/src/index';
import { HttpLanguageModel } from '../../engine/src/model/http';
import { profilePrior, PROFILES } from './learners';

const args = process.argv.slice(2).filter((a) => a !== '--');
const mode = (args[0] ?? 'after') as 'before' | 'after';
const which = (args[1] ?? 'mock') as 'mock' | 'real';
const sentences = Number(args[2] ?? 3);
const label = args[3] ?? `${mode}-${which}`;
const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type Engine = typeof NOW_ENGINE;
const E: Engine = mode === 'before' ? await import(`${process.env.CLIFFWORD_ENGINE_BEFORE}/index.ts`) : NOW_ENGINE;
const pack = E.createDefaultSpanishPack();
const pair = E.createDefaultPairPack();
const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);

type Method = 'scoreContinuation' | 'nextTokens' | 'generate';
interface Book {
  calls: Record<Method, number>;
  ms: Record<Method, number>;
}
const emptyBook = (): Book => ({ calls: { scoreContinuation: 0, nextTokens: 0, generate: 0 }, ms: { scoreContinuation: 0, nextTokens: 0, generate: 0 } });

/** Books every call and its time under the current step label. */
class CountingModel implements LanguageModel {
  readonly id: string;
  label = 'setup';
  book = emptyBook();
  constructor(readonly inner: LanguageModel) {
    this.id = inner.id;
  }
  private queue: Promise<unknown> = Promise.resolve();
  /** One request at a time (the server answers one at a time; a burst of connections can overflow its listen queue under load). */
  private async time<T>(m: Method, f: () => Promise<T>): Promise<T> {
    const book = this.book;
    book.calls[m] += 1;
    const run = async () => {
      const t0 = performance.now();
      try {
        return await f();
      } finally {
        book.ms[m] += performance.now() - t0;
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
  scoreContinuation(c: string, t: string): Promise<TokenScore[]> {
    return this.time('scoreContinuation', () => this.inner.scoreContinuation(c, t));
  }
  nextTokens(c: string, k: number): Promise<TokenCandidate[]> {
    return this.time('nextTokens', () => this.inner.nextTokens(c, k));
  }
  generate(p: string, o: GenerateOptions): Promise<string[]> {
    return this.time('generate', () => this.inner.generate(p, o));
  }
}

const inner: LanguageModel =
  which === 'mock'
    ? E.createMockModel()
    : new HttpLanguageModel({ baseUrl: process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8773', timeoutMs: 900_000 });
const model = new CountingModel(inner);

interface Row {
  step: string;
  calls: Record<Method, number>;
  total: number;
  ms: number;
  modelMs: number;
  screen: string;
  note?: string;
  hash: string;
}
const rows: Row[] = [];
const hash = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);

async function measure<T>(step: string, f: () => Promise<T> | T, describe: (r: T) => { screen: string; note?: string }): Promise<T> {
  model.book = emptyBook();
  const t0 = performance.now();
  const r = await f();
  const ms = performance.now() - t0;
  const b = model.book;
  const total = b.calls.scoreContinuation + b.calls.nextTokens + b.calls.generate;
  const d = describe(r);
  const row: Row = { step, calls: { ...b.calls }, total, ms: +ms.toFixed(1), modelMs: +(b.ms.scoreContinuation + b.ms.nextTokens + b.ms.generate).toFixed(1), screen: d.screen, hash: hash(r) };
  if (d.note !== undefined) row.note = d.note;
  rows.push(row);
  console.log(`${step.padEnd(22)} ${String(total).padStart(4)} calls (score ${b.calls.scoreContinuation}, next ${b.calls.nextTokens}, gen ${b.calls.generate}) ${(ms / 1000).toFixed(2).padStart(7)} s  ${d.screen}${d.note ? `  ${d.note}` : ''}`);
  return r;
}

type StoryStepT = Awaited<ReturnType<InstanceType<Engine['StorySession']>['next']>>;
const stepInfo = (s: StoryStepT) => {
  const scr = s.screen as { kind: string; outcome?: { credit: string; reason: string; scored: string; prob: number | null } };
  return { screen: scr.kind, note: scr.outcome ? `${scr.outcome.scored} ${scr.outcome.credit} ${scr.outcome.reason} p=${scr.outcome.prob === null ? '-' : scr.outcome.prob.toExponential(2)}` : undefined };
};

// ---------------------------------------------------------------------------
// Story session
// ---------------------------------------------------------------------------

const prior = profilePrior(PROFILES.early.reach);
const newLearner = () => {
  const l = new E.LearnerModel({ prior });
  l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  return l;
};
const storyOptions = { sentencesPerChapter: Math.max(1, Math.min(sentences, 6)) };
const story = E.StorySession.create({ model, pack, pair, learner: newLearner(), now: T0, seed: 5, options: storyOptions });
let t = T0;

/** A copy of the story session restored at this point, sharing the counting model. */
const copyOf = (s: InstanceType<Engine['StorySession']>) =>
  E.StorySession.restore(JSON.parse(JSON.stringify(s.snapshot())), { model, pack, pair, learner: E.LearnerModel.restore(s.learner.snapshot(), { prior }) }, { options: storyOptions });

const wrongWord = (options: readonly string[]) => ['mesa', 'verde', 'ayer', 'rápido'].find((w) => !options.some((o) => E.looseText(pack, o) === w)) ?? 'mesa';

for (let i = 0; i < sentences; i++) {
  t += 1000;
  const st = await measure('next', () => story.next(t), stepInfo);
  if (st.screen.kind !== 'cliff') continue;
  const cur = story.snapshot().state.current;
  if (!cur) continue;
  const actual = cur.cliff.answer;
  const optionTexts = (cur.options ?? []).map((o) => o.text);
  const alt = cur.alternatives.find((a) => E.looseText(pack, a.word) !== E.looseText(pack, actual) && !optionTexts.some((o) => E.looseText(pack, o) === E.looseText(pack, a.word)));
  // A wrong form: another analysis-based form of the actual word's lemma, when the pack makes one.
  const first = pack.segment(actual).find((x) => x.kind === 'word');
  let form: string | undefined;
  if (first) {
    const a = pack.analyze(first.norm || pack.normalize(first.text))[0];
    if (a && a.pos === 'VERB') form = pack.inflect(a.lemma, { form: 'fin', mood: 'ind', tense: 'pres', person: '1', number: 'p' });
    else if (a) form = pack.inflect(a.lemma, { ...a.features, number: a.features.number === 'p' ? 's' : 'p' });
    if (form && E.looseText(pack, form) === E.looseText(pack, first.text)) form = undefined;
  }
  const kinds: [string, string | undefined][] = [
    ['alternative', alt?.word],
    ['wrong', wrongWord(optionTexts)],
    ['form', form],
  ];
  console.log(`  cliff "${actual}" rung ${cur.rung}, ${cur.alternatives.length} alternatives, sentence: ${cur.text}`);
  for (const [kind, answer] of kinds) {
    if (!answer) continue;
    const c = copyOf(story);
    await measure(`answer:${kind}`, () => c.handleUtterance(answer, t + 500), stepInfo);
  }
  t += 1000;
  await measure('answer:actual', () => story.handleUtterance(actual, t), stepInfo);
}

// Chapter end: the learner turn (a model judgement), then the retell.
for (let guard = 0; guard < 4; guard++) {
  const kind = story.screen.kind;
  if (kind === 'turn' || kind === 'upNext' || kind === 'retell') break;
  t += 1000;
  await measure('next (to chapter end)', () => story.next(t), stepInfo);
}
if (story.screen.kind === 'turn') {
  t += 1000;
  await measure('turn', () => story.handleUtterance('Ayer yo fui al mercado con mi hermano y compramos fruta.', t), stepInfo);
  t += 1000;
  await measure('next (to up next)', () => story.next(t), stepInfo);
}
if (story.screen.kind === 'upNext') {
  t += 1000;
  await measure('next (retell start)', () => story.next(t), stepInfo);
}
if (story.screen.kind === 'retell') {
  t += 1000;
  const scene = (story.screen as { scene: string }).scene;
  await measure('retell', () => story.handleUtterance(scene, t, { durationMs: 20_000 }), stepInfo);
}

// ---------------------------------------------------------------------------
// Lyric session
// ---------------------------------------------------------------------------

const SONG = [
  '[Verso 1]',
  'Esta noche salimos a bailar',
  'El corillo ya está listo pa la fiesta',
  'Nadie se queda en la casa',
  '',
  '[Coro]',
  'Vamos a cantar hasta que salga el sol',
  'Y mañana no me acuerdo de nada',
].join('\n');
const lyrics = E.parseLyrics(SONG, pack);
const lyricLearner = new E.LearnerModel({ prior });
const lyric = E.LyricSession.create({ model, pack, pair, learner: lyricLearner, now: T0, seed: 3, source: { kind: 'lyrics', lyrics }, settings: { register: 'street', regions: ['PR'] } });
type LyricStepT = Awaited<ReturnType<InstanceType<Engine['LyricSession']>['next']>>;
const lyricInfo = (s: LyricStepT) => {
  const scr = s.screen as { kind: string; outcome?: { credit: string; reason: string; scored: string; prob: number | null } };
  return { screen: scr.kind, note: scr.outcome ? `${scr.outcome.scored} ${scr.outcome.credit} ${scr.outcome.reason} p=${scr.outcome.prob === null ? '-' : scr.outcome.prob.toExponential(2)}` : undefined };
};
const lyricCopy = () =>
  E.LyricSession.restore(JSON.parse(JSON.stringify(lyric.snapshot())), { model, pack, pair, learner: E.LearnerModel.restore(lyricLearner.snapshot(), { prior }) });
const lines = Math.min(lyrics.lines.length, Math.max(2, sentences));
for (let i = 0; i < lines; i++) {
  t += 1000;
  const st = await measure('lyric next', () => lyric.next(t), lyricInfo);
  if (st.screen.kind === 'cliff') {
    const c = lyric.snapshot().state.cliff;
    if (c) {
      const optionTexts = (c.options ?? []).map((o) => o.text);
      const alt = c.alternatives.find((a) => E.looseText(pack, a.word) !== E.looseText(pack, c.answer) && !optionTexts.some((o) => E.looseText(pack, o) === E.looseText(pack, a.word)));
      console.log(`  lyric cliff "${c.answer}" rung ${c.rung}, ${c.alternatives.length} alternatives`);
      if (alt) await measure('lyric answer:alternative', () => lyricCopy().handleUtterance(alt.word, t + 300), lyricInfo);
      await measure('lyric answer:wrong', () => lyricCopy().handleUtterance(wrongWord(optionTexts), t + 400), lyricInfo);
      t += 1000;
      await measure('lyric answer:actual', () => lyric.handleUtterance(c.answer, t), lyricInfo);
    }
  }
  t += 1000;
  await measure('echo', async () => {
    lyric.startEcho(t);
    const unit = lyrics.lines[lyric.snapshot().state.unit];
    return lyric.handleUtterance(unit?.text ?? '', t + 1);
  }, lyricInfo);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const byStep = new Map<string, Row[]>();
for (const r of rows) {
  const k = r.step.startsWith('next (') ? 'next (chapter flow)' : r.step;
  byStep.set(k, [...(byStep.get(k) ?? []), r]);
}
const summary: Record<string, { n: number; calls: { mean: number; min: number; max: number }; byMethod: Record<Method, number>; seconds: { mean: number; max: number } }> = {};
console.log('\nstep                      n   calls mean (min-max)   score  next  gen   seconds mean (max)');
for (const [k, rs] of byStep) {
  const totals = rs.map((r) => r.total);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const byMethod = {
    scoreContinuation: +mean(rs.map((r) => r.calls.scoreContinuation)).toFixed(1),
    nextTokens: +mean(rs.map((r) => r.calls.nextTokens)).toFixed(1),
    generate: +mean(rs.map((r) => r.calls.generate)).toFixed(1),
  };
  const secs = rs.map((r) => r.ms / 1000);
  summary[k] = {
    n: rs.length,
    calls: { mean: +mean(totals).toFixed(1), min: Math.min(...totals), max: Math.max(...totals) },
    byMethod,
    seconds: { mean: +mean(secs).toFixed(3), max: +Math.max(...secs).toFixed(3) },
  };
  console.log(
    `${k.padEnd(24)} ${String(rs.length).padStart(3)}   ${mean(totals).toFixed(1).padStart(6)} (${Math.min(...totals)}-${Math.max(...totals)})`.padEnd(48) +
      `${String(byMethod.scoreContinuation).padStart(5)} ${String(byMethod.nextTokens).padStart(5)} ${String(byMethod.generate).padStart(4)}   ${mean(secs).toFixed(2)} (${Math.max(...secs).toFixed(2)})`,
  );
}
writeFileSync(
  `${OUT}/session-calls-${label}.json`,
  JSON.stringify({ when: new Date().toISOString(), mode, model: which, sentences, load: loadavg().map((x) => +x.toFixed(2)), cores: cpus().length, summary, rows }, null, 1),
);
console.log(`saved results/session-calls-${label}.json`);
