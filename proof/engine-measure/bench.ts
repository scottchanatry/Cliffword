/**
 * Micro-benchmark of the engine's own hot paths with the mock model (no real model):
 * the work a session step does on the phone's JS engine besides waiting for the model.
 *
 * Usage, from engine/:
 *   npx vite-node ../proof/engine-measure/bench.ts -- <before|after> [label] [rounds]
 * "before" imports the engine from CLIFFWORD_ENGINE_BEFORE (an older engine/src).
 *
 * Every case runs a warm-up, then `rounds` timed calls on a fresh pack where a case is
 * about first use ("cold"), else on a shared pack; ms per call are reported as the
 * median and the mean. Node's JIT is much faster than Hermes (no JIT on the phone, often
 * 5 to 10 times slower on compute-heavy code), so anything above about 1 ms here that runs
 * on every step is worth a look. Results: results/bench-<label>.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import * as NOW_ENGINE from '../../engine/src/index';
import { profilePrior, PROFILES } from './learners';

const args = process.argv.slice(2).filter((a) => a !== '--');
const mode = (args[0] ?? 'after') as 'before' | 'after';
const label = args[1] ?? mode;
const rounds = Number(args[2] ?? 50);
const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type Engine = typeof NOW_ENGINE;
const E: Engine = mode === 'before' ? await import(`${process.env.CLIFFWORD_ENGINE_BEFORE}/index.ts`) : NOW_ENGINE;
const pack = E.createDefaultSpanishPack();
const pair = E.createDefaultPairPack();
const model = E.createMockModel();
const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);
const learner = new E.LearnerModel({ prior: profilePrior(PROFILES.early.reach) });
const KEYS = E.frequencyLexemeKeys(pack);

const SENTENCES = [
  'Marta llegó tarde al mercado.',
  'Buscó al señor de las frutas, pero su puesto estaba cerrado.',
  'Entonces vio una nota en la puerta y empezó a leerla en voz alta.',
  'Mi hermano es enfermo hoy.',
  'Ayer yo fui al mercado con mi hermano y compramos fruta.',
  'Los niños juega en el parque todos los días.',
  'Quiero que tú vienes a mi casa mañana por la tarde.',
  'El corillo ya está listo pa la fiesta.',
];
const SONG = Array.from({ length: 5 }, (_, s) =>
  [
    `[Verso ${s + 1}]`,
    '[00:12.50]Esta noche salimos a janguear',
    '[00:15.00][00:40.20]El corillo ya ’tá listo',
    '[00:18.3]pa’ bailar hasta que salga el sol',
    'Vamos a cantar (x2)',
    'Nadie se queda en la casa, mano',
    '',
  ].join('\n'),
).join('\n');
const WORDS = [...new Set(SENTENCES.flatMap((s) => pack.segment(s).filter((x) => x.kind === 'word').map((x) => x.norm)))];

interface Result {
  name: string;
  perStep: boolean;
  medianMs: number;
  meanMs: number;
  maxMs: number;
  n: number;
}
const results: Result[] = [];

async function bench(name: string, perStep: boolean, f: (i: number) => unknown | Promise<unknown>, n = rounds, warm = 3): Promise<void> {
  for (let i = 0; i < warm; i++) await f(i);
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await f(i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const r: Result = {
    name,
    perStep,
    medianMs: +(times[Math.floor(times.length / 2)] as number).toFixed(3),
    meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
    maxMs: +(times[times.length - 1] as number).toFixed(3),
    n,
  };
  results.push(r);
  console.log(`${name.padEnd(52)} ${r.medianMs.toFixed(3).padStart(9)} ms median  ${r.meanMs.toFixed(3).padStart(9)} mean  ${r.maxMs.toFixed(2).padStart(8)} max${perStep ? '  (every step)' : ''}`);
}

// Lexicon lookups.
await bench('pack.analyze, 40 sentence words (warm)', true, () => {
  for (const w of WORDS) pack.analyze(w);
});
await bench('pack.analyze, first use on a new pack (cold)', false, () => {
  const p = E.createDefaultSpanishPack();
  for (const w of WORDS) p.analyze(w);
}, 5, 1);
await bench('createDefaultSpanishPack()', false, () => E.createDefaultSpanishPack(), 5, 1);
await bench('pack.segment, 8 sentences', true, () => {
  for (const s of SENTENCES) pack.segment(s);
});
await bench('pack.inflect, 40 analyses', true, () => {
  for (const w of WORDS) for (const a of pack.analyze(w)) pack.inflect(a.lemma, a.features);
});

// Corrections.
await bench('generateVariants, 8 sentences', true, () => {
  for (const s of SENTENCES) E.generateVariants(pack, s);
});
await bench('judgeSentence (mock), 1 sentence', true, (i) => E.judgeSentence(model, pack, E.scoringContext(pack, ''), SENTENCES[i % SENTENCES.length] as string));

// Scoring.
await bench('scoreWords (mock), 1 sentence', true, (i) => E.scoreWords(model, pack, E.scoringContext(pack, ''), SENTENCES[i % SENTENCES.length] as string));
await bench('slangIn + scoringContext (street), 1 sentence', true, (i) => {
  const s = SENTENCES[i % SENTENCES.length] as string;
  return E.scoringContext(pack, '', { register: 'street', regions: ['PR'], words: E.slangIn(pack, s, ['PR']) });
});
await bench('findSlangMatches, 8 sentences', true, () => {
  for (const s of SENTENCES) E.findSlangMatches(pack, s, { regions: ['PR'] });
});

// Session views.
await bench('sentenceWords, 8 sentences', true, () => {
  for (const s of SENTENCES) E.sentenceWords(pack, s, { register: 'neutral', regions: [] });
});
const viewWords = SENTENCES.map((s) => E.sentenceWords(pack, s, { register: 'neutral', regions: [] }));
const params = E.deriveParams({ vocab: 300 });
await bench('buildSentenceView, 8 sentences', true, () => {
  SENTENCES.forEach((s, i) =>
    E.buildSentenceView(s, viewWords[i] ?? [], { cliff: { wordIndex: 2, length: 1, answered: false }, revealed: [] }, {
      pack, pair, learner, now: T0, params, settings: { textMode: 'auto', showExplicit: true }, rate: 1,
    }),
  );
});

// Learner-wide work a step does.
await bench('estimateVocabulary (frequency list)', true, () => E.estimateVocabulary(learner, T0, KEYS));
await bench('frequencyLexemeKeys(pack)', true, () => E.frequencyLexemeKeys(pack));
await bench('chooseTargets', true, () => E.chooseTargets({ learner, now: T0, frequencyKeys: KEYS, options: { count: 2 } }));

// Lyrics.
const songLines = SONG.split('\n').length;
await bench(`parseLyrics, ${songLines} source lines`, false, () => E.parseLyrics(SONG, pack));

// Whole steps with no model (canned) and with the mock.
await bench('StorySession canned: next + answer', true, async (i) => {
  const s = E.StorySession.create({ model: null, pack, pair, learner: new E.LearnerModel(), now: T0, seed: i + 1, startMode: 'brand_new' });
  await s.next(T0 + 1000);
  const ans = s.snapshot().state.current?.cliff.answer ?? '';
  await s.handleUtterance(ans, T0 + 2000);
}, 20, 2);
await bench('StorySession mock: next + answer', true, async (i) => {
  const l = new E.LearnerModel({ prior: profilePrior(PROFILES.early.reach) });
  l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  const s = E.StorySession.create({ model, pack, pair, learner: l, now: T0, seed: i + 1 });
  await s.next(T0 + 1000);
  await s.handleUtterance('mesa', T0 + 2000);
}, 10, 1);
// The engine's own work per step: an instant model (every token -2 nats, a fixed
// next-token list, generation from a fixed list), so only engine code is timed.
const STORY_LINES = ['Marta compró pan en el mercado.', 'Su hermano llegó tarde a la casa.', 'Ella vio una nota en la puerta.', 'El perro corrió hacia la calle.', 'Mi madre cocina sopa los domingos.'];
const NEXT = [' casa', ' calle', ' puerta', ' mesa', ' pan', ' perro', ' madre', ' nota', '.', ',', ' el', ' la', ' de', ' que', ' y', ' en', ' un', ' una', ' es', ' no'];
const instant: NOW_ENGINE.LanguageModel = {
  id: 'instant',
  async scoreContinuation(_c: string, t: string) {
    return [...t.matchAll(/\s*[\p{L}\p{M}']+|\s*\d+|\s*[^\s\p{L}\p{M}\d]/gu)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, logprob: -2 }));
  },
  async nextTokens(_c: string, k: number) {
    return NEXT.slice(0, k).map((text, i) => ({ text, logprob: Math.log(0.3 / (i + 1)) }));
  },
  async generate(_p: string, o: NOW_ENGINE.GenerateOptions) {
    return Array.from({ length: o.n }, (_, i) => ' ' + STORY_LINES[((o.seed ?? 0) + i) % STORY_LINES.length]);
  },
};
const steps: Record<string, number[]> = {};
for (let i = 0; i < Math.max(10, Math.floor(rounds / 2)); i++) {
  const l = new E.LearnerModel({ prior: profilePrior(PROFILES.early.reach) });
  l.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  const s = E.StorySession.create({ model: instant, pack, pair, learner: l, now: T0, seed: i + 1, options: { sentencesPerChapter: 2 } });
  const t = async (k: string, f: () => unknown) => {
    const t0 = performance.now();
    await f();
    if (i >= 2) (steps[k] ??= []).push(performance.now() - t0);
  };
  await t('instant model: StorySession next (sentence)', () => s.next(T0 + 1000));
  await t('instant model: StorySession tapWord', () => s.tapWord(1, T0 + 1500));
  await t('instant model: StorySession answer', () => s.handleUtterance('mesa', T0 + 2000));
  await t('instant model: StorySession next (sentence)', () => s.next(T0 + 3000));
  await t('instant model: StorySession answer', () => s.handleUtterance('casa', T0 + 4000));
  await t('instant model: StorySession next (chapter end)', () => s.next(T0 + 5000));
  if (s.screen.kind === 'turn') await t('instant model: StorySession learner turn', () => s.handleUtterance('Ayer yo fui al mercado con mi hermano.', T0 + 6000));
}
for (const [name, times] of Object.entries(steps)) {
  times.sort((a, b) => a - b);
  const r: Result = { name, perStep: true, medianMs: +(times[Math.floor(times.length / 2)] as number).toFixed(3), meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), maxMs: +(times[times.length - 1] as number).toFixed(3), n: times.length };
  results.push(r);
  console.log(`${name.padEnd(52)} ${r.medianMs.toFixed(3).padStart(9)} ms median  ${r.meanMs.toFixed(3).padStart(9)} mean  ${r.maxMs.toFixed(2).padStart(8)} max  (every step)`);
}

const lyrics = E.parseLyrics(SONG, pack);
await bench('instant model: LyricSession next + answer', true, async (i) => {
  const s = E.LyricSession.create({ model: instant, pack, pair, learner: new E.LearnerModel(), now: T0, seed: i + 1, source: { kind: 'lyrics', lyrics } });
  await s.next(T0 + 1000);
  await s.handleUtterance('mesa', T0 + 2000);
}, 20, 2);
await bench('LyricSession mock: next + answer', true, async (i) => {
  const s = E.LyricSession.create({ model, pack, pair, learner: new E.LearnerModel(), now: T0, seed: i + 1, source: { kind: 'lyrics', lyrics } });
  await s.next(T0 + 1000);
  await s.handleUtterance('mesa', T0 + 2000);
}, 10, 1);

writeFileSync(`${OUT}/bench-${label}.json`, JSON.stringify({ when: new Date().toISOString(), mode, node: process.version, load: loadavg().map((x) => +x.toFixed(2)), cores: cpus().length, results }, null, 1));
console.log(`saved results/bench-${label}.json`);
