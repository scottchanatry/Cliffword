/**
 * Correction coverage on the proof sets and the held-out sets, through the engine's public
 * functions against Qwen3-1.7B over HTTP (proof/model_server.py), or offline (variants only).
 *
 * Usage, from engine/:
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8772 npx vite-node ../proof/engine-measure/coverage.ts -- <label> [sets] [--offline]
 * sets: comma list of pairs, holdout, holdout2, slang, slanghold, slanghold2 (default: pairs,
 * holdout, slang, slanghold). holdout2 and slanghold2 are the second, blind held-out sets.
 * Writes results/coverage-<label>.json and prints a summary.
 *
 * Pair sets (neutral register, judgeSentence with the defaults): asserted, asserted with the
 * exact fix, flagged with the exact fix, fix generated (among the scored variants), right rule
 * family, and false asserts and hints on the correct sentences, per rule family.
 * Street sets (street register, street prefix naming the slang): verdicts, asserts, variants
 * that touch a slang word, and slang words shaded by scoreWords with slangExemption. A slang
 * word is a word of a slang form found in the sentence (slangIn, phrases matched as runs of
 * words) or an inflected form of a single-word entry of the sentence's regions (an analysis
 * with the entry's lemma: bacana, panas).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import {
  createDefaultSpanishPack,
  expandRegions,
  generateVariantSet,
  judgeSentence,
  scoreWords,
  scoringContext,
  slangExemption,
  slangIn,
} from '../../engine/src/index';
import type { Judgement, Segment } from '../../engine/src/index';
import { HttpLanguageModel } from '../../engine/src/model/http';

const PROOF = new URL('../', import.meta.url).pathname;
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2).filter((a) => a !== '--');
const offline = args.includes('--offline');
const pos = args.filter((a) => !a.startsWith('--'));
const label = pos[0] ?? 'run';
const sets = new Set((pos[1] ?? 'pairs,holdout,slang,slanghold').split(','));

interface Pair { id: number; rule: string; correct: string; incorrect: string }
interface Street { id: number; street: string; neutral: string; region: string; explicit: boolean }
const jsonl = <T>(file: string): T[] => readFileSync(PROOF + file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as T);

/**
 * Rule tag -> explanation keys that name the same rule. The proof's "number" tag includes
 * subject-verb agreement, and its "articles" tag contractions and body-part articles, so
 * those tags also accept the keys of the rules that cover them.
 */
const FAMILY: Record<string, string[]> = {
  ser_estar: ['es.ser_estar'],
  por_para: ['es.por_para'],
  gender: ['es.gender'],
  number: ['es.number', 'es.verb_agreement'],
  subject_verb: ['es.verb_agreement'],
  preterite_imperfect: ['es.aspect'],
  subjunctive_wish: ['es.mood'],
  personal_a: ['es.personal_a'],
  articles: ['es.article', 'es.contraction', 'es.body_article'],
  contraction: ['es.contraction', 'es.article'],
  body_article: ['es.body_article'],
  pronoun_placement: ['es.pronoun_placement', 'es.pronoun_order', 'es.negative_command', 'es.se_lo', 'es.pronoun_double'],
};

const pack = createDefaultSpanishPack();
const NEUTRAL = scoringContext(pack, '');
const model = offline ? null : new HttpLanguageModel({ baseUrl: process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8772', timeoutMs: 600_000 });
const meta = () => ({ when: new Date().toISOString(), load: loadavg().map((x) => +x.toFixed(2)), cores: cpus().length, offline });

interface PairRow {
  id: number;
  rule: string;
  kind: 'incorrect' | 'correct';
  text: string;
  verdict: string | null;
  margin: number | null;
  best: string | null;
  bestKey: string | null;
  bestRule: string | null;
  variants: number;
  dropped: number;
  fixGenerated?: boolean;
  fixMargin?: number | null;
  ms?: number;
}

function judgeRow(p: Pair, kind: 'incorrect' | 'correct', j: Judgement | null, ms?: number): PairRow {
  const text = p[kind];
  if (!j) {
    const set = generateVariantSet(pack, text);
    const fix = kind === 'incorrect' ? set.variants.find((v) => v.text === p.correct) : undefined;
    return {
      id: p.id, rule: p.rule, kind, text, verdict: null, margin: null, best: null, bestKey: null, bestRule: null,
      variants: set.variants.length, dropped: set.dropped,
      fixGenerated: kind === 'incorrect' ? !!fix : undefined,
    };
  }
  const fix = kind === 'incorrect' ? j.variants.find((v) => v.text === p.correct) : undefined;
  return {
    id: p.id, rule: p.rule, kind, text, verdict: j.verdict, margin: j.margin, best: j.best?.text ?? null,
    bestKey: j.best?.explainKey ?? null, bestRule: j.best?.ruleId ?? null, variants: j.variants.length, dropped: j.droppedVariants,
    fixGenerated: kind === 'incorrect' ? !!fix : undefined, fixMargin: fix ? +fix.margin.toFixed(3) : kind === 'incorrect' ? null : undefined,
    ms,
  };
}

async function runPairs(file: string): Promise<PairRow[]> {
  const pairs = jsonl<Pair>(file);
  const rows: PairRow[] = [];
  const t0 = performance.now();
  for (const p of pairs) {
    for (const kind of ['incorrect', 'correct'] as const) {
      const s = performance.now();
      const j = model ? await judgeSentence(model, pack, NEUTRAL, p[kind]) : null;
      rows.push(judgeRow(p, kind, j, model ? Math.round(performance.now() - s) : undefined));
    }
    if (model && p.id % 10 === 0) console.log(`[coverage] ${file} ${p.id} ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  return rows;
}

function summarizePairs(rows: PairRow[]) {
  const fam: Record<string, Record<string, number>> = {};
  const all: Record<string, number> = {};
  const add = (k: string, rule: string, v = 1) => {
    const f = (fam[rule] ??= {});
    f[k] = (f[k] ?? 0) + v;
    all[k] = (all[k] ?? 0) + v;
  };
  const correctOf = new Map(rows.filter((r) => r.kind === 'correct').map((r) => [r.id, r.text]));
  for (const r of rows) {
    if (r.kind === 'incorrect') {
      add('n', r.rule);
      if (r.fixGenerated) add('fixGenerated', r.rule);
      if (r.verdict === null) continue;
      const right = r.best === correctOf.get(r.id);
      if (r.verdict === 'assert') add('asserted', r.rule);
      if (r.verdict === 'assert' && right) add('assertedRightFix', r.rule);
      if (r.verdict !== 'ok' && right) add('flaggedRightFix', r.rule);
      if (r.verdict === 'hint') add('hinted', r.rule);
      if (r.verdict !== 'ok' && (FAMILY[r.rule] ?? []).includes(r.bestKey ?? '')) add('rightRule', r.rule);
    } else if (r.verdict !== null) {
      if (r.verdict === 'assert') add('falseAsserts', r.rule);
      if (r.verdict === 'hint') add('falseHints', r.rule);
    }
  }
  const flagsOnCorrect = rows.filter((r) => r.kind === 'correct' && r.verdict && r.verdict !== 'ok').map((r) => `${r.verdict} ${r.text} -> ${r.best} (${r.margin?.toFixed(2)}, ${r.bestRule})`);
  const misses = rows
    .filter((r) => r.kind === 'incorrect' && !(r.verdict === 'assert' && r.best === correctOf.get(r.id)))
    .map((r) => `[${r.rule}] ${r.text} -> ${r.verdict ?? '-'} ${r.best ?? '-'} (${r.margin?.toFixed(2) ?? '-'}) fix ${r.fixGenerated ? `generated ${r.fixMargin ?? ''}` : 'NOT generated'}`);
  return { all, families: fam, flagsOnCorrect, misses };
}

interface StreetRow {
  id: number;
  region: string;
  text: string;
  slangNamed: string[];
  slangSegments: string[];
  verdict: string | null;
  margin: number | null;
  best: string | null;
  bestRule: string | null;
  variants: number;
  touchingSlang: string[];
  slangHeat: { word: string; heat: number }[];
}

/** Slang words of `text` for the regions (see the module comment). */
function slangWordsOf(text: string, regions: readonly string[]): Segment[] {
  const segs = pack.segment(text).filter((x) => x.kind === 'word');
  const out = new Set<Segment>();
  for (const form of slangIn(pack, text, regions)) {
    const fw = pack.segment(form).filter((x) => x.kind === 'word').map((x) => x.norm);
    for (let i = 0; i + fw.length <= segs.length; i++) {
      if (fw.every((w, k) => segs[i + k]?.norm === w)) for (let k = 0; k < fw.length; k++) out.add(segs[i + k] as Segment);
    }
  }
  const allowed = new Set(regions);
  const lemmas = new Set<string>();
  for (const reg of pack.registers) {
    for (const e of reg.entries) {
      if (!e.regions.some((r) => allowed.has(r))) continue;
      if (pack.segment(e.form).filter((x) => x.kind === 'word').length !== 1) continue;
      lemmas.add(e.lemma);
      lemmas.add(e.norm);
    }
  }
  for (const x of segs) if (pack.analyze(x.norm).some((a) => lemmas.has(a.lemma))) out.add(x);
  return segs.filter((x) => out.has(x));
}

async function runStreet(file: string): Promise<StreetRow[]> {
  const rows: StreetRow[] = [];
  for (const s of jsonl<Street>(file)) {
    const region = s.region === 'DR' ? 'DO' : s.region;
    const regions = [...(expandRegions([region]) ?? [])];
    const named = slangIn(pack, s.street, regions);
    const ctx = scoringContext(pack, '', { register: 'street', regions, words: named });
    const exempt = slangExemption(pack, regions);
    const slangSegs = slangWordsOf(s.street, regions);
    const touches = (start: number, end: number) => slangSegs.some((x) => start < x.end && x.start < end);
    let j: Judgement | null = null;
    let variants;
    if (model) {
      j = await judgeSentence(model, pack, ctx, s.street, { register: 'street' });
      variants = j.variants;
    } else {
      variants = generateVariantSet(pack, s.street, { register: 'street' }).variants;
    }
    const heat = model ? await scoreWords(model, pack, ctx, s.street, { exempt }) : [];
    rows.push({
      id: s.id,
      region,
      text: s.street,
      slangNamed: named,
      slangSegments: slangSegs.map((x) => x.text),
      verdict: j?.verdict ?? null,
      margin: j?.margin ?? null,
      best: j?.best?.text ?? null,
      bestRule: j?.best?.ruleId ?? null,
      variants: variants.length,
      touchingSlang: variants.filter((v) => touches(v.start, Math.max(v.end, v.start + 1))).map((v) => `${v.ruleId}: ${v.text}`),
      slangHeat: heat.filter((w) => slangSegs.some((x) => x.start === w.segment.start)).map((w) => ({ word: w.segment.text, heat: w.heat })),
    });
    if (model) console.log(`[coverage] ${file} ${s.id} ${j?.verdict} ${j?.best?.text ?? ''} ${j?.margin?.toFixed(2) ?? ''}`);
  }
  return rows;
}

function summarizeStreet(rows: StreetRow[]) {
  const verdicts: Record<string, number> = {};
  for (const r of rows) if (r.verdict) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
  return {
    n: rows.length,
    verdicts,
    asserts: rows.filter((r) => r.verdict === 'assert').map((r) => `${r.text} -> ${r.best} (${r.margin?.toFixed(2)}, ${r.bestRule})`),
    hints: rows.filter((r) => r.verdict === 'hint').map((r) => `${r.text} -> ${r.best} (${r.margin?.toFixed(2)}, ${r.bestRule})`),
    variantsTouchingSlang: rows.flatMap((r) => r.touchingSlang.map((t) => `${r.text} :: ${t}`)),
    slangWords: rows.reduce((n, r) => n + r.slangSegments.length, 0),
    slangShaded: rows.flatMap((r) => r.slangHeat.filter((w) => w.heat > 0).map((w) => `${r.text} :: ${w.word} ${w.heat}`)),
    noSlangFound: rows.filter((r) => r.slangSegments.length === 0).map((r) => r.text),
  };
}

async function main() {
  const out: Record<string, unknown> = { meta: meta(), label };
  const summary: Record<string, unknown> = {};
  const t0 = performance.now();
  const PAIR_SETS: Record<string, string> = { pairs: 'pairs.jsonl', holdout: 'pairs_holdout.jsonl', holdout2: 'pairs_holdout2.jsonl' };
  const STREET_SETS: Record<string, string> = { slang: 'slang.jsonl', slanghold: 'slang_holdout.jsonl', slanghold2: 'slang_holdout2.jsonl' };
  for (const [name, file] of Object.entries(PAIR_SETS)) {
    if (!sets.has(name)) continue;
    const rows = await runPairs(file);
    out[name] = rows;
    summary[name] = summarizePairs(rows);
  }
  for (const [name, file] of Object.entries(STREET_SETS)) {
    if (!sets.has(name)) continue;
    const rows = await runStreet(file);
    out[name] = rows;
    summary[name] = summarizeStreet(rows);
  }
  out.summary = summary;
  out.totalMs = Math.round(performance.now() - t0);
  writeFileSync(`${OUT}coverage-${label}.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
