/**
 * Real-model check of an en-es series: every line, turn question and example answer,
 * resolved for both forms of address, judged by judgeSentence (Qwen3-1.7B through
 * proof/model_server.py), and the model's most likely words at every cliff (candidates
 * for cliff.accept, reviewed by hand).
 *
 * Usage, from engine/ (start the server first, engine/scripts/real-model.md):
 *   CLIFFWORD_MODEL_URL=http://127.0.0.1:8796 npx vite-node ../proof/stories/model-check.ts -- living [out.json] [ids]
 * where ids optionally limits the check to some lines and turns: 'e1.l08,e8.l13,e5.t02'
 * ('-' for no output file, '' or 'all' for every line). CLIFFWORD_CHECK=judge or
 * CLIFFWORD_CHECK=alternatives runs only that half.
 *
 * Lines are judged after the previous line (the story so far is the context), in neutral
 * register, and again in street register (Puerto Rico) when they hold slang. An "assert"
 * means the engine would correct the line: fix it unless it is certainly right, and note
 * why. Prints a summary; writes the full results as JSON when a path is given.
 */
import { writeFileSync } from 'node:fs';
import { createDefaultSpanishPack, judgeSentence, nextWords, scoringContext, slangIn } from '../../engine/src';
import type { Judgement } from '../../engine/src';
import { resolveStory, variantContext } from '../../engine/src/content/variants';
import { HttpLanguageModel } from '../../engine/src/model/http';
import { LIVING_STORIES, LIVING_TRACK } from '../../engine/src/pair/en-es/stories/living';
import type { LibraryStory, LibraryTrack } from '../../engine/src/pair/types';
import { locateAnswer } from '../../engine/src/session/cliff';

const SERIES: Record<string, { track: LibraryTrack; stories: readonly LibraryStory[]; regions: string[] }> = {
  living: { track: LIVING_TRACK, stories: LIVING_STORIES, regions: ['PR'] },
};

interface Check {
  where: string;
  you: 'm' | 'f';
  text: string;
  register: 'neutral' | 'street';
  verdict: string;
  best?: string;
  margin?: number | null;
  explainKey?: string | null;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const name = args[0] ?? 'living';
const out = args[1] && args[1] !== '-' ? args[1] : undefined;
const only = args[2] && args[2] !== 'all' ? new Set(args[2].split(',')) : null;
const mode = process.env.CLIFFWORD_CHECK ?? 'all';
const judging = mode !== 'alternatives';
const alternativesWanted = mode !== 'judge';
const series = SERIES[name];
if (!series) throw new Error(`unknown series ${name}`);
const model = new HttpLanguageModel({ baseUrl: process.env.CLIFFWORD_MODEL_URL ?? 'http://127.0.0.1:8796' });
const pack = createDefaultSpanishPack();

function summarize(j: Judgement): Pick<Check, 'verdict' | 'best' | 'margin' | 'explainKey'> {
  return { verdict: j.verdict, best: j.best?.text, margin: j.margin === null ? null : Math.round(j.margin * 100) / 100, explainKey: j.explainKey };
}

async function judgeBoth(where: string, you: 'm' | 'f', before: string, text: string): Promise<Check[]> {
  const res: Check[] = [];
  const j = await judgeSentence(model, pack, scoringContext(pack, before), text);
  res.push({ where, you, text, register: 'neutral', ...summarize(j) });
  const slang = slangIn(pack, text, series!.regions);
  if (slang.length) {
    const ctx = scoringContext(pack, before, { register: 'street', regions: series!.regions, words: slang });
    const s = await judgeSentence(model, pack, ctx, text, { register: 'street' });
    res.push({ where, you, text, register: 'street', ...summarize(s) });
  }
  return res;
}

const checks: Check[] = [];
const alternatives: { where: string; you: 'm' | 'f'; word: string; top: { word: string; prob: number }[] }[] = [];
const seen = new Set<string>();
const t0 = Date.now();
for (const story of series.stories) {
  for (const you of ['f', 'm'] as const) {
    const r = resolveStory(story, variantContext(series.track, you));
    let prev = '';
    for (const line of r.sentences) {
      const where = `${story.id} ${line.id}`;
      const key = `${where}|${line.text}`;
      if (!seen.has(key) && (!only || only.has(line.id))) {
        seen.add(key);
        if (judging) checks.push(...(await judgeBoth(where, you, prev ? `${prev} ` : '', line.text)));
        const span = alternativesWanted ? locateAnswer(pack, line.text, line.cliff.word) : null;
        if (span) {
          // The text before the gap without its trailing space: the model's next word
          // carries its own leading space (as the session asks it).
          const head = line.text.slice(0, span.start).trimEnd();
          const top = await nextWords(model, scoringContext(pack, `${prev ? `${prev} ` : ''}${head}`), { k: 6, beamWidth: 6, maxModelCalls: 24, normalize: (w) => pack.normalize(w) });
          alternatives.push({ where, you, word: line.cliff.word, top: top.map((w) => ({ word: w.word, prob: Math.round(w.prob * 1000) / 1000 })) });
        }
      }
      prev = line.text;
    }
    for (const t of r.turns ?? []) {
      const where = `${story.id} ${t.id}`;
      const key = `${where}|${t.line}|${t.example}`;
      if (!judging || seen.has(key) || (only && !only.has(t.id))) continue;
      seen.add(key);
      const q = r.sentences[t.after]?.text ?? '';
      checks.push(...(await judgeBoth(`${where} question`, you, q ? `${q} ` : '', t.line)));
      checks.push(...(await judgeBoth(`${where} example`, you, `${t.line} `, t.example)));
    }
  }
  console.error(`${story.id} done (${Math.round((Date.now() - t0) / 1000)} s)`);
}

const flagged = checks.filter((c) => c.verdict !== 'ok');
console.log(`\n${checks.length} judgements, ${flagged.filter((c) => c.verdict === 'assert').length} asserts, ${flagged.filter((c) => c.verdict === 'hint').length} hints`);
for (const c of flagged) console.log(`${c.verdict.toUpperCase()} [${c.register}] ${c.where} (${c.you}) margin ${c.margin} ${c.explainKey}\n    ${c.text}\n -> ${c.best}`);
console.log('\nCliff alternatives (model top words at the gap):');
for (const a of alternatives) console.log(`${a.where} (${a.you}) [${a.word}]: ${a.top.map((w) => `${w.word} ${w.prob}`).join(', ')}`);
if (out) writeFileSync(out, JSON.stringify({ model: model.id, checks, alternatives }, null, 2));
