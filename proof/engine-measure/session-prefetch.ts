/**
 * StorySession.prefetch on the real model: the time next() takes with and without a
 * prefetch on the landing screen, for an early learner (a few sentences).
 *
 * Usage, from engine/ with proof/model_server.py listening:
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8771 npx vite-node ../proof/engine-measure/session-prefetch.ts [sentences] [label]
 *
 * Two sessions with the same seed and learner: A prefetches before every next(), B does
 * not. Both answer each cliff with the story's own word. Reported per sentence: the
 * prefetch time, A's next() time and model calls during it, B's next() time, and whether
 * A and B showed the same sentence (they must). Results: results/session-prefetch-<label>.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
import { StorySession } from '../../engine/src/index';
import { HttpLanguageModel } from '../../engine/src/model/http';
import { learnerFor, pack, pair } from './learners';

const OUT = new URL('./results', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const sentences = Number(process.argv[2] ?? 3);
const label = process.argv[3] ?? 'early';
const BASE = process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8771';
const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);

const make = () => {
  const learner = learnerFor('early');
  learner.apply({ type: 'read', key: 'es:casa', at: T0 - 60_000 });
  return StorySession.create({ model: new HttpLanguageModel({ baseUrl: BASE, timeoutMs: 900_000 }), pack, pair, learner, now: T0, seed: 5 });
};
const a = make();
const b = make();
const rows: Record<string, unknown>[] = [];
let t = T0;
for (let i = 0; i < sentences; i++) {
  t += 1000;
  const p0 = performance.now();
  const info = await a.prefetch(t);
  const prefetchMs = performance.now() - p0;
  const callsBefore = a.modelStats.calls;
  const a0 = performance.now();
  const stepA = await a.next(t);
  const nextMs = performance.now() - a0;
  const callsDuringNext = a.modelStats.calls - callsBefore;
  const b0 = performance.now();
  const stepB = await b.next(t);
  const plainMs = performance.now() - b0;
  const same = JSON.stringify(stepA) === JSON.stringify(stepB);
  const text = stepA.screen.kind === 'cliff' ? stepA.screen.sentence.text : stepA.screen.kind;
  rows.push({ i, text, prefetchMs: Math.round(prefetchMs), prefetchCalls: info.modelCalls, nextMs: Math.round(nextMs), callsDuringNext, plainNextMs: Math.round(plainMs), same });
  console.log(i, text, `prefetch ${(prefetchMs / 1000).toFixed(1)} s (${info.modelCalls} calls), next ${(nextMs / 1000).toFixed(2)} s (${callsDuringNext} calls), without prefetch ${(plainMs / 1000).toFixed(1)} s, same ${same}`);
  // Answer the cliff with the story's word on both, then the landing screen is where the next prefetch runs.
  t += 1000;
  for (const s of [a, b]) {
    const cur = s.snapshot().state.current;
    if (s.screen.kind === 'cliff' && cur) await s.handleUtterance(cur.cliff.answer, t);
  }
}
writeFileSync(`${OUT}/session-prefetch-${label}.json`, JSON.stringify({ date: new Date().toISOString(), loadavg: loadavg(), rows }, null, 1));
