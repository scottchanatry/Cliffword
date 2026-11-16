/**
 * Next-sentence generation with simulated learners on the real model, over a running
 * story: before (the engine at a given directory, e.g. the previous commit) and after
 * (the working tree).
 *
 * Usage, from engine/ with proof/model_server.py listening:
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8771 npx vite-node ../proof/engine-measure/generation.ts \
 *     <after|before> [profiles] [steps] [seedBase] [label]
 * "before" imports the engine from CLIFFWORD_ENGINE_BEFORE (a directory holding the old
 * engine/src, e.g. `git archive HEAD engine/src | tar -x -C /tmp/before`) and runs it with
 * the tuning of the previous measurement (n = 4).
 *
 * Each profile starts from its opening sentences (learners.ts OPENINGS; the brand-new
 * learner from the starter story it has just heard) and generates `steps` sentences in a
 * row, appending each chosen sentence to the story. Targets follow the session: one per
 * sentence (newWordsPerSentence < 1.5 at every level here), the last three sentences'
 * targets excluded. In "after" mode the brand-new learner generates on the bridge
 * (session/handover.ts: familiar words, content-word targets, introduced words).
 * Per step: in band (as selection judged it, and on the learner's own pKnown), target
 * used, the sentence, reject counts by reason, the new rejects applied to the chosen
 * sentence, seconds per call, generate and score calls, and the tokens prefilled and
 * decoded (counted with /score after the timed call). Results: results/generation-<label>.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cpus, loadavg } from 'node:os';
import * as NOW_ENGINE from '../../engine/src/index';
import { HttpLanguageModel } from '../../engine/src/model/http';
import { OPENINGS, PROFILES, profilePrior } from './learners';
import type { ProfileId } from './learners';

const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const mode = (process.argv[2] ?? 'after') as 'after' | 'before';
const profiles = (process.argv[3] ?? 'brandNew,early,reader,advanced,heritage').split(',') as ProfileId[];
const steps = Number(process.argv[4] ?? 8);
const seedBase = Number(process.argv[5] ?? 1);
const label = process.argv[6] ?? mode;
const BASE = process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8771';
const http = new HttpLanguageModel({ baseUrl: BASE, timeoutMs: 900_000 });
const NOW = Date.UTC(2026, 10, 15, 9, 0, 0);

type Engine = typeof NOW_ENGINE;
const E: Engine = mode === 'before' ? await import(`${process.env.CLIFFWORD_ENGINE_BEFORE}/index.ts`) : NOW_ENGINE;
const pack = E.createDefaultSpanishPack();
const pair = E.createDefaultPairPack();
const KEYS = E.frequencyLexemeKeys(pack);
// The current engine's rejects, applied to every chosen sentence (before and after).
const nowPack = NOW_ENGINE.createDefaultSpanishPack();
const nowPair = NOW_ENGINE.createDefaultPairPack();

/** Counts calls and time per method. */
class Timed {
  calls = { generate: 0, score: 0, next: 0 };
  readonly id = http.id;
  generate(p: string, o: Parameters<typeof http.generate>[1]) {
    this.calls.generate++;
    return http.generate(p, o);
  }
  scoreContinuation(c: string, t: string) {
    this.calls.score++;
    return http.scoreContinuation(c, t);
  }
  nextTokens(c: string, k: number) {
    this.calls.next++;
    return http.nextTokens(c, k);
  }
}

async function tokenCount(text: string): Promise<number> {
  if (!text) return 0;
  return (await http.scoreContinuation('', text)).length;
}

const rows: Record<string, unknown>[] = [];
const summary: Record<string, Record<string, unknown>> = {};
for (const id of profiles) {
  const learner = new E.LearnerModel({ prior: profilePrior(PROFILES[id].reach) });
  const story: string[] = [...OPENINGS[id]];
  const recentTargets: string[][] = [];
  const introduced: string[] = [];
  const perStep: Record<string, unknown>[] = [];
  for (let step = 0; step < steps; step++) {
    const vocab = E.estimateVocabulary(learner, NOW, KEYS);
    const params = E.deriveParams({ vocab });
    const bridge = mode === 'after' && id === 'brandNew';
    const familiar: string[] = bridge ? (NOW_ENGINE.bridgeFamiliar(nowPack, nowPair, introduced) as string[]) : [];
    const contentPos = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);
    const targets = E.chooseTargets({
      learner,
      now: NOW,
      frequencyKeys: KEYS,
      exclude: [...recentTargets.flat(), ...familiar],
      ...(bridge ? { accept: (k: string) => contentPos.has(pack.analyze(pack.normalize(k.slice(3)))[0]?.pos ?? '') } : {}),
      options: { count: params.newWordsPerSentence >= 1.5 ? 2 : 1 },
    }).map((t) => t.key);
    const model = new Timed();
    const seed = seedBase + step * 1000;
    const t0 = performance.now();
    const r = mode === 'before'
      ? await E.generateNextSentence(model, { pack, learner, pair }, { story, targets, params, now: NOW, seed, tuning: { n: 4 } })
      : await E.generateNextSentence(model, { pack, learner, pair }, {
          story, targets, params, now: NOW, seed, vocab, names: id === 'heritage' ? [] : ['Marta'], ...(familiar.length ? { familiar } : {}),
        });
    const ms = performance.now() - t0;
    const rejects: Record<string, number> = {};
    for (const e of r.ranked) for (const c of e.rejected) rejects[c] = (rejects[c] ?? 0) + 1;
    const best = r.best;
    // The chosen sentence through the current rejects, and on the learner's own pKnown.
    const own = r.sentence
      ? NOW_ENGINE.evaluateCandidate(r.sentence, 0, { pack: nowPack, learner, now: NOW, targets, params, previous: story.slice(-8), pair: nowPair, names: id === 'heritage' ? [] : ['Marta'] })
      : null;
    const rounds = r.diagnostics.rounds as { prompt: string; raw: string[] }[];
    let promptTokens = 0;
    let decodeTokens = 0;
    for (const round of rounds) {
      promptTokens += await tokenCount(round.prompt);
      for (const raw of round.raw) decodeTokens += (await tokenCount(raw)) + 1; // + the stop or end token
    }
    const row = {
      profile: id, step, seed, vocab: Math.round(vocab), sentenceWords: params.sentenceWords, targets,
      sentence: r.sentence, inBand: best?.inBand ?? false, ownInBand: own ? own.inBand && own.rejected.length === 0 : false,
      ownShare: own ? +own.bandShare.toFixed(3) : null, targetUsed: (best?.targetsHit.length ?? 0) > 0,
      newRejects: own?.rejected ?? [], rejects, candidates: r.ranked.length, accepted: r.ranked.filter((e) => e.accepted).length,
      retried: r.diagnostics.retried, generateCalls: model.calls.generate, scoreCalls: model.calls.score,
      seconds: +(ms / 1000).toFixed(2), promptTokens, decodeTokens, bridge,
      ranked: r.ranked.map((e) => ({ text: e.text, accepted: e.accepted, inBand: e.inBand, share: +e.bandShare.toFixed(3), rejected: e.rejected, targets: e.targetsHit })),
      prompts: rounds.map((x) => x.prompt),
    };
    rows.push(row);
    perStep.push(row);
    console.log(`${id} ${step} ${row.seconds}s ${row.inBand ? 'IN' : 'out'}${row.ownInBand ? '/own' : ''} ${row.targetUsed ? 'T' : '-'} ${row.retried ? 'retry' : ''} ${JSON.stringify(rejects)} ${r.sentence}`);
    if (r.sentence) story.push(r.sentence);
    recentTargets.push(targets);
    while (recentTargets.length > 3) recentTargets.shift();
    for (const k of best?.targetsHit ?? []) if (!introduced.includes(k)) introduced.push(k);
  }
  const n = perStep.length;
  const rate = (k: string) => +(perStep.filter((x) => x[k] === true).length / n).toFixed(2);
  const secs = perStep.map((x) => x.seconds as number).sort((a, b) => a - b);
  const rejectsSum: Record<string, number> = {};
  for (const x of perStep) for (const [k, v] of Object.entries(x.rejects as Record<string, number>)) rejectsSum[k] = (rejectsSum[k] ?? 0) + v;
  const junk = perStep.filter((x) => (x.newRejects as string[]).length > 0).length;
  summary[id] = {
    runs: n,
    inBand: rate('inBand'),
    ownInBand: rate('ownInBand'),
    targetUse: rate('targetUsed'),
    distinct: new Set(perStep.map((x) => x.sentence).filter(Boolean)).size,
    noSentence: perStep.filter((x) => !x.sentence).length,
    chosenFailingNewRejects: junk,
    rejects: rejectsSum,
    meanSeconds: +(secs.reduce((a, b) => a + b, 0) / n).toFixed(1),
    medianSeconds: secs[Math.floor(n / 2)],
    maxSeconds: secs[n - 1],
    meanGenerateCalls: +(perStep.reduce((a, x) => a + (x.generateCalls as number), 0) / n).toFixed(2),
    meanScoreCalls: +(perStep.reduce((a, x) => a + (x.scoreCalls as number), 0) / n).toFixed(2),
    meanPromptTokens: Math.round(perStep.reduce((a, x) => a + (x.promptTokens as number), 0) / n),
    meanDecodeTokens: Math.round(perStep.reduce((a, x) => a + (x.decodeTokens as number), 0) / n),
  };
  console.log(id, JSON.stringify(summary[id]));
}
const meta = { date: new Date().toISOString(), mode, steps, seedBase, cpus: cpus().length, loadavg: loadavg(), server: BASE };
writeFileSync(`${OUT}/generation-${label}.json`, JSON.stringify({ meta, summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
