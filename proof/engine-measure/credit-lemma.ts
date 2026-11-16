/**
 * Cliff credit on the real model: the six cliff sets of proof/ENGINE_REAL_MODEL.md
 * section 4 (40 natural and 23 wrong single-word answers) and a supplementary set for
 * lemma credit (an answer that is the same inflection of the same lexeme as a likely
 * alternative, such as reír for reírse), written before any lemma-credit code or run.
 *
 * Usage, from engine/ with proof/model_server.py listening:
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8773 npx vite-node ../proof/engine-measure/credit-lemma.ts -- <before|after> [label]
 * "before" imports the engine from CLIFFWORD_ENGINE_BEFORE (an older engine/src) and calls
 * scoreCliffAnswer exactly as the last round did (one next-word search per answer).
 * "after" computes each cliff's alternatives once (nextWordsDetailed with the credit
 * options' k and nextWord, what scoreCliffAnswer would search), passes them in, and also
 * sweeps lemmaWeight and partialFloor with the same alternatives (model answers are
 * memoized: the model is deterministic, so a repeated request needs no second call).
 * lemmaWeight 0 with the alternatives passed in is the engine before lemma credit (the
 * precomputed alternatives give the same results as the search; "before" on a subset of
 * cliffs checks it: `before <label> <cliff indices>`).
 *
 * Labels are a Spanish speaker's judgement. Classes: natural; wrong (another word that
 * does not fit, including a verb without the pronoun it needs here: "fue a su cuarto a
 * acostar"); form (the actual word's lexeme in a wrong inflection, which keeps the
 * partial 'form' credit by design). Results: results/credit-lemma-<label>.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import * as NOW_ENGINE from '../../engine/src/index';
import { HttpLanguageModel } from '../../engine/src/model/http';

const args = process.argv.slice(2).filter((a) => a !== '--');
const mode = (args[0] ?? 'after') as 'before' | 'after';
const label = args[1] ?? mode;
const only = args[2] ? new Set(args[2].split(',').map(Number)) : undefined;
const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

type Engine = typeof NOW_ENGINE;
const E: Engine = mode === 'before' ? await import(`${process.env.CLIFFWORD_ENGINE_BEFORE}/index.ts`) : NOW_ENGINE;
const pack = E.createDefaultSpanishPack();
const model = new HttpLanguageModel({ baseUrl: process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8773', timeoutMs: 900_000 });

interface Cliff {
  set: 'section4' | 'lemma';
  opening: string;
  actual: string;
  natural: string[];
  wrong: string[];
  form: string[];
}

// proof/ENGINE_REAL_MODEL.md section 4 (proof/engine-measure/measure.ts runCredit; "vamos a
// casa" counts as natural there, which gives its 40 natural and 23 wrong answers).
const SECTION4: Cliff[] = [
  { set: 'section4', opening: 'En la playa hacía mucho', actual: 'calor', natural: ['calor', 'frío', 'sol', 'viento', 'ruido'], wrong: ['mesa', 'verde', 'comer', 'rápido'], form: [] },
  { set: 'section4', opening: 'Esta noche vamos a', actual: 'cenar', natural: ['cenar', 'ver', 'comer', 'salir', 'bailar', 'celebrar', 'nadar', 'casa'], wrong: ['mesa', 'verde', 'rojo'], form: [] },
  { set: 'section4', opening: 'El perro corrió hacia la', actual: 'puerta', natural: ['puerta', 'casa', 'calle', 'playa', 'ventana', 'cocina'], wrong: ['verde', 'comer', 'rápido', 'ayer'], form: [] },
  { set: 'section4', opening: 'La niña abrió la puerta y', actual: 'salió', natural: ['salió', 'entró', 'vio', 'miró', 'gritó', 'corrió', 'sonrió'], wrong: ['mesa', 'verde', 'rápido', 'casa'], form: [] },
  { set: 'section4', opening: 'Mi hermano siempre', actual: 'llega', natural: ['llega', 'dice', 'come', 'trabaja', 'juega', 'canta'], wrong: ['mesa', 'verde', 'azul', 'puerta'], form: [] },
  {
    set: 'section4',
    opening: 'Marta llegó tarde al mercado. Buscó al señor de las frutas, pero su puesto estaba cerrado. Entonces vio una nota en la puerta y empezó a',
    actual: 'leerla',
    natural: ['leerla', 'leer', 'llorar', 'reír', 'gritar', 'sonreír', 'buscar', 'pensar'],
    wrong: ['mesa', 'verde', 'puerta', 'rápido'],
    form: ['lee', 'leyó', 'leía'],
  },
];

// Supplementary lemma-credit set (written 2026-11-16 before the lemma-credit code):
// cliffs where the model is likely to expect a pronominal or clitic form.
const LEMMA: Cliff[] = [
  { set: 'lemma', opening: 'Cuando vio al payaso, la niña empezó a', actual: 'reírse', natural: ['reírse', 'reír', 'llorar', 'gritar'], wrong: ['mesa', 'verde'], form: ['reía', 'ríe'] },
  { set: 'lemma', opening: 'Estaba muy cansado, así que fue a su cuarto a', actual: 'dormir', natural: ['dormir', 'descansar', 'acostarse', 'leer'], wrong: ['acostar', 'mesa'], form: ['duerme'] },
  { set: 'lemma', opening: 'Llegamos tarde al cine y no pudimos', actual: 'entrar', natural: ['entrar', 'sentarnos', 'ver', 'comprar'], wrong: ['sentar', 'mesa'], form: ['entramos'] },
  { set: 'lemma', opening: 'La fiesta fue genial y todos empezaron a', actual: 'bailar', natural: ['bailar', 'cantar', 'divertirse', 'reír', 'reírse'], wrong: ['divertir', 'mesa'], form: ['bailaron'] },
  { set: 'lemma', opening: 'Sonó el despertador, pero Juan no quería', actual: 'levantarse', natural: ['levantarse', 'salir', 'ir', 'despertarse'], wrong: ['levantar', 'mesa'], form: ['levanta'] },
  { set: 'lemma', opening: 'Mi abuela me llamó para', actual: 'decirme', natural: ['decirme', 'saludarme', 'preguntarme', 'invitarme', 'hablar'], wrong: ['mesa', 'verde'], form: ['dice'] },
];

const CLIFFS = [...SECTION4, ...LEMMA];
type Klass = 'natural' | 'wrong' | 'form';
interface Row {
  set: string;
  opening: string;
  actual: string;
  klass: Klass;
  answer: string;
  prob: number;
  rank: number | null;
  credit: string;
  reason: string;
  lemmaMatch?: { word: string; prob: number } | undefined;
  ms: number;
}

const rows: Row[] = [];
const alternativesByCliff: Record<string, { word: string; prob: number }[]> = {};
const sweep: Record<string, Row[]> = {};
const t0 = performance.now();
let calls = 0;
const memo = new Map<string, Promise<unknown>>();
// One request at a time (the server answers one at a time anyway; a burst of parallel
// connections can overflow its listen queue on a loaded machine).
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => {
  const p = queue.then(f, f);
  queue = p.catch(() => undefined);
  return p;
};
const once = <T>(key: string, f: () => Promise<T>): Promise<T> => {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    calls++;
    p = serial(f);
    memo.set(key, p);
  }
  return p;
};
const counted = {
  id: model.id,
  scoreContinuation: (c: string, t: string) => once(JSON.stringify(['s', c, t]), () => model.scoreContinuation(c, t)),
  nextTokens: (c: string, k: number) => once(JSON.stringify(['n', c, k]), () => model.nextTokens(c, k)),
  generate: (p: string, o: Parameters<typeof model.generate>[1]) => (calls++, model.generate(p, o)),
};

for (const [ci, c] of CLIFFS.entries()) {
  if (only && !only.has(ci)) continue;
  const ctx = E.scoringContext(pack, c.opening);
  let pre: NOW_ENGINE.NextWord[] | undefined;
  if (mode === 'after') {
    const o = E.DEFAULT_CREDIT_OPTIONS;
    pre = (await E.nextWordsDetailed(counted, ctx.replace(/\s+$/u, ''), { ...E.DEFAULT_NEXT_WORD_OPTIONS, ...o.nextWord, k: o.k, normalize: (w: string) => pack.normalize(w) })).words;
  }
  for (const klass of ['natural', 'wrong', 'form'] as const) {
    for (const answer of c[klass]) {
      const a0 = performance.now();
      const r = await E.scoreCliffAnswer(counted, pack, ctx, answer, c.actual, pre ? { alternatives: pre } : {});
      const ms = performance.now() - a0;
      alternativesByCliff[c.opening] ??= r.alternatives.map((x) => ({ word: x.word, prob: +x.prob.toPrecision(3) }));
      const lemmaMatch = (r as { lemmaMatch?: { word: string; prob: number } }).lemmaMatch;
      rows.push({ set: c.set, opening: c.opening.slice(-48), actual: c.actual, klass, answer, prob: r.prob, rank: r.rank, credit: r.credit, reason: r.reason, lemmaMatch, ms: Math.round(ms) });
      console.log(`${c.set.padEnd(8)} ${c.opening.slice(-30).padEnd(30)} ${klass.padEnd(7)} ${answer.padEnd(12)} ${r.prob.toExponential(2)} ${r.credit.padEnd(7)} ${r.reason.padEnd(9)} ${lemmaMatch ? `via ${lemmaMatch.word} ${lemmaMatch.prob.toExponential(2)}` : ''} ${Math.round(ms)} ms`);
      if (pre) {
        for (const lemmaWeight of [0, 0.02, 0.05, 0.1, 0.25, 0.5, 1]) {
          for (const partialFloor of [1e-4, 5e-4, 2e-3, 5e-3]) {
            const k = `w=${lemmaWeight} floor=${partialFloor}`;
            const s = await E.scoreCliffAnswer(counted, pack, ctx, answer, c.actual, { alternatives: pre, lemmaWeight, partialFloor } as Partial<NOW_ENGINE.CreditOptions>);
            const lm = (s as { lemmaMatch?: { word: string; prob: number } }).lemmaMatch;
            (sweep[k] ??= []).push({ set: c.set, opening: c.opening.slice(-48), actual: c.actual, klass, answer, prob: s.prob, rank: s.rank, credit: s.credit, reason: s.reason, lemmaMatch: lm, ms: 0 });
          }
        }
      }
    }
  }
}

function tally(rs: Row[]) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const set of ['section4', 'lemma']) {
    const r = rs.filter((x) => x.set === set);
    const n = (k: Klass) => r.filter((x) => x.klass === k).length;
    const credited = (k: Klass) => r.filter((x) => x.klass === k && x.credit !== 'none').length;
    const full = (k: Klass) => r.filter((x) => x.klass === k && x.credit === 'full').length;
    out[set] = {
      natural: `${credited('natural')}/${n('natural')} credited, ${full('natural')} full`,
      wrong: `${credited('wrong')}/${n('wrong')} credited`,
      form: `${r.filter((x) => x.klass === 'form' && x.reason === 'form').length}/${n('form')} kept 'form', ${r.filter((x) => x.klass === 'form' && x.credit === 'full').length} full`,
      lemma: r.filter((x) => x.lemmaMatch).map((x) => `${x.answer} via ${x.lemmaMatch?.word} (${x.klass}, ${x.credit})`),
    };
  }
  return out;
}

const summary = tally(rows);
console.log(JSON.stringify(summary, null, 1));
const sweepSummary: Record<string, unknown> = {};
for (const [k, rs] of Object.entries(sweep)) sweepSummary[k] = tally(rs);
if (Object.keys(sweepSummary).length) console.log(JSON.stringify(sweepSummary, null, 1));
writeFileSync(
  `${OUT}/credit-lemma-${label}.json`,
  JSON.stringify({ when: new Date().toISOString(), mode, seconds: +((performance.now() - t0) / 1000).toFixed(1), calls, load: loadavg().map((x) => +x.toFixed(2)), cores: cpus().length, summary, sweepSummary, alternatives: alternativesByCliff, rows, sweep }, null, 1),
);
console.log(`saved results/credit-lemma-${label}.json`);
